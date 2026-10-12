import { CATEGORIES, CURRENCIES, OWNERS, type Category, type Currency, type Owner } from "@/db/schema/codes";

/**
 * 코드값 → 화면 글자 (DESIGN 4-1절). **저장은 영문 코드, 화면은 한글.**
 * 소유의 화면 표시는 지금 엑셀 표기(KYOSAN)를 따랐다. A/S 는 같은 값을 「교산」으로 보여 준다.
 * 🔴 용어를 섞어 쓰지 않는다 — 화면 전체가 이 표 하나를 쓴다 (CLAUDE.md 10절).
 */
export const OWNER_LABEL: Record<Owner, string> = {
  DSS: "DSS",
  KYOSAN: "KYOSAN",
  SERVICE_SPARE: "보수부재",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  RFG: "RFG",
  MB: "MB",
  COMPATIBLE: "호환",
};

export const CURRENCY_SIGN: Record<Currency, string> = {
  JPY: "¥",
  KRW: "₩",
};

export { OWNERS, CATEGORIES, CURRENCIES };
export type { Owner, Category, Currency };

export function isOwner(v: unknown): v is Owner {
  return typeof v === "string" && (OWNERS as readonly string[]).includes(v);
}
export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

/** 금액 표시. null 은 "-". 통화 기호를 앞에 붙인다 (예시 화면과 같다). */
export function formatMoney(value: number | null, currency: Currency): string {
  if (value === null) return "-";
  return `${CURRENCY_SIGN[currency]}${value.toLocaleString("ko-KR")}`;
}

/** 수량 표시. 단위 "개" 는 칸 머리글에만 쓴다. */
export function formatQuantity(value: number): string {
  return value.toLocaleString("ko-KR");
}
