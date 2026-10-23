import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuditAction } from "../src/lib/audit";
import { AUDIT_DETAIL_EMPTY, auditDetailLines, unknownAuditDetail, type AuditDetailContext, type AuditDetailLine } from "../src/lib/audit-detail";
import { AUDIT_ACTIONS } from "../src/lib/audit-labels";

/**
 * ============================================================================
 * 변경 이력 「내용」 칸 — 전수 시험 (2026-10-23)
 * ============================================================================
 * 🔴 **이 시험이 있는 까닭**: 2026-10-23 까지 `/audit` 화면은 38개 행위 가운데 **22개만** 글자로
 *    풀고 나머지 16개는 JSON 을 그대로 내보내고 있었다. 불출 결재 계열 다섯과 반출 신청 계열
 *    여섯이 통째로 빠져 있었는데 **오류가 한 번도 안 났다** — 모르는 모양이 조용히 되돌아가는
 *    길로 떨어졌기 때문이다. 쓰는 분이 화면에서 보고 신고하고 나서야 알았다:
 *
 *        대상: 확인 대기 신청
 *        내용: {"note":"","entry":"USE-2026-8","issued":1,"issueNo":1,"summary":"사용 · …"}
 *
 * 그래서 **빠뜨릴 수 없게** 만든다. 울타리는 두 겹이다:
 *   1. 아래 `SAMPLES` 가 `Record<AuditAction, …>` 다 — 행위를 하나 더하고 본보기를 안 적으면
 *      **tsc 가 멈춘다.**
 *   2. 「전수」 시험이 그 본보기를 넣어 `unknown === false` 를 본다 — 본보기는 적었는데 글자
 *      규칙을 안 더하면 **여기서 깨진다.**
 *
 * 🔴 **본보기 `detail` 은 지어낸 것이 아니다.** 행위마다 쓰는 자리(아래 주석의 `파일:줄`)를 직접
 *    읽어 칸 이름과 타입을 그대로 가져왔다. 🔴 **값만 가짜다** — 실제 고객사·사람 이름·L/N·S/N 은
 *    한 글자도 넣지 않는다(공개 저장소에 박힌다).
 * ============================================================================
 */

/** 글자를 짓는 데 쓰는 바깥 자료. 옛 「엑셀 기준 적용」 줄의 uuid → 기록 번호. */
const CTX: AuditDetailContext = { entryNos: new Map([["11111111-1111-4111-8111-111111111111", "US-2026-9"]]) };

/** 한 줄이 사람에게 보이는 글자 전부(앞·뒤 값 줄과 「사유」 이름표까지 포함). 빈 줄 검사가 쓴다. */
function visibleText(line: AuditDetailLine): string {
  if (line.kind === "field") return `${line.field} ${line.before} ${line.after}`;
  return `${line.text}${line.reason === undefined ? "" : ` 사유 ${line.reason}`}`;
}

/** 줄들을 한 글자로 — 기대 글자를 통째로 맞대어 볼 때. */
function joined(action: AuditAction, detail: Record<string, unknown> | null): string {
  return auditDetailLines(action, detail, CTX)
    .lines.map(visibleText)
    .join("\n");
}

function linesOf(action: AuditAction): AuditDetailLine[] {
  return auditDetailLines(action, SAMPLES[action], CTX).lines;
}

/**
 * 🔴 **행위마다 실제로 쌓이는 `detail` 모양.** `Record` 라 빠뜨리면 컴파일이 안 된다.
 * 🔵 `null` 은 「그 행위는 `detail` 을 아예 안 남긴다」는 뜻이고, 실제로 그런 것이 둘뿐이다.
 */
