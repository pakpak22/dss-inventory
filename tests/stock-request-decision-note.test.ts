import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { RequestStatus } from "../src/db/schema/stock-requests";
import {
  DECISION_NOTE_LABEL_CLOSED,
  DECISION_NOTE_LABEL_OTHER,
  DECISION_NOTE_LABEL_REJECTED,
  DECISION_NOTE_TONE,
  HOLD_REASON_TONE,
  requestDecisionNote,
} from "../src/lib/stock/codes";

/**
 * ============================================================================
 * 결정 사유 — 「내가 왜 반려했더라」를 변경 이력에서 뒤지지 않게 (2026-10-21)
 * ============================================================================
 * 재고 관리는 반려·마감할 때 사유를 받아 DB 에 적고(`decision_note`), 그것을 A/S 에도 내주고 있었다
 * (`lib/api/stock-request-status.ts` → A/S 수리건 상세의 [부품 요청] 구역). **정작 재고 관리 자신의
 * 부품 요청 관리 화면(`/requests`)만 안 그렸다** — 담당자가 제가 적은 사유를 보려면 변경 이력(`/audit`)을
 * 뒤져야 했다. 그려 주기만 하는 조각이고 **조회도 쓰기도 한 글자도 안 고쳤다.**
 *
 * 🔴 이 저장소에는 **화면 렌더 시험이 없다**(`tests/part-field-order.test.ts` 머리말). 그래서
 *  1. 그릴지 말지·글자·색은 순수 함수 한 곳(`requestDecisionNote`)에서 재고,
 *  2. **화면이 그 한 곳을 안 돌고 손으로 적는 것**은 파일 글자에서 잰다(아래 마지막 두 묶음).
 * ============================================================================
 */

/**
 * 🔴 줄바꿈을 LF 로 눕혀서 읽는다 — 이 저장소의 소스는 CRLF 다. 눕히지 않으면 아래 `functionSource` 의
 *    「맨 앞 칸의 `}`」 가 **한 번도 안 맞아** 모든 단언이 조용히 「못 찾았다」로 끝난다.
 */
const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * 파일 글자에서 함수 하나만 잘라 낸다.
 * 🔵 끝은 **맨 앞 칸의 `}`** 로 본다 — 안쪽 블록은 전부 들여써 있어 여기 걸리지 않는다.
 */
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} 을(를) 못 찾았다 — 이름이 바뀌었으면 이 시험도 함께 고쳐라`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} 의 끝을 못 찾았다`);
  return source.slice(start, end + 3);
}

/**
 * 신청 한 줄에서 **이 함수가 보는 칸만.** 나머지는 판정에 쓰이지 않는다.
 *
 * 🔵 **아래 호출마다 둘째 인자로 `null` 을 적어 넘기는 까닭** (2026-10-22): 결재 단계에서 반려된
 *    신청이면 「원래 결재권자 (대리인 대리)」를 적어야 해서 그 단계 줄을 함께 받는데, **기본값을
 *    두지 않았다** — 두면 부르는 자리가 늘 때 아무 말 없이 「결재 반려가 아님」으로 굳어 그
 *    화면에서만 대리인 이름이 사라진다. 그쪽 동작은 `tests/approval-decided-by.test.ts` 가 잰다.
 */
function request(over: Partial<Parameters<typeof requestDecisionNote>[0]> = {}) {
  return {
    status: "REJECTED" as RequestStatus,
    closed: false,
    decisionNote: "재고가 없습니다",
    decidedByName: "예시 담당자",
    decidedAt: "2026-10-20T05:00:00.000Z",
    ...over,
  };
}

