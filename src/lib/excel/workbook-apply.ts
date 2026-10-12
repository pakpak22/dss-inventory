import { createHash } from "node:crypto";
import { buildPartIndex, matchRecord, type IndexedPart, type RecordKey } from "@/lib/legacy/match";
import { ENTRY_TYPE_LABEL, INTAKE_NUMBER_RE, PURPOSE_LABEL } from "@/lib/stock/codes";
import type { EntryInput } from "@/lib/stock/form";
import type { ChargeType, EntryType, Purpose } from "@/db/schema/stock";
import { SHEET_CHANGE_NAME, SHEET_RECEIVE_NAME, SHEET_USE_NAME } from "./full-workbook";
import { STOCK_SHEET_NAME } from "./stock-workbook";
import type { RowFull, SheetDiff, WorkbookDiff } from "./workbook-diff";

/**
 * [엑셀 기준 적용] 계획 — 순수 함수 (조각 8-B, DESIGN 6-6절, docs/조각8B_계획_2026-10-12.md).
 * 8-A 의 차이(WorkbookDiff)를 받아 「원장에 쓸 기록 입력 N건」과 「사람에게 남길 줄」로 가른다. 파일·DB·시각을 모른다.
 *
 * 자동으로 바꾸는 것(계획 2절):
 *  - 사용처·입고 기입란의 **더한 줄** → USE / RECEIVE
 *  - 수량 변경 기록의 더한 줄 중 종류가 조정·폐기·대여(·입고) → ADJUST / DISPOSE / LOAN(/RECEIVE)
 *  - 부품 재고 현황의 **수량 칸 바뀜** → 더한 줄을 다 반영한 뒤의 예상 수량과 견줘 **차이만** ADJUST (계획 3절, 두 번 빼지 않게)
 * 나머지(기존 줄 고침·지움, 반환·소유 옮김·기록 취소, 부품의 수량 아닌 칸, 새 No.·사라진 No., 못 맞춘 부품, 날짜·수량 못 읽음)는
 * 전부 `skipped` 에 이유와 함께 남긴다. 조용히 버리는 줄은 없다.
 *
 * 부품 맞추기는 가져오기 규칙(legacy/match.ts) 그대로 — 품명·품명2·도번·소유 네 칸 글자. 단 엑셀의 `-` 와 DB 의 빈 값은 같은 것으로 본다.
 * 묶음(16묶음)·소유 불일치는 새 줄에는 판정표가 없으니 사람에게 남긴다.
 *
 * 칸은 **머리글 이름**으로 찾는다(차이 쪽이 파일 1행에서 읽어 둔 columns). 실제 현황판 머리글(legacy/workbook.ts)과 짧은 이름 둘 다 받는다.
 */

export interface ApplyPart {
  id: string;
  no: number;
  name: string;
  name2: string;
  drawingNo: string;
  /** 엑셀 소유 칸 글자 (OWNER_LABEL) */
  ownerLabel: string;
  /** 지금 프로그램 수량 */
  quantity: number;
}

export interface PlannedEntry {
  sheet: string;
  rowLabel: string;
  input: EntryInput;
  partId: string;
  partNo: number;
  partName: string;
  /** 부호 있는 변동(화면·예상 수량용). 조정은 그 차이. */
  delta: number;
  /** 화면 한 줄 요약 */
  summary: string;
  /** 엑셀 줄에 적힌 비고(화면용) */
  excelNote: string;
}

export interface SkippedRow {
  sheet: string;
  rowLabel: string;
  reason: string;
  /** 시트 칸 그대로(화면용, 없으면 빈 배열) */
  values: string[];
}

/** 부품 시트 수량 맞춤(계획 3절). adjustDelta 0 이면 조정 없음(엑셀 수량이 더한 줄의 결과였던 것). */
export interface ReconcileItem {
  partId: string;
  partNo: number;
  partName: string;
  excelQuantity: number;
  programQuantity: number;
  /** 더한 줄을 다 반영한 뒤의 예상 수량 */
  expectedQuantity: number;
  adjustDelta: number;
  input: EntryInput | null;
}

