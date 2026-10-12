import { CHARGE_TYPES, ENTRY_TYPES, PURPOSES, type ChargeType, type EntryType, type Purpose, type Sheet } from "@/db/schema/stock";

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
