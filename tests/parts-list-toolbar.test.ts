import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * 재고 현황 맨 위 단추 넷이 **폰에서 한 줄**에 선다 (2026-11-18, 쓰는 분 요청)
 * ============================================================================
 * 「[인쇄, 엑셀 내려받기, 수량 변경 기록, 부품 등록]이 한 줄이 되도록 사이즈 조절을 해줘.」
 * 그 전에는 폰(360px)에서 [부품 등록]만 둘째 줄로 떨어졌다.
 *
 * ── 🔴 왜 소스 글자로 재는가 ───────────────────────────────────────────
 * 이 저장소에는 **화면 렌더 시험이 없다**(`tests/parts-list-cards.test.ts`·
 * `tests/app-header-responsive.test.ts` 머리말). 배치는 파일 글자에서 잰다.
 *
 * ── 🔵 여기서 지키는 것 ────────────────────────────────────────────────
 *   ① 단추 넷이 **한 묶음 안**에 있고, 줄을 나누는 것이 섞이지 않았다
 *   ② 글자가 **안 접힌다** — 「수량 변경 기록」이 두 줄이 되면 그 단추만 키가 커져 줄이 틀어진다
 *   ③ **640px 이상은 예전 그대로**다 — 신고된 것은 폰이고 PC 모양은 안 건드렸다
 *   ④ [부품 등록]만 **다른 색**이다(그 구분을 크기 조절이 먹어 버리지 않았다)
 *   ⑤ 가는 곳 셋이 그대로다 — [인쇄]의 주소는 `tests/parts-list-cards.test.ts` 가 이미 잰다
 *   ⑥ 🔴 **폭 셈** — 360px 폰에 넷이 실제로 들어가는가. 여백·글자 크기를 도로 키우면 여기서 깨진다
 *   ⑦ 🔴 **폰에서만** 넷이 남는 자리를 나눠 가로폭을 채운다 (2026-11-18 쓰는 분이 고른 그림)
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 주석을 걷어낸 코드만. 🔴 **글자로 재는 시험은 주석까지 긁는다** — 이 조각이 고친 자리에는
 * 「왜 이 크기인가」가 숫자까지 길게 적혀 있어, 주석이 코드 대신 걸리면 다음 사람이
 * **까닭이 적힌 주석을 지우는 쪽으로** 움직인다.
 * 🔵 떼고 나서 빈 글자가 아닌 것을 함께 확인한다(떼는 규칙이 낡으면 전부 조용히 통과한다).
 */
function codeOnly(source: string): string {
  const out = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(out.trim().length > 0, "주석을 떼고 나니 아무것도 안 남았다 — 떼는 규칙이 더는 안 맞는다");
  return out;
}

const code = codeOnly(src("src/components/parts/PartsList.tsx"));

/** 상수 한 줄의 글자값. 🔴 못 찾으면 멈춘다 — 빈 글자로 흘러가면 아래 단언이 전부 통과한다. */
function constant(name: string): string {
  const hit = new RegExp(`const ${name} =\\s*"([^"]*)"`).exec(code);
  assert.ok(hit, `${name} 을(를) 찾지 못했다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라`);
  return hit[1];
}

/**
 * 단추 넷이 든 묶음. `no-print` 가 붙은 맨 위 줄 하나뿐이고, 끝은 그 `</div>` 다.
 * 🔴 끝을 안 끊으면 아래쪽(거르개·쪽 단추) 글자에 걸려 헛통과한다.
 */
