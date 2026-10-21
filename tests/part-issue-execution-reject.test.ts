import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { AUDIT_ACTION_LABEL, AUDIT_ACTIONS } from "../src/lib/audit-labels";
import {
  checkCanExecutePartIssue,
  checkCanRejectExecutionPartIssue,
  checkRejectReason,
  requestStatusAfterPartIssue,
  PART_ISSUE_STATUSES,
} from "../src/lib/approval/part-issue-rules";
import { DECIDED_ISSUE_APPROVAL_STATUSES } from "../src/lib/notifications/bell-items";

/**
 * ============================================================================
 * 실행 대기에서 반려 — 결재가 다 끝난 건을 담당자가 멈춘다 (2026-10-21)
 * ============================================================================
 * 2026-10-21 에 「결재 중」을 만들며 결재가 도는 동안 담당자의 [반려]·[보류]·[신청 취소]를
 * 닫았다. 그 결과 **결재가 다 끝나 [실행]만 남으면 아무도 그 건을 멈출 수 없었다** — 재고가
 * 모자라도 할 수 있는 일은 「실행하지 않고 두기」뿐이라 그 건은 「실행할 건」 목록에 영원히 떠
 * 있었다. 이 조각이 그 빚을 갚고, 이 파일이 그것을 못 박는다.
 *
 * ── 🔴 **왜 소스 글자로 재는가** ────────────────────────────────────────
 * 이 저장소에는 **DB 시험도 화면 렌더 시험도 없다**(`src/lib/approval/part-issue-rules.ts`
 * 머리말). 그래서 두 가지를 갈라 잰다:
 *
 *  1. **순수 판정** — 어떤 상태에서 되는가 · 사유가 없으면 막히는가 · 신청이 어디로 가는가.
 *     돌려 볼 수 있으므로 **실제로 돌린다.**
 *  2. **한 트랜잭션인가 · 사유를 신청에 복사하는가 · 관리자만인가** — 돌려 볼 방법이 없다.
 *     글자로 재는 것이 약한 울타리인 것은 맞지만, **없는 것보다 훨씬 낫다**
 *     (`tests/part-issue-gate.test.ts` 가 같은 까닭으로 같은 방식을 쓴다). 둘 중 하나가
 *     끊기면 **되돌릴 수 없는 일**이 생기는 자리다: 결재건만 닫히고 신청이 `IN_APPROVAL` 에
 *     남으면 그 신청은 다섯 단추를 전부 거절하는 자리에 **갇힌다.**
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 그 함수의 **본문만** 잘라 낸다 — `tests/part-issue-gate.test.ts` 의 같은 함수와 같은 잣대다. */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 를 찾지 못했다 — 이름이 바뀌었으면 시험도 함께 고쳐라`);
  const rest = source.slice(start + declaration.length);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

const SERVER = src("src/lib/approval/part-issue.ts");
const ACTIONS = src("src/app/actions/part-issue.ts");
const SCREEN = src("src/components/stock/IssueApprovalScreen.tsx");
const REJECT_BODY = bodyOf(SERVER, "export async function rejectExecutionPartIssueApproval");
const ACTION_BODY = bodyOf(ACTIONS, "export async function rejectExecutionPartIssueAction");

/* ------------------------------------------------------------------ */

describe("① 🔴 `APPROVED` 일 때만 된다 (전수)", () => {
  it("나머지 다섯 상태는 전부 거절한다", () => {
    for (const status of PART_ISSUE_STATUSES) {
      assert.equal(checkCanRejectExecutionPartIssue(status).ok, status === "APPROVED", status);
    }
  });

  /**
   * 🔴 「실행할 수 있는 건」과 「실행 대기에서 멈출 수 있는 건」은 **같은 건이어야 한다.**
   * 한쪽만 넓으면 목록에 떠 있는데 멈출 수 없는 건이나, 멈출 수는 있는데 실행은 못 하는 건이 생긴다.
   */
  it("🔴 실행과 **같은 자리**다 — 어느 상태에서든 둘의 답이 같다", () => {
    for (const status of PART_ISSUE_STATUSES) {
      assert.equal(checkCanRejectExecutionPartIssue(status).ok, checkCanExecutePartIssue(status).ok, status);
    }
  });

  it("🔴 서버 함수가 **그 판정을 실제로 부른다** — 상태를 손으로 다시 적지 않는다", () => {
    assert.ok(REJECT_BODY.includes("checkCanRejectExecutionPartIssue(head.status)"), "판정을 안 부른다 — 어느 상태에서나 막을 수 있게 된다");
  });

  /**
   * 🔴 읽은 뒤 쓰기 전 사이에 다른 관리자가 [실행]을 눌렀을 수 있다. 그때 **조건부 UPDATE 가
   * 0행**이 되어야 한다 — 안 그러면 이미 나간 건이 반려로 덮인다.
   */
  it("🔴 **상태를 WHERE 에 걸어 집는다** — 두 사람이 동시에 눌러도 한 번만 된다", () => {
    assert.ok(REJECT_BODY.includes('eq(stockIssueApprovals.status, "APPROVED")'), "조건부 UPDATE 가 아니다 — 읽은 뒤 바뀐 상태를 덮어쓴다");
    assert.ok(REJECT_BODY.includes("방금 다른 담당자가"), "0행일 때 사람에게 말하지 않는다");
    assert.ok(REJECT_BODY.includes('.for("update")'), "결재건 행을 잠그지 않는다 — 실행과 반려가 엇갈릴 수 있다");
  });
});

/* ------------------------------------------------------------------ */

describe("② 🔴 사유가 없으면 막힌다 — 화면·서버 둘 다", () => {
  it("🔴 **결재 중 반려와 같은 함수**를 쓴다 — 두 벌이면 한쪽만 느슨해지는 날이 온다", () => {
    assert.ok(REJECT_BODY.includes("checkRejectReason(reason)"), "사유 검사를 새로 적었다");
    assert.equal(checkRejectReason("").ok, false);
    assert.equal(checkRejectReason("   ").ok, false, "공백만 적은 것은 적지 않은 것이다");
    assert.equal(checkRejectReason("재고 부족").ok, true);
  });

  it("🔴 서버 액션도 두 글자 미만을 거절한다 — 이 저장소의 반려·마감·보류와 같은 잣대다", () => {
    assert.ok(ACTION_BODY.includes("note.length < 2"), "서버 액션이 빈 사유를 그냥 흘려보낸다");
    assert.ok(ACTION_BODY.includes('cleanNote(formData.get("note"))'), "사유를 읽지 않는다 — 시험이 낡았다");
  });

  it("🔴 화면도 **먼저** 막는다 — `required` 와 `minLength`", () => {
    const field = /<textarea name="note"[^>]*재고가 모자라[^>]*\/>/.exec(SCREEN);
    assert.ok(field !== null, "실행 대기 반려의 사유 칸을 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(/\brequired\b/.test(field[0]), "화면이 빈 사유를 막지 않는다");
    assert.ok(/minLength=\{2\}/.test(field[0]), "화면의 두 글자 울타리가 없다");
    assert.ok(SCREEN.includes("반려 사유 *"), "필수라는 표시(별표)가 없다 — 사람은 선택인 줄 안다");
  });

  /**
   * 🔴 표의 CHECK(`stock_issue_approvals_execution_rejection_metadata`)가 **최종 방어선**이다.
   * 앞단 둘이 다 뚫려도 빈 사유는 DB 가 거절한다 — 적용된 제약과 어긋나면 사람에게는 그냥 실패로 보인다.
   */
  it("🔴 표의 CHECK 가 마지막으로 거른다 — 사유가 빈 글자면 안 된다", () => {
    const schema = src("src/db/schema/stock-issue-approvals.ts");
    assert.ok(schema.includes("execution_rejected_reason <> ''"), "빈 사유를 막는 제약이 사라졌다");
    assert.ok(schema.includes("stock_issue_approvals_execution_rejection_metadata"), "제약 이름이 바뀌었다 — 시험도 함께 고쳐라");
  });
});

/* ------------------------------------------------------------------ */

describe("③ 🔴 관리자가 아니면 막힌다 — [실행]과 같은 울타리", () => {
  it("서버 액션의 문이 `requireRole(\"ADMIN\", …)` 이다", () => {
    assert.ok(ACTION_BODY.includes('requireRole("ADMIN", APPROVALS)'), "관리자 울타리가 없다 — 누구나 결재를 멈출 수 있게 된다");
    assert.ok(!ACTION_BODY.includes("requireSession("), "세션만 보고 통과시킨다");
  });

  /**
   * 🔴 **[실행]과 문턱이 같아야 한다.** 한쪽만 열어 두면 「내보낼 수는 있는데 멈출 수는 없는」
   * (또는 그 반대의) 사람이 생긴다 — 쓰는 분이 정한 것도 관리자 하나다.
   */
  it("🔴 [실행]과 **같은 문**이다 — 글자까지 같다", () => {
    const execute = bodyOf(ACTIONS, "export async function executePartIssueAction");
    const door = /const session = await (requireRole\("ADMIN", APPROVALS\)|requireSession\(APPROVALS\));/;
    assert.equal(door.exec(ACTION_BODY)?.[1], door.exec(execute)?.[1], "실행과 반려의 문턱이 갈렸다");
  });
});

