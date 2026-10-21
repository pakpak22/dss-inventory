import { APPROVAL_DELEGATE_UNNAMED, approvalDelegateSuffix } from "./delegate-label";
import { type ApprovalStepActor } from "./delegation";
import { partIssueLockFor } from "./part-issue-gate";
import { PART_ISSUE_STATUS_LABELS, type PartIssueStatus } from "./part-issue-rules";
import type { EntryType } from "@/lib/stock/codes";
import type { RequestItemView } from "@/lib/stock/request-item-detail";

/**
 * ============================================================================
 * 부품 불출 결재 화면 — 순수 규칙 · 문구 · 화면이 받는 모양 (2026-10-15, 조각 11b)
 * ============================================================================
 * 「승인 요청건」 화면(`src/components/stock/IssueApprovalScreen.tsx` ·
 * `IssueApprovalTrail.tsx`)이 쓰는 **판정과 글자**를 여기 모은다. 화면 파일에 풀어 놓지 않는
 * 까닭 둘:
 *
 *  1. 🔴 **이 저장소에는 화면 렌더 시험이 없다**(시험은 전부 순수 함수다). 화면 안에 적은 규칙은
 *     아무도 돌려 보지 못한 채 운영으로 나간다 — `./part-issue-rules.ts` 머리말과 같은 까닭이고,
 *     같은 처방이다. 그래서 「상자 색과 글자」·「(다)에서 (나)를 빼기」·「0건일 때 뭐라고
 *     말하나」를 여기 내려 두고 `tests/part-issue-screen.test.ts` 가 전수를 돌려 본다.
 *  2. 🔴 **서버/클라이언트 경계**: 이 파일은 `server-only` 를 **직접도 타입으로도** 끌어오지
 *     않는다. 결재건을 읽는 `./part-issue.ts` 는 `server-only` 라 화면 조각이 가져오면 빌드가
 *     깨지고, 같은 모양을 화면 쪽에 한 벌 더 적으면 칸이 늘 때 한쪽만 고쳐진다(`./view.ts` 가
 *     결재선에서 같은 까닭으로 생긴 자리다).
 *
 * ── 🔴 화면으로 내려가는 모양에는 **포털 번호가 없다** ──────────────────
 * 결재선 그림에 필요한 것은 **이름**이지 번호가 아니다. 포털 번호(`approver_sub`)는 결재자
 * 판정의 열쇠이자 신원을 가리키는 값이라, 서버가 판정을 끝내고 `skipped` 한 칸만 실어 보낸다
 * (`./queries.ts` 머리말에서 번호가 든 조회와 화면용 조회를 가른 까닭과 같다). 아래 어느
 * 타입에도 번호를 담는 칸이 없다 — 칸이 없으면 다음 사람이 실어 보낼 수도 없다.
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* 화면이 받는 모양                                                     */
/* ------------------------------------------------------------------ */

/**
 * 한 줄 — **이번에 줄 부품과 수량.** 결재건에 적힌 줄별 수량(`quantities`)에 반출 신청에서
 * 읽은 품명·부품 칸 넷·지금 재고를 붙인 것이다.
 *
 * 🔴 `available` 은 **신청 당시가 아니라 지금 재고**다. 결재가 도는 동안 재고는 움직이고,
 * 모자라면 실행 순간 원장이 거절한다 — 누르기 전에 보여 주려고 싣는다(`RequestLineView` 의
 * 같은 칸과 같은 뜻).
 *
 * 🔴 **신청 항목 한 줄의 모양(`RequestItemView`)을 물려받는다**(2026-10-21, 쓰는 분 접수 5번: 「승인
 *    요청건에서도 어느 부품인지 알아보게」 · 같은 날 접수: 「소유구분과 유상/무상도」). 들고 오는 것은
 *    **부품 쪽 값**(`partNo`·고객사 품명·품명2·교산 품번·도번·**소유구분**)과 **줄 쪽 값**(**유상/무상**)이고,
 *    🔴 그 둘이 **성격이 다르다**는 것은 저쪽 타입이 갈라 들고 있다(`lib/stock/request-item-detail.ts`
 *    머리말). 손으로 베껴 적지 않는 까닭은 칸이 늘 때 한쪽만 고쳐지지 않게 하려는 것이다.
 * 🔵 **조회는 한 글자도 안 고쳤다**: 넷과 소유구분은 `listAllRequests` 가 이미 싣고 있었고
 *    (`RequestLineView`), 여기서는 그 줄에서 **옮겨 적기만** 한다(`./part-issue-screen-data.ts` 의 `linesOf`).
 *    🔴 2026-10-21 전까지 그 옮겨 적기가 **소유구분을 빠뜨리고 있었다** — 조회에는 와 있는데 결재건 줄로
 *    넘어오지 않아 「승인 요청건」에서만 안 보였다(넷이 같은 자리에서 빠져 있던 것과 **똑같은 모양**이다).
 * 🔵 **결재건 자체에는 그 칸들이 없다** — 결재건이 적어 두는 것은 `{ partId, quantity }` 뿐이고,
 *    이름·품번·소유는 **지금 부품 표의 값**이 맞는 말이다(결재가 도는 동안 담당자가 고칠 수 있다).
 *    🔴 **유상/무상만 자리가 다르다** — 그것은 부품 표가 아니라 **반출 신청 줄**에 적혀 있다.
 */
