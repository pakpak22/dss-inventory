import type { NotificationBellItem } from "@dss/ui";
import type { Role } from "@/db/schema/users";
import type { PartIssueStatus } from "@/lib/approval/part-issue-rules";
import { roleAtLeast } from "@/lib/auth/role";
import { todaySeoul as seoulDate } from "@/lib/stock/codes";

/**
 * ============================================================================
 * 이 시스템의 **자체 알림** — 반출 신청 둘 · 부품 불출 결재 둘
 * ============================================================================
 * 머리말의 알림 종(@dss/ui 의 NotificationBell)이 받는 아홉 칸을 만든다.
 * 이 파일은 **순수 계산만** 한다 — DB 도 React 도 세션도 환경변수도 모른다.
 * 재료(대기 건수 · 반려된 신청 줄 · 결재 차례 요약 · 결정된 내 결재건 · 이 시스템의
 * 주소 · client_id)는 부르는 쪽이 날라다 준다(notifications/queries.ts).
 *
 * ── 🔴 스키마를 건드리지 않는다 ─────────────────────────────────────────
 * 새 표도 마이그레이션도 없다. 「읽음」 표를 만들지 않는다. 네 가지 알림이 모두
 * **이미 있는 표의 상태와 시각만으로** 풀리기 때문이다:
 *
 *  | 누구에게          | 무엇                      | 어디로      | 언제 사라지나                       |
 *  |-------------------|---------------------------|-------------|-------------------------------------|
 *  | 지금 내 차례인 사람| 「결재할 불출 신청 N건」 | `/approvals`| 결재하면 단계가 닫혀 저절로          |
 *  | ADMIN(재고 담당)  | 「반출 확인 대기 N건」    | `/requests` | 확인·반려하면 상태가 바뀌어 저절로  |
 *  | 결재를 올린 본인  | 「불출 결재가 승인/반려」 | `/approvals`| 승인=**실행되면**, 반려=**7일**     |
 *  | 신청한 본인       | 「반출 신청이 반려됨」    | `/requests` | **결정된 지 7일**이 지나면 저절로   |
 *
 * 🔵 **확인된(CONFIRMED) 신청은 알리지 않는다**(2026-10-13 사용자 결정). 수량이
 * 바뀌어 화면에서 바로 보인다. 취소(CANCELLED)도 알리지 않는다 — 본인이 거둔 것이다.
 * 🔵 **승인된 결재건에는 기간 제한이 없다**(2026-10-15 사용자 결정). 「승인됐는데 아직
 * 안 나갔다」는 날짜가 아니라 **상태**(`APPROVED`)로 가려지고, 오래 묵을수록 더 보여야
 * 하는 줄이다. 실행되면 상태가 `EXECUTED` 로 바뀌어 질의에서 빠진다.
 *
 * ── 7일은 **이 파일에 한 번만** 적는다 ──────────────────────────────────
 * 질의도 이 파일의 `rejectionCutoff` 를 불러 WHERE 를 만들고(queries.ts), 아래
 * 조립도 같은 함수로 한 번 더 거른다. 규칙을 SQL 과 TS 에 두 벌로 적으면 언젠가
 * 갈라져서 「종에는 뜨는데 눌러도 없는」 줄이 생긴다.
 * ============================================================================
 */

/** 이 시스템의 사람이 읽는 이름. 종에서 줄마다 작게 붙는다(다른 시스템 알림과 섞이므로). */
export const NOTIFICATION_SOURCE_NAME = "DSS 재고 관리";

/**
 * 알림 종류 코드. @dss/ui 는 이 값으로 **색 한 칸만** 고른다(그쪽 tone.ts) — 종류를
 * 아는 분기가 묶음에는 한 군데도 없다.
 *
 * 🔴 `stock_requests.status` 를 그대로 쓰지 않는다. 「대기」 알림은 상태가 아니라
 * **여러 줄을 하나로 묶은 것**이라 「대기로 세는 상태」를 함께 센다 — PENDING·CONFIRMING 에
 * 더해 **일부만 나가고 아직 남은 것(PARTIAL)까지**다 (2026-10-14, 조각 4c).
 * 🔴 그 목록을 여기에 다시 적지 않는다. 가르는 자리는 `src/lib/stock/codes.ts` 의
 * `ACTIONABLE_REQUEST_STATUSES` 하나이고, 이 파일은 거기로 센 **건수만** 받는다(아래 PendingSummary).
 * 🔴 **보류(ON_HOLD)는 이 숫자에서 빠진다** — 대기 **목록**에는 그대로 보인다 (2026-10-15, 조각 10a).
 */
