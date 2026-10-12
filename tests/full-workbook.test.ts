import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { appendRowsToSheet, buildFullWorkbook, isoDateToSerial, type CellValue } from "../src/lib/excel/full-workbook";
import { changeCounterpartText, purposeActorText, toChangeRow, toUseRow, type LedgerLine } from "../src/lib/excel/rows";
import { readSheetGrid } from "../src/lib/xlsx/sheet-grid";
import { ZipArchive } from "../src/lib/xlsx/zip-reader";
import { writeZip } from "../src/lib/xlsx/zip-writer";

/** 시트 하나짜리 작은 통합문서. 머리글 + 주어진 줄들(값 있는 줄은 과거 줄, 빈 줄은 본보기). 표 하나. */
function tiny(sheetName: string, rowsXml: string[], lastCol: string): Buffer {
  const xml = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`, "utf8");
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
  const last = rowsXml.length + 1;
  const sheet = `<worksheet ${ns}><dimension ref="A1:${lastCol}${last}"/><sheetData><row r="1" ht="24" customHeight="1"><c r="A1" t="inlineStr"><is><t>No.</t></is></c></row>${rowsXml.join("")}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  const table = `<table ${ns} id="1" name="t" displayName="t" ref="A1:${lastCol}${last}"><autoFilter ref="A1:${lastCol}${last}"/><tableColumns count="1"><tableColumn id="1" name="No."/></tableColumns></table>`;
  return writeZip([
    { name: "[Content_Types].xml", data: xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`) },
    { name: "xl/workbook.xml", data: xml(`<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: xml(`<Relationships ${rel}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: xml(sheet) },
    { name: "xl/worksheets/_rels/sheet1.xml.rels", data: xml(`<Relationships ${rel}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>`) },
    { name: "xl/tables/table1.xml", data: xml(table) },
    { name: "xl/styles.xml", data: xml(`<styleSheet ${ns}><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`) },
  ]);
}
const cells = (r: number, withValue: boolean) => `<row r="${r}" ht="17.4" customHeight="1"><c r="A${r}" s="1"${withValue ? `><v>${r}</v></c>` : "/>"}<c r="B${r}" s="2"${withValue ? `><v>46000</v></c>` : "/>"}<c r="C${r}" s="1"${withValue ? ` t="inlineStr"><is><t>옛 ${r}</t></is></c>` : "/>"}</row>`;

describe("엑셀 한 벌 (full-workbook.ts, 조각 7)", () => {
  it("날짜 → 일련번호", () => {
    assert.equal(isoDateToSerial("2026-10-07"), 46302);
    assert.equal(isoDateToSerial("1900-03-01"), 61);
    assert.equal(isoDateToSerial("2023-07-**"), null);
  });
  it("과거 줄이 있는 시트: 그 아래에 붙이고 과거 줄은 그대로", () => {
    const a = ZipArchive.fromBuffer(tiny("S", [cells(2, true), cells(3, true)], "C"));
    const rows: CellValue[][] = [
      [10, { date: "2026-10-07" }, "새 줄"],
      [null, { date: "2026-10-08" }, "둘째"],
    ];
    const rep = appendRowsToSheet(a, "S", rows, 3);
    const sheet = rep.get("xl/worksheets/sheet1.xml")!.toString("utf8");
    assert.match(sheet, /<row r="2" ht="17.4" customHeight="1"><c r="A2" s="1"><v>2<\/v><\/c>/); // 과거 줄 그대로
    assert.match(sheet, /<row r="4"><c r="A4" s="1"><v>10<\/v><\/c><c r="B4" s="2"><v>46302<\/v><\/c><c r="C4" s="1" t="inlineStr">/);
    assert.match(sheet, /<row r="5"><c r="A5" s="1"\/><c r="B5" s="2"><v>46303<\/v><\/c>/);
    assert.match(sheet, /<dimension ref="A1:C5"\/>/);
    assert.match(rep.get("xl/tables/table1.xml")!.toString("utf8"), /ref="A1:C5"[\s\S]*autoFilter ref="A1:C5"/);
  });
  it("빈 본보기 줄만 있는 시트: 그 자리부터. 붙일 줄이 없으면 본보기 줄을 남긴다", () => {
    const a = ZipArchive.fromBuffer(tiny("S", [cells(2, false)], "C"));
    const sheet = appendRowsToSheet(a, "S", [[1, { date: "2026-01-01" }, "x"]], 3).get("xl/worksheets/sheet1.xml")!.toString("utf8");
    assert.match(sheet, /<row r="2"><c r="A2" s="1"><v>1<\/v><\/c>/);
    assert.doesNotMatch(sheet, /<row r="3"/);
    const empty = appendRowsToSheet(a, "S", [], 3);
    assert.match(empty.get("xl/tables/table1.xml")!.toString("utf8"), /ref="A1:C2"/);
    assert.throws(() => appendRowsToSheet(a, "S", [[1, 2]], 3), /칸 수/);
  });

  const line: LedgerLine = {
    entryId: "e1",
    type: "USE",
    occurredOn: "2026-10-07",
    sheetNo: 5,
    lineIndex: 0,
    intakeNumber: "D260701",
    noRepairCase: false,
    usagePlace: "D260701_CMK300M-IC2_WT8724_2203070",
    purpose: "REPAIR",
    purposeText: "",
    counterparty: "",
    reason: "",
    entryNote: "",
    createdByName: "정영빈",
    partName: "AMP-DEH",
    partName2: "",
    partDrawingNo: "WR10136",
    partKyosanPartNo: "",
    ownerLabel: "DSS",
    delta: -2,
    quantityBefore: 10,
    quantityAfter: 8,
    chargeType: "PAID",
    lineNote: "",
    relatedText: "",
    transferCounterpart: "",
  };
  it("사용처 기입란 줄: 엑셀 관용구(없으면 -, 둘째 줄은 No. 비움, 목적/담당)", () => {
    assert.deepEqual(toUseRow(line), [5, { date: "2026-10-07" }, "D260701", "AMP-DEH", "-", "WR10136", "-", 10, 2, 8, "수리/정영빈", "", "DSS", "유상", "D260701_CMK300M-IC2_WT8724_2203070"]);
    const second = toUseRow({ ...line, lineIndex: 1, noRepairCase: true, reason: "검증용", chargeType: null, lineNote: "줄 비고", entryNote: "건 비고" });
    assert.equal(second[0], null);
    assert.equal(second[2], "-");
    assert.equal(second[11], "줄 비고 / 건 비고");
    assert.equal(second[13], "-");
    assert.equal(second[14], "검증용");
    assert.equal(purposeActorText("OTHER", "선행 출하", "홍길동"), "선행 출하/홍길동");
    assert.equal(purposeActorText(null, "", "홍길동"), "홍길동");
  });
  it("수량 변경 기록 줄: 종류·변동 부호·상대", () => {
    const loan = toChangeRow({ ...line, type: "LOAN", counterparty: "상해수리소", delta: -1, quantityAfter: 9 });
    assert.deepEqual(loan.slice(0, 3), [5, { date: "2026-10-07" }, "대여"]);
    assert.equal(loan[8], -1);
    assert.equal(loan[13], "상해수리소");
    assert.equal(changeCounterpartText({ ...line, type: "RETURN", relatedText: "사용 US-2026-3 No.1 -2" }), "사용 US-2026-3 No.1 -2");
    assert.equal(changeCounterpartText({ ...line, type: "TRANSFER", transferCounterpart: "No.2 KYOSAN" }), "No.2 KYOSAN");
    assert.equal(changeCounterpartText({ ...line, type: "ADJUST" }), "-");
  });

  const real = process.env.STOCK_WORKBOOK_TEMPLATE_PATH;
  it("실제 한 벌 틀: 네 시트를 채우고 과거 줄 수가 그대로", { skip: !real || !existsSync(real) ? "STOCK_WORKBOOK_TEMPLATE_PATH 가 없거나 파일이 없음" : false }, () => {
    const tpl = readFileSync(real!);
    const before = ZipArchive.fromBuffer(tpl);
    const useBefore = readSheetGrid(before, "사용처 기입란")!.rowNumbers.length;
    const out = buildFullWorkbook(tpl, {
      parts: [{ no: 1, name: "부품", name2: "", kyosanPartNo: "", drawingNo: "", quantity: 3, supplyPrice: 100, supplyCurrency: "JPY", quotePrice: null, note: "", itemName: "PCB", categoryLabel: "RFG", ownerLabel: "DSS" }],
      useRows: [toUseRow(line)],
      receiveRows: [],
      changeRows: [toChangeRow({ ...line, type: "ADJUST", reason: "실사", delta: 1, quantityAfter: 11 })],
    });
    const a = ZipArchive.fromBuffer(out);
    const use = readSheetGrid(a, "사용처 기입란")!;
    assert.equal(use.rowNumbers.length, useBefore + 1);
    assert.deepEqual(use.cells(useBefore + 1).get("C"), { kind: "text", text: "D260701" });
    assert.deepEqual(use.cells(2).get("D"), readSheetGrid(before, "사용처 기입란")!.cells(2).get("D")); // 과거 줄 그대로
    assert.match(a.readText("xl/tables/table2.xml"), new RegExp(`ref="A1:O${useBefore + 1}"[\\s\\S]*autoFilter ref="A1:O${useBefore + 1}"`));
    const change = readSheetGrid(a, "수량 변경 기록")!;
    assert.deepEqual(change.rowNumbers, [1, 2]);
    assert.deepEqual(change.cells(2).get("C"), { kind: "text", text: "조정" });
    assert.match(a.readText("xl/tables/table3.xml"), /ref="A1:K663"/); // 입고는 붙인 줄 없음 → 그대로
    assert.match(a.readText("xl/tables/table1.xml"), /ref="A1:L2"/);
  });
});
