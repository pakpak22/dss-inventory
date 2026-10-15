import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildInventoryNotificationItems,
  DECIDED_ISSUE_APPROVAL_STATUSES,
  isRejectionVisible,
  ISSUE_APPROVAL_TO_DECIDE_NOTIFICATION_ID,
  issueApprovalDecidedNotificationId,
  NOTIFICATION_KINDS,
  NOTIFICATION_MAX_ITEMS,
  PENDING_NOTIFICATION_ID,
  receivesIssueApprovalDecidedNotification,
  receivesIssueApprovalToDecideNotification,
  receivesPendingNotification,
  receivesRejectedNotification,
  rejectedNotificationId,
  rejectionCutoff,
  REJECTED_VISIBLE_DAYS,
  type DecidedIssueApprovalSource,
  type RejectedRequestSource,
} from "../src/lib/notifications/bell-items";
import { PART_ISSUE_STATUSES } from "../src/lib/approval/part-issue-rules";
import { ownBaseUrlFrom, SSO_CALLBACK_PATH } from "../src/lib/env";

/**
 * 머리말 알림 종에 실리는 줄을 만드는 **순수 계산**. DB 도 망도 타지 않는다.
 * 규칙은 2026-10-13 사용자 결정 — 담당자에게 「확인 대기 N건」, 신청한 본인에게
 * 「반려」(결정된 지 7일까지). 확인(CONFIRMED)·취소(CANCELLED)는 알리지 않는다.
 *
 * 2026-10-15(조각 11d)에 **불출 결재 두 줄**이 붙었다 — 지금 내 차례인 결재(묶음 한 줄) ·
 * 내가 올린 결재건의 결과(건마다 한 줄). 둘 다 `/approvals` 로 간다.
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

/** 승인된 내 결재건 한 줄. 🔴 결정 시각 칸이 비어 있는 것이 **승인 줄의 모양**이다. */
function approvedIssue(over: Partial<DecidedIssueApprovalSource> = {}): DecidedIssueApprovalSource {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    status: "APPROVED",
    summary: "사용 · 2026-10-09 · D260002 · No. 7 가짜부품 ×2",
    requestedAt: new Date("2026-10-09T10:00:00+09:00"),
    decidedByName: null,
    decidedAt: null,
    ...over,
  };
}

/** 반려된 내 결재건 한 줄 — 결정 시각은 **단계 줄**에서 온다. */
function rejectedIssue(over: Partial<DecidedIssueApprovalSource> = {}): DecidedIssueApprovalSource {
  return {
    ...approvedIssue(),
    id: "33333333-3333-4333-8333-333333333333",
    status: "REJECTED",
    decidedByName: "결재자",
    decidedAt: new Date("2026-10-12T10:00:00+09:00"),
    ...over,
  };
}

