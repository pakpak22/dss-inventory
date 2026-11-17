import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { approvalStepActor } from "../src/lib/approval/delegation";
import {
  PART_ISSUE_DECIDED_STEP_STATUSES,
  partIssueHistoryRole,
  partIssueScopeLabel,
  type PartIssueHistoryRole,
  type PartIssueHistoryStep,
} from "../src/lib/approval/part-issue-history";
import { APPROVAL_ROUTE_SCOPES, APPROVAL_ROUTE_SCOPE_LABELS } from "../src/lib/approval/route";
import { partIssueApprovalHref, toPortalApprovalItem } from "../src/lib/notifications/portal-approvals";
import type { PartIssueView } from "../src/lib/approval/part-issue-rules";

/**
 * ============================================================================
 * 결재 내역 — 「내가 한 결재 · 나를 대신해 한 결재」 (2026-11-17, 조각 10a)
 * ============================================================================
 * 여기서 지키는 것:
 *  · 🔴 **셋이 갈린다** — 내가 직접 / 내가 남을 대신 / 내 자리를 남이.
 *  · 🔴 **`decided_by_sub` 가 빈 옛 줄이 「대리」로 둔갑하지 않는다.** 그 줄에는 누가 눌렀는지가
 *    어디에도 없다 — 「본인」으로도 「대리」로도 읽으면 과거를 지어내게 된다.
 *  · 🔴 **남의 결재는 한 줄도 안 나온다.**
 *  · 🔴 기간은 **반열린 구간** `[from, to)` 다 — 끝을 포함하면 잇대어 적은 두 위임의 경계
 *    시각에 결재된 건이 **양쪽 기간에 모두** 뜬다.
 *
 * 🔴 **값은 전부 가짜다** — 실제 사람 이름·고객사를 적지 않는다(공개 저장소로 나갈 수 있다).
 *
 * ── 🔴 조건절은 글자로 잰다 ────────────────────────────────────────────
 * 이 저장소의 `npm test` 는 DB 에 붙지 않고, 「구워진 SQL 을 보는」 방식도 이 집에 없다
 * (`.toSQL()` 을 쓰는 자리가 저장소에 하나도 없다 — 2026-11-17 실측). 그래서 아래 절반은
 * `tests/approval-decided-by.test.ts` 가 쓰는 **소스 글자 시험**이다. 판정 자체는 순수 함수로
 * 내려와 있어 위쪽 절반이 진짜로 돌려 본다.
 * ============================================================================
 */

/* 🔴 전부 가짜 번호·가짜 이름이다. */
const ME = "portal-sub-me-0001";
const OTHER = "portal-sub-other-0002";
const THIRD = "portal-sub-third-0003";
/** 🔴 포털 번호가 아닌 값 — 이것을 넘기면 **아무것도 안 나와야** 한다(오류는 나지 않는다). */
const WRONG_KEY = "11111111-1111-4111-8111-111111111111";

const MY_NAME = "가 결재자";
const OTHER_NAME = "나 결재자";
const THIRD_NAME = "다 대리인";

const DECIDED_AT = new Date("2026-11-10T02:00:00.000Z");

/** 내가 내 자리를 직접 누른 줄이 기본값이다. */
function step(over: Partial<PartIssueHistoryStep> = {}): PartIssueHistoryStep {
  return {
    approverSub: ME,
    approverName: MY_NAME,
    decidedAt: DECIDED_AT,
    decidedBySub: ME,
    decidedByName: MY_NAME,
    ...over,
  };
}

/** 내가 **남의 자리**를 대신 누른 줄. */
const ON_BEHALF_STEP = step({ approverSub: OTHER, approverName: OTHER_NAME, decidedBySub: ME, decidedByName: MY_NAME });
/** **내 자리**를 남이 대신 눌러 준 줄. */
const BY_DELEGATE_STEP = step({ approverSub: ME, approverName: MY_NAME, decidedBySub: THIRD, decidedByName: THIRD_NAME });
/** 🔴 `decided_by_*` 칸이 생기기(2026-10-21) **전에** 결재된 옛 줄 — 내 자리였다. */
const OLD_STEP = step({ approverSub: ME, approverName: MY_NAME, decidedBySub: null, decidedByName: null });

