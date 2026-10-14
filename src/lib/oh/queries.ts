import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  ohPartTemplateItems,
  ohPartTemplateModels,
  ohPartTemplates,
  partOverhaulUnitPrices,
} from "@/db/schema/oh-templates";
import { parts } from "@/db/schema/parts";
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
 * 품명 칸(`<input list>`)이 고를 수 있는 재고 부품 전부. **지워진 부품은 뺀다.**
 *
 * 🔵 `{ id, name, name2 }` 만 넘긴다 — 화면 조각은 "use client" 라 넘긴 값이 그대로 브라우저까지
 * 실려 간다. 수량·단가 따위를 실어 보낼 이유가 없다.
 *
 * `name2`(품명2)를 함께 주는 까닭: 이 저장소의 `parts` 에는 **품명 유니크 제약이 없다**(같은
 * 이름을 따로 세는 부품이 실제로 16묶음 있다). 같은 이름이 둘 나왔을 때 사람이 어느 재고인지
 * 고르려면 단서가 하나는 있어야 한다.
 */
export async function listOhPartOptions(): Promise<{ id: string; no: number; name: string; name2: string }[]> {
  return db()
    .select({ id: parts.id, no: parts.no, name: parts.name, name2: parts.name2 })
    .from(parts)
    .where(eq(parts.isDeleted, false))
    .orderBy(asc(parts.name), asc(parts.no));
}
