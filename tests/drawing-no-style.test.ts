import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DRAWING_NO_FONT_SIZE_MAX,
  DRAWING_NO_FONT_SIZE_MIN,
  DRAWING_NO_STYLE_DEFAULT,
  DRAWING_NO_STYLE_SAMPLE_VALUE,
  drawingNoValueStyle,
  isDrawingNoColor,
  isDrawingNoFontSize,
  isSameDrawingNoStyle,
  normalizeDrawingNoStyle,
  parseDrawingNoStyle,
  serializeDrawingNoStyle,
  validateDrawingNoStyleInput,
  type DrawingNoStyle,
} from "../src/lib/stock/drawing-no-style";
import { SETTING_DRAWING_NO_STYLE } from "../src/db/schema/app-settings";

/**
 * ============================================================================
 * **도번 표시 모양** — 설정값 하나 (2026-11-20 쓰는 분 요청)
 * ============================================================================
 * 「재고 담당자가 **도번을 보면서 불출을 실행**한다. 지금은 너무 작고 눈에 안 띈다.」
 * 그래서 도번을 제 줄로 빼내 크게 세우고, 그 모양(알약 켬·끔 / 크기 / 글자색 / 알약색)을
 * 설정 화면에서 고르게 했다.
 *
 * ── 🔴 여기서 재는 것 ───────────────────────────────────────────────────
 *  ① **깨진 값에서도 화면이 선다** — 설정은 글자 한 칸이라 사람이 손으로 아무 값이나 넣을 수
 *     있고, 판이 바뀌면 저장해 둔 모양이 지금 모양과 다르다. 이 값을 읽는 자리가 **인증 구간
 *     레이아웃**이라, 던지면 「도번 색이 이상하다」가 아니라 **모든 화면이 안 뜬다.**
 *  ② **알약을 꺼도 알약색이 남는다** — 지우면 다시 켤 때 고를 손잡이를 잃는다.
 *  ③ **여백이 `em` 이다** — 알약이 글씨 크기를 저절로 따라가야 한다. px 로 박으면 크기를 고칠
 *     때마다 여백도 같이 고쳐야 하는 자리가 생긴다.
 *  ④ **색이 Tailwind 클래스가 아니다** — 고른 색으로 클래스 이름을 지어내면 그 이름은 CSS 에
 *     없고 **오류 없이 조용히 투명**이 된다. 화면에서만 드러난다.
 *  ⑤ **읽는 자리가 하나다** — 세 화면이 제각기 읽으면 한 자리만 빠뜨려도 그 화면에서만 기본값이
 *     되는데, 그것도 오류가 안 난다.
 *
 * 🔴 **「크게 보인다」는 여기서 못 잰다**(이 저장소에는 화면 렌더 시험이 없다 —
 *    `tests/part-issue-screen.test.ts` 머리말). 대신 **고를 수 있는 값**으로 잰다: 무엇이 기본값인지,
 *    깨진 값이 어떻게 되는지, 꾸밈이 실제로 갈리는지. 모양이 실제로 그 자리에 서는지는 맨 아래
 *    묶음이 **파일 글자에서** 본다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 주석을 걷어낸 코드만. 🔴 **소스 글자로 재는 검사는 주석을 먼저 걷는다** — 이 조각이 고친
 * 파일들의 머리말에는 「색을 클래스로 만들지 마라」 같은 말이 일부러 적혀 있고, 날글자로 재면
 * 그 설명 자체가 걸린다. 그러면 사람은 **주석을 지우는 쪽으로** 움직인다.
 * (`tests/settings-access.test.ts` 의 `codeOnly` 와 같은 함수다.)
 */
function codeOnly(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const open = line.indexOf("/*");
      if (open === -1) break;
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        line = line.slice(0, open);
        inBlock = true;
        break;
      }
      line = line.slice(0, open) + line.slice(close + 2);
    }
    const slash = line.indexOf("//");
    if (slash !== -1) line = line.slice(0, slash);
    out.push(line);
  }
  return out.join("\n");
}

