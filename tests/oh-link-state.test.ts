import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  describeOhPartLink,
  ohPartOptionLabel,
  OH_PART_LINK_LABELS,
  type OhPartLinkOption,
} from "../src/lib/oh/link-state";

/**
 * ============================================================================
 * 줄 하나의 재고 연결 상태 (2026-10-15, 조각 8b → 9b 에서 다시 씀)
 * ============================================================================
 * O/H 템플릿 화면이 줄마다 무엇을 보여 줄지 정하는 판정이다. 그 화면은 서버 액션을 물고 있어
 * 렌더 시험이 붙지 않으므로, 틀리면 조용히 넘어갈 판정을 여기서 덮는다.
 *
 * 🔴 **조각 9b(2026-10-15)에서 재는 상대가 바뀌었다.** 이어진 줄의 품명은 그 부품의 **고객사
 * 품명**(`parts.customer_name`)이다 — 우리 품명이 아니다. 그래서 묶음 둘이 이 조각의 요점이다:
 *
 *  · **`NO_CUSTOMER_NAME`** — 이었는데 고객사 품명이 비었다. 품명이 **빈 글자로 저장되고**
 *    견적서의 품명 칸이 비어 나간다. 우리 품명으로 대신 채우지 않는다(사용자 결정).
 *  · **`MISMATCHED`** — 이은 뒤 재고 쪽 고객사 품명이 바뀌었다. 화면에서는 만들어지지 않고
 *    DB 에서만 온다(품명을 손으로 고치는 길이 없다) — 사람이 손으로 재현하기 어려운 상태라
 *    시험이 유일한 그물이다.
 *
 * DB 에도 망에도 붙지 않는다 — 전부 순수 함수다.
 * ============================================================================
 */

function option(fields: Partial<OhPartLinkOption> & { id: string; no: number; name: string }): OhPartLinkOption {
  return {
    name2: "",
    customerName: "",
    drawingNo: "",
    kyosanPartNo: "",
    quotePrice: null,
    ...fields,
  };
}

const PCB = option({
  id: "11111111-1111-4111-8111-111111111111",
  no: 1,
  name: "PCB ASSY",
  name2: "RF-100",
  customerName: "PCB UNIT",
});
const FUSE_A = option({ id: "22222222-2222-4222-8222-222222222222", no: 7, name: "FUSE", name2: "5A", customerName: "FUSE 5A" });
/** 🔴 고객사 품명이 **아직 없는** 부품. 실제 자료에 많다(2026-10-14 에 칸이 생겼다). */
const NO_CUSTOMER = option({ id: "33333333-3333-4333-8333-333333333333", no: 9, name: "FUSE", name2: "10A" });
const NO_SPEC = option({ id: "44444444-4444-4444-8444-444444444444", no: 12, name: "O-RING", customerName: "O RING" });

const OPTIONS = [PCB, FUSE_A, NO_CUSTOMER, NO_SPEC];

