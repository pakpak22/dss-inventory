import { excelSerialToDateOnly } from "@/lib/xlsx/excel-date";
import type { GridCell, SheetGrid } from "@/lib/xlsx/sheet-grid";

/**
 * 현황판 엑셀(세 시트)을 **글자 그대로** 읽는다 — 순수 함수. 파일도 DB 도 모른다 (조각 5, DESIGN 5-3절).
 *
 * 받은 코드 묶음의 `sheet-grid.ts` 가 만든 격자(SheetGrid)를 받아 줄 단위 값으로 바꾼다.
 * 머리글 **이름**으로 칸을 찾는다 — 칸 순서가 바뀌어도 깨지지 않고, 머리글이 없으면 명확히 던진다.
 *
 * 🔴 과거 기록 쪽은 값을 고치지 않는다. `-` 도 `一` 도 그대로. 부품 쪽만 parts 표 약속대로 `-` 를 빈 값으로 받는다.
 *    대조(match.ts)는 양쪽 다 **엑셀 글자 그대로**(부품도 `-` 를 바꾸기 전 글자)로 한다 —
 *    2026-10-07 에 파이썬으로 센 네 갈래 숫자(1,349/237/55/11 · 545/85/17/15)가 그 규칙으로 나온 것이라서다.
 */

export const SHEET_PARTS = "부품 재고 현황";
export const SHEET_USE = "사용처 기입란";
export const SHEET_RECEIVE = "입고 기입란";

export interface WorkbookPart {
  row: number;
  no: number;
  name: string;
  /** `-` 를 빈 값으로 바꾼 것 (parts 표 약속) */
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
  /** 대조용: 엑셀 글자 그대로 (`-` 포함) */
  rawName2: string;
  rawDrawingNo: string;
  /** 빈칸은 0 (REQUIREMENTS 12절 「빈칸은 0」) */
  quantity: number;
  supplyPrice: number | null;
  supplyCurrency: "JPY" | "KRW";
  quotePrice: number | null;
  note: string;
  itemName: string;
  categoryText: string;
  ownerText: string;
  /** 숫자 칸에 글자가 있었던 것 */
  anomaly: string;
}

export interface LegacyRow {
  sheet: "USE" | "RECEIVE";
  row: number;
  sheetNo: number | null;
  occurredOn: string | null;
  dateText: string;
  intakeNumber: string;
  name: string;
  name2: string;
  drawingNo: string;
  kyosanPartNo: string;
  stockBefore: number | null;
  quantity: number | null;
  stockAfter: number | null;
  purposeText: string;
  note: string;
  ownerText: string;
  chargeText: string;
  usagePlace: string;
  anomaly: string;
}

const PARTS_HEADERS = ["No.", "품명", "품명2", "교산 품번", "도번", "수량", "공급가", "견적가", "비고", "항목", "분류", "소유"] as const;
const USE_HEADERS = ["No.", "날짜", "인수번호", "품명", "품명2", "도번", "교산 품번", "현 재고", "사용 재고", "이후 재고", "목적 및 출하담당", "비고", "소유", "발주현황", "사용처"] as const;
const RECEIVE_HEADERS = ["No.", "날짜", "품명", "품명2", "도번", "교산 품번", "현 재고", "입고", "이후 재고", "비고", "소유"] as const;

export class WorkbookReadError extends Error {}

/** 1행의 머리글 → 열 문자. 빠진 머리글이 있으면 던진다 — 엑셀 모양이 바뀐 것을 조용히 넘기지 않는다. */
export function headerColumns(grid: SheetGrid, sheetName: string, required: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const [col, cell] of grid.cells(1)) {
    const t = cellText(cell);
    if (t) out.set(t, col);
  }
  const missing = required.filter((h) => !out.has(h));
  if (missing.length > 0) throw new WorkbookReadError(`「${sheetName}」 시트 1행에 머리글이 없습니다: ${missing.join(", ")}`);
  return out;
}

/** 칸 → 글자. 숫자 칸은 숫자를 글자로. 없으면 빈 값. 앞뒤 공백만 뗀다. */
export function cellText(cell: GridCell | undefined): string {
  if (!cell) return "";
  if (cell.kind === "text") return cell.text.trim();
  return String(cell.value);
}

/** 칸 → 정수. 숫자가 아니면 null 을 주고 사정을 anomalies 에 적는다. 빈 칸은 null (사정 없음). */
export function cellInt(cell: GridCell | undefined, label: string, anomalies: string[]): number | null {
  if (!cell) return null;
  if (cell.kind === "number") {
    if (Number.isInteger(cell.value)) return cell.value;
    anomalies.push(`${label} 칸이 정수가 아님 「${cell.value}」`);
    return null;
  }
  const t = cell.text.trim();
  if (t === "") return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  anomalies.push(`${label} 칸에 글자 「${t}」`);
  return null;
}

/** 칸 → 날짜(YYYY-MM-DD). 일련번호면 풀고, 글자면 그 모양일 때만. 못 읽으면 null 과 적힌 글자. */
export function cellDate(cell: GridCell | undefined, date1904: boolean): { iso: string | null; text: string } {
  if (!cell) return { iso: null, text: "" };
  if (cell.kind === "number") {
    const iso = excelSerialToDateOnly(cell.value, date1904 ? "1904" : "1900");
    return { iso, text: iso ?? String(cell.value) };
  }
  const t = cell.text.trim();
  return { iso: /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null, text: t };
}

