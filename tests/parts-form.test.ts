import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffPartInput, parseCustomerName, parsePartForm, parsePartItemForm, partToFormValues, readPartFormValues, type PartInput } from "../src/lib/parts/form";

const ITEM = "11111111-1111-1111-1111-111111111111";
const ITEMS = new Set([ITEM]);

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

const GOOD = {
  name: " AMP-DEH-DV2H(13M) ",
  name2: "",
  customerName: " 증폭기 조립품 ",
  kyosanPartNo: "C090722733",
  drawingNo: "WR10136AA148B",
  supplyPrice: "54,000",
  supplyCurrency: "JPY",
  quotePrice: "990000",
  note: "2024.04.07 재고 100EA시 주문 필요\r\n둘째 줄",
  itemId: ITEM,
  category: "RFG",
  owner: "DSS",
};

describe("parsePartForm", () => {
  it("정상 입력: 앞뒤 공백·쉼표를 정리하고 줄바꿈은 \\n 으로", () => {
    const r = parsePartForm(fd(GOOD), ITEMS);
    assert.ok(r.ok);
    assert.equal(r.value.name, "AMP-DEH-DV2H(13M)");
    assert.equal(r.value.customerName, "증폭기 조립품");
    assert.equal(r.value.supplyPrice, 54000);
    assert.equal(r.value.quotePrice, 990000);
    assert.equal(r.value.note, "2024.04.07 재고 100EA시 주문 필요\n둘째 줄");
    assert.equal(r.value.supplyCurrency, "JPY");
    assert.equal(r.value.category, "RFG");
    assert.equal(r.value.owner, "DSS");
  });

  it("가격을 비우면 null, 0 은 0", () => {
    const r = parsePartForm(fd({ ...GOOD, supplyPrice: "", quotePrice: "0" }), ITEMS);
    assert.ok(r.ok);
    assert.equal(r.value.supplyPrice, null);
    assert.equal(r.value.quotePrice, 0);
  });

  it("엑셀 습관대로 친 '-' 는 빈 값으로 받는다 (품명2·고객사 품명·교산 품번·도번·비고)", () => {
    const r = parsePartForm(fd({ ...GOOD, name2: "-", customerName: "-", kyosanPartNo: " - ", drawingNo: "—", note: "-" }), ITEMS);
    assert.ok(r.ok);
    assert.equal(r.value.name2, "");
    assert.equal(r.value.customerName, "");
    assert.equal(r.value.kyosanPartNo, "");
    assert.equal(r.value.drawingNo, "");
    assert.equal(r.value.note, "");
    // 품명은 필수 칸이라 '-' 라도 몰래 비우지 않는다
    const r2 = parsePartForm(fd({ ...GOOD, name: "-" }), ITEMS);
    assert.ok(r2.ok);
    assert.equal(r2.value.name, "-");
  });

  it("품명이 비면 오류 (필수)", () => {
    const r = parsePartForm(fd({ ...GOOD, name: "   " }), ITEMS);
    assert.ok(!r.ok);
    assert.match(r.errors.name ?? "", /품명/);
  });

  it("가격이 숫자가 아니거나 음수·소수면 오류", () => {
    for (const bad of ["abc", "-5", "1.5", "1e3"]) {
      const r = parsePartForm(fd({ ...GOOD, supplyPrice: bad }), ITEMS);
      assert.ok(!r.ok, bad);
      assert.ok(r.errors.supplyPrice, bad);
    }
  });

  it("모르는 항목·분류·소유·통화는 거른다 (클라이언트 값을 믿지 않는다)", () => {
    const r = parsePartForm(fd({ ...GOOD, itemId: "22222222-2222-2222-2222-222222222222", category: "호환", owner: "교산", supplyCurrency: "USD" }), ITEMS);
    assert.ok(!r.ok);
    assert.ok(r.errors.itemId);
    assert.ok(r.errors.category);
    assert.ok(r.errors.owner);
    assert.ok(r.errors.supplyCurrency);
  });

  it("통화를 안 보내면 엔이 기본", () => {
    const r = parsePartForm(fd({ ...GOOD, supplyCurrency: "" }), ITEMS);
    assert.ok(r.ok);
    assert.equal(r.value.supplyCurrency, "JPY");
  });

  it("너무 긴 글자는 오류", () => {
    const r = parsePartForm(fd({ ...GOOD, name2: "x".repeat(201), customerName: "z".repeat(201), note: "y".repeat(4001) }), ITEMS);
    assert.ok(!r.ok);
    assert.ok(r.errors.name2);
    assert.ok(r.errors.customerName);
    assert.ok(r.errors.note);
  });
});

