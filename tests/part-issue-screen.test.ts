import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  excludeApprovalsInExecuteList,
  formatPartIssueMoment,
  partIssueNotice,
  partIssueProgressEmptyText,
  partIssueProgressText,
  partIssueStatusBadge,
  partIssueTrailMark,
  pickPartIssueTrailSource,
  PART_ISSUE_EXECUTION_STANDING_NOTICE,
  PART_ISSUE_NOTHING_AWAITING_APPROVAL,
  PART_ISSUE_NOTHING_IN_PROGRESS,
  PART_ISSUE_NOTHING_TO_DECIDE,
  PART_ISSUE_NOTHING_TO_EXECUTE,
  PART_ISSUE_STATUS_BADGE,
  PART_ISSUE_TRAIL_MARKS,
  type IssueApprovalCard,
} from "../src/lib/approval/part-issue-screen";
import { partIssueLockFor } from "../src/lib/approval/part-issue-gate";
import { PART_ISSUE_STATUS_LABELS, PART_ISSUE_STATUSES, type PartIssueStatus } from "../src/lib/approval/part-issue-rules";

/**
 * ============================================================================
 * 「승인 요청건」 화면의 순수 규칙 (2026-10-15, 조각 11b)
 * ============================================================================
 * 🔴 이 저장소에는 **화면 렌더 시험이 없다.** 그래서 화면이 혼자 쥐고 있으면 아무도 돌려 보지
 * 못하는 것들을 순수 함수로 내려 두고 여기서 전수로 돌려 본다.
 *
 * 여기서 못 박는 것:
 *  1. **건너뛴 단계가 「완료」로 보이지 않는다** — 아무도 승인하지 않은 자리가 승인된 것처럼
 *     보이면, 결재선을 믿고 부품을 내주는 사람이 속는다. 다만 **지금 열려 있는 자리**는
 *     건너뜀으로 칠하지 않는다(실제로 열린 차례를 부정하게 된다).
 *  2. **상자 색과 글자가 언제나 짝이다** — 색만으로 상태를 가르지 않는다(CLAUDE.md 9-7절).
 *  3. **(다)에서 (나)에 뜬 건을 뺀다** — 같은 건이 한 화면에 두 번 나오지 않게.
 *  4. **0건일 때 무슨 말을 하는가** — 묶음을 감추지 않고 말하는 것이 이 화면의 규약이고,
 *     그 말은 **(나)가 보이는 세션인지에 따라 갈린다**(안 그러면 「실행을 기다리는 신청이
 *     없다」가 거짓말이 된다).
 *  5. **시각은 서울 시간으로 박는다** — 운영 서버(NAS)는 UTC 라 안 박으면 날짜가 밀린다.
 *  6. **[승인]은 단추 하나로 끝나고, [반려] 사유는 그대로 필수다**(2026-10-15 결정). 이 둘은
 *     순수 함수가 아니라 **화면과 서버 액션의 모양**이라 소스 글자로 잰다 — 약한 울타리인 것은
 *     맞지만, 승인 의견 칸이 슬그머니 돌아오거나 반려 사유 울타리가 함께 풀리는 날
 *     (그러면 표의 CHECK 에 걸려 **사람에게는 그냥 실패로 보인다**) 이 자리에서 깨진다.
 * ============================================================================
 */

const { DONE, UPCOMING, SKIPPED, CURRENT, REJECTED, CANCELLED } = PART_ISSUE_TRAIL_MARKS;

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

