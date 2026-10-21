import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { actingApproverSubs, delegatorSubsFor, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";

/**
 * ============================================================================
 * 결재권 위임을 **만드는 길**의 울타리 (2026-10-21, 조각 3)
 * ============================================================================
 * 이 조각은 인가 경계다 — 틀리면 **남의 결재권을 넘길 수 있게 된다.** 그런데 울타리가 걸린
 * 자리 셋이 전부 순수 함수로는 닿지 않는 곳이다:
 *
 *  | 울타리 | 빠뜨리면 |
 *  |---|---|
 *  | `delegator_sub` 를 **세션**에서 꺼낸다 | 손으로 만든 요청이 **남의 결재권을 넘긴다** |
 *  | 되돌리기 조건절에 **본인**이 걸린다 | 남이 맡긴 위임을 아무나 거둔다 |
 *  | 문이 `requireSession` 이다 | 결재선에 든 보기 권한자가 **자기 위임을 못 만든다** |
 *
 * 🔴 **이 저장소에는 DB 시험이 없다.** 조건절과 인가는 아무도 돌려 보지 못한 채 운영으로
 * 나간다 — 그래서 `tests/part-issue-delegation.test.ts` 가 쓰는 방식을 그대로 쓴다: 뜻은
 * 순수 함수로 재고(④), 그 뜻이 **그 자리에 정말 걸렸는지**는 소스 글자로 잰다(①~③).
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 🔴 **함수 하나만 잘라 낸다.** 파일 전체에서 글자를 찾으면 **옆 함수가 대신 통과시킨다** —
 * 2026-10-15 에 실제로 그랬다(`tests/part-issue-delegation.test.ts` 의 같은 helper 주석).
 * 자르는 범위가 곧 시험의 범위다. 🔵 머리말 주석도 이 자르기로 함께 빠진다 — 주석에 적은
 * 다짐이 코드 대신 통과하면 안 된다.
 */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 가 사라졌다`);
  const end = source.indexOf("\nexport ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

const MUTATIONS = "src/lib/approval/delegation-mutations.ts";
const ACTIONS = "src/app/actions/approval-delegations.ts";
const QUERIES = "src/lib/approval/delegation-queries.ts";
const PAGE = "src/app/(app)/approvals/page.tsx";

describe("① 🔴 맡기는 사람은 **세션에서 나온다** — 화면이 보낸 값이 아니다", () => {
  const create = bodyOf(src(MUTATIONS), "export async function createApprovalDelegation(");

  it("표에 적는 두 칸이 **`actor.sub`** 다", () => {
    assert.match(create, /delegatorSub: actor\.sub/, "맡기는 사람을 세션에서 꺼내지 않는다 — 남의 결재권을 넘기는 요청을 손으로 만들 수 있다");
    assert.match(create, /createdBySub: actor\.sub/, "「누가 이 권한을 열었나」도 세션의 번호여야 한다");
  });

  it("🔴 들어온 입력에서 맡기는 사람을 **읽는 줄이 하나도 없다**", () => {
    // 🔴 한 줄이라도 생기면 오류 없이 통과하는 **인가 구멍**이 된다. 검증을 지난 값
    //    (`validated`)이든 날것(`input`)이든 마찬가지다.
    assert.doesNotMatch(create, /delegatorSub:\s*(validated|input)/, "검증을 지난 값에서 맡기는 사람을 꺼냈다");
    assert.doesNotMatch(src(MUTATIONS), /validated\.delegator/, "입력 타입에 그 칸이 생겼다");
  });

  it("🔴 이 파일은 **폼을 직접 읽지 않는다** — 서버 액션이 읽어 넘긴 값만 본다", () => {
    assert.ok(!src(MUTATIONS).includes("formData"), "쓰는 층이 폼을 직접 읽으면 검증을 건너뛰는 길이 생긴다");
  });

  it("서버 액션도 폼에서 맡기는 사람을 읽지 않는다 — 넘기는 것은 세션의 번호다", () => {
    const action = bodyOf(src(ACTIONS), "export async function createDelegationAction(");
    assert.doesNotMatch(action, /formData\.get\(\s*["'][^"']*delegator/i, "폼에서 맡기는 사람을 읽는 줄이 생겼다");
    assert.match(action, /sub: session\.user\.authSub/, "결재자 판정의 열쇠는 포털 번호다 — users.id 를 넘기면 조용히 빈 목록이 된다");
  });
});

describe("② 🔴 되돌리기는 **본인 것만** — 조건절에 걸려 있는가", () => {
  const revoke = bodyOf(src(MUTATIONS), "export async function revokeApprovalDelegation(");

  it("조건절에 `delegator_sub = 내 번호` 가 있다", () => {
    // 🔴 화면에서 단추를 안 그리는 것은 울타리가 아니다 — 이 함수는 화면을 거치지 않고도 불린다.
    assert.match(
      revoke,
      /eq\(approvalDelegations\.delegatorSub,\s*actor\.sub\)/,
      "남이 맡긴 위임을 아무나 거둘 수 있다",
    );
  });

  it("이미 되돌린 줄·이미 끝난 줄도 조건절에서 걸러진다", () => {
    assert.match(revoke, /isNull\(approvalDelegations\.revokedAt\)/, "두 번 되돌리면 되돌린 사람·시각이 덮어써진다");
    assert.match(revoke, /gt\(approvalDelegations\.endsAt,\s*now\)/, "끝난 위임을 되돌리면 지난 기간의 근거가 바뀐다");
  });

  it("🔴 **지우지 않는다** — 깃발을 세운다", () => {
    assert.ok(!revoke.includes(".delete("), "줄을 지우면 그 기간에 난 결재를 나중에 설명할 수 없다");
    assert.match(revoke, /revokedAt: now/);
  });

  it("거절 문구가 **까닭 셋을 함께** 말한다 — 어느 쪽인지 말하면 남의 줄을 읽어야 한다", () => {
    const message = /되돌릴 수 없는 위임입니다/;
    assert.match(src(MUTATIONS), message);
  });
});

describe("③ 🔴 문은 `requireSession` 이다 — `requireRole` 이 아니다", () => {
  it("서버 액션 둘 다 세션만 본다", () => {
    const action = src(ACTIONS);
    // 🔴 결재자는 **역할과 무관하게 누구나** 될 수 있다. 역할로 막으면 결재선에 든 보기
    //    권한자가 자기 위임을 영영 못 만든다(`/approvals` 머리말의 같은 까닭).
    // 🔵 **함수 본문만 본다** — 「`requireRole` 을 쓰지 않는다」고 적은 머리말 주석이 파일
    //    전체 검사에서는 그 글자로 잡힌다(자르는 범위가 곧 시험의 범위다).
    for (const declaration of ["export async function createDelegationAction(", "export async function revokeDelegationAction("]) {
      const body = bodyOf(action, declaration);
      assert.match(body, /requireSession\(/, declaration);
      assert.ok(!body.includes("requireRole"), `${declaration} 가 역할로 막는다 — 보기 권한자가 자기 위임을 못 만든다`);
    }
  });

  it("화면(`/approvals`)도 세션만 보고, 위임 자료에 **포털 번호**를 넘긴다", () => {
    const page = bodyOf(src(PAGE), "export default async function ApprovalsPage(");
    assert.match(page, /requireSession\(/);
    assert.ok(!page.includes("requireRole"), "이 화면은 결재자 누구나 들어온다");
    assert.match(page, /readDelegationScreen\(session\.user\.authSub\)/, "users.id 를 넘기면 두 목록이 조용히 빈 목록이 된다");
  });
});

describe("④ 🔴 두 방향을 **바꿔 읽지 않는다** — 바뀌면 남의 위임이 내 화면에 뜬다", () => {
  const queries = src(QUERIES);

  it("「내가 맡긴 것」은 `delegator_sub` 로, 「내가 대신하는 것」은 `delegate_sub` 로 찾는다", () => {
    // 🔴 둘을 바꿔 적으면 오류가 나지 않는다 — 화면에 남의 위임이 뜨고, [되돌리기]는 거절당한다.
    //    증상이 「고장」이 아니라 「이상한 줄」이라 아무도 신고하지 않는다.
    assert.match(
      bodyOf(queries, "export async function listDelegationsIMade("),
      /eq\(approvalDelegations\.delegatorSub,\s*delegatorSub\)/,
    );
    assert.match(
      bodyOf(queries, "export async function listDelegationsIActFor("),
      /eq\(approvalDelegations\.delegateSub,\s*delegateSub\)/,
    );
  });

  it("「내가 대신하는 것」은 **아직 시작 안 한 줄**을 보여 주지 않는다", () => {
    // 🔴 색인에 `starts_at` 이 없어 WHERE 가 그것을 못 본다(표 쪽 주석). 걸러 내지 않으면
    //    미리 적어 둔 위임이 「지금 대신하는 중」으로 보이고, 대리인은 지금 누를 수 있다고 믿는다.
    assert.match(bodyOf(queries, "export async function listDelegationsIActFor("), /isActiveDelegation\(/);
  });
});

/* ------------------------------------------------------------------ */
/* ⑤ 뜻 — 🔴 두 겹은 **만들 때 막지 않고 판정이 막는다**                  */
/* ------------------------------------------------------------------ */

const sub = (name: string) => `sub-${name}`;
const STARTS = new Date("2026-10-01T00:00:00.000Z");
const ENDS = new Date("2026-10-08T00:00:00.000Z");
const NOW = new Date("2026-10-04T12:00:00.000Z");

const delegation = (delegatorName: string, delegateName: string): ApprovalDelegationPeriod => ({
  delegatorSub: sub(delegatorName),
  delegateSub: sub(delegateName),
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
});

describe("⑤ 🔴 이어지지 않는다 — 그래서 **만드는 쪽은 막지 않는다**", () => {
  /** A→B 가 이미 있고, B 가 자기 결재권을 C 에게 맡겼다. */
  const rows = [delegation("a", "b"), delegation("b", "c")];

  it("🔴 C 는 **B 의 결재권만** 얻는다 — A 의 것은 못 얻는다", () => {
    assert.deepEqual(delegatorSubsFor(rows, sub("c"), NOW), [sub("b")], "A 가 맡긴 사람은 B 뿐이다");
    assert.deepEqual(actingApproverSubs(rows, sub("c"), NOW), [sub("c"), sub("b")]);
  });

  it("🔵 **B 가 맡기는 것 자체는 막지 않는다** — 남의 대리인도 출장을 간다", () => {
    // 🔴 만드는 쪽에서 「위임받은 사람은 또 위임할 수 없다」를 막으면, 남의 대리인이 된 사람은
    //    **자기 결재권조차** 맡길 수 없게 된다. 막을 까닭이 없는 것이 ①의 결과 때문이다.
    //    그래서 만드는 길(`createApprovalDelegation`)은 **지금 있는 위임 줄을 아예 읽지 않는다.**
    const create = bodyOf(src(MUTATIONS), "export async function createApprovalDelegation(");
    assert.ok(!create.includes("select("), "만드는 길이 기존 위임을 읽는다 — 두 겹을 막는 검사가 생겼다");
    // B 는 자기 자격을 그대로 쓰고(a 의 대리인), C 는 B 의 자격만 얻는다 — 둘 다 성립한다.
    assert.deepEqual(actingApproverSubs(rows, sub("b"), NOW), [sub("b"), sub("a")]);
  });

  it("🔵 겹치는 기간을 **또 맡겨도** 결재 목록이 겹치지 않는다 — 그래서 만들 때 막지 않는다", () => {
    const twice = [delegation("kim", "lee"), delegation("kim", "lee")];
    assert.deepEqual(delegatorSubsFor(twice, sub("lee"), NOW), [sub("kim")], "같은 번호를 두 번 돌려주면 같은 건이 목록에 두 번 뜬다");
  });
});
