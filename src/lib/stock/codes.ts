import { CHARGE_TYPES, ENTRY_TYPES, PURPOSES, type ChargeType, type EntryType, type Purpose, type Sheet } from "@/db/schema/stock";
import type { RequestSource, RequestStatus } from "@/db/schema/stock-requests";

/**
 * 수량 변경 기록의 코드값 → 화면 글자 (DESIGN 4-1절). 저장은 영문, 화면은 한글. 화면 전체가 이 표 하나를 쓴다.
 */
export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  RECEIVE: "입고",
  USE: "사용",
  RETURN: "반환",
  DISPOSE: "폐기·불량",
  ADJUST: "조정",
  TRANSFER: "소유 옮김",
  LOAN: "대여",
  OPENING: "처음 수량",
  CORRECTION: "기록 취소",
};

/** 기록 화면에서 사람이 고르는 일곱 가지 (DESIGN 2-4절). 처음 수량·기록 취소는 따로. */
export const RECORDABLE_TYPES = ["USE", "RECEIVE", "RETURN", "DISPOSE", "ADJUST", "TRANSFER", "LOAN"] as const satisfies readonly EntryType[];
export type RecordableType = (typeof RECORDABLE_TYPES)[number];

/**
 * 담당자 확인을 거치는 종류 — 반출 계열 (2026-10-06 사용자 결정: 「신청 → 담당자 확인 → 반출」).
 * 입고·반환은 담당자가 하는 일이라 지금도 바로 원장에 쓰인다.
 *
 * 🔴 **2026-10-15 사용자 결정으로 바뀜: 누가 적든 반출은 요청으로 올라간다. 관리자도 예외가 아니다.**
 *    옛 규칙(2026-10-06)은 「기록 권한자가 적으면 확인 대기로, **관리자가 적으면 바로 원장에**」였다 —
 *    까닭은 「관리자가 직접 적으면 신청과 확인이 한 번이다」였다. 그런데 그러면 관리자가 「수량 변경 기록」에
 *    반출을 적을 때 **신청이 아예 만들어지지 않아** 부품 요청 관리(`/requests`)에 한 줄도 안 떴다
 *    (2026-10-15 실측 — 쓰는 분이 적었는데 그 화면에 없었다). 이제 역할을 보지 않는다.
 * 🔴 그래서 **매개변수가 하나다.** 역할을 넘기던 자리를 지워 두면 tsc 가 부르는 자리를 전부 잡아 준다.
 * 🔵 **관리자가 낸 요청은 본인이 확인하게 된다.** 지금 코드가 그걸 이미 감당한다 — `confirmRequest` 는
 *    신청한 사람을 원장의 `created_by`, 확인한 사람을 `confirmed_by` 로 적으므로 **같은 사람이어도 괜찮다**
 *    (`src/lib/stock/requests.ts`). 확인을 누르기 전까지 수량이 빠지지 않는 것이 이 결정의 핵심이다.
 * 🔵 **「누가 적을 수 있나」와는 다른 물음이다** — 그쪽은 아래 `ADMIN_ONLY_TYPES` 이고 이번에 손대지 않았다.
 */
export const CONFIRMATION_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(["USE", "LOAN", "DISPOSE"]);
export function needsConfirmation(type: EntryType): boolean {
  return CONFIRMATION_TYPES.has(type);
}

/** 관리자만 적을 수 있는 종류 (DESIGN 3절: 조정·소유 옮김·기록 취소) */
export const ADMIN_ONLY_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(["ADJUST", "TRANSFER", "CORRECTION", "OPENING"]);