export const NOTIFICATION_KINDS = {
  pending: "STOCK_REQUEST_PENDING",
  rejected: "STOCK_REQUEST_REJECTED",
  /** 「지금 내 차례인 불출 결재가 있다」 — 묶음 한 줄 (2026-10-15, 조각 11d). */
  issueApprovalToDecide: "STOCK_ISSUE_APPROVAL_TO_DECIDE",
  /**
   * 「내가 올린 불출 결재가 결정됐다」 — **승인과 반려를 한 종류로 둔다.**
   *
   * 🔴 가르지 않은 까닭: 이 종류가 답하는 물음은 **「누가 받는가」** 하나이고, 승인이든
   * 반려든 받는 사람이 **올린 본인**으로 똑같다(아래 receives*). 포털 관리 화면은 종류마다
   * 한 줄씩 「이 역할이 받나」를 그리므로, 받는 사람이 같은 둘을 두 줄로 쪼개면 포털에서
   * 똑같은 줄이 두 번 보이고 한쪽만 끄는 길이 열린다 — 「승인은 받고 반려는 안 받는다」는
   * 설정이 뜻을 갖지 않는다.
   * 🔴 **그래도 둘은 글자로 갈린다** — 줄의 제목이 다르다(아래 조립 ③의 두 문장). 색만으로
   * 가르지 않는 것이 이 저장소의 관례이고, 같은 종류라 색도 같으므로 **글자가 유일한
   * 구분**이다. 제목을 다듬을 때 그 사실을 잊지 마라.
   */
  issueApprovalDecided: "STOCK_ISSUE_APPROVAL_DECIDED",
} as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

/** 사람이 읽는 종류 이름. 🔴 색과 **함께 글자로도** 그려진다. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  [NOTIFICATION_KINDS.pending]: "확인 대기",
  [NOTIFICATION_KINDS.rejected]: "반려",
  [NOTIFICATION_KINDS.issueApprovalToDecide]: "결재 차례",
  [NOTIFICATION_KINDS.issueApprovalDecided]: "결재 결과",
};

/**
 * 「대기」 알림의 id. 🔴 **고정값이다** — 여러 신청을 한 줄로 묶은 알림이라 그 줄을
 * 가리키는 열쇠도 하나다. 건수가 바뀌어도 같은 줄이어야 종이 줄을 다시 그리지 않는다.
 */
export const PENDING_NOTIFICATION_ID = "REQUESTS_PENDING";

/** 「반려」 알림 id 의 앞머리. 나중에 종류가 늘어도 열쇠끼리 부딪히지 않게 한다. */
export const REJECTED_ID_PREFIX = "REQUEST_REJECTED";

/**
 * 「결재 차례」 알림의 id. 🔴 **고정값이다** — 위 PENDING_NOTIFICATION_ID 와 같은 까닭으로,
 * 내 차례인 결재 여러 건을 한 줄로 묶은 알림이라 그 줄을 가리키는 열쇠도 하나다.
 */
export const ISSUE_APPROVAL_TO_DECIDE_NOTIFICATION_ID = "ISSUE_APPROVALS_TO_DECIDE";

/** 「결재 결과」 알림 id 의 앞머리. */
export const ISSUE_APPROVAL_DECIDED_ID_PREFIX = "ISSUE_APPROVAL_DECIDED";

/** 반려 알림이 보이는 기간(일). 🔴 사용자가 정한 값(2026-10-13). */
export const REJECTED_VISIBLE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 종에 실어 보낼 줄 수의 상한.
 *
 * 200 인 까닭: 포털이 한 시스템에서 받은 목록을 **200줄에서 자른다**(dss-auth 의
 * notifications/merge.ts 의 MAX_ITEMS_PER_SOURCE). 같은 수를 두 번 정하지 않게 맞춘다.
 *
 * 🔴 **배지 숫자는 이 상한에 걸리기 전의 진짜 개수**다(아래 count 주석).
 */
export const NOTIFICATION_MAX_ITEMS = 200;

