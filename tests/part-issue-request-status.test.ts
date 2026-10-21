import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REQUEST_STATUSES, type RequestStatus } from "../src/db/schema/stock-requests";
import { requestStatusAfterPartIssue, type PartIssueRequestExit } from "../src/lib/approval/part-issue-rules";
import {
  ACTIONABLE_REQUEST_STATUSES,
  CLAIMABLE_REQUEST_STATUSES,
  DECIDED_REQUEST_STATUSES,
  EXECUTABLE_REQUEST_STATUSES,
  PENDING_REQUEST_STATUSES,
  REJECTABLE_REQUEST_STATUSES,
  REQUEST_STATUS_BADGE,
  REQUEST_STATUS_LABEL,
  canCancelRequest,
  isClaimableRequest,
  isClosedRequest,
  isRejectableRequest,
  reopenedRequestStatus,
} from "../src/lib/stock/codes";

/**
 * ============================================================================
 * 부품 요청의 「결재 중」 자리 (2026-10-21, 조각 11e)
 * ============================================================================
 * 이 저장소에는 DB 시험이 없다(`src/lib/approval/part-issue-rules.ts` 머리말). 그래서 서버가
 * `UPDATE … SET status` 에 직접 적은 글자는 **아무도 돌려 보지 못한 채** 운영으로 나간다 —
 * 들고 나는 길을 순수 함수 하나로 뽑아 두고 여기서 전부 돌려 보는 까닭이 그것이다.
 *
 * ── 🔴 이 시험이 지키는 것 셋 ───────────────────────────────────────────
 *  ① **갇히지 않는다.** `IN_APPROVAL` 은 확인·반려·마감·보류·취소를 **전부** 거절하는 자리라,
 *     나오는 길(거두기·반려·실행) 중 하나라도 빠지면 그 신청은 영영 못 움직인다.
 *  ② **구멍 1이 닫혔다.** 결재가 도는 중에 반려·보류·취소가 되면 결재건은 `PENDING_APPROVAL` 로
 *     살아남아 결재자에게 계속 떠서 **이미 반려된 요청을 결재하게 된다.**
 *  ③ **구멍 2가 닫혔다.** 배지·알림이 그 줄을 「지금 할 일」로 세면 담당자는 눌러 봐야
 *     「결재 대기라 지금 할 게 없다」를 안다.
 * ============================================================================
 */

describe("결재가 움직일 때 부품 요청이 가는 자리 — 네 출구 (2026-10-21, 조각 11e)", () => {
  it("🔴 [불출 신청] 이 서면 요청은 「결재 중」이다 — 더는 PENDING 이 아니다", () => {
    assert.equal(requestStatusAfterPartIssue("ISSUE_REQUESTED", 0), "IN_APPROVAL");
  });

  it("🔴 자동 승인(결재자가 전부 신청자 본인)도 「결재 중」이다 — 결재건은 APPROVED 라도 재고는 아직 안 나갔다", () => {
    // 🔵 갈래가 둘이라 빠뜨리기 쉬운 자리다. 결재건의 상태(`AUTO_APPROVED` → `APPROVED`)가 무엇이든
    //    **올리는 순간의 요청 자리는 하나**다 — 나가는 것은 「승인 요청건」의 [실행]이다.
    //    여기가 `PENDING` 이면 담당자가 [확인]으로 한 번, [실행]으로 또 한 번 내준다.
    assert.equal(requestStatusAfterPartIssue("ISSUE_REQUESTED", 0), "IN_APPROVAL");
    assert.equal(requestStatusAfterPartIssue("ISSUE_REQUESTED", 5), "IN_APPROVAL", "이미 나간 수량이 있어도 올릴 때 자리는 같다");
  });

  it("🔴 올린 사람이 [거두기] 하면 담당자 손으로 돌아온다 — 아무것도 안 나갔으면 대기", () => {
    assert.equal(requestStatusAfterPartIssue("APPROVAL_CANCELLED", 0), "PENDING");
  });

  it("🔴 일부 나간 신청에서 올린 결재를 거두면 「일부 나감」으로 돌아온다 — PENDING 으로 고정하면 나간 회차가 없던 일이 된다", () => {
    // 결재는 PENDING 뿐 아니라 PARTIAL 에서도 올릴 수 있다(아래 「올릴 수 있는 자리」 시험).
    assert.equal(requestStatusAfterPartIssue("APPROVAL_CANCELLED", 3), "PARTIAL");
    assert.equal(requestStatusAfterPartIssue("APPROVAL_CANCELLED", 3), reopenedRequestStatus(3), "보류 풀기와 같은 함수로 센다");
    assert.equal(requestStatusAfterPartIssue("APPROVAL_CANCELLED", 0), reopenedRequestStatus(0));
  });

  it("🔴 반려되면 요청도 끝이다 — 대기로 되살리지 않는다 (2026-10-21 쓰는 분 결정)", () => {
    // 되돌리면 반려된 요청이 대기 목록에 되살아나 담당자가 그대로 내주게 되고, 반려한 결재자의 뜻이 사라진다.
    assert.equal(requestStatusAfterPartIssue("APPROVAL_REJECTED", 0), "REJECTED");
    assert.equal(requestStatusAfterPartIssue("APPROVAL_REJECTED", 3), "REJECTED", "일부 나갔어도 결재 반려는 요청을 닫는다");
  });

  it("🔴 네 번째 출구(실행)는 이 함수에 없다 — confirmRequest 가 「다 나갔나」를 세어 정한다", () => {
    // 상태 하나로 답할 수 없는 일이라 일부러 안 넣었다. 넣으면 같은 셈이 두 벌이 된다.
    const exits: PartIssueRequestExit[] = ["ISSUE_REQUESTED", "APPROVAL_CANCELLED", "APPROVAL_REJECTED"];
    for (const exit of exits) {
      assert.notEqual(requestStatusAfterPartIssue(exit, 0), "CONFIRMED", exit);
      assert.notEqual(requestStatusAfterPartIssue(exit, 9), "CONFIRMED", exit);
    }
  });

  it("🔴 출구가 전부 「결재 중」에서 **빠져나온다** — 갇히는 길이 하나도 없다", () => {
    for (const exit of ["APPROVAL_CANCELLED", "APPROVAL_REJECTED"] as const) {
      assert.notEqual(requestStatusAfterPartIssue(exit, 0), "IN_APPROVAL", exit);
      assert.notEqual(requestStatusAfterPartIssue(exit, 4), "IN_APPROVAL", exit);
    }
  });

  it("가는 자리는 전부 실제로 있는 상태다 (스키마 enum 과 맞는다)", () => {
    const exits: PartIssueRequestExit[] = ["ISSUE_REQUESTED", "APPROVAL_CANCELLED", "APPROVAL_REJECTED"];
    for (const exit of exits) {
      for (const issued of [0, 7]) {
        assert.ok((REQUEST_STATUSES as readonly string[]).includes(requestStatusAfterPartIssue(exit, issued)), `${exit}/${issued}`);
      }
    }
  });
});

