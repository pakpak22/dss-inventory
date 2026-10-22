import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { stockRequests } from "../src/db/schema/stock-requests";
import type { EntryInput } from "../src/lib/stock/form";
import {
  EMPTY_REPAIR_CASE,
  REPAIR_CASE_FIELD_GROUPS,
  REPAIR_CASE_HINT,
  REPAIR_CASE_TITLE,
  isRepairCaseEmpty,
  repairCaseDate,
  repairCaseFromLookup,
  repairCaseGroups,
  repairCaseLookupNumber,
  type RepairCaseSnapshot,
} from "../src/lib/stock/repair-case";

/**
 * ============================================================================
 * 반출 신청에 **수리 건 정보**를 싣는다 (2026-10-22, 쓰는 분 요청)
 * ============================================================================
 * 「[부품요청]과 [승인요청건]에 연결된 수리건의 model · L/N · S/N · 인수일 등이 표시되도록」.
 * 방식은 쓰는 분이 정했다 — **요청이 올라올 때 받아 저장**하고, **고객사·최종사용처까지 여섯**을 보인다.
 *
 * 🔴 여기서 못 박는 것 다섯:
 *  1. **A/S 에 못 물어봐도 신청은 선다** — 이 조각에서 가장 중요한 규칙이다. 부품을 못 받는 것보다
 *     정보 몇 칸이 비는 쪽이 낫다. 실패 갈래 셋이 **전부 빈 값**이 되고, 그 바깥의 사고까지 삼킨다.
 *  2. **인수번호가 없는 신청에는 묻지도 않는다** — 404 를 받으려고 5초까지 기다릴 까닭이 없다.
 *  3. 🔴 **인수일은 글자 그대로다** — `"YYYY-MM-DD"` 가 `new Date()` 를 거치면 시간대 때문에
 *     **하루가 밀린다.** 받는 자리·저장하는 자리·그리는 자리 어디에도 Date 가 없어야 한다.
 *  4. **비면 안 그린다** — 재고 관리에서 직접 올린 신청은 **늘** 여섯이 비어 있다.
 *  5. 🔴 **「신청 당시」임을 말한다** — A/S 에서 나중에 고치면 여기 글자는 옛것이 된다.
 *     「최신입니다」로 읽히게 두지 않는다.
 *
 * 🔵 이 저장소에는 **화면 렌더 시험이 없고**, A/S 조회 통로(`src/lib/stock/intake-lookup.ts`)와 신청
 *    만들기(`src/lib/stock/requests.ts`)는 `server-only` 라 **import 조차 할 수 없다.** 그래서 규칙은
 *    순수 함수에 내려 두고 전수로 돌려 보고, 그 함수를 **어디서 어떻게 부르는지**만 소스 글자로 잰다 —
 *    `tests/request-note-screens.test.ts`·`tests/part-issue-screen.test.ts` 와 같은 처방이다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 함수 하나의 본문만 떼어 본다. 🔴 **잘라 낸 토막이 빈 글자가 아닌 것을 함께 확인한다** — 모양이 바뀌어
 * 못 찾으면 `""` 가 되고, 그러면 `!body.includes(…)` 꼴의 단언이 **전부 조용히 통과한다.**
 */
function bodyOf(source: string, head: string): string {
  const parts = source.split(head);
  assert.equal(parts.length, 2, `${head} 를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라`);
  const body = parts[1].split("\n}")[0];
  assert.ok(body.trim().length > 0, `${head} 의 본문이 비었다 — 잘라 내는 규칙이 더는 안 맞는다`);
  return body;
}

/**
 * 주석을 떼고 **코드만** 본다. 🔴 「`new Date()` 를 거치지 마라」가 **주석에 적혀 있어서**, 글자만
 * 찾으면 제 경고문에 걸려 언제나 빨갛다. 🔵 떼고 나서 빈 글자가 아닌 것을 함께 확인한다.
 */
function codeOf(source: string): string {
  const out = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(out.trim().length > 0, "주석을 떼고 나니 아무것도 안 남았다 — 떼는 규칙이 더는 안 맞는다");
  return out;
}

const FULL: RepairCaseSnapshot = {
  customerName: "가나다 주식회사",
  endUser: "라마바 사업장",
  productModel: "TG-100",
  productSerial: "SN-0001",
  productLot: "LN-0001",
  receivedAt: "2026-07-01",
};