describe("① 셋이 갈린다 — 내가 직접 / 내가 남을 대신 / 내 자리를 남이", () => {
  it("내가 **직접** 누른 결재가 나온다", () => {
    assert.deepEqual(partIssueHistoryRole(step(), ME), { kind: "SELF" });
  });

  it("🔴 내가 **대신** 누른 결재가 나온다 — 그 자리의 주인 이름이 함께 온다", () => {
    const role = partIssueHistoryRole(ON_BEHALF_STEP, ME);
    // 🔴 「내가 **누구를** 대신했나」가 이 칸이다. 내 이름이 오면 거꾸로 붙은 것이다.
    assert.deepEqual(role, { kind: "ON_BEHALF", approverName: OTHER_NAME });
  });

  it("🔴 **내 자리를 남이** 누른 결재가 나온다 — 누가 눌렀는지가 함께 온다", () => {
    const role = partIssueHistoryRole(BY_DELEGATE_STEP, ME);
    // 🔴 여기 오는 이름은 **누른 사람**이다. 자리 주인(= 나) 이름이 오면 거꾸로 붙은 것이다.
    assert.deepEqual(role, { kind: "BY_DELEGATE", delegateName: THIRD_NAME });
  });

  it("🔴 셋이 **서로 다른 갈래**로 갈린다 — 한 값으로 뭉개지지 않는다", () => {
    const roles = [partIssueHistoryRole(step(), ME), partIssueHistoryRole(ON_BEHALF_STEP, ME), partIssueHistoryRole(BY_DELEGATE_STEP, ME)];
    // 🔵 표본이 비어서 공짜로 통과하지 않게 — 셋 다 실제로 값이 나왔는지부터 본다.
    assert.equal(roles.filter((r) => r !== null).length, 3);
    assert.deepEqual(
      roles.map((r) => r?.kind),
      ["SELF", "ON_BEHALF", "BY_DELEGATE"],
    );
    assert.equal(new Set(roles.map((r) => r?.kind)).size, 3);
  });

  it("🔵 **같은 한 줄이 보는 사람에 따라 뜻이 바뀐다** — 대리인에겐 「대신」, 자리 주인에겐 「내 자리를 남이」", () => {
    // 🔴 이것이 `approvalStepActor` 의 갈래를 그대로 쓰지 않고 **돌려 세우는** 까닭이다.
    assert.equal(partIssueHistoryRole(ON_BEHALF_STEP, ME)?.kind, "ON_BEHALF");
    assert.equal(partIssueHistoryRole(ON_BEHALF_STEP, OTHER)?.kind, "BY_DELEGATE");
  });

  it("🔵 이름이 안 적힌 대리 줄은 **지어내지 않는다** — 번호만 있는 줄", () => {
    const role = partIssueHistoryRole(step({ decidedBySub: THIRD, decidedByName: null }), ME);
    assert.deepEqual(role, { kind: "BY_DELEGATE", delegateName: null });
  });
});

