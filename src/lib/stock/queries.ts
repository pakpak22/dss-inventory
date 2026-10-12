import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parts } from "@/db/schema/parts";
import { stockEntries, stockTransactions, type ChargeType, type EntryType, type Purpose } from "@/db/schema/stock";
import { sheetNoText } from "./codes";
import type { EntryListFilter } from "./form";

/** 기록 내역·상세 창에 내려보내는 줄. 직렬화 가능한 값만. */
export interface EntryLineRow {
  id: string;
  partId: string;
  partNo: number;
  partName: string;
  partName2: string;
  partDrawingNo: string;
  partKyosanPartNo: string;
  owner: string;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  chargeType: ChargeType | null;
  note: string;
  /** 이 줄을 되돌린 기록 취소 줄이 있나 */
  corrected: boolean;
  /** 이 줄이 되돌린 원래 줄(기록 취소·반환) */
  reversesTransactionId: string | null;
  returnsTransactionId: string | null;
}

export interface EntryRow {
  id: string;
  type: EntryType;
  occurredOn: string;
  sheetYear: number;
  sheetNo: number;
  intakeNumber: string;
  intakeUnverified: boolean;
  noRepairCase: boolean;
  customerName: string;
  productModel: string;
  usagePlace: string;
  purpose: Purpose | null;
  purposeText: string;
  counterparty: string;
  reason: string;
  note: string;
  createdByName: string;
  confirmedByName: string | null;
  createdAt: string;
  lines: EntryLineRow[];
}

const PAGE_SIZE = 30;

async function linesFor(entryIds: string[]): Promise<Map<string, EntryLineRow[]>> {
  const out = new Map<string, EntryLineRow[]>();
  if (entryIds.length === 0) return out;
  const rows = await db()
    .select({
      id: stockTransactions.id,
      entryId: stockTransactions.entryId,
      partId: stockTransactions.partId,
      partNo: parts.no,
      partName: parts.name,
      partName2: parts.name2,
      partDrawingNo: parts.drawingNo,
      partKyosanPartNo: parts.kyosanPartNo,
      owner: parts.owner,
      delta: stockTransactions.delta,
      quantityBefore: stockTransactions.quantityBefore,
      quantityAfter: stockTransactions.quantityAfter,
      chargeType: stockTransactions.chargeType,
      note: stockTransactions.note,
      reversesTransactionId: stockTransactions.reversesTransactionId,
      returnsTransactionId: stockTransactions.returnsTransactionId,
      corrected: sql<boolean>`exists (select 1 from stock_transactions r where r.reverses_transaction_id = ${stockTransactions.id})`,
    })
    .from(stockTransactions)
    .innerJoin(parts, eq(parts.id, stockTransactions.partId))
    .where(inArray(stockTransactions.entryId, entryIds))
    .orderBy(asc(stockTransactions.createdAt), asc(parts.no));
  for (const r of rows) {
    const { entryId, ...line } = r;
    const list = out.get(entryId) ?? [];
    list.push({ ...line, corrected: Boolean(line.corrected) });
    out.set(entryId, list);
  }
  return out;
}

function toEntryRow(e: typeof stockEntries.$inferSelect, lines: EntryLineRow[]): EntryRow {
  return {
    id: e.id,
    type: e.type,
    occurredOn: e.occurredOn,
    sheetYear: e.sheetYear,
    sheetNo: e.sheetNo,
    intakeNumber: e.intakeNumber,
    intakeUnverified: e.intakeUnverified,
    noRepairCase: e.noRepairCase,
    customerName: e.customerName,
    productModel: e.productModel,
    usagePlace: e.usagePlace,
    purpose: e.purpose,
    purposeText: e.purposeText,
    counterparty: e.counterparty,
    reason: e.reason,
    note: e.note,
    createdByName: e.createdByName,
    confirmedByName: e.confirmedByName,
    createdAt: e.createdAt.toISOString(),
    lines,
  };
}

