import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parts } from "./parts";

/**
 * ============================================================================
 * O/H 부품 템플릿 — 기종마다 「오버홀이면 이 부품들을 이만큼」
 * ============================================================================
 * O/H(오버홀) 작업을 할 때 그 기종에 늘 들어가는 부품과 수량을 미리 적어 두는 목록이다.
 * A/S 관리 시스템에서 **원본 모양 그대로** 옮겨 온다(2026-10-15, 조각 5a′).
 *
 * 🔴 조각 5a(2026-10-14)에서는 A/S 의 원본 화면을 보지 않고 설계해 모양이 어긋났다.
 * 원본 화면을 그대로 옮기기로 정했으므로 표를 원본에 맞춰 다시 세운다. 그때 만든 표 둘에는
 * 줄이 0개였고 운영에 나간 적도 없다.
 *
 * 원래 이 목록은 **견적서 OH 양식의 숨은 열**에 살았다(`OH견적서` 시트 P~AD열 34~46행,
 * `K11` 에 기종 코드를 넣으면 `IFS` 수식이 그 기종 것을 꺼내 왔다). 그 방식의 문제는 셋이었다:
 *
 *  1. 부품 하나를 고치려면 숨긴 열을 다시 펴서 엑셀을 고쳐야 한다.
 *  2. 기종이 늘면 수식을 직접 고쳐야 하고, 실제로 목록에 있는 `302` 는 수식에 빠져 있어
 *     고르면 빈칸이 나왔다.
 *  3. 재고(`parts`)와 이어져 있지 않아, 부품을 요청할 때 사람이 이름을 보고 다시 찾아야 한다.
 *
 * 그래서 자기 표로 옮긴다. 옮기고 나면 **재고 관리 화면에서 고칠 수 있고**, 부품 요청에
 * 한 번에 담을 수 있다.
 *
 * ── 기종 코드는 사람이 잇는다 ──────────────────────────────────────────────
 * `15 · 20 · 301 · 302` 가 어느 제품 모델인지는 코드가 알 수 없다(원본에서도 자동 대응은
 * 두지 않기로 했다). 그래서 `oh_part_template_models` 로 **사람이 직접 잇는다.**
 *
 * ── 부품 연결은 있으면 좋은 것이지 필수가 아니다 ──────────────────────────
 * `part_id` 는 NULL 을 허용한다. 양식에서 옮겨 온 이름 중에는 재고 마스터에 없는 것이 있고
 * (`유량계` 처럼), 그렇다고 그 줄을 버리면 템플릿이 반쪽이 된다. 연결이 없으면 부품 요청에
 * 담을 때 **이름만 담고 사람에게 알린다.**
 *
 * ── 삭제는 소프트다 ────────────────────────────────────────────────────────
 * 템플릿은 사람이 만든 설정이고 되돌릴 수 있어야 한다(CLAUDE.md 11절). 딸린 줄(items)과
 * 모델 잇기(models)는 템플릿에 속한 값이라 `ON DELETE CASCADE` 이고, 소프트 삭제일 때는
 * 돌지 않는다.
 *
 * ── 🔵 O/H 단가는 이 표에 없다 ────────────────────────────────────────────
 * 단가는 **부품마다 하나**이고 `part_overhaul_unit_prices`(이 파일 아래)에 산다. 조각 5a 에서
 * 잠깐 `oh_part_template_items.oh_price` 로 두었던 것을 원본에 맞춰 되돌렸다.
 * ============================================================================
 */
