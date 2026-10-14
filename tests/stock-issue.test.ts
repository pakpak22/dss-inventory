import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EntryInput } from "../src/lib/stock/form";
import { buildIssueInput, parseIssueQuantities } from "../src/lib/stock/issue";

/**
 * 일부 수량만 내주기 (2026-10-14, 조각 4b). 🔴 원장으로 가는 입력을 만드는 **유일한** 함수라
 * 경계(요청보다 많이·남은 것보다 많이·0 줄·둘째 회차)를 DB 없이 전부 돌려 본다.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const NAMES = new Map([
  [A, { no: 1, name: "예시 PCB" }],
  [B, { no: 2, name: "예시 센서" }],
]);

function use(lines: Array<{ partId: string; quantity: number; actualQuantity?: number | null }>): EntryInput {
  return {
    type: "USE",
    occurredOn: "2026-10-14",
    intakeNumber: "D261014",
    noRepairCase: false,
    reason: "",
    purpose: "REPAIR",
    purposeText: "",
    note: "신청 비고",
    lines: lines.map((l) => ({ partId: l.partId, quantity: l.quantity, chargeType: "FREE" as const, note: "줄 비고", actualQuantity: l.actualQuantity ?? null })),
  };
}

function loan(lines: Array<{ partId: string; quantity: number }>): EntryInput {
  return { type: "LOAN", occurredOn: "2026-10-14", counterparty: "협력사", note: "", lines: lines.map((l) => ({ ...l, note: "" })) };
}

function linesOf(input: EntryInput | null): Array<{ partId: string; quantity: number }> {
  assert.ok(input && (input.type === "USE" || input.type === "LOAN" || input.type === "DISPOSE"));
  return input.lines.map((l) => ({ partId: l.partId, quantity: l.quantity }));
}

describe("buildIssueInput — 요청 + 이번에 줄 수량 → 원장 입력", () => {
  it("수량을 안 주면 요청 전부가 그대로 간다 (지금까지의 동작)", () => {
    const payload = use([
      { partId: A, quantity: 3 },
      { partId: B, quantity: 2 },
    ]);
    const r = buildIssueInput(payload, null, new Map(), NAMES);
    assert.ok(r.ok);
    assert.deepEqual(r.plan.input, payload); // 머리 칸(인수번호·목적·비고)과 줄 칸이 하나도 안 바뀐다
    assert.equal(r.plan.remaining, 0);
    assert.equal(r.plan.issuing, 5);
  });

  it("일부만 주면 그 수량으로 바뀌고 남은 것이 센다", () => {
    const payload = use([
      { partId: A, quantity: 3 },
      { partId: B, quantity: 2 },
    ]);
    const r = buildIssueInput(payload, new Map([[A, 1]]), new Map(), NAMES);
    assert.ok(r.ok);
    assert.deepEqual(linesOf(r.plan.input), [{ partId: A, quantity: 1 }]); // 🔴 0 인 줄(B)은 빠진다
    assert.equal(r.plan.issuing, 1);
    assert.equal(r.plan.remaining, 4); // A 2 + B 2
  });

  it("줄 칸(유상·무상, 줄 비고)은 그대로 실린다", () => {
    const r = buildIssueInput(use([{ partId: A, quantity: 3 }]), new Map([[A, 2]]), new Map(), NAMES);
    assert.ok(r.ok && r.plan.input?.type === "USE");
    assert.deepEqual(r.plan.input.lines[0], { partId: A, quantity: 2, chargeType: "FREE", note: "줄 비고", actualQuantity: null });
  });

  it("전부 0 이면 원장에 아무것도 안 쓴다", () => {
    const r = buildIssueInput(use([{ partId: A, quantity: 3 }]), new Map([[A, 0]]), new Map(), NAMES);
    assert.ok(r.ok);
    assert.equal(r.plan.input, null);
    assert.equal(r.plan.issuing, 0);
    assert.equal(r.plan.remaining, 3);
  });

  it("수량을 안 적은 부품은 이번에 안 준다", () => {
    const r = buildIssueInput(
      use([
        { partId: A, quantity: 3 },
        { partId: B, quantity: 2 },
      ]),
      new Map([[B, 2]]),
      new Map(),
      NAMES,
    );
    assert.ok(r.ok);
    assert.deepEqual(linesOf(r.plan.input), [{ partId: B, quantity: 2 }]);
    assert.equal(r.plan.remaining, 3);
  });

  it("🔴 요청 수량보다 많이 주려 하면 거절", () => {
    const r = buildIssueInput(use([{ partId: A, quantity: 3 }]), new Map([[A, 4]]), new Map(), NAMES);
    assert.ok(!r.ok);
    assert.match(r.message, /No\. 1 예시 PCB/);
    assert.match(r.message, /요청 수량은 3개/);
  });

  it("🔴 이미 나간 것을 빼고 남은 것보다 많이 주려 해도 거절", () => {
    const r = buildIssueInput(use([{ partId: A, quantity: 5 }]), new Map([[A, 3]]), new Map([[A, 3]]), NAMES);
    assert.ok(!r.ok);
    assert.match(r.message, /3개가 이미 나갔습니다/);
    assert.match(r.message, /남은 2개/);
  });

  it("남은 만큼이면 받아들이고, 그것으로 요청이 끝난다", () => {
    const r = buildIssueInput(use([{ partId: A, quantity: 5 }]), new Map([[A, 2]]), new Map([[A, 3]]), NAMES);
    assert.ok(r.ok);
    assert.deepEqual(linesOf(r.plan.input), [{ partId: A, quantity: 2 }]);
    assert.equal(r.plan.remaining, 0);
  });

  it("수량을 안 주면 「남은 전부」다 (다음 회차)", () => {
    const r = buildIssueInput(
      use([
        { partId: A, quantity: 5 },
        { partId: B, quantity: 2 },
      ]),
      null,
      new Map([[A, 3]]),
      NAMES,
    );
    assert.ok(r.ok);
    assert.deepEqual(linesOf(r.plan.input), [
      { partId: A, quantity: 2 },
      { partId: B, quantity: 2 },
    ]);
    assert.equal(r.plan.remaining, 0);
  });

  it("요청에 없는 부품은 거절", () => {
    const r = buildIssueInput(use([{ partId: A, quantity: 3 }]), new Map([[C, 1]]), new Map(), NAMES);
    assert.ok(!r.ok);
    assert.match(r.message, /요청에 없는 부품/);
  });

  it("정수가 아니거나 음수인 수량은 거절", () => {
    for (const bad of [1.5, -1, Number.NaN]) {
      const r = buildIssueInput(use([{ partId: A, quantity: 3 }]), new Map([[A, bad]]), new Map(), NAMES);
      assert.ok(!r.ok, String(bad));
      assert.match(r.message, /0 이상의 정수/);
    }
  });

  it("🔴 「실제 수량이 다릅니다」는 그 부품이 처음 나갈 때만 실린다 (둘째 회차에 또 실으면 재고가 부푼다)", () => {
    const payload = use([
      { partId: A, quantity: 5, actualQuantity: 4 },
      { partId: B, quantity: 2, actualQuantity: 9 },
    ]);
    const first = buildIssueInput(payload, new Map([[A, 2]]), new Map(), NAMES);
    assert.ok(first.ok && first.plan.input?.type === "USE");
    assert.equal(first.plan.input.lines[0].actualQuantity, 4);

    const second = buildIssueInput(payload, new Map([[A, 3], [B, 2]]), new Map([[A, 2]]), NAMES);
    assert.ok(second.ok && second.plan.input?.type === "USE");
    assert.equal(second.plan.input.lines[0].actualQuantity, null, "이미 나간 A 는 다시 맞추지 않는다");
    assert.equal(second.plan.input.lines[1].actualQuantity, 9, "아직 안 나간 B 는 처음이라 그대로");
  });

  it("대여·폐기도 같은 길로 간다", () => {
    const r = buildIssueInput(loan([{ partId: A, quantity: 4 }]), new Map([[A, 1]]), new Map(), NAMES);
    assert.ok(r.ok && r.plan.input?.type === "LOAN");
    assert.equal(r.plan.input.counterparty, "협력사");
    assert.deepEqual(linesOf(r.plan.input), [{ partId: A, quantity: 1 }]);
    assert.equal(r.plan.remaining, 3);
  });

  it("줄이 없는 종류(조정)는 지금까지 하던 대로 통째로 넘긴다", () => {
    const adjust: EntryInput = { type: "ADJUST", occurredOn: "2026-10-14", reason: "실물 점검", note: "", partId: A, actualQuantity: 7 };
    const r = buildIssueInput(adjust, null, new Map(), NAMES);
    assert.ok(r.ok);
    assert.deepEqual(r.plan.input, adjust);
    assert.equal(r.plan.remaining, 0);
  });

  it("이름을 못 찾아도 문구가 깨지지 않는다", () => {
    const r = buildIssueInput(use([{ partId: C, quantity: 1 }]), new Map([[C, 2]]), new Map(), NAMES);
    assert.ok(!r.ok);
    assert.match(r.message, /^고른 부품: /);
  });
});

describe("parseIssueQuantities — 화면이 보낼 줄별 수량 (조각 4d 가 쓸 자리)", () => {
  it("안 보내면 null = 남은 수량 전부 (지금 화면)", () => {
    for (const raw of [null, undefined, ""]) {
      const r = parseIssueQuantities(raw);
      assert.ok(r.ok);
      assert.equal(r.quantities, null);
    }
  });

  it("JSON 줄을 읽는다 (숫자 글자도)", () => {
    const r = parseIssueQuantities(JSON.stringify([{ partId: A, quantity: 2 }, { partId: B, quantity: "0" }]));
    assert.ok(r.ok);
    assert.deepEqual(r.quantities, [
      { partId: A, quantity: 2 },
      { partId: B, quantity: 0 },
    ]);
  });

  it("깨진 값·중복·음수·소수·50줄 초과는 거절", () => {
    const bad = [
      "{",
      JSON.stringify({ partId: A }),
      JSON.stringify([{ partId: A, quantity: -1 }]),
      JSON.stringify([{ partId: A, quantity: 1.5 }]),
      JSON.stringify([{ partId: "", quantity: 1 }]),
      JSON.stringify([
        { partId: A, quantity: 1 },
        { partId: A, quantity: 2 },
      ]),
      JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ partId: `p${i}`, quantity: 1 }))),
    ];
    for (const raw of bad) {
      const r = parseIssueQuantities(raw);
      assert.ok(!r.ok, raw.slice(0, 40));
      assert.match(r.message, /읽지 못했습니다/);
    }
  });
});