export interface ApplyPlan {
  parkedFile: string;
  entries: PlannedEntry[];
  reconcile: ReconcileItem[];
  skipped: SkippedRow[];
  /** 원장에 쓸 건수 = entries + 조정이 있는 reconcile */
  totalEntries: number;
  /** 계획의 지문. 확인 화면이 들고 가고, 적용 때 다시 세운 계획과 같아야 쓴다(계획 6절). */
  fingerprint: string;
}

/** 머리글 이름의 다른 꼴들 (실제 현황판 / 짧은 이름) */
const ALIASES: Record<string, string[]> = {
  목적: ["목적 및 출하담당", "목적"],
  유상무상: ["발주현황", "유상무상"],
  상대: ["상대", "빌려준 곳"],
};

function colOf(sheet: SheetDiff, label: string): number {
  const names = ALIASES[label] ?? [label];
  for (const n of names) {
    const i = sheet.columns.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

const dashless = (s: string): string => (s.trim() === "-" ? "" : s.trim());

/** 「YYYY-MM-DD」(차이가 날짜 칸을 풀어 둔 꼴) 또는 사람이 글자로 친 YYYY.MM.DD / YYYY/MM/DD / YYYY-M-D */
export function parseDateText(text: string): string | null {
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/.exec(text.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // 2월 30일 같은 것: Date 로 되돌려 같은지 본다 (UTC 로 만들어 시간대 영향 없이)
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? iso : null;
}

/** 정수 글자 → 숫자. 「-」·빈칸·소수·글자는 null. 쉼표는 뗀다. */
export function parseIntText(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^[+-]?\d+$/.test(t)) return null;
  return Number(t);
}

/** 「수리/정영빈」 → 목적 REPAIR, 적은 이 정영빈. 「기타/…」·모르는 글자는 OTHER + 그 글자. */
export function parsePurposeActor(text: string): { purpose: Purpose; purposeText: string; actorName: string } {
  const t = text.trim();
  const slash = t.indexOf("/");
  const head = (slash >= 0 ? t.slice(0, slash) : t).trim();
  const actorName = slash >= 0 ? t.slice(slash + 1).trim() : "";
  if (head === PURPOSE_LABEL.REPAIR) return { purpose: "REPAIR", purposeText: "", actorName };
  if (head === PURPOSE_LABEL.FIELD) return { purpose: "FIELD", purposeText: "", actorName };
  if (head === "" || head === "-") return { purpose: "OTHER", purposeText: "엑셀에 적힌 목적 없음", actorName };
  if (head === PURPOSE_LABEL.OTHER) return { purpose: "OTHER", purposeText: "기타", actorName };
  return { purpose: "OTHER", purposeText: head, actorName };
}

export function parseChargeText(text: string): ChargeType | null {
  const t = text.trim();
  if (t === "유상") return "PAID";
  if (t === "무상") return "FREE";
  return null;
}

/** 수량 변경 기록 시트의 「종류」 글자 → 기록 종류. 모르는 글자는 null. */
export function parseEntryTypeLabel(text: string): EntryType | null {
  const t = text.trim();
  for (const [code, label] of Object.entries(ENTRY_TYPE_LABEL) as Array<[EntryType, string]>) {
    if (label === t) return code;
  }
  if (t === "폐기" || t === "불량") return "DISPOSE";
  return null;
}

/** 원장 비고에 남길 출처 글자: 어느 치워 둔 파일의 어느 줄에서 왔나 (+ 엑셀에 적힌 사람 이름) */
export function provenanceNote(parkedFile: string, sheet: string, rowLabel: string, actorName: string): string {
  const who = actorName && actorName !== "-" ? ` · 적은 이 ${actorName}` : "";
  return `엑셀 기준 적용 · ${parkedFile} · ${sheet} ${rowLabel}${who}`;
}

interface Ctx {
  parkedFile: string;
  index: ReturnType<typeof buildPartIndex>;
  byNo: Map<number, ApplyPart>;
  /** 계획 차례대로 누적한 예상 수량 (부품 id → 수량) */
  running: Map<string, number>;
  entries: PlannedEntry[];
  skipped: SkippedRow[];
}

function expected(ctx: Ctx, p: ApplyPart): number {
  return ctx.running.get(p.id) ?? p.quantity;
}
function bump(ctx: Ctx, p: ApplyPart, delta: number): void {
  ctx.running.set(p.id, expected(ctx, p) + delta);
}

/** 기입란 한 줄의 부품 찾기. 못 찾으면 이유 글자. */
function findPart(ctx: Ctx, sheet: SheetDiff, row: RowFull, recSheet: "USE" | "RECEIVE"): { part: ApplyPart } | { reason: string } {
  const v = (label: string) => {
    const i = colOf(sheet, label);
    return i >= 0 ? row.values[i] ?? "" : "";
  };
  const name = v("품명").trim();
  if (!name) return { reason: "품명이 비어 있음" };
  const rec: RecordKey = { sheet: recSheet, row: Number(row.key) || 0, name, name2: dashless(v("품명2")), drawingNo: dashless(v("도번")), ownerText: v("소유").trim() };
  const m = matchRecord(rec, ctx.index, new Map());
  if (m.status === "CONFIRMED") {
    const part = ctx.byNo.get(m.no);
    return part ? { part } : { reason: `부품 No. ${m.no} 를 찾지 못함` };
  }
  if (m.status === "OWNER_MISMATCH") return { reason: `${m.note} — 소유를 확인해 직접 적으십시오` };
  if (m.status === "GROUP_DECIDED") return { reason: "묶음 판정은 새 줄에 쓰지 않음" };
  return { reason: m.reason.startsWith("묶음") ? `같은 이름의 부품이 여럿(${m.reason.replace(/인데 판정표에 없음$/, "")}) — 어느 No. 인지 직접 고르십시오` : `맞는 부품이 없음(품명·품명2·도번·소유 네 칸이 같은 부품이 없습니다)` };
}

function planUseRow(ctx: Ctx, sheet: SheetDiff, row: RowFull): void {
  const v = (label: string) => {
    const i = colOf(sheet, label);
    return i >= 0 ? row.values[i] ?? "" : "";
  };
  const skip = (reason: string): void => {
    ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason, values: row.values });
  };
  const found = findPart(ctx, sheet, row, "USE");
  if ("reason" in found) return skip(found.reason);
  const occurredOn = parseDateText(v("날짜"));
  if (!occurredOn) return skip(`날짜를 읽을 수 없음(「${v("날짜")}」)`);
  const qty = parseIntText(v("사용 재고"));
  if (qty === null || qty <= 0) return skip(`사용 재고 칸이 1 이상의 숫자가 아님(「${v("사용 재고")}」)`);
  const charge = parseChargeText(v("유상무상"));
  if (!charge) return skip(`유상/무상이 없음(「${v("유상무상")}」) — 사용 기록에는 유상·무상이 있어야 합니다`);
  const intakeRaw = dashless(v("인수번호"));
  const noRepairCase = intakeRaw === "";
  if (!noRepairCase && !INTAKE_NUMBER_RE.test(intakeRaw)) return skip(`인수번호 꼴이 아님(「${intakeRaw}」, D+숫자 6자리)`);
  const { purpose, purposeText, actorName } = parsePurposeActor(v("목적"));
  const usagePlace = dashless(v("사용처"));
  const excelNote = dashless(v("비고"));
  const p = found.part;
  const input: EntryInput = {
    type: "USE",
    occurredOn,
    intakeNumber: noRepairCase ? "" : intakeRaw,
    noRepairCase,
    reason: noRepairCase ? usagePlace || "엑셀에 적힌 사용처 없음" : "",
    purpose,
    purposeText,
    note: provenanceNote(ctx.parkedFile, sheet.sheet, row.label, actorName),
    lines: [{ partId: p.id, quantity: qty, chargeType: charge, note: excelNote, actualQuantity: null }],
  };
  bump(ctx, p, -qty);
  ctx.entries.push({
    sheet: sheet.sheet,
    rowLabel: row.label,
    input,
    partId: p.id,
    partNo: p.no,
    partName: p.name,
    delta: -qty,
    summary: `${ENTRY_TYPE_LABEL.USE} · ${occurredOn} · No. ${p.no} ${p.name} ×${qty} · ${noRepairCase ? `수리 건 없음(${input.reason})` : intakeRaw}`,
    excelNote,
  });
}

