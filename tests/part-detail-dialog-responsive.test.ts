import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * 부품 상세 창이 폰에서 넘치지 않는다 (2026-10-22, 쓰는 분 요청)
 * ============================================================================
 * 쓰는 분이 폰으로 찍어 보내 주신 화면에서 이렇게 깨졌다 — 제목 「예시 PCB-007」이 한 자씩
 * 세로로 쪼개지고, 딱지 넷이 한 줄에 하나씩 네 줄을 먹고, 단추 묶음(반출·입고·수량 조정·
 * 변경 이력·수정·닫기)이 화면 밖으로 잘렸다.
 *
 * 까닭은 머리 줄 하나였다. 가로 한 줄인데 줄바꿈이 없고, 오른쪽 단추 묶음에 `shrink-0` 이
 * 붙어 **줄어들 줄 모르는 칸**이었다. 그래서 폭이 모자라면 왼쪽만 혼자 min-content 까지
 * 찌그러졌고, 한글은 아무 데서나 꺾이므로 그 min-content 가 **한 자 폭**이었다.
 *
 * ── 🔴 왜 소스 글자로 재는가 ───────────────────────────────────────────
 * 이 저장소에는 **화면 렌더 시험이 없다**(`tests/part-field-order.test.ts` 머리말).
 * 배치는 `tests/app-header-responsive.test.ts`·`tests/parts-list-cards.test.ts` 가 쓰는
 * 처방을 그대로 쓴다 — 파일 글자에서 잰다.
 *
 * 🔴 **주석은 걷어내고 잰다.** 고친 파일의 주석에는 「`lg:shrink-0` 으로 좁혔다」·
 *    「`break-keep`」 같은 말이 까닭과 함께 길게 적혀 있다. 주석이 코드 대신 걸리면 다음
 *    사람이 **코드를 되돌려 놓아도 시험이 통과한다**(2026-10-16·10-22 에 이미 두 번 당했다).
 *
 * 🔵 재는 것은 **배치뿐**이다 — 누가 무엇을 보는지(`canRecord`·`canEdit`)와 단추가 가는 곳,
 *    한계수량·고객사 품명의 자격은 `tests/part-limit-quantity.test.ts` 가 따로 지킨다.
 *    여기서는 그 규칙이 **손대지 않은 채로 남아 있는지**만 센다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 주석을 걷어낸 코드만. 🔵 떼고 나서 빈 글자가 아닌 것을 함께 확인한다(떼는 규칙이 낡으면 전부 조용히 통과한다). */
function codeOnly(source: string): string {
  const out = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(out.trim().length > 0, "주석을 떼고 나니 아무것도 안 남았다 — 떼는 규칙이 더는 안 맞는다");
  return out;
}

const DIALOG = "src/components/parts/PartDetailDialog.tsx";
const code = codeOnly(src(DIALOG));

/**
 * 클래스 적힌 자리 한 곳을 정규식으로 집어 **클래스 목록**으로 푼다.
 * 🔴 못 찾으면 멈춘다 — 빈 목록으로 흘러가면 아래 단언이 전부 통과한다.
 * 🔵 클래스 **이름만** 보고 적힌 **차례는 안 본다** — CSS 는 차례를 안 따지는데 시험이 따지면,
 *    뜻이 하나도 안 바뀐 손질에도 빨개져 다음 사람이 시험을 믿지 않게 된다.
 */
function classesOf(re: RegExp, what: string): string[] {
  const hit = re.exec(code);
  assert.ok(hit, `${what} 의 className 을 찾지 못했다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라`);
  return hit[1].split(/\s+/).filter(Boolean);
}

/** 창 전체(dialog 자신) */
const dialogClasses = classesOf(/<dialog[\s\S]*?className="([^"]*)"/, "창(dialog)");
/** 부품이 있을 때의 바깥 상자 */
const bodyClasses = classesOf(/<div className="(flex flex-col gap-4 p-3 lg:gap-5[^"]*)">/, "창 안쪽 바깥 상자");
/** 머리 줄 — 제목·딱지 묶음과 단추 묶음을 담는 그 줄 */
const headClasses = classesOf(/<div className="(flex flex-col gap-3 lg:flex-row[^"]*)">/, "머리 줄");
/** 제목 */
const titleClasses = classesOf(/<h2 className="(text-base font-semibold break-keep[^"]*)">/, "제목(h2)");
/** 단추 묶음 */
const BUTTON_ROW_RE = /<div className="(flex flex-wrap gap-2[^"]*)">/;
const buttonRowClasses = classesOf(BUTTON_ROW_RE, "단추 묶음");
/** 값 칸 묶음(dl) */
const dlClasses = classesOf(/<dl className="([^"]*)">/, "값 칸 묶음(dl)");
/** 단추 상수 · 딱지 상수 */
const btnClasses = classesOf(/const BTN =\s*"([^"]*)"/, "BTN 상수");
const badgeClasses = classesOf(/const BADGE = "([^"]*)"/, "BADGE 상수");

