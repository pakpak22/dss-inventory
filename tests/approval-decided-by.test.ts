import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { APPROVAL_DELEGATE_UNNAMED, approvalDecidedByName, approvalDelegateSuffix } from "../src/lib/approval/delegate-label";
import { approvalStepActor, type ApprovalStepActor } from "../src/lib/approval/delegation";
import { PART_ISSUE_TRAIL_DELEGATE_UNNAMED, partIssueTrailDelegateLabel } from "../src/lib/approval/part-issue-screen";
import { toApiRequestStatus, type RequestStatusSource } from "../src/lib/api/stock-request-status";
import { buildInventoryNotificationItems, type DecidedIssueApprovalSource, type RejectedRequestSource } from "../src/lib/notifications/bell-items";
import { requestDecisionNote, type RequestDecisionActor } from "../src/lib/stock/codes";

/**
 * ============================================================================
 * 같은 반려를 **두 자리가 같은 사람 이름으로** 말하는가 (2026-10-22)
 * ============================================================================
 * 2026-10-22 전까지 대리인이 반려하면 이랬다:
 *
 *  | 어디 | 누구 이름이 떴나 |
 *  |---|---|
 *  | 알림 종 「불출 결재가 반려되었습니다」 | **원래 결재권자** (단계 줄의 `approver_name`) |
 *  | 부품 요청 관리의 반려 사유 상자 | **실제로 누른 사람** (`stock_requests.decided_by_name`) |
 *
 * 🔴 **오류가 안 나고 둘 다 그럴듯해서 아무도 신고하지 않는다.** 그래서 이 시험은 두 자리를
 * **맞대어** 잰다 — 한쪽만 고치면 여기서 깨진다.
 *
 * 🔵 **기준은 바로 앞 조각(결재선 그림)이 세웠다 — 원래 결재권자가 주(主), 대리인이 종(從).**
 *    그림은 상자가 좁아 두 줄로 세우고(윗줄 이름 · 아랫줄 작고 흐린 꼬리), 글줄로 말하는 두
 *    자리는 **한 덩이**로 적는다(「김결재 (이대리 대리)」). 글자를 짓는 함수는 셋 다 하나다.
 *
 * ── 🔴 이 저장소에는 DB 시험도 화면 렌더 시험도 없다 ───────────────────
 * 그래서 「무슨 말을 하는가」는 순수 함수로 재고(①~③), 「그 말이 **실제로 그 자리까지 갔는가**」는
 * 소스 글자로 잰다(④). `tests/part-issue-delegation.test.ts` 가 같은 방식을 쓴다.
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* 본보기 — 🔴 값은 전부 가짜다(공개 저장소다).                           */
/* ------------------------------------------------------------------ */

const OWNER = "김결재";
const DELEGATE = "이대리";
const DECIDED_AT = new Date("2026-10-22T10:00:00+09:00");

/** 「그 자리를 누가 눌렀나」 — **운영이 지나는 길 그대로** 만든다(갈래를 손으로 적지 않는다). */
const actorOf = (over: { decidedBySub: string | null; decidedByName: string | null }): ApprovalStepActor =>
  approvalStepActor({ approverSub: "sub-kim", decidedAt: DECIDED_AT, ...over });

/** 대리인이 눌렀다 — 번호가 자리 주인과 다르다. */
const DELEGATED = actorOf({ decidedBySub: "sub-lee", decidedByName: DELEGATE });
/** 본인이 눌렀다. */
const SELF = actorOf({ decidedBySub: "sub-kim", decidedByName: OWNER });
/** 🔴 **옛 줄** — `decided_by_*` 칸이 생기기(2026-10-21) 전에 결재된 줄이다. 「본인」이 아니다. */
const UNRECORDED = actorOf({ decidedBySub: null, decidedByName: null });

/* ---- 알림 종 쪽 ---- */

const BASE = "http://192.168.1.132:3800";
const NOW = new Date("2026-10-22T18:00:00+09:00");

