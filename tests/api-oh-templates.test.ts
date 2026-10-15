import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  MODEL_ID_PARAM,
  buildOhTemplateResponse,
  parseOhTemplateQuery,
  toApiOhTemplate,
  type OhTemplateSource,
} from "../src/lib/api/oh-templates";
import { checkBearerToken } from "../src/lib/api/token-gate";
import { env } from "../src/lib/env";

/**
 * A/S 가 **「이 장비의 O/H 템플릿 부품 목록」을 읽어 가는 통로**의 울타리
 * (2026-10-15, `GET /api/v1/oh-templates`).
 *
 * 🔴 규칙을 전부 순수 함수에 모아 두고 여기서 덮는다 — 통로 파일도 읽는 질의도 `server-only` 를 거쳐
 *    들어가 `npm test` 가 **불러올 수 없다**(`tests/api-stock-request-status.test.ts` 머리말).
 * 🔴 그래서 **DB 에서만 가려지는 두 울타리는 소스 글자로 잰다**(아래 ⑤). 약한 울타리인 것은 맞지만,
 *    없는 것보다 훨씬 낫다 — 그 조건을 떼는 순간 시험이 그 자리에서 깨진다
 *    (`tests/part-issue-gate.test.ts` 가 같은 판단을 한다).
 */

const MODEL_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const LINKED = { displayOrder: 1, partNameText: "증폭기 PCB", quantity: 2, partNo: 165, partName: "AMP-DEH-DV2H(13M)" };
/** 🔴 **재고 마스터에 없는 줄.** 양식에서 옮겨 온 이름이 그대로 남아 있는 자리다(스키마 머리말). */
const UNLINKED = { displayOrder: 2, partNameText: "유량계", quantity: 1, partNo: null, partName: null };

const SOURCE: OhTemplateSource = {
  id: "0c0f1111-1111-4111-8111-111111111111",
  name: "RFG 15kW O/H",
  note: null,
  items: [LINKED, UNLINKED],
};

const source = (over: Partial<OhTemplateSource> = {}): OhTemplateSource => ({ ...SOURCE, ...over });

const query = (qs: string): string => {
  const r = parseOhTemplateQuery(new URLSearchParams(qs));
  assert.ok(r.ok, `받을 줄 알았는데 거절했다: ${r.ok ? "" : r.message}`);
  return r.modelId;
};

const rejection = (qs: string): string => {
  const r = parseOhTemplateQuery(new URLSearchParams(qs));
  assert.equal(r.ok, false, "거절할 조건인데 통과했다");
  return r.ok ? "" : r.message;
};

/* ------------------------------------------------------------------ */

describe("① 묻는 법 — 열쇠는 A/S 의 제품 모델 id (2026-10-15)", () => {
  it("칸 이름이 modelId 다 — 이름을 넣으면 안 되는 자리임을 이름이 말한다", () => {
    assert.equal(MODEL_ID_PARAM, "modelId");
    assert.equal(query(`modelId=${MODEL_ID}`), MODEL_ID);
  });

  it("앞뒤 공백은 뗀다", () => {
    assert.equal(query(`modelId=++${MODEL_ID}++`), MODEL_ID);
  });

  it("🔴 열쇠가 없으면 **템플릿 전부를 주지 않고** 거절한다 (쓰는 법을 문구에 적어 준다)", () => {
    assert.match(rejection(""), /modelId/);
    assert.match(rejection("modelId=++"), /product_models\.id/);
    assert.match(rejection("model=" + MODEL_ID), /\?modelId=/, "이름을 틀리게 보냈을 때 올바른 꼴이 문구에 보여야 한다");
  });

  it("🔴 **모델 이름으로는 찾지 않는다** — 이름은 바뀌고, 우리 쪽 이름은 이을 때 떠 온 사본일 뿐이다", () => {
    const m = rejection("modelId=RFG-15");
    assert.match(m, /이름/);
    assert.match(m, /uuid/i);
  });

  it("🔴 id 꼴이 아니면 400 이다 — DB 의 uuid 칸에 그대로 보내면 400 이어야 할 일이 500 으로 터진다", () => {
    for (const bad of ["1", "0c0f1111-1111-4111-8111", `${MODEL_ID}; drop table parts`, "null", "undefined"]) {
      const r = parseOhTemplateQuery(new URLSearchParams(`modelId=${encodeURIComponent(bad)}`));
      assert.equal(r.ok, false, `통과하면 안 되는 값: ${bad}`);
    }
  });
});

