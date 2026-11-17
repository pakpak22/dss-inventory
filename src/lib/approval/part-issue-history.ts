import type { EntryType } from "@/lib/stock/codes";
// 🔵 순수 → 순수 import 다. 이 파일도 `server-only` 를 물지 않으므로 화면 묶음이 끌어와도
//    빌드가 깨지지 않는다(`./part-issue-rules.ts` 머리말의 같은 자리).
import { approvalStepActor, type ApprovalStepDecision } from "./delegation";
import type { PartIssueStepStatus } from "./part-issue-rules";
import { APPROVAL_ROUTE_SCOPE_LABELS, type ApprovalRouteScope } from "./route";

/**
 * ============================================================================
 * 결재 내역 — 순수 규칙 (2026-11-17, 결재권 위임 조각 10a)
 * ============================================================================
 * 「내가 했던 결재」와 「나를 대신해서 한 결재」를 **기간으로 가로질러** 보여 주기 위한 층이다.
 * DB 도 서버도 여기서 만지지 않는다 — 읽어 오는 일은 `./part-issue.ts` 의
 * `listPartIssueApprovalHistoryFor` 가 하고, 여기는 **받은 한 줄이 그 사람에게 무엇인가**만 답한다.
 *
 * 🔵 **화면은 이 집에 없다.** 보여 주는 자리는 통합 승인함(`dss-approvals`) 한 곳이고
 * (2026-11-17 쓰는 분 결정), 이 집은 조회와 그 조회가 타는 색인까지만 만든다. 그래서 이 파일에
 * 이름표(「직접」·「대신」 같은 글자)가 없다 — 말을 여기서 정하면 세 시스템이 승인함 한 창에서
 * **저마다 다른 말**을 하게 된다. 갈래의 **값**만 내주고 글자는 그 창이 정한다.
 *
 * ── 🔴 이 집에는 「대신 눌렀다」 전용 칸이 없다 ─────────────────────────
 * A/S 에는 `delegated_from_user_id` 가 있어 미리 계산된 값을 읽으면 되지만, 이 집은 **한 줄 안의
 * 두 칸을 견준다**: `decided_by_sub <> approver_sub` 면 대신 누른 것이다(설계
 * `dss-approvals/DELEGATION_DESIGN.md` 의 「C-4 보충」). 🔴 **그 견줌을 여기서 다시 적지 않는다** —
 * 저장소에 한 자리뿐인 `approvalStepActor`(`./delegation.ts`)가 가르고, 이 파일은 그 답을
 * **보는 사람 쪽으로 돌려 세울** 뿐이다. 두 벌이 되면 옛 줄이 「본인」으로, 또는 더 나쁘게
 * 「대리」로 둔갑한다.
 * ============================================================================
 */

/**
 * **결재가 실제로 난** 단계 상태. 🔴 `REQUESTED` 가 여기 없는 것이 이 조각의 핵심이다 —
 * 아직 눌리지 않은 줄은 「내역」이 아니라 **지금 할 일**이고, 그 목록은 따로 있다
 * (`listPartIssueApprovalsToDecide`).
 *
 * 🔴 **조회가 이 묶음을 손으로 다시 적지 않는다.** 두 벌로 적으면 한쪽만 고쳐지는 날이 오고,
 * 그때 내역에 「아직 안 누른 건」이 섞인다 — 사람은 그것을 「내가 결재했다」로 읽는다.
 * 🔵 표의 `…_decision_metadata` CHECK 가 이 둘에는 `decided_at` 이 반드시 있음을 지켜 준다.
 */
export const PART_ISSUE_DECIDED_STEP_STATUSES = ["APPROVED", "REJECTED"] as const satisfies readonly PartIssueStepStatus[];
export type PartIssueDecidedStepStatus = (typeof PART_ISSUE_DECIDED_STEP_STATUSES)[number];

/**
 * 갈래를 가르는 데 필요한 단계 한 줄. `ApprovalStepDecision`(그 자리의 주인 · 누른 사람 · 시각)에
 * **자리 주인의 이름**만 보탠 것이다 — 「내가 **누구를** 대신해 눌렀나」에 답하려면 그 이름이 있어야 한다.
 */
