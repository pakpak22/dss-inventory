/**
 * ============================================================================
 * 🔴 알림 **확인(✓)** 이 흐르는 길 — 누르는 자리 · 적는 자리 · 걸러지는 자리
 * ============================================================================
 * 2026-10-22, 사용자 요구:
 *
 *   「알림을 **눌러서 확인하면** 종에서 사라지게 해 줘. 하지만 **결재 승인·부품
 *    요청**처럼 **동작이 필요한** 알림은 **해소될 때까지 남아 있게** 해 줘.
 *    예를 들어 **[재고부족]** 같은 경우는 확인하면 알림이 사라지도록 해 줘.
 *    **[X] 는 지금대로** — 당장 사라지고 재로그인하면 다시 생기는 방식으로.」
 *
 *   종의 줄 누르기 (@dss/ui 가 그린 <a href>)
 *     → 서버 액션(app/actions/notifications.ts)이 **제 세션에서** 사람 번호를 읽고
 *     → notifications/portal.ts 가 포털의 **확인** 통로에 Basic 자격으로 POST 하고
 *     → 다음 왕복에 포털이 `acknowledged` 로 그 열쇠를 돌려주면
 *     → withoutAcknowledged 가 **제 줄**을 목록에서 뺀다
 *
 * ── 🔴 이 집이 다른 집과 반대인 점 — **제 줄도 포털로 보낸다** ───────────
 * 휴가·게시판은 제 줄을 일부러 **안** 보냈다. 휴가의 제 줄은 결재 대기(승인용)뿐이라
 * 숨길 길을 아예 안 여는 것이 맞았고, 게시판의 제 줄은 **글을 열면** 열람 기록으로
 * 사라지는 다른 길이 이미 있었다.
 *
 * 🔴 **이 집은 다르다.** 사용자가 콕 집은 [재고 부족]이 **바로 이 시스템의 제 알림**이고,
 *    이 시스템에는 **제 확인 기록 표가 없다** — 적을 곳이 포털뿐이다. 포털의 확인 통로는
 *    **전체 목록**을 보고 지문을 계산하므로(부른 사이트에게도 한 번 묻는다 — dss-auth 의
 *    `docs/사이트-알림-통로.md`) 제 줄도 그 안에 있다.
 *
 * 🔵 **안전한 까닭**: 포털이 분류가 「정보 확인용(INFO)」인 줄만 빼 준다. 이 시스템의
 *    승인용 알림(확인 대기·결재 차례)은 확인을 적어도 **안 빠진다.** 판단은 전부 포털이
 *    하고, 이 사이트에는 종류를 가리는 갈래가 한 줄도 없다.
 *
 * ── 여기서 지키는 것 여덟 ───────────────────────────────────────────────
 *  1. 🔴 **확인 주소로 간다** — 지움 주소(`notification-dismissals`)가 아니다.
 *  2. 🔴 **제 줄을 눌러도 포털로 나간다**(위 까닭).
 *  3. 🔴 **포털이 돌려준 확인 열쇠로 제 줄이 걸러진다.** 이것이 없으면 포털에만
 *     적히고 **이 집 종에서는 안 사라진다** — 반쪽이다.
 *  4. 🔴 **지움 열쇠와 확인 열쇠가 안 섞인다.** 수명이 정반대라(지움은 다시 로그인하면
 *     돌아오고 확인은 안 돌아온다) 섞이면 안 돌아와야 할 줄이 돌아오거나 영영 사라진다.
 *  5. 🔴 **[X] 가 그대로다** — ✕ 와 「보이는 알림 지우기」의 배선·주소·몸통을 건드리지
 *     않았다.
 *  6. 🔴 **확인이 실패해도 이동을 막지 않는다.** 줄을 누르는 일은 화면을 건너가는
 *     일이기도 하다.
 *  7. 🔴 **어떤 답이 와도 던지지 않는다**(읽는 쪽·지움 쪽과 같은 약속).
 *  8. 🔴 **자격증명도 열쇠도 로그에 안 찍는다.**
 *
 * 🔴 이 시험은 DB 에도 바깥 망에도 닿지 않는다. 포털을 부르는 자리는 가짜 fetch 로
 *    가로챈다. 🔴 값은 전부 가짜다 — 실제 고객사·부품명·사람 이름을 넣지 않는다.
 * ============================================================================
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { NotificationBell, type NotificationBellItem } from "@dss/ui";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { acknowledgePortalNotification, normalizePortalNotificationFeed, withoutAcknowledged, withoutDismissed } from "../src/lib/notifications/portal";

// 🔴 이 저장소의 tsconfig 는 `vendor` 를 빼 놓아, 시험을 돌리는 tsx 가 묶음의 .tsx 를
//    **옛 방식(React.createElement)으로 굽는다** — 그 코드는 `React` 를 전역에서 찾는다.
//    (notifications-dismissal.test.ts 에 같은 까닭이 자세히 적혀 있다.)
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

/**
 * 소스에서 한 토막을 잘라 낸다.
 *
 * 🔴 **빈 토막이면 그 자리에서 멈춘다.** 찾는 이름이 바뀌면 `indexOf` 가 -1 을 주고
 *    `slice(-1)` 은 **마지막 한 글자**를, 못 찾은 이름으로 자르면 **빈 문자열**을 준다 —
 *    그 위에서 「없는가」를 묻는 단언은 전부 **조용히 통과한다.** 그러면 이 시험은 아무것도
 *    안 보면서 초록색으로 남는다.
 */