/** 바른 값 한 벌. 🔵 기본값과 **일부러 다 다르게** 잡는다 — 기본값으로 떨어진 것을 「통과」로 읽지 않으려고. */
const GOOD: DrawingNoStyle = { pill: false, fontSize: 20, textColor: "#123456", pillColor: "#abcdef" };

describe("① 기본값 — 저장된 값이 없을 때가 곧 **운영 모습**이다", () => {
  it("🔴 넷이 쓰는 분과 정한 그대로다 (알약 켬 · 15px · 진한 파랑 · 연한 파랑)", () => {
    assert.deepEqual(DRAWING_NO_STYLE_DEFAULT, { pill: true, fontSize: 15, textColor: "#1d4ed8", pillColor: "#dbeafe" });
  });

  it("🔴 기본값이 **제 울타리를 지난다** — 기본값으로 세운 화면이 「못 쓰는 값」이면 안 된다", () => {
    assert.equal(isDrawingNoFontSize(DRAWING_NO_STYLE_DEFAULT.fontSize), true);
    assert.equal(isDrawingNoColor(DRAWING_NO_STYLE_DEFAULT.textColor), true);
    assert.equal(isDrawingNoColor(DRAWING_NO_STYLE_DEFAULT.pillColor), true);
    // 저장과 읽기가 한 꼴이어야 「안 바뀜」을 가릴 수 있다.
    assert.equal(DRAWING_NO_STYLE_DEFAULT.textColor, DRAWING_NO_STYLE_DEFAULT.textColor.toLowerCase());
    assert.equal(DRAWING_NO_STYLE_DEFAULT.pillColor, DRAWING_NO_STYLE_DEFAULT.pillColor.toLowerCase());
    // 🔵 기본값 그대로 저장했다가 다시 읽어도 그대로여야 한다(한 바퀴).
    assert.deepEqual(parseDrawingNoStyle(serializeDrawingNoStyle(DRAWING_NO_STYLE_DEFAULT)), DRAWING_NO_STYLE_DEFAULT);
  });

  it("🔵 **파랑을 고른 까닭이 지켜진다** — 같은 줄의 딱지 셋과 색 계열이 겹치지 않는다", () => {
    // 🔴 이웃 딱지는 노랑(유상)·회색(소유)·보라(O/H)다. 도번을 그 계열로 칠하면 딱지와 섞여 보여
    //    「눈에 띄게」가 되레 무너진다 — 그 판단이 기본값의 까닭이므로 여기서 함께 잰다.
    const tags = codeOnly(src("src/lib/stock/request-item-detail.ts"));
    for (const family of ["amber", "zinc", "violet"]) {
      assert.ok(tags.includes(`-${family}-`), `딱지에서 ${family} 계열이 사라졌다 — 기본 색을 고른 근거를 다시 보라`);
    }
    // 파랑 둘은 그 셋 가운데 어느 것도 아니다(딱지 꾸밈 글자에 이 색이 없다).
    assert.ok(!tags.includes(DRAWING_NO_STYLE_DEFAULT.textColor), "딱지가 도번과 같은 색을 쓴다");
  });

  it("🔴 **본보기 글자에 실제 고객사 값을 적지 않았다** — 한 번 박히면 지울 길이 없다", () => {
    // 🔵 지어낸 값인지는 사람만 알지만, **생김새(글자+숫자)와 길이**는 잴 수 있다.
    assert.match(DRAWING_NO_STYLE_SAMPLE_VALUE, /^[A-Z0-9]{8,16}$/);
  });
});

