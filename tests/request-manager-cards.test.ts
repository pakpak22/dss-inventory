import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * 부품 요청 관리 목록 — **좁은 화면은 카드, 1024px 이상은 표** (2026-10-22 쓰는 분 요청)
 * ============================================================================
 * 「부품 요청 관리 목록을 휴대폰에서 읽을 수 있게.」 이 표는 `min-w-[64rem]`(=1024px)에 가로
 * 스크롤이라, 폭 360px 짜리 휴대폰에서는 **첫 서너 칸만 보이고 나머지는 화면 밖**이다.
 *
 * 🔴 **이 저장소에는 화면 렌더 시험이 없다**(`tests/part-field-order.test.ts` 머리말). 그래서 배치와
 *    「한 자리에 적혔나」는 **파일 글자에서** 잰다. 느슨한 시험이지만, 여기서 재는 넷은 하나만
 *    어긋나도 **오류 없이 조용히** 틀어진다:
 *      ① 인쇄가 표가 아니라 카드로 나간다 (눈으로 확인하기 번거로워 오래 간다)
 *      ② 🔴 **단추 조건이 두 벌이 된다** — 「어떤 줄은 [불출 신청], 어떤 줄은 [확인]」을 가르는
 *         `approvalRequired` 가 한쪽에서만 틀어지면 **승인 절차를 건너뛰는 단추**가 생긴다
 *      ③ 카드가 칸을 다시 적어 표와 다른 것을 그린다 (두 화면이 같은 신청을 다르게 말한다)
 *      ④ 카드에서만 보이는 단추가 생긴다 (표는 숨기는데 카드는 내민다)
 *
 * 🔵 본보기는 같은 날 먼저 바뀐 재고 현황이다 — `tests/parts-list-cards.test.ts`. 낱말도 짝도 그쪽 것이다.
 * ============================================================================
 */

/** 🔴 줄바꿈을 LF 로 눕혀서 읽는다 — 이 저장소의 소스는 CRLF 가 섞여 있다. */
const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석을 떼어 낸 코드만. 🔴 **글자로 재는 시험은 주석까지 긁는다** — 함정을 설명하려고 주석에 적어
 * 둔 인용 때문에 시험이 깨진 적이 있다(2026-10-16 `tests/part-limit-quantity.test.ts`,
 * 2026-10-22 `tests/parts-list-cards.test.ts`). 🔴 **이 화면이 특히 그렇다**: 아래에서 세는 글자
 * (`approvalRequired=` · 「처리할 것 없음」)가 **설계 까닭을 적은 긴 주석에 그대로 인용돼 있다.**
 * 설명을 지우는 대신 **재는 쪽을 좁힌다.**
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // 블록 주석(JSX 의 {/* … */} 포함)
    .replace(/\/\/.*$/gm, ""); // 줄 주석
}

const screen = src("src/components/stock/RequestManagerScreen.tsx");
/** 🔴 아래는 전부 **주석을 뗀 코드**에서 잰다(위 처방). */
const code = stripComments(screen);

/** 카드 묶음(좁은 화면)의 바깥 상자. 🔴 모양이 바뀌었으면 이 시험도 함께 고쳐라. */
const CARD_WRAPPER = '<ul className="no-print flex flex-col gap-2 lg:hidden">';
/** 표를 감싼 상자 — 그 안의 class 를 뽑는다. */
const TABLE_WRAPPER =
  /<div className="([^"]*)">\s*<table className="w-full min-w-\[64rem\] border-separate border-spacing-x-0 border-spacing-y-2 text-sm">/;

