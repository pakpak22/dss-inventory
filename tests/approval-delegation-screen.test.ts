import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ApprovalDelegationPeriod } from "../src/lib/approval/delegation";
import {
  canRevokeDelegation,
  delegationNotice,
  delegationState,
  delegationStateBadge,
  formatDelegationPeriod,
  DELEGATION_NOTHING_ACTING,
  DELEGATION_NOTHING_I_MADE,
  DELEGATION_STATE_BADGE,
  DELEGATION_STATE_LABELS,
  type DelegationState,
} from "../src/lib/approval/delegation-screen";

/**
 * ============================================================================
 * 결재권 위임 화면 — 순수 규칙과 글자 (2026-10-21, 조각 3)
 * ============================================================================
 * 🔴 **이 저장소에는 화면 렌더 시험이 없다.** 화면 파일 안에 적은 규칙은 아무도 돌려 보지 못한
 * 채 운영으로 나간다(`tests/part-issue-screen.test.ts` 와 같은 까닭). 그래서 「지금 어느
 * 상태인가」·「되돌리기를 그릴까」·「0건일 때 뭐라고 하나」를 순수 모듈에 내려 두고 여기서 전수를
 * 돌려 본다.
 * ============================================================================
 */

/** 2026-10-20 00:00 ~ 2026-10-26 00:00(한국) = 「10/20 ~ 10/25」. */
const STARTS = new Date("2026-10-19T15:00:00.000Z");
const ENDS = new Date("2026-10-25T15:00:00.000Z");

const period = (over: Partial<ApprovalDelegationPeriod> = {}): ApprovalDelegationPeriod => ({
  delegatorSub: "sub-kim",
  delegateSub: "sub-lee",
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
  ...over,
});

const DURING = new Date("2026-10-22T03:00:00.000Z");
const BEFORE = new Date("2026-10-01T03:00:00.000Z");
const AFTER = new Date("2026-11-01T03:00:00.000Z");

describe("① 이 줄은 지금 어느 상태인가 — 넷", () => {
  it("기간 안이면 「맡기는 중」", () => {
    assert.equal(delegationState(period(), DURING), "ACTIVE");
  });

  it("🔴 **아직 시작 전**이면 「시작 전」이다 — 「끝남」으로 그리면 거짓말이다", () => {
    // 🔴 셋(살아 있음/끝남/되돌림)만 두면 다음 주 출장을 미리 적어 둔 줄이 「끝남」으로 보인다.
    //    그때 사람은 자기가 잘못 적은 줄 알고 같은 줄을 또 만든다.
    assert.equal(delegationState(period(), BEFORE), "SCHEDULED");
  });

  it("기간이 지났으면 「끝남」", () => {
    assert.equal(delegationState(period(), AFTER), "ENDED");
  });

  it("🔴 **되돌림이 먼저다** — 기간 안이어도, 시작 전이어도 「되돌림」이다", () => {
    // 되돌리기는 기간을 줄여 적는 것이 아니라 깃발을 하나 세우는 것이다(표 쪽 머리말).
    const revoked = period({ revokedAt: new Date("2026-10-21T00:00:00.000Z") });
    assert.equal(delegationState(revoked, DURING), "REVOKED");
    assert.equal(delegationState(revoked, BEFORE), "REVOKED");
    assert.equal(delegationState(revoked, AFTER), "REVOKED");
  });

  it("경계 — 시작 그 순간은 「맡기는 중」, 끝 그 순간은 「끝남」(반열린 구간)", () => {
    assert.equal(delegationState(period(), STARTS), "ACTIVE");
    assert.equal(delegationState(period(), new Date(STARTS.getTime() - 1)), "SCHEDULED");
    assert.equal(delegationState(period(), ENDS), "ENDED", "끝은 포함하지 않는다");
    assert.equal(delegationState(period(), new Date(ENDS.getTime() - 1)), "ACTIVE");
  });
});

