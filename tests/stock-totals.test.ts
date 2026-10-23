import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { summarizeStockValue, usedCurrencies, type StockValueRow } from "../src/lib/parts/totals";

/**
 * ============================================================================
 * 재고 현황의 **부품 총 금액** (2026-10-23 쓰는 분 요청)
 * ============================================================================
 * 「검색 아래 우측 빈 공간에 부품 총 금액(견적가, 공급가, 소유별로)」. 셈은 **수량 × 금액**.
 *
 * 🔴 **이 시험이 지키는 것 중 가장 큰 하나는 「공급가를 한 숫자로 더하지 않는다」**이다.
 *    견적가는 언제나 원이지만 공급가는 부품마다 엔·원이 갈린다(`parts.supply_currency`).
 *    ¥100 과 ₩100 을 더해 200 을 보여 주면 **오류가 한 번도 안 나면서** 아무 뜻도 없는
 *    숫자가 화면에 선다. 이 시스템에는 환율이 없어 고칠 길도 없다.
 *
 * 🔴 둘째는 **「금액이 비어 있는 부품을 조용히 빼지 않는다」**이다. `null` 을 `?? 0` 으로
 *    뭉개면 「0원짜리 부품」과 「아직 안 적은 부품」이 같은 말이 되고, 적게 나온 합계가
 *    전부인 것처럼 보인다.
 * ============================================================================
 */

const row = (over: Partial<StockValueRow> = {}): StockValueRow => ({
  owner: "DSS",
  quantity: 1,
  quotePrice: null,
  supplyPrice: null,
  supplyCurrency: "JPY",
  ...over,
});

describe("summarizeStockValue — 수량 × 금액", () => {
  it("견적가는 수량을 곱해 더한다", () => {
    const s = summarizeStockValue([row({ quantity: 3, quotePrice: 1_000 }), row({ quantity: 2, quotePrice: 500 })]);
    assert.equal(s.total.quote, 3 * 1_000 + 2 * 500);
    assert.equal(s.total.parts, 2);
    assert.equal(s.total.quantity, 5);
  });

  it("🔴 **엔과 원을 더하지 않는다** — 통화마다 따로 센다", () => {
    const s = summarizeStockValue([
      row({ quantity: 2, supplyPrice: 100, supplyCurrency: "JPY" }),
      row({ quantity: 3, supplyPrice: 100, supplyCurrency: "KRW" }),
    ]);
    assert.equal(s.total.supply.JPY, 200, "엔 합계가 틀렸다");
    assert.equal(s.total.supply.KRW, 300, "원 합계가 틀렸다");
    // 🔴 둘을 더한 값(500)이 어느 칸에도 있으면 안 된다 — 그것이 뜻 없는 숫자다.
    assert.notEqual(s.total.supply.JPY, 500);
    assert.notEqual(s.total.supply.KRW, 500);
  });

  it("🔴 수량이 0 이면 금액도 0 이다 — 값이 적혀 있어도", () => {
    // 재고가 없는 부품의 단가를 총액에 싣지 않는다.
    const s = summarizeStockValue([row({ quantity: 0, quotePrice: 9_999, supplyPrice: 8_888 })]);
    assert.equal(s.total.quote, 0);
    assert.equal(s.total.supply.JPY, 0);
    assert.equal(s.total.parts, 1, "줄 수는 그대로 센다 — 부품은 있다");
  });

  it("🔴 금액이 비어 있으면 더하지 않고 **몇 개가 빠졌는지 센다**", () => {
    const s = summarizeStockValue([row({ quantity: 5, quotePrice: null, supplyPrice: 100 }), row({ quantity: 5, quotePrice: 100, supplyPrice: null })]);
    assert.equal(s.total.quoteMissing, 1);
    assert.equal(s.total.supplyMissing, 1);
    assert.equal(s.total.quote, 500);
    assert.equal(s.total.supply.JPY, 500);
  });

  it("🔴 0원과 「안 적음」은 다른 말이다 — 0 은 빠진 것으로 세지 않는다", () => {
    const s = summarizeStockValue([row({ quotePrice: 0, supplyPrice: 0 })]);
    assert.equal(s.total.quoteMissing, 0, "0원을 「안 적음」으로 셌다");
    assert.equal(s.total.supplyMissing, 0, "0원을 「안 적음」으로 셌다");
  });
});