function planReceiveRow(ctx: Ctx, sheet: SheetDiff, row: RowFull): void {
  const v = (label: string) => {
    const i = colOf(sheet, label);
    return i >= 0 ? row.values[i] ?? "" : "";
  };
  const skip = (reason: string): void => {
    ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason, values: row.values });
  };
  const found = findPart(ctx, sheet, row, "RECEIVE");
  if ("reason" in found) return skip(found.reason);
  const occurredOn = parseDateText(v("날짜"));
  if (!occurredOn) return skip(`날짜를 읽을 수 없음(「${v("날짜")}」)`);
  const qty = parseIntText(v("입고"));
  if (qty === null || qty <= 0) return skip(`입고 칸이 1 이상의 숫자가 아님(「${v("입고")}」)`);
  const excelNote = dashless(v("비고"));
  const p = found.part;
  const input: EntryInput = { type: "RECEIVE", occurredOn, note: provenanceNote(ctx.parkedFile, sheet.sheet, row.label, ""), lines: [{ partId: p.id, quantity: qty, note: excelNote }] };
  bump(ctx, p, qty);
  ctx.entries.push({ sheet: sheet.sheet, rowLabel: row.label, input, partId: p.id, partNo: p.no, partName: p.name, delta: qty, summary: `${ENTRY_TYPE_LABEL.RECEIVE} · ${occurredOn} · No. ${p.no} ${p.name} ×${qty}`, excelNote });
}

