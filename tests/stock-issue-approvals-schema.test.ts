import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { stockIssueApprovalSteps, stockIssueApprovals } from "../src/db/schema/stock-issue-approvals";
import { stockRequests } from "../src/db/schema/stock-requests";
import { approvalRoutes } from "../src/db/schema/approval-routes";

/**
 * 부품 불출 결재 표 둘의 모양 (2026-10-15, 조각 11a).
 *
 * DB 에 붙지 않는다 — 스키마 객체만 본다. 여기서 지키는 것은 **마이그레이션을 다시 만들 때
 * 조용히 바뀌면 안 되는 자리**다. 특히 「없어야 한다」가 많은 표라서(사람 FK · 소프트 삭제 ·
 * 신청 항목 표), 다음 사람이 「규칙 위반」으로 보고 칸을 더하면 여기서 깨진다.
 */

const approvals = getTableConfig(stockIssueApprovals);
const steps = getTableConfig(stockIssueApprovalSteps);

const columnOf = (table: ReturnType<typeof getTableConfig>, name: string) => table.columns.find((c) => c.name === name);
const indexNames = (table: ReturnType<typeof getTableConfig>) => table.indexes.map((i) => i.config.name).sort();

describe("표 이름 — 둘뿐이다", () => {
  it("결재건은 stock_issue_approvals", () => {
    assert.equal(approvals.name, "stock_issue_approvals");
  });

  it("단계별 결재는 stock_issue_approval_steps", () => {
    assert.equal(steps.name, "stock_issue_approval_steps");
  });
});

describe("stock_issue_approvals — 칸", () => {
  it("🔴 반출 신청을 가리키는 칸은 NOT NULL 이다 — 요청을 거치지 않는 반출이 없다", () => {
    const col = columnOf(approvals, "request_id");
    assert.ok(col);
    assert.equal(col.notNull, true, "비울 수 있게 두면 실행할 길이 없는 행이 생긴다");
    const fk = approvals.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "request_id"));
    assert.ok(fk);
    assert.equal(fk.reference().foreignTable, stockRequests);
    assert.equal(fk.onDelete, "restrict");
  });

  it("🔴 어느 판으로 올렸는지를 적는다 — 절차를 바꿔도 진행 중인 건은 옛 판을 따라간다", () => {
    const col = columnOf(approvals, "route_id");
    assert.ok(col);
    assert.equal(col.notNull, true, "판이 없으면 결재건 자체가 만들어지지 않는다");
    const fk = approvals.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "route_id"));
    assert.ok(fk);
    assert.equal(fk.reference().foreignTable, approvalRoutes);
  });

  it("status 는 stock_issue_approval_status enum 이고 기본값이 PENDING_APPROVAL", () => {
    const col = columnOf(approvals, "status");
    assert.ok(col);
    assert.equal(col.getSQLType(), "stock_issue_approval_status");
    assert.equal(col.default, "PENDING_APPROVAL");
  });

  it("🔵 줄별 수량은 jsonb 한 칸이다 — 신청 항목 표를 두지 않는다", () => {
    assert.equal(columnOf(approvals, "quantities")?.getSQLType(), "jsonb");
    assert.equal(columnOf(approvals, "quantities")?.notNull, true);
  });

  it("🔴 올린 사람·실행한 사람에 FK 가 없다 — A/S 의 사람이 이 시스템 users 에 없을 수 있다", () => {
    for (const name of ["requested_by", "executed_by"]) {
      const fk = approvals.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === name));
      assert.equal(fk, undefined, `${name} 에 FK 를 걸면 A/S 쪽 계정으로 올린 건을 넣을 수 없다`);
    }
  });

  it("이름은 그때의 사본이다 — 올린 사람 이름은 notNull, 실행한 사람 이름은 실행 전까지 비어 있다", () => {
    assert.equal(columnOf(approvals, "requested_by_name")?.notNull, true);
    assert.equal(columnOf(approvals, "executed_by_name")?.notNull, false);
  });

  it("실행이 만든 원장 머리 칸이 있고 실행 전에는 빌 수 있다", () => {
    const col = columnOf(approvals, "entry_id");
    assert.ok(col);
    assert.equal(col.notNull, false);
  });

  it("🔴 소프트 삭제 4칸이 없다 — 무르는 길은 CANCELLED 상태이지 삭제가 아니다", () => {
    for (const name of ["is_deleted", "deleted_at", "deleted_by", "delete_reason"]) {
      assert.equal(columnOf(approvals, name), undefined, `${name} 이 생겼다 — 결재 이력이 휴지통으로 사라지면 안 된다`);
    }
  });

  it("🔴 접수 건·사용처·절차 작업 칸이 없다 — 「직접 사용」 길이 이 시스템에는 없다", () => {
    for (const name of ["repair_case_id", "destination_note", "procedure_execution_node_id"]) {
      assert.equal(columnOf(approvals, name), undefined, `${name} — 반출은 전부 요청으로 올라온다(2026-10-15 결정)`);
    }
  });

  it("🔴 한 신청에 살아 있는 결재건은 하나뿐 — 부분 유니크 색인", () => {
    const uq = approvals.indexes.find((i) => i.config.name === "stock_issue_approvals_request_open_uq");
    assert.ok(uq, "stock_issue_approvals_request_open_uq 가 없으면 화면 검사만으로는 두 번 올라가는 것을 못 막는다");
    assert.equal(uq.config.unique, true);
    assert.deepEqual(
      uq.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["request_id"],
    );
    assert.ok(uq.config.where, "조건이 없으면 반려된 뒤 다시 올릴 수 없게 된다");
  });

  it("상태·올린 사람으로 찾는 색인이 있다", () => {
    assert.deepEqual(indexNames(approvals), ["stock_issue_approvals_request_open_uq", "stock_issue_approvals_requester_idx", "stock_issue_approvals_status_idx"]);
  });

  it("실행 기록과 상태가 같은 말이 되게 DB 가 막는다", () => {
    assert.deepEqual(
      approvals.checks.map((c) => c.name),
      ["stock_issue_approvals_execution_metadata"],
    );
  });
});

