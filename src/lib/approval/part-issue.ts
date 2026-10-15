import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalRouteSteps } from "@/db/schema/approval-routes";
import { auditLogs } from "@/db/schema/audit-logs";
import { stockIssueApprovalSteps, stockIssueApprovals } from "@/db/schema/stock-issue-approvals";
import { stockRequests } from "@/db/schema/stock-requests";
import { auditValues } from "@/lib/audit";
import { isClaimableRequest } from "@/lib/stock/codes";
import type { IssueQuantity } from "@/lib/stock/issue";
import type { Actor } from "@/lib/stock/ledger";
import { confirmRequest } from "@/lib/stock/requests";
import { users } from "@/db/schema/users";
import {
  checkCanCancelPartIssue,
  checkCanDecidePartIssue,
  checkCanExecutePartIssue,
  checkIssueQuantities,
  checkRejectReason,
  OPEN_PART_ISSUE_STATUSES,
  PART_ISSUE_ROUTE_MISSING_SUB_MESSAGE,
  planPartIssueApproval,
  readIssueQuantities,
  type PartIssueDetail,
  type PartIssueStatus,
  type PartIssueStepView,
  type PartIssueView,
} from "./part-issue-rules";
import { getCurrentApprovalRouteWithSubs } from "./queries";
import { APPROVAL_ROUTE_EMPTY_NOTICES, findNextRouteStepToApprove } from "./route";

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
 * 한 곳에서 만난다. 그래서 `src/lib/stock/ledger.ts` · `issue.ts` · `requests.ts` 는 이 조각에서
 * **한 글자도 바뀌지 않았다.**
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
 * @param reason 왜 이만큼 빼야 하는가 — 결재자가 읽는 글
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
  const route = await getCurrentApprovalRouteWithSubs("PART_ISSUE");
  const plan = planPartIssueApproval(route?.steps ?? [], actor.sub);
  if (!route || plan.kind === "NO_ROUTE") {
    return { ok: false, code: "NO_ROUTE", message: `부품 불출 승인 절차가 없습니다. ${APPROVAL_ROUTE_EMPTY_NOTICES.PART_ISSUE}` };
  }
  // 🔴 결재선에 포털 번호가 없는 단계가 있다 — **만들지 않는다.** 만들면 아무도 결재할 수 없는
  //    건이 생기고, 그 건이 신청을 붙들어 담당자도 바로 확인하지 못한다(규칙 파일의 주석).
  if (plan.kind === "MISSING_SUB") {
    return { ok: false, code: "ROUTE_MISSING_SUB", message: plan.message };
  }

  try {
    return await db().transaction(async (tx): Promise<RequestPartIssueResult> => {
      // 3. 반출 신청이 아직 담당자가 손댈 차례인가. 🔴 묶음은 `CLAIMABLE_REQUEST_STATUSES`
      //    (PENDING·PARTIAL) — 확인·반려·마감·보류가 보는 것과 **같은 묶음**이다.
      const [request] = await tx
        .select({ status: stockRequests.status, summary: stockRequests.summary, type: stockRequests.type })
        .from(stockRequests)
        .where(eq(stockRequests.id, requestId));
      if (!request) return { ok: false, code: "REQUEST_NOT_OPEN", message: "없는 신청입니다." };
      if (!isClaimableRequest(request.status)) {
        return { ok: false, code: "REQUEST_NOT_OPEN", message: "결재를 올릴 수 없는 신청입니다. 대기 중이거나 일부만 내준 신청만 올릴 수 있습니다." };
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
            routeVersion: route.version,
            // 🔴 「누가 결재하게 돼 있었나」를 그때 그대로 남긴다. 나중에 결재선이 바뀌어도 이 줄은 참말이다.
            steps: plan.steps.map((s) => ({ stepOrder: s.stepOrder, approverUserId: s.approverUserId, approverName: s.approverName })),
            autoApproved,
            reason,
            quantities,
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
 * 🔴 **내 차례일 때만** 받는다 — 단계 줄을 `(결재건, status = 'REQUESTED', 결재자 = 나)` 로
 * 집는다. 「관리자면 대신 누를 수 있다」는 길을 두지 않는다(규칙 파일의 `mayDecidePartIssueStep`).
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

  return db().transaction(async (tx): Promise<DecidePartIssueResult> => {
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

    // 3. 내 차례의 단계 줄을 집는다. 🔴 **포털 번호로** 집는다 — A/S 번호로 집으면 아무도 자기
    //    차례를 못 집는다. 상태를 WHERE 에 걸었으므로 두 번 누르면 두 번째는 0행이다.
    const now = new Date();
    const [step] = await tx
      .update(stockIssueApprovalSteps)
      .set({ status: decision, decidedAt: now, note })
      .where(and(eq(stockIssueApprovalSteps.approvalId, approvalId), eq(stockIssueApprovalSteps.status, "REQUESTED"), eq(stockIssueApprovalSteps.approverSub, actor.sub)))
      .returning({ stepOrder: stockIssueApprovalSteps.stepOrder });
    if (!step) return { ok: false, message: "지금 결재할 차례가 아닙니다. 화면을 새로 고치고 다시 보십시오." };

    let nextStatus: PartIssueStatus = "PENDING_APPROVAL";

    if (decision === "REJECTED") {
      await tx.update(stockIssueApprovals).set({ status: "REJECTED" }).where(eq(stockIssueApprovals.id, approvalId));
      nextStatus = "REJECTED";
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
        detail: { requestId: head.requestId, stepOrder: step.stepOrder, status: nextStatus, note },
      }),
    );

    return { ok: true, status: nextStatus, stepOrder: step.stepOrder };
  });
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

  // 🔴 원장으로 가는 길은 이것 하나다. 새로 만들지 않는다.
  const result = await confirmRequest(head.requestId, admin, { quantities, note });
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
/* 4. 거두기                                                            */
/* ------------------------------------------------------------------ */

/**
 * 올린 사람이 **아직 결재 중일 때만** 거둔다.
 *
 * 🔵 열려 있던 단계 줄은 `REQUESTED` 로 **그대로 남긴다.** 거기에 `REJECTED` 를 적으면 「그
 * 사람이 반려했다」는 거짓이 되기 때문이다. 대신 아래 「내가 결재할 건」 조회가 결재건의 상태도
 * 함께 보므로 거둔 건은 아무의 목록에도 뜨지 않는다.
 */
export async function cancelPartIssueApproval(approvalId: string, actor: Actor): Promise<{ ok: true } | { ok: false; message: string }> {
  const [head] = await db()
    .select({ status: stockIssueApprovals.status, requestedBy: stockIssueApprovals.requestedBy })
    .from(stockIssueApprovals)
    .where(eq(stockIssueApprovals.id, approvalId));
  if (!head) return { ok: false, message: "없는 결재건입니다." };

  const gate = checkCanCancelPartIssue(head.status, head.requestedBy, actor.id);
  if (!gate.ok) return { ok: false, message: gate.message };

  // 🔴 판정을 한 번 더 WHERE 에 건다 — 위에서 읽은 뒤 누가 결재했을 수 있다(이 저장소의
  //    `rejectRequest` · `holdRequest` 와 같은 모양).
  const [row] = await db()
    .update(stockIssueApprovals)
    .set({ status: "CANCELLED" })
    .where(and(eq(stockIssueApprovals.id, approvalId), eq(stockIssueApprovals.status, "PENDING_APPROVAL"), eq(stockIssueApprovals.requestedBy, actor.id)))
    .returning({ requestId: stockIssueApprovals.requestId });
  if (!row) return { ok: false, message: "거둘 수 없는 결재건입니다. 이미 결재가 진행됐거나 본인 건이 아닙니다." };

  await db()
    .insert(auditLogs)
    .values(auditValues({ action: "STOCK_ISSUE_APPROVAL_CANCELLED", actorId: actor.id, actorName: actor.name, target: auditTarget(approvalId), detail: { requestId: row.requestId } }));
  return { ok: true };
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
 */
export async function listPartIssueApprovalsToDecide(approverSub: string): Promise<PartIssueView[]> {
  const rows = await listSelect()
    .where(and(eq(stockIssueApprovals.status, "PENDING_APPROVAL"), eq(stockIssueApprovalSteps.approverSub, approverSub)))
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
