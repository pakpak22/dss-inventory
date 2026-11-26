import "server-only";
import type { Role } from "@/db/schema/users";
import { listDecidedPartIssueApprovalsFor, summarizePartIssueApprovalsToDecide } from "@/lib/approval/part-issue";
// 🔴 「누가 반려했나」를 가르는 일은 여기서 한다 — `stock/requests.ts` 는 원장으로 가는 안쪽
//    함수가 있는 자리라 `@/lib/approval/*` 를 가져오지 않으므로(그 파일의 `RejectedRequestRowStep`
//    주석), 그 결과가 올라오는 이 자리가 **원본 칸을 받아 갈라** 준다(2026-10-22).
import { approvalStepActor } from "@/lib/approval/delegation";
import { env } from "@/lib/env";
import { listLowStockParts } from "@/lib/parts/queries";
import { listCompletedReturnsFor, listRejectedRequestsFor, summarizePendingRequests } from "@/lib/stock/requests";
import {
  buildInventoryNotificationItems,
  MAX_LOW_STOCK_ITEMS,
  NOTIFICATION_MAX_ITEMS,
  receivesIssueApprovalDecidedNotification,
  receivesIssueApprovalToDecideNotification,
  receivesLowStockNotification,
  receivesPendingNotification,
  receivesRejectedNotification,
  rejectionCutoff,
  type InventoryNotificationFeed,
} from "./bell-items";

/**
 * ============================================================================
 * 종에 실을 **이 시스템 자신의 알림**을 그 사람 기준으로 가져온다
 * ============================================================================
 * 규칙은 전부 notifications/bell-items.ts 에 있다. 이 파일은 그 순수 계산에
 * **재료를 날라다 주는 자리**다 — 대기 요약, 반려된 내 신청, 이 시스템의 주소, client_id.
 *
 * ── 🔴 「읽음」 표가 없다 ───────────────────────────────────────────────
 * 재료가 이미 `stock_requests` 에 다 있다:
 *   status            PENDING·CONFIRMING·PARTIAL(대기 — stock/codes.ts 의 ACTIONABLE_REQUEST_STATUSES) · REJECTED(반려)
 *                     🔵 **반환이 끝난 것은 CONFIRMED** 다 (2026-11-26, stock/codes.ts 의 COMPLETED_RETURN_STATUSES).
 *                     🔴 보류(ON_HOLD)는 이 숫자에서 빠진다 — 대기 목록에는 그대로 보인다 (2026-10-15, 조각 10a).
 *   requested_by      누가 냈는가 — 색인 stock_requests_requester_idx
 *   requester_sub     A/S 에서 올라온 신청자의 **포털 번호** — 이 시스템에 계정이 없을 수 있어 두 칸을 함께 본다 (2026-11-26)
 *   decided_at        언제 결정됐는가 — 「7일」을 여기에 긋는다
 *
 * 불출 결재 둘도 마찬가지다 — `stock_issue_approvals` · `stock_issue_approval_steps` 가 이미
 * 쥐고 있다(2026-10-15, 조각 11d):
 *   steps.approver_sub + steps.status  내 차례인가 — 색인 stock_issue_approval_steps_approver_sub_idx
 *   approvals.requested_by + status    내가 올린 건이 어떻게 됐나 — 색인 stock_issue_approvals_requester_idx
 *   🔴 **승인 줄은 기간이 아니라 상태로 사라진다** — 실행되면 `EXECUTED` 라 묶음에서 빠진다.
 *
 * 재고 부족 줄(2026-10-16)은 **칸 하나**를 더해 풀었다 — `parts.limit_quantity`(null = 정하지 않음 =
 * 알림 없음). 🔵 읽음 표는 여기서도 만들지 않는다: 견주는 두 수(`stock_balances.quantity` 와 그 칸)가
 * **지금 값**이라, 재고를 채우면 다음 번 질의에서 저절로 빠진다.
 *
 * ── 🔴 여기서 던지지 않는다 ─────────────────────────────────────────────
 * 이 값은 **모든 화면의 머리말**에 실린다. DB 가 멎었든, 설정이 빠져 이 시스템의
 * 주소를 못 만들든(env.ownBaseUrl 은 던진다), 종 하나 때문에 사이트 전체가 못 쓰게
 * 되면 안 된다. 그래서 어떤 실패도 **빈 목록**으로 돌아간다.
 *
 * ⚠️ 로그에는 **오류의 종류만** 남긴다. 사람 이름·부품명·사유 본문·주소는 싣지 않는다.
 * ============================================================================
 */

const EMPTY: InventoryNotificationFeed = { items: [], count: 0 };

