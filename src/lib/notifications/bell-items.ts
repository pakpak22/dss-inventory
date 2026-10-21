import type { NotificationBellItem } from "@dss/ui";
import type { Role } from "@/db/schema/users";
import type { PartIssueStatus } from "@/lib/approval/part-issue-rules";
import { roleAtLeast } from "@/lib/auth/role";
// 🔴 「재고가 한계수량에 걸렸나」는 **부품 어휘**에 있다 — 상세 창의 「부족」 딱지도 같은 함수를
//    본다(그쪽 주석). 여기에 한 벌 더 적으면 「상세엔 부족이라는데 종은 조용하다」가 생긴다.
import { isLowStock } from "@/lib/parts/codes";
import { todaySeoul as seoulDate } from "@/lib/stock/codes";

/**
 * ============================================================================
 * 이 시스템의 **자체 알림** — 반출 신청 둘 · 부품 불출 결재 둘 · 한계수량 하나
 * ============================================================================
 * 머리말의 알림 종(@dss/ui 의 NotificationBell)이 받는 아홉 칸을 만든다.
 * 이 파일은 **순수 계산만** 한다 — DB 도 React 도 세션도 환경변수도 모른다.
 * 재료(대기 건수 · 반려된 신청 줄 · 결재 차례 요약 · 결정된 내 결재건 · 이 시스템의
 * 주소 · client_id)는 부르는 쪽이 날라다 준다(notifications/queries.ts).
 *
 * ── 🔴 「읽음」 표를 만들지 않는다 ───────────────────────────────────────
 * 다섯 가지 알림이 모두 **이미 있는 표의 상태와 값만으로** 풀린다:
 *
 *  | 누구에게          | 무엇                      | 어디로      | 언제 사라지나                       |
 *  |-------------------|---------------------------|-------------|-------------------------------------|
 *  | 지금 내 차례인 사람| 「결재할 불출 신청 N건」 | `/approvals`| 결재하면 단계가 닫혀 저절로          |
 *  | ADMIN(재고 담당)  | 「반출 확인 대기 N건」    | `/requests` | 확인·반려하면 상태가 바뀌어 저절로  |
 *  | ADMIN(재고 담당)  | 「재고가 한계수량 이하」  | `/?part=No.`| 재고가 한계수량을 넘으면 저절로     |
 *  | 결재를 올린 본인  | 「불출 결재가 승인/반려」 | `/approvals`| 승인=**실행되면**, 반려=**7일**     |
 *  | 신청한 본인       | 「반출 신청이 반려됨」    | `/requests` | **결정된 지 7일**이 지나면 저절로   |
 *
 * 🔵 **2026-10-16 에 다섯째가 붙었다** — 한계수량(`parts.limit_quantity`)은 새 칸이지만, 이 파일의
 * 약속은 **읽음 표를 만들지 않는 것**이지 칸을 안 더하는 것이 아니다. 그 줄도 다른 넷과 똑같이
 * **지금 값으로만** 풀린다: 재고를 채우면 다음 번에 저절로 빠진다(아래 ④).
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
  /**
   * 「재고가 한계수량 이하다」 — **부품마다 한 줄** (2026-10-16 사용자 요청).
   *
   * 🔴 **묶음이 아닌 까닭**: 사용자가 「알림을 누르면 해당 부품 상세가 뜨도록」을 함께 요청했다.
   * 한 줄로 묶으면 어느 부품인지 가릴 수 없어 그 요청을 지킬 수 없다. 대신 줄이 넘치지 않게
   * **상한**(아래 `MAX_LOW_STOCK_ITEMS`)을 두고 나머지는 한 줄로 묶어 목록으로 보낸다.
   *
   * 🔴 **코드에 부등호를 담지 않는다.** 처음에 `PART_STOCK_BELOW_LIMIT` 로 적었다가 같은 날
   * 규칙이 「미만」에서 **「이하」**로 바뀌어(2026-10-16 사용자 결정) 코드만 거짓말이 될 뻔했다.
   * 코드는 **무슨 알림인가**(재고가 모자라다)만 말하고, 가르는 셈은 `isLowStock` 한 곳에 둔다.
   * 🔵 바꿔도 안전했던 까닭: 이 값을 **저장하는 표가 없다**(읽음 표도, 설정 표도 없다 — 포털
   * 설정은 읽기 전용이고 @dss/ui 는 이 글자를 해시해 색 칸만 고른다. 목록이 아니다).
   */
  lowStock: "PART_STOCK_LOW",
} as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