const cardAt = code.indexOf(CARD_WRAPPER);
const wrapper = TABLE_WRAPPER.exec(code);
assert.notEqual(cardAt, -1, "카드 묶음의 바깥 상자를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
assert.ok(wrapper, "표를 감싼 상자를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");

/** 카드 쪽 글자만 / 표 쪽 글자만. 🔴 끝을 끊지 않으면 다른 쪽 글자에 걸려 헛통과한다. */
const card = code.slice(cardAt, wrapper.index);
const table = code.slice(wrapper.index);
assert.ok(card.trim().length > 0 && table.trim().length > 0, "잘라 낸 토막이 비었다 — 시험이 아무것도 재지 않는다");

describe("배치 — 카드와 표가 동시에 서지 않는다 (2026-10-22)", () => {
  it("🔴 카드는 `lg` 미만에만 선다", () => {
    assert.ok(CARD_WRAPPER.includes("lg:hidden"), "카드 묶음에 lg:hidden 이 없다 — 1024px 이상에서 표와 함께 선다");
  });

  it("🔴 표는 `lg` 이상에만 선다 — 지금 표 그대로", () => {
    assert.ok(wrapper[1].includes("hidden"), "표가 좁은 화면에서도 선다 — 카드와 겹친다");
    assert.ok(wrapper[1].includes("lg:block"), "표가 1024px 이상에서 안 선다");
    assert.ok(wrapper[1].includes("overflow-x-auto"), "표의 가로 스크롤이 사라졌다 — 1024px 이상의 동작이 달라진다");
  });

  it("🔵 표의 머리글 일곱은 그대로다 — 이 조각은 **배치만** 바꿨다", () => {
    for (const head of ["신청 일시", "종류", "무엇에", "신청자", "신청 항목", "상태"]) {
      assert.ok(table.includes(head), `표에서 [${head}] 열이 사라졌다`);
    }
    assert.ok(table.includes("showActions ? <th"), "단추 열의 울타리가 바뀌었다 — 빈 열이 서거나 단추가 사라진다");
  });
});

/**
 * ============================================================================
 * 🔴 인쇄 — 이 조각에서 가장 깨지기 쉬운 곳
 * ============================================================================
 * 재고 현황과 달리 이 화면에는 **전용 인쇄 화면이 없다.** 종이로 뽑는 길은 사람이 이 화면에서
 * **Ctrl+P** 를 누르는 것뿐이고, 그 길에는 `RequestManagerScreen` 이 그대로 나간다.
 * A4 가로는 CSS 로 **약 1047px** 이라 `lg`(1024px) 경계에 아슬아슬하게 걸린다 — 브라우저·여백·배율에
 * 따라 1024px 아래로 떨어지면 **종이에 카드가 나간다.** 운에 맡기지 않는다.
 */
describe("🔴 인쇄는 언제나 표다 (2026-10-22)", () => {
  it("🔵 이 화면에는 **전용 인쇄 화면이 없다** — 그래서 Ctrl+P 가 유일한 길이다", () => {
    const printPages = readdirSync(new URL("../src/app/print", import.meta.url), { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const dir of printPages) {
      const page = src(`src/app/print/${dir.name}/page.tsx`);
      assert.ok(!page.includes("RequestManagerScreen"), `전용 인쇄 화면(${dir.name})이 이 목록 조각을 쓴다 — 그러면 이 시험의 전제를 다시 보라`);
    }
  });

  it("🔴 카드는 종이에 안 나간다 — `no-print`", () => {
    assert.ok(CARD_WRAPPER.includes("no-print"), "카드 묶음에 no-print 가 없다 — Ctrl+P 로 뽑으면 종이에 카드가 나간다");
  });

  it("🔴 표는 폭과 상관없이 종이에 나간다 — `print:block` 이 `hidden` 을 이긴다", () => {
    assert.ok(wrapper[1].includes("print:block"), "표에 print:block 이 없다 — 인쇄 폭이 1024px 아래로 떨어지면 표도 카드도 없는 빈 종이가 나온다");
  });

  it("🔵 `no-print` 는 실제로 숨기는 규칙이다 — 글자만 적어 둔 것이 아니다", () => {
    const css = src("src/app/globals.css");
    const atPrint = css.slice(css.indexOf("@media print"));
    assert.ok(atPrint.includes(".no-print { display: none !important; }"), "globals.css 의 @media print 에서 .no-print 규칙이 사라졌다");
  });

  it("🔵 단추 열은 전과 같이 종이에서 빠진다 — 종이에 누를 수 있는 것은 없다", () => {
    assert.ok(table.includes('<td className={`${TD} no-print`}>'), "표의 단추 칸에서 no-print 가 사라졌다");
  });
});

/**
 * ============================================================================
 * 🔴 단추 조건은 **한 자리**다 — 이 조각에서 제일 위험한 곳
 * ============================================================================
 * 조건이 셋이다: `actionStatus !== null && (isAdmin || canCancel)` → `issueLock` → `isAdmin`.
 * 베껴 두면 「어떤 줄은 [불출 신청], 어떤 줄은 [확인]」을 가르는 `approvalRequired[r.id]` 같은 값이
 * **한쪽에서만 틀어져도 승인 절차를 건너뛰는 단추**가 생긴다. 재고가 나가는 자리이고, 그 어긋남은
 * 오류를 내지 않아 **아무도 신고하지 않는다.**
 */
describe("🔴 단추 조건이 한 자리다 (2026-10-22)", () => {
  it("🔴 단추 묶음을 그리는 자리가 **하나**다", () => {
    assert.equal([...code.matchAll(/const rowActions = /g)].length, 1, "줄의 단추를 짓는 함수가 둘이다");
    assert.equal([...code.matchAll(/<RequestActions\b/g)].length, 1, "단추 묶음을 두 벌 적어 두었다 — 한쪽만 고쳐지는 날이 온다");
    assert.equal([...code.matchAll(/<IssueLockNotice\b/g)].length, 1, "잠긴 자리의 길 안내를 두 벌 적어 두었다");
    assert.equal([...code.matchAll(/처리할 것 없음/g)].length, 1, "「처리할 것 없음」을 두 벌 적어 두었다");
  });

  it("🔴 **줄별 승인 절차 값이 한 번만 넘어간다** — 두 벌이 되면 승인 절차를 건너뛰는 단추가 생긴다", () => {
    assert.equal([...code.matchAll(/approvalRequired=\{/g)].length, 1, "`approvalRequired` 를 두 자리에서 넘긴다 — 한쪽이 틀어져도 오류가 안 난다");
    assert.ok(code.includes("approvalRequired={approvalRequired[r.id] ?? false}"), "줄에 그 줄의 값을 넘기지 않는다");
  });

  it("🔴 표도 카드도 **그 한 함수**를 부른다 — 조건을 저마다 다시 적지 않는다", () => {
    for (const [name, slice] of [["카드", card], ["표", table]] as const) {
      assert.ok(slice.includes("rowActions(r)"), `${name} 가 단추를 제 손으로 그린다`);
      assert.ok(!slice.includes("canCancel"), `${name} 에 단추 조건이 다시 적혀 있다`);
      assert.ok(!slice.includes("actionStatus"), `${name} 에 단추 조건이 다시 적혀 있다`);
    }
  });

  it("🔴 **카드에서만 보이는 단추가 없다** — 표의 단추 열과 같은 값으로 가린다", () => {
    // 🔵 `showActions` 가 거짓이면 표는 단추 열 자체를 안 그린다. 카드가 그 울타리를 안 쓰면,
    //    관리자가 아닌 사람에게 **표에는 없고 카드에만 있는 자리**가 생긴다(결재 잠금 안내가 그렇다).
    assert.ok(card.includes("showActions ? rowActions(r) : null"), "카드가 단추 열의 울타리를 안 쓴다");
    assert.ok(table.includes("showActions ? <td"), "표의 단추 열 울타리가 바뀌었다 — 시험이 낡았다");
  });

  it("🔴 화면이 권한을 **다시 판정하지 않는다** — 서버가 내려보낸 값만 쓴다", () => {
    // 🔵 `tests/part-issue-gate.test.ts` ⑥ 과 같은 울타리다. 거기가 깨지면 여기도 깨지도록 겹쳐 둔다.
    assert.ok(!/isPartIssueApprovalRouteInForce\(/.test(screen), "화면이 절차 판정을 스스로 한다");
    assert.ok(!/partIssueLockFor\(/.test(screen), "화면이 잠금 판정을 스스로 한다");
  });
});

/**
 * ============================================================================
 * 🔴 카드는 **둘째 사본**이 아니다
 * ============================================================================
 * 칸이 하나 늘 때 고칠 곳은 **한 군데**여야 한다. 재고 현황에서 같은 날 못 박은 것과 같은 규칙이고,
 * 거기 주석에 적힌 까닭(「차례가 어긋나면 값이 한 칸씩 밀린다」)이 여기서도 그대로다.
 */
describe("🔴 카드가 칸을 다시 적지 않는다 — 표와 같은 함수가 그린다 (2026-10-22)", () => {
  it("🔴 내용을 만드는 함수가 칸마다 **하나**다", () => {
    for (const fn of ["function typeCell\\(", "function aboutCell\\(", "function requesterCell\\(", "function statusBadge\\(", "const statusNotes = "]) {
      assert.equal([...code.matchAll(new RegExp(fn, "g"))].length, 1, `${fn} 가 둘이다 — 표와 카드가 다른 것을 그리게 된다`);
    }
  });

  it("🔴 표와 카드가 그 함수들을 **함께** 부른다", () => {
    for (const [name, slice] of [["카드", card], ["표", table]] as const) {
      for (const call of ["typeCell(r, \"", "aboutCell(r)", "requesterCell(r)", "statusBadge(r, issueLock)", "statusNotes(r)", "<RequestItems lines={r.lines} />"]) {
        assert.ok(slice.includes(call), `${name} 가 ${call} 를 안 쓴다`);
      }
    }
  });

  it("🔴 곁들이 조각들을 **베껴 만들지 않았다** — 카드용 한 벌을 더 짓지 않았다", () => {
    // 🔵 전부 공용 조각이다. 카드용으로 한 벌 더 만들면 「비면 안 그린다」가 두 벌이 되고,
    //    이 저장소에는 화면 렌더 시험이 없어 한쪽만 틀어져도 아무도 못 본다.
    // 🔴 다섯은 **공용 함수 안에서 한 번만** 그려진다(`aboutCell` · `statusNotes`) — 그 함수를
    //    표와 카드가 함께 부르므로, 자리가 둘로 늘었다면 누가 베낀 것이다.
    for (const piece of ["<RepairCaseInfo\\b", "<RequestNote\\b", "<IssueApprovalTrail\\b", "<HoldReason\\b", "<DecisionNote\\b"]) {
      assert.equal([...code.matchAll(new RegExp(piece, "g"))].length, 1, `${piece} 를 두 벌 그린다`);
    }
    // 🔵 신청 항목만 **자리가 둘**이다 — 그 조각이 규칙과 모양을 통째로 쥐고 있어 감쌀 것이 없고,
    //    표와 카드가 같은 조각을 그대로 부른다(바로 위 시험이 두 자리를 다 못 박는다).
    assert.equal([...code.matchAll(/<RequestItems\b/g)].length, 2, "신청 항목을 그리는 자리가 표·카드 둘이 아니다 — 한쪽에서 사라졌거나 베껴 적었다");
  });

  it("🔵 숫자는 세로가 맞는다 — 카드도 `.tabular` 를 쓴다", () => {
    assert.ok(card.includes("tabular"), "카드의 숫자에 .tabular 가 없다");
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

/**
 * ============================================================================
 * 카드 한 장의 **차례** — 좁은 화면에서 먼저 읽혀야 하는 것
 * ============================================================================
 * 「이 신청이 무엇이고 내가 뭘 해야 하나」가 먼저 읽히고, **누르는 것은 맨 아래**다(엄지로 닿는
 * 자리이고, 읽고 나서 누르는 차례다). 표에서는 눈이 가로로 훑지만 카드에서는 세로로만 훑으므로,
 * 차례가 곧 「무엇을 먼저 보여 주기로 했나」 그 자체다.
 */
describe("카드 한 장의 차례 (2026-10-22)", () => {
  it("🔴 상태 배지가 맨 위, 단추가 맨 아래", () => {
    const at = (needle: string): number => {
      const i = card.indexOf(needle);
      assert.notEqual(i, -1, `카드에서 ${needle} 를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라`);
      return i;
    };
    const order = ["statusBadge(r, issueLock)", "aboutCell(r)", "requesterCell(r)", "<RequestItems lines={r.lines} />", "statusNotes(r)", "rowActions(r)"];
    const places = order.map(at);
    for (let i = 1; i < places.length; i += 1) {
      assert.ok(places[i - 1] < places[i], `카드의 차례가 틀어졌다: ${order[i - 1]} 가 ${order[i]} 보다 뒤에 있다`);
    }
  });

  it("🔵 신청 일시는 맨 윗줄에 **작게** 선다 — 정확한 값은 손을 올렸을 때", () => {
    assert.ok(card.includes("title={fullAt(r.requestedAt)}"), "카드에서 정확한 시각을 볼 길이 사라졌다");
    assert.ok(card.includes("formatRequestedAt(r.requestedAt)"), "카드에 신청 일시가 없다");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 신청 건 하나 = 네모 하나 (2026-10-23 쓰는 분 요청)
 *
 * 「신청 건별로의 구분감이 확실하지 않다. 개별로 네모 박스를 쳐 달라」가 요청 그대로다.
 * 그 전에는 가는 선 하나로만 갈랐는데(`divide-y` · `border-t`), 한 건이 여러 줄인 이
 * 화면에서는 — 항목 표 · 결재선 · 보류/반려 상자 · 단추가 다 한 건 안에 들어간다 —
 * 어디까지가 한 건인지 읽히지 않았다.
 *
 * 🔴 **모양을 재는 시험이라 눈 확인을 대신하지 못한다.** 여기서 재는 것은 「테두리를
 *    두르는 글자가 아직 있는가」뿐이다. 실제로 네모로 보이는지는 띄워 봐야 안다.
 *    그래도 적어 두는 까닭은, 이 글자들이 **지워져도 오류가 안 나서** 그렇다 —
 *    화면은 조용히 2026-10-22 이전으로 돌아가고 아무도 신고하지 않는다.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("건별 구분 — 신청 건 하나가 네모 하나다 (2026-10-23)", () => {
  it("🔴 폰 카드는 저마다 테두리를 두른다", () => {
    assert.ok(code.includes("const CARD_BOX ="), "CARD_BOX 가 사라졌다 — 카드마다 두르던 테두리가 없어졌다");
    const box = /const CARD_BOX = "([^"]*)"/.exec(code);
    assert.ok(box, "CARD_BOX 의 값을 못 읽었다");
    for (const cls of ["rounded-lg", "border", "bg-white"]) {
      assert.ok(box[1].includes(cls), `카드 상자에서 ${cls} 가 사라졌다 — 네모가 안 그려진다`);
    }
    assert.ok(card.includes("className={CARD_BOX}"), "카드 <li> 가 CARD_BOX 를 안 쓴다");
  });

  it("🔴 카드 사이에 간격이 있다 — 붙어 있으면 네모를 쳐도 한 덩어리로 보인다", () => {
    assert.ok(CARD_WRAPPER.includes("gap-2"), "카드 묶음에서 사이 간격이 사라졌다");
    assert.ok(!CARD_WRAPPER.includes("divide-y"), "가는 선 가르기(divide-y)가 돌아왔다 — 네모와 겹쳐 선이 두 겹으로 보인다");
  });

  it("🔴 표도 줄 하나가 네모 하나다", () => {
    assert.ok(code.includes("const ROW_BOX ="), "ROW_BOX 가 사라졌다 — 표의 줄마다 두르던 테두리가 없어졌다");
    const box = /const ROW_BOX = \[([\s\S]*?)\]\.join\(" "\)/.exec(code);
    assert.ok(box, "ROW_BOX 의 값을 못 읽었다");
    // 🔴 좌우 테두리가 **첫 칸·끝 칸에만** 있어야 줄 전체가 하나의 네모가 된다.
    //    모든 칸에 두르면 칸마다 네모가 되어 그냥 격자다.
    for (const cls of ["[&>td]:border-y", "[&>td:first-child]:border-l", "[&>td:last-child]:border-r"]) {
      assert.ok(box[1].includes(cls), `표의 줄 상자에서 ${cls} 가 사라졌다`);
    }
    assert.ok(table.includes("className={ROW_BOX}"), "표의 <tr> 이 ROW_BOX 를 안 쓴다");
  });

  it("🔴 표는 `border-separate` 다 — `border-collapse` 로는 네모가 안 그려진다", () => {
    // 이웃한 줄의 선이 하나로 합쳐져 격자가 되고, 줄 사이 간격도 줄 수 없다.
    assert.ok(wrapper, "표를 감싼 상자를 못 찾았다");
    assert.ok(!/border-collapse/.test(table.slice(0, 400)), "표가 border-collapse 로 돌아갔다 — 줄마다 네모가 안 그려진다");
    assert.ok(/border-spacing-y-\d/.test(table.slice(0, 400)), "표의 줄 사이 간격이 사라졌다 — 네모들이 붙어 한 덩어리로 보인다");
  });

  it("🔵 바깥 흰 패널은 걷었다 — 네모 안에 네모가 되면 구분감이 오히려 묻힌다", () => {
    assert.ok(!/<section className="rounded-lg border border-zinc-200 bg-white">/.test(code), "바깥 패널이 돌아왔다 — 건별 네모와 이중 상자가 된다");
  });
});
