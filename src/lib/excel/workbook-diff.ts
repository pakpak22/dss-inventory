import { excelSerialToDateOnly } from "@/lib/xlsx/excel-date";
import { columnNumberToLetters, readSheetGrid, type GridCell, type SheetGrid } from "@/lib/xlsx/sheet-grid";
import { ZipArchive } from "@/lib/xlsx/zip-reader";
import { SHEET_CHANGE_NAME, SHEET_RECEIVE_NAME, SHEET_USE_NAME } from "./full-workbook";
import { STOCK_SHEET_NAME } from "./stock-workbook";

/**
 * 치워 둔 파일(사람이 손댄 엑셀) vs 프로그램 기준본(마지막으로 쓴 한 벌)을 **값으로** 견준다 — 조각 8-A (DESIGN 6-5절, 결정 2026-10-08: 2번).
 *
 * 왜 바이트가 아니라 값인가: 사람이 엑셀로 열어 저장만 해도 바이트는 바뀐다(서식·계산 캐시). 우리가 보여 줄 것은 「무슨 **값**을 바꿨나」다.
 * 왜 프로그램 기준본(그림자 사본)과 견주나: 치워 둔 순간 원본 파일은 그 이름으로 옮겨져, 프로그램이 그때 갖고 있던 값은 그림자 사본에만 남는다
 *   (DB 로 다시 만들면 그 사이 들어온 변경까지 섞여 사람 손댐과 구별이 안 된다 — workbook-sync.ts 의 baseline 주석).
 *
 * 🔴 순수 함수: 파일·DB·시각을 모른다. 바이트 두 벌을 받아 구조화된 차이를 돌려준다.
 * 🔴 칸 이름(label)은 하드코딩하지 않고 **그 파일의 머리글(1행)** 에서 읽는다 — 엑셀에서 보는 것과 늘 같게.
 *
 * 줄 맞추는 열쇠:
 *  - 부품 재고 현황: **No.**(A열). 프로그램이 전체를 다시 쓰므로 No. 로 맞춰 바뀐 칸·새 No.·사라진 No. 를 가린다.
 *  - 사용처·입고·수량 변경: **줄 번호**(과거 줄 + 프로그램 줄이 같은 차례라, 끝에 붙은 줄 = 사람이 더한 줄). 줄을 중간에 끼우거나 지워 번호가 밀리면 그 아래가 통째로 바뀐 것으로 보인다(한계, 화면에 안내).
 */
export class WorkbookDiffError extends Error {}

export interface CellDiff {
  col: string;
  label: string;
  before: string;
  after: string;
}
/** 바뀐 줄: 열쇠 + 바뀐 칸만 */
export interface RowDiff {
  key: string;
  label: string;
  cells: CellDiff[];
}
/** 더해지거나 사라진 줄: 열쇠 + 칸 전체(화면용) */
export interface RowFull {
  key: string;
  label: string;
  values: string[];
}
export interface SheetDiff {
  sheet: string;
  /** 칸 이름(머리글에서 읽음). 길이 = 칸 수 */
  columns: string[];
  changed: RowDiff[];
  added: RowFull[];
  removed: RowFull[];
}
export interface WorkbookDiff {
  sheets: SheetDiff[];
  /** 바뀐·더한·사라진 줄 수의 합. 0 이면 값 차이 없음(열어서 저장만 한 경우) */
  totalChanges: number;
}

interface SheetSpec {
  name: string;
  columns: number;
  /** 줄 맞추는 열쇠: No.(A열 값) 또는 줄 번호 */
  keyBy: "no" | "row";
  /** 날짜로 풀어 보일 칸 번호(1부터). 없으면 0 */
  dateCol: number;
}

const SHEET_SPECS: readonly SheetSpec[] = [
  { name: STOCK_SHEET_NAME, columns: 12, keyBy: "no", dateCol: 0 },
  { name: SHEET_USE_NAME, columns: 15, keyBy: "row", dateCol: 2 },
  { name: SHEET_RECEIVE_NAME, columns: 11, keyBy: "row", dateCol: 2 },
  { name: SHEET_CHANGE_NAME, columns: 14, keyBy: "row", dateCol: 2 },
];

/**
 * 칸 값 → 견주고 보여 줄 글자. 날짜 칸이면 일련번호를 YYYY-MM-DD 로. 없는 칸은 빈 글자. 숫자는 그대로.
 * 🔴 줄바꿈은 LF 하나로 맞춘다 — 프로그램이 쓴 비고는 `
`(DB 글자 그대로)인데 엑셀이 저장하면 `
` 으로 바뀌어,
 *    손대지 않은 여러 줄 비고가 전부 「바뀜」으로 잡혔다(2026-10-12 실측: 수량 한 칸 고쳤는데 20줄). 값 비교이므로 줄바꿈 꼴은 차이가 아니다.
 *    `_x000D_` 는 엑셀이 CR 을 글자로 피한 꼴(sheet-grid 가 안 풀면 여기서 푼다).
 */
