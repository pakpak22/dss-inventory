import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parts } from "./parts";

/**
 * ============================================================================
 * O/H 부품 템플릿 — 기종마다 「오버홀이면 이 부품들을 이만큼」
 * ============================================================================
 * O/H(오버홀) 작업을 할 때 그 기종에 늘 들어가는 부품과 수량을 미리 적어 두는 목록이다.
 * A/S 관리 시스템에서 옮겨 온다(2026-10-14, 조각 5a).
 *
 * 원래 이 목록은 **견적서 OH 양식의 숨은 열**에 살았다(`OH견적서` 시트, `K11` 에 기종 코드를
 * 넣으면 수식이 그 기종 것을 꺼내 왔다). 그 방식의 문제는 셋이었다:
 *
 *  1. 부품 하나를 고치려면 숨긴 열을 다시 펴서 엑셀을 고쳐야 한다.
 *  2. 기종이 늘면 수식을 직접 고쳐야 하고, 실제로 목록에 있는 `302` 는 수식에 빠져 있어
 *     고르면 빈칸이 나왔다.
 *  3. 재고(`parts`)와 이어져 있지 않아, 부품을 요청할 때 사람이 이름을 보고 다시 찾아야 한다.
 *
 * 그래서 자기 표로 옮긴다. 옮기고 나면 **재고 관리 화면에서 고칠 수 있고**, 부품 요청에
 * 한 번에 담을 수 있다.
 *
 * ── 기종 코드만 안다 ────────────────────────────────────────────────────────
 * 🔴 원본(A/S)에는 「제품 모델 ↔ 템플릿」을 잇는 셋째 표가 있지만 **여기로 옮기지 않았다**
 * (2026-10-14 결정). 재고 관리에는 제품 모델 표가 없고, 그 잇기는 A/S 쪽에 남긴다.
 * 재고 관리가 아는 것은 템플릿의 **기종 코드**뿐이다.
 *
 * ── 부품 연결은 있으면 좋은 것이지 필수가 아니다 ──────────────────────────
 * `part_id` 는 NULL 을 허용한다. 양식에서 옮겨 온 이름 중에는 재고 마스터에 없는 것이 있고
 * (`유량계` 처럼), 그렇다고 그 줄을 버리면 템플릿이 반쪽이 된다.
 *
 * ── 삭제는 소프트다 ────────────────────────────────────────────────────────
 * 템플릿은 사람이 만든 설정이고 되돌릴 수 있어야 한다(CLAUDE.md 11절). 딸린 줄(items)은
 * 템플릿에 속한 값이라 `ON DELETE CASCADE` 이고, 소프트 삭제일 때는 돌지 않는다.
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
    /** 고르기 목록의 차례. 관리자가 바꾼다(`part_items.sort_order` 와 같은 관례). */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // 소프트 삭제 4컬럼 (이름·개수 고정, CLAUDE.md 11절)
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    deleteReason: text("delete_reason"),
  },
  (t) => [
    /** 지운 템플릿의 코드는 다시 쓸 수 있게 — 이 저장소의 부분 unique 관례. */
    uniqueIndex("oh_part_templates_code_uq").on(t.code).where(sql`${t.isDeleted} = false`),
    index("oh_part_templates_not_deleted_idx").on(t.sortOrder).where(sql`${t.isDeleted} = false`),
  ],
);

/**
 * 템플릿에 든 부품 한 줄.
 *
 * append-only 가 아니다 — 사람이 고치는 설정이라 줄을 고치고 지운다. 템플릿을 지우면
 * `ON DELETE CASCADE` 로 함께 사라진다(소프트 삭제에서는 돌지 않는다).
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
    /** 양식에 적혀 있던 이름 그대로. `part_id` 가 있어도 이 칸을 쓴다. */
    partNameText: text("part_name_text").notNull(),
    quantity: integer("quantity").notNull(),
    /**
     * 🔴 **O/H 작업 때의 원화 단가(부가세 별도).**
     *
     * - **비어 있으면 일반 단가(`parts.quote_price`)로 대신 채우지 않고 빈칸으로 둔다.**
     *   A/S 의 지금 규칙을 그대로 살린 것이다.
     * - 🔴 **이 값은 「그 템플릿에서의」 값이다 — 부품마다 하나가 아니다**(2026-10-14 사용자 결정).
     *   원본(A/S)은 O/H 단가를 부품마다 하나씩 별도 표에 두지만, 여기서는 **템플릿 줄에 붙인다.**
     *   같은 부품이 템플릿 여러 개에 들어 있을 수 있고(개발 DB 실측: 최대 3개), 그때 값이 서로
     *   달라도 되고 어긋나도 시스템은 모른다. **알고 고른 것이다 — 부품당 하나로 합치지 마라.**
     *   어긋남은 화면이 옆에 보여 주는 것으로 다룬다(조각 5b).
     */
    ohPrice: bigint("oh_price", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("oh_part_template_items_template_order_uq").on(t.templateId, t.displayOrder),
    index("oh_part_template_items_template_idx").on(t.templateId),
    index("oh_part_template_items_part_idx").on(t.partId),
    check("oh_part_template_items_quantity_positive", sql`${t.quantity} > 0`),
    /** `oh_price` 는 비어도 되므로 NULL 은 이 검사를 그냥 지나간다(SQL 의 CHECK 규칙). */
    check("oh_part_template_items_oh_price_not_negative", sql`${t.ohPrice} >= 0`),
  ],
);

export type OhPartTemplate = typeof ohPartTemplates.$inferSelect;
export type NewOhPartTemplate = typeof ohPartTemplates.$inferInsert;
export type OhPartTemplateItem = typeof ohPartTemplateItems.$inferSelect;
export type NewOhPartTemplateItem = typeof ohPartTemplateItems.$inferInsert;
