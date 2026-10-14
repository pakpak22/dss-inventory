import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { matchesPartQuery, tokenizePartQuery, type PartQueryFields } from "../src/lib/parts/search";

/**
 * ============================================================================
 * 부품 고르개가 찾는 규칙 (2026-10-15, 조각 9b)
 * ============================================================================
 * 이 규칙은 조각 9b 전까지 `EntryForm.tsx` 안의 비공개 함수에 묻혀 있었다 — 그 화면은 서버
 * 액션을 물고 있어 렌더 시험이 붙지 않으므로, 「도번으로 찾아지는가」를 **아무도 재어 보지
 * 못했다.** 꺼내 놓은 까닭이 이 시험이다.
 *
 * 🔴 고객사 품명으로 찾는 것이 이 조각에서 **새로 생긴 것**이다. 우리 품명과 전혀 다를 수 있어,
 * 그 이름만 아는 사람은 지금까지 아무것도 찾지 못했다.
 *
 * DB 에도 망에도 붙지 않는다 — 순수 함수다.
 * ============================================================================
 */

const PCB: PartQueryFields = {
  no: 7,
  name: "PCB ASSY",
  name2: "RF-100",
  customerName: "제어기판",
  drawingNo: "DWG-2210",
  kyosanPartNo: "KY-88-A",
};

const FUSE: PartQueryFields = {
  no: 12,
  name: "FUSE",
  name2: "5A",
  customerName: "",
  drawingNo: "",
  kyosanPartNo: "",
};

function hits(query: string): string[] {
  const tokens = tokenizePartQuery(query);
  return [PCB, FUSE].filter((part) => matchesPartQuery(part, tokens)).map((part) => part.name);
}

describe("낱말 가르기 (tokenizePartQuery)", () => {
  test("앞뒤·가운데 공백을 지나치고 소문자로 맞춘다", () => {
    assert.deepEqual(tokenizePartQuery("  PCB   DWG-2210 "), ["pcb", "dwg-2210"]);
  });

  test("공백만 친 것은 낱말이 없다", () => {
    assert.deepEqual(tokenizePartQuery("   "), []);
  });
});

describe("찾는 칸 여섯", () => {
  test("품명으로 찾는다", () => {
    assert.deepEqual(hits("pcb"), ["PCB ASSY"]);
  });

  test("품명2로 찾는다", () => {
    assert.deepEqual(hits("RF-100"), ["PCB ASSY"]);
  });

  test("No. 로 찾는다", () => {
    assert.deepEqual(hits("12"), ["FUSE"]);
  });

  test("🔴 도번으로 찾는다", () => {
    assert.deepEqual(hits("DWG-2210"), ["PCB ASSY"]);
  });

  test("🔴 교산 품번으로 찾는다", () => {
    assert.deepEqual(hits("KY-88"), ["PCB ASSY"]);
  });

  test("🔴 고객사 품명으로 찾는다 (2026-10-15 에 더한 칸)", () => {
    assert.deepEqual(hits("제어기판"), ["PCB ASSY"]);
  });

  test("대소문자를 가리지 않는다", () => {
    assert.deepEqual(hits("dwg-2210"), ["PCB ASSY"]);
    assert.deepEqual(hits("ky-88-a"), ["PCB ASSY"]);
  });
});

describe("여러 낱말은 **모두** 들어 있어야 한다", () => {
  test("둘 다 든 줄만 남는다", () => {
    assert.deepEqual(hits("pcb 제어기판"), ["PCB ASSY"]);
  });

  test("한 낱말이라도 빠지면 안 나온다 — OR 가 아니다", () => {
    assert.deepEqual(hits("pcb 유량계"), []);
  });

  test("칸이 달라도 된다 — 품명 한 낱말 + 도번 한 낱말", () => {
    assert.deepEqual(hits("assy dwg-2210"), ["PCB ASSY"]);
  });
});

describe("빈 물음말", () => {
  test("🔵 아무것도 고르지 않는다 — 고르개가 300줄짜리 목록이 되면 안 된다", () => {
    assert.equal(matchesPartQuery(PCB, []), false);
    assert.deepEqual(hits(""), []);
    assert.deepEqual(hits("   "), []);
  });
});

describe("빈 칸이 있어도 터지지 않는다", () => {
  test("고객사 품명·도번·교산 품번이 비어 있는 부품", () => {
    assert.equal(matchesPartQuery(FUSE, tokenizePartQuery("fuse")), true);
    assert.equal(matchesPartQuery(FUSE, tokenizePartQuery("제어기판")), false);
  });
});
