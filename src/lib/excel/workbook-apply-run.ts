import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { workbookApplyLogs } from "@/db/schema/workbook-apply-logs";
import { workbookStates } from "@/db/schema/workbook-states";
import { auditValues } from "@/lib/audit";
import { OWNER_LABEL } from "@/lib/parts/codes";
import { listParts } from "@/lib/parts/queries";
import { sheetNoText, todaySeoul } from "@/lib/stock/codes";
import type { EntryInput } from "@/lib/stock/form";
import { LedgerAbort, ledgerErrorMessage, recordEntryIn, type Actor } from "@/lib/stock/ledger";
import { planApply, summarizePlan, type ApplyPlan } from "./workbook-apply";
import { LOCK_KEY, readParkedDiff, readParkedFile } from "./workbook-sync";

/**
 * [엑셀 기준 적용] 실행 (조각 8-B, DESIGN 6-6절, docs/조각8B_계획_2026-10-12.md 6·7절).
 *
 *  - `readParkedPlan`: 치워 둔 파일의 차이(8-A) + 지금 부품·수량으로 계획을 세운다. 읽기만. 확인 화면과 적용 둘 다 이것으로 세운다.
 *  - `applyExcel`: 관리자가 확인 화면에서 본 계획의 지문과 **다시 세운** 계획의 지문이 같을 때만, 한 트랜잭션에
 *    원장 N건 + 적용 기록 한 줄 + 멈춤 해제(써야 함)를 넣는다. 하나라도 거절되면 전부 되돌린다(전부 되거나 전부 안 되거나).
 *
 * 🔴 치워 둔 파일은 지우지 않는다. 같은 파일(sha256)은 두 번 적지 않는다(`workbook_apply_logs` UNIQUE + 적용 전 조회).
 * 🔴 원장 쓰기는 ledger.ts 의 `recordEntryIn` 만 — 여기서 stock_* 표를 직접 만지지 않는다 (CLAUDE.md 11절).
 */

const STATE_ID = "00000000-0000-4000-8000-000000000001";

export type ParkedPlanResult =
  | { available: true; plan: ApplyPlan; parkedSha256: string }
  | { available: false; reason: "not_parked" | "no_baseline" | "error"; parkedFile: string | null; message?: string };

export async function readParkedPlan(): Promise<ParkedPlanResult> {
  const d = await readParkedDiff();
  if (!d.available) return { available: false, reason: d.reason, parkedFile: d.parkedFile, message: d.message };
  const file = await readParkedFile();
  if (!file) return { available: false, reason: "error", parkedFile: d.parkedFile, message: "수기입 파일을 읽지 못했습니다." };
  const parts = (await listParts()).map((p) => ({ id: p.id, no: p.no, name: p.name, name2: p.name2, drawingNo: p.drawingNo, ownerLabel: OWNER_LABEL[p.owner], quantity: p.quantity }));
  const plan = planApply(d.diff, parts, d.parkedFile);
  return { available: true, plan, parkedSha256: createHash("sha256").update(file.bytes).digest("hex") };
}

export type ApplyExcelResult = { ok: true; count: number; summary: string } | { ok: false; message: string };

class ApplyAbort extends Error {}

/**
 * @param expectedFingerprint 확인 화면이 들고 온 계획 지문
 * @param reason 관리자가 적은 사유(필수)
 */
