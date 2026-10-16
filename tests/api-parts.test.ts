import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { partOverhaulUnitPrices } from "../src/db/schema/oh-templates";
import { matchesQuery, parseApiPartsFilter, toApiPart, type ApiPartSource } from "../src/lib/api/parts";
import { API_PART_COLUMNS, API_PART_OVERHAUL_PRICE_JOIN } from "../src/lib/api/parts-query";

const SRC: ApiPartSource = {
  no: 165,
  name: "AMP-DEH-DV2H(13M)",
  name2: "",
  customerName: "증폭기 조립품",
  kyosanPartNo: "C090722733",
  drawingNo: "WR10136AA148B",
  quantity: 273,
  supplyPrice: 54000,
  supplyCurrency: "JPY",
  quotePrice: 990000,
  overhaulQuotePrice: 125000,
  note: "2024.04.07 재고 100EA시 주문 필요",
  itemCode: "PCB",
  itemName: "PCB",
  category: "RFG",
  owner: "SERVICE_SPARE",
  updatedAt: new Date("2026-10-06T03:00:00Z"),
};

describe("API 부품 모양", () => {
  it("현황판 12칸 + 고객사 품명 + 코드와 한글을 함께, UUID 는 없다", () => {
    const p = toApiPart(SRC);
    assert.deepEqual(Object.keys(p).sort(), ["category", "customerName", "drawingNo", "item", "kyosanPartNo", "name", "name2", "no", "note", "overhaulQuotePrice", "owner", "quantity", "quotePrice", "supplyCurrency", "supplyPrice", "updatedAt"].sort());
    assert.equal(p.customerName, "증폭기 조립품");
    assert.deepEqual(p.owner, { code: "SERVICE_SPARE", label: "보수부재" });
    assert.deepEqual(p.category, { code: "RFG", label: "RFG" });
    assert.deepEqual(p.item, { code: "PCB", name: "PCB" });
    assert.equal(p.updatedAt, "2026-10-06T03:00:00.000Z");
    assert.ok(!("id" in p));
  });

  it("없는 값: 글자는 빈 문자열, 금액은 null (엑셀의 '-' 를 쓰지 않는다)", () => {
    const p = toApiPart({ ...SRC, name2: "", customerName: "", supplyPrice: null });
    assert.equal(p.name2, "");
    assert.equal(p.customerName, "");
    assert.equal(p.supplyPrice, null);
  });
});

