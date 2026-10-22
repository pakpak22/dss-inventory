import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * ============================================================================
 * 머리말이 폰에서 세로로 찌그러지지 않는다 (2026-10-22, 쓰는 분 요청)
 * ============================================================================
 * 그 전까지 머리말은 **줄바꿈도 스크롤도 없는 한 줄**이었다. 폭이 모자라면 flex 칸이
 * min-content(한글 한 자) 까지 줄어들어 폰(360~412px)에서 「재고 관리」가
 * 「재 / 고 / 관 / 리」로 쪼개졌다 — 노트북 창을 반만 줄여도 같은 증상이 났다.
 *
 * ── 🔴 왜 소스 글자로 재는가 ───────────────────────────────────────────
 * 이 저장소에는 **화면 렌더 시험이 없다.** 머리말은 서버 컴포넌트이고 `logoutAction`
 * (서버 액션)을 가져오므로 시험에서 import 조차 되지 않는다 — `tests/repair-case.test.ts`·
 * `tests/settings-access.test.ts` 가 쓰는 처방을 그대로 쓴다.
 *
 * 🔴 **주석은 걷어내고 잰다.** 이 조각이 고친 파일의 머리말에는 「`"use client"` 가 없다」
 * 「`md` 미만에서 접는다」 같은 말이 일부러 길게 적혀 있다. 주석이 코드 대신 걸리면
 * 다음 사람이 **까닭이 적힌 주석을 지우는 쪽으로** 움직인다.
 *
 * 🔵 재는 것은 **배치뿐**이다 — 누가 무엇을 보는지(`isAdmin`·`canRecord`)와 가는 곳은
 * `tests/settings-access.test.ts` 가 따로 지킨다. 여기서는 그 규칙이 **한 벌로 남아 있는지**
 * (폰용으로 베껴 적지 않았는지)만 본다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 주석을 걷어낸 코드만. 🔵 떼고 나서 빈 글자가 아닌 것을 함께 확인한다(떼는 규칙이 낡으면 전부 조용히 통과한다). */
function codeOnly(source: string): string {
  const out = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(out.trim().length > 0, "주석을 떼고 나니 아무것도 안 남았다 — 떼는 규칙이 더는 안 맞는다");
  return out;
}

const HEADER = "src/components/AppHeader.tsx";
const code = codeOnly(src(HEADER));
const count = (needle: string): number => code.split(needle).length - 1;

/**
 * `src/` 아래의 소스 파일 전부(절대 경로). ⑨ 의 z 실측이 쓴다.
 *
 * 🔴 `new URL(…)` 로 폴더를 이어 붙이지 않는다 — 이 저장소에는 `(app)`·`[id]` 같은 폴더가
 *    있어 대괄호가 퍼센트로 둔갑하면 **읽기가 조용히 실패한다**. 경로는 문자열로 잇는다.
 * 🔵 `readdirSync` 의 `recursive` 옵션도 쓰지 않는다 — Node 판에 따라 없다(개발 24 · 운영 22 ·
 *    타입 검사 20). 손으로 내려간다.
 */
function srcFiles(dir = join(fileURLToPath(new URL("../", import.meta.url)), "src")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcFiles(child));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(child);
  }
  return out;
}