export async function applyExcel(expectedFingerprint: string, reason: string, admin: Actor, now = new Date()): Promise<ApplyExcelResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, message: "사유를 적어 주십시오." };
  const planned = await readParkedPlan();
  if (!planned.available) return { ok: false, message: planned.reason === "not_parked" ? "지금은 멈춤 상태가 아닙니다. 적용할 수기입 파일이 없습니다." : `수기입 파일을 견줄 수 없습니다: ${planned.message ?? planned.reason}` };
  const { plan, parkedSha256 } = planned;
  if (plan.fingerprint !== expectedFingerprint) return { ok: false, message: "확인한 뒤 내용이 바뀌었습니다(엑셀 파일이나 프로그램 수량). 다시 확인하십시오." };
  if (plan.totalEntries === 0) return { ok: false, message: "원장에 적을 기록이 없습니다. 반영 불가 줄은 평소 화면에서 직접 적은 뒤 [프로그램 기준 적용]을 누르십시오." };

  // 부품 시트 수량 맞춤(조정)은 적용하는 날 날짜로 — 순수 함수는 오늘을 모른다
  const today = todaySeoul();
  const inputs: Array<{ where: string; input: EntryInput }> = [
    ...plan.entries.map((e) => ({ where: `${e.sheet} ${e.rowLabel}`, input: e.input })),
    ...plan.reconcile.filter((r) => r.input !== null).map((r) => ({ where: `부품 재고 현황 No. ${r.partNo} 수량 맞춤`, input: { ...(r.input as EntryInput), occurredOn: today } as EntryInput })),
  ];
  const summary = summarizePlan(plan);

  try {
    const entryIds = await db().transaction(async (tx) => {
      // 쓰기(runWorkbookSync)와 같은 열쇠 — 적용 중에 자동 갱신이 끼어들지 않는다
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
      const [state] = await tx.select().from(workbookStates).where(eq(workbookStates.id, STATE_ID)).limit(1);
      if (!state || state.status !== "PARKED" || state.parkedFile !== plan.parkedFile) throw new ApplyAbort("멈춤 상태가 바뀌었습니다(다른 관리자가 먼저 처리했을 수 있습니다). 화면을 새로 고치십시오.");
      const [dup] = await tx.select({ id: workbookApplyLogs.id, at: workbookApplyLogs.appliedAt, by: workbookApplyLogs.appliedByName }).from(workbookApplyLogs).where(eq(workbookApplyLogs.parkedSha256, parkedSha256)).limit(1);
      if (dup) throw new ApplyAbort(`이 파일은 이미 적용되었습니다(${dup.by}, ${dup.at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}).`);

      const ids: string[] = [];
      // 사람이 읽는 기록 번호(US-2026-10 꼴). 변경 이력 화면은 uuid 를 보여 줄 수 없어 번호를 따로 남긴다(10-12 사용자 지적: JSON 그대로 보임).
      const nos: string[] = [];
      for (const { where, input } of inputs) {
        try {
          const r = await recordEntryIn(tx, input, admin);
          ids.push(r.entryId);
          nos.push(sheetNoText(r.type, r.sheetYear, r.sheetNo));
        } catch (e) {
          if (e instanceof LedgerAbort) throw new ApplyAbort(`${where} — ${ledgerErrorMessage(e.error)}`);
          throw e;
        }
      }

      await tx.insert(workbookApplyLogs).values({
        parkedFile: plan.parkedFile,
        parkedSha256,
        planFingerprint: plan.fingerprint,
        reason: trimmed,
        appliedBy: admin.id,
        appliedByName: admin.name,
        appliedAt: now,
        entryIds: ids,
        entryCount: ids.length,
        skippedCount: plan.skipped.length,
        summary,
      });
      // 멈춤 해제 = [프로그램 기준 적용]과 같은 갱신. 「써야 함」은 recordEntryIn 안의 writeEntry 가 이미 남겼다 → 다음 차례에 한 벌을 다시 쓴다.
      await tx
        .update(workbookStates)
        .set({ status: "OK", errorCount: 0, errorMessage: null, resumedBy: admin.id, resumedByName: admin.name, resumedAt: now, updatedAt: now })
        .where(eq(workbookStates.id, STATE_ID));
      await tx.insert(auditLogs).values(
        auditValues({
          action: "WORKBOOK_EXCEL_APPLIED",
          actorId: admin.id,
          actorName: admin.name,
          target: "workbook",
          detail: { parkedFile: plan.parkedFile, parkedSha256, reason: trimmed, summary, entryCount: ids.length, skippedCount: plan.skipped.length, entryIds: ids, entryNos: nos },
        }),
      );
      return ids;
    });
    return { ok: true, count: entryIds.length, summary };
  } catch (e) {
    if (e instanceof ApplyAbort) return { ok: false, message: e.message };
    throw e;
  }
}
