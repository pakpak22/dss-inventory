import type { CSSProperties } from "react";

/**
 * ============================================================================
 * **도번 줄의 생김새** — 설정값 하나와 그것을 푸는 규칙 (2026-11-20 쓰는 분 요청)
 * ============================================================================
 * 「재고 담당자가 **도번을 보면서 불출을 실행**한다. 지금은 품명2·교산 품번과 함께 맨 아랫줄에
 *  작은 회색 글씨로 흘려 적혀 있어 **너무 작고 눈에 안 띈다.**」
 *
 * 그래서 도번만 **제 줄로 빼내 알약으로 세우고**(`requestItemDetailGroups` 의 `drawing`),
 * 그 모양을 설정 화면에서 조절하게 했다. 이 파일이 쥐는 것은 **값과 규칙**뿐이고, 그리는 자리는
 * `src/components/stock/DrawingNoLine.tsx` **하나**다.
 *
 * ── 🔴 왜 순수 함수로 내려 두는가 ────────────────────────────────────────
 * 이 저장소에는 **화면 렌더 시험이 없다**(`tests/part-issue-screen.test.ts` 머리말). 설정값을 푸는
 * 규칙을 화면이나 서버 조각 안에 적으면 「**깨진 값이 들어 있을 때 화면이 서는가**」를 아무도 돌려
 * 보지 못한 채 운영으로 나간다. 그리고 이 값은 실제로 깨질 수 있다 — 설정 표는 글자 한 칸이라
 * 사람이 손으로 고칠 수 있고, 판이 바뀌면 저장해 둔 모양이 지금 모양과 다르다.
 *
 * ── 🔴 색을 Tailwind 클래스 이름으로 만들지 않는다 ───────────────────────
 * 이 저장소는 **소스에 글자로 적힌 클래스만** CSS 로 굽는다. 사람이 고른 색으로 클래스 이름을
 * 지어내면 그 이름은 CSS 에 없고, **오류 한 줄 없이 조용히 투명**이 된다 — 화면에서만 드러나고
 * 시험은 전부 통과한다. 그래서 사람이 고른 값은 **전부 인라인 `style`** 로 나간다
 * (아래 `drawingNoValueStyle`).
 *
 * ── 🔵 열쇠 하나에 JSON 글자 하나 ────────────────────────────────────────
 * 설정 표(`app_settings`)는 `key`/`value` 가 글자 하나씩인 꼴이고, 네 가지를 네 줄로 쪼개면
 * **「셋만 저장된 반쪽」**이 생긴다(저장 중에 끊기거나, 다음 사람이 한 줄만 더해도 그렇다).
 * 게다가 기본값이 네 군데로 흩어진다. 그래서 **한 줄에 JSON 한 덩이**로 넣고, 읽는 자리는
 * 아래 `parseDrawingNoStyle` 하나다.
 * ============================================================================
 */

export interface DrawingNoStyle {
  /**
   * 알약(둥근 바탕)을 쓸지.
   * 🔵 **끄면 글자만** 커지고 색이 든다 — 바탕도 여백도 서지 않는다(`drawingNoValueStyle`).
   */
  pill: boolean;
  /**
   * 글씨 크기(px). 🔵 **알약 여백은 여기서 저절로 따라온다** — 여백을 `em` 으로 잡아 두었기
   * 때문이다(`drawingNoValueStyle`). 크기를 키울 때 여백을 따로 고치는 자리가 없다.
   */
  fontSize: number;
  /** 글자색. `#rrggbb` 여섯 자리 한 가지 꼴만 쓴다(아래 `isDrawingNoColor` 의 까닭). */
  textColor: string;
  /**
   * 알약색. `#rrggbb`.
   *
   * 🔴 **알약을 꺼도 이 값을 지우지 않는다.** 다시 켜면 쓸 값이고, 지우면 켤 때마다 색을
   *    새로 골라야 한다 — 끄는 것은 「지금 안 보인다」이지 「그 색을 버린다」가 아니다.
   */
  pillColor: string;
}