describe("② 읽기 — 깨진 값에서도 **기본값으로 서고 화면이 뜬다**", () => {
  /** 🔵 「쓸 수 있는 모양이 저장돼 있지 않다」로 묶이는 것들. 전부 **같은 결과**여야 한다. */
  const JUNK: unknown[] = [
    null,
    undefined,
    "",
    "   ",
    "{",
    "{pill:true}", // JSON 이 아니다(따옴표 없는 키)
    "null",
    "true",
    "123",
    '"그냥 글자"',
    "[]",
    '[{"pill":false}]',
    "{}",
    42, // 글자가 아니다 — 칸 타입이 바뀌는 날
    { pill: false }, // 글자가 아니다(이미 푼 값을 넘긴 경우)
  ];

  it("🔵 **표본이 비어 있지 않다** — 아래가 공짜로 통과하지 않게 먼저 센다", () => {
    assert.ok(JUNK.length >= 12, `지저분한 값 표본이 ${JUNK.length}개뿐이다`);
  });

  it("🔴 깨진 값·없는 열쇠·빈 글자 — **전부 기본값 넷**이고, 한 번도 던지지 않는다", () => {
    for (const raw of JUNK) {
      const got = parseDrawingNoStyle(raw);
      assert.deepEqual(got, DRAWING_NO_STYLE_DEFAULT, `${JSON.stringify(raw)} 에서 기본값이 안 나왔다`);
    }
  });

  it("바른 값은 **그대로** 돌아온다", () => {
    assert.deepEqual(parseDrawingNoStyle(serializeDrawingNoStyle(GOOD)), GOOD);
  });

  it("🔴 **칸마다 따로 본다** — 숫자 한 칸이 깨졌다고 정성껏 고른 색 셋이 사라지지 않는다", () => {
    const got = parseDrawingNoStyle('{"pill":false,"fontSize":"열다섯","textColor":"#123456","pillColor":"#abcdef"}');
    assert.equal(got.fontSize, DRAWING_NO_STYLE_DEFAULT.fontSize, "깨진 칸이 기본값으로 안 떨어졌다");
    assert.equal(got.pill, false, "멀쩡한 칸까지 기본값으로 되돌렸다");
    assert.equal(got.textColor, "#123456", "멀쩡한 칸까지 기본값으로 되돌렸다");
    assert.equal(got.pillColor, "#abcdef", "멀쩡한 칸까지 기본값으로 되돌렸다");
  });

  it("칸이 빠진 값 — 빠진 것만 기본값이다", () => {
    assert.deepEqual(parseDrawingNoStyle('{"fontSize":20}'), { ...DRAWING_NO_STYLE_DEFAULT, fontSize: 20 });
    assert.deepEqual(parseDrawingNoStyle('{"pill":false}'), { ...DRAWING_NO_STYLE_DEFAULT, pill: false });
  });

  it("🔵 모르는 칸은 그냥 버린다 — 판이 바뀌어 칸이 늘어도 화면은 선다", () => {
    assert.deepEqual(parseDrawingNoStyle('{"fontSize":20,"무엇":"몰라도 된다","border":"3px"}'), { ...DRAWING_NO_STYLE_DEFAULT, fontSize: 20 });
  });

  it("색은 **소문자로 맞춰** 돌아온다 — 같은 색이 다른 값으로 보이면 「안 바뀜」을 못 가린다", () => {
    assert.equal(parseDrawingNoStyle('{"textColor":"#1D4ED8"}').textColor, "#1d4ed8");
    assert.equal(parseDrawingNoStyle('{"pillColor":"#ABCDEF"}').pillColor, "#abcdef");
  });

  it("🔴 색은 `#rrggbb` 한 꼴뿐이다 — 줄임꼴·이름·주입 글자는 전부 기본값", () => {
    for (const bad of ["#abc", "red", "rgb(1,2,3)", "#12345", "#1234567", "", "   ", "#1d4ed8; background:url(x)", 16711680, null]) {
      assert.equal(
        parseDrawingNoStyle(JSON.stringify({ textColor: bad })).textColor,
        DRAWING_NO_STYLE_DEFAULT.textColor,
        `${JSON.stringify(bad)} 를 색으로 받았다 — 이 값이 화면의 style 속성에 그대로 들어간다`,
      );
    }
  });

  it("🔴 범위를 넘은 크기는 **자르지 않고 기본값으로** 떨어진다 — 자르면 「내가 적은 값이 통했다」로 읽힌다", () => {
    for (const bad of [DRAWING_NO_FONT_SIZE_MIN - 1, DRAWING_NO_FONT_SIZE_MAX + 1, 0, -15, 1000, 15.5, Number.NaN, Number.POSITIVE_INFINITY, "15", null]) {
      assert.equal(parseDrawingNoStyle(JSON.stringify({ fontSize: bad })).fontSize, DRAWING_NO_STYLE_DEFAULT.fontSize, `${String(bad)} 를 크기로 받았다`);
    }
    // 🔵 끝값 둘은 **받는다** — 울타리가 한 칸씩 안으로 밀려 있지 않은지 함께 본다.
    assert.equal(parseDrawingNoStyle(JSON.stringify({ fontSize: DRAWING_NO_FONT_SIZE_MIN })).fontSize, DRAWING_NO_FONT_SIZE_MIN);
    assert.equal(parseDrawingNoStyle(JSON.stringify({ fontSize: DRAWING_NO_FONT_SIZE_MAX })).fontSize, DRAWING_NO_FONT_SIZE_MAX);
  });

  it("🔴 `normalizeDrawingNoStyle` 은 **`unknown` 을 받는다** — 타입을 좁히면 tsc 는 조용하고 깨진 값은 지나간다", () => {
    // 글자가 아닌 것(이미 푼 값)도 그대로 다룰 수 있어야 서버 액션 입력에 같은 잣대를 쓸 수 있다.
    assert.deepEqual(normalizeDrawingNoStyle(GOOD), GOOD);
    assert.deepEqual(normalizeDrawingNoStyle([1, 2]), DRAWING_NO_STYLE_DEFAULT);
    assert.deepEqual(normalizeDrawingNoStyle(null), DRAWING_NO_STYLE_DEFAULT);
  });

  it("🔵 돌려준 것은 **새 덩이**다 — 화면이 고치다 기본값 상수를 더럽히지 않는다", () => {
    const got = parseDrawingNoStyle(null);
    got.fontSize = 99;
    assert.equal(DRAWING_NO_STYLE_DEFAULT.fontSize, 15, "기본값 상수가 바뀌었다 — 그 뒤로 모든 화면이 99px 다");
  });
});

