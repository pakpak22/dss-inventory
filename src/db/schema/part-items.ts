import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * 항목 — 부품의 종류 (PCB, 판금, 콘덴서 …). 지금 19종 (REQUIREMENTS 4-1절, DESIGN 4-1절).
 *
 * 소유·분류와 달리 enum 이 아니라 표인 이유: **새 항목을 관리자가 화면에서 더한다**(DESIGN 2-7절 설정).
 * enum 이면 항목 하나 늘릴 때마다 마이그레이션이 필요하다.
 *
 * - `code`: 영문 코드값. 바깥에 내주거나 엑셀 가져오기에서 대조하는 열쇠. UNIQUE.
 * - `name`: 화면과 엑셀에 보이는 한글 이름. 엑셀 현황판의 「항목」 칸 글자와 같다.
 * - `sort_order`: 고르기 목록의 차례. 관리자가 바꾼다.
 */
export const partItems = pgTable(
  "part_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
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
    uniqueIndex("part_items_code_uq").on(t.code),
    index("part_items_not_deleted_idx").on(t.sortOrder).where(sql`${t.isDeleted} = false`),
  ],
);

export type PartItem = typeof partItems.$inferSelect;
export type NewPartItem = typeof partItems.$inferInsert;
