import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIRMATION_TYPES, ENTRY_TYPES, needsConfirmation } from "../src/lib/stock/codes";

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