describe("③ 🔴 알약을 꺼도 **알약색은 지워지지 않는다**", () => {
  it("읽을 때 남는다 — 다시 켜면 쓸 값이다", () => {
    const got = parseDrawingNoStyle('{"pill":false,"pillColor":"#ff0000"}');
    assert.equal(got.pill, false);
    assert.equal(got.pillColor, "#ff0000", "알약을 끄면서 알약색까지 지웠다 — 다시 켤 때 고를 손잡이가 없다");
  });

  it("저장할 때도 남는다 — 검증이 그 칸을 떨어뜨리지 않는다", () => {
    const checked = validateDrawingNoStyleInput({ pill: false, fontSize: 15, textColor: "#000000", pillColor: "#ff0000" });
    assert.equal(checked.ok, true);
    assert.equal(checked.ok && checked.value.pillColor, "#ff0000");
  });

  it("한 바퀴 돌아도 남는다 — 저장 → 읽기 → 다시 켜기", () => {
    const off: DrawingNoStyle = { pill: false, fontSize: 18, textColor: "#000000", pillColor: "#ff0000" };
    const back = parseDrawingNoStyle(serializeDrawingNoStyle(off));
    assert.deepEqual(back, off);
    assert.equal({ ...back, pill: true }.pillColor, "#ff0000");
  });

  it("🔴 **그리는 쪽도 알약색을 안 지운다** — 끔은 「안 보인다」이지 「그 색을 버린다」가 아니다", () => {
    const off: DrawingNoStyle = { ...GOOD, pill: false, pillColor: "#ff0000" };
    // 꺼져 있으니 꾸밈에는 안 나온다…
    assert.equal(drawingNoValueStyle(off).backgroundColor, undefined);
    // …그래도 값은 그대로 들고 있다가 켜면 바로 쓰인다.
    assert.equal(drawingNoValueStyle({ ...off, pill: true }).backgroundColor, "#ff0000");
  });
});