function build(over: Partial<Parameters<typeof buildInventoryNotificationItems>[0]> = {}) {
  return buildInventoryNotificationItems({
    role: "ADMIN",
    pending: { count: 0, oldestAt: null },
    rejected: [],
    issueApprovalsToDecide: { count: 0, oldestAt: null },
    decidedIssueApprovals: [],
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

describe("결재 차례 — 지금 내 차례인 불출 결재를 한 줄로 묶는다 (2026-10-15)", () => {
  it("건수가 글자에 들어가고 줄은 하나다", () => {
    const feed = build({ issueApprovalsToDecide: { count: 3, oldestAt: new Date("2026-10-09T10:00:00+09:00") } });
    assert.equal(feed.items.length, 1);
    const item = feed.items[0];
    assert.equal(item.kind, NOTIFICATION_KINDS.issueApprovalToDecide);
    assert.equal(item.kindLabel, "결재 차례");
    assert.equal(item.subject, "결재할 불출 신청 3건");
    assert.equal(item.detail, "가장 오래 기다린 결재 2026-10-09");
    assert.equal(item.id, ISSUE_APPROVAL_TO_DECIDE_NOTIFICATION_ID);
    assert.equal(item.key, `${SOURCE}:${ISSUE_APPROVAL_TO_DECIDE_NOTIFICATION_ID}`);
    assert.equal(item.href, `${BASE}/approvals`);
  });

  it("🔴 내 차례인 결재가 없으면 줄이 서지 않는다 — 결재하면 단계가 닫혀 저절로 빠진다", () => {
    const feed = build({ issueApprovalsToDecide: { count: 0, oldestAt: null } });
    assert.deepEqual(feed.items, []);
    assert.equal(feed.count, 0);
  });

  it("🔵 배지 숫자는 **줄 수**다 — 3건이어도 1 이다(「확인 대기」와 같은 규칙)", () => {
    const feed = build({ issueApprovalsToDecide: { count: 3, oldestAt: NOW } });
    assert.equal(feed.count, 1);
  });

  it("가장 오래된 시각이 없으면 detail 이 빈 글자다(칸을 빼지 않는다)", () => {
    const feed = build({ issueApprovalsToDecide: { count: 1, oldestAt: null } });
    assert.equal(feed.items[0].detail, "");
  });

  /**
   * 🔴 결재자는 **역할과 무관하게** 결재선에 든 사람이고, `/approvals` 의 문은
   * `requireSession` 이다(그 화면 29행). 역할로 거르면 보기(VIEWER) 권한인 결재자가
   * 자기 차례를 알림으로도 못 받는다 — 「눌러도 못 여는 줄」의 정반대 실수다.
   */
  it("🔴 역할로 거르지 않는다 — 보기(VIEWER)에게도 줄이 선다", () => {
    for (const role of ["VIEWER", "STAFF", "ADMIN"] as const) {
      const feed = build({ role, issueApprovalsToDecide: { count: 1, oldestAt: NOW } });
      assert.equal(feed.items.length, 1, role);
      assert.equal(feed.items[0].kind, NOTIFICATION_KINDS.issueApprovalToDecide, role);
    }
  });

  it("🔴 역할 판정은 receivesIssueApprovalToDecideNotification 하나에서 온다", () => {
    assert.equal(receivesIssueApprovalToDecideNotification(), true);
    for (const role of ["VIEWER", "STAFF", "ADMIN"] as const) {
      const feed = build({ role, issueApprovalsToDecide: { count: 1, oldestAt: NOW } });
      assert.equal(feed.items.length > 0, receivesIssueApprovalToDecideNotification(), role);
    }
  });

  it("🔴 신청 내용(부품명·사유)을 싣지 않는다 — 남의 시스템 화면에도 그려지는 줄이다", () => {
    const feed = build({ issueApprovalsToDecide: { count: 2, oldestAt: NOW } });
    assert.ok(!feed.items[0].detail.includes("부품"));
    assert.ok(!feed.items[0].subject.includes("부품명"));
  });
});

describe("결재 결과 — 내가 올린 결재건이 승인/반려됐다 (2026-10-15)", () => {
  it("승인되면 줄이 선다 — 「아직 불출 전」이라고 말한다", () => {
    const feed = build({ decidedIssueApprovals: [approvedIssue()] });
    assert.equal(feed.items.length, 1);
    const item = feed.items[0];
    assert.equal(item.kind, NOTIFICATION_KINDS.issueApprovalDecided);
    assert.equal(item.kindLabel, "결재 결과");
    assert.equal(item.subject, "불출 결재가 승인되었습니다");
    assert.equal(item.detail, "사용 · 2026-10-09 · D260002 · No. 7 가짜부품 ×2 · 아직 불출 전 · 올린 날 2026-10-09");
    assert.equal(item.id, issueApprovalDecidedNotificationId("22222222-2222-4222-8222-222222222222"));
    assert.equal(item.href, `${BASE}/approvals`);
    assert.equal(feed.count, 1);
  });

  /**
   * 🔴 「실행되면 사라진다」가 걸려 있는 자리. 날짜가 아니라 **상태**가 가린다 —
   * 질의(`listDecidedPartIssueApprovalsFor`)의 WHERE 와 아래 조립이 **같은 목록**을 본다.
   */
  it("🔴 실행된 건은 그 목록에 아예 없다 — EXECUTED·CANCELLED·결재 중이 빠져 있다", () => {
    assert.deepEqual([...DECIDED_ISSUE_APPROVAL_STATUSES], ["APPROVED", "REJECTED"]);
    for (const status of PART_ISSUE_STATUSES) {
      const listed = (DECIDED_ISSUE_APPROVAL_STATUSES as readonly string[]).includes(status);
      assert.equal(listed, status === "APPROVED" || status === "REJECTED", status);
    }
    // 실행된 건은 「종에 안 뜬다」로 그치지 않는다 — 이 저장소의 어느 상태인지까지 못 박는다.
    assert.ok(PART_ISSUE_STATUSES.includes("EXECUTED"));
  });

  it("🔴 실행된 건이 질의를 빠져나와도 줄이 되지 않는다 — 조립이 한 번 더 본다", () => {
    const executed = { ...approvedIssue(), status: "EXECUTED" } as unknown as DecidedIssueApprovalSource;
    const feed = build({ decidedIssueApprovals: [executed] });
    assert.deepEqual(feed.items, []);
    assert.equal(feed.count, 0);
  });

  it("🔴 승인 줄에는 기간 제한이 없다 — 한 해 묵어도 그대로 선다(오래될수록 더 보여야 한다)", () => {
    const old = approvedIssue({ requestedAt: new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000) });
    const feed = build({ decidedIssueApprovals: [old] });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].subject, "불출 결재가 승인되었습니다");
  });

  it("반려되면 누가 언제 반려했는지가 붙는다", () => {
    const feed = build({ decidedIssueApprovals: [rejectedIssue()] });
    assert.equal(feed.items[0].subject, "불출 결재가 반려되었습니다");
    assert.equal(feed.items[0].detail, "사용 · 2026-10-09 · D260002 · No. 7 가짜부품 ×2 · 결재자 반려 · 2026-10-12");
  });

  /**
   * 🔴 7일 선을 **손으로 다시 긋지 않는다** — 반출 신청 반려 알림이 쓰는 그 함수
   * (`isRejectionVisible` · `rejectionCutoff`)를 그대로 쓴다. 아래 시험은 **두 종류를 같은
   * 경계에 세워** 둘이 함께 나타나고 함께 사라지는 것으로 그 사실을 잰다 — 한쪽만 7일을
   * 고치면 여기서 깨진다.
   */
  it("🔴 반려는 7일이 지나면 사라진다 — 반출 신청 반려와 **같은 경계**다", () => {
    const edge = rejectionCutoff(NOW);
    const justOver = new Date(edge.getTime() - 1);

    const onEdge = build({ role: "STAFF", decidedIssueApprovals: [rejectedIssue({ decidedAt: edge })], rejected: [rejected({ decidedAt: edge })] });
    assert.equal(onEdge.items.length, 2, "딱 7일 되는 순간까지는 둘 다 보인다");

    const over = build({ role: "STAFF", decidedIssueApprovals: [rejectedIssue({ decidedAt: justOver })], rejected: [rejected({ decidedAt: justOver })] });
    assert.deepEqual(over.items, [], "1밀리초를 넘기면 둘 다 함께 사라진다");
    assert.equal(over.count, 0);
  });

  it("🔴 7일이 적힌 곳은 여전히 한 군데다 — 결재 반려도 그 상수를 지난다", () => {
    const old = rejectedIssue({ decidedAt: new Date(NOW.getTime() - (REJECTED_VISIBLE_DAYS + 1) * 24 * 60 * 60 * 1000) });
    const fresh = rejectedIssue({ id: "fresh" });
    const feed = build({ decidedIssueApprovals: [fresh, old] });
    assert.deepEqual(
      feed.items.map((i) => i.id),
      [issueApprovalDecidedNotificationId("fresh")],
    );
    assert.equal(feed.count, 1);
  });

  it("결정 시각이 없는 반려 줄은 보이지 않는다(있을 수 없지만 지어내지 않는다)", () => {
    const feed = build({ decidedIssueApprovals: [rejectedIssue({ decidedAt: null })] });
    assert.deepEqual(feed.items, []);
  });

  it("반려한 사람 이름이 없어도 줄이 깨지지 않는다", () => {
    const feed = build({ decidedIssueApprovals: [rejectedIssue({ decidedByName: null })] });
    assert.equal(feed.items[0].detail, "사용 · 2026-10-09 · D260002 · No. 7 가짜부품 ×2 · 2026-10-12");
  });

  it("🔴 역할로 거르지 않는다 — 올린 뒤 보기(VIEWER)로 내려가도 자기 결재건의 결과는 본다", () => {
    assert.equal(receivesIssueApprovalDecidedNotification(), true);
    for (const role of ["VIEWER", "STAFF", "ADMIN"] as const) {
      const feed = build({ role, decidedIssueApprovals: [approvedIssue()] });
      assert.equal(feed.items.length, 1, role);
    }
  });

  it("같은 결재건이 두 번 와도 한 줄이다", () => {
    const feed = build({ decidedIssueApprovals: [approvedIssue(), approvedIssue()] });
    assert.equal(feed.items.length, 1);
  });

  it("줄의 아홉 칸이 전부 채워진다 — 승인·반려 둘 다", () => {
    for (const row of [approvedIssue(), rejectedIssue()]) {
      const item = build({ decidedIssueApprovals: [row] }).items[0];
      for (const [key, value] of Object.entries(item)) {
        assert.equal(typeof value, "string", `${row.status}/${key}`);
        assert.notEqual(value, "", `${row.status}/${key}`);
      }
    }
  });

  it("🔴 배지 숫자는 상한에 **걸리기 전**의 개수다", () => {
    const feed = build({ decidedIssueApprovals: [approvedIssue()], decidedIssueApprovalsTotal: 412 });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.count, 412);
  });
});