describe("partIssueTrailMark — 상자 색과 글자는 한 자리에서 함께 (전수)", () => {
  it("앞 단계는 어떤 상태에서도 완료, 뒷 단계는 대기", () => {
    for (const status of PART_ISSUE_STATUSES) {
      assert.deepEqual(partIssueTrailMark({ stepOrder: 1, currentStepOrder: 2, status, skipped: false }), DONE, status);
      assert.deepEqual(partIssueTrailMark({ stepOrder: 3, currentStepOrder: 2, status, skipped: false }), UPCOMING, status);
    }
  });

  it("사슬이 서 있는 자리는 결재건의 상태가 말한다", () => {
    const at = (status: PartIssueStatus) => partIssueTrailMark({ stepOrder: 2, currentStepOrder: 2, status, skipped: false });
    assert.deepEqual(at("PENDING_APPROVAL"), CURRENT);
    assert.deepEqual(at("APPROVED"), DONE);
    assert.deepEqual(at("EXECUTED"), DONE);
    assert.deepEqual(at("REJECTED"), REJECTED);
    assert.deepEqual(at("CANCELLED"), CANCELLED);
  });

  it("🔴 건너뛴 자리는 「완료」가 아니라 「건너뜀」이다 — 앞이든 뒤든, 어떤 상태에서든", () => {
    for (const status of PART_ISSUE_STATUSES) {
      assert.deepEqual(partIssueTrailMark({ stepOrder: 1, currentStepOrder: 2, status, skipped: true }), SKIPPED, status);
      assert.deepEqual(partIssueTrailMark({ stepOrder: 3, currentStepOrder: 2, status, skipped: true }), SKIPPED, status);
    }
  });

  it("🔴 지금 열려 있는 자리는 건너뜀으로 칠하지 않는다 (열린 차례를 부정하게 된다)", () => {
    assert.deepEqual(partIssueTrailMark({ stepOrder: 2, currentStepOrder: 2, status: "PENDING_APPROVAL", skipped: true }), CURRENT);
  });

  it("열린 단계가 없을 때 — 결재가 끝난 건은 전부 완료, 그 밖에는 지어내지 않고 대기", () => {
    const none = (status: PartIssueStatus) => partIssueTrailMark({ stepOrder: 1, currentStepOrder: null, status, skipped: false });
    assert.deepEqual(none("APPROVED"), DONE);
    assert.deepEqual(none("EXECUTED"), DONE);
    assert.deepEqual(none("PENDING_APPROVAL"), UPCOMING);
    assert.deepEqual(none("REJECTED"), UPCOMING);
    assert.deepEqual(none("CANCELLED"), UPCOMING);
    // 열린 단계가 없어도 건너뛴 자리는 그렇게 보인다.
    assert.deepEqual(partIssueTrailMark({ stepOrder: 1, currentStepOrder: null, status: "APPROVED", skipped: true }), SKIPPED);
  });

  /**
   * 🔴 **실행 대기 반려는 「대기」가 아니다** (2026-10-21). 그 건은 **단계가 전부 승인으로 닫힌**
   * 뒤에 막힌 것이다(그 상태는 `APPROVED` 에서만 올 수 있다) — 「대기」로 그리면 아직 결재가
   * 돌고 있는 것처럼 보이고, 실제로 승인한 사람들의 자리가 **없던 일**이 된다.
   */
  it("🔴 실행 대기 반려는 **승인과 같은 「완료」**다 — 단계는 전부 승인된 건이다", () => {
    const none = (status: PartIssueStatus) => partIssueTrailMark({ stepOrder: 1, currentStepOrder: null, status, skipped: false });
    assert.deepEqual(none("EXECUTION_REJECTED"), DONE);
    assert.deepEqual(none("EXECUTION_REJECTED"), none("APPROVED"));
    assert.notDeepEqual(none("EXECUTION_REJECTED"), UPCOMING);
  });

  /**
   * 🔴 **어느 상자도 빨갛게 칠하지 않는다.** 「반려」·「거둠」은 사슬이 **서 있던 그 자리**에서
   * 일어났지만, 이것은 사슬이 **끝난 뒤**에 일어났다 — 막은 사람은 결재자가 아니라 담당자이고
   * 그 사람의 상자는 결재선에 아예 없다. 아무 상자나 칠하면 「그 결재자가 막았다」는 거짓이 된다.
   */
  it("🔴 실행 대기 반려로 **빨개지는 상자가 하나도 없다** — 막은 사람은 결재선에 없다", () => {
    for (const stepOrder of [1, 2, 3]) {
      for (const currentStepOrder of [null, 2]) {
        const mark = partIssueTrailMark({ stepOrder, currentStepOrder, status: "EXECUTION_REJECTED", skipped: false });
        assert.notDeepEqual(mark, REJECTED, `${stepOrder}/${currentStepOrder}`);
        assert.notDeepEqual(mark, CANCELLED, `${stepOrder}/${currentStepOrder}`);
      }
    }
  });

  it("🔴 여섯 가지 모두 색과 글자를 둘 다 들고 있다 — 색만으로 구분되는 상자가 없다", () => {
    const marks = Object.values(PART_ISSUE_TRAIL_MARKS);
    assert.equal(marks.length, 6);
    for (const mark of marks) {
      assert.ok(mark.boxClass.length > 0, "상자 색이 비었다");
      assert.ok(mark.stateLabel.length > 0, "상태 글자가 비었다");
    }
    // 글자가 겹치면 두 상태가 같은 말로 보인다.
    assert.equal(new Set(marks.map((m) => m.stateLabel)).size, marks.length);
    // 🔴 반려와 거둠은 **다른 색**이다 — 일어난 일이 다르다.
    assert.notEqual(REJECTED.boxClass, CANCELLED.boxClass);
  });
});