export type PartIssueHistoryStep = ApprovalStepDecision & {
  /** 🔵 **그때 복사해 굳힌 사본**이다(표 주석). 조인이 아니라 이 값을 쓰므로 지워진 계정도 읽힌다. */
  approverName: string;
};

/**
 * 🔴 **이 한 줄이 「보는 사람」에게 무엇인가** — 셋(+ 옛 줄).
 *
 * `approvalStepActor` 의 갈래는 **줄 자체**를 보고 「본인이 눌렀나 대리인이 눌렀나」를 말하지만,
 * 결재 내역은 **보는 사람이 어느 쪽에 서 있느냐**에 따라 뜻이 갈린다. 같은 `DELEGATED` 한 줄이
 * 대리인에게는 「내가 대신 눌렀다」이고 자리 주인에게는 「내 자리를 남이 눌렀다」다. 그래서
 * 갈래를 **새로 짓지 않고 돌려 세운다.**
 */
export type PartIssueHistoryRole =
  /** 내가 **내 자리**를 내 손으로 눌렀다. */
  | { kind: "SELF" }
  /**
   * 내가 **남의 자리**를 대신 눌렀다. `approverName` 이 그 자리의 주인(= 내가 대신해 준 사람)이다.
   *
   * 🔴 **「어느 위임으로 눌렀나」는 말하지 않는다**(설계 B-16, 2026-11-17 쓰는 분 결정 「구별 없이
   * 간단히」). 출처 칸을 만들지 않았으므로 자체 위임과 승인함 위임을 가를 근거가 애초에 없다.
   */
  | { kind: "ON_BEHALF"; approverName: string }
  /**
   * **내 자리**를 남이 대신 눌렀다. 🔵 `delegateName` 이 `null` 인 줄은 번호만 있고 이름이 안 적힌
   * 줄이다 — 「대리인인데 이름을 모른다」를 지어내지 않고 그대로 들고 간다(`ApprovalStepActor` 와
   * 같은 약속).
   */
  | { kind: "BY_DELEGATE"; delegateName: string | null }
  /**
   * 🔴 **내 자리인데 누가 눌렀는지 어디에도 안 적힌 옛 줄**이다(`decided_by_sub` 칸이 생긴
   * 2026-10-21 이전). 「내가 눌렀다」도 「남이 대신 눌렀다」도 **아니다** — 그 줄에는 그 사실이
   * 없다. 둘 중 하나로 읽으면 과거를 지어내게 된다.
   */
  | { kind: "UNRECORDED" };

/**
 * 🔴 **갈래를 보는 사람 쪽으로 돌려 세우는 유일한 자리다.**
 *
 * @param step 단계 한 줄.
 * @param viewerSub 보는 사람의 **포털 번호**. 🔴 `users.id` 나 A/S 번호를 넘기면 **모든 줄이
 *   `null`** 이 된다 — 막힌 것처럼 보이지만 오류는 나지 않는다(`./delegation.ts` 의 같은 주의).
 *
 * @returns 그 사람의 내역이 **아니면** `null`. 두 경우다:
 *   · 아직 안 눌린 줄(`decided_at` 이 비었다) — 내역이 아니라 할 일이다.
 *   · 그 사람이 **자리 주인도 누른 사람도 아닌** 줄 — 남의 결재다.
 *   🔴 조회의 WHERE 가 이미 그 둘을 거르므로 운영에서는 닿지 않는 가지이지만, **두 벌의 규칙이
 *   어긋나는 날 조용히 남의 결재가 섞이는 것보다 여기서 떨어뜨리는 편이 낫다.**
 */
