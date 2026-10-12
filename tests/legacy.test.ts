import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPartIndex, csvCell, decisionKey, matchRecord, parseCsv, parseDecisionCsv, summarize, type GroupDecision } from "../src/lib/legacy/match";
import { readKrwStyleIndexes, readColumnStyleIndexes } from "../src/lib/legacy/workbook-styles";
import { cellDate, cellInt, cellText, headerColumns, readLegacySheet, readPartsSheet } from "../src/lib/legacy/workbook";
import { addYearly, mergeYearly, productModelOf, toYearlyRecord, yearOf, yearsIn } from "../src/lib/legacy/yearly";
import type { GridCell, SheetGrid } from "../src/lib/xlsx/sheet-grid";

/** 시험용 격자: 행 → { 열: 값 }. 숫자는 number 칸, 글자는 text 칸. */
function grid(rows: Record<number, Record<string, string | number>>, date1904 = false): SheetGrid {
  const map = new Map<number, Map<string, GridCell>>();
  for (const [r, cols] of Object.entries(rows)) {
    const m = new Map<string, GridCell>();
    for (const [c, v] of Object.entries(cols)) m.set(c, typeof v === "number" ? { kind: "number", value: v } : { kind: "text", text: v });
    map.set(Number(r), m);
  }
  return { date1904, rowNumbers: [...map.keys()].sort((a, b) => a - b), cells: (n) => map.get(n) ?? new Map() };
}

describe("과거 기록 — 엑셀 읽기 (workbook.ts)", () => {
  it("칸 값: 글자·정수·날짜", () => {
    assert.equal(cellText({ kind: "text", text: " AMP-DEH " }), "AMP-DEH");
    assert.equal(cellText({ kind: "number", value: 7 }), "7");
    assert.equal(cellText(undefined), "");
    const a: string[] = [];
    assert.equal(cellInt({ kind: "number", value: 3 }, "수량", a), 3);
    assert.equal(cellInt({ kind: "text", text: "1" }, "수량", a), 1);
    assert.equal(cellInt({ kind: "text", text: "一" }, "현 재고", a), null);
    assert.equal(cellInt(undefined, "수량", a), null);
    assert.deepEqual(a, ["현 재고 칸에 글자 「一」"]);
    // 2019-11-21 = 일련번호 43790 (1900 체계)
    assert.deepEqual(cellDate({ kind: "number", value: 43790 }, false), { iso: "2019-11-21", text: "2019-11-21" });
    assert.deepEqual(cellDate({ kind: "text", text: "2023-07-**" }, false), { iso: null, text: "2023-07-**" });
  });

  it("머리글 이름으로 칸을 찾고, 빠지면 던진다", () => {
    const g = grid({ 1: { A: "No.", B: "품명", C: "소유" } });
    assert.deepEqual([...headerColumns(g, "시험", ["No.", "소유"])], [
      ["No.", "A"],
      ["품명", "B"],
      ["소유", "C"],
    ]);
    assert.throws(() => headerColumns(g, "시험", ["No.", "도번"]), /도번/);
  });

  it("부품 시트: No. 가 숫자인 줄만, `-` 는 빈 값, 통화는 서식에서", () => {
    const g = grid({
      1: { A: "No.", B: "품명", C: "품명2", D: "교산 품번", E: "도번", F: "수량", G: "공급가", H: "견적가", I: "비고", J: "항목", K: "분류", L: "소유" },
      2: { A: 1, B: "COMB-C", C: "-", D: "-", E: "WR10245", F: 33, G: 3600, H: 350000, J: "PCB", K: "RFG", L: "KYOSAN" },
      3: { A: 2, B: "VVC", C: "CVHI", D: "-", E: "-", G: "-", H: "-", I: "비고 글", J: "바리콘", K: "MB", L: "DSS" },
      4: { B: "합계 줄 (No. 없음)" },
    });
    const parts = readPartsSheet(g, (row) => (row === 3 ? "KRW" : "JPY"));
    assert.equal(parts.length, 2);
    assert.deepEqual(
      parts.map((p) => [p.no, p.name2, p.kyosanPartNo, p.drawingNo, p.rawName2, p.quantity, p.supplyPrice, p.supplyCurrency, p.quotePrice, p.note]),
      [
        [1, "", "", "WR10245", "-", 33, 3600, "JPY", 350000, ""],
        [2, "CVHI", "", "", "CVHI", 0, null, "KRW", null, "비고 글"],
      ],
    );
  });

  it("사용처 기입란: 적힌 그대로, 숫자 아닌 칸은 null + 사정", () => {
    const g = grid({
      1: { A: "No.", B: "날짜", C: "인수번호", D: "품명", E: "품명2", F: "도번", G: "교산 품번", H: "현 재고", I: "사용 재고", J: "이후 재고", K: "목적 및 출하담당", L: "비고", M: "소유", N: "발주현황", O: "사용처" },
      2: { A: 83, B: 46204, C: "D260701", D: "AMP-DEH", E: "-", F: "WR10136", G: "-", H: 10, I: 1, J: 9, K: "수리/정영빈", M: "DSS", N: "유상", O: "D260701_CMK300M-IC2_WT8724_2203070" },
      3: { B: 46204, C: "一", D: "Fuse", E: "D52-8A:LM", F: "D52-8A:LM", G: "-", H: "一", I: "1", J: 3, K: "수리/ 정영빈", M: "DSS", N: "-" },
      4: {},
    });
    const rows = readLegacySheet(g, "USE");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sheetNo, 83);
    assert.equal(rows[0].occurredOn, "2026-07-01");
    assert.equal(rows[0].name2, "-");
    assert.equal(rows[0].chargeText, "유상");
    assert.equal(rows[0].usagePlace, "D260701_CMK300M-IC2_WT8724_2203070");
    assert.equal(rows[1].sheetNo, null);
    assert.equal(rows[1].intakeNumber, "一");
    assert.equal(rows[1].stockBefore, null);
    assert.equal(rows[1].quantity, 1);
    assert.equal(rows[1].anomaly, "현 재고 칸에 글자 「一」");
    assert.equal(rows[1].purposeText, "수리/ 정영빈");
  });

  it("입고 기입란: 글자 날짜는 날짜 null + 적힌 글자", () => {
    const g = grid({
      1: { A: "No.", B: "날짜", C: "품명", D: "품명2", E: "도번", F: "교산 품번", G: "현 재고", H: "입고", I: "이후 재고", J: "비고", K: "소유" },
      2: { A: 18, B: "2023-07-**", C: "Fuse", D: "660GH", E: "660GH", F: "-", G: 0, H: 150, I: 150, K: "보수부재" },
    });
    const [r] = readLegacySheet(g, "RECEIVE");
    assert.equal(r.occurredOn, null);
    assert.equal(r.dateText, "2023-07-**");
    assert.equal(r.quantity, 150);
    assert.equal(r.ownerText, "보수부재");
    assert.equal(r.intakeNumber, "");
    assert.match(r.anomaly, /날짜 칸/);
  });
});