describe("partIssueStatusBadge — 상태 글자와 색은 짝 (전수)", () => {
  it("다섯 상태를 빠짐없이 덮는다", () => {
    assert.deepEqual(Object.keys(PART_ISSUE_STATUS_BADGE), [...PART_ISSUE_STATUSES]);
  });

  it("글자는 상태 이름표 한 벌에서 온다", () => {
    for (const status of PART_ISSUE_STATUSES) {
      const badge = partIssueStatusBadge(status);
      assert.equal(badge.label, PART_ISSUE_STATUS_LABELS[status]);
      assert.equal(badge.className, PART_ISSUE_STATUS_BADGE[status]);
      assert.ok(badge.label.length > 0 && badge.className.length > 0);
    }
  });
});

describe("partIssueProgressText — 「n/m단계 · 지금 차례: ○○○」", () => {
  it("열린 단계가 있으면 몇 단계인지와 지금 차례를 적는다", () => {
    assert.equal(
      partIssueProgressText({ currentStepOrder: 2, currentApproverName: "홍길동", totalSteps: 3, status: "PENDING_APPROVAL" }),
      "결재선 2/3단계 · 지금 차례: 홍길동",
    );
  });

  it("이름을 모르면 차례만 적는다 — 「지금 차례: 」 뒤가 빈 줄을 만들지 않는다", () => {
    assert.equal(partIssueProgressText({ currentStepOrder: 2, currentApproverName: null, totalSteps: 3, status: "PENDING_APPROVAL" }), "결재선 2/3단계");
  });

  it("🔴 끝난 건은 남의 차례를 말하지 않는다", () => {
    assert.equal(partIssueProgressText({ currentStepOrder: null, currentApproverName: null, totalSteps: 3, status: "APPROVED" }), "결재선 3단계 · 결재 끝");
    assert.equal(partIssueProgressText({ currentStepOrder: null, currentApproverName: null, totalSteps: 3, status: "CANCELLED" }), "결재선 3단계");
  });

  it("🔴 단계를 못 세었으면 「2/」 같은 반쪽짜리를 보여 주지 않는다", () => {
    assert.equal(partIssueProgressText({ currentStepOrder: 2, currentApproverName: "홍길동", totalSteps: 0, status: "PENDING_APPROVAL" }), null);
  });

  /**
   * 🔴 상자들이 전부 「완료」로 그려지므로(위 시험), 이 한 줄까지 「결재 끝」이면 **곧 나갈 건으로
   * 읽힌다** — 실제로는 담당자가 막아 끝난 건이다. 🔵 뒤에 붙는 글자는 **상태 이름표 한 벌**에서
   * 온다: 여기 손으로 적으면 이름표를 다듬는 날 한쪽만 바뀐다.
   */
  it("🔴 실행 대기 반려는 「결재 끝」에서 멈추지 않는다 — 그 뒤에 막혔다고 말한다 (2026-10-21)", () => {
    const text = partIssueProgressText({ currentStepOrder: null, currentApproverName: null, totalSteps: 3, status: "EXECUTION_REJECTED" });
    assert.equal(text, `결재선 3단계 · 결재 끝 · ${PART_ISSUE_STATUS_LABELS.EXECUTION_REJECTED}`);
    assert.notEqual(text, partIssueProgressText({ currentStepOrder: null, currentApproverName: null, totalSteps: 3, status: "APPROVED" }));
    // 🔴 「누가 막았는지」는 여기서 말하지 않는다 — 그림은 결재선이 어떻게 흘렀나만 말하는 자리다.
    assert.ok(!text.includes("차례"));
  });
});

