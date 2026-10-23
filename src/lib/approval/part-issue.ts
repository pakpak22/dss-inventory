import "server-only";
import { and, asc, count, desc, eq, gte, inArray, min, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { approvalRouteSteps } from "@/db/schema/approval-routes";
import { auditLogs } from "@/db/schema/audit-logs";
import { stockIssueApprovalSteps, stockIssueApprovals } from "@/db/schema/stock-issue-approvals";
import { stockRequests } from "@/db/schema/stock-requests";
import { auditValues } from "@/lib/audit";
// 🔴 **커밋이 끝난 뒤에만** 부른다(두 자리, 아래). 알리는 일은 저장을 막지 않는다 — 그 약속이
//    적힌 곳은 `@/lib/notifications/approval-created-ping` 머리말이다.
import { pingPortalApprovalCreated } from "@/lib/notifications/approval-created-ping";
import { DECIDED_ISSUE_APPROVAL_STATUSES, type DecidedIssueApprovalStatus } from "@/lib/notifications/bell-items";
import { CLAIMABLE_REQUEST_STATUSES, isClaimableRequest } from "@/lib/stock/codes";
import type { IssueQuantity } from "@/lib/stock/issue";
import type { Actor } from "@/lib/stock/ledger";
import { confirmRequest, issuedTotalForRequest } from "@/lib/stock/requests";
import { users } from "@/db/schema/users";
// 🔴 「누를 수 있는 번호 목록」은 저장소에 한 자리에서만 만들어진다 — 아래 세 조회·집행이 전부
//    이것을 부른다(까닭은 `./delegation.ts` 의 `actingApproverSubs`).
import { actingApproverSubsFor } from "./delegation-queries";
// 🔴 「그 자리를 실제로 누가 눌렀나」의 갈래 넷도 저장소에 한 자리에서만 갈린다 — 화면마다 다시
//    적으면 옛 줄(`decided_by_sub` 가 `NULL`)이 「본인」으로 둔갑한다(그 함수의 머리말).
import { approvalStepActor, type ApprovalStepActor } from "./delegation";
import {
  checkCanCancelPartIssue,
  checkCanDecidePartIssue,
  checkCanExecutePartIssue,
  checkCanRejectExecutionPartIssue,
  checkIssueQuantities,
  checkRejectReason,
  OPEN_PART_ISSUE_STATUSES,
  PART_ISSUE_ROUTE_MISSING_SUB_MESSAGE,
  planPartIssueApproval,
  readIssueQuantities,
  readRequestNote,
  requestStatusAfterPartIssue,
  type PartIssueDetail,
  type PartIssueStatus,
  type PartIssueStepView,
  type PartIssueView,
} from "./part-issue-rules";
import { getCurrentApprovalRouteWithSubs } from "./queries";
// 🔴 「이 신청은 어느 절차를 타는가」는 저장소에 한 자리에서만 정해진다 — [확인] 게이트도 같은
//    함수를 부른다(그 파일 머리말에 우회 구멍의 모양이 적혀 있다).
import { getApprovalRouteScopeForRequest } from "./request-scope";
import { APPROVAL_ROUTE_EMPTY_NOTICES, APPROVAL_ROUTE_SCOPE_LABELS, findNextRouteStepToApprove } from "./route";

/**
 * ============================================================================
 * 부품 불출 결재 — 올리기 · 결재 · 실행 · 거두기 · 조회
 * ============================================================================
 * 반출 신청(`stock_requests`) 하나를 **여러 사람에게 순서대로** 결재받고, 결재가 끝난 뒤
 * 재고 담당자가 따로 실행하면 그때 원장에 쓰인다(2026-10-15, 조각 11a).
 *
 * A/S 관리 시스템의 `src/lib/db/mutations/inventory-part-issue-requests.ts` 를 **이 시스템에
 * 맞게 줄여** 옮겨 온 것이다. 표가 셋이 아니라 둘인 까닭, 접수 건·사용처 칸이 없는 까닭은
 * `src/db/schema/stock-issue-approvals.ts` 머리말에 있다.
 *
 * ── 🔴 원장으로 가는 길을 새로 만들지 않는다 ────────────────────────────
 * 실행은 **기존 `confirmRequest(requestId, admin, { quantities, note })` 를 그대로 부른다.**
 * 수량 검사·잔량 갱신·회차 줄·감사 로그는 이미 검증돼 있고, 그것을 여기로 베껴 오면 두 위험이
 * 한 곳에서 만난다. 그래서 `src/lib/stock/ledger.ts` · `issue.ts` 는 이 조각에서 **한 글자도 바뀌지 않았다.**
 * 🔵 `requests.ts` 는 2026-10-21(조각 11e)에 **집을 수 있는 묶음을 부르는 쪽이 건네도록** 바뀌었다 —
 *    원장 쪽 규칙은 그대로이고, 바뀐 것은 「어느 상태에서 집는가」 하나다(`ConfirmPath`).
 *
 * ── 🔴 **결재가 움직이면 반출 신청의 자리도 따라 움직인다** (2026-10-21, 조각 11e) ─
 * 올리면 `IN_APPROVAL`, 거두면 담당자 손으로, 반려되면 `REJECTED`, 실행되면 `confirmRequest` 가 정한다.
 * 🔴 **네 길이 적힌 곳은 `./part-issue-rules.ts` 의 `requestStatusAfterPartIssue` 하나**이고, 이 파일은
 * 그것을 **부르기만** 한다 — 이 저장소에는 DB 시험이 없어, 여기 직접 적은 글자는 아무도 돌려 보지 못한다.
 * 🔴 하나라도 빠뜨리면 신청이 `IN_APPROVAL` 에 **갇힌다**(그 자리는 다섯 단추를 전부 거절한다).
 *
 * ── 🔴 안전장치: 「부품 불출」 판이 없으면 이 기능은 없는 것과 같다 ──────
 * 현재 판이 없거나 단계가 0개면 `NO_ROUTE` 를 돌려주고 결재건을 **만들지 않는다.** 부르는
 * 쪽(11c)은 그때 지금까지처럼 바로 [확인]을 쓴다. 이 약속이 없으면 기능을 올리는 순간
 * 관리자가 절차를 만들기 전까지 재고가 통째로 잠긴다.
 *
 * ── 🔴 동시성 — 상태를 WHERE 에 걸어 집는다 ─────────────────────────────
 * 이 저장소가 `rejectRequest` · `holdRequest` 에서 쓰는 모양 그대로다. 두 사람이 동시에 눌러도
 * 상태가 맞는 쪽 한 번만 바뀐다. 결재는 그 위에 결재건 행 `FOR UPDATE` 까지 걸어 사슬이
 * 갈라지지 않게 한다.
 *
 * ── 🔴 판정은 전부 순수 규칙에서 가져온다 ───────────────────────────────
 * 이 저장소에는 DB 시험이 없다. 그래서 「건너뛰기」·「내 차례인가」·「이 상태에서 되는가」는
 * `./part-issue-rules.ts` 가 쥐고 있고 여기서는 **부르기만** 한다 — 그래야 `npm test` 가
 * 돌려 본다.
 *
 * ── 🔴 사람을 가르는 열쇠는 **포털 번호**다 (2026-10-15) ────────────────
 * 결재자는 A/S 명부에서 고르지만, 그 사람이 **여기 로그인했을 때의 번호**는 A/S 번호가 아니라
 * 포털 번호(`users.auth_sub`)다. 그래서 「내 차례인가」·「내가 결재할 건」·「신청자 본인 단계
 * 건너뛰기」가 전부 `approver_sub` 로 돈다. A/S 번호(`approver_user_id`)도 그대로 적어 두지만
 * 그것은 **명부로 되짚는 번호**이지 판정의 열쇠가 아니다. 까닭은 `./directory.ts` 머리말.
 *
 * 🔴 그래서 이 파일이 받는 사람은 `Actor` 가 아니라 **`PartIssueActor`** 다 — 포털 번호가 함께
 * 들어오지 않으면 컴파일되지 않게 해 두었다.
 * ============================================================================
 */

/**
 * 결재를 올리거나 누르는 사람. 🔴 **포털 번호(`sub`)가 반드시 있어야 한다** — 이 시스템의
 * 세션(`SessionPayload.sub`)이 들고 있는 그 값이고, 결재자 판정의 유일한 열쇠다(머리말).
 *
 * 🔵 `Actor` 를 넓힌 것은 원장 쪽(`src/lib/stock/ledger.ts`)을 건드리지 않기 위해서다 — 그쪽은
 * 사람을 `users.id` 로만 다루면 되고, 이 조각에서 한 글자도 바뀌지 않았다.
 */
export type PartIssueActor = Actor & { sub: string };

/** 감사·오류 문구가 쓰는 대상 글자. `src/lib/audit-labels.ts` 의 `describeTarget` 과 짝이다. */
function auditTarget(approvalId: string): string {
  return `issue_approvals:${approvalId}`;
}

/** 부분 유니크 색인에 걸렸나 — 한 반출 신청에 살아 있는 결재건은 하나뿐이다. */
function isOpenApprovalConflict(e: unknown): boolean {
  const o = e as { code?: unknown; constraint_name?: unknown } | null;
  if (!o || typeof o !== "object" || o.code !== "23505") return false;
  return o.constraint_name === "stock_issue_approvals_request_open_uq";
}

/* ------------------------------------------------------------------ */
/* 1. 올리기                                                            */
/* ------------------------------------------------------------------ */

export type RequestPartIssueResult =
  | { ok: true; id: string; status: Extract<PartIssueStatus, "PENDING_APPROVAL" | "APPROVED"> }
  | {
      ok: false;
      /**
       * 🔴 `NO_ROUTE` 는 **오류가 아니다** — 「이 회사는 아직 불출 결재를 쓰지 않는다」는 뜻이고,
       * 부르는 쪽은 그때 지금까지처럼 바로 [확인]을 써야 한다. 코드로 가른 까닭이 그것이다
       * (문구로 가르면 말을 다듬는 순간 분기가 깨진다).
       *
       * 🔴 `ROUTE_MISSING_SUB` 는 **반대로 오류다** — 결재선이 있는데 그중에 아무도 열 수 없는
       * 단계가 있다는 뜻이다. `NO_ROUTE` 와 **절대 같이 다루지 마라**: 같이 다루면 관리자가
       * 세워 둔 결재를 건너뛰고 부품이 그냥 나간다.
       */
      code: "NO_ROUTE" | "ROUTE_MISSING_SUB" | "ALREADY_OPEN" | "REQUEST_NOT_OPEN" | "INVALID_INPUT";
      message: string;
    };

/**
 * 반출 신청 하나에 결재건을 올린다.
 *
 * @param requestId 반출 신청(`stock_requests.id`)
 * @param quantities 줄별 「이번에 줄 수량」. 실행 때 이 값 그대로 `confirmRequest` 에 넘어간다
 * @param reason 왜 이만큼 빼야 하는가 — 결재자가 읽는 글. 🔵 **선택이라 빈 글자가 올 수 있다**
 *   (2026-10-15 결정). 칸이 `text NOT NULL DEFAULT ''` 라 그대로 들어가고, 거르는 자리는
 *   화면·서버 액션 양쪽에서 함께 걷어냈다.
 */
export async function requestPartIssueApproval(
  requestId: string,
  quantities: readonly IssueQuantity[],
  reason: string,
  actor: PartIssueActor,
): Promise<RequestPartIssueResult> {
  // 1. 모양 검사(순수). 🔴 수량의 많고 적음은 보지 않는다 — 그 규칙은 실행 때 `buildIssueInput`
  //    하나가 쥐고 있다(규칙 파일의 `checkIssueQuantities` 주석).
  const quantityGate = checkIssueQuantities(quantities);
  if (!quantityGate.ok) return { ok: false, code: "INVALID_INPUT", message: quantityGate.message };

  // 2. 🔴 현재 판을 읽는다. 「현재 = 그 용도의 가장 큰 version」이 적힌 곳은 `queries.ts` 하나다.
  //    트랜잭션 밖에서 읽어도 괜찮다 — 판은 append-only 라 사라지지 않고, 어느 판으로 올렸는지는
  //    아래에서 `route_id` 에 **못 박아 적는다**(관리자가 절차를 바꿔도 이 건은 옛 판을 따라간다).
  //    🔴 건너뛰기 판정에 넘기는 것은 **포털 번호**다(`actor.sub`). `actor.id`(이 시스템의
  //    users.id)를 넘기면 결재선의 포털 번호와 영원히 안 맞아 **건너뛰기가 조용히 꺼진다.**
  //
  //    ── 🔴 **어느 용도의 판인지는 그 신청의 「수리 건 종류」가 정한다** (2026-10-22) ──
  //    매쳐·제너레이터·토탈 컨트롤러·모름의 네 갈래가 각각 어느 절차로 가는지는 순수 함수 한 곳에
  //    적혀 있고(`./route.ts`), 여기서는 **읽어서 쓰기만** 한다. 🔴 [확인] 게이트와 **같은 함수**를
  //    거쳐야 한다 — 둘이 다른 용도를 보면 결재가 조용히 우회된다(`./request-scope.ts` 머리말).
  //    🔵 트랜잭션 밖에서 읽어도 괜찮다: 그 칸은 신청을 만들 때 한 번 적히고 그 뒤로 **아무도 고치지
  //       않는다**(고치는 길이 코드에 없다).
  const scope = await getApprovalRouteScopeForRequest(requestId);
  const route = await getCurrentApprovalRouteWithSubs(scope);
  const plan = planPartIssueApproval(route?.steps ?? [], actor.sub);
  if (!route || plan.kind === "NO_ROUTE") {
    /**
     * 🔴 **그 용도의 이름으로 말한다** — 「부품 불출 절차가 없습니다」라고만 하면 매쳐 신청을 올린
     *    사람이 멀쩡히 서 있는 「부품 불출」 절차를 보며 왜 안 되는지 알 수 없다.
     * 🔵 **뒷문장도 그 용도의 것을 쓴다**(2026-10-22, 안내문을 고친 조각). 그 전에는 매쳐·제너레이터
     *    쪽 안내가 「아직 그 용도로 오는 신청이 없다」는 옛말이라 **첫째 용도의 문장을 대신** 썼다.
     *    이제 셋 다 「단계가 없으면 결재 없이 그 자리에서 나간다」는 지금 참인 말이라, 대신 쓸 까닭이
     *    없어졌다 — 그 용도의 말을 그 용도에 하는 편이 읽는 사람에게 분명하다.
     * 🔵 이 글자가 그대로 사람에게 가지는 **않는다**: 서버 액션이 `NO_ROUTE` 만 가려내
     *    `PART_ISSUE_ROUTE_GONE_MESSAGE`(「새로 고치면 단추가 [확인]으로 돌아옵니다」)로 바꾼다
     *    (`src/app/actions/part-issue.ts`). 그래도 여기 말을 참으로 두는 까닭은, 이 함수를 부르는
     *    자리가 늘면 그때 바로 쓰이기 때문이다 — 거짓인 채 묵혀 두면 그날 아무도 다시 읽지 않는다.
     */
    return { ok: false, code: "NO_ROUTE", message: `${APPROVAL_ROUTE_SCOPE_LABELS[scope]} 승인 절차가 없습니다. ${APPROVAL_ROUTE_EMPTY_NOTICES[scope]}` };
  }
  // 🔴 결재선에 포털 번호가 없는 단계가 있다 — **만들지 않는다.** 만들면 아무도 결재할 수 없는
  //    건이 생기고, 그 건이 신청을 붙들어 담당자도 바로 확인하지 못한다(규칙 파일의 주석).
  if (plan.kind === "MISSING_SUB") {
    return { ok: false, code: "ROUTE_MISSING_SUB", message: plan.message };
  }

  let result: RequestPartIssueResult;
  try {
    result = await db().transaction(async (tx): Promise<RequestPartIssueResult> => {
      // 3. 반출 신청이 아직 담당자가 손댈 차례인가. 🔴 묶음은 `CLAIMABLE_REQUEST_STATUSES`
      //    (PENDING·PARTIAL) — 확인·반려·마감·보류가 보는 것과 **같은 묶음**이다.
      const [request] = await tx
        .select({ status: stockRequests.status, summary: stockRequests.summary, type: stockRequests.type })
        .from(stockRequests)
        .where(eq(stockRequests.id, requestId));
      if (!request) return { ok: false, code: "REQUEST_NOT_OPEN", message: "없는 신청입니다." };
      /**
       * 🔴 **「이미 결재 중」은 따로 말한다** (2026-10-21, 조각 11e). 신청이 `IN_APPROVAL` 이면 그 신청에
       *    살아 있는 결재건이 이미 있다는 뜻이고, 그것은 아래 부분 유니크 색인이 23505 로 잡던 바로 그
       *    경우다 — 상태가 생기면서 **색인에 닿기 전에** 여기서 걸리므로, 걸리는 자리가 옮겨 갔다고 말까지
       *    흐려지면 안 된다. 🔵 색인 쪽 `catch` 는 그대로 둔다: 이 조각 전에 올라간 결재건은 신청이 아직
       *    `PENDING` 이라 여기를 통과하고 거기서 잡힌다.
       */
      if (request.status === "IN_APPROVAL") {
        return { ok: false, code: "ALREADY_OPEN", message: "이 신청에는 이미 진행 중인 결재건이 있습니다. 화면을 새로 고치고 다시 보십시오." };
      }
      if (!isClaimableRequest(request.status)) {
        return { ok: false, code: "REQUEST_NOT_OPEN", message: "결재를 올릴 수 없는 신청입니다. 대기 중이거나 일부만 내준 신청만 올릴 수 있습니다." };
      }

      /**
       * 3-1. 🔴 **신청을 「결재 중」으로 집는다** (2026-10-21, 조각 11e). 여기가 이 조각의 전부다 —
       *      그 전에는 결재건만 서고 신청은 `PENDING` 그대로라, 결재가 도는 중에 반려·보류·취소가 되고
       *      배지·알림이 그 줄을 「지금 할 일」로 셌다(`src/db/schema/stock-requests.ts` 의 `IN_APPROVAL` 주석).
       *
       * 🔴 **위 읽기가 아니라 이 조건부 UPDATE 가 울타리다.** 읽고 나서 집기 전 사이에 다른 담당자가
       *    [확인]으로 집었을 수 있다(`FOR UPDATE` 를 걸지 않았다 — 거는 대신 이 저장소가 늘 쓰는
       *    「상태를 WHERE 에 걸어 집는」 모양을 따른다). 0행이면 그 사이에 바뀐 것이다.
       * 🔴 **쓰는 일보다 먼저 한다.** 트랜잭션 콜백에서 그냥 `return` 하면 **커밋되므로**
       *    (`decidePartIssueApproval` 의 2번 주석), 거절할 수 있는 마지막 자리가 아직 아무것도 안 쓴 여기다.
       * 🔵 아래에서 결재건 끼워 넣기가 23505(이미 살아 있는 결재건)로 터지면 트랜잭션째 되돌아가므로
       *    신청도 제자리로 돌아온다 — 잡는 곳은 이 트랜잭션 **밖**이다.
       */
      const [claimed] = await tx
        .update(stockRequests)
        .set({ status: requestStatusAfterPartIssue("ISSUE_REQUESTED", 0) })
        .where(and(eq(stockRequests.id, requestId), inArray(stockRequests.status, [...CLAIMABLE_REQUEST_STATUSES])))
        .returning({ id: stockRequests.id });
      if (!claimed) {
        return { ok: false, code: "REQUEST_NOT_OPEN", message: "방금 다른 담당자가 이 신청을 처리했습니다. 화면을 새로 고치고 다시 보십시오." };
      }

      // 4. 🔴 남는 단계가 0개면 곧바로 APPROVED — 결재할 사람이 없으니 기다릴 것이 없다
      //    (`PartIssueRoutePlan` 의 `AUTO_APPROVED` 주석).
      const autoApproved = plan.kind === "AUTO_APPROVED";
      const [row] = await tx
        .insert(stockIssueApprovals)
        .values({
          requestId,
          routeId: route.id,
          status: autoApproved ? "APPROVED" : "PENDING_APPROVAL",
          quantities: quantities.map((q) => ({ partId: q.partId, quantity: q.quantity })),
          reason,
          requestedBy: actor.id,
          requestedByName: actor.name,
        })
        .returning({ id: stockIssueApprovals.id });

      // 5. 🔴 **첫 단계만** 넣는다. 다음 단계는 앞 단계가 승인될 때 비로소 생긴다 — 미리 전부
      //    넣어 두면 「내가 결재할 건」에 아직 차례가 아닌 건이 섞인다.
      if (plan.kind === "NEEDS_APPROVAL") {
        const first = plan.steps[0];
        await tx.insert(stockIssueApprovalSteps).values({
          approvalId: row.id,
          stepOrder: first.stepOrder,
          approverUserId: first.approverUserId,
          // 🔴 결재선 단계의 **포털 번호를 복사해 굳힌다.** 나중에 결재선이 바뀌어도 이 건은
          //    그때 정해진 사람이 결재한다. 번호가 있는 것은 `plan` 이 보장한다(MISSING_SUB).
          approverSub: first.approverSub,
          approverName: first.approverName,
          approverRole: first.approverRole,
        });
      }

      await tx.insert(auditLogs).values(
        auditValues({
          action: "STOCK_ISSUE_APPROVAL_REQUESTED",
          actorId: actor.id,
          actorName: actor.name,
          target: auditTarget(row.id),
          detail: {
            requestId,
            requestSummary: request.summary,
            /**
             * 🔵 **어느 용도의 판으로 올렸나** (2026-10-22). 판 번호(`routeVersion`)는 용도 안에서만
             *    세므로, 용도가 셋이 된 뒤로는 번호만으로 어느 결재선이었는지 알 수 없다.
             */
            routeScope: scope,
            routeVersion: route.version,
            // 🔴 「누가 결재하게 돼 있었나」를 그때 그대로 남긴다. 나중에 결재선이 바뀌어도 이 줄은 참말이다.
            steps: plan.steps.map((s) => ({ stepOrder: s.stepOrder, approverUserId: s.approverUserId, approverName: s.approverName })),
            autoApproved,
            reason,
            quantities,
            /**
             * 🔴 **신청이 어느 자리로 갔는지도 남긴다** (2026-10-21). 자동 승인이면 결재건은 곧바로
             *    `APPROVED` 인데 신청은 `IN_APPROVAL` 이라, 나중에 이력만 보면 「승인됐는데 왜 안 나갔지」가
             *    된다 — 아직 [실행] 전이라는 사실이 이 한 칸에 적힌다.
             */
            requestStatus: requestStatusAfterPartIssue("ISSUE_REQUESTED", 0),
          },
        }),
      );

      return { ok: true, id: row.id, status: autoApproved ? "APPROVED" : "PENDING_APPROVAL" };
    });
  } catch (e) {
    if (isOpenApprovalConflict(e)) {
      return { ok: false, code: "ALREADY_OPEN", message: "이 신청에는 이미 진행 중인 결재건이 있습니다. 화면을 새로 고치고 다시 보십시오." };
    }
    throw e;
  }

  /**
   * 🔴 **여기는 커밋이 끝난 뒤다** (2026-10-24, 결재 생김 알림). 위 `try` 가 닫힌 자리이므로
   *    결재건과 첫 단계는 이미 DB 에 들어가 있다.
   * 🔴 **트랜잭션 안에서 부르면 안 된다** — 포털이 멎었을 때 **신청 자체가 실패**한다. 그래서
   *    `return await …` 이던 것을 변수로 받아 두고 여기서 알린다(그 한 줄이 이 조각의 전부다).
   * 🔵 **못 보내도 아무 일도 일어나지 않는다**: 부르는 함수가 모든 실패를 삼키고, 메일은 포털의
   *    주기 작업이 줍는다(`notifications/approval-created-ping.ts` 머리말).
   * 🔵 **자동 승인(`AUTO_APPROVED`)에는 알리지 않는다** — 결재할 사람이 하나도 없어 단계 줄이
   *    서지 않았고, 그 건은 곧바로 「실행할 건」으로 간다. 알릴 차례가 애초에 없다.
   */
  if (result.ok && plan.kind === "NEEDS_APPROVAL") {
    await pingPortalApprovalCreated(plan.steps[0].approverSub);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 2. 결재 · 반려                                                       */
/* ------------------------------------------------------------------ */

export type DecidePartIssueResult =
  | {
      ok: true;
      /** 결재 뒤 **결재건의** 상태. 아직 뒷 단계가 남았으면 `PENDING_APPROVAL` 그대로다. */
      status: PartIssueStatus;
      /** 방금 결재한 단계 번호 */
      stepOrder: number;
    }
  | { ok: false; message: string };

/**
 * 내 차례의 단계를 승인하거나 반려한다.
 *
 * 🔴 **내 차례일 때만** 받는다 — 단계 줄을 `(결재건, status = 'REQUESTED', 결재자 ∈ 내가 지금
 * 쓸 수 있는 번호들)` 로 집는다. 「관리자면 대신 누를 수 있다」는 길을 두지 않는다(규칙 파일의
 * `mayDecidePartIssueStep`).
 *
 * 🔴 **번호가 하나가 아니라 목록인 것이 결재권 위임이다**(2026-10-21, 조각 2). 목록을 만드는
 * 함수는 저장소에 하나뿐이고(`./delegation.ts` 의 `actingApproverSubs`), 목록·알림 종·순수
 * 판정도 **같은 함수**에서 받는다. 위임이 하나도 없으면 목록은 본인 번호 하나뿐이라 예전과
 * 한 글자도 다르지 않게 돈다.
 *
 * 🔵 `note` 는 **반려 사유**다. 승인에는 한마디를 받지 않으므로(2026-10-15 결정, 화면에 칸이
 * 없고 서버 액션도 승인일 때는 읽지 않는다) 승인으로 올 때는 언제나 빈 글자다 — 표의
 * CHECK 도 그것을 허락한다(`APPROVED` 는 `decided_at` 만 본다).
 *
 * 🔴 **반려되면 결재건을 `REJECTED` 로 닫는다.** 되살리는 길을 만들지 않는다 — 결재선 설계가
 * 「반려되면 처음 단계부터 다시 올린다」이기 때문이다(`approval-routes.ts` 머리말). 되살리는
 * 길을 열면 몇 단계까지 되돌릴지가 또 하나의 규칙이 되고, 그 규칙은 어디에도 적혀 있지 않다.
 */
export async function decidePartIssueApproval(
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
  note: string,
  actor: PartIssueActor,
): Promise<DecidePartIssueResult> {
  if (decision === "REJECTED") {
    const gate = checkRejectReason(note);
    if (!gate.ok) return { ok: false, message: gate.message };
  }

  /**
   * 🔴 **커밋이 끝난 뒤에 알릴 사람** (2026-10-24, 결재 생김 알림). 한 단계가 승인되면 다음
   *    단계가 **새로** 서고, 그 사람에게는 방금 결재할 차례가 생긴 것이다 — 올릴 때의 첫 단계와
   *    똑같이 알려야 한다.
   * 🔴 **트랜잭션 안에서 부르지 않으려고** 이 자리에 둔다: 안에서 부르면 포털이 멎었을 때
   *    **결재가 통째로 되돌아간다.** 아래 트랜잭션은 여기에 번호를 적어만 두고, 알리는 일은
   *    커밋이 끝난 뒤 맨 아래에서 한다.
   * 🔵 값이 `null` 로 남는 길이 셋이다 — 반려 · 마지막 단계(승인 끝) · 집지 못함. 셋 다 새로
   *    생긴 차례가 없으므로 알릴 것도 없다.
   */
  let nextApproverSub: string | null = null;

  const result = await db().transaction(async (tx): Promise<DecidePartIssueResult> => {
    /**
     * 🔴 **한 순간으로 판정하고 그 순간을 적는다** (2026-10-21, 결재권 위임). 아래에서 위임이
     *    살아 있나를 재는 시각과 단계 줄에 적히는 `decided_at` 이 **같은 값**이어야 한다. 갈리면
     *    기간이 끝나는 즈음에 눌린 결재가 「그때 유효했는가」에 두 답을 갖는다.
     */
    const now = new Date();

    // 1. 🔴 결재건 행을 먼저 잠근다. 두 단계가 동시에 결재되거나, 결재와 거두기가 엇갈려
    //    사슬이 갈라지는 것을 막는다. 트랜잭션이 끝나면 저절로 풀린다.
    const [head] = await tx
      .select({ id: stockIssueApprovals.id, status: stockIssueApprovals.status, routeId: stockIssueApprovals.routeId, requestId: stockIssueApprovals.requestId, requestedBy: stockIssueApprovals.requestedBy })
      .from(stockIssueApprovals)
      .where(eq(stockIssueApprovals.id, approvalId))
      .for("update");
    if (!head) return { ok: false, message: "없는 결재건입니다." };

    const gate = checkCanDecidePartIssue(head.status);
    if (!gate.ok) return { ok: false, message: gate.message };

    // 2. 🔴 **쓰기 전에** 사슬을 이을 재료를 다 읽어 둔다. 트랜잭션 콜백에서 그냥 `return` 하면
    //    **커밋된다** — 단계 줄을 이미 고쳐 놓고 거절하면 반쯤 진행된 결재가 남는다.
    //
    //    (가) **그때 그 판**의 단계들. 관리자가 절차를 바꿔도 이 건은 옛 판을 끝까지 따라간다
    //         — 그래서 `route_id` 를 올릴 때 못 박아 적었다.
    const routeSteps = await tx
      .select({
        stepOrder: approvalRouteSteps.stepOrder,
        approverUserId: approvalRouteSteps.approverUserId,
        approverSub: approvalRouteSteps.approverSub,
        approverName: approvalRouteSteps.approverName,
        approverRole: approvalRouteSteps.approverRole,
      })
      .from(approvalRouteSteps)
      .where(eq(approvalRouteSteps.routeId, head.routeId));

    // 🔴 포털 번호가 없는 단계가 섞인 판으로는 사슬을 이을 수 없다. 올릴 때 이미 막으므로
    //    (`planPartIssueApproval` 의 `MISSING_SUB`) 여기까지 오지 않지만, 번호가 `null` 인 줄을
    //    **조용히 건너뛰면 아무도 결재하지 않은 단계가 승인된 것이 된다.** 그래서 세어 본다.
    const usableRouteSteps = routeSteps.filter(
      (routeStep): routeStep is typeof routeStep & { approverSub: string } => routeStep.approverSub !== null,
    );
    if (usableRouteSteps.length !== routeSteps.length) {
      return { ok: false, message: PART_ISSUE_ROUTE_MISSING_SUB_MESSAGE };
    }

    //    (나) 🔴 **신청자의 포털 번호.** 건너뛰기는 결재선의 `approver_sub` 와 견주므로 신청자
    //         쪽도 같은 열쇠여야 한다 — 결재건에 적힌 `requested_by` 는 이 시스템의 `users.id`
    //         라서 그대로 넘기면 **건너뛰기가 조용히 꺼진다.** 올린 사람은 여기 로그인해서
    //         올린 사람이므로 `users` 에 줄이 있다(없으면 `null` — 건너뛰지 않는다).
    const [requester] = await tx.select({ sub: users.authSub }).from(users).where(eq(users.id, head.requestedBy));
    const requesterSub = requester?.sub ?? null;

    /**
     *    (다) 🔴 **지금 내 자격으로 누를 수 있는 결재자 번호 전부** — 본인 + 지금 대신할 수 있는
     *         결재권자들(2026-10-21, 결재권 위임).
     *
     * 🔴 **읽기와 쓰기가 같은 트랜잭션 안에 있어야 한다.** 그래서 `tx` 를 넘긴다 — 밖에서 읽으면
     *    읽은 뒤 아래에서 집기 전 사이에 위임이 끝나거나 되돌려질 수 있고, 그때 **권한이 없는데
     *    통과한** 결재가 한 건 남는다. 🔵 함수의 기본값이 `db()` 라 안 넘겨도 오류는 나지 않는다.
     * 🔵 결재건 행을 이미 `FOR UPDATE` 로 잡아 둔 뒤라, 이 읽기가 길어져도 사슬이 갈라지지 않는다.
     */
    const actingSubs = await actingApproverSubsFor(actor.sub, tx, now);

    /**
     * 3. 내 차례의 단계 줄을 집는다. 🔴 **포털 번호로** 집는다 — A/S 번호로 집으면 아무도 자기
     *    차례를 못 집는다. 상태를 WHERE 에 걸었으므로 두 번 누르면 두 번째는 0행이다.
     *
     * 🔴 **`inArray` 인 것이 위임이다**(위 (다)). 위임이 하나도 없으면 목록은 본인 번호 하나뿐이라
     *    `eq` 와 **한 글자도 다르지 않게** 돈다. 색인(`…_approver_sub_idx`)도 그대로 탄다.
     * 🔴 **`approver_sub` 는 건드리지 않는다** — 그 줄이 **누구 자리였는지**는 그대로 남아야 한다.
     *    대리인이 눌렀다고 그 칸을 덮으면 「원래 누가 결재하게 돼 있었나」가 사라진다.
     * 🔴 **`decided_by_*` 는 본인이 눌러도 언제나 적는다.** 비워 두면 「본인이 눌렀다」와 「이 칸이
     *    생기기 전」이 **같은 모양**이 되어 영영 가를 수 없다(표 쪽 주석의 세 갈래). 그래서 승인·반려
     *    **둘 다** 적는다 — 여기 한 자리가 둘을 함께 쓴다.
     */
    const [step] = await tx
      .update(stockIssueApprovalSteps)
      .set({ status: decision, decidedAt: now, note, decidedBySub: actor.sub, decidedByName: actor.name })
      .where(and(eq(stockIssueApprovalSteps.approvalId, approvalId), eq(stockIssueApprovalSteps.status, "REQUESTED"), inArray(stockIssueApprovalSteps.approverSub, [...actingSubs])))
      .returning({ stepOrder: stockIssueApprovalSteps.stepOrder });
    if (!step) return { ok: false, message: "지금 결재할 차례가 아닙니다. 화면을 새로 고치고 다시 보십시오." };

    let nextStatus: PartIssueStatus = "PENDING_APPROVAL";
    /**
     * 🔵 반려로 **신청까지** 닫혔나 (2026-10-21, 조각 11e). 아래에서 감사 로그에 적는다.
     * 🔴 `false` 는 결함이 아니라 **이 조각이 나가기 전에 올라간 결재건**이다 — 그때는 신청이 `IN_APPROVAL` 로
     *    가지 않아 아직 `PENDING` 이고, 그 건의 반려는 예전처럼 결재건만 닫는다. 그래서 던지지 않는다.
     */
    let requestRejected = false;

    if (decision === "REJECTED") {
      await tx.update(stockIssueApprovals).set({ status: "REJECTED" }).where(eq(stockIssueApprovals.id, approvalId));
      nextStatus = "REJECTED";
      /**
       * 🔴 **반려되면 부품 요청도 끝이다** (2026-10-21 쓰는 분 결정) — `PENDING` 으로 되돌리지 않는다.
       *    되돌리면 반려된 요청이 대기 목록에 되살아나 담당자가 그대로 내주게 되고, 반려한 결재자의 뜻이
       *    사라진다. 다시 필요하면 **새로 신청한다.** 까닭과 다른 세 길은 `./part-issue-rules.ts` 의
       *    `requestStatusAfterPartIssue` 하나에 적혀 있다.
       * 🔴 **반려 사유를 신청의 결정 사유 칸에 복사한다.** 신청자가 보는 화면도 A/S 통로도 결재건이 아니라
       *    **신청**을 읽으므로(`toApiRequestStatus` 의 `decision`), 복사하지 않으면 「왜 반려됐는지」가 어디에도
       *    안 보인다. 🔵 결정한 사람·시각도 함께 적는다 — 그래야 신청자의 알림 종에 걸린다
       *    (`listRejectedRequestsFor` 가 `decided_at` 으로 거른다).
       * 🔵 **같은 트랜잭션 안**이다. 결재건만 닫히고 신청이 `IN_APPROVAL` 에 남으면 **아무도 손댈 수 없는
       *    신청**이 된다(그 상태는 다섯 단추를 전부 거절한다).
       */
      const [rejectedRequest] = await tx
        .update(stockRequests)
        .set({ status: requestStatusAfterPartIssue("APPROVAL_REJECTED", 0), decidedBy: actor.id, decidedByName: actor.name, decidedAt: now, decisionNote: note })
        .where(and(eq(stockRequests.id, head.requestId), eq(stockRequests.status, "IN_APPROVAL")))
        .returning({ id: stockRequests.id });
      requestRejected = rejectedRequest !== undefined;
    } else {
      // 🔴 요청자는 **사슬을 시작한 사람**이다 — 방금 결재한 사람이 아니다. 건너뛰기 규칙이
      //    사슬 내내 같은 사람을 봐야 한다(`findNextRouteStepToApprove` 주석).
      const next = findNextRouteStepToApprove(usableRouteSteps, step.stepOrder, requesterSub);
      if (next) {
        await tx.insert(stockIssueApprovalSteps).values({
          approvalId,
          stepOrder: next.stepOrder,
          approverUserId: next.approverUserId,
          approverSub: next.approverSub,
          approverName: next.approverName,
          approverRole: next.approverRole,
        });
        // 🔴 **적어만 둔다.** 포털을 부르는 일은 커밋이 끝난 뒤 이 함수 맨 아래에서 한다(위 주석).
        nextApproverSub = next.approverSub;
      } else {
        // 마지막 단계였다 → 결재 끝. 🔴 그래도 재고는 아직 나가지 않는다(머리말).
        await tx.update(stockIssueApprovals).set({ status: "APPROVED" }).where(eq(stockIssueApprovals.id, approvalId));
        nextStatus = "APPROVED";
      }
    }

    await tx.insert(auditLogs).values(
      auditValues({
        action: decision === "APPROVED" ? "STOCK_ISSUE_APPROVAL_APPROVED" : "STOCK_ISSUE_APPROVAL_REJECTED",
        actorId: actor.id,
        actorName: actor.name,
        target: auditTarget(approvalId),
        // 🔵 `requestRejected` 는 **신청까지 닫혔나**다 — 승인 줄에는 뜻이 없어 싣지 않는다(위 주석).
        detail: { requestId: head.requestId, stepOrder: step.stepOrder, status: nextStatus, note, ...(decision === "REJECTED" ? { requestRejected } : {}) },
      }),
    );

    return { ok: true, status: nextStatus, stepOrder: step.stepOrder };
  });

  /**
   * 🔴 **여기는 커밋이 끝난 뒤다** — 다음 단계 줄은 이미 DB 에 들어가 있다. 포털이 404·500·
   *    타임아웃으로 답해도 결재는 그대로 남는다(부르는 함수가 모든 실패를 삼킨다).
   * 🔵 `result.ok` 를 함께 보는 까닭: 트랜잭션 콜백이 거절로 돌아오는 길에서는 번호가 적히지
   *    않지만, 한 자리에서 둘을 다 보면 뒷날 길이 하나 늘어도 이 울타리가 먼저 선다.
   */
  if (result.ok && nextApproverSub !== null) {
    await pingPortalApprovalCreated(nextApproverSub);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 3. 실행 — 실제로 부품을 뺀다                                          */
/* ------------------------------------------------------------------ */

export type ExecutePartIssueResult =
  | { ok: true; entryId: string; issueNo: number; issuing: number; remaining: number; done: boolean }
  | { ok: false; message: string };

/**
 * 승인된 결재건을 실행한다 — **원장에 쓰는 것은 `confirmRequest` 하나다.**
 *
 * 🔴 `confirmRequest` 가 거절하면(수량 부족·보류 중·이미 처리됨 등) **그 문구를 그대로**
 * 돌려주고 결재건은 `APPROVED` 로 남는다. 재고가 들어오면 같은 단추를 다시 누르면 된다.
 *
 * 🔵 **순서가 「원장 먼저, 상태 나중」인 까닭**: `confirmRequest` 는 자기 트랜잭션을 열어
 * 집기(PENDING·PARTIAL → CONFIRMING)까지 스스로 한다. 그 안으로 결재건 상태 바꾸기를 끌고 들어갈
 * 수 없고, 밖에서 먼저 `EXECUTED` 로 집어 두면 표의 CHECK(실행 칸 셋이 한 쌍)와 어긋난다.
 * 🔴 **두 담당자가 동시에 눌러도 재고는 한 번만 나간다** — 집기에서 한 사람만 통과하기 때문이다.
 *    남는 아주 좁은 틈(한 사람이 원장을 쓴 직후, 상태를 바꾸기 전에 **세 번째** 사람이 들어오는
 *    경우)은 아래 조건부 UPDATE 가 0행으로 잡아 사람에게 알린다 — 원장 기록은 이미 남아 있으므로
 *    잃는 것은 없고, 결재건이 실제와 어긋난 채 조용히 지나가지 않는다.
 */
export async function executePartIssueApproval(approvalId: string, admin: Actor, note = ""): Promise<ExecutePartIssueResult> {
  const [head] = await db()
    .select({ id: stockIssueApprovals.id, status: stockIssueApprovals.status, requestId: stockIssueApprovals.requestId, quantities: stockIssueApprovals.quantities })
    .from(stockIssueApprovals)
    .where(eq(stockIssueApprovals.id, approvalId));
  if (!head) return { ok: false, message: "없는 결재건입니다." };

  const gate = checkCanExecutePartIssue(head.status);
  if (!gate.ok) return { ok: false, message: gate.message };

  // jsonb 는 모양을 DB 가 지켜 주지 않는다 — 재고를 빼기 전에 한 번 더 본다.
  const quantities = readIssueQuantities(head.quantities);
  if (!quantities) return { ok: false, message: "결재건에 적힌 수량을 읽을 수 없습니다. 담당자에게 알려 주십시오." };

  /**
   * 🔴 원장으로 가는 길은 이것 하나다. 새로 만들지 않는다.
   *
   * 🔴 **`via: "APPROVAL_EXECUTION"` 이 빠지면 결재를 다 받고도 부품이 안 나간다** (2026-10-21, 조각 11e).
   *    올릴 때 신청이 `IN_APPROVAL` 로 갔는데, 사람이 누르는 [확인] 쪽 묶음(`CLAIMABLE_REQUEST_STATUSES`)에는
   *    그 상태가 **일부러 빠져 있기** 때문이다 — 까닭은 `src/lib/stock/codes.ts` 의
   *    `EXECUTABLE_REQUEST_STATUSES` 주석. 그래서 그 매개변수에 기본값을 두지 않았다(tsc 가 잡는다).
   */
  const result = await confirmRequest(head.requestId, admin, { quantities, note, via: "APPROVAL_EXECUTION" });
  if (!result.ok) return { ok: false, message: result.message };

  const now = new Date();
  const [updated] = await db()
    .update(stockIssueApprovals)
    .set({ status: "EXECUTED", entryId: result.result.entryId, executedBy: admin.id, executedByName: admin.name, executedAt: now })
    .where(and(eq(stockIssueApprovals.id, approvalId), eq(stockIssueApprovals.status, "APPROVED")))
    .returning({ id: stockIssueApprovals.id });
  if (!updated) {
    return { ok: false, message: "방금 다른 담당자가 이 결재건을 처리했습니다. 원장에는 기록이 남았으니 기록 내역에서 확인하십시오." };
  }

  await db()
    .insert(auditLogs)
    .values(
      auditValues({
        action: "STOCK_ISSUE_APPROVAL_EXECUTED",
        actorId: admin.id,
        actorName: admin.name,
        target: auditTarget(approvalId),
        detail: {
          requestId: head.requestId,
          entry: `${result.result.type}-${result.result.sheetYear}-${result.result.sheetNo}`,
          issueNo: result.issueNo,
          issued: result.issuing,
          remaining: result.remaining,
          note,
        },
      }),
    );

  return { ok: true, entryId: result.result.entryId, issueNo: result.issueNo, issuing: result.issuing, remaining: result.remaining, done: result.done };
}

/* ------------------------------------------------------------------ */
/* 3-2. 실행 대기에서 반려 — 담당자가 멈춘다 (2026-10-21)                 */
/* ------------------------------------------------------------------ */

export type RejectExecutionPartIssueResult = { ok: true } | { ok: false; message: string };

/**
 * **결재가 다 끝나 [실행]만 남은 건을 담당자가 막는다.**
 *
 * ── 🔴 왜 이 길이 필요한가 ──────────────────────────────────────────────
 * 2026-10-21 에 「결재 중」을 만들면서 결재가 도는 동안 담당자의 [반려]·[보류]·[신청 취소]를
 * 닫았다. 그 결과 결재가 다 끝나면 **아무도 그 건을 멈출 수 없었다** — 재고가 모자라도, 신청이
 * 잘못됐다는 것을 뒤늦게 알아도 할 수 있는 일은 「실행하지 않고 두기」뿐이라 그 건은 「실행할
 * 건」 목록에 영원히 떠 있었다. 이 함수가 그 빚을 갚는다.
 *
 * ── 🔴 **한 트랜잭션 안에서 둘을 함께 닫는다** ──────────────────────────
 * 결재건(`EXECUTION_REJECTED`)과 반출 신청(`REJECTED`)이다. 앞만 되고 뒤가 실패하면 결재건은
 * 닫혔는데 신청이 `IN_APPROVAL` 에 남아 **아무도 손댈 수 없는 신청**이 된다 — 그 자리는 확인·
 * 반려·마감·보류·취소를 전부 거절하고, 결재건이 닫혀서 [실행]조차 없다. 완전한 교착이다.
 * 🔵 `executePartIssueApproval` 이 트랜잭션을 못 쓰는 것은 `confirmRequest` 가 **자기 트랜잭션을
 *    스스로 열기** 때문이다(그 함수의 주석). 이쪽은 원장에 한 글자도 쓰지 않아 그 제약이 없다.
 *
 * ── 🔴 판정·사유 규칙을 **새로 적지 않는다** ────────────────────────────
 * 「이 상태에서 되는가」는 `checkCanRejectExecutionPartIssue`(= 실행과 같은 자리, `APPROVED`
 * 하나), 「사유가 있는가」는 **결재 중 반려와 같은** `checkRejectReason` 이다. 사유 규칙이 두
 * 벌이 되면 한쪽만 느슨해지는 날이 오고, 그날 DB 의 CHECK 가 사람에게는 「알 수 없는 실패」로
 * 보인다.
 * 🔵 **누가** 누를 수 있는지는 여기서 보지 않는다 — 서버 액션의 `requireRole("ADMIN", …)` 이
 *    쥔다([실행]과 같은 울타리). `executePartIssueApproval` 이 `Actor` 만 받는 것과 같은 모양이다.
 *
 * @param reason 🔴 **필수다.** 신청자에게 「왜」가 가는 유일한 길이고, 표의 CHECK
 *   (`stock_issue_approvals_execution_rejection_metadata`)가 최종 방어선이다.
 */
export async function rejectExecutionPartIssueApproval(approvalId: string, admin: Actor, reason: string): Promise<RejectExecutionPartIssueResult> {
  // 🔴 **결재 중 반려와 같은 함수**다. 두 벌로 적지 않는다(머리말).
  const reasonGate = checkRejectReason(reason);
  if (!reasonGate.ok) return { ok: false, message: reasonGate.message };

  return db().transaction(async (tx): Promise<RejectExecutionPartIssueResult> => {
    /** 🔴 결재건 칸 넷과 신청의 결정 시각이 **같은 순간**이어야 한다 — 갈리면 이력에서 둘이 다른 사건으로 보인다. */
    const now = new Date();

    // 🔴 결재건 행을 먼저 잠근다 — 실행과 반려가 엇갈려 **재고가 나간 건이 반려로 덮이는** 일을 막는다
    //    (`decidePartIssueApproval` 과 같은 모양). 트랜잭션이 끝나면 저절로 풀린다.
    const [head] = await tx
      .select({ status: stockIssueApprovals.status, requestId: stockIssueApprovals.requestId })
      .from(stockIssueApprovals)
      .where(eq(stockIssueApprovals.id, approvalId))
      .for("update");
    if (!head) return { ok: false, message: "없는 결재건입니다." };

    const gate = checkCanRejectExecutionPartIssue(head.status);
    if (!gate.ok) return { ok: false, message: gate.message };

    /**
     * 🔴 **조건부 UPDATE 가 울타리다.** 위 읽기와 이 쓰기 사이에 다른 관리자가 [실행]을 눌렀을 수
     *    있다 — 그때 0행이 되어 「방금 다른 분이 처리했습니다」로 돌아간다(이 저장소가 `rejectRequest`·
     *    `holdRequest` 에서 늘 쓰는 모양). 두 사람이 동시에 눌러도 한 번만 된다.
     * 🔴 **칸 넷을 함께 채운다.** 표의 CHECK 가 「상태와 칸 넷은 한 쌍」을 지키므로 하나라도 빠지면
     *    여기서 터진다 — 그 CHECK 가 최종 방어선이고, 사유가 빈 글자인 것도 거기서 막힌다.
     */
    const [row] = await tx
      .update(stockIssueApprovals)
      .set({
        status: "EXECUTION_REJECTED",
        executionRejectedBy: admin.id,
        executionRejectedByName: admin.name,
        executionRejectedAt: now,
        executionRejectedReason: reason,
      })
      .where(and(eq(stockIssueApprovals.id, approvalId), eq(stockIssueApprovals.status, "APPROVED")))
      .returning({ requestId: stockIssueApprovals.requestId });
    if (!row) {
      return { ok: false, message: "방금 다른 담당자가 이 결재건을 처리했습니다. 화면을 새로 고치고 다시 보십시오." };
    }

    /**
     * 🔴 **반출 신청도 함께 닫는다.** 가는 자리는 `requestStatusAfterPartIssue` 하나가 정한다 —
     *    이 저장소에는 DB 시험이 없어 여기 직접 적은 글자는 아무도 돌려 보지 못한다(파일 머리말).
     * 🔴 **사유를 신청의 `decision_note` 에 복사한다.** 신청자가 보는 화면도 A/S 통로도 결재건이
     *    아니라 **신청**을 읽으므로(`toApiRequestStatus` 의 `decision`), 복사하지 않으면 「왜
     *    막혔는지」가 **어디에도 안 보인다.** 결정한 사람·시각도 함께 적는다 — 그래야 신청자의
     *    알림 종에 걸린다(`listRejectedRequestsFor` 가 `decided_at` 으로 거른다).
     * 🔴 **0행이어도 던지지 않는다** — 이 조각이 나가기 전에 올라간 결재건은 신청이 아직
     *    `PENDING`(또는 `PARTIAL`)이다. 그 건은 신청이 이미 담당자 손에 있어 갇히지 않는다.
     *    `decidePartIssueApproval` 의 반려가 같은 까닭으로 같은 일을 한다. 그 사실을 이력에 적는다.
     */
    const [rejectedRequest] = await tx
      .update(stockRequests)
      .set({ status: requestStatusAfterPartIssue("EXECUTION_REJECTED", 0), decidedBy: admin.id, decidedByName: admin.name, decidedAt: now, decisionNote: reason })
      .where(and(eq(stockRequests.id, row.requestId), eq(stockRequests.status, "IN_APPROVAL")))
      .returning({ id: stockRequests.id });

    await tx.insert(auditLogs).values(
      auditValues({
        // 🔴 결재 중 반려(`…_REJECTED`)와 **다른 행위 이름**이다 — 까닭은 `src/lib/audit.ts`.
        action: "STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED",
        actorId: admin.id,
        actorName: admin.name,
        target: auditTarget(approvalId),
        // 🔵 **사유를 이력에도 남긴다** — 결재건 칸은 고쳐질 수 있지만 감사 로그는 append-only 다
        //    (보류 사유를 이력에 싣는 것과 같은 까닭, `src/lib/audit.ts` 의 `STOCK_REQUEST_HELD`).
        detail: { requestId: row.requestId, reason, requestRejected: rejectedRequest !== undefined },
      }),
    );

    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* 4. 거두기                                                            */
/* ------------------------------------------------------------------ */

/**
 * 올린 사람이 **아직 결재 중일 때만** 거둔다.
 *
 * 🔵 열려 있던 단계 줄은 `REQUESTED` 로 **그대로 남긴다.** 거기에 `REJECTED` 를 적으면 「그
 * 사람이 반려했다」는 거짓이 되기 때문이다. 대신 아래 「내가 결재할 건」 조회가 결재건의 상태도
 * 함께 보므로 거둔 건은 아무의 목록에도 뜨지 않는다.
 *
 * ── 🔴 **신청을 담당자 손으로 돌려놓는다** (2026-10-21, 조각 11e) ────────
 * 거두기는 `IN_APPROVAL` 에서 나오는 **유일한 되돌리는 길**이다. 여기를 빠뜨리면 그 신청은 확인·
 * 반려·마감·보류·취소를 전부 거절하는 자리에 **갇힌다.** 🔴 그래서 결재건 닫기와 신청 되돌리기를
 * **한 트랜잭션**에 묶는다 — 앞만 되고 뒤가 실패하면 되돌릴 사람이 아무도 없다.
 * 🔵 돌아갈 자리를 `PENDING` 으로 **고정하지 않는다**: 결재는 일부 나간 신청(`PARTIAL`)에서도 올릴 수
 *    있어, 그대로 `PENDING` 으로 돌리면 이미 나간 회차가 없던 일이 된다. 규칙은 보류 풀기와 같은
 *    한 함수에 있다(`requestStatusAfterPartIssue` → `reopenedRequestStatus`).
 */
export async function cancelPartIssueApproval(approvalId: string, actor: Actor): Promise<{ ok: true } | { ok: false; message: string }> {
  const [head] = await db()
    .select({ status: stockIssueApprovals.status, requestedBy: stockIssueApprovals.requestedBy, requestId: stockIssueApprovals.requestId })
    .from(stockIssueApprovals)
    .where(eq(stockIssueApprovals.id, approvalId));
  if (!head) return { ok: false, message: "없는 결재건입니다." };

  const gate = checkCanCancelPartIssue(head.status, head.requestedBy, actor.id);
  if (!gate.ok) return { ok: false, message: gate.message };

  /**
   * 🔵 **이미 나간 수량을 트랜잭션 밖에서 읽어도 된다** — 결재건이 `PENDING_APPROVAL` 인 동안 신청은
   *    `IN_APPROVAL` 이고, 그 상태는 어느 길로도 집히지 않아(실행은 결재건이 `APPROVED` 일 때만 열린다)
   *    그 사이 불출이 일어날 수 없다. 보류 풀기가 같은 까닭으로 같은 일을 한다(`issuedTotalForRequest`).
   */
  const issuedTotal = await issuedTotalForRequest(head.requestId);
  const reopenedStatus = requestStatusAfterPartIssue("APPROVAL_CANCELLED", issuedTotal);

  return db().transaction(async (tx): Promise<{ ok: true } | { ok: false; message: string }> => {
    // 🔴 판정을 한 번 더 WHERE 에 건다 — 위에서 읽은 뒤 누가 결재했을 수 있다(이 저장소의
    //    `rejectRequest` · `holdRequest` 와 같은 모양).
    //    🔵 0행이면 **아직 아무것도 안 썼다** — 그때만 `return` 해도 빈 트랜잭션이 커밋될 뿐이다.
    const [row] = await tx
      .update(stockIssueApprovals)
      .set({ status: "CANCELLED" })
      .where(and(eq(stockIssueApprovals.id, approvalId), eq(stockIssueApprovals.status, "PENDING_APPROVAL"), eq(stockIssueApprovals.requestedBy, actor.id)))
      .returning({ requestId: stockIssueApprovals.requestId });
    if (!row) return { ok: false, message: "거둘 수 없는 결재건입니다. 이미 결재가 진행됐거나 본인 건이 아닙니다." };

    /**
     * 🔴 **0행이어도 던지지 않는다** — 이 조각이 나가기 전에 올라간 결재건은 신청이 `IN_APPROVAL` 로
     *    가지 않아 아직 `PENDING`(또는 `PARTIAL`)이다. 그 건을 거두는 것은 예전처럼 결재건만 닫으면 되고,
     *    신청은 이미 담당자 손에 있으므로 갇히지 않는다. 그 사실을 감사 로그에 적어 둔다.
     */
    const [reopened] = await tx
      .update(stockRequests)
      .set({ status: reopenedStatus })
      .where(and(eq(stockRequests.id, row.requestId), eq(stockRequests.status, "IN_APPROVAL")))
      .returning({ id: stockRequests.id });

    await tx.insert(auditLogs).values(
      auditValues({
        action: "STOCK_ISSUE_APPROVAL_CANCELLED",
        actorId: actor.id,
        actorName: actor.name,
        target: auditTarget(approvalId),
        // 🔵 「어느 자리로 돌려놨나」를 남긴다 — 나중에 「왜 PARTIAL 이지?」를 따질 수 있게(이미 나간 수량도 함께).
        detail: { requestId: row.requestId, requestStatus: reopened ? reopenedStatus : null, issued: issuedTotal },
      }),
    );
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* 5. 조회 넷 (11b 화면이 쓴다)                                          */
/* ------------------------------------------------------------------ */

/**
 * 목록 넷이 **같은 줄 모양**을 받게 하는 한 자리.
 *
 * 🔵 `leftJoin` 으로 「지금 열려 있는 단계」를 함께 끌어온다. 부분 유니크 색인
 * (`stock_issue_approval_steps_one_open_uq`)이 한 결재건에 `REQUESTED` 줄을 하나로 묶어 두므로
 * 줄이 불어나지 않는다. 열린 단계가 없는 건(승인 끝·반려·거둠)은 칸이 `null` 로 온다.
 */
function listSelect() {
  return db()
    .select({
      id: stockIssueApprovals.id,
      requestId: stockIssueApprovals.requestId,
      routeId: stockIssueApprovals.routeId,
      status: stockIssueApprovals.status,
      quantities: stockIssueApprovals.quantities,
      reason: stockIssueApprovals.reason,
      requestedBy: stockIssueApprovals.requestedBy,
      requestedByName: stockIssueApprovals.requestedByName,
      requestedAt: stockIssueApprovals.requestedAt,
      entryId: stockIssueApprovals.entryId,
      executedByName: stockIssueApprovals.executedByName,
      executedAt: stockIssueApprovals.executedAt,
      requestSummary: stockRequests.summary,
      requestType: stockRequests.type,
      /**
       * 🔵 **요청 비고가 사는 곳**(2026-10-22). 신청자가 적은 말은 제 칸이 아니라 신청의 jsonb
       *    안에 `note` 로 들어 있다 — 조인은 이미 있었고 긁어 오는 칸만 하나 늘었다.
       * 🔴 **통째로 믿지 않는다**: 타입이 `Record<string, unknown>` 이라 `as EntryInput` 로 받으면
       *    옛 신청의 없는 칸·글자 아닌 값이 그대로 화면까지 간다. 읽는 자리는 `readRequestNote` 하나다.
       */
      requestPayload: stockRequests.payload,
      stepOrder: stockIssueApprovalSteps.stepOrder,
      stepApproverUserId: stockIssueApprovalSteps.approverUserId,
      stepApproverName: stockIssueApprovalSteps.approverName,
    })
    .from(stockIssueApprovals)
    .innerJoin(stockRequests, eq(stockRequests.id, stockIssueApprovals.requestId))
    .leftJoin(stockIssueApprovalSteps, and(eq(stockIssueApprovalSteps.approvalId, stockIssueApprovals.id), eq(stockIssueApprovalSteps.status, "REQUESTED")));
}

type ListRow = Awaited<ReturnType<ReturnType<typeof listSelect>["execute"]>>[number];

function toView(r: ListRow): PartIssueView {
  return {
    id: r.id,
    requestId: r.requestId,
    routeId: r.routeId,
    status: r.status,
    quantities: readIssueQuantities(r.quantities) ?? [],
    reason: r.reason,
    requestedBy: r.requestedBy,
    requestedByName: r.requestedByName,
    requestedAt: r.requestedAt.toISOString(),
    entryId: r.entryId,
    executedByName: r.executedByName,
    executedAt: r.executedAt?.toISOString() ?? null,
    requestSummary: r.requestSummary,
    requestType: r.requestType,
    // 🔴 **「신청 사유」(`reason`)와 섞지 않는다** — 바로 윗줄이 결재를 올린 사람의 말이고, 이것은
    //    신청한 사람의 말이다(`PartIssueView.requestNote`). 글자가 아니면 빈 글자로 떨어진다.
    requestNote: readRequestNote(r.requestPayload),
    currentStep:
      r.stepOrder !== null && r.stepApproverUserId !== null && r.stepApproverName !== null
        ? { stepOrder: r.stepOrder, approverUserId: r.stepApproverUserId, approverName: r.stepApproverName }
        : null,
  };
}

/**
 * ① **내가 결재할 건.** 지금 내 차례로 열려 있는 단계가 달린, 아직 결재 중인 건만.
 *
 * @param approverSub 🔴 **로그인한 사람의 포털 번호**(`users.auth_sub` · 세션의 `sub`).
 *   A/S 번호나 `users.id` 를 넘기면 **영원히 빈 목록**이 돌아온다 — 결재건 단계에 적힌 열쇠가
 *   포털 번호이기 때문이다. 이 결함이 실제로 있었고(2026-10-15), 매개변수 이름을 `userId` 로
 *   두었던 것이 그 원인이었다. 이름을 되돌리지 마라.
 *
 * 🔴 결재건의 상태(`PENDING_APPROVAL`)까지 함께 본다 — 올린 사람이 거둔 건은 열린 단계 줄이
 * 그대로 남아 있기 때문이다(`cancelPartIssueApproval` 주석). 색인
 * `stock_issue_approval_steps_approver_sub_idx`(포털 번호, 상태)를 탄다.
 * 🔵 차례는 **오래 기다린 것이 위** — 일감 줄이다.
 *
 * 🔴 **대신할 수 있는 사람의 차례도 함께 온다**(2026-10-21, 결재권 위임). 여기를 빼먹으면
 * 대리인 화면에 그 건이 **아예 안 보인다** — 종은 울리는데 가 보면 없는 꼴이 된다. 번호 목록을
 * 만드는 함수는 저장소에 하나뿐이고(`./delegation.ts` 의 `actingApproverSubs`), 집행·알림 종·
 * 순수 판정도 **같은 함수**에서 받는다.
 */
export async function listPartIssueApprovalsToDecide(approverSub: string): Promise<PartIssueView[]> {
  const actingSubs = await actingApproverSubsFor(approverSub);
  const rows = await listSelect()
    .where(and(eq(stockIssueApprovals.status, "PENDING_APPROVAL"), inArray(stockIssueApprovalSteps.approverSub, [...actingSubs])))
    .orderBy(asc(stockIssueApprovals.requestedAt));
  return rows.map(toView);
}

/**
 * ② **승인됐는데 아직 안 나간 건.** 재고 담당자의 일감 줄이다.
 *
 * 🔴 이 목록이 있어야 `APPROVED` 와 `EXECUTED` 를 가른 보람이 있다 — 「결재는 끝났는데 아직 안
 * 나갔다」를 눈으로 볼 수 있는 유일한 자리다.
 */
export async function listPartIssueApprovalsToExecute(): Promise<PartIssueView[]> {
  const rows = await listSelect().where(eq(stockIssueApprovals.status, "APPROVED")).orderBy(asc(stockIssueApprovals.requestedAt));
  return rows.map(toView);
}

/**
 * ③ **내가 올린 진행 중인 건.** 아직 끝나지 않은 것만(결재 중 · 승인됨).
 *
 * @param requesterUserId 🔵 여기만은 **이 시스템의 `users.id`** 다 — 결재건의 `requested_by` 는
 *   올린 사람이고, 올린 사람은 언제나 여기 로그인한 사람이라 그 번호로 적힌다. 포털 번호가
 *   열쇠인 것은 **결재자** 쪽이다(위 ①). 이름으로 그 차이가 보이게 둔다.
 *
 * 🔵 차례는 **최신이 위** — 「방금 올린 것이 어디까지 갔나」를 보는 자리다(위 둘은 일감 줄이라
 * 반대다).
 */
export async function listMyOpenPartIssueApprovals(requesterUserId: string): Promise<PartIssueView[]> {
  const rows = await listSelect()
    .where(and(eq(stockIssueApprovals.requestedBy, requesterUserId), inArray(stockIssueApprovals.status, [...OPEN_PART_ISSUE_STATUSES])))
    .orderBy(desc(stockIssueApprovals.requestedAt));
  return rows.map(toView);
}

/**
 * ④ **한 건의 결재 이력** — 단계별로 누가 언제 무엇을 했나. 없으면 `null`.
 *
 * 🔴 단계 줄은 **건너뛴 번호가 건너뛴 채로** 온다(1 → 3). 1,2,3 으로 고쳐 적지 않는다 —
 * 그 틈이 「신청자 본인 단계라 건너뛰었다」는 사실 그 자체다.
 */
export async function getPartIssueApproval(approvalId: string): Promise<PartIssueDetail | null> {
  const [row] = await listSelect().where(eq(stockIssueApprovals.id, approvalId));
  if (!row) return null;

  const steps = await db()
    .select({
      stepOrder: stockIssueApprovalSteps.stepOrder,
      approverUserId: stockIssueApprovalSteps.approverUserId,
      approverName: stockIssueApprovalSteps.approverName,
      approverRole: stockIssueApprovalSteps.approverRole,
      status: stockIssueApprovalSteps.status,
      requestedAt: stockIssueApprovalSteps.requestedAt,
      decidedAt: stockIssueApprovalSteps.decidedAt,
      note: stockIssueApprovalSteps.note,
    })
    .from(stockIssueApprovalSteps)
    .where(eq(stockIssueApprovalSteps.approvalId, approvalId))
    .orderBy(asc(stockIssueApprovalSteps.stepOrder));

  const stepViews: PartIssueStepView[] = steps.map((s) => ({
    stepOrder: s.stepOrder,
    approverUserId: s.approverUserId,
    approverName: s.approverName,
    approverRole: s.approverRole,
    status: s.status,
    requestedAt: s.requestedAt.toISOString(),
    decidedAt: s.decidedAt?.toISOString() ?? null,
    note: s.note,
  }));

  return { ...toView(row), steps: stepViews };
}

/* ------------------------------------------------------------------ */
/* 6. 조회 하나 더 — 「이 신청에 살아 있는 결재건이 있나」 (11c 가 쓴다)   */
/* ------------------------------------------------------------------ */

/**
 * 반출 신청 묶음에 달린 **살아 있는** 결재건의 상태를 한 번에 읽는다. 없는 신청은 아예 키가
 * 없다(빈 배열을 넣지 않는다 — 「잠글 것 없음」은 키가 없는 것으로 말한다).
 *
 * 🔴 **신청마다 묻지 않는다.** 부품 요청 관리는 목록을 통째로 그리는 화면이라, 신청마다 물으면
 * 대기 30건이 질의 30번이 된다 — 이 저장소가 `issuedQuantitiesOf`(`src/lib/stock/requests.ts`)
 * 에서 쓰는 방식 그대로다. 빈 입력이면 DB 를 부르지 않는다.
 *
 * 🔴 **좁히는 묶음은 `OPEN_PART_ISSUE_STATUSES` 다** — 표의 부분 유니크 색인
 * (`stock_issue_approvals_request_open_uq`)이 보는 그 묶음이고, 잠금 규칙
 * (`./part-issue-gate.ts` 의 `partIssueLockFor`)이 세는 묶음과도 같아야 한다. 셋이 갈라지면
 * 조회에 걸려 온 줄을 보고도 「잠글 것 없음」이라 답해 **문이 열린다.**
 *
 * 🔵 돌려주는 것이 목록인 까닭은 `partIssueLockFor` 머리말에 있다(색인 때문에 오늘은 0개 아니면
 *    1개다). 차례를 **오래된 것부터**로 두는 것은 뒷사람이 눈으로 볼 때의 편의일 뿐이다 —
 *    판정은 차례를 보지 않는다.
 */
export async function listOpenPartIssueStatusesByRequest(requestIds: readonly string[]): Promise<Map<string, PartIssueStatus[]>> {
  const out = new Map<string, PartIssueStatus[]>();
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return out;

  const rows = await db()
    .select({ requestId: stockIssueApprovals.requestId, status: stockIssueApprovals.status })
    .from(stockIssueApprovals)
    .where(and(inArray(stockIssueApprovals.requestId, ids), inArray(stockIssueApprovals.status, [...OPEN_PART_ISSUE_STATUSES])))
    .orderBy(asc(stockIssueApprovals.requestedAt));

  for (const r of rows) {
    const list = out.get(r.requestId);
    if (list) list.push(r.status);
    else out.set(r.requestId, [r.status]);
  }
  return out;
}

/**
 * 반출 신청 묶음에 달린 **살아 있는** 결재건을 **줄 통째로** 한 번에 읽는다 (2026-10-21, 조각 11f).
 * 없는 신청은 아예 키가 없다(바로 위 함수와 같은 관례).
 *
 * 🔴 **바로 위 `listOpenPartIssueStatusesByRequest` 를 넓히지 않고 옆에 둔 까닭**: 저 함수는 재고가
 * 두 번 나가는 것을 막는 **문의 한쪽**이고(그 주석), 여기 것은 **그림을 그리려는** 조회다. 하나로
 * 합치면 문이 그림에 딸려 다니게 된다 — 뒷날 그림을 걷어내는 사람이 문까지 들고 간다. 값도 다르다:
 * 문에 필요한 것은 상태뿐이라 저쪽은 표 하나만 읽고, 여기는 신청·열린 단계까지 이어 읽는다.
 * 🔵 **같은 묶음(`OPEN_PART_ISSUE_STATUSES`)으로 좁힌다** — 둘이 갈리면 문은 잠갔는데 그림이 없는
 *    (또는 그 반대의) 줄이 생긴다.
 *
 * 🔴 **신청마다 묻지 않는다.** 부품 요청 관리는 목록을 통째로 그리는 화면이라, 신청마다 물으면
 * 대기 30건이 질의 30번이 된다. 빈 입력이면 DB 를 부르지 않는다.
 * 🔵 차례는 **오래된 것부터** — 위 함수와 같게 둔다. 그림을 고르는 쪽은 차례를 보지 않는다
 *    (`pickPartIssueTrailSource` 가 잠금에게 묻는다).
 */
export async function listOpenPartIssueApprovalsByRequest(requestIds: readonly string[]): Promise<Map<string, PartIssueView[]>> {
  const out = new Map<string, PartIssueView[]>();
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return out;

  const rows = await listSelect()
    .where(and(inArray(stockIssueApprovals.requestId, ids), inArray(stockIssueApprovals.status, [...OPEN_PART_ISSUE_STATUSES])))
    .orderBy(asc(stockIssueApprovals.requestedAt));

  for (const r of rows) {
    const view = toView(r);
    const list = out.get(view.requestId);
    if (list) list.push(view);
    else out.set(view.requestId, [view]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 7. 머리말 알림 종이 쓰는 조회 둘 (2026-10-15, 조각 11d)                */
/* 🔴 위의 함수들은 화면이 쓰고 있다 — 동작을 바꾸지 않고 **더하기만** 한다. */
/* ------------------------------------------------------------------ */

/**
 * ⑤ **지금 내 차례인 결재의 요약** — 건수와 가장 오래 기다린 시각.
 *
 * 🔴 **집계만 한다.** 종은 모든 화면에 딸려 오고 포털도 1.5초 안에 받아 가야 하므로, 줄을
 * 통째로 끌어오는 ①(`listPartIssueApprovalsToDecide`)을 종이 그대로 쓰지 않는다 — 종에 필요한
 * 것은 숫자 둘뿐이다.
 *
 * 🔴 **①과 똑같은 묶음을 세야 한다**: (가) 결재건이 `PENDING_APPROVAL` (나) 단계가
 * `REQUESTED` (다) 그 단계의 `approver_sub` 가 **내가 지금 쓸 수 있는 번호들 안에** 있다.
 * 셋이 갈리면 「종에는 N건인데 눌러 보면 다른 수」가 된다. ①은 (나)를 `leftJoin` 의 ON 에 걸고
 * 여기는 WHERE 에 거는데, 여기는 `innerJoin` 이라 **같은 줄만 남는다**(열린 단계가 없는 건은
 * 애초에 빠진다).
 *
 * 🔴 (다)의 번호 목록은 ①·집행·순수 판정과 **같은 함수**에서 받는다(`./delegation.ts` 의
 * `actingApproverSubs`). 여기만 빼먹으면 **대리인에게 종이 안 울린다** — 화면에는 있는데
 * 알림이 없는, 아무도 신고하지 않는 결함이 된다.
 *
 * 🔵 **색인**: `stock_issue_approval_steps_approver_sub_idx` 가 `(approver_sub, status)` 라
 * (나)는 등호로, (다)는 `IN`(번호마다 한 번씩)으로 그 색인에 그대로 얹힌다 — 목록이 보통 한
 * 칸(위임 없음)이고 많아야 몇 칸이라 등호 때와 다르지 않다. 거기서 남는 줄은 보통 한 자릿수이고,
 * 결재건은 기본 키(`stock_issue_approvals.id`)로 하나씩 되짚는다. ①이 타는 길과 같다.
 *
 * @param approverSub 🔴 **포털 번호**(`users.auth_sub` · 세션의 `sub`). `users.id` 를 넘기면
 *   **영원히 0건**이다(①의 주석 — 실제로 있었던 결함이다).
 */
export async function summarizePartIssueApprovalsToDecide(approverSub: string): Promise<{ count: number; oldestAt: Date | null }> {
  const actingSubs = await actingApproverSubsFor(approverSub);
  const [r] = await db()
    .select({ n: count(), oldest: min(stockIssueApprovals.requestedAt) })
    .from(stockIssueApprovalSteps)
    .innerJoin(stockIssueApprovals, eq(stockIssueApprovals.id, stockIssueApprovalSteps.approvalId))
    .where(and(inArray(stockIssueApprovalSteps.approverSub, [...actingSubs]), eq(stockIssueApprovalSteps.status, "REQUESTED"), eq(stockIssueApprovals.status, "PENDING_APPROVAL")));
  // 드라이버가 timestamptz 를 Date 로 주지만 집계는 글자로 올 수도 있다 — 둘 다 받는다
  // (`stock/requests.ts` 의 `summarizePendingRequests` 와 같은 모양).
  const oldest = (r?.oldest ?? null) as Date | string | null;
  return { count: r?.n ?? 0, oldestAt: oldest === null ? null : oldest instanceof Date ? oldest : new Date(oldest) };
}

/** 종에 실을 「결정된 내 결재건」 한 줄. 사유 본문·수량은 싣지 않는다 — 화면에서 본다. */
export interface DecidedPartIssueApprovalRow {
  id: string;
  status: DecidedIssueApprovalStatus;
  summary: string;
  requestedAt: Date;
  /**
   * 🔴 막힌 줄에만 값이 있다. 승인 줄은 `null`.
   * 🔵 `REJECTED` 면 반려한 **결재자**(단계 줄), `EXECUTION_REJECTED` 면 막은 **담당자**(결재건 쪽 칸).
   * 🔴 `REJECTED` 에서 이 이름은 **결재선에 적힌 분**(`approver_name`)이지 실제로 누른 사람이
   *    아니다 — 대리인이 눌렀으면 둘이 갈리고, 그때 누른 사람은 아래 `decidedBy` 가 말한다.
   */
  decidedByName: string | null;
  /** 🔴 막힌 줄에만 값이 있다. 승인 줄은 `null`. 🔵 상태마다 적힌 표가 다르다(바로 위 칸과 같은 까닭). */
  decidedAt: Date | null;
  /**
   * 🔴 **그 자리를 실제로 누른 사람이 누구인가** — 본인 · 대리인 · 옛 줄 · 아직 안 누름
   * (2026-10-22). 위 `decidedByName` 과 **짝이다**: 저것이 「누구 자리였나」, 이것이 「그 자리에서
   * 실제로 무슨 일이 있었나」다. 둘을 한 덩이 글자로 합치는 일은 조립이
   * `approvalDecidedByName` 으로 한다 — 종과 반려 사유 상자가 **같은 함수**를 지난다.
   *
   * 🔴 **실행 대기 반려(`EXECUTION_REJECTED`) 줄은 언제나 `UNDECIDED` 다.** 그 건에는 반려된
   *    단계 줄이 **하나도 없고**(단계가 전부 승인으로 닫힌 뒤에 막힌 것이다), 막은 사람은
   *    결재자가 아니라 담당자라 **대리인이라는 개념 자체가 없다**(`rejectExecutionPartIssueApproval`
   *    은 `requireRole("ADMIN")` 이 쥔 자리다). 그래서 꼬리가 안 붙고, 지금까지와 한 글자도 다르지
   *    않게 담당자 이름 하나만 보인다. 🔵 그 판정도 손으로 적지 않는다 — leftJoin 이 비어 와
   *    `approvalStepActor(null)` 이 그렇게 답한다.
   */
  decidedBy: ApprovalStepActor;
}

/**
 * ⑥ **내가 올린 결재건 중 결정된 것** — 승인(아직 실행 전) · 반려(`rejectedSince` 이후).
 *
 * - 🔴 **승인에는 기간 제한이 없다**(2026-10-15 사용자 결정). 가려 주는 것은 날짜가 아니라
 *   **상태**다: 실행되면 `EXECUTED` 가 되어 이 묶음에서 빠지고, 오래 묵은 건일수록 더 보여야 한다.
 * - 🔴 **반려의 「7일」을 여기에 적지 않는다** — 부르는 쪽이 `rejectedSince` 로 건네준다. 그
 *   값은 반출 신청 반려 알림과 **똑같이** `notifications/bell-items.ts` 의 `rejectionCutoff`
 *   하나에서 나온다(`listRejectedRequestsFor` 와 같은 약속).
 * - 🔴 **반려 시각은 머리에 없다.** `stock_issue_approvals` 에는 결정 시각 칸이 없고, 반려는
 *   **단계 줄**(`stock_issue_approval_steps.decided_at`)에 적힌다. 그래서 반려된 단계를
 *   `leftJoin` 한다. 한 결재건에 `REJECTED` 단계는 많아야 하나다 — 반려되는 순간 결재건이
 *   닫혀(`decidePartIssueApproval`) 다음 단계가 열리지 않기 때문이다. 그래서 줄이 불어나지 않는다.
 * - 🔴 **그런데 실행 대기 반려는 단계 줄에 없다** (2026-10-21). 그 건은 단계가 **전부 승인으로
 *   닫힌** 뒤에 막힌 것이라 `REJECTED` 단계가 **하나도 없고**, 사유·사람·시각이 결재건 쪽 칸
 *   (`execution_rejected_*`)에 적힌다(그 까닭은 표의 머리말). 그래서 `leftJoin` 은 그 줄에서
 *   **언제나 비어 오고**, 그 칸들을 함께 읽어 **읽는 쪽에서 합친다.** 🔴 합치지 않으면 7일 선
 *   조건이 `null` 과 견주어 **그 줄이 통째로 질의에서 빠진다** — 종이 조용해지는 자리다.
 *   🔵 SQL 의 `coalesce` 로 합치지 않고 **TS 에서** 합치는 까닭: 드라이버가 `coalesce` 결과의
 *   타입을 무엇으로 줄지는 약속이 없는데, 두 칸을 그대로 고르면 drizzle 이 `Date` 로 못 박아 준다.
 * - 🔵 **승인 줄은 `leftJoin` 이 비어 온다**(반려된 단계가 없으므로). 차례를 `requested_at` 으로
 *   두는 것이 그래서 자연스럽고, 「언제 올린 건인가」가 종에 적을 수 있는 유일한 시각이다
 *   (`DecidedIssueApprovalSource.requestedAt` 주석).
 * - 🔴 `total` 은 **상한에 걸리기 전의 전체 개수**다(배지 숫자가 참말이어야 한다). 창 함수는
 *   WHERE 뒤·LIMIT 앞에 계산되므로 세는 질의를 따로 보내지 않는다.
 * - 🔵 **색인**: `stock_issue_approvals_requester_idx` 가 `(requested_by, status)` 라 사람과
 *   상태 묶음이 그대로 얹힌다. 단계 쪽은 `(approval_id, step_order)` 유니크 색인의 앞칸으로
 *   되짚는다. 한 사람이 올려 둔 미결·반려 건은 보통 한 자릿수다.
 *
 * @param requesterUserId 🔵 **이 시스템의 `users.id`** 다 — 결재건의 `requested_by` 가 그 번호다
 *   (③ `listMyOpenPartIssueApprovals` 와 같은 열쇠). 포털 번호가 열쇠인 것은 **결재자** 쪽이다.
 */
export async function listDecidedPartIssueApprovalsFor(requesterUserId: string, rejectedSince: Date, limit: number): Promise<{ rows: DecidedPartIssueApprovalRow[]; total: number }> {
  const rejectedStep = alias(stockIssueApprovalSteps, "rejected_step");
  const rows = await db()
    .select({
      id: stockIssueApprovals.id,
      status: stockIssueApprovals.status,
      summary: stockRequests.summary,
      requestedAt: stockIssueApprovals.requestedAt,
      decidedByName: rejectedStep.approverName,
      decidedAt: rejectedStep.decidedAt,
      /**
       * 🔴 **「누가 눌렀나」는 이미 이 줄에 함께 있다** (2026-10-22) — 칸을 더하지 않았고 질의도
       *    한 번 그대로다. 위 `approverName`(누구 자리였나)만 싣고 이 셋을 버리고 있었던 탓에,
       *    대리인이 반려해도 종에는 **원래 결재권자 이름만** 떴다. 🔵 번호는 **갈래를 가르는 데만**
       *    쓰이고 아래에서 버린다 — 화면으로 내려가는 모양에 번호 칸이 없다(`ApprovalStepActor`).
       */
      rejectedApproverSub: rejectedStep.approverSub,
      rejectedDecidedBySub: rejectedStep.decidedBySub,
      rejectedDecidedByName: rejectedStep.decidedByName,
      // 🔴 실행 대기 반려는 **여기**에 적힌다(위 머리말). 아래에서 위 둘과 합쳐 한 칸으로 싣는다.
      executionRejectedByName: stockIssueApprovals.executionRejectedByName,
      executionRejectedAt: stockIssueApprovals.executionRejectedAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(stockIssueApprovals)
    .innerJoin(stockRequests, eq(stockRequests.id, stockIssueApprovals.requestId))
    .leftJoin(rejectedStep, and(eq(rejectedStep.approvalId, stockIssueApprovals.id), eq(rejectedStep.status, "REJECTED")))
    .where(
      and(
        eq(stockIssueApprovals.requestedBy, requesterUserId),
        // 🔴 상태 묶음을 먼저 좁힌다 — 색인 `(requested_by, status)` 를 타는 자리다.
        //    🔴 묶음을 **여기에 손으로 적지 않는다**: `DECIDED_ISSUE_APPROVAL_STATUSES` 가
        //    유일한 자리이고, 조립이 같은 목록으로 한 번 더 거른다. 「실행되면 종에서 사라진다」가
        //    이 한 줄에 걸려 있다 — `EXECUTED` 가 거기 없기 때문이다.
        inArray(stockIssueApprovals.status, [...DECIDED_ISSUE_APPROVAL_STATUSES]),
        // 🔴 7일 선은 **막힌 것에만** 걸린다. 승인에 걸면 오래 묵은 건이 조용히 사라진다.
        // 🔴 **갈래가 셋째까지 있어야 한다** (2026-10-21): 실행 대기 반려는 단계 줄이 비어 있어
        //    가운데 조건으로는 **영원히 걸리지 않는다** — 빠뜨리면 종이 조용해진다(위 머리말).
        //    🔵 `execution_rejected_at` 은 그 상태에서만 채워지는 칸이라(표의 CHECK) 다른 상태를
        //    끌어들이지 않는다.
        or(
          eq(stockIssueApprovals.status, "APPROVED"),
          gte(rejectedStep.decidedAt, rejectedSince),
          gte(stockIssueApprovals.executionRejectedAt, rejectedSince),
        ),
      ),
    )
    // 🔵 **최신이 위** — 「내가 올린 것이 어떻게 됐나」를 보는 자리다(③과 같은 까닭).
    //    막힌 것은 결정 시각, 승인은 올린 시각으로 줄을 세운다.
    .orderBy(desc(sql`coalesce(${rejectedStep.decidedAt}, ${stockIssueApprovals.executionRejectedAt}, ${stockIssueApprovals.requestedAt})`), desc(stockIssueApprovals.id))
    .limit(limit);

  if (rows.length === 0) return { rows: [], total: 0 };
  return {
    rows: rows.map((r) => ({
      id: r.id,
      // 🔵 WHERE 가 둘로 좁혔지만 drizzle 의 타입은 enum 전체다 — 좁혀 둔다.
      status: r.status as DecidedIssueApprovalStatus,
      summary: r.summary,
      requestedAt: r.requestedAt,
      /**
       * 🔴 **두 자리를 한 칸으로 합친다** — 결재 중 반려는 단계 줄, 실행 대기 반려는 결재건 쪽
       *    칸이다(위 머리말). 한 결재건에 둘이 함께 있을 수는 없다: 실행 대기 반려는 단계가
       *    **전부 승인으로 닫힌 뒤**에만 일어나고, 단계가 반려되면 결재건은 그 자리에서
       *    `REJECTED` 로 닫혀 `APPROVED` 까지 가지 못한다. 그래서 `??` 로 충분하다.
       */
      decidedByName: r.decidedByName ?? r.executionRejectedByName,
      decidedAt: r.decidedAt ?? r.executionRejectedAt,
      /**
       * 🔴 **갈래를 가르는 자리는 `approvalStepActor` 하나다**(화면마다 다시 적으면 한 화면에서만
       *    대리가 보이거나, 더 나쁘게는 **옛 줄이 「본인」으로 둔갑**한다 — 그 함수의 머리말).
       * 🔴 **leftJoin 이 비어 오면 `null` 을 넘긴다.** 실행 대기 반려 줄이 그렇고, 그때 답은
       *    「아직 안 누름」이라 꼬리가 안 붙는다(위 타입 주석). `approver_sub` 는 표에서 NOT NULL
       *    이므로 **그 칸이 비었다는 것은 곧 줄이 없다는 뜻**이고, 그래서 이 한 칸으로 가른다.
       */
      decidedBy: approvalStepActor(
        r.rejectedApproverSub === null
          ? null
          : { approverSub: r.rejectedApproverSub, decidedAt: r.decidedAt, decidedBySub: r.rejectedDecidedBySub, decidedByName: r.rejectedDecidedByName },
      ),
    })),
    total: rows[0].total,
  };
}