/** `<details> … </details>` 안쪽. 🔴 못 찾으면 멈춘다 — 빈 글자로 흘러가면 아래 단언이 전부 통과한다. */
function detailsBlock(): string {
  const start = code.indexOf("<details");
  const end = code.indexOf("</details>");
  assert.ok(start > 0 && end > start, "☰ 의 <details> 를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
  return code.slice(start, end);
}

describe("① 🔴 머리말은 **서버 컴포넌트**로 남는다 — ☰ 를 자바스크립트로 여닫지 않았다", () => {
  it("🔴 `use client` 가 없다", () => {
    assert.equal(count('"use client"'), 0, "머리말이 클라이언트 컴포넌트가 됐다 — 경계가 깨지면 시험이 다 통과해도 화면이 안 열리고 build 에서만 드러난다");
    assert.equal(count("'use client'"), 0, "따옴표만 바꾼 `use client` 가 들어왔다");
  });

  it("🔴 여닫는 일은 **브라우저**가 한다 — 상태도 이벤트도 쓰지 않는다", () => {
    for (const bad of ["useState", "useEffect", "useRef", "usePathname", "onClick", "onChange"]) {
      assert.equal(count(bad), 0, `${bad} 가 생겼다 — 서버 컴포넌트에서 쓸 수 없고, 쓰려면 파일 전체가 클라이언트로 내려간다`);
    }
  });

  it("🔴 ☰ 는 `<details>`/`<summary>` 다", () => {
    assert.equal(count("<details"), 1, "☰ 의 <details> 가 없거나 둘이 됐다");
    assert.equal(count("<summary"), 1, "<summary> 가 없거나 둘이 됐다");
  });

  it("🔵 `<summary>` 앞의 ▶ 삼각형을 **둘 다** 끈다 — 하나만 끄면 사파리에서만 남는다", () => {
    const summary = detailsBlock();
    assert.ok(summary.includes("list-none"), "list-none 이 없다 — 크롬·파이어폭스에 ▶ 가 남는다");
    assert.ok(summary.includes("[&::-webkit-details-marker]:hidden"), "웹킷 표식을 안 껐다 — 사파리에 ▶ 가 남는다");
  });
});

describe("② 🔴 접는 경계는 `md`(768px) 하나다 — @dss/ui 의 📦▾ 가 이름을 감추는 폭과 같은 값", () => {
  it("☰ 는 `md` 미만에서만 선다", () => {
    assert.match(code, /<details className="[^"]*md:hidden/, "☰ 가 넓은 화면에서도 보인다");
  });

  it("넓은 화면의 메뉴 줄은 `md` 이상에서만 선다", () => {
    assert.match(code, /<nav aria-label="화면" className="hidden[^"]*md:flex"/, "메뉴 줄이 폰에서도 선다 — ☰ 와 함께 두 벌이 보인다");
  });

  it("사용자 묶음(이름·통합 로그인으로·로그아웃)도 `md` 이상에서만 선다", () => {
    assert.match(code, /<div className="hidden items-center gap-3 md:flex">/, "사용자 묶음이 폰에서도 한 줄에 선다");
  });

  it("🔴 `md` 가 **그 셋에만** 쓰인다 — 경계가 늘면 넓은 화면이 예전과 달라진다", () => {
    assert.equal(count("md:hidden"), 1, "md:hidden 이 늘었다");
    assert.equal(count("md:flex"), 2, "md:flex 가 늘거나 줄었다");
  });
});

describe("③ 🔴 글자가 찌그러지지 않는다 — 줄이는 대신 **줄을 바꾼다**", () => {
  it("🔴 머리말 한 줄이 `flex-wrap` 이다 — 768~1100px 에서 두 줄이 되는 그것", () => {
    assert.match(code, /<div className="mx-auto flex w-full max-w-\[1400px\] flex-wrap/, "바깥 줄이 안 접힌다 — 폭이 모자라면 칸이 다시 줄어든다");
  });

  it("🔴 줄어들 수 있는 칸마다 `whitespace-nowrap` 이 있다 — min-content 가 한 자가 되는 것을 막는 울타리", () => {
    assert.match(code, /const NAV_LINK = "[^"]*whitespace-nowrap/, "메뉴 링크가 한 자 폭까지 줄어든다");
    assert.match(code, /const PANEL_LINK = "[^"]*whitespace-nowrap/, "☰ 패널의 링크가 한 자 폭까지 줄어든다");
    assert.match(code, /const HEADER_BUTTON = "[^"]*whitespace-nowrap/, "[통합 로그인으로]·[로그아웃] 글자가 세로로 선다");
    assert.match(code, /재고 관리/, "제목이 사라졌다");
    assert.match(code, /className="shrink-0 text-base font-semibold whitespace-nowrap text-zinc-900"/, "제목 「재고 관리」가 「재 / 고 / 관 / 리」로 쪼개지던 바로 그 칸이다");
  });
});

