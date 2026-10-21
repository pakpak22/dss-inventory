import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePortalNotificationFeed, PORTAL_NOTIFICATIONS_TIMEOUT_MS } from "../src/lib/notifications/portal";

/**
 * 포털이 **다른 시스템들에** 물어 합쳐 준 답을 그릴 수 있는 모양으로 만드는 순수 함수.
 * 포털은 우리 편이지만 그 답에는 **다른 시스템들이 만든 글자**가 실려 온다 — 한 시스템이
 * 이상한 줄을 하나 섞어 보냈다고 머리말이 통째로 깨지면 안 된다.
 */

function item(over: Record<string, unknown> = {}) {
  return {
    key: "dss-board:POST:1",
    sourceId: "dss-board",
    sourceName: "DSS 사내 게시판",
    id: "POST:1",
    kind: "NOTICE",
    kindLabel: "공지",
    subject: "제목",
    detail: "누가 · 언제",
    href: "http://192.168.1.132:3400/posts/1",
    ...over,
  };
}

describe("포털 응답 읽기", () => {
  it("아홉 칸이 다 글자인 줄은 그대로 실린다", () => {
    const feed = normalizePortalNotificationFeed({ items: [item()], count: 1, degraded: false });
    // 🔴 `acknowledged` 는 2026-10-22 에 **늘어난 칸**이다(✓ 로 확인한 열쇠). 답에 그 칸이
    //    없으면 빈 배열이고 종은 예전 그대로 그려진다 — 뜻과 쓰는 자리는
    //    tests/notifications-acknowledgement.test.ts 에.
    assert.deepEqual(feed, { items: [item()], count: 1, degraded: false, dismissed: [], acknowledged: [] });
  });

  it("🔴 칸이 하나라도 글자가 아니면 **그 줄만** 버린다", () => {
    for (const bad of ["key", "sourceId", "sourceName", "id", "kind", "kindLabel", "subject", "detail", "href"]) {
      const feed = normalizePortalNotificationFeed({ items: [item({ [bad]: 1 }), item({ key: "ok" })], count: 2 });
      assert.deepEqual(
        feed.items.map((i) => i.key),
        ["ok"],
        bad,
      );
      // 🔴 개수는 포털이 센 값 그대로다 — 버린 줄 때문에 다시 세지 않는다.
      assert.equal(feed.count, 2, bad);
    }
  });

  it("줄이 객체가 아니어도 터지지 않는다", () => {
    const feed = normalizePortalNotificationFeed({ items: [null, 3, "줄", item()], count: 1 });
    assert.equal(feed.items.length, 1);
  });

  it("🔴 개수는 포털이 센 값 그대로다 — 줄 수로 다시 세지 않는다", () => {
    const feed = normalizePortalNotificationFeed({ items: [item()], count: 17 });
    assert.equal(feed.count, 17);
  });

  it("개수가 숫자가 아니거나 음수면 0 이다 — 배지만 안 그려지고 목록은 그대로", () => {
    for (const count of ["3", null, undefined, NaN, -1, Infinity]) {
      const feed = normalizePortalNotificationFeed({ items: [item()], count });
      assert.equal(feed.count, 0, String(count));
      assert.equal(feed.items.length, 1, String(count));
    }
  });

  it("degraded 는 true 일 때만 true 다", () => {
    assert.equal(normalizePortalNotificationFeed({ items: [], count: 0, degraded: true }).degraded, true);
    assert.equal(normalizePortalNotificationFeed({ items: [], count: 0, degraded: "true" }).degraded, false);
    assert.equal(normalizePortalNotificationFeed({ items: [], count: 0 }).degraded, false);
  });

  it("items 가 배열이 아니면 빈 목록 — 터지지 않는다", () => {
    assert.deepEqual(normalizePortalNotificationFeed({ items: "없음", count: 0 }).items, []);
    assert.deepEqual(normalizePortalNotificationFeed({}).items, []);
  });

  it("객체가 아닌 답은 「못 물어봤다」로 본다", () => {
    for (const body of [null, undefined, "응답", 3, true]) {
      // 🔴 못 물어봤을 때는 지움도 확인도 **빈 배열**이다 — 거를 것이 없다는 뜻이고,
      //    그때는 지웠던·확인해 둔 줄이 다시 뜬다(틀렸을 때 덜 나쁜 쪽).
      assert.deepEqual(normalizePortalNotificationFeed(body), { items: [], count: 0, degraded: true, dismissed: [], acknowledged: [] });
    }
  });
});

describe("시간 상한", () => {
  it("🔴 포털이 각 시스템에 묻는 상한(1.5초)보다 길어야 한다", () => {
    // 상한을 1.5초로 두면 「한 곳이 빠졌다(degraded)」는 정상 응답을 도착 직전에 버린다.
    assert.ok(PORTAL_NOTIFICATIONS_TIMEOUT_MS > 1500, String(PORTAL_NOTIFICATIONS_TIMEOUT_MS));
    assert.equal(PORTAL_NOTIFICATIONS_TIMEOUT_MS, 2000);
  });
});