export const ohPartTemplates = pgTable(
  "oh_part_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 양식의 `K11` 에 넣던 **기종 코드**(`15` · `20` · `301` · `302`). 숫자처럼 보여도
     * **글자로 둔다** — 사람이 정한 분류 이름이지 셈하는 값이 아니고, 앞으로 `301A` 같은 것이
     * 생기지 못할 이유가 없다.
     */
    code: text("code").notNull(),
    /** 사람이 알아보는 이름. 코드만으로는 무엇인지 알 수 없다. */
    name: text("name").notNull(),
    note: text("note"),
    /**
     * 🔴 **낙관적 잠금(optimistic lock).** 고칠 때 「내가 화면에 띄워 둔 판 번호」와 맞는지 보고,
     * 맞을 때만 +1 하며 저장한다(원본 `mutations/oh-part-templates.ts` 의 `expectedVersion` 검사).
     *
     * 이 칸이 없으면 두 사람이 같은 템플릿을 동시에 고칠 때 **나중에 저장한 사람이 앞사람 것을
     * 조용히 덮는다.** 덮인 쪽은 자기 저장이 성공했다고 믿으므로 아무도 알아차리지 못한다.
     *
     * 🔵 저장이 중간에 거절되면 version 증가까지 **함께 되돌려야 한다** — 실패한 저장이 판 번호만
     * 올려놓고 끝나면 화면은 다음 저장에서 이유 없이 충돌을 만난다(원본 머리말).
     */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * 누가 만들고 누가 마지막으로 고쳤는지. 🔵 **FK 를 걸지 않는다** — 이 저장소의 관례다
     * (`parts.deleted_by` · `stock_request_issues.issued_by` 도 FK 가 없다).
     */
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    // 소프트 삭제 4컬럼 (이름·개수 고정, CLAUDE.md 11절)
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    deleteReason: text("delete_reason"),
  },
  (t) => [
    /**
     * 지운 템플릿의 코드는 다시 쓸 수 있게 — 이 저장소의 부분 unique 관례.
     * CLAUDE.md 11절이 요구하는 `WHERE is_deleted = false` 부분 인덱스가 이것이다.
     *
     * 🔴 차례용 인덱스(`oh_part_templates_not_deleted_idx`)는 **일부러 없앴다.** 원본 화면에
     * 차례 바꾸기가 없고 목록을 **코드 순**(`ORDER BY code`)으로 본다. 쓰지 않는 `sort_order`
     * 칸을 남겨 두면 다음 사람이 「왜 안 쓰지」를 묻다가 되살린다.
     */
    uniqueIndex("oh_part_templates_code_uq").on(t.code).where(sql`${t.isDeleted} = false`),
  ],
);

/**
 * 템플릿에 든 부품 한 줄.
 *
 * append-only 가 아니다 — 사람이 고치는 설정이라 줄을 고치고 지운다. 템플릿을 지우면
 * `ON DELETE CASCADE` 로 함께 사라진다(소프트 삭제에서는 돌지 않는다).
 *
 * 🔵 **한 템플릿에 13줄이 상한이지만 DB 제약으로 걸지 않는다.** 원본도 입력 검사에서 막는다
 * (`MAX_OH_TEMPLATE_ITEMS = 13`). 까닭은 **OH 견적서 양식의 부품 칸이 34~46행**이기 때문이다 —
 * 더 담아 두면 견적서를 만들 때 넘치는 줄이 갈 곳이 없고, 그때 조용히 자르면 청구할 부품이
 * 문서에서 사라진다.
 */
