/**
 * 「자주 사용하는 부품」 계산 — 순수 함수 (2026-10-07 사용자 요청: 기준을 화면에서 바로 조절).
 *
 * 서버는 최근 36개월의 **월별 사용 통계**(부품 → 달 → 건수·수량)만 내려주고, 기준(횟수/수량 · 기간 · 숫자)은
 * 주소에 담긴 상태로 **화면에서** 계산한다. 막대를 움직일 때마다 서버를 부르지 않는다.
 *
 * - 재는 것: `n` 출납 횟수(사용 기록 줄 수) 또는 `q` 사용 수량. 입고·반환·대여는 안 센다. 취소된 줄·소유 불일치 과거 기록은 뺀다.
 * - 기간: 이번 달 포함 최근 N개월 (N 은 2·4·…·36). 달 단위로 자른다 — 막대 한 칸이 2개월이라 날짜 단위 정밀도가 필요 없다.
 * - 기준: 횟수 모드는 그 기간 합이 `min` 이상. **수량 모드는 기준 없음**(2026-10-07 사용자: 「많은 애가 위로 노출되면 된다」) —
 *   그 기간에 한 개라도 쓴 부품이 전부 들어가고 많은 순으로 선다.
 */
export type FrequentMode = "n" | "q";

/** 부품 id → 달("YYYY-MM") → [건수, 수량] */
export type MonthlyUsage = Record<string, Record<string, [number, number]>>;

export const FREQ_MONTHS_STEP = 2;
export const FREQ_MONTHS_MAX = 36;
export const FREQ_MONTHS_DEFAULT = 12;
export const FREQ_MIN_DEFAULT = 3;
export const FREQ_MIN_MAX = 100_000;

export interface FrequentRule {
  mode: FrequentMode;
  /** 짝수 2~36 */
  months: number;
  /** 1 이상. 횟수 모드에서만 쓴다 — 수량 모드는 무시(기준 없음). */
  min: number;
}

export const DEFAULT_RULE: FrequentRule = { mode: "n", months: FREQ_MONTHS_DEFAULT, min: FREQ_MIN_DEFAULT };

export function isFrequentMode(v: unknown): v is FrequentMode {
  return v === "n" || v === "q";
}

/** 막대 값 고르기: 2~36 의 짝수로 맞춘다. 이상한 값은 기본값. */
export function clampMonths(v: number): number {
  if (!Number.isFinite(v)) return FREQ_MONTHS_DEFAULT;
  const even = Math.round(v / FREQ_MONTHS_STEP) * FREQ_MONTHS_STEP;
  return Math.min(FREQ_MONTHS_MAX, Math.max(FREQ_MONTHS_STEP, even));
}

export function clampMin(v: number): number {
  if (!Number.isFinite(v)) return FREQ_MIN_DEFAULT;
  return Math.min(FREQ_MIN_MAX, Math.max(1, Math.floor(v)));
}

/** "YYYY-MM" 에서 n 달 전 (n=0 이면 그대로) */
export function monthMinus(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 - n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/** 이번 달(서울) "YYYY-MM" */
export function currentMonthSeoul(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
}

/**
 * 규칙에 맞는 부품과 그 값(횟수 또는 수량). 값이 큰 순으로 줄 세우는 데 쓴다.
 * 기간은 `[thisMonth - (months-1), thisMonth]` — 이번 달 포함 최근 months 개월.
 */
export function frequentValues(usage: MonthlyUsage, rule: FrequentRule, thisMonth: string): Map<string, number> {
  const from = monthMinus(thisMonth, rule.months - 1);
  const out = new Map<string, number>();
  for (const [partId, byMonth] of Object.entries(usage)) {
    let sum = 0;
    for (const [month, [n, q]] of Object.entries(byMonth)) {
      if (month < from || month > thisMonth) continue;
      sum += rule.mode === "n" ? n : q;
    }
    const min = rule.mode === "q" ? 1 : rule.min;
    if (sum >= min) out.set(partId, sum);
  }
  return out;
}
