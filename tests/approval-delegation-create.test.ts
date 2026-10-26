import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { actingApproverSubs, delegatorSubsFor, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";

/**
 * ============================================================================
 * 결재권 위임을 **만드는 길**의 울타리 (2026-10-21, 조각 3 · 2026-10-26 에 넓힘)
 * ============================================================================
 * 이 조각은 인가 경계다 — 틀리면 **남의 결재권을 넘길 수 있게 된다.** 그런데 울타리가 걸린
 * 자리가 전부 순수 함수로는 닿지 않는 곳이다:
 *
 *  | 울타리 | 빠뜨리면 |
 *  |---|---|
 *  | `delegator_sub` 를 **푼 뒤의 번호**로 적는다 | 손으로 만든 요청이 **명부 밖 사람의 결재권까지** 넘긴다 |
 *  | `created_by_sub` 는 **누른 사람**이다 | 관리자가 세운 줄이 본인이 맡긴 줄과 구별되지 않는다 |
 *  | 되돌리기 조건절에 **본인 또는 `ADMIN`** 이 걸린다 | 남이 맡긴 위임을 아무나 거둔다 |
 *  | 문이 `requireSession` 이다 | 결재선에 든 보기 권한자가 **자기 위임을 못 만든다** |
 *
 * 🔴 **2026-10-26 에 「본인만」이 「본인 또는 `ADMIN`」으로 넓어졌다.** 자리를 갑자기 비우게
 * 된 사람(병가·사고)은 본인이 설정할 수 없어서다(사용자 결정). 그래서 아래 ①②의 **묻는
 * 내용이 바뀌었다** — 단언을 약하게 만든 것이 아니라 **새 동작을 지키도록** 다시 적었다.
 * 「남의 것도 되는가」의 뜻 자체는 `tests/approval-delegation-authority.test.ts` 가 순수
 * 함수로 전부 돌려 본다.
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
/**
 * 🔴 **`/approvals` 가 아니다** — 2026-10-21 에 위임 구역이 **설정의 탭**으로 옮겨 갔다(사용자 요청).
 * 자리는 바뀌었어도 **묻는 것은 그대로다**: 그 화면의 문이 `requireSession` 인가, 위임 자료에
 * **포털 번호**를 넘기는가. 🔴 설정의 다른 탭은 전부 `requireRole("ADMIN")` 이라, 여기가 그 모양을
 * 따라가면 결재선에 든 보기 권한자가 자기 위임을 영영 못 만든다 — 이 시험이 잡아야 할 바로 그 일이다.
 */
const PAGE = "src/app/(app)/settings/delegations/page.tsx";
/** 🔴 화면 조각. 「권한 판정이 **여기 없는가**」를 재는 자리다(③의 마지막). */
const SECTION = "src/components/approval/DelegationSection.tsx";

describe("① 🔴 맡기는 사람은 **푼 뒤의 번호**로 적힌다 — 화면이 보낸 값이 아니다", () => {
  const create = bodyOf(src(MUTATIONS), "export async function createApprovalDelegation(");

  it("🔴 `delegator_sub` 는 **자격까지 확인된 결과**에서 온다 — 날것이 아니다", () => {
    // 🔴 2026-10-26 전에는 `actor.sub` 였다. 지금은 「누구의 결재권인가」를 명부에서 풀고
    //    자격까지 본 결과(`resolveDelegatorFromDirectory`)가 그 자리에 들어간다.
    assert.match(create, /resolveDelegatorFromDirectory\(/, "푸는 자리를 건너뛰면 자격 검사도 함께 사라진다");
    assert.match(create, /delegatorSub: delegator\.delegator\.sub/, "푼 번호가 아닌 것이 표에 들어간다");
  });

  it("🔴 `created_by_sub` 는 **누른 사람**이다 — 둘이 갈려야 「관리자가 세움」이 남는다", () => {
    assert.match(create, /createdBySub: actor\.sub/, "누른 사람을 안 적으면 본인이 맡긴 줄과 구별되지 않는다");
    // 🔴 결재권자를 여기 적으면 두 칸이 언제나 같아져 그 구분이 **영영** 사라진다.
    assert.doesNotMatch(create, /createdBySub: delegator\./, "「누가 열었나」 자리에 「누구의 권한인가」를 적었다");
  });

  it("🔴 들어온 입력에서 **포털 번호**를 읽는 줄이 하나도 없다", () => {
    // 🔴 화면이 보내는 것은 A/S 사용자 id 다. 번호(`…Sub`)를 입력에서 꺼내는 줄이 한 줄이라도
    //    생기면, 손으로 만든 요청이 **명부에 없는 사람의 결재권까지** 넘길 수 있다.
    assert.doesNotMatch(create, /delegatorSub:\s*(validated|input)/, "검증을 지난 값에서 번호를 꺼냈다");
    assert.doesNotMatch(src(MUTATIONS), /validated\.delegatorSub/, "입력 타입에 번호 칸이 생겼다");
    // 🔵 `validated.delegatorUserId`(A/S id)는 **있어야 한다** — 그것이 넓힌 길이다.
    assert.match(create, /validated\.delegatorUserId/, "「누구의 결재권인가」를 아예 안 읽는다 — 넓힌 길이 끊겼다");
  });

  it("🔴 이 파일은 **폼을 직접 읽지 않는다** — 서버 액션이 읽어 넘긴 값만 본다", () => {
    assert.ok(!src(MUTATIONS).includes("formData"), "쓰는 층이 폼을 직접 읽으면 검증을 건너뛰는 길이 생긴다");
  });

  it("서버 액션은 폼에서 **번호**를 읽지 않는다 — 넘기는 것은 세션의 번호와 역할이다", () => {
    const action = bodyOf(src(ACTIONS), "export async function createDelegationAction(");
    assert.doesNotMatch(action, /formData\.get\(\s*["'][^"']*Sub["']/i, "폼에서 포털 번호를 읽는 줄이 생겼다");
    assert.match(action, /formData\.get\(\s*["']delegatorUserId["']/, "「누구의 결재권인가」를 안 읽으면 고르개가 아무 일도 안 한다");
    assert.match(action, /sub: session\.user\.authSub/, "결재자 판정의 열쇠는 포털 번호다 — users.id 를 넘기면 조용히 빈 목록이 된다");
    // 🔴 역할이 폼에서 오면 울타리가 통째로 없어진다.
    assert.match(action, /role: session\.user\.role/, "역할을 안 넘기면 쓰는 층이 「남의 것까지 되는가」를 가를 수 없다");
    assert.doesNotMatch(action, /formData\.get\(\s*["'][^"']*role/i, "폼에서 역할을 읽는 줄이 생겼다");
  });
});

describe("② 🔴 되돌리기는 **본인 것이거나 `ADMIN`** — 조건절에 걸려 있는가", () => {
  const revoke = bodyOf(src(MUTATIONS), "export async function revokeApprovalDelegation(");

  it("🔴 관리자가 아니면 조건절에 `delegator_sub = 내 번호` 가 **붙는다**", () => {
    // 🔴 화면에서 단추를 안 그리는 것은 울타리가 아니다 — 이 함수는 화면을 거치지 않고도 불린다.
    // 🔴 세 조각이 **한 줄**이어야 한다: 「남의 것까지 되나」를 물어, 아니면 그때만 조건을 건다.
    assert.match(revoke, /mayManageOthersDelegations\(actor\.role\)/, "역할을 안 보면 넓힌 길이 없다");
    assert.match(
      revoke,
      /mayRevokeOthers \? undefined : eq\(approvalDelegations\.delegatorSub,\s*actor\.sub\)/,
      "남이 맡긴 위임을 아무나 거둘 수 있거나, 관리자도 못 거둔다",
    );
  });

  it("🔴 0행이면 **거절**한다 — 조용히 성공으로 넘기지 않는다", () => {
    // 🔴 조건절이 울타리이므로, 0행을 성공으로 읽으면 울타리에 걸린 요청이 「됐다」고 답한다.
    assert.match(revoke, /if \(!row\) return \{ ok: false/, "0행을 성공으로 넘긴다");
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

  it("화면(`/settings/delegations`)도 세션만 보고, 위임 자료에 **포털 번호와 역할**을 넘긴다", () => {
    const page = bodyOf(src(PAGE), "export default async function DelegationsSettingsPage(");
    assert.match(page, /requireSession\(/);
    assert.ok(!page.includes("requireRole"), "이 화면은 결재자 누구나 들어온다 — 설정의 다른 탭을 따라 ADMIN 으로 막았다");
    // 🔴 역할을 함께 넘긴다(2026-10-26). 안 넘기면 모두의 목록도 고르개도 영영 안 뜬다.
    assert.match(
      page,
      /readDelegationScreen\(session\.user\.authSub,\s*session\.user\.role\)/,
      "users.id 를 넘기면 두 목록이 조용히 빈 목록이 된다 · 역할을 안 넘기면 넓힌 길이 화면에 없다",
    );
  });

  it("🔴 화면이 **제 손으로 가리지 않는다** — 묶음과 고르개는 서버가 보낸 값으로만 갈린다", () => {
    const page = bodyOf(src(PAGE), "export default async function DelegationsSettingsPage(");
    /**
     * 🔴 화면에서만 가리면 조회를 부르는 **새 자리**가 생기는 날 조용히 다 새어 나간다.
     *    판정은 조회(`listAllDelegations`) 안에 있고, 화면은 `null` 인지만 본다.
     * 🔵 **함수 본문만 본다** — 파일 머리말에 「`requireRole("ADMIN")` 으로 막지 마라」고 적은
     *    주석이 파일 전체 검사에서는 그 글자로 잡힌다(③ 첫 시험과 같은 함정).
     */
    const section = bodyOf(src(SECTION), "export function DelegationSection(");
    assert.doesNotMatch(section, /roleAtLeast|requireRole|"ADMIN"/, "화면이 역할로 판정하기 시작했다 — 울타리가 두 벌이 된다");
    assert.match(page, /all=\{delegation\.all\}/, "모두의 줄을 안 넘기면 관리자가 방금 세운 것이 제 화면에 안 뜬다");
    assert.match(page, /canDelegateForOthers=\{delegation\.canDelegateForOthers\}/, "고르개를 그릴지도 서버가 정한다");
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
