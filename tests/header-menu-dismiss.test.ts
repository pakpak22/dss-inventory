import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HeaderMenuDismiss,
  dismissAll,
  dismissOnPanelAction,
  dismissOutside,
  watchHeaderMenus,
  type HeaderMenuEventHost,
  type HeaderMenuHandle,
} from "../src/components/HeaderMenuDismiss";

/**
 * ============================================================================
 * 머리말 ☰ 패널이 **저절로 접힌다** (2026-10-22, 쓰는 분 요청)
 * ============================================================================
 * 「패널 안의 메뉴를 눌러 화면을 옮기면 접힌다」·「열린 채 바깥을 누르면 접힌다」.
 * 그 전에는 둘 다 안 접혀서, 옮겨 간 화면을 패널이 덮고 있고 ☰ 를 한 번 더 눌러야 했다.
 *
 * ── 🔴 브라우저 없이 어떻게 재는가 ─────────────────────────────────────
 * 이 저장소의 시험에는 **jsdom 이 없다**(화면을 그려 재는 시험이 아예 없다 —
 * tests/app-header-responsive.test.ts 머리말). 그래서 조각을 둘로 갈라 두었다:
 *   - **접을지 말지 가리는 판단**과 **사건을 붙였다 떼는 일**은 진짜 DOM 을 몰라도
 *     되게 해 두었다(`HeaderMenuHandle`·`HeaderMenuEventHost` 는 「접을 수 있는 것」과
 *     「사건을 듣는 곳」의 최소 모양이다). 여기서는 **가짜를 끼워** 직접 돌려 본다.
 *   - 진짜 document 를 그 자리에 넣는 곳은 `openHeaderMenus` / `HeaderMenuDismiss`
 *     두 군데뿐이다. 그 둘은 jsdom 이 없어 못 돌리므로, **두 파일의 글자를 맞대어**
 *     (표식 이름이 같은가 · 조각이 <details> 안에 놓였는가) 잰다 — 아래 ④.
 *
 * ── 🔴 글자로 재는 단언은 **주석을 떼고** 본다 ─────────────────────────
 * 이 조각이 손댄 두 파일의 주석에는 「`details[open]` 처럼 넓게 잡지 않는다」 같은
 * 말이 일부러 적혀 있다. 주석이 코드 대신 걸리면 다음 사람이 **까닭이 적힌 주석을
 * 지우는 쪽으로** 움직인다(2026-10-16·2026-10-22 에 실제로 두 번 났다).
 * ============================================================================
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 가짜 — 접을 수 있는 ☰ 하나와, 사건을 듣는 곳 하나
 * ═════════════════════════════════════════════════════════════════════════ */

/** 누른 자리 — 진짜 DOM 마디가 아니어도 된다. 견주기만 한다. */
function 자리(): EventTarget {
  return {} as EventTarget;
}

/**
 * 접을 수 있는 가짜 ☰ 하나.
 *  - `안쪽` 에 든 자리를 누른 것만 「이 ☰ 안」으로 친다(<details> 안 — ☰ 단추와 패널 전부).
 *  - `가는것` 에 든 자리를 누른 것만 「패널 안의 눌러서 가는 것」(링크·단추)으로 친다.
 */
function 가짜메뉴(안쪽: readonly EventTarget[] = [], 가는것: readonly EventTarget[] = []) {
  let 접힌횟수 = 0;

  const handle: HeaderMenuHandle = {
    contains: (node) => node !== null && 안쪽.includes(node),
    activatesInPanel: (node) => node !== null && 가는것.includes(node),
    close: () => {
      접힌횟수 += 1;
    },
  };

  return { handle, 접힌횟수: () => 접힌횟수 };
}

type 등록 = {
  type: string;
  listener: (event: Event) => void;
  options?: boolean | AddEventListenerOptions;
};

