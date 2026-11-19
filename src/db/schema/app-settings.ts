import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * 설정값 — 열쇠 하나에 글자 하나 (DESIGN 2-7절). 지금은 **전환일**과 **도번 표시 모양** 둘이다.
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

/**
 * 도번 표시 모양 (2026-11-20). 값은 **JSON 글자 한 덩이**다 —
 * `{"pill":true,"fontSize":15,"textColor":"#1d4ed8","pillColor":"#dbeafe"}`.
 *
 * 🔴 **마이그레이션이 없다.** 이 표는 열쇠 하나에 글자 하나인 꼴이라 **열쇠만 더하면** 된다.
 * 🔴 **넷으로 쪼개 네 줄로 두지 않는다**: 저장이 중간에 끊기면 「셋만 저장된 반쪽」이 생기고,
 *    기본값을 적어 둘 자리가 네 군데로 흩어진다(까닭은 `src/lib/stock/drawing-no-style.ts` 머리말).
 * 🔴 **읽는 쪽이 반드시 검증한다.** 글자 칸이라 사람이 손으로 아무 값이나 넣을 수 있고, 판이
 *    바뀌면 저장해 둔 모양이 지금 모양과 다르다 — 깨졌으면 기본값으로 떨어지고 화면은 선다
 *    (`parseDrawingNoStyle`).
 * 🔵 **환경변수가 아닌 까닭**은 전환일과 같다: 쓰는 분이 화면에서 고치는 값이라 **자료의 일부**다.
 */
export const SETTING_DRAWING_NO_STYLE = "drawing_no_style";

export type AppSetting = typeof appSettings.$inferSelect;
