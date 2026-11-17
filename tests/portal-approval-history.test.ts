import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { partIssueHistoryRole, type PartIssueApprovalHistoryRow, type PartIssueHistoryRole, type PartIssueHistoryStep } from "../src/lib/approval/part-issue-history";
import { APPROVAL_ROUTE_SCOPE_LABELS } from "../src/lib/approval/route";
import {
  PORTAL_APPROVAL_HISTORY_LIMIT,
  buildPortalApprovalHistory,
  parseApprovalHistoryPeriod,
  portalApprovalHistoryItemId,
  portalApprovalHistoryRelation,
  toPortalApprovalHistoryEntry,
  type PortalApprovalHistoryEntry,
} from "../src/lib/notifications/portal-approval-history";

/**
 * ============================================================================
 * 결재 내역을 밖으로 내주는 모양 — 세 집이 **글자 그대로** 맞춘 계약 (2026-11-17, 조각 10b)
 * ============================================================================
 * 여기서 지키는 것:
 *  · 🔴 **갈래 네 값이 각각 무엇으로 나가는가.** 이 집의 `UNRECORDED` 가 계약의 `UNKNOWN` 이다
 *    — 바꿔 적는 자리가 어긋나도 **오류가 나지 않는다.** 「내가 한 결재」가 「남이 대신한 것」
 *    으로 보이는 식으로 조용히 틀린다.
 *  · 🔴 **상대 이름이 거꾸로 붙지 않는다.** `ON_BEHALF` 의 상대는 자리 주인, `BY_DELEGATE` 의
 *    상대는 누른 사람이다.
 *  · 🔴 **칸 이름이 계약 그대로다.** 하나만 달라도 승인함에서 **이 집 것만** 조용히 안 그려진다.
 *  · 🔴 **열쇠에 단계 번호가 들어간다** — 같은 결재건의 두 줄 중 하나가 사라지지 않게.
 *  · 🔴 **기간 경계를 손대지 않는다** — 보정이 두 벌이 되면 경계 시각의 결재가 두 기간에 뜬다.
 *  · 🔴 이 집에 계정이 없는 사람은 **빈 목록**이다 — 오류가 아니다.
 *
 * 🔴 **값은 전부 가짜다** — 실제 사람 이름·고객사·품번을 적지 않는다(공개 저장소로 나갈 수 있다).
 * ============================================================================
 */

/* 🔴 전부 가짜 번호·가짜 이름이다. */
const ME = "portal-sub-me-0001";
const OTHER = "portal-sub-other-0002";
const THIRD = "portal-sub-third-0003";

const MY_NAME = "가 결재자";
const OWNER_NAME = "나 자리주인";
const DELEGATE_NAME = "다 대리인";

const BASE = "http://192.168.0.13:3800";
const APPROVAL_ID = "99999999-9999-4999-8999-999999999999";
const DECIDED_AT = new Date("2026-11-10T02:00:00.000Z");

/** 조회가 돌려주는 한 줄. 기본값은 **내가 내 자리를 직접 누른** 줄이다. */
function row(over: Partial<PartIssueApprovalHistoryRow> = {}): PartIssueApprovalHistoryRow {
  return {
    approvalId: APPROVAL_ID,
    stepOrder: 1,
    scope: "PART_ISSUE",
    scopeLabel: APPROVAL_ROUTE_SCOPE_LABELS.PART_ISSUE,
    summary: "사용 · 2026-11-10 · No.123 가짜부품 ×2",
    requestType: "USE",
    requestedByName: "라 신청자",
    decision: "APPROVED",
    decidedAt: DECIDED_AT.toISOString(),
    note: "",
    approverName: MY_NAME,
    role: { kind: "SELF" },
    href: `${BASE}/approvals#approval-${APPROVAL_ID}`,
    ...over,
  };
}

/** 단계 한 줄 — 🔵 갈래를 **손으로 적지 않고** 10a 의 판정 함수로 뽑아 오기 위한 것이다. */
function step(over: Partial<PartIssueHistoryStep>): PartIssueHistoryStep {
  return { approverSub: ME, approverName: MY_NAME, decidedAt: DECIDED_AT, decidedBySub: ME, decidedByName: MY_NAME, ...over };
}