export const ohPartTemplateItems = pgTable(
  "oh_part_template_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => ohPartTemplates.id, { onDelete: "cascade" }),
    /**
     * 차례. **1부터 매기며 저장하는 쪽이 매긴다.** 양식의 부품 순서가 그대로 뜻을 갖는다
     * (휴즈 22개가 셋째 줄인 것에는 이유가 있다).
     */
    displayOrder: integer("display_order").notNull(),
    /**
     * 재고 마스터 연결. 🔴 **비는 것이 정상이다.** 양식에서 옮겨 온 이름 중에 재고 마스터에
     * 없는 것이 있고(`유량계` 같은), 그렇다고 그 줄을 버리면 템플릿이 반쪽이 된다.
     * 연결이 없으면 부품 요청에 담을 때 **이름만 담고 사람에게 알린다.**
     *
     * RESTRICT 는 이 저장소가 `parts` 를 가리키는 다른 표들과 같은 규칙이고, `parts` 가
     * 소프트 삭제를 쓰므로 실제로 막힐 일은 없다.
     */
    partId: uuid("part_id").references(() => parts.id, { onDelete: "restrict" }),
    /**
     * 양식에 적혀 있던 이름 그대로. `part_id` 가 있어도 이 칸을 쓴다 — 화면에서 친 글자가
     * 그대로 견적서에 찍히는 값이라, 재고 쪽 품명이 나중에 바뀌어도 양식은 흔들리지 않는다.
     */
    partNameText: text("part_name_text").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("oh_part_template_items_template_order_uq").on(t.templateId, t.displayOrder),
    index("oh_part_template_items_template_idx").on(t.templateId),
    index("oh_part_template_items_part_idx").on(t.partId),
    check("oh_part_template_items_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

/**
 * ============================================================================
 * 제품 모델 ↔ 템플릿 — 사람이 잇는다
 * ============================================================================
 * 「이 제품 모델의 O/H 부품은 이 템플릿」을 사람이 화면에서 고른다(원본 화면에 그 고르개가 있다).
 *
 * ── 🔴 `product_model_id` 에 FK 를 걸 수 없다 ────────────────────────────
 * **제품 모델 표가 이 시스템에 없다.** 제품 모델(105개)은 A/S 관리 시스템이 가지고 있고,
 * 재고 관리는 그것을 받아 온다. 그래서 **A/S 의 ID 를 글자(uuid 값)로 적어 둘 뿐**이고
 * 데이터베이스가 그 존재를 지켜 줄 수는 없다. 원본(A/S)에서는 같은 칸이
 * `product_models.id` 를 가리키는 진짜 FK 다 — 여기서만 다르다.
 *
 * ── 🔴 `product_model_name` 을 함께 적는 까닭 ───────────────────────────
 * A/S 가 꺼져 있거나 그 모델이 없어져도 화면에 **「어느 모델인지」가 남아야 한다.** 이름은
 * **받아 올 때 떠 온 사본**이고 정본은 언제나 A/S 다 — 나중에 A/S 에서 이름이 바뀌어도 여기 값은
 * 따라 바뀌지 않는다. 이 저장소가 이미 같은 방식을 쓴다: `stock_request_issues` 가
 * `issued_by`(누구)와 `issued_by_name`(그때의 이름)을 둘 다 적는다.
 * ============================================================================
 */
export const ohPartTemplateModels = pgTable(
  "oh_part_template_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => ohPartTemplates.id, { onDelete: "cascade" }),
    /** A/S 의 `product_models.id`. 🔴 FK 없음 — 그 표가 이 시스템에 없다(위 머리말). */
    productModelId: uuid("product_model_id").notNull(),
    /** 받아 올 때의 이름 사본. 정본은 A/S 다(위 머리말). */
    productModelName: text("product_model_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** 누가 이었는지. FK 없음 — 이 저장소의 관례. */
    createdBy: uuid("created_by"),
  },
  (t) => [
    /**
     * 🔴 **이것이 이 표의 요점이다 — 모델 하나는 템플릿 하나에만 붙는다.** 둘에 걸리면
     * 「이 모델의 O/H 부품」이 두 가지가 되어, 부품 요청에서 무엇을 담을지 답할 수 없다.
     */
    uniqueIndex("oh_part_template_models_model_uq").on(t.productModelId),
    index("oh_part_template_models_template_idx").on(t.templateId),
  ],
);

/**
 * ============================================================================
 * O/H 단가 — 오버홀 작업일 때 그 부품을 얼마로 청구하는가
 * ============================================================================
 * 같은 부품이라도 **오버홀(O/H) 견적서에 오를 때와 일반 수리 견적서에 오를 때 청구 단가가
 * 다르다.** 일반 단가(`parts.quote_price`) 한 벌만 두면 O/H 견적서도 일반 단가로 나간다.
 * 그래서 O/H 쪽 값을 담을 표를 따로 둔다.
 *
 * 🔵 **표 이름을 원본(A/S)과 똑같이 `part_overhaul_unit_prices` 로 둔다** — 나중에 A/S 의 운영
 * 값을 옮겨 올 때 어느 표가 어느 표인지 헷갈리지 않는다.
 *
 * ── 🔴 왜 `parts` 에 칸을 더하지 않았나 ─────────────────────────────────
 * 2026-10-14 사용자 결정: **재고 현황 표와 엑셀 한 벌에 O/H 단가가 나가면 안 된다.**
 * `parts` 에 칸을 더하면 `select()` 전체 조회를 쓰는 목록·내려받기·엑셀 한 벌에 그 값이
 * 자동으로 따라 나간다. 표를 따로 두는 것이 그 결정을 지키는 길이다.
 *
 * ── 🔴 「행이 없다」와 「0을 저장했다」는 다른 뜻이다 ────────────────────
 *   · **행이 없다**    = O/H 단가를 정하지 않았다. O/H 견적서는 그 칸을 **비워 두고** 사람이
 *                       채우게 한다.
 *   · **0을 저장했다** = 오버홀 때는 무상으로 주는 부품이다. 견적서에 0원으로 적어 보인다.
 * 그래서 화면에서 칸을 비우면 0을 저장하지 않고 **행을 지운다**(원본 머리말). 비운 것을 0으로
 * 저장해 버리면 「정하지 않음」을 다시 표현할 방법이 사라지고, O/H 견적서가 정하지 않은 부품을
 * 0원으로 청구하게 된다. 읽는 쪽도 없는 부품을 「0」으로 채우지 않는다.
 *
 * ── 🔵 금액은 `bigint`(원 단위)다 — 원본의 `numeric(15,2)` 와 다르다 ────
 * 까닭 둘:
 *   ① A/S 운영 값 12개를 재어 보니 **소수점이 하나도 없다**(전부 정수 원).
 *   ② 이 저장소의 돈 칸이 전부 `bigint` 다(`parts.quote_price` · `parts.supply_price`). 견적가와
 *      나란히 놓고 보게 될 값이라 모양이 같아야 한다 — 한쪽은 문자열, 한쪽은 숫자로 읽히면
 *      비교·합계마다 변환이 끼어든다.
 * (원본이 `numeric` 인 까닭은 「double 로 두면 오차가 쌓여 세금계산서와 1원씩 어긋난다」였다.
 *  정수 원만 다루는 `bigint` 에는 그 오차가 애초에 없다.)
 *
 * ── 🔵 `ON DELETE RESTRICT` — 원본은 cascade 다 ─────────────────────────
 * `restrict` 는 이 저장소가 `parts` 를 가리킬 때의 관례이고(`oh_part_template_items.part_id` 도
 * 같다), `parts` 가 소프트 삭제를 쓰므로 실제로 막힐 일은 없다. 원본은 완전삭제 정리 작업
 * (`purgeExpiredPart`)이 FK 오류로 멈추지 않도록 cascade 지만, 이 저장소에는 그 정리가 없다.
 *
 * ── 대리 키를 쓰는 까닭 ─────────────────────────────────────────────────
 * 부품마다 한 줄뿐이라 `part_id` 자체를 기본 키로 삼을 수도 있었다. 그러지 않은 것은 감사 로그가
 * 대상 레코드 id 로 uuid 하나를 요구하고, 그 uuid 가 부품 id 와 달라야 「부품을 고쳤다」와
 * 「그 부품의 O/H 단가를 고쳤다」가 감사 로그에서 섞이지 않기 때문이다.
 * 「부품마다 한 줄」은 `part_id` 의 UNIQUE 로 DB 가 지킨다.
 * ============================================================================
 */
export const partOverhaulUnitPrices = pgTable(
  "part_overhaul_unit_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    /**
     * 오버홀 작업 때의 원화 단가(부가세 별도). 0 이상이며 그 규칙은 아래 CHECK 가 DB 에서
     * 강제한다. 입력 검사도 같은 규칙을 따로 본다 — 화면을 거치지 않고 부른 경우에도 음수가
     * 들어오지 못하게.
     */
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    /** 누가 마지막으로 값을 바꿨는지. 되돌릴 사람을 찾을 때 감사 로그보다 먼저 보게 된다. FK 없음 — 관례. */
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** 🔴 부품당 한 줄. 두 줄이 되면 어느 값으로 청구할지 DB 가 답하지 못한다. */
    uniqueIndex("part_overhaul_unit_prices_part_uq").on(t.partId),
    check("part_overhaul_unit_prices_not_negative", sql`${t.unitPrice} >= 0`),
  ],
);

export type OhPartTemplate = typeof ohPartTemplates.$inferSelect;
export type NewOhPartTemplate = typeof ohPartTemplates.$inferInsert;
export type OhPartTemplateItem = typeof ohPartTemplateItems.$inferSelect;
export type NewOhPartTemplateItem = typeof ohPartTemplateItems.$inferInsert;
export type OhPartTemplateModel = typeof ohPartTemplateModels.$inferSelect;
export type NewOhPartTemplateModel = typeof ohPartTemplateModels.$inferInsert;
export type PartOverhaulUnitPrice = typeof partOverhaulUnitPrices.$inferSelect;
export type NewPartOverhaulUnitPrice = typeof partOverhaulUnitPrices.$inferInsert;
