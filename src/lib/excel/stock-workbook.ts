import { readKrwStyleIndexes } from "@/lib/legacy/workbook-styles";
import { clearCell, setInlineString, setNumber } from "@/lib/xlsx/sheet-patch";
import { blankRow, parseSheetRows, renumberRow, syncDimension, writeSheetRows, type SheetRow } from "@/lib/xlsx/sheet-rows";
import { resolveSheetPart, STYLES_PART } from "@/lib/xlsx/workbook-parts";
import { ZipArchive } from "@/lib/xlsx/zip-reader";
import { writeZip } from "@/lib/xlsx/zip-writer";

/**
 * 재고 현황 엑셀 내려받기 — **내려받기 틀**에 줄을 채워 바이트로 (조각 6, DESIGN 6-1·6-3절). 순수 함수: 파일·DB·요청을 모른다.
 *
 * 틀(`재고 현황 내려받기 틀.xlsx`)은 사람이 현황판에서 값을 비워 만든 것이다: 머리글 1행 + 본보기 줄 둘(공급가가 ¥ 서식인 줄, ₩ 서식인 줄).
 * 우리는 본보기 줄을 부품 수만큼 **베껴서 번호를 매기고 값만 갈아 끼운다.** 서식(열 너비·글꼴·¥/₩·줄무늬 표)은 틀 것이 그대로다.
 * 🔴 틀 파일 자체는 절대 고치지 않는다 — 읽기만 한다 (README 「미리 알아야 할 것 1」).
 *
 * 받은 코드로 바로 안 되던 둘(DESIGN 6-3절)은 여기서 푼다:
 *  1. **엑셀 표 범위.** 줄 수가 바뀌면 `xl/tables/tableN.xml` 의 `ref` 와 `autoFilter ref` **두 군데**를 같이 고친다. 둘이 어긋나면 엑셀이
 *     파일을 고치라고 묻는다(10-3절 1번). 표 파트는 시트의 관계 파일에서 찾는다 — `table1.xml` 로 못 박지 않는다.
 *  2. **줄 높이.** 본보기 줄의 `ht`·`customHeight` 를 **뗀다.** 그러면 비고 칸에 wrapText 가 걸려 있어 엑셀이 열 때 높이를 스스로 맞춘다(10-3절 2번
 *     「customHeight 를 빼는 쪽 먼저」). 어림으로 넣는 길은 실제 파일로 확인해 안 되면 그때 간다.
 *
 * 값 규칙은 현황판과 같다: 품명2·교산 품번·도번은 없으면 `-`, 비고는 없으면 빈칸, 금액은 없으면 `-`(글자). 수량·No.·금액은 숫자.
 * 🔴 숫자처럼 보이는 글자(도번 등)를 숫자로 바꾸지 않는다 — 본보기 머리말과 같은 이유.
 */
export interface StockExportRow {
  no: number;
  name: string;
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
  quantity: number;
  supplyPrice: number | null;
  supplyCurrency: "JPY" | "KRW";
  quotePrice: number | null;
  note: string;
  itemName: string;
  categoryLabel: string;
  ownerLabel: string;
}

export const STOCK_SHEET_NAME = "부품 재고 현황";
export const STOCK_EXPORT_MAX_ROWS = 5000;

export class StockWorkbookError extends Error {}

/** 본보기 줄에서 높이를 뗀다 — 엑셀이 열 때 스스로 맞추게 (머리말 2). */
export function dropRowHeight(row: SheetRow): SheetRow {
  const xml = row.xml.replace(/^(<row\b[^>]*?)\s+ht="[^"]*"/, "$1").replace(/^(<row\b[^>]*?)\s+customHeight="[^"]*"/, "$1");
  return { ...row, xml };
}

/** 표 파트의 `ref="A1:L3"` 와 `<autoFilter ref="A1:L3"` 를 새 마지막 줄로. 두 군데가 같이 바뀌어야 한다 (머리말 1). */
export function retargetTable(tableXml: string, lastRow: number): string {
  const re = /ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g;
  let n = 0;
  const out = tableXml.replace(re, (_m, c1: string, r1: string, c2: string) => {
    n++;
    return `ref="${c1}${r1}:${c2}${lastRow}"`;
  });
  if (n < 2) throw new StockWorkbookError(`표 파트에서 범위(ref)를 ${n}곳만 찾았습니다. 표와 자동 필터 두 군데가 있어야 합니다.`);
  return out;
}

