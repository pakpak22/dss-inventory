import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
 * ── 🔴 2026-11-17 에 이 통로에 **읽기 갈래**가 생겼다 (조각 9a · 설계 B-14) ───
 * 그래서 ①의 뜻이 **한 칸 좁아졌다.** 옛 단언은 「토큰 없이 부르면 **몸통도 안 읽고** 401」
 * 이었는데, 지금은 어느 쓰임새를 요구할지가 갈래에 달려 있어 **`action` 한 칸을 먼저 엿본다.**
 * 🔵 엿보는 것은 **복제본**이고 표도 토큰도 건드리지 않는다 — 원본 몸통을 읽으면 아래 쓰기
 * 갈래의 `request.json()` 이 빈 몸통을 받아 **모든 쓰기가 조용히 400** 이 된다.
 * 🔴 그래서 ①은 이제 **갈래마다** 「그 갈래의 일은 그 갈래의 토큰 뒤에만」을 잰다. 읽기 갈래
 * 자체(쓰임새·사람 안 싣기·빈 목록으로 안 답하기)는 `tests/portal-delegation-list.test.ts` 다.
 *
 * 여기서 지키는 것:
 *  1. 🔴 자격 검증이 **먼저**다 — 갈래를 가린 뒤, **그 갈래의 일**은 토큰 뒤에만 한다.
 *  2. 🔴 **위임 전파 전용 쓰임새**만 받는다(알림 토큰으로 남의 결재권을 넘길 수 없다).
 *  3. 🔴 **누구에 대한 줄인지는 몸통에서** 온다 — 쿼리 문자열을 읽지 않는다.
 *  4. 모양이 틀리면 **400**(500 이 아니다 — 포털이 영원히 되쏜다).
 *  5. 🔴 **멱등을 표가 보장한다** — `id` 에 기본값이 없고, 쓰기가 `onConflictDoUpdate` 다.
 *  6. 🔴 **판정에 이어져 있다**(조각 8, 2026-11-16 저녁) — 🔴 **조각 6 때는 정반대였다.**
 *     그때는 「아직 안 이었다」를 못 박았고, 그 블록이 「이을 때 함께 고치라」고 적어 두었다.
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
  it("🔴 쓰기 갈래 — 자격 검증이 먼저다. 실패하면 401 로 끝나고 **원본 몸통에 닿지 않는다**", () => {
    /**
     * 🔴 **갈래가 생겨서 자리를 갈라 잰다**(머리말). 쓰기 쪽 차례는 2026-11-16 그대로여야
     *    한다 — 검증 → 거절 → 몸통 → 저장.
     */
    const verifyAt = route.indexOf("PORTAL_TOKEN_PURPOSES.delegationsWrite");
    const rejectAt = route.indexOf("if (!verified.ok) {");
    const readAt = route.indexOf("await request.json()");
    const workAt = route.indexOf("applyPortalDelegation({");
    assert.ok(verifyAt > 0, "쓰기 갈래가 검증하는 자리를 찾지 못했다");
    assert.ok(rejectAt > verifyAt, "검증 결과를 확인하지 않는다");
    assert.ok(readAt > rejectAt, "거절하기 전에 몸통을 읽는다");
    assert.ok(workAt > readAt, "읽기도 전에 저장한다");
    assert.match(route, /status: 401/);
    assert.match(route, /readBearerToken\(request\.headers\.get\("authorization"\)\)/);
  });

  it("🔴 갈래 엿보기는 **복제본**이다 — 원본을 읽으면 모든 쓰기가 조용히 400 이 된다", () => {
    const peekAt = body(route).indexOf("request.clone().text()");
    const branchAt = body(route).indexOf("isDelegationListAction(");
    assert.ok(peekAt > 0, "갈래를 엿보는 자리를 찾지 못했다 — 이 시험이 아무것도 안 재고 있다");
    assert.ok(branchAt > peekAt, "엿보기 전에 갈래를 가른다");
    // 🔴 원본을 읽는 자리는 **쓰기 갈래의 `request.json()` 하나뿐**이어야 한다. 위에서
    //    `request.text()`·`request.json()` 을 한 번이라도 부르면 그 몸통은 이미 비어 있다.
    assert.equal(body(route).split("await request.json()").length - 1, 1, "원본 몸통을 두 번 읽는다");
    assert.ok(!/await request\.text\(\)/.test(body(route)), "원본 몸통을 글자로 읽는다 — 아래 json() 이 빈 몸통을 받는다");
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

  it("🔴 메서드는 POST 하나다 — 읽기도 **POST 의 갈래**이지 새 메서드가 아니다", () => {
    /**
     * 🔴 2026-11-17 에 읽기 갈래가 생겼지만 **GET 을 만들지 않았다**(조각 9a). 읽기를 GET 으로
     *    열면 토큰이 쿼리로 다니기 쉬워지고(접근 로그에 그대로 남는다), 무엇보다 **같은 통로에
     *    서로 다른 자격 검사 두 벌**이 생긴다. 갈래는 몸통의 `action` 한 칸이 가른다.
     */
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

/**
 * ============================================================================
 * 🔴 **아래 두 블록은 2026-11-16 저녁에 뜻이 뒤집혔다** (조각 8, 설계 B-12)
 * ============================================================================
 * 조각 6 은 「받아 적기만 하고 **판정은 한 글자도 안 바뀐다**」를 못 박았다. 그때는 그래야
 * 했다 — 「묻는 쪽」(옛 `src/lib/approval/portal-acting-subs.ts`)이 아직 살아 있어서, 한쪽만
 * 바꾸면 **표가 비어 있는 동안 위임이 통째로 안 듣기** 때문이었다. 그 블록은 스스로
 * 「이을 때 함께 고치라」고 적어 두었고, 이 조각이 그것을 한 것이다.
 *
 * 옛 단언 둘 → 지금 단언 둘:
 *  · 「새 표를 읽어 판정하는 자리가 **아직 없다**」 → 🔴 「**판정이 그 표를 읽는다**」
 *  · 「**「묻는 쪽」이 그대로 살아 있다**」      → 🔴 「**묻는 쪽이 걷혔다**」
 * ============================================================================
 */
describe("🔴 이 통로로 들어온 줄이 **판정에 이어져 있다** (2026-11-16 저녁, 조각 8)", () => {
  it("🔴 새 표를 읽어 「누가 대신 누를 수 있나」를 정하는 자리가 **있다**", () => {
    /**
     * 🔴 안 이어져 있으면 이 통로가 멀쩡히 200 을 돌려주면서도 **아무 일도 일어나지 않는다** —
     * 맡긴 사람은 저쪽에서 성공을 보고, 대리인은 여기서 아무것도 못 누른다. 오류는 안 난다.
     */
    const queries = source("src/lib/approval/delegation-queries.ts");
    assert.ok(queries.includes('from "@/db/schema/portal-approval-delegations"'), "판정하는 층이 이 표를 아예 모른다");
    assert.ok(queries.includes(".from(portalApprovalDelegations)"), "판정하는 층이 이 표를 읽지 않는다 — 받아만 적고 아무도 안 본다");
    // 🔴 **제 표 위임도 그대로 읽는다**(설계 B-4 — 둘 다 산다). 갈아끼우면 이미 맡겨 둔
    //    사람들이 아무 말 없이 자격을 잃는다.
    assert.ok(queries.includes(".from(approvalDelegations)"), "이 시스템의 위임 표를 안 읽는다 — 갈아끼웠다");
  });

  it("🔴 「묻는 쪽」이 걷혔다 — 두 길이 함께 살아 있으면 안 된다", () => {
    /**
     * 🔴 두 길이 함께 살아 있으면 같은 위임이 두 고지에서 두 번 셈해질 자리가 생기고, 무엇보다
     * **포털이 멎었을 때의 처신이 두 벌**이 된다(한쪽은 「위임 없음」, 한쪽은 제 표 그대로).
     * 🔵 더 넓은 그물은 `tests/portal-delegation.test.ts` ④가 던진다 — `src/` 전체를 걷는다.
     */
    assert.equal(existsSync(join(process.cwd(), "src/lib/approval/portal-acting-subs.ts")), false, "포털에 묻던 모듈이 아직 있다");
    assert.equal(existsSync(join(process.cwd(), "src/lib/approval/portal-delegation.ts")), false, "「못 물었다」 그릇이 아직 있다");
    // 🔵 **합치는 자리는 그대로 하나다** — 모양만 번호 목록에서 위임 줄들로 바뀌었다.
    assert.ok(source("src/lib/approval/delegation.ts").includes("portalDelegations: readonly ApprovalDelegationPeriod[]"), "합치는 자리가 사라졌다(또는 모양이 바뀌었다)");
  });

  it("🟢 **받는 쪽은 그대로다** — 걷어내다 조각 6 의 것을 함께 지우지 않았다", () => {
    // 🔴 지웠으면 표에 아무것도 안 쌓이고, 판정이 제 표를 읽어 봤자 영원히 빈 목록이다.
    assert.match(route, /applyPortalDelegation\(\{/);
    assert.match(store, /\.onConflictDoUpdate\(\{/);
    assert.ok(source("src/lib/approval/portal-delegation-sync.ts").includes("export function revokedAtOnConflict("), "한 방향 규칙(B-15)이 사라졌다");
  });
});
