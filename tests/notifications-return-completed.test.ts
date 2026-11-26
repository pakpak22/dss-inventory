import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REQUEST_STATUSES, type RequestStatus } from "../src/db/schema/stock-requests";
import {
  buildInventoryNotificationItems,
  issueApprovalDecidedNotificationId,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  receivesIssueApprovalDecidedNotification,
  rejectedNotificationId,
  rejectionCutoff,
  REJECTED_VISIBLE_DAYS,
  RETURN_COMPLETED_ID_PREFIX,
  returnCompletedNotificationId,
  type CompletedReturnSource,
  type DecidedIssueApprovalSource,
} from "../src/lib/notifications/bell-items";
import { COMPLETED_RETURN_STATUSES, isCompletedReturnStatus } from "../src/lib/stock/codes";
import { inventoryNotificationSettings } from "../src/lib/notifications/settings";

/**
 * ============================================================================
 * 「부품 반환이 완료되었습니다」 — **결재 결과 갈래에 얹은 줄** (2026-11-26)
 * ============================================================================
 * 쓰는 분 지시: 「[반환 요청]은 [확인대기]를, [반환 완료]시에는 [결재 결과]를 따르도록」.
 *
 * 🔴 **고친 것은 침묵이었다.** 반환은 결재를 타지 않아(`approval/route.ts` 의
 *    `isApprovalExemptRequestType`) 「결재 결과」 줄의 재료(`decidedIssueApprovals`)에 한 줄도
 *    들어가지 않았고, 그래서 [반환 완료]를 눌러도 **종이 한 번도 울리지 않았다.** 오류가 아니라
 *    침묵이라 아무도 신고하지 않는 자리다.
 *
 * 여기서 지키는 것:
 *  1. 완료된 반환에 줄이 선다 — 종류는 「결재 결과」 그대로이고, **새 갈래를 만들지 않았다.**
 *  2. 🔴 **반려·거둬진 반환에는 안 선다** — 물건이 돌아오지 않았는데 「완료」라고 하면 거짓말이다.
 *  3. 🔴 **신청한 본인에게만** 간다 — 질의의 WHERE 두 열쇠(`requested_by`·`requester_sub`).
 *  4. 🔴 **그 갈래를 끄면 함께 꺼진다** — 관문이 결재 결과와 **같은 함수** 하나다.
 *  5. 7일 선은 **기존 함수**(`isRejectionVisible`)로 긋는다 — 손으로 다시 적지 않았다.
 *  6. 알림 id 가 기존 결재 줄·반려 줄과 **안 겹친다.**
 *  7. 기존 결재 알림 셋은 **한 글자도 안 바뀐다.**
 *  8. 포털에 내주는 설명 둘에 반환 이야기가 들어 있고, **기존 문장은 그대로**다.
 * ============================================================================
 */

const BASE = "http://192.168.1.132:3800";
const SOURCE = "dss-inventory";
const NOW = new Date("2026-11-26T09:00:00+09:00");
const DECIDED_AT = new Date("2026-11-26T02:30:00+09:00");

/** 값은 전부 가짜다 — 공개 저장소다(사람 이름·고객사명을 넣지 않는다). */
function completedReturn(over: Partial<CompletedReturnSource> = {}): CompletedReturnSource {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    status: "CONFIRMED",
    summary: "반환 · 2026-11-26 · D260001 · No. 7 가짜부품 ×2",
    decidedByName: "재고담당",
    decidedAt: DECIDED_AT,
    ...over,
  };
}

function approvedIssue(over: Partial<DecidedIssueApprovalSource> = {}): DecidedIssueApprovalSource {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    status: "APPROVED",
    summary: "사용 · 2026-11-20 · D260002 · No. 7 가짜부품 ×2",
    requestedAt: new Date("2026-11-20T10:00:00+09:00"),
    decidedByName: null,
    decidedAt: null,
    decidedBy: { kind: "UNDECIDED" },
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
    lowStockParts: [],
    completedReturns: [],
    now: NOW,
    baseUrl: BASE,
    sourceId: SOURCE,
    ...over,
  });
}

/* ── 소스로 지키는 것(질의와 관문) ──────────────────────────────────────
 * 질의는 DB 를 읽으므로 여기서 돌려 볼 수 없다. `tests/integration-approvals-route-source.test.ts`
 * 와 같은 방식으로 **글자로** 못 박는다. 🔴 주석은 먼저 걷어 낸다 — 주석에 적힌 낱말이
 * 시험을 통과시키면 그 시험은 아무것도 재지 않는다. */
