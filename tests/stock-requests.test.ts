import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REQUEST_STATUSES } from "../src/db/schema/stock-requests";
import { PART_ISSUE_LOCK_LABELS, type PartIssueLock } from "../src/lib/approval/part-issue-gate";
import {
  ACTIONABLE_REQUEST_STATUSES,
  ADMIN_ONLY_TYPES,
  AWAITING_EXECUTION_FILTER,
  AWAITING_EXECUTION_REQUEST_BADGE,
  AWAITING_EXECUTION_REQUEST_LABEL,
  CLAIMABLE_REQUEST_STATUSES,
  CLOSED_REQUEST_BADGE,
  CLOSED_REQUEST_LABEL,
  CONFIRMATION_TYPES,
  DECIDED_REQUEST_STATUSES,
  ENTRY_TYPES,
  PENDING_REQUEST_STATUSES,
  REQUEST_STATUS_BADGE,
  REQUEST_STATUS_FILTER_ORDER,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_ORDER,
  isClaimableRequest,
  isClosedRequest,
  needsConfirmation,
  requestMatchesStatusFilter,
  requestStatusBadge,
  requestStatusFilterLabel,
  requestStatusLabel,
} from "../src/lib/stock/codes";

/**
 * 담당자 확인 단계 (2026-10-06) — 🔴 **2026-10-15 에 규칙이 바뀌어 이 묶음을 다시 적었다.**
 *
 * 옛 규칙은 「기록 권한자가 적으면 대기, **관리자가 적으면 바로**」였고 그것을 못 박는 시험이 여기 있었다.
 * 새 규칙은 「**누가 적든** 반출은 요청으로 올라간다」이다 — 관리자가 적은 반출이 신청으로 남지 않아
 * 부품 요청 관리 화면에 안 뜬 것이 바꾼 까닭이다(`src/lib/stock/codes.ts` 의 `needsConfirmation` 주석).
 * 🔵 단언을 **약하게 만든 것이 아니라** 바뀐 규칙을 그대로 다시 못 박은 것이다. 역할 매개변수는 사라졌으므로
 *    「관리자면 false」는 이제 적을 수조차 없다 — tsc 가 먼저 잡는다.
 */
describe("담당자 확인 단계 (2026-10-06 → 2026-10-15 에 역할 조건을 없앴다)", () => {
  it("반출 계열(사용·대여·폐기)만 확인을 거친다", () => {
    assert.deepEqual([...CONFIRMATION_TYPES].sort(), ["DISPOSE", "LOAN", "USE"]);
  });

  it("🔴 반출 셋은 역할과 무관하게 확인을 거친다 — 관리자가 적어도 요청으로 올라간다 (2026-10-15 사용자 결정)", () => {
    for (const t of CONFIRMATION_TYPES) assert.equal(needsConfirmation(t), true, t);
    assert.equal(needsConfirmation("USE"), true);
    assert.equal(needsConfirmation("LOAN"), true);
    assert.equal(needsConfirmation("DISPOSE"), true);
  });

  it("그 밖의 종류는 언제나 바로 기록된다 (입고·반환·조정·소유 옮김·처음 수량·기록 취소)", () => {
    for (const t of ENTRY_TYPES) {
      if (CONFIRMATION_TYPES.has(t)) continue;
      assert.equal(needsConfirmation(t), false, t);
    }
  });

  it("🔵 「누가 적을 수 있나」는 바뀌지 않았다 — ADMIN_ONLY_TYPES 는 그대로이고 확인을 거치지도 않는다", () => {
    assert.deepEqual([...ADMIN_ONLY_TYPES].sort(), ["ADJUST", "CORRECTION", "OPENING", "TRANSFER"]);
    for (const t of ADMIN_ONLY_TYPES) assert.equal(needsConfirmation(t), false, t);
    for (const t of CONFIRMATION_TYPES) assert.ok(!ADMIN_ONLY_TYPES.has(t), t);
  });
});

/**
 * 세는 쪽이 상태를 가르는 자리 (2026-10-14, 조각 4c).
 *
 * 🔴 이 시험이 지키는 것은 **빠짐이 없다는 것**이다. 상태를 하나 더하고 두 묶음을 안 고치면 그 상태의 신청이
 *    대기 목록에도 결정 목록에도 안 걸려 화면에서 조용히 사라진다 — 원장은 안 깨지므로 아무 오류가 안 난다.
 */
