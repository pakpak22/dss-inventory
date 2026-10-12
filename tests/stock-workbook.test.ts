import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildStockWorkbook, dropRowHeight, resolveTablePart, retargetTable, stockExportFileName, type StockExportRow } from "../src/lib/excel/stock-workbook";
import { readSheetGrid } from "../src/lib/xlsx/sheet-grid";
import { ZipArchive } from "../src/lib/xlsx/zip-reader";
import { writeZip } from "../src/lib/xlsx/zip-writer";

/** 내려받기 틀과 같은 뼈대의 아주 작은 통합문서 — 머리글 1행 + ¥ 줄 + ₩ 줄, 엑셀 표 하나. */
function tinyTemplate(): Buffer {
  const xml = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`, "utf8");
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
  const cells = (r: number, g: number) =>
    ["A", "B", "C", "D", "E", "F"].map((c, i) => `<c r="${c}${r}" s="${[2, 3, 3, 4, 3, 5][i]}"/>`).join("") + `<c r="G${r}" s="${g}"/><c r="H${r}" s="7"/><c r="I${r}" s="8"/><c r="J${r}" s="4"/><c r="K${r}" s="4"/><c r="L${r}" s="4"/>`;
  const header = ["No.", "품명", "품명2", "교산 품번", "도번", "수량", "공급가", "견적가", "비고", "항목", "분류", "소유"].map((t, i) => `<c r="${String.fromCharCode(65 + i)}1" s="1" t="inlineStr"><is><t>${t}</t></is></c>`).join("");
  const sheet = `<worksheet ${ns}><dimension ref="A1:L3"/><sheetData><row r="1" ht="24" customHeight="1">${header}</row><row r="2" ht="17.4" customHeight="1">${cells(2, 6)}</row><row r="3" ht="17.4" customHeight="1">${cells(3, 7)}</row></sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  const styles = `<styleSheet ${ns}><numFmts count="2"><numFmt numFmtId="176" formatCode="[$¥-411]#,##0"/><numFmt numFmtId="177" formatCode="[$₩-412]#,##0"/></numFmts><cellXfs count="9"><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="49"/><xf numFmtId="49"/><xf numFmtId="3"/><xf numFmtId="176"/><xf numFmtId="177"/><xf numFmtId="0"><alignment wrapText="1"/></xf></cellXfs></styleSheet>`;
  const table = `<table ${ns} id="1" name="재고현황표" displayName="재고현황표" ref="A1:L3"><autoFilter ref="A1:L3"/><tableColumns count="12">${Array.from({ length: 12 }, (_, i) => `<tableColumn id="${i + 1}" name="c${i + 1}"/>`).join("")}</tableColumns></table>`;
  return writeZip([
    { name: "[Content_Types].xml", data: xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`) },
    { name: "xl/workbook.xml", data: xml(`<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets><sheet name="부품 재고 현황" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: xml(`<Relationships ${rel}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: xml(sheet) },
    { name: "xl/worksheets/_rels/sheet1.xml.rels", data: xml(`<Relationships ${rel}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>`) },
    { name: "xl/tables/table1.xml", data: xml(table) },
    { name: "xl/styles.xml", data: xml(styles) },
  ]);
}

function row(no: number, over: Partial<StockExportRow> = {}): StockExportRow {
  return { no, name: `부품 ${no}`, name2: "", kyosanPartNo: "", drawingNo: `WR${no}`, quantity: no * 2, supplyPrice: 1000 * no, supplyCurrency: "JPY", quotePrice: null, note: "", itemName: "PCB", categoryLabel: "RFG", ownerLabel: "DSS", ...over };
}

describe("재고 현황 엑셀 내려받기 (stock-workbook.ts, 조각 6)", () => {
  it("표 범위 두 군데(ref·autoFilter)를 같이 고친다", () => {
    const out = retargetTable(`<table ref="A1:L3"><autoFilter ref="A1:L3"/></table>`, 321);
    assert.equal(out, `<table ref="A1:L321"><autoFilter ref="A1:L321"/></table>`);
    assert.throws(() => retargetTable(`<table ref="A1:L3"/>`, 5), /두 군데/);
  });
  it("줄 높이를 뗀다 (엑셀이 열 때 맞추게)", () => {
    assert.equal(dropRowHeight({ rowNumber: 2, xml: `<row r="2" spans="1:12" ht="17.4" customHeight="1" x14ac:dyDescent="0.4"><c r="A2"/></row>` }).xml, `<row r="2" spans="1:12" x14ac:dyDescent="0.4"><c r="A2"/></row>`);
  });
  it("작은 틀에 줄을 채운다: 번호·값·통화 줄·표 범위·치수", () => {
    const out = buildStockWorkbook(tinyTemplate(), [row(1, { note: "두 줄\n비고", name2: "" }), row(2, { supplyCurrency: "KRW", supplyPrice: 348400, quotePrice: 1000000, kyosanPartNo: "C0907" }), row(3, { supplyPrice: null })]);
    const a = ZipArchive.fromBuffer(out);
    const sheet = a.readText("xl/worksheets/sheet1.xml");
    const table = a.readText("xl/tables/table1.xml");
    assert.match(table, /ref="A1:L4"[\s\S]*autoFilter ref="A1:L4"/);
    assert.match(sheet, /<dimension ref="A1:L4"\/>/);
    assert.doesNotMatch(sheet, /<row r="[234]"[^>]*customHeight/);
    // ₩ 줄은 ₩ 본보기(G 서식 7)를, 나머지는 ¥ 본보기(6)를 베낀다
    assert.match(sheet, /<c r="G2" s="6"><v>1000<\/v><\/c>/);
    assert.match(sheet, /<c r="G3" s="7"><v>348400<\/v><\/c>/);
    assert.match(sheet, /<c r="G4" s="6" t="inlineStr"><is><t xml:space="preserve">-<\/t><\/is><\/c>/);
    const grid = readSheetGrid(a, "부품 재고 현황")!;
    assert.deepEqual(grid.rowNumbers, [1, 2, 3, 4]);
    const r2 = grid.cells(2);
    assert.deepEqual([r2.get("A"), r2.get("B"), r2.get("C"), r2.get("F"), r2.get("I")], [
      { kind: "number", value: 1 },
      { kind: "text", text: "부품 1" },
      { kind: "text", text: "-" },
      { kind: "number", value: 2 },
      { kind: "text", text: "두 줄\n비고" },
    ]);
    assert.equal(grid.cells(3).get("D")?.kind === "text" ? (grid.cells(3).get("D") as { text: string }).text : "", "C0907");
    assert.equal(grid.cells(4).get("I"), undefined); // 빈 비고는 빈칸
  });
  it("부품이 없으면 빈 줄 하나를 남긴다 (엑셀 표는 머리글만으로 서지 않는다)", () => {
    const a = ZipArchive.fromBuffer(buildStockWorkbook(tinyTemplate(), []));
    assert.match(a.readText("xl/tables/table1.xml"), /ref="A1:L2"/);
  });
  it("표 파트는 관계 파일에서 찾는다", () => {
    assert.equal(resolveTablePart(ZipArchive.fromBuffer(tinyTemplate()), "xl/worksheets/sheet1.xml"), "xl/tables/table1.xml");
  });
  it("파일 이름", () => {
    assert.deepEqual(stockExportFileName("2026-10-07"), { utf8: "재고 현황_2026-10-07.xlsx", ascii: "stock_2026-10-07.xlsx" });
  });

  // 실제 틀이 있으면(개발 PC) 그것으로도 한 번. 없으면 건너뛴다 — CI·컨테이너에는 틀이 없다.
  const real = process.env.STOCK_DOWNLOAD_TEMPLATE_PATH;
  it("실제 내려받기 틀로 319줄 채우기", { skip: !real || !existsSync(real) ? "STOCK_DOWNLOAD_TEMPLATE_PATH 가 없거나 파일이 없음" : false }, () => {
    const rows = Array.from({ length: 319 }, (_, i) => row(i + 1, { supplyCurrency: i % 100 === 0 ? "KRW" : "JPY", note: i % 7 === 0 ? "여러 줄\n비고\n셋째 줄" : "" }));
    const out = buildStockWorkbook(readFileSync(real!), rows);
    const a = ZipArchive.fromBuffer(out);
    assert.match(a.readText("xl/tables/table1.xml"), /ref="A1:L320"[\s\S]*autoFilter ref="A1:L320"/);
    const grid = readSheetGrid(a, "부품 재고 현황")!;
    assert.equal(grid.rowNumbers.length, 320);
    assert.deepEqual(grid.cells(320).get("A"), { kind: "number", value: 319 });
  });
});