describe("① 🔴 갈래 네 값이 계약의 글자로 바뀐다 — `UNRECORDED` → `UNKNOWN`", () => {
  /**
   * 🔴 **갈래를 손으로 적지 않는다.** 10a 의 판정 함수가 실제로 내주는 네 값을 그대로 넣는다 —
   * 손으로 적으면 그쪽이 다섯째 갈래를 내기 시작해도 이 시험은 영영 통과한다.
   */
  const roles: PartIssueHistoryRole[] = [
    partIssueHistoryRole(step({}), ME)!,
    partIssueHistoryRole(step({ approverSub: OTHER, approverName: OWNER_NAME, decidedBySub: ME, decidedByName: MY_NAME }), ME)!,
    partIssueHistoryRole(step({ decidedBySub: THIRD, decidedByName: DELEGATE_NAME }), ME)!,
    partIssueHistoryRole(step({ decidedBySub: null, decidedByName: null }), ME)!,
  ];

  it("🔵 표본이 비지 않았다 — 네 갈래가 **실제로** 나왔다", () => {
    assert.equal(roles.filter((r) => r != null).length, 4);
    assert.deepEqual(
      roles.map((r) => r.kind),
      ["SELF", "ON_BEHALF", "BY_DELEGATE", "UNRECORDED"],
    );
  });

  it("🔴 네 값이 각각 무엇으로 나가는가 — 바꿔 적는 자리가 어긋나도 오류가 안 나는 자리다", () => {
    assert.deepEqual(
      roles.map((r) => portalApprovalHistoryRelation(r)),
      [
        { relation: "SELF", counterpartName: null },
        { relation: "ON_BEHALF", counterpartName: OWNER_NAME },
        { relation: "BY_DELEGATE", counterpartName: DELEGATE_NAME },
        { relation: "UNKNOWN", counterpartName: null },
      ],
    );
  });

  it("🔴 `UNRECORDED` 라는 글자는 **밖으로 나가지 않는다** — 그리고 넷이 서로 다른 값이다", () => {
    const relations = roles.map((r) => portalApprovalHistoryRelation(r).relation);
    assert.ok(!relations.includes("UNRECORDED" as never), "집 안쪽 이름이 그대로 새어 나간다");
    assert.equal(new Set(relations).size, 4, "넷 중 둘이 같은 값으로 뭉개졌다");
  });

  it("🔴 상대 이름이 **거꾸로** 붙지 않는다 — 대신한 쪽과 대신 받은 쪽", () => {
    // 내가 대신 눌렀으면 상대는 **자리 주인**이다. 내 이름이 오면 거꾸로 붙은 것이다.
    assert.equal(portalApprovalHistoryRelation({ kind: "ON_BEHALF", approverName: OWNER_NAME }).counterpartName, OWNER_NAME);
    // 내 자리를 남이 눌렀으면 상대는 **누른 사람**이다.
    assert.equal(portalApprovalHistoryRelation({ kind: "BY_DELEGATE", delegateName: DELEGATE_NAME }).counterpartName, DELEGATE_NAME);
  });

  it("🔵 이름이 안 적힌 대리 줄은 **지어내지 않는다** — `null` 그대로 간다", () => {
    assert.deepEqual(portalApprovalHistoryRelation({ kind: "BY_DELEGATE", delegateName: null }), { relation: "BY_DELEGATE", counterpartName: null });
  });
});

describe("② 🔴 한 줄의 칸이 계약 그대로다 — 하나만 달라도 이 집 것만 안 그려진다", () => {
  /** 🔴 계약의 여덟 칸. 세 집이 글자 그대로 같아야 한다. */
  const CONTRACT_FIELDS = ["id", "subject", "approvalName", "decidedAt", "decision", "relation", "counterpartName", "href"] as const;

  it("칸이 **여덟 개뿐**이다 — 모자라지도 남지도 않는다", () => {
    const entry = toPortalApprovalHistoryEntry(row());
    assert.deepEqual(Object.keys(entry).sort(), [...CONTRACT_FIELDS].sort());
  });

  it("값이 조회의 줄에서 **그대로** 온다 — 통로가 글자를 새로 짓지 않는다", () => {
    const entry = toPortalApprovalHistoryEntry(row({ decision: "REJECTED", scopeLabel: APPROVAL_ROUTE_SCOPE_LABELS.PART_ISSUE_MATCHER }));
    assert.equal(entry.subject, "사용 · 2026-11-10 · No.123 가짜부품 ×2");
    // 🔵 「무슨 결재인가」는 이 집의 갈래 이름표다 — 표는 `approval/route.ts` 하나뿐이고
    //    조회가 `partIssueScopeLabel` 로 이미 풀어 온다.
    assert.equal(entry.approvalName, "매쳐 부품 불출");
    assert.equal(entry.decidedAt, DECIDED_AT.toISOString());
    assert.equal(entry.decision, "REJECTED");
  });

  it("🔴 주소는 **절대 주소**다 — 승인함은 다른 사이트라 상대 주소를 제 주소로 읽는다", () => {
    const entry = toPortalApprovalHistoryEntry(row());
    assert.ok(entry.href.startsWith("http://"), `절대 주소가 아니다: ${entry.href}`);
    assert.equal(entry.href, `${BASE}/approvals#approval-${APPROVAL_ID}`);
  });

  it("🔴 포털 번호가 한 칸도 실리지 않는다 — 남의 신원이 브라우저로 나가지 않게", () => {
    const entry = toPortalApprovalHistoryEntry(row({ role: { kind: "ON_BEHALF", approverName: OWNER_NAME } }));
    const dumped = JSON.stringify(entry);
    for (const sub of [ME, OTHER, THIRD]) {
      assert.ok(!dumped.includes(sub), `포털 번호가 실려 나간다: ${sub}`);
    }
  });
});

