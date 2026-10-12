import { clearCell, setInlineString, setNumber } from "@/lib/xlsx/sheet-patch";
import { blankRow, parseSheetRows, renumberRow, syncDimension, writeSheetRows, type SheetRow } from "@/lib/xlsx/sheet-rows";
import { resolveSheetPart } from "@/lib/xlsx/workbook-parts";
import { ZipArchive } from "@/lib/xlsx/zip-reader";
import { dropRowHeight, fillPartsSheet, repackage, resolveTablePart, retargetTable, StockWorkbookError, type StockExportRow } from "./stock-workbook";

/**
 * 엑셀 한 벌 — **한 벌 틀에 네 시트를 채워 바이트로** (조각 7, DESIGN 6-2·6-4절). 순수 함수: 파일·DB·시각을 모른다.
 *
 *  - 부품 재고 현황: 부품 전체를 No. 순으로 **다시 쓴다** (stock-workbook.ts 와 같은 함수).
 *  - 사용처 기입란·입고 기입란: 틀에 과거 줄 2,314줄이 값째 들어 있다. **그 아래에** 이 프로그램의 기록을 붙인다. 과거 줄은 한 글자도 안 바뀐다.
 *  - 수량 변경 기록: 틀의 빈 본보기 줄 자리부터 쓴다.
 *
 * 본보기 줄 = 그 시트의 **마지막 줄**. 값이 있으면(과거 줄) 그 다음 줄부터, 비어 있으면(빈 본보기) 그 자리부터. 서식만 베끼고 높이는 뗀다.
 * 표 범위는 표·자동 필터 두 군데를 같이 고친다(DESIGN 6-3절). 날짜는 일련번호(본보기 줄의 날짜 서식이 먹는다), 글자는 inlineStr, 숫자는 숫자.
 */
export const SHEET_USE_NAME = "사용처 기입란";
export const SHEET_RECEIVE_NAME = "입고 기입란";
export const SHEET_CHANGE_NAME = "수량 변경 기록";

/** 칸 값: 글자 · 숫자 · 날짜(YYYY-MM-DD) · 빈칸 */
export type CellValue = string | number | { date: string } | null;

export interface FullWorkbookInput {
  parts: readonly StockExportRow[];
  /** 사용처 기입란 15칸: No.·날짜·인수번호·품명·품명2·도번·교산 품번·현 재고·사용 재고·이후 재고·목적 및 출하담당·비고·소유·발주현황·사용처 */
  useRows: readonly CellValue[][];
  /** 입고 기입란 11칸: No.·날짜·품명·품명2·도번·교산 품번·현 재고·입고·이후 재고·비고·소유 */
  receiveRows: readonly CellValue[][];
  /** 수량 변경 기록 14칸: No.·날짜·종류·품명·품명2·도번·교산 품번·현 재고·변동·이후 재고·담당·비고·소유·상대 */
  changeRows: readonly CellValue[][];
}

export const SHEET_COLUMNS = { use: 15, receive: 11, change: 14 } as const;

/** Excel 1900 체계 기준일. 1900년 윤년 버그 때문에 1899-12-31 이 아니라 12-30 (sheet-patch.ts 와 같다). */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** "2026-10-07" → 46302. 시각 없음. 모양이 아니면 null. */
export function isoDateToSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(t)) return null;
  return Math.round((t - EXCEL_EPOCH_UTC) / 86_400_000);
}

function columnLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function rowHasValues(row: SheetRow): boolean {
  return /<c\b[^>]*>(?:<v>|<is>|<f>)/.test(row.xml);
}

function fillCell(rowXml: string, ref: string, v: CellValue): string {
  if (v === null || v === "") return clearCell(rowXml, ref);
  if (typeof v === "number") return setNumber(rowXml, ref, v);
  if (typeof v === "string") return setInlineString(rowXml, ref, v);
  const serial = isoDateToSerial(v.date);
  return serial === null ? setInlineString(rowXml, ref, v.date) : setNumber(rowXml, ref, serial);
}

/**
 * 시트 하나에 줄을 붙인다. 돌려주는 것은 갈아 끼울 파트(시트·표).
 * 🔴 틀의 줄은 건드리지 않는다 — 과거 줄이 자료다. 빈 본보기 줄만 새 줄로 바뀐다.
 */
export function appendRowsToSheet(archive: ZipArchive, sheetName: string, rows: readonly CellValue[][], columns: number): Map<string, Buffer> {
  const sheetPart = resolveSheetPart(archive, sheetName);
  const sheetXml = archive.readText(sheetPart);
  const tablePart = resolveTablePart(archive, sheetPart);
  const existing = parseSheetRows(sheetXml);
  if (existing.length < 2) throw new StockWorkbookError(`「${sheetName}」 시트에 본보기 줄이 없습니다.`);
  const model = existing[existing.length - 1];
  const keep = rowHasValues(model) ? existing : existing.slice(0, -1);
  const start = keep.length === existing.length ? model.rowNumber + 1 : model.rowNumber;
  const blank = dropRowHeight(blankRow(model));
  const added: SheetRow[] = [];
  rows.forEach((values, i) => {
    if (values.length !== columns) throw new StockWorkbookError(`「${sheetName}」 ${i + 1}번째 줄의 칸 수가 ${values.length}개입니다(${columns}개여야 합니다).`);
    const n = start + i;
    let xml = renumberRow(blank, n).xml;
    values.forEach((v, c) => {
      xml = fillCell(xml, `${columnLetter(c)}${n}`, v);
    });
    added.push({ rowNumber: n, xml });
  });
  // 빈 본보기 줄 자리인데 붙일 줄이 없으면 본보기 줄을 그대로 둔다(표는 머리글만으로 서지 않는다)
  const all = added.length === 0 && keep.length < existing.length ? existing : [...keep, ...added];
  const lastRow = all[all.length - 1].rowNumber;
  return new Map<string, Buffer>([
    [sheetPart, Buffer.from(syncDimension(writeSheetRows(sheetXml, all), all), "utf8")],
    [tablePart, Buffer.from(retargetTable(archive.readText(tablePart), lastRow), "utf8")],
  ]);
}

export function buildFullWorkbook(templateBytes: Buffer, input: FullWorkbookInput): Buffer {
  const archive = ZipArchive.fromBuffer(templateBytes);
  const replacements = new Map<string, Buffer>();
  for (const [k, v] of fillPartsSheet(archive, input.parts)) replacements.set(k, v);
  for (const [k, v] of appendRowsToSheet(archive, SHEET_USE_NAME, input.useRows, SHEET_COLUMNS.use)) replacements.set(k, v);
  for (const [k, v] of appendRowsToSheet(archive, SHEET_RECEIVE_NAME, input.receiveRows, SHEET_COLUMNS.receive)) replacements.set(k, v);
  for (const [k, v] of appendRowsToSheet(archive, SHEET_CHANGE_NAME, input.changeRows, SHEET_COLUMNS.change)) replacements.set(k, v);
  return repackage(archive, replacements);
}