/**
 * 반출 신청을 **세는 쪽**이 쓰는 두 묶음 (2026-10-14, 조각 4c. 설계 `docs/부품요청_이관_설계_2026-10-14.md` 5절).
 *
 * 🔵 **`PARTIAL`(일부만 나갔고 아직 남음)은 대기다.** 아직 줄 것이 남아 담당자가 계속 봐야 하기 때문이다
 *    (`src/db/schema/stock-requests.ts` 의 `REQUEST_STATUSES` 주석). 끝난 것으로 세면 대기 목록·머리말 배지·
 *    알림 종 어디에도 안 걸려 **화면에서 사라지고**, 그러면 그 신청을 다시 집을 수 없다.
 * 🔵 **`ON_HOLD`(담당자가 사유를 적어 멈춰 둠)도 대기다** (2026-10-15, 조각 10a). `PARTIAL` 과 **같은 논리**다 —
 *    보류는 「그만둔 것」이 아니라 「나중에 다시 볼 것」이라, 목록에서 사라지면 다시 집을 길이 없어 잊힌다.
 *    🔴 다만 **재촉하는 숫자**(머리말 배지·알림 종)에서는 뺀다 — 아래 `ACTIONABLE_REQUEST_STATUSES`.
 * 🔴 두 묶음이 `REQUEST_STATUSES` 를 **빠짐없이, 겹치지 않게** 덮는다. 상태를 더하고 여기를 안 고치면 그 상태의
 *    신청이 어느 목록에도 안 걸린다 — 원장은 안 깨지므로 아무 오류 없이 조용히 사라진다. 그 덮기는
 *    `tests/stock-requests.test.ts` 가 지킨다.
 * 🔵 서버 전용이 아닌 이 파일에 둔다 — 세는 질의(`src/lib/stock/requests.ts`, server-only)와 시험이 **같은 한 벌**을 본다.
 *    「대기」를 가르는 글자가 적힌 곳은 여기 하나뿐이어야 머리말 배지와 알림 종이 어긋나지 않는다.
 */
export const PENDING_REQUEST_STATUSES = ["PENDING", "CONFIRMING", "PARTIAL", "ON_HOLD"] as const satisfies readonly RequestStatus[];

/** 더 볼 일이 없는 것 — 신청한 사람에게 결과로만 보인다. 🔴 `PARTIAL`·`ON_HOLD` 는 여기 **없다**(위 주석). */
export const DECIDED_REQUEST_STATUSES = ["CONFIRMED", "REJECTED", "CANCELLED"] as const satisfies readonly RequestStatus[];

/**
 * 지금 **담당자가 손댈 수 있는** 신청 — 머리말 「대기 N」 배지와 알림 종이 세는 묶음 (2026-10-15, 조각 10a).
 *
 * 🔴 **세는 묶음(`PENDING_REQUEST_STATUSES`)에서 보류(`ON_HOLD`)만 뺀 것이다.** 담당자가 사유를 적어
 *    **일부러 멈춰 둔** 것을 「대기 N」으로 세면 매일 재촉하는 숫자가 되어, 보류를 걸어 둔 뜻이 사라진다.
 *    대기 **목록**에는 그대로 보인다(위 주석) — 안 보이면 잊히기 때문이다. 「목록에 보인다」와
 *    「숫자로 재촉한다」는 뜻이 다르다. 그래서 묶음을 또 하나 둔다.
 * 🔴 **배지(`countPendingRequests`)와 종(`summarizePendingRequests`)이 반드시 이 한 묶음을 같이 본다.**
 *    둘이 갈리면 「배지에는 있는데 종에는 없는」 신청이 생긴다(`src/lib/stock/requests.ts` 의 두 함수 주석).
 */
export const ACTIONABLE_REQUEST_STATUSES = ["PENDING", "CONFIRMING", "PARTIAL"] as const satisfies readonly RequestStatus[];

/**
 * 담당자가 **집을 수 있는** 상태 — 아직 아무것도 안 나간 것(PENDING)과 일부만 나간 것(PARTIAL) (2026-10-14, 조각 4d).
 *
 * 🔴 **세는 묶음(`PENDING_REQUEST_STATUSES`)과 다른 것이다.** 거기엔 `CONFIRMING`(다른 담당자가 **지금** 집고 있는 것)이
 *    들어 있는데, 그 신청에 [확인] 단추를 그리면 눌러도 집기에서 거절당한다. 「대기로 센다」와 「지금 집을 수 있다」는
 *    뜻이 다르다 — 그래서 묶음을 둘로 둔다.
 * 🔴 **화면과 서버가 이 한 벌을 같이 본다**(`src/lib/stock/requests.ts` 의 `claimRequest`,
 *    `src/app/(app)/entries/page.tsx` 의 단추 그리기). 조각 4c 까지는 화면이 `status === "PENDING"` 만 보고 그려서
 *    일부 나간 신청이 대기 목록에 **보이는데 누를 수 없었다** — 「보이는데 못 누르는 줄」이 생기는 자리다.
 */