describe("반출 신청을 세는 쪽 — 어느 상태를 대기로 보나 (2026-10-14, 조각 4c)", () => {
  it("일부만 나간 것(PARTIAL)은 대기로 센다 — 끝난 것으로 세지 않는다", () => {
    assert.ok(PENDING_REQUEST_STATUSES.includes("PARTIAL"), "아직 줄 것이 남아 담당자가 계속 봐야 한다");
    assert.ok(!(DECIDED_REQUEST_STATUSES as readonly string[]).includes("PARTIAL"));
  });

  it("처리 중(CONFIRMING)·결재 중(IN_APPROVAL)도 대기, 확인·반려·취소는 결정된 것", () => {
    assert.deepEqual([...PENDING_REQUEST_STATUSES].sort(), ["CONFIRMING", "IN_APPROVAL", "ON_HOLD", "PARTIAL", "PENDING"]);
    assert.deepEqual([...DECIDED_REQUEST_STATUSES].sort(), ["CANCELLED", "CONFIRMED", "REJECTED"]);
  });

  it("두 묶음이 모든 상태를 빠짐없이, 겹치지 않게 덮는다", () => {
    const counted = [...PENDING_REQUEST_STATUSES, ...DECIDED_REQUEST_STATUSES];
    assert.deepEqual(counted.slice().sort(), [...REQUEST_STATUSES].sort(), "상태를 더했으면 둘 중 한 묶음에도 넣어야 한다");
    assert.equal(new Set(counted).size, counted.length, "한 상태가 양쪽에 들어가면 같은 신청이 두 목록에 보인다");
  });
});

/**
 * 보류 — 「멈춰 둠」 (2026-10-15, 조각 10a).
 *
 * 🔴 보류는 **대기 목록에는 남고 재촉하는 숫자에서만 빠진다.** 그 둘을 가르는 자리가 묶음 둘이라, 어느 한쪽만
 *    고치면 보류한 신청이 화면에서 사라지거나(목록에서 빼면) 매일 재촉당한다(배지에 넣으면). 이 시험이 그 울타리다.
 */
describe("보류(ON_HOLD) — 어느 묶음에 드나 (2026-10-15, 조각 10a)", () => {
  it("보류는 대기로 센다 — 끝난 것으로 세면 목록에서 사라져 다시 집을 길이 없다", () => {
    assert.ok((PENDING_REQUEST_STATUSES as readonly string[]).includes("ON_HOLD"), "대기 목록에 남아야 잊히지 않는다");
    assert.ok(!(DECIDED_REQUEST_STATUSES as readonly string[]).includes("ON_HOLD"), "보류는 결정이 아니다 — 풀면 다시 살아난다");
  });

  it("🔴 재촉하는 숫자(배지·알림 종)에서는 뺀다 — 일부러 멈춰 둔 것을 매일 재촉하지 않는다", () => {
    assert.deepEqual([...ACTIONABLE_REQUEST_STATUSES].sort(), ["CONFIRMING", "PARTIAL", "PENDING"]);
    assert.ok(!(ACTIONABLE_REQUEST_STATUSES as readonly string[]).includes("ON_HOLD"));
  });

  it("손댈 수 있는 묶음은 대기 묶음의 부분집합이다 — 세지 않는 것을 재촉할 수는 없다", () => {
    for (const s of ACTIONABLE_REQUEST_STATUSES) assert.ok((PENDING_REQUEST_STATUSES as readonly string[]).includes(s), s);
    // 🔵 빠진 둘 = 보류(2026-10-15) · 결재 중(2026-10-21). 둘 다 **담당자가 지금 할 수 있는 일이 없는** 자리다.
    assert.ok(ACTIONABLE_REQUEST_STATUSES.length < PENDING_REQUEST_STATUSES.length, "보류와 결재 중 둘만큼 좁다");
  });

  it("🔴 보류 중에는 집을 수 없다 — 확인·반려·마감이 저절로 막히는 자리다", () => {
    assert.ok(!(CLAIMABLE_REQUEST_STATUSES as readonly string[]).includes("ON_HOLD"));
    assert.equal(isClaimableRequest("ON_HOLD"), false);
    assert.deepEqual([...CLAIMABLE_REQUEST_STATUSES].sort(), ["PARTIAL", "PENDING"], "보류를 걸 수 있는 묶음이기도 하다(requests.ts 의 holdRequest)");
  });

  it("보류는 마감으로 보이지 않는다 — 아직 접힌 것이 아니다", () => {
    assert.equal(isClosedRequest("ON_HOLD", [{ quantity: 8, issued: 5 }]), false);
  });
});

