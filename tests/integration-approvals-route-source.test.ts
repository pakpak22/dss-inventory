import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * 통합 승인함 통로 — **소스로** 지킨다
 * ============================================================================
 * 이 라우트는 직접 부를 수 없다(포털의 JWKS 로 서명을 검증하고 DB 를 읽는다).
 * A/S(RF_Service_System)·휴가(dss-leave)가 같은 통로를 지키는 방식대로 소스를
 * 읽어 못 박는다. 판정 자체는 실제로 돌려 본다 —
 * src/lib/auth/portal-service-token.test.ts(토큰 — 있으면) ·
 * tests/portal-approvals.test.ts(대상 사람 · 목록).
 *
 * 여기서 지키는 것:
 *  1. 토큰 검증이 **먼저** 오고, 실패하면 아무것도 하지 않는다.
 *  2. 🔴 대상 사용자를 **쿼리 문자열에서 읽지 않는다** — 가장 중요한 울타리다.
 *  3. 🔴 기준 주소를 **요청 머리말에서 얻지 않는다.**
 *  4. 알림 읽기 용도의 토큰만 받는다(다른 용도가 섞이지 않는다).
 *  5. 자격 판정을 새로 짓지 않는다 — 기존 조회를 그대로 넘긴다.
 *  6. 읽기 전용이다 — 승인·반려를 실행하는 메서드가 없다.
 *  7. 응답이 캐시되지 않는다.
 * ============================================================================
 */

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

const approvals = source("src/app/api/integration/approvals/route.ts");

describe("통합 승인함 통로", () => {
  it("🔴 토큰 검증이 먼저다 — 실패하면 401 로 끝나고 조회에 닿지 않는다", () => {
    const verifyAt = approvals.indexOf("await verifyPortalServiceToken(");
    const rejectAt = approvals.indexOf("if (!verified.ok) {");
    const workAt = approvals.indexOf("buildPortalApprovalInbox({");
    assert.ok(verifyAt > 0, "검증하는 자리를 찾지 못했다");
    assert.ok(rejectAt > verifyAt, "검증 결과를 확인하지 않는다");
    assert.ok(workAt > rejectAt, "거절하기 전에 결재 목록을 뽑는다");
    assert.match(approvals, /status: 401/);
    assert.match(approvals, /readBearerToken\(request\.headers\.get\("authorization"\)\)/);
  });

  it("🔴 대상 사용자는 토큰에서만 온다 — ?sub= 를 붙여도 읽을 자리가 없다", () => {
    // 이게 가장 중요한 울타리다. 뚫리면 토큰 하나로 아무의 결재함이나 열린다.
    for (const forbidden of ["searchParams", "nextUrl", "?sub=", 'get("sub")', "params.sub", "request.url", "request.json"]) {
      assert.ok(!approvals.includes(forbidden), `부르는 쪽이 대상을 고를 자리가 있다: ${forbidden}`);
    }
    assert.match(approvals, /subject: verified\.subject/);
  });

  it("🔴 기준 주소는 환경에서 온다 — Host 머리말을 읽지 않는다", () => {
    assert.match(approvals, /baseUrl: env\.ownBaseUrl/);
    for (const forbidden of ['headers.get("host")', '"x-forwarded-host"', "request.url"]) {
      assert.ok(!approvals.includes(forbidden), `부르는 쪽이 정하는 주소를 쓴다: ${forbidden}`);
    }
  });

  it("알림 읽기 용도의 토큰만 받는다", () => {
    assert.match(approvals, /PORTAL_TOKEN_PURPOSES\.notificationsRead/);
    for (const forbidden of ["notificationSettingsRead", "notificationSettingsWrite"]) {
      assert.ok(!approvals.includes(forbidden), `설정용 토큰을 받는다: ${forbidden}`);
    }
  });

  it("🔴 자격 판정을 새로 쓰지 않는다 — 기존 조회를 그대로 넘긴다", () => {
    assert.match(approvals, /listPendingApprovals: \(subject\) => listPartIssueApprovalsToDecide\(subject, NO_PORTAL_DELEGATIONS\.delegatorSubs\)/);
    assert.match(approvals, /findActor: findActiveUserByAuthSub/);
    // 라우트가 스스로 SQL 을 쓰거나 역할을 비교하면 판정이 두 벌이 된다.
    for (const forbidden of ["db.select", "drizzle-orm", '=== "ADMIN"', '=== "SUPER_ADMIN"', "role ==="]) {
      assert.ok(!approvals.includes(forbidden), `라우트가 직접 판정한다: ${forbidden}`);
    }
  });

  /**
   * 🔴 **포털이 우리를 부르는 통로에서는 포털에 되묻지 않는다** (2026-11-16, 결재권 위임).
   * 되물으면 **포털이 우리를 기다리는 동안 우리가 포털을 기다린다** — 포털의 상한이 1.5초인데
   * 우리 상한이 2초라(approval/portal-acting-subs.ts) 답이 닿기 전에 포털이 이 줄을 버린다.
   * 🔵 대가(통합 승인함에서만 대리 건이 빠진다)는 라우트 주석에 적혀 있다.
   */
  it("🔴 포털에 **되묻지 않는다** — 서로 기다리는 짝이 된다", () => {
    // 🔴 **주석을 걷어내고 본다.** 「여기서는 되묻지 않는다(까닭은 portal-acting-subs.ts)」는
    //    설명이 곧 금지어를 품는다 — 안 걷어내면 설명 때문에 깨진다(2026-11-16 실측).
    const body = approvals.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["resolvePortalDelegations", "portal-acting-subs", "fetch("]) {
      assert.ok(!body.includes(forbidden), `포털이 부른 통로가 포털에 되묻는다: ${forbidden}`);
    }
    // 🔵 「안 물었다」를 **글자로** 적는다 — 빈 배열을 그냥 넘기면 「물었는데 없었다」와 같아
    //    보여 다음 사람이 결함으로 보고 「묻게」 고친다.
    assert.match(approvals, /NO_PORTAL_DELEGATIONS/);
  });

  it("🔴 읽기 전용이다 — 승인·반려를 실행하는 길이 없다", () => {
    for (const method of ["export async function POST", "export async function PUT", "export async function PATCH", "export async function DELETE"]) {
      assert.ok(!approvals.includes(method), `쓰는 메서드가 생겼다: ${method}`);
    }
    assert.match(approvals, /export async function GET/);
  });

  it("응답이 캐시되지 않는다", () => {
    assert.match(approvals, /"cache-control": "no-store"/);
  });
});
