import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { planPartIssueApproval } from "../src/lib/approval/part-issue-rules";
import { findNextRouteStepToApprove, isRouteStepSkippedForRequester, requesterSubsToSkip, type RequesterSubs } from "../src/lib/approval/route";

/**
 * ============================================================================
 * 🔴 건너뛸 사람은 **둘**이다 — 원 신청자 · 결재를 올린 사람 (2026-10-26)
 * ============================================================================
 * 결재선 단계의 승인자가 **그 부품을 신청한 사람 본인**이면 그 단계를 건너뛴다. 그런데 「신청한
 * 사람」이 둘이다:
 *
 *  1. **원래 신청을 올린 사람** — 부품이 필요해서 달라고 한 사람(`stock_requests` 의 신청자).
 *  2. **[불출 신청] 단추를 눌러 결재를 올린 사람** — 재고 담당자다. 남의 신청을 결재에 태워
 *     주는 자리라 1번과 **다른 사람인 것이 보통이다.**
 *
 * 🔴 **그 전에는 2번만 봤다.** 그래서 어떤 분이 올린 신청의 결재선 1단계가 바로 그 분인데도
 * 그 단계가 그대로 서서, **자기가 달라고 한 것을 자기가 승인하는 칸**이 됐다. 단추를 누른 사람은
 * 재고 담당자였기 때문이다. 이 파일이 그 일이 다시 일어나지 않게 세운 울타리다.
 *
 * 여기서 못 박는 것 여섯:
 *  1. **원 신청자**가 단계에 있으면 그 단계가 안 생긴다. ← 이번에 생긴 동작
 *  2. **결재를 올린 사람**이 단계에 있으면 그 단계가 안 생긴다. ← 예전부터 있던 동작, 그대로다
 *  3. 둘이 **각각 다른 단계**에 있으면 **둘 다** 안 생긴다.
 *  4. 둘 다 아닌 사람의 단계는 **그대로 생긴다** — 건너뛰기가 번지면 결재가 통째로 사라진다.
 *  5. 원 신청자를 **못 구해도**(신청에 `requested_by` 도 `requester_sub` 도 없다) 올린 사람
 *     기준 건너뛰기는 **그대로 돈다.**
 *  6. 🔴 **사슬이 나아갈 때도 올릴 때와 같은 기준으로** 건너뛴다 — 두 자리가 어긋나면 올릴 때
 *     사라졌던 단계가 **사슬 중간에 되살아난다.**
 *
 * ── 🔴 6번의 절반은 **소스 글자로 잰다** ────────────────────────────────
 * 「두 자리가 같은 목록을 본다」는 순수 함수로 증명할 수 없다. 두 자리가 전부 `server-only`
 * 사슬(DB·세션)에 걸려 있어 이 저장소의 시험이 불러 볼 수 없기 때문이다. 약한 울타리인 것은
 * 맞지만, 결재가 어긋나는 길이라 **없는 것보다 훨씬 낫다**(`tests/approval-route.test.ts` 의
 * 「세 자리가 모두 그 함수를 거친다」가 같은 방식을 쓴다).
 * 🔴 글자로 재는 시험은 **주석을 먼저 걷어낸다** — 이 조각의 주석에는 함수 이름이 여러 번 적혀
 * 있어서, 안 걷어내면 **주석만으로 통과한다.** 그리고 잘라 낸 토막이 비어 있지 않은 것까지 본다.
 * ============================================================================
 */

/** 가짜 A/S 번호와 가짜 포털 번호. 🔴 **일부러 다른 모양**으로 둔다 — 열쇠를 바꿔 넘겨도 통과하면 울타리가 아니다. */
const asId = (name: string) => `as-${name}`;
const sub = (name: string) => `sub-${name}`;

/**
 * 결재선 한 판 — `approval_route_steps` 를 읽은 것과 같은 모양.
 * 🔵 사람 이름은 **가짜**다(실제 이름을 시험에 넣지 않는다).
 */
const route = (...approvers: string[]) =>
  approvers.map((name, index) => ({
    stepOrder: index + 1,
    approverUserId: asId(name),
    approverSub: sub(name) as string | null,
    approverName: `${name} 님`,
    approverRole: "STAFF",
  }));