export type IssueApprovalLine = RequestItemView & {
  partId: string;
  partName: string;
  /** 이번에 줄 수량. 이 결재로 나갈 수량이고, 실행 때 이 값 그대로 원장에 간다. */
  quantity: number;
  /** 그 부품의 지금 재고. */
  available: number;
};

/**
 * 결재선 그림의 상자 하나.
 *
 * 🔴 **번호가 아니라 이름이다**(머리말). `skipped` 는 서버가 이미 있는 순수 함수
 * (`./route.ts` 의 `isRouteStepSkippedForRequester`)로 판정해 실은 값이다 — 화면이 「신청자
 * 본인인가」를 다시 적으면 서버가 사슬을 이을 때 보는 규칙과 갈라진다.
 */
export type IssueApprovalTrailStep = {
  /** 1부터. 건너뛴 자리도 **번호가 건너뛴 채로** 보인다(1 → 3). 고쳐 적지 않는다. */
  stepOrder: number;
  approverName: string;
  /** 신청자 본인이라 결재를 받지 않는 단계인가. */
  skipped: boolean;
  /**
   * 🔴 **그 자리를 실제로 누른 사람이 누구인가** (2026-10-22, 결재권 위임 마지막 조각).
   *
   * 위 `approverName` 은 **그 자리의 주인**(결재선에 적힌 사람)이고, 이것은 **그 자리에서 실제로
   * 일어난 일**이다. 둘이 갈리는 길이 위임 하나뿐이라 2026-10-21 전에는 칸 자체가 없었다
   * (`src/db/schema/stock-issue-approvals.ts` 의 `decided_by_sub` 주석).
   *
   * 🔴 **갈래는 넷이고, 그 판정은 화면이 하지 않는다** — 서버가 포털 번호 둘을 견주어
   *    `approvalStepActor` 로 끝낸다(`skipped` 를 서버가 판정해 싣는 것과 **같은 자리·같은
   *    까닭**이다. 머리말: 아래 어느 타입에도 번호를 담는 칸이 없다).
   * 🔵 그래서 이 값에는 **이름밖에 없다** — 그대로 브라우저로 내려가도 신원을 가리키는 번호가
   *    실려 나가지 않는다.
   */
  decidedBy: ApprovalStepActor;
};

/**
 * 결재선 진행 그림 하나가 받는 것 전부 (2026-10-21, 조각 11f).
 *
 * 🔴 **결재건 카드(`IssueApprovalCard`)에서 그림에 쓰는 셋만 뽑은 모양이다.** 부품 요청 관리
 * (`/requests`)는 결재건을 **보여 주는** 화면이 아니라 신청을 처리하는 화면이라, 사유·줄별 수량·
 * [신청 취소] 같은 칸까지 내려보내면 쓰지도 않을 값이 줄마다 브라우저로 실려 나간다.
 * 🔵 칸 이름은 `IssueApprovalTrail` 의 매개변수와 **같게** 둔다 — 화면이 옮겨 담지 않고 그대로 편다.
 */
export type IssueApprovalTrailView = {
  status: PartIssueStatus;
  /** 지금 열려 있는 단계. 결재가 끝났으면 `null`. */
  currentStep: { stepOrder: number; approverName: string } | null;
  /** 🔴 이 건이 **타고 있는 판**의 단계들 — 지금 설정된 판이 아니다(서버가 결재건의 판으로 읽는다). */
  steps: IssueApprovalTrailStep[];
};