export const CLAIMABLE_REQUEST_STATUSES = ["PENDING", "PARTIAL"] as const satisfies readonly RequestStatus[];
export type ClaimableRequestStatus = (typeof CLAIMABLE_REQUEST_STATUSES)[number];

/** 🔵 좁히는 검사다 — 화면이 단추 묶음에 넘기는 상태가 **둘 중 하나임을 타입이 보증**한다(그래서 거기서 「반려냐 마감이냐」를 가를 수 있다). */
export function isClaimableRequest(status: RequestStatus): status is ClaimableRequestStatus {
  return (CLAIMABLE_REQUEST_STATUSES as readonly RequestStatus[]).includes(status);
}

/**
 * 신청이 **어디서 올라왔나** → 화면 글자 (2026-10-15, A/S 반출 신청 통로).
 *
 * 🔴 `Record` 로 둔 까닭은 위 `REQUEST_STATUS_LABEL` 과 같다 — 출처를 하나 더하고 여기를 안 고치면 **tsc 가 멈춘다.**
 * 🔵 재고 관리에서 직접 올린 것은 **글자를 비운다**(`""`). 거의 전부가 그것이라, 줄마다 「재고 관리」가 붙으면
 *    눈에 띄어야 할 「A/S」가 묻힌다. 표식은 **다른 데서 온 것에만** 붙인다.
 */
export const REQUEST_SOURCE_LABEL: Record<RequestSource, string> = {
  INVENTORY: "",
  AS: "A/S",
};

/**
 * 신청한 사람이 **거둘 수 있는 출처** — 재고 관리에서 직접 올린 것뿐이다 (2026-10-15).
 *
 * 🔴 **A/S 에서 올라온 신청은 재고 관리에서 취소되지 않는다.** 저쪽에 「이 부품 내 달라」가 열린 채 남아 있는데
 *    이쪽에서 접으면, A/S 는 영영 답을 못 받고 사람은 기다린다. 거두는 것은 **낸 쪽(A/S)의 몫**이다.
 * 🔴 **화면과 서버가 이 한 벌을 같이 본다** — 아래 `canCancelRequest`(화면이 단추를 그릴지)와
 *    `src/lib/stock/requests.ts` 의 `cancelRequest`(실제로 막는 WHERE). 손으로 두 벌 적으면 언젠가 갈린다.
 */
export const CANCELLABLE_REQUEST_SOURCES = ["INVENTORY"] as const satisfies readonly RequestSource[];

/**
 * **바깥 통로로** 거둘 수 있는 출처 — A/S 에서 올라온 것뿐이다
 * (2026-10-16, `POST /api/v1/stock-requests/cancel`. API.md 4-9절).
 *
 * 🔴 **위 `CANCELLABLE_REQUEST_SOURCES` 와 짝이고, 겹치지 않는다.** 거두는 문은 하나뿐이고 **낸 쪽에만**
 *    열린다 — 화면에서 올린 것은 화면에서, A/S 가 올린 것은 A/S 에서. 한 출처가 양쪽에 들어가면 같은
 *    신청을 두 곳에서 접을 수 있게 되고, 그러면 저쪽에 열린 요청이 답을 못 받는 일이 되돌아온다.
 *    🔵 두 묶음이 **빠짐없이 덮는지**를 시험이 본다(`tests/api-stock-request-cancel.test.ts`) — 출처를
 *    하나 더하고 어느 쪽에도 안 넣으면 그 신청은 **아무도 거둘 수 없는 신청**이 된다.
 * 🔴 **화면과 서버가 아니라, 판정과 WHERE 가 이 한 벌을 같이 본다** —
 *    `src/lib/api/stock-request-cancel.ts` 의 `judgeApiCancel`(거절 문구를 고르는 자리)과
 *    `src/lib/stock/requests.ts` 의 `cancelExternalRequest`(실제로 막는 WHERE).
 */