describe("④ 🔴 종과 📦▾ 는 접지 않는다 (쓰는 분 결정)", () => {
  it("🔴 종은 `<details>` **밖**, 머리말 맨 오른쪽에 한 번 선다", () => {
    assert.equal(count("{notificationBell}"), 1, "종이 사라졌거나 두 자리에 그려진다");
    const bell = code.indexOf("{notificationBell}");
    const close = code.indexOf("</details>");
    assert.ok(close > 0 && bell > close, "종이 ☰ 패널 안으로 들어갔다 — 알림은 접힌 패널에서 기다리면 안 된다");
  });

  /**
   * 🔴 **2026-10-22 에 이 단언의 뜻이 바뀌었다.** 그 전까지 ☰ 는 머리말 오른쪽 끝, 종 바로
   *    왼쪽에 있었고 여기서 재던 것은 「☰ 가 종보다 왼쪽인가」였다. 쓰는 분 요청으로 ☰ 가
   *    **머리말 맨 왼쪽**(시스템 이름보다도 앞 — A/S 시스템과 같은 모양)으로 가면서, 옛
   *    단언은 **여전히 통과하지만 아무것도 지키지 못하게** 됐다(☰ 가 맨 왼쪽이든 가운데든
   *    종보다는 왼쪽이다). 그래서 지우지 않고 **새 뜻으로 더 좁게** 다시 적는다 — ☰ 는 왼쪽
   *    끝이고, 종은 그대로 오른쪽 끝이라는 **두 가지**를 따로 못 박는다.
   */
  it("🔴 ☰ 는 머리말 **맨 왼쪽**이다 — 시스템 이름보다도 앞 (2026-10-22, A/S 와 같은 모양)", () => {
    const hamburger = code.indexOf("<details");
    const title = code.indexOf('className="shrink-0 text-base font-semibold');
    const menu = code.indexOf("<ServiceMenuBar");
    const right = code.indexOf('className="ml-auto flex shrink-0');

    assert.ok(hamburger > 0, "☰ 를 찾지 못했다");
    assert.ok(title > hamburger, "☰ 가 시스템 이름 「재고 관리」보다 뒤에 적혀 있다 — 맨 왼쪽이 아니다");
    assert.ok(menu > hamburger, "☰ 가 📦▾ 보다 뒤에 적혀 있다 — 맨 왼쪽이 아니다");
    assert.ok(right > 0 && hamburger < right, "☰ 가 아직 오른쪽 묶음(ml-auto) 안에 있다 — 2026-10-22 에 왼쪽으로 옮겼다");
  });

  it("🔴 종은 그대로 머리말 **맨 오른쪽**이다 — 펼친 목록이 종에 오른쪽 끝을 맞춰 열린다(@dss/ui 의 right: 0)", () => {
    const bell = code.indexOf("{notificationBell}");
    assert.ok(bell > 0, "종을 찾지 못했다");
    // 🔴 「☰ 보다 오른쪽」으로는 부족하다(그건 이제 거의 모든 자리가 그렇다). 종 **뒤에
    //    아무 요소도 서지 않는가**를 본다 — 하나라도 서면 그만큼 목록이 왼쪽으로 밀려 잘린다.
    const tail = code.slice(bell + "{notificationBell}".length);
    assert.ok(!/<[A-Za-z]/.test(tail), "종 오른쪽에 무언가가 더 섰다 — 폰에서 알림 목록 왼쪽이 화면 밖으로 나간다");
  });

  /**
   * 🔵 그 전에는 「📦▾ 가 `<details>` 보다 **앞에 적혔는가**」로 쟀다. ☰ 가 맨 왼쪽으로 가면서
   *    그 차례가 뒤집혔는데, 글자 차례는 애초에 「안에 들었는가」를 재는 올바른 잣대가 아니었다
   *    (앞에 적혀 있어도 안에 들 수 있다). 이제 `<details>` **안쪽을 직접** 본다.
   */
  it("📦▾(ServiceMenuBar) 는 ☰ 서랍 **밖**에서 늘 보인다", () => {
    assert.equal(count("<ServiceMenuBar"), 1, "📦▾ 가 사라졌거나 두 벌이 됐다");
    assert.ok(!detailsBlock().includes("<ServiceMenuBar"), "📦▾ 가 ☰ 서랍 안으로 들어갔다 — 접으면 다른 시스템으로 갈 길이 함께 사라진다");
  });
});