/**
 * 한 신청에 달린 살아 있는 결재건들 중 **그림이 말해야 하는 한 건**을 고른다. 없으면 `null`.
 *
 * 🔴 **고르는 차례를 새로 적지 않는다 — 잠금에게 묻는다**(`partIssueLockFor`). 부품 요청 관리의
 * [상태] 칸이 「결재 중」인지 「실행 대기」인지도 그 함수가 정하므로, 그림이 다른 건을 그리면
 * **한 줄 안에서 글자와 그림이 서로 다른 말을 한다.** 차례를 여기 손으로 베껴 적으면 언젠가
 * 한쪽만 고쳐지고, 그때 어긋남은 오류가 아니라 **눈으로만 보이는 거짓말**이 된다.
 *
 * 🔵 **목록으로 받는 까닭**은 `partIssueLockFor` 머리말 그대로다 — 표의 부분 유니크 색인이 살아 있는
 *    결재건을 하나로 묶어 두므로 오늘 오는 것은 0개 아니면 1개지만, 「하나」로 적어 두면 둘째가
 *    생기는 날 **아무 말 없이 엉뚱한 건을 그린다.**
 */
export function pickPartIssueTrailSource<T extends { status: PartIssueStatus }>(views: readonly T[]): T | null {
  const lock = partIssueLockFor(views.map((v) => v.status));
  if (lock === null) return null;
  const wanted: PartIssueStatus = lock === "AWAITING_APPROVAL" ? "PENDING_APPROVAL" : "APPROVED";
  return views.find((v) => v.status === wanted) ?? null;
}

/** 결재건 한 장. 🔴 포털 번호도, 사람의 id 도 담지 않는다(머리말). */
export type IssueApprovalCard = {
  id: string;
  status: PartIssueStatus;
  /**
   * 왜 이만큼 빼야 하는가 — 올린 사람이 결재자에게 쓴 글.
   * 🔵 **선택이라 빈 글자일 수 있다**(2026-10-15 결정). 그때 화면은 **그 줄을 그리지 않는다** —
   *    「(없음)」 같은 빈 글자를 여기 채워 넣지 마라.
   */
  reason: string;
  /**
   * **요청 비고** — 부품을 요청한 사람이 신청할 때 적은 말 (2026-10-22).
   *
   * 🔴 **바로 위 `reason`(「신청 사유」)과 다른 사람의 말이다.** 저것은 재고 담당자가 결재를
   *    올리면서 결재자에게 쓴 글이고, 이것은 신청에 실려 온 글이다(A/S 에서 요청했다면 요청한
   *    분이 적은 것이다). 🔴 **이름을 `note` 로 두지 않은 까닭**: 이 화면에는 이미 `note` 라는
   *    이름의 입력 칸이 셋 있다(반려 사유·회차 비고·실행 반려 사유) — 같은 이름을 하나 더 두면
   *    어느 것이 누구의 말인지 코드에서 가를 수 없다.
   * 🔵 **비어 있는 것이 정상이다**(안 적었거나 재고 관리에서 직접 올린 신청). 그때 화면은
   *    `reason` 과 **똑같이** 그 줄을 아예 그리지 않는다 — 「(없음)」을 여기 채워 넣지 마라.
   * 🔵 서버가 jsonb 에서 안전하게 뽑아 싣는다(`readRequestNote`). 화면은 글자인지 다시 보지 않는다.
   */
  requestNote: string;
  /** 결재를 **올린** 사람. 반출 신청을 낸 사람과 다를 수 있어 아래 `request` 와 따로 둔다. */
  requestedByName: string;
  requestedAt: string;
  /** 지금 결재 차례. 결재가 끝났으면 `null`. */
  currentStep: { stepOrder: number; approverName: string } | null;
  /** 이 건이 **타고 있는 판**의 단계들(현재 판이 아니다 — 서버가 결재건의 `route_id` 로 읽는다). */
  trail: IssueApprovalTrailStep[];
  lines: IssueApprovalLine[];
  /** 반출 신청 쪽 — 요약 글자와 신청자. 신청을 못 찾으면 `null`(있을 수 없지만 지어내지 않는다). */
  request: { type: EntryType; summary: string; requestedByName: string } | null;
  /** 내가 올린 건인가 — **서버 판정**이다(화면은 세션이 누구인지 모른다). */
  mine: boolean;
  /**
   * [신청 취소]를 그릴까 — 서버가 `checkCanCancelPartIssue` 로 판정해 싣는다.
   * 🔵 **울타리가 아니다.** 막는 자리는 `cancelPartIssueApproval` 의 WHERE 이고, 화면은 눌러도
   *    거절당할 단추를 안 내미는 것뿐이다.
   */
  canCancel: boolean;
};

