import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Role } from "../src/db/schema/users";
import { DELEGATION_MANAGE_ROLE, mayManageOthersDelegations } from "../src/lib/approval/delegation-authority";
import {
  resolveDelegateFromDirectory,
  resolveDelegatorFromDirectory,
  validateDelegationInput,
  DELEGATE_FOR_OTHERS_FORBIDDEN_MESSAGE,
  SELF_DELEGATION_MESSAGE,
  UNKNOWN_DELEGATOR_MESSAGE,
} from "../src/lib/approval/delegation-input";
import { delegationCreatorLabel } from "../src/lib/approval/delegation-screen";
import { DIRECTORY_UNREACHABLE_SAVE_MESSAGE, type AsUser, type AsUserDirectory } from "../src/lib/approval/directory";

/**
 * ============================================================================
 * 결재권 위임 — **「남의 것까지 되는가」** 의 울타리 (2026-10-26)
 * ============================================================================
 * 2026-10-21 에는 **본인만** 자기 결재권을 맡길 수 있었다. 자리를 갑자기 비우게 된 사람
 * (병가·사고)은 본인이 설정할 수 없어서 **관리자가 남의 결재권도** 맡길 수 있게 넓혔다
 * (사용자 결정). 지금 규칙은 한 줄이다 — 🔴 **본인 것이면 누구나, 남의 것이면 `ADMIN`.**
 *
 * 🔴 **넓히는 변경이라 「되는가」만큼 「여전히 되는가」가 중요하다.** 지금까지 자기 결재권을
 * 맡길 수 있던 사람(보기 권한자 포함)이 못 하게 되면 **이 기능이 풀려던 문제가 그대로
 * 돌아온다.** 그래서 아래 ①은 **역할 셋 전부**로 본인 위임을 돌려 본다.
 *
 * 🔴 **이 저장소에는 DB 시험이 없다.** 그래서 두 겹으로 잰다:
 *   · 뜻은 **순수 함수**로(①~③) — 실제로 돌려 보고 값을 맞대어 본다.
 *   · 그 뜻이 **그 자리에 정말 걸렸는지**는 소스 글자로(④) — 조건절·조회·화면.
 *
 * 🔵 만들기·되돌리기 조건절 자체의 글자는 `tests/approval-delegation-create.test.ts` ①②가
 *    이미 잰다. 여기서는 **겹치지 않는 것**만 본다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 🔴 함수 하나만 잘라 낸다 — 파일 전체에서 찾으면 **옆 함수가 대신 통과시킨다.** */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 가 사라졌다`);
  const end = source.indexOf("\nexport ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

const uuid = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;

/** A/S 사용자 id 와 포털 번호가 **다른 값**이라는 것을 본보기에서부터 못 박는다. */
const ME_ID = uuid("1");
const BOSS_ID = uuid("2");
const DELEGATE_ID = uuid("3");
const NO_SSO_ID = uuid("4");
const ME_SUB = "sub-me";
const BOSS_SUB = "sub-boss";
const DELEGATE_SUB = "sub-delegate";

const asUser = (over: Partial<AsUser> & Pick<AsUser, "id" | "name">): AsUser => ({
  email: `${over.id}@example.com`,
  role: "AS_ENGINEER",
  ssoSubject: null,
  ...over,
});

const DIRECTORY: AsUserDirectory = {
  status: "ok",
  users: [
    asUser({ id: ME_ID, name: "나", ssoSubject: ME_SUB }),
    asUser({ id: BOSS_ID, name: "자리비운분", ssoSubject: BOSS_SUB }),
    asUser({ id: DELEGATE_ID, name: "대신할분", ssoSubject: DELEGATE_SUB }),
    // 🔵 포털로 한 번도 안 들어온 사람 — 명부에는 있지만 결재권을 가리킬 수 없다.
    asUser({ id: NO_SSO_ID, name: "미로그인", ssoSubject: null }),
  ],
};

const ACTOR = { name: "나", sub: ME_SUB };

const ROLES: readonly Role[] = ["VIEWER", "STAFF", "ADMIN"];

/* ------------------------------------------------------------------ */
/* ① 🔴 본인 결재권 — **역할과 무관하게** 된다                           */
/* ------------------------------------------------------------------ */

describe("① 🔴 본인 결재권은 **역할과 무관하게** 맡길 수 있다 — 좁아지지 않았다", () => {
  it("🔴 역할 셋 **전부**가 본인 위임을 세운다 (비워 보낸 경우)", () => {
    for (const role of ROLES) {
      const r = resolveDelegatorFromDirectory(DIRECTORY, null, ACTOR, mayManageOthersDelegations(role));
      assert.ok(r.ok, `${role} 가 자기 결재권을 못 맡긴다 — 넓히려다 좁혔다`);
      assert.deepEqual(r.delegator, { name: "나", sub: ME_SUB, isSelf: true }, role);
    }
  });

  it("🔴 **자기 번호를 골라 보내도** 본인 위임이다 — 비워 보낸 것과 같은 결과", () => {
    // 🔴 관리자가 고르개에서 제 이름을 고르는 일은 흔하다. 그때 자격을 먼저 물으면 관리자가
    //    아닌 사람이 같은 요청을 보냈을 때 거절당한다 — 「본인 것이면 누구나」가 깨진다.
    for (const role of ROLES) {
      const r = resolveDelegatorFromDirectory(DIRECTORY, ME_ID, ACTOR, mayManageOthersDelegations(role));
      assert.ok(r.ok, role);
      assert.equal(r.delegator.isSelf, true, role);
      assert.equal(r.delegator.sub, ME_SUB, role);
    }
  });

  it("🔵 명부를 못 받아 와도 **본인 위임은 선다** — 이름도 번호도 세션에 있다", () => {
    // 🔵 명부가 필요한 쪽은 「대신할 분」이고, 그쪽은 따로 거절한다(③).
    const r = resolveDelegatorFromDirectory({ status: "unreachable", reason: "timeout" }, null, ACTOR, false);
    assert.ok(r.ok);
    assert.equal(r.delegator.isSelf, true);
  });
});

/* ------------------------------------------------------------------ */
/* ② 🔴 남의 결재권 — 관리자만                                           */
/* ------------------------------------------------------------------ */

describe("② 🔴 남의 결재권은 **`ADMIN` 만** 맡길 수 있다", () => {
  it("🔴 관리자가 아니면 **거절**한다 — 보기·기록 둘 다", () => {
    for (const role of ["VIEWER", "STAFF"] as const) {
      const r = resolveDelegatorFromDirectory(DIRECTORY, BOSS_ID, ACTOR, mayManageOthersDelegations(role));
      assert.equal(r.ok, false, `${role} 가 남의 결재권을 맡겼다`);
      assert.equal(r.code, "FORBIDDEN", role);
      assert.equal(r.message, DELEGATE_FOR_OTHERS_FORBIDDEN_MESSAGE, role);
      // 🔴 영어 개발자 메시지가 새어 나가지 않는다(CLAUDE.md 10절).
      assert.doesNotMatch(r.message, /forbidden|permission|role/i, role);
    }
  });

  it("🔴 관리자는 **된다** — 맡기는 사람은 고른 그 사람의 포털 번호다", () => {
    const r = resolveDelegatorFromDirectory(DIRECTORY, BOSS_ID, ACTOR, mayManageOthersDelegations("ADMIN"));
    assert.ok(r.ok, "넓힌 길이 막혀 있다 — 자리를 갑자기 비운 사람의 결재가 선다");
    assert.deepEqual(r.delegator, { name: "자리비운분", sub: BOSS_SUB, isSelf: false });
    // 🔴 누른 사람의 번호가 들어가면 **엉뚱한 사람의 결재권**이 넘어간다.
    assert.notEqual(r.delegator.sub, ME_SUB);
  });

  it("🔴 관리자여도 **명부에 없는 사람**의 결재권은 못 맡긴다", () => {
    const r = resolveDelegatorFromDirectory(DIRECTORY, uuid("ff"), ACTOR, true);
    assert.equal(r.ok, false);
    assert.equal(r.code, "UNKNOWN_DELEGATOR");
    assert.equal(r.message, UNKNOWN_DELEGATOR_MESSAGE);
  });

  it("🔴 관리자여도 **포털 번호가 없는 사람**의 결재권은 못 맡긴다 — 가리킬 수가 없다", () => {
    const r = resolveDelegatorFromDirectory(DIRECTORY, NO_SSO_ID, ACTOR, true);
    assert.equal(r.ok, false);
    assert.equal(r.code, "NO_SSO_SUBJECT");
    // 🔴 **누구인지와 고치는 길**을 함께 적는다 — 이름이 없으면 누구를 빼야 할지 알 수 없다.
    assert.match(r.message, /미로그인 님/);
    assert.match(r.message, /통합 로그인/);
  });

  it("🔴 관리자여도 **명부를 못 받아 왔으면** 남의 결재권은 못 맡긴다", () => {
    // 🔴 확인할 수 없는 채로 세우면 번호가 안 맞는 줄이 서고, 그 위임은 아무 일도 안 한다.
    for (const reason of ["not_configured", "timeout", "error"] as const) {
      const r = resolveDelegatorFromDirectory({ status: "unreachable", reason }, BOSS_ID, ACTOR, true);
      assert.equal(r.ok, false, reason);
      assert.equal(r.code, "DIRECTORY_UNREACHABLE", reason);
      assert.equal(r.message, DIRECTORY_UNREACHABLE_SAVE_MESSAGE, reason);
    }
  });

  it("🔴 역할 사다리의 기준은 **`ADMIN`** 이다 — 그 아래는 전부 거짓", () => {
    assert.equal(DELEGATION_MANAGE_ROLE, "ADMIN");
    assert.deepEqual(ROLES.map(mayManageOthersDelegations), [false, false, true]);
  });
});

/* ------------------------------------------------------------------ */
/* ③ 🔴 「자기 자신에게」의 기준은 **결재권자**다                          */
/* ------------------------------------------------------------------ */

describe("③ 🔴 관리자가 **자기를 대리인으로** 세우는 것은 막지 않는다", () => {
  /** 관리자가 「자리비운분」의 결재권을 **자기에게** 맡긴다. */
  const delegatorOfBoss = () => {
    const r = resolveDelegatorFromDirectory(DIRECTORY, BOSS_ID, ACTOR, true);
    assert.ok(r.ok);
    return r.delegator;
  };

  it("🔴 A → 관리자 는 **통과한다**(2026-10-26 사용자 결정)", () => {
    // 🔴 「자기 자신에게」 판정의 기준은 **결재권자**이지 누르는 사람이 아니다. 누르는 사람을
    //    기준으로 삼으면 이 평범한 쓰임(자리를 비운 사람을 내가 대신한다)이 통째로 막힌다.
    const r = resolveDelegateFromDirectory(DIRECTORY, ME_ID, delegatorOfBoss().sub);
    assert.ok(r.ok, "관리자가 자기를 대리인으로 세우는 길이 막혔다 — 막지 않기로 한 결정이다");
    assert.deepEqual(r.delegate, { id: ME_ID, name: "나", sub: ME_SUB });
  });

  it("🔴 그래도 A → A 는 막는다 — 뜻이 없는 줄이고 DB CHECK 도 막는다", () => {
    const r = resolveDelegateFromDirectory(DIRECTORY, BOSS_ID, delegatorOfBoss().sub);
    assert.equal(r.ok, false);
    assert.equal(r.code, "SELF_DELEGATION");
    assert.equal(r.message, SELF_DELEGATION_MESSAGE);
    // 🔴 문구에 「자기 자신에게」가 남아 있으면 관리자에게는 **거짓말**이 된다(A 의 것을 맡기는 중이다).
    assert.doesNotMatch(r.message, /자기 자신에게/);
  });

  it("🔵 본인 위임에서도 A → A 는 그대로 막힌다 — 넓히면서 느슨해지지 않았다", () => {
    const me = resolveDelegatorFromDirectory(DIRECTORY, null, ACTOR, false);
    assert.ok(me.ok);
    assert.equal(resolveDelegateFromDirectory(DIRECTORY, ME_ID, me.delegator.sub).ok, false);
    // 🔵 다른 사람에게는 멀쩡히 맡겨진다 — 막힌 것이 「자기에게」뿐임을 함께 본다.
    assert.equal(resolveDelegateFromDirectory(DIRECTORY, DELEGATE_ID, me.delegator.sub).ok, true);
  });
});

/* ------------------------------------------------------------------ */
/* ③-2 🔴 입력부터 끝까지 한 바퀴                                        */
/* ------------------------------------------------------------------ */

describe("③-2 🔴 폼 값부터 「누구의 결재권」이 정해지기까지 한 바퀴", () => {
  const form = (over: Record<string, unknown> = {}) => ({
    delegateUserId: DELEGATE_ID,
    startDate: "2026-10-27",
    endDate: "2026-10-30",
    reason: "병가",
    ...over,
  });

  /** 화면 → 검증 → 「누구의 결재권」 풀기까지. 🔵 실제 쓰는 층이 밟는 차례 그대로다. */
  function run(role: Role, over: Record<string, unknown> = {}) {
    const validated = validateDelegationInput(form(over));
    assert.ok(validated.ok, "검증이 거절했다");
    return resolveDelegatorFromDirectory(DIRECTORY, validated.delegatorUserId, ACTOR, mayManageOthersDelegations(role));
  }

  it("🔴 관리자가 아닌 사람의 화면(칸 없음) → **본인** 위임", () => {
    const r = run("STAFF");
    assert.ok(r.ok);
    assert.equal(r.delegator.isSelf, true);
  });

  it("🔴 관리자 화면에서 **본인 줄**을 그대로 둔 채 보냄(빈 글자) → **본인** 위임", () => {
    const r = run("ADMIN", { delegatorUserId: "" });
    assert.ok(r.ok);
    assert.equal(r.delegator.sub, ME_SUB);
  });

  it("🔴 관리자가 남의 이름을 골라 보냄 → **그 사람**의 위임", () => {
    const r = run("ADMIN", { delegatorUserId: BOSS_ID });
    assert.ok(r.ok);
    assert.equal(r.delegator.sub, BOSS_SUB);
    assert.equal(r.delegator.isSelf, false);
  });

  it("🔴 **손으로 만든 요청**이 같은 값을 보내도 관리자가 아니면 거절", () => {
    const r = run("STAFF", { delegatorUserId: BOSS_ID });
    assert.equal(r.ok, false);
    assert.equal(r.code, "FORBIDDEN");
  });
});

/* ------------------------------------------------------------------ */
/* ④ 🔴 그 뜻이 **그 자리에 걸렸는가** — 소스 글자로                      */
/* ------------------------------------------------------------------ */

const MUTATIONS = "src/lib/approval/delegation-mutations.ts";
const QUERIES = "src/lib/approval/delegation-queries.ts";
const SCREEN_DATA = "src/lib/approval/delegation-screen-data.ts";
const SECTION = "src/components/approval/DelegationSection.tsx";

describe("④ 🔴 울타리가 **쓰는 층**에 있다 — 문이 아니라", () => {
  it("만들기가 「누구의 결재권인가」를 풀면서 **역할을 함께 묻는다**", () => {
    const create = bodyOf(src(MUTATIONS), "export async function createApprovalDelegation(");
    assert.match(
      create,
      /resolveDelegatorFromDirectory\(directory, validated\.delegatorUserId, actor, mayManageOthersDelegations\(actor\.role\)\)/,
      "자격을 안 묻거나, 화면이 보낸 값을 그대로 믿는다",
    );
  });

  it("🔴 대신할 분의 「자기 자신」 판정 기준이 **결재권자**다 — 누르는 사람이 아니다", () => {
    const create = bodyOf(src(MUTATIONS), "export async function createApprovalDelegation(");
    // 🔴 `actor.sub` 로 되돌아가면 **관리자가 자기를 대리인으로 세우는 길이 막힌다**(막지 않기로 했다).
    assert.match(create, /resolveDelegateFromDirectory\(directory, validated\.delegateUserId, delegator\.delegator\.sub\)/);
    assert.doesNotMatch(create, /resolveDelegateFromDirectory\([^)]*actor\.sub/, "누르는 사람을 기준으로 되돌아갔다");
  });

  it("🔴 돌아간 화면이 **다른 말을 하도록** 「본인이었나」를 꼬리표로 실어 보낸다", () => {
    /**
     * 🔴 「내 차례를 그분이 대신 누른다」는 관리자가 남의 것을 세웠을 때 **거짓말**이다. 그
     *    갈림을 아는 것은 쓰는 층뿐이라(화면은 제 A/S 번호를 모른다) 값으로 실어 보낸다.
     * 🔵 꼬리표 값을 손으로 적으면 한쪽만 고치는 날 화면이 **조용히 아무 말도 안 하게** 된다.
     */
    const actions = src("src/app/actions/approval-delegations.ts");
    assert.match(actions, /delegated=\$\{delegationNoticeFlag\(r\.onBehalf\)\}/);
    assert.match(actions, /delegationRevoked=\$\{delegationNoticeFlag\(r\.onBehalf\)\}/);
    assert.doesNotMatch(actions, /delegated=1|delegationRevoked=1/, "꼬리표 값을 손으로 적었다");
  });

  it("🔴 **만드는 길은 기존 위임 줄을 읽지 않는다** — 두 겹을 막는 검사가 생기지 않았다", () => {
    // 🔵 조각 3의 약속 그대로다(`tests/approval-delegation-create.test.ts` ⑤). 넓히면서
    //    「관리자가 세운 줄은 또 못 맡긴다」 같은 검사를 끼워 넣지 않았는지 함께 본다.
    const create = bodyOf(src(MUTATIONS), "export async function createApprovalDelegation(");
    assert.ok(!create.includes("select("), "만드는 길이 기존 위임을 읽는다");
  });

  it("🔴 만들기·되돌리기·모두의 목록이 **같은 자**를 쓴다 — 셋이 갈리면 죽은 단추가 생긴다", () => {
    /**
     * 🔴 셋이 각자 `roleAtLeast(…, "ADMIN")` 을 적으면, 한 곳만 고치는 날 「보이는데 눌러도
     *    거절당하는 단추」나 그 반대가 생긴다 — 둘 다 오류를 내지 않는다. 그래서 역할표를
     *    직접 묻는 자리는 `delegation-authority.ts` **하나**여야 한다.
     */
    for (const declaration of [
      ["export async function createApprovalDelegation(", MUTATIONS],
      ["export async function revokeApprovalDelegation(", MUTATIONS],
      ["export async function listAllDelegations(", QUERIES],
    ] as const) {
      const body = bodyOf(src(declaration[1]), declaration[0]);
      assert.match(body, /mayManageOthersDelegations\(/, `${declaration[0]} 가 역할을 아예 안 본다`);
      assert.doesNotMatch(body, /roleAtLeast|"ADMIN"/, `${declaration[0]} 가 제 손으로 역할표를 적는다`);
    }
    // 🔴 그 자 하나가 어디 있는지도 못 박는다 — 옮겨 적으면 위 검사가 조용히 통과한다.
    assert.match(src("src/lib/approval/delegation-authority.ts"), /roleAtLeast\(role, DELEGATION_MANAGE_ROLE\)/);
  });
});

describe("④-2 🔴 모두의 목록은 **조회가 제 손으로** 막는다", () => {
  const listAll = bodyOf(src(QUERIES), "export async function listAllDelegations(");

  it("🔴 권한이 없으면 **첫 줄에서** 거절한다 — 질의를 던지지도 않는다", () => {
    assert.match(listAll, /if \(!mayManageOthersDelegations\(actorRole\)\) return \{ ok: false, reason: "FORBIDDEN" \}/);
  });

  it("🔴 거절은 **빈 목록이 아니다** — 「권한 없음」과 「아직 아무도 안 맡김」이 갈려야 한다", () => {
    // 🔴 빈 목록으로 돌려주면 화면이 둘을 구별해 말할 수 없다. `view` 칸이 아예 없어야
    //    부르는 쪽이 `ok` 를 안 보고 꺼내려 할 때 `tsc` 가 멈춘다.
    assert.match(src(QUERIES), /\{ ok: true; view: AllDelegationsView \} \| \{ ok: false; reason: "FORBIDDEN" \}/);
    assert.doesNotMatch(listAll, /return \{ ok: true, view: \{ live: \[\]/, "거절을 빈 목록으로 바꿨다");
  });

  it("🔴 **살아 있는 줄에는 상한이 없다** — 되돌려야 할 줄이 상한에 밀리면 안 된다", () => {
    // 🔴 이 묶음을 더한 까닭 자체가 「관리자가 방금 세운 줄을 찾아 거둘 길이 없다」였다.
    //    살아 있는 쪽에 `.limit(` 이 붙는 순간 그 까닭이 반쯤 되돌아간다.
    const live = listAll.slice(listAll.indexOf("const [live, finishedPage]"));
    const liveQuery = live.slice(0, live.indexOf("db()", live.indexOf("db()") + 1));
    assert.ok(!liveQuery.includes(".limit("), "살아 있는 줄에 상한이 생겼다");
    assert.match(listAll, /\.limit\(FINISHED_DELEGATION_LIMIT \+ 1\)/, "끝난 줄의 상한과 「더 있다」 셈이 사라졌다");
  });

  it("🔴 두 질의가 **같은 「지금」**을 쓴다 — 그 사이에 줄이 새거나 겹치지 않게", () => {
    assert.match(listAll, /gt\(approvalDelegations\.endsAt, now\)/);
    assert.match(listAll, /lte\(approvalDelegations\.endsAt, now\)/);
    // 🔴 각자 DB 의 now() 를 쓰면 두 질의 사이에 끝난 줄이 양쪽에서 빠지거나 양쪽에 들어간다.
    assert.ok(!listAll.includes("sql`now()`"), "질의가 각자 지금을 묻는다");
  });

  it("🔵 **화면이 가리는 것이 아니다** — 거절을 `null` 로 옮겨 적을 뿐이다", () => {
    const read = bodyOf(src(SCREEN_DATA), "export async function readDelegationScreen(");
    assert.match(read, /all: all\.ok \? all\.view : null/, "조회의 거절을 화면 쪽에서 다시 판정하기 시작했다");
  });
});

describe("④-3 🔴 화면 — 고르개와 묶음", () => {
  const section = bodyOf(src(SECTION), "export function DelegationSection(");

  it("🔴 관리 권한이 없으면 그 묶음이 **아예 없다** — 감추는 것이 아니다", () => {
    // 🔵 `{all && (` 이라 `null` 이면 그리는 코드가 돌지 않는다. `hidden` 같은 것으로 가리면
    //    줄의 이름이 HTML 에 그대로 실려 나간다.
    assert.match(section, /\{all && \(/, "모두의 묶음을 조건 없이 그린다");
    assert.doesNotMatch(section, /all\?\.(live|finished)/, "자료가 없을 때도 그리려고 물음표를 붙였다");
  });

  it("🔴 「누구의 결재권」 고르개는 **관리자에게만** 그려진다 — 잠긴 고르개를 두지 않는다", () => {
    assert.match(section, /\{canDelegateForOthers \? \(/, "권한과 무관하게 고르개를 그린다");
    assert.match(section, /name="delegatorUserId"/, "고르개에 이름이 없으면 값이 서버로 가지 않는다");
    // 🔴 잠긴 고르개를 두면 **남의 이름이 목록에 실려 나가고**, 고를 수 없는 까닭도 안 보인다.
    assert.doesNotMatch(section, /name="delegatorUserId"[^>]*disabled=\{!canDelegateForOthers/, "고르개를 잠가서 두었다");
  });

  it("🔵 고르개의 **첫 줄이 본인**이고 기본값이다 — 남의 이름이 먼저 떠 있으면 안 된다", () => {
    // 🔴 그대로 저장해 **엉뚱한 사람의 결재권**이 넘어간다. 값이 빈 글자인 까닭은 세션에
    //    그 사람의 A/S 번호가 없어서다 — 서버가 빈 값을 본인으로 읽는다.
    assert.match(section, /defaultValue=""[\s\S]{0,200}<option value="">\{meName\} 님 \(본인\)<\/option>/);
  });

  it("🔵 모두의 목록은 **누가 만들었나**를 적는다 — 본인이 맡긴 것과 관리자가 세운 것이 갈린다", () => {
    assert.match(src(SECTION), /delegationCreatorLabel\(row\)/, "이름만 적으면 그 구분은 눈으로 맞대어야만 나온다");
  });
});

describe("④-4 🔵 「누가 만들었나」 글자", () => {
  it("본인이면 「(본인)」, 아니면 「(관리자 지정)」", () => {
    assert.equal(delegationCreatorLabel({ createdByName: "나", createdBySelf: true }), "나 (본인)");
    assert.equal(delegationCreatorLabel({ createdByName: "나", createdBySelf: false }), "나 (관리자 지정)");
  });
});