const ROOT = process.cwd();
function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}
function withoutComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const requestsSource = withoutComments(read("src/lib/stock/requests.ts"));
const queriesSource = withoutComments(read("src/lib/notifications/queries.ts"));
const bellItemsSource = withoutComments(read("src/lib/notifications/bell-items.ts"));

describe("반환 완료 — 줄이 선다", () => {
  it("🔴 [반환 완료]된 반환에 「결재 결과」 줄이 한 줄 선다", () => {
    const feed = build({ completedReturns: [completedReturn()] });
    assert.equal(feed.items.length, 1, "줄이 서지 않았다 — 이 시험이 아무것도 못 본다");
    const item = feed.items[0];
    assert.equal(item.kind, NOTIFICATION_KINDS.issueApprovalDecided);
    assert.equal(item.kindLabel, "결재 결과");
    assert.equal(item.subject, "부품 반환이 완료되었습니다");
    assert.equal(item.detail, "반환 · 2026-11-26 · D260001 · No. 7 가짜부품 ×2 · 재고담당 받음 · 2026-11-26");
    assert.equal(item.id, returnCompletedNotificationId("77777777-7777-4777-8777-777777777777"));
    assert.equal(item.key, `${SOURCE}:${item.id}`);
    assert.equal(feed.count, 1);
  });

  /**
   * 🔴 **새 갈래를 만들지 않았다**(쓰는 분 지시). 갈래를 하나 더 만들면 포털 설정 화면에 줄이
   * 하나 더 생기고, 쓰는 분이 「결재 결과」를 꺼도 반환 알림은 그대로 온다 — 「따르도록」의 반대다.
   */
  it("🔴 알림 종류가 다섯 그대로다 — 반환 때문에 갈래가 늘지 않았다", () => {
    assert.equal(Object.keys(NOTIFICATION_KINDS).length, 5);
    assert.ok(!Object.values(NOTIFICATION_KINDS).some((kind) => kind.includes("RETURN")), "반환 전용 갈래가 생겼다");
    assert.equal(Object.keys(NOTIFICATION_KIND_LABELS).length, 5);
    // 포털에 내주는 표도 같은 다섯 줄이다(설정 표는 NOTIFICATION_KINDS 를 그대로 돈다).
    assert.equal(inventoryNotificationSettings().kinds.length, 5);
  });

  it("가는 곳은 부품 요청 관리다 — 결재건이 없어 승인 요청건에는 그 신청이 없다", () => {
    const feed = build({ completedReturns: [completedReturn()] });
    assert.equal(feed.items[0].href, `${BASE}/requests`);
  });

  it("담당자 이름이 없으면 그 토막만 빠진다 — 지어내지 않는다", () => {
    const feed = build({ completedReturns: [completedReturn({ decidedByName: null })] });
    assert.equal(feed.items[0].detail, "반환 · 2026-11-26 · D260001 · No. 7 가짜부품 ×2 · 2026-11-26");
  });

  it("여러 건이면 건마다 한 줄이다 — 묶지 않는다(어느 반환인지가 알맹이다)", () => {
    const feed = build({
      completedReturns: [completedReturn({ id: "a" }), completedReturn({ id: "b" })],
    });
    assert.deepEqual(
      feed.items.map((i) => i.id),
      [returnCompletedNotificationId("a"), returnCompletedNotificationId("b")],
    );
    assert.equal(feed.count, 2);
  });

  it("🔴 상한에 잘린 줄이 있으면 배지는 **자르기 전의 수**를 말한다", () => {
    const feed = build({ completedReturns: [completedReturn()], completedReturnsTotal: 412 });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.count, 412);
  });
});

