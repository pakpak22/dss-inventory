import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATEGORIES, CURRENCIES, OWNERS } from "../src/db/schema/codes";
import { PART_ITEM_SEED } from "../src/db/seed/part-items";
import { CATEGORY_LABEL, CURRENCY_SIGN, OWNER_LABEL, formatMoney, formatQuantity, isCategory, isOwner } from "../src/lib/parts/codes";

describe("코드값 ↔ 화면 글자", () => {
  it("모든 코드값에 화면 글자가 있다 (하나라도 빠지면 화면에 영문 코드가 그대로 뜬다)", () => {
    for (const o of OWNERS) assert.ok(OWNER_LABEL[o]);
    for (const c of CATEGORIES) assert.ok(CATEGORY_LABEL[c]);
    for (const c of CURRENCIES) assert.ok(CURRENCY_SIGN[c]);
  });

  it("소유는 A/S 와 같은 값, 보수부재만 한글로 보인다 (DESIGN 4-1절)", () => {
    assert.deepEqual([...OWNERS], ["DSS", "KYOSAN", "SERVICE_SPARE"]);
    assert.equal(OWNER_LABEL.SERVICE_SPARE, "보수부재");
    assert.equal(CATEGORY_LABEL.COMPATIBLE, "호환");
  });

  it("판별 함수는 모르는 값을 거른다", () => {
    assert.equal(isOwner("DSS"), true);
    assert.equal(isOwner("교산"), false);
    assert.equal(isCategory("MB"), true);
    assert.equal(isCategory(""), false);
  });

  it("금액·수량 표시", () => {
    assert.equal(formatMoney(54000, "JPY"), "¥54,000");
    assert.equal(formatMoney(15500000, "KRW"), "₩15,500,000");
    assert.equal(formatMoney(null, "JPY"), "-");
    assert.equal(formatMoney(0, "KRW"), "₩0");
    assert.equal(formatQuantity(1234), "1,234");
  });
});

describe("항목 19종 기준 자료", () => {
  it("19종이고 코드·이름이 겹치지 않는다", () => {
    assert.equal(PART_ITEM_SEED.length, 19);
    assert.equal(new Set(PART_ITEM_SEED.map((s) => s.code)).size, 19);
    assert.equal(new Set(PART_ITEM_SEED.map((s) => s.name)).size, 19);
  });

  it("현황판의 항목 글자와 같다 (엑셀 가져오기가 이 이름으로 대조한다)", () => {
    const names = new Set(PART_ITEM_SEED.map((s) => s.name));
    for (const n of ["PCB", "판금", "콘덴서", "기타", "퓨즈", "나사", "바리콘", "케이블", "IGBT", "피팅", "유량계", "트랜스", "팬", "컨트롤러", "커플링", "커넥터", "저항", "호스", "모터"]) {
      assert.ok(names.has(n), `항목 「${n}」 이 없습니다`);
    }
    assert.equal(PART_ITEM_SEED[PART_ITEM_SEED.length - 1].code, "ETC", "「기타」 는 맨 뒤");
  });

  it("코드는 영문 대문자·밑줄만 (DB 에 들어가고 바깥에 내주는 값)", () => {
    for (const s of PART_ITEM_SEED) assert.match(s.code, /^[A-Z][A-Z_]*$/);
  });
});