/**
 * 화면이 [확인] 단추를 그리는 자리 (2026-10-14, 조각 4d).
 *
 * 🔴 조각 4c 까지는 화면이 `status === "PENDING"` 만 보고 그려서 **일부 나간 신청이 보이는데 누를 수 없었다.**
 *    세는 묶음을 그대로 쓰면 이번엔 거꾸로 「처리 중」에도 단추가 생겨 눌러도 거절당한다 — 그래서 묶음이 따로 있다.
 */
describe("집을 수 있는 상태 — [확인] 단추를 어디에 그리나 (2026-10-14, 조각 4d)", () => {
  it("일부 나간 것(PARTIAL)도 다시 집는다 — 「보이는데 못 누르는」 줄이 없게", () => {
    assert.deepEqual([...CLAIMABLE_REQUEST_STATUSES].sort(), ["PARTIAL", "PENDING"]);
    assert.equal(isClaimableRequest("PARTIAL"), true);
    assert.equal(isClaimableRequest("PENDING"), true);
  });

  it("🔴 처리 중(CONFIRMING)에는 안 그린다 — 대기로는 세지만 지금 집을 수는 없다", () => {
    assert.equal(isClaimableRequest("CONFIRMING"), false);
    assert.ok(PENDING_REQUEST_STATUSES.includes("CONFIRMING"), "세는 묶음에는 들어 있다 — 두 묶음은 뜻이 다르다");
  });

  it("결정된 것에는 안 그린다", () => {
    for (const s of DECIDED_REQUEST_STATUSES) assert.equal(isClaimableRequest(s), false, s);
  });

  it("집을 수 있는 것은 전부 대기로 센다 (대기 목록에 없으면 단추를 띄울 자리도 없다)", () => {
    for (const s of CLAIMABLE_REQUEST_STATUSES) assert.ok((PENDING_REQUEST_STATUSES as readonly string[]).includes(s), s);
  });
});

/**
 * 마감 — 「준 것은 그대로 두고 남은 것만 접는다」 (2026-10-14 사용자 결정, 조각 4d).
 *
 * 🔴 상태값을 새로 만들지 않고 **세어서** 가린다. 그래서 이 시험이 그 규칙의 울타리다.
 */
describe("마감된 신청 가리기 — isClosedRequest (2026-10-14, 조각 4d)", () => {
  const line = (quantity: number, issued: number) => ({ quantity, issued });

  it("일부만 나간 채 닫힌 것이 마감이다", () => {
    assert.equal(isClosedRequest("CONFIRMED", [line(8, 5)]), true);
    assert.equal(isClosedRequest("CONFIRMED", [line(5, 5), line(3, 0)]), true, "한 줄은 다 나가고 한 줄은 하나도 안 나간 것도 마감");
  });

  it("다 나간 것은 마감이 아니다 — 그냥 확인이다", () => {
    assert.equal(isClosedRequest("CONFIRMED", [line(8, 8), line(2, 2)]), false);
  });

  it("🔴 회차 표가 생기기 전(조각 4a 이전)에 확인된 신청은 마감이 아니다 — 나간 수량이 0 으로 보인다", () => {
    assert.equal(isClosedRequest("CONFIRMED", [line(8, 0), line(2, 0)]), false, "이것까지 마감으로 세면 옛 신청이 전부 마감으로 보인다");
  });

  it("아직 안 끝난 것·반려·취소는 마감이 아니다", () => {
    assert.equal(isClosedRequest("PARTIAL", [line(8, 5)]), false, "열려 있으면 아직 마감이 아니다");
    assert.equal(isClosedRequest("PENDING", [line(8, 0)]), false);
    assert.equal(isClosedRequest("REJECTED", [line(8, 0)]), false);
    assert.equal(isClosedRequest("CANCELLED", [line(8, 0)]), false);
  });

  it("줄이 없는 신청(조정·소유 옮김)은 마감일 수 없다", () => {
    assert.equal(isClosedRequest("CONFIRMED", []), false);
  });
});

/**
 * 상태 글자와 배지 색 — **두 화면이 같은 표를 본다** (2026-10-15, 조각 10b).
 *
 * 🔴 `Record<RequestStatus, …>` 라 상태를 더하면 tsc 가 빠진 칸을 잡는다. 이 시험은 그 위에 **글자가 비어 있지
 *    않다**는 것까지 지킨다 — 빈 글자는 컴파일을 통과하고 화면에서만 사라진다.
 */
