import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * 기록 내역의 **세부사항** — 좁은 화면은 카드, 1024px 이상은 표 (2026-10-22 쓰는 분 요청)
 * ============================================================================
 * 「기록 내역을 휴대폰에서 읽을 수 있게.」 머리줄은 이미 접히지만 그 아래 세부사항은 열이 열 몇 개라,
 * 폭 360px 짜리 휴대폰에서는 좌우로 밀어도 첫 두 칸만 보인다.
 *
 * 🔴 **이 화면의 진짜 위험은 열이 세 갈래라는 것이다.** 열은 `sheet` 에 따라 다르고(사용처 기입란 ·
 *    입고 기입란 · 수량 변경 기록), 가운데 수량 열은 **이름표까지 갈린다**. 2026-10-22 까지 그 갈림은
 *    `<thead>` 와 `<tbody>` 에 **따로** 적혀 있었다. 카드까지 더해 세 벌이 되면 칸 하나가 갈래를
 *    옮기는 날 한쪽만 고쳐져 **값이 조용히 어긋난다** — 오류가 안 나므로 아무도 모른다.
 *
 * 🔵 **이 저장소에는 화면 렌더 시험이 없다**(`tests/part-field-order.test.ts` 머리말). 그래서 배치와
 *    「한 자리에 적혔나」는 **파일 글자에서** 잰다. 바로 앞 조각(`tests/parts-list-cards.test.ts`)과
 *    같은 처방이다. 여기서 재는 다섯은 하나만 어긋나도 **오류 없이 조용히** 틀어진다:
 *      ① 인쇄가 표가 아니라 카드로 나간다 (눈으로 확인하기 번거로워 오래 간다)
 *      ② 카드가 칸 목록·갈래를 **다시 적어** 표와 갈린다 (값이 한 칸씩 밀린다)
 *      ③ 가운데 수량 열의 이름표가 두 곳이 된다 (「입고」인데 「변동」이라고 적힌다)
 *      ④ 취소선이 카드에서 빠진다 (되돌려진 줄이 멀쩡한 줄처럼 보인다)
 *      ⑤ [기록 취소] 단추의 조건이 두 곳이 된다
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 주석을 떼어 낸 코드만. 🔴 **글자로 재는 시험은 주석까지 긁는다** — 함정을 설명하려고 주석에 적어 둔
 * 인용 때문에 시험이 깨진 적이 있다(2026-10-16 `tests/part-limit-quantity.test.ts`, 2026-10-22
 * `tests/parts-list-cards.test.ts`). 이 파일도 같다: 아래에서 「카드와 표 안에 이름표가 없는가」를
 * 재는데, **그 이름표들을 설명하는 주석**이 바로 그 자리에 있다. 설명을 지우는 대신 **재는 쪽을 좁힌다.**
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // 블록 주석(JSX 의 {/* … */} 포함)
    .replace(/\/\/.*$/gm, ""); // 줄 주석
}

const page = stripComments(src("src/app/(app)/entries/page.tsx"));

/** 카드 묶음(좁은 화면)의 바깥 상자. 🔴 모양이 바뀌었으면 이 시험도 함께 고쳐라. */
const CARD_WRAPPER = '<div className="no-print rounded-md border border-zinc-200 lg:hidden">';
/** 표를 감싼 상자 — 그 안의 class 를 뽑는다. */
const TABLE_WRAPPER = /<div className="([^"]*)">\s*<table className="w-full border-collapse text-xs">/;