function planChangeRow(ctx: Ctx, sheet: SheetDiff, row: RowFull): void {
  const v = (label: string) => {
    const i = colOf(sheet, label);
    return i >= 0 ? row.values[i] ?? "" : "";
  };
  const skip = (reason: string): void => {
    ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason, values: row.values });
  };
  const type = parseEntryTypeLabel(v("종류"));
  if (!type) return skip(`종류를 모름(「${v("종류")}」)`);
  if (type === "RETURN" || type === "TRANSFER") return skip(`${ENTRY_TYPE_LABEL[type]}은 자동 반영하지 않음 — 되돌릴 원래 줄·상대 부품을 엑셀 글자로는 정할 수 없습니다. 기록 화면에서 직접 적으십시오`);
  if (type === "CORRECTION" || type === "OPENING") return skip(`${ENTRY_TYPE_LABEL[type]}은 엑셀에서 적을 수 없는 종류`);
  if (type === "USE") return skip("사용은 사용처 기입란에 적어야 합니다");
  const found = findPart(ctx, sheet, row, "USE");
  if ("reason" in found) return skip(found.reason);
  const occurredOn = parseDateText(v("날짜"));
  if (!occurredOn) return skip(`날짜를 읽을 수 없음(「${v("날짜")}」)`);
  const delta = parseIntText(v("변동"));
  if (delta === null || delta === 0) return skip(`변동 칸이 0 아닌 숫자가 아님(「${v("변동")}」)`);
  const excelNote = dashless(v("비고"));
  const actorName = dashless(v("담당"));
  const p = found.part;
  const note = provenanceNote(ctx.parkedFile, sheet.sheet, row.label, actorName);
  let input: EntryInput;
  let signed = delta;
  if (type === "ADJUST") {
    input = { type: "ADJUST", occurredOn, reason: excelNote || "엑셀에 적힌 조정", note, partId: p.id, actualQuantity: expected(ctx, p) + delta };
  } else if (type === "DISPOSE") {
    if (delta > 0) return skip("폐기·불량의 변동은 음수여야 합니다");
    signed = delta;
    input = { type: "DISPOSE", occurredOn, reason: excelNote || "엑셀에 적힌 폐기·불량", note, lines: [{ partId: p.id, quantity: -delta, note: excelNote }] };
  } else if (type === "LOAN") {
    if (delta > 0) return skip("대여의 변동은 음수여야 합니다(빌려 나간 수량)");
    const counterparty = dashless(v("상대"));
    if (!counterparty) return skip("빌려준 곳(상대)이 비어 있음");
    input = { type: "LOAN", occurredOn, counterparty, note, lines: [{ partId: p.id, quantity: -delta, note: excelNote }] };
  } else if (type === "RECEIVE") {
    if (delta < 0) return skip("입고의 변동은 양수여야 합니다");
    input = { type: "RECEIVE", occurredOn, note, lines: [{ partId: p.id, quantity: delta, note: excelNote }] };
  } else {
    return skip(`${ENTRY_TYPE_LABEL[type]}은 자동 반영하지 않음`);
  }
  bump(ctx, p, signed);
  ctx.entries.push({
    sheet: sheet.sheet,
    rowLabel: row.label,
    input,
    partId: p.id,
    partNo: p.no,
    partName: p.name,
    delta: signed,
    summary: `${ENTRY_TYPE_LABEL[type]} · ${occurredOn} · No. ${p.no} ${p.name} ${signed > 0 ? "+" : ""}${signed}${type === "LOAN" ? ` · ${dashless(v("상대"))}` : ""}`,
    excelNote,
  });
}

