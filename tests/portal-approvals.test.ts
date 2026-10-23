import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPortalApprovalInbox,
  PART_ISSUE_APPROVAL_KIND,
  PART_ISSUE_APPROVAL_KIND_LABEL,
  portalApprovalItemId,
  toPortalApprovalItem,
} from "../src/lib/notifications/portal-approvals";
import type { PartIssueView } from "../src/lib/approval/part-issue-rules";

/**
 * ============================================================================
 * 통합 승인함에 내줄 목록 — DB 없이 그대로 돌려 본다
 * ============================================================================
 * 여기서 지키는 것:
 *  · 🔴 대상 사람은 **토큰이 실어 온 sub** 하나로만 정해진다. 부르는 쪽이 남의
 *    번호를 끼워 넣을 자리가 없다.
 *  · 🔴 「결재할 차례인가」를 이 파일이 판정하지 않는다 — **조회가 준 줄만** 나온다.
 *  · 절대 주소 · ISO 8601 · 열쇠의 유일성 · count = items.length.
 *
 * 🔴 값은 전부 가짜다 — 실제 고객사 · 사람 이름을 적지 않는다.
 * ============================================================================
 */

const BASE = "http://192.168.0.13:3800";
const SUBJECT = "portal-user-0001";
/** 되짚어 낸 재고 관리 계정의 포털 번호. 🔴 토큰의 sub 와 **다른 값**이어야 시험이 뜻을 갖는다. */
const AUTH_SUB = "portal-inventory-approver-0002";
const APPROVAL_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_APPROVAL_ID = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<PartIssueView> = {}): PartIssueView {
  return {
    id: APPROVAL_ID,
    requestId: "33333333-3333-4333-8333-333333333333",
    routeId: "44444444-4444-4444-8444-444444444444",
    status: "PENDING_APPROVAL",
    quantities: [],
    reason: "재작업용 부품 반출",
    requestedBy: "55555555-5555-4555-8555-555555555555",
    requestedByName: "홍길동",
    requestedAt: "2026-10-20T01:00:00.000Z",
    entryId: null,
    executedByName: null,
    executedAt: null,
    requestSummary: "사용 · 2026-10-20 · No.123 가짜부품",
    requestType: "USE",
    requestNote: "",
    currentStep: null,
    ...overrides,
  };
}

/** 조회를 가짜로 끼우고 한 번 부른다. 어느 번호로 물었는지도 함께 돌려준다. */
async function inboxOf(options: { actorValue?: { authSub: string } | null; rows?: PartIssueView[]; baseUrl?: string }) {
  const askedForActor: string[] = [];
  const askedApprovals: string[] = [];
  const inbox = await buildPortalApprovalInbox({
    subject: SUBJECT,
    baseUrl: options.baseUrl ?? BASE,
    findActor: async (subject) => {
      askedForActor.push(subject);
      return options.actorValue === undefined ? { authSub: AUTH_SUB } : options.actorValue;
    },
    listPendingApprovals: async (approverSub) => {
      askedApprovals.push(approverSub);
      return options.rows ?? [];
    },
  });
  return { inbox, askedForActor, askedApprovals };
}

describe("승인함 한 줄 만들기", () => {
  it("갈래 · 이름표 · 제목 · 보탬 · 때 · **절대 주소**가 짝이 맞는다", () => {
    const item = toPortalApprovalItem(row(), BASE);
    assert.equal(item.kind, PART_ISSUE_APPROVAL_KIND);
    assert.equal(item.kindLabel, "부품 불출 결재");
    assert.equal(item.kindLabel, PART_ISSUE_APPROVAL_KIND_LABEL);
    assert.equal(item.subject, "사용 · 2026-10-20 · No.123 가짜부품");
    assert.equal(item.detail, "사용 · 결재 올린 사람 홍길동");
    assert.equal(item.requestedAt, "2026-10-20T01:00:00.000Z");
    assert.equal(item.href, `${BASE}/approvals#approval-${APPROVAL_ID}`);
    assert.equal(item.id, `PART_ISSUE_APPROVAL:${APPROVAL_ID}`);
  });

  it("🔴 신청 종류마다 보탬의 말이 바뀐다 — 조회가 준 값을 그대로 옮길 뿐이다", () => {
    const item = toPortalApprovalItem(row({ requestType: "RECEIVE", requestedByName: "김재고" }), BASE);
    assert.equal(item.detail, "입고 · 결재 올린 사람 김재고");
  });

  it("🔴 기준 주소가 비면 던진다 — 상대 주소를 조용히 내보내지 않는다", () => {
    assert.throws(() => toPortalApprovalItem(row(), ""));
    assert.throws(() => toPortalApprovalItem(row(), "/approvals"));
  });

  it("같은 결재건에는 언제나 같은 열쇠다", () => {
    assert.equal(portalApprovalItemId(APPROVAL_ID), portalApprovalItemId(APPROVAL_ID));
    assert.notEqual(portalApprovalItemId(APPROVAL_ID), portalApprovalItemId(OTHER_APPROVAL_ID));
  });
});