function bellDetail(over: Partial<DecidedIssueApprovalSource>): string {
  const feed = buildInventoryNotificationItems({
    role: "ADMIN",
    pending: { count: 0, oldestAt: null },
    rejected: [],
    issueApprovalsToDecide: { count: 0, oldestAt: null },
    decidedIssueApprovals: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        status: "REJECTED",
        summary: "사용 · 2026-10-22 · D260003 · No. 7 가짜부품 ×2",
        requestedAt: new Date("2026-10-22T09:00:00+09:00"),
        // 🔴 **결재선에 적힌 분**이다 — 질의가 단계 줄의 `approver_name` 을 싣는다.
        decidedByName: OWNER,
        decidedAt: DECIDED_AT,
        decidedBy: DELEGATED,
        ...over,
      },
    ],
    lowStockParts: [],
    now: NOW,
    baseUrl: BASE,
    sourceId: "dss-inventory",
  });
  assert.equal(feed.items.length, 1, "종에 줄이 하나가 아니다");
  return feed.items[0].detail;
}

/* ---- 반려 사유 상자 쪽 ---- */

/** 결재에서 반려된 신청 한 줄. 🔴 신청에 적힌 이름은 **실제로 누른 사람**이다(집행이 그렇게 적는다). */
function box(decidedVia: RequestDecisionActor | null, decidedByName: string | null = DELEGATE) {
  const view = requestDecisionNote(
    { status: "REJECTED", closed: false, decisionNote: "재고가 없습니다", decidedByName, decidedAt: DECIDED_AT.toISOString() },
    decidedVia,
  );
  assert.ok(view, "반려 사유 상자가 서지 않는다");
  return view;
}

const via = (decidedBy: ApprovalStepActor): RequestDecisionActor => ({ approverName: OWNER, decidedBy });

/* ------------------------------------------------------------------ */

describe("① 🔴 대리인이 반려하면 **두 자리가 같은 말**을 한다", () => {
  it("🔴 종과 반려 사유 상자에 **같은 이름 글자**가 선다 — 이 조각의 전부다", () => {
    const name = `${OWNER} (${DELEGATE} 대리)`;
    assert.equal(box(via(DELEGATED)).byName, name);
    assert.ok(bellDetail({}).includes(`${name} 반려`), `종이 다른 말을 한다: ${bellDetail({})}`);
  });

  it("🔴 **원래 결재권자가 앞**이고 대리인은 괄호 안이다 — 주와 종이 뒤집히지 않았다", () => {
    const byName = box(via(DELEGATED)).byName;
    assert.ok(byName.startsWith(OWNER), `결재선에 적힌 분이 앞이 아니다: ${byName}`);
    assert.ok(byName.endsWith(`(${DELEGATE} 대리)`), `누른 사람이 괄호로 매달리지 않았다: ${byName}`);
  });

  it("🔴 **누른 사람이 사라지지 않는다** — 둘 다 그 이름을 들고 있다", () => {
    // 🔴 「원래 결재권자로 맞춘다」가 「대리인을 지운다」가 되면, 누가 실제로 눌렀는지를
    //    감사 로그에서만 알 수 있게 된다.
    assert.ok(box(via(DELEGATED)).byName.includes(DELEGATE));
    assert.ok(bellDetail({}).includes(DELEGATE));
  });

  it("🔵 이름이 안 적힌 대리 줄도 「(null 대리)」를 그리지 않는다 — 아는 것만 말한다", () => {
    const unnamed = actorOf({ decidedBySub: "sub-lee", decidedByName: null });
    assert.equal(box(via(unnamed)).byName, `${OWNER} ${APPROVAL_DELEGATE_UNNAMED}`);
    assert.ok(!box(via(unnamed)).byName.includes("null"));
    assert.ok(bellDetail({ decidedBy: unnamed }).includes(`${OWNER} ${APPROVAL_DELEGATE_UNNAMED} 반려`));
  });
});

describe("② 🔴 본인이 눌렀으면 **꼬리가 안 붙는다** — 지금까지와 한 글자도 다르지 않다", () => {
  it("상자에 이름 하나만", () => {
    // 🔵 본인이 눌렀으면 신청에 적힌 이름과 결재선에 적힌 이름이 애초에 같다.
    assert.equal(box(via(SELF), OWNER).byName, OWNER);
  });

  it("종에도 이름 하나만", () => {
    assert.ok(bellDetail({ decidedBy: SELF }).includes(`${OWNER} 반려`));
    assert.ok(!bellDetail({ decidedBy: SELF }).includes("대리"));
  });
});