const SAMPLES: Record<AuditAction, Record<string, unknown> | null> = {
  // src/app/api/auth/sso/callback/route.ts:69
  LOGIN: { role: "ADMIN", roleClaimPresent: true },
  // src/app/api/auth/sso/callback/route.ts:30 — `{ code, detail, ...extra }`, extra 는 56줄의 `{ sub, name }`
  LOGIN_REJECTED: { code: "no_role", detail: "역할 지정 없음", sub: "portal-sub-0001", name: "홍길동" },
  // src/app/actions/auth.ts:33 — detail 을 안 넘긴다
  LOGOUT: null,
  // src/app/api/auth/sso/backchannel-logout/route.ts:27
  BACKCHANNEL_LOGOUT: { sub: "portal-sub-0001", sid: "sid-0001", affected: 1 },
  // src/lib/parts/mutations.ts:92
  PART_CREATE: { name: "예시 PCB-001", name2: "예시 보드", drawingNo: "예시도면-1", owner: "SERVICE_SPARE", category: "RFG", itemCode: "PCB" },
  // src/lib/parts/mutations.ts:142
  PART_UPDATE: {
    changes: { name: { before: "예시 PCB-001", after: "예시 PCB-002" }, supplyPrice: { before: 1000, after: 1200 } },
    supplyCurrency: { before: "JPY", after: "JPY" },
  },
  // src/lib/parts/mutations.ts:325 근처
  PART_DELETE: { name: "예시 PCB-001", reason: "중복 등록" },
  // src/lib/parts/mutations.ts:366
  PART_ITEM_CREATE: { name: "예시 항목" },
  // src/lib/parts/mutations.ts:401
  PART_ITEM_REORDER: { direction: "up", swappedWith: "PCB" },
  // src/lib/stock/ledger.ts:197
  STOCK_ENTRY: {
    occurredOn: "2026-10-23",
    intakeNumber: "D260101",
    intakeUnverified: false,
    requestId: null,
    confirmedBy: null,
    lines: [{ partNo: 61, delta: -1, before: 5, after: 4 }],
  },
  STOCK_CORRECTION: {
    occurredOn: "2026-10-23",
    intakeNumber: "",
    intakeUnverified: false,
    requestId: null,
    confirmedBy: "김철수",
    lines: [{ partNo: 61, delta: 1, before: 4, after: 5 }],
  },
  // src/lib/stock/ledger.ts:435
  INTAKE_VERIFIED: { intakeNumber: "D260101", productModel: "예시 기종" },
  // src/lib/stock/requests.ts:443 + src/app/api/v1/stock-requests/route.ts:78 의 `audit`
  STOCK_REQUEST: {
    type: "USE",
    summary: "사용 · 2026-10-06 · D260101 · No. 61 예시 부품 ×1",
    source: "AS",
    externalKey: "as-req-0001",
    workflowKind: "MATCHER",
    requesterSub: "portal-sub-0002",
    requesterName: "홍길동",
    matchedUser: null,
    intakeNumber: "D260101",
  },
  /**
   * src/lib/stock/requests.ts:679 — 🔴 **쓰는 분이 JSON 으로 보고 신고한 바로 그 모양**이다
   * (값만 가짜로 바꿨다). 이 줄이 한글로 풀리는 것이 이번 변경의 증거다.
   */
  STOCK_REQUEST_CONFIRMED: {
    summary: "사용 · 2026-10-06 · D260101 · No. 61 예시 부품 ×1",
    requestedBy: "홍길동",
    entry: "USE-2026-8",
    issueNo: 1,
    issued: 1,
    remaining: 0,
    note: "",
  },
  STOCK_REQUEST_PARTIAL: {
    summary: "사용 · 2026-10-06 · D260101 · No. 61 예시 부품 ×3",
    requestedBy: "홍길동",
    entry: "USE-2026-9",
    issueNo: 1,
    issued: 1,
    remaining: 2,
    note: "2개는 다음 주에",
  },
  // src/lib/stock/requests.ts:756
  STOCK_REQUEST_CLOSED: { summary: "사용 · No. 61 예시 부품 ×8", requestedBy: "홍길동", requested: 8, issued: 5, remaining: 3, note: "더 들어올 일정 없음" },
  // src/lib/stock/requests.ts:720
  STOCK_REQUEST_REJECTED: { summary: "사용 · No. 61 예시 부품 ×1", requestedBy: "홍길동", note: "다른 부품으로 대체" },
  // src/lib/stock/requests.ts:849 (화면 취소) / :941 (A/S 통로 취소)
  STOCK_REQUEST_CANCELLED: { summary: "사용 · No. 61 예시 부품 ×1", source: "AS", externalKey: "as-req-0001", requesterSub: "portal-sub-0002" },
  // src/lib/stock/requests.ts:788
  STOCK_REQUEST_HELD: { summary: "사용 · No. 61 예시 부품 ×1", requestedBy: "홍길동", reason: "입고 일정 확인 중" },
  // src/lib/stock/requests.ts:825
  STOCK_REQUEST_HOLD_RELEASED: { summary: "사용 · No. 61 예시 부품 ×1", requestedBy: "홍길동", status: "PARTIAL", issued: 2 },
  // src/lib/approval/part-issue.ts:277
  STOCK_ISSUE_APPROVAL_REQUESTED: {
    requestId: "22222222-2222-4222-8222-222222222222",
    requestSummary: "사용 · No. 61 예시 부품 ×3",
    routeScope: "PART_ISSUE_MATCHER",
    routeVersion: 2,
    steps: [
      { stepOrder: 1, approverUserId: "33333333-3333-4333-8333-333333333333", approverName: "김철수" },
      { stepOrder: 2, approverUserId: "44444444-4444-4444-8444-444444444444", approverName: "이영희" },
    ],
    autoApproved: false,
    reason: "현장 교체용",
    quantities: [{ partId: "55555555-5555-4555-8555-555555555555", quantity: 3 }],
    requestStatus: "IN_APPROVAL",
  },
  // src/lib/approval/part-issue.ts:495
  STOCK_ISSUE_APPROVAL_APPROVED: { requestId: "22222222-2222-4222-8222-222222222222", stepOrder: 1, status: "PENDING_APPROVAL", note: "확인함" },
  STOCK_ISSUE_APPROVAL_REJECTED: { requestId: "22222222-2222-4222-8222-222222222222", stepOrder: 2, status: "REJECTED", note: "수량 과다", requestRejected: true },
  // src/lib/approval/part-issue.ts:568
  STOCK_ISSUE_APPROVAL_EXECUTED: { requestId: "22222222-2222-4222-8222-222222222222", entry: "USE-2026-10", issueNo: 1, issued: 3, remaining: 0, note: "" },
  // src/lib/approval/part-issue.ts:758
  STOCK_ISSUE_APPROVAL_CANCELLED: { requestId: "22222222-2222-4222-8222-222222222222", requestStatus: "PENDING", issued: 0 },
  // src/lib/approval/part-issue.ts:684
  STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED: { requestId: "22222222-2222-4222-8222-222222222222", reason: "실물 수량이 맞지 않음", requestRejected: true },
  // scripts/import-workbook.ts
  WORKBOOK_IMPORT: {
    file: "현황판_예시.xlsx",
    transitionDate: "2026-10-01",
    parts: 319,
    openingLines: 258,
    legacy: { confirmed: 1349, groupDecided: 237, ownerMismatch: 55, unmatched: 26 },
  },
  // src/lib/excel/workbook-sync.ts (치워 두고 멈출 때)
  WORKBOOK_PARKED: { parkedFile: "현황판_사람수정_20261023-1130.xlsx", size: 173285 },
  // src/lib/excel/workbook-sync.ts:72 — detail 을 안 넘긴다
  WORKBOOK_RESUMED: null,
  // src/lib/excel/workbook-apply-run.ts
  WORKBOOK_EXCEL_APPLIED: {
    parkedFile: "현황판_사람수정_20261023-1130.xlsx",
    reason: "현장에서 직접 적은 줄 반영",
    summary: "사용 1 · 입고 1 · 조정 1",
    entryNos: ["US-2026-10", "RC-2026-3"],
    entryCount: 2,
    skippedCount: 1,
  },
  // src/lib/approval/mutations.ts:231
  APPROVAL_ROUTE_SAVED: {
    scope: "PART_ISSUE",
    version: 3,
    previousVersion: 2,
    steps: [{ stepOrder: 1, approverUserId: "33333333-3333-4333-8333-333333333333", approverName: "김철수", approverRole: "ADMIN" }],
    previousSteps: [{ stepOrder: 1, approverUserId: "44444444-4444-4444-8444-444444444444", approverName: "이영희", approverRole: "ADMIN" }],
  },
  // src/lib/approval/delegation-mutations.ts:116
  APPROVAL_DELEGATION_CREATED: {
    delegateName: "김철수",
    startDate: "2026-10-24",
    endDate: "2026-10-25",
    startsAt: "2026-10-23T15:00:00.000Z",
    endsAt: "2026-10-25T15:00:00.000Z",
    reason: "출장",
  },
  // src/lib/approval/delegation-mutations.ts:185
  APPROVAL_DELEGATION_REVOKED: { delegateName: "김철수", endDate: "2026-10-25", revokedAt: "2026-10-23T05:00:00.000Z" },
  // src/lib/oh/mutations.ts:390 — 🔵 2026-10-15 에 기종 코드를 없애 `code` 칸이 **없다**
  OH_TEMPLATE_SAVED: {
    created: false,
    version: 2,
    previousVersion: 1,
    name: "예시 O/H",
    note: "",
    previous: { name: "예시 O/H(옛 이름)", note: "" },
    itemCount: 2,
    items: [
      { displayOrder: 1, partNameText: "예시 PCB-001", quantity: 2, linked: true },
      { displayOrder: 2, partNameText: "예시 패킹", quantity: 1, linked: false },
    ],
  },
  // src/lib/oh/mutations.ts:459
  OH_TEMPLATE_DELETED: { name: "예시 O/H", reason: "더 쓰지 않음" },
  // src/lib/oh/mutations.ts:573 / :615
  OH_TEMPLATE_MODEL_LINKED: { productModelId: "66666666-6666-4666-8666-666666666666", productModelName: "예시 기종" },
  OH_TEMPLATE_MODEL_UNLINKED: { productModelId: "66666666-6666-4666-8666-666666666666", productModelName: "예시 기종" },
  // src/lib/oh/mutations.ts:164
  OH_PRICE_SET: { partName: "예시 PCB-001", before: null, after: 15000 },
};

