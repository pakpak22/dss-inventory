import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * 결재 내역 통로 — **소스로** 지킨다 (2026-11-17, 조각 10b)
 * ============================================================================
 * 이 라우트는 직접 부를 수 없다(포털의 JWKS 로 서명을 검증하고 DB 를 읽는다). 옆 통로
 * (tests/integration-approvals-route-source.test.ts)가 지키는 방식 그대로 소스를 읽어 못
 * 박는다. 판정 자체는 실제로 돌려 본다 — tests/portal-approval-history.test.ts(갈래 바꿔
 * 적기 · 기간 파싱 · 대상 사람) · tests/approval-history.test.ts(조회와 갈래).
 *
 * 여기서 지키는 것:
 *  1. 토큰 검증이 **먼저** 오고, 실패하면 아무것도 하지 않는다.
 *  2. 🔴 **쿼리에서 읽는 열쇠가 `from`·`to` 둘뿐이다.** 옆 통로들은 쿼리를 아예 안 읽어
 *     「사람을 못 고른다」가 저절로 지켜졌지만, 이 통로는 쿼리를 읽는다 — 그래서 **읽는
 *     열쇠가 한정되는지**가 그 울타리다. 뚫리면 토큰 하나로 아무의 결재 내역이나 열린다.
 *  3. 🔴 기준 주소를 **요청 머리말에서 얻지 않는다**(`request.url` 은 쿼리에만 쓴다).
 *  4. 알림 읽기 용도의 토큰만 받는다.
 *  5. 갈래 판정을 새로 짓지 않는다 — 10a 의 조회를 그대로 넘긴다.
 *  6. 읽기 전용이다.
 *  7. 응답이 캐시되지 않는다.
 *  8. 🔴 기간이 틀리면 **400 `invalid_period`** — 글자도 세 집의 계약이다.
 * ============================================================================
 */

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

const history = source("src/app/api/integration/approval-history/route.ts");

/**
 * 🔴 **주석을 걷어낸 몸통.** 금지어를 재는 자리는 전부 이것으로 본다 — 「왜 안 쓰는가」를 적은
 * 주석이 곧 그 금지어를 품기 때문이다(이 저장소에서 실제로 한 번 깨졌다).
 */
