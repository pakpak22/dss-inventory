/**
 * ============================================================================
 * 🔴 알림 지움이 흐르는 길 — 누르는 자리 · 적는 자리 · 걸러지는 자리
 * ============================================================================
 * 2026-10-19 까지 「이 알림 그만 보겠다」는 **각 사이트의 브라우저**에 적혔다.
 * 브라우저 저장소는 주소(포트)별로 갈려서, A/S(3000)에서 지운 줄이 재고관리
 * (3800)의 종에는 그대로 떴다 — 같은 사람이 시스템마다 다른 목록을 봤다.
 * 그래서 지움을 포털 한 곳으로 모았다:
 *
 *   종의 ✕ (@dss/ui 가 그린다)
 *     → 서버 액션(app/actions/notifications.ts)이 **제 세션에서** 사람 번호를 읽고
 *     → notifications/portal.ts 가 포털의 쓰기 통로에 Basic 자격으로 POST 하고
 *     → revalidate 로 사내 구간 레이아웃이 다시 그려지면 그 줄이 빠진다
 *
 * ── 🔴 이 사이트에만 있는 한 단계 — **제 줄 거르기** ─────────────────────
 * 계측기(njlee)·PO 는 남의 알림만 그려서 ✕ 배선 하나로 끝났다. 재고관리는 **제
 * 알림을 제 손으로 그려** 포털 목록에 이어 붙인다(HeaderNotificationBell). 남의
 * 줄은 포털이 걸러서 보내지만 **제 줄은 포털이 손댈 수 없어서**, 포털이 함께
 * 보내는 `dismissed` 로 우리가 걸러야 한다. 안 거르면 「재고관리에서 지웠는데
 * 재고관리 종에만 그대로 뜬다」가 된다 — 다른 사이트에서는 사라지는데 여기서만
 * 남는, 제일 헷갈리는 모양이다.
 *
 * ── 여기서 지키는 것 일곱 ───────────────────────────────────────────────
 *  1. 🔴 **어떤 답이 와도 던지지 않는다.** 이 함수는 사람이 ✕ 를 누른 그 순간,
 *     종의 다른 처리 한가운데서 불린다 — 여기서 예외가 새면 그 누름이 통째로
 *     멈춘다. 못 지우면 그 줄이 남을 뿐이다.
 *  2. 🔴 **200개씩 나눠 보낸다.** 넘기면 포털이 400 으로 **통째로** 거절한다
 *     (앞의 200개만 받아 주지 않는다).
 *  3. 🔴 **빈 목록은 아예 보내지 않는다** — 포털이 400(no_keys)으로 거절한다.
 *  4. 🔴 **누구의 지움인지는 서버가 정한다.** 브라우저가 보낸 사람 번호를 쓰면
 *     남의 알림을 지울 수 있는 통로가 된다.
 *  5. 🔴 **`client_secret` 은 브라우저로 나가지 않는다.** 시크릿을 읽는 모듈을
 *     클라이언트 조각이 부르지 않는지 **소스를 훑어** 확인한다.
 *  6. 🔴 **제 줄을 거르면서 개수도 함께 줄인다.** 줄은 빠졌는데 배지 숫자가
 *     그대로면 「눌러도 안 없어지는 숫자」가 된다.
 *  7. 🔴 **열쇠의 접두사가 포털에 등록된 이름과 같다.** 어긋나면 포털이 열쇠를
 *     조용히 버려 「지워지지 않는 알림」이 생긴다.
 *  8. 🔴 **「보이는 알림 지우기」가 제 줄과 포털 줄을 **둘 다** 묶는다**(2026-10-20,
 *     아래 마지막 절). 한쪽만 묶으면 「전부 지우기를 눌렀는데 내 알림만 남는다」가
 *     된다 — 이 사이트에만 있는 함정이다.
 *
 * 🔴 이 시험은 DB 에도 바깥 망에도 닿지 않는다. 포털을 부르는 자리는 가짜
 *    fetch 로 가로채고, 한 군데만 아무도 듣지 않는 127.0.0.1:1 을 쓴다.
 * ============================================================================
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { NotificationBell, type NotificationBellItem } from "@dss/ui";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildInventoryNotificationItems, NOTIFICATION_MAX_ITEMS } from "../src/lib/notifications/bell-items";
import { MAX_DISMISS_KEYS_AT_ONCE, vetDismissKeys, visibleNotificationKeys } from "../src/lib/notifications/dismiss-keys";
import { dismissPortalNotifications, normalizePortalNotificationFeed, withoutDismissed } from "../src/lib/notifications/portal";

// 🔴 이 저장소의 tsconfig 는 `vendor` 를 **빼 놓는다**(그 묶음은 제 저장소의 규칙으로
//    검사한다). 그래서 시험을 돌리는 tsx 가 묶음의 .tsx 를 읽을 때 `jsx: react-jsx` 를
//    못 보고 **옛 방식(React.createElement)으로 굽는다** — 그 코드는 `React` 를 제 둘레에서
//    찾고, 묶음은 React 를 import 하지 않으므로 전역에서 찾는다. 이 한 줄이 없으면 종을
//    그려 보는 순간 "React is not defined" 로 넘어진다. 🔵 화면에는 영향이 없다 — Next 는
//    제 설정으로 굽는다.
(globalThis as { React?: unknown }).React = React;

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 걷어 낸 코드. 주석에 적힌 낱말이 시험을 통과시키지 않게. */
function withoutComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ACTION_PATH = "src/app/actions/notifications.ts";
const actionRaw = read(ACTION_PATH);
const action = withoutComments(actionRaw);
const portal = withoutComments(read("src/lib/notifications/portal.ts"));
const bellComponent = withoutComments(read("src/components/HeaderNotificationBell.tsx"));
const queries = withoutComments(read("src/lib/notifications/queries.ts"));
const bellItems = withoutComments(read("src/lib/notifications/bell-items.ts"));