/** `detail` 을 아예 안 남기는 행위 둘. 🔴 이 둘이 이번 변경의 증거라 따로 적어 둔다. */
const NO_DETAIL_ACTIONS: AuditAction[] = ["LOGOUT", "WORKBOOK_RESUMED"];

/**
 * 🔴 **2026-10-23 에 새로 푼 열여섯.** 그 전까지 JSON 으로 떨어지던(또는 빈 칸이던) 것들이다.
 * 목록을 적어 두는 까닭: 「전수 통과」만으로는 **이번에 무엇이 달라졌는지**가 시험에 안 남는다.
 */
const NEWLY_TRANSLATED: AuditAction[] = [
  "LOGIN_REJECTED",
  "LOGOUT",
  "BACKCHANNEL_LOGOUT",
  "STOCK_REQUEST",
  "STOCK_REQUEST_CONFIRMED",
  "STOCK_REQUEST_PARTIAL",
  "STOCK_REQUEST_REJECTED",
  "STOCK_REQUEST_HELD",
  "STOCK_REQUEST_HOLD_RELEASED",
  "STOCK_ISSUE_APPROVAL_REQUESTED",
  "STOCK_ISSUE_APPROVAL_APPROVED",
  "STOCK_ISSUE_APPROVAL_REJECTED",
  "STOCK_ISSUE_APPROVAL_EXECUTED",
  "STOCK_ISSUE_APPROVAL_CANCELLED",
  "STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED",
  "WORKBOOK_RESUMED",
];