/** 사람이 읽는 종류 이름. 🔴 색과 **함께 글자로도** 그려진다. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  [NOTIFICATION_KINDS.pending]: "확인 대기",
  [NOTIFICATION_KINDS.rejected]: "반려",
  [NOTIFICATION_KINDS.issueApprovalToDecide]: "결재 차례",
  [NOTIFICATION_KINDS.issueApprovalDecided]: "결재 결과",
  [NOTIFICATION_KINDS.lowStock]: "재고 부족",
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

/**
 * 「재고 부족」 줄 id 의 앞머리. 🔴 뒤에 붙는 것은 **부품 No.** 다(uuid 가 아니다) — 그 줄이 가리키는
 * 주소(`/?part=No.`)와 **같은 열쇠**여야 한다. No. 는 재매김이 없어(`parts.ts` 머리말) 열쇠로 안전하다.
 */
export const LOW_STOCK_ID_PREFIX = "PART_LOW_STOCK";

/**
 * 「그 밖에 N종 더」 줄의 id. 🔴 **고정값이다** — 여러 부품을 한 줄로 묶은 줄이라 열쇠도 하나다.
 */
export const LOW_STOCK_MORE_NOTIFICATION_ID = "PARTS_LOW_STOCK_MORE";

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
 * 「재고 부족」을 **부품마다 한 줄로** 실어 보내는 상한 (2026-10-16).
 *
 * ── 🔴 왜 상한이 있어야 하나 ────────────────────────────────────────────
 * 다른 네 알림과 성질이 다르다. 반려·결재는 **사건**이라 사람이 처리하면 사라지지만, 재고
 * 부족은 **상태**라 부품을 채워 넣기 전까지 계속 서 있다. 부품이 300종이 넘으므로 관리자가
 * 한계수량을 널리 정해 두면 종이 이 줄로만 가득 찰 수 있다.
 *
 * ── 🔴 그래도 묶음 한 줄로 두지 않는다 ──────────────────────────────────
 * 사용자가 「알림을 누르면 **해당 부품 상세**가 뜨도록」을 함께 요청했다. 전부 묶으면 그 요청을
 * 지킬 수 없다. 그래서 **급한 것부터 10종은 줄마다 하나씩**(눌러서 바로 그 부품으로) 두고,
 * 넘치는 것은 **「그 밖에 N종 더」 한 줄**로 묶어 **목록**으로 보낸다(아래 LOW_STOCK_LIST_PATH).
 *
 * 10인 까닭: 종의 목록은 `min(60vh, 420px)` 안에서 굴러가므로(@dss/ui 의 notification-bell.css)
 * 한 번에 눈에 들어오는 줄이 예닐곱이다. 10줄이면 굴려서 끝까지 볼 수 있고, 다른 알림(결재
 * 차례·반려·결재 결과)이 이 줄들에 밀려 안 보이는 일도 생기지 않는다.
 * 🔵 @dss/ui 는 줄 수를 **스스로 자르지 않는다**(굴림 막대로 받는다). 자르는 자리는 여기와
 * 포털의 200(위 NOTIFICATION_MAX_ITEMS)뿐이다.
 */
export const MAX_LOW_STOCK_ITEMS = 10;

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
 * 「재고 부족」 줄이 가는 곳 — **재고 현황 목록의 부품 상세 창**(`/?part=No.`) (2026-10-16).
 *
 * 🔴 **그 길이 실제로 상세 창을 연다.** 넘겨짚지 않고 읽고 적는다:
 *    `src/app/(app)/page.tsx` 가 `searchParams.part` 를 숫자로 읽어 그 부품의 이력까지 함께 내려주고,
 *    `PartsList` → `PartDetailDialog` 이 그 값으로 `showModal()` 한다. 이 저장소가 이미 쓰는 길이다
 *    (`PartForm.tsx` 의 「보기」 · 저장 뒤 `redirect(\`/?part=${no}\`)`).
 * 🔴 **문은 `requireSession` 이다 — 역할로 막지 않는다**(`(app)/layout.tsx` 한 곳에서 본다. 이 화면에는
 *    `requireRole` 이 없다). 그래서 「눌러도 못 여는 줄」이 되지 않는다. 다만 이 알림을 **받는 사람**은
 *    아래 `receivesLowStockNotification` 이 ADMIN 으로 좁힌다 — 자격이 아니라 **할 일**로 가른 것이다.
 * 🔵 묶음 줄(「그 밖에 N종 더」)은 **목록**으로 간다. 🔴 그 줄은 어느 부품인지 가리지 못하므로 상세
 *    창으로 보낼 수 없다. `sort=quantity` 는 목록이 이미 쓰는 주소 규칙이라(`parts/list-state.ts` 의
 *    `parseListState`) 수량이 적은 부품이 맨 위에 선다 — 새 화면도 새 주소 규칙도 만들지 않았다.
 */
