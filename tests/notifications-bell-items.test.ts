import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInventoryNotificationItems,
  isRejectionVisible,
  NOTIFICATION_KINDS,
  NOTIFICATION_MAX_ITEMS,
  PENDING_NOTIFICATION_ID,
  receivesPendingNotification,
  receivesRejectedNotification,
  rejectedNotificationId,
  rejectionCutoff,
  REJECTED_VISIBLE_DAYS,
  type RejectedRequestSource,
} from "../src/lib/notifications/bell-items";
import { ownBaseUrlFrom, SSO_CALLBACK_PATH } from "../src/lib/env";

/**
 * 머리말 알림 종에 실리는 줄을 만드는 **순수 계산**. DB 도 망도 타지 않는다.
 * 규칙은 2026-10-13 사용자 결정 — 담당자에게 「확인 대기 N건」, 신청한 본인에게
 * 「반려」(결정된 지 7일까지). 확인(CONFIRMED)·취소(CANCELLED)는 알리지 않는다.
 */

const BASE = "http://192.168.1.132:3800";
const SOURCE = "dss-inventory";
const NOW = new Date("2026-10-13T09:00:00+09:00");

function rejected(over: Partial<RejectedRequestSource> = {}): RejectedRequestSource {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    summary: "사용 · 2026-10-11 · D260001 · No. 7 가짜부품 ×2",
    decidedByName: "담당자",
    decidedAt: new Date("2026-10-12T10:00:00+09:00"),
    ...over,
  };
}

function build(over: Partial<Parameters<typeof buildInventoryNotificationItems>[0]> = {}) {
  return buildInventoryNotificationItems({
    role: "ADMIN",
    pending: { count: 0, oldestAt: null },
    rejected: [],
    now: NOW,
    baseUrl: BASE,
    sourceId: SOURCE,
    ...over,
  });
}

describe("누가 무엇을 받는가", () => {
  it("「확인 대기」는 ADMIN 에게만 간다", () => {
    assert.equal(receivesPendingNotification("ADMIN"), true);
    assert.equal(receivesPendingNotification("STAFF"), false);
    assert.equal(receivesPendingNotification("VIEWER"), false);
  });

  it("「반려」는 신청을 낼 수 있는 사람(기록 권한 이상)에게 간다", () => {
    assert.equal(receivesRejectedNotification("VIEWER"), false);
    assert.equal(receivesRejectedNotification("STAFF"), true);
    assert.equal(receivesRejectedNotification("ADMIN"), true);
  });

  it("ADMIN 이 아니면 대기 건수가 있어도 줄이 없다", () => {
    for (const role of ["VIEWER", "STAFF"] as const) {
      const feed = build({ role, pending: { count: 5, oldestAt: new Date("2026-10-10T01:00:00Z") } });
      assert.deepEqual(feed.items, [], role);
      assert.equal(feed.count, 0, role);
    }
  });

  /**
   * 🔴 2026-10-15. 반려 줄도 역할 관문을 지난다.
   *
   * 신청을 낸 **뒤에** 보기(VIEWER)로 내려간 사람은 7일 안에 반려된 자기 신청이 남아 있다 —
   * 질의는 `requested_by` 로만 걸러 그 줄을 그대로 가져온다. 그런데 그 줄이 가리키는
   * `/requests` 는 `requireRole("STAFF")` 라 눌러도 `/forbidden` 으로 튕긴다. 같은 줄이
   * 포털을 거쳐 **남의 종에도** 실리므로 막다른 길이 우리 화면 밖에서도 그려진다.
   * 고친 방향은 **권한을 넓히는 쪽이 아니라** 못 여는 사람에게 줄을 안 만드는 쪽이다.
   */
  it("🔴 보기(VIEWER)에게는 반려된 자기 신청이 있어도 줄이 없다 — 눌러도 못 여는 화면이다", () => {
    const feed = build({ role: "VIEWER", rejected: [rejected({ id: "a" }), rejected({ id: "b" })] });
    assert.deepEqual(feed.items, []);
    assert.equal(feed.count, 0);
  });

  it("🔴 보기(VIEWER)는 배지 숫자도 0 이다 — 줄 없이 숫자만 남으면 빈 종이 된다", () => {
    const feed = build({ role: "VIEWER", rejected: [rejected()], rejectedTotal: 412 });
    assert.deepEqual(feed.items, []);
    assert.equal(feed.count, 0);
  });

  it("기록(STAFF)·관리자(ADMIN)에게는 반려 줄이 그대로 나온다", () => {
    for (const role of ["STAFF", "ADMIN"] as const) {
      const feed = build({ role, rejected: [rejected({ id: "a" }), rejected({ id: "b" })] });
      assert.deepEqual(
        feed.items.map((i) => i.id),
        [rejectedNotificationId("a"), rejectedNotificationId("b")],
        role,
      );
      assert.equal(feed.count, 2, role);
    }
  });

  it("🔴 역할 관문의 판정은 receivesRejectedNotification 하나에서 온다", () => {
    // 조건을 조립 쪽에 한 벌 더 적으면 언젠가 갈린다 — 그 함수가 참인 역할에서만 줄이 선다.
    for (const role of ["VIEWER", "STAFF", "ADMIN"] as const) {
      const feed = build({ role, rejected: [rejected()] });
      assert.equal(feed.items.length > 0, receivesRejectedNotification(role), role);
    }
  });
});

