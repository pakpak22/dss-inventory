import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  ohPartTemplateItems,
  ohPartTemplateModels,
  ohPartTemplates,
  partOverhaulUnitPrices,
} from "@/db/schema/oh-templates";
import { parts } from "@/db/schema/parts";
import type { OhPartLinkOption } from "./link-state";
import type { OhTemplateItemView, OhTemplateModelView, OhTemplateView } from "./view";

export type { OhTemplateItemView, OhTemplateModelView, OhTemplateView };

/**
 * ============================================================================
 * O/H 부품 템플릿 — 읽는 쪽
 * ============================================================================
 * **읽기 전용이다.** 만들고 고치는 일은 `mutations.ts` 가 맡는다(원본 A/S 의 같은 규약).
 *
 * ── 🔴 원본의 `findOhTemplateForRepairCase` 는 옮기지 않았다 ──────────────
 * 「이 수리 건의 장비에 붙은 템플릿」을 찾는 일은 **A/S 쪽 화면의 것**이고, 이 시스템에는
 * `repair_cases` · `products` 표가 아예 없다. 나중에 부품 요청 화면이 그것을 필요로 하면 그때
 * A/S 가 모델 id 를 실어 보내고 이쪽이 `oh_part_template_models` 로 찾는 모양이 될 것이다.
 *
 * 🔵 **2026-10-15 에 그대로 됐다** — 아래 `findOhTemplateByProductModel` 이 그 모양이고,
 *    `GET /api/v1/oh-templates?modelId=…` 가 부른다. 수리 건은 저쪽이 풀어서 **모델 id 만** 보낸다.
 *
 * ── 🔴 모델 고르개 목록은 여기서 만들지 않는다 ──────────────────────────
 * 제품 모델 표가 이 시스템에 없다. 고를 수 있는 모델은 A/S 에서 받아 오고(`as-product-models.ts`),
 * 이미 이어 둔 것을 빼는 일은 순수 함수(`product-models.ts` 의 `filterUnlinkedModels`)가 한다.
 * ============================================================================
 */

/**
 * 살아 있는 템플릿 전부. **이름 순** — 2026-10-15 에 기종 코드를 없앤 뒤로 사람이 목록에서
 * 찾는 글자가 이름 하나뿐이다(그 전에는 코드 순이었다. 스키마 머리말 참조).
 *
 * 부품 줄 · 이어진 모델 · 그 부품의 O/H 단가를 함께 싣는다. 🔵 템플릿마다 따로 읽으면 N+1 이라
 * **질의 네 번**으로 걷어 온다(머리 → 줄·모델 → 단가). 템플릿은 많아야 열몇 장이고 줄은 13개가
 * 상한이라, 한 번에 다 받아 화면에서 그리는 것이 이 저장소의 목록 관용구와도 맞는다.
 */
