/**
 * ============================================================================
 * 🔴 결재가 생기면 포털을 **쿡 찌른다** — 저장을 막지 않는다는 약속
 * ============================================================================
 * 2026-10-24, 쓰는 분: 「결재건이 생기자마자 메일이 보내졌으면 좋겠다.」
 * 포털(dss-auth)은 지금 **주기적으로 물어** 메일을 보내므로, 결재가 생긴 **뒤에** 포털을
 * 한 번 불러 그 틈을 메운다.
 *
 * ── 여기서 지키는 것 여섯 ───────────────────────────────────────────────
 *  1. 🔴 **포털이 죽어도 신청은 저장된다** — 404·500·타임아웃·연결 거부 전부에서 던지지 않는다.
 *     (통로가 아직 없는 동안에는 **404 가 정상**이다 — 다른 조각이 포털에 그 통로를 낸다.)
 *  2. 🔴 **트랜잭션 밖에서 부른다** — 안에서 부르면 포털이 멎었을 때 **결재 저장이 통째로
 *     되돌아간다.** 소스의 트랜잭션 몸통을 실제로 잘라 내어 그 안에 호출이 없는지 본다.
 *  3. 🔴 **몸통에 결재 내용이 없다** — 나가는 칸은 `approverSub` 하나뿐이다. 신청 번호·품명·
 *     갈래를 실으면 포털의 「다시 물어보고 보낸다」와 「보낸 기록으로 중복을 막는다」가 동시에
 *     무너진다.
 *  4. 🔴 **포털 번호가 없으면 부르지 않고 로그에 남는다.**
 *  5. 🔴 **결재가 생기는 자리 둘 다에서 불린다** — 올릴 때의 첫 단계 · 승인으로 열리는 다음 단계.
 *  6. 🔴 **대리인도 함께 알린다** — 「내가 결재할 건」 조회를 뒤집은 것이다(위임이 살아 있으면
 *     그 건은 대리인 목록에도 뜬다). 빼면 자리를 비운 사람에게만 메일이 간다.
 *
 * 🔴 이 시험은 DB 에도 바깥 망에도 닿지 않는다 — 포털 자리는 가짜 fetch 로 가로채고, 서버
 *    쪽 배선은 소스로 본다(`src/lib/notifications/approval-created-ping.ts` 는 `server-only`
 *    라 이 시험 과정에서 불러올 수 없다). 🔴 값은 전부 가짜다.
 * ============================================================================
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { delegateSubsFor, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";
import { notifyPortalApprovalCreated, PORTAL_APPROVAL_PING_TIMEOUT_MS } from "../src/lib/notifications/portal";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/**
 * 주석을 걷어 낸 코드.
 *
 * 🔴 **주석을 먼저 걷지 않으면 이 시험은 거짓말을 한다** — 이 저장소의 주석에는 함수 이름이
 * 그대로 적혀 있어서, 「트랜잭션 안에 호출이 없다」가 **주석 한 줄 때문에** 실패하거나
 * (더 나쁘게는) 「있다」가 주석만으로 통과한다.
 * 🔵 줄 끝 주석(` // …`)까지 걷는다. 앞에 공백을 요구하므로 `http://` 같은 글자는 안 건드린다.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");
}

/**
 * 글자값(문자열·템플릿)의 **속을 공백으로 비운다.** 괄호 짝을 세어 토막을 자르려면 글자 속의
 * 괄호가 섞이면 안 된다 — 이 저장소의 한국어 문구에는 괄호가 흔하다.
 * 🔵 따옴표 자리도 공백이라 길이(= 자리 번호)가 그대로다.
 */
