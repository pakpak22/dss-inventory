import "server-only";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalRouteSteps } from "@/db/schema/approval-routes";
import { users } from "@/db/schema/users";
import { listAllRequests, type PendingRequestRow } from "@/lib/stock/requests";
import { listMyOpenPartIssueApprovals, listOpenPartIssueApprovalsByRequest, listPartIssueApprovalsToDecide, listPartIssueApprovalsToExecute } from "./part-issue";
import { checkCanCancelPartIssue, type PartIssueView } from "./part-issue-rules";
import {
  excludeApprovalsInExecuteList,
  pickPartIssueTrailSource,
  type IssueApprovalCard,
  type IssueApprovalLine,
  type IssueApprovalTrailStep,
  type IssueApprovalTrailView,
} from "./part-issue-screen";
import { isRouteStepSkippedForRequester } from "./route";

/**
 * ============================================================================
 * 「승인 요청건」 화면이 받는 자료 한 벌 (2026-10-15, 조각 11b)
 * ============================================================================
 * 서버 컴포넌트(`src/app/(app)/approvals/page.tsx`)가 **한 번 불러** 세 묶음을 받는 자리다.
 * 결재건을 읽는 일 자체는 앞 조각(11a)의 `./part-issue.ts` 가 다 해 두었다 — 여기서는 그
 * 조회들을 **부르기만** 하고, 화면이 그리는 데 모자란 것 셋을 붙인다:
 *
 *  1. **줄별 부품 이름과 지금 재고** — 결재건에 적힌 것은 `{ partId, quantity }` 뿐이다.
 *  2. **이 건이 타고 있는 판의 단계들** — 결재선 그림의 상자들.
 *  3. **건너뛴 자리인가** — 포털 번호 둘을 견주는 판정. 🔴 번호는 **여기서 끝난다**.
 *
 * ── 🔴 포털 번호는 화면으로 내려가지 않는다 ─────────────────────────────
 * 결재선 그림에 필요한 것은 이름이지 번호가 아니다. 판정(`isRouteStepSkippedForRequester`)을
 * 여기서 끝내고 `skipped` 한 칸만 싣는다 — 앞 조각이 `getCurrentApprovalRouteWithSubs` 와
 * `getCurrentApprovalRoute` 를 가른 까닭과 같다(`./queries.ts` 머리말). 화면이 받는 타입
 * (`./part-issue-screen.ts`)에는 번호를 담을 칸이 아예 없다.
 *
 * ── 🔴 판정을 새로 적지 않는다 ──────────────────────────────────────────
 * 「건너뛰는가」는 서버가 사슬을 이을 때 보는 그 함수, 「거둘 수 있는가」는 `cancelPartIssueApproval`
 * 이 보는 그 함수다. 화면용으로 다시 적으면 단추는 보이는데 눌러도 거절당하는 짝이 생긴다.
 * ============================================================================
 */

export type PartIssueScreenData = {
  /** (가) 내가 결재할 건 — 지금 내 차례. */
  toDecide: IssueApprovalCard[];
  /** (나) 실행할 건 — 결재가 끝났고 아직 안 나간 것. **관리자 세션에서만 채운다.** */
  toExecute: IssueApprovalCard[];
  /** (다) 진행 중인 내 신청. (나)가 보이는 세션에서는 거기 뜬 건이 빠져 있다. */
  mine: IssueApprovalCard[];
  /** 🔴 위에서 뺐는가 — 빈 상태 문구가 이것으로 갈린다(`partIssueProgressEmptyText`). */
  progressExcludesExecutable: boolean;
};

/**
 * 이 건이 타고 있는 **판**의 단계들을 결재건의 `route_id` 로 읽는다.
 *
 * 🔴 **「현재 판」이 아니다.** 관리자가 결재선을 바꿔도 이미 올라간 건은 옛 판을 끝까지 따라가고
 * (`part-issue.ts` 가 `route_id` 를 못 박아 적는 까닭), 현재 판을 세면 「2/2단계」가 「2/4단계」로
 * 보인다.
 * 🔴 **포털 번호를 함께 읽는다** — 건너뛰기 판정에 쓰고 **이 파일 안에서 버린다**(머리말).
 * 🔵 판마다 묻지 않는다 — 건이 20개면 질의가 20번이 된다.
 */
