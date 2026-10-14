import "server-only";
import { and, asc, count, desc, eq, gte, inArray, min, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { parts } from "@/db/schema/parts";
import { stockTransactions } from "@/db/schema/stock";
import { stockRequestIssues, stockRequests, type RequestStatus } from "@/db/schema/stock-requests";
import { auditValues } from "@/lib/audit";
import { DECIDED_REQUEST_STATUSES, ENTRY_TYPE_LABEL, PENDING_REQUEST_STATUSES, type EntryType } from "./codes";
import type { EntryInput } from "./form";
import { buildIssueInput, type IssueQuantity } from "./issue";
import { LedgerAbort, ledgerErrorMessage, recordEntryIn, type Actor, type RecordResult } from "./ledger";

/**
 * 반출 확인 대기 (2026-10-06 사용자 결정). 신청 → 담당자 확인 → 원장.
 *
 * - 신청은 수량을 건드리지 않는다. 확인 순간 원장이 잠그고 다시 검사한다(모자라면 거절, 신청은 집기 전 상태로 돌아감).
 * - 두 담당자가 동시에 [확인] 을 눌러도 한 번만 쓰이게: PENDING·PARTIAL → CONFIRMING 으로 **먼저 집고**,
 *   원장을 쓴 뒤 CONFIRMED(또는 PARTIAL)로. 실패하면 집기 전 상태로 되돌린다.
 * - 원장의 created_by 는 **신청한 사람**(부품을 가져간 사람), confirmed_by 는 담당자.
 *
 * 🔵 **일부 수량만 내주기 (2026-10-14, 조각 4b. 설계 5절 「분할 불출 — 여러 번」)**
 *   - 사용자: 「여러 차례 나눠서 주기도 하고 **기다리기도** 한다」 → 다 못 주면 요청이 `PARTIAL` 로 **열린 채** 남는다.
 *   - 🔴 원장에 넘기는 `EntryInput` 은 **`issue.ts` 의 `buildIssueInput` 이 만든 것 하나뿐**이다.
 *     그래서 원장(`ledger.ts`)은 부분인지 전부인지 모르고, 그 파일은 한 글자도 바뀌지 않았다.
 *   - 🔴 회차마다 원장 건의 **「신청 연결」(`RecordOptions.requestId`)을 비운다** — `stock_entries_request_uq` 를
 *     피하는 자리다. 끊어진 자리는 회차 표(`stock_request_issues`)가 대신 잇는다 (그 표의 주석 1번).
 *   - 🔵 상태를 **세는** 쪽(대기 목록·배지·알림 종)은 조각 4c 에서 맞췄다 — `PARTIAL` 은 **대기**로 센다.
 *     가르는 글자는 `./codes` 의 `PENDING_REQUEST_STATUSES`·`DECIDED_REQUEST_STATUSES` 한 벌뿐이다.
 */
export interface RequestLineView {
  partId: string;
  partNo: number | null;
  partName: string;
  quantity: number;
}

export interface PendingRequestRow {
  id: string;
  type: EntryType;
  status: RequestStatus;
  summary: string;
  occurredOn: string;
  intakeNumber: string;
  noRepairCase: boolean;
  counterparty: string;
  reason: string;
  note: string;
  lines: RequestLineView[];
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string;
}

type LinesLike = { type: EntryType; lines: Array<{ partId: string; quantity: number }> };

function linesOf(input: EntryInput): Array<{ partId: string; quantity: number }> {
  if (input.type === "RETURN") return [];
  if (input.type === "ADJUST") return [{ partId: input.partId, quantity: input.actualQuantity }];
  if (input.type === "TRANSFER") return [{ partId: input.fromPartId, quantity: input.quantity }];
  return (input as LinesLike).lines.map((l) => ({ partId: l.partId, quantity: l.quantity }));
}

/** 목록에 보일 한 줄 요약. 부품 이름은 신청 때 붙여 둔다(나중에 부품이 바뀌어도 신청 글자는 그대로). */
export function buildRequestSummary(input: EntryInput, names: ReadonlyMap<string, { no: number; name: string }>): string {
  const lines = linesOf(input);
  const partsText = lines
    .slice(0, 3)
    .map((l) => {
      const p = names.get(l.partId);
      return `${p ? `No. ${p.no} ${p.name}` : "(부품)"} ×${l.quantity}`;
    })
    .join(", ");
  const more = lines.length > 3 ? ` 외 ${lines.length - 3}줄` : "";
  const head =
    input.type === "USE" ? (input.noRepairCase ? `수리 건 없음(${input.reason})` : input.intakeNumber) : input.type === "LOAN" ? input.counterparty : input.type === "DISPOSE" ? input.reason : "";
  return [ENTRY_TYPE_LABEL[input.type], input.occurredOn, head, partsText + more].filter(Boolean).join(" · ");
}

/** 부품 No.·품명 (요약 글자와 오류 문구에 쓴다). 이름은 그때그때 읽는다 — 신청 글자에는 이미 복사해 둔 것이 있다. */
async function partNamesOf(partIds: readonly string[]): Promise<Map<string, { no: number; name: string }>> {
  const ids = [...new Set(partIds)];
  if (ids.length === 0) return new Map();
  const rows = await db().select({ id: parts.id, no: parts.no, name: parts.name }).from(parts).where(inArray(parts.id, ids));
  return new Map(rows.map((r) => [r.id, { no: r.no, name: r.name }]));
}

export async function createRequest(input: EntryInput, actor: Actor): Promise<{ id: string }> {
  const names = await partNamesOf(linesOf(input).map((l) => l.partId));
  const summary = buildRequestSummary(input, names);
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(stockRequests)
      .values({ type: input.type, payload: input as unknown as Record<string, unknown>, summary, requestedBy: actor.id, requestedByName: actor.name })
      .returning({ id: stockRequests.id });
    await tx.insert(auditLogs).values(auditValues({ action: "STOCK_REQUEST", actorId: actor.id, actorName: actor.name, target: `requests:${row.id}`, detail: { type: input.type, summary } }));
    return { id: row.id };
  });
}

