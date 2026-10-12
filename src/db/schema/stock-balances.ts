import { sql } from "drizzle-orm";
import { check, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { parts } from "./parts";

/**
 * 현재 수량 — **원장의 투영(캐시)** 이다 (CLAUDE.md 11절, DESIGN 4-3절).
 *
 * 수량의 정본은 `stock_transactions`(조각 4)의 부호 있는 증감의 합이고, 이 표는 목록을 빨리 그리려고
 * 그 합을 들고 있을 뿐이다. 🔴 수량을 바꾸는 일은 **원장에 줄을 쌓는 것과 이 값을 고치는 것을
 * 한 트랜잭션 안에서** 한다. 둘 중 하나만 되는 일은 없다. 이 표만 직접 UPDATE 하는 코드를 만들지 마라.
 *
 * `quantity >= 0` 은 DB 제약(CHECK)이다. 화면 검사만 믿지 않는다.
 * 조각 2 에서는 시드가 처음 수량을 넣는다(원장이 아직 없다). 조각 4 가 들어오면 「처음 수량(OPENING)」
 * 기록으로 바뀐다 — DESIGN 4-1절 기록 종류.
 */
export const stockBalances = pgTable(
  "stock_balances",
  {
    partId: uuid("part_id")
      .primaryKey()
      .references(() => parts.id),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("stock_balances_quantity_nonnegative", sql`${t.quantity} >= 0`)],
);

export type StockBalance = typeof stockBalances.$inferSelect;