async function routeStepsByRouteId(routeIds: readonly string[]) {
  const ids = [...new Set(routeIds)];
  if (ids.length === 0) return new Map<string, Array<{ stepOrder: number; approverSub: string | null; approverName: string }>>();
  const rows = await db()
    .select({
      routeId: approvalRouteSteps.routeId,
      stepOrder: approvalRouteSteps.stepOrder,
      approverSub: approvalRouteSteps.approverSub,
      approverName: approvalRouteSteps.approverName,
    })
    .from(approvalRouteSteps)
    .where(inArray(approvalRouteSteps.routeId, ids))
    .orderBy(asc(approvalRouteSteps.stepOrder));

  const out = new Map<string, Array<{ stepOrder: number; approverSub: string | null; approverName: string }>>();
  for (const r of rows) {
    const list = out.get(r.routeId) ?? [];
    list.push({ stepOrder: r.stepOrder, approverSub: r.approverSub, approverName: r.approverName });
    out.set(r.routeId, list);
  }
  return out;
}

/**
 * 올린 사람들의 **포털 번호**(`users.auth_sub`). 건너뛰기는 포털 번호 둘을 견주므로 신청자 쪽도
 * 같은 열쇠여야 한다 — 결재건에 적힌 `requested_by` 는 이 시스템의 `users.id` 라서 그대로 쓰면
 * **건너뛰기가 조용히 꺼진다**(`part-issue.ts` 의 `decidePartIssueApproval` 이 같은 까닭으로
 * 같은 값을 읽는다).
 *
 * 🔵 줄이 없으면 `null` 로 둔다 — 그때는 건너뛰지 않는 것이 맞다(`isRouteStepSkippedForRequester`).
 */
async function subsByUserId(userIds: readonly string[]) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db().select({ id: users.id, sub: users.authSub }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.sub]));
}

/**
 * 결재건에 적힌 줄별 수량에 **품명 · 부품 칸 넷 · 소유구분 · 유상/무상 · 지금 재고**를 붙인다.
 * 신청에서 못 찾은 부품은 지어내지 않는다.
 *
 * 🔵 **전부 이미 와 있던 값이다**(2026-10-21, 쓰는 분 접수 5번과 같은 날의 접수). 위에서 부르는
 *    `listAllRequests` 가 고객사 품명·품명2·교산 품번·도번(2026-10-16)과 **소유구분**(2026-10-15)을
 *    싣고 있었고(`RequestLineView`), 여기까지 와서 **버려지고 있었다** — 조회는 한 글자도 안 고치고
 *    **옮겨 적기만** 한다. 🔴 **소유구분이 같은 자리에서 또 빠져 있었다**: 넷을 옮겨 적으면서
 *    바로 윗줄의 `owner` 를 건너뛴 것이라, 「승인 요청건」에서만 소유를 볼 수 없었다.
 * 🔴 **줄을 못 찾으면 넷은 빈 글자, 소유는 `null`** 이다. 품명이 「(지워진 부품)」이 되는 것과 같은
 *    규칙이고, 그러면 화면은 그 줄에 자세한 내용도 딱지도 **아예 안 그린다**
 *    (`request-item-detail.ts` — 막는 자리를 두 벌 두지 않는다).
 * 🔴 **유상/무상만 성격이 다르다 — 그 줄의 값이다.** 부품 표가 아니라 **반출 신청 줄**에서 오고,
 *    사용(반출)이 아닌 신청에는 처음부터 없어 `null` 이 참말이다. 여기서 기본값을 지어내면
 *    **청구가 잘못 간다**(`RequestLineView.chargeType` 주석).
 */
function linesOf(view: PartIssueView, request: PendingRequestRow | undefined): IssueApprovalLine[] {
  return view.quantities.map((q) => {
    const line = request?.lines.find((l) => l.partId === q.partId);
    return {
      partId: q.partId,
      partNo: line?.partNo ?? null,
      partName: line?.partName ?? "(지워진 부품)",
      quantity: q.quantity,
      available: line?.available ?? 0,
      customerName: line?.customerName ?? "",
      name2: line?.name2 ?? "",
      kyosanPartNo: line?.kyosanPartNo ?? "",
      drawingNo: line?.drawingNo ?? "",
      owner: line?.owner ?? null,
      chargeType: line?.chargeType ?? null,
    };
  });
}

