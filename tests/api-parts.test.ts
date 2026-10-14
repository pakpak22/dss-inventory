import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesQuery, parseApiPartsFilter, toApiPart, type ApiPartSource } from "../src/lib/api/parts";

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
    assert.deepEqual(Object.keys(p).sort(), ["category", "customerName", "drawingNo", "item", "kyosanPartNo", "name", "name2", "no", "note", "owner", "quantity", "quotePrice", "supplyCurrency", "supplyPrice", "updatedAt"].sort());
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