/** 기록 내역 (DESIGN 2-5절): 날짜 역순, 거르기, 쪽. 부품으로 거를 때는 그 부품 줄이 든 건만. */
export async function listEntries(f: EntryListFilter): Promise<{ rows: EntryRow[]; total: number; pageSize: number }> {
  const conds = [];
  if (f.type) conds.push(eq(stockEntries.type, f.type));
  if (f.from) conds.push(gte(stockEntries.occurredOn, f.from));
  if (f.to) conds.push(lte(stockEntries.occurredOn, f.to));
  // 「담당」: 기록자(신청자)와 확인자 둘 다. 확인자만 맞는 건이 빠졌었다 (2026-10-07).
  if (f.actor) conds.push(or(ilike(stockEntries.createdByName, `%${f.actor}%`), ilike(stockEntries.confirmedByName, `%${f.actor}%`)));
  if (f.intakeNumber) conds.push(ilike(stockEntries.intakeNumber, `%${f.intakeNumber}%`));
  if (f.unverifiedOnly) conds.push(eq(stockEntries.intakeUnverified, true));
  if (f.text) {
    // 「내용 찾기」(2026-10-07): 제목·비고에 보이는 글자는 다 찾아진다. 머리의 글자 칸 + 줄 비고.
    const pat = `%${f.text}%`;
    conds.push(
      or(
        ilike(stockEntries.reason, pat),
        ilike(stockEntries.counterparty, pat),
        ilike(stockEntries.note, pat),
        ilike(stockEntries.customerName, pat),
        ilike(stockEntries.endUser, pat),
        ilike(stockEntries.productModel, pat),
        ilike(stockEntries.usagePlace, pat),
        ilike(stockEntries.purposeText, pat),
        sql`exists (select 1 from stock_transactions t where t.entry_id = ${stockEntries.id} and t.note ilike ${pat})`,
      ),
    );
  }
  if (f.partText) {
    // 「부품 찾기」: 체크한 곳 중 어디든 들어 있으면. No. 는 숫자일 때만 같은 값으로 본다.
    const pat = `%${f.partText}%`;
    const ors = [];
    if (f.partFields.includes("n") && /^\d+$/.test(f.partText)) ors.push(sql`p.no = ${Number(f.partText)}`);
    if (f.partFields.includes("a")) ors.push(sql`p.name ilike ${pat}`);
    if (f.partFields.includes("b")) ors.push(sql`p.name2 ilike ${pat}`);
    if (f.partFields.includes("d")) ors.push(sql`p.drawing_no ilike ${pat}`);
    if (f.partFields.includes("p")) ors.push(sql`p.kyosan_part_no ilike ${pat}`);
    if (ors.length === 0) ors.push(sql`false`);
    conds.push(sql`exists (select 1 from stock_transactions t join parts p on p.id = t.part_id where t.entry_id = ${stockEntries.id} and (${sql.join(ors, sql` or `)}))`);
  }
  const where = conds.length > 0 ? and(...conds) : undefined;
  const [c] = await db().select({ n: count() }).from(stockEntries).where(where);
  const total = c?.n ?? 0;
  const heads = await db()
    .select()
    .from(stockEntries)
    .where(where)
    .orderBy(desc(stockEntries.occurredOn), desc(stockEntries.createdAt))
    .limit(PAGE_SIZE)
    .offset((f.page - 1) * PAGE_SIZE);
  const lines = await linesFor(heads.map((h) => h.id));
  return { rows: heads.map((h) => toEntryRow(h, lines.get(h.id) ?? [])), total, pageSize: PAGE_SIZE };
}

/** 부품 하나의 수량 이력 (상세 창 「이 프로그램에 쌓인 기록」). 최신이 위. */
export interface PartHistoryLine {
  transactionId: string;
  entryId: string;
  type: EntryType;
  occurredOn: string;
  sheetYear: number;
  sheetNo: number;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  chargeType: ChargeType | null;
  intakeNumber: string;
  intakeUnverified: boolean;
  usagePlace: string;
  counterparty: string;
  reason: string;
  note: string;
  createdByName: string;
  confirmedByName: string | null;
  corrected: boolean;
}