/**
 * 저장된 값이 없을 때의 모양 — 🔴 **이것이 곧 지금 운영 화면의 모습이다.**
 * 설정 줄을 한 번도 저장하지 않은 집(그리고 깨진 값이 들어 있는 집)이 전부 이 넷으로 선다.
 *
 * 🔵 **파랑을 고른 까닭**: 같은 줄에 이미 서 있는 딱지 둘이 노랑(`유상`)과 회색(`소유`)이다
 *    (`request-item-detail.ts` 의 `REQUEST_ITEM_CHARGE_TAG_CLASS`·`REQUEST_ITEM_OWNER_TAG_CLASS`).
 *    도번을 그 계열로 칠하면 **딱지와 섞여 보여** 「눈에 띄게」라는 요청이 되레 무너진다.
 *    보라도 쓰이고 있어서(O/H 딱지) 남은 것이 파랑이다.
 * 🔵 15px 를 고른 까닭: 옆에 선 나머지 글자가 11px 라 **한눈에 더 크다는 것이 보이는** 가장
 *    작은 치수다. 더 키우면 줄 높이가 늘어 한 화면에 들어가는 신청 줄 수가 줄어든다.
 */
export const DRAWING_NO_STYLE_DEFAULT: DrawingNoStyle = {
  pill: true,
  fontSize: 15,
  textColor: "#1d4ed8",
  pillColor: "#dbeafe",
};

/**
 * 글씨 크기의 아래·위 끝.
 *
 * 🔴 **울타리를 두는 까닭은 화면이 깨지기 때문이다.** 이 값은 신청 줄마다 서는 글자라, 크면
 *    줄 높이가 통째로 늘어 목록이 못 쓰게 된다. 설정 화면의 입력 칸은 손으로 만든 요청이
 *    얼마든지 지나칠 수 있으므로(서버 액션은 망 너머에서 불린다) **읽는 쪽과 쓰는 쪽 양쪽**이
 *    이 둘로 잰다.
 * 🔵 아래 끝을 10 으로 둔 까닭: 지금 나머지 글자가 11px 다. 그보다 작으면 「눈에 띄게」가
 *    아니라 더 안 보이게 되는데, 그래도 **고를 수 있게는** 둔다 — 못 고르게 막는 것과
 *    말이 안 되는 값을 막는 것은 다른 일이다.
 */
export const DRAWING_NO_FONT_SIZE_MIN = 10;
export const DRAWING_NO_FONT_SIZE_MAX = 24;

/**
 * 색으로 받을 수 있는 글자인가 — **`#rrggbb` 여섯 자리 한 가지 꼴뿐이다.**
 *
 * 🔴 **인라인 `style` 로 그대로 들어가는 값**이라 모양을 못 박는다. 세 자리 줄임꼴(`#abc`)도,
 *    `red` 같은 이름도, `rgb(…)` 도 받지 않는다 — 받아 주기 시작하면 「어디까지가 색인가」를
 *    이 파일이 혼자 판정하게 되고, 그 판정이 틀린 날 들어가는 자리가 화면의 style 속성이다.
 * 🔵 **고르개가 내는 값이 정확히 이 꼴이다**(`<input type="color">` 은 언제나 `#rrggbb` 를 낸다).
 *    그래서 이 울타리는 사람이 화면에서 고르는 길을 한 치도 좁히지 않는다.
 */
export function isDrawingNoColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** 🔵 저장과 비교를 한 꼴로 맞춘다 — `#DBEAFE` 와 `#dbeafe` 가 다른 값으로 보이면 「안 바뀜」을 못 가린다. */
function normalizeColor(value: string): string {
  return value.toLowerCase();
}

/** 글씨 크기로 받을 수 있는 값인가 — 정수이고 위 두 끝 사이. 🔴 글자로 적힌 숫자(`"15"`)는 받지 않는다(아래 머리말). */
export function isDrawingNoFontSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= DRAWING_NO_FONT_SIZE_MIN && value <= DRAWING_NO_FONT_SIZE_MAX;
}