describe("summarizeStockValue — 소유별", () => {
  it("소유마다 따로 세고 합계도 함께 낸다", () => {
    const s = summarizeStockValue([
      row({ owner: "DSS", quantity: 2, quotePrice: 100 }),
      row({ owner: "KYOSAN", quantity: 3, quotePrice: 100 }),
      row({ owner: "SERVICE_SPARE", quantity: 4, quotePrice: 100 }),
    ]);
    assert.deepEqual(
      s.byOwner.map((g) => [g.owner, g.quote]),
      [
        ["DSS", 200],
        ["KYOSAN", 300],
        ["SERVICE_SPARE", 400],
      ],
    );
    assert.equal(s.total.quote, 900);
  });

  it("🔵 줄이 없는 소유는 서지 않는다 — 0 만 적힌 줄이 눈을 가린다", () => {
    const s = summarizeStockValue([row({ owner: "KYOSAN", quotePrice: 100 })]);
    assert.deepEqual(
      s.byOwner.map((g) => g.owner),
      ["KYOSAN"],
    );
  });

  it("🔴 차례는 들어온 순서가 아니라 **OWNERS 그대로**다 — 목록이 바뀔 때 줄이 춤추면 안 된다", () => {
    const s = summarizeStockValue([row({ owner: "SERVICE_SPARE" }), row({ owner: "KYOSAN" }), row({ owner: "DSS" })]);
    assert.deepEqual(
      s.byOwner.map((g) => g.owner),
      ["DSS", "KYOSAN", "SERVICE_SPARE"],
    );
  });

  it("빈 목록은 0 이고, 소유 줄이 하나도 없다", () => {
    const s = summarizeStockValue([]);
    assert.equal(s.total.parts, 0);
    assert.equal(s.total.quote, 0);
    assert.deepEqual(s.byOwner, []);
  });
});

describe("usedCurrencies — 쓰는 통화만 열을 세운다", () => {
  it("엔만 쓰면 엔 열 하나", () => {
    const rows = [row({ supplyPrice: 100, supplyCurrency: "JPY" })];
    assert.deepEqual(usedCurrencies(rows), ["JPY"]);
  });

  it("둘 다 쓰면 둘 다, 차례는 CURRENCIES 그대로", () => {
    const rows = [row({ supplyPrice: 100, supplyCurrency: "KRW" }), row({ supplyPrice: 100, supplyCurrency: "JPY" })];
    assert.deepEqual(usedCurrencies(rows), ["JPY", "KRW"]);
  });

  it("🔴 금액이 **0원**이라도 그 통화로 적혀 있으면 열을 세운다 — 「0원어치 있다」와 「안 쓴다」는 다르다", () => {
    const rows = [row({ quantity: 0, supplyPrice: 100, supplyCurrency: "KRW" })];
    assert.deepEqual(usedCurrencies(rows), ["KRW"]);
  });

  it("공급가가 하나도 안 적혀 있으면 공급가 열이 서지 않는다", () => {
    const rows = [row({ quotePrice: 100 })];
    assert.deepEqual(usedCurrencies(rows), []);
  });
});

/*
 * ── 🔴 화면이 이 셈을 제대로 쓰는가 ────────────────────────────────────────
 * 이 저장소에는 화면 렌더 시험이 없다. 그래서 「상자가 보이는가」는 눌러 봐야 안다.
 * 여기서 막는 것은 **글자가 지워져도 오류가 안 나는 것** 둘이다.
 */
