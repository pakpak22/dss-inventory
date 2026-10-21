import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  isPartIssueApprovalRouteInForce,
  isPartIssueLockStatus,
  partIssueConfirmLabel,
  partIssueLockFor,
  PART_ISSUE_APPROVALS_PATH,
  PART_ISSUE_APPROVAL_REQUIRED_MESSAGE,
  PART_ISSUE_CONFIRM_LABEL,
  PART_ISSUE_LOCK_LABELS,
  PART_ISSUE_LOCK_TITLES,
  PART_ISSUE_REASON_LABEL,
  PART_ISSUE_REQUEST_LABEL,
  PART_ISSUE_ROUTE_GONE_MESSAGE,
  type PartIssueLock,
} from "../src/lib/approval/part-issue-gate";
import { OPEN_PART_ISSUE_STATUSES, PART_ISSUE_STATUSES, type PartIssueStatus } from "../src/lib/approval/part-issue-rules";

/**
 * ============================================================================
 * 부품 요청 관리의 [확인]에 단 문 (2026-10-15, 조각 11c)
 * ============================================================================
 * 🔴 **이 저장소에는 DB 시험도 화면 렌더 시험도 없다.** 그래서 두 가지를 갈라 못 박는다:
 *
 *  1. **순수 판정과 글자** — 절차가 쓰이고 있는가 · 그 신청이 잠겼는가 · 그때 뭐라고 부르는가.
 *  2. **두 길이 갈린 모양** — 「바로 확인하는 길」에는 문이 있고 「결재를 거친 실행」에는 없다.
 *     이것은 소스 글자로 잰다. 재고가 나가는 자리라 **되돌릴 수 없는 결함**이 생기는 곳인데,
 *     이 저장소에서 그 두 길을 실제로 돌려 볼 방법이 없기 때문이다. 글자로 재는 것이 약한
 *     울타리인 것은 맞지만, **없는 것보다 훨씬 낫다** — 문을 안쪽 함수로 옮기는 순간
 *     (그러면 결재를 다 받고도 부품이 영영 안 나간다) 이 시험이 그 자리에서 깨진다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 그 함수의 **본문만** 잘라 낸다 — 머리말 주석이 섞이면 「무엇을 부르는가」를 잘못 센다. */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 를 찾지 못했다 — 이름이 바뀌었으면 시험도 함께 고쳐라`);
  const rest = source.slice(start + declaration.length);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

/* ------------------------------------------------------------------ */

describe("① 절차가 없으면 [확인]은 지금 그대로다", () => {
  it("🔴 판이 없으면 거짓 — 기능이 없는 것과 같다", () => {
    assert.equal(isPartIssueApprovalRouteInForce(null), false);
  });

  it("🔴 **단계 0개인 판도** 거짓이다 — 절차를 꺼 둔 것이지 세워 둔 것이 아니다", () => {
    assert.equal(isPartIssueApprovalRouteInForce({ steps: [] }), false);
  });

  it("단추 이름이 「확인」 그대로다 — 한 글자도 다르지 않다", () => {
    assert.equal(partIssueConfirmLabel(false), "확인");
    assert.equal(PART_ISSUE_CONFIRM_LABEL, "확인");
  });

  it("🔴 그때 가는 길도 지금 그대로다 — 줄별 수량을 안 적으면 아예 안 보낸다(= 남은 수량 전부)", () => {
    const actions = src("src/components/stock/RequestActions.tsx");
    assert.ok(/startTransition\(\(\) => confirmAction\(out\)\)/.test(actions), "절차가 없을 때 가던 길(confirmAction)이 사라졌다");
    assert.ok(/if \(lines\.some\(\(l\) => String\(form\.get\(`q:\$\{l\.partId\}`\) \?\? ""\)\.trim\(\) !== ""\)\)/.test(actions), "「한 칸도 안 적었으면 안 보낸다」가 사라졌다");
  });
});

describe("② 절차가 있으면 [확인] 자리가 [불출 신청]이 된다", () => {
  it("단계가 하나라도 있으면 참", () => {
    assert.equal(isPartIssueApprovalRouteInForce({ steps: [{ stepOrder: 1 }] }), true);
    assert.equal(isPartIssueApprovalRouteInForce({ steps: [{ stepOrder: 1 }, { stepOrder: 2 }] }), true);
  });

  it("단추 이름이 바뀐다 — 🔴 재고를 빼지 않으므로 이름도 그렇게 말한다", () => {
    assert.equal(partIssueConfirmLabel(true), "불출 신청");
    assert.equal(PART_ISSUE_REQUEST_LABEL, "불출 신청");
  });

  it("🔴 두 이름이 **다른 말**이다 — 같으면 사람이 눌러 보고 나서야 재고가 안 빠진 것을 안다", () => {
    assert.notEqual(partIssueConfirmLabel(true), partIssueConfirmLabel(false));
  });
});

describe("③ 살아 있는 결재건이 있으면 잠긴다 — 두 자리가 다른 말을 한다", () => {
  it("없으면 잠그지 않는다", () => {
    assert.equal(partIssueLockFor([]), null);
  });

  it("결재 중이면 「승인 대기」, 승인이 끝났으면 「실행 대기」", () => {
    assert.equal(partIssueLockFor(["PENDING_APPROVAL"]), "AWAITING_APPROVAL");
    assert.equal(partIssueLockFor(["APPROVED"]), "AWAITING_EXECUTION");
  });

  it("🔴 둘이 섞이면 「승인 대기」가 이긴다 — 실행해도 결재 중인 건이 남아 있으면 못 올린다", () => {
    assert.equal(partIssueLockFor(["APPROVED", "PENDING_APPROVAL"]), "AWAITING_APPROVAL");
    assert.equal(partIssueLockFor(["PENDING_APPROVAL", "APPROVED"]), "AWAITING_APPROVAL");
  });

  it("🔴 끝난 건은 잠그지 않는다 — 불출 완료·반려·거둠 (전수)", () => {
    for (const status of ["EXECUTED", "REJECTED", "CANCELLED"] as const) {
      assert.equal(partIssueLockFor([status]), null, status);
    }
  });

  it("🔴 잠금이 세는 묶음이 **살아 있는 결재건의 묶음과 같다** (전수) — 갈라지면 조회에 걸린 줄을 보고도 문이 열린다", () => {
    for (const status of PART_ISSUE_STATUSES) {
      const open = (OPEN_PART_ISSUE_STATUSES as readonly PartIssueStatus[]).includes(status);
      assert.equal(partIssueLockFor([status]) !== null, open, status);
      assert.equal(isPartIssueLockStatus(status), open, status);
    }
  });

  it("🔴 「승인 대기」와 「실행 대기」가 **다른 말**이다 — 이름도 풀이도", () => {
    assert.notEqual(PART_ISSUE_LOCK_LABELS.AWAITING_APPROVAL, PART_ISSUE_LOCK_LABELS.AWAITING_EXECUTION);
    assert.notEqual(PART_ISSUE_LOCK_TITLES.AWAITING_APPROVAL, PART_ISSUE_LOCK_TITLES.AWAITING_EXECUTION);
  });

  it("🔵 두 풀이 모두 **갈 곳을 말한다** — 막다른 길을 만들지 않는다", () => {
    for (const lock of ["AWAITING_APPROVAL", "AWAITING_EXECUTION"] as PartIssueLock[]) {
      assert.ok(PART_ISSUE_LOCK_TITLES[lock].includes("승인 요청건"), lock);
      assert.ok(PART_ISSUE_LOCK_LABELS[lock].length > 0, lock);
    }
    assert.equal(PART_ISSUE_APPROVALS_PATH, "/approvals");
  });

  it("🔵 잠긴 자리에서 「승인 요청건」으로 가는 길이 화면에 실제로 그려진다", () => {
    const actions = src("src/components/stock/RequestActions.tsx");
    assert.ok(actions.includes("PART_ISSUE_LOCK_TITLES[issueLock]"), "왜 못 누르는지를 title 로 말하지 않는다");
    assert.ok(actions.includes("href={PART_ISSUE_APPROVALS_PATH}"), "잠긴 자리에서 갈 곳이 없다");
  });
});

describe("④ 🔴 절차가 켜져 있으면 **바로 확인하는 길**이 서버에서 막힌다", () => {
  it("화면만 바꾸지 않는다 — 서버 액션이 같은 판정으로 한 번 더 막는다", () => {
    const body = bodyOf(src("src/app/actions/stock.ts"), "export async function confirmRequestAction");
    const gate = body.indexOf("isPartIssueApprovalRouteInForce(");
    const call = body.indexOf("await confirmRequest(");
    assert.notEqual(gate, -1, "confirmRequestAction 에 문이 없다 — 옛 화면을 띄워 둔 탭에서 그대로 나간다");
    assert.notEqual(call, -1, "confirmRequestAction 이 confirmRequest 를 안 부른다 — 시험이 낡았다");
    assert.ok(gate < call, "🔴 문이 원장 호출보다 **뒤**에 있다 — 그러면 이미 나간 뒤에 막는다");
    assert.ok(body.includes("PART_ISSUE_APPROVAL_REQUIRED_MESSAGE"), "막을 때 까닭을 말하지 않는다");
  });

  it("막을 때 **무엇을 해야 하는지**까지 말한다 — 「할 수 없습니다」로 끝내지 않는다", () => {
    assert.ok(PART_ISSUE_APPROVAL_REQUIRED_MESSAGE.includes("불출 신청"));
    assert.ok(PART_ISSUE_APPROVAL_REQUIRED_MESSAGE.includes("새로 고치"));
    // 🔴 영어 개발자 문구가 사람 화면에 나가지 않는다 (CLAUDE.md 10절).
    assert.ok(!/[A-Za-z_]{4,}/.test(PART_ISSUE_APPROVAL_REQUIRED_MESSAGE));
  });

  it("🔴 반대 경우 — 올리는 사이 절차가 꺼졌으면(`NO_ROUTE`) 조용히 넘기지 않는다", () => {
    const body = bodyOf(src("src/app/actions/part-issue.ts"), "export async function requestPartIssueAction");
    assert.ok(body.includes('r.code === "NO_ROUTE" ? PART_ISSUE_ROUTE_GONE_MESSAGE : r.message'), "NO_ROUTE 를 가려내 말이 되는 문구로 바꾸지 않는다");
    assert.ok(PART_ISSUE_ROUTE_GONE_MESSAGE.includes("새로 고치"));
    assert.ok(PART_ISSUE_ROUTE_GONE_MESSAGE.includes("확인"));
  });
});

describe("⑤ 🔴 그런데 **결재를 거친 실행**은 막히지 않는다", () => {
  it("🔴 원장으로 가는 안쪽 함수(`confirmRequest`)에는 문이 없다 — 있으면 결재를 다 받고도 부품이 영영 안 나간다", () => {
    const requests = src("src/lib/stock/requests.ts");
    assert.ok(!requests.includes("isPartIssueApprovalRouteInForce"), "원장 쪽 함수에 문이 달렸다");
    const approvalImports = requests.match(/^import .*@\/lib\/approval\/.*$/gm);
    assert.equal(approvalImports, null, "원장 쪽 함수가 결재 모듈을 끌어온다 — 두 길이 다시 한 문을 지나게 된다");
  });

  it("실행은 그 안쪽 함수를 **직접** 부른다 — 서버 액션의 문을 지나지 않는다", () => {
    const body = bodyOf(src("src/lib/approval/part-issue.ts"), "export async function executePartIssueApproval");
    assert.ok(body.includes("await confirmRequest("), "실행이 원장으로 가는 길을 잃었다");
    assert.ok(!body.includes("isPartIssueApprovalRouteInForce"), "실행하는 길에 문이 달렸다");
    assert.ok(!body.includes("confirmRequestAction"), "실행이 서버 액션을 거친다 — 그러면 문에 걸린다");
  });

  it("실행 서버 액션도 [확인] 액션을 거치지 않는다", () => {
    const body = bodyOf(src("src/app/actions/part-issue.ts"), "export async function executePartIssueAction");
    assert.ok(body.includes("executePartIssueApproval("), "실행 액션이 실행 함수를 안 부른다 — 시험이 낡았다");
    assert.ok(!body.includes("confirmRequestAction"), "실행 액션이 [확인] 액션을 거친다 — 그러면 문에 걸린다");
  });
});

describe("⑥ 🔴 화면은 다시 판정하지 않는다", () => {
  it("두 화면 조각 어디서도 판정 함수를 스스로 부르지 않는다 — 서버가 내려보낸 값만 쓴다", () => {
    for (const file of ["src/components/stock/RequestManagerScreen.tsx", "src/components/stock/RequestActions.tsx"]) {
      const source = src(file);
      assert.ok(!/isPartIssueApprovalRouteInForce\(/.test(source), `${file} 가 절차 판정을 스스로 한다`);
      assert.ok(!/partIssueLockFor\(/.test(source), `${file} 가 잠금 판정을 스스로 한다`);
    }
  });

  it("판정은 서버 컴포넌트가 해서 내려보낸다", () => {
    const page = src("src/app/(app)/requests/page.tsx");
    assert.ok(page.includes("isPartIssueApprovalRouteInForce("), "서버가 절차 판정을 안 한다");
    assert.ok(page.includes("partIssueLockFor("), "서버가 잠금 판정을 안 한다");
    // 🔵 신청마다 묻지 않는다 — 묶음으로 한 번에 읽는다.
    assert.ok(page.includes("listOpenPartIssueStatusesByRequest(requests.map((r) => r.id))"), "신청 묶음으로 한 번에 읽지 않는다");
  });

  it("🔴 잠금은 **그리는 단계에서만** 건다 — 반려·마감·보류·신청 취소는 손대지 않는다", () => {
    const actions = src("src/components/stock/RequestActions.tsx");
    for (const gate of ["const canClose = canDecide && status === \"PARTIAL\";", "const canReject = canDecide && status === \"PENDING\";", "const canHold = canDecide && !held;", "const canRelease = canDecide && held;"]) {
      assert.ok(actions.includes(gate), `다른 단추의 조건이 바뀌었다: ${gate}`);
    }
    assert.ok(!/canCancel = .*issueLock/.test(actions), "[신청 취소]에까지 잠금이 번졌다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑦ 🔵 [불출 신청]의 사유는 **선택**이다 (2026-10-15 쓰는 분 결정)", () => {
  it("🔴 화면에 필수 표시가 없다 — 별표도 `required` 도 `minLength` 도", () => {
    assert.ok(!PART_ISSUE_REASON_LABEL.includes("*"), "라벨에 별표가 남아 있다 — 사람은 아직 필수인 줄 안다");
    assert.ok(PART_ISSUE_REASON_LABEL.includes("선택"), "비워도 된다는 말이 어디에도 없다");

    const actions = src("src/components/stock/RequestActions.tsx");
    // 🔵 **놓아 둔 사유 칸으로 집는다** — 이 화면에는 `name="reason"` 이 둘이고(보류 사유도 같은 이름),
    //    보류 쪽은 **그대로 필수**다. 자리 순서로 집으면 그 둘이 뒤바뀌는 날 조용히 엉뚱한 칸을 잰다.
    const field = /<input name="reason"[^>]*PART_ISSUE_REASON_PLACEHOLDER[^>]*\/>/.exec(actions);
    assert.ok(field !== null, "[불출 신청]의 사유 칸을 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(!/\brequired\b/.test(field[0]), "화면이 아직 `required` 로 막는다 — 비워 두고 누를 수 없다");
    assert.ok(!/\bminLength\b/.test(field[0]), "화면이 아직 `minLength` 로 막는다");
  });

  it("🔴 서버 쪽 두 글자 울타리도 **함께** 풀렸다 — 한쪽만 풀면 눌러도 거절당한다", () => {
    const body = bodyOf(src("src/app/actions/part-issue.ts"), "export async function requestPartIssueAction");
    assert.ok(body.includes('cleanNote(formData.get("reason"))'), "서버가 사유를 읽지 않는다 — 시험이 낡았다");
    assert.ok(!/reason\.length\s*<\s*2/.test(body), "서버가 아직 두 글자 미만을 거절한다 — 화면만 풀면 눌렀을 때 거절당한다");
    assert.ok(!/reason\.length\s*<\s*2/.test(src("src/components/stock/RequestActions.tsx")), "화면이 아직 두 글자 미만을 거절한다");
  });

  it("🔴 사유가 비면 결재 화면이 **그 줄을 그리지 않는다** — 「(없음)」 같은 빈 글자를 지어내지 않는다", () => {
    const screen = src("src/components/stock/IssueApprovalScreen.tsx");
    assert.ok(screen.includes("{card.reason ?"), "사유 줄을 조건 없이 그린다 — 비면 따옴표만 남은 빈 상자가 된다");
    assert.ok(!screen.includes("(없음)"), "빈 자리를 글자로 채운다");
  });

  it("🔵 「적으십시오」라고 말하던 문구는 **말할 자리가 없어져** 사라졌다", () => {
    const gate = src("src/lib/approval/part-issue-gate.ts");
    assert.ok(!/export const PART_ISSUE_REASON_REQUIRED_MESSAGE/.test(gate), "아무도 쓰지 않는 문구 상수가 남아 있다 — 다음 사람이 「아직 쓰나?」로 헤맨다");
  });

  it("🔴 **[보류] 사유는 그대로 필수다** — 이 완화는 [불출 신청] 사유 하나에만 걸린다", () => {
    const actions = src("src/components/stock/RequestActions.tsx");
    assert.ok(actions.includes('<input name="reason" required minLength={2} maxLength={500} className={FIELD} placeholder="예: 부품 입고 대기, 신청자 확인 필요" />'), "보류 사유의 울타리가 함께 풀렸다");
  });
});

/* ------------------------------------------------------------------ */

/**
 * ⑧ 「실행 대기」와 진행 그림 (2026-10-21, 조각 11f).
 *
 * 🔴 여기서 글자로 재는 것은 둘이다:
 *  1. **같은 건을 두 시스템이 같은 이름으로 부른다** — A/S 통로가 재고 관리 화면과 **같은 조회·같은
 *     판정**으로 잠금을 읽는가. 비슷한 것을 저쪽에 새로 적으면 두 화면이 다른 답을 하는 날이 오는데,
 *     그 어긋남은 오류를 내지 않아 **아무도 신고하지 않는다.**
 *  2. **줄마다 묻지 않는가** — 이 통로는 신청을 여러 건 한 번에 내주므로, 줄마다 물으면 호출 한 번이
 *     질의 수십 번이 된다.
 */
describe("⑧ 「실행 대기」 — 두 화면이 같은 이름으로 부른다 (2026-10-21)", () => {
  it("🔴 A/S 통로가 **재고 관리 화면과 같은 조회·같은 판정**으로 잠금을 읽는다", () => {
    const route = src("src/app/api/v1/stock-requests/route.ts");
    assert.ok(route.includes("listOpenPartIssueStatusesByRequest("), "통로가 결재건을 아예 읽지 않는다 — 글자가 옛것으로 남는다");
    assert.ok(route.includes("partIssueLockFor("), "통로가 잠금 판정을 제 손으로 적었다 — 두 화면이 다른 답을 하는 날이 온다");
  });

  it("🔴 통로가 **묶음으로 한 번에** 읽는다 — 줄마다 물으면 호출 한 번이 질의 수십 번이 된다", () => {
    const body = bodyOf(src("src/app/api/v1/stock-requests/route.ts"), "async function issueLocksOf");
    assert.ok(body.includes("listOpenPartIssueStatusesByRequest(requestIds)"), "묶음 조회가 아니다");
    for (const call of ["issueLocksOf(rows.map((r) => r.request.id))", "issueLocksOf(found.map((f) => f.request.id))"]) {
      assert.ok(src("src/app/api/v1/stock-requests/route.ts").includes(call), `묻는 법 한쪽이 잠금을 안 싣는다: ${call}`);
    }
  });

  it("🔴 통로가 내주는 **`code` 는 손대지 않는다** — A/S 가 그 값으로 [요청 취소] 단추를 가린다", () => {
    const status = src("src/lib/api/stock-request-status.ts");
    assert.ok(status.includes("status: { code: r.status, label: requestStatusLabel(r.status, closed, r.issueLock) }"), "`code` 가 상태 그대로가 아니다 — A/S 의 단추가 조용히 어긋난다");
  });

  it("🔴 글자가 적힌 자리는 **한 곳**이다 — 통로도 화면도 「실행 대기」를 제 손으로 박지 않는다", () => {
    // 🔵 주석에 적힌 「실행 대기」는 설명이다. 재는 것은 **따옴표에 박힌 글자** — 그것이 두 벌이 되면 갈린다.
    const quoted = /["'`]실행 대기["'`]/;
    for (const file of ["src/lib/api/stock-request-status.ts", "src/components/stock/RequestManagerScreen.tsx", "src/app/api/v1/stock-requests/route.ts"]) {
      assert.ok(!quoted.test(src(file)), `${file} 에 「실행 대기」가 글자로 박혀 있다 — 글자를 고치는 날 한쪽만 바뀐다`);
    }
    assert.ok(quoted.test(src("src/lib/stock/codes.ts")), "글자가 적힌 그 한 곳이 사라졌다 — 시험이 낡았다");
  });
});

