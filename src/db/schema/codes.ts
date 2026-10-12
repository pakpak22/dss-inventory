import { pgEnum } from "drizzle-orm/pg-core";

/**
 * 부품에 붙는 코드값 (DESIGN 4-1절). **저장은 영문 코드, 화면은 한글** (REQUIREMENTS 4-1절).
 * 화면 표시 글자는 `src/lib/parts/codes.ts` 에 있다 — 여기에는 DB 에 들어가는 값만 둔다.
 *
 * 소유는 A/S 시스템과 같은 값을 쓴다(답변서 2026-10-02). 분류의 `COMPATIBLE` 은 엑셀의 「호환」.
 */
export const OWNERS = ["DSS", "KYOSAN", "SERVICE_SPARE"] as const;
export type Owner = (typeof OWNERS)[number];
export const ownerEnum = pgEnum("owner", OWNERS);

export const CATEGORIES = ["RFG", "MB", "COMPATIBLE"] as const;
export type Category = (typeof CATEGORIES)[number];
export const categoryEnum = pgEnum("category", CATEGORIES);

/** 공급가 통화. 엔이 기본, 국내 구매품만 원 (REQUIREMENTS 4-1절). 견적가는 항상 원이라 통화 칸이 없다. */
export const CURRENCIES = ["JPY", "KRW"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const currencyEnum = pgEnum("currency", CURRENCIES);