describe("확인 대기 — 여러 건을 한 줄로 묶는다", () => {
  it("건수가 글자에 들어가고 줄은 하나다", () => {
    const feed = build({ pending: { count: 5, oldestAt: new Date("2026-10-09T10:00:00+09:00") } });
    assert.equal(feed.items.length, 1);
    const item = feed.items[0];
    assert.equal(item.kind, NOTIFICATION_KINDS.pending);
    assert.equal(item.kindLabel, "확인 대기");
    assert.equal(item.subject, "반출 확인 대기 5건");
    assert.equal(item.detail, "가장 오래 기다린 신청 2026-10-09");
    assert.equal(item.id, PENDING_NOTIFICATION_ID);
    assert.equal(item.key, `${SOURCE}:${PENDING_NOTIFICATION_ID}`);
  });

  it("🔵 배지 숫자는 **줄 수**다 — 5건이어도 1 이다", () => {
    // 펼치면 한 줄인데 배지가 5 이면 둘 중 하나가 거짓말로 읽힌다. N 은 그 줄의 글자에 있다.
    // 머리말의 「대기 N」 배지는 그대로 N 을 말한다 — 역할이 다른 표시다.
    const feed = build({ pending: { count: 5, oldestAt: new Date("2026-10-09T10:00:00+09:00") } });
    assert.equal(feed.count, 1);
  });

  it("0건이면 줄이 없다 — 확인·반려하면 상태가 바뀌어 저절로 빠진다", () => {
    const feed = build({ pending: { count: 0, oldestAt: null } });
    assert.deepEqual(feed.items, []);
    assert.equal(feed.count, 0);
  });

  it("가장 오래된 시각이 없으면 detail 이 빈 글자다(칸을 빼지 않는다)", () => {
    const feed = build({ pending: { count: 1, oldestAt: null } });
    assert.equal(feed.items[0].detail, "");
  });

  it("🔴 신청 내용(부품명·사유)을 싣지 않는다 — 남의 시스템 화면에도 그려지는 줄이다", () => {
    const feed = build({ pending: { count: 3, oldestAt: new Date("2026-10-09T10:00:00+09:00") } });
    assert.ok(!feed.items[0].detail.includes("부품"));
    assert.ok(!feed.items[0].subject.includes("부품"));
  });
});

describe("반려 — 결정된 지 7일까지", () => {
  it("7일이 적힌 곳은 한 군데다", () => {
    assert.equal(REJECTED_VISIBLE_DAYS, 7);
    assert.equal(rejectionCutoff(NOW).getTime(), NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
  });

  it("딱 7일 되는 순간까지는 보인다", () => {
    const edge = rejectionCutoff(NOW);
    assert.equal(isRejectionVisible(edge, NOW), true);
    assert.equal(isRejectionVisible(new Date(edge.getTime() - 1), NOW), false);
  });

  it("결정 시각이 없으면 보이지 않는다", () => {
    assert.equal(isRejectionVisible(null, NOW), false);
  });

  it("7일이 지난 줄은 질의가 흘려보내도 여기서 빠진다", () => {
    const old = rejected({ id: "old", decidedAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000) });
    const fresh = rejected({ id: "fresh" });
    const feed = build({ role: "STAFF", rejected: [fresh, old] });
    assert.deepEqual(
      feed.items.map((i) => i.id),
      [rejectedNotificationId("fresh")],
    );
    assert.equal(feed.count, 1);
  });

  it("줄의 아홉 칸이 전부 채워지고 내용은 어느 신청인지만 가린다", () => {
    const feed = build({ role: "STAFF", rejected: [rejected()] });
    const item = feed.items[0];
    assert.equal(item.sourceId, SOURCE);
    assert.equal(item.sourceName, "DSS 재고 관리");
    assert.equal(item.kind, NOTIFICATION_KINDS.rejected);
    assert.equal(item.kindLabel, "반려");
    assert.equal(item.subject, "반출 신청이 반려되었습니다");
    assert.equal(item.detail, "사용 · 2026-10-11 · D260001 · No. 7 가짜부품 ×2 · 담당자 반려 · 2026-10-12");
    for (const [key, value] of Object.entries(item)) {
      assert.equal(typeof value, "string", key);
      assert.notEqual(value, undefined, key);
    }
  });

  it("반려한 사람 이름이 없어도 줄이 깨지지 않는다", () => {
    const feed = build({ role: "STAFF", rejected: [rejected({ decidedByName: null })] });
    assert.equal(feed.items[0].detail, "사용 · 2026-10-11 · D260001 · No. 7 가짜부품 ×2 · 2026-10-12");
  });

  it("같은 신청이 두 번 와도 한 줄이다", () => {
    const feed = build({ role: "STAFF", rejected: [rejected(), rejected()] });
    assert.equal(feed.items.length, 1);
  });

  it("받은 차례를 그대로 쓴다 — 질의가 정한 차례다", () => {
    const a = rejected({ id: "a", decidedAt: new Date("2026-10-12T10:00:00+09:00") });
    const b = rejected({ id: "b", decidedAt: new Date("2026-10-11T10:00:00+09:00") });
    const feed = build({ role: "STAFF", rejected: [a, b] });
    assert.deepEqual(
      feed.items.map((i) => i.id),
      [rejectedNotificationId("a"), rejectedNotificationId("b")],
    );
  });

  it("🔴 배지 숫자는 상한에 **걸리기 전**의 개수다", () => {
    const feed = build({ role: "STAFF", rejected: [rejected()], rejectedTotal: 412 });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.count, 412);
  });

  it("상한을 넘겨 받으면 줄은 잘린다", () => {
    const many = Array.from({ length: NOTIFICATION_MAX_ITEMS + 5 }, (_, i) => rejected({ id: `r${i}` }));
    const feed = build({ role: "STAFF", rejected: many, rejectedTotal: many.length });
    assert.equal(feed.items.length, NOTIFICATION_MAX_ITEMS);
    assert.equal(feed.count, many.length);
  });
});

