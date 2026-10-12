import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, PART_FIELD_LABEL, describeTarget, isAuditAction } from "../src/lib/audit-labels";
import { PART_FORM_FIELDS } from "../src/lib/parts/form";

describe("변경 이력 글자표", () => {
  it("모든 행위에 한글 이름이 있고 영문 코드가 그대로 나가지 않는다", () => {
    for (const a of AUDIT_ACTIONS) {
      const label = AUDIT_ACTION_LABEL[a];
      assert.ok(label);
      assert.notEqual(label, a);
    }
  });

  it("폼의 모든 칸에 한글 이름이 있다 (수정 앞·뒤 값 표시용)", () => {
    for (const f of PART_FORM_FIELDS) {
      if (f === "itemId") continue; // 감사 로그에는 itemCode 로 남는다
      assert.ok(PART_FIELD_LABEL[f], f);
    }
    assert.ok(PART_FIELD_LABEL.itemCode);
  });

  it("isAuditAction 은 모르는 값을 거른다", () => {
    assert.equal(isAuditAction("PART_CREATE"), true);
    assert.equal(isAuditAction("DROP_TABLE"), false);
    assert.equal(isAuditAction(null), false);
  });

  it("대상 글자", () => {
    assert.equal(describeTarget("parts:No.165"), "부품 No. 165");
    assert.equal(describeTarget("users:abc"), "사용자");
    assert.equal(describeTarget("part_items:PCB"), "항목 PCB");
    assert.equal(describeTarget("entries:USE-2026-84"), "기록 사용 US-2026-84");
    assert.equal(describeTarget("something:else"), "something:else");
    assert.equal(describeTarget(null), "");
  });
});