/** 올릴 때 실제로 서는 단계 번호들. `NEEDS_APPROVAL` 이 아니면 빈 배열이다. */
function plannedStepOrders(routeSteps: ReturnType<typeof route>, requesterSubs: RequesterSubs): number[] {
  const plan = planPartIssueApproval(routeSteps, requesterSubs);
  return plan.kind === "NEEDS_APPROVAL" ? plan.steps.map((s) => s.stepOrder) : [];
}

/**
 * **서버가 사슬을 잇는 길을 그대로 흉내 낸다**: 첫 단계는 올릴 때 만든 계획에서 오고
 * (`requestPartIssueApproval`), 그다음부터는 방금 결재한 번호로 다음 단계를 찾는다
 * (`decidePartIssueApproval` 의 `findNextRouteStepToApprove`).
 *
 * 🔴 **두 자리가 같은 목록을 받는지**를 이 함수가 잰다 — 인자가 하나뿐이라 서로 다른 목록을
 * 넘길 자리가 아예 없고, 그래서 돌려주는 번호 줄은 「어긋나지 않았을 때의 참값」이다.
 */
function walkChain(routeSteps: ReturnType<typeof route>, requesterSubs: RequesterSubs): number[] {
  const planned = plannedStepOrders(routeSteps, requesterSubs);
  if (planned.length === 0) return [];
  const visited = [planned[0]];
  for (;;) {
    const next = findNextRouteStepToApprove(routeSteps, visited[visited.length - 1], requesterSubs);
    if (next === null) break;
    visited.push(next.stepOrder);
  }
  return visited;
}

/** 재고 담당자(단추를 누르는 사람)와 원 신청자. 이 둘이 이 파일의 주인공이다. */
const ADMIN = sub("admin");
const REQUESTER = sub("requester");

describe("① 올릴 때 — 건너뛸 사람 둘", () => {
  it("🔴 1. **원 신청자**가 단계에 있으면 그 단계가 안 생긴다 (이번에 생긴 동작)", () => {
    // 결재선 1단계가 그 부품을 달라고 한 사람이다. 단추는 재고 담당자가 눌렀다.
    const steps = route("requester", "kim", "park");
    assert.deepEqual(
      plannedStepOrders(steps, requesterSubsToSkip(ADMIN, REQUESTER)),
      [2, 3],
      "자기가 달라고 한 것을 자기가 승인하는 칸은 없다",
    );
    // 🔴 울타리: 올린 사람만 보던 옛 기준이면 1단계가 그대로 선다 — 이 줄이 이 조각의 까닭이다.
    assert.deepEqual(plannedStepOrders(steps, requesterSubsToSkip(ADMIN, null)), [1, 2, 3]);
  });

  it("🔴 2. **결재를 올린 사람**이 단계에 있으면 그 단계가 안 생긴다 (예전 동작 그대로)", () => {
    const steps = route("kim", "admin", "park");
    assert.deepEqual(
      plannedStepOrders(steps, requesterSubsToSkip(ADMIN, REQUESTER)),
      [1, 3],
      "🔴 이 줄이 깨지면 넓히면서 원래 되던 것을 잃은 것이다",
    );
  });

  it("🔴 3. 둘이 **각각 다른 단계**에 있으면 **둘 다** 안 생긴다", () => {
    const steps = route("requester", "kim", "admin", "park");
    assert.deepEqual(plannedStepOrders(steps, requesterSubsToSkip(ADMIN, REQUESTER)), [2, 4]);
  });

  it("🔴 4. 둘 다 아닌 사람의 단계는 **그대로 생긴다**", () => {
    // 건너뛰기가 번지면 결재가 통째로 사라진다 — 재고가 결재 없이 나가는 길이다.
    const steps = route("kim", "lee", "park");
    assert.deepEqual(plannedStepOrders(steps, requesterSubsToSkip(ADMIN, REQUESTER)), [1, 2, 3]);
  });

  it("🔴 5. 원 신청자를 **못 구해도** 올린 사람 기준 건너뛰기는 그대로 돈다", () => {
    /**
     * 신청에 `requested_by` 도 `requester_sub` 도 없거나, 가리키는 사람이 이 시스템 `users` 에
     * 없으면 서버는 둘째 자리에 `null` 을 넣는다(`src/lib/approval/requester-subs.ts`).
     * 🔴 그때 **아무것도 못 건너뛰게 되면** 안 된다 — 그 사람 몫만 빠진다.
     */
    const steps = route("kim", "admin", "park");
    assert.deepEqual(plannedStepOrders(steps, requesterSubsToSkip(ADMIN, null)), [1, 3]);
  });

  it("둘이 같은 사람이어도 그대로 돈다 — 담당자가 자기 몫으로 올린 신청", () => {
    const steps = route("admin", "kim");
    assert.deepEqual(plannedStepOrders(steps, requesterSubsToSkip(ADMIN, ADMIN)), [2]);
  });

  it("남는 단계가 하나도 없으면 그 자리에서 승인된다 — 기다릴 사람이 없다", () => {
    const plan = planPartIssueApproval(route("requester", "admin"), requesterSubsToSkip(ADMIN, REQUESTER));
    assert.equal(plan.kind, "AUTO_APPROVED", "PENDING_APPROVAL 로 두면 아무도 누를 수 없는 건이 영영 남는다");
  });

  it("🔴 견주는 것은 포털 번호다 — A/S 번호를 넘기면 한 칸도 안 빠진다", () => {
    // 코드는 맞고 값이 안 맞는 결함이라 눈으로는 안 잡힌다(2026-10-15 결함의 울타리와 같은 자리).
    const steps = route("requester", "admin", "park");
    assert.deepEqual(plannedStepOrders(steps, requesterSubsToSkip(asId("admin"), asId("requester"))), [1, 2, 3]);
    assert.equal(isRouteStepSkippedForRequester(sub("requester"), requesterSubsToSkip(asId("admin"), asId("requester"))), false);
  });
});

