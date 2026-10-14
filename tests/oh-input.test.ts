import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_OH_TEMPLATE_ITEMS,
  OH_PRICE_FIELD_ERROR_PREFIX,
  isValidExpectedVersion,
  isValidOhTemplateId,
  parseOhPriceValue,
  validateOhPriceEntries,
  validateOhTemplateFields,
} from "../src/lib/oh/input";

/**
 * ============================================================================
 * O/H 부품 템플릿 입력 검증 (2026-10-15, 조각 8a)
 * ============================================================================
 * 이 시험이 지키는 것은 둘이다:
 *
 *  1. **13줄이 상한이다.** OH 견적서 양식의 부품 칸이 34~46행이라, 더 담아 두면 견적서를 만들 때
 *     넘치는 줄이 갈 곳이 없다 — 그때 조용히 자르면 **청구할 부품이 문서에서 사라진다.** 상한을
 *     올리려면 양식을 먼저 고쳐야 한다. 이 시험이 그 사실을 붙들어 둔다.
 *  2. 🔴 **「비었다」와 「0」은 다른 값이다.** 빈 칸은 「O/H 단가를 정하지 않았다」(저장 쪽이 줄을
 *     지운다)이고, 0 은 「오버홀 때는 무상」이다. 둘을 같게 다루면 O/H 견적서가 정하지 않은
 *     부품을 0원으로 청구한다.
 *
 * DB 에도 망에도 붙지 않는다 — 전부 순수 함수다.
 * ============================================================================
 */

const 부품id = "11111111-1111-4111-8111-111111111111";
const 다른부품id = "22222222-2222-4222-8222-222222222222";

function 줄(n: number) {
  return Array.from({ length: n }, (_, i) => ({ partId: null, partNameText: `부품${i + 1}`, quantity: 1 }));
}

describe("🔴 부품 줄 수 상한 — 양식의 13줄", () => {
  test("상한은 13이다 (OH 견적서 양식 34~46행)", () => {
    assert.equal(MAX_OH_TEMPLATE_ITEMS, 13);
  });

  test("13줄은 통과한다", () => {
    const r = validateOhTemplateFields({ name: "표준", items: 줄(13) });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.data.items.length, 13);
  });

  test("🔴 14줄째는 거절한다 — 넘치면 견적서에서 갈 곳이 없다", () => {
    const r = validateOhTemplateFields({ name: "표준", items: 줄(14) });
    assert.equal(r.ok, false);
    assert.ok(r.ok === false && r.fieldErrors.items);
    // 거절 문구가 까닭(양식의 칸 수)을 말해 줘야 한다 — 「13개까지」만 적으면 왜인지 모른다.
    assert.match(r.ok === false ? r.fieldErrors.items : "", /13/);
  });
});

describe("머리 칸", () => {
  /**
   * 🔴 **기종 코드는 2026-10-15 에 없앴다**(조각 9a). 양식의 `K11` 에서만 뜻이 있던 흔적이고,
   * 지금은 제품 모델을 직접 잇는다. 이 두 시험이 지키는 것은 「되살아나지 않는다」와
   * 「그 대신 이름이 필수다」 둘이다.
   */
  test("기종 코드를 보내도 무시한다 — 더 이상 필수가 아니고 돌려주지도 않는다", () => {
    const r = validateOhTemplateFields({ code: "  ", name: "표준", items: [] });
    assert.equal(r.ok, true, "코드가 비었다고 거절하면 안 된다 — 그 칸은 없어졌다");
    assert.equal(r.ok && "code" in r.data, false, "없앤 칸이 되돌아오면 열쇠가 둘이 된다");
  });

  test("코드 없이도 통과한다", () => {
    assert.equal(validateOhTemplateFields({ name: "표준", items: [] }).ok, true);
  });

  test("이름이 비면 거절한다 — 템플릿을 가리키는 유일한 글자다", () => {
    const r = validateOhTemplateFields({ name: "", items: [] });
    assert.equal(r.ok, false);
    assert.ok(r.ok === false && r.fieldErrors.name);
  });

  test("앞뒤 공백을 떼고 돌려준다. 빈 비고는 null 이다", () => {
    const r = validateOhTemplateFields({ name: " 표준 ", note: "   ", items: [] });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.data.name, "표준");
    assert.equal(r.ok && r.data.note, null);
  });

  test("부품 줄이 0개여도 저장할 수 있다 — 먼저 만들고 채우는 길이 있다", () => {
    assert.equal(validateOhTemplateFields({ name: "표준", items: [] }).ok, true);
    assert.equal(validateOhTemplateFields({ name: "표준" }).ok, true);
  });
});

