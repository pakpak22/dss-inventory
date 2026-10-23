import { CURRENCIES, OWNERS, type Currency, type Owner } from "@/db/schema/codes";
import type { PartRow } from "./types";

/**
 * ============================================================================
 * 재고 현황의 **부품 총 금액** (2026-10-23 쓰는 분 요청)
 * ============================================================================
 * 「검색 아래 우측 빈 공간에 부품 총 금액(견적가, 공급가, 소유별로)을 볼 수 있도록」이
 * 요청 그대로다. 셈은 **수량 × 금액**이다.
 *
 * ── 🔴 공급가를 한 숫자로 더하면 **조용히 틀린다** ─────────────────────────
 * 견적가(`quotePrice`)는 **언제나 원**이다(`db/schema/codes.ts`: 「견적가는 항상 원이라
 * 통화 칸이 없다」). 그런데 공급가(`supplyPrice`)는 **부품마다 통화가 다르다** —
 * `supplyCurrency` 가 엔(기본)이거나 원(국내 구매품)이다. ¥100 과 ₩100 을 더해 200 을
 * 보여 주면 **오류는 한 번도 안 나면서** 아무 뜻도 없는 숫자가 화면에 선다.
 * 🔴 이 시스템에는 **환율이 없다.** 그래서 공급가는 **통화마다 따로** 센다.
 *
 * ── 🔴 금액이 비어 있는 부품 ───────────────────────────────────────────────
 * 가격은 `null` 일 수 있다(`PartRow`). 그런 부품을 그냥 빼고 더하면 **적게 나온 합계가
 * 전부인 것처럼** 보인다. 그래서 뺀 개수를 함께 들고 나가 화면이 말하게 한다.
 * 🔵 `?? 0` 으로 뭉개지 않는 까닭은 「값이 0원」과 「아직 안 적음」이 다른 말이기 때문이다.
 *
 * ── 🔵 무엇을 세는가 ───────────────────────────────────────────────────────
 * 부르는 쪽이 **지금 걸러진 목록 전체**(`filtered`)를 넘긴다. 보고 있는 **쪽**(`page.rows`)이
 * 아니다 — 쪽을 넘길 때마다 총액이 달라지면 그것은 총액이 아니다.
 * ============================================================================
 */

/** 이 셈에 필요한 칸만. 🔵 `PartRow` 를 통째로 받지 않아 시험에서 가짜 줄을 짧게 적는다. */
export type StockValueRow = Pick<PartRow, "owner" | "quantity" | "quotePrice" | "supplyPrice" | "supplyCurrency">;

export interface StockValueGroup {
  /** 이 묶음의 부품 줄 수. */
  parts: number;
  /** 재고 수량 합. */
  quantity: number;
  /** 견적가 합계 — 🔴 언제나 원이다. */
  quote: number;
  /** 견적가가 비어 있어 위 합계에 **못 들어간** 부품 수. */
  quoteMissing: number;
  /** 공급가 합계 — 🔴 **통화마다 따로**. 더해서 하나로 만들지 마라. */
  supply: Record<Currency, number>;
  /** 공급가가 비어 있어 위 합계에 **못 들어간** 부품 수. */
  supplyMissing: number;
}

export interface StockValueOwnerGroup extends StockValueGroup {
  owner: Owner;
}

export interface StockValueSummary {
  /**
   * 소유별. 🔵 **줄이 하나라도 있는 소유만** 선다 — 거르개로 소유를 좁혀 놓고 보면
   * 나머지 둘은 늘 0 이라, 0 만 적힌 줄 둘이 눈을 가린다. 차례는 `OWNERS` 그대로다.
   */
  byOwner: StockValueOwnerGroup[];
  /** 전체 합계. */
  total: StockValueGroup;
}

function emptyGroup(): StockValueGroup {
  return {
    parts: 0,
    quantity: 0,
    quote: 0,
    quoteMissing: 0,
    // 🔴 통화를 하나라도 빠뜨리면 그 통화의 금액이 **조용히 사라진다**. 목록에서 짓는다.
    supply: Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Record<Currency, number>,
    supplyMissing: 0,
  };
}

function add(group: StockValueGroup, row: StockValueRow): void {
  group.parts += 1;
  group.quantity += row.quantity;
  // 🔴 `null` 과 `0` 을 가른다 — 「0원짜리 부품」과 「값을 아직 안 적은 부품」은 다른 말이다.
  if (row.quotePrice === null) group.quoteMissing += 1;
  else group.quote += row.quotePrice * row.quantity;
  if (row.supplyPrice === null) group.supplyMissing += 1;
  else group.supply[row.supplyCurrency] += row.supplyPrice * row.quantity;
}

/**
 * 걸러진 목록의 총 금액을 소유별로 센다.
 *
 * 🔴 **빈 목록이면 `byOwner` 도 비고 `total` 은 전부 0 이다.** 「0원」과 「셀 것이 없음」을
 *    화면이 가를 수 있게, 여기서 지어내지 않는다(`total.parts` 가 0 이면 셀 것이 없었다).
 */
export function summarizeStockValue(rows: readonly StockValueRow[]): StockValueSummary {
  const byOwner = new Map<Owner, StockValueGroup>();
  const total = emptyGroup();
  for (const row of rows) {
    let group = byOwner.get(row.owner);
    if (group === undefined) {
      group = emptyGroup();
      byOwner.set(row.owner, group);
    }
    add(group, row);
    add(total, row);
  }
  return {
    // 🔵 `OWNERS` 를 돌아 차례를 못 박는다 — Map 이 들어온 순서를 쓰면 목록이 바뀔 때마다 줄이 춤춘다.
    byOwner: OWNERS.filter((owner) => byOwner.has(owner)).map((owner) => ({ owner, ...(byOwner.get(owner) as StockValueGroup) })),
    total,
  };
}

/**
 * **그 통화로 공급가가 적힌 부품이 하나라도 있는** 통화만 (2026-10-23 쓰는 분 요청:
 * 「공급가에 원이 아예 없으면 표시되지 않도록」).
 *
 * 🔵 안 쓰는 통화 열을 세우면 「₩0」이 늘 떠 있어, 0원어치 있는 것처럼 읽힌다.
 * 🔴 **금액이 0원이어도 그 통화는 남는다 — 적혀 있기 때문이다.** 「0원이라고 적음」과
 *    「그 통화를 안 씀」은 다른 말이다. 수량이 0 인 재고도 여기 든다(단가는 적혀 있다).
 *    그래서 **합계가 0 인지로 가르지 않고** 줄을 직접 본다 — 합계로 가르면 수량이 0 인
 *    부품만 남은 순간 열이 조용히 사라진다.
 */
export function usedCurrencies(rows: readonly StockValueRow[]): Currency[] {
  const seen = new Set<Currency>();
  for (const row of rows) if (row.supplyPrice !== null) seen.add(row.supplyCurrency);
  return CURRENCIES.filter((c) => seen.has(c));
}