/* ------------------------------------------------------------------ */
/* 상태 배지                                                            */
/* ------------------------------------------------------------------ */

/**
 * 결재건 상태 배지 색. 🔴 **글자와 짝이다** — 글자는 `PART_ISSUE_STATUS_LABELS` 한 곳에 있고,
 * 색만 보고 상태를 가르지 않게 화면은 **언제나 둘을 함께** 그린다(CLAUDE.md 9-7절).
 *
 * 🔵 색 계열은 부품 요청 관리의 상태 배지(`src/lib/stock/codes.ts` 의 `REQUEST_STATUS_BADGE`)와
 *    맞춘다 — 주황은 기다리는 것, 파랑은 다음 손이 필요한 것, 초록은 끝난 것, 빨강은 반려.
 *    두 화면을 오가는 사람이 같은 색을 다르게 읽지 않게 한다.
 */
export const PART_ISSUE_STATUS_BADGE: Record<PartIssueStatus, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  EXECUTED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-zinc-100 text-zinc-500",
  /**
   * 🔵 **반려와 같은 빨강이다.** 둘 다 「막혔다」이고 사람이 다음에 할 일도 같다(새로 신청한다) —
   * 거의 같은 빨강을 하나 더 만들면 **색이 다른데 뜻은 같은** 자리가 되어 오히려 읽기 어렵다.
   * 가르는 것은 글자이고(「반려됨」 ↔ 「실행 대기에서 반려됨」), 배지는 언제나 색과 글자를 함께
   * 그린다(`partIssueStatusBadge` · CLAUDE.md 9-7절). 🔴 **색만으로 둘을 가르게 만들지 마라.**
   */
  EXECUTION_REJECTED: "bg-red-100 text-red-800",
};

/** 배지에 쓸 글자와 색을 **한 번에** 고른다 — 따로 고르면 「반려인데 초록」 같은 짝이 생긴다. */
export function partIssueStatusBadge(status: PartIssueStatus): { label: string; className: string } {
  return { label: PART_ISSUE_STATUS_LABELS[status], className: PART_ISSUE_STATUS_BADGE[status] };
}

/* ------------------------------------------------------------------ */
/* 결재선 그림 — 한 단계의 「상자 색 + 글자」                             */
/* ------------------------------------------------------------------ */

/** 상자 하나의 모양 — 🔴 **색과 글자를 한 자리에서 함께** 정한다. */
export type PartIssueTrailMark = { boxClass: string; stateLabel: string };

/**
 * 🔴 **색만으로 상태를 구분하지 않는다**(CLAUDE.md 9-7절, A/S 원본 `PartIssueApprovalTrail` 의
 * 까닭 그대로). 색과 글자를 한 상수에 묶어 두는 것이 그 처방이다 — 따로 두면 한쪽만 늘어나고,
 * 그때 색약인 사람에게는 모든 상자가 같아 보인다.
 */
export const PART_ISSUE_TRAIL_MARKS = {
  /** 이미 결재된 자리. */
  DONE: { boxClass: "border-green-300 text-green-700", stateLabel: "완료" },
  /** 아직 차례가 오지 않은 자리. */
  UPCOMING: { boxClass: "border-zinc-200 text-zinc-500", stateLabel: "대기" },
  /**
   * 🔴 신청자 본인이라 결재를 받지 않는 자리. **「완료」로 칠하면 거짓말이다** — 아무도
   * 승인하지 않았는데 승인된 것처럼 보인다. 중립색 + 점선 + 글자 셋으로 말한다.
   */
  SKIPPED: { boxClass: "border-dashed border-zinc-300 text-zinc-400", stateLabel: "건너뜀 · 신청자 본인" },
  /** 지금 열려 있는 자리. */
  CURRENT: { boxClass: "border-blue-300 text-blue-700", stateLabel: "지금 차례" },
  /** 결재자가 반려해 닫힌 자리. */
  REJECTED: { boxClass: "border-red-300 text-red-700", stateLabel: "반려" },
  /**
   * 🔴 올린 사람이 거둬서 닫힌 자리. 반려와 **같은 색을 쓰지 않는다** — 일어난 일이 다르고,
   * 같은 붉은 상자로 그리면 되짚는 사람이 「누가 막았나」를 잘못 읽는다.
   */
  CANCELLED: { boxClass: "border-zinc-300 text-zinc-600", stateLabel: "거둠" },
} as const satisfies Record<string, PartIssueTrailMark>;