function lowStockPartPath(no: number): string {
  return `/?part=${no}`;
}
const LOW_STOCK_LIST_PATH = "/?sort=quantity";

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

/**
 * 「재고가 한계수량 이하다」를 받는 사람 — **재고 담당(ADMIN)뿐**이다 (2026-10-16).
 *
 * 🔴 **「반출 확인 대기」와 같은 사람들을 고른 까닭**: 이 줄이 바라는 행동이 **재고를 채우는 일**인데,
 * 그 일을 하는 사람이 재고 담당(ADMIN)이다. 입고를 적는 것도, 수량을 조정하는 것도, 반출을 확인해
 * 내주는 것도 같은 사람이다. 기록(STAFF)에게 보내면 **자기가 할 수 없는 일**이 종에 쌓이고,
 * 보기(VIEWER)에게는 더더욱 그렇다 — 줄은 「누가 처리할 수 있는가」로 가른다.
 *
 * 🔴 **`receivesPendingNotification` 을 그대로 부르지 않는다.** 답이 오늘 같을 뿐 **다른 물음**이다 —
 * 저쪽은 「누가 신청을 확인하는가」, 이쪽은 「누가 재고를 채우는가」. 한쪽이 바뀌는 날 다른 쪽까지
 * 조용히 끌려가면 안 된다(불출 결재 둘이 똑같이 `true` 를 돌려주면서도 함수를 둘로 둔 것과 같은 까닭).
 *
 * 🔵 이 판정은 **자격이 아니라 할 일**로 가른 것이다. 그 줄이 가리키는 `/?part=No.` 는 문이
 * `requireSession` 이라 누구나 열 수 있다 — 「눌러도 못 여는 줄」 걱정은 여기에 없다.
 */