export type ConfirmResult =
  | {
      ok: true;
      result: Extract<RecordResult, { ok: true }>;
      /** 이번 회차 번호(1부터) */
      issueNo: number;
      /** 이번에 나간 수량의 합 */
      issuing: number;
      /** 아직 못 준 수량의 합. 0 이면 요청이 끝났다 */
      remaining: number;
      /** 다 나갔나 (= 상태가 CONFIRMED 가 됐나) */
      done: boolean;
    }
  | { ok: false; message: string };

export interface ConfirmOptions {
  /**
   * 줄별 「이번에 줄 수량」. 🔵 비우면 **남은 수량 전부** — 화면(조각 4d)이 생기기 전까지의 기존 동작 그대로다.
   * 목록에 없는 부품은 0 으로 본다(이번엔 안 준다).
   */
  quantities?: readonly IssueQuantity[];
  /** 「2개는 다음 주에」처럼 담당자가 그 회차에 남기는 말 */
  note?: string;
}

/** 집을 수 있는 상태 — 아직 아무것도 안 나간 것(PENDING)과 일부만 나간 것(PARTIAL). */
const CLAIMABLE_STATUSES = ["PENDING", "PARTIAL"] as const satisfies readonly RequestStatus[];

/**
 * 집기 — 한 사람만 들어가게 CONFIRMING 으로 먼저 바꾼다.
 *
 * 🔴 한 번에 `inArray` 로 집지 않고 상태마다 한 번씩 시도하는 까닭: `.returning()` 은 **바뀐 뒤**(CONFIRMING) 값을 주므로
 *    실패했을 때 어디로 되돌려야 하는지(PENDING 인지 PARTIAL 인지)를 알 수 없다. 되돌릴 자리를 알아야 한다.
 *    첫 번째 시도가 거의 언제나 맞는다(PENDING).
 */
async function claimRequest(id: string): Promise<{ row: typeof stockRequests.$inferSelect; previousStatus: RequestStatus } | null> {
  for (const previousStatus of CLAIMABLE_STATUSES) {
    const [row] = await db()
      .update(stockRequests)
      .set({ status: "CONFIRMING" })
      .where(and(eq(stockRequests.id, id), eq(stockRequests.status, previousStatus)))
      .returning();
    if (row) return { row, previousStatus };
  }
  return null;
}