/**
 * 알림을 누르면 가는 화면 — **부품 요청 관리**(`/requests`).
 *
 * 🔴 **2026-10-15 에 `/entries` 에서 여기로 옮겼다.** 확인 대기 묶음도, 내 신청 결과도 기록 내역에서 걷어내
 *    부품 요청 관리 한자리로 모았다(사용자 결정). 그대로 두었으면 종을 눌러 기록 내역으로 가 **그 신청이
 *    하나도 보이지 않는 막다른 길**이었다.
 * 🔴 **절대 주소를 만드는 자리는 아래 `href` 한 곳뿐이다**(`baseUrl` + 이 경로). 이 값은 이 시스템의 종뿐
 *    아니라 포털을 거쳐 **다른 사내 시스템의 종에도 실려 나가는데**(notifications/queries.ts 를
 *    app/api/integration/notifications 가 그대로 내준다), 양쪽이 **같은 줄**을 쓰므로 여기 한 줄이 둘 다 바꾼다.
 * 🔵 **문이 기록 권한(STAFF) 이상이다**(그 화면의 `requireRole("STAFF")` — 기록 내역은 세션만 봤다). 「확인
 *    대기」는 ADMIN 에게만 가니 괜찮고, 「반려」는 **신청을 낸 본인**에게만 가므로 보통은 STAFF 이상이다.
 *    🔴 다만 **신청을 낸 뒤 보기(VIEWER)로 내려간 사람**은 7일 안에 반려된 자기 신청이 있으면 종에 줄이 뜨는데
 *    눌러도 `/forbidden` 으로 가는 **막다른 길**이었다. **2026-10-15 에 막았다** — 조립 ②와 질의(queries.ts)가
 *    둘 다 `receivesRejectedNotification` 을 지나간다. 🔴 **권한을 넓혀 푼 것이 아니다** — 이 화면의 문은
 *    `requireRole("STAFF")` 그대로고, 못 여는 사람에게 **줄을 만들지 않는** 쪽으로 맞췄다.
 */
const REQUESTS_PATH = "/requests";

/**
 * 불출 결재 알림 둘이 가는 화면 — **승인 요청건**(`/approvals`) (2026-10-15, 조각 11d).
 *
 * 🔴 **그 화면의 문은 `requireSession` 이다 — 역할로 막지 않는다.** 직접 읽고 적는다
 *    (`src/app/(app)/approvals/page.tsx` 29행: `await requireSession("/approvals")`, 그 위 주석).
 *    까닭은 **결재자가 역할과 무관하게 누구나 될 수 있기 때문**이다 — 결재선은 A/S 명부에서
 *    고르고, 거기 든 사람이 여기서는 보기(VIEWER) 권한일 수 있다. 역할로 막으면 그 사람이
 *    자기 차례를 영영 못 누른다.
 * 🔵 그래서 이 두 줄에는 **역할 관문이 없다**(아래 receives* 둘) — 「반려」 줄이 `/requests` 의
 *    `requireRole("STAFF")` 때문에 역할을 봐야 했던 것과 **반대 경우**다. 두 화면의 문이
 *    다르다는 것이 그 차이의 전부이고, 문이 바뀌면 여기도 바뀌어야 한다.
 * 🔴 「눌러도 못 여는 줄」을 오늘 한 번 만들었다(그 아래 ② 주석). 그래서 이번에는 **문부터
 *    읽고** 적었다 — 넘겨짚지 마라.
 */
const APPROVALS_PATH = "/approvals";

/**
 * 반려 알림이 보이는 선. 이 시각보다 **먼저** 결정된 것은 사라진다.
 *
 * 🔴 질의와 조립이 **같이 부르는 한 함수**다(파일 머리말). 「7일」이 적힌 곳은 위
 * 상수 하나뿐이다.
 */
export function rejectionCutoff(now: Date): Date {
  return new Date(now.getTime() - REJECTED_VISIBLE_DAYS * DAY_MS);
}

/** 그 반려가 아직 보일 때인가. 결정 시각이 없으면(있을 수 없지만) 안 보인다. */
export function isRejectionVisible(decidedAt: Date | null, now: Date): boolean {
  if (!decidedAt) return false;
  return decidedAt.getTime() >= rejectionCutoff(now).getTime();
}

/* ── 누가 무엇을 받는가 — 🔴 이 두 함수가 그 규칙의 **유일한 자리**다 ──────── */

/**
 * 「반출 확인 대기」를 받는 사람 — **재고 담당(ADMIN)뿐**이다.
 *
 * 아래 조립과 포털에 내주는 설정 표(notifications/settings.ts)가 **같이** 부른다.
 * 손으로 두 번 적으면 「종에는 뜨는데 설정 표에는 안 받는다고 적힌」 상태가 생긴다.
 */
export function receivesPendingNotification(role: Role): boolean {
  return role === "ADMIN";
}

/**
 * 「내 반출 신청이 반려됨」을 받는 사람 — **신청을 낼 수 있는 사람**(기록 권한 이상).
 *
 * 🔴 **어느 신청이 오는가**를 거르는 것은 역할이 아니라 `stock_requests.requested_by` 다 —
 * 자기 신청만 온다(stock/requests.ts 의 listRejectedRequestsFor). 이 함수가 답하는 것은
 * 그 앞의 물음, 즉 **「어느 역할이 이 알림을 받을 수 있나」**다: 보기(VIEWER)는 기록을
 * 못 하므로 신청을 낼 수 없고, 기록(STAFF)과 관리자(ADMIN)는 반출을 적으면 확인 대기로
 * 들어간다.
 *
 * 🔴 **이 판정이 적힌 자리는 여기 하나뿐이다.** 부르는 곳이 셋이다 — 조립(아래 ②) ·
 * 질의(notifications/queries.ts) · 포털 설정 표(notifications/settings.ts). 어느 쪽에도
 * `roleAtLeast(role, "STAFF")` 를 손으로 한 벌 더 적지 않는다. 두 벌이 되면 언젠가 갈려
 * 「종에는 뜨는데 눌러도 못 여는」 줄이 다시 생긴다.
 *
 * 🔴 **2026-10-15 사용자 결정으로 관리자도 같아졌다** — 그 전에는 관리자가 적은 반출이
 * 바로 원장에 떨어져서, 「그래도 기록 권한이던 시절의 신청이 남아 있을 수 있다」는
 * 까닭으로 ADMIN 을 넣어 두고 있었다. 이제는 관리자가 낸 요청도 반려될 수 있으므로
 * 까닭이 더 단순해졌다. 답(STAFF 이상)은 **그대로**다
 * (stock/codes.ts 의 needsConfirmation).
 */