describe("③ 🔴 열쇠에 **단계 번호**가 들어간다 — 같은 건의 두 줄이 겹치지 않게", () => {
  it("같은 결재건의 두 단계가 **다른 열쇠**를 받는다", () => {
    // 🔴 결재선은 같은 사람을 두 단계에 넣는 것을 막지 않는다. 열쇠를 결재건 번호만으로 지으면
    //    승인함 목록에서 둘 중 하나가 사라진다.
    const first = toPortalApprovalHistoryEntry(row({ stepOrder: 1 }));
    const third = toPortalApprovalHistoryEntry(row({ stepOrder: 3, role: { kind: "BY_DELEGATE", delegateName: DELEGATE_NAME } }));
    assert.notEqual(first.id, third.id);
    assert.ok(first.id.includes(APPROVAL_ID) && third.id.includes(APPROVAL_ID));
  });

  it("같은 단계에는 **언제나 같은 열쇠**가 나온다 — 다시 물어도 목록이 흔들리지 않게", () => {
    assert.equal(portalApprovalHistoryItemId(APPROVAL_ID, 2), portalApprovalHistoryItemId(APPROVAL_ID, 2));
    assert.equal(portalApprovalHistoryItemId(APPROVAL_ID, 2), `PART_ISSUE_APPROVAL:${APPROVAL_ID}:2`);
  });
});