/**
 * 이 요청에서 **이미 나간 수량**(부품별).
 *
 * 🔵 요약 칸을 두지 않고 회차 표에 달린 원장 줄을 **세어서** 안다 (회차 표 주석 3번: 같은 사실을 두 곳에 적지 않는다).
 * 🔴 반출은 delta 가 음수라 부호를 뒤집는다.
 * 🔴 기록 취소(CORRECTION)로 무른 건은 회차 표에 없으므로 여기 안 센다 — 무른 수량도 「이미 나간 것」으로 남는다.
 *    모자라게 주는 쪽(보수적)이라 재고가 어긋나지는 않는다. 화면에 어떻게 보일지는 조각 4c·4d 에서 정한다.
 */
async function issuedQuantities(requestId: string): Promise<Map<string, number>> {
  const rows = await db()
    .select({ partId: stockTransactions.partId, out: sql<number>`coalesce(sum(-${stockTransactions.delta}), 0)`.mapWith(Number) })
    .from(stockRequestIssues)
    .innerJoin(stockTransactions, eq(stockTransactions.entryId, stockRequestIssues.entryId))
    .where(eq(stockRequestIssues.requestId, requestId))
    .groupBy(stockTransactions.partId);
  return new Map(rows.map((r) => [r.partId, r.out]));
}

/**
 * 회차 표의 UNIQUE 에 걸렸나 (`stock_request_issues_no_uq`·`stock_request_issues_entry_uq`).
 *
 * 집기(CONFIRMING)가 이미 막아 주므로 평소에는 안 걸린다. **마지막 안전장치**라서, 걸렸을 때 사람에게
 * 오류 화면 대신 말이 되는 문구가 보이게 한다 (원장의 `stock_entries_request_uq` 가 하던 몫을 이어받은 자리다).
 */
function isIssueConflict(e: unknown): boolean {
  const o = e as { code?: unknown; constraint_name?: unknown } | null;
  if (!o || typeof o !== "object" || o.code !== "23505") return false;
  return o.constraint_name === "stock_request_issues_no_uq" || o.constraint_name === "stock_request_issues_entry_uq";
}