export const EXTERNALLY_CANCELLABLE_REQUEST_SOURCES = ["AS"] as const satisfies readonly RequestSource[];

/**
 * 「내가 거둘 수 있는 신청인가」 — 출처 · 상태 · 본인 셋을 함께 본다 (2026-10-15).
 *
 * 🔵 **울타리가 아니라 단추를 그릴지의 판정이다.** 실제로 막는 자리는 `cancelRequest` 의 WHERE 이고,
 *    거기도 **같은 세 조건**을 건다. 여기를 지워도 쓰기는 안 뚫린다.
 * 🔴 `requestedBy` 가 `null` 이면(= A/S 에서 왔고 재고 관리에 없는 사람) 누구와도 같지 않다 — 지어낸 기본값을
 *    넣지 않는다. SQL 쪽도 `NULL = <내 id>` 가 참이 되지 않아 **저절로** 같은 답을 낸다.
 */
export function canCancelRequest(request: { source: RequestSource; status: RequestStatus; requestedBy: string | null }, actorUserId: string): boolean {
  if (!(CANCELLABLE_REQUEST_SOURCES as readonly RequestSource[]).includes(request.source)) return false;
  if (request.status !== "PENDING") return false;
  return request.requestedBy !== null && request.requestedBy === actorUserId;
}

/**
 * 마감된 신청인가 — 「준 것은 그대로 두고 **남은 것만** 접은」 것 (2026-10-14 사용자 결정, 조각 4d).
 *
 * 🔵 **상태를 새로 만들지 않았다.** 마감된 신청은 더 볼 일이 없으므로 기존 `CONFIRMED` 로 닫고(`DECIDED_REQUEST_STATUSES`),
 *    「다 나감」과 「마감」은 **세어서** 가린다 — 회차 표 주석 3번(「남은 수량은 세어서 안다, 요약 칸을 일부러 안 뒀다」)과
 *    같은 방식이다. 상태값을 더하면 enum 마이그레이션이 또 필요하고, 적용 전까지 단추가 깨진다.
 * 🔴 **이력에서 반려와 가르는 것은 상태가 아니라 감사 행위다** — `STOCK_REQUEST_CLOSED`(반출 마감) ≠
 *    `STOCK_REQUEST_REJECTED`(반출 반려). 반려는 「하나도 안 준다」, 마감은 「준 것은 두고 나머지만 접는다」이다.
 * 🔴 **「나간 것이 하나라도 있을 것」을 함께 본다.** 회차 표가 생기기 전(조각 4a 이전)에 확인된 신청은 회차 줄이
 *    하나도 없어 `issued` 가 전부 0 이다 — 그 조건이 없으면 **옛 신청이 전부 마감으로 보인다.**
 *    마감은 `PARTIAL` 에서만 할 수 있고 `PARTIAL` 은 한 줄이라도 나가야 되는 상태라, 이 조건이 그 둘을 가른다.
 */
export function isClosedRequest(status: RequestStatus, lines: readonly { quantity: number; issued: number }[]): boolean {
  if (status !== "CONFIRMED") return false;
  return lines.some((l) => l.issued > 0) && lines.some((l) => l.issued < l.quantity);
}