/** 단추 묶음 안쪽 글자만. 🔴 끝을 끊지 않으면 뒤의 값 칸 글자에 걸려 헛통과한다. */
function buttonBlock(): string {
  const from = code.search(BUTTON_ROW_RE);
  const to = code.indexOf("<dl ", from);
  assert.ok(from > 0 && to > from, "단추 묶음과 그 뒤의 <dl> 사이를 끊지 못했다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
  return code.slice(from, to);
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 🔴 머리 줄이 좁은 화면에서 **세로로 쌓인다**
 * ═════════════════════════════════════════════════════════════════════════ */

describe("① 🔴 머리 줄 — 좁은 화면에서는 쌓고, lg 이상은 예전 그대로", () => {
  it("🔴 좁은 화면에서 세로로 쌓는다", () => {
    assert.ok(headClasses.includes("flex"), "머리 줄이 flex 가 아니다");
    assert.ok(headClasses.includes("flex-col"), "머리 줄이 좁은 화면에서 안 쌓인다 — 제목이 다시 한 자 폭까지 찌그러진다");
  });

  it("🔴 가로 한 줄은 **`lg` 이상에서만**이다 — 조건 없는 `flex-row` 가 돌아오지 않았다", () => {
    assert.ok(!headClasses.includes("flex-row"), "머리 줄에 조건 없는 flex-row 가 적혔다 — 폰에서 다시 가로 한 줄이 되어 찌그러진다");
    assert.ok(headClasses.includes("lg:flex-row"), "lg 이상에서 가로 한 줄로 안 돌아간다 — 넓은 화면이 예전과 달라진다");
  });

  it("🔴 넓은 화면의 맞춤 둘(`items-start`·`justify-between`)이 `lg` 로 그대로 남아 있다", () => {
    assert.ok(headClasses.includes("lg:items-start"), "lg 에서 위 맞춤이 사라졌다 — 단추 묶음이 제목 높이에 맞춰 늘어진다");
    assert.ok(headClasses.includes("lg:justify-between"), "lg 에서 양끝 맞춤이 사라졌다 — 단추 묶음이 제목 바로 옆에 붙는다");
    // 🔵 조건 없이 적히면 좁은 화면(flex-col)에서 세로 맞춤으로 읽혀 뜻이 달라진다.
    assert.ok(!headClasses.includes("items-start"), "items-start 가 조건 없이 적혔다 — 쌓인 줄에서는 세로 맞춤이 되어 폭이 안 늘어난다");
    assert.ok(!headClasses.includes("justify-between"), "justify-between 이 조건 없이 적혔다 — 쌓인 줄에서는 위아래로 벌어진다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 🔴 단추 묶음 — 좁은 화면에서는 **줄어들 수 있어야** 접힌다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("② 🔴 단추 여섯이 좁은 화면에서도 다 닿는다", () => {
  /**
   * 🔴 이것이 화면 밖으로 잘리던 **진짜 원인**이다. `flex-wrap` 이 있어도 그 칸이 안 줄어들면
   *    접히기 전에 묶음 전체가 제 max-content(단추 여섯을 한 줄에 늘어놓은 폭)를 고집한다.
   */
  it("🔴 좁은 화면에서 `shrink-0` 이 **아니다** — 접히기 전에 넘치던 그 칸", () => {
    assert.ok(
      !buttonRowClasses.includes("shrink-0"),
      "단추 묶음에 조건 없는 shrink-0 이 돌아왔다 — 좁은 화면에서 접히지 못하고 통째로 화면 밖으로 나간다([닫기] 가 안 닿는다)"
    );
    assert.ok(buttonRowClasses.includes("lg:shrink-0"), "lg 에서 안 깎이게 막는 울타리가 사라졌다 — 넓은 화면에서 단추 글자가 찌그러진다");
  });

  it("🔴 모자라면 **줄을 바꾼다**", () => {
    assert.ok(buttonRowClasses.includes("flex"), "단추 묶음이 flex 가 아니다");
    assert.ok(buttonRowClasses.includes("flex-wrap"), "단추 묶음이 안 접힌다");
  });

  it("🔵 오른쪽 맞춤은 `lg` 이상만 — 접힌 마지막 줄이 오른쪽에 매달리지 않는다", () => {
    assert.ok(buttonRowClasses.includes("lg:justify-end"), "lg 에서 오른쪽 맞춤이 사라졌다 — 넓은 화면이 예전과 달라진다");
    assert.ok(!buttonRowClasses.includes("justify-end"), "justify-end 가 조건 없이 적혔다");
  });

  it("🔴 단추 글자가 세로로 안 쪼개진다 — BTN 에 줄바꿈 금지 울타리", () => {
    assert.ok(btnClasses.includes("whitespace-nowrap"), "BTN 에 whitespace-nowrap 이 없다 — 「수량 조정」이 「수 / 량 / 조 / 정」으로 선다");
  });

  /** 🔴 **이 조각은 배치만 바꾼다** — 단추를 없애거나 좁은 화면에서 감추지 않았다. */
  it("🔴 단추 여섯이 그대로 있다 — 하나도 숨기지 않았다", () => {
    const block = buttonBlock();
    for (const label of ["반출", "입고", "수량 조정", "변경 이력", "수정", "닫기"]) {
      assert.ok(block.includes(label), `[${label}] 단추가 사라졌다`);
    }
    assert.ok(!/\bhidden\b/.test(block), "단추 묶음 안에 숨기는 클래스가 생겼다 — 좁은 화면에서 못 누르는 단추가 된다");
  });

  it("🔴 가는 곳과 자격 판정은 손대지 않았다", () => {
    const block = buttonBlock();
    for (const href of ["type=USE", "type=RECEIVE", "type=ADJUST", "/audit?part=", "/edit"]) {
      assert.ok(block.includes(href), `${href} 로 가는 길이 사라졌다`);
    }
    assert.equal((block.match(/canRecord \?/g) ?? []).length, 1, "기록 자격으로 가리는 자리가 늘거나 줄었다 — 이 조각은 배치만 바꾼다");
    assert.equal((block.match(/canEdit \?/g) ?? []).length, 1, "관리자 자격으로 가리는 자리가 늘거나 줄었다 — 이 조각은 배치만 바꾼다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 🔴 제목과 딱지
 * ═════════════════════════════════════════════════════════════════════════ */

describe("③ 🔴 제목이 가로로 보인다", () => {
  it("🔴 낱말 가운데서 안 꺾인다 — `break-keep`", () => {
    assert.ok(titleClasses.includes("break-keep"), "제목에 break-keep 이 없다 — 이름이 길어 줄이 넘어갈 때 한글 낱말이 가운데서 쪼개진다");
  });

  it("🔴 `lg` 이상은 예전 그대로 — 꺾는 규칙을 되돌려 둔다", () => {
    assert.ok(titleClasses.includes("lg:break-normal"), "lg 에서 꺾는 규칙을 안 되돌린다 — 넓은 화면의 줄바꿈 자리가 예전과 달라질 수 있다");
  });

  it("🔵 글자 크기·굵기는 그대로다 — 이 조각은 좁은 화면 배치만 바꾼다", () => {
    assert.ok(titleClasses.includes("text-base"), "제목 글자 크기가 바뀌었다");
    assert.ok(titleClasses.includes("font-semibold"), "제목 굵기가 바뀌었다");
  });
});

describe("③-2 🔴 딱지 넷이 가로로 흐른다", () => {
  it("🔴 딱지 하나하나가 안 쪼개진다 — BADGE 에 줄바꿈 금지", () => {
    assert.ok(badgeClasses.includes("whitespace-nowrap"), "BADGE 에 whitespace-nowrap 이 없다 — 「No. 7」이 세 줄로 선다");
  });

  it("🔴 딱지 줄은 접힌다 — 가로로 흐르다 넘치면 줄을 바꾼다", () => {
    const badgeRow = classesOf(/<div className="(flex flex-wrap gap-1\.5)">/, "딱지 줄");
    assert.ok(badgeRow.includes("flex-wrap"), "딱지 줄이 안 접힌다");
  });

  it("🔵 딱지 넷이 그대로다 — No. · 항목 · 분류 · 소유", () => {
    assert.equal((code.match(/<span className=\{BADGE\}>/g) ?? []).length, 4, "머리 줄의 딱지 수가 바뀌었다 — 이 조각은 배치만 바꾼다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 좁은 화면용으로 줄인 값마다 **`lg` 짝**이 있다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("④ 🔴 1024px 이상은 한 글자도 달라지지 않는다 — 줄인 값마다 되돌리는 짝", () => {
  /**
   * 🔴 짝이 빠지면 **넓은 화면이 조용히 좁아진다.** 오류는 한 줄도 안 나고, 폰에서 보면
   *    멀쩡하니 아무도 신고하지 않는다. 그래서 한 쌍씩 못 박는다.
   */
  const pairs: ReadonlyArray<readonly [string[], string, string, string]> = [
    [bodyClasses, "p-3", "lg:p-4", "창 안쪽 여백"],
    [bodyClasses, "gap-4", "lg:gap-5", "구역 사이 간격"],
    [dlClasses, "gap-x-4", "lg:gap-x-6", "값 칸 사이 가로 간격"],
    [btnClasses, "px-2", "lg:px-3", "단추 좌우 여백"],
  ];

  for (const [classes, narrow, wide, what] of pairs) {
    it(`🔴 ${what} — 좁은 화면만 줄이고 lg 에서 되돌린다`, () => {
      assert.ok(classes.includes(narrow), `${what} 의 좁은 화면 값(${narrow})이 없다`);
      assert.ok(classes.includes(wide), `${what} 를 lg 에서 안 되돌린다(${wide} 없음) — 넓은 화면이 예전보다 좁아진다`);
    });
  }

  it("🔴 값 칸이 나뉘는 규칙은 그대로다 — 2칸 → sm 3칸 → lg 5칸", () => {
    for (const c of ["grid-cols-2", "sm:grid-cols-3", "lg:grid-cols-5"]) {
      assert.ok(dlClasses.includes(c), `값 칸 묶음에서 ${c} 가 사라졌다 — 이 조각은 간격만 줄인다`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 🔴 폭과 높이는 **여기서 정하지 않는다**
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑤ 🔴 창의 폭·높이를 두 곳에서 정하지 않는다", () => {
  /**
   * 🔴 폭은 `w-full max-w-4xl`(여기)과 `globals.css` 의 좁은 화면 규칙이 함께 정한다.
   *    여기에 폭을 또 적으면 선택자 힘이 센 쪽이 **조용히** 이겨 한쪽이 아무 일도 안 한다.
   * 🔴 높이는 브라우저 기본 규칙이 이미 최대 높이와 세로 스크롤을 준다 — 창을 열 때
   *    `scrollTop` 을 0 으로 되돌리는 코드가 그 증거다. 여기서 덮으면 내용이 길 때
   *    **[닫기] 까지 굴러 올라갈 길이 막힌다.**
   */
  it("🔴 창에 폭은 둘(`w-full`·`max-w-4xl`)뿐이고 높이는 안 적는다", () => {
    assert.ok(dialogClasses.includes("w-full"), "창의 w-full 이 사라졌다");
    assert.ok(dialogClasses.includes("max-w-4xl"), "창의 max-w-4xl 이 사라졌다 — 넓은 화면에서 창이 끝없이 넓어진다");
    const heights = dialogClasses.filter((c) => /^(lg:)?(max-)?h-/.test(c));
    assert.deepEqual(heights, [], `창에 높이를 적었다: ${heights.join(" ")} — 브라우저 기본 최대 높이와 다퉈 세로 스크롤이 막힐 수 있다`);
    const overflows = dialogClasses.filter((c) => /overflow/.test(c));
    assert.deepEqual(overflows, [], `창에 넘침 규칙을 적었다: ${overflows.join(" ")} — 브라우저 기본 세로 스크롤을 덮는다`);
  });

  it("🔴 세로로 길어지면 창 안에서 굴러 [닫기] 로 돌아갈 수 있다 — 열 때 맨 위로 되돌린다", () => {
    assert.ok(code.includes("el.scrollTop = 0"), "창을 열 때 맨 위로 되돌리지 않는다 — 다른 부품을 열면 지난 부품의 스크롤 자리에서 시작한다");
  });

  it("🔴 좁은 화면의 폭은 `globals.css` 가 정한다 — 그 규칙이 그대로 있다", () => {
    const css = src("src/app/globals.css");
    assert.match(css, /dialog:modal\s*\{[^}]*width:/, "globals.css 의 좁은 화면 창 폭 규칙이 사라졌다 — 폰에서 창이 화면에 딱 붙는다");
    assert.match(css, /dialog \{ margin: auto; \}/, "창을 가운데 두는 규칙이 사라졌다 — 모든 팝업이 왼쪽 위 구석에 붙는다");
  });
});