export async function confirmRequest(id: string, admin: Actor, opts: ConfirmOptions = {}): Promise<ConfirmResult> {
  // 1. 집기 — 한 사람만. 일부만 나간 것(PARTIAL)은 다시 집어 다음 회차를 낸다.
  const claimed = await claimRequest(id);
  if (!claimed) return { ok: false, message: "이미 처리된 신청이거나 없는 신청입니다." };
  const { row: request, previousStatus } = claimed;
  const restore = () => db().update(stockRequests).set({ status: previousStatus }).where(eq(stockRequests.id, id));

  const payload = request.payload as unknown as EntryInput;
  const requester: Actor = { id: request.requestedBy, name: request.requestedByName };

  // 2. 「요청 수량」이 아니라 「이번에 줄 수량」으로 원장 입력을 만든다. 🔴 원장으로 가는 길은 이 함수 하나뿐이다.
  //    집기로 이 요청을 혼자 들고 있으므로 이미 나간 수량을 트랜잭션 밖에서 읽어도 그 사이에 바뀌지 않는다.
  let plan;
  try {
    const [issued, names] = await Promise.all([issuedQuantities(id), partNamesOf(linesOf(payload).map((l) => l.partId))]);
    const want = opts.quantities ? new Map(opts.quantities.map((q) => [q.partId, q.quantity])) : null;
    const built = buildIssueInput(payload, want, issued, names);
    if (!built.ok) {
      await restore();
      return { ok: false, message: built.message };
    }
    plan = built.plan;
  } catch (e) {
    await restore();
    throw e;
  }
  const input = plan.input;
  if (!input) {
    // 줄이 하나도 안 남았다 → 아무것도 하지 않는다. 빈 원장 건을 만들지 않는다.
    await restore();
    return { ok: false, message: "이번에 내줄 수량이 없습니다. 줄마다 내줄 수량을 적으십시오." };
  }

  // 3. 🔴 원장 쓰기 · 회차 줄 · 상태 바꾸기를 **한 트랜잭션**으로. 중간에 멈추면 아무것도 안 들어간다.
  const done = plan.remaining === 0;
  const now = new Date();
  let written: { result: Extract<RecordResult, { ok: true }>; issueNo: number };
  try {
    written = await db().transaction(async (tx) => {
      // 🔴 「신청 연결」(requestId)을 **비워 넘긴다** — stock_entries_request_uq 가 한 신청에서 두 건이 나오는 것을 막기 때문이다.
      //    끊어진 자리는 바로 아래 회차 줄이 잇는다 (stock-requests.ts 의 회차 표 주석 1번).
      const result = await recordEntryIn(tx, input, requester, { confirmedBy: admin });
      // 회차 번호 = 그 요청의 직전 최대값 + 1 (빈 번호가 생기지 않게). 겹치면 UNIQUE 가 막는다.
      const [seq] = await tx
        .select({ next: sql<number>`coalesce(max(${stockRequestIssues.issueNo}), 0) + 1`.mapWith(Number) })
        .from(stockRequestIssues)
        .where(eq(stockRequestIssues.requestId, id));
      const issueNo = seq?.next ?? 1;
      await tx.insert(stockRequestIssues).values({ requestId: id, entryId: result.entryId, issueNo, issuedBy: admin.id, issuedByName: admin.name, note: opts.note ?? "" });
      await tx
        .update(stockRequests)
        // 🔴 다 나갔으면 끝난 것(CONFIRMED), 남았으면 열린 채(PARTIAL).
        //    decided* 와 entryId 는 **끝났을 때만** 적는다 — 「결정됨 = 더 볼 일 없음」이라는 기존 뜻을 바꾸지 않으려고.
        //    누가 언제 몇 회차를 내줬는지는 회차 표에 줄마다 남는다. 여러 회차면 entryId 는 마지막 회차의 건이다.
        .set(done ? { status: "CONFIRMED", decidedBy: admin.id, decidedByName: admin.name, decidedAt: now, entryId: result.entryId } : { status: "PARTIAL" })
        .where(eq(stockRequests.id, id));
      await tx.insert(auditLogs).values(
        auditValues({
          action: done ? "STOCK_REQUEST_CONFIRMED" : "STOCK_REQUEST_PARTIAL",
          actorId: admin.id,
          actorName: admin.name,
          target: `requests:${id}`,
          detail: {
            summary: request.summary,
            requestedBy: request.requestedByName,
            entry: `${result.type}-${result.sheetYear}-${result.sheetNo}`,
            issueNo,
            issued: plan.issuing,
            remaining: plan.remaining,
            note: opts.note ?? "",
          },
        }),
      );
      return { result, issueNo };
    });
  } catch (e) {
    await restore();
    // 원장이 거절한 것(수량 부족 등)은 결과로 바꿔 돌려준다 — 신청은 집기 전 상태로 남는다(기존 동작 그대로).
    if (e instanceof LedgerAbort) return { ok: false, message: ledgerErrorMessage(e.error) };
    if (isIssueConflict(e)) return { ok: false, message: "다른 담당자가 방금 이 신청을 처리했습니다. 화면을 새로 고치고 다시 보십시오." };
    throw e;
  }
  return { ok: true, result: written.result, issueNo: written.issueNo, issuing: plan.issuing, remaining: plan.remaining, done };
}

export async function rejectRequest(id: string, note: string, admin: Actor): Promise<{ ok: boolean; message?: string }> {
  const now = new Date();
  const [row] = await db()
    .update(stockRequests)
    .set({ status: "REJECTED", decidedBy: admin.id, decidedByName: admin.name, decidedAt: now, decisionNote: note })
    .where(and(eq(stockRequests.id, id), eq(stockRequests.status, "PENDING")))
    .returning({ summary: stockRequests.summary, requestedByName: stockRequests.requestedByName });
  if (!row) return { ok: false, message: "이미 처리된 신청이거나 없는 신청입니다." };
  await db()
    .insert(auditLogs)
    .values(auditValues({ action: "STOCK_REQUEST_REJECTED", actorId: admin.id, actorName: admin.name, target: `requests:${id}`, detail: { summary: row.summary, requestedBy: row.requestedByName, note } }));
  return { ok: true };
}