describe("API 목록 조건", () => {
  it("아는 값만 받고, 모르는 값은 400 으로 돌려줄 오류를 낸다", () => {
    const ok = parseApiPartsFilter(new URLSearchParams("owner=DSS&category=MB&item=PCB&q=vvc&since=2026-10-01T00:00:00Z"));
    assert.ok(ok.ok);
    assert.equal(ok.filter.owner, "DSS");
    assert.equal(ok.filter.category, "MB");
    assert.equal(ok.filter.item, "PCB");
    assert.equal(ok.filter.q, "vvc");
    assert.equal(ok.filter.since?.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.ok(!parseApiPartsFilter(new URLSearchParams("owner=교산")).ok);
    assert.ok(!parseApiPartsFilter(new URLSearchParams("category=호환")).ok);
    assert.ok(!parseApiPartsFilter(new URLSearchParams("since=어제")).ok);
    assert.ok(!parseApiPartsFilter(new URLSearchParams("item=pcb")).ok);
  });

  it("빈 조건은 전체", () => {
    const r = parseApiPartsFilter(new URLSearchParams(""));
    assert.ok(r.ok);
    assert.deepEqual(r.filter, { owner: null, category: null, item: null, q: "", since: null });
  });

  it("찾기는 낱말이 모두 들어 있어야 하고 대소문자를 가리지 않는다", () => {
    assert.equal(matchesQuery(SRC, "amp 13m"), true);
    assert.equal(matchesQuery(SRC, "amp vvc"), false);
    assert.equal(matchesQuery(SRC, "c0907"), true);
    assert.equal(matchesQuery(SRC, ""), true);
  });

  it("찾기는 고객사 품명으로도 된다 (우리 품명에 없는 낱말)", () => {
    assert.equal(matchesQuery(SRC, "증폭기"), true);
    assert.equal(matchesQuery(SRC, "amp 조립품"), true);
    assert.equal(matchesQuery({ ...SRC, customerName: "" }, "증폭기"), false);
  });
});

/**
 * ============================================================================
 * O/H 단가 칸 (`overhaulQuotePrice`, 2026-10-16)
 * ============================================================================
 * A/S 의 **공용 부품 고르개**는 부품을 고르는 순간 단가를 자동으로 붓는다. 오버홀 건이면
 * O/H 단가를, 아니면 일반 단가를 붓는다. 그 고르개가 재고 관리 쪽으로 넘어오는데 O/H 단가만
 * 통로에 없었다 — 이 칸이 그것이다.
 *
 * 🔴 이 시험들이 지키는 것은 **한 가지 혼동**이다: 「O/H 단가를 정하지 않았다(`null`)」와
 *    「O/H 때는 무상이다(`0`)」는 다른 말이다. 둘을 섞으면 되돌릴 수 없다.
 *      · `null` 을 0 으로 보내면 → 고르개가 **0원을 부어** 정하지 않은 부품을 0원으로 청구한다.
 *      · `0` 을 null 로 보내면 → 무상으로 정해 둔 부품이 「안 정해짐」이 되어 사람이 다시 채운다.
 *    그래서 `?? 0`(앞) 도 `|| null`(뒤) 도 끼우면 안 되고, 아래 셋이 그 자리를 각각 밟는다.
 * ============================================================================
 */
describe("API 부품의 O/H 단가", () => {
  it("정한 부품은 값이 그대로 실린다", () => {
    assert.equal(toApiPart(SRC).overhaulQuotePrice, 125000);
  });

  it("🔴 안 정한 부품은 null 이다 — **0 이 아니다**", () => {
    const p = toApiPart({ ...SRC, overhaulQuotePrice: null });
    assert.ok("overhaulQuotePrice" in p, "칸 자체가 빠지면 받는 쪽은 옛 판으로 알고 넘어간다");
    assert.strictEqual(p.overhaulQuotePrice, null);
    assert.notStrictEqual(p.overhaulQuotePrice, 0, "0 으로 채우면 고르개가 0원을 붓는다");
  });

  it("🔴 0 은 0 그대로다 — 「O/H 때 무상」이 「안 정함」으로 바뀌면 안 된다", () => {
    const p = toApiPart({ ...SRC, overhaulQuotePrice: 0 });
    assert.strictEqual(p.overhaulQuotePrice, 0);
    assert.notStrictEqual(p.overhaulQuotePrice, null, "`|| null` 꼴을 쓰면 여기서 깨진다");
  });

  it("통화 칸을 따로 두지 않는다 — 견적가와 같이 **항상 원**이다", () => {
    const p = toApiPart(SRC);
    assert.ok(!("overhaulQuoteCurrency" in p));
    // 통화가 갈리는 것은 공급가뿐이다.
    assert.equal(p.supplyCurrency, "JPY");
  });
});

/**
 * 읽는 칸 한 벌 — **목록(`/api/v1/parts`)과 하나 조회(`/api/v1/parts/{no}`)가 같은 것을 쓴다.**
 * 두 통로가 칸 목록을 따로 적고 있으면 칸을 더하는 날 한쪽만 고쳐지고, 받는 쪽은 그 차이를
 * 「그 부품은 값이 없구나」로 읽는다(오류가 나지 않아 아무도 모른다).
 */
describe("부품 통로가 읽는 칸 한 벌", () => {
  it("DB 에서 읽는 칸과 내주는 모양의 칸이 정확히 같다", () => {
    // SRC 는 `ApiPartSource` 라 tsc 가 칸이 다 있음을 보장한다 — 그래서 이 비교가 뜻을 갖는다.
    assert.deepEqual(Object.keys(API_PART_COLUMNS).sort(), Object.keys(SRC).sort());
  });

  it("🔴 overhaulQuotePrice 는 parts 가 아니라 part_overhaul_unit_prices.unit_price 를 읽는다", () => {
    const col = API_PART_COLUMNS.overhaulQuotePrice;
    assert.equal(col.name, "unit_price");
    assert.equal(col.table, partOverhaulUnitPrices, "parts 에 칸을 더해 읽으면 재고 현황·엑셀 한 벌에 단가가 따라 나간다 (2026-10-14 결정)");
  });

  it("🔴 잇는 열쇠는 part_id = parts.id 하나다", () => {
    const cols = API_PART_OVERHAUL_PRICE_JOIN.queryChunks.filter((c): c is { name: string } => typeof c === "object" && c !== null && "name" in c);
    assert.deepEqual(
      cols.map((c) => c.name),
      ["part_id", "id"],
    );
  });

  it("🔴 지운 단가는 **행이 사라진다** — 그 표에 소프트 삭제 칸이 없다", () => {
    // 사람이 칸을 비우면 0 을 저장하지 않고 행을 지운다(`lib/oh/mutations.ts` 의 applyOnePrice).
    // 그래서 LEFT JOIN 이 이을 줄을 못 찾아 null 이 되고, 「안 정했다」와 같은 길로 나간다.
    // 🔴 이 칸 목록이 늘어나 `is_deleted` 가 생기는 날, 이 시험이 깨져서 **조인에 거르는 조건을
    //    붙이라고** 말해 준다. 안 붙이면 지운 단가가 그대로 견적서에 붓힌다.
    assert.deepEqual(
      getTableConfig(partOverhaulUnitPrices).columns.map((c) => c.name).sort(),
      ["id", "part_id", "unit_price", "updated_at", "updated_by"],
    );
  });
});