describe("반환 완료 — 안 서는 자리", () => {
  /**
   * 🔴 **이 시험이 이 조각의 울타리다.** 거둬진 반환에 「완료」가 뜨면 기사는 돌려준 적 없는
   * 부품을 돌려준 것으로 읽는다. 오류가 아니라 **그럴듯한 거짓말**이라 아무도 신고하지 않는다.
   */
  it("🔴 거둬지거나 반려된 반환에는 줄이 안 선다 — CONFIRMED 하나만 줄이 된다", () => {
    const making: RequestStatus[] = [];
    for (const status of REQUEST_STATUSES) {
      const feed = build({ completedReturns: [completedReturn({ status })] });
      if (feed.items.length > 0) making.push(status);
      // 줄이 없으면 배지도 0 이어야 한다 — 숫자만 남으면 눌러서 빈 종이 된다.
      if (feed.items.length === 0) assert.equal(feed.count, 0, status);
    }
    assert.deepEqual(making, [...COMPLETED_RETURN_STATUSES], "줄이 서는 상태 묶음이 codes.ts 의 한 벌과 다르다");
    for (const status of ["CANCELLED", "REJECTED", "PENDING", "ON_HOLD", "IN_APPROVAL", "PARTIAL", "CONFIRMING"] as const) {
      assert.equal(isCompletedReturnStatus(status), false, status);
    }
    assert.equal(isCompletedReturnStatus("CONFIRMED"), true);
  });

  it("🔴 결정 시각이 비어 있으면 줄이 안 선다 — 7일 선을 그을 수 없다", () => {
    const feed = build({ completedReturns: [completedReturn({ decidedAt: null })] });
    assert.deepEqual(feed.items, []);
    assert.equal(feed.count, 0);
  });

  /**
   * 🔴 7일은 **반려 줄과 같은 함수**가 긋는다(`isRejectionVisible`). 반환 완료는 이미 끝난 일이라
   * 승인 줄처럼 기간 제한 없이 남겨 둘 까닭이 없다.
   */
  it("🔴 끝난 지 7일이 지나면 사라진다 — 선은 rejectionCutoff 그대로다", () => {
    const cutoff = rejectionCutoff(NOW);
    const onTheLine = build({ completedReturns: [completedReturn({ decidedAt: cutoff })] });
    assert.equal(onTheLine.items.length, 1, "선 위(정확히 7일)는 보여야 한다");
    const justBefore = build({ completedReturns: [completedReturn({ decidedAt: new Date(cutoff.getTime() - 1) })] });
    assert.deepEqual(justBefore.items, [], "선을 1밀리초 넘긴 줄이 남아 있다");
    assert.equal(justBefore.count, 0);
  });

  it("🔴 7일을 손으로 다시 적지 않았다 — 조립이 isRejectionVisible 로 거른다", () => {
    const block = bellItemsSource.slice(bellItemsSource.indexOf("for (const row of input.completedReturns)"));
    const end = block.indexOf("returnShown += 1;");
    assert.ok(end > 0, "반환 줄을 세는 자리를 찾지 못했다 — 시험이 엉뚱한 곳을 보고 있다");
    const guard = block.slice(0, end);
    assert.ok(guard.includes("isRejectionVisible(row.decidedAt, input.now)"), "7일 선을 같은 함수로 긋지 않는다");
    assert.ok(!/\b7\b/.test(guard), "7 을 손으로 적었다");
    assert.ok(guard.includes("isCompletedReturnStatus(row.status)"), "상태를 한 번 더 거르지 않는다");
  });
});

