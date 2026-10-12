import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENTRY_TYPES } from "../src/db/schema/stock";
import { ENTRY_TYPE_LABEL, RECORDABLE_TYPES, formatDelta, sheetNoText, sheetOf, signOf, todaySeoul } from "../src/lib/stock/codes";
import { parseEntryForm, parseEntryListFilter, parseOccurredOn } from "../src/lib/stock/form";

const TODAY = "2026-10-06";
const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const T1 = "33333333-3333-3333-3333-333333333333";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

describe("코드표", () => {
  it("모든 종류에 한글 이름이 있고, 시트·부호가 정해져 있다", () => {
    for (const t of ENTRY_TYPES) {
      assert.ok(ENTRY_TYPE_LABEL[t]);
      assert.ok(["USE", "RECEIVE", "CHANGE"].includes(sheetOf(t)));
    }
    assert.equal(sheetOf("USE"), "USE");
    assert.equal(sheetOf("RECEIVE"), "RECEIVE");
    assert.equal(sheetOf("CORRECTION"), "CHANGE");
    assert.equal(signOf("USE"), -1);
    assert.equal(signOf("RECEIVE"), 1);
    assert.equal(signOf("ADJUST"), 0);
  });

  it("화면에서 고르는 종류는 일곱 가지 (처음 수량·기록 취소 제외)", () => {
    assert.equal(RECORDABLE_TYPES.length, 7);
    assert.ok(!(RECORDABLE_TYPES as readonly string[]).includes("OPENING"));
    assert.ok(!(RECORDABLE_TYPES as readonly string[]).includes("CORRECTION"));
  });

  it("기록 번호는 시트별 영문 두 글자 + 연도 + 순번 (견적서 번호와 안 겹치게)", () => {
    assert.equal(sheetNoText("USE", 2026, 5), "US-2026-5");
    assert.equal(sheetNoText("RECEIVE", 2026, 12), "RC-2026-12");
    assert.equal(sheetNoText("CORRECTION", 2026, 3), "CH-2026-3");
    assert.equal(sheetNoText("LOAN", 2026, 3), "CH-2026-3");
  });

  it("증감 표시와 오늘 날짜(서울)", () => {
    assert.equal(formatDelta(3), "+3");
    assert.equal(formatDelta(-1200), "−1,200");
    assert.match(todaySeoul(new Date("2026-10-06T20:00:00Z")), /^2026-10-07$/); // UTC 20시 = 서울 다음날 5시
  });
});

describe("parseOccurredOn", () => {
  it("있는 날짜만, 2000년 이후, 내일까지", () => {
    assert.equal(parseOccurredOn("2026-10-06", TODAY), "2026-10-06");
    assert.equal(parseOccurredOn("2026-10-07", TODAY), "2026-10-07");
    assert.equal(parseOccurredOn("2026-10-08", TODAY), null);
    assert.equal(parseOccurredOn("2026-02-30", TODAY), null);
    assert.equal(parseOccurredOn("1999-12-31", TODAY), null);
    assert.equal(parseOccurredOn("26-10-06", TODAY), null);
  });
});

describe("parseEntryForm — 사용", () => {
  const base = { type: "USE", occurredOn: TODAY, intakeNumber: "d260701", purpose: "REPAIR", note: "" };
  const lines = JSON.stringify([{ partId: P1, quantity: 2, chargeType: "PAID", note: "", actualQuantity: null }]);

  it("정상: 인수번호는 대문자로, 줄은 그대로", () => {
    const r = parseEntryForm(fd({ ...base, lines }), TODAY);
    assert.ok(r.ok);
    assert.equal(r.value.type, "USE");
    if (r.value.type !== "USE") return;
    assert.equal(r.value.intakeNumber, "D260701");
    assert.equal(r.value.noRepairCase, false);
    assert.deepEqual(r.value.lines, [{ partId: P1, quantity: 2, chargeType: "PAID", note: "", actualQuantity: null }]);
  });

  it("인수번호 모양이 틀리면 오류, 수리 건 없음이면 사유 필수", () => {
    const bad = parseEntryForm(fd({ ...base, intakeNumber: "D26", lines }), TODAY);
    assert.ok(!bad.ok && bad.errors.intakeNumber);
    const noCase = parseEntryForm(fd({ ...base, intakeNumber: "", noRepairCase: "1", reason: "", lines }), TODAY);
    assert.ok(!noCase.ok && noCase.errors.reason);
    const ok = parseEntryForm(fd({ ...base, intakeNumber: "", noRepairCase: "1", reason: "데모 장비", lines }), TODAY);
    assert.ok(ok.ok && ok.value.type === "USE" && ok.value.noRepairCase && ok.value.intakeNumber === "");
  });

  it("부품 줄: 비면 오류, 같은 부품 두 번 오류, 수량 0 오류, 유상·무상 없으면 오류", () => {
    assert.ok(!parseEntryForm(fd({ ...base, lines: "[]" }), TODAY).ok);
    const dup = parseEntryForm(fd({ ...base, lines: JSON.stringify([{ partId: P1, quantity: 1, chargeType: "PAID" }, { partId: P1, quantity: 1, chargeType: "PAID" }]) }), TODAY);
    assert.ok(!dup.ok && dup.errors["lines.1"]);
    const zero = parseEntryForm(fd({ ...base, lines: JSON.stringify([{ partId: P1, quantity: 0, chargeType: "PAID" }]) }), TODAY);
    assert.ok(!zero.ok && zero.errors["lines.0"]);
    const noCharge = parseEntryForm(fd({ ...base, lines: JSON.stringify([{ partId: P1, quantity: 1 }]) }), TODAY);
    assert.ok(!noCharge.ok && noCharge.errors["lines.0"]);
  });

  it("실제 수량이 다릅니다: 0 이상의 정수", () => {
    const r = parseEntryForm(fd({ ...base, lines: JSON.stringify([{ partId: P1, quantity: 1, chargeType: "FREE", actualQuantity: "7" }]) }), TODAY);
    assert.ok(r.ok && r.value.type === "USE" && r.value.lines[0].actualQuantity === 7);
    const bad = parseEntryForm(fd({ ...base, lines: JSON.stringify([{ partId: P1, quantity: 1, chargeType: "FREE", actualQuantity: -1 }]) }), TODAY);
    assert.ok(!bad.ok);
  });

  it("목적이 기타면 글자 필수", () => {
    const r = parseEntryForm(fd({ ...base, purpose: "OTHER", purposeText: "", lines }), TODAY);
    assert.ok(!r.ok && r.errors.purposeText);
  });

  it("깨진 JSON 은 오류로 (예외를 던지지 않는다)", () => {
    const r = parseEntryForm(fd({ ...base, lines: "{not json" }), TODAY);
    assert.ok(!r.ok && r.errors.lines);
  });
});