function toolbar(): { open: string; body: string } {
  const open = /<div className="(flex flex-wrap[^"]*no-print[^"]*)">/.exec(code);
  assert.ok(open, "맨 위 단추 줄의 바깥 상자를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
  const from = open.index + open[0].length;
  const end = code.indexOf("</div>", from);
  assert.ok(end > from, "단추 줄의 끝(</div>)을 못 찾았다");
  return { open: open[1], body: code.slice(from, end) };
}

const { open: ROW_CLASS, body: ROW } = toolbar();

/* ══════════════════════════════════════════════════════════════════════════
 * ① 🔴 넷이 한 묶음 안에 있다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("① 🔴 단추 넷이 한 묶음 안에 있다 (2026-11-18)", () => {
  it("🔴 크기 상수를 쓰는 자리가 넷 — 셋은 평범한 단추, 하나는 색이 다른 단추", () => {
    assert.equal(ROW.split("className={TOOLBAR_BTN}").length - 1, 3, "맨 위 줄의 평범한 단추가 셋이 아니다");
    assert.equal(ROW.split("className={TOOLBAR_BTN_PRIMARY}").length - 1, 1, "색이 다른 단추가 하나가 아니다");
  });

  it("🔴 줄을 나누는 것이 묶음 안에 섞여 있지 않다", () => {
    for (const bad of ["<br", "basis-full", "w-full", "flex-col", "<hr"]) {
      assert.ok(!ROW.includes(bad), `묶음 안에 ${bad} 가 들어왔다 — 넷이 한 줄에 서지 않는다`);
    }
  });

  it("🔵 `flex-wrap` 은 남는다 — 그래도 모자랄 때의 비상구다(글자가 잘리거나 겹치는 쪽보다 낫다)", () => {
    assert.ok(ROW_CLASS.includes("flex-wrap"), "flex-wrap 이 사라졌다 — 폭이 더 모자라면 단추 글자가 서로 겹친다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 🔴 글자가 안 접힌다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("② 🔴 단추 글자가 안 접힌다 (2026-11-18)", () => {
  it("🔴 크기 상수에 `whitespace-nowrap` 이 있다 — 넷 모두가 그 상수를 쓴다", () => {
    assert.ok(
      constant("TOOLBAR_SIZE").includes("whitespace-nowrap"),
      "「수량 변경 기록」이 두 줄로 접힐 수 있다 — 그 단추만 키가 커져 줄이 통째로 틀어진다",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 🔴 640px 이상은 예전 그대로다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("③ 🔴 넓은 화면 모양이 안 바뀌었다 (2026-11-18)", () => {
  /**
   * 🔴 「좁은 화면만 줄였다」를 믿을 근거는 **되돌리는 쪽을 직접 세어 보는 것**뿐이다.
   *    좁은 쪽 값(`px-1.5 py-2 text-xs`)마다 `sm:` 짝이 있고, 그 짝이 **예전 값과 글자까지 같아야**
   *    640px 이상에서 전과 똑같이 그려진다.
   */
  it("🔴 좁은 쪽에서 줄인 것마다 `sm:` 짝이 있고, 그 값이 예전 크기 그대로다", () => {
    const before = constant("BTN_SIZE").split(/\s+/).filter(Boolean);
    assert.deepEqual(before, ["px-3", "py-1.5", "text-sm"], "예전 단추 크기가 바뀌었다 — 그러면 넓은 화면도 함께 바뀐 것이다");

    const narrow = constant("TOOLBAR_SIZE").split(/\s+/).filter(Boolean);
    for (const token of before) {
      assert.ok(narrow.includes(`sm:${token}`), `640px 이상에서 ${token} 로 안 돌아간다 — 넓은 화면 모양이 바뀐다`);
    }
    // 🔵 되돌리지 않은 채 줄인 것이 남아 있으면 그것도 넓은 화면이 바뀐 것이다.
    const kinds = before.map((t) => t.replace(/-[\d.]+$/, "").replace(/-\w+$/, ""));
    for (const narrowToken of narrow) {
      if (narrowToken.startsWith("sm:") || narrowToken === "whitespace-nowrap") continue;
      const kind = narrowToken.replace(/-[\d.]+$/, "").replace(/-\w+$/, "");
      assert.ok(kinds.includes(kind), `${narrowToken} 은 되돌릴 sm: 짝이 없는 새 값이다 — 넓은 화면도 함께 바뀐다`);
    }
  });

  it("🔴 틈도 640px 이상에서는 예전 값(gap-2)으로 돌아간다", () => {
    assert.ok(ROW_CLASS.includes("sm:gap-2"), "넓은 화면의 단추 사이 틈이 예전 값으로 안 돌아간다");
  });

  it("🔴 같은 파일의 **다른** 단추들은 안 작아졌다 — 크기를 줄인 것은 맨 위 줄뿐이다", () => {
    // 정렬 방향 단추·[이전]·[다음] 쪽 단추는 그대로 `BTN` 을 쓴다. `BTN` 자체를 줄여 푸는 날
    // 이 단언이 깨진다(그 길로 가면 폰에서 저 셋도 같이 작아진다).
    const outside = code.split("className={BTN}").length - 1;
    assert.ok(outside >= 1, "BTN 을 쓰는 단추가 하나도 안 남았다 — BTN 자체를 줄여서 푼 것이 아닌지 봐라");
    assert.ok(!ROW.includes("className={BTN}"), "맨 위 줄이 아직 예전 크기 상수를 쓴다");
  });

  /**
   * 🔴 2026-11-18 에 더해진 「폰에서 넷이 가로폭을 나눠 채운다」가 **넓은 화면으로 새면** PC 에서
   *    단추가 늘어나 쓰는 분이 이 안을 고른 조건이 깨진다. 폰 전용 변형(`max-sm:`)으로 적혀
   *    있는지를 **글자 하나하나** 본다 — 변형이 빠진 날 PC 가 조용히 바뀐다.
   */
  it("🔴 폰에서 자리를 나누는 규칙이 **폰 전용**이다 — PC 에는 선언이 아예 안 생긴다", () => {
    for (const token of constant("TOOLBAR_FILL").split(/\s+/).filter(Boolean)) {
      assert.ok(token.startsWith("max-sm:"), `${token} 이 폰 전용이 아니다 — 넓은 화면에서도 단추가 늘어난다`);
    }
    // 🔴 묶음 쪽에도 폰 전용 규칙이 하나 있다(`max-sm:w-full`). 울타리가 거기까지 닿아야 한다 —
    //    `w-full` 로 적는 순간 PC 에서 단추 묶음이 줄 전체를 먹어 제목과 두 줄로 갈라진다.
    for (const token of ROW_CLASS.split(/\s+/).filter(Boolean)) {
      if (["w-full", "flex-1", "grow", "basis-full"].includes(token)) {
        assert.fail(`단추 묶음에 ${token} 이 폰 전용 변형 없이 적혔다 — PC 에서 묶음이 줄 전체를 먹어 제목과 갈라진다`);
      }
    }
  });

  it("🔵 색·테두리는 **한 자리**에서 온다 — 크기만 두 벌이다", () => {
    assert.match(code, /const BTN = `\$\{BTN_LOOK\} \$\{BTN_SIZE\}`/, "평범한 단추가 공용 생김새를 안 쓴다 — 색을 바꿀 때 고칠 곳이 둘이 된다");
    assert.match(code, /const TOOLBAR_BTN = `\$\{BTN_LOOK\} \$\{TOOLBAR_SIZE\}/, "맨 위 줄 단추가 공용 생김새를 안 쓴다");
    assert.match(code, /const TOOLBAR_BTN_PRIMARY = `\$\{BTN_PRIMARY_LOOK\} \$\{TOOLBAR_SIZE\}/, "맨 위 줄의 색이 다른 단추가 공용 생김새를 안 쓴다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 [부품 등록]만 다른 색
 * ═════════════════════════════════════════════════════════════════════════ */

describe("④ 🔴 [부품 등록]만 색이 다르다 (크기를 맞추면서 그 구분을 먹지 않았다)", () => {
  it("🔴 색이 다른 쪽은 채운 바탕 + 흰 글자, 나머지 셋은 테두리만", () => {
    const primary = constant("BTN_PRIMARY_LOOK");
    const plain = constant("BTN_LOOK");
    assert.ok(primary.includes("bg-zinc-900") && primary.includes("text-white"), "[부품 등록]이 채운 바탕·흰 글자가 아니다");
    assert.ok(plain.includes("border") && !plain.includes("bg-zinc-900"), "나머지 셋이 테두리 단추가 아니다");
    assert.notEqual(primary, plain, "두 생김새가 같아졌다 — [부품 등록]이 나머지와 구분되지 않는다");
  });

  it("🔴 색이 다른 쪽은 **[부품 등록]** 이다 — 딴 단추로 옮겨 가지 않았다", () => {
    const at = ROW.indexOf("TOOLBAR_BTN_PRIMARY");
    assert.ok(at > 0, "색이 다른 단추를 못 찾았다");
    assert.ok(ROW.slice(at, at + 120).includes("부품 등록"), "색이 다른 단추가 [부품 등록]이 아니다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 가는 곳
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑤ 가는 곳이 그대로다 (크기만 손댄 조각이다)", () => {
  /** 🔵 [인쇄]의 주소와 `target`·`rel` 은 `tests/parts-list-cards.test.ts` 가 이미 잰다 — 여기 또 적지 않는다. */
  it("나머지 셋의 주소", () => {
    for (const href of ["href={`/api/export/parts${exportQuery}`}", 'href="/entries/new"', 'href="/parts/new"']) {
      assert.ok(ROW.includes(href), `${href} 가 사라졌다`);
    }
  });

  it("🔴 [인쇄]는 새 창으로 뜬다 — 크기 조절이 그 속성을 건드리지 않았다", () => {
    assert.ok(ROW.includes('target="_blank" rel="noopener"'), "[인쇄]의 새 창 설정이 사라졌다");
  });

  it("🔴 권한에 따라 가리는 두 자리가 그대로다 — 둘·셋만 서는 사람이 있다", () => {
    assert.ok(ROW.includes("{canRecord && ("), "[수량 변경 기록]의 자격 규칙이 사라졌다");
    assert.ok(ROW.includes("{canRegister && ("), "[부품 등록]의 자격 규칙이 사라졌다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ 🔴 폭 셈 — 360px 폰에 넷이 실제로 들어가는가
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 이 조각의 **전부**가 이 숫자다. 다음 사람이 「좀 좁아 보이는데」 하고 여백이나 글자를 도로
 *    키우면 폰에서 조용히 두 줄로 돌아간다 — 그 날 깨지라고 적는다.
 *
 * 재는 법(2026-11-18 실측 기준):
 *   - 쓸 수 있는 폭 = 360 − 32. 레이아웃이 본문 좌우에 16px 씩 둔다(`src/app/(app)/layout.tsx`).
 *   - 한글 한 글자의 너비는 글꼴 크기와 같다(1em). 폰의 한글 글꼴(Noto Sans KR · Apple SD Gothic
 *     Neo)이 전부 그렇다. 공백은 약 0.26em.
 *   - 단추마다 좌우 안쪽 여백 두 몫, 테두리 있는 단추는 좌우 1px 씩, 단추 사이에 틈.
 */
const PHONE_WIDTH = 360;
const LAYOUT_PADDING = 32;
const AVAILABLE = PHONE_WIDTH - LAYOUT_PADDING;
/** 🔵 남겨 둘 여유. 폰 글꼴 크기를 키워 쓰는 분이 있어 딱 맞게 잡으면 그 폰에서 다시 접힌다. */
const HEADROOM = 20;

/** 이름 붙은 글자 크기 → px. 🔴 모르는 값이면 멈춘다(모르는 채 0 으로 세면 공짜로 통과한다). */
const FONT_PX: Record<string, number> = { "text-xs": 12, "text-sm": 14, "text-base": 16 };

/** `px-3` · `gap-1.5` 처럼 숫자가 붙은 Tailwind 값 → px (한 칸 = 4px). */
function spacingPx(token: string): number {
  const hit = /-([\d.]+)$/.exec(token);
  assert.ok(hit, `${token} 에서 숫자를 못 읽었다 — 아는 꼴이 아니면 세지 않는다`);
  return Number(hit[1]) * 4;
}

/** 글자 한 줄의 너비(px). 한글은 1em, 공백은 0.26em, 그 밖(영문·숫자)은 넉넉히 0.6em 으로 센다. */
function textWidth(text: string, fontPx: number): number {
  let em = 0;
  for (const ch of text) {
    if (ch === " ") em += 0.26;
    else if (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch)) em += 1;
    else em += 0.6;
  }
  return em * fontPx;
}

describe("⑥ 🔴 폭 셈 — 360px 폰에 단추 넷이 들어간다 (2026-11-18)", () => {
  /** 묶음 안 단추들의 **글자**. 🔴 라벨은 쓰는 분 것이라 여기 적지 않고 소스에서 읽어 센다. */
  const labels = [...ROW.matchAll(/>\s*([^<>{}\n]+?)\s*</g)].map((m) => m[1].trim()).filter((s) => s.length > 0);

  it("🔵 먼저 **무엇을 재는지** — 묶음에서 단추 글자 넷을 읽어 냈다", () => {
    assert.equal(labels.length, 4, `단추 글자를 넷 못 읽었다(읽은 것: ${JSON.stringify(labels)}) — 읽는 규칙이 낡으면 이 셈이 통째로 공짜가 된다`);
    for (const label of labels) assert.ok(label.length > 0, "빈 글자를 단추로 셌다");
  });

  it("🔴 넷 + 여백 + 틈이 328px 안에 들고, 여유가 20px 이상 남는다", () => {
    const narrow = constant("TOOLBAR_SIZE").split(/\s+/).filter(Boolean);

    const fontToken = narrow.find((t) => FONT_PX[t] !== undefined);
    assert.ok(fontToken, `좁은 화면의 글자 크기를 못 읽었다(${narrow.join(" ")}) — 아는 꼴(text-xs 등)이 아니면 세지 않는다`);
    const fontPx = FONT_PX[fontToken];

    const padToken = narrow.find((t) => /^px-[\d.]+$/.test(t));
    assert.ok(padToken, "좁은 화면의 좌우 안쪽 여백을 못 읽었다");
    const padPx = spacingPx(padToken);

    const gapToken = ROW_CLASS.split(/\s+/).find((t) => /^gap-[\d.]+$/.test(t));
    assert.ok(gapToken, "단추 사이 틈을 못 읽었다");
    const gapPx = spacingPx(gapToken);

    // 테두리 있는 단추(TOOLBAR_BTN)만 좌우 1px 씩 더 먹는다. 색이 다른 단추는 테두리가 없다.
    const bordered = ROW.split("className={TOOLBAR_BTN}").length - 1;

    const text = labels.reduce((sum, label) => sum + textWidth(label, fontPx), 0);
    const total = text + labels.length * padPx * 2 + bordered * 2 + (labels.length - 1) * gapPx;

    assert.ok(
      total <= AVAILABLE - HEADROOM,
      `폰 360px 에서 단추 넷이 ${Math.round(total)}px 다 — 쓸 수 있는 폭 ${AVAILABLE}px 에서 여유 ${HEADROOM}px 를 빼면 ${AVAILABLE - HEADROOM}px 까지다. ` +
        `글자 ${Math.round(text)} + 안쪽 여백 ${labels.length * padPx * 2} + 테두리 ${bordered * 2} + 틈 ${(labels.length - 1) * gapPx}. ` +
        `여백(${padToken})·글자(${fontToken})·틈(${gapToken}) 중 하나를 도로 키운 것이 아닌지 봐라 — 폰에서 다시 두 줄이 된다`,
    );
  });

  it("🔵 이 셈이 **까다로운지** 스스로 확인 — 예전 크기(14px·px-3·gap-2)로는 328px 을 넘는다", () => {
    const old = labels.reduce((sum, label) => sum + textWidth(label, FONT_PX["text-sm"]), 0) + 4 * 12 * 2 + 3 * 2 + 3 * 8;
    assert.ok(old > AVAILABLE, `예전 크기로도 ${Math.round(old)}px 라 328px 안에 든다 — 그렇다면 쓰는 분이 본 두 줄은 다른 까닭이고 이 셈이 틀린 것이다`);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑦ 🔴 폰에서는 넷이 남는 자리를 나눠 가로폭을 채운다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑦ 🔴 폰에서 넷이 가로폭을 나눠 갖는다 (2026-11-18, 쓰는 분이 고른 그림)", () => {
  const fill = constant("TOOLBAR_FILL");

  /**
   * 🔴 **2026-11-18 에 이것 하나가 빠져서 한 번 틀렸다.** 단추마다 `flex-1` 을 주고 시험 스물한
   *    개가 전부 초록이었는데 폰 화면은 오른쪽이 150px 남짓 빈 채였다.
   *
   *    까닭: 이 묶음은 **바깥 줄의 flex 칸**이고, flex 칸의 기본 폭은 「제 내용 폭」이다. 폰에서
   *    `flex-wrap` 덕에 제목 아래로 **내려가기는 해도** 폭은 단추 넷을 합친 만큼이다 —
   *    **내려가는 것과 줄을 다 쓰는 것은 다른 일이다.** 그러면 안쪽 `flex-1` 이 나눠 가질 자리가
   *    0 이라 단추들은 그냥 제 글자 폭으로 선다.
   *
   *    🔵 그래서 `max-sm:w-full`(바깥 한 겹)과 `max-sm:flex-1`(안쪽)은 **둘이 한 쌍**이다.
   *       어느 한쪽만 지워도 오류 없이 조용히 예전 모습으로 돌아간다.
   */
  it("🔴 묶음이 폰에서 **줄 전체를 쓴다** — 이게 없으면 안쪽 flex-1 이 나눌 자리가 0 이다", () => {
    assert.ok(
      ROW_CLASS.includes("max-sm:w-full"),
      `단추 묶음이 폰에서 제 내용 폭으로 선다(class: ${ROW_CLASS}) — 제목 아래로 내려가기만 하고 오른쪽이 빈다. ` +
        "안쪽 단추에 flex-1 을 아무리 줘도 나눠 가질 남는 자리가 없다",
    );
  });

  it("🔴 남는 자리를 나눠 갖고, 늘어난 자리는 글자 **양옆으로** 갈라진다", () => {
    assert.ok(fill.includes("max-sm:flex-1"), "폰에서 단추가 남는 자리를 안 나눠 갖는다 — 왼쪽에 모여 서고 오른쪽이 빈다");
    assert.ok(fill.includes("max-sm:text-center"), "늘어난 자리가 오른쪽에만 붙는다 — 짧은 [인쇄]가 한쪽으로 쏠려 보인다");
  });

  it("🔴 넷 **모두**가 그 규칙을 쓴다 — 하나만 빠지면 그 단추만 글자 폭으로 남는다", () => {
    for (const name of ["TOOLBAR_BTN", "TOOLBAR_BTN_PRIMARY"]) {
      assert.match(
        code,
        new RegExp(`const ${name} = \`[^\`]*\\$\\{TOOLBAR_FILL\\}`),
        `${name} 이 자리 나누기 규칙을 안 쓴다 — 그 단추만 안 늘어나 줄 끝이 빈다`,
      );
    }
  });

  /**
   * 🔴 flex 칸의 기본 최소 폭은 「글자 폭」이고, 이 화면은 **그것에 두 가지를 기대고 있다**:
   *    ① 늘어나도 글자가 칸 밖으로 비어져 나오지 않는다
   *    ② 자리가 모자라면 `flex-wrap` 이 전처럼 줄을 바꾼다(줄을 바꿀지는 늘어나기 전 폭으로 정한다)
   *    `min-w-0` 은 그 최소 폭을 0 으로 만들어 **둘 다** 없앤다 — 넓은 자리에서는 멀쩡해 보이고
   *    좁은 폰에서만 글자가 삐져나오므로, 들어오는 날 아무도 못 알아챈다.
   */
  it("🔴 `min-w-0` 이 없다 — 있으면 좁은 폰에서 글자가 칸 밖으로 비어져 나온다", () => {
    assert.ok(!fill.includes("min-w-0"), "자리 나누기 규칙에 min-w-0 이 들어왔다");
    assert.ok(!ROW.includes("min-w-0"), "단추 줄 안에 min-w-0 이 들어왔다");
    assert.ok(!constant("TOOLBAR_SIZE").includes("min-w-0"), "크기 상수에 min-w-0 이 들어왔다");
  });

  it("🔵 늘어나는 바탕이 되는 줄이 가로 flex 그대로다", () => {
    const classes = ROW_CLASS.split(/\s+/).filter(Boolean);
    assert.ok(classes.includes("flex"), "단추 줄이 flex 가 아니다 — flex 가 아니면 자리 나누기가 아무 뜻이 없다");
    assert.ok(!classes.includes("flex-col"), "단추 줄이 세로로 섰다");
  });
});