describe("③ 🔴 옛 줄(`decided_by_sub` 가 `NULL`)은 **이름 하나**다 — 과거를 지어내지 않는다", () => {
  /**
   * 🔴 2026-10-21 이전의 결재에는 누가 눌렀는지가 **어디에도 안 적혀 있다.** 그때는 위임 기능
   *    자체가 없어서 적힌 사람이 누른 것이 **사실상 맞지만**, 「사실상 맞다」와 「적혀 있다」는
   *    다른 말이다. 그래서 화면에서만 본인과 같게 보이고 **갈래로는 끝까지 갈려 있다.**
   */
  it("상자에도 종에도 이름 하나만 — 「모른다」를 적으면 옛 결재가 전부 수상해 보인다", () => {
    assert.equal(box(via(UNRECORDED), OWNER).byName, OWNER);
    assert.ok(bellDetail({ decidedBy: UNRECORDED }).includes(`${OWNER} 반려`));
    assert.ok(!bellDetail({ decidedBy: UNRECORDED }).includes("대리"));
  });

  it("🔴 그래도 **본인과 한 값으로 뭉개지지 않았다** — 합치면 옛 줄이 「본인이 눌렀다」가 된다", () => {
    assert.equal(UNRECORDED.kind, "UNRECORDED");
    assert.notEqual(UNRECORDED.kind, SELF.kind);
    // 🔵 화면에서만 같다.
    assert.equal(box(via(UNRECORDED), OWNER).byName, box(via(SELF), OWNER).byName);
  });
});

describe("④ 🔴 **실행 대기 반려**도 같은 말을 한다 — 거기엔 대리인이 아예 없다", () => {
  /**
   * 🔴 그 건에는 **반려된 단계 줄이 하나도 없다**(단계는 전부 승인으로 닫힌 뒤에 막혔다). 막은
   *    사람은 결재자가 아니라 **담당자**이고 그 자리는 결재선에 **아예 없으므로**, 대리인이라는
   *    개념 자체가 없다 — 「맞출 수 없다」가 아니라 **맞출 것이 없다.**
   * 🔵 그래서 질의의 leftJoin 이 비어 와 `UNDECIDED` 가 되고, 꼬리가 안 붙는다. 상자 쪽도
   *    키가 아예 없어(`null`) 신청에 적힌 담당자 이름 하나만 선다. 🔴 **두 자리가 같은 말이다.**
   */
  it("종에 담당자 이름 하나만 — 꼬리가 안 붙는다", () => {
    const detail = bellDetail({ status: "EXECUTION_REJECTED", decidedByName: "재고담당", decidedBy: { kind: "UNDECIDED" } });
    assert.ok(detail.includes("재고담당 반려"), detail);
    assert.ok(!detail.includes("대리"), detail);
  });

  it("상자에도 담당자 이름 하나만 — 결재 단계가 없어 `null` 이 온다", () => {
    assert.equal(box(null, "재고담당").byName, "재고담당");
  });

  it("🔵 승인 줄도 같은 모양이다 — 반려된 단계가 없어 꼬리가 없다", () => {
    const detail = bellDetail({ status: "APPROVED", decidedByName: null, decidedAt: null, decidedBy: { kind: "UNDECIDED" } });
    assert.ok(!detail.includes("대리"), detail);
    assert.ok(!detail.includes("반려"), detail);
  });
});