/**
 * 신청 상태 → 화면 글자 (2026-10-15, 조각 10b. 부품 요청 관리 화면).
 *
 * 🔴 **`Record` 로 둔 까닭**: 상태를 하나 더하고 여기를 안 고치면 **tsc 가 멈춘다.** 화면이 `status` 를 그대로
 *    보이던 때에는 영문 코드가 그냥 새어 나갔고(CLAUDE.md 10절: 코드값을 화면에 내지 않는다) 아무도 못 알아챘다.
 * 🔵 글자는 **기록 내역의 「확인 대기」 구역이 쓰던 것 그대로**다(「처리 중」·「일부 나감」·「반려」·「취소」).
 *    그 구역은 2026-10-15 에 걷어냈지만 글자는 옮겨 왔다 — 쓰는 분이 이미 그 말로 부르고 있어서,
 *    화면이 옮겨 갔다고 낱말까지 바꾸면 같은 것이 다른 것으로 읽힌다. 표는 **한 곳에** 둔다.
 */
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: "대기",
  CONFIRMING: "처리 중",
  PARTIAL: "일부 나감",
  CONFIRMED: "확인됨",
  REJECTED: "반려",
  CANCELLED: "취소",
  ON_HOLD: "보류",
};

/**
 * 거르개가 도는 차례 — 글자 표에서 **뽑아 쓴다**(따로 적으면 상태를 더했을 때 한쪽만 고쳐진다).
 *
 * 🔴 스키마의 `REQUEST_STATUSES` 를 쓰지 않는 까닭 둘: ① 저쪽은 enum 마이그레이션 때문에 **새 값이 맨 뒤에 붙는**
 *    차례라(PARTIAL·ON_HOLD) 사람이 읽을 차례가 아니다. ② 값으로 끌어오면 **클라이언트 묶음에 표 정의(drizzle)가
 *    딸려 온다** — 타입만 쓰면 컴파일할 때 지워진다.
 */
export const REQUEST_STATUS_ORDER: readonly RequestStatus[] = Object.keys(REQUEST_STATUS_LABEL) as RequestStatus[];

/**
 * 상태 배지 색 (2026-10-15, 조각 10b. A/S 쪽 `PartRequestManagerScreen` 의 색을 그대로 옮기고 `dark:` 만 뺐다 —
 * 이 저장소에는 다크 모드가 없다).
 *
 * 🔵 요청 관리는 **「지금 손댈 것이 무엇인가」를 훑는 화면**이라, 처리 대기 중인 것과 이미 끝난 것이 한눈에 갈려야 한다.
 * 🔴 **보류를 대기와 다른 색으로 둔다**(보라 ↔ 주황). 「멈춰 있다」가 한눈에 보여야 하기 때문이다 — 같은 주황이면
 *    지금 처리해야 할 것으로 착각하고 눌러 보게 되는데, 보류 중에는 확인도 반려도 마감도 막혀 있다(requests.ts).
 * 🔵 글자 표와 마찬가지로 **이 표를 보는 자리는 한 곳**이다(부품 요청 관리) — 2026-10-15 에 기록 내역의
 *    「확인 대기」 구역을 걷어내면서 그렇게 됐다. 그래도 색을 화면 파일에 흩지 않는다: 글자와 색은 짝이고,
 *    짝이 갈리면 「마감인데 초록」 같은 줄이 생긴다(아래 `requestStatusBadge`).
 */
export const REQUEST_STATUS_BADGE: Record<RequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMING: "bg-zinc-200 text-zinc-700",
  PARTIAL: "bg-blue-100 text-blue-800",
  CONFIRMED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-zinc-100 text-zinc-500",
  ON_HOLD: "bg-violet-100 text-violet-800",
};

/**
 * 마감된 신청의 글자와 색.
 *
 * 🔴 **마감은 상태값이 아니다** — 상태는 `CONFIRMED` 이고, 가르는 자리는 위 `isClosedRequest` 하나뿐이다(그 주석).
 *    그래서 표에 여덟 번째 칸을 만들지 않고 따로 둔다. 상태를 새로 만들면 enum 마이그레이션이 또 필요하다.
 * 🔵 색은 기록 내역 화면이 쓰던 마감 배지 그대로다(2026-10-14, 조각 4d).
 */
export const CLOSED_REQUEST_LABEL = "마감";
export const CLOSED_REQUEST_BADGE = "bg-amber-100 text-amber-900";