type RouteStepRows = ReadonlyMap<string, Array<{ stepOrder: number; approverSub: string | null; approverName: string }>>;

/**
 * 이 건이 타고 있는 판의 단계들 → 그림의 상자들.
 *
 * 🔵 **두 자리가 같은 이 함수를 쓴다** — 「승인 요청건」의 결재건 카드(`toCard`)와 부품 요청 관리의
 *    진행 그림(`readPartIssueTrailsByRequest`). 손으로 두 벌 적으면 「건너뛴 자리」가 한 화면에서만
 *    점선으로 보이는 날이 온다.
 * 🔴 판정을 새로 적지 않는다 — 서버가 사슬을 이을 때 보는 그 함수다. 포털 번호는 여기서 끝난다(머리말).
 */
function trailOf(view: PartIssueView, routeSteps: RouteStepRows, requesterSubs: ReadonlyMap<string, string>): IssueApprovalTrailStep[] {
  const requesterSub = requesterSubs.get(view.requestedBy) ?? null;
  return (routeSteps.get(view.routeId) ?? []).map((step) => ({
    stepOrder: step.stepOrder,
    approverName: step.approverName,
    skipped: isRouteStepSkippedForRequester(step.approverSub, requesterSub),
  }));
}

function toCard(
  view: PartIssueView,
  ctx: {
    viewerUserId: string;
    requests: ReadonlyMap<string, PendingRequestRow>;
    routeSteps: RouteStepRows;
    requesterSubs: ReadonlyMap<string, string>;
  },
): IssueApprovalCard {
  const request = ctx.requests.get(view.requestId);
  const trail = trailOf(view, ctx.routeSteps, ctx.requesterSubs);

  return {
    id: view.id,
    status: view.status,
    reason: view.reason,
    requestedByName: view.requestedByName,
    requestedAt: view.requestedAt,
    // 🔵 A/S 번호(`approverUserId`)는 싣지 않는다 — 그림에 필요한 것은 이름뿐이다.
    currentStep: view.currentStep ? { stepOrder: view.currentStep.stepOrder, approverName: view.currentStep.approverName } : null,
    trail,
    lines: linesOf(view, request),
    request: request ? { type: view.requestType, summary: view.requestSummary, requestedByName: request.requestedByName } : null,
    mine: view.requestedBy === ctx.viewerUserId,
    // 🔵 울타리가 아니라 「그릴까」다. 막는 자리는 `cancelPartIssueApproval` 의 WHERE 다.
    canCancel: checkCanCancelPartIssue(view.status, view.requestedBy, ctx.viewerUserId).ok,
  };
}

/**
 * 세 묶음을 한 번에 읽어 화면이 받는 모양으로.
 *
 * @param viewer 지금 보는 사람 — `userId`(이 시스템의 번호, 「내 신청인가」) ·
 *   `approverSub`(**포털 번호**, 「내 차례인가」) · `isAdmin`(실행 묶음을 보는가).
 *   🔴 두 번호를 바꿔 넘기면 「내가 결재할 건」이 **영원히 빈 목록**이 된다(`part-issue.ts` 의
 *   `listPartIssueApprovalsToDecide` 주석 — 실제로 있었던 결함이다).
 *
 * 🔵 반출 신청 줄은 `listAllRequests()` 한 번으로 받아 결재건에 붙인다 — 신청마다 묻지 않으려는
 *    것이고, 그 함수는 이미 부품 이름·소유·지금 재고를 **한 벌 모양**으로 만들어 준다.
 *    🔴 지금은 신청이 몇십 건이라 이 편이 싸다. **신청이 수백 건이 되면** 결재건이 가리키는 id
 *    로 좁히는 조회를 따로 두고 여기만 바꾼다(부르는 화면은 그대로다).
 */