export function receivesLowStockNotification(role: Role): boolean {
  return role === "ADMIN";
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
 *
 * ── 🔴 `EXECUTION_REJECTED` 가 **셋째로 들어왔다** (2026-10-21) ─────────
 * 실행 대기에서 담당자가 막은 건이다. **넣지 않으면 그 건은 「실행할 건」 목록에서 사라지기만
 * 하고 올린 사람은 아무 소식도 받지 못한다** — 오류가 아니라 **침묵**이라 아무도 신고하지
 * 않는다. 🔵 `REJECTED` 와 같은 7일 선을 쓴다(아래 조립): 둘 다 「막혔다」이고 사람이 다음에 할
 * 일이 같다(새로 신청한다). 🔴 다만 **결정 시각이 적힌 곳이 다르다** — `REJECTED` 는 단계 줄의
 * `decided_at`, 이쪽은 결재건의 `execution_rejected_at` 이다(질의가 둘을 합쳐 싣는다).
 */
export const DECIDED_ISSUE_APPROVAL_STATUSES = ["APPROVED", "REJECTED", "EXECUTION_REJECTED"] as const satisfies readonly PartIssueStatus[];

export type DecidedIssueApprovalStatus = (typeof DECIDED_ISSUE_APPROVAL_STATUSES)[number];

/** 알림으로 만들 「결정된 내 결재건」 한 줄. 종에 필요한 칸만 받는다. */
export type DecidedIssueApprovalSource = {
  /** `stock_issue_approvals.id`. 알림 id 가 이 값에서 나온다. */
  id: string;
  /** 🔴 **셋뿐이다** — 까닭은 바로 위 `DECIDED_ISSUE_APPROVAL_STATUSES`. */
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
  /**
   * 막은 사람의 이름. 🔴 **승인 줄에서는 null 이다** — 승인에는 한마디를 받지 않는다.
   * 🔵 `REJECTED` 면 반려한 **결재자**, `EXECUTION_REJECTED` 면 막은 **담당자**다. 종에서는 둘 다
   *    「○○○ 반려」로 읽히면 되고, 무엇이 달랐는지는 **줄의 제목**이 말한다(아래 조립 ③).
   */
  decidedByName: string | null;
  /**
   * 막힌 시각. 🔴 **승인 줄에서는 null 이다.**
   * 🔴 상태마다 **적힌 표가 다르다** — `REJECTED` 는 `stock_issue_approval_steps.decided_at`,
   *    `EXECUTION_REJECTED` 는 `stock_issue_approvals.execution_rejected_at` 이다. 질의가 둘을
   *    합쳐 이 한 칸으로 싣는다(`listDecidedPartIssueApprovalsFor`) — 조립은 **7일 선을 그을 때만**
   *    쓰므로 어느 표에서 왔는지를 알 필요가 없다.
   */
  decidedAt: Date | null;
};

/**
 * 알림으로 만들 「재고가 한계수량에 걸린 부품」 한 줄 (2026-10-16). 종에 필요한 칸만 받는다.
 *
 * 🔴 **고르는 일은 여기서 하지 않는다.** 「재고 ≤ 한계수량」도, 「한계수량이 null 이면 빼기」도,
 * 「지워진 부품은 빼기」도 **질의가 WHERE 로** 끝낸 뒤에 오는 줄이다(`parts/queries.ts` 의
 * `listLowStockParts`). 그래서 `limitQuantity` 가 `number`(널 아님)인 것이 이 타입의 약속이다.
 * 🔵 조립은 그래도 한 번 더 거른다(아래 ④) — 반려 줄이 7일 선을 두 번 보는 것과 같은 결이고,
 * **두 자리가 같은 부등호를 쓰므로** 갈라질 수 없다.
 */
export type LowStockPartSource = {
  /** 부품 No. 🔴 알림 id 와 주소(`/?part=No.`)가 **이 값 하나**에서 나온다. */
  no: number;
  name: string;
  /** 없으면 빈 문자열(`parts` 표의 관례). 있으면 줄에 함께 적는다 — 품명만 같은 부품이 실제로 여럿 있다. */
  name2: string;
  /** 🔴 **재고 현황 목록이 보여 주는 그 수**다(`stock_balances.quantity`, 줄이 없으면 0). */
  quantity: number;
  /** 🔴 `null` 이 아니다 — 질의가 걸렀다. */
  limitQuantity: number;
};

/** 부품 No. → 이 시스템 안에서의 알림 id. 🔴 같은 부품에는 **언제나 같은 값**이 나온다. */
export function lowStockNotificationId(partNo: number): string {
  return `${LOW_STOCK_ID_PREFIX}:${partNo}`;
}

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
 * **할 일이 위, 결과가 아래**다. ⓪ 결재 차례 → ① 확인 대기 → ④ 재고 부족 → ③ 결재 결과 → ② 반출 신청 반려.
 * ⓪ 가 맨 위인 까닭: 그 줄만이 **남이 나를 기다리고 있는** 일이다(결재가 안 나면 부품이 안
 * 나간다). ④ 는 할 일 묶음의 **끝**이다 — 사람을 기다리게 하는 일이 아니라 미리 챙기는 일이다.
 * 줄 안의 차례는 질의가 정한 그대로 쓴다 — 두 곳에서 각자 정렬하면 언젠가 갈린다.
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
  /**
   * 재고가 한계수량 이하인 부품 — **이미 상한(`MAX_LOW_STOCK_ITEMS`)에서 잘린** 줄,
   * 모자란 만큼 큰 순서(질의가 정한 차례 그대로).
   */
  lowStockParts: readonly LowStockPartSource[];
  /** 🔴 자르기 전의 **종수**. 안 넘기면 받은 줄 수로 본다. 「그 밖에 N종 더」가 이 값에서 나온다. */
  lowStockPartsTotal?: number;
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
  const lowStockListHref = `${baseUrl}${LOW_STOCK_LIST_PATH}`;
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

  // ④ 담당자(ADMIN)에게 — 「재고가 한계수량 이하입니다」. **부품마다 한 줄**이다 (2026-10-16).
  //    🔴 묶지 않는 까닭: 사용자가 「알림을 누르면 **해당 부품 상세**가 뜨도록」을 함께 요청했다.
  //       묶으면 어느 부품인지 가릴 수 없어 그 요청을 지킬 수 없다.
  //    🔴 그래서 **상한**(MAX_LOW_STOCK_ITEMS)을 두고 넘치면 「그 밖에 N종 더」 한 줄로 묶어
  //       **목록**으로 보낸다. 재고 부족은 사건이 아니라 **상태**라 채워 넣기 전까지 계속 서 있는데,
  //       부품이 300종이 넘어 상한이 없으면 종이 이 줄로만 가득 찬다(그 상수의 주석).
  //    🔴 **역할도 본다** — 재고를 채우는 사람(ADMIN)에게만 간다. 판정은
  //       `receivesLowStockNotification` 한 곳에서만 온다.
  const showLowStock = receivesLowStockNotification(input.role);
  let lowStockShown = 0;
  let lowStockMoreShown = false;
  if (showLowStock) {
    for (const row of input.lowStockParts) {
      // 🔴 질의가 이미 걸렀지만 여기서 한 번 더 본다(②·③과 같은 모양). **같을 때도 알린다** —
      //    둘이 `isLowStock` 하나를 보므로 규칙이 갈라질 수 없다.
      if (!isLowStock(row.quantity, row.limitQuantity)) continue;
      lowStockShown += 1;
      push(
        lowStockNotificationId(row.no),
        NOTIFICATION_KINDS.lowStock,
        "재고가 한계수량 이하입니다",
        // 🔴 **어느 부품인지와 두 숫자만** 싣는다. 눌러서 열리는 상세 창이 나머지를 다 말해 준다.
        joinDetail([`No. ${row.no} ${row.name}`.trim(), row.name2, `재고 ${row.quantity}개 · 한계수량 ${row.limitQuantity}개`]),
        // 🔴 **이 줄만이 부품마다 다른 주소**를 쓴다 — 그래야 눌러서 그 부품 상세가 열린다.
        `${baseUrl}${lowStockPartPath(row.no)}`,
      );
    }
    // 🔵 넘친 종은 **한 줄로 묶어 목록으로** 보낸다. 🔴 상세 창으로 보낼 수 없는 줄이다(어느
    //    부품인지 가리지 못한다). 수량이 적은 순으로 선 목록이 열린다.
    const lowStockTotal = input.lowStockPartsTotal ?? input.lowStockParts.length;
    const rest = lowStockTotal - lowStockShown;
    if (lowStockShown > 0 && rest > 0) {
      push(LOW_STOCK_MORE_NOTIFICATION_ID, NOTIFICATION_KINDS.lowStock, `한계수량 이하인 부품이 ${rest}종 더 있습니다`, "재고 현황 목록에서 봅니다", lowStockListHref);
      lowStockMoreShown = true;
    }
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
      /**
       * 🔵 **막힌 둘(`REJECTED`·`EXECUTION_REJECTED`)은 같은 7일 선을 쓴다** (2026-10-21) — 둘 다
       *    「막혔다」이고 사람이 다음에 할 일이 같다(새로 신청한다). 선을 긋는 함수도 ②와 **같은
       *    하나**라 세 자리가 갈라질 수 없다.
       */
      const visible = row.status === "APPROVED" ? true : isRejectionVisible(row.decidedAt, input.now);
      if (!visible) continue;
      decidedShown += 1;
      push(
        issueApprovalDecidedNotificationId(row.id),
        NOTIFICATION_KINDS.issueApprovalDecided,
        /**
         * 🔴 **셋이 서로 다른 말이어야 한다.** 같은 종류라 색이 같으므로 **글자가 유일한 구분**이다
         *    (`NOTIFICATION_KINDS.issueApprovalDecided` 주석). 「반려되었습니다」와 「실행 대기에서
         *    반려되었습니다」를 뭉개면, 결재 도중 막힌 것과 결재를 다 받고도 막힌 것이 한 말이 된다 —
         *    올린 사람이 **결재선을 다시 밟아야 하는지**를 그 한 줄로 가늠하는데 그 단서가 사라진다.
         */
        row.status === "APPROVED"
          ? "불출 결재가 승인되었습니다"
          : row.status === "REJECTED"
            ? "불출 결재가 반려되었습니다"
            : "불출 결재가 실행 대기에서 반려되었습니다",
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

  // ④ 재고 부족은 **그린 줄을 그대로 센다** — 넘친 종을 「그 밖에 N종 더」 한 줄로 **보여 주므로**
  //    배지와 펼친 목록이 어긋날 자리가 없다. 🔴 ②·③처럼 「잘린 총계」를 쓰지 않는 까닭이 그것이다:
  //    저쪽은 넘친 줄을 **말없이 버리므로** 총계를 써야 참말이 되고, 이쪽은 버리지 않는다.
  const lowStockCount = lowStockShown + (lowStockMoreShown ? 1 : 0);

  return {
    items: items.slice(0, NOTIFICATION_MAX_ITEMS),
    // 🔵 묶음 줄(⓪ · ① · ④의 「그 밖에 N종 더」)은 **1** 로 센다 — 펼치면 한 줄이기 때문이다(위 count 주석).
    count: (showToDecide ? 1 : 0) + (showPending ? 1 : 0) + lowStockCount + decidedCount + rejectedCount,
  };
}