/** 종이 보는 사람. 🔴 `requireSession()` 이 읽은 **살아 있는 users 행**이어야 한다. */
export type NotificationViewer = {
  /** `users.id`. 쿠키에 박힌 값이나 요청 본문에서 온 값을 넘기면 남의 알림을 보게 된다. */
  id: string;
  role: Role;
  /**
   * 🔴 **포털 번호**(`users.auth_sub` · 세션의 `sub`) — 「지금 내 차례인 결재가 있나」를 가르는
   * 유일한 열쇠다(2026-10-15, 조각 11d). 위 `id` 를 여기 넘기면 **영원히 0건**이고 오류도 나지
   * 않는다(`approval/part-issue.ts` 의 ① 주석 — 실제로 있었던 결함이다).
   *
   * 🔵 **두 통로 모두 이 값을 이미 쥐고 있다** — 화면 쪽은 세션(`session.user.authSub`), 포털
   * 통로는 포털이 서명한 토큰의 `sub` 로 되짚은 `users` 행(`user.authSub`)이다. 그래서 이 칸을
   * 채우려고 `users` 를 한 번 더 읽는 곳이 **한 군데도 없다**.
   */
  sub: string;
};

/**
 * 이 사람의 알림 — 줄과 **진짜 개수**.
 *
 * 여섯 질의는 **나란히** 나간다. 모두 **자격이 있을 때만** 묻는다 — 자격이 없으면 어차피
 * 줄이 만들어지지 않으므로(bell-items.ts) 왕복 한 번이 그대로 낭비다. 대기 요약과 재고 부족은
 * ADMIN 에게만, 반려 줄은 기록 권한(STAFF) 이상에게만 묻는다. 🔵 불출 결재 둘은 **누구에게나** 묻는다 —
 * `/approvals` 의 문이 `requireSession` 이라 역할로 가를 것이 없고, 자격은 질의의 열쇠
 * (`approver_sub` · `requested_by`)가 쥔다. 둘 다 색인을 타는 가벼운 질의다(그쪽 주석).
 * 🔵 **여섯째가 「완료된 내 반환 신청」이다** (2026-11-26) — 관문이 결재 결과와 **같은 함수**라
 * (쓰는 분 지시: 「[반환 완료]시에는 [결재 결과]를 따르도록」) 그 갈래를 끄면 **묻지도 않는다.**
 *
 * 🔴 「누가 받는가」를 이 파일에 손으로 적지 않는다 — 조립이 쓰는 `receives*` 를 **그대로
 * 부른다.** 조립이 한 번 더 거르므로 여기서 안 묻는 것은 **답을 바꾸는 일이 아니라 질의를
 * 아끼는 일**이고, 두 자리가 같은 함수를 보므로 갈라질 수 없다.
 *
 * ── 🟢 **승인함 위임이 두 통로에서 똑같이 걸린다** (2026-11-16 저녁, 설계 B-12) ──
 * 그날 낮까지는 「지금 내 차례인 결재」의 위임 목록을 **부르는 쪽이 정해서 넘겼다**: 머리말의
 * 종은 포털에 물어서 넘기고, **포털이 우리를 부르는 통로**(`app/api/integration/notifications`)는
 * 「안 물었다」를 글자로 넘겼다(되물으면 포털이 우리를 기다리는 동안 우리가 포털을 기다린다).
 * 🔴 그 갈림의 대가가 **「남의 시스템 종에서만 대리 건이 빠진다」**였다 — 설계 D-8 ②.
 * 🟢 이제 아래 집계가 **제 표 둘**을 읽으므로 넘길 인자가 없고, 두 통로가 같은 수를 센다.
 */
