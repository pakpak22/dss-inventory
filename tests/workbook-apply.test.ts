import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChargeText, parseDateText, parseEntryTypeLabel, parseIntText, parsePurposeActor, planApply, summarizePlan, type ApplyPart } from "../src/lib/excel/workbook-apply";
import type { SheetDiff, WorkbookDiff } from "../src/lib/excel/workbook-diff";

/**
 * 조각 8-B 계획 함수 검사. 8-A 의 차이(WorkbookDiff)를 손으로 만들어 넣는다 — 파일·DB 없이 돈다.
 * 머리글은 실제 현황판의 것(legacy/workbook.ts) 그대로.
 */
const H_PARTS = ["No.", "품명", "품명2", "교산 품번", "도번", "수량", "공급가", "견적가", "비고", "항목", "분류", "소유"];
const H_USE = ["No.", "날짜", "인수번호", "품명", "품명2", "도번", "교산 품번", "현 재고", "사용 재고", "이후 재고", "목적 및 출하담당", "비고", "소유", "발주현황", "사용처"];
const H_RECEIVE = ["No.", "날짜", "품명", "품명2", "도번", "교산 품번", "현 재고", "입고", "이후 재고", "비고", "소유"];
const H_CHANGE = ["No.", "날짜", "종류", "품명", "품명2", "도번", "교산 품번", "현 재고", "변동", "이후 재고", "담당", "비고", "소유", "상대"];

const PARTS: ApplyPart[] = [
  { id: "p1", no: 1, name: "볼트", name2: "", drawingNo: "", ownerLabel: "DSS", quantity: 18 },
  { id: "p2", no: 2, name: "너트", name2: "M6", drawingNo: "DR-2", ownerLabel: "KYOSAN", quantity: 5 },
  { id: "p3", no: 3, name: "와셔", name2: "", drawingNo: "", ownerLabel: "DSS", quantity: 0 },
  { id: "p4", no: 4, name: "와셔", name2: "", drawingNo: "", ownerLabel: "KYOSAN", quantity: 7 },
  // 같은 열쇠가 둘(묶음)
  { id: "p5", no: 5, name: "핀", name2: "", drawingNo: "", ownerLabel: "DSS", quantity: 1 },
  { id: "p6", no: 6, name: "핀", name2: "", drawingNo: "", ownerLabel: "DSS", quantity: 2 },
];

function sheet(name: string, columns: string[], o: Partial<SheetDiff> = {}): SheetDiff {
  return { sheet: name, columns, changed: [], added: [], removed: [], ...o };
}
function diff(sheets: SheetDiff[]): WorkbookDiff {
  const n = sheets.reduce((s, x) => s + x.changed.length + x.added.length + x.removed.length, 0);
  return { sheets, totalChanges: n };
}
const added = (key: string, values: string[]) => ({ key, label: `${key}행`, values });

