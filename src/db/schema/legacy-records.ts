import { date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parts } from "./parts";

/**
 * 과거 기록 — 엑셀 사용처 기입란·입고 기입란의 한 줄을 **적힌 그대로** 담는다 (DESIGN 4-5절, 조각 5).
 *
 * 🔴 수량 계산에 쓰지 않는다. 엑셀의 현 재고·이후 재고가 서로 안 맞는 곳이 있어 과거 기록을 더해서는
 *    지금 수량이 나오지 않는다 (REQUIREMENTS 12절). 원장(`stock_transactions`)과 섞지 않고 화면도 구역을 가른다.
 * 🔴 고치지 않는다. 담당자 이름(「수리/정연빈」 오타 포함)·소유 글자·`-` 전부 엑셀 글자 그대로. 담당자별로 셀 때만 합친다.
 *    그래서 소유도 enum 이 아니라 글자(`owner_text`)다 — 엑셀에 「보수부재」로 적힌 것을 코드로 바꾸면 「그대로」가 아니다.
 * 🔴 지우지 않는다. 가져오기는 한 번이고 다시 넣으려면 DB 를 통째로 다시 만든다. 소프트 삭제 4칸도 두지 않는다(append-only, 감사 로그와 같다).
 *
 * 맞는 부품이 없는 26건은 넣지 않고 CSV 로 남긴다 (답변서). 그래서 `part_id` 는 NOT NULL 이다.
 */
export const LEGACY_SHEETS = ["USE", "RECEIVE"] as const;
export type LegacySheet = (typeof LEGACY_SHEETS)[number];
export const legacySheetEnum = pgEnum("legacy_sheet", LEGACY_SHEETS);

/**
 * 부품을 어떻게 붙였나 (DESIGN 5절 네 갈래 중 넣는 셋).
 *  - CONFIRMED: 품명·품명2·도번·소유가 같은 No. 가 하나뿐 → 그대로
 *  - GROUP_DECIDED: 같은 것이 여럿(16묶음) → 묶음 판정표(`과거기록_묶음판정_2026-10-02.csv`)대로
 *  - OWNER_MISMATCH: 같은 부품은 있는데 그 소유의 No. 가 없음 → 하나뿐이면 거기에, 여럿이면 No. 가 앞선 것에. **연도별 사용 수량에서 뺀다**
 */
export const LEGACY_MATCH_STATUSES = ["CONFIRMED", "GROUP_DECIDED", "OWNER_MISMATCH"] as const;
export type LegacyMatchStatus = (typeof LEGACY_MATCH_STATUSES)[number];
export const legacyMatchStatusEnum = pgEnum("legacy_match_status", LEGACY_MATCH_STATUSES);

export const legacyRecords = pgTable(
  "legacy_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sheet: legacySheetEnum("sheet").notNull(),
    /** 엑셀의 몇째 줄이었나 (머리글이 1행). 판정표·CSV 와 잇는 열쇠. */
    sourceRow: integer("source_row").notNull(),
    /** 엑셀 No. 칸 값. 비어 있던 줄(같은 건의 둘째 줄부터)은 null. */
    sheetNo: integer("sheet_no"),
    /** 날짜. 날짜로 읽히지 않은 글자(예: `2023-07-**`)면 null 이고 `date_text` 에 그대로 남는다. */
    occurredOn: date("occurred_on", { mode: "string" }),
    dateText: text("date_text").notNull().default(""),
    /** 인수번호 칸 글자 그대로 (`一`·`상해수리소`·`Ｄ240401` 같은 것도 그대로). 입고는 빈 값. */
    intakeNumber: text("intake_number").notNull().default(""),
    name: text("name").notNull().default(""),
    name2: text("name2").notNull().default(""),
    drawingNo: text("drawing_no").notNull().default(""),
    kyosanPartNo: text("kyosan_part_no").notNull().default(""),
    /** 현 재고 · 사용(입고) 수량 · 이후 재고. 숫자가 아닌 칸은 null 이고 `anomaly` 에 적힌 글자를 남긴다. */
    stockBefore: integer("stock_before"),
    quantity: integer("quantity"),
    stockAfter: integer("stock_after"),
    /** 「수리/정영빈」 같은 글자 그대로. **계정에 잇지 않는다.** 입고는 빈 값. */
    purposeText: text("purpose_text").notNull().default(""),
    note: text("note").notNull().default(""),
    ownerText: text("owner_text").notNull().default(""),
    /** 사용처 기입란 「발주현황」 칸 — 유상·무상이 적혀 있다. 글자 그대로. */
    chargeText: text("charge_text").notNull().default(""),
    usagePlace: text("usage_place").notNull().default(""),
    /** 숫자 칸에 글자가 있었던 것 등, 칸에 그대로 못 담은 사정. 비어 있으면 없음. */
    anomaly: text("anomaly").notNull().default(""),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    matchStatus: legacyMatchStatusEnum("match_status").notNull(),
    /** 판정표의 「까닭」 또는 소유 불일치의 후보 설명 */
    matchNote: text("match_note").notNull().default(""),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("legacy_records_sheet_row_uq").on(t.sheet, t.sourceRow),
    index("legacy_records_part_idx").on(t.partId),
    index("legacy_records_occurred_idx").on(t.occurredOn),
  ],
);

export type LegacyRecord = typeof legacyRecords.$inferSelect;
export type NewLegacyRecord = typeof legacyRecords.$inferInsert;