describe("② 되돌리기를 그릴까", () => {
  it("🔵 살아 있는 것과 **시작 전인 것**은 되돌릴 수 있다 — 취소된 출장은 실제로 있다", () => {
    assert.equal(canRevokeDelegation("ACTIVE"), true);
    assert.equal(canRevokeDelegation("SCHEDULED"), true);
  });

  it("🔴 끝난 것·이미 되돌린 것은 아니다 — 지난 기간의 위임은 「그때 왜 저 사람이 눌렀나」의 근거다", () => {
    assert.equal(canRevokeDelegation("ENDED"), false);
    assert.equal(canRevokeDelegation("REVOKED"), false);
  });
});

describe("③ 배지 — 🔴 색과 글자는 **짝이다**", () => {
  const STATES: DelegationState[] = ["SCHEDULED", "ACTIVE", "ENDED", "REVOKED"];

  it("넷 모두 글자와 색이 있고, 코드가 그대로 나가지 않는다", () => {
    for (const state of STATES) {
      const badge = delegationStateBadge(state);
      assert.equal(badge.label, DELEGATION_STATE_LABELS[state]);
      assert.equal(badge.className, DELEGATION_STATE_BADGE[state]);
      assert.ok(badge.label.length > 0, state);
      assert.notEqual(badge.label, state, "영어 코드가 화면에 나갔다(CLAUDE.md 10절)");
      assert.match(badge.className, /bg-/, state);
    }
  });

  it("🔴 **글자가 서로 다르다** — 색만 보고 가르지 않게 넷이 다른 말을 한다(CLAUDE.md 9-7절)", () => {
    const labels = STATES.map((s) => DELEGATION_STATE_LABELS[s]);
    assert.equal(new Set(labels).size, labels.length, `글자가 겹친다: ${labels.join(" · ")}`);
  });
});

describe("④ 기간 한 줄", () => {
  it("「시작 ~ 종료」", () => {
    assert.equal(formatDelegationPeriod("2026-10-20", "2026-10-25"), "2026-10-20 ~ 2026-10-25");
  });

  it("🔵 하루짜리는 날짜 하나로 — 같은 날짜가 두 번 보이면 사람이 잘못 적은 줄 안다", () => {
    assert.equal(formatDelegationPeriod("2026-10-20", "2026-10-20"), "2026-10-20 하루");
  });
});

describe("⑤ 돌아왔을 때의 한 줄", () => {
  it("맡긴 뒤 — 🔴 **내가 직접 누르는 길이 그대로 열려 있다**는 것까지 말한다", () => {
    const n = delegationNotice({ delegated: "1" });
    assert.ok(n);
    assert.match(n.text, /맡겼습니다/);
    assert.match(n.text, /내가 직접 누르는 길/, "맡기면 내가 못 누르는 줄 아는 사람이 있다");
  });

  it("되돌린 뒤 — 🔵 **지난 기간에 그분이 누른 건은 그대로 남는다**", () => {
    const n = delegationNotice({ delegationRevoked: "1" });
    assert.ok(n);
    assert.match(n.text, /되돌렸습니다/);
    assert.match(n.text, /그대로 남습니다/);
  });

  it("꼬리표가 없거나 `1` 이 아니면 아무 말도 하지 않는다", () => {
    assert.equal(delegationNotice({}), null);
    assert.equal(delegationNotice({ delegated: "0" }), null);
    assert.equal(delegationNotice({ delegated: ["1", "1"] }), null, "주소를 손으로 고쳐도 화면이 깨지지 않는다");
    assert.equal(delegationNotice({ approved: "1" }), null, "결재 쪽 꼬리표를 가로채지 않는다");
  });
});

describe("⑥ 0건일 때 — 🔴 묶음을 감추지 않고 **말한다**", () => {
  it("두 문구가 다르다 — 「맡긴 것이 없다」와 「대신하는 것이 없다」는 다른 말이다", () => {
    assert.notEqual(DELEGATION_NOTHING_I_MADE, DELEGATION_NOTHING_ACTING);
    for (const text of [DELEGATION_NOTHING_I_MADE, DELEGATION_NOTHING_ACTING]) {
      assert.match(text, /습니다\.$/, "하십시오체가 아니다(CLAUDE.md 10절)");
    }
  });
});