const cardAt = page.indexOf(CARD_WRAPPER);
const wrapper = TABLE_WRAPPER.exec(page);
assert.notEqual(cardAt, -1, "카드 묶음의 바깥 상자를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
assert.ok(wrapper, "표를 감싼 상자를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");

/** 카드 쪽 글자만 / 표 쪽 글자만. 🔴 끝을 끊지 않으면 다른 쪽 글자에 걸려 헛통과한다. */
const card = page.slice(cardAt, wrapper.index);
const table = page.slice(wrapper.index, page.indexOf("</table>", wrapper.index) + "</table>".length);
assert.ok(card.length > 0 && table.length > "</table>".length, "두 자리를 가르지 못했다 — 카드가 표 뒤로 갔는지 보라");

/** 갈래를 정하는 함수의 본문만. */
const columnsAt = page.indexOf("function entryColumns(");
assert.notEqual(columnsAt, -1, "entryColumns 를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
const columnsFn = page.slice(columnsAt, page.indexOf("const PART_FIELD_KEY_SET", columnsAt));

const count = (text: string, needle: string): number => text.split(needle).length - 1;

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
 * 이 화면에는 [인쇄] 단추가 **없다.** 그런데 거르기 상자와 단추 칸에는 처음부터 `no-print` 가 붙어
 * 있다 — 사람이 **Ctrl+P** 로 뽑는 길을 전제하고 만든 흔적이다. A4 가로는 CSS 로 **약 1047px** 이라
 * `lg`(1024px) 경계에 아슬아슬하게 걸린다. 브라우저·여백·배율에 따라 1024px 아래로 떨어지면
 * **종이에 카드가 나간다.** 운에 맡기지 않는다.
 */
describe("🔴 인쇄는 언제나 표다 (2026-10-22)", () => {
  it("🔴 카드는 종이에 안 나간다 — `no-print`", () => {
    assert.ok(CARD_WRAPPER.includes("no-print"), "카드 묶음에 no-print 가 없다 — Ctrl+P 로 뽑으면 종이에 카드가 나간다");
  });

  it("🔴 표는 폭과 상관없이 종이에 나간다 — `print:block` 이 `hidden` 을 이긴다", () => {
    assert.ok(
      wrapper[1].includes("print:block"),
      "표에 print:block 이 없다 — 인쇄 폭이 1024px 아래로 떨어지면 표도 카드도 없는 빈 종이가 나온다",
    );
  });

  it("🔵 단추 칸은 지금까지처럼 종이에서 빠진다 — 이 조각이 그 규칙을 건드리지 않았다", () => {
    assert.ok(table.includes("no-print"), "표의 단추 칸에서 no-print 가 사라졌다");
    assert.ok(src("src/app/(app)/entries/page.tsx").includes('className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 no-print"'), "거르기 상자의 no-print 가 사라졌다");
  });

  it("🔵 `no-print` 는 실제로 숨기는 규칙이다 — 글자만 적어 둔 것이 아니다", () => {
    const css = src("src/app/globals.css");
    const atPrint = css.slice(css.indexOf("@media print"));
    assert.ok(atPrint.includes(".no-print { display: none !important; }"), "globals.css 의 @media print 에서 .no-print 규칙이 사라졌다");
  });
});

/**
 * ============================================================================
 * 🔴 **열이 세 갈래라는 것을 적는 자리는 하나다**
 * ============================================================================
 * 이것이 이 조각의 진짜 숙제였다. 표 머리글 · 표 본문 · 카드가 **같은 목록**(`entryColumns`)을 돌지
 * 않으면, 칸 하나가 갈래를 옮기는 날 한쪽만 고쳐져 값이 어긋난다.
 */
describe("🔴 갈래를 markup 에 다시 적지 않는다 (2026-10-22)", () => {
  it("🔴 `sheet` 로 가르는 자리가 파일 전체에 하나뿐이다 — `entryColumns`", () => {
    for (const branch of ['sheet === "USE"', 'sheet === "CHANGE"']) {
      assert.equal(count(page, branch), 1, `${branch} 가 두 곳에 적혔다 — 한쪽만 고쳐지는 날이 온다`);
      assert.ok(columnsFn.includes(branch), `${branch} 가 entryColumns 밖에 있다`);
    }
  });

  it("🔴 카드도 표도 `sheet` 를 보지 않는다 — 이미 갈라진 `cols` 를 받을 뿐이다", () => {
    for (const [where, text] of [
      ["카드", card],
      ["표", table],
    ] as const) {
      assert.ok(!text.includes("sheet ==="), `${where} 가 갈래를 스스로 가른다 — 조건이 두 벌이 된다`);
      assert.ok(text.includes("cols."), `${where} 가 칸 목록을 안 돈다`);
    }
  });

  it("🔴 이름표가 카드에도 표에도 적혀 있지 않다 — 전부 `cols` 에서 온다", () => {
    const labels = [
      "No.",
      "날짜",
      "인수번호",
      "종류",
      "고객사 품명",
      "품명2",
      "교산 품번",
      "도번",
      "현 재고",
      "이후 재고",
      "목적 및 출하담당",
      "비고",
      "소유",
      "유상·무상",
      "사용처",
      "상대",
    ];
    for (const label of labels) {
      assert.ok(!card.includes(label), `카드에 이름표(${label})를 손으로 적었다`);
      assert.ok(!table.includes(label), `표에 이름표(${label})를 손으로 적었다`);
    }
  });

  /**
   * 🔴 **가운데 수량 열은 이름표까지 갈린다** — 사용처 기입란은 「사용 재고」, 입고 기입란은 「입고」,
   *    수량 변경 기록은 「변동」. 두 곳에 적히면 카드만 「변동」이라고 말하는 날이 온다.
   */
  it("🔴 가운데 수량 열의 이름표 셋이 한 표에서 온다 — `DELTA_LABEL`", () => {
    assert.ok(
      /const DELTA_LABEL: Record<Sheet, string> = \{ USE: "사용 재고", RECEIVE: "입고", CHANGE: "변동" \};/.test(page),
      "시트별 이름표 표가 사라졌거나 글자가 바뀌었다",
    );
    for (const label of ["사용 재고", "변동"]) {
      assert.equal(count(page, label), 1, `${label} 가 두 곳에 적혔다`);
      assert.ok(!card.includes(label) && !table.includes(label), `${label} 를 카드나 표에 손으로 적었다`);
    }
  });

  it("🔴 세 갈래의 칸이 `entryColumns` 안에서 갈린다 — 어느 칸이 어느 시트의 것인지", () => {
    for (const only of [
      'onlyUse({ key: "intake"',
      'onlyChange({ key: "kind"',
      'onlyUse({ key: "purposeActor"',
      'onlyChange({ key: "actor"',
      'onlyUse({ key: "charge"',
      'onlyUse({ key: "usagePlace"',
      'onlyChange({ key: "counterparty"',
    ]) {
      assert.ok(columnsFn.includes(only), `${only}… 갈래가 사라졌다 — 그 칸이 모든 시트에 서거나 어디에도 안 선다`);
    }
    // 🔵 나머지는 세 갈래 모두에 선다 — 갈림 밖에 그냥 적혀 있다.
    for (const always of ['{ key: "no"', '{ key: "date"', '{ key: "before"', '{ key: "delta"', '{ key: "after"', '{ key: "note"', '{ key: "owner"']) {
      assert.ok(columnsFn.includes(always), `${always}… 칸이 사라졌다`);
    }
    // 🔵 다섯 칸의 차례는 여전히 `PART_FIELDS` 한 표가 쥔다(2026-10-16). 화면 전체는 part-field-order 가 잰다.
    assert.ok(columnsFn.includes("PART_FIELDS.map("), "다섯 칸을 손으로 적고 있다 — 차례가 두 곳이 된다");
  });

  it("🔴 표 머리글도 본문도 손으로 적은 칸이 없다 — `<th>` 둘, `<td>` 둘", () => {
    // 🔵 여는 딱지만 센다 — `<th` 로 세면 `<thead>` 가 함께 걸린다(2026-10-22 실측).
    assert.equal([...table.matchAll(/<th[\s>]/g)].length, 2, "표 머리글에 손으로 적은 칸이 있다 (`cols` 를 도는 하나 + 단추 칸 하나여야 한다)");
    assert.equal([...table.matchAll(/<td[\s>]/g)].length, 2, "표 본문에 손으로 적은 칸이 있다 (`cols` 를 도는 하나 + 단추 칸 하나여야 한다)");
  });
});

describe("🔴 값은 표와 카드가 **같은 함수**로 그린다 (2026-10-22)", () => {
  it("🔴 값을 그리는 함수가 하나다", () => {
    assert.equal(count(page, "function entryCellBody("), 1, "값을 그리는 함수가 둘이다");
    assert.ok(card.includes("entryCellBody(e, l, c.key)"), "카드가 제 모양으로 값을 빚는다");
    assert.ok(table.includes("entryCellBody(e, l, c.key)"), "표가 제 모양으로 값을 빚는다");
  });

  it("🔴 칸이 하나 늘면 타입 검사가 멈춘다 — `never` 장치", () => {
    assert.ok(page.includes("const unhandled: never = key;"), "칸이 늘 때 한쪽을 잊는 것을 막는 장치가 사라졌다");
  });

  it("🔴 카드도 표도 값을 **스스로 빚지 않는다** — 꼴만 입힌다", () => {
    for (const [where, text] of [
      ["카드", card],
      ["표", table],
    ] as const) {
      for (const builder of ["formatQuantity", "formatDelta", "sheetNoText", "ENTRY_TYPE_LABEL", "OWNER_LABEL", "CHARGE_LABEL", "PURPOSE_LABEL", "PART_FIELDS"]) {
        assert.ok(!text.includes(builder), `${where} 가 ${builder} 로 값을 직접 빚는다 — 값이 두 곳에서 만들어진다`);
      }
    }
  });

  it("🔵 값이 빈 칸은 카드에 안 그린다 — 「도번 -」이 줄마다 서면 있는 값이 묻힌다", () => {
    assert.ok(card.includes("!isEntryCellBlank(e, l, c.key)"), "카드가 빈 칸을 거르지 않는다");
    assert.ok(table.includes("isEntryCellBlank(e, l, c.key)"), "표가 빈 칸 판정을 따로 적고 있다");
    // 🔵 표는 `-` 로 자리를 지킨다(열이 밀리면 안 된다) — 비고만 빼고. 그 예외도 한 자리다.
    assert.ok(/const TABLE_DASH_SKIP: ReadonlySet<EntryColumnKey> = new Set<EntryColumnKey>\(\["note"\]\);/.test(page), "표의 `-` 예외 목록이 바뀌었다 — 1024px 이상의 글자가 달라진다");
  });

  it("🔵 숫자는 세로가 맞는다 — 카드도 `.tabular` 를 쓴다", () => {
    assert.ok(card.includes("tabular"), "카드의 숫자에 .tabular 가 없다");
  });

  /**
   * 🔴 좁은 칸에서 **이름표만 윗줄에 남고 값이 아랫줄로** 떨어진 적이 있다
   *    (`src/components/stock/RepairCaseInfo.tsx` 가 같은 문제를 겪고 고쳤다).
   *    `inline-block` 이 **함께** 있어야 쌍이 통째로 내려간다.
   */
  it("🔴 이름표와 값은 한 쌍으로 붙어 다닌다", () => {
    assert.ok(card.includes("inline-block whitespace-nowrap"), "이름표+값 쌍이 갈라질 수 있다 — RepairCaseInfo 가 고친 그 문제다");
    assert.ok(src("src/components/stock/RepairCaseInfo.tsx").includes("inline-block whitespace-nowrap"), "본보기(RepairCaseInfo)에서 그 방식이 사라졌다 — 둘 중 하나가 틀어진 것이다");
  });
});

/**
 * ============================================================================
 * 🔴 줄에서 되던 것이 카드에서도 된다
 * ============================================================================
 * 특히 **취소선**: 되돌려진 줄은 회색 취소선으로 서 있다. 카드에서 그것이 빠지면 **취소된 줄이
 * 멀쩡한 줄처럼 보인다** — 수량이 맞는지 세는 사람이 두 번 센다.
 */
describe("🔴 줄에서 되던 것이 카드에서도 된다 (2026-10-22)", () => {
  it("🔴 취소된 줄은 카드에서도 회색 취소선이다", () => {
    const strike = 'l.corrected ? "text-zinc-400 line-through" : ""';
    assert.ok(card.includes(strike), "카드에서 취소선이 빠졌다 — 되돌려진 줄이 멀쩡한 줄처럼 보인다");
    assert.ok(table.includes(strike), "표에서 취소선이 사라졌다");
  });

  it("🔵 「취소됨」 딱지는 취소선에서 빠져나온다 — 딱지 글자까지 그어지면 읽기 어렵다", () => {
    assert.ok(page.includes("bg-red-50 text-red-800 no-underline"), "딱지의 no-underline 이 사라졌다");
    assert.equal(count(page, "취소됨"), 1, "딱지를 두 벌 적어 두었다 — 카드와 표가 갈린다");
  });

  it("🔴 [기록 취소] 단추의 조건이 한 자리다 — 표의 마지막 칸과 카드의 맨 아랫줄이 같은 함수를 쓴다", () => {
    assert.equal(count(page, "function correctButtonFor("), 1, "단추를 그리는 함수가 둘이다");
    assert.ok(card.includes("correctButtonFor(e, l, isAdmin)"), "카드에 [기록 취소] 단추가 없다");
    assert.ok(table.includes("correctButtonFor(e, l, isAdmin)"), "표에서 [기록 취소] 단추가 사라졌다");
    // 🔴 누가 누를 수 있는지도 한 자리여야 한다.
    assert.equal(count(page, "if (!isAdmin || l.corrected || e.type === \"CORRECTION\") return null;"), 1, "단추의 조건이 바뀌었거나 두 곳이 됐다");
  });

  it("🔵 부품 상세로 가는 길은 그대로다 — 카드도 같은 링크를 쓴다(`entryCellBody` 하나)", () => {
    assert.equal(count(page, "/?part=${l.partNo}"), 1, "부품 상세 주소를 두 곳에서 빚는다");
  });
});

/**
 * ============================================================================
 * 🔵 **거르기·권한·기록의 뜻은 한 글자도 안 바뀌었다** — 이 조각은 배치만 바꿨다.
 * ============================================================================
 */
describe("🔵 이 조각이 건드리지 않은 것 (2026-10-22)", () => {
  const raw = src("src/app/(app)/entries/page.tsx");

  it("권한 가름이 그대로다 — 기록 권한자와 관리자", () => {
    assert.ok(raw.includes('const canRecord = roleAtLeast(session.user.role, "STAFF");'), "기록 권한 가름이 바뀌었다");
    assert.ok(raw.includes('const isAdmin = roleAtLeast(session.user.role, "ADMIN");'), "관리자 가름이 바뀌었다");
  });

  it("건의 비고는 지금까지처럼 표 위에 제 줄로 선다", () => {
    assert.ok(raw.includes("{e.note ? <p"), "건의 비고 줄이 바뀌었다 — tests/request-note-screens.test.ts 가 같은 것을 잰다");
  });
});
