import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parts } from "./parts";
import { users } from "./users";

/**
 * 즐겨찾기 — 사람마다 별표를 붙인 부품 (2026-10-07 사용자 요청: 목록에서 별을 누르면 그 부품이 위에 보인다).
 *
 * 사람(users)별이다. 브라우저 저장소가 아니라 DB 인 이유: 같은 사람이 PC 와 휴대폰에서 같은 별을 봐야 하고,
 * 포털 계정 하나가 곧 사람 하나다(CLAUDE.md 8절). 역할과 상관없이 로그인한 사람이면 누구나 쓴다 — 개인 편의지 권한이 아니다.
 * 지우면 물리 삭제한다 — 되돌릴 가치가 없는 개인 표시라 소프트 삭제 4칸을 두지 않는다(감사 로그도 안 남긴다).
 */
export const partFavorites = pgTable(
  "part_favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("part_favorites_user_part_uq").on(t.userId, t.partId), index("part_favorites_user_idx").on(t.userId)],
);

export type PartFavorite = typeof partFavorites.$inferSelect;