/** 사건을 듣는 가짜 곳. 무엇을 붙였고 무엇을 뗐는지 그대로 적어 둔다. */
function 가짜듣는곳() {
  const 붙인것: 등록[] = [];
  const 뗀것: 등록[] = [];

  const host: HeaderMenuEventHost = {
    addEventListener: (type, listener, options) => {
      붙인것.push({ type, listener, options });
    },
    removeEventListener: (type, listener, options) => {
      뗀것.push({ type, listener, options });
    },
  };

  /**
   * 아직 붙어 있는 리스너에게만 사건을 넘긴다 — 뗀 것은 부르지 않는다.
   * 가짜 사건은 우리가 보는 두 칸(누른 자리 · 누른 키)만 갖는다.
   */
  const 일으킨다 = (type: string, event: { target?: EventTarget | null; key?: string }) => {
    for (const 하나 of 붙인것) {
      if (하나.type !== type) continue;
      if (뗀것.some((x) => x.type === type && x.listener === 하나.listener)) continue;
      하나.listener(event as unknown as Event);
    }
  };

  return { host, 붙인것, 뗀것, 일으킨다 };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 바깥을 누르면 접힌다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("① 바깥을 누르면 접힌다 (쓰는 분 요청 둘째)", () => {
  it("☰ 묶음 밖을 누르면 접힌다", () => {
    const 메뉴 = 가짜메뉴([자리()]);

    dismissOutside([메뉴.handle], 자리());

    assert.equal(메뉴.접힌횟수(), 1);
  });

  it("누른 자리를 알 수 없으면(target 이 없으면) 바깥으로 친다", () => {
    const 메뉴 = 가짜메뉴([자리()]);

    dismissOutside([메뉴.handle], null);

    assert.equal(메뉴.접힌횟수(), 1);
  });

  it("🔴 ☰ 묶음 **안**을 누른 것은 바깥이 아니다 — 누르는 그 순간에는 접지 않는다", () => {
    const 안 = 자리();
    const 메뉴 = 가짜메뉴([안]);

    dismissOutside([메뉴.handle], 안);

    assert.equal(메뉴.접힌횟수(), 0, "☰ 단추를 누르는 순간 우리가 먼저 접으면, 그 누름이 다시 펼쳐 접히지 않는 단추가 된다");
  });

  it("펼쳐진 것이 여럿이면 바깥인 것만 접는다", () => {
    const 누른자리 = 자리();
    const 눌린쪽 = 가짜메뉴([누른자리]);
    const 딴쪽 = 가짜메뉴();

    dismissOutside([눌린쪽.handle, 딴쪽.handle], 누른자리);

    assert.equal(눌린쪽.접힌횟수(), 0);
    assert.equal(딴쪽.접힌횟수(), 1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 패널 안의 메뉴를 누르면 접힌다 — 🔴 본보기와 **일부러 다른** 곳
 * ═════════════════════════════════════════════════════════════════════════ */

describe("② 패널 안의 메뉴를 누르면 접힌다 (쓰는 분 요청 첫째)", () => {
  /**
   * 🔴 본보기(@dss/ui 의 DropdownDismiss)는 **목록 안을 누른 것은 일부러 안 접는다** —
   *    거기 링크는 다른 사이트로 나가면서 화면이 통째로 바뀌기 때문이다. 우리 ☰ 는
   *    반대다: 패널의 링크는 같은 앱 안의 이동(next/link)이라 머리말이 살아남으므로,
   *    접지 않으면 옮겨 간 화면을 패널이 덮는다. **되돌리지 마라.**
   */
  it("🔴 패널의 링크·단추를 누르면 접힌다 — 본보기와 달리하는 바로 그 한 가지", () => {
    const 링크 = 자리();
    const 메뉴 = 가짜메뉴([링크], [링크]);

    dismissOnPanelAction([메뉴.handle], 링크);

    assert.equal(메뉴.접힌횟수(), 1, "같은 앱 안의 이동이라 머리말이 살아남는다 — 접지 않으면 옮겨 간 화면을 패널이 덮는다");
  });

  it("🔴 패널 안이어도 **가는 것이 아니면** 안 접는다 — 역할 바꿔 보기의 고르개·맨 글자", () => {
    const 고르개 = 자리();
    const 메뉴 = 가짜메뉴([고르개], []);

    dismissOnPanelAction([메뉴.handle], 고르개);

    assert.equal(메뉴.접힌횟수(), 0, "고르개를 펼치려고 누른 것에 패널이 접히면 고를 수가 없다");
  });

  it("🔴 ☰ 단추를 누른 것은 접지 않는다 — 접는 일은 그때 브라우저가 하고 있다", () => {
    const 단추 = 자리();
    const 메뉴 = 가짜메뉴([단추], []);

    dismissOnPanelAction([메뉴.handle], 단추);

    assert.equal(메뉴.접힌횟수(), 0, "우리가 함께 접으면 그 누름이 다시 펼쳐 접히지 않는 단추가 된다");
  });

  it("바깥을 누른 것은 이쪽에서 접지 않는다 — 그 몫은 ①이다", () => {
    const 메뉴 = 가짜메뉴([자리()], [자리()]);

    dismissOnPanelAction([메뉴.handle], 자리());

    assert.equal(메뉴.접힌횟수(), 0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 무엇을 듣는가 — 🔴 바깥은 pointerdown, 안은 click
 * ═════════════════════════════════════════════════════════════════════════ */

describe("③ 듣는 사건 셋", () => {
  it("🔴 폰까지 한 번에 받으려고 pointerdown 을 듣는다 — click 은 iOS 에서 빈 바탕을 누르면 문서까지 오지 않는다", () => {
    const 듣는곳 = 가짜듣는곳();

    watchHeaderMenus(듣는곳.host, () => []);

    assert.deepEqual(
      듣는곳.붙인것.map((하나) => 하나.type).sort(),
      ["click", "keydown", "pointerdown"],
      "바깥을 받는 pointerdown · 패널 안을 받는 click · Esc 를 받는 keydown 셋이다"
    );
  });

  it("🔴 셋 다 capture 로 듣는다 — 중간에서 누가 stopPropagation 을 불러도 들린다", () => {
    const 듣는곳 = 가짜듣는곳();

    watchHeaderMenus(듣는곳.host, () => []);

    for (const 하나 of 듣는곳.붙인것) {
      assert.deepEqual(하나.options, { capture: true }, `${하나.type} 를 capture 로 안 듣는다`);
    }
  });

  /**
   * 🔴 **이 시험이 이 조각의 핵심이다.** 패널 안을 `pointerdown` 에 접으면, 눌린 링크·단추가
   *    손을 떼기 전에 화면에서 사라져(접힌 <details> 의 안쪽은 display:none) **click 이 아예
   *    안 난다** — 패널만 닫히고 화면은 안 옮겨 가고 [로그아웃]도 안 눌린다. 눈으로는
   *    「닫히긴 하네」로 보여서 더 위험하다.
   */
  it("🔴 패널 안은 **누르는 순간이 아니라 눌리고 난 뒤**(click)에 접힌다 — 안 그러면 링크가 안 눌린다", () => {
    const 링크 = 자리();
    const 메뉴 = 가짜메뉴([링크], [링크]);
    const 듣는곳 = 가짜듣는곳();

    watchHeaderMenus(듣는곳.host, () => [메뉴.handle]);

    듣는곳.일으킨다("pointerdown", { target: 링크 });
    assert.equal(메뉴.접힌횟수(), 0, "누르는 순간 접으면 링크가 사라져 click 이 안 나고, 화면이 안 옮겨 간다");

    듣는곳.일으킨다("click", { target: 링크 });
    assert.equal(메뉴.접힌횟수(), 1, "눌리고 난 뒤에는 접어도 그 누름이 취소되지 않는다");
  });

  it("바깥은 반대로 **누르는 순간**(pointerdown) 접힌다", () => {
    const 바깥 = 자리();
    const 메뉴 = 가짜메뉴();
    const 듣는곳 = 가짜듣는곳();

    watchHeaderMenus(듣는곳.host, () => [메뉴.handle]);

    듣는곳.일으킨다("pointerdown", { target: 바깥 });

    assert.equal(메뉴.접힌횟수(), 1);
  });

  it("Esc 는 펼쳐진 것을 전부 접는다 — 안이든 바깥이든 가리지 않는다", () => {
    const 하나 = 가짜메뉴();
    const 둘 = 가짜메뉴([자리()]);

    dismissAll([하나.handle, 둘.handle]);

    assert.equal(하나.접힌횟수(), 1);
    assert.equal(둘.접힌횟수(), 1);
  });

  it("Esc 말고 다른 키는 아무 일도 하지 않는다 — 글자를 치다 메뉴가 접히면 안 된다", () => {
    const 메뉴 = 가짜메뉴();
    const 듣는곳 = 가짜듣는곳();

    watchHeaderMenus(듣는곳.host, () => [메뉴.handle]);

    for (const key of ["Enter", "Tab", "e", "Esc", " "]) {
      듣는곳.일으킨다("keydown", { key });
    }

    assert.equal(메뉴.접힌횟수(), 0);
  });

  it("🔴 사건이 올 때마다 지금 펼쳐진 것을 다시 찾는다 — 한 번 붙잡아 두지 않는다", () => {
    let 찾은횟수 = 0;
    const 듣는곳 = 가짜듣는곳();

    watchHeaderMenus(듣는곳.host, () => {
      찾은횟수 += 1;
      return [];
    });

    assert.equal(찾은횟수, 0, "붙이는 것만으로 화면을 뒤지지 않는다");

    듣는곳.일으킨다("pointerdown", { target: 자리() });
    듣는곳.일으킨다("click", { target: 자리() });
    듣는곳.일으킨다("keydown", { key: "Escape" });

    assert.equal(찾은횟수, 3, "머리말은 화면마다 다시 그려질 수 있다 — 그때마다 새로 찾아야 한다");
  });

  it("🔴 붙인 것을 **전부** 떼어낸다 — 같은 함수, 같은 옵션으로", () => {
    const 듣는곳 = 가짜듣는곳();

    const 뒷정리 = watchHeaderMenus(듣는곳.host, () => []);
    assert.equal(듣는곳.뗀것.length, 0, "아직 뗄 때가 아니다");

    뒷정리();

    // 옵션(capture)이 다르면 브라우저는 다른 리스너로 보고 떼지 않는다 — 그래서 옵션까지 대조한다.
    assert.deepEqual(듣는곳.뗀것, 듣는곳.붙인것);
    for (const 붙인 of 듣는곳.붙인것) {
      assert.ok(
        듣는곳.뗀것.some((뗀) => 뗀.type === 붙인.type && 뗀.listener === 붙인.listener),
        `${붙인.type} 리스너가 화면에 남는다 — 화면을 오갈수록 쌓인다`
      );
    }
  });

  it("뒷정리한 뒤에는 눌러도 접히지 않는다", () => {
    const 링크 = 자리();
    const 메뉴 = 가짜메뉴([링크], [링크]);
    const 듣는곳 = 가짜듣는곳();

    watchHeaderMenus(듣는곳.host, () => [메뉴.handle])();

    듣는곳.일으킨다("pointerdown", { target: 자리() });
    듣는곳.일으킨다("click", { target: 링크 });
    듣는곳.일으킨다("keydown", { key: "Escape" });

    assert.equal(메뉴.접힌횟수(), 0);
  });

  it("펼쳐진 것이 하나도 없으면 아무 일도 하지 않는다", () => {
    const 듣는곳 = 가짜듣는곳();

    watchHeaderMenus(듣는곳.host, () => []);

    assert.doesNotThrow(() => {
      듣는곳.일으킨다("pointerdown", { target: 자리() });
      듣는곳.일으킨다("click", { target: 자리() });
      듣는곳.일으킨다("keydown", { key: "Escape" });
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 서버/클라이언트 경계와 **표식이 두 곳에서 맞는가**
 * ═════════════════════════════════════════════════════════════════════════ */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 주석을 걷어낸 코드만. 🔵 떼고 나서 빈 글자가 아닌 것을 함께 확인한다(떼는 규칙이 낡으면 전부 조용히 통과한다). */
function codeOnly(source: string): string {
  const out = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(out.trim().length > 0, "주석을 떼고 나니 아무것도 안 남았다 — 떼는 규칙이 더는 안 맞는다");
  return out;
}

const DISMISS = "src/components/HeaderMenuDismiss.tsx";
const HEADER = "src/components/AppHeader.tsx";
const dismissCode = codeOnly(src(DISMISS));
const headerCode = codeOnly(src(HEADER));

/** 클라이언트 지시문. 🔴 **낱말로 적지 않고 값으로 둔다** — 주석에 그대로 쓰면 글자로 세는 시험이 뒤집힌다. */
const CLIENT_DIRECTIVE = '"use client"';

/** 머리말의 `<details … >` 여는 태그 하나. */
function headerDetailsTag(): string {
  const start = headerCode.indexOf("<details");
  assert.ok(start > 0, "☰ 의 <details> 를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
  const end = headerCode.indexOf(">", start);
  assert.ok(end > start, "<details> 의 여는 태그가 안 닫힌다");
  return headerCode.slice(start, end + 1);
}

describe("④ 🔴 경계는 **새 파일 하나**다 — 머리말은 서버 컴포넌트로 남는다", () => {
  /**
   * 🔴 서버/클라이언트 경계가 어긋나면 **시험이 다 통과해도 화면이 안 열리고** `npm run build`
   *    에서만 드러난다. 이 저장소에서 실제로 났던 종류다. 그래서 갈린 것을 시험으로 못 박는다.
   *    (머리말 쪽은 tests/app-header-responsive.test.ts 도 같은 것을 재고 있다 — 두 벌이지만,
   *     이 조각이 깨뜨릴 수 있는 바로 그 짝이라 여기서도 짝으로 본다.)
   */
  it("🔴 새 조각이 **클라이언트**다 — 지시문이 맨 앞 한 줄이다", () => {
    assert.ok(dismissCode.trimStart().startsWith(CLIENT_DIRECTIVE), "지시문이 맨 앞에 없다 — 아래에 적으면 조용히 안 먹고 useEffect 가 서버에서 돌려진다");
    assert.equal(dismissCode.split(CLIENT_DIRECTIVE).length - 1, 1, "지시문이 둘이 됐다");
  });

  it("🔴 머리말은 **서버**로 남는다 — 지시문도 상태도 없다", () => {
    assert.equal(headerCode.split(CLIENT_DIRECTIVE).length - 1, 0, "머리말이 클라이언트 컴포넌트가 됐다 — 이 조각은 곁들이로 얹는 것이지 머리말을 내리는 것이 아니다");
    assert.equal(headerCode.split("'use client'").length - 1, 0, "따옴표만 바꾼 지시문이 들어왔다");
    for (const bad of ["useState", "useEffect", "useRef", "usePathname", "onClick", "onChange"]) {
      assert.equal(headerCode.split(bad).length - 1, 0, `머리말에 ${bad} 가 생겼다 — 그 순간 파일 전체가 클라이언트로 내려간다`);
    }
  });

  it("🔴 ☰ 를 여닫는 방식은 그대로다 — `<details>`/`<summary>` 를 안 바꿨다", () => {
    assert.equal(headerCode.split("<details").length - 1, 1, "☰ 의 <details> 가 없거나 둘이 됐다");
    assert.equal(headerCode.split("<summary").length - 1, 1, "<summary> 가 없거나 둘이 됐다");
    // 🔴 조각은 **듣기만 한다.** 누름을 가로채면 [로그아웃](<form action> 의 submit 단추)이 안 눌린다.
    assert.ok(!dismissCode.includes("preventDefault"), "누름을 취소하고 있다 — 로그아웃 단추가 안 눌린다");
    assert.ok(!dismissCode.includes("stopPropagation"), "사건을 가로채고 있다 — 사이트 쪽 동작이 함께 죽는다");
  });
});

describe("④-2 🔴 손잡이의 표식이 **두 파일에서 같은가**", () => {
  /**
   * 🔴 한쪽만 이름을 바꾸면 **아무것도 안 접히는데 오류도 안 난다** — 조용히 예전으로
   *    돌아가고 아무도 신고하지 않는다. 그래서 선택자에서 칸 이름을 뽑아 머리말의
   *    <details> 태그와 직접 맞대어 본다.
   */
  it("🔴 조각이 찾는 칸이 머리말의 `<details>` 에 실제로 붙어 있다", () => {
    const 선택자 = /const OPEN_HEADER_MENUS = "([^"]+)"/.exec(dismissCode);
    assert.ok(선택자, "선택자를 못 찾았다 — 이름이 바뀌었으면 이 시험도 함께 고쳐라");

    const 표식 = /\[(data-[a-z-]+)\]/.exec(선택자[1]);
    assert.ok(표식, `선택자(${선택자[1]})에 data- 표식이 없다 — 무엇으로 「우리 ☰」만 고르는지 알 수 없다`);

    // 🔴 `includes` 로 재지 마라 — `data-header-menu-바뀐이름` 도 **그 글자를 품고 있어** 통과한다.
    //    (이 시험을 쓰면서 역검증으로 실제로 한 번 헛통과했다.) 칸 이름이 거기서 끝나는지까지 본다.
    const 붙어있나 = new RegExp(`\\s${표식[1]}(?=[=\\s>])`);
    assert.match(headerDetailsTag(), 붙어있나, `머리말의 <details> 에 ${표식[1]} 이 없다 — 조각이 아무것도 못 찾아 패널이 저절로 안 접힌다`);
    assert.ok(선택자[1].includes("[open]"), "펼쳐진 것만 고르지 않는다 — 접혀 있는 것까지 헛되이 싼다");
  });

  it("🔴 `details[open]` 처럼 **넓게 잡지 않는다** — 남의 <details> 까지 접는다", () => {
    assert.ok(!/querySelectorAll\w*\(\s*"details\[open\]"/.test(dismissCode), "선택자가 화면의 모든 <details> 를 집는다");
    assert.ok(!dismissCode.includes('"details[open]"'), "선택자가 화면의 모든 <details> 를 집는다");
  });

  it("🔴 조각이 ☰ 의 `<details>` **안**에 한 번 놓인다 — 밖에 두면 영영 안 돌아도 모른다", () => {
    assert.equal(headerCode.split("<HeaderMenuDismiss").length - 1, 1, "조각이 없거나 두 번 놓였다");
    assert.ok(headerCode.includes("HeaderMenuDismiss } from"), "머리말이 조각을 가져오지 않는다");

    const 안 = headerCode.indexOf("<HeaderMenuDismiss");
    const 열림 = headerCode.indexOf("<details");
    const 닫힘 = headerCode.indexOf("</details>");
    assert.ok(열림 < 안 && 안 < 닫힘, "조각이 ☰ 의 <details> 밖에 있다");
  });

  /**
   * 🔵 제목이 「보이는 모양은 하나도 안 바뀌었다」였다. 2026-10-22 에 ☰ 가 머리말 맨 왼쪽으로
   *    가고 패널이 **왼쪽 서랍**이 되면서 그 말은 더는 맞지 않는다 — 다만 **여기서 재는 셋**
   *    (접는 폭 둘 · 인쇄 규칙)은 그때도 한 글자도 안 바뀌었고, 바뀌면 곤란한 것도 그대로다.
   *    그래서 단언은 손대지 않고 **재는 것이 무엇인지로** 제목만 바로잡았다.
   */
  it("🔵 접는 경계와 인쇄 규칙은 그대로다 — 서랍으로 바뀌면서도 이 셋은 안 건드렸다", () => {
    assert.equal(headerCode.split("md:hidden").length - 1, 1, "☰ 가 서는 폭이 바뀌었다");
    assert.equal(headerCode.split("md:flex").length - 1, 2, "넓은 화면의 메뉴 줄·사용자 묶음이 서는 폭이 바뀌었다");
    assert.equal(headerCode.split("no-print").length - 1, 2, "인쇄에서 머리말 메뉴를 숨기는 표가 바뀌었다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ 🔴 검은 바탕이 **닫기로 이어지는가** — 규칙이 두 파일에 흩어져 있다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑥ 🔴 서랍의 검은 바탕을 누르면 닫힌다", () => {
  /**
   * 🔴 2026-10-22, ☰ 패널이 **왼쪽에서 나오는 서랍**이 되면서 검은 바탕이 `<details>` **안**으로
   *    들어왔다. 즉 「바깥」이 아니다 — 바깥 누르기(pointerdown)로는 안 접힌다. 접히는 길은
   *    하나뿐이다: **패널 안**을 click 으로 듣고 눌린 것이 `PANEL_ACTIONS` 에 걸릴 때.
   *
   * 🔴 그래서 바탕이 평범한 `<div>` 가 되거나, 저쪽 `PANEL_ACTIONS` 에서 `button` 이 빠지면
   *    **눌러도 아무 일이 없는데 오류는 한 줄도 안 난다.** 규칙이 두 파일에 흩어져 있어 한쪽만
   *    고치는 날이 반드시 온다 — 그 날을 잡으려고 둘을 **맞대어** 본다.
   */
  const BACKDROP_LABEL = 'aria-label="메뉴 닫기"';

  /** 검은 바탕의 **여는 태그 하나**. 주석은 이미 걷어낸 글자에서 찾는다. */
  function backdropTag(): string {
    assert.equal(headerCode.split(BACKDROP_LABEL).length - 1, 1, `검은 바탕(${BACKDROP_LABEL})이 없거나 둘이다 — 서랍을 눌러 닫을 길이 사라졌다`);
    const at = headerCode.indexOf(BACKDROP_LABEL);
    const start = headerCode.lastIndexOf("<", at);
    const end = headerCode.indexOf(">", at);
    assert.ok(start >= 0 && end > start, "검은 바탕의 여는 태그를 읽지 못했다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
    return headerCode.slice(start, end + 1);
  }

  it("🔴 검은 바탕은 ☰ 의 `<details>` **안**에 있다 — 그래서 「바깥 누르기」로는 안 접힌다", () => {
    const 열림 = headerCode.indexOf("<details");
    const 닫힘 = headerCode.indexOf("</details>");
    const 바탕 = headerCode.indexOf(BACKDROP_LABEL);
    assert.ok(열림 > 0 && 열림 < 바탕 && 바탕 < 닫힘, "검은 바탕이 ☰ 밖에 있다 — 아래 두 단언이 재는 전제가 통째로 달라진다");
  });

  it("🔴 바탕의 태그가 `PANEL_ACTIONS` 에 **실제로 걸린다** — 걸려야 click 에 접힌다", () => {
    const 규칙 = /const PANEL_ACTIONS = "([^"]+)"/.exec(dismissCode);
    assert.ok(규칙, "PANEL_ACTIONS 를 못 찾았다 — 이름이 바뀌었으면 이 시험도 함께 고쳐라");
    const 걸리는것 = 규칙[1].split(",").map((하나) => 하나.trim());

    const 태그 = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(backdropTag());
    assert.ok(태그, "검은 바탕의 태그 이름을 읽지 못했다");
    assert.ok(
      걸리는것.includes(태그[1]),
      `검은 바탕이 <${태그[1]}> 인데 PANEL_ACTIONS("${규칙[1]}") 에 그것이 없다 — 눌러도 서랍이 안 닫히는데 오류도 안 난다`
    );
  });

  it('🔴 바탕에 `type="button"` 이 있다 — 기본값 `submit` 이면 같은 서랍의 폼이 날아간다', () => {
    assert.match(
      backdropTag(),
      /\stype="button"/,
      '검은 바탕에 type="button" 이 없다 — 지금은 <form action={logoutAction}> 밖이라 조용하지만, 같은 서랍 안에 그 폼이 있어 마크업을 조금만 손대면 누를 때마다 로그아웃된다'
    );
  });

  it("🔵 바탕은 **화면을 꽉 덮는다** — 덮지 않으면 가려지지 않은 곳이 「바깥」이 되어 길이 둘로 갈린다", () => {
    assert.match(headerCode, /<div className="fixed inset-0 z-\[60\] flex">/, "서랍 바깥이 화면 전체가 아니다");
    assert.match(backdropTag(), /className="absolute inset-0 /, "검은 바탕이 그 안을 다 덮지 않는다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 그리는 것이 없다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑤ 🔴 마크업이 한 글자도 늘지 않는다", () => {
  it("조각은 아무것도 그리지 않는다 — 서버가 그린 것과 어긋날 자리가 없다", () => {
    assert.equal(renderToStaticMarkup(React.createElement(HeaderMenuDismiss)), "");
  });

  it("🔴 서버에서 그려도 터지지 않는다 — 그리는 동안에는 화면의 물건을 만지지 않는다", () => {
    // node 에는 document 가 아예 없다. 그리는 동안 그것을 만지는 코드가 한 줄이라도
    // 있으면 이 시험이 바로 빨개진다.
    assert.equal(typeof globalThis.document, "undefined", "이 시험의 전제가 깨졌다");
    assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(HeaderMenuDismiss)));
  });
});
