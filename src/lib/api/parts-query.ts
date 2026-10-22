import { eq } from "drizzle-orm";
import { partOverhaulUnitPrices } from "@/db/schema/oh-templates";
import { partItems } from "@/db/schema/part-items";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";

/**
 * ============================================================================
 * 부품 통로가 읽어 오는 칸 — **목록과 하나 조회가 같은 한 벌을 쓴다**
 * ============================================================================
 * `GET /api/v1/parts` 와 `GET /api/v1/parts/{no}` 는 **같은 모양**을 내주겠다고 API.md 3절에
 * 적어 두었다(「위와 같은 모양」). 그런데 읽는 칸 목록이 두 파일에 따로 적혀 있으면, 칸을 더하는
 * 날 한쪽만 고쳐지고 **목록에는 있는데 하나 조회에는 없는 칸**이 생긴다. 받는 쪽은 그것을
 * 「그 부품은 값이 없구나」로 읽는다 — 틀린 줄도 아니고 오류도 아니라 아무도 알아차리지 못한다.
 *
 * 그래서 칸 한 벌을 여기 한 곳에 둔다. 🔵 DB 에 붙지 않는 모듈이라(스키마 객체만 본다)
 * `npm test` 가 그대로 불러 읽을 수 있다.
 *
 * ── 🔴 O/H 단가는 `parts` 가 아니라 **옆 표**에서 온다 ────────────────────
 * 2026-10-14 결정으로 O/H 단가는 `parts` 에 칸을 두지 않고 `part_overhaul_unit_prices` 에 산다
 * (그 표 머리말: `parts` 에 두면 `select()` 전체 조회를 쓰는 재고 현황·엑셀 한 벌에 따라 나간다).
 * 그래서 **LEFT JOIN** 으로 이어 읽는다 — `INNER` 로 이으면 단가를 정하지 않은 부품이
 * **목록에서 통째로 사라진다**(319개 중 단가가 정해진 몇 개만 남는다).
 *
 * 이어 붙을 줄은 부품마다 많아야 하나다(`part_overhaul_unit_prices_part_uq`). 그래서 이 조인이
 * 부품 줄을 늘리지 않는다. 그리고 그 표에는 **소프트 삭제가 없다** — 사람이 칸을 비우면 0 을
 * 저장하지 않고 **행을 지우므로**(`lib/oh/mutations.ts` 의 `applyOnePrice`), 지운 단가는 여기서
 * 이을 줄이 없어 `null` 이 된다. 거르는 조건을 따로 붙일 자리가 아니다.
 * ============================================================================
 */
export const API_PART_COLUMNS = {
  no: parts.no,
  name: parts.name,
  name2: parts.name2,
  customerName: parts.customerName,
  kyosanPartNo: parts.kyosanPartNo,
  drawingNo: parts.drawingNo,
  supplyPrice: parts.supplyPrice,
  supplyCurrency: parts.supplyCurrency,
  quotePrice: parts.quotePrice,
  /**
   * 🔴 **저장된 값 그대로**다 — 정한 부품만 값이 있고 나머지는 `null` 이다. 0 으로 채우지 않는다.
   * 🔴 **여기서 `COALESCE` 로 풀지 않는다.** 2026-10-22 결정(「비면 견적가를 따른다」)을 푸는
   *    일은 `toApiPart` 가 `resolveOverhaulUnitPrice` 로 한다 — 순수 함수라 시험이 붙고,
   *    SQL 로 풀면 화면·질의·통로가 각자 다른 식을 들고 다니게 된다(`./parts.ts` 머리말).
   *    🔵 칸 이름이 `overhaulQuotePrice` 가 아닌 까닭도 같다 — **푼 값과 안 푼 값을 가른다.**
   */
  overhaulUnitPrice: partOverhaulUnitPrices.unitPrice,
  note: parts.note,
  itemCode: partItems.code,
  itemName: partItems.name,
  category: parts.category,
  owner: parts.owner,
  updatedAt: parts.updatedAt,
  quantity: stockBalances.quantity,
} as const;

/** 항목(`part_items`)은 반드시 있다 — `parts.item_id` 가 NOT NULL 이라 INNER 로 잇는다. */
export const API_PART_ITEM_JOIN = eq(parts.itemId, partItems.id);

/** 수량은 없을 수 있다(원장에 한 줄도 없는 새 부품). 읽는 쪽에서 `?? 0` 으로 채운다. */
export const API_PART_BALANCE_JOIN = eq(stockBalances.partId, parts.id);

/** 🔴 O/H 단가는 **정해진 부품만** 줄이 있다. LEFT JOIN 이어야 나머지가 사라지지 않는다(위 머리말). */
export const API_PART_OVERHAUL_PRICE_JOIN = eq(partOverhaulUnitPrices.partId, parts.id);
