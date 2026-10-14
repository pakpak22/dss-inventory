import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { shouldCreateNewVersion, validateApprovalRouteInput } from "../src/lib/approval/input";
import { MAX_APPROVAL_ROUTE_STEPS } from "../src/lib/approval/route";

/**
 * ============================================================================
 * 승인 절차 저장 입력 검증 + 「바뀐 게 없으면 새 판을 만들지 않는다」 (조각 ③b)
 * ============================================================================
 * 서버 액션은 **네트워크 경계 너머**에서 불린다 — 타입은 그 경계에서 아무것도 막지 못한다.
 * 그래서 여기서 못 박는 것 둘:
 *
 *  1. **허용되지 않은 용도는 거절한다. 기본값으로 채워 주지 않는다.** 「없으면 부품 불출」로
 *     채우면 용도를 빠뜨린 요청이 조용히 어떤 절차를 덮어쓴다.
 *  2. **판은 지우지 않으므로(append-only) 똑같은 판을 또 얹지 않는다.** 안 걸면 [저장] 을
 *     누를 때마다 쓰레기 판이 쌓여 「누가 언제 결재선을 바꿨나」가 잡음에 묻힌다.
 *
 * DB 에도 망에도 붙지 않는다.
 * ============================================================================
 */

const 가 = "11111111-1111-4111-8111-111111111111";
const 나 = "22222222-2222-4222-8222-222222222222";

describe("저장 입력 검증 — 용도", () => {
  test("허용된 용도는 통과한다", () => {
    const r = validateApprovalRouteInput({ scope: "PART_ISSUE", approverUserIds: [가] });
    assert.ok(r.ok);
    assert.equal(r.scope, "PART_ISSUE");
    assert.deepEqual(r.approverUserIds, [가]);
  });

  test("🔴 용도가 없으면 거절한다 — 기본값으로 채우지 않는다", () => {
    const r = validateApprovalRouteInput({ approverUserIds: [] });
    assert.ok(!r.ok);
    assert.equal(r.code, "INVALID_INPUT");
    // 「없으면 부품 불출」로 채웠다면 ok 가 돼 있었을 것이다.
    assert.ok(r.message.includes("어떤 승인 절차"), r.message);
  });

  test("🔴 모르는 용도도 거절한다 — 표의 enum 까지 가면 「알 수 없는 오류」가 된다", () => {
    for (const scope of ["FINAL_SHIPMENT", "part_issue", "", null, 7, {}]) {
      const r = validateApprovalRouteInput({ scope, approverUserIds: [] });
      assert.ok(!r.ok, String(scope));
    }
  });

  test("요청 자체가 모양이 아니면 거절한다", () => {
    for (const input of [null, "scope=PART_ISSUE", [], 7]) {
      assert.ok(!validateApprovalRouteInput(input).ok, String(input));
    }
  });
});

describe("저장 입력 검증 — 승인자 목록", () => {
  test("🔴 빈 배열은 정상이다 — 절차를 끄는 유일한 출구다", () => {
    const r = validateApprovalRouteInput({ scope: "PART_ISSUE", approverUserIds: [] });
    assert.ok(r.ok);
    assert.deepEqual(r.approverUserIds, []);
  });

  test("배열이 아니면 거절한다", () => {
    assert.ok(!validateApprovalRouteInput({ scope: "PART_ISSUE", approverUserIds: 가 }).ok);
    assert.ok(!validateApprovalRouteInput({ scope: "PART_ISSUE" }).ok);
  });

  test("값이 들어 있는데 uuid 형식이 아니면 거절한다 (손으로 만든 요청이다)", () => {
    const r = validateApprovalRouteInput({ scope: "PART_ISSUE", approverUserIds: [가, "1; drop"] });
    assert.ok(!r.ok);
    assert.equal(r.code, "INVALID_INPUT");
    assert.ok(r.message.includes("2번째 단계"), r.message);
  });

  test("아직 안 고른 빈 자리는 「형식이 아니다」가 아니라 「골라 주세요」로 말한다", () => {
    const r = validateApprovalRouteInput({ scope: "PART_ISSUE", approverUserIds: [가, "  "] });
    assert.ok(!r.ok);
    assert.equal(r.code, "MISSING_APPROVER");
    assert.ok(r.message.includes("선택"), r.message);
  });

  test("같은 사람이 두 번이면 거절한다", () => {
    const r = validateApprovalRouteInput({ scope: "PART_ISSUE", approverUserIds: [가, 나, 가] });
    assert.ok(!r.ok);
    assert.equal(r.code, "DUPLICATE_APPROVER");
  });

  test("상한을 넘으면 거절한다", () => {
    const many = Array.from({ length: MAX_APPROVAL_ROUTE_STEPS + 1 }, (_, i) =>
      `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    const r = validateApprovalRouteInput({ scope: "PART_ISSUE", approverUserIds: many });
    assert.ok(!r.ok);
    assert.equal(r.code, "TOO_MANY_STEPS");
  });

  test("받은 배열을 그대로 돌려주지 않는다 (새 배열)", () => {
    const ids = [가];
    const r = validateApprovalRouteInput({ scope: "PART_ISSUE", approverUserIds: ids });
    assert.ok(r.ok);
    assert.notEqual(r.approverUserIds, ids);
    assert.deepEqual(r.approverUserIds, ids);
  });
});

describe("바뀐 게 없으면 새 판을 만들지 않는다", () => {
  test("그대로면 만들지 않는다", () => {
    assert.equal(shouldCreateNewVersion([가, 나], [가, 나]), false);
    assert.equal(shouldCreateNewVersion([], []), false);
  });

  test("🔴 순서만 달라도 다른 절차다 — 누가 먼저 보느냐가 결재선의 뜻이다", () => {
    assert.equal(shouldCreateNewVersion([가, 나], [나, 가]), true);
  });

  test("사람이 늘거나 줄면 만든다", () => {
    assert.equal(shouldCreateNewVersion([가], [가, 나]), true);
    assert.equal(shouldCreateNewVersion([가, 나], [가]), true);
    assert.equal(shouldCreateNewVersion([가], []), true);
  });

  test("🔴 판이 하나도 없으면 0개짜리라도 만든다 — 「쓰지 않기로 했다」를 처음 기록하는 일이다", () => {
    assert.equal(shouldCreateNewVersion(null, []), true);
    assert.equal(shouldCreateNewVersion(null, [가]), true);
  });
});
