import type { NotificationBellItem } from "@dss/ui";
import type { Role } from "@/db/schema/users";
import { roleAtLeast } from "@/lib/auth/role";
import { todaySeoul as seoulDate } from "@/lib/stock/codes";

/**
 * ============================================================================
 * 이 시스템의 **자체 알림** — 「반출 확인 대기」와 「내 신청이 반려됨」
 * ============================================================================
 * 머리말의 알림 종(@dss/ui 의 NotificationBell)이 받는 아홉 칸을 만든다.
 * 이 파일은 **순수 계산만** 한다 — DB 도 React 도 세션도 환경변수도 모른다.
 * 재료(대기 건수 · 반려된 신청 줄 · 이 시스템의 주소 · client_id)는 부르는 쪽이
 * 날라다 준다(notifications/queries.ts).
 *
 * ── 🔴 스키마를 건드리지 않는다 ─────────────────────────────────────────
 * 새 표도 마이그레이션도 없다. 「읽음」 표를 만들지 않는다. 두 가지 알림이 모두
 * **이미 있는 `stock_requests` 의 상태와 시각만으로** 풀리기 때문이다:
 *
 *  | 누구에게        | 무엇                   | 언제 사라지나                        |
 *  |-----------------|------------------------|--------------------------------------|
 *  | ADMIN(재고 담당)| 「반출 확인 대기 N건」 | 확인·반려하면 상태가 바뀌어 저절로   |
 *  | 신청한 본인     | 「반출 신청이 반려됨」 | **결정된 지 7일**이 지나면 저절로    |
 *
 * 🔵 **확인된(CONFIRMED) 신청은 알리지 않는다**(2026-10-13 사용자 결정). 수량이
 * 바뀌어 화면에서 바로 보인다. 취소(CANCELLED)도 알리지 않는다 — 본인이 거둔 것이다.
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
} as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

/** 사람이 읽는 종류 이름. 🔴 색과 **함께 글자로도** 그려진다. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  [NOTIFICATION_KINDS.pending]: "확인 대기",
  [NOTIFICATION_KINDS.rejected]: "반려",
};

/**
 * 「대기」 알림의 id. 🔴 **고정값이다** — 여러 신청을 한 줄로 묶은 알림이라 그 줄을
 * 가리키는 열쇠도 하나다. 건수가 바뀌어도 같은 줄이어야 종이 줄을 다시 그리지 않는다.
 */
export const PENDING_NOTIFICATION_ID = "REQUESTS_PENDING";

/** 「반려」 알림 id 의 앞머리. 나중에 종류가 늘어도 열쇠끼리 부딪히지 않게 한다. */
export const REJECTED_ID_PREFIX = "REQUEST_REJECTED";

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

/** 종이 받는 한 뭉치 — 그릴 줄과 배지에 찍을 수. */
export type InventoryNotificationFeed = {
  items: NotificationBellItem[];
  /**
   * 배지에 찍을 수. 🔴 **줄 수를 다시 세지 않는다**(@dss/ui README 7절) — 아래
   * buildInventoryNotificationItems 가 자르기 전의 진짜 개수로 계산해 넘긴다.
   *
   * 🔵 「대기 N건」은 **1** 로 센다. 종을 펼치면 한 줄이기 때문이다 — 배지가 5 인데
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
 * 「확인 대기」가 맨 위(담당자가 **지금 해야 할 일**이다), 그다음 반려가 최근 것부터.
 * 반려 줄의 차례는 질의가 정한 그대로 쓴다 — 두 곳에서 각자 정렬하면 언젠가 갈린다.
 *
 * ── 🔴 아홉 칸이 전부 채워진다 ──────────────────────────────────────────
 * @dss/ui 의 NotificationBellItem 은 아홉 칸이 모두 필수 string 이고, **없는 값은
 * null 이 아니라 빈 문자열**이다(그쪽 types.ts).
 */
export function buildInventoryNotificationItems(input: {
  /** 보는 사람의 역할. 🔴 「확인 대기」는 ADMIN 에게만, 「반려」는 기록 권한(STAFF) 이상에게만 간다(위 receives*). */
  role: Role;
  pending: PendingSummary;
  /** 이미 상한(NOTIFICATION_MAX_ITEMS)에서 잘린 반려 줄. */
  rejected: readonly RejectedRequestSource[];
  /** 🔴 자르기 전의 반려 건수. 안 넘기면 받은 줄 수로 본다. */
  rejectedTotal?: number;
  /** 기준 시각. 7일 선을 여기서 긋는다. */
  now: Date;
  /** 이 시스템의 주소 앞머리. 🔴 절대 주소여야 한다. */
  baseUrl: string;
  /** 이 시스템의 client_id(`dss-inventory`). */
  sourceId: string;
}): InventoryNotificationFeed {
  const baseUrl = requireAbsoluteBaseUrl(input.baseUrl);
  const href = `${baseUrl}${REQUESTS_PATH}`;
  const items: NotificationBellItem[] = [];
  const seen = new Set<string>();

  const push = (id: string, kind: NotificationKind, subject: string, detail: string): void => {
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
    );
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

  return {
    items: items.slice(0, NOTIFICATION_MAX_ITEMS),
    count: (showPending ? 1 : 0) + rejectedCount,
  };
}