describe("신청 상태의 글자와 색 (2026-10-15, 조각 10b)", () => {
  it("여덟 상태를 빠짐없이 덮고 글자가 비어 있지 않다", () => {
    assert.deepEqual(Object.keys(REQUEST_STATUS_LABEL).sort(), [...REQUEST_STATUSES].sort());
    for (const s of REQUEST_STATUSES) assert.ok(REQUEST_STATUS_LABEL[s].trim().length > 0, s);
  });

  it("거르개가 도는 차례도 여덟 상태를 빠짐없이 덮는다 (글자 표에서 뽑으므로 저절로 따라온다)", () => {
    assert.deepEqual([...REQUEST_STATUS_ORDER].sort(), [...REQUEST_STATUSES].sort());
    assert.equal(new Set(REQUEST_STATUS_ORDER).size, REQUEST_STATUS_ORDER.length);
  });

  it("배지 색표도 여덟 상태를 빠짐없이 덮는다", () => {
    assert.deepEqual(Object.keys(REQUEST_STATUS_BADGE).sort(), [...REQUEST_STATUSES].sort());
    for (const s of REQUEST_STATUSES) assert.ok(REQUEST_STATUS_BADGE[s].trim().length > 0, s);
  });

  it("🔵 기록 내역 화면이 쓰던 글자 그대로다 — 두 화면이 같은 신청을 다르게 부르지 않는다", () => {
    assert.equal(REQUEST_STATUS_LABEL.CONFIRMING, "처리 중");
    assert.equal(REQUEST_STATUS_LABEL.PARTIAL, "일부 나감");
    assert.equal(REQUEST_STATUS_LABEL.REJECTED, "반려");
    assert.equal(REQUEST_STATUS_LABEL.CANCELLED, "취소");
  });

  it("🔴 보류는 대기와 **다른 색**이다 — 「멈춰 있다」가 한눈에 보여야 한다", () => {
    assert.notEqual(REQUEST_STATUS_BADGE.ON_HOLD, REQUEST_STATUS_BADGE.PENDING);
  });

  it("🔴 「마감」은 상태가 아니라 isClosedRequest 로 가른다 — 마감된 신청의 글자는 「확인됨」이 아니다", () => {
    const lines = [{ quantity: 8, issued: 5 }];
    const closed = isClosedRequest("CONFIRMED", lines);
    assert.equal(closed, true, "일부만 나간 채 닫힌 신청");
    assert.equal(requestStatusLabel("CONFIRMED", closed, null), CLOSED_REQUEST_LABEL);
    assert.notEqual(requestStatusLabel("CONFIRMED", closed, null), REQUEST_STATUS_LABEL.CONFIRMED);
    assert.notEqual(requestStatusBadge("CONFIRMED", closed, null), REQUEST_STATUS_BADGE.CONFIRMED);
  });

  it("다 나간 신청은 그냥 「확인됨」이다 — 마감 글자가 아무 데나 붙지 않는다", () => {
    const closed = isClosedRequest("CONFIRMED", [{ quantity: 8, issued: 8 }]);
    assert.equal(closed, false);
    assert.equal(requestStatusLabel("CONFIRMED", closed, null), REQUEST_STATUS_LABEL.CONFIRMED);
    assert.equal(requestStatusBadge("CONFIRMED", closed, null), REQUEST_STATUS_BADGE.CONFIRMED);
  });

  it("마감이 아닌 상태는 글자도 색도 표 그대로다", () => {
    for (const s of REQUEST_STATUSES) {
      assert.equal(requestStatusLabel(s, false, null), REQUEST_STATUS_LABEL[s], s);
      assert.equal(requestStatusBadge(s, false, null), REQUEST_STATUS_BADGE[s], s);
    }
  });
});

/**
 * 「실행 대기」 — 결재가 끝나 [실행]만 남은 신청 (2026-10-21, 조각 11f).
 *
 * 🔴 **상태값이 아니다.** 「마감」과 같은 길이라, 지키는 것도 같다 — 글자와 색이 **짝으로** 나오는가,
 *    차례(마감이 먼저)가 지켜지는가, 그리고 **결재가 없는 신청은 한 글자도 안 바뀌는가**.
 */
