import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import { stockEntries, stockTransactions, type ChargeType, type EntryType, type Purpose } from "@/db/schema/stock";
import { auditValues } from "@/lib/audit";
import { markWorkbookDirty } from "@/lib/excel/workbook-sync";
import { sheetOf } from "./codes";
import type { EntryInput } from "./form";
import { buildUsagePlace, lookupIntake, type IntakeInfo } from "./intake-lookup";

/**
 * 원장 쓰기 — 수량을 바꾸는 **유일한** 길 (CLAUDE.md 11절, DESIGN 4-4절).
 *
 * 한 트랜잭션 안에서: 번호표(sheet_no) 받기 → 머리(stock_entries) → 줄(stock_transactions) → 캐시(stock_balances) → 감사 로그.
 * 둘 중 하나만 되는 일은 없다. 부품 수량 줄은 `FOR UPDATE` 로 잠그고 0 아래로 내려가면 전체를 되돌린다.
 *
 * 🔴 stock_balances 를 여기 말고 다른 곳에서 UPDATE 하지 마라.
 */
export interface Actor {
  id: string;
  name: string;
}

export type LedgerError =
  | { code: "part_not_found"; partId: string }
  | { code: "insufficient"; partNo: number; partName: string; have: number; need: number }
  | { code: "no_change"; partNo: number }
  | { code: "intake_not_found"; intakeNumber: string }
  | { code: "return_source_invalid"; transactionId: string }
  | { code: "return_exceeds"; partNo: number; remaining: number; requested: number }
  | { code: "transfer_mismatch"; reason: string }
  | { code: "already_corrected" }
  | { code: "not_correctable" };

export type RecordResult =
  | { ok: true; entryId: string; sheetYear: number; sheetNo: number; type: EntryType; intakeUnverified: boolean; adjustEntryId: string | null }
  | { ok: false; error: LedgerError };

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

interface LineSpec {
  partId: string;
  delta: number;
  chargeType?: ChargeType | null;
  note?: string;
  returnsTransactionId?: string | null;
  reversesTransactionId?: string | null;
}

interface HeadSpec {
  type: EntryType;
  occurredOn: string;
  intakeNumber?: string;
  intakeUnverified?: boolean;
  noRepairCase?: boolean;
  intake?: IntakeInfo | null;
  purpose?: Purpose | null;
  purposeText?: string;
  counterparty?: string;
  reason?: string;
  note?: string;
  /** 확인 대기를 거친 건이면 신청 id 와 확인한 담당자 (2026-10-06 확인 단계) */
  requestId?: string | null;
  confirmedBy?: Actor | null;
}