describe("둘이 함께 뜰 때", () => {
  it("확인 대기가 위, 반려가 아래. 개수는 더한다", () => {
    const feed = build({
      role: "ADMIN",
      pending: { count: 2, oldestAt: new Date("2026-10-10T10:00:00+09:00") },
      rejected: [rejected({ id: "a" }), rejected({ id: "b" })],
    });
    assert.deepEqual(
      feed.items.map((i) => i.kind),
      [NOTIFICATION_KINDS.pending, NOTIFICATION_KINDS.rejected, NOTIFICATION_KINDS.rejected],
    );
    assert.equal(feed.count, 3);
  });

  it("열쇠(key)가 목록 안에서 유일하다 — 다른 시스템 줄과 섞여도 안 부딪히게 client_id 를 붙인다", () => {
    const feed = build({
      pending: { count: 1, oldestAt: NOW },
      rejected: [rejected({ id: "a" }), rejected({ id: "b" })],
    });
    const keys = feed.items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of keys) assert.ok(key.startsWith(`${SOURCE}:`), key);
  });
});

describe("링크는 절대 주소다 — 남의 종에 실리는 줄이다", () => {
  // 🔴 2026-10-15 에 `/entries` → `/requests` 로 옮겼다 — 확인 대기도 내 신청 결과도
  //    기록 내역에서 걷어내 부품 요청 관리 한자리로 모았기 때문이다(bell-items.ts 의 REQUESTS_PATH).
  it("두 종류 모두 부품 요청 관리 화면(/requests)으로 간다", () => {
    const feed = build({ pending: { count: 1, oldestAt: NOW }, rejected: [rejected()] });
    assert.equal(feed.items.length, 2);
    for (const item of feed.items) assert.equal(item.href, `${BASE}/requests`);
  });

  it("끝 슬래시는 떼어 낸다", () => {
    const feed = build({ pending: { count: 1, oldestAt: NOW }, baseUrl: `${BASE}/` });
    assert.equal(feed.items[0].href, `${BASE}/requests`);
  });

  it("🔴 상대경로를 받으면 던진다 — 포털이 상대경로 줄을 버린다", () => {
    assert.throws(() => build({ pending: { count: 1, oldestAt: NOW }, baseUrl: "/" }), /절대 주소/);
    assert.throws(() => build({ pending: { count: 1, oldestAt: NOW }, baseUrl: "" }), /절대 주소/);
  });
});

describe("이 시스템의 주소는 SSO_REDIRECT_URI 에서 나온다", () => {
  it("콜백 경로만 떼어 낸다", () => {
    assert.equal(ownBaseUrlFrom(`http://192.168.1.132:3800${SSO_CALLBACK_PATH}`), "http://192.168.1.132:3800");
    assert.equal(ownBaseUrlFrom(`http://localhost:3800${SSO_CALLBACK_PATH}`), "http://localhost:3800");
  });

  it("🔴 콜백 경로로 끝나지 않으면 던진다 — 조용히 넘어가면 링크가 엉뚱한 곳을 가리킨다", () => {
    assert.throws(() => ownBaseUrlFrom("http://localhost:3800"), /SSO_REDIRECT_URI/);
    assert.throws(() => ownBaseUrlFrom("http://localhost:3800/callback"), /SSO_REDIRECT_URI/);
  });
});