describe("「실행 대기」 글자와 색 (2026-10-21, 조각 11f)", () => {
  it("🔴 결재가 **없는** 신청은 글자도 색도 2026-10-21 이전과 한 글자도 다르지 않다", () => {
    for (const s of REQUEST_STATUSES) {
      assert.equal(requestStatusLabel(s, false, null), REQUEST_STATUS_LABEL[s], s);
      assert.equal(requestStatusBadge(s, false, null), REQUEST_STATUS_BADGE[s], s);
    }
  });

  it("🔵 결재가 **도는 중**이면(승인 대기) 상태 표 그대로다 — 「결재 중」은 상태가 말한다", () => {
    assert.equal(requestStatusLabel("IN_APPROVAL", false, "AWAITING_APPROVAL"), REQUEST_STATUS_LABEL.IN_APPROVAL);
    assert.equal(requestStatusBadge("IN_APPROVAL", false, "AWAITING_APPROVAL"), REQUEST_STATUS_BADGE.IN_APPROVAL);
  });

  it("🔴 결재가 끝나 실행만 남으면 글자와 색이 **함께** 바뀐다 — 한쪽만 바뀌는 일이 없다", () => {
    assert.equal(requestStatusLabel("IN_APPROVAL", false, "AWAITING_EXECUTION"), AWAITING_EXECUTION_REQUEST_LABEL);
    assert.equal(requestStatusBadge("IN_APPROVAL", false, "AWAITING_EXECUTION"), AWAITING_EXECUTION_REQUEST_BADGE);
    assert.notEqual(requestStatusLabel("IN_APPROVAL", false, "AWAITING_EXECUTION"), REQUEST_STATUS_LABEL.IN_APPROVAL);
    assert.notEqual(requestStatusBadge("IN_APPROVAL", false, "AWAITING_EXECUTION"), REQUEST_STATUS_BADGE.IN_APPROVAL);
  });

  it("🔴 이 조각 **전에** 올라간 결재건은 신청이 아직 대기(PENDING)다 — 그 줄도 「실행 대기」로 보인다", () => {
    assert.equal(requestStatusLabel("PENDING", false, "AWAITING_EXECUTION"), AWAITING_EXECUTION_REQUEST_LABEL);
    assert.equal(requestStatusBadge("PENDING", false, "AWAITING_EXECUTION"), AWAITING_EXECUTION_REQUEST_BADGE);
  });

  it("🔴 **마감이 「실행 대기」를 이긴다** — 차례를 글자로 못 박아 둔 자리다", () => {
    assert.equal(requestStatusLabel("CONFIRMED", true, "AWAITING_EXECUTION"), CLOSED_REQUEST_LABEL);
    assert.equal(requestStatusBadge("CONFIRMED", true, "AWAITING_EXECUTION"), CLOSED_REQUEST_BADGE);
  });

  it("🔴 색이 「결재 중」과 다르다 — 담당자가 할 일이 다르다(기다리기 ↔ 가서 누르기)", () => {
    assert.notEqual(AWAITING_EXECUTION_REQUEST_BADGE, REQUEST_STATUS_BADGE.IN_APPROVAL);
  });

  it("🔴 여덟 상태 어느 색과도, 마감 색과도 겹치지 않는다 — 두 뜻이 한 색을 쓰면 가를 수 없다", () => {
    for (const s of REQUEST_STATUSES) assert.notEqual(AWAITING_EXECUTION_REQUEST_BADGE, REQUEST_STATUS_BADGE[s], s);
    assert.notEqual(AWAITING_EXECUTION_REQUEST_BADGE, CLOSED_REQUEST_BADGE);
  });

  it("🔴 글자도 여덟 상태·마감 어느 것과도 겹치지 않는다", () => {
    for (const s of REQUEST_STATUSES) assert.notEqual(AWAITING_EXECUTION_REQUEST_LABEL, REQUEST_STATUS_LABEL[s], s);
    assert.notEqual(AWAITING_EXECUTION_REQUEST_LABEL, CLOSED_REQUEST_LABEL);
  });

  it("🔵 글자는 잠금이 쓰던 말과 같은 뿌리다 — 두 화면이 같은 순간을 다른 말로 부르지 않는다", () => {
    assert.ok(PART_ISSUE_LOCK_LABELS.AWAITING_EXECUTION.startsWith(AWAITING_EXECUTION_REQUEST_LABEL), `잠금 문구와 갈렸다: ${PART_ISSUE_LOCK_LABELS.AWAITING_EXECUTION}`);
  });
});

