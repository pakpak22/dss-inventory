import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entryTypeEnum, stockEntries } from "./stock";

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
/**
 * 🔵 `PARTIAL` = **일부만 나갔고 아직 남음** (2026-10-14, 조각 4a. 설계 5절 「분할 불출 — 여러 번」).
 *    부분 불출이 한 번 나갔지만 요청은 **열린 채 남아** 있는 상태다. 사용자: 「여러 차례 나눠서 주기도 하고 기다리기도 한다」.
 *    🔵 **대기로 센다** — 아직 줄 것이 남아 담당자가 계속 봐야 하기 때문이다. 끝난 것으로 세면 화면에서 사라져 잊힌다.
 *    🔴 세는 쪽 코드(대기 목록·머리말 배지·알림 종 — `src/lib/stock/requests.ts`·`src/lib/notifications/bell-items.ts`)는
 *       **조각 4c 에서** 맞춘다. 이 조각(4a)은 값만 더한다 — 그래서 지금은 아직 어느 곳도 PARTIAL 을 대기로 세지 않는다.
 *    🔴 값을 **맨 뒤에** 붙였다. 가운데 끼우면 마이그레이션이 enum 타입을 다시 만들 수 있어서,
 *       기존 값을 건드리지 않는 `ALTER TYPE … ADD VALUE` 한 줄로 끝내려고 뒤에 붙인 것이다. 차례에 뜻은 없다.
 */
export const REQUEST_STATUSES = ["PENDING", "CONFIRMING", "CONFIRMED", "REJECTED", "CANCELLED", "PARTIAL"] as const;
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

/**
 * 부분 불출 회차 (2026-10-14, 조각 4a. 설계 `docs/부품요청_이관_설계_2026-10-14.md` 5절·8절).
 *
 * 한 요청에서 **원장 건이 여러 번** 나온다. 회차마다 여기 한 줄이 생기고, 그 줄이 「요청 ↔ 그때 쓰인 원장 건」을 잇는다.
 * 아직 줄 것이 남아 있으면 요청은 `PARTIAL` 로 **열린 채** 남는다.
 *
 * 🔴 **1. 원장 건의 `request_id` 는 비워 넣는다 — 그래서 이 표가 필요하다.**
 *    `stock_entries.request_id` 에 UNIQUE 색인이 걸려 있어(`stock_entries_request_uq`, `src/db/schema/stock.ts:82`
 *    「같은 신청이 두 번 쓰이지 않게」) 그대로 쓰면 **한 신청에서 원장 건이 두 번 나올 수 없다.**
 *    그 칸은 원래 nullable 이고(`stock.ts:73`) `RecordOptions.requestId` 도 선택이라(`src/lib/stock/ledger.ts:200`)
 *    **비워 넣으면 UNIQUE 에 안 걸린다.** 선례도 있다 — 사용(USE)의 「실제 수량이 다릅니다」가 만드는 ADJUST 건은
 *    `request_id` 를 안 붙인 채 들어간다(`ledger.ts:252` vs `:269` 의 `...viaRequest`).
 *    🔴 **그렇게 끊어진 자리를 이 표가 대신 잇는다.** 회차는 **일관되게 전부** `request_id` 를 비운다 —
 *    첫 회차만 붙이고 나머지를 비우면 읽는 사람이 헷갈린다.
 *    🔴 그러니 `stock_entries_request_uq` 를 **지우면 안 된다.** 그것을 피하려고 이 설계를 한 것이고,
 *    지우는 순간 이 표를 둔 까닭이 통째로 사라진다. 원장 표(`stock.ts`)는 한 글자도 고치지 않는다.
 *
 * 🔵 **2. 요청 줄 표를 일부러 안 만들었다.**
 *    요청 수량은 `stock_requests.payload` 의 `lines` 에, 실제 불출 수량은 원장(`stock_transactions`)에 **이미 있다.**
 *    줄 표를 더해 둘 다 적으면 같은 사실이 두 곳에 적히고, 어느 쪽이 진실인지 **코드가 강제하지 못해** 언젠가 어긋난다.
 *    같은 사실은 한 곳에만 둔다.
 *
 * 🔵 **3. 남은 수량은 세어서 안다 — 요약 칸을 일부러 안 뒀다.**
 *    「요청 수량 − 불출 합계」로 그때그때 센다. 느려지면 그때 요약 칸을 두면 된다.
 *    🔴 거꾸로(요약 칸을 뒀다가 빼기)는 어렵다 — 이미 쓰인 값을 믿는 코드가 생기기 때문이다.
 *
 * append-only. 불출을 무르는 것은 이 줄을 지우는 것이 아니라 원장 쪽 기록 취소(CORRECTION)다 (CLAUDE.md 11절).
 */
export const stockRequestIssues = pgTable(
  "stock_request_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => stockRequests.id),
    /** 이 회차가 만든 원장 머리. 🔴 그 건의 `request_id` 는 비어 있다(위 1번). */
    entryId: uuid("entry_id")
      .notNull()
      .references(() => stockEntries.id),
    /** 회차 — 요청 안에서 1부터. 빈 번호가 생기지 않게 직전 최대값 + 1 로 매긴다. */
    issueNo: integer("issue_no").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /** 불출한 담당자(users.id)와 그때의 이름 — 이름은 포털에서 바뀔 수 있어 복사해 둔다(`requestedByName` 과 같은 관례). */
    issuedBy: uuid("issued_by").notNull(),
    issuedByName: text("issued_by_name").notNull(),
    /** 「2개는 다음 주에」처럼 담당자가 남기는 말 */
    note: text("note").notNull().default(""),
  },
  (t) => [
    /** 한 요청 안에서 회차 번호는 한 번만. 동시에 두 번 불출해도 DB 가 거절한다. */
    uniqueIndex("stock_request_issues_no_uq").on(t.requestId, t.issueNo),
    /** 원장 건 하나는 회차 하나에만 붙는다 — `stock_entries_request_uq` 가 지키던 「두 번 쓰이지 않게」를 여기서 잇는다. */
    uniqueIndex("stock_request_issues_entry_uq").on(t.entryId),
    index("stock_request_issues_request_idx").on(t.requestId, t.issuedAt),
  ],
);

export type StockRequestIssue = typeof stockRequestIssues.$inferSelect;