/**
 * 그 단계가 지금 어디쯤인가.
 *
 * @param stepOrder 그릴 상자의 단계 번호.
 * @param currentStepOrder **사슬이 지금 서 있는 단계.** 열린 단계가 없으면 `null`.
 *   🔵 화면 세 묶음에 뜨는 건은 `PENDING_APPROVAL`(열린 단계가 꼭 하나 있다)과
 *   `APPROVED`(열린 단계가 없다) 둘뿐이라, 실제로 오는 값은 그 둘이다.
 * @param status 결재건의 상태.
 * @param skipped 신청자 본인이라 건너뛰는 자리인가(서버가 순수 함수로 판정해 실은 값).
 *
 * 🔴 **건너뛴 자리를 먼저 본다.** 「앞이면 완료」에 그대로 걸리면 아무도 승인하지 않은 상자가
 * 「완료」로 보인다. 다만 **지금 열려 있는 단계 자신**은 건너뜀으로 칠하지 않는다 — 실제로
 * 열려 있는 차례를 부정하게 된다.
 *
 * 🔵 `currentStepOrder` 가 `null` 인데 결재가 끝나지 않은 상태(반려·거둠·결재 중)면 **「대기」**
 * 로 둔다. 어디서 닫혔는지 모르는 채 「반려」를 칠하면 앞서 승인한 사람들의 자리까지 빨개져
 * 거짓이 된다 — 모를 때는 지어내지 않는 편이 낫다.
 *
 * ── 🔴 **실행 대기 반려는 「완료」다** (2026-10-21) ─────────────────────
 * `EXECUTION_REJECTED` 는 열린 단계가 없어 위 갈래에서 「대기」로 떨어졌는데 **그것이 거짓이다** —
 * 그 건은 **단계가 전부 승인으로 닫힌** 건이다(그 상태는 `APPROVED` 에서만 올 수 있다). 「대기」로
 * 그리면 아직 결재가 돌고 있는 것처럼 보이고, 실제로 승인한 사람들의 자리가 **없던 일**이 된다.
 *
 * 🔴 **그렇다고 어느 상자를 빨갛게 칠하지도 않는다.** 「반려」·「거둠」과 다른 일이기 때문이다:
 * 저 둘은 **사슬이 서 있던 그 자리에서** 일어났지만, 이것은 **사슬이 끝난 뒤**에 일어났다 —
 * 막은 사람은 결재자가 아니라 담당자이고, 그 사람의 상자는 결재선에 **아예 없다.** 아무 상자나
 * 빨갛게 칠하면 「그 결재자가 막았다」는 거짓이 된다(단계 줄에 사유를 적지 않고 결재건 쪽에
 * 칸을 둔 것과 **같은 까닭** — `src/db/schema/stock-issue-approvals.ts` 의 그 칸 주석).
 *
 * 🔵 그래서 **상자는 `APPROVED`·`EXECUTED` 와 똑같이 「완료」**이고, 「그 뒤에 막혔다」는
 *    ① 상태 배지(빨강 · 「실행 대기에서 반려됨」)와 ② 그림 위의 한 줄
 *    (`partIssueProgressText`)이 말한다. 그림은 **결재선이 어떻게 흘렀나**만 말하는 자리다.
 */
export function partIssueTrailMark(input: {
  stepOrder: number;
  currentStepOrder: number | null;
  status: PartIssueStatus;
  skipped: boolean;
}): PartIssueTrailMark {
  const { stepOrder, currentStepOrder, status, skipped } = input;
  if (skipped && stepOrder !== currentStepOrder) return PART_ISSUE_TRAIL_MARKS.SKIPPED;

  if (currentStepOrder === null) {
    // 열린 단계가 없다 — 결재가 끝까지 갔거나(승인·불출 완료·실행 대기 반려) 어디선가 닫혔다.
    // 🔴 `EXECUTION_REJECTED` 가 여기 **함께 있어야 한다** — 단계는 전부 승인된 건이다(위 주석).
    if (status === "APPROVED" || status === "EXECUTED" || status === "EXECUTION_REJECTED") return PART_ISSUE_TRAIL_MARKS.DONE;
    return PART_ISSUE_TRAIL_MARKS.UPCOMING;
  }

  if (stepOrder < currentStepOrder) return PART_ISSUE_TRAIL_MARKS.DONE;
  if (stepOrder > currentStepOrder) return PART_ISSUE_TRAIL_MARKS.UPCOMING;

  // 사슬이 서 있는 바로 그 자리 — 결재건의 상태가 그 자리에서 무슨 일이 있었는지를 말한다.
  if (status === "REJECTED") return PART_ISSUE_TRAIL_MARKS.REJECTED;
  if (status === "CANCELLED") return PART_ISSUE_TRAIL_MARKS.CANCELLED;
  if (status === "PENDING_APPROVAL") return PART_ISSUE_TRAIL_MARKS.CURRENT;
  return PART_ISSUE_TRAIL_MARKS.DONE;
}