const useInput = (over: Partial<Extract<EntryInput, { type: "USE" }>> = {}): EntryInput => ({
  type: "USE",
  occurredOn: "2026-10-22",
  intakeNumber: "D260701",
  noRepairCase: false,
  reason: "",
  purpose: "REPAIR",
  purposeText: "",
  note: "",
  lines: [],
  ...over,
});

describe("① 🔴 A/S 에 못 물어봐도 신청은 선다 (2026-10-22)", () => {
  for (const status of ["not_found", "bad_format", "unreachable"] as const) {
    it(`🔴 \`${status}\` 는 **빈 값**이다 — 거절하는 갈래가 없다`, () => {
      const got = repairCaseFromLookup({ status });
      assert.deepEqual(got, EMPTY_REPAIR_CASE);
      assert.equal(isRepairCaseEmpty(got), true);
    });
  }

  it("🔴 `unreachable` 은 **곁들이 칸이 더 실려 와도** 빈 값이다 (A/S 가 꺼져 있는 그 갈래)", () => {
    // 🔵 `lookupIntake` 의 unreachable 에는 `reason` 이 함께 온다. 모양만 적어 둔 타입이라 더 와도 버려진다.
    assert.deepEqual(repairCaseFromLookup({ status: "unreachable", reason: "timeout" } as never), EMPTY_REPAIR_CASE);
  });

  it("🔵 찾았으면 여섯을 그대로 옮겨 적는다", () => {
    assert.deepEqual(repairCaseFromLookup({ status: "found", info: FULL }), FULL);
  });

  it("🔴 **여섯 칸만** 옮긴다 — 통째로 펴면 쓸지 정한 적 없는 값이 신청 표로 흘러든다", () => {
    const got = repairCaseFromLookup({ status: "found", info: { ...FULL, intakeNumber: "D260701" } as never });
    assert.deepEqual(Object.keys(got).sort(), Object.keys(EMPTY_REPAIR_CASE).sort());
  });

  it("🔴 받아 오는 자리가 **던지지 않는다** — 그 바깥의 사고까지 삼키고 빈 값을 돌려준다", () => {
    const body = bodyOf(src("src/lib/stock/requests.ts"), "async function readRepairCaseFor(");
    assert.ok(body.includes("try {") && body.includes("} catch ("), "조회를 감싼 try 가 없다 — 통로가 터지면 반출 신청이 통째로 안 선다");
    assert.ok(!body.includes("throw"), "받아 오는 자리가 던진다 — 신청이 못 선다");
    assert.ok(body.includes("return EMPTY_REPAIR_CASE;"), "실패했을 때 빈 값으로 눕히는 줄이 없다");
  });

  it("🔴 신청 만들기가 **조회 결과로 갈라지지 않는다** — 받았든 못 받았든 같은 길로 선다", () => {
    const body = bodyOf(src("src/lib/stock/requests.ts"), "export async function createRequest(");
    assert.ok(body.includes("const repairCase = await readRepairCaseFor(input);"), "받아 오는 줄이 없다");
    assert.ok(body.includes("...repairCase,"), "받은 값을 신청에 안 싣는다");
    assert.ok(!/\brepairCase\s*(===|!==|\?|\.)/.test(body), "조회 결과를 보고 갈라진다 — 못 받아도 신청은 그대로 서야 한다");
  });

  it("🔵 **트랜잭션 밖**에서 묻는다 — 5초까지 기다릴 수 있는 호출이 DB 연결을 붙들지 않게", () => {
    const body = bodyOf(src("src/lib/stock/requests.ts"), "export async function createRequest(");
    const asked = body.indexOf("readRepairCaseFor(input)");
    const tx = body.indexOf("db().transaction(");
    assert.ok(asked > 0 && tx > 0, "자리를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(asked < tx, "조회가 트랜잭션 안으로 들어갔다");
  });

  it("🔵 **같은 열쇠로 다시 보낸 호출에는 안 묻는다** — 멱등 되돌림이 먼저다", () => {
    const body = bodyOf(src("src/lib/stock/requests.ts"), "export async function createRequest(");
    const idempotent = body.indexOf("findByExternalKey(externalKey)");
    const asked = body.indexOf("readRepairCaseFor(input)");
    assert.ok(idempotent > 0 && asked > 0, "자리를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(idempotent < asked, "끊겨서 다시 보낼 때마다 A/S 에 또 묻는다");
  });

  it("🔵 **신청이 생기는 길은 하나다** — 화면도 A/S 통로도 `createRequest` 를 부른다(그래서 받는 자리도 하나)", () => {
    assert.ok(src("src/app/actions/stock.ts").includes("await createRequest(parsed.value, actor)"), "화면에서 올리는 길이 바뀌었다");
    assert.ok(src("src/app/api/v1/stock-requests/route.ts").includes("await createRequest(buildApiUseRequest("), "A/S 통로의 길이 바뀌었다");
    // 🔴 두 길 어디에도 제 손으로 A/S 에 묻는 줄이 생기면 규칙이 두 벌이 된다.
    assert.ok(!src("src/app/api/v1/stock-requests/route.ts").includes("lookupIntake("), "통로가 제 손으로 또 묻는다 — 받아 오는 자리가 둘이 된다");
  });
});

describe("② 인수번호가 없으면 묻지 않는다 (2026-10-22)", () => {
  it("🔵 인수번호가 있는 사용 신청에만 묻는다", () => {
    assert.equal(repairCaseLookupNumber(useInput()), "D260701");
  });

  it("🔴 「수리 건 없음」을 고른 반출에는 묻지 않는다", () => {
    assert.equal(repairCaseLookupNumber(useInput({ noRepairCase: true, intakeNumber: "", reason: "재고 점검분" })), null);
  });

  it("🔴 인수번호가 비었거나 공백뿐이면 묻지 않는다", () => {
    assert.equal(repairCaseLookupNumber(useInput({ intakeNumber: "" })), null);
    assert.equal(repairCaseLookupNumber(useInput({ intakeNumber: "   " })), null);
  });

  it("🔴 사용(반출)이 아닌 신청에는 애초에 인수번호가 없다 — 묻지 않는다", () => {
    const others: EntryInput[] = [
      { type: "LOAN", occurredOn: "2026-10-22", counterparty: "협력사", note: "", lines: [] },
      { type: "DISPOSE", occurredOn: "2026-10-22", reason: "파손", note: "", lines: [] },
      { type: "RECEIVE", occurredOn: "2026-10-22", note: "", lines: [] },
      { type: "RETURN", occurredOn: "2026-10-22", note: "", lines: [] },
      { type: "ADJUST", occurredOn: "2026-10-22", reason: "실사", note: "", partId: "p", actualQuantity: 1 },
      { type: "TRANSFER", occurredOn: "2026-10-22", note: "", fromPartId: "a", toPartId: "b", quantity: 1 },
    ];
    for (const input of others) assert.equal(repairCaseLookupNumber(input), null, input.type);
  });
});

describe("③ 🔴 인수일이 하루 밀리지 않는다 — 글자로 받아 글자로 넣는다 (2026-10-22)", () => {
  it("🔴 받은 글자가 **한 글자도 안 바뀐다**", () => {
    for (const day of ["2026-01-01", "2026-07-01", "2026-12-31", "2025-02-28"]) {
      assert.equal(repairCaseDate(day), day);
      assert.equal(repairCaseFromLookup({ status: "found", info: { ...FULL, receivedAt: day } }).receivedAt, day);
    }
  });

  it("🔴 **자정이 UTC 로 읽히는 그 경로가 아예 없다** — 글자 그대로라 시간대가 끼어들 자리가 없다", () => {
    // 🔵 Date 를 거쳤다면 KST(+09:00)에서 UTC 로 가면서 **하루 전 날짜**가 나온다. 그 값과 다른 것을 잰다.
    const day = "2026-07-01";
    const shifted = new Date(`${day}T00:00:00+09:00`).toISOString().slice(0, 10);
    assert.equal(shifted, "2026-06-30", "이 PC 의 계산이 기대와 다르다 — 시험의 전제를 다시 보라");
    assert.equal(repairCaseFromLookup({ status: "found", info: { ...FULL, receivedAt: day } }).receivedAt, day);
    assert.notEqual(repairCaseFromLookup({ status: "found", info: { ...FULL, receivedAt: day } }).receivedAt, shifted);
  });

  it("🔴 **받는 자리·그리는 자리 어디에도 Date 가 없다**", () => {
    const pure = codeOf(src("src/lib/stock/repair-case.ts"));
    for (const bad of ["new Date(", "toISOString", "Date.parse", "toLocaleDateString"]) {
      assert.ok(!pure.includes(bad), `순수 함수 쪽에 ${bad} 가 생겼다 — 인수일이 하루 밀린다`);
    }
    const view = codeOf(src("src/components/stock/RepairCaseInfo.tsx"));
    for (const bad of ["new Date(", "toISOString", "Intl.DateTimeFormat"]) {
      assert.ok(!view.includes(bad), `그리는 자리에 ${bad} 가 생겼다 — 인수일이 하루 밀린다`);
    }
  });

  it("🔴 **저장하는 자리도 글자 그대로** — `toRow` 가 그 칸만 Date 를 안 거친다", () => {
    const body = bodyOf(src("src/lib/stock/requests.ts"), "    repairCase: {");
    assert.ok(body.includes("receivedAt: r.receivedAt,"), "인수일을 그대로 싣는 줄이 없다");
    assert.ok(!body.includes("Date"), "수리 건 여섯 칸을 옮기는 자리에 Date 가 섞였다");
  });

  it("🔴 표의 칸이 **글자(text)** 다 — `date`·`timestamp` 로 바꾸면 모양을 PostgreSQL 이 정하게 된다", () => {
    const table = getTableConfig(stockRequests);
    const col = table.columns.find((c) => c.name === "received_at");
    assert.ok(col, "received_at 칸이 없다");
    assert.equal(col.getSQLType(), "text");
    assert.equal(col.notNull, true);
    assert.equal(col.default, "", "기본값이 빈 글자가 아니면 「모름」이 세 가지가 된다(없음·null·빈 글자)");
  });
});

describe("④ 🔴 받은 것을 믿지 않는다 — 모양이 깨진 응답 (2026-10-22)", () => {
  it("🔴 모양이 다른 글자는 **떨어뜨린다**(고쳐 주지 않는다)", () => {
    for (const bad of ["2026-7-1", "2026/07/01", "20260701", "2026-07-01T00:00:00Z", "2026-07-01 ", " 2026-07-01", "", "오늘"]) {
      assert.equal(repairCaseDate(bad), "", JSON.stringify(bad));
    }
  });

  it("🔴 글자가 아니면 `String(v)` 로 **만들어 주지 않는다** — 「Tue Jul 01 2026 …」 이 조용히 저장된다", () => {
    for (const bad of [null, undefined, 20260701, new Date("2026-07-01"), { value: "2026-07-01" }, ["2026-07-01"], true]) {
      assert.equal(repairCaseDate(bad), "", JSON.stringify(bad ?? null));
    }
  });

  it("🔵 떨어뜨려도 **나머지 다섯은 그대로**다 — 칸 하나가 신청을 막지 않는다", () => {
    const got = repairCaseFromLookup({ status: "found", info: { ...FULL, receivedAt: repairCaseDate(20260701) } });
    assert.equal(got.receivedAt, "");
    assert.equal(got.productModel, "TG-100");
    assert.equal(isRepairCaseEmpty(got), false, "인수일만 비었다고 통째로 안 그리면 안 된다");
  });

  it("🔵 A/S 통로가 이 규칙을 **제 손으로 다시 적지 않는다**", () => {
    const lookup = src("src/lib/stock/intake-lookup.ts");
    assert.ok(lookup.includes("receivedAt: repairCaseDate("), "통로가 인수일을 순수 함수로 안 거른다");
    assert.ok(!lookup.includes("receivedAt: str("), "인수일을 다른 다섯과 같은 자로 다듬고 있다 — 글자가 아닌 값이 String(v) 로 만들어진다");
  });
});

describe("⑤ 🔴 「신청 당시」라고 말한다 — 「최신입니다」로 읽히면 안 된다 (2026-10-22)", () => {
  it("🔴 눈에 보이는 이름표에 **「신청 당시」**가 있다", () => {
    assert.ok(REPAIR_CASE_TITLE.includes("신청 당시"), "이름표가 때를 안 말한다 — 사람은 당연히 지금 값으로 읽는다");
  });

  it("🔴 설명이 **그 뒤에 바뀔 수 있다**는 사실까지 말한다", () => {
    for (const word of ["그때", "A/S", "바뀌지 않습니다"]) {
      assert.ok(REPAIR_CASE_HINT.includes(word), `설명에 「${word}」 가 없다 — 「신청 당시」 네 글자만으로는 옛값이 될 수 있다는 말이 안 전해진다`);
    }
  });

  it("🔴 그리는 조각이 **둘 다** 쓴다 — 이름표만 있고 설명이 없으면 손을 올려도 아무 말이 없다", () => {
    const view = src("src/components/stock/RepairCaseInfo.tsx");
    assert.ok(view.includes("{REPAIR_CASE_TITLE}"), "이름표를 안 그린다");
    assert.ok(view.includes("title={REPAIR_CASE_HINT}"), "설명을 안 단다");
  });
});

describe("⑥ 여섯 값을 어떻게 묶어 보이나 · 비면 안 그린다 (2026-10-22)", () => {
  it("🔴 **여섯이 빠짐없이** 묶음에 들어 있다 — 칸이 늘면 여기서 깨진다", () => {
    const keys = REPAIR_CASE_FIELD_GROUPS.flat().map((f) => f.key);
    assert.deepEqual([...keys].sort(), Object.keys(EMPTY_REPAIR_CASE).sort());
    assert.equal(new Set(keys).size, keys.length, "같은 칸이 두 묶음에 들어 있다");
  });

  it("🔴 차례는 쓰는 분이 적어 준 그대로 — 기종 · L/N · S/N / 인수일 · 고객사 · End-User", () => {
    assert.deepEqual(
      REPAIR_CASE_FIELD_GROUPS.map((g) => g.map((f) => f.key)),
      [
        ["productModel", "productLot", "productSerial"],
        ["receivedAt", "customerName", "endUser"],
      ],
    );
  });

  it("🔵 낱말은 이 저장소가 이미 쓰는 것 — 기록 화면의 인수번호 [확인] 상자와 같다", () => {
    const labels = REPAIR_CASE_FIELD_GROUPS.flat().map((f) => f.label);
    assert.deepEqual(labels, ["기종", "L/N", "S/N", "인수일", "고객사", "End-User"]);
    const form = src("src/components/stock/EntryForm.tsx");
    for (const word of ["고객사", "End-User", "기종", "S/N · L/N"]) {
      assert.ok(form.includes(word), `기록 화면이 「${word}」 를 더는 안 쓴다 — 두 화면이 같은 값을 다른 말로 부르게 된다`);
    }
  });

  it("🔴 **값이 있는 칸만** 그리고, 빈 묶음은 아예 없다", () => {
    const only = { ...EMPTY_REPAIR_CASE, productModel: "TG-100", customerName: "가나다 주식회사" };
    assert.deepEqual(repairCaseGroups(only), [
      [{ key: "productModel", label: "기종", value: "TG-100" }],
      [{ key: "customerName", label: "고객사", value: "가나다 주식회사" }],
    ]);
  });

  it("🔴 **여섯이 다 비면 아무것도 안 그린다** — 재고 관리에서 직접 올린 신청이 늘 그렇다", () => {
    assert.deepEqual(repairCaseGroups(EMPTY_REPAIR_CASE), []);
    assert.equal(isRepairCaseEmpty(EMPTY_REPAIR_CASE), true);
    assert.equal(isRepairCaseEmpty({ ...EMPTY_REPAIR_CASE, receivedAt: "   " }), true, "공백뿐인 값도 없는 것이다");
    const view = src("src/components/stock/RepairCaseInfo.tsx");
    assert.ok(view.includes("if (groups.length === 0) return null;"), "비었을 때 빠져나오는 울타리가 없다");
    assert.ok(!/(\?\?|\|\|)\s*["“]-/.test(view), "비었을 때 「-」 를 지어낸다");
  });

  it("🔵 한 묶음이 다 비면 **그 줄만** 사라진다 — 나머지는 그대로 선다", () => {
    const productOnly = { ...EMPTY_REPAIR_CASE, productModel: "TG-100", productSerial: "SN-0001" };
    assert.equal(repairCaseGroups(productOnly).length, 1);
    const caseOnly = { ...EMPTY_REPAIR_CASE, receivedAt: "2026-07-01" };
    assert.deepEqual(repairCaseGroups(caseOnly), [[{ key: "receivedAt", label: "인수일", value: "2026-07-01" }]]);
  });
});

describe("⑦ 두 화면이 같은 조각으로 같은 값을 그린다 (2026-10-22)", () => {
  const manager = src("src/components/stock/RequestManagerScreen.tsx");
  const approvals = src("src/components/stock/IssueApprovalScreen.tsx");

  it("🔴 **모양을 두 곳에 베껴 적지 않는다** — 둘 다 `RepairCaseInfo` 하나를 쓴다", () => {
    for (const [name, screen] of [
      ["부품 요청 관리", manager],
      ["승인 요청건", approvals],
    ] as const) {
      assert.ok(screen.includes('import { RepairCaseInfo } from "./RepairCaseInfo";'), `${name} 가 공용 조각을 안 쓴다`);
      assert.ok(!screen.includes("REPAIR_CASE_FIELD_GROUPS"), `${name} 가 무엇을 보일지 제 손으로 또 정한다`);
    }
  });

  it("🔴 [부품 요청] — **인수번호 바로 밑, 요청 비고 위**", () => {
    assert.ok(manager.includes("<RepairCaseInfo repairCase={r.repairCase} />"), "목록이 수리 건을 안 그린다");
    const about = manager.indexOf('{aboutOf(r) || <span className="text-zinc-400">-</span>}');
    const repair = manager.indexOf("<RepairCaseInfo repairCase={r.repairCase} />");
    const note = manager.indexOf("<RequestNote note={r.note} />");
    assert.ok(about > 0 && repair > 0 && note > 0, "자리를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(about < repair, "인수번호보다 위에 섰다 — 그 번호를 푸는 값이라 밑이어야 한다");
    assert.ok(repair < note, "요청 비고 아래로 내려갔다 — 사실 둘 사이에 사람의 말이 끼면 안 된다");
  });

  it("🔴 [승인요청건] — **머리말 아래, 「신청 사유」·「요청 비고」 쌍보다 위**", () => {
    assert.ok(approvals.includes("{card.request ? <RepairCaseInfo repairCase={card.request.repairCase} /> : null}"), "카드가 수리 건을 안 그린다");
    const repair = approvals.indexOf("<RepairCaseInfo repairCase={card.request.repairCase} />");
    const reason = approvals.indexOf("신청 사유: “{card.reason}”");
    const note = approvals.indexOf("{card.requestNote ? (");
    assert.ok(repair > 0 && reason > 0 && note > 0, "자리를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(repair < reason && repair < note, "사람의 말 둘보다 아래로 내려갔다");
    assert.ok(reason < note, "「신청 사유」와 「요청 비고」 사이에 다른 상자가 끼었다 — 둘은 나란히 세우기로 한 한 쌍이다");
  });

  it("🔵 신청을 못 찾은 카드에는 **함께** 사라진다 — 어디서 온 값인지 알 수 없게 두지 않는다", () => {
    assert.ok(approvals.includes("{card.request ? <RepairCaseInfo"), "신청을 못 찾아도 수리 건만 떠 있다");
  });

  it("🔵 값은 **서버가 실어 보낸 것**이다 — 화면이 A/S 에 다시 묻지 않는다", () => {
    for (const screen of [manager, approvals]) {
      assert.ok(!screen.includes("lookupIntake"), "화면이 A/S 를 부른다 — 「요청이 올라올 때 받아 저장」이 깨진다");
      assert.ok(!screen.includes("fetch("), "화면이 제 손으로 값을 가지러 간다");
    }
  });
});

describe("⑧ 표의 칸 — 묶음(jsonb)이 아니라 칸으로, `payload` 밖에 (2026-10-22)", () => {
  const table = getTableConfig(stockRequests);
  const columnOf = (name: string) => table.columns.find((c) => c.name === name);

  it("🔴 여섯이 **제 칸**으로 서 있다 — 원장(`stock_entries`)과 같은 이름·같은 모양", () => {
    for (const name of ["customer_name", "end_user", "product_model", "product_serial", "product_lot", "received_at"]) {
      const col = columnOf(name);
      assert.ok(col, `${name} 칸이 없다`);
      assert.equal(col.getSQLType(), "text", name);
      assert.equal(col.notNull, true, name);
      assert.equal(col.default, "", `${name} 의 기본값이 빈 글자가 아니다 — 옛 신청이 「모름」으로 안 읽힌다`);
    }
  });

  it("🔴 `payload` 는 그대로다 — 그 칸은 「확인 때 원장에 쓰는 값」이고 수리 건은 거기 쓰이지 않는다", () => {
    const payload = columnOf("payload");
    assert.ok(payload, "payload 칸이 없다");
    assert.equal(payload.getSQLType(), "jsonb");
    assert.equal(payload.notNull, true);
  });

  it("🔵 묶음 칸을 새로 만들지 않았다 — 같은 값이 두 모양으로 눕지 않게", () => {
    const jsonbs = table.columns.filter((c) => c.getSQLType() === "jsonb").map((c) => c.name);
    assert.deepEqual(jsonbs, ["payload"], "jsonb 칸이 늘었다 — 수리 건을 묶음으로 둔 것이 아닌지 보라");
  });
});
