import "server-only";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { partItems } from "@/db/schema/part-items";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import type { PartItemRow, PartRow } from "./types";

/**
 * 부품 전체를 No. 순으로 한 번에 읽는다. 찾기·거르기·정렬은 화면(브라우저)에서 한다 —
 * 부품이 319개라 A/S 재고 목록과 같은 방식이 맞다 (DESIGN 2-1절). 1만 개가 되면 그때 서버 쪽으로 옮긴다.
 *
 * 숨긴(소프트 삭제) 부품은 빼고, 수량이 아직 없는 부품(stock_balances 줄이 없음)은 0 으로 본다.
 * 재고 0 인 부품도 항상 보인다 (REQUIREMENTS 3절).
 */
export async function listParts(): Promise<PartRow[]> {
  const rows = await db()
    .select({
      id: parts.id,
      no: parts.no,
      name: parts.name,
      name2: parts.name2,
      customerName: parts.customerName,
      kyosanPartNo: parts.kyosanPartNo,
      drawingNo: parts.drawingNo,
      supplyPrice: parts.supplyPrice,
      supplyCurrency: parts.supplyCurrency,
      quotePrice: parts.quotePrice,
      note: parts.note,
      itemCode: partItems.code,
      itemName: partItems.name,
      category: parts.category,
      owner: parts.owner,
      quantity: stockBalances.quantity,
    })
    .from(parts)
    .innerJoin(partItems, eq(parts.itemId, partItems.id))
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(eq(parts.isDeleted, false))
    .orderBy(asc(parts.no));

  return rows.map((r) => ({ ...r, quantity: r.quantity ?? 0 }));
}

/** 항목 목록(고르기 상자용). 숨긴 것은 빼고 차례대로. */
export async function listPartItems(): Promise<PartItemRow[]> {
  return db()
    .select({ id: partItems.id, code: partItems.code, name: partItems.name, sortOrder: partItems.sortOrder })
    .from(partItems)
    .where(eq(partItems.isDeleted, false))
    .orderBy(asc(partItems.sortOrder), asc(partItems.name));
}

/* ───────────── 조각 3: 수정 화면·변경 이력 ───────────── */

/** 수정 화면용 — 목록 줄에 항목 id 를 더한 것 (폼의 <select> 값). */
export interface PartEditRow extends PartRow {
  itemId: string;
}

/** No. 로 부품 하나. 숨긴 것은 없는 것으로 본다. */
export async function findPartByNo(no: number): Promise<PartEditRow | null> {
  const rows = await db()
    .select({
      id: parts.id,
      no: parts.no,
      name: parts.name,
      name2: parts.name2,
      customerName: parts.customerName,
      kyosanPartNo: parts.kyosanPartNo,
      drawingNo: parts.drawingNo,
      supplyPrice: parts.supplyPrice,
      supplyCurrency: parts.supplyCurrency,
      quotePrice: parts.quotePrice,
      note: parts.note,
      itemId: parts.itemId,
      itemCode: partItems.code,
      itemName: partItems.name,
      category: parts.category,
      owner: parts.owner,
      quantity: stockBalances.quantity,
    })
    .from(parts)
    .innerJoin(partItems, eq(parts.itemId, partItems.id))
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(and(eq(parts.no, no), eq(parts.isDeleted, false)))
    .limit(1);
  const r = rows[0];
  return r ? { ...r, quantity: r.quantity ?? 0 } : null;
}

/** 설정 화면용 — 항목 전체(숨긴 것 포함하지 않음) + 각 항목을 쓰는 부품 수. */
export interface PartItemAdminRow extends PartItemRow {
  partCount: number;
}

export async function listPartItemsForAdmin(): Promise<PartItemAdminRow[]> {
  const rows = await db()
    .select({
      id: partItems.id,
      code: partItems.code,
      name: partItems.name,
      sortOrder: partItems.sortOrder,
      partCount: sql<number>`count(${parts.id}) filter (where ${parts.isDeleted} = false)`.mapWith(Number),
    })
    .from(partItems)
    .leftJoin(parts, eq(parts.itemId, partItems.id))
    .where(eq(partItems.isDeleted, false))
    .groupBy(partItems.id)
    .orderBy(asc(partItems.sortOrder), asc(partItems.name));
  return rows;
}

/** 변경 이력 한 줄. 시각은 ISO 문자열(직렬화 가능). */
export interface AuditRow {
  id: string;
  occurredAt: string;
  actorName: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
}

export async function listAuditLogs(opts: { page: number; size: number; action: string | null; target?: string | null }): Promise<{ rows: AuditRow[]; total: number }> {
  const conds = [];
  if (opts.action) conds.push(eq(auditLogs.action, opts.action));
  if (opts.target) conds.push(eq(auditLogs.target, opts.target));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const [countRow] = await db().select({ n: count() }).from(auditLogs).where(where);
  const total = countRow?.n ?? 0;
  const offset = (Math.max(1, opts.page) - 1) * opts.size;
  const rows = await db()
    .select({
      id: auditLogs.id,
      occurredAt: auditLogs.occurredAt,
      actorName: auditLogs.actorName,
      action: auditLogs.action,
      target: auditLogs.target,
      detail: auditLogs.detail,
    })
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.occurredAt))
    .limit(opts.size)
    .offset(offset);
  return { rows: rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString(), detail: r.detail ?? null })), total };
}