/** 연도별·시트별 순번. 같은 (시트, 연도) 에 동시에 두 건이 들어와도 겹치지 않게 트랜잭션 잠금을 건다. */
async function nextSheetNo(tx: Tx, sheet: string, year: number): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sheet:${sheet}:${year}`}))`);
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${stockEntries.sheetNo}), 0)`.mapWith(Number) })
    .from(stockEntries)
    .where(and(eq(stockEntries.sheet, sheet as never), eq(stockEntries.sheetYear, year)));
  return (row?.max ?? 0) + 1;
}

/** 부품 수량 줄을 잠그고 읽는다. 줄이 없으면(옛 자료) 0 으로 만든다. */
async function lockBalances(tx: Tx, partIds: string[]): Promise<Map<string, { no: number; name: string; quantity: number }>> {
  const ids = [...new Set(partIds)];
  const rows = await tx
    .select({ id: parts.id, no: parts.no, name: parts.name, isDeleted: parts.isDeleted })
    .from(parts)
    .where(inArray(parts.id, ids));
  const out = new Map<string, { no: number; name: string; quantity: number }>();
  for (const p of rows) {
    if (p.isDeleted) continue;
    await tx.insert(stockBalances).values({ partId: p.id, quantity: 0 }).onConflictDoNothing();
    const [b] = await tx
      .select({ quantity: stockBalances.quantity })
      .from(stockBalances)
      .where(eq(stockBalances.partId, p.id))
      .for("update");
    out.set(p.id, { no: p.no, name: p.name, quantity: b?.quantity ?? 0 });
  }
  return out;
}

/** 머리 + 줄 + 캐시 + 감사 로그. 호출자가 트랜잭션 안에서 부른다. */
async function writeEntry(tx: Tx, head: HeadSpec, lines: LineSpec[], actor: Actor): Promise<{ ok: true; entryId: string; sheetYear: number; sheetNo: number } | { ok: false; error: LedgerError }> {
  const balances = await lockBalances(
    tx,
    lines.map((l) => l.partId),
  );
  for (const l of lines) if (!balances.has(l.partId)) return { ok: false, error: { code: "part_not_found", partId: l.partId } };

  // 같은 부품이 한 건에 두 줄(소유 옮김은 다른 부품이라 해당 없음)이어도 순서대로 누적
  const running = new Map<string, number>();
  const computed: Array<LineSpec & { before: number; after: number }> = [];
  for (const l of lines) {
    const b = balances.get(l.partId)!;
    const before = running.get(l.partId) ?? b.quantity;
    const after = before + l.delta;
    if (after < 0) return { ok: false, error: { code: "insufficient", partNo: b.no, partName: b.name, have: before, need: -l.delta } };
    running.set(l.partId, after);
    computed.push({ ...l, before, after });
  }

  const sheet = sheetOf(head.type);
  const sheetYear = Number(head.occurredOn.slice(0, 4));
  const sheetNo = await nextSheetNo(tx, sheet, sheetYear);
  const intake = head.intake ?? null;

  const [entry] = await tx
    .insert(stockEntries)
    .values({
      type: head.type,
      sheet,
      occurredOn: head.occurredOn,
      sheetYear,
      sheetNo,
      intakeNumber: head.intakeNumber ?? "",
      intakeUnverified: head.intakeUnverified ?? false,
      noRepairCase: head.noRepairCase ?? false,
      customerName: intake?.customerName ?? "",
      endUser: intake?.endUser ?? "",
      productModel: intake?.productModel ?? "",
      productSerial: intake?.productSerial ?? "",
      productLot: intake?.productLot ?? "",
      usagePlace: intake ? buildUsagePlace(intake) : "",
      purpose: head.purpose ?? null,
      purposeText: head.purposeText ?? "",
      counterparty: head.counterparty ?? "",
      reason: head.reason ?? "",
      note: head.note ?? "",
      createdBy: actor.id,
      createdByName: actor.name,
      confirmedBy: head.confirmedBy?.id ?? null,
      confirmedByName: head.confirmedBy?.name ?? null,
      requestId: head.requestId ?? null,
    })
    .returning({ id: stockEntries.id });

  for (const l of computed) {
    await tx.insert(stockTransactions).values({
      entryId: entry.id,
      partId: l.partId,
      delta: l.delta,
      quantityBefore: l.before,
      quantityAfter: l.after,
      chargeType: l.chargeType ?? null,
      note: l.note ?? "",
      returnsTransactionId: l.returnsTransactionId ?? null,
      reversesTransactionId: l.reversesTransactionId ?? null,
    });
  }
  const now = new Date();
  for (const [partId, quantity] of running) {
    await tx.update(stockBalances).set({ quantity, updatedAt: now }).where(eq(stockBalances.partId, partId));
  }
  // 수량이 바뀌었다 → 엑셀 한 벌 「써야 함」 (조각 7). 같은 트랜잭션이라 원장만 되고 표시만 빠지는 일이 없다.
  await markWorkbookDirty(tx);
  await tx.insert(auditLogs).values(
    auditValues({
      action: head.type === "CORRECTION" ? "STOCK_CORRECTION" : "STOCK_ENTRY",
      actorId: actor.id,
      actorName: actor.name,
      target: `entries:${head.type}-${sheetYear}-${sheetNo}`,
      detail: {
        occurredOn: head.occurredOn,
        intakeNumber: head.intakeNumber ?? "",
        intakeUnverified: head.intakeUnverified ?? false,
        requestId: head.requestId ?? null,
        confirmedBy: head.confirmedBy?.name ?? null,
        lines: computed.map((l) => ({ partNo: balances.get(l.partId)!.no, delta: l.delta, before: l.before, after: l.after })),
      },
    }),
  );
  return { ok: true, entryId: entry.id, sheetYear, sheetNo };
}

/**
 * 화면에서 온 기록 한 건을 쓴다. 사용(USE)은 저장 직전에 인수번호를 **서버가 다시** 확인한다 (DESIGN 7절 3번).
 *  - 찾음 → 여섯 값을 복사 / 없음 → 저장 안 됨 / A/S 응답 없음 → 저장하고 intake_unverified.
 *  - 「실제 수량이 다릅니다」 줄이 있으면 조정(ADJUST) 한 건을 **먼저** 같은 트랜잭션에 쌓고 사용을 쓴다.
 */
export interface RecordOptions {
  /** 확인 대기를 거쳐 쓰는 건 — 신청 id 와 확인한 담당자. actor 는 **신청한 사람**(부품을 가져간 사람)이다. */
  requestId?: string;
  confirmedBy?: Actor;
}

export async function recordEntry(input: EntryInput, actor: Actor, opts: RecordOptions = {}): Promise<RecordResult> {
  return db()
    .transaction((tx) => recordEntryIn(tx, input, actor, opts))
    .catch((e) => {
      if (e instanceof LedgerAbort) return { ok: false, error: e.error } satisfies RecordResult;
      throw e;
    });
}

/** 호출자가 트랜잭션을 들고 있을 때 쓰는 타입 (조각 8-B 의 엑셀 기준 적용이 쓴다) */
export type LedgerTx = Tx;

/**
 * 한 건을 **호출자의 트랜잭션 안에서** 쓴다 (2026-10-12, 조각 8-B: 엑셀 기준 적용이 여러 건 + 적용 기록 + 멈춤 해제를
 * 한 트랜잭션에 넣어야 해서 recordEntry 에서 분리. 동작은 같다).
 * 🔴 거절 사유는 결과로 돌려주지 않고 `LedgerAbort` 를 **던진다** — 그래야 호출자의 트랜잭션이 통째로 되돌아간다
 *    (drizzle 은 콜백이 던지면 ROLLBACK). 혼자 한 건 쓸 때는 recordEntry 를 부른다(던진 것을 결과로 바꿔 준다).
 */
export async function recordEntryIn(tx: Tx, input: EntryInput, actor: Actor, opts: RecordOptions = {}): Promise<Extract<RecordResult, { ok: true }>> {
  const viaRequest = { requestId: opts.requestId ?? null, confirmedBy: opts.confirmedBy ?? null };
  let intake: IntakeInfo | null = null;
  let intakeUnverified = false;
  const fail = (error: LedgerError): never => {
    throw new LedgerAbort(error);
  };
  if (input.type === "USE" && !input.noRepairCase) {
    const r = await lookupIntake(input.intakeNumber);
    if (r.status === "found") intake = r.info;
    else if (r.status === "unreachable") intakeUnverified = true;
    else return fail({ code: "intake_not_found", intakeNumber: input.intakeNumber });
  }
  switch (input.type) {
    case "USE": {
      let adjustEntryId: string | null = null;
      const adjustLines: LineSpec[] = [];
      const balances = await lockBalances(
        tx,
        input.lines.map((l) => l.partId),
      );
      for (const l of input.lines) {
        if (l.actualQuantity === null) continue;
        const b = balances.get(l.partId);
        if (!b) return fail({ code: "part_not_found", partId: l.partId });
        const delta = l.actualQuantity - b.quantity;
        if (delta !== 0) adjustLines.push({ partId: l.partId, delta, note: `사용 기록 중 실제 수량 맞춤 (${b.quantity} → ${l.actualQuantity})` });
      }
      if (adjustLines.length > 0) {
        const a = await writeEntry(tx, { type: "ADJUST", occurredOn: input.occurredOn, reason: "사용 기록 중 실제 수량이 달라 맞춤" }, adjustLines, actor);
        if (!a.ok) return fail(a.error);
        adjustEntryId = a.entryId;
      }
      const r = await writeEntry(
        tx,
        {
          type: "USE",
          occurredOn: input.occurredOn,
          intakeNumber: input.noRepairCase ? "" : input.intakeNumber,
          intakeUnverified,
          noRepairCase: input.noRepairCase,
          intake,
          purpose: input.purpose,
          purposeText: input.purposeText,
          reason: input.reason,
          note: input.note,
          ...viaRequest,
        },
        input.lines.map((l) => ({ partId: l.partId, delta: -l.quantity, chargeType: l.chargeType, note: l.note })),
        actor,
      );
      if (!r.ok) return fail(r.error);
      return { ...r, type: "USE", intakeUnverified, adjustEntryId };
    }
    case "RECEIVE":
    case "LOAN":
    case "DISPOSE": {
      const sign = input.type === "RECEIVE" ? 1 : -1;
      const r = await writeEntry(
        tx,
        {
          type: input.type,
          occurredOn: input.occurredOn,
          note: input.note,
          counterparty: input.type === "LOAN" ? input.counterparty : "",
          reason: input.type === "DISPOSE" ? input.reason : "",
          ...viaRequest,
        },
        input.lines.map((l) => ({ partId: l.partId, delta: sign * l.quantity, note: l.note })),
        actor,
      );
      if (!r.ok) return fail(r.error);
      return { ...r, type: input.type, intakeUnverified: false, adjustEntryId: null };
    }
    case "RETURN": {
      // 되돌리는 원래 줄: 사용·대여의 − 줄이어야 하고, 이미 돌아온 수량을 빼고 남은 만큼만
      const ids = input.lines.map((l) => l.transactionId);
      const sources = await tx
        .select({ id: stockTransactions.id, partId: stockTransactions.partId, delta: stockTransactions.delta, type: stockEntries.type })
        .from(stockTransactions)
        .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
        .where(inArray(stockTransactions.id, ids));
      const srcById = new Map(sources.map((s) => [s.id, s]));
      const lines: LineSpec[] = [];
      for (const l of input.lines) {
        const s = srcById.get(l.transactionId);
        if (!s || (s.type !== "USE" && s.type !== "LOAN") || s.delta >= 0) return fail({ code: "return_source_invalid", transactionId: l.transactionId });
        const [ret] = await tx
          .select({ sum: sql<number>`coalesce(sum(${stockTransactions.delta}), 0)`.mapWith(Number) })
          .from(stockTransactions)
          .where(eq(stockTransactions.returnsTransactionId, s.id));
        const [rev] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockTransactions).where(eq(stockTransactions.reversesTransactionId, s.id));
        if ((rev?.n ?? 0) > 0) return fail({ code: "return_source_invalid", transactionId: l.transactionId });
        const remaining = -s.delta - (ret?.sum ?? 0);
        if (l.quantity > remaining) {
          const [p] = await tx.select({ no: parts.no }).from(parts).where(eq(parts.id, s.partId));
          return fail({ code: "return_exceeds", partNo: p?.no ?? 0, remaining, requested: l.quantity });
        }
        lines.push({ partId: s.partId, delta: l.quantity, note: l.note, returnsTransactionId: s.id });
      }
      const r = await writeEntry(tx, { type: "RETURN", occurredOn: input.occurredOn, note: input.note, ...viaRequest }, lines, actor);
      if (!r.ok) return fail(r.error);
      return { ...r, type: "RETURN", intakeUnverified: false, adjustEntryId: null };
    }
    case "ADJUST": {
      const balances = await lockBalances(tx, [input.partId]);
      const b = balances.get(input.partId);
      if (!b) return fail({ code: "part_not_found", partId: input.partId });
      const delta = input.actualQuantity - b.quantity;
      if (delta === 0) return fail({ code: "no_change", partNo: b.no });
      const r = await writeEntry(tx, { type: "ADJUST", occurredOn: input.occurredOn, reason: input.reason, note: input.note, ...viaRequest }, [{ partId: input.partId, delta }], actor);
      if (!r.ok) return fail(r.error);
      return { ...r, type: "ADJUST", intakeUnverified: false, adjustEntryId: null };
    }
    case "TRANSFER": {
      const rows = await tx
        .select({ id: parts.id, name: parts.name, name2: parts.name2, drawingNo: parts.drawingNo, owner: parts.owner, isDeleted: parts.isDeleted })
        .from(parts)
        .where(inArray(parts.id, [input.fromPartId, input.toPartId]));
      const from = rows.find((p) => p.id === input.fromPartId);
      const to = rows.find((p) => p.id === input.toPartId);
      if (!from || from.isDeleted) return fail({ code: "part_not_found", partId: input.fromPartId });
      if (!to || to.isDeleted) return fail({ code: "part_not_found", partId: input.toPartId });
      // 소유 옮김은 같은 부품의 다른 소유 No. 사이에서만 (DESIGN 2-4절)
      if (from.owner === to.owner) return fail({ code: "transfer_mismatch", reason: "두 부품의 소유가 같습니다. 소유 옮김은 다른 소유의 같은 부품 사이에서만 합니다." });
      if (from.name !== to.name) return fail({ code: "transfer_mismatch", reason: "두 부품의 품명이 다릅니다. 소유 옮김은 같은 부품 사이에서만 합니다." });
      const r = await writeEntry(
        tx,
        { type: "TRANSFER", occurredOn: input.occurredOn, note: input.note, ...viaRequest },
        [
          { partId: input.fromPartId, delta: -input.quantity },
          { partId: input.toPartId, delta: input.quantity },
        ],
        actor,
      );
      if (!r.ok) return fail(r.error);
      return { ...r, type: "TRANSFER", intakeUnverified: false, adjustEntryId: null };
    }
  }
}

/** 원장이 거절한 이유. recordEntryIn 이 던지고 recordEntry 가 결과로 바꾼다. */
export class LedgerAbort extends Error {
  constructor(public readonly error: LedgerError) {
    super(`ledger:${error.code}`);
  }
}

/**
 * 기록 취소 (관리자, DESIGN 2-5절). 잘못된 줄 하나를 고르면 그것을 **되돌리는 줄**이 새 CORRECTION 건으로 쌓인다.
 * 원래 줄은 지워지지 않고 「취소됨」 표시가 붙는다(reverses_transaction_id). 한 줄은 한 번만.
 */
export async function correctTransaction(transactionId: string, reason: string, actor: Actor, todayIso: string): Promise<RecordResult> {
  return db()
    .transaction(async (tx) => {
      const [src] = await tx
        .select({ id: stockTransactions.id, partId: stockTransactions.partId, delta: stockTransactions.delta, type: stockEntries.type })
        .from(stockTransactions)
        .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
        .where(eq(stockTransactions.id, transactionId));
      if (!src) throw new LedgerAbort({ code: "not_correctable" });
      if (src.type === "CORRECTION") throw new LedgerAbort({ code: "not_correctable" });
      const [rev] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockTransactions).where(eq(stockTransactions.reversesTransactionId, src.id));
      if ((rev?.n ?? 0) > 0) throw new LedgerAbort({ code: "already_corrected" });
      const r = await writeEntry(tx, { type: "CORRECTION", occurredOn: todayIso, reason }, [{ partId: src.partId, delta: -src.delta, reversesTransactionId: src.id }], actor);
      if (!r.ok) throw new LedgerAbort(r.error);
      return { ...r, type: "CORRECTION" as const, intakeUnverified: false, adjustEntryId: null } satisfies RecordResult;
    })
    .catch((e) => {
      if (e instanceof LedgerAbort) return { ok: false, error: e.error } satisfies RecordResult;
      throw e;
    });
}

/** 「인수번호 확인 안 됨」 기록을 다시 확인한다 (기록 내역의 [확인]). 찾으면 여섯 값을 채우고 표시를 내린다. */
export async function reverifyIntake(entryId: string, actor: Actor): Promise<{ ok: true } | { ok: false; code: "not_found" | "unreachable" | "no_entry" }> {
  const [e] = await db().select({ id: stockEntries.id, intakeNumber: stockEntries.intakeNumber, sheetYear: stockEntries.sheetYear, sheetNo: stockEntries.sheetNo, type: stockEntries.type }).from(stockEntries).where(and(eq(stockEntries.id, entryId), eq(stockEntries.intakeUnverified, true)));
  if (!e) return { ok: false, code: "no_entry" };
  const r = await lookupIntake(e.intakeNumber);
  if (r.status === "not_found" || r.status === "bad_format") return { ok: false, code: "not_found" };
  if (r.status !== "found") return { ok: false, code: "unreachable" };
  const info = r.info;
  await db().transaction(async (tx) => {
    await tx
      .update(stockEntries)
      .set({
        intakeUnverified: false,
        customerName: info.customerName,
        endUser: info.endUser,
        productModel: info.productModel,
        productSerial: info.productSerial,
        productLot: info.productLot,
        usagePlace: buildUsagePlace(info),
      })
      .where(eq(stockEntries.id, e.id));
    await tx.insert(auditLogs).values(
      auditValues({ action: "INTAKE_VERIFIED", actorId: actor.id, actorName: actor.name, target: `entries:${e.type}-${e.sheetYear}-${e.sheetNo}`, detail: { intakeNumber: e.intakeNumber, productModel: info.productModel } }),
    );
  });
  return { ok: true };
}

/** 원장 오류 → 한국어 문구 */
export function ledgerErrorMessage(err: LedgerError): string {
  switch (err.code) {
    case "part_not_found":
      return "없는 부품이 들어 있습니다. 목록에서 다시 고르십시오.";
    case "insufficient":
      return `No. ${err.partNo} ${err.partName}: 수량이 모자랍니다 (지금 ${err.have}개, 필요 ${err.need}개). 재고는 0 아래로 내려가지 않습니다.`;
    case "no_change":
      return `No. ${err.partNo}: 실제 수량이 지금 수량과 같아 조정할 것이 없습니다.`;
    case "intake_not_found":
      return `인수번호 ${err.intakeNumber} 이(가) A/S 에 없습니다. 번호를 확인하거나 「수리 건 없음」을 고르십시오.`;
    case "return_source_invalid":
      return "되돌릴 수 없는 기록입니다. 사용·대여 기록 중 아직 취소하지 않은 것만 반환할 수 있습니다.";
    case "return_exceeds":
      return `No. ${err.partNo}: 되돌릴 수 있는 수량은 ${err.remaining}개인데 ${err.requested}개를 적었습니다.`;
    case "transfer_mismatch":
      return err.reason;
    case "already_corrected":
      return "이미 취소한 줄입니다. 한 줄은 한 번만 취소합니다.";
    case "not_correctable":
      return "취소할 수 없는 줄입니다.";
  }
}