/**
 * 아무 값이나 받아 **쓸 수 있는 모양 하나**로 만든다 — 읽는 쪽(관대한 쪽)이 쓰는 함수.
 *
 * 🔴 **칸마다 따로 본다.** 한 칸이 깨졌다고 넷을 통째로 기본값으로 되돌리면, 사람이 정성껏
 *    고른 색 셋이 숫자 한 칸 때문에 사라진다. 깨진 칸만 기본값으로 떨어진다.
 * 🔴 **자르지 않고 기본값으로 떨어뜨린다.** 범위를 넘은 숫자를 끝값으로 자르면(1000 → 24)
 *    화면에는 큰 글씨가 서고 사람은 **「내가 적은 값이 통했다」**고 읽는다. 참말은 「그 값은 못
 *    쓴다」이고, 그 말을 하는 길이 기본값이다.
 * 🔴 **받는 것이 `unknown` 이다.** 들어오는 자리가 둘인데(DB 의 글자 한 칸 · 망 너머에서 온 서버
 *    액션 입력) 둘 다 「이미 맞는 모양」이라고 믿을 수 없다. 타입을 좁혀 놓으면 tsc 는 조용하고
 *    깨진 값은 그대로 지나간다.
 */
export function normalizeDrawingNoStyle(raw: unknown): DrawingNoStyle {
  // 🔴 `typeof null === "object"` 이고 배열도 object 다 — 둘 다 여기서 걸러야 아래에서 칸을 뒤지지 않는다.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DRAWING_NO_STYLE_DEFAULT };
  const v = raw as Record<string, unknown>;
  return {
    pill: typeof v.pill === "boolean" ? v.pill : DRAWING_NO_STYLE_DEFAULT.pill,
    fontSize: isDrawingNoFontSize(v.fontSize) ? v.fontSize : DRAWING_NO_STYLE_DEFAULT.fontSize,
    textColor: isDrawingNoColor(v.textColor) ? normalizeColor(v.textColor) : DRAWING_NO_STYLE_DEFAULT.textColor,
    pillColor: isDrawingNoColor(v.pillColor) ? normalizeColor(v.pillColor) : DRAWING_NO_STYLE_DEFAULT.pillColor,
  };
}

/**
 * 설정 표에 저장된 **글자 한 칸**을 모양으로 푼다.
 *
 * 🔴 **예외를 던지지 않는다.** 이 값을 읽는 자리가 인증 구간 레이아웃이라, 던지면 **모든 화면이
 *    통째로 안 뜬다** — 그것도 「도번 색이 이상하다」가 아니라 오류 화면으로. 깨진 값에 걸맞은
 *    행동은 기본값으로 서는 것이다.
 * 🔵 열쇠가 없을 때(`null`)와 깨졌을 때가 **같은 결과**인 것이 맞다: 둘 다 「쓸 수 있는 모양이
 *    저장돼 있지 않다」이고, 화면이 해야 할 일도 같다.
 */
export function parseDrawingNoStyle(raw: unknown): DrawingNoStyle {
  if (typeof raw !== "string") return { ...DRAWING_NO_STYLE_DEFAULT };
  const text = raw.trim();
  if (text === "") return { ...DRAWING_NO_STYLE_DEFAULT };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 🔵 서버 로그에도 안 남긴다 — 사람이 설정을 한 번 고칠 때마다가 아니라 **화면을 그릴 때마다**
    //    지나는 자리라, 깨진 값이 하나 있으면 로그가 그 글자로 가득 찬다.
    return { ...DRAWING_NO_STYLE_DEFAULT };
  }
  return normalizeDrawingNoStyle(parsed);
}

/** 설정 표에 적을 글자. 🔵 읽는 쪽과 짝이라 둘을 한 파일에 둔다 — 한쪽만 고치면 다음 판에서 전부 기본값이 된다. */
export function serializeDrawingNoStyle(style: DrawingNoStyle): string {
  return JSON.stringify(style);
}

export type DrawingNoStyleValidation = { ok: true; value: DrawingNoStyle } | { ok: false; message: string };

/**
 * 저장하기 전에 보는 **엄한 쪽** — 하나라도 어긋나면 거절한다.
 *
 * 🔴 **읽는 쪽(`normalizeDrawingNoStyle`)과 정책이 일부러 다르다.** 읽을 때는 이미 저장돼 버린
 *    값을 어떻게든 화면에 세워야 하므로 깨진 칸을 기본값으로 **메우고**, 쓸 때는 **메우면 안 된다** —
 *    메우면 사람이 보낸 적 없는 값이 조용히 저장되고, 화면은 「저장했습니다」라고 말한다.
 * 🔵 **재는 잣대는 같다**(`isDrawingNoColor`·`isDrawingNoFontSize`). 규칙이 둘로 갈리면 언젠가
 *    「저장은 되는데 읽으면 기본값」이 된다 — 오류가 한 번도 안 나는 종류의 어긋남이다.
 */
