import { bigint, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * 엑셀 한 벌의 상태 — **한 줄만 있다** (DESIGN 4-6절·6-5절, REQUIREMENTS 6절 「덮어쓰기 사고를 막는 장치」).
 *
 *  - `dirty_at`: 수량·부품이 바뀌어 「써야 함」이 된 시각. 쓰고 나면 null. 서버가 다시 켜져도 DB 에 있어 잃지 않는다.
 *  - `written_at`·`written_size`·`written_sha256`: 마지막으로 **우리가** 쓴 파일의 시각·크기·지문. 쓰기 전에 지금 파일과 맞춰 본다.
 *  - `status`: OK(정상) / PARKED(사람이 손대 멈춤 — 그 파일을 치워 두고 관리자가 [다시 쓰기 시작]을 눌러야 다시 씀) / ERROR(쓰기 실패, 다음 차례에 다시).
 *  - `parked_file`: 치워 둔 파일 **이름**(폴더 아닌 이름만 — 절대경로를 DB 에 두지 않는다, CLAUDE.md 12-1절 1번).
 *  - `error_message`·`error_count`: 마지막 실패 사유와 연속 실패 횟수(여러 번 실패하면 관리자에게 알린다).
 */
export const WORKBOOK_STATUSES = ["OK", "PARKED", "ERROR"] as const;
export type WorkbookStatus = (typeof WORKBOOK_STATUSES)[number];
export const workbookStatusEnum = pgEnum("workbook_status", WORKBOOK_STATUSES);

export const workbookStates = pgTable("workbook_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: workbookStatusEnum("status").notNull().default("OK"),
  dirtyAt: timestamp("dirty_at", { withTimezone: true }),
  writtenAt: timestamp("written_at", { withTimezone: true }),
  writtenSize: bigint("written_size", { mode: "number" }),
  writtenSha256: text("written_sha256"),
  parkedFile: text("parked_file"),
  parkedAt: timestamp("parked_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  errorCount: integer("error_count").notNull().default(0),
  /** [다시 쓰기 시작]을 누른 사람 */
  resumedBy: uuid("resumed_by"),
  resumedByName: text("resumed_by_name"),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkbookState = typeof workbookStates.$inferSelect;