function blankLiterals(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const quote = code[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      out += " ";
      i++;
      while (i < code.length) {
        if (code[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          out += " ";
          i++;
          break;
        }
        out += code[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += code[i];
    i++;
  }
  return out;
}

/** `db().transaction( … )` 의 **몸통**을 괄호 짝으로 잘라 낸다(여러 개면 전부). */
function transactionBodies(code: string): string[] {
  const MARKER = "db().transaction(";
  const bodies: string[] = [];
  let at = code.indexOf(MARKER);
  while (at >= 0) {
    const open = at + MARKER.length - 1;
    let depth = 0;
    let i = open;
    for (; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    assert.ok(i < code.length && depth === 0, "🔴 트랜잭션의 괄호 짝을 못 맞췄다 — 토막 자르기가 깨졌다");
    bodies.push(code.slice(open, i + 1));
    at = code.indexOf(MARKER, i);
  }
  return bodies;
}

const PART_ISSUE_PATH = "src/lib/approval/part-issue.ts";
/** 주석만 걷은 코드 — 글자값(`"NEEDS_APPROVAL"` 따위)을 그대로 봐야 하는 단언이 쓴다. */
const partIssueText = withoutComments(read(PART_ISSUE_PATH));
/**
 * 글자값의 속까지 비운 코드 — **괄호 짝으로 토막을 자르는** 쪽이 쓴다.
 * 🔵 비우되 길이를 그대로 두므로 자리 번호(`indexOf`)가 위 `partIssueText` 와 **같다.**
 */
const partIssue = blankLiterals(partIssueText);
const ping = withoutComments(read("src/lib/notifications/approval-created-ping.ts"));
const portalRaw = read("src/lib/notifications/portal.ts");
const portal = withoutComments(portalRaw);

/** 포털로 나가는 함수의 몸통만. 🔴 빈 토막이면 그 자리에서 멈춘다(아무것도 안 보고 통과할 뻔한다). */
const notifyWrite = (() => {
  const at = portal.indexOf("export async function notifyPortalApprovalCreated");
  assert.ok(at > 0, "🔴 포털로 나가는 함수를 찾지 못했다 — 이름이 바뀌었으면 이 시험도 함께 고칠 것");
  const cut = portal.slice(at);
  assert.ok(cut.trim().length > 0, "🔴 토막이 비었다");
  return cut;
})();

/* ── 가짜 포털 ────────────────────────────────────────────────────────── */

type PortalCall = { url: string; headers: Record<string, string>; rawBody: string; body: URLSearchParams };

function accepted(): Response {
  return new Response(JSON.stringify({ queued: 1 }), { status: 200, headers: { "content-type": "application/json" } });
}

function rejectedWith(status: number): Response {
  return new Response(JSON.stringify({ error: "not_found" }), { status, headers: { "content-type": "application/json" } });
}

/** 포털 자리에 가짜를 세우고 **무엇이 나갔는지**를 돌려준다. 진짜 망에 안 나간다. */
async function callingPortal(
  answer: (call: PortalCall, nth: number) => Response | Promise<Response>,
  run: () => Promise<boolean>,
): Promise<{ calls: PortalCall[]; sent: boolean; logs: string[] }> {
  const calls: PortalCall[] = [];
  const logs: string[] = [];
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  const realError = console.error;
  const realWarn = console.warn;

  process.env.SSO_ISSUER = "http://portal.invalid";
  process.env.SSO_CLIENT_ID = "dss-inventory";
  process.env.SSO_CLIENT_SECRET = "가짜-시크릿";

  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const rawBody = String(init.body ?? "");
    const call: PortalCall = {
      url: String(input),
      headers: (init.headers ?? {}) as Record<string, string>,
      rawBody,
      body: new URLSearchParams(rawBody),
    };
    calls.push(call);
    return answer(call, calls.length);
  }) as typeof fetch;
  console.error = (...args: unknown[]) => void logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  console.warn = console.error;

  let sent: boolean;
  try {
    sent = await run();
  } finally {
    globalThis.fetch = realFetch;
    process.env = realEnv;
    console.error = realError;
    console.warn = realWarn;
  }

  return { calls, sent, logs };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 🔴 보내는 것은 「누구에게 생겼다」 하나뿐
 * ═════════════════════════════════════════════════════════════════════════ */

describe("포털에 보내는 모양", () => {
  it("결재 생김 통로로 간다 — 알림·지움·확인 통로가 아니다", async () => {
    const { calls, sent } = await callingPortal(
      () => accepted(),
      () => notifyPortalApprovalCreated(["사람-1"]),
    );

    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://portal.invalid/api/integration/approval-created");
    for (const 다른통로 of ["notification-dismissals", "notification-acknowledgements", "integration/notifications"]) {
      assert.equal(calls[0].url.includes(다른통로), false, `🔴 엉뚱한 통로로 나갔다: ${다른통로}`);
    }
  });

  it("🔴 몸통에 실리는 칸은 `approverSub` 하나뿐이다 — 결재 내용이 한 글자도 안 나간다", async () => {
    const { calls } = await callingPortal(
      () => accepted(),
      () => notifyPortalApprovalCreated(["사람-1"]),
    );

    const [call] = calls;
    // 🔵 「무엇을 재는지」를 먼저 못 박는다 — 몸통이 비면 아래 「없다」들이 전부 공짜로 통과한다.
    assert.equal(call.body.get("approverSub"), "사람-1");
    assert.deepEqual([...new Set(call.body.keys())], ["approverSub"]);

    // 🔴 이 시스템의 결재를 가리키는 값들이 몸통에도 주소에도 없다.
    for (const 금지 of ["requestId", "approvalId", "summary", "kind", "quantit", "reason", "PART_ISSUE", "partNo", "note"]) {
      assert.equal(call.rawBody.includes(금지), false, `🔴 결재 내용이 실렸다: ${금지}`);
    }
    assert.equal(call.url.includes("?"), false, "🔴 주소에 무언가 실렸다 — 그 값은 접근 로그에 남는다");
  });

  it("자격증명은 머리말로만 나간다 — 읽기·지움·확인 통로와 같은 모양", async () => {
    const { calls } = await callingPortal(
      () => accepted(),
      () => notifyPortalApprovalCreated(["사람-1"]),
    );

    const [call] = calls;
    assert.match(call.headers.authorization, /^Basic /);
    assert.equal(call.headers["content-type"], "application/x-www-form-urlencoded");
    assert.equal(Buffer.from(call.headers.authorization.slice("Basic ".length), "base64").toString("utf8"), "dss-inventory:%EA%B0%80%EC%A7%9C-%EC%8B%9C%ED%81%AC%EB%A6%BF");

    assert.match(notifyWrite, /method: "POST"/);
    assert.match(notifyWrite, /cache: "no-store"/);
    assert.match(notifyWrite, /authorization: `Basic \$\{Buffer\.from\(credentials/);
    assert.match(notifyWrite, /env\.ssoClientId/);
    assert.match(notifyWrite, /env\.ssoClientSecret/);
    // 🔴 자격증명을 새로 짜지 않았다 — 이 집에 이미 있던 그 값들이다.
    assert.equal(/process\.env\./.test(notifyWrite), false, "🔴 환경변수를 직접 읽는다 — env.ts 를 거치지 않았다");
  });

  it("🔴 보내는 함수 자체가 결재 내용을 받지 못한다 — 실을 길이 없다", () => {
    const 머리 = notifyWrite.slice(0, notifyWrite.indexOf("{"));
    assert.match(머리, /notifyPortalApprovalCreated\(approverSubs: readonly string\[\]\)/);
    for (const 금지 of ["requestId", "approvalId", "summary", "quantities", "reason", "PartIssue"]) {
      assert.equal(notifyWrite.includes(금지), false, `🔴 포털로 나가는 함수가 결재 내용을 안다: ${금지}`);
    }
  });

  it("🔴 상한이 2초 안쪽이다 — 사람이 단추를 누르고 기다리는 자리다", () => {
    assert.ok(PORTAL_APPROVAL_PING_TIMEOUT_MS < 2000, String(PORTAL_APPROVAL_PING_TIMEOUT_MS));
    assert.equal(PORTAL_APPROVAL_PING_TIMEOUT_MS, 1500);
    assert.match(notifyWrite, /signal: AbortSignal\.timeout\(PORTAL_APPROVAL_PING_TIMEOUT_MS\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 🔴 여럿이면 한 번에 — 차례에 뜻이 있다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("결재할 사람이 여럿일 때", () => {
  it("🔴 **한 번만** 부르고 같은 칸을 거듭 싣는다 — 상한이 사람 수만큼 곱해지면 안 된다", async () => {
    const { calls, sent } = await callingPortal(
      () => accepted(),
      () => notifyPortalApprovalCreated(["결재자-1", "대리인-1", "대리인-2"]),
    );

    assert.equal(sent, true);
    assert.equal(calls.length, 1, "🔴 사람마다 따로 불렀다 — 누른 사람이 그만큼 더 기다린다");
    assert.deepEqual(calls[0].body.getAll("approverSub"), ["결재자-1", "대리인-1", "대리인-2"]);
  });

  it("🔴 맨 앞이 그 단계에 적힌 결재자다 — 포털이 칸을 하나만 읽어도 그 사람에게는 간다", async () => {
    const { calls } = await callingPortal(
      () => accepted(),
      () => notifyPortalApprovalCreated(["결재자-1", "대리인-1"]),
    );
    assert.equal(calls[0].body.get("approverSub"), "결재자-1");
  });

  it("같은 번호가 겹쳐 와도 한 번만 싣는다", async () => {
    const { calls } = await callingPortal(
      () => accepted(),
      () => notifyPortalApprovalCreated(["결재자-1", "대리인-1", "결재자-1"]),
    );
    assert.deepEqual(calls[0].body.getAll("approverSub"), ["결재자-1", "대리인-1"]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 🔴 포털 번호가 없는 사람은 **부르지 않고 로그에 남긴다**
 * ═════════════════════════════════════════════════════════════════════════ */

describe("포털 번호가 없을 때", () => {
  it("🔴 아무도 부르지 않고 로그 한 줄을 남긴다", async () => {
    for (const 빈값 of [[], [""], ["", ""]]) {
      const { calls, sent, logs } = await callingPortal(
        () => accepted(),
        () => notifyPortalApprovalCreated(빈값),
      );
      assert.equal(calls.length, 0, `🔴 빈 몸통으로 포털을 불렀다: ${JSON.stringify(빈값)}`);
      assert.equal(sent, false);
      assert.equal(logs.length, 1, `🔴 조용히 넘어갔다 — 그 사람에게는 메일이 영영 안 간다: ${JSON.stringify(빈값)}`);
      assert.match(logs[0], /포털 번호가 없어/);
    }
  });

  it("🔴 섞여 있으면 번호가 있는 사람에게는 보낸다", async () => {
    const { calls, sent } = await callingPortal(
      () => accepted(),
      () => notifyPortalApprovalCreated(["", "대리인-1"]),
    );
    assert.equal(sent, true);
    assert.deepEqual(calls[0].body.getAll("approverSub"), ["대리인-1"]);
  });

  it("🔴 부르는 쪽도 번호가 비면 멈춘다 — 그 자리에 로그가 있다", () => {
    assert.match(ping, /if \(approverSub === null \|\| approverSub === ""\)/);
    assert.match(ping, /console\.warn\([\s\S]{0,120}포털 번호가 없어/);
    // 번호 자체는 어디에도 안 찍는다(이 집의 포털 통로가 전부 그렇다).
    for (const logged of [...ping.matchAll(/console\.(error|warn|log)\(([\s\S]*?)\);/g), ...notifyWrite.matchAll(/console\.(error|warn|log)\(([\s\S]*?)\);/g)]) {
      const args = logged[2];
      assert.equal(/approverSub|credentials|ssoClientSecret|authorization/i.test(args), false, `🔴 로그에 번호·자격증명이 딸려 나간다: ${args.trim().slice(0, 60)}`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 포털이 죽어도 신청은 저장된다 — 던지지 않는다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("포털이 죽어도 결재 저장은 멀쩡하다", () => {
  it("🔴 거절 여덟에 던지지 않는다 — **404 는 통로가 아직 없다는 뜻이고 정상이다**", async () => {
    for (const status of [400, 401, 403, 404, 405, 429, 500, 503]) {
      const { calls, sent } = await callingPortal(
        () => rejectedWith(status),
        () => notifyPortalApprovalCreated(["사람-1"]),
      );
      assert.equal(calls.length, 1, String(status));
      assert.equal(sent, false, `${status} 에서 보냈다고 답했다`);
    }
  });

  it("🔴 타임아웃·연결 거부·이상한 답에도 던지지 않는다", async () => {
    const 타임아웃 = await callingPortal(
      () => {
        // AbortSignal.timeout 이 터질 때의 모양 그대로.
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      },
      () => notifyPortalApprovalCreated(["사람-1"]),
    );
    assert.equal(타임아웃.sent, false);
    assert.match(타임아웃.logs.join("\n"), /TimeoutError/);

    const 연결거부 = await callingPortal(
      () => {
        throw new TypeError("fetch failed");
      },
      () => notifyPortalApprovalCreated(["사람-1"]),
    );
    assert.equal(연결거부.sent, false);

    // 🔵 몸통은 안 읽는다(받을 것이 「받았다」 한 마디뿐이다) — 200 이면 보낸 것이다.
    const 이상한답 = await callingPortal(
      () => new Response("이건 JSON 이 아니다", { status: 200, headers: { "content-type": "text/plain" } }),
      () => notifyPortalApprovalCreated(["사람-1"]),
    );
    assert.equal(이상한답.sent, true);
  });

  it("🔴 설정값이 빠져도 던지지 않는다 — env 의 getter 가 던지는 자리까지 try 안이다", async () => {
    const realEnv = { ...process.env };
    const realError = console.error;
    console.error = () => {};
    delete process.env.SSO_ISSUER;
    delete process.env.SSO_CLIENT_ID;
    delete process.env.SSO_CLIENT_SECRET;
    try {
      assert.equal(await notifyPortalApprovalCreated(["사람-1"]), false);
    } finally {
      process.env = realEnv;
      console.error = realError;
    }
  });

  it("🔴 두 파일 어디에도 throw 가 없다 — 하나라도 새면 저장된 결재가 실패로 보인다", () => {
    assert.equal(/\bthrow\b/.test(notifyWrite), false, "🔴 포털로 나가는 함수가 던진다");
    assert.equal(/\bthrow\b/.test(ping), false, "🔴 알리는 함수가 던진다 — 결재 저장이 실패로 보인다");
    // 부르는 쪽이 받아 주기를 기대하지 않는다 — 제 손으로 삼킨다(바깥 try 가 마지막 울타리).
    assert.match(ping, /export async function pingPortalApprovalCreated\(approverSub: string \| null\): Promise<void> \{\s*try \{/);
    assert.match(ping, /\} catch \(e\) \{[\s\S]*?console\.error\([\s\S]*?\}\s*\}\s*$/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 🔴 **트랜잭션 밖에서** 부른다 — 이 조각의 알맹이
 * ═════════════════════════════════════════════════════════════════════════ */

describe("결재 저장을 막지 않는다 — 트랜잭션 밖", () => {
  const bodies = transactionBodies(partIssue);

  it("🔵 먼저 **무엇을 재는지** 못 박는다 — 토막이 비면 아래가 전부 공짜로 통과한다", () => {
    assert.ok(bodies.length >= 2, `🔴 트랜잭션 토막을 못 찾았다(${bodies.length}개) — 토막 자르기가 깨졌다`);
    const 단계를쓰는토막 = bodies.filter((body) => body.includes("tx.insert(stockIssueApprovalSteps)"));
    assert.equal(단계를쓰는토막.length, 2, `🔴 결재 단계를 쓰는 트랜잭션이 둘이 아니다(${단계를쓰는토막.length}개) — 자리가 늘었으면 알림도 함께 더할 것`);
    for (const body of 단계를쓰는토막) {
      assert.ok(body.length > 500, "🔴 토막이 너무 짧다 — 괄호 짝 세기가 깨졌다");
    }
  });

  it("🔴 트랜잭션 **안**에는 포털을 부르는 줄이 하나도 없다", () => {
    for (const body of bodies) {
      assert.equal(body.includes("pingPortalApprovalCreated"), false, "🔴 트랜잭션 안에서 포털을 부른다 — 포털이 멎으면 결재가 통째로 되돌아간다");
      assert.equal(body.includes("notifyPortalApprovalCreated"), false, "🔴 트랜잭션 안에서 포털을 부른다");
      assert.equal(body.includes("fetch("), false, "🔴 트랜잭션 안에서 망으로 나간다");
    }
  });

  it("🔴 **결재가 생기는 자리 둘 다**에서 부른다 — 올릴 때의 첫 단계 · 승인으로 열리는 다음 단계", () => {
    const 호출 = [...partIssue.matchAll(/pingPortalApprovalCreated\(([^)]*)\)/g)];
    assert.equal(호출.length, 2, `🔴 부르는 자리가 둘이 아니다(${호출.length}곳)`);
    // 올리기: 첫 단계의 결재자. 승인: 방금 열린 다음 단계의 결재자.
    assert.deepEqual(호출.map((m) => m[1]), ["plan.steps[0].approverSub", "nextApproverSub"]);
    // 🔴 인자가 하나뿐이다 — 결재 내용을 함께 넘길 자리가 없다.
    for (const m of 호출) assert.equal(m[1].includes(","), false, `🔴 결재 내용을 함께 넘긴다: ${m[1]}`);
    assert.equal(/pingPortalApprovalCreated\([^)]*tx\b/.test(partIssue), false, "🔴 트랜잭션 손잡이를 넘긴다");
  });

  it("🔴 두 호출이 **트랜잭션이 끝난 뒤** 줄에 있다", () => {
    for (const body of bodies) {
      const at = partIssue.indexOf(body);
      const 끝 = at + body.length;
      for (const m of partIssue.matchAll(/pingPortalApprovalCreated\(/g)) {
        assert.equal(m.index > at && m.index < 끝, false, "🔴 호출이 트랜잭션 토막 안에 있다");
      }
    }
    // 승인 쪽은 트랜잭션 안에서 **번호만 적어 두고** 커밋 뒤에 부른다.
    assert.match(partIssue, /nextApproverSub = next\.approverSub;/);
    assert.ok(
      partIssue.indexOf("let nextApproverSub: string | null = null;") < partIssue.indexOf("nextApproverSub = next.approverSub;"),
      "🔴 번호를 담아 둘 자리가 트랜잭션보다 뒤에 있다",
    );
  });

  it("🔴 올리기는 **커밋이 끝난 뒤** 알린다 — `return await` 가 아니라 받아 두고 부른다", () => {
    assert.match(partIssueText, /let result: RequestPartIssueResult;/);
    assert.match(partIssueText, /if \(result\.ok && plan\.kind === "NEEDS_APPROVAL"\) \{\s*await pingPortalApprovalCreated\(plan\.steps\[0\]\.approverSub\);/);
    assert.match(partIssueText, /if \(result\.ok && nextApproverSub !== null\) \{\s*await pingPortalApprovalCreated\(nextApproverSub\);/);
  });

  it("🔵 자동 승인·반려·거두기·실행에는 알리지 않는다 — 새로 생긴 차례가 없다", () => {
    // AUTO_APPROVED 는 단계 줄이 서지 않고, 반려·거두기는 열린 단계를 **닫는** 일이다.
    assert.equal(/AUTO_APPROVED[\s\S]{0,200}pingPortalApprovalCreated/.test(partIssueText), false, "🔴 자동 승인에도 알린다");
    const 실행쪽 = partIssue.slice(partIssue.indexOf("export async function executePartIssueApproval"));
    assert.ok(실행쪽.length > 0);
    assert.equal(실행쪽.includes("pingPortalApprovalCreated"), false, "🔴 실행·거두기·실행 대기 반려에서도 알린다 — 그때는 새 차례가 없다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ 🔴 누구에게 가는가 — 「내가 결재할 건」 조회를 **뒤집은** 것
 * ═════════════════════════════════════════════════════════════════════════ */

function 위임(over: Partial<ApprovalDelegationPeriod> = {}): ApprovalDelegationPeriod {
  return {
    delegatorSub: "결재자-1",
    delegateSub: "대리인-1",
    startsAt: new Date("2026-10-01T00:00:00Z"),
    endsAt: new Date("2026-11-01T00:00:00Z"),
    revokedAt: null,
    ...over,
  };
}

const 지금 = new Date("2026-10-24T01:00:00Z");

describe("대리인도 함께 알린다 — 판정을 뒤집어 쓴다", () => {
  it("🔴 지금 살아 있는 위임의 대리인이 나온다", () => {
    assert.deepEqual(delegateSubsFor([위임()], "결재자-1", 지금), ["대리인-1"]);
  });

  it("🔴 되돌린 줄·지난 줄·아직 시작 안 한 줄은 빠진다 — 결재 판정과 **같은 잣대**다", () => {
    assert.deepEqual(delegateSubsFor([위임({ revokedAt: new Date("2026-10-20T00:00:00Z") })], "결재자-1", 지금), []);
    assert.deepEqual(delegateSubsFor([위임({ endsAt: new Date("2026-10-20T00:00:00Z") })], "결재자-1", 지금), []);
    assert.deepEqual(delegateSubsFor([위임({ startsAt: new Date("2026-10-30T00:00:00Z") })], "결재자-1", 지금), []);
    // 끝은 포함하지 않는 반열린 구간이다(결재 판정과 같다).
    assert.deepEqual(delegateSubsFor([위임({ endsAt: 지금 })], "결재자-1", 지금), []);
  });

  it("남의 줄이 섞여 있어도 이 사람 것만 고른다 · 겹친 줄은 한 번만", () => {
    const 줄들 = [위임({ delegatorSub: "결재자-9", delegateSub: "대리인-9" }), 위임(), 위임({ startsAt: new Date("2026-10-10T00:00:00Z") }), 위임({ delegateSub: "대리인-2" })];
    assert.deepEqual(delegateSubsFor(줄들, "결재자-1", 지금), ["대리인-1", "대리인-2"]);
  });

  it("🔴 **이어 붙이지 않는다** — A→B 와 B→C 가 있어도 A 의 알림은 C 에게 가지 않는다", () => {
    // 「누를 수 있나」가 한 겹이므로(actingApproverSubs) 알림도 한 겹이어야 한다. 넓으면
    // 「알림은 왔는데 눌러 보니 내 차례가 아니다」가 된다.
    const 줄들 = [위임(), 위임({ delegatorSub: "대리인-1", delegateSub: "대리인-2" })];
    assert.deepEqual(delegateSubsFor(줄들, "결재자-1", 지금), ["대리인-1"]);
  });

  it("🔴 알리는 쪽이 **적힌 결재자 + 대리인**을 그 차례로 넘긴다", () => {
    assert.match(ping, /activeDelegateSubsFor\(approverSub\)/);
    assert.match(ping, /notifyPortalApprovalCreated\(\[approverSub, \.\.\.delegateSubs\]\)/);
    // 🔴 대리인을 못 읽어도 적힌 결재자에게는 알린다(그 조회를 제 try 로 감쌌다).
    assert.match(ping, /try \{\s*delegateSubs = await activeDelegateSubsFor\(approverSub\);\s*\} catch/);
  });

  it("🔴 **자격 판정을 새로 짓지 않는다** — 알리는 쪽에 결재 규칙이 한 줄도 없다", () => {
    for (const 금지 of ["isActiveDelegation", "PENDING_APPROVAL", "REQUESTED", 'status ===', "db()", "drizzle-orm"]) {
      assert.equal(ping.includes(금지), false, `🔴 알리는 쪽이 직접 판정한다: ${금지}`);
    }
  });
});