describe("buildPortalApprovalInbox — 대상 사람", () => {
  it("🔴 되짚는 열쇠는 토큰의 sub 다 — 다른 값이 끼어들 자리가 없다", async () => {
    const { askedForActor } = await inboxOf({ rows: [row()] });
    assert.deepEqual(askedForActor, [SUBJECT]);
  });

  it("🔴 조회는 **되짚은 계정의 포털 번호**로만 부른다 — 토큰의 sub 를 그대로 흘려 넣지 않는다", async () => {
    const { askedApprovals } = await inboxOf({ rows: [row()] });
    assert.deepEqual(askedApprovals, [AUTH_SUB]);
    // 되짚은 번호가 토큰의 sub 와 다르므로, sub 가 그대로 흘러들면 여기서 잡힌다.
    assert.ok(!askedApprovals.includes(SUBJECT));
  });

  it("🔴 이 시스템에 계정이 없는 사람은 빈 목록이다 — 오류가 아니고, 조회를 부르지도 않는다", async () => {
    const { inbox, askedApprovals } = await inboxOf({ actorValue: null, rows: [row()] });
    assert.deepEqual(inbox, { items: [], count: 0 });
    assert.deepEqual(askedApprovals, []);
  });
});

describe("buildPortalApprovalInbox — 목록", () => {
  it("조회가 준 줄 그대로 나오고, count 는 items.length 다", async () => {
    const { inbox } = await inboxOf({
      rows: [row(), row({ id: OTHER_APPROVAL_ID, requestedAt: "2026-10-21T00:00:00.000Z" })],
    });
    assert.equal(inbox.items.length, 2);
    assert.equal(inbox.count, inbox.items.length);
    assert.equal(new Set(inbox.items.map((item) => item.id)).size, 2);
  });

  it("🔴 조회가 주지 않은 건은 한 줄도 만들지 않는다 — 자격 판정이 여기 없다는 뜻", async () => {
    const { inbox } = await inboxOf({ rows: [] });
    assert.deepEqual(inbox, { items: [], count: 0 });
  });

  it("🔴 모든 주소가 절대 주소다", async () => {
    const { inbox } = await inboxOf({ rows: [row(), row({ id: OTHER_APPROVAL_ID })] });
    assert.equal(inbox.items.length, 2);
    for (const item of inbox.items) {
      assert.ok(item.href.startsWith(`${BASE}/`), `상대 주소가 섞였다: ${item.href}`);
    }
  });

  it("🔴 requestedAt 이 ISO 8601 이다", async () => {
    const { inbox } = await inboxOf({ rows: [row()] });
    assert.equal(inbox.items.length, 1);
    const item = inbox.items[0];
    assert.match(item.requestedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(new Date(item.requestedAt).toISOString(), item.requestedAt);
  });

  it("조회가 정한 차례를 그대로 둔다 — 여기서 다시 정렬하지 않는다", async () => {
    const first = row({ id: APPROVAL_ID, requestedAt: "2026-10-22T00:00:00.000Z" });
    const second = row({ id: OTHER_APPROVAL_ID, requestedAt: "2026-10-20T00:00:00.000Z" });
    const { inbox } = await inboxOf({ rows: [first, second] });
    assert.deepEqual(
      inbox.items.map((item) => item.id),
      [portalApprovalItemId(APPROVAL_ID), portalApprovalItemId(OTHER_APPROVAL_ID)],
    );
  });
});
