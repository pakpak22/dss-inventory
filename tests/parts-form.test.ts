import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffPartInput, parseCustomerName, parseLimitQuantity, parsePartForm, parsePartItemForm, partToFormValues, readPartFormValues, type PartInput } from "../src/lib/parts/form";
import { MAX_QTY } from "../src/lib/stock/form";

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
  limitQuantity: "5",
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
      limitQuantity: null,
      note: "",
      itemId: ITEM,
      category: "MB",
      owner: "KYOSAN",
    });
    assert.equal(back.supplyPrice, "");
    assert.equal(back.customerName, "고객사 품명 A");
    assert.equal(back.quotePrice, "1200");
    assert.equal(back.supplyCurrency, "KRW");
    assert.equal(back.limitQuantity, "");
  });

  // 🔴 「0 = 하나도 안 남으면 알려라」와 「빈 칸 = 알리지 않음」은 다른 값이다. 빈 칸으로 그리면
  //    화면에서 **끈 것처럼 보이는데 실제로는 울리는** 부품이 생긴다(부등호가 「이하」라서).
  it("🔴 한계수량 `0` 은 빈 칸이 아니다 — 「0 으로 정함」과 「정하지 않음」이 다른 값이다", () => {
    const zero = partToFormValues({
      name: "A",
      name2: "",
      customerName: "",
      kyosanPartNo: "",
      drawingNo: "",
      supplyPrice: null,
      supplyCurrency: "JPY",
      quotePrice: null,
      limitQuantity: 0,
      note: "",
      itemId: ITEM,
      category: "MB",
      owner: "DSS",
    });
    assert.equal(zero.limitQuantity, "0");
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

/**
 * 한계수량 (2026-10-16 사용자 요청). 🔴 **`null` 과 `0` 이 다른 값**인 것이 이 칸의 전부다 —
 * `null` 은 「정하지 않았다 = **알리지 않는다**」이고 `0` 은 「**하나도 안 남으면 알려라**」는 정한
 * 값이다(부등호가 「이하」라 재고 0 에서 울린다). 「빈 칸과 0 은 다르다」는 결은 금액 칸이 이미
 * 지키는 규칙과 같고, 다른 점은 상한뿐이다.
 *
 * 🔴 **끄는 길은 비우는 것 하나뿐**이라는 것이 이 묶음이 지키는 울타리다 — `0` 을 끄기로 읽으면
 *    그 부품은 재고가 0 이 되는 날 조용히 울린다.
 */
describe("한계수량", () => {
  it("🔴 비우면 null, 0 은 0 — 뭉개면 「끈 부품」과 「0 으로 정한 부품」이 한 값이 된다", () => {
    const none = parsePartForm(fd({ ...GOOD, limitQuantity: "" }), ITEMS);
    assert.ok(none.ok);
    assert.equal(none.value.limitQuantity, null);

    const zero = parsePartForm(fd({ ...GOOD, limitQuantity: "0" }), ITEMS);
    assert.ok(zero.ok);
    assert.equal(zero.value.limitQuantity, 0);
    // 🔴 `0 || null` 같은 실수를 잡는다 — 값이 0 이면서 null 이 아니어야 한다.
    assert.notEqual(zero.value.limitQuantity, null);
  });

  it("쉼표와 앞뒤 공백을 정리한다", () => {
    const r = parsePartForm(fd({ ...GOOD, limitQuantity: " 1,200 " }), ITEMS);
    assert.ok(r.ok);
    assert.equal(r.value.limitQuantity, 1200);
  });

  it("🔴 음수·소수·글자·상한 넘김은 오류다", () => {
    for (const bad of ["-1", "-0", "1.5", "abc", "1e3", String(MAX_QTY + 1)]) {
      const r = parsePartForm(fd({ ...GOOD, limitQuantity: bad }), ITEMS);
      assert.ok(!r.ok, bad);
      assert.ok(r.errors.limitQuantity, bad);
    }
    const edge = parsePartForm(fd({ ...GOOD, limitQuantity: String(MAX_QTY) }), ITEMS);
    assert.ok(edge.ok);
    assert.equal(edge.value.limitQuantity, MAX_QTY);
  });

  it("🔴 상세 창의 전용 길도 **같은 자**를 쓴다 — 어디서 고쳤느냐로 값이 달라지면 안 된다", () => {
    const empty = parseLimitQuantity(fd({ limitQuantity: " " }));
    assert.ok(empty.ok);
    assert.equal(empty.value, null);

    const zero = parseLimitQuantity(fd({ limitQuantity: "0" }));
    assert.ok(zero.ok);
    assert.equal(zero.value, 0);

    const bad = parseLimitQuantity(fd({ limitQuantity: "-3" }));
    assert.ok(!bad.ok);
    assert.match(bad.errors, /한계수량/);

    // 아예 안 보내도 빈 값(= 알림 끄기)
    const none = parseLimitQuantity(fd({}));
    assert.ok(none.ok);
    assert.equal(none.value, null);
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
    limitQuantity: null,
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

  /**
   * 🔴 안 남기면 「누가 한계수량을 내려서 알림이 꺼졌는지」를 아무도 모른다. 특히 `null → 0`
   * (정하지 않음 → 0 으로 정함)은 **알림을 켠 것**인데 숫자가 작아 눈에 안 띈다 — 그 반대인
   * `5 → null` 은 **알림을 끈 것**이다. 둘 다 이력에 남아야 나중에 따질 수 있다.
   */
  it("🔴 한계수량도 이력에 남는다 — null → 0(켜기)·5 → null(끄기) 둘 다 바뀐 것으로 센다", () => {
    assert.deepEqual(diffPartInput(base, { ...base, limitQuantity: 0 }), { limitQuantity: { before: null, after: 0 } });
    assert.deepEqual(diffPartInput({ ...base, limitQuantity: 5 }, { ...base, limitQuantity: null }), { limitQuantity: { before: 5, after: null } });
    assert.deepEqual(diffPartInput({ ...base, limitQuantity: 5 }, { ...base, limitQuantity: 5 }), {});
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