describe("🔴 말이 서로 달라야 한다 — 색만으로 가르지 않는다 (CLAUDE.md 9-7절)", () => {
  it("세 줄의 제목이 서로 다르고, 기존 두 줄과도 다르다", () => {
    const feed = build({
      role: "ADMIN",
      issueApprovalsToDecide: { count: 2, oldestAt: NOW },
      pending: { count: 2, oldestAt: NOW },
      decidedIssueApprovals: [approvedIssue(), rejectedIssue()],
      rejected: [rejected()],
    });
    const subjects = feed.items.map((i) => i.subject);
    assert.equal(new Set(subjects).size, subjects.length, subjects.join(" / "));
    assert.deepEqual(subjects, [
      "결재할 불출 신청 2건",
      "반출 확인 대기 2건",
      "불출 결재가 승인되었습니다",
      "불출 결재가 반려되었습니다",
      "반출 신청이 반려되었습니다",
    ]);
  });

  /**
   * 🔴 승인과 반려는 **같은 종류**(한 사람이 받는 한 가지 설정이라서)이므로 색이 같다 —
   * 그래서 둘을 갈라 주는 것은 **글자뿐**이다. 이 시험이 그 사실을 못 박는다.
   */
  it("🔴 승인과 반려는 같은 종류·같은 이름표라서 **글자가 유일한 구분**이다", () => {
    const [approved, rejectedItem] = build({ decidedIssueApprovals: [approvedIssue(), rejectedIssue()] }).items;
    assert.equal(approved.kind, rejectedItem.kind);
    assert.equal(approved.kindLabel, rejectedItem.kindLabel);
    assert.notEqual(approved.subject, rejectedItem.subject);
  });

  it("할 일이 위, 결과가 아래 — 개수는 묶음 둘이 1씩, 나머지는 줄마다", () => {
    const feed = build({
      role: "ADMIN",
      issueApprovalsToDecide: { count: 5, oldestAt: NOW },
      pending: { count: 4, oldestAt: NOW },
      decidedIssueApprovals: [approvedIssue(), rejectedIssue()],
      rejected: [rejected()],
    });
    assert.deepEqual(
      feed.items.map((i) => i.kind),
      [
        NOTIFICATION_KINDS.issueApprovalToDecide,
        NOTIFICATION_KINDS.pending,
        NOTIFICATION_KINDS.issueApprovalDecided,
        NOTIFICATION_KINDS.issueApprovalDecided,
        NOTIFICATION_KINDS.rejected,
      ],
    );
    assert.equal(feed.count, 1 + 1 + 2 + 1);
  });

  it("열쇠(key)가 다섯 줄 모두에서 유일하다", () => {
    const feed = build({
      role: "ADMIN",
      issueApprovalsToDecide: { count: 1, oldestAt: NOW },
      pending: { count: 1, oldestAt: NOW },
      decidedIssueApprovals: [approvedIssue(), rejectedIssue()],
      rejected: [rejected()],
    });
    const keys = feed.items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of keys) assert.ok(key.startsWith(`${SOURCE}:`), key);
  });
});