export async function listInventoryNotifications(viewer: NotificationViewer, now = new Date()): Promise<InventoryNotificationFeed> {
  try {
    const [pending, rejected, toDecide, decided, lowStock, completedReturns] = await Promise.all([
      // 🔴 「누가 받는가」를 여기서 다시 적지 않는다 — 조립이 쓰는 그 함수를 그대로 본다.
      receivesPendingNotification(viewer.role) ? summarizePendingRequests() : Promise.resolve({ count: 0, oldestAt: null }),
      // 🔴 기록 권한(STAFF) 아래면 **묻지도 않는다.** 그 줄이 가리키는 `/requests` 는
      //    `requireRole("STAFF")` 라 자격이 없는 사람에게는 눌러도 못 여는 줄이 되고
      //    (bell-items.ts 의 ②), 그 줄은 포털을 거쳐 남의 종에도 실린다.
      // 🔴 「7일」을 여기서 손으로 적지 않는다 — 조립과 **같은 함수**로 선을 긋는다.
      receivesRejectedNotification(viewer.role) ? listRejectedRequestsFor(viewer.id, rejectionCutoff(now), NOTIFICATION_MAX_ITEMS) : Promise.resolve({ rows: [], total: 0 }),
      // 🔴 **포털 번호**로 묻는다(viewer.sub). users.id 를 넘기면 영원히 0건이다.
      // 🟢 위임 목록은 그 집계가 **제 표 둘에서** 만든다(2026-11-16 저녁) — 여기서 넘기지
      //    않으므로 「넘기는 자리와 안 넘기는 자리」가 갈릴 일도 없다(머리말).
      receivesIssueApprovalToDecideNotification() ? summarizePartIssueApprovalsToDecide(viewer.sub) : Promise.resolve({ count: 0, oldestAt: null }),
      // 🔴 여기는 반대로 **이 시스템의 users.id** 다 — 결재건의 `requested_by` 가 그 번호다.
      // 🔴 반려의 「7일」은 위 반려 줄과 **같은 함수**에서 온다. 두 벌로 적지 않는다.
      receivesIssueApprovalDecidedNotification() ? listDecidedPartIssueApprovalsFor(viewer.id, rejectionCutoff(now), NOTIFICATION_MAX_ITEMS) : Promise.resolve({ rows: [], total: 0 }),
      // 🔴 재고를 채우는 사람(ADMIN)이 아니면 **묻지도 않는다** — 위 대기 요약과 같은 결이다.
      // 🔴 상한은 **종이 쓰는 그 값**(MAX_LOW_STOCK_ITEMS)이다. 다른 넷과 달리 200 이 아닌 까닭은
      //    그 상수의 주석에 — 재고 부족은 사건이 아니라 **상태**라 채워 넣기 전까지 계속 서 있다.
      //    🔵 넘친 종은 버려지지 않는다. `total` 이 그대로 와서 「그 밖에 N종 더」 한 줄이 된다.
      receivesLowStockNotification(viewer.role) ? listLowStockParts(MAX_LOW_STOCK_ITEMS) : Promise.resolve({ rows: [], total: 0 }),
      /**
       * 🔵 **완료된 내 반환 신청** (2026-11-26). 🔴 관문이 **바로 위 결재 결과와 같은 함수**다 —
       *    쓰는 분 지시가 「[반환 완료]시에는 [결재 결과]를 따르도록」이고, 포털에서 그 갈래를 끄면
       *    묻지도 않고 줄도 서지 않아야 한다(조립도 같은 관문을 지난다 — `bell-items.ts` 의 ③-2).
       * 🔴 **열쇠가 둘이다** — `users.id` 와 **포털 번호**를 함께 넘긴다. 반환을 올린 사람은 A/S 쪽
       *    기사라 이 시스템에 계정이 없던 시절의 신청이 `requester_sub` 로만 남아 있을 수 있다
       *    (그 질의의 머리말 · `approval/requester-subs.ts` 의 COALESCE 규칙). 🔵 **여기 서 있는 사람은
       *    두 값을 이미 쥐고 있다**(위 `NotificationViewer`) — users 를 다시 읽지 않는다.
       * 🔴 「7일」도 위 둘과 **같은 함수**에서 온다. 두 벌로 적지 않는다.
       */
      receivesIssueApprovalDecidedNotification() ? listCompletedReturnsFor({ userId: viewer.id, requesterSub: viewer.sub }, rejectionCutoff(now), NOTIFICATION_MAX_ITEMS) : Promise.resolve({ rows: [], total: 0 }),
    ]);

    if (pending.count === 0 && rejected.rows.length === 0 && toDecide.count === 0 && decided.rows.length === 0 && lowStock.rows.length === 0 && completedReturns.rows.length === 0) return EMPTY;

    return buildInventoryNotificationItems({
      role: viewer.role,
      pending,
      // 🔴 **갈래를 가르는 자리는 `approvalStepActor` 하나다** — 화면마다(또는 질의마다) 다시
      //    가르면 한 자리에서만 대리가 보이거나, 더 나쁘게는 옛 줄이 「본인」으로 둔갑한다
      //    (그 함수의 머리말). `listRejectedRequestsFor` 가 원본 칸(`rejectedStep`)만 올려 보내고
      //    여기서 받아 가른다 — 이 파일은 이미 결재 모듈을 가져오고 있어 고리가 생기지 않는다.
      rejected: rejected.rows.map((r) => ({ id: r.id, summary: r.summary, decidedByName: r.decidedByName, decidedAt: r.decidedAt, decidedBy: approvalStepActor(r.rejectedStep) })),
      rejectedTotal: rejected.total,
      issueApprovalsToDecide: toDecide,
      decidedIssueApprovals: decided.rows,
      decidedIssueApprovalsTotal: decided.total,
      lowStockParts: lowStock.rows,
      lowStockPartsTotal: lowStock.total,
      completedReturns: completedReturns.rows,
      completedReturnsTotal: completedReturns.total,
      now,
      // 주소를 못 만들면 여기서 던진다 — 아래 catch 가 받는다(env.ts 의 ownBaseUrlFrom).
      baseUrl: env.ownBaseUrl,
      sourceId: env.ssoClientId,
    });
  } catch (e) {
    // 🔴 오류의 **종류만** 남긴다. 값(이름·부품명·사유·주소)은 싣지 않는다.
    console.error("[notifications] 알림 목록을 만들지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return EMPTY;
  }
}
