import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * 설정값 — 열쇠 하나에 글자 하나 (DESIGN 2-7절). 지금은 **전환일** 하나뿐이다.
 *
 * 🔴 전환일을 코드에 적지 않는다 (DESIGN 10-3절 7번: 전환이 미뤄져도 코드를 안 고치게). 실제 자료를 넣는 날
 *    가져오기 스크립트가 적어 넣고, 화면의 「전환일 이전/이후」 문구와 이력 구역 나누기가 전부 이 값을 읽는다.
 *    자료를 넣기 전에는 줄이 없고 화면은 「전환 전」으로 보인다.
 * 환경변수가 아닌 이유: 전환일은 실행 환경 값이 아니라 **자료의 일부**다 — DB 를 백업하면 같이 따라가야 한다.
 */
export const appSettings = pgTable(
  "app_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** 바꾼 사람(users.id). 스크립트가 적은 것은 null 이고 이름 칸에 스크립트 이름을 남긴다. */
    updatedBy: uuid("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
  },
  (t) => [uniqueIndex("app_settings_key_uq").on(t.key)],
);

/** 설정 열쇠. 값은 YYYY-MM-DD. */
export const SETTING_TRANSITION_DATE = "transition_date";

export type AppSetting = typeof appSettings.$inferSelect;
