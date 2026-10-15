import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkCanCancelPartIssue,
  checkCanDecidePartIssue,
  checkCanExecutePartIssue,
  checkIssueQuantities,
  checkRejectReason,
  isOpenPartIssueStatus,
  mayDecidePartIssueStep,
  OPEN_PART_ISSUE_STATUSES,
  PART_ISSUE_ROUTE_MISSING_SUB_MESSAGE,
  PART_ISSUE_STATUS_LABELS,
  PART_ISSUE_STATUSES,
  PART_ISSUE_STEP_STATUS_LABELS,
  PART_ISSUE_STEP_STATUSES,
  planPartIssueApproval,
  readIssueQuantities,
  type PartIssueStatus,
} from "../src/lib/approval/part-issue-rules";
import { stockIssueApprovalStatusEnum, stockIssueApprovalStepStatusEnum } from "../src/db/schema/stock-issue-approvals";

/**
 * ============================================================================
 * 부품 불출 결재 — 순수 규칙 (2026-10-15, 조각 11a)
 * ============================================================================
 * 이 저장소에는 DB 시험이 없다. 그래서 **서버가 기대는 규칙을 여기서 전부 돌려 본다** —
 * 서버(`src/lib/approval/part-issue.ts`)는 이 함수들을 부르기만 한다.
 *
 * 여기서 못 박는 것:
 *  1. **신청자가 결재선에 있으면 그 단계가 빠진다**(그리고 전부 빠지면 기다릴 것이 없다).
 *  2. **판이 없거나 단계가 0개면 결재건을 만들지 않는다** — 이 안전장치가 없으면 기능을
 *     올리는 순간 재고가 통째로 잠긴다.
 *  3. **내 차례가 아닌 사람은 결재할 수 없다.**
 *  4. **`APPROVED` 가 아니면 실행할 수 없다** — 특히 `PENDING_APPROVAL`(결재 전)과
 *     `EXECUTED`(두 번 나감) 둘 다 막힌다.
 *  5. **반려되면 닫힌다** — 그 뒤로는 결재도 실행도 거두기도 되지 않는다.
 *  6. 상태 값 목록이 표의 enum 과 **글자 그대로 같다**(스키마 파일이 도메인 층을 가져오지
 *     않는 이 저장소의 관례라 두 벌이 된다. 갈라지면 화면은 받아 주는데 저장이 22P02 로 터진다).
 *
 * ── 🔴 그리고 **열쇠는 포털 번호다**(2026-10-15) ───────────────────────
 * 결재자는 A/S 명부에서 고르지만, 그 사람이 **여기 로그인했을 때의 번호**는 A/S 번호가 아니다.
 * 그래서 「내 차례인가」도 「신청자 건너뛰기」도 포털 번호로 가린다. 7·8·9 를 더 못 박는다:
 *  7. 🔴 **A/S 번호를 넘기면 거짓이다** — 이 시험이 2026-10-15 결함의 울타리다(코드는 맞고
 *     값이 안 맞는 결함이라, 이 시험이 없으면 다시 생겨도 아무도 모른다).
 *  8. 결재선에 포털 번호 없는 단계가 하나라도 있으면 **결재건을 만들지 않는다.**
 *  9. 그것을 「절차 없음」과 **가른다** — 뭉개면 관리자가 세워 둔 결재를 건너뛰고 부품이 나간다.
 * ============================================================================
 */

/**
 * 가짜 A/S 번호와 가짜 포털 번호. 🔴 **일부러 다른 모양**으로 둔다 — 같은 값으로 두면 열쇠를
 * 바꿔 넘겨도 시험이 통과해 버려 울타리 구실을 못 한다.
 */
const asId = (name: string) => `as-${name}`;
const sub = (name: string) => `sub-${name}`;

/** 결재선 한 판의 단계 모양 — `approval_route_steps` 를 읽은 것과 같은 모양이다. */
const route = (...approvers: string[]) =>
  approvers.map((name, index) => ({
    stepOrder: index + 1,
    approverUserId: asId(name),
    approverSub: sub(name) as string | null,
    approverName: `${name} 님`,
    approverRole: "STAFF",
  }));

/** 포털 번호가 빠진 단계(옛 판). 🔴 그런 단계가 하나라도 있으면 결재건을 올릴 수 없다. */
const withoutSub = <T extends { approverSub: string | null }>(step: T): T => ({ ...step, approverSub: null });