describe("줄 하나의 재고 연결 상태 (describeOhPartLink)", () => {
  test("비었음 — 연결도 없고 품명도 비면 아직 아무것도 아니다", () => {
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "" }, OPTIONS), { kind: "EMPTY" });
    // 공백만 친 것도 비운 것이다 — 저장할 때 걸러지는 줄과 같은 잣대여야 한다.
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "   " }, OPTIONS), { kind: "EMPTY" });
  });

  test("재고 미연결 — 마스터에 없는 이름. 오류가 아니라 정상이다", () => {
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "특수 가스켓" }, OPTIONS), { kind: "UNLINKED" });
  });

  test("🔵 품명이 재고의 이름과 같아도 **저절로 이어지지 않는다** — 연결은 고를 때만 맺힌다", () => {
    // 조각 9b 전에는 이 줄이 이름 일치로 이어졌다. 지금은 고르개가 「골랐다」를 만든다.
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "PCB ASSY" }, OPTIONS), { kind: "UNLINKED" });
  });

  test("이어짐 — 적힌 글자가 지금 고객사 품명과 같다", () => {
    assert.deepEqual(describeOhPartLink({ partId: PCB.id, partNameText: "PCB UNIT" }, OPTIONS), {
      kind: "LINKED",
      part: PCB,
    });
  });

  test("이어짐 — 공백·대소문자만 다른 것은 같은 이름이다", () => {
    const state = describeOhPartLink({ partId: PCB.id, partNameText: "  pcb   unit " }, OPTIONS);
    assert.equal(state.kind, "LINKED");
  });

  test("🔴 고객사 품명 없음 — 이었는데 그 부품에 고객사 품명이 없다. 품명은 빈 글자로 간다", () => {
    assert.deepEqual(describeOhPartLink({ partId: NO_CUSTOMER.id, partNameText: "" }, OPTIONS), {
      kind: "NO_CUSTOMER_NAME",
      part: NO_CUSTOMER,
    });
  });

  test("🔴 고객사 품명 없음 — 이어진 줄의 빈 품명은 **비었음이 아니다**(그 줄은 저장된다)", () => {
    // 조각 9b 전에는 이 줄이 `EMPTY` 였고, 그대로 두면 저장할 때 **조용히 사라진다.**
    const state = describeOhPartLink({ partId: NO_CUSTOMER.id, partNameText: "   " }, OPTIONS);
    assert.equal(state.kind, "NO_CUSTOMER_NAME");
  });

  test("🔴 고객사 품명 없음이 어긋남보다 먼저다 — 할 일이 다르다", () => {
    // 전에 저장된 글자가 남아 있어도, 지금 고객사 품명이 비었으면 사람이 할 일은 「먼저 정하라」다.
    const state = describeOhPartLink({ partId: NO_CUSTOMER.id, partNameText: "옛날 이름" }, OPTIONS);
    assert.equal(state.kind, "NO_CUSTOMER_NAME");
  });

  test("🔴 달라짐 — 이은 뒤 재고 쪽 고객사 품명이 바뀌면 그 줄을 짚어 준다", () => {
    // 저장된 글자는 `PCB UNIT (구형)`, 지금 고객사 품명은 `PCB UNIT` 이다.
    assert.deepEqual(describeOhPartLink({ partId: PCB.id, partNameText: "PCB UNIT (구형)" }, OPTIONS), {
      kind: "MISMATCHED",
      part: PCB,
    });
  });

  test("🔴 우리 품명과 같아도 어긋남이다 — 견적서에 나가는 이름은 고객사 품명이다", () => {
    const state = describeOhPartLink({ partId: PCB.id, partNameText: "PCB ASSY" }, OPTIONS);
    assert.equal(state.kind, "MISMATCHED");
  });

  test("찾을 수 없음 — 이어 둔 부품이 지워졌다", () => {
    const state = describeOhPartLink(
      { partId: "99999999-9999-4999-8999-999999999999", partNameText: "PCB UNIT" },
      OPTIONS,
    );
    assert.deepEqual(state, { kind: "MISSING" });
  });

  test("후보가 하나도 없어도 터지지 않는다", () => {
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "PCB UNIT" }, []), { kind: "UNLINKED" });
    assert.deepEqual(describeOhPartLink({ partId: PCB.id, partNameText: "PCB UNIT" }, []), { kind: "MISSING" });
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
    assert.notEqual(ohPartOptionLabel(FUSE_A), ohPartOptionLabel(NO_CUSTOMER));
  });
});

describe("상태 글자", () => {
  test("목록 화면과 같은 말을 쓴다 — 새 용어를 만들지 않는다", () => {
    assert.equal(OH_PART_LINK_LABELS.UNLINKED, "재고 미연결");
    assert.equal(OH_PART_LINK_LABELS.LINKED, "재고 연결됨");
    assert.equal(OH_PART_LINK_LABELS.NO_CUSTOMER_NAME, "고객사 품명 없음");
    assert.equal(OH_PART_LINK_LABELS.MISMATCHED, "저장된 품명이 지금 고객사 품명과 다름");
    assert.equal(OH_PART_LINK_LABELS.MISSING, "연결된 재고를 찾을 수 없음");
  });
});