export function validateDrawingNoStyleInput(raw: unknown): DrawingNoStyleValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, message: "보낸 값의 모양이 올바르지 않습니다." };
  const v = raw as Record<string, unknown>;
  if (typeof v.pill !== "boolean") return { ok: false, message: "알약 모양 사용 여부가 올바르지 않습니다." };
  if (!isDrawingNoFontSize(v.fontSize)) {
    return { ok: false, message: `글씨 크기는 ${DRAWING_NO_FONT_SIZE_MIN}px 에서 ${DRAWING_NO_FONT_SIZE_MAX}px 사이의 정수여야 합니다.` };
  }
  if (!isDrawingNoColor(v.textColor)) return { ok: false, message: "글자색이 올바르지 않습니다." };
  if (!isDrawingNoColor(v.pillColor)) return { ok: false, message: "알약색이 올바르지 않습니다." };
  return {
    ok: true,
    // 🔴 알약을 껐어도 **알약색을 그대로 싣는다** — 지우면 다시 켤 때 고를 손잡이를 잃는다(위 `pillColor` 주석).
    value: { pill: v.pill, fontSize: v.fontSize, textColor: normalizeColor(v.textColor), pillColor: normalizeColor(v.pillColor) },
  };
}

/**
 * 설정 화면의 미리보기에 세우는 **도번 본보기 글자**.
 *
 * 🔴 **실제 고객사 도번을 적지 않는다.** 이 저장소의 시험·화면에 실제 값이 박히면 지울 길이 없다
 *    (고객사·L/N·S/N 과 같은 결). 생김새만 닮은 **지어낸 값**이다.
 * 🔵 길이를 실제와 비슷하게 잡은 까닭: 미리보기로 보려는 것이 색뿐 아니라 **얼마나 넓게 자리를
 *    차지하나**이기도 하다. 짧은 글자로 보면 알약이 작아 보여 크기를 과하게 키우게 된다.
 */
export const DRAWING_NO_STYLE_SAMPLE_VALUE = "AB12345CD678";

/** 두 모양이 같은가. 🔵 설정 화면이 「바뀐 것이 없습니다」를 가려 말하는 데 쓴다. */
export function isSameDrawingNoStyle(a: DrawingNoStyle, b: DrawingNoStyle): boolean {
  return a.pill === b.pill && a.fontSize === b.fontSize && a.textColor === b.textColor && a.pillColor === b.pillColor;
}

/**
 * 도번 **값 글자**에 붙는 인라인 꾸밈 — 🔴 **사람이 고른 것은 전부 여기로 나간다**(머리말).
 *
 * 🔴 **여백을 `em` 으로 잡는다.** 같은 요소에 글씨 크기를 함께 얹으므로 `em` 은 **그 글씨 크기**를
 *    기준으로 풀린다 — 크기를 키우면 알약이 **저절로** 함께 커지고, 줄이면 함께 줄어든다.
 *    px 로 박으면 큰 글씨에는 알약이 꽉 끼고 작은 글씨에는 헐렁해져서, 크기를 고칠 때마다 여백도
 *    같이 고쳐야 하는 자리가 생긴다.
 * 🔵 둥근 정도(`borderRadius`)만 px 인 것은 **치수가 아니라 「끝까지 둥글게」라는 뜻**이기 때문이다.
 *    높이보다 큰 값이면 어떤 크기에서도 양 끝이 반원이 된다.
 * 🔴 **알약을 끄면 바탕도 여백도 아예 없다.** 투명한 바탕에 여백만 남기면 글자가 제자리에서 밀려
 *    옆 글자와 간격이 어긋난다 — 끈다는 것은 「알약이 없다」이지 「안 보이는 알약이 있다」가 아니다.
 * 🔵 글자 크기·색은 **끄든 켜든 그대로** 든다(쓰는 분 결정): 끄는 것은 알약이지 「눈에 띄게」가 아니다.
 */
export function drawingNoValueStyle(style: DrawingNoStyle): CSSProperties {
  const base: CSSProperties = { fontSize: `${style.fontSize}px`, color: style.textColor };
  if (!style.pill) return base;
  return { ...base, backgroundColor: style.pillColor, borderRadius: "9999px", padding: "0.15em 0.55em" };
}