/** 부품 재고 현황 시트: 수량 칸 바뀜만 맞춤 대상. 나머지 칸·새 No.·사라진 No. 는 사람에게. */
function planPartsSheet(ctx: Ctx, sheet: SheetDiff): ReconcileItem[] {
  const out: ReconcileItem[] = [];
  for (const row of sheet.changed) {
    const no = Number(row.key);
    const p = ctx.byNo.get(no);
    const others = row.cells.filter((c) => c.label !== "수량");
    if (others.length > 0) {
      ctx.skipped.push({
        sheet: sheet.sheet,
        rowLabel: row.label,
        reason: `${others.map((c) => `${c.label}(${c.before || "빈칸"} → ${c.after || "빈칸"})`).join(", ")} — 부품 정보는 부품 수정 화면에서 고치십시오`,
        values: [],
      });
    }
    const q = row.cells.find((c) => c.label === "수량");
    if (!q) continue;
    if (!p) {
      ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason: `No. ${row.key} 부품을 프로그램에서 찾지 못함`, values: [] });
      continue;
    }
    const excelQuantity = parseIntText(q.after);
    if (excelQuantity === null || excelQuantity < 0) {
      ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason: `수량 칸이 0 이상의 숫자가 아님(「${q.after}」)`, values: [] });
      continue;
    }
    const expectedQuantity = expected(ctx, p);
    const adjustDelta = excelQuantity - expectedQuantity;
    const input: EntryInput | null =
      adjustDelta === 0
        ? null
        : {
            type: "ADJUST",
            occurredOn: "", // 적용하는 날로 — 실행 쪽이 채운다(순수 함수는 오늘을 모른다)
            reason: `엑셀 기준 적용 — 부품 재고 현황의 수량을 ${excelQuantity} 로 고침`,
            note: provenanceNote(ctx.parkedFile, sheet.sheet, row.label, ""),
            partId: p.id,
            actualQuantity: excelQuantity,
          };
    out.push({ partId: p.id, partNo: p.no, partName: p.name, excelQuantity, programQuantity: p.quantity, expectedQuantity, adjustDelta, input });
  }
  for (const row of sheet.added) ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason: "새 No. — 부품 등록은 부품 등록 화면에서", values: row.values });
  for (const row of sheet.removed) ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason: "사라진 No. — 부품 삭제는 자동으로 하지 않음", values: row.values });
  return out;
}