/** 시트의 관계 파일에서 표 파트 경로. `xl/worksheets/sheet1.xml` → `xl/worksheets/_rels/sheet1.xml.rels` → `../tables/table1.xml` */
export function resolveTablePart(archive: ZipArchive, sheetPart: string): string {
  const slash = sheetPart.lastIndexOf("/");
  const dir = sheetPart.slice(0, slash + 1);
  const relsPart = `${dir}_rels/${sheetPart.slice(slash + 1)}.rels`;
  const rels = archive.readTextOrNull(relsPart);
  if (rels === null) throw new StockWorkbookError("틀의 시트에 관계 파일이 없습니다 — 엑셀 표가 없는 틀입니다.");
  const m = /<Relationship\b[^>]*Type="[^"]*\/relationships\/table"[^>]*Target="([^"]+)"/.exec(rels) ?? /<Relationship\b[^>]*Target="([^"]+)"[^>]*Type="[^"]*\/relationships\/table"/.exec(rels);
  if (!m) throw new StockWorkbookError("틀의 시트에 표(table) 관계가 없습니다.");
  const target = m[1];
  // `../tables/table1.xml` 를 시트 폴더 기준으로 푼다
  const parts = (dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

function cellStyle(rowXml: string, column: string): number {
  const m = new RegExp(`<c\\s+r="${column}\\d+"[^>]*?\\bs="(\\d+)"`).exec(rowXml);
  return m ? Number(m[1]) : 0;
}

function fill(rowXml: string, ref: string, value: string | number | null, dashWhenEmpty: boolean): string {
  if (typeof value === "number") return setNumber(rowXml, ref, value);
  if (value === null || value === "") return dashWhenEmpty ? setInlineString(rowXml, ref, "-") : clearCell(rowXml, ref);
  return setInlineString(rowXml, ref, value);
}

export function buildStockWorkbook(templateBytes: Buffer, rows: readonly StockExportRow[]): Buffer {
  const archive = ZipArchive.fromBuffer(templateBytes);
  return repackage(archive, fillPartsSheet(archive, rows));
}

/** 바뀐 파트만 갈아 끼워 다시 묶는다. 나머지 파트는 바이트 그대로. 한 벌(full-workbook.ts)도 같은 것을 쓴다. */
export function repackage(archive: ZipArchive, replacements: ReadonlyMap<string, Buffer>): Buffer {
  const entries: { name: string; data: Buffer }[] = [];
  for (const entry of archive.listEntries()) {
    const replaced = replacements.get(entry.name);
    entries.push({ name: entry.name, data: replaced ?? archive.readEntry(entry.name) ?? Buffer.alloc(0) });
  }
  return writeZip(entries);
}

/**
 * 「부품 재고 현황」 시트를 부품 전체로 **다시 쓴다** (DESIGN 6-2절). 내려받기 틀과 한 벌 틀 둘 다 이 시트 모양이 같다.
 * 돌려주는 것은 갈아 끼울 파트(시트 XML·표 XML).
 */
export function fillPartsSheet(archive: ZipArchive, rows: readonly StockExportRow[]): Map<string, Buffer> {
  if (rows.length > STOCK_EXPORT_MAX_ROWS) throw new StockWorkbookError(`부품이 ${rows.length}개라 너무 많습니다. ${STOCK_EXPORT_MAX_ROWS}개까지 내려받을 수 있습니다.`);
  const sheetPart = resolveSheetPart(archive, STOCK_SHEET_NAME);
  const sheetXml = archive.readText(sheetPart);
  const tablePart = resolveTablePart(archive, sheetPart);
  const tableXml = archive.readText(tablePart);

  const templateRows = parseSheetRows(sheetXml);
  const header = templateRows.find((r) => r.rowNumber === 1);
  if (!header) throw new StockWorkbookError("틀의 1행(머리글)이 없습니다.");
  const models = templateRows.filter((r) => r.rowNumber > 1);
  if (models.length === 0) throw new StockWorkbookError("틀에 본보기 줄이 없습니다. 머리글 아래에 ¥ 줄과 ₩ 줄 하나씩이 있어야 합니다.");
  const krwStyles = readKrwStyleIndexes(archive.readTextOrNull(STYLES_PART) ?? "");
  const krwModel = models.find((r) => krwStyles.has(cellStyle(r.xml, "G")));
  const jpyModel = models.find((r) => !krwStyles.has(cellStyle(r.xml, "G")));
  if (!krwModel || !jpyModel) throw new StockWorkbookError("틀의 본보기 줄에서 ¥ 줄과 ₩ 줄을 가리지 못했습니다(공급가 칸 서식을 봅니다).");

  const dataRows: SheetRow[] = [];
  if (rows.length === 0) {
    // 엑셀 표는 머리글만으로는 서지 않는다 — 빈 줄 하나를 남긴다.
    dataRows.push(dropRowHeight(renumberRow(blankRow(jpyModel), 2)));
  }
  rows.forEach((p, i) => {
    const model = p.supplyCurrency === "KRW" ? krwModel : jpyModel;
    const n = i + 2;
    let xml = dropRowHeight(renumberRow(blankRow(model), n)).xml;
    xml = fill(xml, `A${n}`, p.no, false);
    xml = fill(xml, `B${n}`, p.name, false);
    xml = fill(xml, `C${n}`, p.name2, true);
    xml = fill(xml, `D${n}`, p.kyosanPartNo, true);
    xml = fill(xml, `E${n}`, p.drawingNo, true);
    xml = fill(xml, `F${n}`, p.quantity, false);
    xml = fill(xml, `G${n}`, p.supplyPrice, true);
    xml = fill(xml, `H${n}`, p.quotePrice, true);
    xml = fill(xml, `I${n}`, p.note, false);
    xml = fill(xml, `J${n}`, p.itemName, false);
    xml = fill(xml, `K${n}`, p.categoryLabel, false);
    xml = fill(xml, `L${n}`, p.ownerLabel, false);
    dataRows.push({ rowNumber: n, xml });
  });

  const allRows = [header, ...dataRows];
  const lastRow = allRows[allRows.length - 1].rowNumber;
  const nextSheetXml = syncDimension(writeSheetRows(sheetXml, allRows), allRows);
  const nextTableXml = retargetTable(tableXml, lastRow);

  return new Map<string, Buffer>([
    [sheetPart, Buffer.from(nextSheetXml, "utf8")],
    [tablePart, Buffer.from(nextTableXml, "utf8")],
  ]);
}

/** 내려받는 파일 이름. 한글은 Content-Disposition 의 filename* 로, 영문 대체 이름을 같이 준다. */
export function stockExportFileName(dateIso: string): { utf8: string; ascii: string } {
  return { utf8: `재고 현황_${dateIso}.xlsx`, ascii: `stock_${dateIso}.xlsx` };
}