export function receivesRejectedNotification(role: Role): boolean {
  return roleAtLeast(role, "STAFF");
}

/**
 * 「결재할 불출 신청이 있다」를 받는 사람 — **역할로 거르지 않는다.**
 *
 * 🔴 매개변수가 없는 것이 **답이자 설명**이다. 역할은 이 판정에 들어오지 않는다:
 *  - **자격을 가르는 것은 `stock_issue_approval_steps.approver_sub` 다** — 지금 내 차례로 열려
 *    있는 단계가 있는 사람에게만 질의가 줄을 가져온다(approval/part-issue.ts 의
 *    `summarizePartIssueApprovalsToDecide`). 차례가 없으면 건수가 0 이라 줄이 서지 않는다.
 *  - **문이 `requireSession` 이다**(위 APPROVALS_PATH 주석에 근거를 적었다). 역할로 거르면
 *    보기(VIEWER) 권한인 결재자가 자기 차례를 알림으로도 못 받고 화면으로도 못 간다 —
 *    「눌러도 못 여는 줄」의 **정반대 실수**다.
 *
 * 🔵 돌려주는 값이 늘 `true` 인데도 함수로 둔 까닭: 포털 설정 표(notifications/settings.ts)와
 * 질의(notifications/queries.ts)와 아래 조립이 **같은 자리**를 봐야 하기 때문이다. 자격 규칙이
 * 생기면 고칠 곳이 여기 하나다.
 */
export function receivesIssueApprovalToDecideNotification(): boolean {
  return true;
}

/**
 * 「내가 올린 불출 결재가 승인/반려됐다」를 받는 사람 — **역할로 거르지 않는다.**
 *
 * 🔴 **어느 건이 오는가**를 거르는 것은 역할이 아니라 `stock_issue_approvals.requested_by` 다 —
 * 자기가 올린 건만 온다(approval/part-issue.ts 의 `listDecidedPartIssueApprovalsFor`).
 * 결재를 올리는 길이 오늘은 기록 권한(STAFF) 이상에게 열려 있지만, 올린 **뒤에** 보기(VIEWER)로
 * 내려간 사람에게도 자기 결재건의 결과는 보여야 한다 — 그 화면(`/approvals`)의 문이
 * `requireSession` 이라 **눌러서 열린다**(위 APPROVALS_PATH 주석). 반려 줄에서 역할을 봐야 했던
 * 까닭은 문이 `requireRole("STAFF")` 였기 때문이지 「신청자였으니까」가 아니다.
 */
export function receivesIssueApprovalDecidedNotification(): boolean {
  return true;
}

/** 종이 받는 한 뭉치 — 그릴 줄과 배지에 찍을 수. */
export type InventoryNotificationFeed = {
  items: NotificationBellItem[];
  /**
   * 배지에 찍을 수. 🔴 **줄 수를 다시 세지 않는다**(@dss/ui README 7절) — 아래
   * buildInventoryNotificationItems 가 자르기 전의 진짜 개수로 계산해 넘긴다.
   *
   * 🔵 묶음 줄(「대기 N건」 · 「결재할 불출 신청 N건」)은 **1** 로 센다. 종을 펼치면 한 줄이기 때문이다 — 배지가 5 인데
   * 펼치면 한 줄이면 둘 중 하나가 거짓말로 읽힌다. N 은 그 줄의 글자에 있다.
   * 머리말의 「대기 N」 배지는 그대로 N 을 말한다 — 역할이 다른 표시다(그쪽은
   * 「이 화면에 할 일이 있다」, 종은 「알림이 몇 줄 있다」).
   */
  count: number;
};

