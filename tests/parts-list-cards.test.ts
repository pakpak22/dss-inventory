import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * 재고 현황 목록 — **좁은 화면은 카드, 1024px 이상은 표** (2026-10-22 쓰는 분 요청)
 * ============================================================================
 * 「재고 현황 목록을 휴대폰에서 읽을 수 있게.」 가로 스크롤이 있어 글자가 찌그러지지는 않지만,
 * 폭 360px 짜리 휴대폰에서 열 열세 개짜리 표를 좌우로 밀어 보는 것은 실제로는 못 쓴다.
 *
 * 🔴 **이 저장소에는 화면 렌더 시험이 없다**(`tests/part-field-order.test.ts` 머리말). 그래서 배치와
 *    「한 자리에 적혔나」는 **파일 글자에서** 잰다. 느슨한 시험이지만, 여기서 재는 넷은 하나만
 *    어긋나도 **오류 없이 조용히** 틀어진다:
 *      ① 인쇄가 표가 아니라 카드로 나간다 (눈으로 확인하기 번거로워 오래 간다)
 *      ② 카드가 칸 목록을 **다시 적어** 차례가 표와 갈린다 (값이 한 칸씩 밀린다)
 *      ③ ★ 의 `stopPropagation` 이 한쪽에서 빠진다 (별을 누를 때마다 상세 상자가 열린다)
 *      ④ 카드에서 정렬할 길이 사라진다 (머리글이 없어 `<th>` 안의 단추가 함께 사라진다)
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const list = src("src/components/parts/PartsList.tsx");

/**
 * 주석을 떼어 낸 코드만. 🔴 **글자로 재는 시험은 주석까지 긁는다** — 함정을 설명하려고 주석에 적어
 * 둔 인용 때문에 시험이 깨진 적이 있다(2026-10-16 `tests/part-limit-quantity.test.ts`, 그리고
 * 2026-10-22 이 파일에서 또 한 번: ★ 주석 안의 `e.stopPropagation()` 이 두 번째로 세어졌다).
 * 설명을 지우는 대신 **재는 쪽을 좁힌다.**
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // 블록 주석(JSX 의 {/* … */} 포함)
    .replace(/\/\/.*$/gm, ""); // 줄 주석
}

/** 카드 묶음(좁은 화면)의 바깥 상자. 🔴 모양이 바뀌었으면 이 시험도 함께 고쳐라. */
const CARD_WRAPPER = '<div className="no-print border-t border-zinc-200 lg:hidden">';
/** 표를 감싼 상자 — 그 안의 class 를 뽑는다. */
const TABLE_WRAPPER = /<div className="([^"]*)">\s*<table className="w-full border-collapse text-sm">/;