describe("② 이어진 템플릿을 준다 (2026-10-15)", () => {
  it("칸은 이것뿐이다 — 약속이라 이름을 바꾸거나 빼지 않는다", () => {
    assert.deepEqual(Object.keys(toApiOhTemplate(source())).sort(), ["id", "items", "name", "note"].sort());
    assert.deepEqual(Object.keys(toApiOhTemplate(source()).items[0]).sort(), ["displayOrder", "linked", "name", "no", "partName", "quantity"].sort());
  });

  it("🔴 줄마다 **부품 번호(No.) · 품명 · 수량**", () => {
    assert.deepEqual(toApiOhTemplate(source({ items: [LINKED] })).items, [
      { displayOrder: 1, no: 165, name: "증폭기 PCB", partName: "AMP-DEH-DV2H(13M)", quantity: 2, linked: true },
    ]);
  });

  it("템플릿을 가리키는 글자는 이름 하나다 (기종 코드는 2026-10-15 에 없앴다)", () => {
    assert.equal(toApiOhTemplate(source()).name, "RFG 15kW O/H");
  });

  it("비고가 없으면 \"\" 다 — 부품 목록 통로의 글자 칸과 같은 관례", () => {
    assert.equal(toApiOhTemplate(source()).note, "");
    assert.equal(toApiOhTemplate(source({ note: "2026 개정분" })).note, "2026 개정분");
  });

  it("차례(displayOrder)가 그대로 실린다 — 양식의 부품 순서 자체가 뜻을 갖는다", () => {
    assert.deepEqual(
      toApiOhTemplate(source()).items.map((i) => i.displayOrder),
      [1, 2],
    );
  });

  it("물어본 모델 id 와 보낸 시각이 함께 온다", () => {
    const r = buildOhTemplateResponse(MODEL_ID, source(), "2026-10-15T05:00:00.000Z");
    assert.equal(r.modelId, MODEL_ID);
    assert.equal(r.generatedAt, "2026-10-15T05:00:00.000Z");
    assert.deepEqual(Object.keys(r).sort(), ["generatedAt", "modelId", "template"].sort());
  });

  /**
   * 🔴 **O/H 단가는 내보내지 않는다** — A/S 화면이 쓰는 것은 「무엇을 몇 개」이고, 단가는 견적 쪽 값이다
   *    (「행이 없다 = 정하지 않음」과 「0 = 무상」을 가려야 하는 값이라 더 그렇다).
   */
  it("🔴 단가 비슷한 칸이 한 개도 없다 — 칸이 늘어도 값이 새지 않게 통째로 센다", () => {
    const body = JSON.stringify(buildOhTemplateResponse(MODEL_ID, source(), "2026-10-15T05:00:00.000Z"));
    for (const word of ["ohPrice", "unitPrice", "price", "단가"]) {
      assert.equal(body.includes(word), false, `응답에 ${word} 가 들어 있다`);
    }
  });
});

/**
 * 🔴 **재고 마스터에 안 이어진 줄을 감추지 않는다.**
 *    빼고 보내면 A/S 는 받은 줄만 보고 「다 담겼다」고 믿는다 — 정작 필요한 부품을 빠뜨린 채 요청이 나간다.
 *    A/S 화면이 지금 그 사실을 사람에게 알려 주고 있다(`PartRequestSection.tsx`:
 *    「재고에 없어 담지 못함(직접 찾아 담아 주세요): …」). 우리가 감추면 그 말을 못 한다.
 */
describe("③ 🔴 안 이어진 줄 — 감추지 않고 그 사실과 함께 보낸다 (2026-10-15)", () => {
  it("🔴 줄 수가 줄지 않는다 — 안 이어진 줄도 그대로 온다", () => {
    assert.equal(toApiOhTemplate(source()).items.length, 2);
  });

  it("🔴 안 이어진 줄은 `linked: false` 이고 번호는 null 이다 — 지어내지 않는다", () => {
    const [, unlinked] = toApiOhTemplate(source()).items;
    assert.equal(unlinked.linked, false);
    assert.equal(unlinked.no, null);
    assert.equal(unlinked.partName, null);
  });

  it("🔴 그래도 **이름은 온다** — 사람에게 「이것을 직접 찾아 담으라」고 말할 값이 그것뿐이다", () => {
    assert.equal(toApiOhTemplate(source()).items[1].name, "유량계");
  });

  it("🔵 `linked` 와 `no` 는 언제나 같은 말을 한다 — 한 자리에서 만들기 때문이다", () => {
    for (const items of [[LINKED], [UNLINKED], [LINKED, UNLINKED], []]) {
      for (const item of toApiOhTemplate(source({ items })).items) {
        assert.equal(item.linked, item.no !== null, `linked 와 no 가 어긋났다: ${JSON.stringify(item)}`);
      }
    }
  });

  it("이어진 줄의 이름 둘은 다를 수 있다 — 이은 뒤 재고 쪽에서 품명을 고친 경우", () => {
    const item = toApiOhTemplate(source({ items: [{ ...LINKED, partName: "AMP-DEH-DV2H(13M) 개정" }] })).items[0];
    assert.equal(item.name, "증폭기 PCB", "템플릿에 적힌 이름이 바뀌면 안 된다");
    assert.equal(item.partName, "AMP-DEH-DV2H(13M) 개정");
  });
});

