import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { actingApproverSubs, activeDelegateSubs, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";

/**
 * ============================================================================
 * 승인함에서 맡긴 위임의 대리인에게도 **즉시 메일이 간다** (2026-11-17, 설계 D-8 ①)
 * ============================================================================
 * 결재가 한 건 생기면 이 집은 **그 단계에 적힌 결재자 + 지금 그를 대신할 수 있는 사람들**에게
 * 포털을 통해 즉시 알린다(`src/lib/notifications/approval-created-ping.ts`). 그 「대신할 수
 * 있는 사람들」을 모으는 조회가 **제 표(`approval_delegations`) 하나만** 읽고 있어서,
 * **통합 승인함에서 맡긴 위임의 대리인만 이 즉시 메일에서 빠졌다.**
 *
 * 🔵 **빠진 것은 즉시 메일 하나뿐이었다.** 그 사람의 알림 종·결재 화면·[승인] 단추는 판정
 * (`actingApproverSubs`)이 두 표를 합치게 되면서 이미 멀쩡했고(2026-11-16 저녁, 설계 B-12),
 * 포털의 주기 작업도 평소처럼 주웠다. 🔴 그래서 증상이 「메일이 한 바퀴 늦는다」 하나뿐이라
 * **아무도 신고하지 않는 모양**이었다 — 위임이 없애려던 기다림이 바로 그 한 바퀴다.
 *
 * ── 여기서 못 박는 것 넷 ────────────────────────────────────────────────
 *  1. 🔴 **승인함 위임으로 생긴 대리인이 목록에 들어온다** — 이 조각의 전부다.
 *  2. 🔴 **끝났거나 거둔 위임의 대리인은 안 들어온다** — 두 고지 **양쪽 다**.
 *  3. 🔴 **두 고지에 같은 사람이 있어도 한 번만** — 같은 사람에게 두 번 가지 않는다.
 *  4. 🔴 **짝 함수(판정, 정방향)와 같은 규칙을 쓴다** — 한쪽만 고쳐지는 날 ④가 빨개진다.
 *     🔵 규칙을 베껴 적어 재지 않는다. **두 방향에 같은 줄을 넣어 답이 갈리는지**를 본다 —
 *     기간 규칙을 여기 한 줄이라도 적으면 그 순간 이 시험이 「세 벌째 규칙」이 된다.
 *
 * ── 🔴 이 저장소에는 DB 시험이 없다 ─────────────────────────────────────
 * 그래서 뜻은 순수 함수로 재고(①~④), 「어느 조회가 무엇을 읽는가」는 **소스 글자**로 잰다(⑤) —
 * `tests/portal-delegation.test.ts` 와 같은 방식이다. 표를 읽는 모듈
 * (`src/lib/approval/delegation-queries.ts`)은 `server-only` 를 물고 있어 **불러올 수 없다.**
 *
 * 🔴 **값은 전부 가짜다** — 실제 사람 번호도 이름도 한 자 적지 않는다.
 * ============================================================================
 */

const sub = (name: string) => `sub-${name}`;

/** 자리의 주인(결재선에 적힌 결재자)과 대신할 사람. 🔵 가짜 이름이다. */
const 주인 = sub("kim");
const 대리 = sub("lee");

const STARTS = new Date("2026-11-01T00:00:00.000Z");
const ENDS = new Date("2026-11-30T00:00:00.000Z");
const NOW = new Date("2026-11-17T12:00:00.000Z");

/**
 * 위임 한 줄. 🔵 **두 표가 같은 모양이라 지어내는 함수도 하나다** — 칸 이름도 기간 규칙도
 * `revoked_at` 깃발도 글자 그대로 같다(`tests/portal-delegation.test.ts` 와 같은 자리).
 */
const row = (over: Partial<ApprovalDelegationPeriod> = {}): ApprovalDelegationPeriod => ({
  delegatorSub: 주인,
  delegateSub: 대리,
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
  ...over,
});

/* ══════════════════════════════════════════════════════════════════════════
 * ① 🔴 승인함 위임의 대리인이 **들어온다** — 이 조각의 전부
 * ═════════════════════════════════════════════════════════════════════════ */

describe("① 승인함에서 맡긴 위임의 대리인도 알림을 받는다", () => {
  it("🔴 승인함 줄만 있어도 대리인이 나온다 — 고치기 전에는 여기서 빈 목록이었다", () => {
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, [row()]), [대리]);
  });

  it("🔴 **이 집의 위임을 걷어내지 않았다** — 둘 다 산다(설계 B-4)", () => {
    // 🔴 승인함 쪽으로 갈아끼우면 이 집에서 맡겨 둔 사람들이 **아무 말 없이** 알림을 잃는다.
    assert.deepEqual(activeDelegateSubs([row()], 주인, NOW, []), [대리], "제 표 위임이 안 걸린다 — 고치기 전보다 나빠졌다");
    assert.deepEqual(activeDelegateSubs([row()], 주인, NOW, [row({ delegateSub: sub("park") })]), [대리, sub("park")]);
  });

  it("🔴 **남의 줄은 내 알림을 늘리지 않는다** — `delegator_sub` 가 나일 때만 본다", () => {
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, [row({ delegatorSub: sub("park") })]), []);
  });

  it("🔴 **이어 붙이지 않는다** — 고지를 갈아타도 A 의 알림은 C 에게 안 간다", () => {
    /**
     * 🔴 판정(`actingApproverSubs`)이 한 겹인데 알림만 넓으면 「메일은 왔는데 눌러 보니 내
     *    차례가 아니다」가 된다. 한 고지 안에서는 `delegateSubsFor` 가 막아 왔고, 고지가 둘이
     *    되면서 **갈아타는 길**이 생겼다 — 막는 자리는 합치는 함수 하나다.
     */
    const 이집 = [row({ delegatorSub: 주인, delegateSub: 대리 })];
    const 승인함 = [row({ delegatorSub: 대리, delegateSub: sub("park") })];
    assert.deepEqual(activeDelegateSubs(이집, 주인, NOW, 승인함), [대리], "park 까지 알림을 받는다 — 두 겹이 됐다");
    // 🔵 한 겹은 멀쩡히 돈다 — 대리의 자리를 대신하는 사람은 그대로 나온다.
    assert.deepEqual(activeDelegateSubs(이집, 대리, NOW, 승인함), [sub("park")]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 🔴 끝났거나 거둔 위임의 대리인은 **안 들어온다** — 두 고지 양쪽 다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("② 살아 있지 않은 줄은 양쪽 표에서 똑같이 빠진다", () => {
  it("🔴 거둔 승인함 줄은 안 걸린다 — 기간이 남아 있어도", () => {
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, [row({ revokedAt: new Date("2026-11-05T00:00:00.000Z") })]), []);
  });

  it("🔴 끝난 승인함 줄은 안 걸린다 — 끝은 포함하지 않는다(반열린 구간)", () => {
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, [row({ endsAt: NOW })]), [], "끝나는 그 순간에도 알림이 간다");
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, [row({ endsAt: new Date(NOW.getTime() + 1) })]), [대리]);
  });

  it("🔴 아직 시작 안 한 승인함 줄은 안 걸린다 — 미리 적어 둔 위임이 먼저 열리면 안 된다", () => {
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, [row({ startsAt: new Date(NOW.getTime() + 1), endsAt: ENDS })]), []);
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, [row({ startsAt: NOW })]), [대리]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 🔴 두 고지에 같은 사람이 있어도 **한 번만**
 * ═════════════════════════════════════════════════════════════════════════ */