/* ── 가짜 포털 ────────────────────────────────────────────────────────── */

type PortalCall = { url: string; headers: Record<string, string>; body: URLSearchParams };

/** 포털이 보내는 정상 답. `recorded` 는 **뜻이 지켜진 수**다(새 행 수가 아니다). */
function accepted(count: number): Response {
  return new Response(JSON.stringify({ recorded: count, dropped: 0 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rejected(status: number): Response {
  return new Response(JSON.stringify({ error: "invalid_request", error_description: "" }), { status, headers: { "content-type": "application/json" } });
}

/**
 * 포털 자리에 가짜를 세우고 일을 시킨 뒤, **무엇이 나갔는지**를 돌려준다.
 * 🔴 진짜 망에 나가지 않는다. 환경변수도 이 블록 안에서만 산다.
 */
async function callingPortal(answer: (call: PortalCall, nth: number) => Response, run: () => Promise<boolean>): Promise<{ calls: PortalCall[]; recorded: boolean }> {
  const calls: PortalCall[] = [];
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };

  process.env.SSO_ISSUER = "http://portal.invalid";
  process.env.SSO_CLIENT_ID = "dss-inventory";
  process.env.SSO_CLIENT_SECRET = "가짜-시크릿";

  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const call: PortalCall = {
      url: String(input),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: new URLSearchParams(String(init.body ?? "")),
    };
    calls.push(call);
    return answer(call, calls.length);
  }) as typeof fetch;

  let recorded: boolean;
  try {
    recorded = await run();
  } finally {
    globalThis.fetch = realFetch;
    process.env = realEnv;
  }

  return { calls, recorded };
}

function keys(count: number, prefix = "rf-service-system"): string[] {
  return Array.from({ length: count }, (_, at) => `${prefix}:APPROVAL:${at + 1}`);
}

describe("보내지 않아야 하는 때", () => {
  it("🔴 보낼 열쇠가 없으면 포털을 아예 부르지 않는다 — 빈 묶음은 400 으로 거절된다", async () => {
    for (const empty of [[], [""], ["", ""]]) {
      const { calls, recorded } = await callingPortal(
        () => accepted(0),
        () => dismissPortalNotifications("00000000-0000-0000-0000-000000000000", empty),
      );
      assert.equal(calls.length, 0, `${JSON.stringify(empty)} 로 포털을 불렀다`);
      assert.equal(recorded, false);
    }
  });

  it("사람 번호가 비어 있으면 아예 적지 않는다", async () => {
    const { calls, recorded } = await callingPortal(
      () => accepted(1),
      () => dismissPortalNotifications("", keys(1)),
    );
    assert.equal(calls.length, 0);
    assert.equal(recorded, false);
  });
});

describe("나가는 모양", () => {
  it("🔴 자격증명은 Authorization: Basic 으로만 나간다 — 주소에 싣지 않는다", async () => {
    const { calls, recorded } = await callingPortal(
      () => accepted(1),
      () => dismissPortalNotifications("사람-1", ["rf-service-system:APPROVAL:7"]),
    );

    assert.equal(recorded, true);
    assert.equal(calls.length, 1);

    const [call] = calls;
    assert.equal(call.url, "http://portal.invalid/api/integration/notification-dismissals");
    // 🔴 주소에 실리면 포털이 400 으로 거절하고, 그 값은 이미 접근 로그에 남아
    //    **다시 발급**해야 한다(dss-auth/docs/사이트-알림-통로.md).
    assert.equal(call.url.includes("?"), false, "🔴 주소에 무언가 실렸다");
    assert.match(call.headers.authorization, /^Basic /);
    assert.equal(call.headers["content-type"], "application/x-www-form-urlencoded");

    // 몸통에 실리는 것은 둘뿐이다.
    assert.deepEqual([...call.body.keys()].sort(), ["keys", "sub"]);
    assert.equal(call.body.get("sub"), "사람-1");
    assert.equal(call.body.get("keys"), "rf-service-system:APPROVAL:7");
  });

  it("읽는 통로와 같은 자격·같은 상한·같은 no-store 를 쓴다", () => {
    const write = portal.slice(portal.indexOf("async function recordDismissalChunk"));
    assert.ok(write.length > 0, "지움을 적는 함수를 찾지 못했다");
    assert.match(write, /authorization: `Basic \$\{Buffer\.from\(credentials/);
    assert.match(write, /signal: AbortSignal\.timeout\(PORTAL_NOTIFICATIONS_TIMEOUT_MS\)/);
    assert.match(write, /cache: "no-store"/);
  });

  it("🔴 자격증명도 열쇠도 로그에 찍지 않는다 — 찍히는 것은 오류의 종류와 상태뿐이다", () => {
    const write = portal.slice(portal.indexOf("async function recordDismissalChunk"));
    for (const logged of write.matchAll(/console\.(error|log|warn)\(([\s\S]*?)\);/g)) {
      const args = logged[2];
      assert.equal(/credentials|ssoClientSecret|ssoClientId|authorization/i.test(args), false, `🔴 로그에 자격증명이 딸려 나간다: ${args.trim().slice(0, 60)}`);
      // 🔴 열쇠도 찍지 않는다 — 그 안에 신청 번호 같은 업무 식별자가 있다.
      assert.equal(/\bkeys?\b/.test(args), false, `🔴 로그에 열쇠가 딸려 나간다: ${args.trim()}`);
    }
  });
});

describe("200개씩 나눠 보낸다", () => {
  it("🔴 200개까지는 한 번에 간다", async () => {
    const { calls, recorded } = await callingPortal(
      () => accepted(200),
      () => dismissPortalNotifications("사람-1", keys(200)),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.get("keys")?.split(",").length, 200);
    assert.equal(recorded, true);
  });

  it("🔴 201개부터 나눠 보낸다 — 한 번에 보내면 포털이 **통째로** 거절한다", async () => {
    const wanted = keys(450);
    const { calls, recorded } = await callingPortal(
      () => accepted(1),
      () => dismissPortalNotifications("사람-1", wanted),
    );

    assert.equal(calls.length, 3, "묶음 수가 다르다");
    assert.deepEqual(
      calls.map((call) => call.body.get("keys")?.split(",").length),
      [200, 200, 50],
    );
    // 🔴 나누면서 **한 개도 흘리지 않는다.** 차례도 그대로다.
    assert.deepEqual(
      calls.flatMap((call) => call.body.get("keys")?.split(",") ?? []),
      wanted,
    );
    // 사람 번호는 묶음마다 같은 값이 실린다.
    assert.deepEqual(new Set(calls.map((call) => call.body.get("sub"))), new Set(["사람-1"]));
    assert.equal(recorded, true);
  });

  it("같은 열쇠가 두 번 실려 와도 한 번만 보낸다", async () => {
    const { calls } = await callingPortal(
      () => accepted(1),
      () => dismissPortalNotifications("사람-1", ["rf-service-system:APPROVAL:1", "rf-service-system:APPROVAL:1", "", "dss-inventory:REJECTED:2"]),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.get("keys")?.split(","), ["rf-service-system:APPROVAL:1", "dss-inventory:REJECTED:2"]);
  });
});

describe("어떤 답이 와도 던지지 않는다", () => {
  it("🔴 포털에 닿지 못해도 던지지 않는다 — false 로 돌아온다", async () => {
    // 실제로 불러 본다. 아무도 듣고 있지 않은 자리(127.0.0.1:1)라 연결이 곧바로
    // 거절된다 — 바깥 망에 나가지 않고 DB 도 쓰지 않는다.
    const realEnv = { ...process.env };
    process.env.SSO_ISSUER = "http://127.0.0.1:1";
    process.env.SSO_CLIENT_ID = "dss-inventory";
    process.env.SSO_CLIENT_SECRET = "가짜-시크릿";

    try {
      assert.equal(await dismissPortalNotifications("사람-1", keys(1)), false);
    } finally {
      process.env = realEnv;
    }
  });

  it("🔴 설정이 빠져도 던지지 않는다 — env 의 getter 가 던지는 자리까지 삼킨다", async () => {
    const realEnv = { ...process.env };
    delete process.env.SSO_ISSUER;
    delete process.env.SSO_CLIENT_ID;
    delete process.env.SSO_CLIENT_SECRET;

    try {
      assert.equal(await dismissPortalNotifications("사람-1", keys(1)), false);
    } finally {
      process.env = realEnv;
    }
  });

  it("🔴 거절(400·401·403·429·503)도 삼킨다 — 던지지 않고 false 다", async () => {
    for (const status of [400, 401, 403, 429, 503]) {
      const { recorded } = await callingPortal(
        () => rejected(status),
        () => dismissPortalNotifications("사람-1", keys(1)),
      );
      assert.equal(recorded, false, `${status} 에서 false 가 아니다`);
    }
  });

  it("🔴 한 묶음이 거절돼도 나머지 묶음은 그대로 보낸다", () => {
    // 가운데가 503 이어도 셋 다 나가야 한다. 여기서 멈추면 뒤쪽 열쇠는 영영 적히지
    // 않는데, 🔵 이 통로는 몇 번을 다시 보내도 안전하므로 멈출 까닭이 없다.
    return callingPortal(
      (_call, nth) => (nth === 2 ? rejected(503) : accepted(200)),
      () => dismissPortalNotifications("사람-1", keys(450)),
    ).then(({ calls, recorded }) => {
      assert.equal(calls.length, 3);
      assert.equal(recorded, false, "🔴 하나라도 거절됐으면 false 여야 한다");
    });
  });

  it("🔴 이 통로에는 throw 가 한 군데도 없다", () => {
    const write = portal.slice(portal.indexOf("async function recordDismissalChunk"));
    assert.ok(write.length > 0, "지움을 적는 함수를 찾지 못했다");
    assert.equal(/\bthrow\b/.test(write), false, "🔴 지움 통로가 던진다 — 누름이 통째로 멈춘다");
    assert.equal(/\bthrow\b/.test(action), false, "🔴 서버 액션이 던진다");
  });
});

describe("누구의 지움인지는 서버가 정한다", () => {
  it('🔴 서버 액션이다 — 파일 첫 줄이 "use server" 다', () => {
    assert.match(actionRaw, /^"use server";\n/, '🔴 "use server" 가 파일 맨 앞이 아니다');
  });

  it("🔴 사람 번호를 **세션에서** 읽는다 — 브라우저가 보낸 값을 쓰지 않는다", () => {
    assert.match(action, /const session = await getSession\(\);/);
    assert.match(action, /dismissPortalNotifications\(session\.user\.authSub, \[key\]\)/);
    // 🔴 받는 것은 종이 넘겨 준 줄 하나뿐이다. sub·subject 를 인자로 받으면 브라우저가
    //    아무 번호나 실어 **남의 알림을 지울 수 있는 통로**가 된다.
    const signature = action.slice(action.indexOf("export async function dismissNotificationAction"));
    assert.match(signature, /^export async function dismissNotificationAction\(\s*item: NotificationBellItem,?\s*\)/);
    // 세션이 끊긴 사람은 아무 일도 일어나지 않는다(로그인으로 튀지 않는다).
    assert.equal(action.includes("requireSession"), false, "🔴 종 하나 때문에 화면이 로그인으로 튄다");
  });

  it("🔴 세션이 없거나 열쇠가 비면 포털을 부르지 않는다", () => {
    assert.match(action, /if \(!session\) return;/);
    assert.match(action, /if \(key === ""\) return;/);
  });
});

/** `"use client"` 가 **첫 줄**인 파일만 고른다(주석에 적힌 낱말은 세지 않는다). */
function clientFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = withoutComments(fs.readFileSync(full, "utf8")).trimStart();
      if (/^["']use client["']/.test(source)) found.push(full);
    }
  };
  walk(path.resolve(ROOT, "src"));
  return found;
}

describe("client_secret 이 브라우저로 나가지 않는다", () => {
  it("🔴 시크릿을 읽는 모듈을 클라이언트 조각이 부르지 않는다", () => {
    // notifications/portal.ts 와 env.ts 는 `client_secret` 을 읽는다. 클라이언트
    // 그래프에 한 번 들어가면 그 값이 번들에 실릴 길이 생긴다 — 들어갔는지는 화면에서
    // 드러나지 않으므로 여기서 본다.
    // 🔴 **단순 grep 으로 고르지 않는다** — 서버 조각의 주석에 그 낱말이 있으면
    //    (실제로 HeaderNotificationBell 의 머리말에 있다) 엉뚱한 파일이 걸린다.
    const files = clientFiles();
    assert.ok(files.length > 0, "클라이언트 조각을 하나도 못 찾았다 — 고르는 방식이 깨졌다");
    for (const file of files) {
      const source = withoutComments(fs.readFileSync(file, "utf8"));
      assert.equal(/from "@\/lib\/notifications\/portal"|from "@\/lib\/auth\/oidc"|from "@\/lib\/env"/.test(source), false, `🔴 클라이언트 조각이 서버 전용 모듈을 부른다: ${path.relative(ROOT, file)}`);
    }
  });

  it("🔴 종은 서버 조각 그대로다 — 지우기를 붙이면서 클라이언트로 넘기지 않았다", () => {
    // 넘어갔다면 `client_secret` 을 다루는 자리가 하나 더 생긴다(portal.ts 머리말).
    assert.equal(clientFiles().includes(path.resolve(ROOT, "src/components/HeaderNotificationBell.tsx")), false);
    // 🔴 브라우저용 중계 통로. `api/integration/notifications` 는 **다른 것**이다 —
    //    포털이 우리 알림을 가져가는 들어오는 길이고, 자격이 포털의 서명(Bearer)이다.
    assert.equal(fs.existsSync(path.resolve(ROOT, "src/app/api/notifications")), false, "브라우저용 중계 통로가 생겼다 — 생겼다면 세션 재검증까지 함께 봐야 한다");
  });
});

describe("그리는 자리 — ✕ 가 서고, 다음 렌더에서 줄어든다", () => {
  it("🔴 종에 서버 액션을 넘긴다 — 이 함수가 있어야 ✕ 가 그려진다", () => {
    // 🔴 중괄호 안이 한 낱말이 아닐 수 있다 — 2026-10-20 에 일괄 지우기 액션이 같은
    //    모듈에서 함께 들어오면서 둘이 되었다. 보는 것은 **어디서 오는가**이지 그 줄의
    //    생김새가 아니다.
    assert.match(bellComponent, /import \{[\s\S]*?\bdismissNotificationAction\b[\s\S]*?\} from "@\/app\/actions\/notifications";/);
    assert.match(bellComponent, /<NotificationBell[\s\S]*?onDismiss=\{dismissNotificationAction\}[\s\S]*?\/>/);
  });

  it("🔴 모든 줄에 ✕ 가 선다 — 종류를 가리지 않는다", () => {
    // A/S 가 「처리해야 사라지는 제 할 일」은 못 지우게 가렸는데 2026-10-20 에 그
    // 규칙을 **풀었다**(A/S 의 551641f) — 다른 시스템의 종에서는 어차피 지워져서,
    // 막는 것이 아니라 헷갈리게 만들고 있었기 때문이다. canDismiss 를 다시 넘기려면
    // 그때는 까닭이 함께 적혀 있어야 한다.
    assert.equal(bellComponent.includes("canDismiss"), false);
  });

  it("🔴 지운 뒤 다음 렌더에서 줄이 빠진다 — 사내 구간 **레이아웃**을 되살린다", () => {
    // 종은 (app)/layout.tsx 가 그린다. 화면 하나만 되살리면 레이아웃은 그대로라 ✕ 를
    // 눌러도 줄이 남는다.
    assert.match(action, /revalidatePath\("\/", "layout"\);/);
    // 적히지 않았으면 되살리지 않는다 — 목록이 똑같을 것이므로 캐시만 버리게 된다.
    const tail = action.slice(action.indexOf("const recorded"));
    assert.ok(tail.indexOf("if (!recorded) return;") < tail.indexOf('revalidatePath("/", "layout")'), "🔴 거절당했는데도 사이트 전체 캐시를 버린다");
  });

  it("🔴 포털이 보낸 개수는 손대지 않는다 — 남의 줄 몫이고 지움이 이미 반영돼 있다", () => {
    assert.match(bellComponent, /count=\{mine\.count \+ others\.count\}/);
  });
});

/* ── 🔴 제 줄 거르기 — 이 사이트에만 있는 한 단계 ─────────────────────── */

function myItem(id: string, source = "dss-inventory") {
  return {
    key: `${source}:${id}`,
    sourceId: source,
    sourceName: "DSS 재고관리",
    id,
    kind: "REJECTED",
    kindLabel: "반려됨",
    subject: "가짜 신청",
    detail: "",
    href: `http://192.168.1.132:3800/requests?id=${id}`,
  };
}

describe("포털이 돌려준 지움으로 제 줄을 거른다", () => {
  it("🔴 지운 제 줄이 목록에서 빠진다 — 안 거르면 「여기서 지웠는데 여기서만 뜬다」가 된다", () => {
    const mine = { items: [myItem("REJECTED:1"), myItem("REJECTED:2"), myItem("PENDING")], count: 3 };
    const left = withoutDismissed(mine, ["dss-inventory:REJECTED:2"]);
    assert.deepEqual(
      left.items.map((row) => row.key),
      ["dss-inventory:REJECTED:1", "dss-inventory:PENDING"],
    );
  });

  it("🔴 **개수도 함께 줄어든다** — 줄만 빠지면 「눌러도 안 없어지는 숫자」가 된다", () => {
    const mine = { items: [myItem("REJECTED:1"), myItem("REJECTED:2"), myItem("PENDING")], count: 3 };
    assert.equal(withoutDismissed(mine, ["dss-inventory:REJECTED:2"]).count, 2);
    assert.equal(withoutDismissed(mine, ["dss-inventory:REJECTED:1", "dss-inventory:PENDING"]).count, 1);
    // 전부 지우면 0 이다 — 줄도 숫자도 남지 않는다.
    assert.deepEqual(withoutDismissed(mine, ["dss-inventory:REJECTED:1", "dss-inventory:REJECTED:2", "dss-inventory:PENDING"]), { items: [], count: 0 });
  });

  it("🔴 개수가 0 아래로 내려가지 않는다 — 묶음 줄은 1 로 세고 잘린 목록은 총계로 센다", () => {
    // 이 시스템의 count 는 줄 수가 아니다(bell-items.ts 의 count 주석). 뺀 줄 수가
    // count 보다 클 수 있고, 그때 음수가 나오면 배지가 깨진다.
    const mine = { items: [myItem("A"), myItem("B"), myItem("C")], count: 1 };
    assert.equal(withoutDismissed(mine, ["dss-inventory:A", "dss-inventory:B", "dss-inventory:C"]).count, 0);
  });

  it("지운 것이 없으면 줄도 개수도 그대로다", () => {
    const mine = { items: [myItem("A")], count: 7 };
    assert.deepEqual(withoutDismissed(mine, []), { items: [myItem("A")], count: 7 });
    // 내 목록에 없는 열쇠가 와도 개수를 건드리지 않는다(이미 사라진 줄의 지움 기록).
    assert.deepEqual(withoutDismissed(mine, ["dss-inventory:없는줄"]), { items: [myItem("A")], count: 7 });
  });

  it("🔴 종 조각이 실제로 걸러서 그린다 — 함수를 만들어 놓고 안 쓰면 증상이 똑같다", () => {
    assert.match(bellComponent, /withoutDismissed\(raw, others\.dismissed\)/);
    assert.match(bellComponent, /const items = \[\.\.\.mine\.items, \.\.\.others\.items\]/);
  });
});

describe("포털이 보낸 dismissed 를 읽는다", () => {
  it("열쇠 배열을 그대로 싣는다", () => {
    const feed = normalizePortalNotificationFeed({ items: [], count: 0, dismissed: ["dss-inventory:A", "dss-inventory:B"] });
    assert.deepEqual(feed.dismissed, ["dss-inventory:A", "dss-inventory:B"]);
  });

  it("🔴 칸이 없는 옛 포털에도 돌아간다 — 빈 배열이고 종은 예전 그대로 그려진다", () => {
    for (const body of [{ items: [], count: 0 }, { items: [], count: 0, dismissed: null }, { items: [], count: 0, dismissed: "A,B" }, {}]) {
      assert.deepEqual(normalizePortalNotificationFeed(body).dismissed, []);
    }
  });

  it("글자가 아닌 조각은 그 조각만 버린다", () => {
    const feed = normalizePortalNotificationFeed({ items: [], count: 0, dismissed: ["dss-inventory:A", 3, null, "", "dss-inventory:B"] });
    assert.deepEqual(feed.dismissed, ["dss-inventory:A", "dss-inventory:B"]);
  });
});

/* ── 🔴 열쇠의 접두사 — 포털에 등록된 이름과 같아야 한다 ──────────────── */

describe("열쇠의 접두사", () => {
  it("🔴 제 줄의 열쇠는 `{env.ssoClientId}:` 로 시작한다 — 어긋나면 포털이 조용히 버린다", () => {
    // 포털은 모르는 시스템의 열쇠를 **조용히 버린다**(dss-auth 의 readDismissalKeys).
    // 그래서 접두사가 어긋나면 오류 없이 「지워지지 않는 알림」만 남는다.
    // ① 조립은 받은 sourceId 를 접두사로 쓴다.
    const feed = buildInventoryNotificationItems({
      role: "ADMIN",
      pending: { count: 2, oldestAt: new Date("2026-10-13T00:00:00+09:00") },
      rejected: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          summary: "가짜 신청",
          decidedByName: "담당자",
          decidedAt: new Date("2026-10-13T00:00:00+09:00"),
          decidedBy: { kind: "UNDECIDED" },
        },
      ],
      issueApprovalsToDecide: { count: 1, oldestAt: new Date("2026-10-13T00:00:00+09:00") },
      decidedIssueApprovals: [],
      lowStockParts: [{ no: 7, name: "가짜부품", name2: "", quantity: 1, limitQuantity: 5 }],
      now: new Date("2026-10-13T09:00:00+09:00"),
      baseUrl: "http://192.168.1.132:3800",
      sourceId: "가짜-클라이언트",
    });
    assert.ok(feed.items.length > 0, "줄이 하나도 안 만들어졌다 — 이 시험이 아무것도 못 본다");
    for (const row of feed.items) assert.ok(row.key.startsWith("가짜-클라이언트:"), `접두사가 다르다: ${row.key}`);
    assert.match(bellItems, /key: `\$\{input\.sourceId\}:\$\{id\}`/);

    // ② 그 sourceId 로 넘기는 값은 `env.ssoClientId` 다 — 포털에 등록된 이름 그대로.
    assert.match(queries, /sourceId: env\.ssoClientId,/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 「보이는 알림 지우기 n건」 — 2026-10-20
 * ══════════════════════════════════════════════════════════════════════════
 * 줄이 여럿이면 ✕ 를 여러 번 눌러야 했다. 단추·글자·개수는 이제 @dss/ui 가 그리고
 * (그쪽 1210d11), 이 사이트가 하는 일은 둘뿐이다 — 묶음 포인터를 올리는 것과 **열쇠를
 * 미리 묶어** 넘기는 것.
 *
 * 여기서 지키는 것 넷:
 *  1. 🔴 자리가 `() => void` 라 인자를 못 받는다. 종은 **서버 조각**이라 평범한 화살표
 *     함수를 경계 너머로 못 넘긴다 — 그래서 값을 미리 묶은 서버 액션
 *     (`…bind(null, 열쇠들)`)이다.
 *  2. 🔴 **제 줄과 포털 줄이 둘 다 묶인다.** 이 사이트에만 있는 함정이다 — 계측기·PO 는
 *     남의 알림만 그려 포털 목록이 곧 전부였지만, 여기는 제 알림을 제 손으로 이어
 *     붙인다. 한쪽만 묶으면 「전부 지우기를 눌렀는데 내 알림만 남는다」가 된다.
 *  3. 🔴 묶인 값은 브라우저를 한 번 거쳐 돌아온다. **모양과 수를 가린다.** (누구의
 *     지움인지는 위 그대로 — 서버가 제 세션에서 읽는다.)
 *  4. 🔴 묶음 포인터만 올려서는 **마크업이 한 글자도 늘지 않는다.** 선을 넘는 것은
 *     `onDismissAll` 을 넘기는 순간뿐이다.
 * ═════════════════════════════════════════════════════════════════════════ */

/** 종에 그릴 줄 하나. 🔴 값은 전부 가짜다 — 실제 고객사·신청 번호를 넣지 않는다. */
function bellRow(over: Partial<NotificationBellItem> = {}): NotificationBellItem {
  return {
    key: "dss-inventory:REJECTED:1",
    sourceId: "dss-inventory",
    sourceName: "DSS 재고관리",
    id: "REJECTED:1",
    kind: "REJECTED",
    kindLabel: "반려됨",
    subject: "가짜 신청",
    detail: "",
    href: "http://192.168.1.132:3800/requests?id=1",
    ...over,
  };
}

/** 포털에서 온 줄(= 남의 시스템 것) 하나. */
function portalRow(over: Partial<NotificationBellItem> = {}): NotificationBellItem {
  return bellRow({
    key: "rf-service-system:APPROVAL:9",
    sourceId: "rf-service-system",
    sourceName: "DSS A/S 관리 시스템",
    id: "APPROVAL:9",
    kind: "APPROVAL",
    kindLabel: "결재 대기",
    href: "http://192.168.1.132:3000/repair-cases/9",
    ...over,
  });
}

/** 종이 실제로 내놓는 HTML. 묶음이 약속한 것을 글자로 확인한다. */
function bellMarkup(props: Parameters<typeof NotificationBell>[0]): string {
  return renderToStaticMarkup(NotificationBell(props) as React.ReactElement);
}

const allAction = action.slice(action.indexOf("export async function dismissAllNotificationsAction"));

describe("일괄 지우기 — 인자는 묶어서 넘긴다", () => {
  it("🔴 종이 값을 미리 묶어 넘긴다 — 평범한 화살표 함수는 경계를 못 건넌다", () => {
    // `onDismissAll={() => 지운다(열쇠들)}` 는 서버 조각에서 쓸 수 없다. 건널 수 있는
    // 것은 서버 액션뿐이고, 인자를 실으려면 bind 가 유일한 길이다.
    assert.match(bellComponent, /dismissAllNotificationsAction\.bind\(\s*null,\s*visibleNotificationKeys\(items\),?\s*\)/, "🔴 열쇠를 묶어 넘기지 않는다");
    assert.match(bellComponent, /<NotificationBell[\s\S]*?onDismissAll=\{dismissAll\}[\s\S]*?\/>/);
    // 묶음은 서버 조각 그대로여야 한다 — bind 를 쓰는 까닭 자체가 그것이다.
    assert.equal(clientFiles().includes(path.resolve(ROOT, "src/components/HeaderNotificationBell.tsx")), false);
  });

  it("🔴 묶는 목록이 **합친 뒤의 items** 다 — 포털 줄만 묶으면 제 알림이 남는다", () => {
    // 이 사이트의 함정. `others.items` 를 묶으면 화면은 멀쩡해 보이는데 눌렀을 때 제
    // 줄만 남는다 — 글자 한 낱말 차이라 눈으로는 안 잡힌다.
    assert.equal(/visibleNotificationKeys\(others\.items\)/.test(bellComponent), false, "🔴 포털에서 온 줄만 묶는다 — 제 알림이 안 지워진다");
    assert.equal(/visibleNotificationKeys\(mine\.items\)/.test(bellComponent), false, "🔴 제 줄만 묶는다 — 남의 알림이 안 지워진다");
    // 합치는 자리가 먼저고 묶는 자리가 뒤다(합치기 전의 값을 묶을 수 없게).
    assert.ok(bellComponent.indexOf("const items = [...mine.items, ...others.items]") < bellComponent.indexOf("dismissAllNotificationsAction.bind"));
  });
});

describe("일괄 지우기 — 제 줄과 포털 줄이 둘 다 열쇠에 들어간다", () => {
  it("🔴 합친 목록을 주면 **양쪽 열쇠가 다 나온다** — 빠뜨리면 「내 알림만 남는다」가 된다", () => {
    const mine = [bellRow({ key: "dss-inventory:REJECTED:1" }), bellRow({ key: "dss-inventory:PENDING", id: "PENDING", href: "http://192.168.1.132:3800/requests" })];
    const others = [portalRow(), portalRow({ key: "dss-improvements:NEW:3", sourceId: "dss-improvements", href: "http://192.168.1.132:3500/items/3" })];

    const keys = visibleNotificationKeys([...mine, ...others]);

    // 🔴 넷이 전부 있고, 차례도 종이 그리는 차례 그대로다(제 것이 앞).
    assert.deepEqual(keys, ["dss-inventory:REJECTED:1", "dss-inventory:PENDING", "rf-service-system:APPROVAL:9", "dss-improvements:NEW:3"]);
    assert.equal(keys.filter((key) => key.startsWith("dss-inventory:")).length, 2, "🔴 제 줄이 빠졌다");
    assert.equal(keys.filter((key) => !key.startsWith("dss-inventory:")).length, 2, "🔴 포털 줄이 빠졌다");
  });

  it("🔴 제 줄의 열쇠는 포털이 그대로 받아 적는다 — 한 묶음으로 나간다", async () => {
    // 제 줄도 남의 줄도 같은 통로로 나간다. 여기서 갈라 보내면 묶음이 둘이 되고, 한쪽만
    // 거절되는 길이 생긴다.
    const keys = visibleNotificationKeys([bellRow(), portalRow()]);
    const { calls, recorded } = await callingPortal(
      () => accepted(2),
      () => dismissPortalNotifications("사람-1", keys),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.get("keys")?.split(","), ["dss-inventory:REJECTED:1", "rf-service-system:APPROVAL:9"]);
    assert.equal(recorded, true);
  });
});

describe("일괄 지우기 — 누구의 지움인지는 서버가 정한다", () => {
  it("🔴 일괄 액션도 sub 을 인자로 받지 않는다 — 받는 것은 열쇠 목록뿐이다", () => {
    assert.ok(allAction.length > 0, "일괄 지우기 서버 액션을 찾지 못했다");
    assert.match(allAction, /^export async function dismissAllNotificationsAction\(keys: readonly string\[\]\)/, "🔴 받는 모양이 바뀌었다");
    const head = allAction.slice(0, allAction.indexOf("{"));
    assert.equal(/\bsub\b|subject/.test(head), false, "🔴 사람 번호를 인자로 받는다 — 남의 알림을 지울 수 있는 통로가 된다");
  });

  it("🔴 일괄 액션도 사람 번호를 **세션에서** 읽고, 세션이 끊겨도 튀지 않는다", () => {
    assert.match(allAction, /const session = await getSession\(\);/);
    assert.match(allAction, /if \(!session\) return;/);
    assert.match(allAction, /dismissPortalNotifications\(session\.user\.authSub, wanted\)/);
    assert.equal(allAction.includes("requireSession"), false, "🔴 단추 하나 때문에 화면이 로그인으로 튄다");
  });

  it("🔴 일괄 액션도 던지지 않고, 열쇠를 로그에 찍지 않는다", () => {
    assert.equal(/\bthrow\b/.test(allAction), false, "🔴 일괄 지우기가 던진다 — 누름이 통째로 멈춘다");
    for (const logged of allAction.matchAll(/console\.(error|log|warn)\(([\s\S]*?)\);/g)) {
      const args = logged[2];
      assert.equal(/\bkeys?\b|\bwanted\b|\bitem\b/.test(args), false, `🔴 로그에 열쇠가 딸려 나간다: ${args.trim().slice(0, 60)}`);
    }
  });

  it("🔴 일부만 적혀도 종이 다시 그려진다 — 일괄은 되살리기를 거르지 않는다", () => {
    // 열쇠가 200개를 넘으면 묶음이 여럿 나가고, 돌아오는 값은 「**전부** 적혔는가」다.
    // 가운데 하나가 거절돼도 나머지는 적혔다 — 거기서 되살리지 않으면 **이미 지워진 줄이
    // 종에 남는다.** 한 줄짜리 ✕ 와 반대인 까닭이 이것이다.
    assert.match(allAction, /revalidatePath\("\/", "layout"\);/);
    assert.equal(/if \(!recorded\w*\) return;/.test(allAction), false, "🔴 거절을 보고 되살리기를 건너뛴다 — 일부만 적힌 경우에 목록이 어긋난다");
  });
});

describe("일괄 지우기 — 브라우저에서 돌아온 값을 가린다", () => {
  it("🔴 배열이 아니면 통째로 거절한다 — 종에서 온 값이 아니다", () => {
    for (const bad of ["열쇠", 7, null, undefined, true, { 0: "a", length: 1 }, new Set(["a"])]) {
      assert.equal(vetDismissKeys(bad), null, `${JSON.stringify(bad) ?? String(bad)} 을 받아들였다`);
    }
  });

  it("글자가 아닌 칸과 빈 글자는 **그 칸만** 버린다 — 하나 때문에 단추가 죽지 않는다", () => {
    assert.deepEqual(vetDismissKeys(["dss-inventory:REJECTED:1", "", 7, null, "rf-service-system:APPROVAL:9"]), ["dss-inventory:REJECTED:1", "rf-service-system:APPROVAL:9"]);
    // 보낼 것이 하나도 안 남는 것과 「믿을 수 없는 값」은 **다른 답**이다.
    assert.deepEqual(vetDismissKeys([]), []);
    assert.deepEqual(vetDismissKeys(["", null]), []);
  });

  it("🔴 울타리를 넘으면 잘라 보내지 않고 거절한다 — 적힌 수가 거짓이 되면 안 된다", () => {
    const 딱맞게 = Array.from({ length: MAX_DISMISS_KEYS_AT_ONCE }, (_, at) => `site:K:${at}`);
    assert.equal(vetDismissKeys(딱맞게)?.length, MAX_DISMISS_KEYS_AT_ONCE);
    assert.equal(vetDismissKeys([...딱맞게, "site:K:하나더"]), null);

    // 🔴 울타리가 **정직한 종**보다 넉넉한지. 이 종의 줄은 제 줄(200에서 잘린다 —
    //    NOTIFICATION_MAX_ITEMS)과 남의 줄(포털이 한 시스템당 200 × 남의 시스템 여섯)을
    //    더한 것이라 아무리 많아도 일곱 몫이다. 정직한 누름이 여기 걸리면 안 된다.
    assert.ok(MAX_DISMISS_KEYS_AT_ONCE > NOTIFICATION_MAX_ITEMS * 7, "울타리가 정직한 종보다 좁다");
  });

  it("🔴 울타리 안의 큰 묶음은 하나도 안 흘리고 200개씩 나간다 — 실제로 보내 본다", async () => {
    const 열쇠들 = vetDismissKeys(Array.from({ length: MAX_DISMISS_KEYS_AT_ONCE }, (_, at) => `site:K:${at}`));
    assert.ok(열쇠들);

    const { calls, recorded } = await callingPortal(
      () => accepted(200),
      () => dismissPortalNotifications("사람-1", 열쇠들),
    );
    assert.equal(calls.length, MAX_DISMISS_KEYS_AT_ONCE / 200);
    assert.deepEqual(
      calls.flatMap((call) => call.body.get("keys")?.split(",") ?? []),
      열쇠들,
    );
    assert.equal(recorded, true);
  });
});

describe("일괄 지우기 — 지우는 범위 = 지금 그리는 줄 전부", () => {
  it("🔴 그릴 수 없는 주소의 줄은 열쇠에서도 빠진다 — 안 보인 줄이 사라지면 안 된다", () => {
    const items = [bellRow({ key: "a" }), bellRow({ key: "나쁜줄", href: "javascript:alert(1)" }), portalRow({ key: "b", href: "/requests" }), portalRow({ key: "c", href: "//다른곳/경로" })];
    // 종이 그리는 것과 **같은 기준**으로 거른다(@dss/ui 의 isSafeNotificationHref).
    assert.deepEqual(visibleNotificationKeys(items), ["a", "b"]);
  });

  it("🔴 단추에 적히는 수와 보내는 열쇠 수가 같다 — 둘이 어긋나면 사람에게 거짓말이다", () => {
    const items = [bellRow({ key: "a" }), bellRow({ key: "나쁜줄", href: "javascript:alert(1)" }), portalRow({ key: "b" })];
    const keys = visibleNotificationKeys(items);
    const markup = bellMarkup({ items, count: 9, label: "알림", onDismissAll: () => {} });

    assert.equal(keys.length, 2);
    assert.ok(markup.includes(`보이는 알림 지우기 ${keys.length}건`), `🔴 단추의 수가 보내는 열쇠 수와 다르다: ${markup.slice(markup.indexOf("보이는 알림"), markup.indexOf("보이는 알림") + 40)}`);
  });
});

describe("일괄 지우기 — 넘기기 전후", () => {
  it("🔴 onDismissAll 을 안 넘기면 마크업이 한 글자도 늘지 않는다", () => {
    // 🔴 묶음 포인터를 올린 것만으로는 화면이 바뀌지 않는다는 못이다. 선을 넘는 것은
    //    함수를 넘기는 순간뿐이다.
    const items = [bellRow({ key: "a" }), portalRow({ key: "b" })];
    const 안넘겼을때 = bellMarkup({ items, count: 2, label: "알림", onDismiss: () => {} });

    assert.equal(안넘겼을때.includes("dss-bell__dismissall"), false, "🔴 안 넘겼는데 일괄 단추가 섰다 — 묶음의 약속이 깨졌다");
    assert.equal(안넘겼을때.includes("dss-bell__dismissrow"), false);
    // 줄마다 서는 ✕ 는 그대로다(이 조각이 더하기만 했다는 뜻).
    assert.equal(안넘겼을때.match(/dss-bell__dismiss"/g)?.length, 2);
  });

  it("🔴 넘기면 목록 **안**에 단추가 서고, 줄마다 서는 ✕ 는 그대로다", () => {
    const items = [bellRow({ key: "a" }), portalRow({ key: "b" })];
    const 넘겼을때 = bellMarkup({ items, count: 2, label: "알림", onDismiss: () => {}, onDismissAll: () => {} });

    assert.match(넘겼을때, /<li class="dss-bell__dismissrow"><button type="button" class="dss-bell__dismissall">보이는 알림 지우기 2건<\/button><\/li><\/ul>/, "🔴 일괄 단추가 목록 맨 아래에 서지 않는다 — 묶음 포인터가 옛 커밋일 수 있다");
    assert.equal(넘겼을때.match(/dss-bell__dismiss"/g)?.length, 2, "줄마다 서는 ✕ 가 달라졌다");
    // 🔴 폼 안에 앉은 화면에서 누르는 순간 폼이 보내지면 안 된다.
    assert.match(넘겼을때, /<button type="button" class="dss-bell__dismissall">/);
  });

  it("🔴 그릴 줄이 하나도 없으면 단추도 없다 — 눌러도 아무 일 없는 단추를 두지 않는다", () => {
    // 이 사이트는 빈 종을 아예 안 그리지만(조각이 null 을 돌려준다) 묶음 쪽 선도 함께
    // 못 박는다.
    assert.equal(NotificationBell({ items: [], count: 0, onDismissAll: () => {} }), null);
    const 빈종 = bellMarkup({ items: [], count: 0, showWhenEmpty: true, emptyLabel: "알림이 없습니다", onDismissAll: () => {} });
    assert.equal(빈종.includes("dss-bell__dismissall"), false);
  });
});