describe("④ 🔴 없는 모델이면 「없다」가 분명하다 (2026-10-15)", () => {
  it("이어진 템플릿이 없으면 `template: null` 이다 — 오류가 아니다", () => {
    const r = buildOhTemplateResponse(MODEL_ID, null, "2026-10-15T05:00:00.000Z");
    assert.equal(r.template, null);
    assert.equal(r.modelId, MODEL_ID, "물어본 모델 id 는 그대로 돌아온다");
  });

  it("🔴 「없다」와 「줄이 0개인 템플릿」이 다른 모양이다 — 둘을 같게 만들면 A/S 가 가릴 수 없다", () => {
    const none = buildOhTemplateResponse(MODEL_ID, null, "x");
    const empty = buildOhTemplateResponse(MODEL_ID, source({ items: [] }), "x");
    assert.equal(none.template, null);
    assert.notEqual(empty.template, null);
    assert.deepEqual(empty.template?.items, []);
  });
});

/**
 * ⑤ 🔴 **DB 에서만 가려지는 울타리 — 소스 글자로 잰다.**
 *    `src/lib/oh/queries.ts` 는 `server-only` 라 여기서 불러올 수 없고, 이 저장소에는 DB 시험이 없다.
 *    그런데 아래 셋은 **빠지면 조용히 틀린 값이 나간다**(지운 템플릿이 나가고 · 숨긴 부품이 번호를 달고
 *    나가 A/S 의 반출 신청이 통째로 400 이 되고 · 단가가 새어 나간다). 글자로라도 못 박는다.
 */
