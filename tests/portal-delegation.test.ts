import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { actingApproverSubs, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";
import { NO_PORTAL_DELEGATIONS, notePortalDelegationOutage, readPortalDelegationSubs } from "../src/lib/approval/portal-delegation";

/**
 * ============================================================================
 * 포털에 맡긴 결재권 위임을 **읽는다** (2026-11-16, 설계 조각 4)
 * ============================================================================
 * 2026-11-13 결정으로 위임을 포털(dss-auth) 한 곳에 모았다(설계: `dss-approvals/
 * DELEGATION_DESIGN.md` 의 B-1·B-2). 지정은 통합 승인함이 하고, 저장은 포털이 하고, **읽는
 * 것은 각 시스템**이다. 이 조각이 재고관리 쪽 읽는 자리를 붙였다.
 *
 * 여기서 못 박는 것:
 *  1. **그릇** — 빈 목록과 「못 물었다」가 값에서 갈린다(설계 B-6·B-7). 뭉개면 안내를 띄울
 *     자리에서 구별할 길이 영영 없다.
 *  2. **답 읽기** — 모르는 모양은 「위임 없음」이 아니라 「못 읽었다」다. 🔴 **답에 부른 사람
 *     자신이 없으면 그것도 못 읽은 것**이다(방향이 뒤집힌 답으로 남의 결재를 누르지 않게).
 *  3. 🔴 **합집합이되 이어 붙지 않는다**(설계 B-4) — 이 집의 표로 A→B 이고 포털로 B→C 여도
 *     C 는 A 를 못 얻는다. 고지가 둘이 되면서 **한 고지 안에서는 막히던 두 겹이 고지를
 *     갈아타며** 생길 수 있게 됐고, 막는 자리는 `actingApproverSubs` 하나다.
 *  4. **누가 묻고 누가 안 묻는가** — 🔴 포털이 우리를 부르는 통로에서는 **되묻지 않는다.**
 *
 * ── 🔴 이 저장소에는 DB 시험이 없다 ─────────────────────────────────────
 * 그래서 뜻은 순수 함수로 재고(①~④), 「어느 자리가 묻는가」는 **소스 글자**로 잰다(⑤) —
 * `tests/part-issue-delegation.test.ts` 와 같은 방식이다. 망을 타는 모듈
 * (`src/lib/approval/portal-acting-subs.ts`)은 `server-only` 를 물고 있어 **불러올 수 없다.**
 * 글자로 재는 까닭이 그것이기도 하다.
 * ============================================================================
 */

const sub = (name: string) => `sub-${name}`;

const STARTS = new Date("2026-11-01T00:00:00.000Z");
const ENDS = new Date("2026-11-30T00:00:00.000Z");
const NOW = new Date("2026-11-16T12:00:00.000Z");

/** 이 집의 표에 적힌 위임 한 줄. */
const own = (delegatorName: string, delegateName: string, over: Partial<ApprovalDelegationPeriod> = {}): ApprovalDelegationPeriod => ({
  delegatorSub: sub(delegatorName),
  delegateSub: sub(delegateName),
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
  ...over,
});

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 🔴 **주석을 걷어낸 소스.** 아래 ⑤·⑥은 글자로 재는 시험이라 **주석이 답을 바꾼다.**
 *
 * 이 저장소는 「왜 그렇게 했는가」를 길게 적는 집이라, 「여기서는 포털에 묻지 않는다(까닭은
 * `portal-acting-subs.ts`)」 같은 **설명이 곧 금지어를 품는다.** 걷어내지 않으면
 *  · 「묻지 않는다」를 재는 시험이 **설명 때문에** 깨지고(2026-11-16 에 실제로 넷이 깨졌다),
 *  · 🔴 더 나쁘게는 「묻는다」를 재는 시험이 **주석만으로 영영 통과**한다.
 * 둘째가 훨씬 비싸다 — 깨지는 쪽은 바로 보이지만 통과하는 쪽은 아무도 안 본다.
 */
const code = (relative: string): string =>
  src(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------------ */

describe("① 그릇 — 「없다」와 「모른다」는 다른 값이다", () => {
  it("🔴 안 물은 것은 **장애가 아니다** — `unavailable` 이 거짓이다", () => {
    // 🔴 참으로 두면 포털에 묻지 않는 자리(포털이 우리를 부르는 통로 둘)마다 「포털을 확인하지
    //    못했습니다」가 뜬다 — 아무 상관없는 화면에 경고가 깔린다.
    assert.equal(NO_PORTAL_DELEGATIONS.unavailable, false);
    assert.deepEqual(NO_PORTAL_DELEGATIONS.delegatorSubs, []);
  });

  it("🔴 빈 목록만 보고 「없다」고 읽을 수 없다 — 두 칸을 **함께** 봐야 갈린다", () => {
    const askedAndEmpty = { delegatorSubs: [] as readonly string[], unavailable: false };
    const couldNotAsk = { delegatorSubs: [] as readonly string[], unavailable: true };
    // 🔴 목록만 보면 둘이 **똑같이** 생겼다. 이 한 줄이 「칸을 하나로 줄이자」를 막는 근거다.
    assert.deepEqual(askedAndEmpty.delegatorSubs, couldNotAsk.delegatorSubs);
    assert.notEqual(askedAndEmpty.unavailable, couldNotAsk.unavailable);
  });
});

describe("② 포털의 답 읽기 (readPortalDelegationSubs)", () => {
  const me = sub("lee");

  it("제대로 된 답 — 맨 앞이 본인이고 뒤에 결재권자들", () => {
    assert.deepEqual(readPortalDelegationSubs({ subs: [me, sub("kim")], count: 2 }, me), [me, sub("kim")]);
  });

  it("위임이 하나도 없는 사람 — **본인 하나짜리 목록**이고 「못 읽었다」가 아니다", () => {
    assert.deepEqual(readPortalDelegationSubs({ subs: [me], count: 1 }, me), [me]);
  });

  it("🔴 모르는 모양은 **빈 목록이 아니라 `null`** 이다 — 통로가 바뀐 날 조용히 「위임 없음」이 되면 안 된다", () => {
    // 🔴 빈 목록으로 읽으면 대리인 전원이 까닭 없이 막히는데 로그에도 화면에도 흔적이 없다.
    for (const payload of [null, undefined, 42, "subs", [], {}, { subs: null }, { subs: "a,b" }, { subs: { 0: me } }, { count: 1 }]) {
      assert.equal(readPortalDelegationSubs(payload, me), null, `${JSON.stringify(payload) ?? "undefined"} 를 「위임 없음」으로 읽었다`);
    }
  });

  it("글자가 아닌 조각·빈 글자는 **그 조각만** 버린다", () => {
    assert.deepEqual(readPortalDelegationSubs({ subs: [me, "", 7, null, sub("kim")] }, me), [me, sub("kim")]);
  });

  it("🔴 **답에 부른 사람 자신이 없으면 못 읽은 것**이다 — 방향이 뒤집힌 답으로 권한을 늘리지 않는다", () => {
    /**
     * 포털의 약속은 「`subs[0]` 은 언제나 부른 사람 자신」이다(설계 C-2). 그 약속이 깨진 답은
     * 🔴 **우리가 아는 그 답이 아니다.** 가장 무서운 갈림이 방향이 뒤집히는 것인데(「내가
     * 대신할 수 있는 사람들」 ↔ 「나를 대신할 수 있는 사람들」), 그때 그대로 합치면 **남의
     * 결재를 누를 수 있게 된다.** 모양이 낯설면 권한을 늘리지 않는 쪽으로 간다.
     */
    assert.equal(readPortalDelegationSubs({ subs: [sub("kim"), sub("park")] }, me), null);
    // 🔴 빈 배열도 약속 위반이다 — 본인이 들어 있어야 하므로 비어 올 수가 없다.
    assert.equal(readPortalDelegationSubs({ subs: [] }, me), null);
  });
});

describe("③ 🔴 두 고지를 합친다 — 합집합이되 **이어 붙지 않는다** (설계 B-4)", () => {
  it("포털 위임만 있어도 붙는다 — 이 조각의 전부다", () => {
    assert.deepEqual(actingApproverSubs([], sub("lee"), NOW, [sub("lee"), sub("kim")]), [sub("lee"), sub("kim")]);
  });

  it("🔴 **이 집의 위임을 걷어내지 않았다** — 둘 다 산다", () => {
    // 🔴 설계 B-4 가 「둘 다 살려 둔다」였다. 포털 쪽으로 갈아끼우면 이미 맡겨 둔 사람들이
    //    **아무 말 없이** 자격을 잃는다.
    const result = actingApproverSubs([own("kim", "lee")], sub("lee"), NOW, [sub("lee"), sub("park")]);
    assert.deepEqual(result, [sub("lee"), sub("kim"), sub("park")]);
  });

  it("🔴 **본인이 맨 앞에 한 번만** — 포털이 본인을 맨 앞에 넣어 줘도 두 번 들어가지 않는다", () => {
    // 🔴 두 번 들어가면 `inArray` 에 같은 번호가 두 칸이 되고, 같은 건이 화면에 두 번 뜬다.
    const result = actingApproverSubs([], sub("lee"), NOW, [sub("lee")]);
    assert.deepEqual(result, [sub("lee")]);
    assert.equal(result.filter((one) => one === sub("lee")).length, 1);
  });

  it("두 고지에 **같은 사람**이 겹쳐 있어도 한 번만 — 겹쳐 지정하는 일은 실제로 생긴다", () => {
    // 🔵 설계 D-2: 두 곳에 겹쳐 지정해도 해롭지 않다(둘 다 대신할 수 있을 뿐). 다만 목록에
    //    두 번 들어가면 같은 건이 두 번 뜬다.
    assert.deepEqual(actingApproverSubs([own("kim", "lee")], sub("lee"), NOW, [sub("lee"), sub("kim")]), [sub("lee"), sub("kim")]);
  });

  it("🔴 **고지를 갈아타며 두 겹이 생기지 않는다** — 이 집 A→B, 포털 B→C 라도 C 는 A 를 못 얻는다", () => {
    /**
     * 🔴 **이 조각이 새로 연 구멍이 바로 이것이다.** 한 고지 안에서는 `delegatorSubsFor` 가
     *    이어 붙이기를 막아 왔는데(A 는 C 를 모른다 · 고리가 생긴다), 고지가 둘이 되면서
     *    **두 고지를 갈아타며** 두 겹이 될 수 있게 됐다. 막는 자리는 `actingApproverSubs`
     *    하나뿐이라, 그 한 자리가 무너지면 **A 가 동의한 적 없는 사람에게 결재권이 넘어간다.**
     */
    // 이 집의 표: a 가 b 에게 맡겼다. 포털: b 가 c 에게 맡겨서 c 가 물으면 [c, b] 가 온다.
    const ownRows = [own("a", "b")];
    const asC = actingApproverSubs(ownRows, sub("c"), NOW, [sub("c"), sub("b")]);
    assert.deepEqual(asC, [sub("c"), sub("b")], "c 가 a 의 결재권까지 얻었다 — 두 고지를 갈아타며 이어 붙었다");
    assert.equal(asC.includes(sub("a")), false);

    // 🔵 한 겹은 멀쩡히 돈다 — b 는 a 의 결재권을 그대로 쓴다.
    assert.deepEqual(actingApproverSubs(ownRows, sub("b"), NOW, [sub("b")]), [sub("b"), sub("a")]);
  });

  it("🔴 반대 방향으로 갈아타도 마찬가지다 — 포털 A→B, 이 집 B→C", () => {
    // 이 집의 표: b 가 c 에게 맡겼다. 포털: a 가 b 에게 맡겼다(c 가 물으면 포털은 [c] 뿐이다).
    const ownRows = [own("b", "c")];
    const asC = actingApproverSubs(ownRows, sub("c"), NOW, [sub("c")]);
    assert.deepEqual(asC, [sub("c"), sub("b")]);
    assert.equal(asC.includes(sub("a")), false, "c 가 포털 쪽 한 겹까지 타고 올라갔다");
  });

  it("🔴 끝난 줄·되돌린 줄은 **이 집 쪽만** 걸러진다 — 포털 쪽 기간 판정을 베껴 적지 않았다", () => {
    /**
     * 🔵 포털이 주는 목록은 **포털이 이미 기간·되돌림을 가린 결과**다(설계 C-2). 여기서 한 번
     *    더 가리려면 그 규칙을 이 집에 베껴 적어야 하고, 두 벌이 갈리는 날 한쪽만 틀린다.
     * 🔴 그래서 포털 번호는 **무조건 들어간다** — 이 시험이 그 약속을 글자로 못 박는다.
     */
    const ended = own("kim", "lee", { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-10T00:00:00.000Z") });
    const revoked = own("cho", "lee", { revokedAt: new Date("2026-11-02T00:00:00.000Z") });
    assert.deepEqual(actingApproverSubs([ended, revoked], sub("lee"), NOW, [sub("lee"), sub("park")]), [sub("lee"), sub("park")]);
  });

  it("빈 글자는 목록에 안 들어간다 — 열쇠로 쓰이는 값이다", () => {
    assert.deepEqual(actingApproverSubs([], sub("lee"), NOW, ["", sub("kim"), ""]), [sub("lee"), sub("kim")]);
  });

  it("🔴 못 물었을 때(빈 목록)는 **이 칸이 생기기 전과 한 글자도 다르지 않다**", () => {
    // 🔴 이것이 「포털이 멎어도 본인 결재는 멀쩡하다」의 근거다(설계 B-6).
    assert.deepEqual(actingApproverSubs([own("kim", "lee")], sub("lee"), NOW, []), [sub("lee"), sub("kim")]);
    assert.deepEqual(actingApproverSubs([], sub("lee"), NOW, []), [sub("lee")]);
  });
});

/**
 * 결과 모양 흉내 — 서버 액션이 돌려주는 것과 **같은 꼴**이다(`PartIssueActionState`).
 *
 * 🔵 칸을 **선언해 두어야** 한다. 제약(`{ portalDelegationUnavailable?: true }`)이 칸이 전부
 * 선택인 「약한 타입」이라, 그 칸이 아예 없는 객체를 넘기면 TS 가 「공통 칸이 하나도 없다」로
 * 보고 추론을 포기한다 — 실제 부르는 자리들이 타입을 손으로 적거나(`<PartIssueScreenData>`)
 * 칸을 선언해 두는 까닭이 그것이다.
 */
type NotedResult = { error: string | null; portalDelegationUnavailable?: true };

describe("④ 「못 물었다」를 결과에 얹는다 (notePortalDelegationOutage)", () => {
  it("못 물었으면 칸이 선다 — 화면이 안내를 띄울 유일한 단서다(설계 B-7)", () => {
    const result: NotedResult = { error: "지금 결재할 차례가 아닙니다." };
    const noted = notePortalDelegationOutage(result, { delegatorSubs: [], unavailable: true });
    assert.equal(noted.portalDelegationUnavailable, true);
    assert.equal(noted.error, "지금 결재할 차례가 아닙니다.", "원래 값이 지워졌다");
  });

  it("🔴 멀쩡했으면 **칸 자체가 없다** — `false` 를 실으면 「있음」으로 읽는 쪽에서 경고가 깔린다", () => {
    const result: NotedResult = { error: "지금 결재할 차례가 아닙니다." };
    const noted = notePortalDelegationOutage(result, { delegatorSubs: [sub("kim")], unavailable: false });
    assert.equal("portalDelegationUnavailable" in noted, false);
    // 🔵 새 객체를 만들지 않는다 — 평소(포털이 멀쩡할 때)에는 아무 비용도 없다.
    assert.equal(noted, result);
  });

  it("안 물은 자리에서는 칸이 서지 않는다 — 안 물은 것은 장애가 아니다", () => {
    const result: NotedResult = { error: null };
    assert.equal("portalDelegationUnavailable" in notePortalDelegationOutage(result, NO_PORTAL_DELEGATIONS), false);
  });
});

/* ------------------------------------------------------------------ */
/* ⑤ 아래는 **순수 함수로는 닿지 않는 자리**를 글자로 못 박는 시험이다.    */
/*    망을 타는 모듈은 `server-only` 를 물고 있어 불러올 수 없다.          */
/* ------------------------------------------------------------------ */

const FETCHER = "src/lib/approval/portal-acting-subs.ts";

describe("⑤ 묻는 쪽 — 규격과 처신", () => {
  const fetcher = code(FETCHER);

  it("🔴 설계서의 통로 규격 그대로 부른다 — 한 칸이라도 틀리면 조용히 401·400 이 된다", () => {
    assert.ok(fetcher.includes("/api/integration/delegations"), "통로 주소가 바뀌었다");
    assert.ok(fetcher.includes('method: "POST"'), "읽기라고 GET 으로 바꿨다 — 사람 번호가 접근 로그에 남는다(포털 쪽 머리말)");
    assert.ok(fetcher.includes("authorization: `Basic ${Buffer.from(credentials"), "자격증명을 머리말로 안 보낸다");
    assert.ok(fetcher.includes('"content-type": "application/x-www-form-urlencoded"'), "본문 모양이 바뀌었다");
    // 🔴 **방향**이다. 반대 방향을 꽂으면 오류 없이 엉뚱한 사람이 누르게 된다.
    assert.ok(fetcher.includes('action: "acting"'), "묻는 방향이 `acting` 이 아니다");
  });

  it("🔴 상한이 있고, **이 집의 포털 호출 상한과 같은 값**이다 — 설계서의 3초가 아니다", () => {
    /**
     * 🔴 설계서 B-6 의 3초는 **통합 승인함이 각 결재함을 부를 때**의 값이다. 이 집에서 포털을
     *    부르는 상한은 2초로 맞춰져 있고(`notifications/portal.ts`), 같은 집에서 같은 포털을
     *    부르는 상한이 둘이면 느릴 때 어느 쪽이 느린지 알 수 없게 된다. 🔵 **두 상수를 맞대어
     *    본다** — 한쪽만 바뀌는 날 여기서 깨진다.
     */
    const ours = /PORTAL_DELEGATIONS_TIMEOUT_MS = (\d+)/.exec(fetcher);
    const theirs = /PORTAL_NOTIFICATIONS_TIMEOUT_MS = (\d+)/.exec(code("src/lib/notifications/portal.ts"));
    assert.ok(ours, "상한 상수가 사라졌다 — 포털이 멎으면 결재 화면이 하염없이 기다린다");
    assert.ok(theirs, "견줄 상대(알림 쪽 상한)가 사라졌다 — 이 시험이 빈 채로 통과할 뻔했다");
    assert.equal(ours[1], theirs[1], "같은 집에서 같은 포털을 부르는 상한이 둘이 됐다");
    assert.ok(fetcher.includes("AbortSignal.timeout(PORTAL_DELEGATIONS_TIMEOUT_MS)"), "상수를 선언만 하고 안 쓰고 있다");
  });

  it("🔴 **어떤 일이 있어도 던지지 않는다** — 포털 한 곳이 멈춘 날 세 시스템의 결재가 멈추면 안 된다", () => {
    assert.ok(!fetcher.includes("throw"), "던지는 길이 생겼다(설계 B-6 — 못 물으면 「위임 없음」으로 보고 진행한다)");
    // 🔴 설정값을 읽는 getter 는 값이 없으면 던진다 — 그래서 `try` 안에서 읽어야 한다.
    const tryAt = fetcher.indexOf("try {");
    const envAt = fetcher.indexOf("env.ssoClientId");
    assert.ok(tryAt !== -1 && envAt > tryAt, "설정값을 try 밖에서 읽는다 — 설정이 빠진 날 결재가 통째로 깨진다");
  });

  it("🔴 로그에 **사람 번호를 쌓지 않는다** — 이 집의 포털 통로 전부가 같은 규칙이다", () => {
    for (const line of fetcher.split("\n")) {
      if (!line.includes("console.")) continue;
      assert.ok(!line.includes("subject"), `로그에 포털 번호를 싣는다: ${line.trim()}`);
      assert.ok(!line.includes("credentials"), `로그에 자격증명을 싣는다: ${line.trim()}`);
    }
  });
});

describe("⑥ 🔴 **누가 묻고 누가 안 묻는가** — 빠뜨리면 「어떤 길에서만 안 듣는다」가 된다", () => {
  /** 묻는 자리 — 사람이 보는 화면과 사람이 누르는 단추다. */
  const ASK = [
    "src/app/actions/part-issue.ts",
    "src/lib/approval/part-issue-screen-data.ts",
    "src/lib/approval/delegation-screen-data.ts",
    "src/components/HeaderNotificationBell.tsx",
  ];
  /** 🔴 묻지 **말아야** 하는 자리 — 지금 그 요청이 **포털이 우리를 부른 것**이다. */
  const NEVER_ASK = ["src/app/api/integration/approvals/route.ts", "src/app/api/integration/notifications/route.ts"];

  it("사람이 보는 네 자리는 **전부** 묻는다 — 하나라도 빠지면 거기서만 대리 결재가 안 된다", () => {
    for (const file of ASK) {
      assert.ok(code(file).includes("resolvePortalDelegations("), `${file} 이 포털에 묻지 않는다`);
    }
  });

  it("🔴 포털이 부르는 통로 둘은 **되묻지 않는다** — 서로를 기다리는 짝이 된다", () => {
    // 🔴 포털의 상한은 1.5초이고 우리 상한은 2초다. 되물으면 답이 닿기 전에 포털이 이 줄을
    //    통째로 버린다 — 「남의 시스템 종에서만 재고 줄이 통째로 빠진다」가 된다.
    for (const file of NEVER_ASK) {
      const route = code(file);
      assert.ok(!route.includes("resolvePortalDelegations"), `${file} 이 포털에 되묻는다`);
      // 🔵 「안 물었다」를 **글자로** 적는다 — 빈 배열을 그냥 넘기면 「물었는데 없었다」와 같아
      //    보여 다음 사람이 결함으로 보고 「묻게」 고친다.
      assert.ok(route.includes("NO_PORTAL_DELEGATIONS.delegatorSubs"), `${file} 에 안 물었다는 사실이 안 적혀 있다`);
    }
  });

  it("🔴 **거래 안에서 묻는 자리가 없다** — 망 호출이 `FOR UPDATE` 잠금을 붙든다(설계 C-3)", () => {
    for (const file of ["src/lib/approval/part-issue.ts", "src/lib/approval/delegation-queries.ts"]) {
      assert.ok(!code(file).includes("resolvePortalDelegations"), `${file} 이 제 손으로 포털에 묻는다 — 트랜잭션 안으로 들어가는 길이다`);
    }
  });

  it("🔴 「못 물었다」가 **밖으로 나오는 길**이 있다 — 없으면 대리인이 조용히 막힌다(설계 B-7)", () => {
    // 🔴 안내 문구는 다음 조각의 일이지만, **값이 나오는 길은 이 조각이 낸다.** 길이 없으면
    //    안내를 붙이려는 사람이 결재 함수를 다시 열어야 하고 그때 하나를 빠뜨린다.
    for (const file of ["src/app/actions/part-issue.ts", "src/lib/approval/part-issue-screen-data.ts", "src/lib/approval/part-issue.ts"]) {
      assert.ok(code(file).includes("portalDelegationUnavailable"), `${file} 에 「못 물었다」가 밖으로 나오는 길이 없다`);
    }
    // 위임 설정 화면은 **수와 함께** 내려보낸다 — 「저쪽에도 N건이 있습니다」(설계 D-2).
    const screen = code("src/lib/approval/delegation-screen-data.ts");
    assert.ok(screen.includes("portalActing"), "위임 화면이 포털 쪽을 한 글자도 안 보여 준다");
    assert.ok(screen.includes("unavailable: portal.unavailable"), "위임 화면이 「못 물었다」를 버리고 0건으로 그린다 — 거짓말이 된다");
  });
});