export async function partHistory(partId: string, limit = 200): Promise<PartHistoryLine[]> {
  const rows = await db()
    .select({
      transactionId: stockTransactions.id,
      entryId: stockEntries.id,
      type: stockEntries.type,
      occurredOn: stockEntries.occurredOn,
      sheetYear: stockEntries.sheetYear,
      sheetNo: stockEntries.sheetNo,
      delta: stockTransactions.delta,
      quantityBefore: stockTransactions.quantityBefore,
      quantityAfter: stockTransactions.quantityAfter,
      chargeType: stockTransactions.chargeType,
      intakeNumber: stockEntries.intakeNumber,
      intakeUnverified: stockEntries.intakeUnverified,
      usagePlace: stockEntries.usagePlace,
      counterparty: stockEntries.counterparty,
      reason: stockEntries.reason,
      note: stockTransactions.note,
      createdByName: stockEntries.createdByName,
      confirmedByName: stockEntries.confirmedByName,
      corrected: sql<boolean>`exists (select 1 from stock_transactions r where r.reverses_transaction_id = ${stockTransactions.id})`,
    })
    .from(stockTransactions)
    .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
    .where(eq(stockTransactions.partId, partId))
    .orderBy(desc(stockEntries.occurredOn), desc(stockTransactions.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, corrected: Boolean(r.corrected) }));
}

/** 반환 화면용: 이 부품의 사용·대여 줄 중 아직 돌아올 수량이 남은 것. */
export interface ReturnCandidate {
  transactionId: string;
  type: EntryType;
  occurredOn: string;
  sheetYear: number;
  sheetNo: number;
  intakeNumber: string;
  usagePlace: string;
  counterparty: string;
  taken: number;
  returned: number;
  remaining: number;
}

export async function returnCandidates(partId: string): Promise<ReturnCandidate[]> {
  const rows = await db()
    .select({
      transactionId: stockTransactions.id,
      type: stockEntries.type,
      occurredOn: stockEntries.occurredOn,
      sheetYear: stockEntries.sheetYear,
      sheetNo: stockEntries.sheetNo,
      intakeNumber: stockEntries.intakeNumber,
      usagePlace: stockEntries.usagePlace,
      counterparty: stockEntries.counterparty,
      delta: stockTransactions.delta,
      returned: sql<number>`coalesce((select sum(r.delta) from stock_transactions r where r.returns_transaction_id = ${stockTransactions.id}), 0)`.mapWith(Number),
      corrected: sql<boolean>`exists (select 1 from stock_transactions r where r.reverses_transaction_id = ${stockTransactions.id})`,
    })
    .from(stockTransactions)
    .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
    .where(and(eq(stockTransactions.partId, partId), inArray(stockEntries.type, ["USE", "LOAN"])))
    .orderBy(desc(stockEntries.occurredOn), desc(stockTransactions.createdAt))
    .limit(100);
  return rows
    .filter((r) => !r.corrected && r.delta < 0)
    .map((r) => ({
      transactionId: r.transactionId,
      type: r.type,
      occurredOn: r.occurredOn,
      sheetYear: r.sheetYear,
      sheetNo: r.sheetNo,
      intakeNumber: r.intakeNumber,
      usagePlace: r.usagePlace,
      counterparty: r.counterparty,
      taken: -r.delta,
      returned: r.returned,
      remaining: -r.delta - r.returned,
    }))
    .filter((r) => r.remaining > 0);
}

/** 부품에 원장 줄이 있나 (삭제 막기 — 조각 3 mutations.ts 의 TODO) */
export async function partHasTransactions(partId: string): Promise<boolean> {
  const [r] = await db().select({ n: count() }).from(stockTransactions).where(eq(stockTransactions.partId, partId));
  return (r?.n ?? 0) > 0;
}

/**
 * 기록 id(uuid) → 사람이 읽는 번호(US-2026-10 꼴). 변경 이력 화면이 옛 「엑셀 기준 적용」 기록(번호를 detail 에 안 남긴 것)을
 * 보여 줄 때만 쓴다 — 감사 로그는 append-only 라 고쳐 넣지 않고 볼 때 찾는다. 모르는 id 는 빠진다.
 */
export async function entryNosByIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await db()
    .select({ id: stockEntries.id, type: stockEntries.type, sheetYear: stockEntries.sheetYear, sheetNo: stockEntries.sheetNo })
    .from(stockEntries)
    .where(inArray(stockEntries.id, ids));
  for (const r of rows) out.set(r.id, sheetNoText(r.type, r.sheetYear, r.sheetNo));
  return out;
}