/** 화면에 보일 글자 — 마감된 신청은 「확인됨」이 아니라 「마감」이다. `closed` 는 `isClosedRequest` 가 센 값이다. */
export function requestStatusLabel(status: RequestStatus, closed: boolean): string {
  return closed ? CLOSED_REQUEST_LABEL : REQUEST_STATUS_LABEL[status];
}

/** 위와 짝이 되는 배지 색. 글자와 색을 따로 고르면 「마감인데 초록」 같은 짝이 생긴다. */
export function requestStatusBadge(status: RequestStatus, closed: boolean): string {
  return closed ? CLOSED_REQUEST_BADGE : REQUEST_STATUS_BADGE[status];
}

export const PURPOSE_LABEL: Record<Purpose, string> = {
  REPAIR: "수리",
  FIELD: "필드",
  OTHER: "기타",
};

export const CHARGE_LABEL: Record<ChargeType, string> = {
  PAID: "유상",
  FREE: "무상",
};

export const SHEET_LABEL: Record<Sheet, string> = {
  USE: "사용처 기입란",
  RECEIVE: "입고 기입란",
  CHANGE: "수량 변경 기록",
};

/** 종류 → 엑셀 시트. 사용은 사용처 기입란, 입고는 입고 기입란, 나머지는 새 시트 「수량 변경 기록」 (DESIGN 6-2절). */
export function sheetOf(type: EntryType): Sheet {
  if (type === "USE") return "USE";
  if (type === "RECEIVE") return "RECEIVE";
  return "CHANGE";
}

/** 그 종류에서 수량이 늘어나나(+) 줄어드나(−). ADJUST·CORRECTION 은 어느 쪽이든. TRANSFER 는 두 줄(−, +). */
export function signOf(type: EntryType): 1 | -1 | 0 {
  switch (type) {
    case "RECEIVE":
    case "RETURN":
    case "OPENING":
      return 1;
    case "USE":
    case "DISPOSE":
    case "LOAN":
      return -1;
    default:
      return 0;
  }
}

export function isEntryType(v: unknown): v is EntryType {
  return typeof v === "string" && (ENTRY_TYPES as readonly string[]).includes(v);
}
export function isRecordableType(v: unknown): v is RecordableType {
  return typeof v === "string" && (RECORDABLE_TYPES as readonly string[]).includes(v);
}
export function isPurpose(v: unknown): v is Purpose {
  return typeof v === "string" && (PURPOSES as readonly string[]).includes(v);
}
export function isChargeType(v: unknown): v is ChargeType {
  return typeof v === "string" && (CHARGE_TYPES as readonly string[]).includes(v);
}

/**
 * 기록 번호 글자. 시트별 영문 두 글자 + 연도 + 순번 → "US-2026-84".
 * 🔴 "2026-84" 만으로는 견적서 번호와 겹쳐 보인다(2026-10-06 사용자 지적). 앞 두 글자는 **시트**를 뜻한다
 * (순번도 시트별로 따로 세므로): US 사용처 기입란 · RC 입고 기입란 · CH 수량 변경 기록. 바꾸려면 여기 한 곳.
 */
export const SHEET_PREFIX: Record<Sheet, string> = { USE: "US", RECEIVE: "RC", CHANGE: "CH" };
export function sheetNoText(type: EntryType, year: number, no: number): string {
  return `${SHEET_PREFIX[sheetOf(type)]}-${year}-${no}`;
}

/** 인수번호 모양: D + 숫자 6자리 (DESIGN 7절) */
export const INTAKE_NUMBER_RE = /^D\d{6}$/;

/** 증감 표시: +3 / −2 (마이너스는 U+2212 로 눈에 잘 띄게) */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta.toLocaleString("ko-KR")}` : `−${Math.abs(delta).toLocaleString("ko-KR")}`;
}

/** 오늘 (Asia/Seoul, YYYY-MM-DD). 운영 서버가 UTC 라 꼭 시간대를 박는다 (CLAUDE.md 10절). */
export function todaySeoul(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export { ENTRY_TYPES, PURPOSES, CHARGE_TYPES };
export type { EntryType, Purpose, ChargeType, Sheet };