function sliceFrom(source: string, marker: string, label: string): string {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `🔴 ${label} 을(를) 찾지 못했다 — 이름이 바뀌었으면 이 시험도 함께 고칠 것: ${marker}`);
  const cut = source.slice(at);
  assert.ok(cut.trim().length > 0, `🔴 ${label} 토막이 비었다 — 아무것도 안 보면서 통과할 뻔했다`);
  return cut;
}

const ACTION_PATH = "src/app/actions/notifications.ts";
const actionRaw = read(ACTION_PATH);
const action = withoutComments(actionRaw);
const portal = withoutComments(read("src/lib/notifications/portal.ts"));
const bellComponent = withoutComments(read("src/components/HeaderNotificationBell.tsx"));

/** 확인을 적는 함수의 몸통만. */
const ackWrite = sliceFrom(portal, "export async function acknowledgePortalNotification", "확인을 적는 함수");
/** 지움을 적는 함수의 몸통만(끝은 확인 함수가 시작되는 자리). */
const dismissWrite = (() => {
  const from = sliceFrom(portal, "async function recordDismissalChunk", "지움을 적는 함수");
  const to = from.indexOf("export async function acknowledgePortalNotification");
  assert.ok(to > 0, "🔴 확인 함수가 지움 함수 뒤에 있지 않다 — 토막 자르기가 깨졌다");
  const cut = from.slice(0, to);
  assert.ok(cut.trim().length > 0, "🔴 지움 토막이 비었다");
  return cut;
})();
/**
 * 확인 서버 액션의 몸통만.
 * 🔴 **뒤를 잘라야 한다** — 이 함수는 일괄 지우기 액션 **앞**에 서 있어서, 끝을 안 끊으면
 *    토막에 지움 쪽 코드가 딸려 들어와 「확인이 지움을 안 부른다」 같은 단언이 엉뚱하게
 *    실패한다(또는 더 나쁘게, 엉뚱하게 통과한다).
 */
const ackAction = (() => {
  const from = sliceFrom(action, "export async function acknowledgeNotificationAction", "확인 서버 액션");
  const to = from.indexOf("export async function dismissAllNotificationsAction");
  assert.ok(to > 0, "🔴 확인 액션 뒤에 일괄 지우기 액션이 없다 — 토막 자르기가 깨졌다");
  const cut = from.slice(0, to);
  assert.ok(cut.trim().length > 0, "🔴 확인 액션 토막이 비었다");
  return cut;
})();

/* ── 가짜 포털 ────────────────────────────────────────────────────────── */

type PortalCall = { url: string; headers: Record<string, string>; body: URLSearchParams };

