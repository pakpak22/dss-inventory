import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  AS_PRODUCT_MODEL_MESSAGES,
  decideProductModelLink,
  filterUnlinkedModels,
  linkedProductModelIds,
  parseAsProductModelsResponse,
  productModelLinkBlockedMessage,
  type AsProductModelDirectory,
  type ExistingProductModelLink,
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

/* ================================================================== */
/*  🔴 지워진 템플릿이 붙잡고 있던 모델 (2026-10-16 결함 수리)         */
/* ================================================================== */

/**
 * 쓰는 분이 만난 막다른 길: 템플릿을 지웠는데 거기 이어 둔 제품 모델을 다른 템플릿에 이으려니
 * **「지워진 템플릿에 가서 연결을 먼저 푸십시오」** 라고 막았다. 그 템플릿은 목록에 없고
 * 되살리기 화면도 없어 **갈 곳이 없다.**
 *
 * 여기서 못 박는 것 셋:
 *  ① 지워진 템플릿이 붙잡고 있으면 **막지 않는다**(거둬들이고 잇는다).
 *  ② 살아 있는 템플릿끼리는 **여전히 막는다** — 모델 하나에 템플릿 둘이 되면 「이 장비의 O/H
 *    부품」이 두 가지가 된다.
 *  ③ 「그쪽에 가서 푸십시오」라는 말은 **갈 수 있을 때만** 한다.
 *
 * 🔵 템플릿 이름은 **가짜**다 — 운영의 템플릿 이름은 고객사 이름이라 저장소에 박아 두지 않는다.
 */
const 살아있는템플릿 = "11111111-aaaa-4aaa-8aaa-111111111111";
const 다른템플릿 = "22222222-bbbb-4bbb-8bbb-222222222222";
const 지워진템플릿 = "33333333-cccc-4ccc-8ccc-333333333333";

const 붙어있음 = (over: Partial<ExistingProductModelLink> = {}): ExistingProductModelLink => ({
  templateId: 다른템플릿,
  templateName: "살아 있는 옛 템플릿",
  templateIsDeleted: false,
  ...over,
});

describe("🔴 이을 수 있나 — 그리고 못 이으면 빠져나갈 길이 있나", () => {
  test("아무 데도 안 붙어 있으면 그냥 잇는다", () => {
    assert.deepEqual(decideProductModelLink(살아있는템플릿, 가.modelName, null), { kind: "LINK" });
  });

  test("같은 템플릿에 다시 거는 것은 그냥 성공 — 사람이 두 번 누른 것이다", () => {
    const decision = decideProductModelLink(살아있는템플릿, 가.modelName, 붙어있음({ templateId: 살아있는템플릿 }));
    assert.deepEqual(decision, { kind: "ALREADY" });
  });

  test("🔴 **살아 있는** 다른 템플릿에 붙어 있으면 여전히 막는다 — 모델 하나에 템플릿 둘이 되면 안 된다", () => {
    const decision = decideProductModelLink(살아있는템플릿, 가.modelName, 붙어있음());
    assert.equal(decision.kind, "BLOCKED");
    if (decision.kind !== "BLOCKED") return;
    assert.match(decision.message, /살아 있는 옛 템플릿/, "어느 템플릿인지 말해 주지 않으면 풀러 갈 수 없다");
    assert.match(decision.message, /먼저 푸십시오/);
    assert.match(decision.message, /RF-100/, "어느 모델 이야기인지도 말해 준다");
  });

  test("🔴 **지워진** 템플릿이 붙잡고 있으면 막지 않고 거둬들인다 — 풀러 갈 곳이 없다", () => {
    const decision = decideProductModelLink(
      살아있는템플릿,
      가.modelName,
      붙어있음({ templateId: 지워진템플릿, templateName: "지워진 옛 템플릿", templateIsDeleted: true }),
    );
    assert.deepEqual(
      decision,
      { kind: "TAKE_OVER", fromTemplateName: "지워진 옛 템플릿" },
      "막으면 그 모델은 영영 다시 이을 수 없다 — 지워진 템플릿은 목록에 없고 되살리기 화면도 없다",
    );
  });

  test("🔴 문구가 사실에 맞다 — 지워진 템플릿 이름으로 「그쪽에 가서 푸십시오」라고 말하지 않는다", () => {
    const decision = decideProductModelLink(
      살아있는템플릿,
      가.modelName,
      붙어있음({ templateId: 지워진템플릿, templateName: "지워진 옛 템플릿", templateIsDeleted: true }),
    );
    assert.notEqual(decision.kind, "BLOCKED", "거절이 아니므로 「푸십시오」라고 말할 일 자체가 없다");
    assert.equal("message" in decision, false, "갈 수 없는 곳을 가리키는 문구가 만들어지면 안 된다");
  });

  test("거절 문구는 한 자리에서만 만든다 — 두 벌이 되면 한쪽만 고쳐진다", () => {
    const decision = decideProductModelLink(살아있는템플릿, 가.modelName, 붙어있음());
    assert.equal(
      decision.kind === "BLOCKED" ? decision.message : "",
      productModelLinkBlockedMessage(가.modelName, "살아 있는 옛 템플릿"),
    );
  });

  test("🔵 거둬들인 뒤에도 「모델 하나에 템플릿 하나」는 그대로다 — 고르개가 보는 집합이 안 는다", () => {
    // 거둬들이기 = 옛 줄을 **지우고** 새 줄을 넣는 것이므로, 살아 있는 템플릿들이 쥔 모델은
    // 여전히 모델마다 하나다. 되살려도 그 템플릿에는 그 모델이 없다(지웠으므로).
    const 거둔뒤 = [{ models: [{ productModelId: 가.id }] }];
    assert.equal(linkedProductModelIds(거둔뒤).size, 1);
    assert.deepEqual(filterUnlinkedModels([가, 나], linkedProductModelIds(거둔뒤)), [나]);
  });
});

