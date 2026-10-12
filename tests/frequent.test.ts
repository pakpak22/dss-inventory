import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampMin, clampMonths, frequentValues, monthMinus, type MonthlyUsage } from "../src/lib/parts/frequent";

describe("자주 사용하는 부품 기준 (frequent.ts, 2026-10-07)", () => {
  it("달 빼기", () => {
    assert.equal(monthMinus("2026-10", 0), "2026-10");
    assert.equal(monthMinus("2026-10", 11), "2025-11");
    assert.equal(monthMinus("2026-01", 1), "2025-12");
    assert.equal(monthMinus("2026-10", 35), "2023-11");
  });
  it("막대 값은 2~36 짝수, 기준은 1 이상 정수", () => {
    assert.equal(clampMonths(7), 8);
    assert.equal(clampMonths(0), 2);
    assert.equal(clampMonths(99), 36);
    assert.equal(clampMonths(Number.NaN), 12);
    assert.equal(clampMin(0), 1);
    assert.equal(clampMin(2.7), 2);
    assert.equal(clampMin(Number.NaN), 3);
  });
  it("횟수/수량 · 기간 · 기준으로 걸러 값과 함께", () => {
    const usage: MonthlyUsage = {
      a: { "2026-10": [2, 10], "2026-09": [1, 1], "2025-10": [5, 50] },
      b: { "2026-03": [1, 100] },
      c: { "2024-01": [9, 9] },
    };
    // 이번 달 포함 12개월 = 2025-11 ~ 2026-10 → a: 3건/11개, b: 1건/100개, c: 없음
    assert.deepEqual([...frequentValues(usage, { mode: "n", months: 12, min: 3 }, "2026-10")], [["a", 3]]);
    // 수량 모드는 기준(min)을 무시한다 — 기간 안에 쓴 부품이 전부, 값과 함께
    assert.deepEqual([...frequentValues(usage, { mode: "q", months: 12, min: 50 }, "2026-10")].sort(), [
      ["a", 11],
      ["b", 100],
    ]);
    // 2개월 = 2026-09~10 → a 만 3건
    assert.deepEqual([...frequentValues(usage, { mode: "n", months: 2, min: 3 }, "2026-10")], [["a", 3]]);
    // 36개월이면 2023-11 부터 → c(2024-01) 도 들어오고 a 는 2025-10 까지 더해 8건
    const all = frequentValues(usage, { mode: "n", months: 36, min: 1 }, "2026-10");
    assert.deepEqual([...all].sort(), [
      ["a", 8],
      ["b", 1],
      ["c", 9],
    ]);
  });
});