/* ------------------------------------------------------------------ */
/* 결재선 그림 — 「대신 눌렀다」를 상자에 덧붙이는 한 줄                   */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **이름이 안 적힌 대리 결재**에 쓰는 글자.
 *
 * 🔵 **글자 자체는 `./delegate-label.ts` 가 들고 있다**(2026-10-22). 같은 말을 하는 자리가 셋이
 *    되면서(결재선 그림 · 부품 요청 관리의 반려 사유 상자 · 알림 종) 글자를 한 곳으로 모았고,
 *    여기 이름은 **이 화면 묶음이 부르던 그대로** 남겨 두었다 — 그림과 그 시험이 쓰는 이름이다.
 *    🔴 까닭(왜 다른 파일인가)은 그쪽 머리말에 있다: `codes.ts` 가 이 파일을 가져오면 **고리가
 *    생긴다.**
 */
export const PART_ISSUE_TRAIL_DELEGATE_UNNAMED = APPROVAL_DELEGATE_UNNAMED;

/**
 * 결재선 그림의 상자에 **덧붙일 한 줄**. 덧붙일 것이 없으면 `null`.
 *
 * 🔵 **갈래 넷을 글자로 바꾸는 규칙은 `approvalDelegateSuffix` 한 곳에 있다**(2026-10-22) — 거기
 *    주석에 네 갈래의 까닭(특히 **옛 줄(`UNRECORDED`)을 `SELF` 와 합치지 않는** 까닭)이 적혀
 *    있다. 🔴 여기서 다시 가르지 마라: 반려 사유 상자·알림 종이 **같은 함수**를 지나므로, 여기
 *    한 자리만 새로 적으면 같은 결재가 화면마다 다른 말을 한다.
 *
 * 🔵 **「김○○ 결재 (이○○ 대리)」의 뒷부분**이다 — 앞의 이름은 상자가 이미 그리고 있다. 그림만
 *    이렇게 **꼬리만** 받는 까닭은 상자가 좁아 두 줄로 세우기 때문이고(윗줄 이름, 아랫줄 작고
 *    흐린 꼬리), 글줄로 말하는 두 자리는 이름까지 붙은 한 덩이(`approvalDecidedByName`)를 쓴다.
 */
export function partIssueTrailDelegateLabel(actor: ApprovalStepActor): string | null {
  return approvalDelegateSuffix(actor);
}

/** 대리 줄에 다는 설명. 🔴 괄호 넉 자가 무슨 뜻인지는 글자로도 말해 둔다(색·기호만으로 말하지 않는다). */
export const PART_ISSUE_TRAIL_DELEGATE_TITLE = "결재선에 적힌 분을 대신해 결재권을 위임받은 분이 결재했습니다. 윗줄이 원래 결재권자입니다.";

/**
 * 그림 위에 적는 한 줄 — 「결재선 n/m단계 · 지금 차례: ○○○」.
 *
 * 🔴 **뒷자리(m)는 이 건이 타고 있는 판의 단계 수**다. 현재 판을 세면 진행 중이던 건이
 * 「2/2단계」 대신 「2/4단계」로 보인다(A/S 원본의 까닭 그대로).
 * 🔴 **「지금 차례」는 열린 단계가 있을 때만** 적는다 — 끝난 건이 남의 차례를 말하지 않게.
 * 🔵 단계를 못 세었으면(`totalSteps` 가 0) 「2/」 같은 반쪽짜리를 보여 주지 않는다.
 *
 * 🔴 **실행 대기 반려는 「결재 끝」에서 멈추지 않는다** (2026-10-21). 상자들이 전부 「완료」로
 * 그려지므로(`partIssueTrailMark` 의 그 주석) 이 한 줄까지 「결재 끝」이면 **곧 나갈 건으로
 * 읽힌다** — 실제로는 담당자가 막아 끝난 건이다. 🔵 뒤에 붙이는 글자는 상태 이름표 한 벌
 * (`PART_ISSUE_STATUS_LABELS`)에서 가져온다: 여기 손으로 적으면 이름표를 다듬는 날 한쪽만 바뀐다.
 */