describe("③ 겹쳐 맡긴 사람에게 두 번 가지 않는다", () => {
  it("🔴 두 표에 같은 사람이 있으면 **한 번만** 나온다 — 겹쳐 지정하는 일은 실제로 생긴다", () => {
    // 🔵 설계 D-2: 두 곳에 겹쳐 지정해도 해롭지 않다(둘 다 대신할 수 있을 뿐). 다만 그대로
    //    두면 같은 사람이 목록에 두 번 들어간다.
    const 모음 = activeDelegateSubs([row()], 주인, NOW, [row()]);
    assert.deepEqual(모음, [대리]);
    assert.equal(모음.filter((one) => one === 대리).length, 1);
  });

  it("🔴 한 고지 안에서 여러 줄로 겹쳐도 한 번만 — 기간을 나눠 맡기면 생긴다", () => {
    const 줄들 = [row(), row({ startsAt: new Date("2026-11-10T00:00:00.000Z") })];
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, 줄들), [대리]);
    assert.deepEqual(activeDelegateSubs(줄들, 주인, NOW, 줄들), [대리]);
  });

  it("🔵 사람이 다르면 둘 다 나온다 — 두 사람에게 나눠 맡기는 일도 생긴다", () => {
    assert.deepEqual(activeDelegateSubs([], 주인, NOW, [row(), row({ delegateSub: sub("park") })]), [대리, sub("park")]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 **짝 함수와 같은 규칙을 쓰는가** — 한쪽만 고쳐지는 날 여기가 빨개진다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("④ 알림(거꾸로)과 판정(정방향)이 **같은 자를 쓴다**", () => {
  /**
   * 🔵 **규칙을 베껴 적지 않는다.** 「되돌린 줄은 빠진다」를 여기 적으면 그 순간 같은 규칙이
   * 세 벌(판정·알림·시험)이 되고, 셋이 갈려도 시험은 제 벌만 보고 초록이 된다. 대신 **같은 줄을
   * 두 방향에 넣어 답이 갈리는지**만 본다 — 규칙이 무엇인지는 이 시험이 몰라도 된다.
   *
   * 🔴 갈리는 날 생기는 일: 「결재함에는 뜨는데 메일은 안 오는」(또는 그 반대) 사람. 그 어긋남은
   * **신고로만 드러난다** — 안 온 메일이 있었다는 것은 아무도 알 수 없다.
   */
  const 변주: readonly (readonly [string, Partial<ApprovalDelegationPeriod>])[] = [
    ["지금 살아 있는 줄", {}],
    ["거둔 줄", { revokedAt: new Date("2026-11-05T00:00:00.000Z") }],
    ["거둔 줄(기간 밖에서 거둠)", { revokedAt: new Date("2026-12-05T00:00:00.000Z") }],
    ["이미 끝난 줄", { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-10T00:00:00.000Z") }],
    ["끝나는 바로 그 순간", { endsAt: NOW }],
    ["끝나기 1ms 전", { endsAt: new Date(NOW.getTime() + 1) }],
    ["아직 시작 안 한 줄", { startsAt: new Date(NOW.getTime() + 1), endsAt: ENDS }],
    ["시작하는 바로 그 순간", { startsAt: NOW }],
  ];

  /** 정방향: 대리인이 **주인의 결재권을 쓸 수 있나**. */
  const 판정이본다 = (줄: ApprovalDelegationPeriod, 고지: "이집" | "승인함"): boolean =>
    actingApproverSubs(고지 === "이집" ? [줄] : [], 대리, NOW, 고지 === "승인함" ? [줄] : []).includes(주인);

  /** 거꾸로: 주인의 자리에 결재가 생기면 **대리인에게 알리나**. */
  const 알림이본다 = (줄: ApprovalDelegationPeriod, 고지: "이집" | "승인함"): boolean =>
    activeDelegateSubs(고지 === "이집" ? [줄] : [], 주인, NOW, 고지 === "승인함" ? [줄] : []).includes(대리);

  it("🔵 **표본이 한쪽으로 쏠려 있지 않다** — 아래가 「둘 다 언제나 거짓」으로 공짜 통과하지 않게", () => {
    // 🔴 변주가 전부 「안 걸린다」면 아래 비교는 무엇도 재지 않고 초록이 된다.
    const 걸리는것 = 변주.filter(([, over]) => 알림이본다(row(over), "승인함"));
    assert.ok(걸리는것.length >= 3, `살아 있는 변주가 ${걸리는것.length}개뿐이다 — 표본이 쏠렸다`);
    assert.ok(걸리는것.length < 변주.length, "변주가 전부 살아 있다 — 거르는 쪽을 아무것도 안 재고 있다");
  });

  for (const 고지 of ["이집", "승인함"] as const) {
    it(`🔴 ${고지} 고지: 판정이 보는 줄과 알림이 보는 줄이 **똑같다**`, () => {
      for (const [이름, over] of 변주) {
        const 줄 = row(over);
        assert.equal(
          알림이본다(줄, 고지),
          판정이본다(줄, 고지),
          `${고지} 고지의 「${이름}」을 두 방향이 다르게 읽는다 — 한쪽만 고쳐졌다`,
        );
      }
    });
  }

  it("🔴 **두 고지를 또 서로 맞댄다** — 한 표의 거르기만 고치고 다른 표를 잊으면 깨진다", () => {
    for (const [이름, over] of 변주) {
      const 줄 = row(over);
      assert.equal(알림이본다(줄, "승인함"), 알림이본다(줄, "이집"), `두 표가 「${이름}」을 다르게 읽는다`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 🔴 **배선** — 소스 글자로 (표를 읽는 층은 `server-only` 라 못 부른다)
 * ═════════════════════════════════════════════════════════════════════════ */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 🔴 **주석을 걷어낸 소스.** 이 저장소는 「왜 그렇게 했는가」를 길게 적는 집이라 **내력 설명이
 * 곧 찾는 글자를 품는다.** 걷지 않으면 「읽는다」를 재는 단언이 **주석만으로 영영 통과**한다 —
 * 깨지는 쪽은 바로 보이지만 통과하는 쪽은 아무도 안 본다(`tests/portal-delegation.test.ts` 머리말).
 */
const code = (relative: string): string =>
  src(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** 선언 한 줄부터 **다음 `export` 앞까지.** 🔴 안 끊으면 뒤 함수의 글자에 걸려 헛통과한다. */
function bodyOf(source: string, declaration: string, what: string): string {
  const at = source.indexOf(declaration);
  assert.notEqual(at, -1, `${what} 를 찾지 못했다 — 이름이 바뀌었으면 이 시험도 함께 고칠 것`);
  const end = source.indexOf("\nexport ", at + 1);
  const body = source.slice(at, end === -1 ? undefined : end);
  assert.ok(body.length > 200, `${what} 토막이 너무 짧다(${body.length}자) — 자르기가 깨졌다`);
  return body;
}

describe("⑤ 알림이 읽는 조회가 **두 표에 닿아 있다**", () => {
  const queries = code("src/lib/approval/delegation-queries.ts");
  const pure = code("src/lib/approval/delegation.ts");
  const ping = code("src/lib/notifications/approval-created-ping.ts");

  const 조회 = bodyOf(queries, "export async function activeDelegateSubsFor(", "알림이 쓰는 조회");
  const 합치는함수 = bodyOf(pure, "export function activeDelegateSubs(", "합치는 순수 함수");

  it("🔴 **메일 가는 길이 이 조회에 걸려 있다** — 조회만 고치고 길이 끊겨 있으면 헛일이다", () => {
    assert.ok(ping.includes("activeDelegateSubsFor(approverSub)"), "즉시 알림이 이 조회를 안 쓴다");
    assert.ok(ping.includes("notifyPortalApprovalCreated([approverSub, ...delegateSubs])"), "모은 사람들을 포털에 안 넘긴다");
  });

  it("🔴 **두 표를 읽는다** — 한쪽만 읽으면 그 고지의 대리인이 통째로 빠진다", () => {
    assert.ok(조회.includes(".from(approvalDelegations)"), "이 집의 위임 표를 안 읽는다 — 갈아끼웠다");
    assert.ok(조회.includes(".from(portalApprovalDelegations)"), "승인함 위임 표를 안 읽는다 — 이 조각이 고치려던 바로 그 자리다");
  });

  it("🔴 **승인함 표에도 같은 조건 셋을 건다** — 짝 함수와 글자까지 같은 모양", () => {
    // 🔴 한 조건이라도 빠지면 거둔 줄·끝난 줄의 대리인에게 메일이 가거나 표가 통째로 딸려 온다.
    assert.ok(조회.includes("eq(portalApprovalDelegations.delegatorSub, delegatorSub)"), "자리의 주인으로 안 좁힌다 — 남의 줄까지 읽는다");
    assert.ok(조회.includes("isNull(portalApprovalDelegations.revokedAt)"), "거둔 줄까지 읽는다");
    assert.ok(조회.includes("gt(portalApprovalDelegations.endsAt, now)"), "이미 끝난 줄까지 읽는다");
    // 🔵 제 표 쪽 조건도 그대로 산다(이 조각 전부터 있던 것).
    assert.ok(조회.includes("eq(approvalDelegations.delegatorSub, delegatorSub)"), "제 표에서 자리의 주인으로 안 좁힌다");
    assert.ok(조회.includes("isNull(approvalDelegations.revokedAt)"), "제 표의 거둔 줄까지 읽는다");
    assert.ok(조회.includes("gt(approvalDelegations.endsAt, now)"), "제 표의 끝난 줄까지 읽는다");
  });

  it("🔵 `starts_at` 은 **SQL 로 거르지 않는다** — 두 표 모두, 반열린 구간 판정은 한 곳에만 있다", () => {
    for (const column of ["approvalDelegations.startsAt", "portalApprovalDelegations.startsAt"]) {
      assert.ok(조회.includes(`startsAt: ${column}`), `${column} 을 안 읽어 온다 — 순수 함수가 거를 수 없다`);
      assert.equal(조회.split(column).length - 1, 1, `${column} 을 SQL 에서도 거르고 있다 — 반열린 구간 규칙이 한 벌 더 생긴다`);
    }
  });

  it("🔴 **합치는 자리는 순수 함수 하나다** — 조회가 제 손으로 이어 붙이지 않는다", () => {
    assert.ok(조회.includes("return activeDelegateSubs(rows, delegatorSub, now, portalRows);"), "읽어 온 두 묶음을 **한 자리에서** 순수 함수에 넘기지 않는다");
    // 🔴 조회 쪽에 겹침을 걷는 손이 생기면 규칙이 두 벌이 된다.
    assert.equal(/new Set|concat|\.\.\.rows/.test(조회), false, "조회가 제 손으로 합치거나 겹침을 걷는다");
  });

  it("🔴 **합치는 함수가 규칙을 베껴 적지 않았다** — 두 묶음을 같은 거르개에 넘긴다", () => {
    assert.equal(합치는함수.split("delegateSubsFor(").length - 1, 2, "두 묶음을 같은 순수 함수로 거르지 않는다");
    assert.ok(합치는함수.includes("new Set("), "겹침을 안 걷는다 — 같은 사람이 목록에 두 번 들어간다");
    // 🔴 기간·되돌림을 제 손으로 보기 시작하면 반열린 구간 규칙이 한 벌 더 생긴다.
    for (const 금지 of ["revokedAt", "startsAt", "endsAt", "getTime", "isActiveDelegation"]) {
      assert.equal(합치는함수.includes(금지), false, `합치는 함수가 제 손으로 기간을 본다: ${금지}`);
    }
  });

  it("🔴 **승인함 위임을 넘기는 자리가 선택 인자가 아니다** — 빠뜨린 자리에서만 조용히 안 걸린다", () => {
    assert.equal(/portalDelegations: readonly ApprovalDelegationPeriod\[\] =/.test(합치는함수), false, "기본값이 생겼다 — 안 넘긴 자리가 오류 없이 반쪽이 된다");
    assert.ok(합치는함수.includes("portalDelegations: readonly ApprovalDelegationPeriod[],"), "승인함 묶음을 아예 안 받는다");
  });
});