describe("② 🔴 내역이 **아닌** 줄은 한 줄도 안 나온다", () => {
  it("아직 결재 안 난 줄(`REQUESTED`)은 안 나온다", () => {
    assert.equal(partIssueHistoryRole(step({ decidedAt: null, decidedBySub: null, decidedByName: null }), ME), null);
    // 🔴 「누른 사람은 적혀 있는데 시각이 비었다」는 표가 못 만드는 줄이지만(CHECK), 그래도
    //    시각 하나로 가른다 — 갈래 함수가 그 칸만 본다.
    assert.equal(partIssueHistoryRole(step({ decidedAt: null }), ME), null);
  });

  it("🔴 **남의 결재는 안 나온다** — 자리 주인도 누른 사람도 내가 아닌 줄", () => {
    const strangers: PartIssueHistoryStep[] = [
      step({ approverSub: OTHER, approverName: OTHER_NAME, decidedBySub: OTHER, decidedByName: OTHER_NAME }),
      step({ approverSub: OTHER, approverName: OTHER_NAME, decidedBySub: THIRD, decidedByName: THIRD_NAME }),
      step({ approverSub: OTHER, approverName: OTHER_NAME, decidedBySub: null, decidedByName: null }),
    ];
    // 🔵 표본이 비지 않았는지 먼저 본다.
    assert.equal(strangers.length, 3);
    for (const s of strangers) {
      assert.equal(partIssueHistoryRole(s, ME), null, `남의 결재가 새어 나온다: ${JSON.stringify(s)}`);
    }
  });

  it("🔴 열쇠를 잘못 넘기면(`users.id`·A/S 번호) **전부 빈다** — 오류는 나지 않는다", () => {
    for (const s of [step(), ON_BEHALF_STEP, BY_DELEGATE_STEP, OLD_STEP]) {
      assert.equal(partIssueHistoryRole(s, WRONG_KEY), null);
    }
  });
});

describe("③ 🔴 `decided_by_sub` 가 빈 **옛 줄**이 「대신 누른 것」으로 오판되지 않는다", () => {
  it("내 자리의 옛 줄은 `UNRECORDED` 다 — 「본인」도 「대리」도 아니다", () => {
    const role = partIssueHistoryRole(OLD_STEP, ME);
    assert.deepEqual(role, { kind: "UNRECORDED" });
    // 🔴 이 줄이 셋 중 어느 쪽으로도 읽히면 과거를 지어내는 것이다.
    const kinds: PartIssueHistoryRole["kind"][] = ["SELF", "ON_BEHALF", "BY_DELEGATE"];
    assert.ok(!kinds.includes(role!.kind), "옛 줄이 셋 중 하나로 둔갑했다");
  });

  it("🔴 가르는 자리는 `approvalStepActor` 하나다 — 두 함수의 답이 짝이 맞는다", () => {
    // 🔵 「새로 가르지 않았다」를 값으로 못 박는다. 이 짝이 깨지면 갈래가 두 벌이 된 것이다.
    const samples: Array<[PartIssueHistoryStep, string, string]> = [
      [step(), "SELF", "SELF"],
      [ON_BEHALF_STEP, "DELEGATED", "ON_BEHALF"],
      [BY_DELEGATE_STEP, "DELEGATED", "BY_DELEGATE"],
      [OLD_STEP, "UNRECORDED", "UNRECORDED"],
    ];
    assert.equal(samples.length, 4);
    for (const [s, actorKind, roleKind] of samples) {
      assert.equal(approvalStepActor(s).kind, actorKind);
      assert.equal(partIssueHistoryRole(s, ME)?.kind ?? partIssueHistoryRole(s, OTHER)?.kind, roleKind);
    }
  });

  it("남의 자리의 옛 줄은 내 내역이 아니다", () => {
    assert.equal(partIssueHistoryRole(step({ approverSub: OTHER, approverName: OTHER_NAME, decidedBySub: null, decidedByName: null }), ME), null);
  });
});

describe("④ 결재가 **실제로 난** 줄의 묶음과 갈래 이름표", () => {
  it("🔴 `REQUESTED` 가 묶음에 없다 — 그것은 내역이 아니라 **할 일**이다", () => {
    assert.deepEqual([...PART_ISSUE_DECIDED_STEP_STATUSES], ["APPROVED", "REJECTED"]);
    assert.ok(!(PART_ISSUE_DECIDED_STEP_STATUSES as readonly string[]).includes("REQUESTED"));
  });

  it("🔵 결재 갈래 셋에 이름표가 붙고, 표는 `route.ts` 하나다", () => {
    assert.equal(APPROVAL_ROUTE_SCOPES.length, 3);
    for (const scope of APPROVAL_ROUTE_SCOPES) {
      assert.equal(partIssueScopeLabel(scope), APPROVAL_ROUTE_SCOPE_LABELS[scope]);
      assert.ok(partIssueScopeLabel(scope).length > 0);
    }
    // 사람이 보고 구별해야 하므로 셋이 서로 다른 말이어야 한다.
    assert.equal(new Set(APPROVAL_ROUTE_SCOPES.map(partIssueScopeLabel)).size, 3);
  });
});