describe("stock_issue_approval_steps — 칸", () => {
  it("🔵 결재건을 RESTRICT 로 가리킨다 — 결재 기록이 함께 사라지면 안 된다", () => {
    const fk = steps.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "approval_id"));
    assert.ok(fk);
    assert.equal(fk.onDelete, "restrict");
    assert.equal(fk.reference().foreignTable, stockIssueApprovals);
  });

  it("단계 차례·결재자·이름·역할이 전부 notNull", () => {
    for (const name of ["step_order", "approver_user_id", "approver_name", "approver_role"]) {
      assert.equal(columnOf(steps, name)?.notNull, true, name);
    }
  });

  it("🔴 결재자에 FK 가 없다 — uuid 값으로만 적고 이름·역할은 사본이다", () => {
    const fk = steps.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "approver_user_id"));
    assert.equal(fk, undefined);
    assert.equal(columnOf(steps, "approver_name")?.getSQLType(), "text");
    assert.equal(columnOf(steps, "approver_role")?.getSQLType(), "text");
  });

  it("한 결재건 안에서 단계 차례는 한 번만 — (approval_id, step_order) 유니크", () => {
    const uq = steps.indexes.find((i) => i.config.name === "stock_issue_approval_steps_order_uq");
    assert.ok(uq);
    assert.equal(uq.config.unique, true);
    assert.deepEqual(
      uq.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["approval_id", "step_order"],
    );
  });

  it("🔴 열려 있는 단계는 한 번에 하나뿐 — 아니면 순차 승인이라는 말이 성립하지 않는다", () => {
    const uq = steps.indexes.find((i) => i.config.name === "stock_issue_approval_steps_one_open_uq");
    assert.ok(uq, "stock_issue_approval_steps_one_open_uq 가 없다");
    assert.equal(uq.config.unique, true);
    assert.ok(uq.config.where);
  });

  it("「내가 결재할 건」이 (결재자, 상태)로 들어온다", () => {
    const idx = steps.indexes.find((i) => i.config.name === "stock_issue_approval_steps_approver_idx");
    assert.ok(idx);
    assert.equal(idx.config.unique, false);
    assert.deepEqual(
      idx.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["approver_user_id", "status"],
    );
  });

  it("단계 차례 1 이상과 결정 칸의 짝을 DB 가 막는다", () => {
    assert.deepEqual(steps.checks.map((c) => c.name).sort(), ["stock_issue_approval_steps_decision_metadata", "stock_issue_approval_steps_step_order_positive"]);
  });
});
