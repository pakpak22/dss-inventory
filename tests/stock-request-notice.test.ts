import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestDecisionNotice, requestSavedNotice } from "../src/lib/stock/request-notice";

/**
 * 돌아온 자리에서 하는 한 줄 (2026-10-15, 조각 10c).
 *
 * 🔵 두 화면(기록 내역·부품 요청 관리)이 **같은 한 벌**을 쓴다는 것을 여기서 지킨다 — 같은 일을 다르게 말하거나,
 *    한쪽 문구만 고쳐지는 날을 막는 자리다. 뜻이 **일부러 갈린 둘**(가리키는 목록·누를 단추)도 함께 박아 둔다.
 */
describe("돌아온 자리에서 하는 한 줄 (request-notice)", () => {
  it("꼬리표가 없으면 아무 말도 하지 않는다", () => {
    assert.equal(requestDecisionNotice({}, "entries"), null);
    assert.equal(requestSavedNotice({}, "requests"), null);
    assert.equal(requestDecisionNotice({ held: "0" }, "requests"), null);
  });

  /**
   * [불출 신청]으로 결재를 올린 뒤 (2026-10-15, 조각 11c).
   * 🔴 지금까지 그 자리는 [확인]이었고 누르면 부품이 나갔다 — **「아직 안 빠졌다」를 말하지 않으면** 사람은 나간 줄 안다.
   */
  it("🔴 결재를 올린 뒤에는 「아직 재고가 안 빠졌다」와 「어디로 가면 되는지」를 말한다", () => {
    const n = requestDecisionNotice({ issueRequested: "1" }, "requests");
    assert.ok(n);
    assert.equal(n.tone, "info");
    assert.ok(n.text.includes("아직 재고는 빠지지 않았습니다"));
    assert.ok(n.text.includes("승인 요청건"));
  });

  it("🔴 결재할 사람이 없어 **바로 승인된** 건은 다른 말을 한다 — 아니면 아무도 [실행]을 누르지 않는다", () => {
    const auto = requestDecisionNotice({ issueRequested: "1", autoApproved: "1" }, "requests");
    const normal = requestDecisionNotice({ issueRequested: "1" }, "requests");
    assert.ok(auto);
    assert.ok(normal);
    assert.notEqual(auto.text, normal.text);
    assert.equal(auto.tone, "warn");
    assert.ok(auto.text.includes("바로 승인됐습니다"));
    assert.ok(auto.text.includes("실행"));
  });

  it("반려·마감·보류 해제·신청 취소는 두 화면이 같은 글자로 말한다", () => {
    for (const tag of ["rejected", "closed", "holdReleased", "cancelled"]) {
      const atEntries = requestDecisionNotice({ [tag]: "1" }, "entries");
      const atRequests = requestDecisionNotice({ [tag]: "1" }, "requests");
      assert.ok(atEntries, `${tag}: 기록 내역에서 한 줄이 나와야 한다`);
      assert.ok(atRequests, `${tag}: 부품 요청 관리에서도 한 줄이 나와야 한다`);
      assert.equal(atEntries.text, atRequests.text);
      assert.equal(atEntries.tone, "info");
    }
  });

  /**
   * 🔴 **2026-10-15 로 가리키는 곳이 바뀌었다.** 기록 내역 맨 위의 「확인 대기」 구역을 걷어내서, 거기서는
   *    「확인 대기 목록」이 아니라 **부품 요청 관리 목록**을 가리켜야 한다 — 없는 구역을 가리키면 거짓말이다.
   *    (기록 내역에서 이 말이 뜨는 길은 돌아갈 자리를 잃어 기본값으로 떨어진 때뿐이다. `return-to.ts`)
   */
  it("보류는 가리키는 목록만 다르다 (보는 화면에 따라 「이 목록」인지 그 화면 이름인지)", () => {
    const atEntries = requestDecisionNotice({ held: "1" }, "entries");
    const atRequests = requestDecisionNotice({ held: "1" }, "requests");
    assert.ok(atEntries);
    assert.ok(atRequests);
    assert.ok(atEntries.text.startsWith("신청을 보류했습니다."));
    assert.ok(atRequests.text.startsWith("신청을 보류했습니다."));
    assert.match(atEntries.text, /부품 요청 관리 목록에 그대로 남고/);
    assert.ok(!atEntries.text.includes("확인 대기 목록"));
    assert.match(atRequests.text, /이 목록에 그대로 남고/);
  });

  it("확인: 기록 번호를 말하고, 아직 남은 수량이 있으면 주황", () => {
    const n = requestSavedNotice({ saved: "US-2026-84", type: "USE", remaining: "3" }, "requests");
    assert.ok(n);
    assert.match(n.text, /사용 기록 US-2026-84 이\(가\) 저장되었습니다\./);
    assert.match(n.text, /아직 3개가 남았습니다/);
    assert.match(n.text, /이 목록에 그대로 있습니다/);
    assert.equal(n.tone, "warn");
  });

  it("남은 것도 경고도 없으면 평범한 알림", () => {
    const n = requestSavedNotice({ saved: "RC-2026-5", type: "RECEIVE", remaining: "0" }, "entries");
    assert.ok(n);
    assert.equal(n.tone, "info");
    assert.ok(!n.text.includes("남았습니다"));
  });

  it("인수번호 확인 안 됨: 누를 단추가 화면마다 달라 말이 갈린다", () => {
    const atEntries = requestSavedNotice({ saved: "US-2026-84", type: "USE", unverified: "1" }, "entries");
    const atRequests = requestSavedNotice({ saved: "US-2026-84", type: "USE", unverified: "1" }, "requests");
    assert.ok(atEntries);
    assert.ok(atRequests);
    assert.match(atEntries.text, /나중에 아래 \[확인\]을 누르십시오\./);
    assert.match(atRequests.text, /기록 내역에서 그 줄의 \[확인\]을 누르십시오\./);
    assert.equal(atEntries.tone, "warn");
    assert.equal(atRequests.tone, "warn");
  });

  it("주소를 고쳐 보내도 깨지지 않는다 (모르는 종류·숫자 아닌 남은 수량)", () => {
    const n = requestSavedNotice({ saved: "X", type: "NOPE", remaining: "abc", unverified: "yes" }, "entries");
    assert.ok(n);
    assert.equal(n.tone, "info");
    assert.ok(!n.text.includes("남았습니다"));
    assert.ok(!n.text.includes("인수번호 확인 안 됨"));
  });
});
