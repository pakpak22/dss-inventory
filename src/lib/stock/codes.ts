import { CHARGE_TYPES, ENTRY_TYPES, PURPOSES, type ChargeType, type EntryType, type Purpose, type Sheet } from "@/db/schema/stock";
import type { RequestStatus } from "@/db/schema/stock-requests";

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
 * 기록 권한자가 적으면 확인 대기로, 관리자가 적으면 바로 원장에. 입고·반환은 담당자가 하는 일이라 바로.
 */
export const CONFIRMATION_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(["USE", "LOAN", "DISPOSE"]);
export function needsConfirmation(type: EntryType, isAdmin: boolean): boolean {
  return !isAdmin && CONFIRMATION_TYPES.has(type);
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
