import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * 승인함 위임을 **받아 적는 통로** — 소스로 지킨다 (2026-11-16, 조각 6)
 * ============================================================================
 * 이 라우트는 직접 부를 수 없다(포털의 JWKS 로 서명을 검증하고 DB 에 쓴다). 옆의 승인함 통로
 * (`tests/integration-approvals-route-source.test.ts`)와 같은 방식으로 소스를 읽어 못 박는다.
 * 판단 자체는 실제로 돌려 본다 — `tests/portal-delegation-sync.test.ts`(멱등·`not_applicable`·
 * 거절), `tests/portal-service-token.test.ts`(토큰).
 *
 * 여기서 지키는 것:
 *  1. 🔴 자격 검증이 **먼저**다 — 토큰 없이 부르면 몸통도 안 읽고 401.
 *  2. 🔴 **위임 전파 전용 쓰임새**만 받는다(알림 토큰으로 남의 결재권을 넘길 수 없다).
 *  3. 🔴 **누구에 대한 줄인지는 몸통에서** 온다 — 쿼리 문자열을 읽지 않는다.
 *  4. 모양이 틀리면 **400**(500 이 아니다 — 포털이 영원히 되쏜다).
 *  5. 🔴 **멱등을 표가 보장한다** — `id` 에 기본값이 없고, 쓰기가 `onConflictDoUpdate` 다.
 *  6. 🔴 **판정에 이어 붙이지 않았다**(조각 8) — 이 조각에서 결재 동작이 바뀌면 안 된다.
 *  7. 응답이 캐시되지 않는다.
 * ============================================================================
 */

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

