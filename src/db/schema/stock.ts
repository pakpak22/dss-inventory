import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { parts } from "./parts";

/**
 * 수량 변경 기록 (DESIGN 4-4절). 엑셀 사용처 기입란처럼 **한 건(머리) 안에 부품 여러 줄**.
 *
 * 🔴 수량의 정본은 `stock_transactions.delta` 의 합이다 (CLAUDE.md 11절). 줄은 고치지도 지우지도 않는다 —
 *    잘못 넣었으면 되돌리는 줄(CORRECTION)을 새로 쌓는다. `stock_balances` 는 그 합의 캐시다.
 */

/** 기록 종류 (DESIGN 4-1절). 화면 글자는 src/lib/stock/codes.ts */
export const ENTRY_TYPES = ["RECEIVE", "USE", "RETURN", "DISPOSE", "ADJUST", "TRANSFER", "LOAN", "OPENING", "CORRECTION"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const entryTypeEnum = pgEnum("entry_type", ENTRY_TYPES);

/** 엑셀의 어느 시트에 쓰는 줄인가. 연도별 순번(sheet_no)을 **시트별로 따로** 센다 (DESIGN 4-4절). */
export const SHEETS = ["USE", "RECEIVE", "CHANGE"] as const;
export type Sheet = (typeof SHEETS)[number];
export const sheetEnum = pgEnum("sheet", SHEETS);

export const PURPOSES = ["REPAIR", "FIELD", "OTHER"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const purposeEnum = pgEnum("purpose", PURPOSES);

export const CHARGE_TYPES = ["PAID", "FREE"] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];
export const chargeTypeEnum = pgEnum("charge_type", CHARGE_TYPES);

/** 한 건의 머리 — 반출·입고 한 번 */
export const stockEntries = pgTable(
  "stock_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: entryTypeEnum("type").notNull(),
    sheet: sheetEnum("sheet").notNull(),
    /** 사람이 적는 날짜 (YYYY-MM-DD, 시간대 없음) */
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    /**
     * 엑셀 No. 칸에 쓰는 연도별 순번. 시트별로 따로. 🔴 취소해도 원래 번호는 그대로 두고 빈 번호가 생긴다.
     * 다시 매기지 않는다 — 종이로 나간 서류·사람 기억과 어긋난다 (담당자, 답변서 10번).
     */
    sheetYear: integer("sheet_year").notNull(),
    sheetNo: integer("sheet_no").notNull(),
    /** 인수번호 (D + 숫자 6자리). 수리 건이 없으면 빈 값. */
    intakeNumber: text("intake_number").notNull().default(""),
    /** A/S 가 응답하지 않아 인수번호를 확인하지 못한 채 저장함 → 기록 내역에서 걸러 나중에 [확인] */
    intakeUnverified: boolean("intake_unverified").notNull().default(false),
    /** 「수리 건 없음」을 고른 반출. 사유는 reason 에. */
    noRepairCase: boolean("no_repair_case").notNull().default(false),
    // 인수번호로 찾아 온 값을 **그 시점 값으로 복사** (DESIGN 7절). 통로가 여섯 값을 준다.
    customerName: text("customer_name").notNull().default(""),
    endUser: text("end_user").notNull().default(""),
    productModel: text("product_model").notNull().default(""),
    productSerial: text("product_serial").notNull().default(""),
    productLot: text("product_lot").notNull().default(""),
    /** 엑셀 사용처 칸 글자 `인수번호_기종_S/N_L/N`. 재고 쪽에서 조립한다 (10절 6번). */
    usagePlace: text("usage_place").notNull().default(""),
    purpose: purposeEnum("purpose"),
    purposeText: text("purpose_text").notNull().default(""),
    /** 대여일 때 빌려준 곳 */
    counterparty: text("counterparty").notNull().default(""),
    /** 폐기·조정·기록 취소·수리 건 없음의 사유 */
    reason: text("reason").notNull().default(""),
    note: text("note").notNull().default(""),
    /** 기록한 사람(users.id)과 그때의 이름 — 이름은 포털에서 바뀔 수 있어 복사해 둔다. 확인 대기를 거친 건이면 **신청한 사람**이다. */
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name").notNull().default(""),
    /** 확인 대기를 거쳐 들어온 건이면 확인한 담당자. 바로 적은 건은 null. (2026-10-06 확인 단계) */
    confirmedBy: uuid("confirmed_by"),
    confirmedByName: text("confirmed_by_name"),
    /** 이 건을 만든 확인 대기 신청. 같은 신청이 두 번 쓰이지 않게 UNIQUE. */
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_entries_sheet_no_uq").on(t.sheet, t.sheetYear, t.sheetNo),
    index("stock_entries_occurred_idx").on(t.occurredOn),
    index("stock_entries_type_idx").on(t.type),
    index("stock_entries_intake_idx").on(t.intakeNumber),
    index("stock_entries_unverified_idx").on(t.id).where(sql`${t.intakeUnverified} = true`),
    uniqueIndex("stock_entries_request_uq").on(t.requestId),
  ],
);

/** 그 건 안의 부품 한 줄 — 원장. append-only. */
export const stockTransactions = pgTable(
  "stock_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => stockEntries.id),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    /** 늘면 +, 줄면 −. 0 은 없다 (CHECK). */
    delta: integer("delta").notNull(),
    /**
     * 🔴 그 시점의 **표시용** 값이다 (엑셀 「현 재고」·「이후 재고」 칸). 재고를 다시 계산하는 데 쓰지 않는다 —
     * 진실은 delta 의 합이다. 기록 취소가 쌓이면 과거 줄의 이 값과 실제 수량이 달라진다. DB 칸 주석(COMMENT)도 같다.
     */
    quantityBefore: integer("quantity_before").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    /** 유상·무상. 사용(반출)에서만. 같은 건 안에서도 줄마다 다를 수 있다. */
    chargeType: chargeTypeEnum("charge_type"),
    note: text("note").notNull().default(""),
    /** 반환일 때 되돌리는 원래 사용·대여 줄 */
    returnsTransactionId: uuid("returns_transaction_id").references((): AnyPgColumn => stockTransactions.id),
    /** 기록 취소일 때 되돌리는 원래 줄. UNIQUE — 한 줄은 한 번만 취소는다. */
    reversesTransactionId: uuid("reverses_transaction_id").references((): AnyPgColumn => stockTransactions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("stock_transactions_delta_nonzero", sql`${t.delta} <> 0`),
    uniqueIndex("stock_transactions_reverses_uq").on(t.reversesTransactionId),
    index("stock_transactions_part_idx").on(t.partId, t.createdAt),
    index("stock_transactions_entry_idx").on(t.entryId),
    index("stock_transactions_returns_idx").on(t.returnsTransactionId),
  ],
);

export type StockEntry = typeof stockEntries.$inferSelect;
export type StockTransaction = typeof stockTransactions.$inferSelect;