describe("결정 사유를 그릴지 말지 (2026-10-21)", () => {
  it("🔴 사유가 비면 그리지 않는다 — 빈 상자가 서면 「사유가 있는데 안 보인다」로 읽힌다", () => {
    assert.equal(requestDecisionNote(request({ decisionNote: "" }), null), null);
  });

  it("🔴 공백만 적힌 것도 빈 것이다", () => {
    assert.equal(requestDecisionNote(request({ decisionNote: "   \n  " }), null), null);
  });

  it("반려에 그린다", () => {
    const view = requestDecisionNote(request({ status: "REJECTED", decisionNote: "재고가 없습니다" }), null);
    assert.ok(view);
    assert.equal(view.note, "재고가 없습니다");
    assert.equal(view.label, DECISION_NOTE_LABEL_REJECTED);
  });

  it("🔴 마감에도 그린다 — 「왜 남은 걸 접었는지」가 반려만큼 중요하다", () => {
    // 마감은 상태값이 아니다(`isClosedRequest`). 상태는 CONFIRMED 이고 `closed` 가 참이다.
    const view = requestDecisionNote(request({ status: "CONFIRMED", closed: true, decisionNote: "나머지는 다음 입고에" }), null);
    assert.ok(view);
    assert.equal(view.note, "나머지는 다음 입고에");
    assert.equal(view.label, DECISION_NOTE_LABEL_CLOSED);
  });

  it("사유를 앞뒤 공백 없이 다듬어 준다 — 상자 안이 비어 보이지 않게", () => {
    assert.equal(requestDecisionNote(request({ decisionNote: "  재고가 없습니다  " }), null)?.note, "재고가 없습니다");
  });

  it("결정한 때가 없어도 상자는 선다 — 시각만 빠진다(사유가 함께 사라지면 안 된다)", () => {
    const view = requestDecisionNote(request({ decidedAt: null }), null);
    assert.ok(view);
    assert.equal(view.at, null);
    assert.equal(view.note, "재고가 없습니다");
  });

  it("결정한 사람 이름이 없으면 빈 글자다 — 화면이 「null」을 찍지 않게", () => {
    assert.equal(requestDecisionNote(request({ decidedByName: null }), null)?.byName, "");
  });

  /**
   * 🔴 **「취소」에는 사유라는 개념이 아예 없다.** 거두는 함수가 사유를 **받지 않아서**
   *    `decision_note` 가 빈 글자 그대로다 — 안 보이는 것이 아니라 처음부터 없다.
   *    다음 사람이 「취소 사유가 왜 안 보이지」로 헤매지 않게 **코드에서** 잰다.
   */
  it("🔴 취소에는 사유가 없다 — 거두는 두 함수가 사유 칸을 적지 않는다", () => {
    const requests = src("src/lib/stock/requests.ts");
    for (const name of ["cancelRequest", "cancelExternalRequest"]) {
      assert.ok(
        !functionSource(requests, name).includes("decisionNote"),
        `${name} 이(가) 사유를 적기 시작했다. 사유를 받게 됐다면 이 시험과 \`requestDecisionNote\` 의 주석·글자를 함께 고쳐라`,
      );
    }
    // 그래서 취소된 신청은 그릴 것이 없다.
    assert.equal(requestDecisionNote(request({ status: "CANCELLED", decisionNote: "" }), null), null);
  });

  it("🔴 사유를 적는 자리는 반려와 마감 둘뿐이다 — 쓰기 쪽은 이 조각에서 한 글자도 안 바뀌었다", () => {
    const requests = src("src/lib/stock/requests.ts");
    for (const name of ["rejectRequest", "closeRequest"]) {
      assert.ok(functionSource(requests, name).includes("decisionNote: note"), `${name} 이(가) 더 이상 사유를 적지 않는다`);
    }
  });
});

/**
 * 글자와 색 — **한 자리에서 고른다**(`codes.ts` 의 규약. 그 파일 주석: 짝이 갈리면 「마감인데 초록」 같은 줄이 생긴다).
 */
