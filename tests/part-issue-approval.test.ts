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
 * ============================================================================
 */

/** 결재선 한 판의 단계 모양 — `approval_route_steps` 를 읽은 것과 같은 모양이다. */
const route = (...approvers: string[]) =>
  approvers.map((approverUserId, index) => ({
    stepOrder: index + 1,
    approverUserId,
    approverName: `${approverUserId} 님`,
    approverRole: "STAFF",
  }));

describe("① 결재선 단계 → 이 건이 밟을 단계 목록", () => {
  it("🔴 판이 없으면(단계 0개) 결재건을 만들지 않는다 — NO_ROUTE", () => {
    const plan = planPartIssueApproval([], "kim");
    assert.equal(plan.kind, "NO_ROUTE", "여기서 결재건을 만들면 아무도 결재할 수 없는 건만 쌓여 재고가 잠긴다");
  });

  it("남이 올리면 단계가 그대로 다 남는다", () => {
    const plan = planPartIssueApproval(route("kim", "lee", "park"), "cho");
    assert.equal(plan.kind, "NEEDS_APPROVAL");
    assert.deepEqual(
      plan.steps.map((s) => s.stepOrder),
      [1, 2, 3],
    );
  });

  it("🔴 신청자가 결재선에 있으면 그 단계가 빠진다 — 번호는 건너뛴 채로 남는다", () => {
    const plan = planPartIssueApproval(route("kim", "lee", "park"), "lee");
    assert.equal(plan.kind, "NEEDS_APPROVAL");
    assert.deepEqual(
      plan.steps.map((s) => s.approverUserId),
      ["kim", "park"],
      "자기가 올린 것을 자기가 결재하는 칸은 없다",
    );
    assert.deepEqual(
      plan.steps.map((s) => s.stepOrder),
      [1, 3],
      "🔴 2 를 빼고 1,2 로 고쳐 적지 않는다 — 그 틈이 「건너뛰었다」는 사실 그 자체다",
    );
  });

  it("단계가 뒤섞여 들어와도 번호가 작은 것부터 센다", () => {
    const shuffled = [route("kim", "lee", "park")[2], route("kim", "lee", "park")[0], route("kim", "lee", "park")[1]];
    const plan = planPartIssueApproval(shuffled, "cho");
    assert.equal(plan.kind, "NEEDS_APPROVAL");
    assert.deepEqual(
      plan.steps.map((s) => s.stepOrder),
      [1, 2, 3],
    );
  });

  it("🔴 건너뛰어서 남는 단계가 하나도 없으면 곧바로 승인 — 기다릴 사람이 없다", () => {
    const plan = planPartIssueApproval(route("kim"), "kim");
    assert.equal(plan.kind, "AUTO_APPROVED", "PENDING_APPROVAL 로 두면 아무도 누를 수 없는 건이 영영 남는다");
    assert.deepEqual(plan.steps, []);
  });

  it("🔵 「절차 없음」과 「전부 건너뜀」을 가른다 — 뒤쪽은 결재건이 남아야 한다", () => {
    assert.equal(planPartIssueApproval([], "kim").kind, "NO_ROUTE");
    assert.equal(planPartIssueApproval(route("kim"), "kim").kind, "AUTO_APPROVED");
  });
});

describe("② 지금 차례가 누구인가", () => {
  it("🔴 내 차례가 아닌 사람은 결재할 수 없다", () => {
    const step = { approverUserId: "kim", status: "REQUESTED" as const };
    assert.equal(mayDecidePartIssueStep(step, "kim"), true);
    assert.equal(mayDecidePartIssueStep(step, "lee"), false, "다음 단계 결재자라도 앞 단계를 대신 누를 수 없다");
    assert.equal(mayDecidePartIssueStep(step, "admin"), false, "🔴 관리자라고 대신 누를 수 있는 길을 두지 않는다");
  });

  it("이미 결정된 줄은 같은 사람이라도 다시 누를 수 없다", () => {
    assert.equal(mayDecidePartIssueStep({ approverUserId: "kim", status: "APPROVED" }, "kim"), false);
    assert.equal(mayDecidePartIssueStep({ approverUserId: "kim", status: "REJECTED" }, "kim"), false);
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