describe("① 결재선 단계 → 이 건이 밟을 단계 목록", () => {
  it("🔴 판이 없으면(단계 0개) 결재건을 만들지 않는다 — NO_ROUTE", () => {
    const plan = planPartIssueApproval([], sub("kim"));
    assert.equal(plan.kind, "NO_ROUTE", "여기서 결재건을 만들면 아무도 결재할 수 없는 건만 쌓여 재고가 잠긴다");
  });

  it("남이 올리면 단계가 그대로 다 남는다", () => {
    const plan = planPartIssueApproval(route("kim", "lee", "park"), sub("cho"));
    assert.equal(plan.kind, "NEEDS_APPROVAL");
    assert.deepEqual(
      plan.steps.map((s) => s.stepOrder),
      [1, 2, 3],
    );
  });

  it("🔴 신청자가 결재선에 있으면 그 단계가 빠진다 — 포털 번호로 가린다", () => {
    const plan = planPartIssueApproval(route("kim", "lee", "park"), sub("lee"));
    assert.equal(plan.kind, "NEEDS_APPROVAL");
    assert.deepEqual(
      plan.steps.map((s) => s.approverUserId),
      [asId("kim"), asId("park")],
      "자기가 올린 것을 자기가 결재하는 칸은 없다",
    );
    assert.deepEqual(
      plan.steps.map((s) => s.stepOrder),
      [1, 3],
      "🔴 2 를 빼고 1,2 로 고쳐 적지 않는다 — 그 틈이 「건너뛰었다」는 사실 그 자체다",
    );
  });

  it("🔴 신청자의 A/S 번호를 넘기면 아무 단계도 안 빠진다 — 열쇠는 포털 번호다", () => {
    // 🔴 2026-10-15 결함의 울타리. 이 시험이 깨지면 열쇠가 다시 뒤바뀐 것이다.
    const plan = planPartIssueApproval(route("kim", "lee", "park"), asId("lee"));
    assert.equal(plan.kind, "NEEDS_APPROVAL");
    assert.deepEqual(
      plan.steps.map((s) => s.stepOrder),
      [1, 2, 3],
      "A/S 번호는 결재선의 포털 번호와 영영 안 맞는다 — 건너뛰기가 조용히 꺼진다",
    );
  });

  it("단계가 뒤섞여 들어와도 번호가 작은 것부터 센다", () => {
    const shuffled = [route("kim", "lee", "park")[2], route("kim", "lee", "park")[0], route("kim", "lee", "park")[1]];
    const plan = planPartIssueApproval(shuffled, sub("cho"));
    assert.equal(plan.kind, "NEEDS_APPROVAL");
    assert.deepEqual(
      plan.steps.map((s) => s.stepOrder),
      [1, 2, 3],
    );
  });

  it("🔴 건너뛰어서 남는 단계가 하나도 없으면 곧바로 승인 — 기다릴 사람이 없다", () => {
    const plan = planPartIssueApproval(route("kim"), sub("kim"));
    assert.equal(plan.kind, "AUTO_APPROVED", "PENDING_APPROVAL 로 두면 아무도 누를 수 없는 건이 영영 남는다");
    assert.deepEqual(plan.steps, []);
  });

  it("🔵 「절차 없음」과 「전부 건너뜀」을 가른다 — 뒤쪽은 결재건이 남아야 한다", () => {
    assert.equal(planPartIssueApproval([], sub("kim")).kind, "NO_ROUTE");
    assert.equal(planPartIssueApproval(route("kim"), sub("kim")).kind, "AUTO_APPROVED");
  });

  // ────────────────────────────── 포털 번호 없는 단계가 섞인 결재선 (2026-10-15)

  it("🔴 포털 번호 없는 단계가 하나라도 있으면 결재건을 올릴 수 없다", () => {
    const [first, second] = route("kim", "lee");
    const plan = planPartIssueApproval([first, withoutSub(second)], sub("cho"));
    assert.equal(plan.kind, "MISSING_SUB", "그 단계는 아무도 열 수 없는 문이다 — 올리면 영영 결재되지 않는 건이 남는다");
    assert.ok(plan.kind === "MISSING_SUB");
    assert.equal(plan.message, PART_ISSUE_ROUTE_MISSING_SUB_MESSAGE);
    assert.ok(plan.message.includes("설정"), "🔴 고치는 길까지 말해 준다");
  });

  it("🔴 **남는 단계가 아니어도** 본다 — 앞 단계만 보면 사슬이 뒤에서 멈춘다", () => {
    // 1단계는 멀쩡하고 번호 없는 것은 3단계뿐이다. 그래도 올리지 않는다 — 올리면 앞 둘이
    // 결재를 한 **뒤에** 멈춘다(그때는 되돌리기가 더 어렵다).
    const [kim, lee, park] = route("kim", "lee", "park");
    const plan = planPartIssueApproval([kim, lee, withoutSub(park)], sub("cho"));
    assert.equal(plan.kind, "MISSING_SUB");
  });

  it("🔴 신청자 본인 단계라 어차피 건너뛸 자리여도 거절한다 — 판 전체를 본다", () => {
    const [kim, lee] = route("kim", "lee");
    const plan = planPartIssueApproval([kim, withoutSub(lee)], sub("lee"));
    assert.equal(plan.kind, "MISSING_SUB", "번호 없는 줄을 건너뛰어 통과시키면 결재선이 고장 난 채 굳는다");
  });

  it("🔵 「절차 없음」과 **가른다** — 뭉개면 세워 둔 결재를 건너뛰고 부품이 나간다", () => {
    const [kim] = route("kim");
    assert.equal(planPartIssueApproval([withoutSub(kim)], sub("cho")).kind, "MISSING_SUB");
    assert.notEqual(planPartIssueApproval([withoutSub(kim)], sub("cho")).kind, "NO_ROUTE");
  });
});