const cardAt = list.indexOf(CARD_WRAPPER);
const wrapper = TABLE_WRAPPER.exec(list);
assert.notEqual(cardAt, -1, "카드 묶음의 바깥 상자를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
assert.ok(wrapper, "표를 감싼 상자를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");

/** 카드 쪽 글자만 / 표 쪽 글자만. 🔴 끝을 끊지 않으면 다른 쪽 글자에 걸려 헛통과한다. */
const card = list.slice(cardAt, wrapper.index);
const table = list.slice(wrapper.index);

describe("배치 — 카드와 표가 동시에 서지 않는다 (2026-10-22)", () => {
  it("🔴 카드는 `lg` 미만에만 선다", () => {
    assert.ok(CARD_WRAPPER.includes("lg:hidden"), "카드 묶음에 lg:hidden 이 없다 — 1024px 이상에서 표와 함께 선다");
  });

  it("🔴 표는 `lg` 이상에만 선다 — 지금 표 그대로", () => {
    assert.ok(wrapper[1].includes("hidden"), "표가 좁은 화면에서도 선다 — 카드와 겹친다");
    assert.ok(wrapper[1].includes("lg:block"), "표가 1024px 이상에서 안 선다");
    assert.ok(wrapper[1].includes("overflow-x-auto"), "표의 가로 스크롤이 사라졌다 — 1024px 이상의 동작이 달라진다");
  });
});

/**
 * ============================================================================
 * 🔴 인쇄 — 이 조각에서 가장 깨지기 쉬운 곳
 * ============================================================================
 * [인쇄] 단추는 **전용 화면**(`/print/parts`)으로 가므로 카드는 거기 섞이지 않는다. 그런데 사람이
 * 이 화면에서 그냥 **Ctrl+P** 를 누를 수 있다 — 그 길에는 `PartsList` 가 그대로 나간다.
 * A4 가로는 CSS 로 **약 1047px** 이라 `lg`(1024px) 경계에 아슬아슬하게 걸린다. 브라우저·여백·배율에
 * 따라 1024px 아래로 떨어지면 **종이에 카드가 나간다.** 운에 맡기지 않는다.
 */
describe("🔴 인쇄는 언제나 표다 (2026-10-22)", () => {
  it("🔴 [인쇄] 단추는 전용 인쇄 화면으로 간다 — 카드가 그 길에는 아예 없다", () => {
    assert.ok(list.includes("href={`/print/parts${exportQuery}`}"), "[인쇄] 단추가 전용 인쇄 화면(/print/parts)으로 가지 않는다");
    const print = src("src/app/print/parts/page.tsx");
    assert.ok(!print.includes("PartsList"), "전용 인쇄 화면이 목록 조각을 쓰고 있다 — 카드가 종이에 섞인다");
  });

  it("🔴 그래도 카드는 종이에 안 나간다 — `no-print`", () => {
    assert.ok(CARD_WRAPPER.includes("no-print"), "카드 묶음에 no-print 가 없다 — Ctrl+P 로 뽑으면 종이에 카드가 나간다");
  });

  it("🔴 표는 폭과 상관없이 종이에 나간다 — `print:block` 이 `hidden` 을 이긴다", () => {
    assert.ok(
      wrapper[1].includes("print:block"),
      "표에 print:block 이 없다 — 인쇄 폭이 1024px 아래로 떨어지면 표도 카드도 없는 빈 종이가 나온다",
    );
  });

  it("🔵 `no-print` 는 실제로 숨기는 규칙이다 — 글자만 적어 둔 것이 아니다", () => {
    const css = src("src/app/globals.css");
    const atPrint = css.slice(css.indexOf("@media print"));
    assert.ok(atPrint.includes(".no-print { display: none !important; }"), "globals.css 의 @media print 에서 .no-print 규칙이 사라졌다");
  });
});

/**
 * ============================================================================
 * 🔴 카드는 **세 번째 사본**이 아니다
 * ============================================================================
 * 이 파일에는 이미 그 교훈이 적혀 있다 — 「다섯 칸은 머리글과 **같은 표**를 돈다. 둘을 따로 적어
 * 두었더니 차례가 어긋나면 값이 한 칸씩 밀리는 자리였다.」 카드를 셋째 사본으로 만들면 그 버그가
 * 되돌아온다. 칸이 하나 늘 때 고칠 곳은 **한 군데**여야 한다.
 */
describe("🔴 카드가 칸 목록을 다시 적지 않는다 (2026-10-22)", () => {
  it("🔴 카드도 `COLUMNS` 를 돈다 — 라벨도 차례도 카드에 없다", () => {
    assert.ok(card.includes("COLUMNS.filter("), "카드가 칸을 손으로 적고 있다 — 차례가 두 곳이 된다");
    // 🔵 다섯 칸의 라벨을 손으로 적어 둔 자리가 없는지는 `tests/part-field-order.test.ts` 가 파일 전체에서 잰다.
  });

  it("🔴 값은 표와 **같은 함수**가 그린다 — 꼴만 다르고 내용은 한 자리다", () => {
    assert.equal([...list.matchAll(/function cellBody\(/g)].length, 1, "값을 그리는 함수가 둘이다");
    for (const call of ['cellBody(p, "quantity")', "cellBody(p, c.key)"]) assert.ok(card.includes(call), `카드가 ${call} 를 안 쓴다`);
    for (const call of ['cellBody(p, "quantity")', "cellBody(p, f.key)"]) assert.ok(table.includes(call), `표가 ${call} 를 안 쓴다`);
  });

  it("🔴 연도 칸도 같은 표(`yearColumns`)를 돈다", () => {
    assert.ok(card.includes("yearColumns.map("), "카드가 연도 칸을 안 그린다 — 연도를 켜도 휴대폰에서는 안 보인다");
    assert.ok(table.includes("yearColumns.map("), "표에서 연도 칸이 사라졌다");
  });

  it("🔵 값이 빈 칸은 카드에 안 그린다 — 「도번 -」이 줄마다 서면 있는 값이 묻힌다", () => {
    assert.ok(card.includes("!isBlank(p, c.key)"), "카드가 빈 칸을 거르지 않는다");
    assert.ok(table.includes("isBlank(p, f.key)"), "표가 빈 칸 판정을 따로 적고 있다");
  });

  it("🔵 숫자는 세로가 맞는다 — 카드도 `.tabular` 를 쓴다", () => {
    assert.ok(card.includes("tabular"), "카드의 숫자에 .tabular 가 없다");
  });
});

describe("🔴 줄에서 되던 네 가지가 카드에서도 된다 (2026-10-22)", () => {
  it("🔴 ★ 는 한 함수가 그린다 — `stopPropagation` 이 한 자리다", () => {
    assert.equal(
      [...stripComments(list).matchAll(/e\.stopPropagation\(\)/g)].length,
      1,
      "★ 를 두 벌 적어 두었다 — 한쪽에서 stopPropagation 이 빠지면 별을 누를 때마다 상세 상자가 열린다",
    );
    assert.ok(card.includes("favoriteStar(p)"), "카드에 ★ 가 없다");
    assert.ok(table.includes("favoriteStar(p)"), "표에서 ★ 가 사라졌다");
  });

  it("🔴 카드를 눌러도 Enter 를 쳐도 상세가 열린다", () => {
    assert.ok(card.includes("openDetail(p.no)"), "카드를 눌러도 상세가 안 열린다");
    assert.ok(card.includes('e.key === "Enter"'), "카드에서 Enter 로 상세를 못 연다");
    assert.ok(card.includes("tabIndex={0}"), "카드에 키보드 차례가 없다 — Enter 가 닿지 않는다");
  });

  it("🔴 찾은 글자 노란 칠은 카드에서도 보인다 — `cellBody` 가 `Marked` 를 쥔다", () => {
    const body = list.slice(list.indexOf("function cellBody("), list.indexOf("  return (\n    <div className=\"flex flex-col gap-4\">"));
    assert.ok(body.includes("<Marked"), "cellBody 가 찾은 글자를 칠하지 않는다 — 카드에서 왜 걸렸는지 안 보인다");
    assert.ok(body.includes("PART_CELL[key].search"), "어느 「찾을 곳」의 글자인지를 PART_CELL 이 아닌 곳에서 정하고 있다");
  });

  /**
   * 🔴 카드에는 머리글이 없어 `<th>` 안의 정렬 단추가 **함께 사라진다.** 목록 위에 고르개를 두고,
   *    표와 **같은** `sortBy`·`state.sort`·`state.desc` 를 쓴다(정렬 규칙을 따로 만들지 않는다).
   */
  it("🔴 카드에서도 정렬할 수 있다 — 같은 `sortBy` 로", () => {
    assert.ok(card.includes("sortBy(e.target.value as SortKey)"), "카드 위에 정렬 고르개가 없다");
    assert.ok(card.includes("value={state.sort}"), "고르개가 지금 정렬 기준을 안 보여 준다");
    assert.ok(card.includes("onClick={() => sortBy(state.sort)}"), "오름·내림을 바꿀 길이 없다");
    assert.ok(card.includes("COLUMNS.map("), "고를 수 있는 칸을 손으로 적고 있다 — COLUMNS 가 쥐어야 한다");
  });

  /**
   * 🔴 좁은 칸에서 **이름표만 윗줄에 남고 값이 아랫줄로** 떨어진 적이 있다
   *    (`src/components/stock/RepairCaseInfo.tsx` 가 같은 문제를 겪고 고쳤다).
   *    `inline-block` 이 **함께** 있어야 쌍이 통째로 내려간다 — `whitespace-nowrap` 만으로는
   *    inline 상자가 쪼개진다.
   */
  it("🔴 이름표와 값은 한 쌍으로 붙어 다닌다", () => {
    assert.ok(card.includes("inline-block whitespace-nowrap"), "이름표+값 쌍이 갈라질 수 있다 — RepairCaseInfo 가 고친 그 문제다");
    const repair = src("src/components/stock/RepairCaseInfo.tsx");
    assert.ok(repair.includes("inline-block whitespace-nowrap"), "본보기(RepairCaseInfo)에서 그 방식이 사라졌다 — 둘 중 하나가 틀어진 것이다");
  });
});