export async function listOhTemplates(): Promise<OhTemplateView[]> {
  const rows = await db()
    .select({
      id: ohPartTemplates.id,
      version: ohPartTemplates.version,
      name: ohPartTemplates.name,
      note: ohPartTemplates.note,
    })
    .from(ohPartTemplates)
    .where(eq(ohPartTemplates.isDeleted, false))
    .orderBy(asc(ohPartTemplates.name));

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [items, models] = await Promise.all([
    db()
      .select({
        id: ohPartTemplateItems.id,
        templateId: ohPartTemplateItems.templateId,
        displayOrder: ohPartTemplateItems.displayOrder,
        partId: ohPartTemplateItems.partId,
        partNameText: ohPartTemplateItems.partNameText,
        quantity: ohPartTemplateItems.quantity,
        // 🔵 지금 재고의 No.·품명. 저장된 `part_name_text` 와 **다를 수 있다**(이은 뒤 재고
        //    쪽에서 품명을 고친 경우). 그 어긋남을 화면이 짚어 줘야 하므로 둘 다 싣는다.
        partNo: parts.no,
        partName: parts.name,
      })
      .from(ohPartTemplateItems)
      .leftJoin(parts, eq(parts.id, ohPartTemplateItems.partId))
      .where(inArray(ohPartTemplateItems.templateId, ids))
      .orderBy(asc(ohPartTemplateItems.displayOrder)),
    db()
      .select({
        id: ohPartTemplateModels.id,
        templateId: ohPartTemplateModels.templateId,
        productModelId: ohPartTemplateModels.productModelId,
        // 🔴 A/S 를 조인하지 않는다 — 그 표가 이 시스템에 없다. 이을 때 적어 둔 사본을 쓴다.
        //    그 덕에 A/S 가 꺼져 있어도 「어느 모델인지」가 화면에 남는다.
        productModelName: ohPartTemplateModels.productModelName,
      })
      .from(ohPartTemplateModels)
      .where(inArray(ohPartTemplateModels.templateId, ids))
      .orderBy(asc(ohPartTemplateModels.productModelName)),
  ]);

  // 🔴 단가는 **정해진 것만** 돌아온다. 없는 부품을 0 으로 채우지 않는다 — 채우면
  //    「정하지 않음」과 「0원(무상)」이 화면에 닿기도 전에 같은 값이 되고, 그 뒤로는 어느
  //    쪽이었는지 되찾을 수 없다(schema/oh-templates.ts 머리말).
  const partIds = [...new Set(items.map((item) => item.partId).filter((id): id is string => id !== null))];
  const priceRows =
    partIds.length === 0
      ? []
      : await db()
          .select({ partId: partOverhaulUnitPrices.partId, unitPrice: partOverhaulUnitPrices.unitPrice })
          .from(partOverhaulUnitPrices)
          .where(inArray(partOverhaulUnitPrices.partId, partIds));
  const priceByPartId = new Map(priceRows.map((row) => [row.partId, row.unitPrice]));

  return rows.map((row) => ({
    ...row,
    items: items
      .filter((item) => item.templateId === row.id)
      .map(
        (item): OhTemplateItemView => ({
          id: item.id,
          displayOrder: item.displayOrder,
          partId: item.partId,
          partNameText: item.partNameText,
          quantity: item.quantity,
          partNo: item.partNo,
          partName: item.partName,
          ohPrice: item.partId === null ? null : (priceByPartId.get(item.partId) ?? null),
        }),
      ),
    models: models
      .filter((model) => model.templateId === row.id)
      .map(
        (model): OhTemplateModelView => ({
          id: model.id,
          productModelId: model.productModelId,
          productModelName: model.productModelName,
        }),
      ),
  }));
}

/**
 * 부품 고르개가 고를 수 있는 재고 부품 전부. **지워진 부품은 뺀다.**
 *
 * 🔵 **찾는 칸 여섯만** 넘긴다(`PartQueryFields` + id) — 화면 조각은 "use client" 라 넘긴 값이
 * 그대로 브라우저까지 실려 간다. 수량·단가 따위를 실어 보낼 이유가 없다. 2026-10-15(조각 9b)에
 * **고객사 품명·도번·교산 품번**이 늘었다: 공용 고르개(`src/components/parts/PartPicker.tsx`)가
 * 그 여섯으로 찾으므로, 여기서 빼면 **그 화면에서만 조용히 안 찾아진다.**
 *
 * 🔴 고객사 품명은 보여 주기용이 아니라 **그 줄에 저장되는 값**이기도 하다 — 고르면
 * `part_name_text` 가 그 글자가 된다(`mutations.ts` 3번이 DB 에서 다시 읽어 확정한다).
 *
 * `name2`(품명2)와 `no` 를 함께 주는 까닭: 이 저장소의 `parts` 에는 **품명 유니크 제약이
 * 없다**(같은 이름을 따로 세는 부품이 실제로 16묶음 있다). 같은 이름이 둘 나왔을 때 사람이 어느
 * 재고인지 고르려면 단서가 하나는 있어야 한다.
 *
 * 🔵 **`quotePrice` 도 함께 준다**(2026-10-22) — 찾는 칸은 아니지만, O/H 단가를 비워 둔 줄에
 * 화면이 그 부품의 **견적가를 회색 placeholder 로** 비쳐 주는 데 쓴다. 새 조회를 열지 않고 이미
 * 부품을 읽는 이 자리에 칸만 더한다. `null` 은 「견적가를 정하지 않았다」이고 0 과 다르다 — 그대로
 * 나른다(`?? 0` 금지, `src/lib/api/parts.ts` 머리말과 같은 잣대).
 */
export async function listOhPartOptions(): Promise<OhPartLinkOption[]> {
  return db()
    .select({
      id: parts.id,
      no: parts.no,
      name: parts.name,
      name2: parts.name2,
      customerName: parts.customerName,
      drawingNo: parts.drawingNo,
      kyosanPartNo: parts.kyosanPartNo,
      quotePrice: parts.quotePrice,
    })
    .from(parts)
    .where(eq(parts.isDeleted, false))
    .orderBy(asc(parts.name), asc(parts.no));
}