describe("② 지금 차례가 누구인가", () => {
  it("🔴 내 차례가 아닌 사람은 결재할 수 없다", () => {
    const step = { approverSub: sub("kim"), status: "REQUESTED" as const };
    assert.equal(mayDecidePartIssueStep(step, sub("kim")), true);
    assert.equal(mayDecidePartIssueStep(step, sub("lee")), false, "다음 단계 결재자라도 앞 단계를 대신 누를 수 없다");
    assert.equal(mayDecidePartIssueStep(step, sub("admin")), false, "🔴 관리자라고 대신 누를 수 있는 길을 두지 않는다");
  });

  it("🔴 A/S 번호를 넘기면 거짓이다 — 열쇠는 포털 번호 하나뿐이다", () => {
    // 🔴 **이 시험이 2026-10-15 결함의 울타리다.** 같은 사람인데 번호가 달라서, 열쇠를 되돌리면
    //    「내가 결재할 건」이 영원히 빈 목록이 된다(코드는 맞고 값이 안 맞아 눈으로도 안 보인다).
    const step = { approverSub: sub("kim"), status: "REQUESTED" as const };
    assert.equal(mayDecidePartIssueStep(step, asId("kim")), false, "A/S 번호로 견주면 본인도 자기 차례를 못 집는다");
  });

  it("이미 결정된 줄은 같은 사람이라도 다시 누를 수 없다", () => {
    assert.equal(mayDecidePartIssueStep({ approverSub: sub("kim"), status: "APPROVED" }, sub("kim")), false);
    assert.equal(mayDecidePartIssueStep({ approverSub: sub("kim"), status: "REJECTED" }, sub("kim")), false);
  });
});

describe("③ 어떤 상태에서 무엇을 할 수 있나", () => {
  it("결재는 PENDING_APPROVAL 에서만", () => {
    assert.equal(checkCanDecidePartIssue("PENDING_APPROVAL").ok, true);
    for (const status of ["APPROVED", "EXECUTED", "REJECTED", "CANCELLED"] as const) {
      assert.equal(checkCanDecidePartIssue(status).ok, false, status);
    }
  });

  it("🔴 APPROVED 가 아니면 실행할 수 없다", () => {
    assert.equal(checkCanExecutePartIssue("APPROVED").ok, true);
    assert.equal(checkCanExecutePartIssue("PENDING_APPROVAL").ok, false, "결재 전에 나가면 결재가 무의미하다");
    assert.equal(checkCanExecutePartIssue("EXECUTED").ok, false, "두 번 실행되면 같은 결재로 재고가 두 번 나간다");
    assert.equal(checkCanExecutePartIssue("REJECTED").ok, false);
    assert.equal(checkCanExecutePartIssue("CANCELLED").ok, false);
  });

  it("막을 때는 지금 상태를 한글로 알려 준다 — 코드값이 그대로 나가지 않는다", () => {
    const gate = checkCanExecutePartIssue("PENDING_APPROVAL");
    assert.equal(gate.ok, false);
    assert.ok(gate.message.includes("결재 중"), gate.message);
    assert.ok(!gate.message.includes("PENDING_APPROVAL"), gate.message);
  });

  it("거두기는 본인이 결재 중일 때만", () => {
    assert.equal(checkCanCancelPartIssue("PENDING_APPROVAL", "kim", "kim").ok, true);
    assert.equal(checkCanCancelPartIssue("PENDING_APPROVAL", "kim", "lee").ok, false, "남의 건은 못 거둔다");
    assert.equal(checkCanCancelPartIssue("APPROVED", "kim", "kim").ok, false, "승인된 건은 담당자의 일감 목록에 올라가 있다");
    assert.equal(checkCanCancelPartIssue("EXECUTED", "kim", "kim").ok, false);
  });

  it("🔴 반려되면 닫힌다 — 그 뒤로는 결재도 실행도 거두기도 되지 않는다", () => {
    assert.equal(checkCanDecidePartIssue("REJECTED").ok, false);
    assert.equal(checkCanExecutePartIssue("REJECTED").ok, false);
    assert.equal(checkCanCancelPartIssue("REJECTED", "kim", "kim").ok, false);
    assert.equal(isOpenPartIssueStatus("REJECTED"), false, "살아 있는 건으로 세지 않는다 — 같은 신청에 다시 올릴 수 있어야 한다");
  });

  it("반려에는 사유가 있어야 한다 — 공백만 적은 것도 거절", () => {
    assert.equal(checkRejectReason("수량이 과합니다").ok, true);
    assert.equal(checkRejectReason("").ok, false);
    assert.equal(checkRejectReason("   ").ok, false);
  });

  it("🔴 살아 있는 건은 결재 중·승인됨 둘뿐이다 — 표의 부분 유니크 색인이 보는 묶음과 같다", () => {
    assert.deepEqual([...OPEN_PART_ISSUE_STATUSES], ["PENDING_APPROVAL", "APPROVED"]);
    const open = PART_ISSUE_STATUSES.filter((s) => isOpenPartIssueStatus(s));
    assert.deepEqual(open, ["PENDING_APPROVAL", "APPROVED"]);
  });
});