describe("조각 8-B 계획 (workbook-apply.ts)", () => {
  it("사용처 기입란의 더한 줄 → 사용 기록 (부품은 네 칸 글자로, `-` 는 빈 값)", () => {
    const d = diff([sheet("사용처 기입란", H_USE, { added: [added("1654", ["", "2026-10-12", "D261001", "볼트", "-", "-", "-", "18", "5", "13", "수리/정영빈", "손으로 적음", "DSS", "유상", "현장A"])] })]);
    const plan = planApply(d, PARTS, "현황판_사람수정_20261012-1056.xlsx");
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.skipped.length, 0);
    const e = plan.entries[0];
    assert.equal(e.partNo, 1);
    assert.equal(e.delta, -5);
    assert.equal(e.input.type, "USE");
    if (e.input.type !== "USE") return;
    assert.equal(e.input.intakeNumber, "D261001");
    assert.equal(e.input.noRepairCase, false);
    assert.equal(e.input.purpose, "REPAIR");
    assert.equal(e.input.occurredOn, "2026-10-12");
    assert.deepEqual(e.input.lines, [{ partId: "p1", quantity: 5, chargeType: "PAID", note: "손으로 적음", actualQuantity: null }]);
    assert.match(e.input.note, /엑셀 기준 적용 · 현황판_사람수정_20261012-1056.xlsx · 사용처 기입란 1654행 · 적은 이 정영빈/);
    assert.equal(plan.totalEntries, 1);
  });

  it("인수번호가 `-` 면 수리 건 없음 + 사유는 사용처 글자", () => {
    const d = diff([sheet("사용처 기입란", H_USE, { added: [added("3", ["", "2026-10-12", "-", "볼트", "-", "-", "-", "18", "1", "17", "기타/홍길동", "", "DSS", "무상", "시험용"])] })]);
    const e = planApply(d, PARTS, "f.xlsx").entries[0];
    assert.equal(e.input.type, "USE");
    if (e.input.type !== "USE") return;
    assert.equal(e.input.noRepairCase, true);
    assert.equal(e.input.reason, "시험용");
    assert.equal(e.input.purpose, "OTHER");
    assert.equal(e.input.lines[0].chargeType, "FREE");
  });

  it("입고 기입란의 더한 줄 → 입고 기록", () => {
    const d = diff([sheet("입고 기입란", H_RECEIVE, { added: [added("664", ["", "2026-10-11", "너트", "M6", "DR-2", "-", "5", "10", "15", "", "KYOSAN"])] })]);
    const plan = planApply(d, PARTS, "f.xlsx");
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.entries[0].partNo, 2);
    assert.equal(plan.entries[0].delta, 10);
    assert.equal(plan.entries[0].input.type, "RECEIVE");
  });

  it("부품 시트 수량 바뀜은 더한 줄을 반영한 뒤 차이만 조정한다 (두 번 빼지 않게)", () => {
    const use = sheet("사용처 기입란", H_USE, { added: [added("3", ["", "2026-10-12", "-", "볼트", "-", "-", "-", "18", "5", "13", "수리/정영빈", "", "DSS", "유상", "현장"])] });
    // (가) 엑셀 수량 13 = 18 − 5 → 조정 없음
    const partsA = sheet("부품 재고 현황", H_PARTS, { changed: [{ key: "1", label: "No. 1", cells: [{ col: "F", label: "수량", before: "18", after: "13" }] }] });
    const a = planApply(diff([use, partsA]), PARTS, "f.xlsx");
    assert.equal(a.reconcile.length, 1);
    assert.equal(a.reconcile[0].expectedQuantity, 13);
    assert.equal(a.reconcile[0].adjustDelta, 0);
    assert.equal(a.reconcile[0].input, null);
    assert.equal(a.totalEntries, 1);
    // (나) 엑셀 수량 12 → 차이 −1 만 조정, 조정의 실제 수량은 12
    const partsB = sheet("부품 재고 현황", H_PARTS, { changed: [{ key: "1", label: "No. 1", cells: [{ col: "F", label: "수량", before: "18", after: "12" }] }] });
    const b = planApply(diff([use, partsB]), PARTS, "f.xlsx");
    assert.equal(b.reconcile[0].adjustDelta, -1);
    assert.equal(b.reconcile[0].input?.type, "ADJUST");
    if (b.reconcile[0].input?.type === "ADJUST") assert.equal(b.reconcile[0].input.actualQuantity, 12);
    assert.equal(b.totalEntries, 2);
    assert.notEqual(a.fingerprint, b.fingerprint);
  });

  it("부품 시트의 수량 아닌 칸·새 No.·사라진 No. 는 사람에게 남긴다", () => {
    const parts = sheet("부품 재고 현황", H_PARTS, {
      changed: [{ key: "2", label: "No. 2", cells: [{ col: "I", label: "비고", before: "", after: "새 비고" }] }],
      added: [{ key: "9", label: "No. 9", values: ["9", "새 부품", "-", "-", "-", "3", "", "", "", "PCB", "MB", "DSS"] }],
      removed: [{ key: "3", label: "No. 3", values: ["3", "와셔", "-", "-", "-", "0", "", "", "", "PCB", "MB", "DSS"] }],
    });
    const plan = planApply(diff([parts]), PARTS, "f.xlsx");
    assert.equal(plan.entries.length, 0);
    assert.equal(plan.reconcile.length, 0);
    assert.equal(plan.skipped.length, 3);
    assert.match(plan.skipped[0].reason, /비고/);
    assert.match(plan.skipped[1].reason, /새 No\./);
    assert.match(plan.skipped[2].reason, /사라진 No\./);
  });

  it("수량 변경 기록의 더한 줄: 조정·폐기·대여는 반영, 반환·소유 옮김은 남긴다", () => {
    const change = sheet("수량 변경 기록", H_CHANGE, {
      added: [
        added("9", ["", "2026-10-12", "조정", "너트", "M6", "DR-2", "-", "5", "3", "8", "정영빈", "실사", "KYOSAN", "-"]),
        added("10", ["", "2026-10-12", "폐기·불량", "너트", "M6", "DR-2", "-", "8", "-1", "7", "정영빈", "", "KYOSAN", "-"]),
        added("11", ["", "2026-10-12", "대여", "볼트", "-", "-", "-", "18", "-2", "16", "정영빈", "", "DSS", "교산 서울"]),
        added("12", ["", "2026-10-12", "반환", "볼트", "-", "-", "-", "16", "1", "17", "정영빈", "", "DSS", "-"]),
        added("13", ["", "2026-10-12", "소유 옮김", "와셔", "-", "-", "-", "7", "-1", "6", "정영빈", "", "KYOSAN", "No. 3"]),
      ],
    });
    const plan = planApply(diff([change]), PARTS, "f.xlsx");
    assert.deepEqual(
      plan.entries.map((e) => [e.input.type, e.partNo, e.delta]),
      [
        ["ADJUST", 2, 3],
        ["DISPOSE", 2, -1],
        ["LOAN", 1, -2],
      ],
    );
    const adj = plan.entries[0].input;
    if (adj.type === "ADJUST") assert.equal(adj.actualQuantity, 8); // 5 + 3
    const loan = plan.entries[2].input;
    if (loan.type === "LOAN") assert.equal(loan.counterparty, "교산 서울");
    assert.equal(plan.skipped.length, 2);
    assert.match(plan.skipped[0].reason, /반환/);
    assert.match(plan.skipped[1].reason, /소유 옮김/);
  });

  it("못 맞춘 줄·날짜·수량·유상무상·묶음·소유 불일치는 이유와 함께 남긴다", () => {
    const use = sheet("사용처 기입란", H_USE, {
      added: [
        added("3", ["", "2026-10-12", "-", "없는부품", "-", "-", "-", "", "1", "", "수리/정영빈", "", "DSS", "유상", ""]),
        added("4", ["", "날짜아님", "-", "볼트", "-", "-", "-", "", "1", "", "수리/정영빈", "", "DSS", "유상", ""]),
        added("5", ["", "2026-10-12", "-", "볼트", "-", "-", "-", "", "0", "", "수리/정영빈", "", "DSS", "유상", ""]),
        added("6", ["", "2026-10-12", "-", "볼트", "-", "-", "-", "", "1", "", "수리/정영빈", "", "DSS", "-", ""]),
        added("7", ["", "2026-10-12", "-", "핀", "-", "-", "-", "", "1", "", "수리/정영빈", "", "DSS", "유상", ""]),
        added("8", ["", "2026-10-12", "-", "너트", "M6", "DR-2", "-", "", "1", "", "수리/정영빈", "", "DSS", "유상", ""]),
        added("9", ["", "2026-10-12", "ABC", "볼트", "-", "-", "-", "", "1", "", "수리/정영빈", "", "DSS", "유상", ""]),
      ],
      changed: [{ key: "2", label: "2행", cells: [{ col: "I", label: "사용 재고", before: "1", after: "2" }] }],
    });
    const plan = planApply(diff([use]), PARTS, "f.xlsx");
    assert.equal(plan.entries.length, 0);
    const reasons = plan.skipped.map((s) => s.reason);
    assert.equal(reasons.length, 8);
    assert.match(reasons[0], /기존 줄을 고침/);
    assert.match(reasons[1], /맞는 부품이 없음/);
    assert.match(reasons[2], /날짜/);
    assert.match(reasons[3], /사용 재고/);
    assert.match(reasons[4], /유상\/무상/);
    assert.match(reasons[5], /여럿/);
    assert.match(reasons[6], /소유 불일치/);
    assert.match(reasons[7], /인수번호 꼴/);
    assert.equal(plan.totalEntries, 0);
    assert.match(summarizePlan(plan), /반영할 기록 없음 \(반영 불가 8줄\)/);
  });

  it("같은 입력이면 지문이 같고, 요약은 종류별 건수", () => {
    const d = diff([sheet("입고 기입란", H_RECEIVE, { added: [added("664", ["", "2026-10-11", "너트", "M6", "DR-2", "-", "5", "10", "15", "", "KYOSAN"])] })]);
    const a = planApply(d, PARTS, "f.xlsx");
    const b = planApply(d, PARTS, "f.xlsx");
    assert.equal(a.fingerprint, b.fingerprint);
    assert.equal(summarizePlan(a), "입고 1");
  });

  it("글자 풀기 도우미", () => {
    assert.equal(parseDateText("2026-10-12"), "2026-10-12");
    assert.equal(parseDateText("2026.1.5"), "2026-01-05");
    assert.equal(parseDateText("2026/10/12"), "2026-10-12");
    assert.equal(parseDateText("2026.02.30"), null);
    assert.equal(parseDateText("어제"), null);
    assert.equal(parseIntText("1,200"), 1200);
    assert.equal(parseIntText("-3"), -3);
    assert.equal(parseIntText("-"), null);
    assert.equal(parseIntText("1.5"), null);
    assert.deepEqual(parsePurposeActor("수리/정영빈"), { purpose: "REPAIR", purposeText: "", actorName: "정영빈" });
    assert.deepEqual(parsePurposeActor("필드/김"), { purpose: "FIELD", purposeText: "", actorName: "김" });
    assert.deepEqual(parsePurposeActor("데모용/김"), { purpose: "OTHER", purposeText: "데모용", actorName: "김" });
    assert.equal(parseChargeText("유상"), "PAID");
    assert.equal(parseChargeText("-"), null);
    assert.equal(parseEntryTypeLabel("폐기·불량"), "DISPOSE");
    assert.equal(parseEntryTypeLabel("폐기"), "DISPOSE");
    assert.equal(parseEntryTypeLabel("모름"), null);
  });
});