describe("⑤ 🔴 지워진 것은 안 온다 · 단가 표는 열지 않는다 — 소스로 잰다 (2026-10-15)", () => {
  const queries = readFileSync(new URL("../src/lib/oh/queries.ts", import.meta.url), "utf8");

  /** `findOhTemplateByProductModel` 의 **본문만** 잘라 낸다 — 다른 함수의 글자가 섞이면 잘못 센다. */
  const body = (() => {
    const start = queries.indexOf("export async function findOhTemplateByProductModel");
    assert.notEqual(start, -1, "findOhTemplateByProductModel 을 찾지 못했다 — 이름이 바뀌었으면 시험도 함께 고쳐라");
    const rest = queries.slice(start);
    const end = rest.indexOf("\nexport ");
    return end === -1 ? rest : rest.slice(0, end);
  })();

  it("🔴 지워진(숨긴) 템플릿은 뺀다", () => {
    assert.match(body, /eq\(ohPartTemplates\.isDeleted,\s*false\)/, "템플릿의 소프트 삭제 거르기가 사라졌다");
  });

  it("🔴 숨긴 부품은 **이어 읽는 조건**에서 걸러 「안 이어진 줄」이 된다 — 번호를 달고 나가면 A/S 의 신청이 통째로 400 이다", () => {
    assert.match(
      body,
      /leftJoin\(\s*parts,\s*and\(eq\(parts\.id,\s*ohPartTemplateItems\.partId\),\s*eq\(parts\.isDeleted,\s*false\)\)\s*\)/,
      "숨긴 부품 거르기가 join 조건에서 사라졌다",
    );
  });

  /**
   * 🔵 **역검증에서 찾은 빈틈(2026-10-15)**: 이 자리를 처음에 `/\.where\([^)]*parts\.isDeleted/` 로 쟀더니,
   *    거르기를 `.where(and(eq(…, head.id), eq(parts.isDeleted, false)))` 로 옮긴 변형을 **놓쳤다** —
   *    `[^)]*` 가 안쪽 괄호를 못 넘는다. 글자 맞히기 대신 **어디에 있는가**로 잰다.
   */
  it("🔴 숨긴 부품 거르기를 `where` 로 옮기면 그 줄이 통째로 사라진다 — 그 자리가 아니다", () => {
    assert.equal(body.split("parts.isDeleted").length - 1, 1, "부품의 소프트 삭제 거르기는 한 자리(leftJoin)에만 있어야 한다");
    const itemsQuery = body.indexOf(".from(ohPartTemplateItems)");
    assert.notEqual(itemsQuery, -1, "줄을 읽는 질의를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    const whereAt = body.indexOf(".where(", itemsQuery);
    assert.notEqual(whereAt, -1, "줄을 읽는 질의의 where 를 찾지 못했다");
    assert.equal(body.slice(whereAt).includes("parts.isDeleted"), false, "부품의 소프트 삭제 거르기가 where 로 옮겨졌다 — 줄이 감춰진다");
  });

  it("🔴 O/H 단가 표를 **아예 열지 않는다** — 읽어 놓고 모양에서 빼면 다음 사람이 칸을 더할 때 샌다", () => {
    assert.equal(body.includes("partOverhaulUnitPrices"), false, "단가 표를 읽고 있다");
    assert.equal(body.includes("ohPrice"), false, "단가를 싣고 있다");
  });

  it("🔴 모델 하나는 템플릿 하나 — 그래서 한 줄만 읽는다", () => {
    assert.match(body, /\.limit\(1\)/);
  });
});

/**
 * ⑥ 🔴 **읽기 토큰 전용.** 이 통로는 재고를 한 개도 움직이지 않는다 — 부품 목록과 같은 문이다.
 *    쓰기 토큰은 신청을 **만드는** 자리에만 쓴다. 두 값이 다르므로 서로의 문을 열지 못한다.
 */
describe("⑥ 🔴 읽기 토큰 전용 — 쓰기 토큰으로는 못 읽고, 토큰이 없으면 닫힌다 (2026-10-15)", () => {
  const READ = "read-".padEnd(40, "r");
  const WRITE = "write-".padEnd(44, "w");

  const withEnv = (vars: Record<string, string | undefined>, run: () => void) => {
    const saved = { INVENTORY_API_TOKEN: process.env.INVENTORY_API_TOKEN, INVENTORY_WRITE_TOKEN: process.env.INVENTORY_WRITE_TOKEN };
    try {
      for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      run();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it("🔴 읽기 토큰이 설정에 없으면 열어 두지 않고 닫는다 (503)", () => {
    withEnv({ INVENTORY_API_TOKEN: undefined }, () => {
      const d = checkBearerToken(env.inventoryApiToken, `Bearer ${READ}`);
      assert.ok(d);
      assert.equal(d.status, 503);
      assert.equal(d.error, "api_closed");
    });
  });

  it("🔴 쓰기 토큰으로 이 통로를 두드리면 401 — 두 값이 다른 환경변수에서 온다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.notEqual(env.inventoryApiToken, env.inventoryWriteToken);
      const d = checkBearerToken(env.inventoryApiToken, `Bearer ${WRITE}`);
      assert.ok(d, "쓰기 토큰이 읽기 통로를 지나갔다");
      assert.equal(d.status, 401);
      assert.equal(d.error, "unauthorized");
    });
  });

  it("맞는 읽기 토큰은 지나간다 — 부품 목록과 같은 문이다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.equal(checkBearerToken(env.inventoryApiToken, `Bearer ${READ}`), null);
    });
  });

  it("머리말이 없거나 모양이 다르면 401", () => {
    for (const header of [null, "", "Basic abc", "Bearer ", `Token ${READ}`]) {
      const d = checkBearerToken(READ, header);
      assert.ok(d, `통과하면 안 되는 머리말: ${JSON.stringify(header)}`);
      assert.equal(d.status, 401);
    }
  });

  it("🔴 통로 파일이 **읽기** 문지기를 쓴다 — 쓰기 문지기를 달면 A/S 가 못 읽는다", () => {
    const route = readFileSync(new URL("../src/app/api/v1/oh-templates/route.ts", import.meta.url), "utf8");
    assert.match(route, /const denied = checkApiToken\(request\);/, "읽기 문지기가 사라졌다");
    assert.equal(route.includes("checkApiWriteToken"), false, "읽기 통로에 쓰기 문지기가 달렸다");
    assert.match(route, /if \(denied\) return denied;/, "문지기의 판정을 쓰지 않는다");
  });
});
