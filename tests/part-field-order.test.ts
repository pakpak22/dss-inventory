import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PART_FIELDS, PART_FIELDS_WITHOUT_NAME, PART_FIELD_LABELS } from "../src/lib/parts/field-order";
import { SEARCH_FIELDS } from "../src/lib/parts/list-state";
import { PART_SEARCH_FIELDS } from "../src/lib/stock/form";
import { REQUEST_ITEM_DETAIL_FIELDS, requestItemDetails } from "../src/lib/stock/request-item-detail";

/**
 * ============================================================================
 * 부품 칸 다섯의 **차례** — 적는 자리는 한 곳 (2026-10-16 쓰는 분 요청)
 * ============================================================================
 * 「**어디서든** 부품에 대한 검색 결과는 **고객사 품명 · 품명 · 품명2 · 교산 품번 · 도번** 순서로.」
 *
 * 🔴 이 저장소에는 **화면 렌더 시험이 없다**(`tests/part-issue-screen.test.ts` 머리말). 그래서
 *  1. 차례 자체는 `PART_FIELDS` 한 표에서 재고,
 *  2. **표를 안 돌고 손으로 적은 화면이 생기는 것**은 파일 글자에서 잰다(아래 마지막 묶음).
 *     화면 넷(재고 현황 목록·인쇄·기록 내역·부품 요청 관리)이 같은 표를 돌아야 한 화면만
 *     고쳐지는 날이 없다. 실제로 2026-10-16 전까지 **기록 내역만 교산 품번과 도번이 뒤바뀌어** 있었다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 쓰는 분이 적어 준 차례 그대로. 🔴 이 글자가 이 조각의 요구 사항이다 — 표를 섞으면 여기서 깨진다. */
const ASKED = ["고객사 품명", "품명", "품명2", "교산 품번", "도번"];

describe("다섯 칸의 차례 — 표 하나 (2026-10-16)", () => {
  it("🔴 요청받은 차례 그대로다", () => {
    assert.deepEqual(
      PART_FIELDS.map((f) => f.label),
      ASKED,
    );
    assert.deepEqual([...PART_FIELD_LABELS], ASKED);
  });

  it("키는 `parts` 표의 칸 이름 그대로 — 화면이 `PartRow[key]` 로 값을 바로 꺼낸다", () => {
    assert.deepEqual(
      PART_FIELDS.map((f) => f.key),
      ["customerName", "name", "name2", "kyosanPartNo", "drawingNo"],
    );
  });

  it("🔵 품명을 뺀 넷은 **뺀 자리만** 빠진다 — 나머지 차례는 그대로", () => {
    assert.deepEqual(
      PART_FIELDS_WITHOUT_NAME.map((f) => f.label),
      ASKED.filter((l) => l !== "품명"),
    );
  });
});

describe("다른 목록들이 그 표를 따른다 (2026-10-16)", () => {
  it("🔴 부품 요청 관리의 작은 글씨 목록 = 품명 뺀 넷, 차례 그대로", () => {
    assert.deepEqual(REQUEST_ITEM_DETAIL_FIELDS, PART_FIELDS_WITHOUT_NAME);
  });

  it("🔴 값이 있는 칸만, 그래도 차례는 표 그대로", () => {
    const d = requestItemDetails({ partNo: 165, customerName: "증폭기 조립품", name2: "", kyosanPartNo: "C090722733", drawingNo: "WR10136AA148B" });
    assert.deepEqual(
      d.map((x) => x.label),
      ["고객사 품명", "교산 품번", "도번"],
    );
  });

  it("재고 현황의 「찾을 곳」 체크 차례 = 표 그대로 (비고는 그 다섯에 없어 뒤에 선다)", () => {
    const labels = SEARCH_FIELDS.map((f) => f.label).filter((l) => l !== "비고");
    assert.deepEqual(labels, ASKED);
    assert.equal(SEARCH_FIELDS[SEARCH_FIELDS.length - 1].label, "비고");
  });

  it("기록 내역의 「찾을 곳」 체크 차례 = 표 그대로 (No. 는 그 다섯에 없어 맨 앞에 선다)", () => {
    const labels = PART_SEARCH_FIELDS.map((f) => f.label).filter((l) => l !== "No.");
    assert.deepEqual(labels, ASKED);
    assert.equal(PART_SEARCH_FIELDS[0].label, "No.");
  });
});

describe("🔴 화면이 차례를 **다시 적지 않는다** (2026-10-16)", () => {
  /** 다섯 라벨을 `<th>`·`<span>` 으로 **줄줄이 적어 둔** 자리가 있으면 그 화면은 표를 안 도는 것이다. */
  const hardCoded = (text: string): number => {
    const hits = text.match(/(고객사 품명|교산 품번|품명2|도번)\s*<\/(th|span|dt)>/g);
    return hits === null ? 0 : hits.length;
  };

  for (const file of [
    "src/components/parts/PartsList.tsx",
    "src/app/print/parts/page.tsx",
    "src/app/(app)/entries/page.tsx",
  ]) {
    it(`${file} — PART_FIELDS 를 돌면서 그린다`, () => {
      const text = src(file);
      assert.match(text, /PART_FIELDS\.map\(/, "표를 돌지 않고 칸을 손으로 적고 있다");
      assert.equal(hardCoded(text), 0, "머리글을 손으로 적어 둔 자리가 남아 있다 — 차례가 두 곳이 된다");
    });
  }

  it("부품 요청 관리는 순수 함수를 부른다 — 라벨도 차례도 화면에 없다", () => {
    assert.match(src("src/components/stock/RequestManagerScreen.tsx"), /requestItemDetails\(l\)/);
  });
});