/**
 * 🔴 **저장하는 자리가 이 판단을 실제로 쓰는가** — 소스 글자로 잰다.
 *
 * `mutations.ts` 는 `server-only` 를 거쳐 들어가 `npm test` 가 불러올 수 없고, 이 저장소에는 DB
 * 시험이 없다(`tests/part-issue-gate.test.ts` 와 같은 사정). 약한 울타리인 것은 맞지만 없는 것보다
 * 훨씬 낫다 — 아래 넷 중 하나라도 되돌리면 그 자리에서 깨진다.
 */
const linkBody = (() => {
  const source = readFileSync(new URL("../src/lib/oh/mutations.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function linkProductModel(");
  assert.notEqual(start, -1, "linkProductModel 을 찾지 못했다 — 이름이 바뀌었으면 시험도 함께 고쳐라");
  const rest = source.slice(start);
  const end = rest.indexOf("\nexport ", 1);
  return end === -1 ? rest : rest.slice(0, end);
})();

describe("🔴 저장하는 자리의 울타리 (mutations.ts 의 linkProductModel)", () => {
  test("붙잡고 있는 템플릿이 **지워진 것인지** 함께 읽는다", () => {
    assert.match(
      linkBody,
      /isDeleted:\s*ohPartTemplates\.isDeleted/,
      "이 칸을 안 읽으면 지워진 템플릿의 연결을 살아 있는 것과 똑같이 막아 막다른 길이 된다",
    );
  });

  test("판단은 시험이 붙는 순수 함수가 한다", () => {
    assert.match(linkBody, /decideProductModelLink\(/);
    assert.doesNotMatch(linkBody, /먼저 푸십시오/, "거절 문구를 여기 다시 적으면 규칙이 두 벌이 된다");
  });

  test("🔴 거둬들일 때 옛 줄을 **지운다** — DB 의 unique 가 전역이라 남겨 두면 insert 가 거절된다", () => {
    assert.match(linkBody, /\.delete\(ohPartTemplateModels\)/);
    assert.match(linkBody, /OH_TEMPLATE_MODEL_UNLINKED/, "거둬들인 줄이 감사 로그에 남아야 어디로 갔는지 답할 수 있다");
  });

  test("🔴 붙어 있는 줄을 찾을 때 **지워진 템플릿을 빼지 않는다** — 빼면 insert 가 unique 로 터진다", () => {
    const filters = linkBody.match(/eq\(ohPartTemplates\.isDeleted,\s*false\)/g) ?? [];
    assert.equal(
      filters.length,
      1,
      "그 조건은 **이으려는 템플릿이 살아 있는가**를 보는 한 군데뿐이어야 한다. 붙어 있는 줄을 찾는 질의에 더하면 지워진 줄이 안 보여 거둬들이지 못하고, 그대로 insert 하다 unique 로 터진다",
    );
  });
});