describe("폼 값 왕복", () => {
  it("readPartFormValues 는 문자열 그대로, partToFormValues 는 null 을 빈 칸으로", () => {
    const v = readPartFormValues(fd(GOOD));
    assert.equal(v.supplyPrice, "54,000");
    const back = partToFormValues({
      name: "A",
      name2: "",
      customerName: "고객사 품명 A",
      kyosanPartNo: "",
      drawingNo: "",
      supplyPrice: null,
      supplyCurrency: "KRW",
      quotePrice: 1200,
      note: "",
      itemId: ITEM,
      category: "MB",
      owner: "KYOSAN",
    });
    assert.equal(back.supplyPrice, "");
    assert.equal(back.customerName, "고객사 품명 A");
    assert.equal(back.quotePrice, "1200");
    assert.equal(back.supplyCurrency, "KRW");
  });
});

describe("parseCustomerName (고객사 품명만 고치는 전용 길)", () => {
  it("폼 전체 검사와 같은 규칙: 앞뒤 공백 정리, '-' 는 빈 값", () => {
    const a = parseCustomerName(fd({ customerName: "  증폭기 조립품  " }));
    assert.ok(a.ok);
    assert.equal(a.value, "증폭기 조립품");

    const b = parseCustomerName(fd({ customerName: " - " }));
    assert.ok(b.ok);
    assert.equal(b.value, "");
  });

  it("칸을 비우면 빈 값으로 지울 수 있다 (사람이 직접 고칠 때는 덮어쓴다)", () => {
    const r = parseCustomerName(fd({ customerName: "" }));
    assert.ok(r.ok);
    assert.equal(r.value, "");
    // 아예 안 보내도 빈 값
    const none = parseCustomerName(fd({}));
    assert.ok(none.ok);
    assert.equal(none.value, "");
  });

  it("200자를 넘으면 한국어 오류", () => {
    const r = parseCustomerName(fd({ customerName: "가".repeat(201) }));
    assert.ok(!r.ok);
    assert.match(r.errors, /고객사 품명/);
  });
});

describe("diffPartInput", () => {
  const base: PartInput = {
    name: "A",
    name2: "",
    customerName: "",
    kyosanPartNo: "",
    drawingNo: "D1",
    supplyPrice: 100,
    supplyCurrency: "JPY",
    quotePrice: null,
    note: "",
    itemId: ITEM,
    category: "RFG",
    owner: "DSS",
  };

  it("바뀐 칸만 앞·뒤 값으로 담는다", () => {
    const d = diffPartInput(base, { ...base, name: "B", supplyPrice: null, quotePrice: 5 });
    assert.deepEqual(d, {
      name: { before: "A", after: "B" },
      supplyPrice: { before: 100, after: null },
      quotePrice: { before: null, after: 5 },
    });
  });

  it("같으면 빈 객체", () => {
    assert.deepEqual(diffPartInput(base, { ...base }), {});
  });
});

describe("parsePartItemForm", () => {
  it("코드는 대문자로 올리고, 이름과 함께 받는다", () => {
    const r = parsePartItemForm(fd({ code: "sensor_2", name: " 센서 " }));
    assert.ok(r.ok);
    assert.deepEqual(r.value, { code: "SENSOR_2", name: "센서" });
  });

  it("코드 모양이 틀리면 오류", () => {
    for (const bad of ["1ABC", "A-B", "한글", "A".repeat(41), ""]) {
      const r = parsePartItemForm(fd({ code: bad, name: "이름" }));
      assert.ok(!r.ok, bad);
      assert.ok(r.errors.code, bad);
    }
  });

  it("이름이 비면 오류", () => {
    const r = parsePartItemForm(fd({ code: "ABC", name: "" }));
    assert.ok(!r.ok);
    assert.ok(r.errors.name);
  });
});