describe("⑤ 글자를 짓는 자리는 **하나**다 — 결재선 그림까지 셋이 같은 말을 한다", () => {
  it("🔴 그림의 꼬리와 글줄의 꼬리가 **같은 글자**다", () => {
    assert.equal(partIssueTrailDelegateLabel(DELEGATED), approvalDelegateSuffix(DELEGATED));
    assert.equal(PART_ISSUE_TRAIL_DELEGATE_UNNAMED, APPROVAL_DELEGATE_UNNAMED);
    // 🔵 한 덩이는 「이름 + 한 칸 + 꼬리」다 — 그림은 그 꼬리를 아랫줄에 세울 뿐이다.
    assert.equal(approvalDecidedByName(OWNER, DELEGATED), `${OWNER} ${partIssueTrailDelegateLabel(DELEGATED)}`);
  });

  it("갈래 넷 전수 — 대리에만 꼬리가 있다", () => {
    assert.equal(approvalDelegateSuffix({ kind: "DELEGATED", delegateName: DELEGATE }), `(${DELEGATE} 대리)`);
    assert.equal(approvalDelegateSuffix({ kind: "DELEGATED", delegateName: null }), APPROVAL_DELEGATE_UNNAMED);
    assert.equal(approvalDelegateSuffix({ kind: "SELF" }), null);
    assert.equal(approvalDelegateSuffix({ kind: "UNRECORDED" }), null);
    assert.equal(approvalDelegateSuffix({ kind: "UNDECIDED" }), null);
    for (const actor of [{ kind: "SELF" } as const, { kind: "UNRECORDED" } as const, { kind: "UNDECIDED" } as const]) {
      assert.equal(approvalDecidedByName(OWNER, actor), OWNER);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 아래는 **순수 함수로는 닿지 않는 자리**를 글자로 못 박는 시험이다.      */
/* 🔴 DB 조건절도 화면도 아무도 돌려 보지 못한 채 운영으로 나간다(머리말).  */
/* ------------------------------------------------------------------ */

/** 🔴 줄바꿈을 LF 로 눕혀서 읽는다 — 이 저장소의 소스는 CRLF 가 섞여 있다. */
const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("⑥ 🔴 **두 자리가 같은 함수를 지난다** — 글자가 두 벌이 되면 또 두 얼굴이 된다", () => {
  it("종의 조립도 반려 사유 상자도 `approvalDecidedByName` 을 부른다", () => {
    for (const path of ["src/lib/notifications/bell-items.ts", "src/lib/stock/codes.ts"]) {
      assert.ok(src(path).includes("approvalDecidedByName("), `${path} 가 이름을 손으로 짓는다`);
    }
  });

  it("🔴 **갈래를 다시 가르는 자리가 없다** — 옛 줄이 「본인」으로 둔갑하는 길", () => {
    for (const path of ["src/lib/notifications/bell-items.ts", "src/lib/stock/codes.ts", "src/components/stock/RequestManagerScreen.tsx"]) {
      const file = src(path);
      assert.ok(!/decidedBy\.kind|kind === "DELEGATED"|kind === "UNRECORDED"/.test(file), `${path} 가 갈래를 직접 가른다`);
      assert.ok(!/대리\)|대리`|대리"/.test(file.replace(/^\s*[*/].*$/gm, "")), `${path} 에 대리 글자가 손으로 적혀 있다`);
    }
  });
});

describe("⑦ 🔴 종의 질의가 「누가 눌렀나」를 **같은 줄에서** 들고 온다 — 칸을 더하지 않았다", () => {
  const server = src("src/lib/approval/part-issue.ts");

  it("반려된 단계 줄에서 세 칸을 더 고르고 갈래는 `approvalStepActor` 가 가린다", () => {
    for (const column of ["rejectedStep.approverSub", "rejectedStep.decidedBySub", "rejectedStep.decidedByName"]) {
      assert.ok(server.includes(column), `${column} 을(를) 안 싣는다 — 대리인이 종에서 사라진다`);
    }
    assert.ok(server.includes("decidedBy: approvalStepActor("), "종이 갈래를 손으로 가른다");
  });

  it("🔴 **줄이 없으면 `null` 을 넘긴다** — 실행 대기 반려가 「본인」으로 둔갑하지 않게", () => {
    // `approver_sub` 는 표에서 NOT NULL 이라 **그 칸이 비었다는 것은 곧 줄이 없다는 뜻**이다.
    assert.ok(server.includes("r.rejectedApproverSub === null"), "leftJoin 이 비어 온 줄을 가리지 않는다");
  });
});

describe("⑧ 🔴 반려 사유 상자가 **원래 결재권자에 닿는 길** — 서버가 찾아 실어 보낸다", () => {
  const data = src("src/lib/approval/part-issue-screen-data.ts");
  const page = src("src/app/(app)/requests/page.tsx");
  const screen = src("src/components/stock/RequestManagerScreen.tsx");

  it("🔴 **진행 그림으로는 못 닿는다** — 반려되는 순간 결재건이 닫혀 그 묶음에서 빠진다", () => {
    // 🔵 그래서 조회가 따로 섰다. 둘이 보는 묶음이 다르다는 것을 글자로 남겨 둔다 —
    //    「이미 와 있는 자료를 또 읽는다」로 오해해 지우면 이 화면만 다시 두 얼굴이 된다.
    assert.ok(data.includes("export async function readPartIssueRejectionActorsByRequest("), "닫힌 결재건을 읽는 조회가 사라졌다");
    assert.ok(data.includes('eq(stockIssueApprovalSteps.status, "REJECTED")'), "반려된 단계로 좁히지 않는다");
  });

  it("🔴 **같은 사건인가를 시각으로 못 박는다** — 담당자가 따로 반려한 줄에 결재자 이름이 붙지 않게", () => {
    assert.ok(
      data.includes("eq(stockRequests.decidedAt, stockIssueApprovalSteps.decidedAt)"),
      "신청의 결정 시각과 단계의 결정 시각을 견주지 않는다 — 엉뚱한 사람 이름이 붙는 줄이 생긴다",
    );
  });

  it("🔴 판정은 **서버가 끝낸다** — 화면이 받는 모양에 포털 번호가 없다", () => {
    assert.ok(data.includes("decidedBy: approvalStepActor({ approverSub: r.approverSub"), "서버가 갈래를 안 가린다");
    const codes = src("src/lib/stock/codes.ts");
    const type = codes.slice(codes.indexOf("export interface RequestDecisionActor"));
    assert.ok(!/Sub(\??):\s*string/.test(type.slice(0, type.indexOf("\n}"))), "화면이 받는 모양에 포털 번호 칸이 생겼다 — 신원이 브라우저로 실려 나간다");
  });

  it("화면까지 실제로 이어져 있다 — 페이지가 읽어 넘기고, 상자가 받아 쓴다", () => {
    assert.ok(page.includes("readPartIssueRejectionActorsByRequest("), "페이지가 그 조회를 안 부른다");
    assert.ok(page.includes("decisionActors={decisionActors}"), "페이지가 화면에 안 넘긴다");
    assert.ok(screen.includes("decidedVia={decisionActors[r.id] ?? null}"), "상자가 받은 값을 안 쓴다");
    assert.ok(screen.includes("requestDecisionNote(request, decidedVia)"), "상자가 순수 함수를 안 거친다");
  });

  it("🔴 **신청의 `decided_by_name` 칸은 그대로다** — 감사 쪽이 그 값을 쓴다", () => {
    // 🔵 이 조각은 **보여 줄 때 두 이름을 합치는** 일만 했다. 집행이 적는 값을 바꾸면
    //    「실제로 누른 사람」이 어디에도 안 남는다.
    const server = src("src/lib/approval/part-issue.ts");
    assert.ok(
      server.includes("decidedBy: actor.id, decidedByName: actor.name, decidedAt: now, decisionNote: note"),
      "결재 반려가 신청에 적는 값이 바뀌었다 — 감사 쪽 근거가 사라진다",
    );
  });
});

/* ------------------------------------------------------------------ */
/* 세 번째 자리 — 알림 종의 「반출 신청이 반려되었습니다」(②) 와           */
/* A/S 로 내주는 통로(`decision.byName`) (2026-10-22)                    */
/* ------------------------------------------------------------------ */

/** 알림 종의 ② 줄 — 「반출 신청이 반려되었습니다」(`notifications/bell-items.ts`). */
function rejectedLineDetail(over: Partial<RejectedRequestSource> = {}): string {
  const feed = buildInventoryNotificationItems({
    role: "STAFF",
    pending: { count: 0, oldestAt: null },
    rejected: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        summary: "사용 · 2026-10-22 · D260003 · No. 7 가짜부품 ×2",
        // 🔴 **그릴 이름의 주(主)** — 결재를 거쳤으면 결재선에 적힌 분(`listRejectedRequestsFor`
        //    가 신청 표의 값보다 이 이름을 앞세운다), 결재를 거치지 않았으면 반려한 그 담당자다.
        //    여기(기본값)는 「결재를 거쳐 대리인이 반려한」 경우라 **결재선에 적힌 분**이 온다.
        decidedByName: OWNER,
        decidedAt: DECIDED_AT,
        decidedBy: DELEGATED,
        ...over,
      },
    ],
    issueApprovalsToDecide: { count: 0, oldestAt: null },
    decidedIssueApprovals: [],
    lowStockParts: [],
    now: NOW,
    baseUrl: BASE,
    sourceId: "dss-inventory",
  });
  assert.equal(feed.items.length, 1, "종에 줄이 하나가 아니다");
  return feed.items[0].detail;
}

/** A/S 가 되읽는 신청 한 줄의 재료. 🔴 **운영이 지나는 길 그대로**(`decidedVia`)를 바꿔 가며 잰다. */
const API_SOURCE: RequestStatusSource = {
  id: "77777777-7777-4777-8777-777777777777",
  type: "USE",
  status: "REJECTED",
  intakeNumber: "D260003",
  requesterSub: null,
  requestedByName: "예시 신청자",
  requestedAt: "2026-10-22T09:00:00.000Z",
  note: "",
  lines: [],
  // 🔴 신청 표에 적힌 이름 — 결재를 거치지 않았을 때(`decidedVia: null`)는 이 값 하나만 나간다.
  decidedByName: DELEGATE,
  decidedAt: DECIDED_AT.toISOString(),
  decisionNote: "재고가 없습니다",
  decidedVia: null,
  hold: null,
  issueLock: null,
};

/** A/S 가 받는 `decision.byName`. */
function apiByName(decidedVia: RequestDecisionActor | null): string {
  const q = toApiRequestStatus("AS-1", { ...API_SOURCE, decidedVia });
  assert.ok(q.decision, "decision 이 서지 않았다 — decidedAt 이 있는데 null 이 왔다");
  return q.decision.byName;
}

describe("⑨ 🔴 알림 종의 두 줄(②·③)이 같은 말을 한다 — 「반출 신청이 반려되었습니다」 ↔ 「불출 결재가 반려되었습니다」", () => {
  it("대리인이 반려하면 둘 다 같은 이름 글자다", () => {
    const name = `${OWNER} (${DELEGATE} 대리)`;
    assert.ok(rejectedLineDetail({}).includes(`${name} 반려`), rejectedLineDetail({}));
    assert.ok(bellDetail({}).includes(`${name} 반려`), bellDetail({}));
  });

  it("본인이 반려하면 둘 다 꼬리가 없다", () => {
    assert.ok(rejectedLineDetail({ decidedBy: SELF, decidedByName: OWNER }).includes(`${OWNER} 반려`));
    assert.ok(!rejectedLineDetail({ decidedBy: SELF, decidedByName: OWNER }).includes("대리"));
  });

  it("🔴 결재를 거치지 않았으면(`UNDECIDED`) 신청 표의 이름 하나다 — 담당자가 화면에서 직접 반려한 경우", () => {
    const detail = rejectedLineDetail({ decidedBy: { kind: "UNDECIDED" }, decidedByName: "담당자" });
    assert.ok(detail.includes("담당자 반려"), detail);
    assert.ok(!detail.includes("대리"), detail);
  });

  it("🔴 옛 줄(`UNRECORDED`)도 이름 하나다 — 과거를 지어내지 않는다", () => {
    const detail = rejectedLineDetail({ decidedBy: UNRECORDED, decidedByName: OWNER });
    assert.ok(detail.includes(`${OWNER} 반려`), detail);
    assert.ok(!detail.includes("대리"), detail);
  });
});

describe("⑩ 🔴 A/S 로 내주는 통로(`decision.byName`)도 같은 말을 한다 (2026-10-22, 쓰는 분 결정)", () => {
  it("세 자리(반려 사유 상자 · 알림 종 · A/S 통로)가 같은 글자를 쓴다 — 대리인이 반려했을 때", () => {
    const name = `${OWNER} (${DELEGATE} 대리)`;
    assert.equal(box(via(DELEGATED)).byName, name);
    assert.ok(bellDetail({}).includes(`${name} 반려`));
    assert.equal(apiByName(via(DELEGATED)), name);
  });

  it("본인이 반려했으면 세 자리 모두 꼬리가 없다", () => {
    assert.equal(apiByName(via(SELF)), OWNER);
    assert.ok(!apiByName(via(SELF)).includes("대리"));
  });

  it("🔴 결재를 거치지 않았으면(`decidedVia: null`) 신청 표의 이름 하나다 — 지금까지와 한 글자도 다르지 않다", () => {
    assert.equal(apiByName(null), DELEGATE);
  });

  it("🔵 모양은 그대로다 — `byName` 은 여전히 글자 하나다(칸을 더하거나 쪼개지 않는다)", () => {
    assert.equal(typeof apiByName(via(DELEGATED)), "string");
  });

  it("🔴 **같은 함수를 쓴다** — `approvalDecidedByName` 을 새로 적지 않는다(넷째 벌을 만들지 않는다)", () => {
    const status = src("src/lib/api/stock-request-status.ts");
    assert.ok(status.includes("approvalDecidedByName("), "A/S 통로가 이름을 손으로 짓는다");
    assert.ok(!/decidedVia\.decidedBy\.kind|kind === "DELEGATED"|kind === "UNRECORDED"/.test(status), "A/S 통로가 갈래를 직접 가른다");
  });

  it("🔴 **같은 울타리를 쳤다** — 재고 관리 화면의 반려 사유 상자와 같은 조회를 묶음으로 부른다", () => {
    const route = src("src/app/api/v1/stock-requests/route.ts");
    assert.ok(route.includes("readPartIssueRejectionActorsByRequest("), "통로가 그 조회를 안 부른다 — 결재 반려 이름이 안 실린다");
    for (const call of ["readPartIssueRejectionActorsByRequest(rows.map((r) => r.request.id))", "readPartIssueRejectionActorsByRequest(found.map((f) => f.request.id))"]) {
      assert.ok(route.includes(call), `묻는 법 한쪽이 반려 이름을 안 싣는다: ${call}`);
    }
  });
});

describe("⑪ 🔴 결정 시각이 안 맞으면 짝으로 안 본다 — `listRejectedRequestsFor` 도 같은 울타리", () => {
  const server = src("src/lib/stock/requests.ts");

  it("🔴 신청의 결정 시각과 단계의 결정 시각을 견준다", () => {
    assert.ok(
      server.includes("eq(rejectedStep.decidedAt, stockRequests.decidedAt)"),
      "시각을 견주지 않는다 — 옛 결재건(거둔 뒤 담당자가 직접 반려)에 엉뚱한 대리인 이름이 붙는다",
    );
  });

  it("🔴 반려 상태로 먼저 좁힌 뒤에 신청과 잇는다 — 한 신청에 결재건이 여러 번 서도 줄이 안 불어난다", () => {
    assert.ok(
      server.includes('.where(eq(stockIssueApprovalSteps.status, "REJECTED"))'),
      "반려 상태로 좁히지 않는다 — 거둔 결재건까지 겹쳐 신청이 두 줄로 불어날 수 있다",
    );
  });

  it("🔴 **갈래는 이 파일에서 가르지 않는다** — 원장으로 가는 안쪽 함수가 있는 자리라 결재 모듈을 안 가져온다", () => {
    // 🔵 `tests/part-issue-gate.test.ts` ⑤ 와 같은 울타리를 여기서도 못 박는다 — 두 시험이
    //    갈리면 한쪽만 고치는 날 이 파일이 조용히 결재 모듈을 끌어온다.
    //    🔴 **`import` 줄만 잰다** — 주석에 그 경로를 설명으로 적은 것까지 걸리면(이 파일이
    //    바로 그렇다) 시험이 항상 빨개져 아무도 안 보게 된다. 그 시험과 같은 정규식을 쓴다.
    assert.equal(server.match(/^import .*@\/lib\/approval\/.*$/gm), null, "이 파일이 결재 모듈을 가져온다 — tests/part-issue-gate.test.ts ⑤ 가 깨진다");
    const queries = src("src/lib/notifications/queries.ts");
    assert.ok(queries.includes("approvalStepActor(r.rejectedStep)"), "부르는 쪽(notifications/queries.ts)이 원본 칸을 받아 가르지 않는다");
  });
});