describe("④ 🔴 기간 — 못 읽으면 거절하고, 읽은 경계는 **손대지 않는다**", () => {
  it("ISO 8601 두 값을 읽는다", () => {
    const parsed = parseApprovalHistoryPeriod({ from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" });
    assert.ok(parsed.ok);
    assert.equal(parsed.period.from.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(parsed.period.to.toISOString(), "2026-12-01T00:00:00.000Z");
  });

  it("🔴 **하나라도 없으면** 거절한다 — 기간 없이 통째로 내주는 길이 없다", () => {
    const missing = [
      { from: null, to: null },
      { from: "2026-11-01T00:00:00.000Z", to: null },
      { from: null, to: "2026-12-01T00:00:00.000Z" },
    ];
    assert.equal(missing.length, 3); // 🔵 표본이 비어서 공짜로 통과하지 않게.
    for (const input of missing) {
      assert.equal(parseApprovalHistoryPeriod(input).ok, false, `기간 없이 통과한다: ${JSON.stringify(input)}`);
    }
  });

  it("🔴 **못 읽는 글자**는 거절한다 — 그리고 숫자 하나가 26년치 기간으로 둔갑하지 않는다", () => {
    // 🔴 `"0"` 이 여기 있는 까닭: `new Date("0")` 은 `NaN` 이 **아니라** 1999-12-31 이다(실측).
    //    `NaN` 으로만 거르면 `?from=0` 이 오류도 없이 **26년치 기간**으로 읽히고, 목록도 비지
    //    않아 아무도 모른다.
    const bad = ["", "   ", "어제", "2026-13-99T00:00:00Z", "null", "0", "1", "1762000000000", "2026"];
    assert.equal(bad.length, 9);
    for (const value of bad) {
      assert.equal(parseApprovalHistoryPeriod({ from: value, to: "2026-12-01T00:00:00.000Z" }).ok, false, `못 읽는 시작을 받았다: "${value}"`);
      assert.equal(parseApprovalHistoryPeriod({ from: "2026-11-01T00:00:00.000Z", to: value }).ok, false, `못 읽는 끝을 받았다: "${value}"`);
    }
  });

  /**
   * 🔴 **시간대가 없는 글자는 「어느 순간인지」가 정해지지 않는다.**
   *
   * `Date` 는 그것을 오류로 보지 않고 **읽는 기계의 지역 시간**으로 읽는다 — 그래서 같은
   * 요청이 개발 PC(KST)와 NAS 컨테이너(UTC)에서 **아홉 시간 다른 기간**이 된다. 위의
   * `"0"`·`"2026"` 과 같은 종류인데 **훨씬 그럴듯해 보여서 더 위험하다.**
   * 🔵 증상이 「월말(또는 월초) 하루치가 안 보인다」 하나뿐이라 시험이 아니면 못 잡는다.
   */
  it("🔴 **시간대가 없는 글자**는 거절한다 — 개발 PC 와 NAS 가 아홉 시간 어긋나는 자리", () => {
    const zoneless = [
      "2026-11-01T00:00:00", // T 까지 붙었는데 끝에 `Z` 도 `+09:00` 도 없다
      "2026-11-01T00:00:00.000", // 밀리초까지 붙어도 시간대가 없으면 같다
      "2026-11-01T00:00", // 초를 줄인 꼴도 마찬가지
      "2026-11-01 00:00:00Z", // T 자리에 공백 — 모양이 아예 다르다
    ];
    assert.equal(zoneless.length, 4); // 🔵 표본이 비어서 공짜로 통과하지 않게.
    for (const value of zoneless) {
      assert.equal(parseApprovalHistoryPeriod({ from: value, to: "2026-12-01T00:00:00.000Z" }).ok, false, `시간대 없는 시작을 받았다: "${value}"`);
      assert.equal(parseApprovalHistoryPeriod({ from: "2026-11-01T00:00:00.000Z", to: value }).ok, false, `시간대 없는 끝을 받았다: "${value}"`);
    }
  });

  it("🔴 **날짜만** 적은 글자도 거절한다 — 첫날 아홉 시간이 조용히 빠지는 자리", () => {
    // `new Date("2026-11-01")` 은 UTC 자정이라 **한국 시간 11월 1일 오전 9시**다. 「11월」을
    // 물었는데 1일 0시~9시에 난 결재가 통째로 빠지고, 오류는 나지 않는다.
    assert.equal(parseApprovalHistoryPeriod({ from: "2026-11-01", to: "2026-12-01T00:00:00.000Z" }).ok, false);
    assert.equal(parseApprovalHistoryPeriod({ from: "2026-11-01T00:00:00.000Z", to: "2026-12-01" }).ok, false);
  });

  it("🔵 포털이 보낼 만한 꼴은 **전부 통과한다** — 좁게 받는 집만 승인함에서 빠진다", () => {
    // 세 집이 **같은 정규식**을 쓰기로 해서 좁힐 수 있었다(2026-11-17). 그래도 포털이 실제로
    // 보낼 꼴은 다 받아야 한다 — 거절하면 이 집 줄만 조용히 사라진다.
    const good = ["2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00Z", "2026-11-01T09:00:00+09:00", "2026-11-01T00:00Z", "2026-11-01t00:00:00z"];
    assert.equal(good.length, 5);
    for (const value of good) {
      assert.equal(parseApprovalHistoryPeriod({ from: value, to: "2026-12-01T00:00:00.000Z" }).ok, true, `포털이 보낼 꼴을 거절한다: "${value}"`);
    }
  });

  it("🔴 경계를 **1ms 도 보정하지 않는다** — 끝을 빼는 일은 조회의 `lt` 하나가 한다", () => {
    // 🔴 여기서도 보정하면 규칙이 두 벌이 되고, 한쪽만 고쳐지는 날 **잇대어 적은 두 위임의
    //    경계 시각**에 결재된 건이 양쪽 기간에 모두 뜬다. 받은 값이 그대로 나오는지만 본다.
    const from = "2026-11-01T09:30:15.123Z";
    const to = "2026-11-30T23:59:59.999Z";
    const parsed = parseApprovalHistoryPeriod({ from, to });
    assert.ok(parsed.ok);
    assert.equal(parsed.period.from.getTime(), Date.parse(from));
    assert.equal(parsed.period.to.getTime(), Date.parse(to));
  });

  it("🔵 뒤집힌 기간은 **거절하지 않는다** — 읽을 수 없는 값이 아니라 아무것도 안 걸리는 값이다", () => {
    // 계약에 없는 400 을 이 집에서만 내면, 승인함은 그것을 이 집의 고장으로 읽는다.
    const parsed = parseApprovalHistoryPeriod({ from: "2026-12-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
    assert.equal(parsed.ok, true);
  });
});

describe("⑤ 🔴 사람은 토큰에서만 — 그리고 이 집에 없는 사람은 **빈 목록**이다", () => {
  /** 조회를 흉내 낸다. 🔵 **무엇을 받았는지**를 적어 두고 그것까지 잰다. */
  function fakeHistory(rows: PartIssueApprovalHistoryRow[]) {
    const calls: Array<{ sub: string; from: Date; to: Date; baseUrl: string; limit: number }> = [];
    return {
      calls,
      listHistory: async (args: { sub: string; from: Date; to: Date; baseUrl: string; limit: number }) => {
        calls.push(args);
        return { rows };
      },
    };
  }

  const PERIOD = { from: new Date("2026-11-01T00:00:00.000Z"), to: new Date("2026-12-01T00:00:00.000Z") };

  it("계정이 있으면 줄이 내려온다 — 🔵 표본이 비어서 공짜로 통과하지 않게 먼저 센다", async () => {
    const fake = fakeHistory([row(), row({ stepOrder: 2, role: { kind: "ON_BEHALF", approverName: OWNER_NAME } })]);
    const out = await buildPortalApprovalHistory({
      subject: ME,
      period: PERIOD,
      baseUrl: BASE,
      limit: PORTAL_APPROVAL_HISTORY_LIMIT,
      findActor: async (authSub) => ({ authSub }),
      listHistory: fake.listHistory,
    });
    assert.equal(out.entries.length, 2);
    assert.deepEqual(
      out.entries.map((e: PortalApprovalHistoryEntry) => e.relation),
      ["SELF", "ON_BEHALF"],
    );
    // 받은 기간을 그대로 넘긴다 — 통로가 중간에서 하루를 더하거나 빼지 않는다.
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].from.getTime(), PERIOD.from.getTime());
    assert.equal(fake.calls[0].to.getTime(), PERIOD.to.getTime());
    assert.equal(fake.calls[0].limit, PORTAL_APPROVAL_HISTORY_LIMIT);
  });

  it("🔴 이 집에 계정이 없으면 **빈 목록**이다 — 오류가 아니고, 조회에 닿지도 않는다", async () => {
    // 🔴 한 집이 오류를 뱉으면 포털이 나머지 둘까지 못 그릴 수 있다.
    const fake = fakeHistory([row()]);
    const out = await buildPortalApprovalHistory({
      subject: ME,
      period: PERIOD,
      baseUrl: BASE,
      limit: PORTAL_APPROVAL_HISTORY_LIMIT,
      findActor: async () => null,
      listHistory: fake.listHistory,
    });
    assert.deepEqual(out, { entries: [] });
    assert.equal(fake.calls.length, 0, "계정도 못 찾았는데 결재 내역을 읽었다");
  });

  it("🔴 조회에 넘기는 번호는 **되짚은 DB 의 값**이다 — 토큰 글자를 그대로 싣지 않는다", async () => {
    // 🔵 이 집은 `auth_sub` 가 포털 `sub` 그대로라 평소에는 같은 값이다. 그래도 **되짚은 줄의
    //    값**을 쓰는 것이 옆 통로들과 같은 관례다 — 그 관례가 지켜지는지를 일부러 다른 값으로 잰다.
    const fake = fakeHistory([]);
    await buildPortalApprovalHistory({
      subject: ME,
      period: PERIOD,
      baseUrl: BASE,
      limit: 7,
      findActor: async () => ({ authSub: OTHER }),
      listHistory: fake.listHistory,
    });
    assert.equal(fake.calls[0].sub, OTHER);
  });

  it("🔴 사람을 고를 자리가 **`subject` 하나뿐**이다 — 부르는 쪽이 남의 번호를 끼워 넣을 틈이 없다", async () => {
    const asked: string[] = [];
    await buildPortalApprovalHistory({
      subject: ME,
      period: PERIOD,
      baseUrl: BASE,
      limit: PORTAL_APPROVAL_HISTORY_LIMIT,
      findActor: async (authSub) => {
        asked.push(authSub);
        return null;
      },
      listHistory: fakeHistory([]).listHistory,
    });
    assert.deepEqual(asked, [ME]);
  });
});
