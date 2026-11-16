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
    // 🟢 2026-11-16 저녁(설계 B-12): 감싸지 않고 **함수 자체를** 넘긴다. 낮까지는 「포털에 안
    //    물었다」를 인자로 적어 주느라 화살표로 한 겹 감싸야 했고, 그 겹이 곧 **여기서만 다르게
    //    세는 자리**였다 — 그래서 통합 승인함에서만 대리 건이 빠졌다(설계 D-8 ②).
    assert.match(approvals, /listPendingApprovals: listPartIssueApprovalsToDecide,/);
    assert.match(approvals, /findActor: findActiveUserByAuthSub/);
    // 라우트가 스스로 SQL 을 쓰거나 역할을 비교하면 판정이 두 벌이 된다.
    for (const forbidden of ["db.select", "drizzle-orm", '=== "ADMIN"', '=== "SUPER_ADMIN"', "role ==="]) {
      assert.ok(!approvals.includes(forbidden), `라우트가 직접 판정한다: ${forbidden}`);
    }
  });

  /**
   * 🔴 **뒤집힌 단언이다** (2026-11-16 저녁, 설계 B-12).
   *
   * 옛 뜻: 「**이 통로에서는** 포털에 되묻지 않는다 — 되물으면 포털이 우리를 기다리는 동안
   * 우리가 포털을 기다린다. 그래서 「안 물었다」를 `NO_PORTAL_DELEGATIONS` 로 적어 둔다」.
   * 🔴 그 대가가 **통합 승인함에서만 대리 결재할 건이 빠지는 것**이었다(설계 D-8 ②).
   *
   * 지금 뜻: 🔴 **묻는 길 자체가 저장소에서 사라졌다.** 조회가 제 표를 읽으므로 이 통로에도
   * 승인함 위임으로 대신할 건이 **뜬다** — 아래는 그것이 되돌아가지 않게 지키는 자리다.
   * 🔵 이 통로 하나만 보면 **공짜로 통과한다**(아무도 안 묻는다). 그래서 여기서는 「이 통로가
   * 쓰는 조회가 다시 인자를 받게 됐나」까지 함께 본다 — 그 인자가 곧 갈리는 자리였다.
   */
  it("🔴 포털에 **되묻지 않는다** — 그리고 「안 묻는 자리」를 따로 두지도 않는다", () => {
    // 🔴 **주석을 걷어내고 본다.** 「걷어냈다」는 내력 설명이 곧 금지어를 품는다 — 안 걷어내면
    //    설명 때문에 깨진다(2026-11-16 실측).
    const body = approvals.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["resolvePortalDelegations", "portal-acting-subs", "fetch(", "NO_PORTAL_DELEGATIONS"]) {
      assert.ok(!body.includes(forbidden), `포털이 부른 통로가 포털에 되묻는다(또는 「안 묻는 자리」가 되살아났다): ${forbidden}`);
    }
    // 🔴 조회가 **위임 목록을 인자로 받지 않는다** — 받는 순간 이 통로만 다르게 셀 수 있다.
    assert.match(source("src/lib/approval/part-issue.ts"), /export async function listPartIssueApprovalsToDecide\(approverSub: string\): Promise<PartIssueView\[\]>/);
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