/** 신청한 사람 본인이 아직 PENDING 인 것만 거둔다. */
export async function cancelRequest(id: string, actor: Actor): Promise<{ ok: boolean; message?: string }> {
  const now = new Date();
  const [row] = await db()
    .update(stockRequests)
    .set({ status: "CANCELLED", decidedBy: actor.id, decidedByName: actor.name, decidedAt: now })
    .where(and(eq(stockRequests.id, id), eq(stockRequests.status, "PENDING"), eq(stockRequests.requestedBy, actor.id)))
    .returning({ summary: stockRequests.summary });
  if (!row) return { ok: false, message: "거둘 수 없는 신청입니다. 이미 처리됐거나 본인 신청이 아닙니다." };
  await db().insert(auditLogs).values(auditValues({ action: "STOCK_REQUEST_CANCELLED", actorId: actor.id, actorName: actor.name, target: `requests:${id}`, detail: { summary: row.summary } }));
  return { ok: true };
}

function toRow(r: typeof stockRequests.$inferSelect, names: ReadonlyMap<string, { no: number; name: string }>): PendingRequestRow {
  const input = r.payload as unknown as EntryInput;
  const lines = linesOf(input).map((l) => {
    const p = names.get(l.partId);
    return { partId: l.partId, partNo: p?.no ?? null, partName: p?.name ?? "(지워진 부품)", quantity: l.quantity };
  });
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    summary: r.summary,
    occurredOn: input.occurredOn,
    intakeNumber: input.type === "USE" ? input.intakeNumber : "",
    noRepairCase: input.type === "USE" ? input.noRepairCase : false,
    counterparty: input.type === "LOAN" ? input.counterparty : "",
    reason: "reason" in input ? input.reason : "",
    note: input.note,
    lines,
    requestedBy: r.requestedBy,
    requestedByName: r.requestedByName,
    requestedAt: r.requestedAt.toISOString(),
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
  };
}

/**
 * 확인 대기 목록(오래된 것이 위 — 먼저 올라온 것부터 처리). CONFIRMING 도 대기로 보인다(처리 중).
 *
 * 🔵 **일부만 나간 것(PARTIAL)도 여기 남는다** (2026-10-14, 조각 4c) — 아직 줄 것이 남았으니 담당자가 계속 봐야 한다.
 *    차례는 **처음 신청한 시각**이라 회차를 거듭해도 자리가 바뀌지 않는다(오래 기다린 것이 계속 위).
 */
export async function listPendingRequests(): Promise<PendingRequestRow[]> {
  const rows = await db()
    .select()
    .from(stockRequests)
    .where(inArray(stockRequests.status, [...PENDING_REQUEST_STATUSES]))
    .orderBy(asc(stockRequests.requestedAt));
  return attachNames(rows);
}

/**
 * 최근 처리된 것(반려·취소·확인) — 신청한 사람이 결과를 볼 수 있게.
 *
 * 🔴 `PARTIAL` 은 여기 **없다.** 아직 끝나지 않아 위의 대기 목록에 있다 — 양쪽에 넣으면 같은 신청이 두 번 보인다.
 *    `decidedAt` 역순으로 세우는데 PARTIAL 은 그 칸이 비어 있기도 하다(confirmRequest: decided* 는 끝났을 때만 적는다).
 */
export async function listRecentDecidedRequests(limit = 10): Promise<PendingRequestRow[]> {
  const rows = await db()
    .select()
    .from(stockRequests)
    .where(inArray(stockRequests.status, [...DECIDED_REQUEST_STATUSES]))
    .orderBy(desc(stockRequests.decidedAt))
    .limit(limit);
  return attachNames(rows);
}

async function attachNames(rows: Array<typeof stockRequests.$inferSelect>): Promise<PendingRequestRow[]> {
  const names = await partNamesOf(rows.flatMap((r) => linesOf(r.payload as unknown as EntryInput).map((l) => l.partId)));
  return rows.map((r) => toRow(r, names));
}