function cellText(cell: GridCell | undefined, isDate: boolean, date1904: boolean): string {
  if (cell === undefined) return "";
  if (cell.kind === "number") {
    if (isDate) {
      const iso = excelSerialToDateOnly(cell.value, date1904 ? "1904" : "1900");
      if (iso) return iso;
    }
    return String(cell.value);
  }
  return normalizeText(cell.text);
}

/** 비교용 글자 정리: `_x000D_`→CR, CRLF·CR→LF, 양 끝 공백 제거. 내보내는 함수(테스트용). */
export function normalizeText(text: string): string {
  return text.replace(/_x000D_/g, "\r").replace(/\r\n?/g, "\n").trim();
}

/** 한 줄의 칸 글자 배열(1..columns). 날짜 칸만 풀어서. */
function rowValues(grid: SheetGrid, rowNumber: number, spec: SheetSpec): string[] {
  const cells = grid.cells(rowNumber);
  const out: string[] = [];
  for (let c = 1; c <= spec.columns; c++) {
    out.push(cellText(cells.get(columnNumberToLetters(c)), c === spec.dateCol, grid.date1904));
  }
  return out;
}

/** 머리글(1행)에서 칸 이름. 빈 칸이면 열 문자로. */
function columnLabels(grid: SheetGrid, spec: SheetSpec): string[] {
  const head = grid.cells(1);
  const out: string[] = [];
  for (let c = 1; c <= spec.columns; c++) {
    const letter = columnNumberToLetters(c);
    out.push(cellText(head.get(letter), false, grid.date1904) || letter);
  }
  return out;
}

/** 값이 하나라도 있는 줄만(머리글 1행 제외). No. 로 맞출 때는 A열이 숫자인 줄만 부품. */
function dataRowNumbers(grid: SheetGrid, spec: SheetSpec): number[] {
  const out: number[] = [];
  for (const rn of grid.rowNumbers) {
    if (rn <= 1) continue;
    const vals = rowValues(grid, rn, spec);
    if (vals.every((v) => v === "")) continue;
    if (spec.keyBy === "no" && !/^\d+$/.test(vals[0])) continue;
    out.push(rn);
  }
  return out;
}

function sheetDiff(base: SheetGrid, edited: SheetGrid, spec: SheetSpec): SheetDiff {
  const columns = columnLabels(edited, spec);
  const changed: RowDiff[] = [];
  const added: RowFull[] = [];
  const removed: RowFull[] = [];

  const keyOf = (grid: SheetGrid, rn: number): string => (spec.keyBy === "no" ? rowValues(grid, rn, spec)[0] : String(rn));
  const label = (key: string): string => (spec.keyBy === "no" ? `No. ${key}` : `${key}행`);

  const baseRows = new Map<string, number>();
  for (const rn of dataRowNumbers(base, spec)) baseRows.set(keyOf(base, rn), rn);
  const editedRows = new Map<string, number>();
  for (const rn of dataRowNumbers(edited, spec)) editedRows.set(keyOf(edited, rn), rn);

  // 바뀐 줄 · 더한 줄 (치워 둔 파일 기준으로 훑는다)
  for (const [key, ern] of editedRows) {
    const brn = baseRows.get(key);
    const after = rowValues(edited, ern, spec);
    if (brn === undefined) {
      added.push({ key, label: label(key), values: after });
      continue;
    }
    const before = rowValues(base, brn, spec);
    const cells: CellDiff[] = [];
    for (let i = 0; i < spec.columns; i++) {
      if (before[i] !== after[i]) cells.push({ col: columnNumberToLetters(i + 1), label: columns[i], before: before[i], after: after[i] });
    }
    if (cells.length > 0) changed.push({ key, label: label(key), cells });
  }
  // 사라진 줄 (프로그램엔 있는데 치워 둔 파일엔 없는)
  for (const [key, brn] of baseRows) {
    if (!editedRows.has(key)) removed.push({ key, label: label(key), values: rowValues(base, brn, spec) });
  }

  const byKeyNum = (a: { key: string }, b: { key: string }) => (Number(a.key) || 0) - (Number(b.key) || 0) || a.key.localeCompare(b.key);
  changed.sort(byKeyNum);
  added.sort(byKeyNum);
  removed.sort(byKeyNum);
  return { sheet: spec.name, columns, changed, added, removed };
}

/** 두 통합문서(baseline = 프로그램 기준본, edited = 치워 둔 파일)를 네 시트에서 견준다. */
export function diffWorkbooks(baselineBytes: Buffer, editedBytes: Buffer): WorkbookDiff {
  const base = ZipArchive.fromBuffer(baselineBytes);
  const edited = ZipArchive.fromBuffer(editedBytes);
  const sheets: SheetDiff[] = [];
  for (const spec of SHEET_SPECS) {
    const b = readSheetGrid(base, spec.name);
    const e = readSheetGrid(edited, spec.name);
    if (!b || !e) throw new WorkbookDiffError(`「${spec.name}」 시트를 ${!b ? "기준본" : "치워 둔 파일"}에서 찾지 못했습니다.`);
    sheets.push(sheetDiff(b, e, spec));
  }
  const totalChanges = sheets.reduce((n, s) => n + s.changed.length + s.added.length + s.removed.length, 0);
  return { sheets, totalChanges };
}