describe("② 사슬이 나아갈 때 — 올릴 때와 **같은 기준**", () => {
  it("🔴 6. 사슬이 밟는 단계가 올릴 때 세운 계획과 글자 그대로 같다", () => {
    for (const steps of [
      route("requester", "kim", "admin", "park"),
      route("kim", "requester", "park"),
      route("admin", "requester", "kim", "lee"),
      route("kim", "lee", "park"),
    ]) {
      const requesterSubs = requesterSubsToSkip(ADMIN, REQUESTER);
      const planned = plannedStepOrders(steps, requesterSubs);
      assert.ok(planned.length > 0, "🔴 표본이 비었다 — 이 시험이 아무것도 재지 않았다");
      assert.deepEqual(
        walkChain(steps, requesterSubs),
        planned,
        "올릴 때 세운 단계 줄과 사슬이 실제로 밟는 단계 줄이 다르다",
      );
    }
  });

  it("🔴 두 자리가 **다른 목록**을 보면 빠졌던 단계가 사슬 중간에 되살아난다", () => {
    /**
     * 🔵 **일부러 어긋나게 해 본다** — 이 줄이 없으면 위 시험이 「어긋나도 통과하는」 시험인지
     *    알 수 없다. 여기서 재는 것은 「어긋나면 무슨 일이 일어나는가」이고, 그 일이 바로
     *    `src/lib/approval/route.ts` 머리말이 경고하는 것이다.
     */
    const steps = route("kim", "requester", "park");
    const both = requesterSubsToSkip(ADMIN, REQUESTER);
    const raiserOnly = requesterSubsToSkip(ADMIN, null); // 옛 기준(올린 사람만)

    assert.deepEqual(plannedStepOrders(steps, both), [1, 3], "올릴 때는 2단계(원 신청자)가 빠진다");
    assert.equal(findNextRouteStepToApprove(steps, 1, both)?.stepOrder, 3, "같은 목록을 보면 1단계 다음은 3단계다");
    assert.equal(
      findNextRouteStepToApprove(steps, 1, raiserOnly)?.stepOrder,
      2,
      "🔴 사슬만 옛 목록을 보면 빠졌던 2단계가 되살아난다 — 그래서 두 자리가 한 함수를 부른다",
    );
  });
});

/**
 * ============================================================================
 * ③ 🔴 **두 자리가 그 함수 하나를 부른다** (소스로 잰다)
 * ============================================================================
 */
