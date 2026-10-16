import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_FIELD_KEYS,
  DEFAULT_STATE,
  applyFilter,
  applyPins,
  applySort,
  highlight,
  noteOneLine,
  notePreview,
  paginate,
  parseListState,
  serializeListState,
  tokenize,
  type ListState,
} from "../src/lib/parts/list-state";
import type { PartRow } from "../src/lib/parts/types";

function row(over: Partial<PartRow> & { no: number }): PartRow {
  return {
    id: `id-${over.no}`,
    name: `품명 ${over.no}`,
    name2: "",
    customerName: "",
    kyosanPartNo: "",
    drawingNo: "",
    supplyPrice: null,
    supplyCurrency: "JPY",
    quotePrice: null,
    limitQuantity: null,
    note: "",
    itemCode: "PCB",
    itemName: "PCB",
    category: "RFG",
    owner: "DSS",
    quantity: 0,
    ...over,
  };
}

const ROWS: PartRow[] = [
  row({ no: 1, name: "COMB-C(13M)", drawingNo: "WR10245AA350A01", quantity: 33, supplyPrice: 3600, note: "트랜스 조립형(4) , 19개 오래됨", owner: "KYOSAN" }),
  row({ no: 2, name: "VVC", name2: "CVHI-2500AW/25-ADUD", quantity: 4, supplyPrice: 1180000, itemCode: "VVC", itemName: "바리콘", category: "MB" }),
  row({ no: 3, name: "VVC", name2: "CVHI-2500AW/15-ADUD", quantity: 5, supplyPrice: null, note: "241217 공급가격 상승\n241218 견적가격 결정", itemCode: "VVC", itemName: "바리콘", category: "MB" }),
  row({ no: 4, name: "AMP-DEH-DV2H(13M)", kyosanPartNo: "C090722733", quantity: 0, supplyPrice: 54000, owner: "SERVICE_SPARE", category: "COMPATIBLE" }),
];

function state(over: Partial<ListState>): ListState {
  return { ...DEFAULT_STATE, fields: [...ALL_FIELD_KEYS], ...over };
}

describe("parseListState / serializeListState", () => {
  it("빈 주소는 기본값이고, 기본값은 빈 주소로 돌아간다", () => {
    const s = parseListState(new URLSearchParams(""));
    assert.deepEqual(s, DEFAULT_STATE);
    assert.equal(serializeListState(s).toString(), "");
  });

  it("조건을 넣으면 주소에 담기고 다시 읽힌다 (왕복)", () => {
    const s = state({ q: "vvc 2500", fields: ["a", "b"], item: "VVC", category: "MB", owner: "DSS", sort: "quantity", desc: true, page: 3, size: 20, part: 165 });
    const back = parseListState(serializeListState(s));
    assert.deepEqual(back, s);
  });

  it("이상한 값은 기본값으로 떨어진다", () => {
    const s = parseListState(new URLSearchParams("sort=hack&size=7&page=-2&f=zzz&part=abc&desc=yes"));
    assert.equal(s.sort, "no");
    assert.equal(s.size, 0);
    assert.equal(s.page, 1);
    assert.deepEqual(s.fields, [...ALL_FIELD_KEYS]);
    assert.equal(s.part, null);
    assert.equal(s.desc, false);
  });

  it("찾을 곳은 하나 이상 남는다 — f 가 비면 전부", () => {
    assert.deepEqual(parseListState(new URLSearchParams("f=")).fields, [...ALL_FIELD_KEYS]);
    assert.deepEqual(parseListState(new URLSearchParams("f=m,a")).fields, ["a", "m"]);
    // 연도별 사용 수량 (조각 5): y=2024,2025 → 최신이 앞, 이상한 값은 버림, 주소 왕복
    assert.deepEqual(parseListState(new URLSearchParams("y=2024,2025,abc,1999,2024")).years, [2025, 2024]);
    assert.equal(serializeListState({ ...DEFAULT_STATE, years: [2025, 2024] }).get("y"), "2025,2024");
    assert.equal(serializeListState(DEFAULT_STATE).has("y"), false);
    // 자주 사용하는 부품 위로 (2026-10-07): freq=1
    assert.equal(parseListState(new URLSearchParams("freq=1")).frequent, true);
    assert.equal(parseListState(new URLSearchParams("freq=yes")).frequent, false);
    assert.equal(serializeListState({ ...DEFAULT_STATE, frequent: true }).get("freq"), "1");
    assert.equal(serializeListState(DEFAULT_STATE).has("freq"), false);
  });
});

describe("tokenize / applyFilter", () => {
  it("띄어 쓰면 낱말이 모두 들어 있는 부품만 남는다 (대소문자 무시)", () => {
    assert.deepEqual(tokenize("  VVC  aw/25 "), ["vvc", "aw/25"]);
    const got = applyFilter(ROWS, state({ q: "vvc aw/25" }));
    assert.deepEqual(got.map((r) => r.no), [2]);
  });

  it("찾을 곳을 좁히면 다른 칸의 글자는 보지 않는다", () => {
    assert.deepEqual(applyFilter(ROWS, state({ q: "조립형" })).map((r) => r.no), [1]);
    assert.deepEqual(applyFilter(ROWS, state({ q: "조립형", fields: ["a"] })).map((r) => r.no), []);
  });

  it("비고는 줄바꿈 너머의 글자도 찾는다", () => {
    assert.deepEqual(applyFilter(ROWS, state({ q: "견적가격" })).map((r) => r.no), [3]);
  });

  it("항목·분류·소유로 거른다", () => {
    assert.deepEqual(applyFilter(ROWS, state({ item: "VVC" })).map((r) => r.no), [2, 3]);
    assert.deepEqual(applyFilter(ROWS, state({ category: "COMPATIBLE" })).map((r) => r.no), [4]);
    assert.deepEqual(applyFilter(ROWS, state({ owner: "KYOSAN" })).map((r) => r.no), [1]);
    assert.deepEqual(applyFilter(ROWS, state({ owner: "DSS", item: "PCB" })).map((r) => r.no), []);
  });

  it("재고 0 인 부품도 남는다", () => {
    assert.ok(applyFilter(ROWS, state({})).some((r) => r.quantity === 0));
  });
});