describe("⑤ 🔴 메뉴는 **한 벌**이다 — 폰용으로 베껴 적지 않았다", () => {
  it("넓은 화면과 ☰ 패널이 같은 `ScreenLinks` 를 쓴다", () => {
    assert.equal(count("<ScreenLinks "), 2, "두 자리가 같은 조각을 쓰지 않는다 — 자격 규칙이 갈리면 폰과 컴퓨터가 다른 메뉴를 그린다");
    assert.equal(count("function ScreenLinks("), 1);
  });

  it("🔴 가는 곳이 **한 번씩만** 적혀 있다 — 두 벌이면 고칠 때 한쪽이 잊힌다", () => {
    for (const href of ['href="/entries/new"', 'href="/entries"', 'href="/requests"', 'href="/approvals"', 'href={isAdmin ?']) {
      assert.equal(count(href), 1, `${href} 가 두 곳에 적혀 있다`);
    }
  });

  it("🔴 자격 규칙도 한 벌이다 — `canRecord` 로 가리는 자리가 둘(수량 변경 기록 · 부품 요청)뿐", () => {
    assert.equal(count("{canRecord && ("), 2, "역할로 가리는 자리가 늘거나 줄었다 — 이 조각은 배치만 바꾼다");
  });

  it("이름·역할 배지도 조각 하나를 함께 쓴다", () => {
    assert.equal(count("<UserIdentity user={user} />"), 2);
    assert.equal(count("function UserIdentity("), 1);
  });
});