/** 머리말의 「대기 N」 배지. 🔴 아래 `summarizePendingRequests()`(알림 종)와 **같은 묶음**을 본다 — 둘이 갈리면 「배지에는 있는데 종에는 없는」 신청이 생긴다. */
export async function countPendingRequests(): Promise<number> {
  const [r] = await db().select({ n: count() }).from(stockRequests).where(inArray(stockRequests.status, [...PENDING_REQUEST_STATUSES]));
  return r?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* 머리말의 알림 종이 쓰는 조회 (2026-10-13)                            */
/* 🔴 위의 함수들은 화면이 쓰고 있다 — 동작을 바꾸지 않고 **더하기만** 한다. */
/* ------------------------------------------------------------------ */

/**
 * 확인 대기 요약 — 건수와 **가장 오래 기다린 신청의 시각**.
 *
 * 🔴 `countPendingRequests()` 와 세는 범위가 **같다** — 둘 다 `PENDING_REQUEST_STATUSES` 를
 * 본다(일부 나감 PARTIAL 포함). 목록을 손으로 두 벌 적으면 언젠가 갈려서 「배지에는
 * 있는데 종에는 없는」 신청이 생긴다. 그런데도 질의를 둘로 둔 까닭: 머리말의 「대기 N」
 * 배지는 숫자 하나만 쓰고 모든 화면에 딸려 오므로, 거기에 집계 한 칸을 더 얹지 않는다.
 * 종은 줄에 적을 날짜가 필요해 따로 묻는다.
 */
export async function summarizePendingRequests(): Promise<{ count: number; oldestAt: Date | null }> {
  const [r] = await db()
    .select({ n: count(), oldest: min(stockRequests.requestedAt) })
    .from(stockRequests)
    .where(inArray(stockRequests.status, [...PENDING_REQUEST_STATUSES]));
  // 드라이버가 timestamptz 를 Date 로 주지만, 집계는 글자로 올 수도 있어 둘 다 받는다.
  const oldest = (r?.oldest ?? null) as Date | string | null;
  return {
    count: r?.n ?? 0,
    oldestAt: oldest === null ? null : oldest instanceof Date ? oldest : new Date(oldest),
  };
}

/** 종에 실을 「내 반려된 신청」 한 줄. 사유 본문은 싣지 않는다 — 화면에서 본다. */
export interface RejectedRequestRow {
  id: string;
  summary: string;
  decidedByName: string | null;
  decidedAt: Date | null;
}

/**
 * 그 사람이 낸 신청 중 **반려된 것**을, `since` 이후에 결정된 것만.
 *
 * - 🔴 확인(CONFIRMED)·취소(CANCELLED)는 뺀다. 확인은 수량이 바뀌어 화면에서 바로
 *   보이고(2026-10-13 사용자 결정), 취소는 본인이 거둔 것이라 알릴 일이 아니다.
 * - `since` 를 부르는 쪽이 정한다 — 「7일」이 적힌 곳은 notifications/bell-items.ts
 *   하나뿐이어야 하기 때문이다(그 파일의 `rejectionCutoff`).
 * - 🔴 `total` 은 **상한에 걸리기 전의 전체 개수**다. 배지 숫자가 참말이어야 한다
 *   (@dss/ui README 7절). 창 함수는 WHERE 뒤·LIMIT 앞에 계산되므로 세는 질의를 따로
 *   보내지 않아도 된다 — 종은 모든 화면에 딸려 오므로 왕복 한 번이 곧 모든 화면의 비용이다.
 * - 색인 `stock_requests_requester_idx`(requested_by)를 탄다.
 */
export async function listRejectedRequestsFor(userId: string, since: Date, limit: number): Promise<{ rows: RejectedRequestRow[]; total: number }> {
  const rows = await db()
    .select({
      id: stockRequests.id,
      summary: stockRequests.summary,
      decidedByName: stockRequests.decidedByName,
      decidedAt: stockRequests.decidedAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(stockRequests)
    .where(and(eq(stockRequests.status, "REJECTED"), eq(stockRequests.requestedBy, userId), gte(stockRequests.decidedAt, since)))
    .orderBy(desc(stockRequests.decidedAt), desc(stockRequests.id))
    .limit(limit);
  if (rows.length === 0) return { rows: [], total: 0 };
  return {
    rows: rows.map((r) => ({ id: r.id, summary: r.summary, decidedByName: r.decidedByName, decidedAt: r.decidedAt })),
    total: rows[0].total,
  };
}
