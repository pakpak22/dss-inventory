import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DELEGATION_AUDIT_LIMIT,
  DELEGATION_LIST_ACTION,
  buildDelegationListReply,
  isDelegationListAction,
  readDelegationAction,
  type DelegationAuditRow,
} from "../src/lib/approval/portal-delegation-list";
import { parsePortalDelegationCommand } from "../src/lib/approval/portal-delegation-sync";
import { PORTAL_TOKEN_PURPOSES } from "../src/lib/auth/portal-service-token";

/**
 * ============================================================================
 * 포털의 **어긋남 점검**이 읽어 가는 갈래 (2026-11-17, 조각 9a · 설계 B-14)
 * ============================================================================
 * 포털이 지정·철회하면 세 집에 전파하고 셋이 다 성공했을 때만 포털에 적는다(B-13). 🔴 그래도
 * **「전파는 됐는데 포털 저장만 실패하는」 틈**은 남고, 맞대어 보지 않으면 그 어긋남은 영영
 * 조용하다. 통로가 POST 쓰기 전용이라 물을 길이 아예 없던 것을 `action=list` 로 연다.
 *
 * 여기서 지키는 것:
 *  1. 🔴 **답에 사람이 없다.** 칸은 `id`·`startsAt`·`endsAt`·`revokedAt` 넷뿐이고, 조회도
 *     사람 칸을 **애초에 안 고른다.**
 *  2. 🔴 **모든 줄을 준다** — 살아 있는 것·끝난 것·**철회된 것**까지. 화면용 조회는 사람으로
 *     좁히거나 거둔 줄을 빼므로 쓸 수 없다. 거르개가 하나라도 끼면 「포털은 거뒀는데 집에서는
 *     살아 있는」 줄이 **양쪽에서 똑같이 안 보인다** — B-13 이 더 위험하다고 못 박은 쪽이다.
 *  3. 🔴 넘치면 **`truncated: true` 로 말한다.** 조용히 자르면 점검이 잘린 줄을 「집에 없다」로
 *     읽고, 그 모양이 **찾으려는 어긋남과 글자 그대로 같다.**
 *  4. 🔴 **쓰기 토큰으로 읽을 수 없고, 읽기 토큰으로 쓸 수 없다**(⑤·⑥).
 *  5. 🔴 **쓰기 갈래가 한 글자도 안 바뀌었다** — 2026-11-16 에 세 집이 맞춘 자리다.
 *
 * ── 🔵 왜 통로를 **실제로 불러 보지 않는가** ────────────────────────────────
 * 이 집의 라우트는 `server-only` 를 문 모듈 둘(`portal-delegation-store`·`delegation-queries`)을
 * 끌어와서 시험에서 **불러올 수 없다**(`tests/portal-delegation.test.ts` 와 같은 사정). 그래서
 * 뜻은 순수 모듈로 진짜 돌려 보고(②③), 배선은 **소스 글자**로 잰다(④⑤) — 이 집이 옆 통로들에
 * 쓰는 그 방식이다. 🔵 토큰 울타리 자체는 `tests/portal-service-token.test.ts` 가 **서명해서**
 * 양쪽 방향으로 재고, 여기 ⑤는 「통로가 그 갈래에 어느 글자를 대는가」만 본다.
 *
 * 🔴 **값은 전부 가짜다** — 실제 사람 번호를 한 자도 적지 않는다(공개 저장소로 나갈 수 있다).
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석을 떼어 낸 코드만. 🔴 이 집은 「왜 그렇게 했는가」를 길게 적어서 **설명이 곧 금지어를
 * 품는다** — 걷어내지 않으면 금지 쪽은 설명 때문에 깨지고, 더 나쁘게는 **있어야 할 것**을 재는
 * 쪽이 주석만으로 영영 통과한다.
 */