describe("🔴 화면이 넘기는 값 (2026-10-23)", () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  /** 🔴 주석을 떼고 잰다 — 글자로 재는 시험은 주석까지 긁는다. */
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const list = strip(src("src/components/parts/PartsList.tsx"));
  const box = strip(src("src/components/parts/StockTotals.tsx"));

  it("🔴 **걸러진 전체**를 넘긴다 — 보고 있는 쪽이 아니다", () => {
    assert.ok(/<StockTotals rows=\{filtered\}/.test(list), "StockTotals 가 filtered 를 안 받는다 — page.rows 를 받으면 쪽을 넘길 때마다 총액이 달라진다");
    assert.ok(!/<StockTotals[^>]*page\.rows/.test(list), "StockTotals 가 지금 쪽만 센다");
  });

  /**
   * 🔴 **거르개 단추 넷이 한 줄에 같은 꼴로 선다** (2026-10-23 쓰는 분 요청: 「단추들을 가로로
   *    나열해줘」·「부품 총 금액도 버튼으로」). 그 전에는 체크박스 하나와 단추 셋이 섞여 있고
   *    금액 상자만 늘 펼쳐져 있어, 폰에서 무엇이 한 묶음인지 안 보였다.
   * 🔵 **보이는 모양은 눌러 봐야 안다.** 여기서 막는 것은 넷 중 하나가 **조용히 빠지는 것**이다.
   */
  it("🔴 거르개 단추 넷이 **같은 조각**으로 한 줄에 선다", () => {
    const row = list.slice(list.indexOf('<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">'), list.indexOf("{showFields ?"));
    assert.ok(row.length > 0, "단추 줄을 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
    for (const label of ["찾을 곳", "자주 사용", "연도별 사용 수량", "부품 총 금액"]) {
      assert.ok(row.includes(`label="${label}"`), `단추 줄에서 [${label}] 이 사라졌다`);
    }
    assert.equal([...row.matchAll(/<FilterToggle/g)].length, 4, "단추가 넷이 아니다");
  });

  /**
   * 🔴 **넷의 폭이 같아야 한다** (2026-10-23 쓰는 분 요청: 「버튼들의 가로폭을 일정하게」).
   *    글자만큼만 차지하게 두면 폰에서 2×2 로 접히며 폭이 제각각이 되어 들쭉날쭉했다.
   * 🔵 폭이 **보기에** 같은지는 띄워 봐야 안다. 여기서 막는 것은 폭을 정하는 글자가
   *    조용히 사라지는 것이다 — 사라져도 오류는 안 나고 모양만 흐트러진다.
   */
  it("🔴 단추 폭이 **하나의 조각**에서 정해진다 — 좁으면 칸을 채우고 넓으면 고정", () => {
    const toggle = list.slice(list.indexOf("function FilterToggle("), list.indexOf("export function PartsList"));
    assert.ok(/w-full/.test(toggle), "좁은 화면에서 격자 칸을 안 채운다 — 폭이 제각각이 된다");
    assert.ok(/sm:w-\d+/.test(toggle), "넓은 화면에서 폭이 안 고정된다");
    assert.ok(/justify-between/.test(toggle), "글자와 ▾ 가 양끝으로 안 벌어진다 — 폭이 같아도 화살표가 안 맞는다");
    // 🔴 폭을 **부르는 쪽에서** 따로 주면 넷이 달라질 수 있다. 감싸는 div 의 class 는 봐야
    //    하므로(격자가 거기 있다) `<FilterToggle …/>` 호출 토막만 떼어서 본다.
    const row = list.slice(list.indexOf('<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">'), list.indexOf("{showFields ?"));
    const calls = row.split("<FilterToggle").slice(1).map((s) => s.slice(0, s.indexOf("/>")));
    assert.equal(calls.length, 4, "단추 호출을 넷 다 못 읽었다");
    for (const call of calls) assert.ok(!/className=/.test(call), "단추마다 class 를 따로 준다 — 폭이 넷 다 달라질 수 있다");
  });

  it("🔴 총 금액은 **단추로 열고 닫는다** — 늘 펼쳐 두지 않는다", () => {
    assert.ok(/\{showTotals \? <StockTotals/.test(list), "총 금액이 단추와 무관하게 늘 떠 있다");
    assert.ok(/const \[showTotals, setShowTotals\] = useState\(false\)/.test(list), "기본이 펼침이다 — 부품을 찾으러 오는 화면이지 금액을 보러 오는 화면이 아니다");
  });

  /**
   * 🔴 **항목·분류·소유가 같은 상자를 쓴다** (2026-10-23 쓰는 분 요청). 네이티브 `<select>` 는
   *    안드로이드에서 **화면을 덮는 라디오 목록**으로 열려, 바로 옆의 「항목」과 여는 모습이
   *    전혀 달랐다. 그리는 쪽이 브라우저라 CSS 로 맞출 길이 없다 — 상자를 바꾸는 수밖에 없다.
   * 🔵 되돌아가도 오류가 안 난다. 화면만 조용히 예전으로 돌아간다.
   */
  it("🔴 항목·분류·소유가 모두 `ScrollSelect` 다 — 거르개에 네이티브 목록이 없다", () => {
    const filters = list.slice(list.indexOf('<div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">'), list.indexOf('<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">'));
    assert.ok(filters.length > 0, "거르개 줄을 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
    assert.equal([...filters.matchAll(/<ScrollSelect/g)].length, 3, "항목·분류·소유 셋이 같은 상자를 안 쓴다");
    assert.ok(!/<select/.test(filters), "거르개에 네이티브 <select> 가 남아 있다 — 폰에서 혼자 다르게 열린다");
    for (const label of ["항목", "분류", "소유"]) {
      assert.ok(filters.includes(`ariaLabel="${label}"`), `[${label}] 상자의 이름표가 없다`);
    }
  });

  it("🔴 바깥을 눌러 닫는 것은 `pointerdown` 이다 — 손가락에서도 닫혀야 한다", () => {
    const scroll = strip(src("src/components/parts/ScrollSelect.tsx"));
    assert.ok(/addEventListener\("pointerdown"/.test(scroll), "pointerdown 이 아니다 — mousedown 은 손가락에서 늦거나 안 올 수 있다");
    assert.ok(!/addEventListener\("mousedown"/.test(scroll), "mousedown 으로 돌아갔다");
  });

  it("🔵 켜 둔 거르개는 단추가 **까맣게** 칠해진다 — 상태 글을 걷어낸 대신이다", () => {
    // 아무 표시도 없으면 「품명만 켜 둔 것」을 잊고 있는 부품을 못 찾는다.
    assert.ok(/active=\{activeFields\.size !== SEARCH_FIELDS\.length\}/.test(list), "찾을 곳이 기본값과 다를 때 표시가 없다");
    assert.ok(/active=\{state\.frequent\}/.test(list), "자주 사용이 켜져 있을 때 표시가 없다");
    assert.ok(/active=\{state\.years\.length > 0\}/.test(list), "연도 칸을 보는 중일 때 표시가 없다");
  });

  it("🔴 공급가 칸이 **통화마다** 선다 — 한 칸에 뭉치면 뜻 없는 숫자가 된다", () => {
    assert.ok(/usedCurrencies\(/.test(box), "쓰는 통화를 가리는 자리가 사라졌다");
    assert.ok(/currencies\.map\(/.test(box), "공급가 칸이 통화마다 서지 않는다");
    assert.ok(/group\.supply\[c\]/.test(box), "통화별 합계를 안 읽는다");
  });

  /**
   * 🔴 **좁은 화면은 표가 아니다** (2026-10-23 눈 확인 뒤 고침). 폭 360px 짜리 폰에서 표를
   *    그리면 합계 줄의 견적가가 화면 밖으로 잘려, 제일 큰 숫자를 보려면 옆으로 밀어야 했다.
   *    총액은 훑어보는 값이라 **미는 순간 못 쓴다.**
   */
  it("🔴 좁은 화면은 세로로 쌓고, 표는 `lg` 이상에만 선다", () => {
    assert.ok(/lg:hidden/.test(box), "좁은 화면용 목록이 없다 — 폰에서 표가 잘린다");
    assert.ok(/hidden w-full text-xs lg:table/.test(box), "표가 좁은 화면에서도 선다 — 목록과 겹친다");
    assert.ok(!/overflow-x-auto/.test(box), "아직 좌우로 미는 길이 남아 있다 — 세로로 쌓기로 했다");
  });

  it("🔴 못 센 부품 수를 화면이 말한다", () => {
    assert.ok(/quoteMissing/.test(box) && /supplyMissing/.test(box), "금액이 빈 부품 수를 안 적는다 — 적게 나온 합계가 전부인 것처럼 보인다");
  });

  it("🔵 종이에는 안 나간다 — 조건이 안 적힌 종이에 총액만 찍히면 무엇의 합계인지 모른다", () => {
    assert.ok(/no-print/.test(box), "상자에 no-print 가 없다");
  });

  /**
   * 🔴 **차례는 소유 · 수량 · 공급가 · 견적가** (2026-10-23 쓰는 분 지정).
   *
   * 🔵 머리글과 값이 어긋날 길은 이제 **구조로 막혀 있다** — 둘 다 `cells()` 한 곳을 돈다.
   *    그래서 여기서 재는 것은 ① `cells()` 안의 차례와 ② **머리글을 손으로 적지 않는 것**이다.
   *    손으로 적는 순간 다시 어긋날 수 있고, 그것은 오류가 아니라 **틀린 금액**이라 아무도
   *    신고하지 않는다(견적가는 원, 공급가는 보통 엔이라 자릿수가 비슷하면 눈에도 안 걸린다).
   */
  it("🔴 금액 칸을 짓는 자리가 **하나**이고, 거기서 공급가가 견적가보다 먼저다", () => {
    const cells = box.slice(box.indexOf("const cells ="), box.indexOf("const lines ="));
    assert.ok(cells.length > 0, "cells 를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
    const atSupply = cells.indexOf("supplyLabel(c)");
    const atQuote = cells.indexOf('label: "견적가"');
    assert.ok(atSupply !== -1 && atQuote !== -1, "금액 칸 둘을 못 찾았다");
    assert.ok(atSupply < atQuote, "견적가가 공급가보다 먼저 나온다 — 지정한 차례가 아니다");
  });

  it("🔴 머리글을 손으로 적지 않는다 — 값과 **같은 `cells()`** 를 돈다", () => {
    const head = box.slice(box.indexOf("<thead>"), box.indexOf("</thead>"));
    assert.ok(/cells\(summary\.total\)\.map\(/.test(head), "머리글이 cells 를 안 돈다 — 값과 어긋날 수 있다");
    assert.ok(/\{cell\.label\}/.test(head), "머리글이 cells 의 이름을 안 쓴다");
    // 🔴 금액 열 이름을 머리글에 **글자로** 박아 두면 그 순간 두 벌이 된다.
    assert.ok(!/공급가|견적가/.test(head), "머리글에 금액 열 이름이 손으로 적혀 있다 — 값과 두 벌이 된다");
    // 소유·수량은 금액 열이 아니라 `cells` 밖에 있는 것이 맞다. 차례가 앞인지만 본다.
    assert.ok(head.indexOf("소유") < head.indexOf("수량"), "소유보다 수량이 먼저다");
    assert.ok(head.indexOf("수량") < head.indexOf("cells(summary.total)"), "수량이 금액 열보다 뒤에 있다");
  });

  it("🔵 좁은 화면 목록도 **같은 `cells()`** 를 돈다 — 표와 다른 금액을 말할 수 없다", () => {
    const list = box.slice(box.indexOf("lg:hidden"), box.indexOf("<table"));
    assert.ok(/cells\(line\.group\)\.map\(/.test(list), "좁은 화면 목록이 cells 를 안 돈다");
    assert.equal([...box.matchAll(/const cells =/g)].length, 1, "금액 칸을 짓는 자리가 둘이다");
  });
});
