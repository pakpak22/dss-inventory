import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { actingApproverSubs, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";
import { mayDecidePartIssueStep } from "../src/lib/approval/part-issue-rules";

/**
 * ============================================================================
 * 결재권 위임이 **실제 판정에 붙었나** (2026-10-21, 조각 2)
 * ============================================================================
 * 조각 1은 순수 규칙(`src/lib/approval/delegation.ts`)만 깔았고, 부르는 곳이 시험뿐이었다.
 * 이 조각이 그것을 **네 자리**에 이었다:
 *
 *  | 자리 | 빠뜨리면 |
 *  |---|---|
 *  | 집행 `decidePartIssueApproval` | 위임이 **아예 안 먹는다** |
 *  | 목록 `listPartIssueApprovalsToDecide` | 대리인 화면에 그 건이 **안 보인다** |
 *  | 알림 종 `summarizePartIssueApprovalsToDecide` | 대리인에게 **종이 안 울린다**(가 보면 있는데) |
 *  | 순수 판정 `mayDecidePartIssueStep` | 시험만 통과하고 운영은 그대로 막는다 |
 *
 * ── 🔴 **두 벌이던 것을 한 벌로 합쳤다** ────────────────────────────────
 * 앞 셋은 SQL 이고 넷째는 TS 라 같은 코드를 쓸 수 없다. 그래서 **둘이 보는 번호 목록을 한 함수가
 * 만들게** 했다 — `actingApproverSubs`(순수) / `actingApproverSubsFor`(표를 읽어 그 함수에 넘김).
 * 아래 ②가 그 약속을 글자로 못 박는다.
 *
 * ── 🔴 이 저장소에는 DB 시험이 없다 ─────────────────────────────────────
 * 그래서 「누가 누를 수 있나」의 **뜻**은 순수 함수로 재고(①), 그 뜻이 **세 조건절에 똑같이
 * 걸렸는지**는 소스 글자로 잰다(②~⑤). 조건절은 아무도 돌려 보지 못한 채 운영으로 나가는
 * 자리라, `tests/notifications-bell-items.test.ts` 와 `tests/part-issue-screen.test.ts` 가
 * 같은 방식을 쓴다.
 * ============================================================================
 */

const sub = (name: string) => `sub-${name}`;
const asId = (name: string) => `as-${name}`;

/** 2026-10-01 00:00 부터 2026-10-08 00:00 **직전**까지. 지금은 그 한가운데다. */
const STARTS = new Date("2026-10-01T00:00:00.000Z");
const ENDS = new Date("2026-10-08T00:00:00.000Z");
const NOW = new Date("2026-10-04T12:00:00.000Z");

const delegation = (
  delegatorName: string,
  delegateName: string,
  over: Partial<ApprovalDelegationPeriod> = {},
): ApprovalDelegationPeriod => ({
  delegatorSub: sub(delegatorName),
  delegateSub: sub(delegateName),
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
  ...over,
});

/** 「kim 님 차례」로 열려 있는 단계 한 줄. */
const KIM_STEP = { approverSub: sub("kim"), status: "REQUESTED" as const };

/**
 * 「지금 이 사람이 kim 의 단계를 누를 수 있나」 — **운영이 지나는 길 그대로** 잰다.
 * 🔴 번호 목록을 손으로 만들지 않고 `actingApproverSubs` 를 지난다. DB 조건절 셋이 받는 것과
 *    **같은 목록**이어야 하므로, 여기서 손으로 적으면 이 시험이 아무것도 지키지 못한다.
 */
const mayPress = (rows: ApprovalDelegationPeriod[], actorSub: string, now: Date = NOW) =>
  mayDecidePartIssueStep(KIM_STEP, actingApproverSubs(rows, actorSub, now));

describe("① 위임이 붙은 뒤 **누가 누를 수 있나**", () => {
  it("🔴 대리인이 그 단계를 누를 수 있다 — 이 조각의 전부다", () => {
    assert.equal(mayPress([delegation("kim", "lee")], sub("lee")), true);
  });

  it("🔴 **원래 결재권자는 위임 중에도 누를 수 있다** — 위임은 넘기는 것이 아니라 늘리는 것이다", () => {
    // 🔴 막으면 「맡겼더니 내가 못 누른다」가 된다. 출장 중에 전화로 처리하는 일은 실제로 있다.
    assert.equal(mayPress([delegation("kim", "lee")], sub("kim")), true);
  });

  it("🔴 **대리인이 되었다고 자기 차례를 잃지 않는다** — 늘어나는 것이지 바뀌는 것이 아니다", () => {
    // 🔴 lee 는 park 의 대리인이면서 결재선에 **자기 단계**도 갖고 있다. 목록을 「맡은 사람들」로
    //    갈아 끼우면 lee 는 남의 차례만 누를 수 있고 **자기 차례에서 막힌다** — 위임을 받아 준
    //    대가로 제 일을 못 하게 되는, 아무도 바란 적 없는 동작이다.
    const acting = actingApproverSubs([delegation("park", "lee")], sub("lee"), NOW);
    assert.equal(mayDecidePartIssueStep({ approverSub: sub("lee"), status: "REQUESTED" }, acting), true, "자기 차례를 잃었다");
    assert.equal(mayDecidePartIssueStep({ approverSub: sub("park"), status: "REQUESTED" }, acting), true, "맡은 차례를 못 누른다");
  });

  it("🔴 위임이 **끝난 뒤**에는 못 누른다 — 끝은 포함하지 않는다", () => {
    assert.equal(mayPress([delegation("kim", "lee")], sub("lee"), ENDS), false, "끝 그 순간부터 거짓이다");
    assert.equal(mayPress([delegation("kim", "lee")], sub("lee"), new Date("2026-10-09T00:00:00.000Z")), false);
    // 🔵 기간 안으로 되돌아가면 다시 참이다 — 꺼진 것은 시각 때문이지 다른 까닭이 아니다.
    assert.equal(mayPress([delegation("kim", "lee")], sub("lee"), new Date("2026-10-07T23:59:59.999Z")), true);
  });

  it("🔴 **되돌린 뒤**에는 못 누른다 — 기간이 남아 있어도", () => {
    const revoked = delegation("kim", "lee", { revokedAt: new Date("2026-10-03T09:00:00.000Z") });
    assert.equal(mayPress([revoked], sub("lee")), false);
    assert.equal(mayPress([revoked], sub("kim")), true, "되돌린 것은 대리 자격이지 본인 자격이 아니다");
  });

  it("🔴 **시작 전**에는 못 누른다 — 미리 적어 둔 위임이 먼저 열리면 안 된다", () => {
    assert.equal(mayPress([delegation("kim", "lee")], sub("lee"), new Date("2026-09-30T23:59:59.999Z")), false);
  });

  it("🔴 **위임 없는 남은 여전히 못 누른다** — 위임이 「아무나 되는 문」이 되지 않았다", () => {
    const rows = [delegation("kim", "lee")];
    assert.equal(mayPress(rows, sub("cho")), false, "위임을 받은 적 없는 사람");
    assert.equal(mayPress(rows, sub("park")), false, "다른 사람의 대리인도 아닌 사람");
  });

  it("🔴 **관리자라고 대신 못 누른다** — 위임이 이 구멍을 열면 안 된다", () => {
    // 🔴 목록에 들어오는 번호는 「지금 살아 있는 위임의 결재권자」뿐이다. 역할은 보지 않는다.
    //    관리자가 남의 결재권을 **넘기는** 길도 두지 않았다(표 쪽 `created_by_sub` 주석) —
    //    그 길이 있으면 관리자가 자기를 아무의 대리인으로 세워 이 울타리를 설정 화면으로 우회한다.
    assert.equal(mayPress([delegation("kim", "lee")], sub("admin")), false);
    assert.equal(mayPress([], sub("admin")), false);
  });

  it("🔴 **두 겹이 안 이어진다** — A→B·B→C 에서 C 는 A 의 단계를 못 누른다", () => {
    const rows = [delegation("kim", "lee"), delegation("lee", "cho")];
    assert.equal(mayPress(rows, sub("cho")), false, "kim 이 맡긴 사람은 lee 뿐이다 — 동의한 적 없는 사람에게 결재권이 넘어간다");
    assert.equal(mayPress(rows, sub("lee")), true, "한 겹은 멀쩡히 돈다");
  });

  it("🔴 **다음 단계 결재자라도 앞 단계를 대신 누를 수 없다** — 위임이 이 울타리를 건드리지 않았다", () => {
    // 결재선에 lee 가 2단계로 있어도, kim(1단계)의 위임이 없으면 lee 는 1단계를 못 누른다.
    assert.equal(mayPress([delegation("park", "lee")], sub("lee")), false);
  });

  it("🔴 **A/S 번호로는 본인도 자기 차례를 못 집는다** — 열쇠는 포털 번호다", () => {
    assert.equal(mayPress([], asId("kim")), false);
    assert.equal(mayPress([delegation("kim", "lee")], asId("lee")), false);
  });

  it("이미 결정된 줄은 대리인도 못 누른다 — 위임은 **닫힌 단계를 열지 않는다**", () => {
    const acting = actingApproverSubs([delegation("kim", "lee")], sub("lee"), NOW);
    assert.equal(mayDecidePartIssueStep({ approverSub: sub("kim"), status: "APPROVED" }, acting), false);
    assert.equal(mayDecidePartIssueStep({ approverSub: sub("kim"), status: "REJECTED" }, acting), false);
  });

  it("🔴 **위임이 하나도 없으면 판정이 예전과 한 글자도 다르지 않다**", () => {
    assert.equal(mayPress([], sub("kim")), true, "본인은 누른다");
    for (const name of ["lee", "park", "cho", "admin"]) {
      assert.equal(mayPress([], sub(name)), false, `${name} 은 못 누른다`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 아래는 **순수 함수로는 닿지 않는 자리**를 글자로 못 박는 시험이다.      */
/* 🔴 DB 조건절은 아무도 돌려 보지 못한 채 운영으로 나간다(머리말).        */
/* ------------------------------------------------------------------ */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 🔴 **함수 하나만 잘라 낸다.** 파일 전체에서 글자를 찾으면 **옆 함수가 대신 통과시킨다** —
 * 2026-10-15 에 실제로 그랬다(`tests/notifications-bell-items.test.ts` 의 같은 helper 주석).
 * 자르는 범위가 곧 시험의 범위다.
 */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 가 사라졌다`);
  const end = source.indexOf("\nexport ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

const PART_ISSUE = "src/lib/approval/part-issue.ts";
const RULES = "src/lib/approval/part-issue-rules.ts";
const QUERIES = "src/lib/approval/delegation-queries.ts";

/** 세 조건절이 **똑같이** 써야 하는 글자. 하나라도 다르면 그 자리만 위임이 안 먹는다. */
const NARROW = "inArray(stockIssueApprovalSteps.approverSub, [...actingSubs])";

describe("② 🔴 **넷이 같은 함수에서 번호 목록을 받는다** — 이 조각의 핵심", () => {
  const server = src(PART_ISSUE);

  it("집행·목록·알림 종 **셋 다** 목록을 `actingApproverSubsFor` 에서 받는다", () => {
    for (const declaration of [
      "export async function decidePartIssueApproval(",
      "export async function listPartIssueApprovalsToDecide(",
      "export async function summarizePartIssueApprovalsToDecide(",
    ]) {
      const fn = bodyOf(server, declaration);
      assert.ok(fn.includes("actingApproverSubsFor("), `${declaration} 가 위임 목록을 직접 만들고 있다 — 두 벌이 다시 생겼다`);
      assert.ok(fn.includes(NARROW), `${declaration} 가 그 목록으로 좁히지 않는다`);
    }
  });

  it("🔴 **번호 하나로 좁히는 옛 꼴이 한 자리도 남아 있지 않다**", () => {
    // 🔴 한 자리만 `eq` 로 남으면 그 화면에서만 위임이 안 먹는다 — 오류가 아니라 「없음」이라
    //    아무도 신고하지 않는다. 셋이 전부 같은 글자인 것으로 그것을 막는다.
    assert.ok(!server.includes("eq(stockIssueApprovalSteps.approverSub"), "결재자 번호를 아직 하나로 견주는 자리가 있다");
    assert.equal(server.split(NARROW).length - 1, 3, "세 자리가 같은 글자로 좁히지 않는다(집행·목록·알림 종)");
  });

  it("넷째(순수 판정)는 **번호 하나가 아니라 그 목록**을 받는다", () => {
    const rules = src(RULES);
    assert.ok(
      rules.includes("export function mayDecidePartIssueStep(step: PartIssueStepAssignment, actingSubs: ActingApproverSubs): boolean {"),
      "순수 판정이 번호 하나를 받던 꼴로 돌아갔다 — 시험만 통과하고 운영은 그대로 막는다",
    );
    assert.ok(rules.includes('import type { ActingApproverSubs } from "./delegation";'), "목록 타입을 위임 쪽에서 받지 않는다 — 모양이 갈릴 수 있다");
  });

  it("🔴 목록을 **실제로 만드는 자리는 하나**다 — 표를 읽는 쪽이 순수 함수에 넘긴다", () => {
    const fn = bodyOf(src(QUERIES), "export async function actingApproverSubsFor(");
    assert.ok(fn.includes("return actingApproverSubs(rows, actorSub, now);"), "읽어 온 줄을 순수 판정에 넘기지 않는다 — 규칙이 두 벌이 된다");
  });
});

describe("③ 🔴 알림 종과 목록은 **같은 수**를 센다", () => {
  const server = src(PART_ISSUE);
  const list = bodyOf(server, "export async function listPartIssueApprovalsToDecide(");
  const bell = bodyOf(server, "export async function summarizePartIssueApprovalsToDecide(");

  it("둘 다 **같은 번호 목록**으로 좁힌다 — 대리인에게 둘이 함께 늘어난다", () => {
    // 🔴 한쪽만 고치면 「가 보면 있는데 알림이 없다」(또는 그 반대)가 된다.
    assert.ok(list.includes("actingApproverSubsFor(approverSub)"), "목록이 위임을 안 본다 — 대리인 화면이 비어 보인다");
    assert.ok(bell.includes("actingApproverSubsFor(approverSub)"), "종이 위임을 안 본다 — 대리인에게 알림이 안 간다");
    assert.ok(list.includes(NARROW) && bell.includes(NARROW));
  });

  it("나머지 두 조건도 그대로 같다 — 결재건은 `PENDING_APPROVAL`, 단계는 `REQUESTED`", () => {
    assert.ok(list.includes('eq(stockIssueApprovals.status, "PENDING_APPROVAL")'), "목록이 거둔 건·끝난 건까지 센다");
    assert.ok(bell.includes('eq(stockIssueApprovals.status, "PENDING_APPROVAL")'), "종이 거둔 건·끝난 건까지 센다");
    assert.ok(bell.includes('eq(stockIssueApprovalSteps.status, "REQUESTED")'), "종이 이미 결재한 단계까지 센다");
    // 🔵 목록 쪽의 「열린 단계만」은 `listSelect()` 의 leftJoin ON 에 걸려 있다(함수 밖이다).
    assert.ok(
      bodyOf(server, "function listSelect() {").includes('eq(stockIssueApprovalSteps.status, "REQUESTED")'),
      "목록이 이미 결재한 단계까지 끌어온다 — 종과 수가 갈린다",
    );
  });
});

describe("④ 🔴 `decided_by_*` 를 **언제나** 적는다", () => {
  const decide = bodyOf(src(PART_ISSUE), "export async function decidePartIssueApproval(");

  it("승인·반려 **둘 다**, 본인이 눌러도 **실제로 누른 사람**을 적는다", () => {
    // 🔴 비워 두면 「본인이 눌렀다」와 「이 칸이 생기기 전」이 **같은 모양**이 되어 영영 가를 수
    //    없다(표 쪽 주석의 세 갈래). 🔵 승인·반려가 같은 UPDATE 한 자리를 지나므로 둘 다 적힌다.
    assert.ok(
      decide.includes(".set({ status: decision, decidedAt: now, note, decidedBySub: actor.sub, decidedByName: actor.name })"),
      "누른 사람을 안 적거나, 본인일 때만 비우는 갈래가 생겼다",
    );
    assert.ok(!decide.includes("decidedBySub: null"), "본인이 눌렀을 때 비우고 있다 — 옛 줄과 구별할 수 없게 된다");
  });

  it("🔴 **`approver_sub` 는 건드리지 않는다** — 그 줄이 누구 자리였는지는 그대로 남아야 한다", () => {
    assert.ok(!decide.includes("approverSub: actor.sub"), "대리인이 눌렀다고 「누구 자리였나」를 덮고 있다");
    // 🔵 단계 줄을 고치는 자리는 저 UPDATE 하나뿐이다 — 둘이 되면 한쪽만 적는 날이 온다.
    assert.equal(src(PART_ISSUE).split(".update(stockIssueApprovalSteps)").length - 1, 1, "단계 줄을 고치는 자리가 둘이 됐다");
  });

  it("🔵 대리인이 눌렀나는 **두 칸을 견주어** 안다 — 깃발 칸을 따로 두지 않았다", () => {
    const schema = src("src/db/schema/stock-issue-approvals.ts");
    assert.ok(schema.includes("`decided_by_sub = approver_sub` — **본인**이 눌렀다."), "표 쪽 세 갈래 설명이 사라졌다");
    assert.ok(schema.includes("`decided_by_sub <> approver_sub` — **대리인**이 눌렀다."), "표 쪽 세 갈래 설명이 사라졌다");
  });
});

describe("⑤ 🔴 집행은 **읽기와 쓰기가 같은 트랜잭션** 안에 있다", () => {
  const decide = bodyOf(src(PART_ISSUE), "export async function decidePartIssueApproval(");

  it("위임을 `tx` 로, 결재 시각과 **같은 순간**으로 읽는다", () => {
    // 🔴 밖에서 읽으면 읽은 뒤 집기 전 사이에 위임이 끝나거나 되돌려질 수 있고, 그때 권한이
    //    없는데 통과한 결재가 한 건 남는다. 🔵 함수의 기본값이 `db()` 라 안 넘겨도 오류가 없다.
    assert.ok(decide.includes("actingApproverSubsFor(actor.sub, tx, now)"), "집행이 위임을 트랜잭션 밖에서(또는 다른 시각으로) 읽는다");
    // 🔴 `now` 가 그 UPDATE 의 `decided_at` 과 같은 값이어야 한다 — 위에서 한 번만 만든다.
    assert.equal(decide.split("new Date()").length - 1, 1, "결재 한 번에 시각을 두 번 만들고 있다 — 판정과 기록이 갈린다");
  });
});

describe("⑥ 🔴 위임 조회는 **색인을 탄다** — 표를 통째로 읽어 JS 에서 거르지 않는다", () => {
  const fn = bodyOf(src(QUERIES), "export async function actingApproverSubsFor(");

  it("색인 차례대로 세 조건을 건다 — `delegate_sub` · `revoked_at IS NULL` · `ends_at > now`", () => {
    // 🔴 위임 표는 지워지지 않고 쌓인다(되돌리기도 깃발이다). 통째 읽기는 해가 갈수록 느려지고,
    //    느려지는 자리가 하필 모든 화면에 딸려 오는 알림 종이다. 조각 1이 깐 색인이
    //    `(delegate_sub, revoked_at, ends_at)` 이고 아래 차례가 그 차례다.
    assert.ok(fn.includes("eq(approvalDelegations.delegateSub, actorSub)"), "대신할 사람으로 좁히지 않는다");
    assert.ok(fn.includes("isNull(approvalDelegations.revokedAt)"), "되돌린 줄까지 읽는다");
    assert.ok(fn.includes("gt(approvalDelegations.endsAt, now)"), "이미 끝난 줄까지 읽는다 — 표가 통째로 딸려 온다");
  });

  it("🔵 `starts_at` 은 **SQL 로 거르지 않는다** — 색인에 없고, 반열린 구간 판정은 한 곳에만 있다", () => {
    // 🔵 그 칸이 나오는 자리는 **읽어 오는 한 줄뿐**이다. 둘이 되면 WHERE 에도 걸린 것이고,
    //    그 순간 「끝을 포함하는가」가 SQL 과 순수 함수 두 곳에 적힌다.
    assert.ok(fn.includes("startsAt: approvalDelegations.startsAt"), "시작 시각을 안 읽어 온다 — 순수 함수가 거를 수 없다");
    assert.equal(fn.split("approvalDelegations.startsAt").length - 1, 1, "시작 시각을 SQL 에서도 거르고 있다 — 반열린 구간 규칙이 두 벌이 된다");
  });
});

describe("⑦ 🔴 위임이 **건드리지 않은 것** — 승인 절차와 상태 전이", () => {
  it("위임 쪽 두 파일은 결재선 표도 신청 상태도 모른다", () => {
    for (const path of ["src/lib/approval/delegation.ts", QUERIES]) {
      const file = src(path);
      assert.ok(!file.includes("approvalRoutes"), `${path} 가 승인 절차 표를 건드린다 — 「원래 누가 결재하게 돼 있었나」가 사라진다`);
      assert.ok(!file.includes("approvalRouteSteps"), `${path} 가 승인 절차 단계를 건드린다`);
      assert.ok(!file.includes("requestStatusAfterPartIssue"), `${path} 가 신청 상태 전이를 새로 만든다 — 신청이 「결재 중」에 갇힐 수 있다`);
    }
  });

  it("🔴 신청 상태의 네 갈래는 그대로다 — 위임은 **새 전이를 만들지 않는다**", () => {
    const rules = src(RULES);
    assert.ok(rules.includes('case "ISSUE_REQUESTED":\n      return "IN_APPROVAL";'), "올릴 때 가는 자리가 바뀌었다");
    assert.ok(rules.includes('case "APPROVAL_REJECTED":\n      return "REJECTED";'), "반려 때 가는 자리가 바뀌었다");
    assert.ok(rules.includes('case "APPROVAL_CANCELLED":\n      return reopenedRequestStatus(issuedTotal);'), "거둘 때 가는 자리가 바뀌었다");
  });
});