const body = history.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("결재 내역 통로", () => {
  it("🔵 **몸통을 제대로 잘랐다** — 주석만 남은 글자를 재고 있지 않다", () => {
    // 🔵 아래 금지어 시험들이 「파일이 통째로 비어서」 공짜로 통과하지 않게 먼저 세운다.
    assert.ok(body.includes("export async function GET"), "몸통에서 GET 을 못 찾았다");
    assert.ok(body.length > 600, `몸통이 너무 짧다(${body.length}자)`);
  });

  it("🔴 토큰 검증이 먼저다 — 실패하면 401 로 끝나고 기간도 조회도 보지 않는다", () => {
    const verifyAt = body.indexOf("await verifyPortalServiceToken(");
    const rejectAt = body.indexOf("if (!verified.ok) {");
    const periodAt = body.indexOf("parseApprovalHistoryPeriod(");
    const workAt = body.indexOf("buildPortalApprovalHistory({");
    assert.ok(verifyAt > 0, "검증하는 자리를 찾지 못했다");
    assert.ok(rejectAt > verifyAt, "검증 결과를 확인하지 않는다");
    // 🔴 기간이 틀렸다는 것도 자격을 보인 쪽에만 말해 준다 — 거꾸로면 토큰 없이 두드려 보는
    //    쪽이 400/401 로 통로가 살아 있는지를 알아낸다.
    assert.ok(periodAt > rejectAt, "자격을 보기 전에 기간부터 본다");
    assert.ok(workAt > periodAt, "기간을 거절하기 전에 결재 내역을 뽑는다");
    assert.match(body, /status: 401/);
    assert.match(body, /readBearerToken\(request\.headers\.get\("authorization"\)\)/);
  });

  it("🔴 **쿼리에서 읽는 열쇠가 `from`·`to` 둘뿐이다** — 사람을 고를 자리가 없다", () => {
    // 이게 이 통로에서 가장 중요한 울타리다. 뚫리면 토큰 하나로 아무의 결재 내역이나 열린다.
    /**
     * 🔴 **쿼리든 머리말이든 「부르는 쪽이 넣은 값」을 꺼내는 자리를 모조리 센다.** 쿼리만
     * 세면 Host 머리말을 읽는 길이 안 걸리고, 변수 이름(`query`)으로 좁히면 이름을 바꾸는
     * 날 시험이 조용히 아무것도 안 센다.
     */
    const keys = [...body.matchAll(/\.get\("([^"]+)"\)/g)].map((m) => m[1]).sort();
    // 🔵 표본이 비어서 공짜로 통과하지 않게 — 실제로 셋을 읽고 있는지부터 본다.
    assert.equal(keys.length, 3, `부르는 쪽에서 꺼내는 값이 셋이 아니다: ${JSON.stringify(keys)}`);
    assert.deepEqual(keys, ["authorization", "from", "to"]);
    for (const forbidden of ['get("sub")', 'get("user")', 'get("viewer")', 'get("subject")', 'get("approver")', "request.json"]) {
      assert.ok(!body.includes(forbidden), `부르는 쪽이 대상을 고를 자리가 있다: ${forbidden}`);
    }
    assert.match(body, /subject: verified\.subject/);
  });

  it("🔴 기준 주소는 환경에서 온다 — `request.url` 은 **쿼리에만** 쓴다", () => {
    assert.match(body, /baseUrl: env\.ownBaseUrl/);
    // 🔴 next dev 의 `request.url` 은 들어온 Host 와 상관없이 localhost 다 — 거기서 주소를
    //    읽으면 조용히 엉뚱한 링크가 나간다.
    assert.equal((body.match(/request\.url/g) ?? []).length, 1, "`request.url` 을 쿼리 말고 다른 데서도 쓴다");
    assert.match(body, /new URL\(request\.url\)\.searchParams/);
    for (const forbidden of ['headers.get("host")', '"x-forwarded-host"', "nextUrl"]) {
      assert.ok(!body.includes(forbidden), `부르는 쪽이 정하는 주소를 쓴다: ${forbidden}`);
    }
  });

  it("🔴 기간을 중간에서 **보정하지 않는다** — 경계를 빼는 일은 조회의 `lt` 하나가 한다", () => {
    assert.match(body, /period: parsed\.period/);
    for (const forbidden of ["setHours", "setDate", "setMilliseconds", "86400000", "getTime()"]) {
      assert.ok(!body.includes(forbidden), `통로가 기간을 손본다: ${forbidden}`);
    }
  });

  it("🔴 기간이 틀리면 400 `invalid_period` — 글자도 세 집의 계약이다", () => {
    assert.match(body, /\{ error: "invalid_period" \}, \{ status: 400/);
    // 🔵 계약의 몸통은 칸 하나다. 까닭을 덧붙이면 세 집의 답이 달라진다.
    assert.ok(!/invalid_period"[^}]*error_description/.test(body), "계약에 없는 칸을 덧붙인다");
    // 🔴 500 으로 답하면 포털이 「다시 보낼 만하다」고 읽고 영원히 되쏜다.
    assert.ok(!body.includes("status: 500"), "몸통이 틀린 것을 500 으로 답한다");
  });

  it("알림 읽기 용도의 토큰만 받는다", () => {
    assert.match(body, /PORTAL_TOKEN_PURPOSES\.notificationsRead/);
    for (const forbidden of ["notificationSettingsRead", "notificationSettingsWrite", "delegationsWrite"]) {
      assert.ok(!body.includes(forbidden), `다른 용도의 토큰을 받는다: ${forbidden}`);
    }
  });

  it("🔴 갈래 판정을 새로 쓰지 않는다 — 10a 의 조회를 그대로 넘긴다", () => {
    // 감싸지 않고 **함수 자체를** 넘기는 것이 「여기서는 다르게 센다」를 만들 자리가 없다는 뜻이다.
    assert.match(body, /listHistory: listPartIssueApprovalHistoryFor,/);
    assert.match(body, /findActor: findActiveUserByAuthSub,/);
    // 라우트가 스스로 SQL 을 쓰거나 갈래를 가르면 판정이 두 벌이 된다.
    for (const forbidden of ["db.select", "drizzle-orm", "partIssueHistoryRole", "UNRECORDED", '=== "ADMIN"', "role ==="]) {
      assert.ok(!body.includes(forbidden), `라우트가 직접 판정한다: ${forbidden}`);
    }
  });

  it("🔴 포털이 부른 통로가 포털에 **되묻지 않는다**", () => {
    // 되물으면 포털이 우리를 기다리는 동안 우리가 포털을 기다린다(옆 통로의 같은 울타리).
    for (const forbidden of ["resolvePortalDelegations", "portal-acting-subs", "fetch(", "NO_PORTAL_DELEGATIONS"]) {
      assert.ok(!body.includes(forbidden), `포털에 되묻는다: ${forbidden}`);
    }
  });

  it("🔴 읽기 전용이다 — 무엇을 쓰는 길이 없다", () => {
    for (const method of ["export async function POST", "export async function PUT", "export async function PATCH", "export async function DELETE"]) {
      assert.ok(!history.includes(method), `쓰는 메서드가 생겼다: ${method}`);
    }
    assert.match(body, /export async function GET/);
  });

  it("응답이 캐시되지 않는다 — 남의 승인함에 남의 내역이 남지 않게", () => {
    assert.match(body, /"cache-control": "no-store"/);
    // 세 갈래(401 · 400 · 200)와 503 이 전부 같은 머리말을 단다.
    assert.equal((body.match(/NO_STORE/g) ?? []).length, 5, "답 가운데 캐시 금지를 안 다는 길이 있다");
  });

  it("🔴 상한을 라우트가 숫자로 적지 않는다 — 한 자리(lib 의 상수)를 쓴다", () => {
    assert.match(body, /limit: PORTAL_APPROVAL_HISTORY_LIMIT/);
  });
});