/** 포털이 보내는 정상 답. `skipped` 는 **실패가 아니다**(그 줄이 포털 목록에 없었다). */
function accepted(count: number): Response {
  return new Response(JSON.stringify({ recorded: count, dropped: 0, skipped: 0 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rejectedWith(status: number): Response {
  return new Response(JSON.stringify({ error: "invalid_request", error_description: "" }), { status, headers: { "content-type": "application/json" } });
}

/** 포털 자리에 가짜를 세우고 일을 시킨 뒤 **무엇이 나갔는지**를 돌려준다. 진짜 망에 안 나간다. */
async function callingPortal(answer: (call: PortalCall, nth: number) => Response | Promise<Response>, run: () => Promise<boolean>): Promise<{ calls: PortalCall[]; written: boolean }> {
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

  let written: boolean;
  try {
    written = await run();
  } finally {
    globalThis.fetch = realFetch;
    process.env = realEnv;
  }

  return { calls, written };
}

/** 이 시스템이 제 손으로 그리는 줄(= 제 줄) 하나. [재고 부족]이 여기 산다. */
function myItem(id: string): NotificationBellItem {
  return {
    key: `dss-inventory:${id}`,
    sourceId: "dss-inventory",
    sourceName: "DSS 재고관리",
    id,
    kind: "LOW_STOCK",
    kindLabel: "재고 부족",
    subject: "가짜부품",
    detail: "남은 수량 1 · 한계수량 5",
    href: "http://192.168.1.132:3800/?part=7",
  };
}

/** 포털에서 온 줄(= 남의 시스템 것) 하나. */
function portalItem(id: string): NotificationBellItem {
  return {
    key: `rf-service-system:${id}`,
    sourceId: "rf-service-system",
    sourceName: "DSS A/S 관리 시스템",
    id,
    kind: "APPROVAL",
    kindLabel: "결재 대기",
    subject: "가짜 건",
    detail: "",
    href: "http://192.168.1.132:3000/repair-cases/9",
  };
}

/** 종이 실제로 내놓는 HTML. */
function bellMarkup(props: Parameters<typeof NotificationBell>[0]): string {
  return renderToStaticMarkup(NotificationBell(props) as React.ReactElement);
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 누르면 포털에 보낸다 — **확인 주소**로
 * ═════════════════════════════════════════════════════════════════════════ */

describe("확인은 확인 주소로 나간다 — 지움 주소가 아니다", () => {
  it("🔴 `notification-acknowledgements` 로 간다", async () => {
    const { calls, written } = await callingPortal(
      () => accepted(1),
      () => acknowledgePortalNotification("사람-1", "rf-service-system:APPROVAL:9"),
    );

    assert.equal(written, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://portal.invalid/api/integration/notification-acknowledgements");
    // 🔴 지움 통로로 가면 **수명이 뒤바뀐다** — 다시 로그인하면 돌아와야 할 줄이
    //    영영 사라지거나, 안 돌아와야 할 줄이 돌아온다.
    assert.equal(calls[0].url.includes("notification-dismissals"), false, "🔴 확인이 지움 통로로 나갔다");
  });

  it("🔴 자격증명은 머리말로만 나가고, 몸통에 실리는 것은 둘뿐이다", async () => {
    const { calls } = await callingPortal(
      () => accepted(1),
      () => acknowledgePortalNotification("사람-1", "dss-inventory:PART_LOW_STOCK:7"),
    );

    const [call] = calls;
    assert.equal(call.url.includes("?"), false, "🔴 주소에 무언가 실렸다 — 그 값은 접근 로그에 남는다");
    assert.match(call.headers.authorization, /^Basic /);
    assert.equal(call.headers["content-type"], "application/x-www-form-urlencoded");

    // 🔴 **지문 칸은 없다.** 「그때 본 내용」은 포털이 제 목록에서 계산한다 — 사이트가
    //    지문을 정할 수 있으면 아무 값이나 넣어 그 알림을 영영 안 보이게 만들 수 있다.
    assert.deepEqual([...call.body.keys()].sort(), ["keys", "sub"]);
    assert.equal(call.body.get("sub"), "사람-1");
    // 칸 이름은 하나여도 `keys` 다 — 지움 통로와 같은 모양이고 포털도 같은 파서를 쓴다.
    assert.equal(call.body.get("keys"), "dss-inventory:PART_LOW_STOCK:7");
  });

  it("읽는 통로·지움 통로와 같은 자격·같은 상한·같은 no-store 를 쓴다", () => {
    assert.match(ackWrite, /authorization: `Basic \$\{Buffer\.from\(credentials/);
    assert.match(ackWrite, /signal: AbortSignal\.timeout\(PORTAL_NOTIFICATIONS_TIMEOUT_MS\)/);
    assert.match(ackWrite, /cache: "no-store"/);
    assert.match(ackWrite, /method: "POST"/);
  });

  it("🔴 지움 쪽과 **요청 모양이 같다** — 두 벌이라 한쪽만 고쳐지는 날이 온다", () => {
    // 두 통로는 자격증명도·몸통 모양도·상한도 같다. 그래도 한 함수로 묶지 않았다 —
    // 묶으려면 **이미 돌고 있는 ✕ 쪽 코드를 고쳐야** 하는데 요구가 「[X] 는 지금대로」였다.
    // 대신 두 벌이 어긋나는 위험을 여기서 막는다.
    const 같아야하는것 = [
      'method: "POST"',
      "authorization: `Basic ${Buffer.from(credentials",
      '"content-type": "application/x-www-form-urlencoded"',
      'accept: "application/json"',
      'cache: "no-store"',
      "signal: AbortSignal.timeout(PORTAL_NOTIFICATIONS_TIMEOUT_MS)",
      "new URLSearchParams({ sub: subject",
      "if (!response.ok)",
      "return false;",
      "return true;",
    ];
    for (const 조각 of 같아야하는것) {
      assert.ok(dismissWrite.includes(조각), `🔴 지움 쪽에 없다(토막 자르기가 깨졌을 수 있다): ${조각}`);
      assert.ok(ackWrite.includes(조각), `🔴 확인 쪽에 없다 — 두 통로가 갈라졌다: ${조각}`);
    }
  });
});

describe("보내지 않아야 하는 때", () => {
  it("🔴 열쇠가 비면 포털을 아예 부르지 않는다 — 빈 묶음은 400 으로 거절된다", async () => {
    const { calls, written } = await callingPortal(
      () => accepted(0),
      () => acknowledgePortalNotification("사람-1", ""),
    );
    assert.equal(calls.length, 0);
    assert.equal(written, false);
  });

  it("사람 번호가 비어 있으면 아예 적지 않는다", async () => {
    const { calls, written } = await callingPortal(
      () => accepted(1),
      () => acknowledgePortalNotification("", "dss-inventory:PART_LOW_STOCK:7"),
    );
    assert.equal(calls.length, 0);
    assert.equal(written, false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ① -ㄴ 🔴 **제 줄을 눌러도 포털로 간다** — 이 집만의 결정(까닭은 머리말)
 * ═════════════════════════════════════════════════════════════════════════ */

describe("제 줄도 포털로 보낸다 — 휴가·게시판과 반대다", () => {
  it("🔴 [재고 부족] 같은 **제 줄의 열쇠**도 그대로 나간다", async () => {
    // 까닭(머리말에 자세히): 사용자가 콕 집은 [재고부족]이 **이 시스템의 제 알림**이고,
    // 이 시스템에는 **제 확인 기록 표가 없어** 적을 곳이 포털뿐이다. 포털의 확인 통로는
    // 전체 목록을 보고 지문을 계산하므로 제 줄도 그 안에 있다.
    const { calls, written } = await callingPortal(
      () => accepted(1),
      () => acknowledgePortalNotification("사람-1", myItem("PART_LOW_STOCK:7").key),
    );

    assert.equal(written, true);
    assert.equal(calls.length, 1, "🔴 제 줄이라고 안 보냈다 — 그러면 적을 곳이 아무 데도 없다");
    assert.equal(calls[0].body.get("keys"), "dss-inventory:PART_LOW_STOCK:7");
  });

  it("🔴 종이 **가리지 않고** 넘긴다 — sourceId 로 갈래를 치지 않는다", () => {
    // 갈래를 치면 제 줄의 확인이 어디에도 안 적히거나(휴가의 모양), 두 곳이 서로 다른
    // 규칙을 들게 된다. 무엇이 실제로 사라질지는 **포털이** 정한다.
    assert.match(bellComponent, /<NotificationBell[\s\S]*?onAcknowledge=\{acknowledgeNotificationAction\}[\s\S]*?\/>/, "🔴 종이 확인을 안 넘긴다 — 줄을 눌러도 아무 일이 없다");
    assert.equal(/onAcknowledge=\{[^}]*sourceId/.test(bellComponent), false, "🔴 sourceId 로 갈래를 친다");
    assert.equal(/onAcknowledge=\{[^}]*\?/.test(bellComponent), false, "🔴 확인을 넘길지 말지를 여기서 가른다");
  });

  it("🔴 서버 액션에도 종류를 가리는 갈래가 없다 — 판단은 전부 포털이 한다", () => {
    // 「동작이 필요한 알림은 남아 있게」는 포털이 지킨다(승인용 줄의 열쇠는 애초에
    // `acknowledged` 에 안 담겨 온다). 여기서 한 번 더 가르면 어긋나도 오류가 안 난다.
    assert.equal(/\bLOW_STOCK\b|\bPENDING\b|\bAPPROVAL\b|\bkind\b/.test(ackAction), false, "🔴 확인 액션이 알림 종류를 들여다본다");
    assert.equal(/sourceId/.test(ackAction), false, "🔴 확인 액션이 어느 시스템 줄인지를 가린다");
  });

  it("🔴 누구의 확인인지는 **서버가** 정한다 — 받는 것은 줄 하나뿐이다", () => {
    assert.match(ackAction, /^export async function acknowledgeNotificationAction\(\s*item: NotificationBellItem,?\s*\)/, "🔴 받는 모양이 바뀌었다");
    const head = ackAction.slice(0, ackAction.indexOf("{"));
    assert.equal(/\bsub\b|subject/.test(head), false, "🔴 사람 번호를 인자로 받는다 — 남의 알림을 확인 처리하는 통로가 된다");
    assert.match(ackAction, /const session = await getSession\(\);/);
    assert.match(ackAction, /if \(!session\) return;/);
    assert.match(ackAction, /acknowledgePortalNotification\(session\.user\.authSub, key\)/);
    // 세션이 막 끊긴 사람이 줄을 눌렀다고 보던 화면이 로그인으로 튀면 안 된다.
    assert.equal(ackAction.includes("requireSession"), false, "🔴 줄 하나 눌렀다고 화면이 로그인으로 튄다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 🔴 포털이 돌려준 **확인한 열쇠**로 제 줄을 거른다 — 이것이 없으면 반쪽이다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("포털이 보낸 acknowledged 를 읽는다", () => {
  it("열쇠 배열을 그대로 싣는다", () => {
    const feed = normalizePortalNotificationFeed({ items: [], count: 0, acknowledged: ["dss-inventory:A", "dss-inventory:B"] });
    assert.deepEqual(feed.acknowledged, ["dss-inventory:A", "dss-inventory:B"]);
  });

  it("🔴 칸이 없는 옛 포털에도 돌아간다 — 빈 배열이고 종은 예전 그대로 그려진다", () => {
    for (const body of [{ items: [], count: 0 }, { items: [], count: 0, acknowledged: null }, { items: [], count: 0, acknowledged: "A,B" }, {}]) {
      assert.deepEqual(normalizePortalNotificationFeed(body).acknowledged, []);
    }
  });

  it("글자가 아닌 조각은 그 조각만 버린다", () => {
    const feed = normalizePortalNotificationFeed({ items: [], count: 0, acknowledged: ["dss-inventory:A", 3, null, "", "dss-inventory:B"] });
    assert.deepEqual(feed.acknowledged, ["dss-inventory:A", "dss-inventory:B"]);
  });
});

describe("포털이 돌려준 확인으로 제 줄을 거른다", () => {
  it("🔴 확인한 제 줄이 목록에서 빠진다 — 안 거르면 포털에만 적히고 여기선 그대로 뜬다", () => {
    // 🔴 이것이 이 조각의 알맹이다. 제 줄은 **제 DB 에서 그리므로**, ①만 하면 포털에는
    //    적혔는데 이 집 종에서는 안 사라진다.
    const mine = { items: [myItem("PART_LOW_STOCK:7"), myItem("PART_LOW_STOCK:8"), myItem("REQUESTS_PENDING")], count: 3 };
    const left = withoutAcknowledged(mine, ["dss-inventory:PART_LOW_STOCK:8"]);
    assert.deepEqual(
      left.items.map((row) => row.key),
      ["dss-inventory:PART_LOW_STOCK:7", "dss-inventory:REQUESTS_PENDING"],
    );
  });

  it("🔴 **개수도 함께 줄어든다** — 줄만 빠지면 「눌러도 안 없어지는 숫자」가 된다", () => {
    const mine = { items: [myItem("A"), myItem("B"), myItem("C")], count: 3 };
    assert.equal(withoutAcknowledged(mine, ["dss-inventory:B"]).count, 2);
    assert.deepEqual(withoutAcknowledged(mine, ["dss-inventory:A", "dss-inventory:B", "dss-inventory:C"]), { items: [], count: 0 });
  });

  it("🔴 개수가 0 아래로 내려가지 않는다 — 묶음 줄은 1 로 세고 잘린 목록은 총계로 센다", () => {
    const mine = { items: [myItem("A"), myItem("B"), myItem("C")], count: 1 };
    assert.equal(withoutAcknowledged(mine, ["dss-inventory:A", "dss-inventory:B", "dss-inventory:C"]).count, 0);
  });

  it("확인한 것이 없으면 줄도 개수도 그대로다", () => {
    const mine = { items: [myItem("A")], count: 7 };
    assert.deepEqual(withoutAcknowledged(mine, []), { items: [myItem("A")], count: 7 });
    // 내 목록에 없는 열쇠가 와도 개수를 건드리지 않는다(이미 사라진 줄의 확인 기록).
    assert.deepEqual(withoutAcknowledged(mine, ["dss-inventory:없는줄"]), { items: [myItem("A")], count: 7 });
  });

  it("🔴 종 조각이 **실제로** 걸러서 그린다 — 함수를 만들어 놓고 안 쓰면 증상이 똑같다", () => {
    assert.match(bellComponent, /withoutAcknowledged\([\s\S]{0,40}?others\.acknowledged\)/, "🔴 확인 거르기를 종이 안 부른다");
    // 거른 결과가 실제로 그려지는 목록에 들어간다(합치는 자리가 거르기 **뒤**다).
    assert.ok(bellComponent.indexOf("withoutAcknowledged(") < bellComponent.indexOf("const items = [...mine.items, ...others.items]"), "🔴 거르기 전의 값을 그린다");
    assert.match(bellComponent, /const items = \[\.\.\.mine\.items, \.\.\.others\.items\]/);
  });

  it("🔴 두 거르기의 셈이 갈라지지 않았다 — 두 벌이라 한쪽만 고쳐지는 날이 온다", () => {
    // 🔴 코드를 **합치라는 뜻이 아니다**(합치면 수명이 섞인다 — 아래 절). 뜻은 둘이되
    //    「줄을 빼고 개수를 그만큼 줄인다」는 셈은 하나여야 한다는 못이다.
    const mine = { items: [myItem("A"), myItem("B"), myItem("C")], count: 5 };
    for (const 열쇠들 of [[], ["dss-inventory:A"], ["dss-inventory:A", "dss-inventory:C"], ["dss-inventory:없는줄"], ["dss-inventory:A", "dss-inventory:B", "dss-inventory:C"]]) {
      assert.deepEqual(withoutAcknowledged(mine, 열쇠들), withoutDismissed(mine, 열쇠들), `🔴 같은 입력에 두 함수가 다른 답을 냈다: ${JSON.stringify(열쇠들)}`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 🔴 **지움과 확인이 안 섞인다** — 수명이 정반대다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("지움 열쇠와 확인 열쇠가 안 섞인다", () => {
  it("🔴 포털의 답에서 두 칸을 **따로** 읽는다", () => {
    const feed = normalizePortalNotificationFeed({
      items: [],
      count: 0,
      dismissed: ["dss-inventory:지운줄"],
      acknowledged: ["dss-inventory:확인한줄"],
    });
    assert.deepEqual(feed.dismissed, ["dss-inventory:지운줄"]);
    assert.deepEqual(feed.acknowledged, ["dss-inventory:확인한줄"]);
    // 🔴 한쪽에 다른 쪽이 섞여 들어오면 안 된다. 섞이면 확인을 지움으로 읽어
    //    **안 돌아와야 할 줄이 다시 로그인했을 때 돌아온다.**
    assert.equal(feed.dismissed.includes("dss-inventory:확인한줄"), false, "🔴 확인이 지움에 섞였다");
    assert.equal(feed.acknowledged.includes("dss-inventory:지운줄"), false, "🔴 지움이 확인에 섞였다");
  });

  it("🔴 한쪽 열쇠로는 다른 쪽이 안 걸러진다 — 두 목록은 끝까지 따로다", () => {
    const mine = { items: [myItem("지운줄"), myItem("확인한줄")], count: 2 };

    // 지움 열쇠만으로 거르면 확인한 줄은 남는다.
    const 지움만 = withoutDismissed(mine, ["dss-inventory:지운줄"]);
    assert.deepEqual(
      지움만.items.map((row) => row.key),
      ["dss-inventory:확인한줄"],
    );

    // 확인 열쇠만으로 거르면 지운 줄은 남는다.
    const 확인만 = withoutAcknowledged(mine, ["dss-inventory:확인한줄"]);
    assert.deepEqual(
      확인만.items.map((row) => row.key),
      ["dss-inventory:지운줄"],
    );

    // 둘을 **차례로** 거르면 둘 다 빠진다 — 종이 하는 그대로다.
    const 둘다 = withoutAcknowledged(지움만, ["dss-inventory:확인한줄"]);
    assert.deepEqual(둘다.items, []);
    assert.equal(둘다.count, 0);
  });

  it("🔴 종이 두 목록을 **한 배열로 이어 붙이지 않는다** — 섞으면 다시 가를 수 없다", () => {
    // 코드가 한 줄 짧아지는 대신 수명이 정반대인 두 뜻이 섞인다. 지움은 다시 로그인하면
    // 돌아오고(보기를 미루는 것) 확인은 안 돌아온다(해소된 것).
    assert.equal(/\[\s*\.\.\.others\.dismissed\s*,\s*\.\.\.others\.acknowledged\s*\]/.test(bellComponent), false, "🔴 두 목록을 한 배열로 합쳤다");
    assert.equal(/\[\s*\.\.\.others\.acknowledged\s*,\s*\.\.\.others\.dismissed\s*\]/.test(bellComponent), false, "🔴 두 목록을 한 배열로 합쳤다");
    assert.equal(/others\.dismissed\.concat|others\.acknowledged\.concat/.test(bellComponent), false, "🔴 두 목록을 이어 붙였다");

    // 🔴 짝이 어긋나도 안 된다 — 지움 함수에 확인 열쇠를, 확인 함수에 지움 열쇠를.
    assert.equal(/withoutDismissed\([^)]*acknowledged/.test(bellComponent), false, "🔴 확인 열쇠를 지움으로 걸렀다 — 영영 사라진다");
    assert.equal(/withoutAcknowledged\([^)]*others\.dismissed/.test(bellComponent), false, "🔴 지움 열쇠를 확인으로 걸렀다 — 안 돌아와야 할 줄이 돌아온다");

    // 두 거르기가 **둘 다** 그 자리에 있다(하나만 두면 한쪽이 안 걸러진다).
    assert.match(bellComponent, /withoutDismissed\(raw, others\.dismissed\)/);
    assert.match(bellComponent, /withoutAcknowledged\(/);
  });

  it("🔴 적히는 통로도 둘이다 — 주소가 다르다", () => {
    assert.ok(ackWrite.includes("/api/integration/notification-acknowledgements"), "🔴 확인이 확인 통로로 안 간다");
    assert.equal(ackWrite.includes("/api/integration/notification-dismissals"), false, "🔴 확인이 지움 통로로 간다");
    assert.ok(dismissWrite.includes("/api/integration/notification-dismissals"), "🔴 지움 통로 주소가 바뀌었다");
    assert.equal(dismissWrite.includes("/api/integration/notification-acknowledgements"), false, "🔴 지움이 확인 통로로 간다");
  });

  it("🔴 확인 액션이 지움 함수를 부르지 않는다 — 두 단추가 한쪽으로 합쳐지면 안 된다", () => {
    assert.equal(/dismissPortalNotifications/.test(ackAction), false, "🔴 확인이 지움으로 적힌다 — 다시 로그인하면 돌아온다");
    assert.match(ackAction, /acknowledgePortalNotification\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 [X] 는 지금대로 — 사용자가 못 박은 것
 * ═════════════════════════════════════════════════════════════════════════ */

describe("[X] 가 그대로다", () => {
  it("🔴 ✕ 와 일괄 지우기 배선이 그대로 넘어간다", () => {
    assert.match(bellComponent, /<NotificationBell[\s\S]*?onDismiss=\{dismissNotificationAction\}[\s\S]*?\/>/);
    assert.match(bellComponent, /<NotificationBell[\s\S]*?onDismissAll=\{dismissAll\}[\s\S]*?\/>/);
    assert.match(bellComponent, /dismissAllNotificationsAction\.bind\(\s*null,\s*visibleNotificationKeys\(items\),?\s*\)/);
  });

  it("🔴 모든 줄에 ✕ 가 그대로 선다 — 확인을 붙이면서 자격을 가리지 않았다", () => {
    assert.equal(bellComponent.includes("canDismiss"), false, "🔴 ✕ 를 가리는 자격이 생겼다");
  });

  it("🔴 확인을 넘겨도 줄마다 서는 ✕ 는 그대로다 — 마크업으로 확인한다", () => {
    const items = [myItem("PART_LOW_STOCK:7"), portalItem("APPROVAL:9")];
    const 확인없을때 = bellMarkup({ items, count: 2, label: "알림", onDismiss: () => {}, onDismissAll: () => {} });
    const 확인있을때 = bellMarkup({ items, count: 2, label: "알림", onAcknowledge: () => {}, onDismiss: () => {}, onDismissAll: () => {} });

    assert.equal(확인있을때.match(/dss-bell__dismiss"/g)?.length, 2, "🔴 ✕ 의 수가 달라졌다");
    assert.equal(확인있을때.match(/dss-bell__dismiss"/g)?.length, 확인없을때.match(/dss-bell__dismiss"/g)?.length);
    assert.ok(확인있을때.includes("보이는 알림 지우기 2건"), "🔴 일괄 지우기 단추가 사라졌다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 🔴 확인이 실패해도 **이동을 막지 않는다** · 던지지 않는다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("확인이 실패해도 이동을 막지 않는다", () => {
  it("🔴 거절 여섯에 **던지지 않고** false 를 돌려준다", async () => {
    for (const status of [400, 401, 403, 405, 429, 503]) {
      const { calls, written } = await callingPortal(
        () => rejectedWith(status),
        () => acknowledgePortalNotification("사람-1", "dss-inventory:PART_LOW_STOCK:7"),
      );
      assert.equal(calls.length, 1);
      assert.equal(written, false, `${status} 에서 적혔다고 답했다`);
    }
  });

  it("🔴 망이 멎어도·답이 JSON 이 아니어도 던지지 않는다", async () => {
    const 망멎음 = await callingPortal(
      () => {
        throw new TypeError("fetch failed");
      },
      () => acknowledgePortalNotification("사람-1", "dss-inventory:PART_LOW_STOCK:7"),
    );
    assert.equal(망멎음.written, false);

    // 🔵 몸통은 안 읽는다(열쇠 하나짜리라 볼 것이 없다) — 그래도 200 이면 적힌 것이다.
    const 이상한답 = await callingPortal(
      () => new Response("이건 JSON 이 아니다", { status: 200, headers: { "content-type": "text/plain" } }),
      () => acknowledgePortalNotification("사람-1", "dss-inventory:PART_LOW_STOCK:7"),
    );
    assert.equal(이상한답.written, true);
  });

  it("🔴 이 통로에도 서버 액션에도 throw 가 한 군데도 없다", () => {
    assert.equal(/\bthrow\b/.test(ackWrite), false, "🔴 확인 통로가 던진다 — 누름이 통째로 멈춘다");
    assert.equal(/\bthrow\b/.test(action), false, "🔴 서버 액션이 던진다 — 이동까지 흔들린다");
    // 못 적었으면 사이트 전체 캐시를 버리지 않는다(목록이 똑같을 것이므로).
    assert.match(ackAction, /if \(!written\) return;/);
    assert.match(ackAction, /revalidatePath\("\/", "layout"\);/);
    assert.ok(ackAction.indexOf("if (!written) return;") < ackAction.indexOf('revalidatePath("/", "layout")'), "🔴 거절당했는데도 사이트 전체 캐시를 버린다");
  });

  it("🔴 @dss/ui 가 이 함수를 try 로 감싼다 — 그래도 우리 쪽이 기대지 않는다", () => {
    // 이동은 평범한 <a href> 가 한다. 묶음이 한 겹 받아 주지만 그 성질에 기대지 않고
    // 서버 액션도 제 손으로 삼킨다(위 단언).
    const 묶음 = withoutComments(read("vendor/dss-ui/src/notification-bell/BellBehavior.tsx"));
    const 알리는자리 = sliceFrom(묶음, "export function notifyAcknowledged", "묶음의 notifyAcknowledged");
    const 끝 = 알리는자리.indexOf("export function notifyDismissed");
    assert.ok(끝 > 0, "🔴 notifyDismissed 가 뒤에 없다 — 토막 자르기가 깨졌다");
    const 몸통 = 알리는자리.slice(0, 끝);
    assert.ok(몸통.trim().length > 0, "🔴 묶음 토막이 비었다");
    assert.match(몸통, /try \{[\s\S]*?onAcknowledge\(item\);[\s\S]*?\} catch \{/, "🔴 묶음이 더 이상 확인을 감싸지 않는다");
  });

  it("🔴 줄은 평범한 <a href> 그대로다 — 확인을 붙여도 이동 수단이 안 바뀐다", () => {
    const items = [myItem("PART_LOW_STOCK:7")];
    const markup = bellMarkup({ items, count: 1, label: "알림", onAcknowledge: () => {}, onDismiss: () => {} });
    assert.match(markup, /<a[^>]+href="http:\/\/192\.168\.1\.132:3800\/\?part=7"/, "🔴 줄이 더 이상 링크가 아니다 — 확인이 실패하면 아무 데도 못 간다");
  });

  it("🔴 자격증명도 열쇠도 로그에 찍지 않는다 — 찍히는 것은 오류의 종류와 상태뿐이다", () => {
    for (const logged of ackWrite.matchAll(/console\.(error|log|warn)\(([\s\S]*?)\);/g)) {
      const args = logged[2];
      assert.equal(/credentials|ssoClientSecret|ssoClientId|authorization/i.test(args), false, `🔴 로그에 자격증명이 딸려 나간다: ${args.trim().slice(0, 60)}`);
      assert.equal(/\bkeys?\b/.test(args), false, `🔴 로그에 열쇠가 딸려 나간다: ${args.trim()}`);
    }
    for (const logged of ackAction.matchAll(/console\.(error|log|warn)\(([\s\S]*?)\);/g)) {
      const args = logged[2];
      assert.equal(/\bkeys?\b|\bitem\b/.test(args), false, `🔴 로그에 열쇠가 딸려 나간다: ${args.trim()}`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ 🔴 시크릿이 브라우저로 나가지 않는다 — 확인을 붙이면서도 그대로
 * ═════════════════════════════════════════════════════════════════════════ */

describe("확인을 붙여도 종은 서버 조각 그대로다", () => {
  it('🔴 서버 액션이다 — 파일 첫 줄이 "use server" 다', () => {
    assert.match(actionRaw, /^"use server";\n/, '🔴 "use server" 가 파일 맨 앞이 아니다');
  });

  it("🔴 종에 `use client` 가 붙지 않았다 — 붙으면 client_secret 을 다루는 자리가 는다", () => {
    const source = withoutComments(read("src/components/HeaderNotificationBell.tsx")).trimStart();
    assert.equal(/^["']use client["']/.test(source), false, "🔴 종이 클라이언트 조각이 됐다");
    // 브라우저용 중계 통로도 안 생겼다(생겼다면 세션 재검증까지 함께 봐야 한다).
    assert.equal(fs.existsSync(path.resolve(ROOT, "src/app/api/notifications")), false);
  });
});