describe("parseEntryForm — 다른 종류", () => {
  it("입고·대여·폐기는 단순 줄. 대여는 빌려준 곳, 폐기는 사유 필수", () => {
    const lines = JSON.stringify([{ partId: P1, quantity: 3, note: "x" }]);
    const rec = parseEntryForm(fd({ type: "RECEIVE", occurredOn: TODAY, lines }), TODAY);
    assert.ok(rec.ok && rec.value.type === "RECEIVE" && rec.value.lines[0].quantity === 3);
    const loan = parseEntryForm(fd({ type: "LOAN", occurredOn: TODAY, counterparty: "", lines }), TODAY);
    assert.ok(!loan.ok && loan.errors.counterparty);
    const disp = parseEntryForm(fd({ type: "DISPOSE", occurredOn: TODAY, reason: "", lines }), TODAY);
    assert.ok(!disp.ok && disp.errors.reason);
  });

  it("반환은 되돌릴 줄 id 와 수량", () => {
    const r = parseEntryForm(fd({ type: "RETURN", occurredOn: TODAY, lines: JSON.stringify([{ transactionId: T1, quantity: 1 }]) }), TODAY);
    assert.ok(r.ok && r.value.type === "RETURN" && r.value.lines[0].transactionId === T1);
    assert.ok(!parseEntryForm(fd({ type: "RETURN", occurredOn: TODAY, lines: "[]" }), TODAY).ok);
  });

  it("조정은 부품·실제 수량(0 허용)·사유", () => {
    const r = parseEntryForm(fd({ type: "ADJUST", occurredOn: TODAY, partId: P1, actualQuantity: "0", reason: "실사" }), TODAY);
    assert.ok(r.ok && r.value.type === "ADJUST" && r.value.actualQuantity === 0);
    const bad = parseEntryForm(fd({ type: "ADJUST", occurredOn: TODAY, partId: "x", actualQuantity: "", reason: "" }), TODAY);
    assert.ok(!bad.ok && bad.errors.partId && bad.errors.actualQuantity && bad.errors.reason);
  });

  it("소유 옮김은 보내는·받는 부품이 달라야 한다", () => {
    const same = parseEntryForm(fd({ type: "TRANSFER", occurredOn: TODAY, fromPartId: P1, toPartId: P1, quantity: "1" }), TODAY);
    assert.ok(!same.ok && same.errors.toPartId);
    const ok = parseEntryForm(fd({ type: "TRANSFER", occurredOn: TODAY, fromPartId: P1, toPartId: P2, quantity: "2" }), TODAY);
    assert.ok(ok.ok && ok.value.type === "TRANSFER" && ok.value.quantity === 2);
  });

  it("모르는 종류·처음 수량·기록 취소는 폼으로 못 넣는다", () => {
    for (const t of ["OPENING", "CORRECTION", "HACK"]) {
      const r = parseEntryForm(fd({ type: t, occurredOn: TODAY }), TODAY);
      assert.ok(!r.ok && r.errors.type, t);
    }
  });
});

describe("parseEntryListFilter", () => {
  it("주소 값을 거르기로. 이상한 값은 버린다", () => {
    const f = parseEntryListFilter({ type: "USE", from: "2026-01-01", to: "bad", part: "12", actor: " 정영빈 ", intake: "d26", unverified: "1", page: "3" });
    assert.deepEqual(f, { type: "USE", from: "2026-01-01", to: null, partText: "12", partFields: ["n", "a", "b", "d", "p"], actor: "정영빈", text: "", intakeNumber: "D26", unverifiedOnly: true, page: 3 });
    // 내용 찾기 (2026-10-07): 앞뒤 공백 떼고 100자까지
    assert.equal(parseEntryListFilter({ text: "  상해수리소 " }).text, "상해수리소");
    assert.equal(parseEntryListFilter({ text: "x".repeat(150) }).text.length, 100);
    // 찾을 곳 체크 (2026-10-06): pf 가 없거나 전부 틀리면 전부, 있으면 그것만(차례는 고정)
    const t = parseEntryListFilter({ part: " WRDEMO002A ", pf: "d,a" });
    assert.equal(t.partText, "WRDEMO002A");
    assert.deepEqual(t.partFields, ["a", "d"]);
    assert.deepEqual(parseEntryListFilter({ pf: "zzz" }).partFields, ["n", "a", "b", "d", "p"]);
    const g = parseEntryListFilter({ type: "HACK", page: "-1" });
    assert.equal(g.type, null);
    assert.equal(g.page, 1);
  });
});