describe("excludeApprovalsInExecuteList — 같은 건이 한 화면에 두 번 나오지 않게", () => {
  const progress = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("「실행할 건」에 뜬 것만 빠지고 차례는 그대로다", () => {
    assert.deepEqual(excludeApprovalsInExecuteList(progress, [{ id: "b" }]), [{ id: "a" }, { id: "c" }]);
  });

  it("겹치는 것이 없으면 그대로, 전부 겹치면 빈 목록", () => {
    assert.deepEqual(excludeApprovalsInExecuteList(progress, [{ id: "z" }]), progress);
    assert.deepEqual(excludeApprovalsInExecuteList(progress, progress), []);
    assert.deepEqual(excludeApprovalsInExecuteList(progress, []), progress);
  });

  it("🔵 입력 배열을 건드리지 않는다", () => {
    const before = [...progress];
    excludeApprovalsInExecuteList(progress, [{ id: "a" }]);
    assert.deepEqual(progress, before);
  });
});

describe("0건일 때 하는 말 — 묶음을 감추지 않는다 (문구 전수)", () => {
  it("🔴 「진행 중인 내 신청」의 빈 문구는 (나)가 보이는 세션인지에 따라 갈린다", () => {
    assert.equal(partIssueProgressEmptyText(true), PART_ISSUE_NOTHING_AWAITING_APPROVAL);
    assert.equal(partIssueProgressEmptyText(false), PART_ISSUE_NOTHING_IN_PROGRESS);
    // 뺀 세션에서 「실행을 기다리는 신청이 없다」고 말하면 거짓말이 된다(위에 있을 수 있다).
    assert.ok(!PART_ISSUE_NOTHING_AWAITING_APPROVAL.includes("실행"));
    assert.ok(PART_ISSUE_NOTHING_IN_PROGRESS.includes("실행"));
  });

  it("네 문구가 서로 다르고 하십시오체다 (CLAUDE.md 10절)", () => {
    const texts = [PART_ISSUE_NOTHING_TO_DECIDE, PART_ISSUE_NOTHING_TO_EXECUTE, PART_ISSUE_NOTHING_IN_PROGRESS, PART_ISSUE_NOTHING_AWAITING_APPROVAL];
    assert.equal(new Set(texts).size, texts.length);
    for (const text of texts) assert.ok(text.endsWith("습니다."), text);
  });

  it("🔴 실행이 막혀도 결재건이 남는다는 사실을 미리 말해 둔다", () => {
    assert.ok(PART_ISSUE_EXECUTION_STANDING_NOTICE.includes("그대로 남습니다"));
  });
});

