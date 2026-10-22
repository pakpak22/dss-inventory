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
  // 🔵 **저장된** O/H 단가다. 내보내는 `overhaulQuotePrice` 와 이름이 다른 까닭은 그 칸 머리말에.
  overhaulUnitPrice: 125000,
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
 * O/H 단가 칸 (`overhaulQuotePrice`) — **통로가 내주는 값은 이미 풀려 있다**
 * ============================================================================
 * A/S 의 **공용 부품 고르개**는 부품을 고르는 순간 단가를 자동으로 붓는다. 오버홀 줄이면
 * O/H 단가를, 아니면 일반 단가를 붓는다(가르는 것은 견적서 종류가 아니라 **그 줄의 `OH` 표시**다).
 *
 * ── 🔴 2026-10-22 오후, 쓰는 분이 뜻을 바꾸셨다 ─────────────────────────
 * 그 전(2026-10-16~10-22 오전)에는 **저장된 값을 그대로** 내주었고, O/H 단가를 안 정한 부품은
 * `null` 로 나가 A/S 고르개가 단가 칸을 **비워 두었다**. 쓰는 분의 새 결정은:
 *
 *   「비워 두면 견적가가 자동으로 쓰인다. 나중에 견적가가 바뀌면 따라서 바뀐다.」
 *
 * 그래서 **푸는 일을 재고관리가 한다** — 두 숫자를 다 쥐고 있는 쪽이 여기이고, 저쪽이 같은
 * 폴백을 따로 계산하면 언젠가 서로 다른 값을 말한다. 🔴 **A/S 는 한 글자도 안 고친다.**
 *
 * ── 🔴 이 시험들이 지키는 것은 **뜻 셋이 안 뭉개지는 것**이다 ───────────
 *   | 저장된 값 | 뜻                   | 내주는 값     |
 *   |-----------|----------------------|---------------|
 *   | `null`    | 「견적가를 따른다」  | `quotePrice`  |
 *   | `0`       | 「O/H 때는 무상」    | `0`           |
 *   | 숫자      | 사람이 정한 O/H 단가 | 그 숫자       |
 *
 *   🔴 **`0` 과 빈 값을 섞으면 되돌릴 수 없다.** `stored || quotePrice` 로 적으면 무상 부품이
 *      견적가로 청구되고(받는 사람은 무상 약속을 청구당한다), `?? 0` 으로 적으면 견적가가 있는
 *      부품이 0원이 된다. 아래 ①~④ 가 그 자리를 각각 밟는다.
 * ============================================================================
 */
describe("API 부품의 O/H 단가", () => {
  it("① 정한 부품은 그 값이 그대로 실린다 — 견적가가 있어도 사람이 정한 값이 이긴다", () => {
    const p = toApiPart(SRC);
    assert.equal(p.overhaulQuotePrice, 125000);
    assert.notEqual(p.overhaulQuotePrice, SRC.quotePrice, "견적가가 사람이 정한 값을 덮었다");
  });

  it("🔴 ② 비워 둔 부품은 **그 부품의 견적가**가 나간다 (2026-10-22 쓰는 분 결정)", () => {
    const p = toApiPart({ ...SRC, overhaulUnitPrice: null });
    assert.ok("overhaulQuotePrice" in p, "칸 자체가 빠지면 받는 쪽은 옛 판으로 알고 넘어간다");
    assert.strictEqual(p.overhaulQuotePrice, 990000, "비워 둔 칸이 견적가를 안 따라간다");
    assert.strictEqual(p.overhaulQuotePrice, p.quotePrice, "따라가는 상대는 **그 부품의** 견적가다");
    assert.notStrictEqual(p.overhaulQuotePrice, 0, "0 으로 채우면 고르개가 0원을 붓는다");
  });

  it("🔴 ③ 저장된 `0` 은 0 그대로다 — **견적가로 바뀌면 무상 약속이 청구로 둔갑한다**", () => {
    const p = toApiPart({ ...SRC, overhaulUnitPrice: 0 });
    assert.strictEqual(p.overhaulQuotePrice, 0);
    assert.notStrictEqual(p.overhaulQuotePrice, null, "`|| null` 꼴을 쓰면 여기서 깨진다");
    assert.notStrictEqual(
      p.overhaulQuotePrice,
      990000,
      "`stored || quotePrice` 로 적으면 여기서 깨진다 — 0 은 「안 정함」이 아니라 「무상」이다",
    );
  });

  it("🔴 ④ 둘 다 없으면 `null` — 따라갈 숫자가 없으니 칸을 비우고 사람이 채운다", () => {
    const p = toApiPart({ ...SRC, overhaulUnitPrice: null, quotePrice: null });
    assert.strictEqual(p.overhaulQuotePrice, null);
    assert.strictEqual(p.quotePrice, null);
  });

  it("🔴 「사람이 정한 값인가 / 견적가를 따른 것인가」를 말하는 칸은 **안 내준다** (2026-10-22 판단)", () => {
    // 받는 쪽(A/S 견적서)이 그 갈림으로 하는 일이 없다 — 어느 쪽이든 똑같이 단가 칸에 붓는다.
    // 쓰이지 않는 칸을 내주면 아무도 안 지키는 약속이 하나 는다. 필요해지면 그때 더하면 된다
    // (칸을 더하는 것은 깨지 않는 변경이다 — `src/lib/api/parts.ts` 머리말).
    // 🔵 숫자를 두 개 내주지 않는 것이 더 중요하다: 어느 것이 진짜인지 받는 쪽이 고르게 된다.
    const keys = Object.keys(toApiPart(SRC));
    assert.equal(keys.filter((k) => k.toLowerCase().includes("overhaul")).length, 1, "O/H 칸이 둘 이상이다");
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

  it("🔴 overhaulUnitPrice 는 parts 가 아니라 part_overhaul_unit_prices.unit_price 를 읽는다", () => {
    const col = API_PART_COLUMNS.overhaulUnitPrice;
    assert.equal(col.name, "unit_price");
    assert.equal(col.table, partOverhaulUnitPrices, "parts 에 칸을 더해 읽으면 재고 현황·엑셀 한 벌에 단가가 따라 나간다 (2026-10-14 결정)");
  });

  it("🔴 질의는 **안 푼 값**을 읽는다 — SQL 로 `COALESCE` 해서 푸는 길로 가지 않았다", () => {
    /**
     * 폴백(「비면 견적가」)을 SQL 에 두면 순수 함수 시험이 안 붙고, 화면·질의·통로가 각자 다른
     * 식을 들고 다니게 된다. 🔴 그래서 칸 이름도 `overhaulQuotePrice`(푼 값)가 아니라
     * `overhaulUnitPrice`(저장된 값)다 — 이름이 같으면 `toApiPart` 가 그냥 복사하는 칸으로 보여
     * 다음 사람이 푸는 줄을 지운다. 이 시험은 그 이름이 다시 붙는 날 말해 준다.
     */
    assert.ok(!("overhaulQuotePrice" in API_PART_COLUMNS), "질의가 푼 값을 읽는 것처럼 이름이 붙었다");
    assert.equal(API_PART_COLUMNS.overhaulUnitPrice.table, partOverhaulUnitPrices);
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
