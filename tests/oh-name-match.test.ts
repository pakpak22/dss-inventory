import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isExactNormalizedMatch, normalizeEntityName } from "../src/lib/oh/name-match";

/**
 * ============================================================================
 * 이름 맞추기 (2026-10-15, 조각 8a)
 * ============================================================================
 * A/S 의 `src/lib/domain/entity-name-match.test.ts` 를 그대로 옮긴 것이다 — **동작이 그쪽과
 * 글자 하나까지 같아야** 나중에 A/S 의 값을 옮겨 올 때 연결이 어긋나지 않는다.
 *
 * 🔵 **조각 9b(2026-10-15)에서 묶음 둘이 빠졌다**(`rankSimilarNames` · `resolvePartLinkId`).
 * 품명 칸이 `<input list>` 에서 **고르개**로 바뀌면서 두 함수가 할 일이 없어져 지웠다 — 까닭은
 * `src/lib/oh/name-match.ts` 머리말에. 지금 그 자리의 규칙은 `tests/oh-link-state.test.ts` 가 덮는다.
 *
 * DB 에도 망에도 붙지 않는다 — 전부 순수 함수다.
 * ============================================================================
 */

describe("정규화 — 앞뒤 공백·가운데 공백·대소문자", () => {
  test("앞뒤를 떼고 가운데 공백을 한 칸으로 줄이고 소문자로", () => {
    assert.equal(normalizeEntityName("  Acme   Co  "), "acme co");
    assert.equal(normalizeEntityName("ACME CO"), "acme co");
    assert.equal(normalizeEntityName("acme co"), "acme co");
  });

  test("공백·대소문자만 다른 이름은 같은 이름이다", () => {
    assert.equal(isExactNormalizedMatch("Acme Co", "  acme   co "), true);
    assert.equal(isExactNormalizedMatch("Acme Co", "Acme Corp"), false);
  });
});