describe("partIssueNotice — 단추를 누르고 돌아왔을 때의 한 줄", () => {
  it("꼬리표가 없으면 아무 말도 하지 않는다", () => {
    assert.equal(partIssueNotice({}), null);
    assert.equal(partIssueNotice({ approved: "0" }), null);
  });

  it("승인·반려·거두기", () => {
    assert.equal(partIssueNotice({ approved: "1" })?.tone, "info");
    assert.ok(partIssueNotice({ approved: "1" })?.text.startsWith("승인했습니다"));
    assert.ok(partIssueNotice({ rejected: "1" })?.text.includes("닫혔습니다"));
    assert.ok(partIssueNotice({ cancelled: "1" })?.text.includes("거뒀습니다"));
  });

  /**
   * 🔴 **결재 중 반려와 다른 말을 한다** (2026-10-21). 저쪽은 결재건만 닫히지만 이쪽은 **반출
   * 신청까지 함께 닫힌다** — 「다시 올리면 처음 단계부터」로 뭉개면 담당자가 그 신청을 다시 집을
   * 수 있다고 읽는다. 실제로는 **신청자가 새로 신청해야** 한다.
   */
  it("🔴 실행 대기 반려는 **신청까지 닫혔다**고 말한다 — 결재 중 반려와 다른 말이다", () => {
    const notice = partIssueNotice({ executionRejected: "1" });
    assert.equal(notice?.tone, "info");
    assert.ok(notice?.text.includes("신청도 함께 닫혔"), notice?.text);
    assert.ok(notice?.text.includes("새로 신청"), notice?.text);
    // 🔵 사유가 어디로 갔는지도 말한다 — 모르면 같은 말을 따로 전하러 간다.
    assert.ok(notice?.text.includes("사유"), notice?.text);
    assert.notEqual(notice?.text, partIssueNotice({ rejected: "1" })?.text);
  });

  it("🔴 실행은 이번에 나간 수량을 말하고, 남은 것이 있으면 신청이 살아 있다고 말한다", () => {
    const done = partIssueNotice({ executed: "1", issued: "3", remaining: "0" });
    assert.equal(done?.tone, "info");
    assert.ok(done?.text.includes("3개"));

    const left = partIssueNotice({ executed: "1", issued: "3", remaining: "2" });
    assert.equal(left?.tone, "warn");
    assert.ok(left?.text.includes("2개가 남아"));
  });

  it("주소를 손으로 고쳐도 깨지지 않는다 — 숫자가 아니면 0", () => {
    const notice = partIssueNotice({ executed: "1", issued: "abc", remaining: ["2"] });
    assert.ok(notice?.text.includes("0개"));
    assert.equal(notice?.tone, "info");
  });
});

describe("formatPartIssueMoment — 시간대를 박는다", () => {
  it("UTC 로 받은 값을 서울 시간으로 적는다", () => {
    assert.equal(formatPartIssueMoment("2026-10-15T04:40:00.000Z"), "2026-10-15 13:40");
  });

  it("🔴 날짜가 밀리는 자리 — 자정 직전의 UTC 는 다음 날 서울이다", () => {
    assert.equal(formatPartIssueMoment("2026-10-15T15:00:00.000Z"), "2026-10-16 00:00");
  });

  it("읽을 수 없는 값은 받은 글자 그대로 (화면이 깨지지 않게)", () => {
    assert.equal(formatPartIssueMoment("언젠가"), "언젠가");
  });
});

/* ------------------------------------------------------------------ */