describe("🔴 「결재 결과」 갈래를 따른다 — 끄면 함께 꺼진다", () => {
  /**
   * 🔴 쓰는 분 지시의 알맹이다. 반환 줄이 제 관문을 따로 세우면 포털에서 「결재 결과」를 꺼도
   * 반환 알림만 남고, 끈 사람은 왜 하나가 남는지 알 수 없다.
   */
  it("🔴 조립: 반환 줄이 결재 결과와 **같은 관문**(showDecided) 안에 있다", () => {
    const gateAt = bellItemsSource.indexOf("const showDecided = receivesIssueApprovalDecidedNotification();");
    const loopAt = bellItemsSource.indexOf("for (const row of input.completedReturns)");
    const countAt = bellItemsSource.indexOf("let returnCount = 0;");
    assert.ok(gateAt > 0 && loopAt > gateAt, "반환 줄이 관문보다 앞에 있다");
    // 관문 블록은 `if (showDecided) {` 로 열리고 반환 고리가 그 안에 있다.
    const openAt = bellItemsSource.indexOf("if (showDecided) {", gateAt);
    assert.ok(openAt > 0 && openAt < loopAt, "관문 블록 밖에서 반환 줄을 만든다");
    // 배지 숫자도 같은 관문을 지난다.
    const countBlock = bellItemsSource.slice(countAt, countAt + 400);
    assert.ok(countBlock.includes("if (showDecided) {"), "배지 숫자가 관문을 안 지난다");
  });

  it("🔴 질의: 그 갈래가 아니면 **묻지도 않는다** — 관문 함수가 같다", () => {
    assert.match(queriesSource, /receivesIssueApprovalDecidedNotification\(\) \? listCompletedReturnsFor\(/);
    // 결재 결과 줄도 같은 함수를 관문으로 쓴다 — 두 줄이 한 스위치에 매여 있다.
    assert.equal((queriesSource.match(/receivesIssueApprovalDecidedNotification\(\)/g) ?? []).length, 2);
  });

  /**
   * 🔵 그 함수는 오늘 언제나 참이다(역할로 가르지 않는다 — `/approvals` 의 문이 `requireSession`).
   * 끄고 켜는 일은 포털이 한다. 여기서 재는 것은 **관문이 하나**라는 사실이다.
   */
  it("관문이 참인 동안에는 세 역할 모두 줄을 받는다 — 역할로 가르지 않는다", () => {
    for (const role of ["VIEWER", "STAFF", "ADMIN"] as const) {
      const feed = build({ role, completedReturns: [completedReturn()] });
      assert.equal(feed.items.length > 0, receivesIssueApprovalDecidedNotification(), role);
    }
  });
});

describe("🔴 신청한 본인에게만 간다 — 질의의 열쇠", () => {
  /** 질의 본문을 글자로 못 박는다(DB 를 읽어 여기서 돌려 볼 수 없다). */
  const query = requestsSource.slice(requestsSource.indexOf("export async function listCompletedReturnsFor("));

  it("🔴 두 열쇠(users.id · 포털 번호) 중 하나라도 맞는 신청만 가져온다", () => {
    assert.ok(query.length > 0, "질의를 찾지 못했다 — 시험이 엉뚱한 곳을 보고 있다");
    const where = query.slice(0, query.indexOf(".orderBy("));
    assert.ok(where.includes("or(eq(stockRequests.requestedBy, who.userId), eq(stockRequests.requesterSub, who.requesterSub))"), "본인 조건이 두 열쇠가 아니다");
  });

  it("🔴 반환만, 완료된 것만, 선 안의 것만 가져온다", () => {
    const where = query.slice(0, query.indexOf(".orderBy("));
    assert.ok(where.includes('eq(stockRequests.type, "RETURN")'), "종류로 안 좁힌다 — 반출까지 알리게 된다");
    assert.ok(where.includes("inArray(stockRequests.status, [...COMPLETED_RETURN_STATUSES])"), "상태 묶음을 손으로 적었다");
    assert.ok(where.includes("gte(stockRequests.decidedAt, since)"), "7일 선을 질의가 안 긋는다");
  });

  it("🔴 보는 사람의 값으로 묻는다 — 요청이 고르는 값이 아니다", () => {
    assert.match(queriesSource, /listCompletedReturnsFor\(\{ userId: viewer\.id, requesterSub: viewer\.sub \}, rejectionCutoff\(now\), NOTIFICATION_MAX_ITEMS\)/);
  });
});

describe("🔴 알림 id 가 기존 줄과 안 겹친다", () => {
  const sameUuid = "88888888-8888-4888-8888-888888888888";

  it("같은 번호라도 세 모양이 서로 다르다", () => {
    const ids = [returnCompletedNotificationId(sameUuid), issueApprovalDecidedNotificationId(sameUuid), rejectedNotificationId(sameUuid)];
    assert.equal(new Set(ids).size, 3, `열쇠가 겹친다: ${ids.join(" / ")}`);
    assert.ok(returnCompletedNotificationId(sameUuid).startsWith(`${RETURN_COMPLETED_ID_PREFIX}:`));
  });

  it("🔴 앞머리가 서로를 삼키지 않는다 — 한쪽이 다른 쪽의 앞머리이면 안 된다", () => {
    const prefixes = [RETURN_COMPLETED_ID_PREFIX, "ISSUE_APPROVAL_DECIDED", "REQUEST_REJECTED", "PART_LOW_STOCK"];
    for (const a of prefixes) for (const b of prefixes) if (a !== b) assert.ok(!`${a}:`.startsWith(`${b}:`), `${a} 가 ${b} 에 삼켜진다`);
  });

  /** 🔴 겹치면 조립의 `seen` 이 **뒤엣것을 말없이 버린다** — 그 사실을 값으로 잰다. */
  it("🔴 같은 번호의 결재건과 반환이 함께 있어도 두 줄 다 남는다", () => {
    const feed = build({
      decidedIssueApprovals: [approvedIssue({ id: sameUuid })],
      completedReturns: [completedReturn({ id: sameUuid })],
    });
    assert.equal(feed.items.length, 2, "한 줄이 말없이 사라졌다");
    assert.equal(feed.count, 2);
    assert.deepEqual(
      feed.items.map((i) => i.subject),
      ["불출 결재가 승인되었습니다", "부품 반환이 완료되었습니다"],
    );
  });
});

describe("🔴 기존 결재 알림은 한 글자도 안 바뀐다", () => {
  const decided: DecidedIssueApprovalSource[] = [
    approvedIssue(),
    approvedIssue({ id: "33333333-3333-4333-8333-333333333333", status: "REJECTED", decidedByName: "결재자", decidedAt: DECIDED_AT, decidedBy: { kind: "SELF" } }),
    approvedIssue({ id: "44444444-4444-4444-8444-444444444444", status: "EXECUTION_REJECTED", decidedByName: "재고담당", decidedAt: DECIDED_AT, decidedBy: { kind: "UNDECIDED" } }),
  ];

  it("반환 줄이 섞여도 결재 줄 셋의 글자·주소·열쇠가 그대로다", () => {
    const before = build({ decidedIssueApprovals: decided });
    const after = build({ decidedIssueApprovals: decided, completedReturns: [completedReturn()] });
    assert.equal(before.items.length, 3, "견줄 표본이 비었다");
    assert.deepEqual(after.items.slice(0, 3), before.items, "기존 결재 줄이 달라졌다");
    assert.equal(after.items.length, 4);
    assert.equal(after.count, before.count + 1);
  });

  it("결재 줄 셋과 반환 줄의 제목이 서로 다르다 — 같은 색이라 글자가 유일한 구분이다", () => {
    const feed = build({ decidedIssueApprovals: decided, completedReturns: [completedReturn()] });
    const subjects = feed.items.map((i) => i.subject);
    assert.equal(new Set(subjects).size, 4, `제목이 겹친다: ${subjects.join(" / ")}`);
    for (const item of feed.items) assert.equal(item.kind, NOTIFICATION_KINDS.issueApprovalDecided);
  });

  it("승인 줄은 여전히 기간 제한이 없다 — 반환의 7일이 옮아붙지 않았다", () => {
    const old = approvedIssue({ requestedAt: new Date("2026-01-01T00:00:00+09:00") });
    const feed = build({ decidedIssueApprovals: [old], completedReturns: [] });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].subject, "불출 결재가 승인되었습니다");
  });
});