describe("applySort", () => {
  it("기본은 No. 오름차순", () => {
    assert.deepEqual(applySort([...ROWS].reverse(), state({})).map((r) => r.no), [1, 2, 3, 4]);
  });

  it("숫자 칸: 값이 없는 것은 오름·내림 상관없이 뒤로", () => {
    assert.deepEqual(applySort(ROWS, state({ sort: "supplyPrice" })).map((r) => r.no), [1, 4, 2, 3]);
    assert.deepEqual(applySort(ROWS, state({ sort: "supplyPrice", desc: true })).map((r) => r.no), [2, 4, 1, 3]);
  });

  it("글자 칸: 같은 값은 No. 순으로 (흔들리지 않는다)", () => {
    const asc = applySort(ROWS, state({ sort: "name" })).map((r) => r.no);
    assert.deepEqual(asc, [4, 1, 2, 3]);
    const desc = applySort(ROWS, state({ sort: "name", desc: true })).map((r) => r.no);
    assert.deepEqual(desc, [2, 3, 1, 4]);
  });
});

describe("applyPins — 즐겨찾기·자주 사용 위로 (2026-10-07)", () => {
  const rows = [1, 2, 3, 4, 5].map((no) => row({ no }));
  const fav = new Set(["id-4"]);
  const freq = new Map([
    ["id-2", 3],
    ["id-5", 7],
  ]);
  it("즐겨찾기는 항상 맨 위, 체크하면 자주 사용이 그다음(값 큰 순), 나머지는 원래 차례", () => {
    assert.deepEqual(applyPins(rows, fav, freq, DEFAULT_STATE).map((p) => p.no), [4, 1, 2, 3, 5]);
    assert.deepEqual(applyPins(rows, fav, freq, { ...DEFAULT_STATE, frequent: true }).map((p) => p.no), [4, 5, 2, 1, 3]);
  });
  it("즐겨찾기이면서 자주 사용이면 즐겨찾기 묶음에 한 번만", () => {
    assert.deepEqual(applyPins(rows, new Set(["id-2"]), freq, { ...DEFAULT_STATE, frequent: true }).map((p) => p.no), [2, 5, 1, 3, 4]);
  });
  it("기준 상태: fm·fp·ft 주소 왕복, 이상한 값은 기본값·짝수로", () => {
    const s = parseListState(new URLSearchParams("fm=q&fp=7&ft=10"));
    assert.deepEqual(s.rule, { mode: "q", months: 8, min: 10 });
    // 수량 모드는 기준이 없어 ft 를 주소에 쓰지 않는다
    assert.equal(serializeListState(s).toString(), "fm=q&fp=8");
    assert.equal(serializeListState({ ...s, rule: { ...s.rule, mode: "n" } }).toString(), "fp=8&ft=10");
    assert.deepEqual(parseListState(new URLSearchParams("fm=zz&fp=99&ft=0")).rule, { mode: "n", months: 36, min: 1 });
    assert.deepEqual(parseListState(new URLSearchParams("")).rule, { mode: "n", months: 12, min: 3 });
  });
});

describe("paginate", () => {
  it("size 0 은 전체", () => {
    const p = paginate(ROWS, state({ size: 0 }));
    assert.equal(p.rows.length, 4);
    assert.deepEqual([p.from, p.to, p.page, p.pages], [1, 4, 1, 1]);
  });

  it("쪽을 나눈다. 범위를 넘긴 page 는 마지막 쪽으로", () => {
    const p = paginate(ROWS, state({ size: 10, page: 9 }));
    assert.equal(p.page, 1);
    const q = paginate([...ROWS, ...ROWS, ...ROWS], state({ size: 10, page: 2 }));
    assert.deepEqual([q.from, q.to, q.page, q.pages, q.rows.length], [11, 12, 2, 2, 2]);
  });

  it("비어 있으면 0-0건, 1/1쪽", () => {
    const p = paginate([], state({}));
    assert.deepEqual([p.total, p.from, p.to, p.page, p.pages], [0, 0, 0, 1, 1]);
  });
});

describe("highlight / notePreview", () => {
  it("찾은 글자를 조각내고 겹치는 범위는 합친다", () => {
    const pieces = highlight("ABCABC", ["abc", "bc"]);
    assert.deepEqual(pieces, [
      { text: "ABC", hit: true },
      { text: "ABC", hit: true },
    ]);
    assert.deepEqual(highlight("hello", []), [{ text: "hello", hit: false }]);
    assert.deepEqual(highlight("", ["a"]), []);
  });

  it("비고는 한 줄로 줄이고 넘치면 자른다", () => {
    assert.equal(noteOneLine("a \n b\r\n c"), "a / b / c");
    const long = "가".repeat(50);
    assert.deepEqual(notePreview(long, []), { text: "가".repeat(30), clippedStart: false, clippedEnd: true });
  });

  it("찾는 글자가 뒤쪽에 있으면 그 둘레를 보여 준다", () => {
    const note = "앞쪽 설명이 길게 이어집니다 이어집니다 이어집니다 끝에 YAC사양 표시";
    const p = notePreview(note, ["yac"]);
    assert.ok(p.text.includes("YAC"));
    assert.equal(p.clippedStart, true);
  });
});