describe("⑥ 🔴 접혀도 **할 일이 있다는 것**은 보인다 — 세는 값은 하나", () => {
  it("🔴 ☰ 에 표식이 있다", () => {
    const summary = detailsBlock();
    assert.ok(summary.includes("pendingRequests > 0"), "접힌 ☰ 에 아무 표시가 없다 — 「대기 N」이 패널 안으로 숨어 할 일을 놓친다");
    assert.match(summary, /bg-amber-/, "표식이 배지와 다른 색이다 — 같은 일을 가리키는 두 표시는 같은 색이어야 한다");
  });

  it("🔴 숫자는 여전히 **배지 한 곳**에서만 나온다 — 두 벌로 세지 않는다", () => {
    assert.equal(count("<PendingBadge count={pendingRequests} />"), 1, "배지가 두 자리에 생겼다");
    assert.equal(count("function PendingBadge("), 1);
    // 🔵 ☰ 의 표식과 이름은 **같은 prop** 을 본다 — 따로 세는 값이 생기면 두 표시가 서로 다른 말을 한다.
    assert.equal(count("pendingRequests > 0"), 2, "☰ 의 표식과 이름이 같은 값을 보지 않는다");
  });

  it("🔵 화면 낭독기에도 말한다 — 점은 눈에만 보이는 것이라 이름으로 한 번 더 적는다", () => {
    const summary = detailsBlock();
    assert.match(summary, /aria-label=\{pendingRequests > 0 \?/, "☰ 의 이름이 대기 건수에 따라 달라지지 않는다");
    assert.match(summary, /aria-hidden="true"/, "눈에만 보이는 ☰ 글자·점이 낭독기에 두 번 읽힌다");
  });
});

describe("⑦ ☰ 패널의 차례 — 화면 링크 → 구분선 → 사용자 → 통합 로그인 → 로그아웃 → 역할 바꿔 보기", () => {
  it("쓰는 분이 적어 준 그 차례 그대로다", () => {
    const panel = detailsBlock();
    const at = (needle: string): number => {
      const i = panel.indexOf(needle);
      assert.ok(i > 0, `${needle} 를 패널에서 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라`);
      return i;
    };
    const order = ["<ScreenLinks ", "border-t", "<UserIdentity", "href={portalUrl}", "logoutAction", "{devRoleSwitch}"].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order, "패널 안의 차례가 어긋났다");
  });

  /**
   * 🔴 **2026-10-22 에 이 단언의 뜻도 바뀌었다.** 그 전의 ☰ 패널은 머리말 **아래로** 펼쳐지는
   *    전폭 패널(`absolute inset-x-0 top-full`)이었고, 그래서 머리말에 기댈 자리(`relative`)가
   *    필요했다. 쓰는 분 요청으로 **왼쪽에서 나오는 서랍**(`fixed inset-0`)이 되면서 기댈 자리가
   *    필요 없어졌고, 머리말의 `relative` 는 `sticky` 로 **바뀌었다**(둘 다 position 이라 같이
   *    쓸 수 없다). 옛 단언 둘은 이제 거짓이므로 **새 뜻으로** 다시 적는다.
   */
  it("🔵 서랍은 **화면에 매달려** 왼쪽에서 나온다 — 열어도 본문이 밀리지 않는다", () => {
    const panel = detailsBlock();
    assert.match(panel, /<div className="fixed inset-0 z-\[60\] flex">/, "서랍 바깥이 화면을 꽉 채우지 않는다 — 검은 바탕이 화면 일부만 덮는다");
    assert.match(panel, /className="relative z-50 flex min-h-0 w-64 flex-col/, "서랍 본체가 왼쪽에 선 고정폭(w-64) 기둥이 아니다");
    assert.ok(!panel.includes("absolute inset-x-0 top-full"), "아직 머리말 아래로 펼쳐지는 옛 전폭 패널이다 — 2026-10-22 에 서랍으로 바꿨다");
  });

  it("🔴 머리말은 굴러도 화면 위에 남는다 — `sticky top-0`, 인쇄에서는 되돌린다", () => {
    assert.match(code, /<header className="sticky top-0 z-30 /, "머리말이 고정되지 않는다(또는 z 가 바뀌었다 — 본문 쪽 최대보다 위여야 한다)");
    assert.match(code, /<header className="[^"]*print:static/, "인쇄에서 고정을 안 되돌린다 — 쪽마다 겹쳐 찍히거나 첫 쪽 본문을 가린다");
    // 🔴 position 은 한 요소에 하나다. 둘이 적히면 Tailwind 가 CSS 를 찍는 차례에 따라
    //    한쪽이 **조용히** 이긴다 — 지는 날 머리말이 안 고정되거나 서랍 기준이 어긋난다.
    const headerClass = /<header className="([^"]*)"/.exec(code);
    assert.ok(headerClass, "머리말의 className 을 찾지 못했다");
    const positions = headerClass[1].split(/\s+/).filter((c) => ["static", "relative", "absolute", "fixed", "sticky"].includes(c));
    assert.deepEqual(positions, ["sticky"], `머리말에 position 이 둘 이상 적혔다: ${positions.join(" ")}`);
  });

  it("🔴 인쇄에는 ☰ 도 메뉴 줄도 나오지 않는다 — `no-print` 를 잃지 않았다", () => {
    assert.equal(count("no-print"), 2, "인쇄에서 머리말 메뉴를 숨기는 표가 사라졌거나 늘었다");
    assert.match(code, /<details className="no-print/, "☰ 가 인쇄물에 찍힌다");
    // 🔵 서랍 안쪽에는 `print:hidden` 을 또 적지 않는다 — 바깥 <details> 하나로 통째로 사라진다.
    assert.ok(!detailsBlock().includes("print:hidden"), "서랍에 인쇄 숨김이 두 벌이 됐다");
  });

  it("🔴 ☰ 가 좁은 폭에서 깎이지 않는다 — `shrink-0` 이 없으면 손가락에 안 잡히는 크기가 된다", () => {
    assert.match(code, /<details className="[^"]*\bshrink-0\b/, "☰ 에 shrink-0 이 없다 — 폰에서 flex 가 w-9 를 깎는다(A/S TopBar.tsx 의 같은 까닭)");
    assert.match(detailsBlock(), /\bh-9 w-9\b/, "☰ 단추의 크기가 바뀌었다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑧ 🔴 노치 인셋 — 패딩과 **한 클래스 안에서** 더한다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑧ 🔴 노치 인셋 둘 — 위는 머리말, 아래는 서랍", () => {
  /**
   * 🔴 까닭(A/S TopBar.tsx·AppShell.tsx 의 주석을 그대로 옮긴 것):
   *    - **머리말 위**: 고정되면서 노치 밑에 깔릴 수 있는 **맨 위 요소**가 됐다.
   *    - **서랍 아래**: 화면 높이를 꽉 채우므로, 없으면 맨 아래 칸이 홈 인디케이터에 겹쳐
   *      **눌리지 않는다**(A/S 에서 실제로 겪은 일이다).
   * 🔴 둘 다 **한 클래스 안에서** 패딩과 인셋을 더해야 한다. `py-3` 를 둔 채 인셋을 따로
   *    걸면 같은 padding 을 두 클래스가 다투고, 지는 날 아이폰에서 인셋이 조용히 사라진다.
   */
  // 🔴 시험 이름에 그 클래스를 **대괄호째 적지 마라.** Tailwind 는 tests/ 의 글자도 긁어
  //    가짜 클래스를 CSS 로 찍으려 들고, 줄임표가 섞이면 globals.css 가 통째로 깨진다.
  it("🔴 머리말 위 — padding-top 안에서 calc 로 safe-area-inset-top 을 더한다(한 클래스)", () => {
    assert.match(code, /pt-\[calc\(0\.75rem\+env\(safe-area-inset-top\)\)\]/, "머리말 위 인셋이 없다");
    assert.ok(!/<div className="mx-auto flex[^"]*\bpy-3\b/.test(code), "머리말 줄에 py-3 가 남아 있다 — 같은 padding-top 을 두 클래스가 다툰다");
  });

  it("🔴 서랍 아래 — padding-bottom 안에서 calc 로 safe-area-inset-bottom 을 더한다(한 클래스)", () => {
    const panel = detailsBlock();
    assert.match(panel, /pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]/, "서랍 아래 인셋이 없다 — 맨 아래 칸이 홈 인디케이터에 겹쳐 안 눌린다");
    assert.ok(!/className="relative z-50[^"]*\bpy-3\b/.test(panel), "서랍에 py-3 가 남아 있다 — 같은 padding-bottom 을 두 클래스가 다툰다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑨ 🔴 쌓임 순서 — 머리말이 본문보다 **위**인가
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑨ 🔴 머리말의 z 가 본문 쪽 최대보다 위다", () => {
  /**
   * 🔴 `sticky` + `z` 는 **쌓임 맥락**을 만든다. 그 뒤로 머리말 **안**의 z(종 목록 50 ·
   *    📦▾ 목록 50 · 서랍 60)는 그 맥락 안에서만 겨루고, 바깥과는 머리말의 z **하나**로만
   *    겨룬다. 그래서 본문 어딘가에 머리말과 같거나 큰 z 가 생기면 **머리말이 통째로 덮이는데
   *    오류는 한 줄도 안 난다** — 그 날을 잡으려고 src/ 전체를 훑어 실제로 센다.
   * 🔵 2026-10-22 실측: 머리말 밖에서 가장 큰 것은 ScrollSelect 펼침 목록의 20 하나뿐이다.
   */
  it("🔴 src/ 안에서 머리말 밖의 z 가 머리말보다 작다", () => {
    const headerZ = /<header className="[^"]*\bz-(\d+)\b/.exec(code);
    assert.ok(headerZ, "머리말의 z 를 찾지 못했다");

    const files = srcFiles();
    // 🔵 훑는 규칙이 낡으면 **아무것도 못 찾아 조용히 통과한다** — 그래서 먼저 센다.
    assert.ok(files.length > 50, `src/ 를 제대로 훑지 못했다(${files.length}개) — 이 시험은 찾은 것이 없으면 그냥 통과한다`);
    assert.ok(files.some((f) => f.endsWith("ScrollSelect.tsx")), "z 가 실제로 쓰인 파일(ScrollSelect.tsx)에 닿지 못했다");

    const top = { z: 0, file: "(없음)" };
    for (const file of files) {
      if (file.endsWith("AppHeader.tsx")) continue; // 머리말 **안**의 z 는 제 맥락 안에서만 겨룬다
      const body = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const hit of body.matchAll(/\bz-(?:\[(\d+)\]|(\d+))\b/g)) {
        const z = Number(hit[1] ?? hit[2]);
        if (z > top.z) {
          top.z = z;
          top.file = file;
        }
      }
    }

    assert.ok(
      top.z < Number(headerZ[1]),
      `머리말(z-${headerZ[1]})보다 크거나 같은 z 가 본문에 있다 — ${top.file} 의 z-${top.z}. 머리말의 z 도 함께 올려라`
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑩ 🔴 서랍의 사용자 묶음은 **바닥에 붙는다** (2026-10-22, 쓰는 분 요청)
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑩ 🔴 사용자 묶음이 서랍 **맨 아래**에 붙는다 — 늘어나는 빈 칸막이로", () => {
  /**
   * 그 전에는 메뉴 링크 여섯 **바로 밑**에 붙어 있고 그 아래로 빈 자리가 길게 남았다.
   *
   * 🔴 받치고 있는 것이 **빈 div 하나**라 다음 사람이 「쓸데없는 칸」으로 보고 지우기 쉽다.
   *    지우면 묶음이 다시 링크 밑으로 올라붙는데 **오류는 한 줄도 안 난다** — 그래서 못 박는다.
   * 🔴 **주석을 떼고 잰다**(이 파일 머리말의 `codeOnly`). 칸막이의 까닭이 바로 그 자리에 길게
   *    적혀 있어, 주석이 코드 대신 걸리면 **까닭을 통째로 지워도 시험이 통과한다.**
   * 🔵 재는 것은 **자리뿐**이다 — 묶음 안의 차례는 ⑦ 이, 아래쪽 노치 여백은 ⑧ 이 따로 지킨다.
   */
  it("🔴 `</nav>` 와 아래 묶음 **사이**에 늘어나는 빈 칸막이가 있다", () => {
    const panel = detailsBlock();
    const nav = panel.indexOf("</nav>");
    const 묶음 = panel.indexOf("border-t");
    assert.ok(nav > 0, "서랍의 </nav> 를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(묶음 > nav, "구분선(border-t)으로 시작하는 아래 묶음을 <nav> 뒤에서 찾지 못했다");

    const 사이 = panel.slice(nav, 묶음);
    const 칸막이 = /<div ([^>]*)\/>/.exec(사이);
    assert.ok(칸막이, "메뉴 링크와 아래 묶음 **사이**에 빈 칸막이가 없다 — 2026-10-22 에 사용자 묶음을 서랍 바닥으로 내렸고, 받치는 것이 그 칸 하나다");

    const 속성 = 칸막이[1];
    const classes = (/className="([^"]*)"/.exec(속성)?.[1] ?? "").split(/\s+/).filter(Boolean);
    assert.ok(
      classes.includes("grow"),
      `칸막이가 남는 자리를 안 먹는다(class: ${classes.join(" ") || "(없음)"}) — grow 가 빠지면 높이 0 인 빈 칸이 되어 묶음이 다시 링크 바로 밑으로 올라붙는다`
    );
    assert.match(속성, /aria-hidden="true"/, "칸막이가 화면 낭독기에 읽힌다 — 아무것도 그리지 않는 칸이라 알릴 것이 없다");
  });

  it("🔴 아래 묶음은 `mt-3` 그대로다 — `mt-auto` 로 내리지 않았다", () => {
    const panel = detailsBlock();
    const 묶음 = /<div className="([^"]*\bborder-t\b[^"]*)">/.exec(panel);
    assert.ok(묶음, "아래 묶음의 className 을 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");

    const classes = 묶음[1].split(/\s+/).filter(Boolean);
    assert.ok(classes.includes("mt-3"), `구분선 위 12px 간격이 사라졌다(class: ${묶음[1]})`);
    // 🔴 margin-top:auto 는 **남는 자리가 있을 때만** 내려 준다. 메뉴가 서랍보다 길어지는 순간
    //    0 으로 풀려 구분선이 마지막 링크에 바짝 달라붙는다 — 간격이 가장 필요한 바로 그 때다.
    //    칸막이는 그 경우에 높이 0 으로 줄 뿐이라 mt-3 가 그대로 남는다.
    assert.ok(
      !panel.includes("mt-auto"),
      "서랍에 mt-auto 가 들어왔다 — 자리가 남을 때는 멀쩡해 보이지만, 메뉴가 서랍보다 길어지면 0 으로 풀려 구분선 위 12px 간격이 사라진다"
    );
  });

  it("🔵 칸막이가 먹히는 **전제** — 서랍 본체가 세로 flex 이고 높이가 화면에 매여 있다", () => {
    const panel = detailsBlock();
    const 본체 = /className="(relative z-50 [^"]*)"/.exec(panel);
    assert.ok(본체, "서랍 본체의 className 을 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");

    const classes = 본체[1].split(/\s+/).filter(Boolean);
    assert.ok(
      classes.includes("flex") && classes.includes("flex-col"),
      "서랍 본체가 세로 flex 가 아니다 — flex 가 아니면 grow 는 아무 뜻이 없고 칸막이가 **조용히** 높이 0 이 된다"
    );
    assert.ok(
      classes.includes("overflow-y-auto") && classes.includes("min-h-0"),
      "내용이 길어질 때 서랍이 안 구른다 — 그 경우 칸막이가 0 으로 줄어도 메뉴 아래가 잘린다"
    );
    // 🔴 늘어날 **남는 자리**는 바깥 상자가 화면 높이를 꽉 채워서 생긴다. 바깥이 높이를 안 잡으면
    //    서랍이 제 내용만큼만 높아져 남는 자리가 늘 0 이고, 묶음은 영영 바닥에 안 붙는다.
    assert.ok(panel.includes("fixed inset-0"), "서랍 바깥이 화면 높이를 안 잡는다 — 남는 자리가 아예 없어 칸막이가 늘 0 이다");
  });
});