describe("🔵 [승인]은 단추 하나로 끝난다 — 의견 칸과 그 길을 걷어냈다 (2026-10-15 쓰는 분 결정)", () => {
  it("🔴 화면에 승인 의견 칸이 없다 — 글자도, 그 칸을 여는 상태도", () => {
    const screen = src("src/components/stock/IssueApprovalScreen.tsx");
    assert.ok(!screen.includes("승인 의견"), "승인 의견 칸이 돌아왔다");
    assert.ok(!screen.includes("승인 확정"), "승인이 다시 펼침 상자를 거친다 — 단추 하나로 끝나지 않는다");
    /**
     * 🔴 펼침 상자가 열리는 길에 **승인이 없다** — 그것이 이 줄이 지키는 것이다.
     * 🔵 2026-10-21 에 셋째(`REJECT_EXECUTION` — 실행 대기에서 반려)가 **일부러** 생겼다.
     *    그래서 「둘뿐」을 「승인이 없다」로 고쳐 잰다: 갈래 이름을 전수로 훑어 승인 쪽 칸이
     *    돌아왔는지만 본다. 글자를 통째로 맞춰 두면 갈래가 늘 때마다 이 시험이 깨지는데,
     *    정작 지켜야 할 것(승인에는 칸이 없다)은 그때 아무도 다시 보지 않는다.
     */
    const draftKinds = /type Draft = (.+);/.exec(screen);
    assert.ok(draftKinds !== null, "펼침 상태의 갈래를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(!draftKinds[1].includes("APPROVE"), "펼침 상태가 승인 쪽 칸을 다시 들고 있다");
    assert.deepEqual(draftKinds[1].match(/kind: "([A-Z_]+)"/g), ['kind: "REJECT"', 'kind: "REJECT_EXECUTION"', 'kind: "EXECUTE"']);
    assert.ok(!/decision:\s*"APPROVED"\s*\|\s*"REJECTED"/.test(screen), "쓰지 않는 `decision` 칸이 펼침 상태에 남아 있다");
  });

  it("🔴 서버 액션도 승인일 때는 한마디를 **읽지 않는다** — 칸만 지우면 손으로 보낸 값이 그대로 적힌다", () => {
    const actions = src("src/app/actions/part-issue.ts");
    assert.ok(actions.includes('const note = decision === "REJECTED" ? cleanNote(formData.get("note")) : "";'), "승인일 때도 한마디를 읽는 길이 남아 있다");
  });

  it("🔵 [실행]의 「이번 회차에 남길 말」은 **그대로 선택으로 남는다** — 걷어낸 것은 승인 의견 하나다", () => {
    const screen = src("src/components/stock/IssueApprovalScreen.tsx");
    assert.ok(screen.includes("이번 회차에 남길 말 (선택)"), "실행의 한마디까지 함께 걷어냈다 — 불출 회차에 적히는 쓸모 있는 말이다");
  });
});

describe("🔴 [반려] 사유는 **여전히 필수**다 — 승인 쪽을 푼 것이 이 울타리를 건드리지 않았다", () => {
  it("화면이 빈 사유를 막는다 — 별표 · `required` · `minLength`", () => {
    const screen = src("src/components/stock/IssueApprovalScreen.tsx");
    assert.ok(screen.includes("반려 사유 *"), "반려 사유의 별표가 사라졌다");
    assert.ok(screen.includes('<textarea name="note" rows={2} required minLength={2} maxLength={500}'), "반려 사유 칸의 울타리가 풀렸다");
  });

  it("🔴 서버 액션도 두 글자 미만을 거절한다 — 화면을 고쳐 불러도 통과하지 않는다", () => {
    const actions = src("src/app/actions/part-issue.ts");
    assert.ok(actions.includes('if (decision === "REJECTED" && note.length < 2) return { error: "반려 사유를 적으십시오." };'), "서버 쪽 반려 사유 울타리가 사라졌다");
  });

  it("🔴 그 아래 서버 함수와 **표의 CHECK** 가 마지막으로 거른다 — 적용된 제약과 어긋나면 사람에게는 그냥 실패로 보인다", () => {
    const server = src("src/lib/approval/part-issue.ts");
    assert.ok(server.includes("checkRejectReason(note)"), "서버 함수가 빈 사유를 다시 거르지 않는다");

    const schema = src("src/db/schema/stock-issue-approvals.ts");
    // 🔵 적용된 제약(`stock_issue_approval_steps_decision_metadata`)과 **같은 글자**다 —
    //    반려만 사유를 요구하고, 승인은 결정 시각만 본다(그래서 빈 한마디가 들어간다).
    assert.ok(schema.includes("(status = 'REJECTED' AND decided_at IS NOT NULL AND note <> '')"), "표의 CHECK 가 빈 반려 사유를 허락하게 바뀌었다");
    assert.ok(schema.includes("(status = 'APPROVED' AND decided_at IS NOT NULL)"), "승인이 한마디를 요구하게 바뀌었다 — 그러면 단추 하나로 끝낼 수 없다");
  });
});

/**
 * 부품 요청 관리 줄에 세우는 **진행 그림의 출처 고르기** (2026-10-21, 조각 11f).
 *
 * 🔴 한 줄 안에서 [상태] 칸의 글자와 그림이 **같은 결재건**을 말해야 한다. 글자를 고르는 것은 잠금
 *    (`partIssueLockFor`)이므로, 그림의 출처도 그 잠금에게 물어 고른다 — 차례를 손으로 베껴 적으면
 *    언젠가 한쪽만 고쳐지고, 그 어긋남은 오류가 아니라 **눈으로만 보이는 거짓말**이 된다.
 */
describe("진행 그림의 출처 고르기 (2026-10-21, 조각 11f)", () => {
  const view = (id: string, status: PartIssueStatus) => ({ id, status });

  it("결재건이 하나도 없으면 그릴 것이 없다", () => {
    assert.equal(pickPartIssueTrailSource([]), null);
  });

  it("결재 중인 건 하나 — 그 건을 그린다", () => {
    assert.deepEqual(pickPartIssueTrailSource([view("a", "PENDING_APPROVAL")]), view("a", "PENDING_APPROVAL"));
  });

  it("승인돼 실행을 기다리는 건 하나 — 그 건을 그린다", () => {
    assert.deepEqual(pickPartIssueTrailSource([view("b", "APPROVED")]), view("b", "APPROVED"));
  });

  it("🔴 **잠금과 같은 건을 고른다** — 섞여 있으면 결재 중이 이긴다(잠금의 차례 그대로)", () => {
    const mixed = [view("b", "APPROVED"), view("a", "PENDING_APPROVAL")];
    assert.equal(partIssueLockFor(mixed.map((v) => v.status)), "AWAITING_APPROVAL");
    assert.deepEqual(pickPartIssueTrailSource(mixed), view("a", "PENDING_APPROVAL"));
  });

  it("🔴 **잠금이 없으면 그림도 없다** — 끝난 건(불출 완료·반려·거둠)만 남은 신청에는 그릴 것이 없다", () => {
    for (const status of PART_ISSUE_STATUSES) {
      const only = [view("x", status)];
      const lock = partIssueLockFor([status]);
      assert.equal(pickPartIssueTrailSource(only) === null, lock === null, status);
    }
  });

  it("🔴 **잠금과 짝이 어긋나지 않는다** — 어떤 묶음이든 고른 건의 상태가 잠금이 말한 그 상태다", () => {
    const wanted: Record<"AWAITING_APPROVAL" | "AWAITING_EXECUTION", PartIssueStatus> = {
      AWAITING_APPROVAL: "PENDING_APPROVAL",
      AWAITING_EXECUTION: "APPROVED",
    };
    // 🔵 상태 다섯으로 만들 수 있는 두 건짜리 묶음을 **전수로** 돌려 본다(5 × 5).
    for (const a of PART_ISSUE_STATUSES) {
      for (const b of PART_ISSUE_STATUSES) {
        const views = [view("1", a), view("2", b)];
        const lock = partIssueLockFor([a, b]);
        const picked = pickPartIssueTrailSource(views);
        if (lock === null) assert.equal(picked, null, `${a}+${b}`);
        else assert.equal(picked?.status, wanted[lock], `${a}+${b}`);
      }
    }
  });
});

/**
 * ============================================================================
 * **요청 비고** — 신청한 사람이 적은 말이 결재 화면까지 온다 (2026-10-22)
 * ============================================================================
 * 값은 처음부터 신청에 저장돼 있었다(`stock_requests.payload` 의 `note`). [부품 요청]·[기록내역]은
 * 이미 그리고 있었는데 「승인 요청건」만 **긁어 오지 않아** 안 보였다.
 *
 * 🔴 여기서 못 박는 것 셋:
 *  1. **「신청 사유」와 섞이지 않았다.** `reason`(결재를 올린 재고 담당자가 결재자에게 쓴 글)과
 *     `requestNote`(신청한 사람이 적은 말)는 **다른 사람의 말**이다. 이름이 비슷해 섞어 심기 쉽고,
 *     섞이면 오류 없이 **화면만 거짓말**을 한다.
 *  2. **비면 줄 자체가 없다.** 거의 모든 신청이 비어 있어, 「요청 비고: -」가 붙으면 카드가 길어진다.
 *  3. 🔴 **묶음 셋이 같은 변환을 거친다**(결재할 것 · 실행할 것 · 내가 올린 것). 하나라도 빠지면
 *     **그 묶음에서만** 비고가 안 보이고, 오류가 안 나 아무도 신고하지 않는다.
 *
 * 🔵 순수 함수가 아니라 **화면·조회의 모양**이라 소스 글자로 잰다 — 이 파일 머리말 6번과 같은 처방이다.
 * ============================================================================
 */
describe("요청 비고가 「승인 요청건」까지 온다 (2026-10-22)", () => {
  it("🔴 조회가 신청의 jsonb 를 긁어 와 **안전하게** 뽑는다 — 맹목적 형변환이 아니다", () => {
    const server = src("src/lib/approval/part-issue.ts");
    assert.ok(server.includes("requestPayload: stockRequests.payload"), "조회가 신청의 payload 를 안 긁어 온다 — 화면까지 올 길이 없다");
    assert.ok(server.includes("requestNote: readRequestNote(r.requestPayload)"), "화면이 받는 모양에 비고를 안 담는다");
    assert.ok(!/payload as (unknown as )?EntryInput/.test(server), "payload 를 EntryInput 으로 믿고 받는 길이 생겼다 — 옛 신청에는 그 칸이 없다");
  });

  it("🔴 **묶음 셋이 같은 변환(`toCard`)을 거친다** — 한 묶음만 따로 만드는 길이 없다", () => {
    const data = src("src/lib/approval/part-issue-screen-data.ts");
    assert.ok(data.includes("requestNote: view.requestNote"), "변환이 비고를 옮겨 적지 않는다");
    // 🔵 (가) 결재할 것 · (나) 실행할 것 · (다) 내가 올린 것 — 셋 다 같은 함수를 지난다.
    assert.equal(data.match(/toCard\(v, ctx\)/g)?.length, 3, "세 묶음 중 `toCard` 를 안 거치는 것이 생겼다 — 그 묶음에서만 비고가 사라진다");
    assert.ok(/toDecide: toDecideViews\.map\(\(v\) => toCard\(v, ctx\)\)/.test(data), "(가) 결재할 건이 다른 길로 만들어진다");
    assert.ok(/const toExecute = toExecuteViews\.map\(\(v\) => toCard\(v, ctx\)\)/.test(data), "(나) 실행할 건이 다른 길로 만들어진다");
    assert.ok(/const mineAll = mineViews\.map\(\(v\) => toCard\(v, ctx\)\)/.test(data), "(다) 내가 올린 건이 다른 길로 만들어진다");
  });

  it("🔴 화면이 「신청 사유」와 **다른 이름표로** 그린다 — 누구의 말인지 알 수 있게", () => {
    const screen = src("src/components/stock/IssueApprovalScreen.tsx");
    assert.ok(screen.includes("요청 비고 (신청한 사람이 적은 말): “{card.requestNote}”"), "요청 비고를 안 그리거나 이름표에 누구 말인지가 없다");
    assert.ok(screen.includes("신청 사유: “{card.reason}”"), "「신청 사유」 줄이 바뀌었다 — 이 조각은 그 줄을 건드리지 않는다");
    assert.ok(!screen.includes("요청 비고: “{card.reason}”"), "「신청 사유」의 값을 요청 비고 자리에 심었다 — 섞였다");
    assert.ok(!screen.includes("신청 사유: “{card.requestNote}”"), "요청 비고를 「신청 사유」 자리에 심었다 — 섞였다");
  });

  it("🔴 비어 있으면 **줄 자체를 그리지 않는다** — 사유와 같은 규칙", () => {
    const screen = src("src/components/stock/IssueApprovalScreen.tsx");
    assert.ok(screen.includes("{card.requestNote ? ("), "비었을 때를 가르는 울타리가 없다 — 모든 카드에 빈 상자가 붙는다");
    assert.ok(!/requestNote \|\| ["“]/.test(screen), "비었을 때 「없음」 같은 글자를 지어낸다");
    assert.ok(!/requestNote\?\?/.test(screen.replace(/\s/g, "")), "비었을 때 대신 쓸 글자를 지어낸다");
  });

  it("🔴 길어도 **잘라서 숨기지 않는다** — 읽으라고 적은 글이다", () => {
    const screen = src("src/components/stock/IssueApprovalScreen.tsx");
    assert.ok(!/card\.requestNote\.(slice|substring|substr)\(/.test(screen), "비고를 잘라서 보여 준다");
    assert.ok(!/line-clamp[^"]*"[^"]*\{card\.requestNote\}/s.test(screen), "비고를 줄 수로 접어 숨긴다");
  });

  it("🔵 카드 타입이 비고를 **제 이름으로** 들고 있다 — 화면의 `note` 입력 칸 셋과 겹치지 않게", () => {
    // 🔴 타입이 어긋나면 여기서 tsc 가 멈춘다(런타임 단언은 거드는 것일 뿐이다).
    const card: Pick<IssueApprovalCard, "reason" | "requestNote"> = { reason: "담당자가 결재자에게 쓴 글", requestNote: "신청한 사람이 적은 말" };
    assert.notEqual(card.reason, card.requestNote, "둘은 다른 사람의 말이다");
  });
});