/** 확인 대기 요약. 부르는 쪽이 세어 온다. */
export type PendingSummary = {
  /** 대기로 세는 상태(`ACTIONABLE_REQUEST_STATUSES` — PENDING·CONFIRMING·PARTIAL)의 건수. 🔴 머리말 배지와 같은 묶음이고, 보류(ON_HOLD)는 이 숫자에서 빠진다 — 대기 목록에는 그대로 보인다. */
  count: number;
  /** 가장 오래 기다린 신청의 시각. 없으면 null. */
  oldestAt: Date | null;
};

/** 알림으로 만들 반려된 신청 한 줄. 종에 필요한 칸만 받는다. */
export type RejectedRequestSource = {
  /** `stock_requests.id`. 알림 id 가 이 값에서 나온다. */
  id: string;
  /** 신청 때 붙여 둔 한 줄 요약(종류·날짜·부품). */
  summary: string;
  /** 반려한 담당자 이름. 없으면 빈 칸으로 그린다. */
  decidedByName: string | null;
  decidedAt: Date | null;
};

/** 「지금 내 차례인 결재」 요약. 부르는 쪽이 세어 온다. `PendingSummary` 와 같은 모양이다. */
export type IssueApprovalToDecideSummary = {
  /** 내 차례로 열려 있는 단계가 달린, 아직 결재 중인 건의 수. */
  count: number;
  /** 그중 가장 오래 기다린 건이 **올라온** 시각. 없으면 null. */
  oldestAt: Date | null;
};

/**
 * 🔴 **종에 줄이 서는 결재건의 상태 — 이 목록이 유일한 자리다.**
 *
 * 「승인됐는데 아직 안 나갔다」와 「반려됐다」 둘뿐이고, 실행된 건(`EXECUTED`)·거둔 건
 * (`CANCELLED`)·아직 결재 중인 건(`PENDING_APPROVAL`)은 **들어 있지 않다.** 그래서
 * **「실행되면 종에서 사라진다」가 날짜가 아니라 이 한 줄로 풀린다** — 질의
 * (`approval/part-issue.ts` 의 `listDecidedPartIssueApprovalsFor`)가 이 목록을 그대로 WHERE 에
 * 넣고, 아래 조립이 같은 목록으로 한 번 더 거른다. 목록을 손으로 두 벌 적으면 언젠가 갈려서
 * 「이미 나간 부품이 종에 남는」 줄이 생긴다.
 *
 * 🔵 `PartIssueStatus` 로 좁혀 둔 덕에 **오타가 컴파일에서 걸린다**(없는 상태를 적을 수 없다).
 */
export const DECIDED_ISSUE_APPROVAL_STATUSES = ["APPROVED", "REJECTED"] as const satisfies readonly PartIssueStatus[];

export type DecidedIssueApprovalStatus = (typeof DECIDED_ISSUE_APPROVAL_STATUSES)[number];

/** 알림으로 만들 「결정된 내 결재건」 한 줄. 종에 필요한 칸만 받는다. */
export type DecidedIssueApprovalSource = {
  /** `stock_issue_approvals.id`. 알림 id 가 이 값에서 나온다. */
  id: string;
  /** 🔴 **둘뿐이다** — 까닭은 바로 위 `DECIDED_ISSUE_APPROVAL_STATUSES`. */
  status: DecidedIssueApprovalStatus;
  /** 어느 반출 신청인가 — `stock_requests.summary` 한 줄 요약. */
  summary: string;
  /**
   * 결재건을 **올린** 시각.
   *
   * 🔵 승인 줄의 날짜가 「승인된 시각」이 아니라 이것인 까닭 둘: ① 승인 시각은 표의 머리에
   * 없고 **마지막 단계 줄**에 있어 집계 하나가 더 붙는다(종은 모든 화면에 딸려 온다).
   * ② 결재선이 전부 신청자 본인이라 **단계 없이 바로 승인된 건**(`AUTO_APPROVED`)에는 그
   * 시각이 아예 없다. 올린 시각은 어느 건에나 있고, 「얼마나 묵었나」를 더 길게 말해 준다.
   */
  requestedAt: Date;
  /** 반려한 결재자 이름. 🔴 **승인 줄에서는 null 이다** — 승인에는 한마디를 받지 않는다. */
  decidedByName: string | null;
  /** 반려된 시각(`stock_issue_approval_steps.decided_at`). 🔴 **승인 줄에서는 null 이다.** */
  decidedAt: Date | null;
};

/**
 * 절대 주소인지 보고 끝의 슬래시를 떼어 낸다.
 *
 * 🔴 **상대경로를 받지 않는다.** 자기 화면에서는 `/entries` 로도 열리지만, 이 목록은
 * 포털을 거쳐 **다른 시스템의 종**에 실린다 — 포털은 상대경로로 온 줄을 버린다
 * (dss-auth 의 merge.ts).
 *
 * 조용히 물러서지 않고 던진다 — 주소가 틀린 채로 그럭저럭 도는 상태가 가장 오래
 * 숨는다. 종 하나 때문에 모든 화면이 죽지 않게 삼키는 것은 부르는 쪽(queries.ts)의 몫이다.
 */
function requireAbsoluteBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+(\/\S*)?$/.test(trimmed)) {
    throw new Error(`알림 주소의 앞머리(baseUrl)는 http(s):// 로 시작하는 절대 주소여야 합니다(받은 값: ${baseUrl}).`);
  }
  return trimmed;
}

/** 신청 id → 이 시스템 안에서의 알림 id. 🔴 같은 신청에는 **언제나 같은 값**이 나온다. */
export function rejectedNotificationId(requestId: string): string {
  return `${REJECTED_ID_PREFIX}:${requestId}`;
}

/**
 * 결재건 id → 알림 id. 🔴 같은 결재건에는 **언제나 같은 값**이 나온다.
 *
 * 🔵 승인과 반려가 **같은 id** 를 쓴다. 한 결재건은 둘 중 하나로만 끝나므로 부딪히지 않고,
 * 같은 열쇠여야 「승인됨」 줄이 「반려됨」 줄로 바뀌는 일도 (있을 수 없지만) 줄이 둘이 되지 않는다.
 */
export function issueApprovalDecidedNotificationId(approvalId: string): string {
  return `${ISSUE_APPROVAL_DECIDED_ID_PREFIX}:${approvalId}`;
}

/** " · " 로 잇되 빈 토막은 뺀다. */
function joinDetail(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "")
    .join(" · ");
}

/**
 * 재료 → 종이 받는 목록과 개수.
 *
 * ── 차례 ────────────────────────────────────────────────────────────────
 * **할 일이 위, 결과가 아래**다. ⓪ 결재 차례 → ① 확인 대기 → ③ 결재 결과 → ② 반출 신청 반려.
 * ⓪ 가 맨 위인 까닭: 그 줄만이 **남이 나를 기다리고 있는** 일이다(결재가 안 나면 부품이 안
 * 나간다). 줄 안의 차례는 질의가 정한 그대로 쓴다 — 두 곳에서 각자 정렬하면 언젠가 갈린다.
 *
 * ── 🔴 아홉 칸이 전부 채워진다 ──────────────────────────────────────────
 * @dss/ui 의 NotificationBellItem 은 아홉 칸이 모두 필수 string 이고, **없는 값은
 * null 이 아니라 빈 문자열**이다(그쪽 types.ts).
 */
