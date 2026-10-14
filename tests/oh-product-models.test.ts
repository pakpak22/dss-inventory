import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AS_PRODUCT_MODEL_MESSAGES,
  filterUnlinkedModels,
  linkedProductModelIds,
  parseAsProductModelsResponse,
  type AsProductModelDirectory,
} from "../src/lib/oh/product-models";

/**
 * ============================================================================
 * A/S 제품 모델 명부 — 「못 받아 왔다」와 「빈 목록」을 가른다 (2026-10-15, 조각 8a)
 * ============================================================================
 * 제품 모델의 주인은 A/S 이고, A/S 가 꺼지는 일은 실제로 일어난다. 그때 「확인하지 못했다」를
 * 「이을 수 있는 모델이 없다」로 그리면 관리자는 저쪽 모델이 지워진 줄 안다. 그래서 응답을 못
 * 읽은 것(`null`)과 한 개도 없는 것(`[]`)을 **다른 결과로** 들고 다닌다.
 *
 * 둘째는 고르개 거르개다 — **모델 하나는 템플릿 하나에만 붙으므로**(DB 의 unique), 이미 붙은
 * 것을 빼 두지 않으면 사람이 고를 수는 있는데 저장이 거절당한다.
 *
 * DB 에도 망에도 붙지 않는다 — 전부 순수 함수다.
 * ============================================================================
 */

const 가 = { id: "11111111-1111-4111-8111-111111111111", modelName: "RF-100" };
const 나 = { id: "22222222-2222-4222-8222-222222222222", modelName: "RF-200" };

describe("🔴 응답 읽기 — 못 읽은 것과 한 개도 없는 것은 다르다", () => {
  test("모양이면 그대로 읽는다", () => {
    const models = parseAsProductModelsResponse({ generatedAt: "2026-10-15T00:00:00Z", count: 2, models: [가, 나] });
    assert.deepEqual(models, [가, 나]);
  });

  test("🔴 200 인데 한 개도 없는 것은 **빈 배열**이다 — null 이 아니다", () => {
    assert.deepEqual(parseAsProductModelsResponse({ generatedAt: "x", count: 0, models: [] }), []);
  });

  test("🔴 모양이 아니면 null 이다 — 부르는 쪽이 「못 받아 왔다」로 바꾼다", () => {
    assert.equal(parseAsProductModelsResponse(null), null);
    assert.equal(parseAsProductModelsResponse("models"), null);
    assert.equal(parseAsProductModelsResponse([가]), null); // 배열 통째로는 모양이 아니다
    assert.equal(parseAsProductModelsResponse({ count: 2 }), null); // models 가 없다
    assert.equal(parseAsProductModelsResponse({ models: "둘" }), null);
  });

  test("count 를 믿지 않는다 — 실제로 읽은 줄 수가 답이다", () => {
    assert.equal(parseAsProductModelsResponse({ count: 99, models: [가] })?.length, 1);
  });

  test("id 나 이름이 빈 줄은 버린다 — 고를 수 없고, 저장하면 NOT NULL 에서 터진다", () => {
    const models = parseAsProductModelsResponse({
      models: [가, { id: "", modelName: "이름만" }, { id: "x", modelName: "   " }, "글자", null],
    });
    assert.deepEqual(models, [가]);
  });

  test("앞뒤 공백은 뗀다", () => {
    assert.deepEqual(parseAsProductModelsResponse({ models: [{ id: ` ${가.id} `, modelName: " RF-100 " }] }), [가]);
  });
});

describe("못 받아 온 까닭을 사람 말로", () => {
  test("셋 다 「모델이 없습니다」라고 말하지 않는다", () => {
    for (const reason of ["not_configured", "timeout", "error"] as const) {
      const message = AS_PRODUCT_MODEL_MESSAGES[reason];
      assert.ok(message);
      assert.doesNotMatch(message, /없습니다$/);
    }
  });

  test("받아 온 결과와 못 받아 온 결과가 타입에서 갈린다", () => {
    const 받아옴: AsProductModelDirectory = { status: "ok", models: [] };
    const 못받아옴: AsProductModelDirectory = { status: "unreachable", reason: "timeout" };
    // 🔴 빈 목록은 **성공**이다. 못 받아 온 것과 같은 값으로 뭉개지지 않는다.
    assert.equal(받아옴.status, "ok");
    assert.notEqual(받아옴.status, 못받아옴.status);
  });
});

describe("🔴 이미 이어 둔 모델을 고르개에서 뺀다", () => {
  test("붙은 것은 빠지고 나머지는 남는다", () => {
    assert.deepEqual(filterUnlinkedModels([가, 나], new Set([가.id])), [나]);
  });

  test("아무것도 안 붙었으면 전부 남는다", () => {
    assert.deepEqual(filterUnlinkedModels([가, 나], new Set()), [가, 나]);
  });

  test("다 붙었으면 빈 목록이다 — 「못 받아 왔다」와 다른 값이다", () => {
    assert.deepEqual(filterUnlinkedModels([가, 나], new Set([가.id, 나.id])), []);
  });

  test("모델명 순으로 돌려준다 — 저쪽 차례 규칙이 바뀌어도 이쪽이 흔들리지 않게", () => {
    assert.deepEqual(
      filterUnlinkedModels([나, 가], new Set()).map((m) => m.modelName),
      ["RF-100", "RF-200"],
    );
  });

  test("받은 배열을 고치지 않는다", () => {
    const 원본 = [나, 가];
    filterUnlinkedModels(원본, new Set());
    assert.deepEqual(원본, [나, 가]);
  });

  test("🔴 다른 템플릿에 붙은 것도 빠진다 — 모델 하나는 템플릿 하나에만 붙는다", () => {
    const templates = [
      { models: [{ productModelId: 가.id }] },
      { models: [] },
      { models: [{ productModelId: 나.id }] },
    ];
    const linked = linkedProductModelIds(templates);
    assert.equal(linked.size, 2);
    assert.deepEqual(filterUnlinkedModels([가, 나], linked), []);
  });
});