/**
 * 이 통로가 쓰는 템플릿 한 장의 모양. 🔵 화면용 `OhTemplateView` 와 **일부러 다르다** —
 * 그쪽은 고칠 때 필요한 것(판 번호 · 줄 id · 부품 uuid · O/H 단가)을 싣고, 이쪽은 **읽어 가는 쪽이
 * 쓰는 것만** 싣는다(API.md 2절의 「UUID 는 내주지 않는다」).
 */
export type OhTemplateForModel = {
  id: string;
  name: string;
  note: string | null;
  items: {
    displayOrder: number;
    partNameText: string;
    quantity: number;
    partNo: number | null;
    partName: string | null;
  }[];
};

/**
 * **이 제품 모델에 이어진 O/H 템플릿 한 장.** 없으면 `null` 이다(오류가 아니다 — 안 이어 두었거나
 * O/H 템플릿이 없는 기종이면 없다).
 *
 * A/S 가 「이 장비의 O/H 부품」을 읽어 갈 때 쓴다(`GET /api/v1/oh-templates`, API.md 6절).
 * 🔴 열쇠는 **A/S 의 `product_models.id`** 다 — 그 값이 그대로 `oh_part_template_models.product_model_id`
 *    에 적혀 있다(스키마 머리말). 이름으로 잇지 않는다: 이름은 **이을 때 떠 온 사본**이라 저쪽에서 고치면
 *    여기 값은 따라 바뀌지 않는다.
 *
 * 🔴 **모델 하나는 템플릿 하나에만 붙는다**(`oh_part_template_models_model_uq`). 그래서 `limit(1)` 이고,
 *    결과가 여럿일 수 없다.
 *
 * 🔵 `listOhTemplates` 를 다시 쓰지 않는 까닭 둘:
 *    ① 그쪽은 **살아 있는 템플릿을 전부** 읽어 와서 하나를 고른다(원본 A/S 가 그렇게 한다). 통로가
 *       부를 때마다 전부 읽을 일이 아니다.
 *    ② 🔴 그쪽은 **O/H 단가를 함께 읽는다.** 이 통로는 단가를 내보내지 않기로 했으므로
 *       (`lib/api/oh-templates.ts` 머리말) 아예 **그 표를 열지 않는 길**로 간다 — 읽어 놓고 모양에서
 *       빼는 것은, 다음 사람이 칸을 하나 더할 때 조용히 새어 나가는 길을 열어 둔다.
 */
export async function findOhTemplateByProductModel(productModelId: string): Promise<OhTemplateForModel | null> {
  const [head] = await db()
    .select({ id: ohPartTemplates.id, name: ohPartTemplates.name, note: ohPartTemplates.note })
    .from(ohPartTemplateModels)
    .innerJoin(ohPartTemplates, eq(ohPartTemplates.id, ohPartTemplateModels.templateId))
    // 🔴 **지워진(숨긴) 템플릿은 뺀다.** 되살릴 수 있게 남겨 둔 것이지 쓰라고 둔 것이 아니다.
    .where(and(eq(ohPartTemplateModels.productModelId, productModelId), eq(ohPartTemplates.isDeleted, false)))
    .limit(1);

  if (!head) return null;

  const items = await db()
    .select({
      displayOrder: ohPartTemplateItems.displayOrder,
      partNameText: ohPartTemplateItems.partNameText,
      quantity: ohPartTemplateItems.quantity,
      partNo: parts.no,
      partName: parts.name,
    })
    .from(ohPartTemplateItems)
    /**
     * 🔴 **이어 읽는 조건에 `is_deleted = false` 가 함께 있다.** 숨긴 부품은 「안 이어진 줄」로 나간다.
     *    빼고 보면 부품이 숨겨진 줄이 **번호를 달고** 나가고, A/S 가 그것을 담아 올린 반출 신청은
     *    `POST /api/v1/stock-requests` 에서 **통째로 400** 이 된다(숨긴 부품은 거절한다). 줄 하나 때문에
     *    요청 전체가 막히는데, A/S 쪽에서는 왜인지 알 길이 없다.
     * 🔵 `where` 가 아니라 **join 조건**에 둔다 — `where` 에 두면 그 줄이 통째로 사라져, 감추지 않기로 한
     *    약속이 깨진다.
     */
    .leftJoin(parts, and(eq(parts.id, ohPartTemplateItems.partId), eq(parts.isDeleted, false)))
    .where(eq(ohPartTemplateItems.templateId, head.id))
    .orderBy(asc(ohPartTemplateItems.displayOrder));

  return { ...head, items };
}
