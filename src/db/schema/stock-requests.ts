import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { entryTypeEnum } from "./stock";

/**
 * 반출 확인 대기 (2026-10-06 사용자 결정: 「신청 → 담당자 확인 → 반출」을 1차에 넣는다).
 *
 * 반출 계열(사용·대여·폐기)을 **기록 권한자**가 적으면 여기에 먼저 들어오고, **관리자(재고 담당)** 가 확인하면
 * 그때 원장(stock_entries/stock_transactions)에 쓰인다. 관리자가 직접 적으면 신청과 확인이 한 번이라 여기를 거치지 않는다.
 * 결재선이 아니다 — 확인 한 번이다 (REQUIREMENTS 7절: 결재를 붙이면 시스템을 거치지 않고 가져간다).
 *
 * 수량은 여기서 바뀌지 않는다. 확인 순간 ledger 가 잠그고 다시 검사한다(모자라면 그때 거절).
 * `payload` 는 화면이 보낸 것을 검사해 통과한 EntryInput(JSON) 그대로 — 확인 때 그 값으로 원장을 쓴다.
 */
export const REQUEST_STATUSES = ["PENDING", "CONFIRMING", "CONFIRMED", "REJECTED", "CANCELLED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const requestStatusEnum = pgEnum("stock_request_status", REQUEST_STATUSES);

export const stockRequests = pgTable(
  "stock_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: entryTypeEnum("type").notNull(),
    status: requestStatusEnum("status").notNull().default("PENDING"),
    /** 검사를 통과한 EntryInput. 확인 때 이 값으로 원장을 쓴다. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** 화면에 보여 줄 요약(부품 줄 수·총 수량·인수번호 등). payload 를 매번 풀지 않으려고 */
    summary: text("summary").notNull().default(""),
    requestedBy: uuid("requested_by").notNull(),
    requestedByName: text("requested_by_name").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** 반려 사유 */
    decisionNote: text("decision_note").notNull().default(""),
    /** 확인되어 쓰인 원장 머리 */
    entryId: uuid("entry_id"),
  },
  (t) => [index("stock_requests_status_idx").on(t.status, t.requestedAt), index("stock_requests_requester_idx").on(t.requestedBy)],
);

export type StockRequest = typeof stockRequests.$inferSelect;