describe("④ 쓰기 전 검증 — **엄한 쪽**(메우지 않는다)", () => {
  it("바른 값은 통과하고, 색은 소문자로 맞춰 돌아온다", () => {
    const checked = validateDrawingNoStyleInput({ pill: true, fontSize: 12, textColor: "#AABBCC", pillColor: "#DDEEFF" });
    assert.deepEqual(checked, { ok: true, value: { pill: true, fontSize: 12, textColor: "#aabbcc", pillColor: "#ddeeff" } });
  });

  it("🔴 칸마다 거절한다 — 그리고 **기본값으로 메우지 않는다**(메우면 보낸 적 없는 값이 저장된다)", () => {
    const base = { pill: true, fontSize: 15, textColor: "#000000", pillColor: "#ffffff" };
    for (const [patch, what] of [
      [{ pill: "yes" }, "알약"],
      [{ fontSize: 100 }, "크기"],
      [{ fontSize: "15" }, "크기"],
      [{ textColor: "red" }, "글자색"],
      [{ pillColor: "#abc" }, "알약색"],
    ] as [Record<string, unknown>, string][]) {
      const checked = validateDrawingNoStyleInput({ ...base, ...patch });
      assert.equal(checked.ok, false, `${what}: 못 쓰는 값이 통과했다`);
      assert.ok(!("value" in checked), `${what}: 거절하면서 값을 돌려줬다 — 메운 값이 저장될 길이 생긴다`);
      assert.ok(checked.ok === false && checked.message.length > 0, `${what}: 까닭을 말해 주지 않는다`);
    }
  });

  it("덩이가 아닌 것은 통째로 거절한다", () => {
    for (const bad of [null, undefined, "", 1, [], [{ pill: true }]]) {
      assert.equal(validateDrawingNoStyleInput(bad).ok, false, `${JSON.stringify(bad)} 가 통과했다`);
    }
  });

  it("🔴 **읽는 쪽과 같은 잣대를 쓴다** — 저장을 지난 값은 읽어도 그대로다(안 그러면 「저장은 되는데 기본값」)", () => {
    for (const style of [GOOD, DRAWING_NO_STYLE_DEFAULT, { pill: false, fontSize: DRAWING_NO_FONT_SIZE_MIN, textColor: "#ffffff", pillColor: "#000000" }]) {
      const checked = validateDrawingNoStyleInput(style);
      assert.equal(checked.ok, true, JSON.stringify(style));
      assert.ok(checked.ok);
      assert.deepEqual(parseDrawingNoStyle(serializeDrawingNoStyle(checked.value)), checked.value);
    }
  });

  it("🔵 같고 다름을 가리는 자리 — 설정 화면의 「아직 저장하지 않았습니다」가 이것으로 선다", () => {
    assert.equal(isSameDrawingNoStyle(GOOD, { ...GOOD }), true);
    for (const patch of [{ pill: true }, { fontSize: 21 }, { textColor: "#123457" }, { pillColor: "#abcdee" }]) {
      assert.equal(isSameDrawingNoStyle(GOOD, { ...GOOD, ...patch }), false, JSON.stringify(patch));
    }
  });
});

