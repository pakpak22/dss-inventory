import { sql } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * 역할 — 포털에 등록한 `available_roles` 와 글자 하나까지 같아야 한다 (REQUIREMENTS 10절, 포털등록값 4절).
 * 모르는 값이 들어오면 로그인을 거절한다 (src/lib/auth/role.ts). A/S 의 역할 5개를 베끼지 않았다.
 */
export const ROLES = ["VIEWER", "STAFF", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];
export const roleEnum = pgEnum("role", ROLES);

/**
 * 이 시스템에 들어온 사람. 신원과 역할은 포털이 준다 — 여기에는 **포털의 `sub` 를 열쇠로** 사본만 둔다.
 *
 * - `auth_sub` 가 사람을 잇는 유일한 영구 식별자다. 이메일·이름은 표시용이고 바뀔 수 있다 (CLAUDE.md 6-6절).
 * - `sessions_valid_from`: 포털에서 로그아웃(백채널)하면 이 선을 올리고, 그보다 먼저 발급된
 *   세션을 매 요청마다 거절한다. 이것이 없으면 포털에서 로그아웃해도 이 시스템은 열려 있다 (6-8절).
 * - 소프트 삭제 4컬럼은 이 표에도 둔다 (11절 규칙). 사람을 지우는 일은 없지만 규칙은 예외 없이.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authSub: text("auth_sub").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    role: roleEnum("role").notNull(),
    /** 이 시각보다 먼저 발급된 세션은 무효. 백채널 로그아웃이 올린다. */
    sessionsValidFrom: timestamp("sessions_valid_from", { withTimezone: true }).notNull().defaultNow(),
    /** 마지막 로그인의 포털 세션 id(sid). 백채널 logout_token 이 sub 없이 sid 만 들고 올 때 사람을 찾는 열쇠 */
    lastSid: text("last_sid"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // 소프트 삭제 4컬럼 (이름·개수 고정)
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    deleteReason: text("delete_reason"),
  },
  (t) => [
    uniqueIndex("users_auth_sub_uq").on(t.authSub),
    index("users_not_deleted_idx").on(t.id).where(sql`${t.isDeleted} = false`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