describe("변경 이력 「내용」 칸 (audit-detail.ts)", () => {
  /* ---------------------------------------------------------------- */
  /* 0. 무엇을 재고 있는가 — 표본이 비어서 공짜로 통과하지 않게         */
  /* ---------------------------------------------------------------- */
  it("본보기가 행위 전부를 빠짐없이, 더도 덜도 없이 덮는다", () => {
    assert.ok(AUDIT_ACTIONS.length >= 38, `행위가 ${AUDIT_ACTIONS.length}개뿐이다 — 글자표를 못 읽은 것 아닌가`);
    const sampled = Object.keys(SAMPLES).sort();
    assert.deepEqual(sampled, [...AUDIT_ACTIONS].sort());
    // 이번에 푼 열여섯도 전부 실재하는 행위여야 한다(이름이 틀리면 아래 시험이 엉뚱한 것을 잰다).
    for (const a of NEWLY_TRANSLATED) assert.ok(AUDIT_ACTIONS.includes(a), a);
    assert.equal(NEWLY_TRANSLATED.length, 16);
  });

  /* ---------------------------------------------------------------- */
  /* 1. 전수 — JSON 으로 떨어지는 행위가 하나도 없다                    */
  /* ---------------------------------------------------------------- */
  it("🔴 모든 행위가 글자로 풀린다 (JSON 되돌아가는 길로 떨어지지 않는다)", () => {
    const fallen: string[] = [];
    for (const action of AUDIT_ACTIONS) {
      if (auditDetailLines(action, SAMPLES[action], CTX).unknown) fallen.push(action);
    }
    assert.deepEqual(fallen, [], `JSON 그대로 나가는 행위가 남아 있다: ${fallen.join(", ")}`);
  });

  it("🔴 빈 줄이 하나도 없다 — 줄은 하나 이상이고 글자가 비어 있지 않다", () => {
    for (const action of AUDIT_ACTIONS) {
      const lines = linesOf(action);
      assert.ok(lines.length >= 1, `${action}: 줄이 없다`);
      for (const [i, line] of lines.entries()) {
        const t = visibleText(line).trim();
        assert.notEqual(t, "", `${action}: ${i + 1}번째 줄이 비었다`);
      }
    }
  });

  it("🔴 영문 코드값이 화면 글자에 섞여 나가지 않는다 (상태·절차·종류·거절 사유)", () => {
    // 코드로 쓰이는 영문 토막들. 하나라도 글자에 그대로 보이면 글자표를 안 거친 것이다.
    const CODES = ["PENDING_APPROVAL", "IN_APPROVAL", "EXECUTION_REJECTED", "PART_ISSUE_MATCHER", "MATCHER", "no_role", "PARTIAL"];
    for (const action of AUDIT_ACTIONS) {
      const all = linesOf(action).map(visibleText).join(" ");
      for (const code of CODES) assert.ok(!all.includes(code), `${action}: 「${code}」가 그대로 나간다 — ${all}`);
    }
  });

  /* ---------------------------------------------------------------- */
  /* 2. 결이 다른 둘 — detail 이 없어 빈 칸이던 것                      */
  /* ---------------------------------------------------------------- */
  it("🔴 detail 을 안 남기는 둘도 글자가 있다 (예전에는 빈 칸이었다)", () => {
    for (const action of NO_DETAIL_ACTIONS) {
      assert.equal(SAMPLES[action], null, `${action}: 본보기가 null 이 아니다 — 쓰는 쪽이 바뀌었나`);
      const lines = linesOf(action);
      assert.equal(lines.length, 1);
      assert.ok(visibleText(lines[0]).length > 5, `${action}: 글자가 너무 짧다`);
    }
    assert.equal(joined("LOGOUT", null), "본인이 [로그아웃]을 눌러 나감 (세션이 저절로 만료된 것이 아니다)");
    assert.equal(joined("WORKBOOK_RESUMED", null), "멈춤을 풀었다 — 다음 차례부터 프로그램이 현황판 한 벌을 다시 쓴다");
  });

  it("그 밖의 행위인데 내용이 비어 있는 옛 줄은 「—」 (「null」을 그리지 않는다)", () => {
    assert.equal(joined("STOCK_REQUEST", null), AUDIT_DETAIL_EMPTY);
    assert.equal(auditDetailLines("STOCK_REQUEST", null, CTX).unknown, false);
  });

  /* ---------------------------------------------------------------- */
  /* 3. 이번에 푼 것들이 실제로 어떤 글자가 되는가                      */
  /* ---------------------------------------------------------------- */
  it("반출 확인 — 쓰는 분이 JSON 으로 보고 신고한 그 줄", () => {
    assert.equal(
      joined("STOCK_REQUEST_CONFIRMED", SAMPLES.STOCK_REQUEST_CONFIRMED),
      ["사용 · 2026-10-06 · D260101 · No. 61 예시 부품 ×1 (신청자 홍길동)", "기록 사용 US-2026-8 · 1회차로 1개 내줌 · 남은 수량 없음"].join("\n"),
    );
  });

  it("반출 일부 불출 — 남은 수량과 담당자 메모가 보인다", () => {
    assert.equal(
      joined("STOCK_REQUEST_PARTIAL", SAMPLES.STOCK_REQUEST_PARTIAL),
      ["사용 · 2026-10-06 · D260101 · No. 61 예시 부품 ×3 (신청자 홍길동)", "기록 사용 US-2026-9 · 1회차로 1개 내줌 · 아직 2개 남음", "담당자 메모: 2개는 다음 주에"].join("\n"),
    );
  });

  it("반출 반려 — 마감과 다른 말이어야 한다 (하나도 안 준다)", () => {
    const rejected = joined("STOCK_REQUEST_REJECTED", SAMPLES.STOCK_REQUEST_REJECTED);
    const closed = joined("STOCK_REQUEST_CLOSED", SAMPLES.STOCK_REQUEST_CLOSED);
    assert.ok(rejected.includes("하나도 내주지 않고 반려 · 사유: 다른 부품으로 대체"), rejected);
    assert.ok(closed.includes("남은 3개는 주지 않는 것으로 마감"), closed);
    assert.notEqual(rejected, closed);
  });

  it("반출 신청 — A/S 에서 올라온 것은 출처·수리 건 종류가 보인다", () => {
    assert.equal(
      joined("STOCK_REQUEST", SAMPLES.STOCK_REQUEST),
      [
        "사용 · 2026-10-06 · D260101 · No. 61 예시 부품 ×1",
        "A/S 에서 올라옴 (요청 번호 as-req-0001) · 보낸 이름 홍길동 · 포털 번호 portal-sub-0002 · 이 시스템에 계정 없음",
        "인수번호 D260101 · 수리 건 종류 매쳐",
      ].join("\n"),
    );
    // 재고 관리에서 직접 올린 것은 출처 줄을 그리지 않는다(줄마다 「재고 관리」가 붙으면 A/S 가 묻힌다).
    const inventory = joined("STOCK_REQUEST", { type: "USE", summary: "사용 · No. 61 예시 부품 ×1", source: "INVENTORY", externalKey: null, workflowKind: null });
    assert.equal(inventory, ["사용 · No. 61 예시 부품 ×1", "수리 건 종류 모름 (기존 「부품 불출」 절차로 간다)"].join("\n"));
  });

  it("반출 보류 걸기·풀기 — 사유와 돌아간 자리", () => {
    assert.ok(joined("STOCK_REQUEST_HELD", SAMPLES.STOCK_REQUEST_HELD).endsWith("사유: 입고 일정 확인 중"));
    assert.ok(joined("STOCK_REQUEST_HOLD_RELEASED", SAMPLES.STOCK_REQUEST_HOLD_RELEASED).endsWith("이미 나간 수량 2개 · 「일부 나감」 자리로 돌려놓음"));
  });

  it("불출 결재 올림 — 결재선·수량은 센 숫자로 푼다 (배열을 통째로 내보내지 않는다)", () => {
    assert.equal(
      joined("STOCK_ISSUE_APPROVAL_REQUESTED", SAMPLES.STOCK_ISSUE_APPROVAL_REQUESTED),
      [
        "사용 · No. 61 예시 부품 ×3",
        "매쳐 부품 불출 절차 2번째 판 · 결재선 2단계: 1. 김철수 ▶ 2. 이영희",
        "올린 수량 1줄 · 모두 3개 · 신청은 「결재 중」 자리로",
        "사유: 현장 교체용",
      ].join("\n"),
    );
    // 결재할 사람이 없어 곧바로 승인된 건은 다르게 읽혀야 한다 — 「승인은 났는데 왜 안 나갔지」의 답이다.
    const auto = joined("STOCK_ISSUE_APPROVAL_REQUESTED", { ...SAMPLES.STOCK_ISSUE_APPROVAL_REQUESTED, autoApproved: true, steps: [] });
    assert.ok(auto.includes("결재할 사람이 없어 곧바로 승인됨 (이제 [실행]을 기다린다)"), auto);
  });

  it("불출 결재 승인 — 「다음 단계」와 「결재 끝」을 가른다", () => {
    assert.equal(joined("STOCK_ISSUE_APPROVAL_APPROVED", SAMPLES.STOCK_ISSUE_APPROVAL_APPROVED), ["1단계 승인 · 다음 단계로 넘어감", "의견: 확인함"].join("\n"));
    const last = joined("STOCK_ISSUE_APPROVAL_APPROVED", { ...SAMPLES.STOCK_ISSUE_APPROVAL_APPROVED, status: "APPROVED", note: "" });
    assert.equal(last, "1단계 승인 · 마지막 단계라 결재 끝 (이제 [실행]을 기다린다)");
  });

  it("불출 결재 반려 — 반출 신청까지 닫혔나가 보인다", () => {
    assert.equal(
      joined("STOCK_ISSUE_APPROVAL_REJECTED", SAMPLES.STOCK_ISSUE_APPROVAL_REJECTED),
      ["2단계에서 반려 · 결재건은 「반려됨」", "사유: 수량 과다", "반출 신청도 함께 닫음 (다시 필요하면 새로 신청한다)"].join("\n"),
    );
    const old = joined("STOCK_ISSUE_APPROVAL_REJECTED", { ...SAMPLES.STOCK_ISSUE_APPROVAL_REJECTED, requestRejected: false });
    assert.ok(old.endsWith("반출 신청은 그대로 남음 — 담당자가 직접 처리한다"), old);
  });

  it("불출 결재 실행 — 기록 번호·회차·남은 수량", () => {
    assert.equal(joined("STOCK_ISSUE_APPROVAL_EXECUTED", SAMPLES.STOCK_ISSUE_APPROVAL_EXECUTED), "기록 사용 US-2026-10 · 1회차로 3개 내줌 · 남은 수량 없음");
  });

  it("불출 결재 실행 대기 반려·거둠", () => {
    assert.equal(
      joined("STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED", SAMPLES.STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED),
      ["사유: 실물 수량이 맞지 않음", "반출 신청도 함께 닫음 (다시 필요하면 새로 신청한다)"].join("\n"),
    );
    assert.equal(joined("STOCK_ISSUE_APPROVAL_CANCELLED", SAMPLES.STOCK_ISSUE_APPROVAL_CANCELLED), "이미 나간 수량 0개 · 반출 신청을 「대기」 자리로 돌려놓음");
    const oldOne = joined("STOCK_ISSUE_APPROVAL_CANCELLED", { ...SAMPLES.STOCK_ISSUE_APPROVAL_CANCELLED, requestStatus: null });
    assert.ok(oldOne.endsWith("반출 신청은 이미 담당자 손에 있어 그대로 둠"), oldOne);
  });

  it("로그인 거절 — 사유가 한글이고, 개발자가 적어 둔 자세한 사유도 함께 남는다", () => {
    assert.equal(joined("LOGIN_REJECTED", SAMPLES.LOGIN_REJECTED), ["거절 사유: 역할이 아직 지정되지 않음 · 보낸 이름 홍길동 · 포털 번호 portal-sub-0001", "자세한 사유: 역할 지정 없음"].join("\n"));
    // 사람을 모른 채 거절된 것(쿠키 만료 등)은 이름·번호 토막이 붙지 않는다.
    assert.equal(joined("LOGIN_REJECTED", { code: "tx_expired", detail: "왕복 쿠키 없음 또는 만료" }), ["거절 사유: 로그인 왕복 쿠키가 없거나 시간이 지남", "자세한 사유: 왕복 쿠키 없음 또는 만료"].join("\n"));
  });

  it("포털 로그아웃 — 끊긴 사람이 0명인 것도 정상이라 숫자를 적는다", () => {
    assert.equal(joined("BACKCHANNEL_LOGOUT", SAMPLES.BACKCHANNEL_LOGOUT), "포털에서 로그아웃 알림을 받아 이 시스템 세션을 끊음 · 끊긴 사람 1명 · 포털 번호 portal-sub-0001");
    assert.ok(joined("BACKCHANNEL_LOGOUT", { sub: "portal-sub-0003", sid: "sid-0003", affected: 0 }).includes("끊긴 사람 0명"));
  });

  /* ---------------------------------------------------------------- */
  /* 4. 이미 한글로 나오던 22개는 한 글자도 안 바뀐다                   */
  /* ---------------------------------------------------------------- */
  it("🔵 예전부터 한글이던 줄은 글자가 그대로다 (이번 일은 더하는 일이다)", () => {
    // 소유는 글자표를 거친다(`SERVICE_SPARE` → 「보수부재」). DSS·KYOSAN 은 이 저장소가 일부러 영문 그대로 둔 이름이다.
    assert.equal(joined("PART_CREATE", SAMPLES.PART_CREATE), "예시 PCB-001 · 예시 보드 · 보수부재");
    assert.equal(joined("PART_DELETE", SAMPLES.PART_DELETE), "예시 PCB-001 사유 중복 등록");
    assert.equal(joined("PART_ITEM_CREATE", SAMPLES.PART_ITEM_CREATE), "예시 항목");
    assert.equal(joined("PART_ITEM_REORDER", SAMPLES.PART_ITEM_REORDER), "위로 (PCB 와 자리 바꿈)");
    assert.equal(joined("LOGIN", SAMPLES.LOGIN), "역할 ADMIN");
    assert.equal(joined("INTAKE_VERIFIED", SAMPLES.INTAKE_VERIFIED), "D260101 → 예시 기종");
    assert.equal(joined("STOCK_ENTRY", SAMPLES.STOCK_ENTRY), ["2026-10-23 · D260101", "부품 No. 61 (-1) 5개 4개"].join("\n"));
    assert.equal(joined("WORKBOOK_PARKED", SAMPLES.WORKBOOK_PARKED), "수기입 파일을 「현황판_사람수정_20261023-1130.xlsx」 로 따로 보관하고 멈춤 · 169.2 KB");
    assert.equal(
      joined("STOCK_REQUEST_CLOSED", SAMPLES.STOCK_REQUEST_CLOSED),
      ["사용 · No. 61 예시 부품 ×8 (신청자 홍길동)", "요청 8개 중 5개를 내주고, 남은 3개는 주지 않는 것으로 마감 · 사유: 더 들어올 일정 없음"].join("\n"),
    );
    assert.equal(joined("APPROVAL_ROUTE_SAVED", SAMPLES.APPROVAL_ROUTE_SAVED), ["2번째 판 → 3번째 판", "승인 단계 1. 이영희 1. 김철수"].join("\n"));
    assert.equal(joined("APPROVAL_DELEGATION_CREATED", SAMPLES.APPROVAL_DELEGATION_CREATED), ["김철수 님에게 2026-10-24 ~ 2026-10-25 동안 내 결재권을 맡김", "사유: 출장"].join("\n"));
    assert.equal(joined("APPROVAL_DELEGATION_REVOKED", SAMPLES.APPROVAL_DELEGATION_REVOKED), "김철수 님에게 맡긴 위임(2026-10-25까지)을 되돌림");
    assert.equal(joined("OH_PRICE_SET", SAMPLES.OH_PRICE_SET), "O/H 단가 예시 PCB-001 (정하지 않음) ₩15,000");
    assert.equal(joined("OH_TEMPLATE_MODEL_LINKED", SAMPLES.OH_TEMPLATE_MODEL_LINKED), "제품 모델 「예시 기종」 연결");
    assert.equal(joined("OH_TEMPLATE_MODEL_UNLINKED", SAMPLES.OH_TEMPLATE_MODEL_UNLINKED), "제품 모델 「예시 기종」 연결 해제");
    assert.equal(joined("STOCK_REQUEST_CANCELLED", SAMPLES.STOCK_REQUEST_CANCELLED), "사용 · No. 61 예시 부품 ×1 · A/S 에서 거둠 (요청 번호 as-req-0001)");
  });

  it("🔵 부품 수정은 바뀐 칸마다 한 줄이고 금액에 통화 기호가 붙는다", () => {
    const lines = linesOf("PART_UPDATE");
    assert.deepEqual(lines, [
      { kind: "field", field: "품명", before: "예시 PCB-001", after: "예시 PCB-002" },
      { kind: "field", field: "공급가", before: "¥1,000", after: "¥1,200" },
    ]);
    // 통화가 원으로 바뀐 기록은 앞·뒤가 각자의 통화로 읽힌다.
    const krw = linesOf2("PART_UPDATE", { changes: { supplyPrice: { before: 1000, after: 1200 } }, supplyCurrency: { before: "JPY", after: "KRW" } });
    assert.deepEqual(krw, [{ kind: "field", field: "공급가", before: "¥1,000", after: "₩1,200" }]);
    // 바깥(A/S)이 채운 것이면 누가 채웠는지 한 줄이 더 붙는다.
    const filled = linesOf2("PART_UPDATE", { changes: { customerName: { before: "", after: "예시 고객 품명" } }, filledBy: { sub: "portal-sub-0004", name: "홍길동" } });
    assert.equal(visibleText(filled[1]), "A/S 통로로 채움 · 보낸 이름 홍길동 · 포털 번호 portal-sub-0004");
  });

  it("🔵 O/H 템플릿 저장은 그때 들어 있던 부품 줄을 글자로 들고 있다", () => {
    const all = joined("OH_TEMPLATE_SAVED", SAMPLES.OH_TEMPLATE_SAVED);
    assert.ok(all.includes("1번째 판 → 2번째 판"), all);
    assert.ok(all.includes("이름 예시 O/H(옛 이름) 예시 O/H"), all);
    assert.ok(all.includes("부품 2줄: 1. 예시 PCB-001 2개 · 2. 예시 패킹 1개 (재고 미연결)"), all);
    assert.equal(joined("OH_TEMPLATE_DELETED", SAMPLES.OH_TEMPLATE_DELETED), "기종  · 예시 O/H 사유 더 쓰지 않음");
  });

  it("🔵 엑셀 기준 적용 — 번호가 없는 옛 줄은 uuid 로 기록 번호를 찾아 보인다", () => {
    assert.ok(joined("WORKBOOK_EXCEL_APPLIED", SAMPLES.WORKBOOK_EXCEL_APPLIED).includes("원장에 적은 기록 2건: US-2026-10, RC-2026-3 · 자동 반영하지 않은 줄 1줄"));
    const oldOne = joined("WORKBOOK_EXCEL_APPLIED", {
      parkedFile: "현황판_사람수정_20261001-0900.xlsx",
      reason: "옛 줄",
      summary: "사용 1",
      entryIds: ["11111111-1111-4111-8111-111111111111", "없는-id"],
    });
    assert.ok(oldOne.includes("원장에 적은 기록 1건: US-2026-9"), oldOne);
  });

  /* ---------------------------------------------------------------- */
  /* 5. JSON 되돌아가는 길은 **지우지 않았다**                          */
  /* ---------------------------------------------------------------- */
  it("🔵 모르는 모양은 여전히 JSON 그대로 (숨기면 원인을 못 찾는다)", () => {
    // 글자표에 없는 행위(옛 줄·손으로 넣은 줄)는 화면이 이 길로 보낸다.
    const unknown = unknownAuditDetail({ 뭔가: 1 });
    assert.equal(unknown.unknown, true);
    assert.deepEqual(unknown.lines, [{ kind: "text", text: '{"뭔가":1}' }]);
    // 아는 행위인데 모양이 깨진 옛 줄(부품 수정에 changes 가 없다)도 같은 길로 간다.
    const broken = auditDetailLines("PART_UPDATE", { 뭔가: 1 }, CTX);
    assert.equal(broken.unknown, true);
    assert.deepEqual(broken.lines, [{ kind: "text", text: '{"뭔가":1}' }]);
    const brokenEntry = auditDetailLines("STOCK_ENTRY", { occurredOn: "2026-10-23" }, CTX);
    assert.equal(brokenEntry.unknown, true);
  });
});

/** 본보기 대신 다른 `detail` 을 넣어 볼 때. */
function linesOf2(action: AuditAction, detail: Record<string, unknown>): AuditDetailLine[] {
  return auditDetailLines(action, detail, CTX).lines;
}