export async function readPartIssueApprovalScreen(viewer: { userId: string; approverSub: string; isAdmin: boolean }): Promise<PartIssueScreenData> {
  const [toDecideViews, toExecuteViews, mineViews] = await Promise.all([
    listPartIssueApprovalsToDecide(viewer.approverSub),
    // 🔴 관리자가 아니면 **읽지도 않는다** — 화면에서 감추는 묶음이라 자료도 만들 까닭이 없다.
    viewer.isAdmin ? listPartIssueApprovalsToExecute() : Promise.resolve([] as PartIssueView[]),
    listMyOpenPartIssueApprovals(viewer.userId),
  ]);

  const all = [...toDecideViews, ...toExecuteViews, ...mineViews];
  const [requestRows, routeSteps, requesterSubs] = await Promise.all([
    all.length === 0 ? Promise.resolve([] as PendingRequestRow[]) : listAllRequests(),
    routeStepsByRouteId(all.map((v) => v.routeId)),
    subsByUserId(all.map((v) => v.requestedBy)),
  ]);
  const requests = new Map(requestRows.map((r) => [r.id, r]));
  const ctx = { viewerUserId: viewer.userId, requests, routeSteps, requesterSubs };

  const toExecute = toExecuteViews.map((v) => toCard(v, ctx));
  const mineAll = mineViews.map((v) => toCard(v, ctx));
  return {
    toDecide: toDecideViews.map((v) => toCard(v, ctx)),
    toExecute,
    // 🔴 (나)가 보이는 세션에서만 뺀다 — 안 보이는 사람에게서 빼면 승인된 자기 신청이 사라진다.
    mine: viewer.isAdmin ? excludeApprovalsInExecuteList(mineAll, toExecute) : mineAll,
    progressExcludesExecutable: viewer.isAdmin,
  };
}

/* ------------------------------------------------------------------ */
/* 부품 요청 관리 줄에 세우는 진행 그림 (2026-10-21, 조각 11f)            */
/* ------------------------------------------------------------------ */

/**
 * **신청 묶음 → 그 줄에 그릴 결재선 진행 그림.** 결재가 걸려 있지 않은 신청은 아예 키가 없다.
 *
 * 🔴 **그림이 그려야 하는 단계는 「그 결재건이 타고 있는 판」이지 지금 설정된 판이 아니다**
 * (`IssueApprovalTrail` 머리말, `routeStepsByRouteId` 주석). 현재 판(`getCurrentApprovalRoute`)을
 * 집어다 그리면 **절차를 바꾼 뒤 옛 건을 볼 때 없는 결재자가 그려진다.** 그래서 「승인 요청건」이
 * 쓰는 길을 그대로 재사용한다 — 판은 결재건의 `route_id` 로 읽고, 「건너뛴 자리」는 포털 번호 둘을
 * 서버에서 견주어 끝낸다(머리말).
 *
 * 🔴 **질의 수가 신청 건수와 무관하다**(결재건 1 · 판 단계 1 · 포털 번호 1 = 셋). 신청마다 물으면
 * 목록 한 번 그리는 데 왕복이 줄 수만큼 는다 — 위 `readPartIssueApprovalScreen` 과 같은 까닭이다.
 * 🔵 **결재건이 하나도 없으면 뒤 둘을 아예 부르지 않는다**(빈 Map 으로 끝). 결재선을 안 쓰는 날의
 *    `/requests` 는 조회가 **한 번도 늘지 않는다.**
 */
export async function readPartIssueTrailsByRequest(requestIds: readonly string[]): Promise<Map<string, IssueApprovalTrailView>> {
  const byRequest = await listOpenPartIssueApprovalsByRequest(requestIds);
  // 🔵 신청마다 한 건만 그린다 — 고르는 차례는 잠금에게 묻는다(`pickPartIssueTrailSource`).
  const picked: Array<[string, PartIssueView]> = [];
  for (const [requestId, views] of byRequest) {
    const view = pickPartIssueTrailSource(views);
    if (view !== null) picked.push([requestId, view]);
  }
  if (picked.length === 0) return new Map();

  const [routeSteps, requesterSubs] = await Promise.all([
    routeStepsByRouteId(picked.map(([, v]) => v.routeId)),
    subsByUserId(picked.map(([, v]) => v.requestedBy)),
  ]);

  return new Map(
    picked.map(([requestId, view]) => [
      requestId,
      {
        status: view.status,
        // 🔵 A/S 번호(`approverUserId`)는 싣지 않는다 — 그림에 필요한 것은 이름뿐이다(`toCard` 와 같다).
        currentStep: view.currentStep ? { stepOrder: view.currentStep.stepOrder, approverName: view.currentStep.approverName } : null,
        steps: trailOf(view, routeSteps, requesterSubs),
      },
    ]),
  );
}