/* ------------------------------------------------------------------ */

describe("④ 🔴 한 트랜잭션에서 결재건과 신청이 **함께** 닫힌다", () => {
  /**
   * 🔴 앞만 되고 뒤가 실패하면 결재건은 닫혔는데 신청이 `IN_APPROVAL` 에 남는다 — 그 자리는
   * 확인·반려·마감·보류·취소를 **전부 거절**하고 결재건이 닫혀서 [실행]조차 없다. 완전한 교착이다.
   */
  /** 🔵 drizzle 의 사슬은 줄이 바뀌므로(`tx\n  .update(…)`) **사이의 공백을 허용해** 잰다. */
  const txUpdate = (table: string) => new RegExp(`tx\\s*\\.update\\(${table}\\)`);

  it("둘 다 `tx` 로 쓴다 — 트랜잭션 밖에서 쓰는 길이 없다", () => {
    assert.ok(REJECT_BODY.includes("db().transaction("), "트랜잭션을 열지 않는다");
    assert.ok(txUpdate("stockIssueApprovals").test(REJECT_BODY), "결재건을 트랜잭션 안에서 닫지 않는다");
    assert.ok(txUpdate("stockRequests").test(REJECT_BODY), "반출 신청을 트랜잭션 안에서 닫지 않는다");
    assert.ok(/tx\s*\.insert\(auditLogs\)/.test(REJECT_BODY), "감사 로그가 같은 묶음에 들어 있지 않다");
    assert.ok(!/db\(\)\s*\.(update|insert)\(/.test(REJECT_BODY), "트랜잭션 밖에서 쓰는 자리가 생겼다 — 앞만 되고 뒤가 실패할 수 있다");
  });

  it("🔴 **거절은 아무것도 쓰기 전에** 한다 — 트랜잭션 콜백의 `return` 은 커밋된다", () => {
    const firstWrite = /tx\s*\.update\(/.exec(REJECT_BODY)?.index;
    assert.notEqual(firstWrite, undefined, "쓰는 자리를 찾지 못했다 — 시험이 낡았다");
    for (const guard of ["checkCanRejectExecutionPartIssue(head.status)", "없는 결재건입니다."]) {
      const at = REJECT_BODY.indexOf(guard);
      assert.notEqual(at, -1, guard);
      assert.ok(at < firstWrite!, `거절하는 자리가 쓰기보다 뒤에 있다: ${guard}`);
    }
  });

  /**
   * 🔴 신청이 가야 할 자리를 **손으로 적지 않는다.** 그 규칙이 적힌 곳은 순수 함수 하나이고
   * (`requestStatusAfterPartIssue`), 이 저장소에는 DB 시험이 없어 여기 직접 적은 글자는
   * 아무도 돌려 보지 못한 채 운영으로 나간다.
   */
  it("🔴 신청의 자리는 **순수 함수**가 정한다 — 서버가 글자를 박지 않는다", () => {
    assert.ok(REJECT_BODY.includes('requestStatusAfterPartIssue("EXECUTION_REJECTED", 0)'), "신청 상태를 손으로 적었다");
    assert.equal(requestStatusAfterPartIssue("EXECUTION_REJECTED", 0), "REJECTED");
    // 🔴 **되돌리지 않는다**: 되살리면 막은 당사자의 대기 목록에 그 신청이 돌아오고, 그대로
    //    [확인]을 누르면 방금 막은 부품이 그냥 나간다. 이미 일부 나간 신청(3개)이어도 그렇다.
    assert.equal(requestStatusAfterPartIssue("EXECUTION_REJECTED", 3), "REJECTED");
  });
});

/* ------------------------------------------------------------------ */

describe("⑤ 🔴 사유가 신청의 `decision_note` 로 복사된다 — A/S 가 그것을 그린다", () => {
  /**
   * 🔴 신청자가 보는 화면도 A/S 통로도 **결재건이 아니라 신청**을 읽는다. 복사하지 않으면
   * 「왜 막혔는지」가 **어디에도 안 보인다** — 결재건 쪽 칸은 아무 화면도 읽지 않는다.
   */
  it("결정 사유·사람·시각을 함께 적는다", () => {
    assert.ok(REJECT_BODY.includes("decisionNote: reason"), "사유를 신청에 복사하지 않는다 — 신청자에게 「왜」가 안 보인다");
    assert.ok(REJECT_BODY.includes("decidedBy: admin.id"), "누가 막았는지를 신청에 적지 않는다");
    assert.ok(REJECT_BODY.includes("decidedAt: now"), "결정 시각이 없으면 신청자의 알림 종에 걸리지 않는다");
  });

  it("🔴 **결재 중 반려와 같은 모양**이다 — 그쪽이 적는 네 칸을 그대로 적는다", () => {
    const decide = bodyOf(SERVER, "export async function decidePartIssueApproval");
    for (const field of ["decidedBy:", "decidedByName:", "decidedAt:", "decisionNote:"]) {
      assert.ok(decide.includes(field), `시험이 낡았다 — 결재 중 반려가 ${field} 를 더는 안 적는다`);
      assert.ok(REJECT_BODY.includes(field), `실행 대기 반려가 ${field} 를 안 적는다`);
    }
  });

  it("🔴 통로가 그 칸을 그대로 내준다 — A/S 는 새로 만들 것이 없다", () => {
    const api = src("src/lib/api/stock-request-status.ts");
    assert.ok(api.includes("note: r.decisionNote"), "통로가 결정 사유를 안 싣는다 — A/S 화면이 빈 상자가 된다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑥ 🔴 반려하면 「실행할 건」 목록에서 사라진다", () => {
  /**
   * 🔴 그 목록은 **결재건의 상태만 보고 신청은 안 본다**(`listPartIssueApprovalsToExecute`).
   * 그래서 사라지게 하는 것은 상태 하나뿐이다 — `APPROVED` 가 아니게 되면 그 자리에서 빠진다.
   */
  it("목록이 `APPROVED` 하나로 좁힌다 — 새 상태는 거기 없다", () => {
    const body = bodyOf(SERVER, "export async function listPartIssueApprovalsToExecute");
    assert.ok(body.includes('eq(stockIssueApprovals.status, "APPROVED")'), "실행할 건 목록이 상태로 좁히지 않는다");
    assert.ok(REJECT_BODY.includes('status: "EXECUTION_REJECTED"'), "결재건을 새 상태로 닫지 않는다 — 목록에 그대로 남는다");
  });

  it("🔴 **살아 있는 결재건으로도 세지 않는다** — 그 신청의 [확인] 자리가 영영 잠기면 안 된다", () => {
    const rules = src("src/lib/approval/part-issue-rules.ts");
    assert.ok(rules.includes('export const OPEN_PART_ISSUE_STATUSES = ["PENDING_APPROVAL", "APPROVED"]'), "살아 있는 묶음이 바뀌었다 — 시험도 함께 고쳐라");
  });
});

/* ------------------------------------------------------------------ */

describe("⑦ 🔴 올린 사람에게 알림이 간다", () => {
  /**
   * 🔴 **안 넣으면 건이 목록에서 사라지기만 하고 아무도 모른다.** 오류가 아니라 **침묵**이라
   * 아무도 신고하지 않는다. 조립과 질의가 **같은 묶음**을 보는 울타리는 이미 걸려 있다.
   */
  it("종이 세는 묶음에 새 상태가 들어 있다", () => {
    assert.ok((DECIDED_ISSUE_APPROVAL_STATUSES as readonly string[]).includes("EXECUTION_REJECTED"), "종이 그 건을 아예 세지 않는다");
  });

  it("🔴 질의도 그 줄을 **실제로 가져온다** — 7일 선을 만날 길이 있다", () => {
    const body = bodyOf(SERVER, "export async function listDecidedPartIssueApprovalsFor");
    assert.ok(body.includes("gte(stockIssueApprovals.executionRejectedAt, rejectedSince)"), "실행 대기 반려가 7일 선을 못 만난다 — 그 줄이 종에 영영 안 뜬다");
    // 🔴 결정 시각이 **단계 줄이 아니라 결재건 쪽 칸**에서 온다 — 합치지 않으면 `null` 로 와서 조용히 사라진다.
    assert.ok(body.includes("r.decidedAt ?? r.executionRejectedAt"), "두 자리의 결정 시각을 한 칸으로 합치지 않는다");
    assert.ok(body.includes("r.decidedByName ?? r.executionRejectedByName"), "두 자리의 결정한 사람을 한 칸으로 합치지 않는다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑧ 🔴 이력이 사람 말로 남는다 — `/audit` 이 JSON 을 그대로 띄우지 않게", () => {
  it("새 행위 이름에 한글 이름표가 있다", () => {
    assert.ok(AUDIT_ACTIONS.includes("STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED"), "행위 이름이 글자표에 없다 — /audit 이 영문 코드를 그대로 띄운다");
    assert.equal(AUDIT_ACTION_LABEL.STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED, "불출 결재 실행 대기 반려");
  });

  /**
   * 🔴 결재 중 반려와 **다른 글자여야 한다.** 멈춘 자리가 다르고, 그 자리가 곧 **사유를 찾을
   * 곳**이다 — 앞은 단계 줄, 이쪽은 결재건 쪽 칸. 같은 말로 보이면 엉뚱한 표에서 찾게 된다.
   */
  it("🔴 결재 중 반려·거둠과 **다른 말**이다", () => {
    const label = AUDIT_ACTION_LABEL.STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED;
    assert.notEqual(label, AUDIT_ACTION_LABEL.STOCK_ISSUE_APPROVAL_REJECTED);
    assert.notEqual(label, AUDIT_ACTION_LABEL.STOCK_ISSUE_APPROVAL_CANCELLED);
    assert.ok(label.includes("실행 대기"), label);
  });

  it("🔴 **사유를 이력에도 남긴다** — 결재건 칸은 고쳐질 수 있지만 감사 로그는 append-only 다", () => {
    assert.ok(REJECT_BODY.includes('action: "STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED"'), "새 행위 이름으로 남기지 않는다");
    assert.ok(/detail: \{[^}]*reason[^}]*\}/.test(REJECT_BODY), "사유가 이력에 안 남는다");
  });
});

/* ------------------------------------------------------------------ */

/**
 * ⑨ 🔴 **기존 길을 넓혀 이 일을 하지 않았다.**
 *
 * 넓히면 **결재 중인 신청까지 함께 열려** 2026-10-21 결정을 다시 깬다 — 결재자에게 뜬 건이
 * 소리 없이 사라지면 안 된다. 그래서 이 조각은 **결재건을 보는 새 길**을 옆에 냈고, 아래 넷은
 * 한 글자도 바뀌지 않았다.
 */
describe("⑨ 🔴 기존 반려·보류·취소의 조건이 한 글자도 안 바뀌었다", () => {
  const REQUESTS = src("src/lib/stock/requests.ts");
  const CODES = src("src/lib/stock/codes.ts");

  it("[반려]는 아직 아무것도 안 나간 신청만 받는다 (`PENDING` 하나)", () => {
    assert.ok(CODES.includes('export const REJECTABLE_REQUEST_STATUSES = ["PENDING"]'), "반려가 받는 묶음이 넓어졌다 — 결재 중인 신청까지 열린다");
    const body = bodyOf(REQUESTS, "export async function rejectRequest");
    assert.ok(body.includes("inArray(stockRequests.status, [...REJECTABLE_REQUEST_STATUSES])"), "반려의 WHERE 가 그 묶음을 안 쓴다");
  });

  it("[보류]는 집을 수 있는 묶음 그대로다 (`PENDING`·`PARTIAL`)", () => {
    assert.ok(CODES.includes('export const CLAIMABLE_REQUEST_STATUSES = ["PENDING", "PARTIAL"]'), "집을 수 있는 묶음이 넓어졌다 — 결재 중인 신청에 보류가 걸린다");
    const body = bodyOf(REQUESTS, "export async function holdRequest");
    assert.ok(body.includes("inArray(stockRequests.status, [...CLAIMABLE_REQUEST_STATUSES])"), "보류의 WHERE 가 그 묶음을 안 쓴다");
  });

  it("[신청 취소]는 본인의 `PENDING` 신청만", () => {
    const body = bodyOf(REQUESTS, "export async function cancelRequest");
    assert.ok(body.includes('eq(stockRequests.status, "PENDING")'), "거두기의 상태 조건이 넓어졌다");
    assert.ok(body.includes("eq(stockRequests.requestedBy, actor.id)"), "거두기의 「본인」 조건이 사라졌다");
  });

  it("🔴 **새 길은 신청이 아니라 결재건을 본다** — 그래서 저 셋을 건드릴 까닭이 없었다", () => {
    assert.ok(REJECT_BODY.includes("stockIssueApprovals"), "새 길이 결재건을 안 본다");
    for (const widened of ["REJECTABLE_REQUEST_STATUSES", "CLAIMABLE_REQUEST_STATUSES"]) {
      assert.ok(!REJECT_BODY.includes(widened), `새 길이 신청 쪽 묶음을 끌어다 쓴다: ${widened}`);
    }
  });

  /**
   * 🔴 **보류를 만들지 않았다** — 쓰는 분이 정한 것은 **반려 하나**다 (2026-10-21).
   * 🔵 「보류」라는 **낱말**로 재지 않는다: 위 주석들이 「확인·반려·마감·보류·취소를 전부
   *    거절한다」처럼 **설명으로** 그 말을 쓴다. 재는 것은 **실제로 보류를 거는 코드**다.
   */
  it("🔴 보류를 만들지 않았다 — 쓰는 분이 정한 것은 반려 하나다 (2026-10-21)", () => {
    for (const hold of ['"ON_HOLD"', "holdReason", "holdRequest(", "releaseHold("]) {
      assert.ok(!REJECT_BODY.includes(hold), `실행 대기에 보류가 섞여 들어왔다: ${hold}`);
    }
    assert.ok(!/kind: "[A-Z_]*HOLD[A-Z_]*"/.test(SCREEN), "화면에 실행 대기 보류 단추가 생겼다");
  });
});