/** 🔴 **주석을 걷어내고 본다** — 「…하지 않는다」는 설명이 곧 금지어를 품는다(옆 통로 시험의 실측). */
function body(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const route = source("src/app/api/integration/delegations/route.ts");
const store = source("src/lib/approval/portal-delegation-store.ts");
const schema = source("src/db/schema/portal-approval-delegations.ts");

describe("승인함 위임 받는 통로 — 소스", () => {
  it("🔴 자격 검증이 먼저다 — 실패하면 401 로 끝나고 몸통에 닿지 않는다", () => {
    const verifyAt = route.indexOf("await verifyPortalServiceToken(");
    const rejectAt = route.indexOf("if (!verified.ok) {");
    const readAt = route.indexOf("await request.json()");
    const workAt = route.indexOf("applyPortalDelegation({");
    assert.ok(verifyAt > 0, "검증하는 자리를 찾지 못했다");
    assert.ok(rejectAt > verifyAt, "검증 결과를 확인하지 않는다");
    assert.ok(readAt > rejectAt, "거절하기 전에 몸통을 읽는다");
    assert.ok(workAt > readAt, "읽기도 전에 저장한다");
    assert.match(route, /status: 401/);
    assert.match(route, /readBearerToken\(request\.headers\.get\("authorization"\)\)/);
  });

  it("🔴 위임 전파 전용 쓰임새만 받는다 — 종을 읽는 토큰으로 결재권을 넘길 수 없다", () => {
    assert.match(route, /PORTAL_TOKEN_PURPOSES\.delegationsWrite/);
    for (const forbidden of ["notificationsRead", "notificationSettingsRead", "notificationSettingsWrite"]) {
      assert.ok(!body(route).includes(forbidden), `다른 통로의 토큰을 받는다: ${forbidden}`);
    }
  });

  it("🔴 대상은 몸통에서만 온다 — ?sub= 를 붙여도 읽을 자리가 없다", () => {
    for (const forbidden of ["searchParams", "nextUrl", 'get("sub")', "params.sub", "request.url"]) {
      assert.ok(!body(route).includes(forbidden), `부르는 쪽이 주소로 대상을 고를 자리가 있다: ${forbidden}`);
    }
    /**
     * 🔵 **토큰의 `sub` 를 쓰지 않는다**(알림 통로와 다른 점). 여기서는 「누구에 대한 줄인가」가
     *    몸통에 있고, 토큰은 「포털이 맞나」만 말한다. 토큰 주인으로 줄을 쓰기 시작하면 포털이
     *    누구 이름으로 부르느냐에 따라 **엉뚱한 사람의 결재권**이 넘어간다.
     */
    assert.ok(!body(route).includes("verified.subject"), "토큰 주인을 줄에 쓰고 있다");
  });

  it("🔴 모양이 틀리면 400 이다 — 500 으로 답하면 포털이 영원히 되쏜다", () => {
    assert.match(route, /status: 400/);
    assert.match(route, /parsePortalDelegationCommand\(payload\)/);
    assert.match(route, /if \(!parsed\.ok\) return badRequest\(parsed\.message\)/);
    // 🔴 오류 몸통의 모양은 세 시스템 공통 규약이다.
    assert.match(route, /error_description/);
  });

  it("🔴 성공은 `outcome` 한 칸이다 — `not_applicable` 도 200 이다", () => {
    assert.match(route, /Response\.json\(\{ outcome \}, \{ headers: NO_STORE \}\)/);
    // 「해당 없음」을 4xx 로 답하면 포털이 전파 실패로 보고 **지정 자체를 거절한다**(설계 B-13).
    assert.ok(!/not_applicable[\s\S]{0,200}status: 4/.test(body(route)), "`not_applicable` 을 오류로 답한다");
  });

  it("🔴 라우트가 직접 판정하거나 SQL 을 쓰지 않는다 — 판단은 sync, 쓰기는 store", () => {
    for (const forbidden of ["drizzle-orm", "db()", "@/db/schema", '=== "ADMIN"', "role ==="]) {
      assert.ok(!body(route).includes(forbidden), `라우트가 직접 한다: ${forbidden}`);
    }
    assert.match(route, /findActor: findPortalDelegationPerson/);
    assert.match(route, /store: portalDelegationStore/);
  });

  it("읽는 메서드가 없다 — 이 통로는 받아 적기만 한다", () => {
    for (const method of ["export async function GET", "export async function PUT", "export async function PATCH", "export async function DELETE"]) {
      assert.ok(!route.includes(method), `다른 메서드가 생겼다: ${method}`);
    }
    assert.match(route, /export async function POST/);
  });

  it("응답이 캐시되지 않는다", () => {
    assert.match(route, /"cache-control": "no-store"/);
  });
});

describe("🔴 멱등을 무엇이 보장하는가 — 표와 쓰기", () => {
  it("🔴 `id` 에 기본값이 없다 — 번호의 주인이 포털이다", () => {
    // 붙이는 순간 몸통에 id 가 빠져 온 날 **우리만 아는 번호**가 생기고, 그 줄은 포털이
    // 철회해도 영영 안 거둬진다.
    assert.ok(!body(schema).includes("defaultRandom()"), "id 에 defaultRandom() 이 붙었다");
    assert.match(schema, /id: uuid\("id"\)\.primaryKey\(\)/);
  });

  it("🔴 쓰기가 덮어쓰기다 — 같은 번호로 두 번 와도 한 줄", () => {
    assert.match(store, /\.onConflictDoUpdate\(\{/);
    assert.match(store, /target: portalApprovalDelegations\.id/);
  });

  it("🔴 거둔 시각은 **포털이 보낸 값**을 적는다 — 받은 시각으로 갈아 적으면 멱등이 깨진다", () => {
    assert.match(store, /\.set\(\{ revokedAt, syncedAt: new Date\(\) \}\)/);
  });

  /**
   * 🔴 아래 둘은 **한 방향 규칙이 실제로 쓰이는지**를 본다. 규칙 자체가 맞는지는
   * `tests/portal-delegation-sync.test.ts` 가 `revokedAtOnConflict` 를 돌려서 재고, 여기서는
   * 「그 함수를 쓰는가」만 본다 — 둘이 함께 있어야 「규칙은 맞는데 아무도 안 쓴다」가 없다.
   * 🔵 자르는 자리를 주석 걷어낸 본문에서 찾는다(이 파일 머리말의 `body`).
   */
  const storeBody = body(store);
  const conflictAt = storeBody.indexOf(".onConflictDoUpdate(");
  const valuesAt = storeBody.indexOf(".values({");

  it("🔴 덮어쓸 때 `revoked_at` 을 **널로 지우지 않는다** — 거둔 위임이 되살아나는 길이다", () => {
    assert.ok(conflictAt > 0, "덮어쓰는 자리를 찾지 못했다 — 이 시험이 아무것도 안 재고 있다");
    const conflict = storeBody.slice(conflictAt);
    assert.ok(
      conflict.includes("...revokedAtOnConflict(command.revokedAt)"),
      "덮어쓰는 자리가 한 방향 규칙을 안 쓴다",
    );
    // 늦게 닿은 upsert 가 철회를 되살리면 **아무 오류 없이** 남의 결재를 누를 수 있게 된다.
    assert.ok(
      !/revokedAt: command\.revokedAt/.test(conflict),
      "덮어쓰는 자리가 널까지 그대로 적는다 — 엇갈려 닿은 전파가 철회를 되살린다",
    );
  });

  it("🔵 **넣는 자리는 그대로다** — 처음 받는 줄은 거둔 채로 와도 그대로 적는다", () => {
    assert.ok(valuesAt > 0 && valuesAt < conflictAt, "넣는 자리를 찾지 못했다");
    const values = storeBody.slice(valuesAt, conflictAt);
    // 여기까지 조건부로 만들면 거꾸로 「포털은 거뒀는데 여기선 살아 있는」 줄이 생긴다.
    assert.match(values, /revokedAt: command\.revokedAt/);
  });

  it("🔵 없는 줄을 거두는 것은 오류가 아니다 — 0행이면 false", () => {
    assert.match(store, /if \(!row\) return false;/);
  });
});

describe("🔴 이 조각은 판정을 건드리지 않았다 (조각 8 의 일)", () => {
  it("새 표를 읽어 「누가 대신 누를 수 있나」를 정하는 자리가 아직 없다", () => {
    /**
     * 🔴 이 조각이 끝나도 결재 동작은 한 군데도 안 바뀌어야 한다. 바꾸려면 「묻는 쪽」
     * (`portal-acting-subs.ts`)을 함께 걷어내야 하고, 그것이 다음 조각이다 — 지금 한쪽만
     * 바꾸면 **표가 비어 있는 동안 포털 위임이 통째로 안 듣는다.**
     */
    const users = [
      "src/lib/approval/delegation.ts",
      "src/lib/approval/delegation-queries.ts",
      "src/lib/approval/part-issue.ts",
      "src/lib/approval/portal-acting-subs.ts",
    ];
    for (const path of users) {
      assert.ok(
        !source(path).includes("portalApprovalDelegations"),
        `${path} 가 벌써 새 표를 읽는다 — 판정 연결은 조각 8 이다`,
      );
    }
  });

  it("🔵 「묻는 쪽」이 그대로 살아 있다 — 지금 걷으면 기능이 끊긴다", () => {
    const asking = source("src/lib/approval/portal-acting-subs.ts");
    assert.match(asking, /fetch\(/);
    assert.ok(source("src/lib/approval/delegation.ts").includes("portalDelegatorSubs"), "합치는 자리가 사라졌다");
  });
});
