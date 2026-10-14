import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isExactNormalizedMatch,
  normalizeEntityName,
  rankSimilarNames,
  resolvePartLinkId,
} from "../src/lib/oh/name-match";

/**
 * ============================================================================
 * 이름 맞추기 (2026-10-15, 조각 8a)
 * ============================================================================
 * 앞의 여섯은 A/S 의 `src/lib/domain/entity-name-match.test.ts` 를 그대로 옮긴 것이다 —
 * **동작이 그쪽과 글자 하나까지 같아야** 나중에 A/S 의 값을 옮겨 올 때 연결이 어긋나지 않는다.
 *
 * 마지막 묶음(`resolvePartLinkId`)이 이 조각의 요점이다: **품명이 어긋나면 재고 연결을 푼다.**
 * 연결을 만드는 유일한 몸짓이 이름 일치이므로, 지키는 잣대도 같아야 한다.
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

describe("비슷한 이름 줄 세우기", () => {
  test("정규화해서 똑같은 것이 맨 앞", () => {
    const candidates = [
      { id: "1", name: "Acme Corp" },
      { id: "2", name: "acme co" },
    ];
    assert.equal(rankSimilarNames("Acme Co", candidates)[0]?.id, "2");
  });

  test("앞머리가 같은 것이 가운데에 든 것보다 앞", () => {
    const candidates = [
      { id: "prefix", name: "Acme Electronics" },
      { id: "substring", name: "New Acme Group" },
    ];
    const result = rankSimilarNames("Acme", candidates);
    assert.equal(result[0]?.id, "prefix");
    assert.equal(result[1]?.id, "substring");
  });

  test("물음말을 아예 품지 않은 후보는 뺀다", () => {
    const candidates = [
      { id: "1", name: "Acme Corp" },
      { id: "2", name: "Globex Inc" },
    ];
    const result = rankSimilarNames("acme", candidates);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "1");
  });

  test("물음말이 비면 전부를 가나다순으로", () => {
    const candidates = [
      { id: "1", name: "Zeta" },
      { id: "2", name: "Alpha" },
    ];
    assert.deepEqual(
      rankSimilarNames("", candidates).map((c) => c.id),
      ["2", "1"],
    );
  });

  test("같은 층 안에서는 짧은 이름이 먼저", () => {
    const candidates = [
      { id: "long", name: "Acme Electronics Group" },
      { id: "short", name: "Acme Co" },
    ];
    const result = rankSimilarNames("Acme", candidates);
    assert.equal(result[0]?.id, "short");
    assert.equal(result[1]?.id, "long");
  });
});

describe("🔴 품명을 고치면 재고 연결이 풀린다", () => {
  const 가 = { id: "11111111-1111-4111-8111-111111111111", name: "PCB 조립" };
  const 나 = { id: "22222222-2222-4222-8222-222222222222", name: "휴즈" };
  const options = [가, 나];

  test("정확히 일치하면 그 부품에 잇는다 — 공백·대소문자는 눈감는다", () => {
    assert.equal(resolvePartLinkId("PCB 조립", null, options), 가.id);
    assert.equal(resolvePartLinkId("  pcb   조립 ", null, options), 가.id);
  });

  test("🔴 어긋나면 null 로 되돌린다 — 이어 둔 줄이어도", () => {
    assert.equal(resolvePartLinkId("PCB 조립품", 가.id, options), null);
    assert.equal(resolvePartLinkId("", 가.id, options), null);
  });

  test("이름을 다시 맞추면 연결이 그대로 돌아온다", () => {
    assert.equal(resolvePartLinkId("휴즈", null, options), 나.id);
  });

  test("재고에 없는 이름은 연결 없이 그대로 둔다(그것이 정상이다)", () => {
    assert.equal(resolvePartLinkId("유량계", null, options), null);
  });

  describe("같은 품명이 여럿일 때(이 저장소에 실제로 16묶음)", () => {
    const 둘1 = { id: "33333333-3333-4333-8333-333333333333", name: "오링" };
    const 둘2 = { id: "44444444-4444-4444-8444-444444444444", name: "오링" };
    const 많음 = [둘1, 둘2];

    test("지금 연결이 그중 하나면 빼앗지 않는다", () => {
      assert.equal(resolvePartLinkId("오링", 둘2.id, 많음), 둘2.id);
    });

    test("고른 적이 없으면 찍지 않고 사람에게 넘긴다", () => {
      assert.equal(resolvePartLinkId("오링", null, 많음), null);
      // 지금 연결이 그 후보들 밖이면 그것도 찍지 않는다.
      assert.equal(resolvePartLinkId("오링", 가.id, 많음), null);
    });
  });
});
