import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Role } from "../src/db/schema/users";
import { actingApproverSubs, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";
import {
  APPROVAL_ROUTE_DELEGATED_ADMIN_MESSAGE,
  DELEGATED_ADMIN_SOURCE_ROLE,
  decideDelegatedRole,
  delegatorSubsOf,
  mayChangeApprovalRoute,
} from "../src/lib/approval/delegated-role";
import { mayDecidePartIssueStep } from "../src/lib/approval/part-issue-rules";

/**
 * ============================================================================
 * 결재권 위임이 **역할까지 넘긴다** (2026-11-17, 설계 B-10·B-11)
 * ============================================================================
 * 사용자 결정: 「재고관리의 결재권 위임은 **역할 위임을 포함하는 개념**」이다. `ADMIN` 이 맡기면
 * 대리인은 **그 기간 동안** `ADMIN` 이다. 🔴 **다만 「결재선 설정 변경」만은 주지 않는다**(B-11) —
 * `ADMIN` 이 여는 문 가운데 **그것 하나만 위임 기간을 넘어 남기** 때문이다.
 *
 * ── 여기서 못 박는 것 일곱 ──────────────────────────────────────────────
 *  1. 🔴 `ADMIN` 이 맡긴 위임의 대리인은 임시 `ADMIN` 이 된다 — **두 고지 각각**.
 *  2. 🔴 `ADMIN` 이 아닌 사람이 맡긴 위임은 **역할을 안 넘긴다**.
 *  3. 🔴 거뒀거나 기간이 지난 위임은 **역할을 안 넘긴다** — 「**저절로 닫힌다**」의 증거다.
 *  4. 🔴 **진짜 `ADMIN` 은 좁아지지 않는다** — 위임을 받았다고 임시로 바뀌지 않는다.
 *  5. 🔴 **임시 `ADMIN` 은 결재선을 못 고치고**(B-11), **진짜 `ADMIN` 은 고친다**.
 *  6. 🔴 **결재 판정은 안 바뀌었다** — 역할이 올라가도 결재선에 없으면 못 누른다(설계 D-7 ①).
 *  7. 🔴 그 뜻이 **실제로 그 자리에 걸렸는가** — 소스 글자로(⑦).
 *
 * ── 🔴 규칙을 **베껴 적지 않는다** ──────────────────────────────────────
 * 아래 `지금역할` 은 서버가 하는 일을 **그대로** 한다: 두 묶음을 **진짜 판정 함수**
 * (`actingApproverSubs`)에 넘기고 → 본인을 빼고(`delegatorSubsOf`) → 그 번호들의 역할을
 * `decideDelegatedRole` 에 넘긴다. 기간·되돌림 조건을 이 파일에 한 줄이라도 적으면 그 순간 이
 * 시험이 **「두 벌째 규칙」**이 되어, 저쪽이 바뀌어도 여기만 초록으로 남는다.
 * 🔵 서버와 다른 것은 **역할을 어디서 읽는가** 하나다(저쪽은 `users` 표, 여기는 아래 `명부`).
 * 그 한 걸음은 순수 함수로 닿지 않으므로 ⑦이 소스 글자로 잰다.
 *
 * ── 🔴 이 저장소에는 DB 시험이 없다 ─────────────────────────────────────
 * 표를 읽는 모듈(`src/lib/approval/delegation-queries.ts`)과 세션
 * (`src/lib/auth/session.ts`)은 `server-only` 를 물고 있어 **불러올 수 없다** —
 * `tests/portal-delegation-ping.test.ts` 와 같은 방식이다.
 *
 * 🔴 **값은 전부 가짜다** — 실제 사람 번호도 이름도 한 자 적지 않는다.
 * ============================================================================
 */

const sub = (name: string) => `sub-${name}`;

/** 🔵 가짜 이름이다. 「나」가 위임을 받는 사람이고, 뒤의 둘이 맡기는 쪽이다. */
const 나 = sub("lee");
const 관리자 = sub("kim");
const 기록자 = sub("park");
/** 이 집에 **한 번도 로그인한 적 없는** 결재권자 — `users` 에 줄이 없다(A/S 명부에서 고를 수 있다). */
const 낯선이 = sub("choi");

/**
 * 서버에서 `users` 표가 하는 일. 🔴 **낯선이는 일부러 빠져 있다** — 역할을 못 찾는 위임자가
 * 있어도 승격이 생기지 않는 것을 ⑥이 잰다.
 */
const 명부: Record<string, Role> = { [관리자]: "ADMIN", [기록자]: "STAFF" };

const STARTS = new Date("2026-11-01T00:00:00.000Z");
const ENDS = new Date("2026-11-30T00:00:00.000Z");
const NOW = new Date("2026-11-17T12:00:00.000Z");

/** 위임 한 줄. 🔵 **두 표가 같은 모양이라 지어내는 함수도 하나다**(기간 규칙도 깃발도 같다). */
const row = (over: Partial<ApprovalDelegationPeriod> = {}): ApprovalDelegationPeriod => ({
  delegatorSub: 관리자,
  delegateSub: 나,
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
  ...over,
});

/**
 * 🔴 **서버의 길 그대로다**(머리말). 값만 가짜고 거치는 함수는 운영이 거치는 바로 그 셋이다.
 *
 * @param ownRole 포털이 준 진짜 역할.
 * @param mine 이 집에서 맡긴 위임 줄들(`approval_delegations`).
 * @param portal 승인함에서 맡겨 포털이 써 준 줄들(`portal_approval_delegations`).
 */
function 지금역할(
  ownRole: Role,
  mine: readonly ApprovalDelegationPeriod[],
  portal: readonly ApprovalDelegationPeriod[],
  now: Date = NOW,
) {
  const 위임자들 = delegatorSubsOf(actingApproverSubs(mine, 나, now, portal), 나);
  const 역할들 = 위임자들.map((s) => 명부[s]).filter((r): r is Role => r !== undefined);
  return decideDelegatedRole(ownRole, 역할들);
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 🔴 `ADMIN` 이 맡기면 역할이 따라간다 — **두 고지 각각**
 * ═════════════════════════════════════════════════════════════════════════ */

describe("① 🔴 ADMIN 이 맡긴 위임의 대리인은 임시 ADMIN 이 된다", () => {
  it("🔵 **표본이 비어 있지 않다** — 위임이 없으면 아무 일도 없다(아래가 공짜로 통과하지 않게)", () => {
    // 🔴 이 줄이 없으면 「위임이 안 걸려서」 생긴 초록과 「제대로 안 올려서」 생긴 초록을 가를
    //    수 없다. 먼저 **아무 일도 안 일어나는 바닥**을 못 박는다.
    assert.deepEqual(지금역할("STAFF", [], []), { role: "STAFF", delegatedAdmin: false });
    assert.deepEqual(지금역할("VIEWER", [], []), { role: "VIEWER", delegatedAdmin: false });
    assert.equal(명부[관리자], "ADMIN", "표본의 관리자가 관리자가 아니다 — 아래 전부가 뜻을 잃는다");
  });

  it("🔴 **이 집의 위임**으로 올라간다", () => {
    assert.deepEqual(지금역할("STAFF", [row()], []), { role: "ADMIN", delegatedAdmin: true });
  });

  it("🔴 **승인함에서 맡긴 위임**으로도 올라간다 — 한쪽만 보면 여기서 빨개진다", () => {
    // 🔴 두 표 가운데 하나만 읽으면 「승인함에서 맡겼는데 역할이 안 따라오는」 사람이 생기고,
    //    그 증상은 「관리자 메뉴가 안 보인다」 하나뿐이라 코드에서 찾을 단서가 없다.
    assert.deepEqual(지금역할("STAFF", [], [row()]), { role: "ADMIN", delegatedAdmin: true });
  });

  it("🔴 **역할과 무관하게** 받는다 — 보기 권한자도 올라간다(결재자는 누구나 될 수 있다)", () => {
    assert.deepEqual(지금역할("VIEWER", [row()], []), { role: "ADMIN", delegatedAdmin: true });
    assert.deepEqual(지금역할("VIEWER", [], [row()]), { role: "ADMIN", delegatedAdmin: true });
  });

  it("🔵 둘 다 있어도, 남의 줄이 섞여 있어도 답은 같다", () => {
    assert.deepEqual(지금역할("STAFF", [row()], [row()]), { role: "ADMIN", delegatedAdmin: true });
    // 🔴 **내가 받은 줄이 아니면** 아무것도 아니다 — `delegate_sub` 가 나일 때만 본다.
    assert.deepEqual(지금역할("STAFF", [row({ delegateSub: 기록자 })], []), { role: "STAFF", delegatedAdmin: false });
    assert.deepEqual(지금역할("STAFF", [], [row({ delegateSub: 기록자 })]), { role: "STAFF", delegatedAdmin: false });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 🔴 `ADMIN` 이 아닌 사람이 맡긴 위임은 역할을 안 넘긴다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("② 🔴 ADMIN 이 아닌 위임자는 역할을 넘기지 않는다", () => {
  for (const [고지, 묶음] of [
    ["이 집의 위임", (r: ApprovalDelegationPeriod) => 지금역할("VIEWER", [r], [])],
    ["승인함 위임", (r: ApprovalDelegationPeriod) => 지금역할("VIEWER", [], [r])],
  ] as const) {
    it(`${고지} — 기록 권한자가 맡겨도 보기 권한자는 보기 권한자다`, () => {
      assert.deepEqual(묶음(row({ delegatorSub: 기록자 })), { role: "VIEWER", delegatedAdmin: false });
    });
  }

  it("🔴 **결재권은 그대로 넘어간다** — 안 넘어가는 것은 역할뿐이다", () => {
    // 🔵 이 조각이 결재권 위임을 **좁히지 않았다**는 증거다. 역할만 안 따라갈 뿐 대리 결재는 된다.
    const 쓸수있는번호 = actingApproverSubs([row({ delegatorSub: 기록자 })], 나, NOW, []);
    assert.deepEqual([...쓸수있는번호], [나, 기록자]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 🔴 거뒀거나 기간이 지난 위임은 역할을 안 넘긴다 — 「저절로 닫힌다」
 * ═════════════════════════════════════════════════════════════════════════ */

describe("③ 🔴 기간이 끝나거나 거둔 위임은 역할을 안 넘긴다 — 저절로 닫히는 증거", () => {
  /**
   * 🔴 **야간 작업도 만료 처리도 없다**(설계 D-7 ④). 「지금 유효한가」를 **판정 시점에** 보므로
   *    기간이 지나면 그 다음 요청부터 그냥 닫힌다. 이 변주 여섯이 그것을 잰다.
   * 🔵 변주 이름은 뜻이고, **판정은 아래 `지금역할` 이 진짜 함수로 한다** — 여기에 「끝을
   *    포함하나」를 적지 않는다.
   */
  const 닫히는줄: [string, Partial<ApprovalDelegationPeriod>, Date][] = [
    ["거둔 줄", { revokedAt: new Date("2026-11-10T00:00:00.000Z") }, NOW],
    ["기간 **밖**에서 거둔 줄도 마찬가지", { revokedAt: new Date("2099-01-01T00:00:00.000Z") }, NOW],
    ["이미 끝난 줄", {}, new Date("2026-12-01T00:00:00.000Z")],
    ["끝나는 **바로 그 순간**(끝은 포함하지 않는다)", {}, ENDS],
    ["아직 시작 전", {}, new Date("2026-10-31T23:59:59.999Z")],
  ];

  for (const [무엇, over, now] of 닫히는줄) {
    it(`이 집의 위임 — ${무엇}`, () => {
      assert.deepEqual(지금역할("STAFF", [row(over)], [], now), { role: "STAFF", delegatedAdmin: false });
    });
    it(`승인함 위임 — ${무엇}`, () => {
      assert.deepEqual(지금역할("STAFF", [], [row(over)], now), { role: "STAFF", delegatedAdmin: false });
    });
  }

  it("🔵 **그 가장자리 바로 안쪽에서는 열려 있다** — 닫히는 쪽만 재면 「언제나 닫힘」도 통과한다", () => {
    const 끝나기1밀리초전 = new Date(ENDS.getTime() - 1);
    assert.deepEqual(지금역할("STAFF", [row()], [], 끝나기1밀리초전), { role: "ADMIN", delegatedAdmin: true });
    assert.deepEqual(지금역할("STAFF", [], [row()], 끝나기1밀리초전), { role: "ADMIN", delegatedAdmin: true });
    // 🔵 시작하는 **그 순간**은 포함한다(반열린 구간 `[starts_at, ends_at)`).
    assert.deepEqual(지금역할("STAFF", [row()], [], STARTS), { role: "ADMIN", delegatedAdmin: true });
    assert.deepEqual(지금역할("STAFF", [], [row()], STARTS), { role: "ADMIN", delegatedAdmin: true });
  });

  it("🔴 한 줄이 닫혀도 **다른 살아 있는 줄**이 있으면 그대로 열려 있다", () => {
    assert.deepEqual(
      지금역할("STAFF", [row({ revokedAt: new Date("2026-11-10T00:00:00.000Z") })], [row()]),
      { role: "ADMIN", delegatedAdmin: true },
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 진짜 `ADMIN` 은 좁아지지 않는다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("④ 🔴 진짜 ADMIN 은 위임을 받아도 임시로 바뀌지 않는다 — 역할이 둘이면 높은 쪽이 이긴다", () => {
  it("ADMIN 이 ADMIN 의 대리인이어도 `delegatedAdmin` 은 거짓이다", () => {
    // 🔴 여기가 참이 되면 그 사람은 **위임을 받았다는 이유만으로** 결재선 설정을 잃는다(B-11).
    assert.deepEqual(지금역할("ADMIN", [row()], []), { role: "ADMIN", delegatedAdmin: false });
    assert.deepEqual(지금역할("ADMIN", [], [row()]), { role: "ADMIN", delegatedAdmin: false });
  });

  it("위임이 하나도 없는 ADMIN 도 그대로다", () => {
    assert.deepEqual(지금역할("ADMIN", [], []), { role: "ADMIN", delegatedAdmin: false });
  });

  it("🔵 넘기는 쪽의 기준 역할이 상수로 한 자리에 있다", () => {
    assert.equal(DELEGATED_ADMIN_SOURCE_ROLE, "ADMIN");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 🔴 B-11 — 임시 `ADMIN` 은 결재선 설정을 못 바꾼다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑤ 🔴 B-11 — 결재선 설정만은 임시 ADMIN 에게 주지 않는다", () => {
  it("🔴 임시 ADMIN 은 **못 바꾼다** — 그 설정만 위임 기간을 넘어 남는다", () => {
    const 임시 = 지금역할("STAFF", [row()], []);
    assert.equal(임시.delegatedAdmin, true, "표본이 임시 관리자가 아니다 — 아래가 뜻을 잃는다");
    assert.equal(mayChangeApprovalRoute(임시.role, 임시.delegatedAdmin), false);
  });

  it("🔴 **진짜 ADMIN 은 바꾼다** — 넓히면서 관리자에게서 무엇을 빼앗지 않았다", () => {
    const 진짜 = 지금역할("ADMIN", [row()], []);
    assert.equal(mayChangeApprovalRoute(진짜.role, 진짜.delegatedAdmin), true);
    assert.equal(mayChangeApprovalRoute("ADMIN", false), true);
  });

  it("🔵 애초에 관리자가 아닌 사람은 그대로 못 바꾼다", () => {
    for (const role of ["VIEWER", "STAFF"] as const) {
      assert.equal(mayChangeApprovalRoute(role, false), false);
    }
  });

  it("🔴 막힌 사람이 **까닭을 읽을 수 있다** — 「권한이 없습니다」로 끝내지 않는다", () => {
    // 🔴 임시 관리자에게는 다른 관리자 화면이 전부 열려 있다. 왜 이것만 안 되는지 적어 주지
    //    않으면 그 사람은 고장으로 읽고, 되는 길(관리자에게 요청)도 모른다.
    assert.match(APPROVAL_ROUTE_DELEGATED_ADMIN_MESSAGE, /위임/, "무엇이 막았는지 안 적혀 있다");
    assert.match(APPROVAL_ROUTE_DELEGATED_ADMIN_MESSAGE, /기간이 끝난 뒤에도 그대로 남/, "왜 막는지 안 적혀 있다");
    assert.match(APPROVAL_ROUTE_DELEGATED_ADMIN_MESSAGE, /관리자에게 요청/, "어떻게 하라는지 안 적혀 있다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ 🔴 역할을 못 찾는 위임자는 승격을 만들지 않는다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑥ 🔴 이 집에 로그인한 적 없는 위임자 — 결재권만 넘어가고 역할은 안 넘어간다", () => {
  it("명부에 없는 번호는 역할을 못 준다", () => {
    assert.equal(명부[낯선이], undefined, "표본이 틀렸다 — 낯선이가 명부에 있다");
    assert.deepEqual(지금역할("STAFF", [row({ delegatorSub: 낯선이 })], []), { role: "STAFF", delegatedAdmin: false });
    assert.deepEqual(지금역할("STAFF", [], [row({ delegatorSub: 낯선이 })]), { role: "STAFF", delegatedAdmin: false });
  });

  it("🔵 그래도 **결재권은 넘어간다** — 두 문이 다르다는 것이 이 조각의 전제다", () => {
    assert.deepEqual([...actingApproverSubs([row({ delegatorSub: 낯선이 })], 나, NOW, [])], [나, 낯선이]);
  });

  it("🔵 섞여 있으면 **ADMIN 한 명으로 충분하다**", () => {
    assert.deepEqual(
      지금역할("STAFF", [row({ delegatorSub: 낯선이 }), row({ delegatorSub: 기록자 }), row()], []),
      { role: "ADMIN", delegatedAdmin: true },
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑦ 🔴 결재 판정은 **안 바뀌었다** (설계 D-7 ①)
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑦ 🔴 역할이 올라가도 결재는 그대로다 — 결재선에 없으면 못 누른다", () => {
  const 남의단계 = { approverSub: 기록자, status: "REQUESTED" } as const;

  it("🔴 임시 ADMIN 이어도 **남의 단계는 못 누른다**", () => {
    const 쓸수있는번호 = actingApproverSubs([row()], 나, NOW, []);
    assert.equal(지금역할("STAFF", [row()], []).delegatedAdmin, true, "표본이 임시 관리자가 아니다");
    assert.equal(mayDecidePartIssueStep(남의단계, 쓸수있는번호), false, "역할이 결재 판정에 끼어들었다");
  });

  it("🔴 **진짜 ADMIN 도 못 누른다** — 애초에 역할이 여는 문이 아니다", () => {
    assert.equal(mayDecidePartIssueStep(남의단계, actingApproverSubs([], 나, NOW, [])), false);
  });

  it("🔵 **맡긴 사람의 단계는 누른다** — 좁아지지 않았다", () => {
    const 쓸수있는번호 = actingApproverSubs([row()], 나, NOW, []);
    assert.equal(mayDecidePartIssueStep({ approverSub: 관리자, status: "REQUESTED" }, 쓸수있는번호), true);
    assert.equal(mayDecidePartIssueStep({ approverSub: 나, status: "REQUESTED" }, 쓸수있는번호), true);
  });
});

/* ------------------------------------------------------------------ */
/* ⑧ 🔴 그 뜻이 **그 자리에 걸렸는가** — 소스 글자로                      */
/*     세션과 표 읽기는 `server-only` 라 불러올 수 없다.                  */
/* ------------------------------------------------------------------ */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 주석을 걷어낸 코드만. 🔴 **이 파일들의 머리말에는 「DB 의 역할 칸을 쓰지 마라」 같은 말이
 * 일부러 적혀 있다** — 주석이 코드 대신 걸리면 그 주석을 지우는 쪽으로 사람이 움직인다
 * (`tests/settings-access.test.ts` 와 같은 자리·같은 함수).
 */
function codeOnly(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const open = line.indexOf("/*");
      if (open === -1) break;
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        line = line.slice(0, open);
        inBlock = true;
        break;
      }
      line = line.slice(0, open) + line.slice(close + 2);
    }
    const slash = line.indexOf("//");
    if (slash !== -1) line = line.slice(0, slash);
    out.push(line);
  }
  return out.join("\n");
}

const SESSION = "src/lib/auth/session.ts";
const QUERIES = "src/lib/approval/delegation-queries.ts";
const ROUTE_ACTION = "src/app/actions/approval-routes.ts";
const DECIDE_ACTION = "src/app/actions/part-issue.ts";

describe("⑧ 🔴 승격이 **역할을 읽는 그 자리**에 꽂혔다", () => {
  const session = codeOnly(src(SESSION));

  it("🔵 **표본이 비어 있지 않다** — 세션 파일을 제대로 읽었나", () => {
    assert.ok(session.includes("export const getSession"), "세션 읽는 자리를 못 찾았다 — 아래가 아무것도 안 재고 있다");
    assert.ok(session.length > 1000, `세션 코드가 ${session.length}자뿐이다 — 주석 걷어내기가 깨졌다`);
  });

  it("🔴 세션이 **판정을 거쳐** 역할을 올린다 — 제 손으로 ADMIN 을 적지 않는다", () => {
    assert.match(session, /activeDelegatorRolesFor\(payload\.sub\)/, "위임자들의 역할을 읽어 오지 않는다");
    assert.match(session, /decideDelegatedRole\(actualRole, delegatorRoles\)/, "판정을 순수 함수에 안 맡긴다");
    assert.match(session, /if \(delegated\.delegatedAdmin\) effective = \{ \.\.\.effective, role: delegated\.role \};/, "승격이 실제로 안 꽂혀 있다");
    assert.match(session, /delegatedAdmin: delegated\.delegatedAdmin,/, "B-11 이 볼 깃발을 세션이 안 싣는다");
  });

  it("🔴 **DB 의 역할 칸을 바꿔 쓰지 않는다** — 기간이 끝나면 저절로 닫혀야 한다(설계 D-7 ④)", () => {
    // 🔴 칸에 적는 순간 「여는 조건과 닫는 조건이 다른 곳에」 생기고, 화면에서 내릴 수 없는
    //    권한이 남는다. 세션은 역할을 **읽기만** 한다.
    assert.equal(session.includes(".update("), false, "세션이 표를 고친다 — 역할을 칸에 적는 길이 생겼다");
    assert.equal(session.includes("users.role"), false, "세션이 역할 칸을 직접 만진다");
  });

  it("🔴 **진짜 ADMIN 에게는 묻지 않는다** — 좁아지지도, 매 요청마다 질의 둘을 돌리지도 않게", () => {
    assert.match(session, /if \(!roleAtLeast\(actualRole, DELEGATED_ADMIN_SOURCE_ROLE\)\)/, "진짜 관리자까지 위임을 읽는다");
  });

  it("🔴 **못 읽었으면 안 올린다**(fail-close) — 그리고 반드시 로그에 남긴다", () => {
    assert.match(session, /catch \(e\) \{/, "조회 실패를 안 받아 낸다 — 위임과 무관한 사람까지 500 이 된다");
    assert.match(session, /역할 위임 조회 실패/, "실패가 아무 자국도 안 남긴다 — 증상이 「안 열린다」 하나뿐이다");
  });
});

describe("⑧-2 🔴 표를 읽는 층이 **판정을 새로 짓지 않는다**", () => {
  const queries = codeOnly(src(QUERIES));
  const 본문 = (() => {
    const at = queries.indexOf("export async function activeDelegatorRolesFor(");
    assert.notEqual(at, -1, "역할을 읽어 오는 자리가 사라졌다 — 이 시험이 아무것도 안 재고 있다");
    const end = queries.indexOf("\nexport ", at + 1);
    return queries.slice(at, end === -1 ? undefined : end);
  })();

  it("🔴 **판정 함수를 지나서** 위임자들을 구한다 — 조건절을 제 손으로 적지 않는다", () => {
    assert.ok(본문.includes("delegatorSubsOf(await actingApproverSubsFor(actorSub, db(), now), actorSub)"), "두 고지를 합치는 자리를 안 지난다");
    // 🔴 여기에 기간·되돌림이 한 줄이라도 생기면 반열린 구간 규칙이 한 벌 더 생긴다.
    for (const 금지 of ["revokedAt", "startsAt", "endsAt", "getTime", "isActiveDelegation", "portalApprovalDelegations"]) {
      assert.equal(본문.includes(금지), false, `역할 조회가 제 손으로 기간을 본다: ${금지}`);
    }
  });

  it("🔴 **지워진 사람은 역할을 넘기지 않는다** — 그만둔 계정이 임시 관리자를 찍어 내면 안 된다", () => {
    assert.ok(본문.includes("eq(users.isDeleted, false)"), "지워진 사람의 역할까지 읽는다");
    assert.ok(본문.includes("inArray(users.authSub, delegatorSubs)"), "위임자 번호로 안 좁힌다");
  });

  it("🔵 빈 목록이면 **질의를 안 돌린다** — `inArray(…, [])` 는 조용히 0행이 된다", () => {
    assert.ok(본문.includes("if (delegatorSubs.length === 0) return [];"), "빈 목록을 그대로 질의에 넣는다");
  });

  it("🔴 **역할 칸은 읽기만 한다**", () => {
    assert.equal(본문.includes(".update("), false, "역할을 읽는 자리가 표를 고친다");
  });
});

describe("⑧-3 🔴 B-11 이 **서버 액션**에 걸렸다 — 화면 분기가 아니라", () => {
  const action = codeOnly(src(ROUTE_ACTION));

  it("저장하는 액션이 묻고, 거절 문구를 **그 자리에서** 돌려준다", () => {
    assert.match(action, /if \(!mayChangeApprovalRoute\(session\.user\.role, session\.delegatedAdmin\)\)/, "B-11 을 안 묻는다 — 임시 관리자가 결재선을 고친다");
    assert.match(action, /return \{ ok: false, message: APPROVAL_ROUTE_DELEGATED_ADMIN_MESSAGE \};/, "까닭을 안 돌려준다");
  });

  it("🔴 **문은 그대로 `requireRole(\"ADMIN\")`** 이다 — B-11 을 문으로 바꿔 달지 않았다", () => {
    // 🔴 문으로 막으면 `/forbidden` 으로 튕겨 **막힌 까닭을 볼 자리가 없고**, 지금 절차가 어떻게
    //    돼 있는지조차 못 본다.
    assert.match(action, /const session = await requireRole\("ADMIN"\);/, "관리자 문이 사라졌다");
  });

  it("🔴 **화면 쪽 문은 손대지 않았다** — 읽는 것까지 막으면 넓히려던 것이 좁혀진다", () => {
    const page = codeOnly(src("src/app/(app)/settings/approval-routes/page.tsx"));
    assert.ok(page.includes('await requireRole("ADMIN", "/settings/approval-routes")'), "화면의 관리자 문이 바뀌었다");
    assert.equal(page.includes("delegatedAdmin"), false, "막는 자리가 화면 분기로 옮겨 갔다 — 액션이 울타리다");
  });
});

describe("⑧-4 🔴 **결재 쪽은 한 글자도 안 바뀌었다**", () => {
  it("결재(승인·반려) 액션의 문은 그대로 `requireSession` 이다", () => {
    const decide = codeOnly(src(DECIDE_ACTION));
    const at = decide.indexOf("export async function decidePartIssueAction(");
    assert.notEqual(at, -1, "결재 액션이 사라졌다");
    const body = decide.slice(at, decide.indexOf("\nexport ", at + 1));
    assert.match(body, /await requireSession\(APPROVALS\)/, "결재가 역할로 막히기 시작했다 — 보기 권한자가 제 차례를 못 누른다");
    assert.equal(body.includes("delegatedAdmin"), false, "역할 위임이 결재 판정에 끼어들었다");
    assert.equal(body.includes("requireRole"), false, "결재 액션이 역할 문을 달았다");
  });

  it("🔴 **결재 판정 모듈은 역할이라는 것을 아예 모른다**", () => {
    const 판정 = codeOnly(src("src/lib/approval/delegation.ts"));
    assert.ok(판정.includes("export function actingApproverSubs("), "판정 함수를 못 찾았다 — 아래가 공짜로 통과한다");
    assert.equal(판정.includes("Role"), false, "결재 판정이 역할을 들여다보기 시작했다(설계 D-7 ①)");
    assert.equal(판정.includes("delegatedAdmin"), false, "결재 판정에 역할 위임이 들어왔다");
  });
});