describe("⑧-2 결재선 진행 그림 — 판정은 서버가 하고 화면은 그린다 (2026-10-21)", () => {
  it("🔴 자료를 읽는 일은 **서버 컴포넌트**가 한다 — 화면 조각이 읽으면 빌드가 깨진다", () => {
    const page = src("src/app/(app)/requests/page.tsx");
    assert.ok(page.includes("readPartIssueTrailsByRequest(requests.map((r) => r.id))"), "서버가 진행 그림 자료를 묶음으로 읽지 않는다");
    assert.ok(page.includes("issueTrails={issueTrails}"), "읽어 놓고 화면에 내려보내지 않는다");
    assert.ok(!src("src/components/stock/RequestManagerScreen.tsx").includes("part-issue-screen-data"), "화면 조각이 server-only 사슬을 끌어온다");
  });

  it("🔴 화면이 **그릴 건을 스스로 고르지 않는다** — 고르는 자리는 순수 함수 한 곳이다", () => {
    const screen = src("src/components/stock/RequestManagerScreen.tsx");
    assert.ok(!screen.includes("pickPartIssueTrailSource("), "화면이 그릴 결재건을 스스로 고른다");
    assert.ok(screen.includes("<IssueApprovalTrail status={issueTrail.status}"), "받은 값을 그대로 펴지 않는다");
  });

  it("🔴 그림의 단계는 **그 결재건이 타고 있는 판**이다 — 지금 설정된 판을 집어 오지 않는다", () => {
    const body = bodyOf(src("src/lib/approval/part-issue-screen-data.ts"), "export async function readPartIssueTrailsByRequest");
    assert.ok(body.includes("routeStepsByRouteId("), "판을 결재건의 route_id 로 읽지 않는다");
    assert.ok(!body.includes("getCurrentApprovalRoute"), "현재 판을 집어다 그린다 — 절차를 바꾸면 없는 결재자가 그려진다");
  });

  it("🔴 **그림도 잠금과 같은 묶음**에서 나온다 — 한쪽에만 있는 줄이 생기면 글자와 그림이 갈린다", () => {
    const body = bodyOf(src("src/lib/approval/part-issue.ts"), "export async function listOpenPartIssueApprovalsByRequest");
    assert.ok(body.includes("inArray(stockIssueApprovals.status, [...OPEN_PART_ISSUE_STATUSES])"), "살아 있는 결재건 묶음으로 좁히지 않는다");
    assert.ok(body.includes("if (ids.length === 0) return out;"), "빈 입력에도 DB 를 부른다");
  });
});
