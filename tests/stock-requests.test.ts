import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REQUEST_STATUSES } from "../src/db/schema/stock-requests";
import {
  ACTIONABLE_REQUEST_STATUSES,
  CLAIMABLE_REQUEST_STATUSES,
  CONFIRMATION_TYPES,
  DECIDED_REQUEST_STATUSES,
  ENTRY_TYPES,
  PENDING_REQUEST_STATUSES,
  isClaimableRequest,
  isClosedRequest,
  needsConfirmation,
} from "../src/lib/stock/codes";

describe("담당자 확인 단계 (2026-10-06)", () => {
  it("반출 계열(사용·대여·폐기)만 확인을 거친다", () => {
    assert.deepEqual([...CONFIRMATION_TYPES].sort(), ["DISPOSE", "LOAN", "USE"]);
  });

  it("기록 권한자가 적으면 대기, 관리자가 적으면 바로", () => {
    assert.equal(needsConfirmation("USE", false), true);
    assert.equal(needsConfirmation("LOAN", false), true);
    assert.equal(needsConfirmation("DISPOSE", false), true);
    assert.equal(needsConfirmation("USE", true), false);
  });

  it("입고·반환·조정·소유 옮김·처음 수량·기록 취소는 확인을 거치지 않는다", () => {
    for (const t of ENTRY_TYPES) {
      if (CONFIRMATION_TYPES.has(t)) continue;
      assert.equal(needsConfirmation(t, false), false, t);
    }
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

  it("처리 중(CONFIRMING)도 대기, 확인·반려·취소는 결정된 것", () => {
    assert.deepEqual([...PENDING_REQUEST_STATUSES].sort(), ["CONFIRMING", "ON_HOLD", "PARTIAL", "PENDING"]);
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
    assert.ok(ACTIONABLE_REQUEST_STATUSES.length < PENDING_REQUEST_STATUSES.length, "보류 하나만큼 좁다");
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