describe("⑤ 🔴 인라인 꾸밈 — 여백이 `em` 이고, 색이 클래스가 아니다", () => {
  it("알약을 켜면 바탕·여백·둥글기가 선다", () => {
    const style = drawingNoValueStyle({ pill: true, fontSize: 15, textColor: "#1d4ed8", pillColor: "#dbeafe" });
    assert.equal(style.fontSize, "15px");
    assert.equal(style.color, "#1d4ed8");
    assert.equal(style.backgroundColor, "#dbeafe");
    assert.ok(typeof style.padding === "string" && style.padding.length > 0);
    assert.ok(typeof style.borderRadius === "string" && style.borderRadius.length > 0);
    // 🔵 **표본이 비지 않게** — 재는 칸이 다섯이라는 것을 먼저 못 박는다.
    assert.deepEqual(Object.keys(style).sort(), ["backgroundColor", "borderRadius", "color", "fontSize", "padding"]);
  });

  it("🔴 알약을 끄면 바탕도 여백도 **아예 없다** — 안 보이는 알약을 남기면 글자가 제자리에서 밀린다", () => {
    const style = drawingNoValueStyle({ pill: false, fontSize: 15, textColor: "#1d4ed8", pillColor: "#dbeafe" });
    assert.deepEqual(Object.keys(style).sort(), ["color", "fontSize"]);
    // 🔵 **글자는 그대로 커지고 색이 든다** — 끄는 것은 알약이지 「눈에 띄게」가 아니다.
    assert.equal(style.fontSize, "15px");
    assert.equal(style.color, "#1d4ed8");
  });

  it("🔴 **여백이 글씨 크기를 따라간다** — `em` 이라 크기를 바꿔도 적어 둔 여백은 한 글자도 안 바뀐다", () => {
    const sizes = [DRAWING_NO_FONT_SIZE_MIN, 15, DRAWING_NO_FONT_SIZE_MAX];
    const paddings = new Set<string>();
    for (const fontSize of sizes) {
      const style = drawingNoValueStyle({ ...DRAWING_NO_STYLE_DEFAULT, fontSize });
      assert.equal(style.fontSize, `${fontSize}px`);
      assert.ok(typeof style.padding === "string");
      // 🔴 px 로 박으면 큰 글씨에 알약이 꽉 끼고 작은 글씨에는 헐렁해진다.
      assert.ok(!(style.padding as string).includes("px"), `여백이 px 로 박혔다(${fontSize}px): ${String(style.padding)}`);
      for (const piece of (style.padding as string).split(/\s+/)) {
        assert.match(piece, /em$/, `여백 한 토막이 em 이 아니다: ${piece}`);
      }
      paddings.add(style.padding as string);
    }
    assert.equal(paddings.size, 1, "크기마다 여백 글자가 다르다 — em 비례가 아니라 크기별로 적고 있다");
  });

  it("🔵 둥글기만 px 인 것은 **치수가 아니라 「끝까지 둥글게」**라서다 — 어떤 크기에서도 높이보다 크다", () => {
    const style = drawingNoValueStyle(DRAWING_NO_STYLE_DEFAULT);
    const radius = Number(String(style.borderRadius).replace("px", ""));
    assert.ok(radius > DRAWING_NO_FONT_SIZE_MAX * 10, `둥글기(${radius}px)가 글씨 크기에 비해 작다 — 크게 키우면 알약이 모서리진다`);
  });

  it("🔴 사람이 고른 색이 **그 값 그대로** 꾸밈에 들어간다 — 클래스 이름으로 둔갑하지 않는다", () => {
    const style = drawingNoValueStyle({ pill: true, fontSize: 11, textColor: "#010203", pillColor: "#040506" });
    assert.equal(style.color, "#010203");
    assert.equal(style.backgroundColor, "#040506");
  });
});