describe("과거 기록 — 통화 서식 (workbook-styles.ts)", () => {
  it("₩ 서식인 cellXfs 번호와 열의 줄별 서식", () => {
    const styles = `<styleSheet><numFmts count="2"><numFmt numFmtId="176" formatCode="[$¥-411]#,##0"/><numFmt numFmtId="177" formatCode="[$₩-412]#,##0"/></numFmts>
      <cellXfs count="4"><xf numFmtId="0" fontId="0"/><xf numFmtId="176" fontId="0" applyNumberFormat="1"/><xf numFmtId="177" fontId="0"><alignment/></xf><xf numFmtId="3"/></cellXfs></styleSheet>`;
    assert.deepEqual([...readKrwStyleIndexes(styles)], [2]);
    const sheet = `<sheetData><row r="2"><c r="F2" s="1"><v>1</v></c><c r="G2" s="1"><v>3600</v></c></row><row r="3"><c r="G3" s="2"><v>5000</v></c><c r="H3" s="2"/></row><row r="4"><c r="G4" t="s"><v>0</v></c></row></sheetData>`;
    assert.deepEqual(
      [...readColumnStyleIndexes(sheet, "G")],
      [
        [2, 1],
        [3, 2],
        [4, 0],
      ],
    );
  });
});

describe("과거 기록 — 부품에 붙이기 (match.ts)", () => {
  const index = buildPartIndex([
    { no: 7, name: "Fuse", name2: "D52-8A:LM", drawingNo: "D52-8A:LM", ownerText: "DSS" },
    { no: 181, name: "Fuse", name2: "D52-8A:LM", drawingNo: "D52-8A:LM", ownerText: "DSS" },
    { no: 25, name: "RF transformer", name2: "-", drawingNo: "WR10245AA370G", ownerText: "보수부재" },
    { no: 146, name: "RF transformer", name2: "-", drawingNo: "WR10245AA370G", ownerText: "KYOSAN" },
    { no: 1, name: "COMB-C", name2: "-", drawingNo: "WR10245AA350A01", ownerText: "KYOSAN" },
  ]);
  const decisions = new Map<string, GroupDecision>([[decisionKey("USE", 358), { sheet: "USE", row: 358, no: 7, reason: "YAC사양 아님" }]]);
  const rec = (over: Partial<Parameters<typeof matchRecord>[0]>) => ({ sheet: "USE" as const, row: 1, name: "", name2: "-", drawingNo: "", ownerText: "DSS", ...over });

  it("한 No. 로 정해짐 → CONFIRMED (앞뒤 공백은 뗀다)", () => {
    assert.deepEqual(matchRecord(rec({ name: "COMB-C ", drawingNo: "WR10245AA350A01", ownerText: "KYOSAN" }), index, decisions), { status: "CONFIRMED", no: 1, note: "" });
  });
  it("여럿 → 판정표대로. 표에 없거나 후보 밖이면 UNMATCHED", () => {
    const fuse = { name: "Fuse", name2: "D52-8A:LM", drawingNo: "D52-8A:LM", ownerText: "DSS" };
    assert.deepEqual(matchRecord(rec({ ...fuse, row: 358 }), index, decisions), { status: "GROUP_DECIDED", no: 7, note: "YAC사양 아님" });
    assert.equal(matchRecord(rec({ ...fuse, row: 999 }), index, decisions).status, "UNMATCHED");
    const bad = new Map(decisions);
    bad.set(decisionKey("USE", 358), { sheet: "USE", row: 358, no: 1, reason: "낡은 표" });
    const r = matchRecord(rec({ ...fuse, row: 358 }), index, bad);
    assert.equal(r.status, "UNMATCHED");
    assert.match(r.status === "UNMATCHED" ? r.reason : "", /후보\(No\. 7·181\) 밖/);
  });
  it("소유만 다름 → OWNER_MISMATCH, 여럿이면 앞선 No.", () => {
    const r = matchRecord(rec({ name: "RF transformer", drawingNo: "WR10245AA370G", ownerText: "DSS" }), index, decisions);
    assert.equal(r.status, "OWNER_MISMATCH");
    assert.equal(r.status === "OWNER_MISMATCH" ? r.no : 0, 25);
    assert.match(r.status === "OWNER_MISMATCH" ? r.note : "", /25\(보수부재\)·146\(KYOSAN\) 중 앞선 No\.25/);
  });
  it("맞는 부품 없음 → UNMATCHED", () => {
    assert.deepEqual(matchRecord(rec({ name: "없는 부품" }), index, decisions), { status: "UNMATCHED", reason: "맞는 부품이 없음" });
  });
  it("판정표 CSV: BOM·쉼표 든 까닭·시트 이름", () => {
    const csv = '﻿시트,행,날짜,인수번호,품명,품명2,도번,소유,붙일 No.,까닭\r\n사용처 기입란,358,2022-11-29,一,Fuse,D52-8A:LM,D52-8A:LM,DSS,7,YAC사양 아님\r\n입고 기입란,259,2023-07-12,,Screw,-,-,DSS,265,"수량이 남은 쪽 (No.252는 0개, 수리소에서 관리 사용)"\r\n';
    assert.deepEqual(parseDecisionCsv(csv), [
      { sheet: "USE", row: 358, no: 7, reason: "YAC사양 아님" },
      { sheet: "RECEIVE", row: 259, no: 265, reason: "수량이 남은 쪽 (No.252는 0개, 수리소에서 관리 사용)" },
    ]);
    assert.throws(() => parseDecisionCsv("시트,행\n엉뚱한 시트,1"), /칸이 없습니다/);
  });
  it("CSV 풀기·쓰기", () => {
    assert.deepEqual(parseCsv('a,"b,c","d""e"\n1,,3'), [
      ["a", "b,c", 'd"e'],
      ["1", "", "3"],
    ]);
    assert.equal(csvCell("x,y"), '"x,y"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(7), "7");
  });
  it("요약", () => {
    assert.deepEqual(summarize([{ status: "CONFIRMED", no: 1, note: "" }, { status: "OWNER_MISMATCH", no: 2, note: "" }, { status: "UNMATCHED", reason: "" }]), {
      confirmed: 1,
      groupDecided: 0,
      ownerMismatch: 1,
      unmatched: 1,
    });
  });
});

describe("연도별 사용 수량 (yearly.ts)", () => {
  it("연도: 날짜 → 적힌 글자 → null", () => {
    assert.equal(yearOf("2024-03-01", ""), 2024);
    assert.equal(yearOf(null, "2023-07-**"), 2023);
    assert.equal(yearOf(null, "一"), null);
  });
  it("사용처 글자에서 기종", () => {
    assert.equal(productModelOf("D260701_CMK300M-IC2_WT8724_2203070"), "CMK300M-IC2");
    assert.equal(productModelOf("D260701"), "");
    assert.equal(productModelOf(""), "");
  });
  it("더하기·합치기·연도 목록·직렬화", () => {
    const a = new Map();
    addYearly(a, "p1", 2024, 2);
    addYearly(a, "p1", 2024, 3);
    addYearly(a, "p1", 2025, 1);
    const b = new Map();
    addYearly(b, "p1", 2025, 4);
    addYearly(b, "p2", 2023, 1);
    const m = mergeYearly(a, b);
    assert.deepEqual(yearsIn(m), [2025, 2024, 2023]);
    assert.deepEqual(toYearlyRecord(m), { p1: { "2024": 5, "2025": 5 }, p2: { "2023": 1 } });
  });
});