/**
 * 구멍 1 — 결재가 도는 중에는 담당자도 신청자도 그 신청을 닫을 수 없다.
 *
 * 🔴 **막는 자리를 새로 더하지 않았다.** 다섯 함수(`confirmRequest`·`rejectRequest`·`closeRequest`·
 *    `holdRequest`·`cancelRequest`)가 전부 상태를 WHERE 에 걸고 `IN_APPROVAL` 을 받는 곳이 하나도 없어
 *    **저절로** 막힌다 — 보류(`ON_HOLD`)가 막히는 자리와 **같은 한 줄**이다. 이 시험은 그 묶음들을 지킨다.
 */
describe("🔴 결재 중인 요청은 반려·보류·취소가 안 된다 — 구멍 1 (2026-10-21, 조각 11e)", () => {
  it("[반려] 가 받지 않는다 — 반려는 아직 아무것도 안 나간 신청만 받는다", () => {
    assert.equal(isRejectableRequest("IN_APPROVAL"), false);
    assert.ok(!(REJECTABLE_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"));
    assert.deepEqual([...REJECTABLE_REQUEST_STATUSES], ["PENDING"], "rejectRequest 의 WHERE 가 이 묶음을 그대로 쓴다");
  });

  it("[보류] 가 받지 않는다 — 보류는 집을 수 있는 묶음(PENDING·PARTIAL)에만 걸린다", () => {
    assert.equal(isClaimableRequest("IN_APPROVAL"), false);
    assert.ok(!(CLAIMABLE_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"), "holdRequest 의 WHERE 가 이 묶음이다");
  });

  it("[마감] 도 받지 않는다 — 마감은 일부 나간 신청(PARTIAL)만 받는다", () => {
    assert.equal(isClosedRequest("IN_APPROVAL", [{ quantity: 8, issued: 5 }]), false, "결재 중은 마감으로 보이지도 않는다");
  });

  it("🔴 신청자의 [신청 취소] 도 막힌다 — 거두면 결재건만 살아남아 이미 취소된 요청을 결재하게 된다", () => {
    const me = "u-1";
    const mine = { source: "INVENTORY", requestedBy: me } as const;
    assert.equal(canCancelRequest({ ...mine, status: "IN_APPROVAL" }, me), false);
    // 🔵 되돌리는 길은 있다 — 결재를 올린 사람이 먼저 결재건을 거두면 신청이 PENDING 으로 돌아와 단추가 다시 선다.
    assert.equal(canCancelRequest({ ...mine, status: reopenedRequestStatus(0) }, me), true);
  });

  it("🔴 사람이 누르는 [확인] 도 그 자리에서 재고를 빼지 못한다 — 묶음에서 빠져 있다", () => {
    // 지금 그 길에 달린 문은 「절차가 쓰이고 있는가」 하나뿐이라, 관리자가 결재선을 끄면 그 문이 열린다.
    // 상태를 묶음에서 빼 두면 그 틈이 **상태 자체로** 막힌다.
    assert.ok(!(CLAIMABLE_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"));
  });

  it("🔴 그런데 **실행**은 집어야 한다 — 안 그러면 결재를 다 받고도 부품이 안 나간다", () => {
    assert.ok((EXECUTABLE_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"));
  });

  it("🔴 실행 묶음은 [확인] 묶음을 **덮는다** — 이 조각 전에 올라간 결재건은 신청이 아직 PENDING·PARTIAL 이다", () => {
    for (const s of CLAIMABLE_REQUEST_STATUSES) assert.ok((EXECUTABLE_REQUEST_STATUSES as readonly string[]).includes(s), s);
    assert.equal(EXECUTABLE_REQUEST_STATUSES.length, CLAIMABLE_REQUEST_STATUSES.length + 1, "넓어진 것은 「결재 중」 하나뿐이다");
  });

  it("🔴 결재 중은 끝난 것이 아니다 — 결정 묶음에 넣으면 요청 관리 목록에서 사라진다", () => {
    assert.ok(!(DECIDED_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"));
    assert.ok((PENDING_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"), "대기 목록에는 보여야 잊히지 않는다");
  });
});

/**
 * 구멍 2 — 결재가 도는 동안 담당자가 그 신청에 할 수 있는 일은 하나도 없다.
 * 🔴 그런데도 「대기 N」에 세면 매일 그 숫자를 보고 화면을 열었다가 **누를 단추가 없다**는 것을 확인하고 닫게 된다.
 */
describe("🔴 결재 중인 요청은 배지·알림에 안 세어진다 — 구멍 2 (2026-10-21, 조각 11e)", () => {
  it("재촉하는 숫자(머리말 배지·알림 종)에서 빠진다", () => {
    assert.ok(!(ACTIONABLE_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"));
    assert.deepEqual([...ACTIONABLE_REQUEST_STATUSES].sort(), ["CONFIRMING", "PARTIAL", "PENDING"], "보류와 결재 중 둘만큼 좁다");
  });

  it("🔴 배지와 종이 보는 묶음은 하나다 — countPendingRequests·summarizePendingRequests 가 같은 것을 쓴다", () => {
    // 둘이 갈리면 「배지에는 있는데 종에는 없는」 신청이 생긴다. 묶음이 한 벌이라 저절로 같다.
    for (const s of ACTIONABLE_REQUEST_STATUSES) assert.ok((PENDING_REQUEST_STATUSES as readonly string[]).includes(s), s);
    assert.equal(ACTIONABLE_REQUEST_STATUSES.length + 2, PENDING_REQUEST_STATUSES.length, "빠진 둘 = 보류 · 결재 중");
  });

  it("🔴 목록에서는 사라지지 않는다 — 「숫자로 재촉한다」와 「목록에 보인다」는 뜻이 다르다", () => {
    assert.ok((PENDING_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"));
    assert.ok(!(DECIDED_REQUEST_STATUSES as readonly string[]).includes("IN_APPROVAL"));
  });
});

/**
 * 글자와 색 — 상태를 더하면 `Record<RequestStatus, …>` 라 tsc 가 빠진 칸을 잡지만, **빈 글자와 겹친 색**은
 * 컴파일을 통과하고 화면에서만 드러난다.
 */
describe("「결재 중」의 글자와 배지 색 (2026-10-21, 조각 11e)", () => {
  it("글자는 「결재 중」이다", () => {
    assert.equal(REQUEST_STATUS_LABEL.IN_APPROVAL, "결재 중");
  });

  it("🔴 대기·보류와 **다른 색**이다 — 지금 처리할 것으로 착각하고 눌러 보지 않게", () => {
    assert.notEqual(REQUEST_STATUS_BADGE.IN_APPROVAL, REQUEST_STATUS_BADGE.PENDING);
    assert.notEqual(REQUEST_STATUS_BADGE.IN_APPROVAL, REQUEST_STATUS_BADGE.ON_HOLD);
  });

  it("어느 상태와도 색이 겹치지 않는다", () => {
    const colours = (REQUEST_STATUSES as readonly RequestStatus[]).map((s) => REQUEST_STATUS_BADGE[s]);
    assert.equal(new Set(colours).size, colours.length, "색이 겹치면 두 상태가 한 화면에서 같은 줄로 읽힌다");
  });
});
