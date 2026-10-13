import "server-only";
import { and, asc, count, desc, eq, gte, inArray, min, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { parts } from "@/db/schema/parts";
import { stockRequests, type RequestStatus } from "@/db/schema/stock-requests";
import { auditValues } from "@/lib/audit";
import { ENTRY_TYPE_LABEL, type EntryType } from "./codes";
import type { EntryInput } from "./form";
import { ledgerErrorMessage, recordEntry, type Actor, type RecordResult } from "./ledger";

/**
 * 반출 확인 대기 (2026-10-06 사용자 결정). 신청 → 담당자 확인 → 원장.
 *
 * - 신청은 수량을 건드리지 않는다. 확인 순간 `recordEntry` 가 잠그고 다시 검사한다(모자라면 거절, 신청은 PENDING 으로 남음).
 * - 두 담당자가 동시에 [확인] 을 눌러도 한 번만 쓰이게: PENDING → CONFIRMING 으로 **먼저 집고**(UPDATE … WHERE status = 'PENDING'),
 *   원장을 쓴 뒤 CONFIRMED 로. 실패하면 PENDING 으로 되돌린다. stock_entries.request_id 의 UNIQUE 가 마지막 안전장치.
 * - 원장의 created_by 는 **신청한 사람**(부품을 가져간 사람), confirmed_by 는 담당자.
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

export async function createRequest(input: EntryInput, actor: Actor): Promise<{ id: string }> {
  const ids = [...new Set(linesOf(input).map((l) => l.partId))];
  const rows = ids.length > 0 ? await db().select({ id: parts.id, no: parts.no, name: parts.name }).from(parts).where(inArray(parts.id, ids)) : [];
  const names = new Map(rows.map((r) => [r.id, { no: r.no, name: r.name }]));
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

export type ConfirmResult = { ok: true; result: Extract<RecordResult, { ok: true }> } | { ok: false; message: string };

export async function confirmRequest(id: string, admin: Actor): Promise<ConfirmResult> {
  // 1. 집기 — PENDING 인 것만, 한 사람만
  const [claimed] = await db()
    .update(stockRequests)
    .set({ status: "CONFIRMING" })
    .where(and(eq(stockRequests.id, id), eq(stockRequests.status, "PENDING")))
    .returning();
  if (!claimed) return { ok: false, message: "이미 처리된 신청이거나 없는 신청입니다." };

  const requester: Actor = { id: claimed.requestedBy, name: claimed.requestedByName };
  let result: RecordResult;
  try {
    result = await recordEntry(claimed.payload as unknown as EntryInput, requester, { requestId: claimed.id, confirmedBy: admin });
  } catch (e) {
    await db().update(stockRequests).set({ status: "PENDING" }).where(eq(stockRequests.id, id));
    throw e;
  }
  if (!result.ok) {
    await db().update(stockRequests).set({ status: "PENDING" }).where(eq(stockRequests.id, id));
    return { ok: false, message: ledgerErrorMessage(result.error) };
  }
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx
      .update(stockRequests)
      .set({ status: "CONFIRMED", decidedBy: admin.id, decidedByName: admin.name, decidedAt: now, entryId: result.ok ? result.entryId : null })
      .where(eq(stockRequests.id, id));
    await tx.insert(auditLogs).values(
      auditValues({
        action: "STOCK_REQUEST_CONFIRMED",
        actorId: admin.id,
        actorName: admin.name,
        target: `requests:${id}`,
        detail: { summary: claimed.summary, requestedBy: claimed.requestedByName, entry: result.ok ? `${result.type}-${result.sheetYear}-${result.sheetNo}` : null },
      }),
    );
  });
  return { ok: true, result };
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

/** 확인 대기 목록(오래된 것이 위 — 먼저 올라온 것부터 처리). CONFIRMING 도 대기로 보인다(처리 중). */
export async function listPendingRequests(): Promise<PendingRequestRow[]> {
  const rows = await db()
    .select()
    .from(stockRequests)
    .where(inArray(stockRequests.status, ["PENDING", "CONFIRMING"]))
    .orderBy(asc(stockRequests.requestedAt));
  return attachNames(rows);
}

/** 최근 처리된 것(반려·취소·확인) — 신청한 사람이 결과를 볼 수 있게. */
export async function listRecentDecidedRequests(limit = 10): Promise<PendingRequestRow[]> {
  const rows = await db()
    .select()
    .from(stockRequests)
    .where(inArray(stockRequests.status, ["CONFIRMED", "REJECTED", "CANCELLED"]))
    .orderBy(desc(stockRequests.decidedAt))
    .limit(limit);
  return attachNames(rows);
}

async function attachNames(rows: Array<typeof stockRequests.$inferSelect>): Promise<PendingRequestRow[]> {
  const ids = [...new Set(rows.flatMap((r) => linesOf(r.payload as unknown as EntryInput).map((l) => l.partId)))];
  const partRows = ids.length > 0 ? await db().select({ id: parts.id, no: parts.no, name: parts.name }).from(parts).where(inArray(parts.id, ids)) : [];
  const names = new Map(partRows.map((p) => [p.id, { no: p.no, name: p.name }]));
  return rows.map((r) => toRow(r, names));
}

export async function countPendingRequests(): Promise<number> {
  const [r] = await db().select({ n: count() }).from(stockRequests).where(inArray(stockRequests.status, ["PENDING", "CONFIRMING"]));
  return r?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* 머리말의 알림 종이 쓰는 조회 (2026-10-13)                            */
/* 🔴 위의 함수들은 화면이 쓰고 있다 — 동작을 바꾸지 않고 **더하기만** 한다. */
/* ------------------------------------------------------------------ */

/**
 * 확인 대기 요약 — 건수와 **가장 오래 기다린 신청의 시각**.
 *
 * `countPendingRequests()` 와 세는 범위가 같다(PENDING + CONFIRMING). 둘을 합치지
 * 않은 까닭: 머리말의 「대기 N」 배지는 숫자 하나만 쓰고 모든 화면에 딸려 오므로,
 * 거기에 집계 한 칸을 더 얹지 않는다. 종은 줄에 적을 날짜가 필요해 따로 묻는다.
 */
export async function summarizePendingRequests(): Promise<{ count: number; oldestAt: Date | null }> {
  const [r] = await db()
    .select({ n: count(), oldest: min(stockRequests.requestedAt) })
    .from(stockRequests)
    .where(inArray(stockRequests.status, ["PENDING", "CONFIRMING"]));
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