export function partIssueProgressText(input: {
  currentStepOrder: number | null;
  currentApproverName: string | null;
  totalSteps: number;
  status: PartIssueStatus;
}): string | null {
  const { currentStepOrder, currentApproverName, totalSteps, status } = input;
  if (totalSteps <= 0) return null;
  if (currentStepOrder !== null) {
    const turn = currentApproverName !== null ? ` · 지금 차례: ${currentApproverName}` : "";
    return `결재선 ${currentStepOrder}/${totalSteps}단계${turn}`;
  }
  if (status === "EXECUTION_REJECTED") return `결재선 ${totalSteps}단계 · 결재 끝 · ${PART_ISSUE_STATUS_LABELS[status]}`;
  if (status === "APPROVED" || status === "EXECUTED") return `결재선 ${totalSteps}단계 · 결재 끝`;
  return `결재선 ${totalSteps}단계`;
}

/* ------------------------------------------------------------------ */
/* (다)에서 (나)를 빼기                                                  */
/* ------------------------------------------------------------------ */

/**
 * 「진행 중인 내 신청」에서 **「실행할 건」에 이미 떠 있는 건을 뺀다.**
 *
 * 🔴 같은 건이 한 화면에 두 번 나오지 않게 하는 자리다. 관리자가 자기 신청을 올리면 승인 뒤
 * 그 건이 (나)와 (다)에 함께 뜬다 — 위에서 [실행]을 누를 수 있는데 아래에도 같은 카드가 있으면
 * 어느 쪽이 참인지 알 수 없다.
 * 🔴 **빼는 것은 (나)가 보이는 세션에서만**이다. (나)를 못 보는 사람에게서 빼면 승인된 자기
 * 신청이 통째로 사라진다 — 그 판정(`isAdmin`)과 빼기는 **서버(페이지)가** 하고 화면은 받은
 * 대로 그린다.
 * 🔵 입력 배열을 건드리지 않고 **새 배열**을 돌려준다.
 */
export function excludeApprovalsInExecuteList<T extends { id: string }>(
  progress: readonly T[],
  executable: readonly { id: string }[],
): T[] {
  const shown = new Set(executable.map((e) => e.id));
  return progress.filter((p) => !shown.has(p.id));
}

/* ------------------------------------------------------------------ */
/* 0건일 때 하는 말                                                      */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **묶음을 함부로 감추지 않는다.** 「지금 할 일이 없다」와 「이 화면은 나와 상관없다」는 다른
 * 말이고, 감추면 사람은 둘을 구분하지 못한다. 0건이면 **그렇게 말한다.**
 * (화면에서 감추는 묶음은 「실행할 건」 하나뿐이고, 그것도 관리자가 아닌 세션에서만이다.)
 */
export const PART_ISSUE_NOTHING_TO_DECIDE = "지금 결재할 건이 없습니다.";
export const PART_ISSUE_NOTHING_TO_EXECUTE = "지금 실행할 건이 없습니다.";
/**
 * 「진행 중인 내 신청」이 비었을 때 — 🔴 **두 문구가 갈린다.** 「실행할 건」이 보이는 세션에서는
 * 거기 떠 있는 건을 이 묶음에서 빼므로(`excludeApprovalsInExecuteList`), 비었다고 「실행을
 * 기다리는 신청이 없다」고 말하면 **틀린다**(위에 있을 수 있다). 그때는 결재 중인 것만 말한다.
 */
export const PART_ISSUE_NOTHING_IN_PROGRESS = "결재 중이거나 실행을 기다리는 내 신청이 없습니다.";
export const PART_ISSUE_NOTHING_AWAITING_APPROVAL = "결재 중인 내 신청이 없습니다.";

/** 위 둘 중 어느 쪽을 말할지 — 가르는 값은 **서버가 뺐는가** 하나다. */
export function partIssueProgressEmptyText(excludesExecutable: boolean): string {
  return excludesExecutable ? PART_ISSUE_NOTHING_AWAITING_APPROVAL : PART_ISSUE_NOTHING_IN_PROGRESS;
}

/**
 * 🔴 실행이 막혀도 **결재건은 그대로 살아 있다**는 사실을 미리 말해 둔다. 서버는 실패하면
 * 아무것도 바꾸지 않고 `APPROVED` 로 남기는데(`executePartIssueApproval`), 화면이 실패만 보여
 * 주면 신청이 사라진 줄 알고 처음부터 다시 올리게 된다 — 그러면 결재도 다시 받아야 한다.
 */