describe("🔴 포털에 내주는 설명 — 반환이 적혀 있다", () => {
  const kinds = inventoryNotificationSettings().kinds;
  const pending = kinds.find((k) => k.kind === NOTIFICATION_KINDS.pending);
  const decided = kinds.find((k) => k.kind === NOTIFICATION_KINDS.issueApprovalDecided);

  it("「확인 대기」 설명에 반환 신청이 함께 세어진다고 적혀 있다", () => {
    assert.ok(pending);
    assert.ok(pending.description.includes("반환"), pending.description);
    assert.ok(pending.description.includes("[반환 완료]"), "사라지는 조건이 안 적혀 있다");
    // 🔴 기존 문장을 지우지 않았다 — 덧붙였을 뿐이다.
    assert.ok(pending.description.startsWith("확인을 기다리는 반출 신청이 있으면 건수를 종에 띄웁니다. 다 내주거나 반려하면 사라집니다. 일부만 내준 신청은 남은 수량이 있어 그대로 남습니다."));
  });

  it("「결재 결과」 설명에 반환 완료의 받는 사람·기간·안 뜨는 경우가 적혀 있다", () => {
    assert.ok(decided);
    const text = decided.description;
    assert.ok(text.includes("자기가 올린 부품 반환 신청"), text);
    assert.ok(text.includes("[반환 완료]"), "무엇을 누르면 뜨는지가 안 적혀 있다");
    assert.ok(text.includes(`반환 완료도 ${REJECTED_VISIBLE_DAYS}일이 지나면 사라집니다`), "7일이 안 적혀 있다");
    assert.ok(text.includes("반려되거나 거둬진 반환 신청은"), "안 뜨는 경우가 안 적혀 있다");
    assert.ok(text.startsWith("자기가 올린 부품 불출 결재가 승인되거나 반려되면 종에 띄웁니다."), "기존 문장이 지워졌다");
  });

  it("🔴 설명의 7일은 손으로 적은 숫자가 아니다 — 상수에서 온다", () => {
    assert.ok(decided);
    assert.equal(REJECTED_VISIBLE_DAYS, 7);
    const settingsSource = withoutComments(read("src/lib/notifications/settings.ts"));
    const line = settingsSource.slice(settingsSource.indexOf("[NOTIFICATION_KINDS.issueApprovalDecided]:"));
    const body = line.slice(0, line.indexOf("`,") + 1);
    assert.ok(!/\b7일\b/.test(body), "7일을 글자로 박아 넣었다");
    assert.ok(body.includes("${REJECTED_VISIBLE_DAYS}일"), "상수를 안 쓴다");
  });
});
