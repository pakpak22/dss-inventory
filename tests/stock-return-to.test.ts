import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RETURN_TO_FIELD, RETURN_TO_PATHS, safeReturnTo } from "../src/lib/stock/return-to";

/**
 * 돌아갈 자리 거르개 (2026-10-15, 조각 10c).
 *
 * 🔴 부품 요청 단추는 **폼에 실린 글자**를 보고 돌아갈 자리를 정한다. 그 값을 그대로 믿으면 남의 주소로
 *    사람을 보내는 구멍(open redirect)이 된다. 울타리는 `safeReturnTo` 하나뿐이라 여기서 전부 눌러 본다.
 */
describe("돌아갈 자리 거르개 (safeReturnTo)", () => {
  it("단추 묶음을 쓰는 두 화면은 그대로 통과한다", () => {
    assert.equal(safeReturnTo("/entries"), "/entries");
    assert.equal(safeReturnTo("/requests"), "/requests");
    // 허용 목록과 시험이 어긋나지 않게 — 자리가 늘면 이 줄이 먼저 깨져 시험을 같이 고치게 된다.
    assert.deepEqual([...RETURN_TO_PATHS], ["/entries", "/requests"]);
  });

  it("빈 값·안 보낸 값은 기록 내역으로", () => {
    assert.equal(safeReturnTo(""), "/entries");
    assert.equal(safeReturnTo(undefined), "/entries");
    assert.equal(safeReturnTo(null), "/entries");
  });

  it("다른 화면 주소는 받지 않는다", () => {
    assert.equal(safeReturnTo("/audit"), "/entries");
    assert.equal(safeReturnTo("/"), "/entries");
    assert.equal(safeReturnTo("/entries/new"), "/entries");
    assert.equal(safeReturnTo("/settings/items"), "/entries");
  });

  it("바깥 주소는 전부 막는다 (open redirect)", () => {
    assert.equal(safeReturnTo("https://evil.example"), "/entries");
    // 🔴 스킴 없는 바깥 주소 — 브라우저는 이것을 「다른 집」으로 읽는다. `startsWith("/")` 로 재면 뚫리는 자리.
    assert.equal(safeReturnTo("//evil.example"), "/entries");
    assert.equal(safeReturnTo("//evil.example/requests"), "/entries");
    assert.equal(safeReturnTo("http://evil.example/entries"), "/entries");
    assert.equal(safeReturnTo("javascript:alert(1)"), "/entries");
  });

  it("꼬리표·조건이 붙은 것도 받지 않는다 — 정확히 같은 글자만", () => {
    assert.equal(safeReturnTo("/requests?x=1"), "/entries");
    assert.equal(safeReturnTo("/entries?page=2"), "/entries");
    assert.equal(safeReturnTo("/requests#x"), "/entries");
    assert.equal(safeReturnTo("/requests/"), "/entries");
    assert.equal(safeReturnTo(" /requests"), "/entries");
    assert.equal(safeReturnTo("/REQUESTS"), "/entries");
  });

  it("글자가 아닌 것(숫자·객체·배열)도 기록 내역으로", () => {
    assert.equal(safeReturnTo(123), "/entries");
    assert.equal(safeReturnTo({ toString: () => "/requests" }), "/entries");
    assert.equal(safeReturnTo(["/requests"]), "/entries");
  });

  it("폼 칸 이름은 한 곳에서 온다 (화면과 서버가 같은 글자를 본다)", () => {
    assert.equal(RETURN_TO_FIELD, "returnTo");
  });
});