describe("③ 서버의 두 자리가 같은 목록을 받는다 (소스로 잰다)", () => {
  /** 🔴 줄바꿈을 LF 로 눕혀서 읽는다 — 이 저장소의 소스는 CRLF 가 섞여 있다. */
  const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

  /**
   * 주석을 떼어 낸 코드만. 🔴 **글자로 재는 시험은 주석까지 긁는다** — 이 조각의 주석에는
   * `requesterSubsToSkipFor` 가 여러 번 적혀 있어서, 안 걷어내면 **주석만으로 통과한다.**
   */
  const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  /** 그 자리에서 **일하는 줄**을 잘라 낸다(주석 말고). 🔴 빈 토막이면 그 자리에서 터뜨린다. */
  function codeLineWith(source: string, needle: string, file: string): string {
    const line = source.split("\n").find((l) => l.includes(needle));
    assert.ok(line !== undefined, `${file}: 코드에서 ${needle} 를 찾지 못했다(주석 말고)`);
    assert.notEqual(line.trim(), "", `${file}: 잘라 낸 토막이 비어 있다 — 시험이 아무것도 재지 않았다`);
    return line;
  }

  const partIssue = stripComments(src("src/lib/approval/part-issue.ts"));

  it("🔴 올리는 자리와 사슬 잇는 자리가 **둘 다** 그 함수로 목록을 받는다", () => {
    const calls = partIssue.split("requesterSubsToSkipFor(").length - 1;
    assert.equal(calls, 2, `결재 올리기·사슬 잇기 두 자리여야 한다 — 지금 ${calls} 곳이다`);
  });

  it("🔴 올리는 자리는 그 신청의 **번호로** 목록을 받아 계획에 넘긴다", () => {
    const got = codeLineWith(partIssue, "requesterSubsToSkipFor(requestId", "src/lib/approval/part-issue.ts");
    assert.ok(got.includes("actor.sub"), "결재를 올린 사람의 포털 번호를 안 넘긴다 — 그쪽 건너뛰기가 꺼진다");

    const planned = codeLineWith(partIssue, "planPartIssueApproval(", "src/lib/approval/part-issue.ts");
    assert.ok(planned.includes("requesterSubs"), "계획이 그 목록을 안 받는다");
    assert.ok(
      !planned.includes("actor.sub"),
      "🔴 아직 올린 사람 번호 하나만 넘긴다 — 원 신청자의 단계가 그대로 선다",
    );
  });

  it("🔴 사슬 잇는 자리도 **같은 목록**을 본다 — 그 건의 신청 번호와 같은 트랜잭션으로", () => {
    const got = codeLineWith(partIssue, "requesterSubsToSkipFor(head.requestId", "src/lib/approval/part-issue.ts");
    assert.ok(got.includes("tx"), "🔴 쓰기와 다른 연결로 읽으면 집기 전 사이에 값이 달라질 수 있다");

    const next = codeLineWith(partIssue, "findNextRouteStepToApprove(usableRouteSteps", "src/lib/approval/part-issue.ts");
    assert.ok(next.includes("requesterSubs"), "사슬이 그 목록을 안 본다 — 올릴 때와 어긋난다");
  });

  it("🔴 목록을 묶는 일은 **순수 함수 한 곳**이 한다 — 서버가 배열을 손으로 적지 않는다", () => {
    const requesterSubs = stripComments(src("src/lib/approval/requester-subs.ts"));
    assert.ok(requesterSubs.includes("requesterSubsToSkip("), "읽어 온 둘을 그 함수로 묶지 않는다");
    // 🔴 COALESCE 두 칸 — 실려 온 포털 번호가 먼저, 없으면 `users` 로 되짚는다.
    assert.ok(requesterSubs.includes("stockRequests.requesterSub"), "A/S 가 실어 보낸 포털 번호를 안 읽는다");
    assert.ok(requesterSubs.includes("users.authSub"), "`requested_by` 를 포털 번호로 되짚지 않는다");
    assert.ok(
      requesterSubs.includes("leftJoin(users"),
      "🔴 `requested_by` 는 빌 수 있다 — innerJoin 이면 A/S 신청이 통째로 빠져 건너뛰기가 조용히 꺼진다",
    );
  });

  it("🔴 진행 그림도 같은 판정을 본다 — 화면만 거짓말하지 않게", () => {
    // 화면이 한쪽만 보면, 아무도 누르지 않을 칸이 「결재 대기」로 남아 있는 것처럼 그려진다.
    const screen = stripComments(src("src/lib/approval/part-issue-screen-data.ts"));
    assert.ok(screen.includes("requesterSubsToSkip("), "그림이 건너뛸 사람 둘을 묶지 않는다");
    assert.ok(screen.includes("originalRequesterSubsByRequest("), "그림이 원 신청자를 안 읽는다");
  });
});