/** 부품 쪽 규칙: `-` 는 빈 값 (parts 표 약속, DESIGN 4-3절) */
function dashToEmpty(s: string): string {
  return s === "-" ? "" : s;
}

/** 금액 칸: 숫자면 그 값, `-`·빈칸은 null. 글자는 null + 사정. */
function cellMoney(cell: GridCell | undefined, label: string, anomalies: string[]): number | null {
  if (!cell) return null;
  if (cell.kind === "number") {
    if (Number.isInteger(cell.value)) return cell.value;
    anomalies.push(`${label} 칸이 정수가 아님 「${cell.value}」`);
    return null;
  }
  const t = cell.text.trim();
  if (t === "" || t === "-") return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  anomalies.push(`${label} 칸에 글자 「${t}」`);
  return null;
}

/**
 * 「부품 재고 현황」. No. 가 숫자인 줄만 부품이다. 공급가의 통화는 칸 서식(¥·₩)에서 오므로 밖에서 받는다 —
 * sheet-grid 는 값만 읽고 서식은 모른다 (workbook-styles.ts).
 */
export function readPartsSheet(grid: SheetGrid, currencyOfRow: (row: number) => "JPY" | "KRW"): WorkbookPart[] {
  const col = headerColumns(grid, SHEET_PARTS, PARTS_HEADERS);
  const out: WorkbookPart[] = [];
  for (const row of grid.rowNumbers) {
    if (row === 1) continue;
    const cells = grid.cells(row);
    const c = (h: (typeof PARTS_HEADERS)[number]) => cells.get(col.get(h)!);
    const noCell = c("No.");
    if (!noCell || noCell.kind !== "number" || !Number.isInteger(noCell.value)) continue;
    const anomalies: string[] = [];
    const rawName2 = cellText(c("품명2"));
    const rawDrawingNo = cellText(c("도번"));
    out.push({
      row,
      no: noCell.value,
      name: cellText(c("품명")),
      name2: dashToEmpty(rawName2),
      kyosanPartNo: dashToEmpty(cellText(c("교산 품번"))),
      drawingNo: dashToEmpty(rawDrawingNo),
      rawName2,
      rawDrawingNo,
      quantity: cellInt(c("수량"), "수량", anomalies) ?? 0,
      supplyPrice: cellMoney(c("공급가"), "공급가", anomalies),
      supplyCurrency: currencyOfRow(row),
      quotePrice: cellMoney(c("견적가"), "견적가", anomalies),
      note: dashToEmpty(cellText(c("비고"))),
      itemName: cellText(c("항목")),
      categoryText: cellText(c("분류")),
      ownerText: cellText(c("소유")),
      anomaly: anomalies.join("; "),
    });
  }
  return out;
}

/** 「사용처 기입란」·「입고 기입란」. 품명이나 날짜가 있는 줄이 기록이다. 값은 전부 적힌 그대로. */
export function readLegacySheet(grid: SheetGrid, sheet: "USE" | "RECEIVE"): LegacyRow[] {
  const sheetName = sheet === "USE" ? SHEET_USE : SHEET_RECEIVE;
  const headers: readonly string[] = sheet === "USE" ? USE_HEADERS : RECEIVE_HEADERS;
  const col = headerColumns(grid, sheetName, headers);
  const out: LegacyRow[] = [];
  for (const row of grid.rowNumbers) {
    if (row === 1) continue;
    const cells = grid.cells(row);
    const c = (h: string) => (col.has(h) ? cells.get(col.get(h)!) : undefined);
    const name = cellText(c("품명"));
    const date = cellDate(c("날짜"), grid.date1904);
    if (!name && !date.text) continue;
    const anomalies: string[] = [];
    const noCell = c("No.");
    const sheetNo = noCell && noCell.kind === "number" && Number.isInteger(noCell.value) ? noCell.value : null;
    if (noCell && sheetNo === null) anomalies.push(`No. 칸에 글자 「${cellText(noCell)}」`);
    if (date.iso === null && date.text !== "") anomalies.push(`날짜 칸 「${date.text}」`);
    const qtyLabel = sheet === "USE" ? "사용 재고" : "입고";
    out.push({
      sheet,
      row,
      sheetNo,
      occurredOn: date.iso,
      dateText: date.text,
      intakeNumber: sheet === "USE" ? cellText(c("인수번호")) : "",
      name,
      name2: cellText(c("품명2")),
      drawingNo: cellText(c("도번")),
      kyosanPartNo: cellText(c("교산 품번")),
      stockBefore: cellInt(c("현 재고"), "현 재고", anomalies),
      quantity: cellInt(c(qtyLabel), qtyLabel, anomalies),
      stockAfter: cellInt(c("이후 재고"), "이후 재고", anomalies),
      purposeText: sheet === "USE" ? cellText(c("목적 및 출하담당")) : "",
      note: cellText(c("비고")),
      ownerText: cellText(c("소유")),
      chargeText: sheet === "USE" ? cellText(c("발주현황")) : "",
      usagePlace: sheet === "USE" ? cellText(c("사용처")) : "",
      anomaly: anomalies.join("; "),
    });
  }
  return out;
}