export function partIssueHistoryRole(step: PartIssueHistoryStep, viewerSub: string): PartIssueHistoryRole | null {
  // 🔴 「대신 눌렀나」의 판정은 **여기 없다** — 저장소에 한 자리뿐인 함수가 가른다(머리말).
  const actor = approvalStepActor(step);
  switch (actor.kind) {
    case "UNDECIDED":
      return null;
    case "UNRECORDED":
      // 🔴 이 줄은 `decided_by_sub` 가 비어 있어 **자리 주인으로만** 걸려 온다. 자리 주인이
      //    아니면 남의 옛 줄이다.
      return step.approverSub === viewerSub ? { kind: "UNRECORDED" } : null;
    case "SELF":
      return step.approverSub === viewerSub ? { kind: "SELF" } : null;
    case "DELEGATED":
      // 🔴 **누른 쪽을 먼저 본다.** 둘 다 나인 줄은 있을 수 없고(그러면 `SELF` 다) 그래서 차례에
      //    따라 답이 달라지지 않지만, 「내가 한 일」이 「나에게 일어난 일」보다 앞인 편이 읽기 쉽다.
      if (step.decidedBySub === viewerSub) return { kind: "ON_BEHALF", approverName: step.approverName };
      if (step.approverSub === viewerSub) return { kind: "BY_DELEGATE", delegateName: actor.delegateName };
      return null;
  }
}

/**
 * 결재 내역 한 줄 — 조회가 돌려주는 모양.
 *
 * 🔴 **포털 번호가 한 칸도 없다.** 이 값은 통로를 타고 포털을 거쳐 승인함 화면까지 그대로
 * 내려간다 — 번호를 실으면 남의 신원이 브라우저로 나간다(`./part-issue-screen.ts` 머리말과 같은
 * 울타리). 사람은 **이름 사본**으로만 말한다.
 */
export interface PartIssueApprovalHistoryRow {
  /**
   * 어느 결재건인가.
   *
   * 🔴 **이것 하나로 줄을 가리킬 수 없다.** 한 사람이 **같은 결재건에 두 줄**을 가질 수 있다 —
   * 1단계는 제 자리로 직접 누르고 3단계는 제 자리를 대리인이 누른 식이다(결재선은 같은 사람을
   * 두 단계에 넣는 것을 막지 않는다). 열쇠가 필요한 쪽(통로)은 `stepOrder` 까지 함께 써야 한다.
   */
  approvalId: string;
  /** 그 판 안에서 몇 번째 단계인가(1부터). 🔵 건너뛴 번호는 **건너뛴 채로** 온다(1 → 3). */
  stepOrder: number;
  /**
   * 🔴 **어느 결재 갈래인가** — 이 집의 불출 결재는 셋이다(부품 불출 · 매쳐 · 제너레이터). 사람이
   * 보고 구별해야 하므로 값과 이름표를 함께 싣는다.
   */
  scope: ApprovalRouteScope;
  /** 🔵 이름표가 적힌 곳은 `./route.ts` 의 `APPROVAL_ROUTE_SCOPE_LABELS` 하나다 — 여기서 짓지 않는다. */
  scopeLabel: string;
  /** **무엇에 대한 결재인가** — 반출 신청의 요약 글자(부품 · 수량). 승인함의 「결재할 건」이 쓰는 값과 같다. */
  summary: string;
  /** 신청 종류. 사람이 읽는 말은 `ENTRY_TYPE_LABEL`. */
  requestType: EntryType;
  /** 결재를 올린 사람의 이름 사본. */
  requestedByName: string;
  /** 승인인가 반려인가. 🔴 `REQUESTED` 는 여기 올 수 없다(위 묶음). */
  decision: PartIssueDecidedStepStatus;
  /** 언제 눌렸나. ISO 8601. */
  decidedAt: string;
  /** 결재자가 남긴 한마디. 반려면 **사유**이고 비어 있을 수 없다(표의 CHECK). */
  note: string;
  /** 그 자리의 주인 이름 사본 — 🔴 **실제로 누른 사람이 아닐 수 있다.** 그 사실은 `role` 이 말한다. */
  approverName: string;
  /** 🔴 **셋이 갈리는 자리**(+ 옛 줄). 위 `partIssueHistoryRole` 이 가린다. */
  role: PartIssueHistoryRole;
  /** 🔴 절대 주소 — 그 건의 결재 카드까지 간다. 「결재할 건」과 **같은 함수**가 짓는다. */
  href: string;
}

/** 용도 값 → 이름표. 🔵 조회가 글자를 짓지 않게 한 겹 둔다(표는 `./route.ts` 하나). */
export function partIssueScopeLabel(scope: ApprovalRouteScope): string {
  return APPROVAL_ROUTE_SCOPE_LABELS[scope];
}
