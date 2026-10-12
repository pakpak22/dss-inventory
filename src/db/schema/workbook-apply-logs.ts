import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * [엑셀 기준 적용] 기록 (조각 8-B, DESIGN 6-6절, 계획 docs/조각8B_계획_2026-10-12.md 6절). **append-only** — 지우지 않는다.
 *
 * 왜 따로 표를 두나: 치워 둔 파일 하나를 **두 번 원장에 적지 않게**(멱등). 치워 둔 파일의 sha256 에 UNIQUE 를 걸어
 * 같은 파일이 다시 적용되면 DB 가 거절한다. 적용 때 쓴 기록(entry) id 들을 함께 남겨 「이 적용으로 어느 줄이 생겼나」를 되짚을 수 있다.
 * 되돌리기는 자동으로 하지 않는다 — 건마다 기록 취소(CORRECTION)로(원장은 고치지 않는다, CLAUDE.md 11절).
 *
 * `parked_file` 은 이름만(절대경로를 DB 에 두지 않는다, CLAUDE.md 12-1절 1번).
 */
export const workbookApplyLogs = pgTable(
  "workbook_apply_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parkedFile: text("parked_file").notNull(),
    parkedSha256: text("parked_sha256").notNull(),
    /** 관리자가 확인 화면에서 본 계획의 지문 — 적용 때 다시 세운 계획과 같아야 한다 */
    planFingerprint: text("plan_fingerprint").notNull(),
    /** 관리자가 적은 사유(필수) */
    reason: text("reason").notNull(),
    appliedBy: uuid("applied_by").notNull(),
    appliedByName: text("applied_by_name").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    /** 이 적용으로 원장에 쓰인 기록 머리 id 들 */
    entryIds: jsonb("entry_ids").$type<string[]>().notNull(),
    entryCount: integer("entry_count").notNull(),
    /** 자동 반영하지 않고 사람에게 남긴 줄 수 (확인 화면에 보였던 수) */
    skippedCount: integer("skipped_count").notNull().default(0),
    /** 화면용 요약(종류별 건수 등) */
    summary: text("summary").notNull().default(""),
  },
  (t) => [uniqueIndex("workbook_apply_logs_sha_uq").on(t.parkedSha256)],
);

export type WorkbookApplyLog = typeof workbookApplyLogs.$inferSelect;
