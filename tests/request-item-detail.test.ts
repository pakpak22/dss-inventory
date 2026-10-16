import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { partDetailHref, requestItemDetails, REQUEST_ITEM_DETAIL_FIELDS, type RequestItemPart } from "../src/lib/stock/request-item-detail";

/**
 * ============================================================================
 * 부품 요청 관리 화면의 **신청 항목** 칸 (2026-10-16 쓰는 분 요청)
 * ============================================================================
 * 🔴 이 저장소에는 **화면 렌더 시험이 없다**(`tests/part-issue-screen.test.ts` 머리말). 그래서 규칙을
 * 순수 함수로 내려 두고 여기서 돌린다. 못 박는 것 넷:
 *  1. **무엇을 보이나** — 고객사 품명 · 품명2 · 교산 품번 · 도번. 차례가 뜻을 가진다.
 *  2. **빈 칸은 안 그린다** — 「없음」을 줄줄이 적으면 정작 있는 값이 묻힌다.
 *  3. 🔴 **지워진 부품에는 링크가 없다** — 눌러도 안 열리는 링크를 그리지 않는다.
 *  4. 🔵 **부품 상세로 가는 길은 이미 있는 것** — `/?part=No.`(재고 현황의 상세 창). 새 화면이 아니다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const part = (over: Partial<RequestItemPart> = {}): RequestItemPart => ({
  partNo: 165,
  customerName: "증폭기 조립품",
  name2: "AMP 2",
  kyosanPartNo: "C090722733",
  drawingNo: "WR10136AA148B",
  ...over,
});

describe("자세한 내용 — 무엇을 어떤 차례로 (2026-10-16)", () => {
  it("네 칸을 정해진 차례로 준다 — 고객사 품명이 맨 앞", () => {
    const d = requestItemDetails(part());
    assert.deepEqual(
      d.map((x) => x.label),
      ["고객사 품명", "품명2", "교산 품번", "도번"],
    );
    assert.deepEqual(d[0], { label: "고객사 품명", value: "증폭기 조립품" });
    assert.equal(d[3].value, "WR10136AA148B");
  });

  it("🔵 보이는 칸 목록이 `parts` 의 칸 이름과 맞물려 있다 — 한쪽만 고치면 타입에서 깨진다", () => {
    assert.deepEqual(
      REQUEST_ITEM_DETAIL_FIELDS.map((f) => f.key),
      ["customerName", "name2", "kyosanPartNo", "drawingNo"],
    );
  });

  it("🔴 빈 칸은 그리지 않는다 — 있는 것만, 차례는 그대로", () => {
    const d = requestItemDetails(part({ name2: "", drawingNo: "" }));
    assert.deepEqual(
      d.map((x) => x.label),
      ["고객사 품명", "교산 품번"],
    );
  });

  it("공백만 있는 값도 없는 것으로 본다", () => {
    assert.deepEqual(requestItemDetails(part({ customerName: "   ", name2: "\t", kyosanPartNo: "", drawingNo: " " })), []);
  });

  it("값이 하나도 없으면 빈 목록이다 — 화면은 그 줄에 아무것도 안 그린다", () => {
    assert.deepEqual(requestItemDetails(part({ customerName: "", name2: "", kyosanPartNo: "", drawingNo: "" })), []);
  });

  it("🔴 지워진 부품은 네 칸이 비어 있어 저절로 빈 목록이 된다 — 막는 자리를 두 벌 두지 않는다", () => {
    assert.deepEqual(requestItemDetails({ partNo: null, customerName: "", name2: "", kyosanPartNo: "", drawingNo: "" }), []);
  });
});

describe("🔴 품명을 누르면 부품 상세 — 지워진 부품에는 링크가 없다 (2026-10-16)", () => {
  it("번호가 있으면 이미 있는 길로 간다 (`/?part=No.`)", () => {
    assert.equal(partDetailHref(165), "/?part=165");
    assert.equal(partDetailHref(1), "/?part=1");
  });

  it("🔴 번호가 없으면(지워진 부품) `null` — 눌러도 안 열리는 링크를 그리지 않는다", () => {
    assert.equal(partDetailHref(null), null);
  });

  it("🔵 다른 화면이 쓰는 길과 **같은 모양**이다 — 새 주소를 만들지 않았다", () => {
    // 기록 내역(`/entries`)이 부품 상세로 가는 길. 이 글자가 바뀌면 그쪽도 같이 바뀌어야 한다.
    assert.match(src("src/app/(app)/entries/page.tsx"), /\/\?part=\$\{l\.partNo\}/);
  });
});

describe("🔴 화면이 이 규칙을 실제로 쓴다 (2026-10-16)", () => {
  const screen = src("src/components/stock/RequestManagerScreen.tsx");

  it("두 함수를 모두 부른다 — 화면이 규칙을 따로 적으면 여기서 깨진다", () => {
    assert.match(screen, /partDetailHref\(l\.partNo\)/);
    assert.match(screen, /requestItemDetails\(l\)/);
  });

  it("🔴 링크를 손으로 빚지 않는다 — 그러면 지워진 부품에도 링크가 달린다", () => {
    assert.doesNotMatch(screen, /\?part=\$\{/, "화면이 부품 상세 주소를 직접 만들고 있다");
  });

  it("🔴 링크는 **번호가 있을 때만** 그린다 — 삼항의 양쪽이 링크와 글자로 갈린다", () => {
    assert.match(screen, /href \? \(/, "href 가 null 일 때의 갈림이 없다");
  });

  it("🔵 열을 늘리지 않았다 — 표 머리글은 전과 같은 다섯 칸이다(품목·요청·불출·남음·가용)", () => {
    for (const head of ["품목", "요청", "불출", "남음", "가용"]) assert.ok(screen.includes(head), head);
    // 자세한 내용은 품목 칸 **안**에 작은 글씨로 들어간다 — 열로 세우면 가로 스크롤이 네 칸 더 길어진다.
    assert.doesNotMatch(screen, /고객사 품명\n?\s*<\/th>/, "자세한 내용이 열로 올라갔다");
  });
});