export function buildInventoryNotificationItems(input: {
  /**
   * 보는 사람의 역할. 🔴 「확인 대기」는 ADMIN 에게만, 「반려」는 기록 권한(STAFF) 이상에게만
   * 간다(위 receives*). 🔵 **불출 결재 둘은 역할을 보지 않는다** — `/approvals` 의 문이
   * `requireSession` 이기 때문이다(위 APPROVALS_PATH 주석).
   */
  role: Role;
  pending: PendingSummary;
  /** 이미 상한(NOTIFICATION_MAX_ITEMS)에서 잘린 반려 줄. */
  rejected: readonly RejectedRequestSource[];
  /** 🔴 자르기 전의 반려 건수. 안 넘기면 받은 줄 수로 본다. */
  rejectedTotal?: number;
  /** 지금 내 차례인 불출 결재 요약(건수 · 가장 오래 기다린 시각). */
  issueApprovalsToDecide: IssueApprovalToDecideSummary;
  /** 내가 올린 결재건 중 **결정된 것** — 승인(기간 제한 없음) · 반려(7일). 이미 상한에서 잘린 줄. */
  decidedIssueApprovals: readonly DecidedIssueApprovalSource[];
  /** 🔴 자르기 전의 건수. 안 넘기면 받은 줄 수로 본다. */
  decidedIssueApprovalsTotal?: number;
  /** 기준 시각. 7일 선을 여기서 긋는다. */
  now: Date;
  /** 이 시스템의 주소 앞머리. 🔴 절대 주소여야 한다. */
  baseUrl: string;
  /** 이 시스템의 client_id(`dss-inventory`). */
  sourceId: string;
}): InventoryNotificationFeed {
  const baseUrl = requireAbsoluteBaseUrl(input.baseUrl);
  // 🔴 **절대 주소를 만드는 자리는 여기 둘뿐이다.** 화면의 종과 포털이 가져가는 목록이 같은
  //    줄을 쓰므로, 이 두 줄이 양쪽을 함께 바꾼다.
  const requestsHref = `${baseUrl}${REQUESTS_PATH}`;
  const approvalsHref = `${baseUrl}${APPROVALS_PATH}`;
  const items: NotificationBellItem[] = [];
  const seen = new Set<string>();

  const push = (id: string, kind: NotificationKind, subject: string, detail: string, href: string): void => {
    // key 는 목록 안에서 유일해야 한다(React key 이자 눌린 줄을 되찾는 열쇠다).
    if (seen.has(id)) return;
    seen.add(id);
    items.push({
      // 🔴 목록 **전체**에서 유일해야 한다. 다른 시스템의 줄이 같은 목록에 섞이면
      //    id 만으로는 부딪히므로 포털과 같은 모양(`client_id:id`)으로 둔다.
      key: `${input.sourceId}:${id}`,
      sourceId: input.sourceId,
      sourceName: NOTIFICATION_SOURCE_NAME,
      id,
      kind,
      kindLabel: NOTIFICATION_KIND_LABELS[kind],
      subject,
      detail,
      // 🔴 **절대 주소**다. 남의 종에 그려질 링크이기도 하거니와, 포털이 상대경로로
      //    온 줄을 버린다(requireAbsoluteBaseUrl 주석).
      href,
    });
  };

  // ⓪ 지금 내 차례인 사람에게 — 「결재할 불출 신청 N건」. 여러 건을 **한 줄로 묶는다.**
  //    🔴 건마다 한 줄로 두지 않는 까닭: 결재가 밀릴수록 종이 그 줄로만 가득 찬다(①과 같은 까닭).
  //    🔴 **역할을 보지 않는다** — 자격은 「내 차례인 단계가 있나」(질의의 approver_sub)로 이미
  //       갈렸고, `/approvals` 의 문은 `requireSession` 이다(위 APPROVALS_PATH 주석).
  //       판정은 `receivesIssueApprovalToDecideNotification` 한 곳에서만 온다.
  const showToDecide = receivesIssueApprovalToDecideNotification() && input.issueApprovalsToDecide.count > 0;
  if (showToDecide) {
    push(
      ISSUE_APPROVAL_TO_DECIDE_NOTIFICATION_ID,
      NOTIFICATION_KINDS.issueApprovalToDecide,
      `결재할 불출 신청 ${input.issueApprovalsToDecide.count}건`,
      // 🔴 신청 **내용**(부품명·사유)은 싣지 않는다 — ①과 같은 까닭이다.
      input.issueApprovalsToDecide.oldestAt ? `가장 오래 기다린 결재 ${seoulDate(input.issueApprovalsToDecide.oldestAt)}` : "",
      approvalsHref,
    );
  }

  // ① 담당자(ADMIN)에게 — 「반출 확인 대기 N건」. 여러 줄을 **한 줄로 묶는다.**
  //    확인하거나 반려하면 상태가 바뀌어 다음 번에 저절로 빠진다.
  const showPending = receivesPendingNotification(input.role) && input.pending.count > 0;
  if (showPending) {
    push(
      PENDING_NOTIFICATION_ID,
      NOTIFICATION_KINDS.pending,
      `반출 확인 대기 ${input.pending.count}건`,
      // 🔴 신청 **내용**(부품명·사유)은 싣지 않는다. 묶음 줄이라 어느 신청인지 가릴
      //    수 없고, 이 줄은 포털을 거쳐 다른 시스템의 화면에도 그려진다.
      input.pending.oldestAt ? `가장 오래 기다린 신청 ${seoulDate(input.pending.oldestAt)}` : "",
      requestsHref,
    );
  }

  // ③ 결재를 **올린 본인**에게 — 「승인되었습니다」 · 「반려되었습니다」. **건마다 한 줄**이다
  //    (②와 같은 모양). 결재 차례(⓪)와 달리 묶지 않는 까닭: 어느 신청이 어떻게 됐는지가
  //    그 줄의 알맹이라서 묶으면 아무 말도 하지 못한다.
  //
  //    🔴 **두 문장이 서로 다른 말이어야 한다** — 「결재할 것이 있다」(⓪) · 「승인됐다」 ·
  //       「반려됐다」는 다른 사건이다. 승인과 반려는 **같은 종류**라 색이 같으므로
  //       (NOTIFICATION_KINDS 주석) 갈라 주는 것은 **글자뿐**이다.
  //    🔴 **승인 줄에는 기간 제한이 없다**(2026-10-15 사용자 결정). 가려 주는 것은 날짜가
  //       아니라 상태다 — 실행되면 `EXECUTED` 가 되어 질의가 가져오지 않는다.
  //    🔴 **반려 줄의 7일은 ②와 같은 함수로 긋는다**(`isRejectionVisible`). 손으로 다시 적으면
  //       두 벌이 되어 언젠가 갈린다.
  //    🔴 **역할을 보지 않는다** — ⓪과 같은 까닭(`/approvals` 의 문이 `requireSession` 이다).
  const showDecided = receivesIssueApprovalDecidedNotification();
  let decidedShown = 0;
  if (showDecided) {
    for (const row of input.decidedIssueApprovals) {
      // 🔴 질의가 이미 걸렀지만 여기서 한 번 더 본다(②와 같은 모양). **마지막 갈래가 핵심이다**:
      //    실행된 건·거둔 건·결재 중인 건은 줄이 되지 않는다. 그 목록은
      //    `DECIDED_ISSUE_APPROVAL_STATUSES` 하나에서 오므로 질의와 갈라질 수 없다.
      const visible = row.status === "APPROVED" ? true : row.status === "REJECTED" ? isRejectionVisible(row.decidedAt, input.now) : false;
      if (!visible) continue;
      decidedShown += 1;
      push(
        issueApprovalDecidedNotificationId(row.id),
        NOTIFICATION_KINDS.issueApprovalDecided,
        row.status === "APPROVED" ? "불출 결재가 승인되었습니다" : "불출 결재가 반려되었습니다",
        // 🔴 반려 **사유 본문**도 승인 **수량**도 싣지 않는다 — /approvals 에서 본다.
        //    어느 건인지와, 얼마나 묵었는지만 가린다.
        row.status === "APPROVED"
          ? joinDetail([row.summary, "아직 불출 전", `올린 날 ${seoulDate(row.requestedAt)}`])
          : joinDetail([row.summary, row.decidedByName ? `${row.decidedByName} 반려` : null, row.decidedAt ? seoulDate(row.decidedAt) : null]),
        approvalsHref,
      );
    }
  }

  // ② 신청한 본인에게 — 「반출 신청이 반려되었습니다」. 결정된 지 7일이 지나면 사라진다.
  //    🔴 **역할도 본다**(①과 같은 모양). 기록 권한(STAFF) 아래인 사람에게는 줄을 아예 만들지 않는다.
  //    까닭: 이 줄이 가리키는 `/requests` 는 `requireRole("STAFF")` 라 자격이 없으면 눌러도 `/forbidden` 으로
  //    튕긴다 — **눌러도 못 여는 줄**이다. 신청을 낸 뒤 보기(VIEWER)로 내려간 사람에게 실제로 그랬다.
  //    게다가 이 줄은 포털을 거쳐 **다른 사내 시스템의 종에도 실려 나가므로**(app/api/integration/notifications),
  //    막다른 길이 우리 화면 밖에서도 그려진다. 🔴 판정은 `receivesRejectedNotification` 한 곳에서만 온다.
  const showRejected = receivesRejectedNotification(input.role);
  let rejectedShown = 0;
  if (showRejected) {
    for (const row of input.rejected) {
      // 🔴 질의가 이미 걸렀지만 여기서 한 번 더 본다. 둘이 같은 함수를 부르므로 규칙이
      //    갈라질 수 없고, 질의가 쥐여 준 줄을 그대로 믿지 않아도 된다.
      if (!isRejectionVisible(row.decidedAt, input.now)) continue;
      rejectedShown += 1;
      push(
        rejectedNotificationId(row.id),
        NOTIFICATION_KINDS.rejected,
        "반출 신청이 반려되었습니다",
        // 🔴 반려 **사유 본문**은 싣지 않는다 — /requests 에서 본다. 어느 신청인지만 가린다.
        joinDetail([row.summary, row.decidedByName ? `${row.decidedByName} 반려` : null, row.decidedAt ? seoulDate(row.decidedAt) : null]),
        requestsHref,
      );
    }
  }

  // 🔴 자르기 전의 진짜 개수. 받은 줄이 상한에서 잘렸다면 rejectedTotal 이 더 크다.
  //    다만 「7일 선에 걸려 여기서 뺀 줄」까지 세면 거짓이 되므로, 상한에 걸리지 않은
  //    보통의 경우(총계 = 받은 줄 수)에는 실제로 그린 줄 수를 쓴다.
  //    🔴 자격이 없으면 **0 이다** — 줄이 없는데 배지 숫자만 남으면 눌러도 빈 종이 된다.
  let rejectedCount = 0;
  if (showRejected) {
    const rejectedTotal = input.rejectedTotal ?? input.rejected.length;
    rejectedCount = rejectedTotal > input.rejected.length ? rejectedTotal : rejectedShown;
  }

  // 결재 결과 줄도 같은 셈이다(바로 위 주석).
  let decidedCount = 0;
  if (showDecided) {
    const decidedTotal = input.decidedIssueApprovalsTotal ?? input.decidedIssueApprovals.length;
    decidedCount = decidedTotal > input.decidedIssueApprovals.length ? decidedTotal : decidedShown;
  }

  return {
    items: items.slice(0, NOTIFICATION_MAX_ITEMS),
    // 🔵 묶음 줄(⓪ · ①)은 **1** 로 센다 — 펼치면 한 줄이기 때문이다(위 count 주석).
    count: (showToDecide ? 1 : 0) + (showPending ? 1 : 0) + decidedCount + rejectedCount,
  };
}