/** 기록 시트의 기존 줄 고침·지움은 전부 사람에게 (원장은 고치지 않는다 — 기록 취소로만) */
function skipEditedRows(ctx: Ctx, sheet: SheetDiff): void {
  for (const row of sheet.changed) {
    ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason: `기존 줄을 고침(${row.cells.map((c) => `${c.label}: ${c.before || "빈칸"} → ${c.after || "빈칸"}`).join(", ")}) — 원장은 고치지 않습니다. 잘못된 줄이면 기록 취소를, 빠진 것이면 새 기록을`, values: [] });
  }
  for (const row of sheet.removed) ctx.skipped.push({ sheet: sheet.sheet, rowLabel: row.label, reason: "기존 줄을 지움 — 원장은 지우지 않습니다. 잘못된 줄이면 기록 취소를", values: row.values });
}

export function planApply(diff: WorkbookDiff, parts: readonly ApplyPart[], parkedFile: string): ApplyPlan {
  const indexed: IndexedPart[] = parts.map((p) => ({ no: p.no, name: p.name.trim(), name2: dashless(p.name2), drawingNo: dashless(p.drawingNo), ownerText: p.ownerLabel.trim() }));
  const ctx: Ctx = { parkedFile, index: buildPartIndex(indexed), byNo: new Map(parts.map((p) => [p.no, p])), running: new Map(), entries: [], skipped: [] };

  // 1. 기입란·수량 변경 기록의 더한 줄(줄 번호 차례 = 사람이 적은 차례)
  const by = (name: string) => diff.sheets.find((s) => s.sheet === name);
  const use = by(SHEET_USE_NAME);
  const receive = by(SHEET_RECEIVE_NAME);
  const change = by(SHEET_CHANGE_NAME);
  if (use) {
    skipEditedRows(ctx, use);
    for (const row of use.added) planUseRow(ctx, use, row);
  }
  if (receive) {
    skipEditedRows(ctx, receive);
    for (const row of receive.added) planReceiveRow(ctx, receive, row);
  }
  if (change) {
    skipEditedRows(ctx, change);
    for (const row of change.added) planChangeRow(ctx, change, row);
  }
  // 2. 부품 시트 수량은 마지막에 차이만 (계획 3절)
  const partsSheet = by(STOCK_SHEET_NAME);
  const reconcile = partsSheet ? planPartsSheet(ctx, partsSheet) : [];

  const totalEntries = ctx.entries.length + reconcile.filter((r) => r.input !== null).length;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        parkedFile,
        entries: ctx.entries.map((e) => e.input),
        reconcile: reconcile.map((r) => [r.partId, r.excelQuantity, r.expectedQuantity, r.adjustDelta]),
      }),
    )
    .digest("hex");
  return { parkedFile, entries: ctx.entries, reconcile, skipped: ctx.skipped, totalEntries, fingerprint };
}

/** 확인 화면·감사 로그용 한 줄 요약: 「사용 2 · 입고 1 · 조정 1 (반영 불가 3줄)」 */
export function summarizePlan(plan: ApplyPlan): string {
  const counts = new Map<string, number>();
  for (const e of plan.entries) counts.set(ENTRY_TYPE_LABEL[e.input.type], (counts.get(ENTRY_TYPE_LABEL[e.input.type]) ?? 0) + 1);
  const adj = plan.reconcile.filter((r) => r.input !== null).length;
  if (adj > 0) counts.set(`${ENTRY_TYPE_LABEL.ADJUST}(수량 맞춤)`, adj);
  const head = [...counts].map(([k, n]) => `${k} ${n}`).join(" · ") || "반영할 기록 없음";
  return plan.skipped.length > 0 ? `${head} (반영 불가 ${plan.skipped.length}줄)` : head;
}