const code = (relative: string): string =>
  src(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/* 🔴 전부 가짜 번호다. */
const DELEGATION_ID = "cccc3333-3333-4333-8333-333333333333";
const FAKE_DELEGATOR = "11111111-2222-4333-8444-555555555555";
const FAKE_DELEGATE = "66666666-7777-4888-8999-aaaaaaaaaaaa";

/** 표에서 읽은 줄 한 개. 기본은 **살아 있는** 줄이다. */
function auditRow(over: Partial<DelegationAuditRow> = {}): DelegationAuditRow {
  return {
    id: DELEGATION_ID,
    startsAt: new Date("2027-03-01T00:00:00.000Z"),
    endsAt: new Date("2027-03-08T00:00:00.000Z"),
    revokedAt: null,
    ...over,
  };
}

describe("① 🔴 계약 글자 — 세 집이 같아야 한다", () => {
  it("값으로 못 박는다 — 한 집만 다른 글자를 쓰면 그 집만 조용히 401 이다", () => {
    /**
     * 🔴 A/S·휴가 저장소는 여기서 읽을 수 없다. 그래서 **값**을 적어 둔다 — 한 집이 글자를
     *    바꾸면 그 집만 401 이 되고, 점검은 그것을 「못 쟀다」로 읽어 **어긋남과 섞인다.**
     * 🟢 휴가가 2026-11-17 에 같은 글자로 열었다(커밋 `09fe333`).
     */
    assert.equal(DELEGATION_LIST_ACTION, "list");
    assert.equal(PORTAL_TOKEN_PURPOSES.delegationsRead, "dss.delegations.read");
    // 🔵 쓰기 쪽이 그대로인 것도 함께 잰다 — 둘이 같은 글자가 되면 울타리가 없어진다.
    assert.equal(PORTAL_TOKEN_PURPOSES.delegationsWrite, "dss.delegations.write");
    assert.notEqual(PORTAL_TOKEN_PURPOSES.delegationsRead, PORTAL_TOKEN_PURPOSES.delegationsWrite);
  });

  it("상한은 2000 이다 — 🔵 이름만 이 집에서 다르고 값은 셋이 같다", () => {
    // 🔵 `delegation-queries.ts` 에 같은 이름의 **화면용 상한 50** 이 이미 살아서 이름을 갈랐다.
    //    계약은 값이지 이름이 아니다(그 상수 주석).
    assert.equal(DELEGATION_AUDIT_LIMIT, 2000);
  });
});

describe("② 갈래 가리기 — 몸통에서 `action` 한 칸만 엿본다", () => {
  it("JSON 몸통에서 읽기 갈래를 가린다", () => {
    const action = readDelegationAction('{"action":"list"}', "application/json");
    assert.equal(action, "list");
    assert.ok(isDelegationListAction(action));
  });

  it("🔵 폼 인코딩 몸통도 **같은 답**이다 — 규약이 안 정한 빈칸을 집마다 다르게 메우지 않는다", () => {
    /**
     * 계약은 JSON 이지만 휴가가 먼저 만들 때 지시서가 폼 인코딩이어서 **양쪽을 다 받게**
     * 구현했고 그 집이 지금 그렇게 돈다. 🔴 여기서 한쪽만 받으면 **포털이 어느 모양으로
     * 부르느냐에 따라 집 하나만 400** 이 되는데, 그 400 은 점검에서 「못 쟀다」로 보여
     * 어긋남과 섞인다.
     */
    assert.equal(readDelegationAction("action=list", "application/x-www-form-urlencoded"), "list");
    // 🔵 `charset` 이 붙어 와도 같은 말이다.
    assert.equal(readDelegationAction("action=list", "application/x-www-form-urlencoded; charset=utf-8"), "list");
    // 🔵 다른 칸이 함께 와도 `action` 만 본다.
    assert.equal(readDelegationAction("sub=x&action=list", "application/x-www-form-urlencoded"), "list");
  });

  it("🔴 쓰기 갈래의 말은 읽기로 가지 않는다 — `list` 는 쓰기 말 목록에도 없다", () => {
    for (const action of ["upsert", "revoke"]) {
      const 읽은값 = readDelegationAction(JSON.stringify({ action }), "application/json");
      assert.equal(읽은값, action);
      assert.ok(!isDelegationListAction(읽은값), `${action} 이 읽기 갈래로 샜다`);
    }
    /**
     * 🔴 **`list` 를 쓰기 쪽 모양 검사에 더하지 않았다.** 더하면 쓰기 토큰으로 읽기 갈래에
     *    발을 들일 수 있고, 모양 검사가 「id 가 uuid 가 아닙니다」라는 엉뚱한 말을 돌려준다.
     */
    const 거절 = parsePortalDelegationCommand({ action: "list" });
    assert.equal(거절.ok, false);
    assert.match(거절.ok ? "" : 거절.message, /upsert.*revoke/);
  });

  it("읽을 수 없는 몸통은 null 이다 — 🔵 거절은 **쓰기 갈래의 일**이다", () => {
    // 🔵 여기서 400 을 내면 **토큰을 보기 전에** 모양으로 답을 가르게 된다.
    for (const 몸통 of ["", "{", "[]", '"list"', "null", "action=list"]) {
      assert.equal(readDelegationAction(몸통, "application/json"), null, 몸통);
    }
    // `action` 칸이 글자가 아니면 모르는 것으로 본다.
    assert.equal(readDelegationAction('{"action":{"x":1}}', "application/json"), null);
    assert.equal(readDelegationAction('{"action":3}', "application/json"), null);
    assert.equal(readDelegationAction("{}", null), null);
    assert.ok(!isDelegationListAction(null));
  });
});

describe("③ 🔴 몸통 짓기 — 사람이 안 실린다", () => {
  it("칸은 넷뿐이고 시각은 ISO 8601 이다", () => {
    const 답 = buildDelegationListReply([auditRow()]);
    assert.equal(답.delegations.length, 1);
    assert.deepEqual(Object.keys(답.delegations[0]).sort(), ["endsAt", "id", "revokedAt", "startsAt"]);
    assert.equal(답.delegations[0].startsAt, "2027-03-01T00:00:00.000Z");
    assert.equal(답.delegations[0].endsAt, "2027-03-08T00:00:00.000Z");
    assert.equal(답.delegations[0].revokedAt, null);
    assert.equal(답.truncated, false);
  });

  it("🔴 **철회된 줄도 그대로 실린다** — 맞대어 보기의 핵심", () => {
    const 거둔줄 = auditRow({ revokedAt: new Date("2027-03-04T09:30:00.000Z") });
    const 답 = buildDelegationListReply([거둔줄]);
    // 🔴 걸러 내면 「포털은 거뒀는데 집에서는 살아 있는」 줄이 양쪽에서 똑같이 안 보인다.
    assert.equal(답.delegations.length, 1);
    assert.equal(답.delegations[0].revokedAt, "2027-03-04T09:30:00.000Z");
  });

  it("🔴 사람 칸은 **섞어 넣어도** 몸통에 안 나간다", () => {
    // 🔵 표에 칸이 늘거나 조회가 칸을 더 고르는 날을 흉내 낸다. `...row` 로 펼치는 구현이면
    //    여기서 터진다 — 오류도 경고도 없이 새는 모양이다.
    const 사람이섞인줄 = {
      ...auditRow(),
      delegatorSub: FAKE_DELEGATOR,
      delegateSub: FAKE_DELEGATE,
      reason: "출장",
      syncedAt: new Date("2027-03-01T00:00:00.000Z"),
    } as unknown as DelegationAuditRow;
    const 글자 = JSON.stringify(buildDelegationListReply([사람이섞인줄]));
    for (const 새는값 of [FAKE_DELEGATOR, FAKE_DELEGATE, "출장", "delegator", "delegate", "reason", "synced"]) {
      assert.ok(!글자.includes(새는값), `${새는값} 가 몸통에 실렸다`);
    }
    // 🔵 표본이 비어 공짜로 통과하지 않게 — 같은 몸통에 번호는 실려 있어야 한다.
    assert.ok(글자.includes(DELEGATION_ID));
  });

  it("빈 목록도 제대로 된 답이다 — 🔴 「못 읽었다」와 **다른 뜻**이다", () => {
    assert.deepEqual(buildDelegationListReply([]), { delegations: [], truncated: false });
  });

  it("🔴 상한을 넘치면 **말한다**(truncated) — 조용히 자르지 않는다", () => {
    const 줄 = (n: number) => Array.from({ length: n }, (_, i) => auditRow({ id: `cccc3333-3333-4333-8333-${String(i).padStart(12, "0")}` }));
    // 🔴 딱 상한만큼은 **안 잘린 것**이다. 여기서 참이 되면 점검이 멀쩡한 날마다 「잘렸을 수
    //    있다」를 보고한다.
    const 딱맞음 = buildDelegationListReply(줄(5), 5);
    assert.equal(딱맞음.truncated, false);
    assert.equal(딱맞음.delegations.length, 5);
    // 한 줄 더 읽었으면 넘친 것이다 — 그 한 줄은 버리고 참으로 답한다.
    const 넘침 = buildDelegationListReply(줄(6), 5);
    assert.equal(넘침.truncated, true);
    assert.equal(넘침.delegations.length, 5);
    assert.equal(넘침.delegations[4].id.endsWith("000000000004"), true);
  });

  it("🔵 기본 상한에서도 같다 — 조회가 2001 줄을 주면 2000 줄 + truncated", () => {
    const 꽉찬목록 = Array.from({ length: DELEGATION_AUDIT_LIMIT + 1 }, () => auditRow());
    const 답 = buildDelegationListReply(꽉찬목록);
    assert.equal(답.delegations.length, DELEGATION_AUDIT_LIMIT);
    assert.equal(답.truncated, true);
  });
});

describe("④ 🔴 조회 — 거르개가 없는 자리 (소스 글자로 잰다)", () => {
  /**
   * 🔵 `delegation-queries.ts` 는 `server-only` 를 물고 있어 불러올 수 없고, 이 집에는 구워진
   * SQL 을 보는 방식도 없다(`.toSQL()` 을 쓰는 자리가 저장소에 하나도 없다 — 2026-11-17 실측).
   * 그래서 **함수 본문만 잘라** 글자로 본다.
   */
  const queries = code("src/lib/approval/delegation-queries.ts");
  const at = queries.indexOf("export function delegationsForAuditQuery(");
  const end = queries.indexOf("export async function loadDelegationsForAudit(");
  const 본문 = queries.slice(at, end);

  it("🔵 **표본이 비어 있지 않다** — 아래 넷이 공짜로 통과하지 않게 먼저 센다", () => {
    assert.ok(at > 0, "점검용 조회를 찾지 못했다");
    assert.ok(end > at, "입구 함수가 조회보다 앞에 있다 — 본문을 잘못 잘랐다");
    assert.ok(본문.includes(".select({"), "자른 본문에 질의가 없다");
  });

  it("🔴 **포털 표**를 읽는다 — 제 표(`approval_delegations`)가 아니다", () => {
    // 🔴 두 표는 이름도 칸도 닮았다. 제 표를 읽으면 점검이 **이 집에서 맡긴 위임**을 포털 것과
    //    맞대어 보고 전부 어긋남으로 보고한다.
    assert.ok(본문.includes(".from(portalApprovalDelegations)"), "포털 표를 안 읽는다");
    assert.ok(!본문.includes("approvalDelegations)") || !본문.includes(".from(approvalDelegations)"), "제 표를 읽고 있다");
  });

  it("🔴 사람 칸을 **고르지도 않는다**", () => {
    assert.ok(본문.includes("id: portalApprovalDelegations.id"), "번호를 안 읽는다 — 짝을 맞출 수 없다");
    for (const 칸 of ["startsAt", "endsAt", "revokedAt"]) {
      assert.ok(본문.includes(`${칸}: portalApprovalDelegations.${칸}`), `${칸} 이 빠졌다`);
    }
    for (const 칸 of ["delegatorSub", "delegateSub", "reason", "syncedAt"]) {
      assert.ok(!본문.includes(칸), `${칸} 을 읽고 있다 — 사람(또는 쓸 일 없는 값)이 몸통으로 샌다`);
    }
    // 🔴 이름을 붙이려고 `users` 를 끌어오면 그 순간 사람을 실을 수 있게 된다.
    assert.ok(!본문.includes("leftJoin"), "사람 표를 이어 붙였다");
    assert.ok(!본문.includes("users"), "사람 표를 읽는다");
  });

  it("🔴 **거르개가 없다** — 철회된 줄까지 전부", () => {
    for (const 금지 of [".where(", "isNull(", "isNotNull(", "eq(", "gt(", "lte("]) {
      assert.ok(!본문.includes(금지), `거르개가 붙었다: ${금지}`);
    }
  });

  it("🔴 차례를 못 박는다 — 잘릴 때 **같은 줄**이 잘린다", () => {
    // 🔴 호출마다 다른 줄이 잘리면 점검이 돌 때마다 다른 줄을 「집에 없다」로 읽는다.
    assert.ok(본문.includes(".orderBy(asc(portalApprovalDelegations.id))"), "번호 오름차순이 아니다");
  });

  it("🔴 상한보다 **한 줄 더** 묻는다 — 넘침을 가리는 유일한 길", () => {
    assert.ok(본문.includes(".limit(limit + 1)"), "딱 상한만큼 읽는다 — 넘친 날과 꽉 찬 날을 가를 수 없다");
    assert.ok(queries.includes("limit: number = DELEGATION_AUDIT_LIMIT"), "상한을 순수 모듈에서 가져오지 않는다 — 값이 두 벌이 된다");
  });

  it("🟢 **화면이 쓰는 조회는 그대로다** — 거르개를 푸는 식으로 고치지 않았다", () => {
    /**
     * 🔴 이 조각이 더한 것은 **새 조회 하나**다. `listPortalDelegationsIActFor` 의 거르개를
     *    풀어 돌려썼다면 화면에 **거둔 위임·끝난 위임이 쏟아진다.**
     */
    for (const 이름 of [
      "export async function listPortalDelegationsIMade",
      "export async function listPortalDelegationsIActFor",
      "export async function listAllDelegations",
      "export async function actingApproverSubsFor",
    ]) {
      assert.ok(queries.includes(이름), `${이름} 이 없어졌다`);
    }
    const 화면용 = queries.slice(queries.indexOf("export async function listPortalDelegationsIActFor"), at);
    assert.ok(화면용.includes("isNull(portalApprovalDelegations.revokedAt)"), "화면용 조회가 거둔 줄을 거르지 않게 됐다");
  });

  it("🔵 순수 모듈은 **아무것도 끌어오지 않는다** — 사람으로 가는 길이 애초에 없다", () => {
    // 🔴 표·사람 조회를 한 줄이라도 끌어오면 다음 사람이 「이왕 읽은 김에 이름까지」로
    //    무너뜨릴 수 있고, 그 순간 시험에서 불러올 수도 없게 된다(`server-only`).
    const 순수 = code("src/lib/approval/portal-delegation-list.ts");
    assert.ok(순수.includes("export function buildDelegationListReply"), "표본이 비었다 — 파일을 잘못 읽었다");
    assert.ok(!/^\s*import /m.test(순수), "순수 모듈이 무언가를 끌어온다");
  });
});

describe("⑤ 🔴 통로 배선 — 갈래마다 다른 쓰임새", () => {
  const route = code("src/app/api/integration/delegations/route.ts");
  const 가르는자리 = route.indexOf("isDelegationListAction(");
  const 읽기 = route.indexOf("PORTAL_TOKEN_PURPOSES.delegationsRead");
  const 쓰기 = route.indexOf("PORTAL_TOKEN_PURPOSES.delegationsWrite");
  const 읽기갈래 = route.slice(route.indexOf("if (isDelegationListAction("), 쓰기);

  it("🔴 갈래를 가린 **뒤에** 그 갈래의 쓰임새를 요구한다", () => {
    assert.ok(가르는자리 > 0, "갈래를 가르는 자리를 찾지 못했다");
    assert.ok(읽기 > 가르는자리, "읽기 갈래가 쓰임새를 안 요구한다");
    assert.ok(쓰기 > 읽기, "🔴 읽기 갈래가 쓰기 쓰임새를 보고 있다 — 쓰기 토큰으로 장부가 열린다");
    // 🔴 엿보기는 **복제본**이어야 한다 — 원본을 읽으면 아래 쓰기 갈래의 `request.json()` 이
    //    빈 몸통을 받아 **모든 쓰기가 조용히 400** 이 된다.
    assert.ok(route.includes("await request.clone().text()"), "원본 몸통을 엿본다");
    assert.ok(route.indexOf("request.clone()") < 가르는자리);
  });

  it("🔴 토큰을 보기 **전에** 표를 읽지 않는다", () => {
    assert.ok(읽기갈래.includes("loadDelegationsForAudit()"), "표본이 비었다 — 갈래를 잘못 잘랐다");
    assert.ok(읽기갈래.indexOf("loadDelegationsForAudit()") > 읽기갈래.indexOf("PORTAL_TOKEN_PURPOSES.delegationsRead"), "자격을 보기 전에 장부를 읽는다");
    assert.match(읽기갈래, /if \(!verifiedReader\.ok\) return invalidToken\(\);/);
    assert.ok(읽기갈래.indexOf("invalidToken()") < 읽기갈래.indexOf("loadDelegationsForAudit()"), "거절하기 전에 장부를 읽는다");
  });

  it("🔴 읽기 갈래가 **사람을 건드리지 않는다**", () => {
    for (const 금지 of ["findPortalDelegationPerson", "verifiedReader.subject", "Sub", "reason", "users"]) {
      assert.ok(!읽기갈래.includes(금지), `읽기 갈래가 ${금지} 를 건드린다`);
    }
    // 🔵 몸통을 짓는 자리는 순수 모듈 하나다 — 여기서 칸을 손으로 골라 담지 않는다.
    assert.ok(읽기갈래.includes("buildDelegationListReply(rows)"));
  });

  it("🔴 못 읽은 것을 **빈 목록으로 답하지 않는다**", () => {
    /**
     * 🔴 빈 목록은 「이 집에 위임이 하나도 없다」는 **뜻 있는 답**이고, 점검은 그것을 「포털에만
     *    있다 = 어긋남」으로 읽는다. DB 가 앓는 날 모든 위임이 어긋난 것으로 보고되면 안 된다.
     */
    assert.ok(읽기갈래.includes("return unavailable("), "읽다 실패한 자리를 못 찾았다");
    assert.ok(!/delegations: \[\]/.test(읽기갈래), "실패를 빈 목록으로 답한다");
    assert.ok(읽기갈래.indexOf("return unavailable(") < 읽기갈래.indexOf("return Response.json(buildDelegationListReply"), "실패를 답하는 자리가 성공 뒤에 있다");
    assert.match(route, /status: 503/);
  });

  it("🔴 두 갈래의 401 이 **같은 모양**이다 — 답의 모양으로 갈래를 떠볼 틈이 없다", () => {
    // 🔵 쓰기 갈래의 401 은 2026-11-16 그대로 두고 읽기 갈래는 `invalidToken()` 을 쓴다.
    //    두 자리가 어긋나면 토큰 없이 두드리는 쪽이 어느 갈래가 살아 있는지를 알아낸다.
    assert.equal(route.split('error: "invalid_token"').length - 1, 2, "401 의 모양이 갈래마다 다르다");
    assert.equal(route.split('"www-authenticate": "Bearer"').length - 1, 2);
    assert.equal(route.split('error_description: "자격증명이 없거나 이 통로의 것이 아닙니다."').length - 1, 2);
  });

  it("🔴 포털 번호를 로그에 쌓지 않는다", () => {
    const 로그 = route.match(/console\.(log|warn|error)\([\s\S]*?\);/g) ?? [];
    assert.ok(로그.length >= 2, "로그 자리를 못 찾았다 — 이 시험이 아무것도 안 재고 있다");
    for (const 한줄 of 로그) {
      assert.ok(!/[Ss]ub\b/.test(한줄), `포털 번호를 남기고 있다: ${한줄}`);
      assert.ok(!/body|rows|parsed\.command/.test(한줄), `본문을 통째로 남기고 있다: ${한줄}`);
    }
  });

  it("🔴 위임 장부도 캐시되지 않는다 — 거둔 위임이 살아 있는 것처럼 남는다", () => {
    assert.ok(읽기갈래.includes("headers: NO_STORE"), "읽기 갈래의 답에 no-store 가 없다");
    assert.match(route, /"cache-control": "no-store"/);
  });
});
