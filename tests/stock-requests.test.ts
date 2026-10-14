import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REQUEST_STATUSES } from "../src/db/schema/stock-requests";
import { CONFIRMATION_TYPES, DECIDED_REQUEST_STATUSES, ENTRY_TYPES, PENDING_REQUEST_STATUSES, needsConfirmation } from "../src/lib/stock/codes";

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
    assert.deepEqual([...PENDING_REQUEST_STATUSES].sort(), ["CONFIRMING", "PARTIAL", "PENDING"]);
    assert.deepEqual([...DECIDED_REQUEST_STATUSES].sort(), ["CANCELLED", "CONFIRMED", "REJECTED"]);
  });

  it("두 묶음이 모든 상태를 빠짐없이, 겹치지 않게 덮는다", () => {
    const counted = [...PENDING_REQUEST_STATUSES, ...DECIDED_REQUEST_STATUSES];
    assert.deepEqual(counted.slice().sort(), [...REQUEST_STATUSES].sort(), "상태를 더했으면 둘 중 한 묶음에도 넣어야 한다");
    assert.equal(new Set(counted).size, counted.length, "한 상태가 양쪽에 들어가면 같은 신청이 두 목록에 보인다");
  });
});
