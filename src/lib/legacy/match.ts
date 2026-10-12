/**
 * 과거 기록 한 줄을 부품 No. 에 붙이는 규칙 — 순수 함수 (DESIGN 5절, REQUIREMENTS 12절 「최희만 지정」).
 *
 * 열쇠는 **품명·품명2·도번·소유** 네 칸의 엑셀 글자 그대로(앞뒤 공백만 뗀 것). 교산 품번은 보지 않는다 —
 * 품명 정리 때 표준 값으로 맞춘 칸이라 YAC사양 기록에도 다른 쪽 품번이 적혀 있다(DESIGN 5-1절).
 *
 *  1. 같은 열쇠의 No. 가 하나 → CONFIRMED
 *  2. 여럿(16묶음) → 묶음 판정표의 (시트, 행) 으로 → GROUP_DECIDED. 표에 없으면 넣지 않고 알린다(UNMATCHED)
 *  3. 없는데 소유만 빼고 같은 No. 가 있음 → 하나면 거기, 여럿이면 No. 가 앞선 것 → OWNER_MISMATCH
 *  4. 그것도 없음 → UNMATCHED (CSV 로 남긴다)
 *
 * 🔴 판정표의 No. 가 후보(같은 열쇠) 밖이면 표가 낡은 것이다 — 조용히 붙이지 않고 UNMATCHED 로 알린다.
 */
export interface IndexedPart {
  no: number;
  name: string;
  name2: string;
  drawingNo: string;
  ownerText: string;
}

export interface RecordKey {
  sheet: "USE" | "RECEIVE";
  row: number;
  name: string;
  name2: string;
  drawingNo: string;
  ownerText: string;
}

export interface GroupDecision {
  sheet: "USE" | "RECEIVE";
  row: number;
  no: number;
  reason: string;
}

export type MatchResult =
  | { status: "CONFIRMED"; no: number; note: string }
  | { status: "GROUP_DECIDED"; no: number; note: string }
  | { status: "OWNER_MISMATCH"; no: number; note: string }
  | { status: "UNMATCHED"; reason: string };

export interface PartIndex {
  byKey: Map<string, IndexedPart[]>;
  byKeyNoOwner: Map<string, IndexedPart[]>;
}

const SEP = "\u0001";
function k4(name: string, name2: string, drawingNo: string, ownerText: string): string {
  return [name, name2, drawingNo, ownerText].map((s) => s.trim()).join(SEP);
}
function k3(name: string, name2: string, drawingNo: string): string {
  return [name, name2, drawingNo].map((s) => s.trim()).join(SEP);
}

export function buildPartIndex(parts: readonly IndexedPart[]): PartIndex {
  const byKey = new Map<string, IndexedPart[]>();
  const byKeyNoOwner = new Map<string, IndexedPart[]>();
  for (const p of parts) {
    const a = k4(p.name, p.name2, p.drawingNo, p.ownerText);
    const b = k3(p.name, p.name2, p.drawingNo);
    byKey.set(a, [...(byKey.get(a) ?? []), p]);
    byKeyNoOwner.set(b, [...(byKeyNoOwner.get(b) ?? []), p]);
  }
  for (const list of byKey.values()) list.sort((x, y) => x.no - y.no);
  for (const list of byKeyNoOwner.values()) list.sort((x, y) => x.no - y.no);
  return { byKey, byKeyNoOwner };
}

export function decisionKey(sheet: "USE" | "RECEIVE", row: number): string {
  return `${sheet}:${row}`;
}

export function matchRecord(rec: RecordKey, index: PartIndex, decisions: ReadonlyMap<string, GroupDecision>): MatchResult {
  const exact = index.byKey.get(k4(rec.name, rec.name2, rec.drawingNo, rec.ownerText)) ?? [];
  if (exact.length === 1) return { status: "CONFIRMED", no: exact[0].no, note: "" };
  if (exact.length > 1) {
    const nos = exact.map((p) => p.no).join("·");
    const d = decisions.get(decisionKey(rec.sheet, rec.row));
    if (!d) return { status: "UNMATCHED", reason: `묶음(후보 No. ${nos})인데 판정표에 없음` };
    if (!exact.some((p) => p.no === d.no)) return { status: "UNMATCHED", reason: `판정표의 No.${d.no} 이(가) 후보(No. ${nos}) 밖` };
    return { status: "GROUP_DECIDED", no: d.no, note: d.reason };
  }
  const anyOwner = index.byKeyNoOwner.get(k3(rec.name, rec.name2, rec.drawingNo)) ?? [];
  if (anyOwner.length === 0) return { status: "UNMATCHED", reason: "맞는 부품이 없음" };
  const pick = anyOwner[0];
  const note =
    anyOwner.length === 1
      ? `소유 불일치: 기록은 「${rec.ownerText}」, 부품 No.${pick.no} 은 「${pick.ownerText}」`
      : `소유 불일치: 기록은 「${rec.ownerText}」, 후보 No. ${anyOwner.map((p) => `${p.no}(${p.ownerText})`).join("·")} 중 앞선 No.${pick.no}`;
  return { status: "OWNER_MISMATCH", no: pick.no, note };
}

/**
 * 묶음 판정표 CSV (`과거기록_묶음판정_2026-10-02.csv`). 머리글: 시트,행,날짜,인수번호,품명,품명2,도번,소유,붙일 No.,까닭
 * 까닭에 쉼표가 들어 있어(「… 0개, 수리소에서 …」) 따옴표를 아는 CSV 풀기가 필요하다.
 */
export function parseDecisionCsv(text: string): GroupDecision[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const ci = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`판정표에 「${name}」 칸이 없습니다. 머리글: ${header.join(", ")}`);
    return i;
  };
  const iSheet = ci("시트");
  const iRow = ci("행");
  const iNo = ci("붙일 No.");
  const iReason = ci("까닭");
  const out: GroupDecision[] = [];
  for (const r of rows.slice(1)) {
    if (r.every((c) => c.trim() === "")) continue;
    const sheetText = r[iSheet]?.trim();
    const sheet = sheetText === "사용처 기입란" ? "USE" : sheetText === "입고 기입란" ? "RECEIVE" : null;
    if (!sheet) throw new Error(`판정표의 시트 이름을 모릅니다: 「${sheetText}」`);
    const row = Number(r[iRow]);
    const no = Number(r[iNo]);
    if (!Number.isInteger(row) || !Number.isInteger(no)) throw new Error(`판정표의 행·No. 가 숫자가 아닙니다: ${r.join(",")}`);
    out.push({ sheet, row, no, reason: (r[iReason] ?? "").trim() });
  }
  return out;
}

/** RFC 4180 꼴의 작은 CSV 풀기. 따옴표 안의 쉼표·줄바꿈·"" 를 안다. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** CSV 한 칸으로 (쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다) */
export function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface MatchSummary {
  confirmed: number;
  groupDecided: number;
  ownerMismatch: number;
  unmatched: number;
}

export function summarize(results: readonly MatchResult[]): MatchSummary {
  const s: MatchSummary = { confirmed: 0, groupDecided: 0, ownerMismatch: 0, unmatched: 0 };
  for (const r of results) {
    if (r.status === "CONFIRMED") s.confirmed++;
    else if (r.status === "GROUP_DECIDED") s.groupDecided++;
    else if (r.status === "OWNER_MISMATCH") s.ownerMismatch++;
    else s.unmatched++;
  }
  return s;
}
