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
 * 🔴 두 묶음이 `REQUEST_STATUSES` 를 **빠짐없이, 겹치지 않게** 덮는다. 상태를 더하고 여기를 안 고치면 그 상태의
 *    신청이 어느 목록에도 안 걸린다 — 원장은 안 깨지므로 아무 오류 없이 조용히 사라진다. 그 덮기는
 *    `tests/stock-requests.test.ts` 가 지킨다.
 * 🔵 서버 전용이 아닌 이 파일에 둔다 — 세는 질의(`src/lib/stock/requests.ts`, server-only)와 시험이 **같은 한 벌**을 본다.
 *    「대기」를 가르는 글자가 적힌 곳은 여기 하나뿐이어야 머리말 배지와 알림 종이 어긋나지 않는다.
 */
export const PENDING_REQUEST_STATUSES = ["PENDING", "CONFIRMING", "PARTIAL"] as const satisfies readonly RequestStatus[];

/** 더 볼 일이 없는 것 — 신청한 사람에게 결과로만 보인다. 🔴 `PARTIAL` 은 여기 **없다**(위 주석). */
export const DECIDED_REQUEST_STATUSES = ["CONFIRMED", "REJECTED", "CANCELLED"] as const satisfies readonly RequestStatus[];

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