export const PART_ISSUE_EXECUTION_STANDING_NOTICE =
  "실행이 막혀도 결재건은 그대로 남습니다. 입고된 뒤 같은 자리에서 다시 [실행]을 누르면 됩니다.";

/* ------------------------------------------------------------------ */
/* 시각 적기                                                            */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **시간대를 박는다**(CLAUDE.md 10절). 운영 서버(NAS)는 UTC 라 `date.getFullYear()` 꼴로
 * 쓰면 서버가 그린 글자와 브라우저가 그린 글자가 **달라진다**(hydration 이 어긋나고 날짜가
 * 하루 밀려 보인다). 부품 요청 관리 화면이 쓰는 것과 **같은 셈**이다.
 */
const AT_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 「2026-10-15 13:40」. 🔴 **연도를 남긴다** — 결재건은 해를 넘겨 남아 있을 수 있어 월·일만으로는
 * 작년 것과 구별되지 않는다. 🔵 읽을 수 없는 값은 받은 글자를 그대로 돌려준다(화면이 깨지지 않게).
 */
export function formatPartIssueMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = AT_PARTS.formatToParts(date);
  const at = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")} ${at("hour")}:${at("minute")}`;
}

/* ------------------------------------------------------------------ */
/* 단추를 누르고 돌아왔을 때의 한 줄                                      */
/* ------------------------------------------------------------------ */

/** `info` = 평범한 알림(회색), `warn` = 아직 끝나지 않은 것이 있음(주황). 모양은 화면이 정한다. */
export type PartIssueNotice = { tone: "info" | "warn"; text: string };

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): boolean => v === "1";
/** 🔴 주소로 온 값이라 숫자가 아니면 0 으로 본다(사람이 주소를 고쳐도 화면이 깨지지 않게). */
const num = (v: string | string[] | undefined): number => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0);

/**
 * 결재·실행·거두기가 **성공한 뒤** 돌아온 자리에서 할 한 줄. 꼬리표가 없으면 `null`.
 *
 * 🔵 **실패는 여기로 오지 않는다** — 실패는 서버 액션이 돌려주는 문구를 그 카드 자리에 그대로
 *    보여 준다(「처리할 수 없습니다」로 뭉개지 않는다는 규칙이 그것이다). 여기 있는 것은
 *    「무슨 일이 일어났는지」뿐이다.
 * 🔵 서버 액션이 한 번에 하나만 붙이므로 둘이 겹칠 일은 없다 — 겹치면 위에서부터 하나만 보인다.
 */
export function partIssueNotice(sp: Params): PartIssueNotice | null {
  if (one(sp.approved)) return { tone: "info", text: "승인했습니다. 다음 단계가 남아 있으면 그분 차례로 넘어갑니다." };
  if (one(sp.rejected)) {
    return { tone: "info", text: "반려했습니다. 이 결재건은 닫혔습니다 — 다시 올리면 처음 단계부터 결재를 받습니다." };
  }
  /**
   * 🔴 **결재 중 반려(`rejected`)와 다른 말을 한다** (2026-10-21). 저쪽은 결재건만 닫히고 반출
   *    신청은 결재자가 되돌린 것이지만, 이쪽은 **신청까지 함께 닫힌다**(`requestStatusAfterPartIssue`).
   *    「다시 올리면 처음 단계부터」로 뭉개면 담당자가 그 신청을 다시 집을 수 있다고 읽는다 —
   *    실제로는 **신청자가 새로 신청해야** 한다. 🔵 사유가 신청 쪽으로 갔다는 것도 말해 준다:
   *    그 글이 어디로 갔는지 모르면 같은 말을 따로 전하러 간다.
   */
  if (one(sp.executionRejected)) {
    return { tone: "info", text: "실행 대기에서 반려했습니다. 반출 신청도 함께 닫혔고, 적어 주신 사유가 신청자에게 그대로 보입니다 — 다시 내주려면 신청자가 새로 신청해야 합니다." };
  }
  if (one(sp.cancelled)) return { tone: "info", text: "올린 결재건을 거뒀습니다. 반출 신청 자체는 그대로 남아 있습니다." };
  if (one(sp.executed)) {
    const issued = num(sp.issued);
    const remaining = num(sp.remaining);
    const left = remaining > 0 ? ` 아직 ${remaining.toLocaleString("ko-KR")}개가 남아 신청은 부품 요청 관리에 그대로 있습니다.` : "";
    return { tone: remaining > 0 ? "warn" : "info", text: `부품을 내줬습니다 (이번에 ${issued.toLocaleString("ko-KR")}개).${left}` };
  }
  return null;
}
