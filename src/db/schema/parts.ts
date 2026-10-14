import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, pgSequence, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { categoryEnum, currencyEnum, ownerEnum } from "./codes";
import { partItems } from "./part-items";

/**
 * 부품 No. 번호표 (DESIGN 4-3절). 🔴 **지워도, 저장이 실패해도 그 번호는 다시 나오지 않는다.**
 * 시퀀스는 트랜잭션이 되돌아가도 값을 되감지 않으므로 그 성질이 공짜로 따라온다.
 *
 * 엑셀 가져오기(조각 5)는 현황판의 No.(1~319)를 그대로 넣고 `setval` 로 번호표를 그 뒤로 옮긴다.
 * 그래서 identity 컬럼이 아니라 따로 둔 시퀀스 + DEFAULT nextval 이다 — 명시한 값도 받을 수 있어야 한다.
 */
export const partsNoSeq = pgSequence("parts_no_seq", { startWith: 1, increment: 1, minValue: 1 });

/**
 * 부품 (DESIGN 4-3절). 한 줄 = No. 하나. 같은 부품이라도 소유가 다르면 다른 No. (REQUIREMENTS 4-1절).
 *
 * - `no`: 사람이 읽고, 바깥 시스템에 내주는 값. UNIQUE. 재매김 없음.
 * - `name2`·`kyosan_part_no`·`drawing_no`·`note`: 없으면 **빈 문자열**. 엑셀에는 `-` 로 쓴다(DESIGN 4-3절).
 *   null 을 쓰지 않는 이유: 찾기·정렬·엑셀 쓰기에서 "없음" 을 한 가지로만 다루기 위해서다.
 * - `supply_price`·`quote_price`: 없으면 **null** (금액은 0 과 "모름" 이 다르다). 정수(엔·원에 소수가 없다).
 * - 수량은 이 표에 없다. `stock_balances` 가 들고 있고, 원장(조각 4)의 합이 진실이다 (CLAUDE.md 11절).
 * - 품명·품명2·도번·소유가 같은 부품이 여럿 있을 수 있다(16묶음) → UNIQUE 를 걸지 않고 등록 때 경고만 (조각 3).
 */
export const parts = pgTable(
  "parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    no: integer("no")
      .notNull()
      .default(sql`nextval('parts_no_seq')`),
    name: text("name").notNull(),
    name2: text("name2").notNull().default(""),
    /**
     * 고객사 품명 — 고객사에 나가는 서류(견적서)에 쓸 이름. 우리 품명(`name`)과 다르다 (2026-10-14 사용자 결정).
     * 한 부품에 하나라 따로 표를 두지 않고 칸 하나로 둔다. 없으면 **빈 문자열**(위 머리말의 관례).
     * 🔵 엑셀 한 벌·내려받기는 부품과 **별개 타입**에 칸을 손으로 옮겨 적으므로 이 칸은 저절로 나가지 않는다.
     */
    customerName: text("customer_name").notNull().default(""),
    kyosanPartNo: text("kyosan_part_no").notNull().default(""),
    drawingNo: text("drawing_no").notNull().default(""),
    supplyPrice: bigint("supply_price", { mode: "number" }),
    supplyCurrency: currencyEnum("supply_currency").notNull().default("JPY"),
    /** 견적가. 항상 원. */
    quotePrice: bigint("quote_price", { mode: "number" }),
    note: text("note").notNull().default(""),
    itemId: uuid("item_id")
      .notNull()
      .references(() => partItems.id),
    category: categoryEnum("category").notNull(),
    owner: ownerEnum("owner").notNull(),
    /** 만든·고친 사람(users.id). 가져오기 스크립트가 넣은 줄은 null. */
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // 소프트 삭제 4컬럼 (이름·개수 고정, CLAUDE.md 11절)
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    deleteReason: text("delete_reason"),
  },
  (t) => [
    uniqueIndex("parts_no_uq").on(t.no),
    index("parts_not_deleted_idx").on(t.no).where(sql`${t.isDeleted} = false`),
    index("parts_item_idx").on(t.itemId),
  ],
);

export type Part = typeof parts.$inferSelect;
export type NewPart = typeof parts.$inferInsert;