describe("줄별 「이번에 줄 수량」", () => {
  it("빈 신청·0 뿐인 신청을 거절한다", () => {
    assert.equal(checkIssueQuantities([]).ok, false);
    assert.equal(checkIssueQuantities([{ partId: "p1", quantity: 0 }]).ok, false);
    assert.equal(checkIssueQuantities([{ partId: "p1", quantity: 0 }, { partId: "p2", quantity: 2 }]).ok, true);
  });

  it("같은 부품이 두 줄이거나 수량이 음수·소수면 거절", () => {
    assert.equal(checkIssueQuantities([{ partId: "p1", quantity: 1 }, { partId: "p1", quantity: 2 }]).ok, false);
    assert.equal(checkIssueQuantities([{ partId: "p1", quantity: -1 }]).ok, false);
    assert.equal(checkIssueQuantities([{ partId: "p1", quantity: 1.5 }]).ok, false);
  });

  it("jsonb 로 되읽을 때 모양이 아니면 null — 재고를 빼기 전에 한 번 더 본다", () => {
    assert.deepEqual(readIssueQuantities([{ partId: "p1", quantity: 3 }]), [{ partId: "p1", quantity: 3 }]);
    assert.deepEqual(readIssueQuantities([]), []);
    assert.equal(readIssueQuantities(null), null);
    assert.equal(readIssueQuantities({ partId: "p1" }), null);
    assert.equal(readIssueQuantities([{ partId: "", quantity: 1 }]), null);
    assert.equal(readIssueQuantities([{ partId: "p1", quantity: "3" }]), null);
    assert.equal(readIssueQuantities([{ partId: "p1" }]), null);
  });
});

describe("🔴 상태 값 목록이 표의 enum 과 글자 그대로 같다", () => {
  it("결재건 상태", () => {
    assert.deepEqual([...stockIssueApprovalStatusEnum.enumValues], [...PART_ISSUE_STATUSES], "갈라지면 저장이 22P02 로 터진다");
  });

  it("단계 상태", () => {
    assert.deepEqual([...stockIssueApprovalStepStatusEnum.enumValues], [...PART_ISSUE_STEP_STATUSES]);
  });

  it("🔴 APPROVED 와 EXECUTED 가 둘 다 있다 — 「승인은 났는데 아직 안 나갔다」가 실재하는 상태다", () => {
    assert.ok(PART_ISSUE_STATUSES.includes("APPROVED"));
    assert.ok(PART_ISSUE_STATUSES.includes("EXECUTED"));
  });

  it("모든 상태에 한글 이름이 있고 코드값이 그대로 나가지 않는다", () => {
    for (const status of PART_ISSUE_STATUSES) {
      const label = PART_ISSUE_STATUS_LABELS[status as PartIssueStatus];
      assert.ok(label, status);
      assert.notEqual(label, status);
    }
    for (const status of PART_ISSUE_STEP_STATUSES) {
      assert.ok(PART_ISSUE_STEP_STATUS_LABELS[status], status);
      assert.notEqual(PART_ISSUE_STEP_STATUS_LABELS[status], status);
    }
  });
});