describe("결정 사유 상자의 글자와 색 (2026-10-21)", () => {
  it("🔴 글자와 색이 **함께** 나온다 — 한쪽만 받아 갈 수 없다", () => {
    for (const r of [request({ status: "REJECTED" }), request({ status: "CONFIRMED", closed: true }), request({ status: "PENDING" })]) {
      const view = requestDecisionNote(r, null);
      assert.ok(view);
      assert.ok(view.label.trim().length > 0, "글자가 비었다");
      assert.equal(view.tone, DECISION_NOTE_TONE, "색이 그 표에서 오지 않았다");
    }
  });

  it("🔴 상태 배지와 같은 차례로 가른다 — ① 마감 ② 반려 ③ 그 밖", () => {
    // 마감이 반려를 이긴다. 같은 줄의 배지가 「마감」인데 상자가 「반려 사유」라고 하면 두 말을 한다.
    assert.equal(requestDecisionNote(request({ status: "REJECTED", closed: true }), null)?.label, DECISION_NOTE_LABEL_CLOSED);
    assert.equal(requestDecisionNote(request({ status: "REJECTED", closed: false }), null)?.label, DECISION_NOTE_LABEL_REJECTED);
    assert.equal(requestDecisionNote(request({ status: "CONFIRMED", closed: false }), null)?.label, DECISION_NOTE_LABEL_OTHER);
  });

  it("세 글자가 서로 다르다 — 뭉개면 한 상태가 다른 상태인 척한다", () => {
    const labels = [DECISION_NOTE_LABEL_CLOSED, DECISION_NOTE_LABEL_REJECTED, DECISION_NOTE_LABEL_OTHER];
    assert.equal(new Set(labels).size, labels.length);
  });

  it("🔴 보류 상자와 **색이 다르다** — 둘이 나란히 설 수 있고, 담당자가 할 일이 정반대다", () => {
    assert.notEqual(DECISION_NOTE_TONE.box, HOLD_REASON_TONE.box);
    assert.notEqual(DECISION_NOTE_TONE.body, HOLD_REASON_TONE.body);
    assert.notEqual(DECISION_NOTE_TONE.meta, HOLD_REASON_TONE.meta);
  });

  it("색 한 벌이 세 칸 다 차 있다 — 바탕만 바꾸고 글자색을 두고 오면 연한 바탕에 연한 글자가 남는다", () => {
    for (const tone of [DECISION_NOTE_TONE, HOLD_REASON_TONE]) {
      for (const [key, value] of Object.entries(tone)) assert.ok(value.trim().length > 0, key);
    }
  });
});

/**
 * 화면이 **그 한 곳을 돈다** — 손으로 적은 색·조건이 생기면 여기서 깨진다.
 * 🔵 `part-field-order.test.ts` 의 마지막 묶음과 같은 방식이다(화면 렌더 시험이 없는 저장소의 대체 수단).
 */
describe("부품 요청 관리 화면이 표를 돈다 (2026-10-21)", () => {
  const screen = src("src/components/stock/RequestManagerScreen.tsx");

  it("🔴 결정 사유를 그린다 — 이 화면만 안 그려서 생긴 조각이다", () => {
    assert.ok(screen.includes("requestDecisionNote"), "화면이 결정 사유를 안 그린다");
  });

  it("🔴 두 상자의 색이 `codes.ts` 의 표에서만 온다 — 세 칸을 다 돌아야 한다", () => {
    for (const key of ["box", "body", "meta"] as const) {
      assert.ok(screen.includes(`HOLD_REASON_TONE.${key}`), `보류 상자의 ${key} 가 표를 안 돈다`);
      assert.ok(screen.includes(`decision.tone.${key}`), `결정 상자의 ${key} 가 표를 안 돈다`);
    }
  });

  /**
   * 🔵 **보라만 잰다.** 보라 셋은 보류 상자 말고 쓰는 자리가 없어서 「손으로 적었나」를 글자로 가릴 수 있다.
   *    결정 상자의 중립색(zinc)은 이 화면의 다른 자리(출처 표식·품명)가 이미 같은 칸을 쓰고 있어
   *    글자만으로는 가를 수 없다 — 그쪽은 바로 위 묶음이 「표를 도는가」로 잰다.
   */
  it("🔴 보류 상자의 색이 화면에 손으로 적혀 있지 않다", () => {
    for (const hardcoded of [HOLD_REASON_TONE.box, HOLD_REASON_TONE.body, HOLD_REASON_TONE.meta]) {
      assert.ok(!screen.includes(hardcoded), `화면에 ${hardcoded} 이(가) 손으로 적혀 있다`);
    }
  });

  it("화면이 신청에서 세 칸을 받는다 — 조회는 처음부터 싣고 있었다", () => {
    for (const field of ["decisionNote", "decidedByName", "decidedAt"]) {
      assert.ok(screen.includes(field), `화면이 받는 모양에 ${field} 가 없다`);
    }
  });
});