describe("⑤ 🔴 「그 건으로 건너갈 주소」는 **승인함의 「결재할 건」과 같은 함수**가 짓는다", () => {
  const BASE = "http://192.168.0.13:3800";
  const APPROVAL_ID = "99999999-9999-4999-8999-999999999999";

  function view(): PartIssueView {
    return {
      id: APPROVAL_ID,
      requestId: "88888888-8888-4888-8888-888888888888",
      routeId: "77777777-7777-4777-8777-777777777777",
      status: "PENDING_APPROVAL",
      quantities: [],
      reason: "",
      requestedBy: "66666666-6666-4666-8666-666666666666",
      requestedByName: "라 신청자",
      requestedAt: "2026-11-10T01:00:00.000Z",
      entryId: null,
      executedByName: null,
      executedAt: null,
      requestSummary: "사용 · 2026-11-10 · No.123 가짜부품 ×2",
      requestType: "USE",
      requestNote: "",
      currentStep: null,
    };
  }

  it("🔴 두 길이 **같은 주소**로 간다 — 「눌렀더니 엉뚱한 화면」이 생기지 않게", () => {
    assert.equal(partIssueApprovalHref(APPROVAL_ID, BASE), toPortalApprovalItem(view(), BASE).href);
    assert.equal(partIssueApprovalHref(APPROVAL_ID, BASE), `${BASE}/approvals#approval-${APPROVAL_ID}`);
  });

  it("🔴 상대 주소면 던진다 — 승인함은 **다른 사이트**라 제 주소로 읽는다", () => {
    assert.throws(() => partIssueApprovalHref(APPROVAL_ID, ""));
    assert.throws(() => partIssueApprovalHref(APPROVAL_ID, "/approvals"));
  });
});

/* ------------------------------------------------------------------ */
/* 아래는 **순수 함수로는 닿지 않는 자리**를 글자로 못 박는 시험이다.      */
/* 🔴 DB 조건절은 아무도 돌려 보지 못한 채 운영으로 나간다(머리말).        */
/* ------------------------------------------------------------------ */

/** 🔴 줄바꿈을 LF 로 눕혀서 읽는다 — 이 저장소의 소스는 CRLF 가 섞여 있다. */
const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * 조회 한 함수의 **본문만** 잘라 낸다. 🔵 파일 전체로 재면 다른 조회의 글자에 기대어 공짜로
 * 통과한다 — 이 파일에는 비슷한 조회가 일곱 개 있다.
 */
function historyQueryBody(): string {
  const file = src("src/lib/approval/part-issue.ts");
  const head = "export async function listPartIssueApprovalHistoryFor(";
  const start = file.indexOf(head);
  assert.ok(start > 0, "결재 내역 조회가 사라졌다");
  const body = file.slice(start);
  const end = body.indexOf("\n}\n");
  const cut = end > 0 ? body.slice(0, end) : body;
  // 🔵 표본이 비어서 공짜로 통과하지 않게 — 잘라 낸 덩이가 실제로 질의인지 먼저 본다.
  assert.ok(cut.length > 800, `본문을 제대로 못 잘랐다(${cut.length}자)`);
  assert.ok(cut.includes(".from(stockIssueApprovalSteps)"), "단계 표에서 읽지 않는다");
  return cut;
}