describe("링크는 절대 주소다 — 남의 종에 실리는 줄이다", () => {
  // 🔴 2026-10-15 에 `/entries` → `/requests` 로 옮겼다 — 확인 대기도 내 신청 결과도
  //    기록 내역에서 걷어내 부품 요청 관리 한자리로 모았기 때문이다(bell-items.ts 의 REQUESTS_PATH).
  it("반출 신청 두 종류는 부품 요청 관리 화면(/requests)으로 간다", () => {
    const feed = build({ pending: { count: 1, oldestAt: NOW }, rejected: [rejected()] });
    assert.equal(feed.items.length, 2);
    for (const item of feed.items) assert.equal(item.href, `${BASE}/requests`);
  });

  it("🔴 불출 결재 두 종류는 승인 요청건 화면(/approvals)으로 간다 — **절대 주소**다", () => {
    const feed = build({
      issueApprovalsToDecide: { count: 1, oldestAt: NOW },
      decidedIssueApprovals: [approvedIssue(), rejectedIssue()],
    });
    assert.equal(feed.items.length, 3);
    for (const item of feed.items) {
      assert.equal(item.href, `${BASE}/approvals`);
      // 🔴 포털은 상대경로로 온 줄을 **버린다**(dss-auth 의 merge.ts).
      assert.ok(item.href.startsWith("http://") || item.href.startsWith("https://"), item.href);
    }
  });

  it("끝 슬래시는 떼어 낸다 — 두 경로 모두", () => {
    const feed = build({ pending: { count: 1, oldestAt: NOW }, issueApprovalsToDecide: { count: 1, oldestAt: NOW }, baseUrl: `${BASE}/` });
    assert.deepEqual(
      feed.items.map((i) => i.href),
      [`${BASE}/approvals`, `${BASE}/requests`],
    );
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

/* ------------------------------------------------------------------ */
/* 아래는 **순수 함수로는 닿지 않는 자리**를 글자로 못 박는 시험이다.      */
/* 🔴 이 저장소에는 DB 시험이 없다. 「남의 건이 내 종에 뜨지 않는다」는     */
/*    질의의 WHERE 에 걸려 있고, 그 WHERE 는 아무도 돌려 보지 못한 채      */
/*    운영으로 나간다 — tests/part-issue-screen.test.ts 가 쓰는 방식이다.  */
/* ------------------------------------------------------------------ */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 🔴 **함수 하나만 잘라 낸다.** 파일 전체에서 글자를 찾으면 **옆 함수가 대신 통과시킨다** —
 * 실제로 그랬다: 「내 차례」 집계의 열쇠를 A/S 번호로 바꿔 망가뜨렸는데, 같은 글자를 가진
 * `listPartIssueApprovalsToDecide` 때문에 시험이 그대로 통과했다(2026-10-15 역검증에서 잡았다).
 * 빈 채로 통과하는 시험을 만들지 않으려면 **자르는 범위가 곧 시험의 범위**여야 한다.
 */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} 이 사라졌다`);
  const end = source.indexOf("\nexport ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

describe("🔴 남의 건은 내 종에 안 뜬다 — 가르는 열쇠는 질의의 WHERE 다", () => {
  it("「결재 차례」는 **포털 번호**(approver_sub)로 좁힌다 — 열린 단계가 내 것일 때만 센다", () => {
    const fn = bodyOf(src("src/lib/approval/part-issue.ts"), "summarizePartIssueApprovalsToDecide");
    assert.ok(fn.includes("eq(stockIssueApprovalSteps.approverSub, approverSub)"), "결재 차례 집계가 포털 번호로 좁히지 않는다 — 남의 결재가 내 종에 뜨거나, A/S 번호라 영원히 0건이다");
    assert.ok(!fn.includes("approverUserId"), "A/S 번호로 좁히고 있다 — 오류 없이 영원히 0건이 된다");
    assert.ok(fn.includes('eq(stockIssueApprovalSteps.status, "REQUESTED")'), "이미 결재한 단계까지 세고 있다");
    assert.ok(fn.includes('eq(stockIssueApprovals.status, "PENDING_APPROVAL")'), "거둔 건·끝난 건까지 세고 있다");
  });

  it("「결재 결과」는 **올린 사람**(requested_by)으로 좁힌다 — 남이 올린 건은 안 온다", () => {
    const fn = bodyOf(src("src/lib/approval/part-issue.ts"), "listDecidedPartIssueApprovalsFor");
    assert.ok(fn.includes("eq(stockIssueApprovals.requestedBy, requesterUserId)"), "결재 결과가 사람으로 좁히지 않는다 — 남의 결재 결과가 내 종에 뜬다");
    assert.ok(fn.includes("inArray(stockIssueApprovals.status, [...DECIDED_ISSUE_APPROVAL_STATUSES])"), "상태 묶음을 손으로 적었다 — 조립과 갈라질 수 있다");
  });

  /**
   * 🔴 **두 번호를 바꿔 넘기면 조용히 깨진다**(2026-10-15 에 실제로 있었던 결함):
   * 「내 차례인가」는 포털 번호, 「내가 올린 건인가」는 이 시스템의 users.id 다.
   */
  it("🔴 질의에 넘기는 번호가 바뀌지 않았다 — 차례는 sub, 올린 건은 id", () => {
    const queries = src("src/lib/notifications/queries.ts");
    assert.ok(queries.includes("summarizePartIssueApprovalsToDecide(viewer.sub)"), "결재 차례를 users.id 로 묻고 있다 — 영원히 0건이 된다");
    assert.ok(queries.includes("listDecidedPartIssueApprovalsFor(viewer.id,"), "결재 결과를 포털 번호로 묻고 있다 — 영원히 0건이 된다");
  });
});

describe("🔴 두 통로가 포털 번호를 어디서 얻는가 — users 를 다시 읽지 않는다", () => {
  it("화면 쪽(머리말): 세션의 `authSub` 가 종까지 그대로 내려온다", () => {
    const layout = src("src/app/(app)/layout.tsx");
    const bell = src("src/components/HeaderNotificationBell.tsx");
    assert.ok(layout.includes("subject={session.user.authSub}"), "머리말이 포털 번호를 종에 안 넘긴다");
    assert.ok(bell.includes("listInventoryNotifications({ id: userId, role, sub: subject })"), "종이 포털 번호를 질의에 안 넘긴다 — 결재 줄이 영원히 안 뜬다");
  });

  it("포털 통로: 토큰의 sub 로 되짚은 **그 users 행**의 `authSub` 를 쓴다", () => {
    const route = src("src/app/api/integration/notifications/route.ts");
    assert.ok(route.includes("findActiveUserByAuthSub(verified.subject)"), "포털 통로가 사람을 되짚는 길이 바뀌었다");
    assert.ok(route.includes("listInventoryNotifications({ id: user.id, role: user.role, sub: user.authSub })"), "포털 통로가 포털 번호를 안 넘긴다 — 남의 시스템 종에서만 결재 줄이 빠진다");
    // 🔴 번호를 얻으려고 users 를 **한 번 더** 읽지 않는다 — 위에서 이미 통째로 읽었다.
    assert.equal(route.split("findActiveUserByAuthSub").length - 1, 2, "users 를 두 번 읽고 있다(import 1 + 호출 1 이어야 한다)");
  });
});

describe("🔴 7일은 한 자리에서만 긋는다 — 결재 반려도 그 함수를 지난다", () => {
  it("질의가 **같은 함수**로 두 선을 긋는다(rejectionCutoff)", () => {
    const queries = src("src/lib/notifications/queries.ts");
    assert.equal(queries.split("rejectionCutoff(now)").length - 1, 2, "반출 신청 반려와 결재 반려가 서로 다른 선을 쓰고 있다");
  });

  it("🔴 결재 쪽 질의에 날짜 계산을 손으로 적지 않았다 — 부르는 쪽이 건네준다", () => {
    const fn = bodyOf(src("src/lib/approval/part-issue.ts"), "listDecidedPartIssueApprovalsFor");
    assert.ok(!fn.includes("24 * 60 * 60 * 1000"), "결재 질의가 「며칠」을 스스로 세고 있다 — 두 벌이 되면 갈린다");
    assert.ok(!fn.includes("REJECTED_VISIBLE_DAYS"), "결재 질의가 기간 상수를 직접 들고 있다");
    // 🔴 승인에는 그 선이 걸리지 않는다 — 걸면 오래 묵은 승인이 조용히 사라진다.
    assert.ok(fn.includes('or(eq(stockIssueApprovals.status, "APPROVED"), gte(rejectedStep.decidedAt, rejectedSince))'), "반려 7일 선이 사라졌거나 승인 줄에도 걸렸다");
  });
});

describe("🔴 눌러서 열리는 줄인가 — 두 화면의 문을 **직접 읽고** 적었다", () => {
  it("`/approvals` 의 문은 `requireSession` 이다 — 역할로 막지 않는다", () => {
    const page = src("src/app/(app)/approvals/page.tsx");
    assert.ok(page.includes('requireSession("/approvals")'), "승인 요청건 화면의 문이 바뀌었다");
    // 🔵 `requireRole` 은 **주석에도** 나온다(실행 단추의 울타리를 가리키는 말이다). 그래서
    //    글자가 아니라 **문이 실제로 서는 자리** 둘로 잰다 — 가져오는 줄과 부르는 줄.
    assert.ok(page.includes('import { requireSession } from "@/lib/auth/session";'), "승인 요청건 화면이 세션 말고 다른 문을 가져오기 시작했다");
    assert.ok(!page.includes("await requireRole("), "승인 요청건 화면이 역할로 막기 시작했다 — 그러면 결재 두 줄에도 역할 관문이 필요하다(bell-items.ts 의 receives*)");
  });

  it("그래서 결재 두 줄에는 역할 관문이 없다 — 보기(VIEWER)도 눌러서 연다", () => {
    const feed = build({
      role: "VIEWER",
      issueApprovalsToDecide: { count: 1, oldestAt: NOW },
      decidedIssueApprovals: [approvedIssue()],
    });
    assert.equal(feed.items.length, 2);
    for (const item of feed.items) assert.equal(item.href, `${BASE}/approvals`);
  });

  it("🔵 반대로 `/requests` 는 기록 권한을 요구한다 — 그래서 반려 줄에는 관문이 있다", () => {
    const page = src("src/app/(app)/requests/page.tsx");
    assert.ok(page.includes('requireRole("STAFF"'), "부품 요청 관리의 문이 바뀌었다 — 반려 줄의 역할 관문을 다시 봐야 한다");
    assert.deepEqual(build({ role: "VIEWER", rejected: [rejected()] }).items, []);
  });
});