/**
 * 상태 거르개 — 🔴 **「결재 중」과 「실행 대기」가 갈려야 한다** (2026-10-21, 조각 11f).
 *
 * 둘은 상태가 같고(`IN_APPROVAL`) 잠금만 다른 것이 보통이라, 상태만 보고 거르면 한쪽을 고를 길이 없다.
 */
describe("상태 거르개의 「실행 대기」 (2026-10-21, 조각 11f)", () => {
  const row = (status: (typeof REQUEST_STATUSES)[number], issueLock: PartIssueLock | null) => ({ status, issueLock });
  const inApproval = row("IN_APPROVAL", "AWAITING_APPROVAL");
  const awaiting = row("IN_APPROVAL", "AWAITING_EXECUTION");
  const plain = row("PENDING", null);

  it("거르개 차례가 상태 여덟에 「실행 대기」 하나를 더한 것이다 — 빠지거나 겹치지 않는다", () => {
    assert.deepEqual([...REQUEST_STATUS_FILTER_ORDER].sort(), [...REQUEST_STATUSES, AWAITING_EXECUTION_FILTER].sort());
    assert.equal(new Set(REQUEST_STATUS_FILTER_ORDER).size, REQUEST_STATUS_FILTER_ORDER.length);
  });

  it("🔵 「실행 대기」는 「결재 중」 바로 뒤에 선다 — 갈라야 하는 둘이 나란히 보여야 한다", () => {
    const i = REQUEST_STATUS_FILTER_ORDER.indexOf("IN_APPROVAL");
    assert.ok(i >= 0, "「결재 중」이 거르개에서 사라졌다");
    assert.equal(REQUEST_STATUS_FILTER_ORDER[i + 1], AWAITING_EXECUTION_FILTER);
  });

  it("🔴 고르개 글자가 [상태] 칸의 글자와 같다 — 다르면 사람이 같은 것인 줄 모른다", () => {
    for (const s of REQUEST_STATUSES) assert.equal(requestStatusFilterLabel(s), requestStatusLabel(s, false, null), s);
    assert.equal(requestStatusFilterLabel(AWAITING_EXECUTION_FILTER), requestStatusLabel("IN_APPROVAL", false, "AWAITING_EXECUTION"));
  });

  it("🔴 「결재 중」으로 거르면 **실행 대기 줄이 안 섞인다**", () => {
    assert.equal(requestMatchesStatusFilter("IN_APPROVAL", inApproval), true);
    assert.equal(requestMatchesStatusFilter("IN_APPROVAL", awaiting), false, "실행 대기 줄이 「결재 중」에 섞였다");
  });

  it("🔴 「실행 대기」로 거르면 **결재 중 줄이 안 섞인다**", () => {
    assert.equal(requestMatchesStatusFilter(AWAITING_EXECUTION_FILTER, awaiting), true);
    assert.equal(requestMatchesStatusFilter(AWAITING_EXECUTION_FILTER, inApproval), false, "결재 중 줄이 「실행 대기」에 섞였다");
    assert.equal(requestMatchesStatusFilter(AWAITING_EXECUTION_FILTER, plain), false);
  });

  it("🔴 이 조각 전에 올라간 건(상태는 PENDING)도 「대기」가 아니라 「실행 대기」로 걸린다 — 목록의 글자와 같다", () => {
    const legacy = row("PENDING", "AWAITING_EXECUTION");
    assert.equal(requestMatchesStatusFilter("PENDING", legacy), false);
    assert.equal(requestMatchesStatusFilter(AWAITING_EXECUTION_FILTER, legacy), true);
  });

  it("「전체 상태」는 무엇이든 받는다", () => {
    for (const r of [inApproval, awaiting, plain]) assert.equal(requestMatchesStatusFilter("ALL", r), true);
  });

  it("🔵 결재가 없는 줄은 지금까지와 똑같이 **제 상태 칸에서만** 나온다", () => {
    for (const s of REQUEST_STATUSES) {
      const r = row(s, null);
      assert.equal(requestMatchesStatusFilter(s, r), true, s);
      assert.equal(requestMatchesStatusFilter(AWAITING_EXECUTION_FILTER, r), false, s);
      for (const other of REQUEST_STATUSES) if (other !== s) assert.equal(requestMatchesStatusFilter(other, r), false, `${s} → ${other}`);
    }
  });
});