describe("⑥ 🔴 가로지르는 조건 — 「내가 누른 줄」과 「내 자리였던 줄」 둘 다", () => {
  const body = historyQueryBody();

  it("두 칸을 `OR` 로 가로지른다 — 이 집에는 전용 칸이 없다", () => {
    assert.ok(
      body.includes("or(eq(stockIssueApprovalSteps.decidedBySub, params.sub), eq(stockIssueApprovalSteps.approverSub, params.sub))"),
      "두 칸을 가로지르지 않는다 — 한쪽만 보면 대리 결재가 통째로 빠진다",
    );
  });

  it("🔴 **A/S 의 전용 칸을 베껴 오지 않았다** — 이 집에 `delegated_from` 칸은 없다", () => {
    assert.ok(!body.includes("delegatedFrom"), "있지도 않은 칸을 읽는다");
  });
});

describe("⑦ 🔴 결재가 **실제로 난** 줄만 — `REQUESTED` 가 섞이지 않는다", () => {
  const body = historyQueryBody();

  it("묶음을 손으로 적지 않는다 — 한 자리(`PART_ISSUE_DECIDED_STEP_STATUSES`)를 쓴다", () => {
    assert.ok(body.includes("inArray(stockIssueApprovalSteps.status, [...PART_ISSUE_DECIDED_STEP_STATUSES])"), "상태로 안 좁힌다");
    assert.ok(!body.includes('"REQUESTED"'), "상태 글자를 조회가 직접 적는다 — 두 벌이 되는 자리다");
  });

  it("🔴 `decided_at` 이 빈 줄도 함께 막는다", () => {
    assert.ok(body.includes("isNotNull(stockIssueApprovalSteps.decidedAt)"), "시각이 빈 줄을 안 막는다");
  });
});

describe("⑧ 🔴 기간은 **반열린 구간** `[from, to)` — 경계를 재는 자리", () => {
  const body = historyQueryBody();
  /** drizzle 연산자를 들여오는 줄 하나. 🔵 못 찾으면 아래가 공짜로 통과하므로 먼저 세운다. */
  const imports = (() => {
    const line = src("src/lib/approval/part-issue.ts")
      .split("\n")
      .find((l) => l.startsWith("import {") && l.includes('from "drizzle-orm";'));
    assert.ok(line, "drizzle 연산자를 들여오는 줄을 못 찾았다");
    return line;
  })();

  it("시작은 포함하고(`gte`) 끝은 포함하지 않는다(`lt`)", () => {
    assert.ok(body.includes("gte(stockIssueApprovalSteps.decidedAt, params.from)"), "시작 경계가 없다");
    assert.ok(body.includes("lt(stockIssueApprovalSteps.decidedAt, params.to)"), "끝 경계가 없다");
  });

  it("🔴 **끝을 포함하는 꼴이 하나도 없다** — 잇댄 두 위임의 경계가 양쪽에 걸리는 자리", () => {
    assert.ok(!body.includes("lte("), "`lte` 로 끝을 포함한다 — 경계 시각의 결재가 두 기간에 모두 뜬다");
    assert.ok(!body.includes("between("), "`between` 은 양끝을 포함한다");
    assert.ok(!/\bgt\(stockIssueApprovalSteps\.decidedAt/.test(body), "시작 경계가 빠지는 꼴이다");
  });

  it("🔵 `lte` 를 아예 안 들여온다 — 손이 미끄러질 자리를 없앤다", () => {
    assert.ok(/\blt\b/.test(imports), `drizzle 에서 lt 를 안 들여온다: ${imports}`);
    assert.ok(!/\blte\b/.test(imports), `lte 를 들여왔다: ${imports}`);
  });
});

describe("⑨ 🔴 갈래도 주소도 **한 자리**를 지난다 — 조회가 손으로 짓지 않는다", () => {
  const body = historyQueryBody();

  it("갈래는 `partIssueHistoryRole` 이 가린다", () => {
    assert.ok(body.includes("const role = partIssueHistoryRole(step, params.sub);"), "조회가 갈래를 직접 가른다");
    assert.ok(!/kind === "DELEGATED"|kind === "UNRECORDED"/.test(body), "조회가 갈래 글자를 직접 견준다");
    assert.ok(
      !/decidedBySub === r\.approverSub|r\.decidedBySub !== r\.approverSub/.test(body),
      "조회가 두 칸을 직접 견준다 — 옛 줄이 「대리」로 둔갑하는 길",
    );
  });

  it("🔴 갈래가 `null` 인 줄은 싣지 않는다 — 남의 결재가 조용히 섞이지 않게", () => {
    assert.ok(body.includes("if (role === null || step.decidedAt === null) continue;"), "갈래가 없는 줄을 그대로 싣는다");
  });

  it("주소는 `partIssueApprovalHref` 가 짓는다", () => {
    assert.ok(body.includes("partIssueApprovalHref(r.approvalId, params.baseUrl)"), "조회가 주소를 직접 조립한다");
    assert.ok(!body.includes("#approval-"), "주소 모양이 두 벌이 됐다");
  });

  it("🔴 돌려주는 모양에 **포털 번호 칸이 없다** — 신원이 브라우저로 실려 나가지 않게", () => {
    const history = src("src/lib/approval/part-issue-history.ts");
    const head = history.indexOf("export interface PartIssueApprovalHistoryRow {");
    assert.ok(head > 0, "돌려주는 모양이 사라졌다");
    const shape = history.slice(head, history.indexOf("\n}", head));
    assert.ok(shape.length > 200, "모양을 제대로 못 잘랐다");
    // 주석에는 `sub` 가 나오므로 **주석을 걷어낸 뒤** 칸 선언만 본다.
    const fields = shape.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/Sub(\??):\s*string/.test(fields), "포털 번호 칸이 생겼다");
  });
});