describe("⑥ 🔴 그리는 조각 — 색을 클래스로 만들지 않았다 (소스)", () => {
  const piece = codeOnly(src("src/components/stock/DrawingNoLine.tsx"));

  it("꾸밈을 **순수 함수에서 받아** 인라인 `style` 로 넣는다", () => {
    assert.match(piece, /style=\{drawingNoValueStyle\(style\)\}/, "조각이 꾸밈을 제 안에서 짓고 있다");
  });

  it("🔴 **클래스 이름을 지어내는 자리가 없다** — 지어낸 이름은 CSS 에 없어 조용히 투명이 된다", () => {
    assert.ok(!/className=\{`/.test(piece), "클래스 이름을 템플릿 글자로 짓고 있다");
    assert.ok(!piece.includes("className={"), "클래스 이름이 식으로 들어간다 — 글자로 적힌 것만 CSS 로 구워진다");
    assert.ok(!piece.includes("#"), "조각이 색 값을 제 안에 적었다");
  });

  it("🔴 **알약 켬·끔으로 그리는 것이 갈리지 않는다** — 꺼도 글자는 그대로 선다", () => {
    assert.ok(!piece.includes(".pill"), "조각이 알약 켬·끔을 보고 갈라 그린다 — 끄면 줄이 사라질 길이 생긴다");
  });

  it("🔴 **라벨 글자가 남아 있다** — 색만으로 가르지 않는다(CLAUDE.md 9-7절)", () => {
    assert.match(piece, /\{label\}/, "라벨을 안 그린다 — 색을 지우면 그 줄이 무슨 값인지 알 수 없다");
    assert.ok(!piece.includes("도번"), "라벨을 손으로 적었다 — 부르는 말을 바꾸는 날 이 줄만 옛말을 한다");
    // 🔵 색 말고도 가르는 것 하나 더: 굵기.
    assert.ok(piece.includes("font-medium"), "굵기로도 갈리지 않는다 — 흑백으로 찍으면 이웃 줄과 같아 보인다");
  });
});

describe("⑦ 🔴 읽는 자리가 **하나**다 — 세 화면이 제각기 읽지 않는다", () => {
  it("인증 구간 레이아웃이 읽어 Context 로 내려보낸다", () => {
    const layout = codeOnly(src("src/app/(app)/layout.tsx"));
    assert.match(layout, /await getDrawingNoStyle\(\)/, "레이아웃이 도번 모양을 안 읽는다");
    assert.match(layout, /\.catch\(\(\) => DRAWING_NO_STYLE_DEFAULT\)/, "못 읽으면 화면이 통째로 안 뜬다 — 꾸밈 설정 하나 때문이다");
    assert.match(layout, /<DrawingNoStyleProvider value=\{drawingNoStyle\}>/, "읽고도 안 내려보낸다");
  });

  it("도번 줄을 그리는 조각이 그 값을 받아 쓴다", () => {
    const details = codeOnly(src("src/components/stock/RequestItemDetails.tsx"));
    assert.match(details, /useDrawingNoStyle\(\)/, "조각이 저장된 모양을 안 읽는다 — 늘 기본값으로 선다");
    assert.match(details, /<DrawingNoLine label=\{drawing\.label\} value=\{drawing\.value\} style=\{drawingNoStyle\}/, "도번 줄을 조각으로 안 그린다");
  });

  it("🔴 화면 셋은 **한 자리도 제 값을 읽지 않는다** — 한 자리만 빠뜨려도 그 화면만 기본값이 된다(오류가 안 난다)", () => {
    for (const file of ["src/components/stock/RequestManagerScreen.tsx", "src/components/stock/RequestActions.tsx", "src/components/stock/IssueApprovalScreen.tsx"]) {
      const text = codeOnly(src(file));
      assert.ok(!text.includes("drawingNoStyle"), `${file} 이 도번 모양을 따로 나른다 — 나르는 자리가 늘면 빠뜨릴 자리도 는다`);
      assert.ok(!text.includes("DrawingNoLine"), `${file} 이 도번 줄을 제 모양으로 그린다`);
    }
  });

  it("🔴 **도번이 나머지 글자 줄에서 빠졌다** — 안 빼면 같은 값이 한 줄에 두 번 나온다", () => {
    const rules = codeOnly(src("src/lib/stock/request-item-detail.ts"));
    assert.match(rules, /export const REQUEST_ITEM_DRAWING_FIELD = "drawingNo"/, "빼내는 칸을 키로 못 박지 않았다");
    assert.match(rules, /rest: details\.filter\(\(d\) => !REQUEST_ITEM_PULLED_OUT_FIELDS\.includes\(d\.key\)\)/, "빼낸 칸과 거르는 칸이 같은 글자에서 안 나온다");
  });
});

describe("⑧ 설정 화면 — 미리보기는 **고르는 중인 값**이고, 꺼도 그려진다", () => {
  const form = codeOnly(src("src/components/settings/DrawingNoStyleForm.tsx"));

  it("🔴 미리보기가 **진짜 그 조각**이다 — 베껴 그리면 미리보기와 화면이 갈라진다", () => {
    assert.match(form, /<DrawingNoStyleProvider value=\{draft\}>\s*<RequestItemDetails item=\{PREVIEW_ITEM\} \/>/, "미리보기가 실제 조각을 안 쓴다");
  });

  it("🔴 미리보기가 **저장된 값**을 따르지 않는다 — 그러면 저장을 열 번 해야 색 하나를 맞춘다", () => {
    assert.ok(!form.includes("value={saved}"), "미리보기에 저장된 값을 끼웠다");
  });

  it("🔴 **알약을 꺼도 미리보기가 그려진다** — 사라지면 다시 켤 손잡이를 잃는다", () => {
    // 미리보기를 알약 켬·끔으로 가리는 자리가 없다. 꾸밈만 갈릴 뿐 그리는 것은 늘 그린다.
    assert.ok(!form.includes("draft.pill && "), "미리보기나 칸을 알약 켬·끔으로 통째로 없앤다");
    assert.ok(!form.includes("{draft.pill ? <"), "알약을 끄면 다른 것을 그린다 — 미리보기가 제 설정을 따라 사라질 길이다");
  });

  it("🔴 **알약색 칸을 지우지 않는다** — 흐려 보이게만 둔다", () => {
    assert.match(form, /value=\{draft\.pillColor\}/, "알약색 칸이 사라졌다");
    assert.match(form, /draft\.pill \? "" : "opacity-50"/, "알약을 꺼도 알약색 칸이 또렷하다 — 쓰이지 않는 칸인 줄 모른다");
  });

  it("🔵 **되돌릴 길이 있다** — 흰 바탕에 흰 글자로 만들어 놓으면 고치러 와도 안 보인다", () => {
    assert.match(form, /update\(DRAWING_NO_STYLE_DEFAULT\)/, "기본값으로 되돌리는 길이 없다");
    // 🔴 누르자마자 저장되면 되돌릴 셈으로 눌러 본 사람이 남의 화면까지 바꾼다.
    assert.ok(!/onClick=\{\(\) => \{?\s*saveDrawingNoStyleAction/.test(form), "되돌리기가 바로 저장한다");
  });

  it("🔴 크기 칸의 위·아래 끝이 **순수 함수 쪽 상수**다 — 화면과 서버가 다른 잣대를 쓰면 안 된다", () => {
    assert.match(form, /min=\{DRAWING_NO_FONT_SIZE_MIN\}/);
    assert.match(form, /max=\{DRAWING_NO_FONT_SIZE_MAX\}/);
  });
});

describe("⑨ 🔴 저장 길 — 관리자만, 검증을 지나서", () => {
  const action = codeOnly(src("src/app/actions/drawing-no-style.ts"));

  it("서버 액션이 **제 자리에서 다시** 역할을 본다 — 탭을 안 그리는 것은 울타리가 아니다", () => {
    assert.match(action, /await requireRole\("ADMIN"\)/, "액션이 역할을 안 본다 — 망 너머에서 누구나 부를 수 있다");
  });

  it("🔴 **엄한 검증을 지난 값만** 적는다 — 화면이 보낸 것을 그대로 믿지 않는다", () => {
    assert.match(action, /validateDrawingNoStyleInput\(input\)/, "검증을 안 지난다");
    assert.match(action, /saveDrawingNoStyle\(validated\.value,/, "검증을 지난 값이 아니라 받은 값을 적는다");
    assert.ok(!action.includes("normalizeDrawingNoStyle"), "쓰는 자리가 깨진 칸을 메우고 있다 — 보낸 적 없는 값이 저장된다");
  });

  it("🔵 저장하는 자리와 읽는 자리가 **같은 열쇠**를 쓴다 — 어긋나면 「저장은 되는데 화면은 그대로」", () => {
    const queries = codeOnly(src("src/lib/stock/drawing-no-style-queries.ts"));
    assert.equal(SETTING_DRAWING_NO_STYLE, "drawing_no_style");
    const uses = queries.split("SETTING_DRAWING_NO_STYLE").length - 1;
    assert.ok(uses >= 3, `열쇠를 쓰는 자리가 ${uses}군데뿐이다 — 읽기·쓰기 둘 다 같은 이름을 쓰는지 다시 보라`);
    assert.ok(!queries.includes('"drawing_no_style"'), "열쇠 글자를 손으로 적은 자리가 있다");
  });

  it("🔴 **마이그레이션이 없다** — 설정 표는 열쇠 하나에 글자 하나라 열쇠만 더하면 된다", () => {
    const dir = new URL("../drizzle/", import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
    // 🔵 표본이 비면 아래가 공짜로 통과한다.
    assert.ok(files.length > 20, `마이그레이션을 못 읽었다(${files.length}개)`);
    for (const name of files) {
      const sql = readFileSync(new URL(name, dir), "utf8");
      assert.ok(!sql.includes(SETTING_DRAWING_NO_STYLE), `${name} 이 이 설정 때문에 생겼다 — 표를 건드릴 일이 아니다`);
    }
  });
});
