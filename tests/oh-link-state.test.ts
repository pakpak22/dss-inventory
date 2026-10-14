import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  describeOhPartLink,
  ohPartOptionLabel,
  OH_PART_LINK_LABELS,
  type OhPartLinkOption,
} from "../src/lib/oh/link-state";
import { resolvePartLinkId } from "../src/lib/oh/name-match";

/**
 * ============================================================================
 * 줄 하나의 재고 연결 상태 (2026-10-15, 조각 8b)
 * ============================================================================
 * O/H 템플릿 화면이 줄마다 무엇을 보여 줄지 정하는 판정이다. 그 화면은 서버 액션을 물고 있어
 * 렌더 시험이 붙지 않으므로, 틀리면 조용히 넘어갈 판정을 여기서 덮는다.
 *
 * 특히 **`MISMATCHED`**(이은 뒤 재고 쪽 품명이 바뀜)는 화면에서는 만들어지지 않고 DB 에서만
 * 온다 — 사람이 손으로 재현하기 어려운 상태라 시험이 유일한 그물이다.
 *
 * DB 에도 망에도 붙지 않는다 — 전부 순수 함수다.
 * ============================================================================
 */

const PCB: OhPartLinkOption = { id: "11111111-1111-4111-8111-111111111111", no: 1, name: "PCB ASSY", name2: "RF-100" };
const FUSE_A: OhPartLinkOption = { id: "22222222-2222-4222-8222-222222222222", no: 7, name: "FUSE", name2: "5A" };
const FUSE_B: OhPartLinkOption = { id: "33333333-3333-4333-8333-333333333333", no: 9, name: "FUSE", name2: "10A" };
const NO_SPEC: OhPartLinkOption = { id: "44444444-4444-4444-8444-444444444444", no: 12, name: "O-RING", name2: "" };

const OPTIONS = [PCB, FUSE_A, FUSE_B, NO_SPEC];

describe("줄 하나의 재고 연결 상태 (describeOhPartLink)", () => {
  test("비었음 — 품명이 비면 아직 아무것도 아니다", () => {
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "" }, OPTIONS), { kind: "EMPTY" });
    // 공백만 친 것도 비운 것이다 — 저장할 때 걸러지는 줄과 같은 잣대여야 한다.
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "   " }, OPTIONS), { kind: "EMPTY" });
    // 🔴 연결이 남아 있어도 품명이 비면 비었음이다. 품명 칸이 그 줄의 뜻이다.
    assert.deepEqual(describeOhPartLink({ partId: PCB.id, partNameText: "" }, OPTIONS), { kind: "EMPTY" });
  });

  test("재고 미연결 — 마스터에 없는 이름. 오류가 아니라 정상이다", () => {
    const state = describeOhPartLink({ partId: null, partNameText: "특수 가스켓" }, OPTIONS);
    assert.deepEqual(state, { kind: "UNLINKED", ambiguous: [] });
  });

  test("재고 미연결 — 같은 품명이 여럿이면 고를 것을 들려 보낸다", () => {
    const state = describeOhPartLink({ partId: null, partNameText: "FUSE" }, OPTIONS);
    assert.equal(state.kind, "UNLINKED");
    if (state.kind !== "UNLINKED") return;
    assert.deepEqual(
      state.ambiguous.map((option) => option.no),
      [7, 9],
    );
  });

  test("재고 미연결 — 일치가 하나뿐이면 고를 것을 들려 보내지 않는다", () => {
    // 이름이 하나로 정해지는 줄은 `resolvePartLinkId` 가 이미 이어 버린다. 그래도 저장된 줄로
    // 들어올 수 있으므로 상태는 돌려주되, 고르게 할 것은 없다.
    const state = describeOhPartLink({ partId: null, partNameText: "PCB ASSY" }, OPTIONS);
    assert.deepEqual(state, { kind: "UNLINKED", ambiguous: [] });
  });

  test("이어짐 — 연결된 부품의 품명과 적힌 글자가 같다", () => {
    const state = describeOhPartLink({ partId: PCB.id, partNameText: "PCB ASSY" }, OPTIONS);
    assert.deepEqual(state, { kind: "LINKED", part: PCB });
  });

  test("이어짐 — 공백·대소문자만 다른 것은 같은 이름이다", () => {
    const state = describeOhPartLink({ partId: PCB.id, partNameText: "  pcb   assy " }, OPTIONS);
    assert.equal(state.kind, "LINKED");
  });

  test("🔴 달라짐 — 이은 뒤 재고 쪽 품명이 바뀌면 그 줄을 짚어 준다", () => {
    // 저장된 글자는 `PCB ASSY (구형)`, 지금 재고의 품명은 `PCB ASSY` 다.
    const state = describeOhPartLink({ partId: PCB.id, partNameText: "PCB ASSY (구형)" }, OPTIONS);
    assert.deepEqual(state, { kind: "MISMATCHED", part: PCB });
  });

  test("🔴 달라짐은 화면이 만들지 않는다 — 품명을 고치면 연결이 먼저 풀린다", () => {
    // 같은 글자를 화면에서 쳤다면 `resolvePartLinkId` 가 연결을 풀어 UNLINKED 가 된다.
    const next = resolvePartLinkId("PCB ASSY (구형)", PCB.id, OPTIONS);
    assert.equal(next, null);
    assert.deepEqual(describeOhPartLink({ partId: next, partNameText: "PCB ASSY (구형)" }, OPTIONS), {
      kind: "UNLINKED",
      ambiguous: [],
    });
  });

  test("찾을 수 없음 — 이어 둔 부품이 지워졌다", () => {
    const state = describeOhPartLink(
      { partId: "99999999-9999-4999-8999-999999999999", partNameText: "PCB ASSY" },
      OPTIONS,
    );
    assert.deepEqual(state, { kind: "MISSING" });
  });

  test("후보가 하나도 없어도 터지지 않는다", () => {
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "PCB ASSY" }, []), {
      kind: "UNLINKED",
      ambiguous: [],
    });
    assert.deepEqual(describeOhPartLink({ partId: PCB.id, partNameText: "PCB ASSY" }, []), { kind: "MISSING" });
  });
});

describe("고를 때 보이는 줄 (ohPartOptionLabel)", () => {
  test("No. 가 앞에 오고 품명2가 뒤에 붙는다", () => {
    assert.equal(ohPartOptionLabel(FUSE_A), "No. 7 · FUSE — 5A");
  });

  test("품명2가 비면 No. 와 품명만", () => {
    assert.equal(ohPartOptionLabel(NO_SPEC), "No. 12 · O-RING");
  });

  test("같은 품명이라도 No. 가 둘을 가른다", () => {
    assert.notEqual(ohPartOptionLabel(FUSE_A), ohPartOptionLabel(FUSE_B));
  });
});

describe("상태 글자", () => {
  test("목록 화면과 같은 말을 쓴다 — 새 용어를 만들지 않는다", () => {
    assert.equal(OH_PART_LINK_LABELS.UNLINKED, "재고 미연결");
    assert.equal(OH_PART_LINK_LABELS.LINKED, "재고 연결됨");
    assert.equal(OH_PART_LINK_LABELS.MISMATCHED, "연결된 재고와 품명이 다름");
    assert.equal(OH_PART_LINK_LABELS.MISSING, "연결된 재고를 찾을 수 없음");
  });
});