describe("⑩ 🔴 색인 둘 — 「OR 두 칸」은 한 색인으로 못 탄다", () => {
  const DECIDED_IDX = "stock_issue_approval_steps_decided_by_history_idx";
  const APPROVER_IDX = "stock_issue_approval_steps_approver_history_idx";

  it("스키마에 칸마다 하나씩 둘이 있다", () => {
    const schema = src("src/db/schema/stock-issue-approvals.ts");
    assert.ok(schema.includes(`index("${DECIDED_IDX}").on(t.decidedBySub, t.decidedAt)`), "누가 눌렀나 쪽 색인이 없다");
    assert.ok(schema.includes(`index("${APPROVER_IDX}").on(t.approverSub, t.decidedAt)`), "자리 주인 쪽 색인이 없다");
  });

  it("🔵 **기존 「현재 차례」 색인은 그대로 있다** — 지우지 않고 옆에 더했다", () => {
    const schema = src("src/db/schema/stock-issue-approvals.ts");
    assert.ok(schema.includes('index("stock_issue_approval_steps_approver_sub_idx").on(t.approverSub, t.status)'), "결재할 건 목록이 타는 색인이 사라졌다");
  });

  it("🔴 마이그레이션이 **더하기만** 한다 — 지우는 문장이 없다", () => {
    const dir = new URL("../drizzle/", import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
    // 🔵 표본이 비면 아래 전부가 공짜로 통과한다.
    assert.ok(files.length > 20, `마이그레이션을 못 읽었다(${files.length}개)`);

    const owning = files.filter((name) => readFileSync(new URL(name, dir), "utf8").includes(DECIDED_IDX));
    assert.equal(owning.length, 1, `색인을 만드는 판이 ${owning.length}개다 — 하나여야 한다`);

    const sql = readFileSync(new URL(owning[0], dir), "utf8").replace(/\r\n/g, "\n");
    assert.match(sql, new RegExp(`CREATE INDEX "${DECIDED_IDX}" ON "stock_issue_approval_steps" USING btree \\("decided_by_sub","decided_at"\\)`));
    assert.match(sql, new RegExp(`CREATE INDEX "${APPROVER_IDX}" ON "stock_issue_approval_steps" USING btree \\("approver_sub","decided_at"\\)`));
    // 🔴 표를 건드리지 않는 판이다(설계 B-16: 출처 칸을 안 만들기로 해서 칸 변경이 없다).
    assert.ok(!/\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b/i.test(sql), `지우거나 고치는 문장이 섞였다:\n${sql}`);
  });
});