describe("부품 줄", () => {
  test("품명이 비면 그 줄을 짚어 거절한다", () => {
    const r = validateOhTemplateFields({ name: "표준", items: [{ partNameText: "  ", quantity: 1 }] });
    assert.equal(r.ok, false);
    assert.ok(r.ok === false && r.fieldErrors["items.0.partNameText"]);
  });

  test("🔴 수량 0 은 거절한다 — 1 이상이어야 한다", () => {
    const r = validateOhTemplateFields({ name: "표준", items: [{ partNameText: "휴즈", quantity: 0 }] });
    assert.equal(r.ok, false);
    assert.ok(r.ok === false && r.fieldErrors["items.0.quantity"]);
  });

  test("음수·소수 수량도 거절한다", () => {
    for (const quantity of [-1, 1.5]) {
      const r = validateOhTemplateFields({ name: "표준", items: [{ partNameText: "휴즈", quantity }] });
      assert.equal(r.ok, false, String(quantity));
    }
  });

  test("재고 연결은 비어도 된다 — 마스터에 없는 이름이 실제로 있다", () => {
    const r = validateOhTemplateFields({ name: "표준", items: [{ partNameText: "유량계", quantity: 2 }] });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.data.items[0].partId, null);
  });

  test("모양이 uuid 가 아닌 재고 연결은 거절한다", () => {
    const r = validateOhTemplateFields({ name: "표준", items: [{ partId: "아무거나", partNameText: "휴즈", quantity: 1 }] });
    assert.equal(r.ok, false);
    assert.ok(r.ok === false && r.fieldErrors["items.0.partId"]);
  });
});

describe("id·판 번호 모양", () => {
  test("uuid 만 템플릿 id 로 받는다", () => {
    assert.equal(isValidOhTemplateId(부품id), true);
    assert.equal(isValidOhTemplateId("301"), false);
    assert.equal(isValidOhTemplateId(null), false);
  });

  test("판 번호는 1 이상의 정수여야 한다 — 0·소수·글자는 아니다", () => {
    assert.equal(isValidExpectedVersion(1), true);
    assert.equal(isValidExpectedVersion(0), false);
    assert.equal(isValidExpectedVersion(1.5), false);
    assert.equal(isValidExpectedVersion("1"), false);
  });
});

describe("🔴 O/H 단가 — 「비었다」와 「0」은 다른 값이다", () => {
  test("빈 칸·null·undefined 는 「정하지 않음」(null)이다", () => {
    for (const raw of ["", "   ", null, undefined]) {
      const r = parseOhPriceValue(raw);
      assert.equal(r.ok, true, String(raw));
      assert.equal(r.ok && r.value, null, String(raw));
    }
  });

  test("🔴 0 은 값이다 — null 로 뭉개지 않는다(오버홀 때 무상이라는 뜻)", () => {
    const 글자 = parseOhPriceValue("0");
    assert.equal(글자.ok && 글자.value, 0);
    const 숫자 = parseOhPriceValue(0);
    assert.equal(숫자.ok && 숫자.value, 0);
    // 「비었다」와 「0」이 같은 값이 되면 이 단언이 깨진다.
    const 빈칸 = parseOhPriceValue("");
    assert.equal(빈칸.ok, true);
    assert.notEqual(빈칸.ok && 빈칸.value, 0);
  });

  test("쉼표·통화 기호가 섞여도 읽는다 (부품 금액 칸과 같은 규칙)", () => {
    const r = parseOhPriceValue("₩1,250,000");
    assert.equal(r.ok && r.value, 1_250_000);
  });

  test("음수·소수·글자는 거절한다", () => {
    for (const raw of ["-1", "1.5", "아무거나", -1, 1.5, Number.NaN, {}]) {
      assert.equal(parseOhPriceValue(raw).ok, false, String(raw));
    }
  });

  test("줄 목록: 통과하면 부품 id 와 값만 남는다", () => {
    const r = validateOhPriceEntries([
      { partId: 부품id, unitPrice: "125000" },
      { partId: 다른부품id, unitPrice: "" },
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.data, [
      { partId: 부품id, unitPrice: 125_000 },
      // 🔴 비운 칸은 0 이 아니라 null 로 내려간다 — 저장 쪽이 그 줄을 지운다.
      { partId: 다른부품id, unitPrice: null },
    ]);
  });

  test("🔴 하나라도 틀리면 전부 거절한다 — 반쯤 저장되면 화면과 DB 가 달라진다", () => {
    const r = validateOhPriceEntries([
      { partId: 부품id, unitPrice: "125000" },
      { partId: 다른부품id, unitPrice: "-5" },
    ]);
    assert.equal(r.ok, false);
    // 오류 키는 **부품 id** 다 — 화면이 그 줄의 칸 밑에 문장을 붙인다.
    assert.ok(r.ok === false && r.fieldErrors[다른부품id]);
  });

  test("같은 부품이 두 번 오면 거절한다 — 한 줄짜리 표라 하나는 반드시 사라진다", () => {
    const r = validateOhPriceEntries([
      { partId: 부품id, unitPrice: "1" },
      { partId: 부품id, unitPrice: "2" },
    ]);
    assert.equal(r.ok, false);
  });

  test("배열이 아니면 거절한다", () => {
    assert.equal(validateOhPriceEntries(null).ok, false);
    assert.equal(validateOhPriceEntries({ partId: 부품id }).ok, false);
  });

  test("빈 배열은 「고칠 칸이 없다」로 통과한다", () => {
    const r = validateOhPriceEntries([]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.data, []);
  });

  test("오류 키 접두사가 템플릿 칸 이름과 섞이지 않는다", () => {
    // 접두사가 비면 단가 오류와 템플릿 오류가 한 자루에서 구별되지 않는다.
    assert.notEqual(OH_PRICE_FIELD_ERROR_PREFIX, "");
  });
});
