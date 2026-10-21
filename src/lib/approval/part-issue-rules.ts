import type { RequestStatus } from "@/db/schema/stock-requests";
import { reopenedRequestStatus, type EntryType } from "@/lib/stock/codes";
import type { IssueQuantity } from "@/lib/stock/issue";
// 🔵 순수 → 순수 import 다. `./delegation.ts` 도 `server-only` 를 물지 않으므로 이 파일을
//    끌어오는 화면 묶음의 빌드가 깨지지 않는다(머리말의 「화면이 쓰는 모양도 여기 둔다」).
import type { ActingApproverSubs } from "./delegation";
import { findNextRouteStepToApprove, type RouteStepAssignment } from "./route";

/**
 * ============================================================================
 * 부품 불출 결재 — 순수 규칙
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. **시험으로 지킬 수 있는 규칙만** 내려 둔 자리다 —
 * 이 저장소에는 DB 시험이 없고(시험은 전부 순수 함수다), 그래서 서버 함수가 직접 적은 규칙은
 * 아무도 돌려 보지 못한 채 운영으로 나간다. 서버(`./part-issue.ts`)는 여기 있는 것을 **부르기만**
 * 한다.
 *
 * 표 구조와 까닭은 `src/db/schema/stock-issue-approvals.ts` 머리말에 있다.
 * 원본은 A/S 관리 시스템의 `vendor/dss-core/src/schema/inventory-part-issue-requests.ts` 와
 * `src/lib/db/mutations/inventory-part-issue-requests.ts` 다(2026-10-15, 조각 11a).
 *
 * ── 🔴 「다음에 결재할 단계」 규칙을 여기서 다시 적지 않는다 ──────────────
 * 신청자 본인 단계를 건너뛰는 규칙은 이미 `./route.ts` 의
 * `isRouteStepSkippedForRequester` · `findNextRouteStepToApprove` 하나가 쥐고 있다. 아래
 * `planPartIssueApproval` 은 **그 함수를 반복해서 부를 뿐**이다 — 규칙을 두 벌 적으면 「올릴
 * 때는 건너뛰는데 사슬에서는 안 건너뛴다」가 되고, 그때 신청자가 자기 차례를 받는다.
 *
 * ── 🔴 화면이 쓰는 모양(View 타입)도 여기 둔다 ──────────────────────────
 * 읽는 쪽(`./part-issue.ts`)은 `server-only` 라 클라이언트 묶음이 끌어오면 빌드가 깨진다.
 * 같은 모양을 화면에 한 벌 더 적으면 칸이 늘 때 한쪽만 고쳐진다 — `./view.ts` 가 결재선에서
 * 같은 까닭으로 생긴 자리다. 여기는 코드가 없는 파일이 아니라서 따로 쪼개지 않고 함께 둔다.
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* 상태                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 결재건 한 건이 지나가는 상태.
 *
 * 🔴 `APPROVED` 와 `EXECUTED` 는 **다른 상태다.** 결재가 끝난 것과 부품이 나간 것은 다른
 * 사건이고, 그 사이의 시간이 이 설계의 핵심이다. 둘을 하나로 뭉개면 「승인은 났는데 아직 안
 * 나갔다」를 표현할 방법이 사라지고, 재고 담당자는 무엇을 실행해야 하는지 목록으로 볼 수
 * 없게 된다.
 *
 * 🔴 **승인 순간 재고를 빼지 않는 까닭**(A/S 원본 머리말 그대로): 신청 시점과 마지막 승인
 * 시점의 재고가 다르다. 승인이 곧 불출이면 **마지막 결재자가 「재고 부족」으로 막힌다** —
 * 결재자는 재고를 어찌할 수 없는 사람이다.
 *
 * 나아가는 길:
 *   PENDING_APPROVAL → APPROVED → EXECUTED
 *   PENDING_APPROVAL → REJECTED | CANCELLED
 *   APPROVED         → EXECUTION_REJECTED   **실행 대기에서 담당자가 멈춘 것**
 *   EXECUTED         → (끝)   **이미 나간 것은 되돌릴 수 없다**
 *
 * ── 🔴 `REJECTED` 와 `EXECUTION_REJECTED` 를 **뭉개지 않는다** (2026-10-21) ──
 * 2026-10-21 에 「결재 중」을 만들면서 **결재가 도는 동안 담당자의 [반려]·[보류]·[신청 취소]를
 * 닫았다.** 그 결과 결재가 다 끝나 [실행]만 남으면 **아무도 그 건을 멈출 수 없었다** — 재고가
 * 모자라도, 신청이 잘못됐다는 것을 뒤늦게 알아도, 할 수 있는 일은 「실행하지 않고 두기」뿐이라
 * 그 건은 「실행할 건」 목록에 영원히 떠 있었다. 그 빚을 갚는 값이다.
 *
 * 🔴 **기존 `REJECTED` 를 재사용하지 않는 까닭**: 저것은 **결재자가 결재 중에 반려한 것**이고
 * 사유가 **단계 줄**(`stock_issue_approval_steps.note`)에 적힌다. 실행 대기에는 **열린 단계가
 * 하나도 없다**(다 끝났다) — 같은 값으로 적으면 「누가 왜 막았나」를 찾을 자리가 서로 다른데
 * 겉으로는 같은 상태로 보인다. 🔵 「거둠(`CANCELLED`)」도 아니다: 그것은 **올린 사람이** 무르는
 * 길이고, 여기는 **담당자가** 막는 길이라 글자가 거짓말이 된다.
 *
 * 🔴 값 목록은 표의 enum(`src/db/schema/stock-issue-approvals.ts`)과 **글자 그대로 같아야
 * 한다.** 스키마 파일이 도메인 층을 가져오지 않는 이 저장소의 관례라 두 벌이 되고
 * (`APPROVAL_ROUTE_SCOPES` ↔ `approvalRouteScopeEnum` 과 같은 자리), 갈라지지 않도록
 * `tests/part-issue-approval.test.ts` 가 둘을 맞춰 본다.
 *
 * 🔴 **새 값은 맨 끝에 더한다** — `ALTER TYPE … ADD VALUE` 는 언제나 뒤에 붙는다.
 */
export const PART_ISSUE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "EXECUTED", "REJECTED", "CANCELLED", "EXECUTION_REJECTED"] as const;
export type PartIssueStatus = (typeof PART_ISSUE_STATUSES)[number];

/**
 * 🔴 코드 값은 사람이 읽을 말이 아니다 (CLAUDE.md 10절). 화면 글자가 적힌 곳은 여기 하나다.
 *
 * 🔵 `REJECTED` 와 `EXECUTION_REJECTED` 는 **글자로 갈린다** — 둘 다 「반려」지만 멈춘 자리가
 *    다르고, 그 자리가 곧 **사유를 찾을 곳**이다(앞은 단계 줄, 뒤는 결재건 쪽 칸).
 */
export const PART_ISSUE_STATUS_LABELS: Record<PartIssueStatus, string> = {
  PENDING_APPROVAL: "결재 중",
  APPROVED: "승인됨(아직 안 나감)",
  EXECUTED: "불출 완료",
  REJECTED: "반려됨",
  CANCELLED: "거둠",
  EXECUTION_REJECTED: "실행 대기에서 반려됨",
};

/**
 * 단계 한 줄의 상태. `REQUESTED` 는 「이 사람 차례인데 아직 안 눌렀다」다.
 *
 * 🔴 「거둠(CANCELLED)」에 해당하는 값이 **없다.** 올린 사람이 거둬도 열려 있던 단계 줄은
 * `REQUESTED` 로 남는다 — 거기에 `REJECTED` 를 적으면 「그 사람이 반려했다」는 거짓이 되기
 * 때문이다. 대신 **「내가 결재할 건」 조회가 결재건의 상태까지 본다**(`PENDING_APPROVAL` 인
 * 것만). 그래서 거둔 건은 아무의 목록에도 남지 않는다.
 */
export const PART_ISSUE_STEP_STATUSES = ["REQUESTED", "APPROVED", "REJECTED"] as const;
export type PartIssueStepStatus = (typeof PART_ISSUE_STEP_STATUSES)[number];

export const PART_ISSUE_STEP_STATUS_LABELS: Record<PartIssueStepStatus, string> = {
  REQUESTED: "결재 대기",
  APPROVED: "승인",
  REJECTED: "반려",
};

/**
 * **살아 있는** 결재건의 상태 묶음 — 아직 끝나지 않아 반출 신청 하나를 붙들고 있는 것.
 *
 * 🔴 표의 **부분 유니크 색인**(`stock_issue_approvals_request_open_uq`)이 보는 묶음과
 * **글자 그대로 같아야 한다.** 한 반출 신청에 살아 있는 결재건은 하나뿐이고, 그 사실이
 * 11c 의 잠금이 기대는 근거다. 두 곳이 갈라지면 화면은 「없다」는데 저장이 23505 로 터진다.
 *
 * ── 🔴 `EXECUTION_REJECTED` 는 여기 **없다**, 그리고 그것이 맞다 (2026-10-21) ──
 * 색인이 보는 묶음에서 빠진다는 것은 **그 신청에 결재건을 다시 올릴 수 있게 된다**는 뜻이다.
 * 닫힌 건(`EXECUTED`·`REJECTED`·`CANCELLED`)과 **같은 대접**이고, 세 까닭으로 맞다:
 *  1. 실행 대기에서 반려된 건은 **끝난 건**이다 — 결재도 실행도 거두기도 되지 않는다(아래 판정 넷).
 *     살아 있는 것으로 세면 그 신청의 [확인] 자리가 **영원히 잠긴 채** 남는다(`partIssueLockFor`).
 *  2. 색인에서 빠지지 않으면 **같은 신청에 두 번째 결재건을 올릴 수 없다.** 반려는 「이번엔
 *     안 된다」이지 「이 신청은 영영 안 된다」가 아니어야 한다 — 반려된 뒤 처음 단계부터 다시
 *     올리는 길은 `REJECTED` 에서 이미 열려 있고, 여기만 닫으면 규칙이 두 벌이 된다.
 *  3. 🔵 **그런데 오늘 당장 다시 올라오지는 않는다.** 실행 대기 반려는 반출 신청 자체도
 *     `REJECTED` 로 닫기 때문이다(`requestStatusAfterPartIssue`) — 닫힌 신청은 집을 수 없어
 *     (`isClaimableRequest`) 결재를 올릴 화면이 없다. 색인이 열어 두는 것은 **제약이지 길이
 *     아니다**: 나중에 「반려된 신청을 되살린다」가 생겨도 DB 가 막아서지 않는다는 뜻이다.
 * 🔴 **색인은 고치지 않았다.** 조건절(`status in ('PENDING_APPROVAL','APPROVED')`)이 이미
 * 이 묶음과 글자 그대로 같고, 새 값은 거기 없으므로 **저절로** 위 동작이 된다.
 */
export const OPEN_PART_ISSUE_STATUSES = ["PENDING_APPROVAL", "APPROVED"] as const satisfies readonly PartIssueStatus[];

export function isOpenPartIssueStatus(status: PartIssueStatus): boolean {
  return (OPEN_PART_ISSUE_STATUSES as readonly PartIssueStatus[]).includes(status);
}

/* ------------------------------------------------------------------ */
/* 결재가 움직일 때 **부품 요청**이 따라가는 자리 (2026-10-21, 조각 11e)  */
/* ------------------------------------------------------------------ */

/**
 * 결재건이 움직여 **반출 신청(`stock_requests`)의 자리를 바꾸는** 다섯 순간 중 **넷**.
 *
 * 🔴 **다섯째(실행)는 여기 없다.** 실행은 `confirmRequest` 가 「다 나갔나」를 세어 `CONFIRMED` 나
 *    `PARTIAL` 을 정하는데, 그 셈에는 이번에 나간 수량과 이미 나간 수량이 필요해 상태 하나로 답할 수 없다.
 *    그 규칙은 그 함수 하나가 쥐고 있고(`src/lib/stock/requests.ts`), 여기서 다시 적으면 두 벌이 된다.
 *    🔵 그래서 이 묶음의 이름은 「결재가 **신청의 자리를 직접 적는** 순간들」이다.
 */
export type PartIssueRequestExit =
  /** [불출 신청] — 결재건이 섰다. 🔴 **자동 승인(`AUTO_APPROVED`)도 이것이다** (아래 함수 주석). */
  | "ISSUE_REQUESTED"
  /** 올린 사람이 [거두기] — 결재건이 `CANCELLED`. 신청은 담당자 손으로 **돌아온다**. */
  | "APPROVAL_CANCELLED"
  /** 결재자가 [반려] — 결재건이 `REJECTED`. 신청도 **끝난다**. */
  | "APPROVAL_REJECTED"
  /**
   * 담당자가 **실행 대기에서 [반려]** — 결재건이 `EXECUTION_REJECTED`. 신청도 **끝난다**.
   *
   * 🔴 **위 셋 어디에도 못 끼운다.** 셋은 전부 「결재가 도는 중」을 전제한다 —
   * `APPROVAL_CANCELLED`·`APPROVAL_REJECTED` 는 열린 단계가 있는 `PENDING_APPROVAL` 에서만
   * 일어나고, 이 출구는 **결재가 다 끝난 `APPROVED`** 에서만 일어난다. 하나로 뭉개면 거두기의
   * 「담당자 손으로 돌려보낸다」가 따라붙어 **담당자가 막은 신청이 그 담당자의 대기 목록에
   * 되살아난다.**
   */
  | "EXECUTION_REJECTED";

/**
 * 그 순간 **신청이 가야 할 자리**.
 *
 * 🔴 **규칙을 여기 한 곳에 둔 까닭**: 이 저장소에는 DB 시험이 없어(이 파일 머리말), 서버 함수의 `UPDATE …
 * SET status` 에 직접 적은 글자는 **아무도 돌려 보지 못한 채** 운영으로 나간다. 들고 나는 길 중 하나라도
 * 빠지면 신청이 `IN_APPROVAL` 에 **갇힌다** — 그 자리는 확인·반려·마감·보류·취소를 **전부** 거절하는
 * 상태라, 갇히면 담당자도 신청자도 손쓸 길이 없고 부품은 영영 안 나간다.
 * 🔵 `tests/part-issue-request-status.test.ts` 가 이 함수로 다섯 길을 전부 못 박는다.
 *
 * 🔴 **출구를 더할 때마다 「갇히지 않는가」를 다시 본다.** 2026-10-21 에 더한 `EXECUTION_REJECTED`
 * 가 그 경고에 걸리는 자리였다 — 담당자가 실행 대기에서 막았는데 신청을 `IN_APPROVAL` 에 그대로
 * 두면, 결재건은 닫혔는데 신청은 아무 단추도 받지 않는 **완전한 교착**이 된다(결재건이 닫혀서
 * [실행]조차 없다). 아래 갈래가 `REJECTED` 로 **빠져나오는** 것이 그 경고를 지키는 자리다.
 *
 * - `ISSUE_REQUESTED` → **`IN_APPROVAL`.** 🔴 **자동 승인도 똑같다.** 결재선이 전부 신청자 본인이면 결재건은
 *   그 자리에서 `APPROVED` 가 되지만(`planPartIssueApproval` 의 `AUTO_APPROVED`) **재고는 아직 안 나갔다** —
 *   나가는 것은 「승인 요청건」의 [실행]이다. 그때 신청을 `PENDING` 으로 두면 담당자가 [확인]으로 한 번 더
 *   내주고 [실행]으로 또 한 번 내준다. 갈래가 둘이라 **빠뜨리기 쉬운 자리**라서 글자로 못 박는다.
 * - `APPROVAL_CANCELLED` → **`PENDING` 또는 `PARTIAL`.** 🔴 `PENDING` 으로 고정하지 않는다 — 결재는 **일부
 *   나간 신청에서도 올릴 수 있어**(`isClaimableRequest` = PENDING·PARTIAL) 거둘 때 그대로 `PENDING` 으로
 *   돌리면 **이미 나간 회차가 없던 일이 된다.** 보류 풀기와 **같은 함수**로 센다(`reopenedRequestStatus`).
 * - `APPROVAL_REJECTED` → **`REJECTED`.** 🔵 2026-10-21 쓰는 분 결정: 「결재가 반려되면 부품 요청도 끝이다.
 *   다시 필요하면 새로 신청한다.」 `PENDING` 으로 되돌리지 **않는다** — 되돌리면 반려된 요청이 대기 목록에
 *   되살아나 담당자가 그대로 내주게 되고, 반려한 결재자의 뜻이 사라진다.
 *   🔴 반려 사유는 신청의 **결정 사유 칸**(`decision_note`)에 복사한다 — 신청자가 보는 화면과 A/S 통로는
 *   결재건이 아니라 신청을 읽으므로, 복사하지 않으면 「왜 반려됐는지」가 어디에도 안 보인다.
 * - `EXECUTION_REJECTED` → **`REJECTED`.** 🔴 **`APPROVAL_REJECTED` 와 같은 자리로 보낸다** —
 *   일어난 일이 「담당자가 이 불출을 막았다」로 같고, 신청 쪽에는 그 둘을 가를 칸이 없다(가르는 것은
 *   결재건의 상태다). 🔴 **`PENDING`·`PARTIAL` 로 되돌리지 않는다**: 되돌리면 막은 당사자인 담당자의
 *   대기 목록에 그 신청이 되살아나고, 그대로 [확인]을 누르면 **방금 막은 부품이 그냥 나간다.**
 *   🔵 되살릴 일이 있으면 신청자가 새로 신청한다(`APPROVAL_REJECTED` 와 같은 2026-10-21 결정).
 *   🔴 사유 복사도 `APPROVAL_REJECTED` 와 같다 — 신청의 `decision_note` 로 가야 신청자에게 보인다.
 *
 * @param issuedTotal 그 신청에서 **이미 나간 수량의 합**. 🔵 `APPROVAL_CANCELLED` 에서만 쓰인다.
 */
export function requestStatusAfterPartIssue(exit: PartIssueRequestExit, issuedTotal: number): RequestStatus {
  switch (exit) {
    case "ISSUE_REQUESTED":
      return "IN_APPROVAL";
    case "APPROVAL_REJECTED":
      return "REJECTED";
    case "APPROVAL_CANCELLED":
      return reopenedRequestStatus(issuedTotal);
    // 🔵 바로 위와 **가는 자리가 같지만 갈래를 합치지 않는다.** 둘은 다른 사건이고(결재 중 반려 ↔
    //    실행 대기 반려) 언젠가 한쪽만 바뀔 수 있다 — 합쳐 두면 그날 둘 다 바뀐다. 갈래마다
    //    한 줄로 적혀 있어야 시험도 이 함수의 길을 하나씩 짚을 수 있다.
    case "EXECUTION_REJECTED":
      return "REJECTED";
  }
}

/* ------------------------------------------------------------------ */
/* ① 결재선 단계 → 이 건이 실제로 밟을 단계 목록                          */
/* ------------------------------------------------------------------ */

/**
 * 결재선 한 판을 이 신청에 **적용했을 때 무슨 일이 일어나는가** 셋 중 하나다.
 *
 * 🔴 `NO_ROUTE` 가 **안전장치**다. 「부품 불출」 판이 없거나 단계가 0개인 판뿐이면 결재건을
 * 만들지 않고 이것을 돌려준다 — 부르는 쪽(11c)은 그때 지금까지처럼 재고 담당자가 그 자리에서
 * 바로 [확인]을 누르게 둔다. **이 약속이 없으면 기능을 올리는 순간 관리자가 절차를 만들기
 * 전까지 재고가 통째로 잠긴다**(아무도 결재할 수 없는 신청만 쌓이고 부품은 나가지 못한다).
 * 판이 비어 있는 것이 정상 초기 상태라는 것은 결재선 표의 규약과 같다.
 *
 * 🔴 `MISSING_SUB` 는 **결재선 단계 중에 포털 번호가 없는 것이 있다**는 뜻이다. 그 단계는
 * 아무도 열 수 없는 문이라, 결재건을 만들면 **영영 결재되지 않는 건**이 하나 생기고 그 신청은
 * 담당자가 바로 확인할 수도 없게 잠긴다(살아 있는 결재건이 신청을 붙들기 때문이다). 그래서
 * 만들지 않고 **사람에게 고치는 길을 말한다** — 설정 → 승인 절차에서 다시 저장하면 그때의
 * 명부에서 포털 번호가 채워진다.
 *
 * 🔵 `NO_ROUTE` 와 **절대 뭉개지 않는다.** 저쪽은 「결재 제도를 쓰지 않는다」라서 부르는 쪽이
 * 지금까지처럼 바로 [확인]을 누르는데, 이쪽은 **결재선이 있는데 고장 난 것**이다. 같은 것으로
 * 다루면 관리자가 세워 둔 결재를 건너뛰고 부품이 나간다.
 *
 * 🔴 **남는 단계만이 아니라 그 판의 단계 전부**를 본다. 뒤쪽 단계 하나에 번호가 없어도 사슬은
 * 거기까지 가서 멈춘다 — 그때는 이미 앞사람들이 결재를 한 뒤라 되돌리기가 더 어렵다.
 *
 * 🔴 `AUTO_APPROVED` 는 **단계는 있는데 전부 신청자 본인이라 남는 단계가 0개**인 경우다.
 * 곧바로 `APPROVED` 로 만든다 — 결재할 사람이 아무도 없으니 **기다릴 것이 없고**, 그런데도
 * `PENDING_APPROVAL` 로 두면 아무도 누를 수 없는 건이 영영 남아 재고가 잠긴다(위 `NO_ROUTE`
 * 를 둔 까닭과 같은 위험이다). 🔵 `NO_ROUTE` 와 **일부러 가른다**: 저쪽은 「결재 제도를 쓰지
 * 않는다」라 결재건 자체가 없는 것이 맞고, 이쪽은 「결재를 받았다(받을 사람이 없었다)」라
 * 누가 언제 무엇을 올렸는지가 남아야 한다. 뭉개면 자기 이름이 결재선에 들어 있는 사람만
 * 이력 없이 부품을 뺄 수 있게 된다.
 */
/**
 * 포털 번호가 **있는 것이 타입으로 보장된** 단계. 서버는 이 모양만 표에 넣는다 —
 * `stock_issue_approval_steps.approver_sub` 는 NOT NULL 이고, 그 약속을 지키는 자리가
 * `planPartIssueApproval` 하나다(`null` 검사가 여러 곳에 흩어지면 하나가 빠지는 날 터진다).
 */
export type RouteStepWithSub<T extends RouteStepAssignment> = T & { approverSub: string };

export type PartIssueRoutePlan<T extends RouteStepAssignment> =
  | { kind: "NO_ROUTE" }
  /** 🔴 결재선이 **고장 났다** — 「절차 없음」과 뭉개지 않는다. `message` 는 사람이 읽는 글이다. */
  | { kind: "MISSING_SUB"; message: string }
  | { kind: "AUTO_APPROVED"; steps: readonly [] }
  | { kind: "NEEDS_APPROVAL"; steps: readonly [RouteStepWithSub<T>, ...Array<RouteStepWithSub<T>>] };

/**
 * 결재선에 포털 번호 없는 단계가 섞였을 때 사람에게 하는 말. 🔴 **고치는 길까지** 적는다 —
 * 「올릴 수 없습니다」만 주면 신청자는 담당자를 찾아다니고, 담당자도 어디를 고칠지 모른다.
 */
export const PART_ISSUE_ROUTE_MISSING_SUB_MESSAGE =
  "결재선에 통합 로그인 번호가 없는 분이 있습니다. 설정 → 승인 절차에서 다시 저장해 주십시오.";

/**
 * 그 판의 단계들 중 **이 신청이 실제로 밟을 단계**를 차례대로.
 *
 * @param routeSteps 현재 판의 단계들. 순서가 뒤섞여 있어도 된다.
 * @param requesterSub 결재건을 올리는 사람의 **포털 번호**. 그 사람의 단계는 건너뛴다.
 *   🔴 이름이 `…Sub` 인 까닭은 `./route.ts` 의 `RouteStepAssignment` 주석에 있다 — 여기에
 *   `users.id`(이 시스템의 번호)나 A/S 번호를 넘기면 건너뛰기가 **조용히 꺼진다.**
 *
 * 🔴 걸러 내는 일을 여기서 직접 하지 않고 `findNextRouteStepToApprove` 를 **되풀이해 부른다.**
 * 사슬이 나아갈 때 서버가 부르는 것도 같은 함수라, 「올릴 때 만든 목록」과 「나아가며 고르는
 * 단계」가 어긋날 수 없다.
 */
export function planPartIssueApproval<T extends RouteStepAssignment>(
  routeSteps: readonly T[],
  requesterSub: string,
): PartIssueRoutePlan<T> {
  if (routeSteps.length === 0) return { kind: "NO_ROUTE" };

  // 🔴 **판 전체**를 먼저 본다 — 뒤쪽 단계 하나가 비어 있어도 사슬은 거기까지 가서 멈춘다.
  if (routeSteps.some((step) => step.approverSub === null)) {
    return { kind: "MISSING_SUB", message: PART_ISSUE_ROUTE_MISSING_SUB_MESSAGE };
  }

  const steps: Array<RouteStepWithSub<T>> = [];
  let completedStepOrder = 0;
  for (;;) {
    const next = findNextRouteStepToApprove(routeSteps, completedStepOrder, requesterSub);
    if (next === null) break;
    // 위에서 판 전체에 번호가 있는 것을 확인했다 — 그래서 여기서 다시 보지 않는다.
    steps.push(next as RouteStepWithSub<T>);
    completedStepOrder = next.stepOrder;
  }

  if (steps.length === 0) return { kind: "AUTO_APPROVED", steps: [] };
  return { kind: "NEEDS_APPROVAL", steps: steps as [RouteStepWithSub<T>, ...Array<RouteStepWithSub<T>>] };
}

/* ------------------------------------------------------------------ */
/* ② 지금 차례가 누구인가                                                */
/* ------------------------------------------------------------------ */

/**
 * 이 층이 단계 한 줄에서 보는 것. 표를 읽는 층의 타입이 이 모양을 이미 만족한다.
 *
 * 🔴 **`approverUserId`(A/S 번호)가 아니라 `approverSub`(포털 번호)다.** 결재건 단계 표는 둘
 * 다 들고 있지만, 「누구인가」를 가르는 것은 포털 번호 하나뿐이다 — A/S 번호는 이 시스템의
 * 로그인 번호가 아니라서 그것으로 견주면 **언제나 거짓**이 된다(`./directory.ts` 머리말).
 */
export type PartIssueStepAssignment = {
  /** 🔴 포털 번호. 결재건 단계 표에서는 NOT NULL 이다(올릴 때 결재선에서 복사해 굳힌다). */
  approverSub: string;
  status: PartIssueStepStatus;
};

/**
 * 이 사람이 **지금** 이 단계를 결재할 수 있는가.
 *
 * 🔴 조건은 둘뿐이다: 그 줄이 아직 `REQUESTED` 이고, 그 줄에 적힌 **포털 번호**가 이 사람이
 * 지금 쓸 수 있는 번호들 안에 있다. 「관리자면 아무 단계나 대신 누를 수 있다」 같은 예외를
 * **두지 않는다** — 순차 승인에서 누가 승인했는지가 곧 그 건의 근거이고, 대신 누르는 길이
 * 있으면 그 근거가 무너진다.
 *
 * ── 🔴 번호 **하나**가 아니라 **목록**을 받는 까닭 (2026-10-21, 결재권 위임) ─
 * 같은 판정이 네 곳에 필요하고 셋은 SQL 이다(집행·목록·알림 종의 조건절). SQL 과 TS 가 같은
 * 코드를 쓸 수 없으니 **둘이 보는 번호 목록을 한 함수가 만든다** — `../approval/delegation.ts`
 * 의 `actingApproverSubs`(표를 읽어 오는 쪽은 `./delegation-queries.ts`). 여기는 그 목록에
 * 들어 있나를 보고, 저쪽 셋은 같은 목록을 `inArray` 에 넣는다.
 * 🔴 **그 전에는 두 벌이었다**: 운영은 조건절 쪽만 쓰고 이 함수는 시험만 불렀다. 두 벌이면
 * 「시험은 통과하는데 운영은 막는」(또는 그 반대의) 짝이 생기고, 그 어긋남은 오류가 아니라
 * 사람이 포기할 때까지 조용하다.
 * 🔵 위임이 하나도 없으면 목록은 **본인 번호 하나뿐**이라 예전과 한 글자도 다르지 않게 돈다.
 *
 * 🔴 **매개변수에 포털 번호가 아닌 것을 넣으면 안 된다.** `users.id` 나 A/S 번호로 만든
 * 목록을 넘기면 이 함수는 **아무에게도 참을 돌려주지 않고**, 「내가 결재할 건」은 영원히 빈
 * 목록이 된다. 코드는 맞고 값이 안 맞는 결함이라 눈으로도 시험으로도 잘 안 잡힌다 — 그래서
 * `tests/part-issue-approval.test.ts` 에 **A/S 번호를 넘기면 거짓이 되는 시험**을 울타리로
 * 세워 두었다.
 * 🔵 글자 하나(`string`)를 그대로 넘기는 길은 타입이 막는다. 막지 않으면 `"sub-kim".includes(…)`
 *    가 **글자 조각 검사**로 돌아 조용히 참이 되는 자리가 생긴다.
 *
 * 🔵 결재건 자체가 아직 `PENDING_APPROVAL` 인지는 **여기서 보지 않는다**(단계 줄만 본다).
 * 그 판정은 `checkCanDecidePartIssue` 가 쥐고 있고, 서버는 둘 다 통과해야 받아 준다.
 */
export function mayDecidePartIssueStep(step: PartIssueStepAssignment, actingSubs: ActingApproverSubs): boolean {
  return step.status === "REQUESTED" && actingSubs.includes(step.approverSub);
}

/* ------------------------------------------------------------------ */
/* ③ 어떤 상태에서 무엇을 할 수 있나                                      */
/* ------------------------------------------------------------------ */

/**
 * 막을 때는 **왜 막혔는지**까지 돌려준다. 「할 수 없습니다」만 주면 사람은 같은 단추를 몇 번
 * 더 눌러 보다 포기한다 (`validateApprovalRouteSteps` 와 같은 관례).
 */
export type PartIssueGate = { ok: true } | { ok: false; message: string };

/** 결재(승인·반려)를 받을 수 있는 상태인가. */
export function checkCanDecidePartIssue(status: PartIssueStatus): PartIssueGate {
  if (status === "PENDING_APPROVAL") return { ok: true };
  return { ok: false, message: `결재할 수 없는 건입니다 (지금 ${PART_ISSUE_STATUS_LABELS[status]}). 화면을 새로 고치고 다시 보십시오.` };
}

/**
 * 실행(= 실제로 부품을 빼기)할 수 있는 상태인가.
 *
 * 🔴 `APPROVED` 하나뿐이다. `PENDING_APPROVAL` 에서 실행되면 결재가 무의미해지고,
 * `EXECUTED` 에서 또 실행되면 **같은 결재로 재고가 두 번 나간다.**
 */
export function checkCanExecutePartIssue(status: PartIssueStatus): PartIssueGate {
  if (status === "APPROVED") return { ok: true };
  if (status === "EXECUTED") return { ok: false, message: "이미 불출된 건입니다." };
  return { ok: false, message: `아직 불출할 수 없는 건입니다 (지금 ${PART_ISSUE_STATUS_LABELS[status]}).` };
}

/**
 * **실행 대기에서 반려**할 수 있는 상태인가 (2026-10-21).
 *
 * 🔴 `APPROVED` 하나뿐이다 — `checkCanExecutePartIssue` 와 **같은 자리**다. 「실행할 수 있는
 * 건」과 「실행 대기에서 멈출 수 있는 건」은 같은 건이어야 한다. 한쪽만 넓으면 목록에 떠 있는데
 * 멈출 수 없는 건이나, 멈출 수는 있는데 실행은 못 하는 건이 생긴다.
 *  · `PENDING_APPROVAL` — 🔴 **여기서 열면 2026-10-21 결정을 깬다.** 결재가 도는 동안은 담당자가
 *    그 건을 닫지 못한다(결재자에게 뜬 건이 소리 없이 사라지면 안 된다). 결재 중인 건을 무르는
 *    길은 **올린 사람의 [거두기]**(`checkCanCancelPartIssue`)이지 담당자의 반려가 아니다.
 *  · `EXECUTED` — 이미 나갔다. 되돌리는 것은 반려가 아니라 입고다.
 *  · `REJECTED`·`CANCELLED`·`EXECUTION_REJECTED` — 이미 닫힌 건이다. 두 번 막을 것이 없다.
 *
 * 🔴 **기존 `rejectRequest`·`holdRequest`(반출 신청 쪽)의 조건을 넓혀 이 일을 하지 않는다.**
 * 저 둘은 `REJECTABLE_REQUEST_STATUSES`·`CLAIMABLE_REQUEST_STATUSES` 를 WHERE 에 그대로 쓰는데,
 * 거기에 `IN_APPROVAL` 을 넣으면 **결재가 도는 중인 신청까지 함께 열린다.** 그래서 판정을
 * **따로** 둔다 — 이쪽은 신청이 아니라 **결재건**을 보고, 열리는 자리가 `APPROVED` 하나다.
 *
 * 🔵 **누가** 누를 수 있는지는 여기서 보지 않는다(관리자다). `checkCanExecutePartIssue` 와 같은
 * 모양이고, 그 판정은 부르는 쪽(서버 액션·화면)이 쥔다 — 이 파일은 `server-only` 를 물지 않는다.
 * 🔵 **사유**는 `checkRejectReason` 이 본다. 결재 중 반려와 **같은 함수**를 쓴다 — 사유를 받는
 *    규칙이 두 벌이 되면 한쪽만 느슨해지는 날이 온다.
 */
export function checkCanRejectExecutionPartIssue(status: PartIssueStatus): PartIssueGate {
  if (status === "APPROVED") return { ok: true };
  if (status === "EXECUTED") return { ok: false, message: "이미 불출된 건입니다. 되돌리려면 입고로 처리하십시오." };
  if (status === "PENDING_APPROVAL") {
    return { ok: false, message: "아직 결재가 도는 중입니다. 결재가 끝난 뒤에 멈출 수 있습니다 — 지금 무르려면 올린 분이 [거두기] 를 누르면 됩니다." };
  }
  return { ok: false, message: `실행 대기에서 반려할 수 없는 건입니다 (지금 ${PART_ISSUE_STATUS_LABELS[status]}).` };
}

/**
 * 거둘 수 있는가 — **올린 사람이, 아직 결재가 진행 중일 때만.**
 *
 * 🔴 `APPROVED` 는 거두지 못하게 한다. A/S 원본은 「아직 안 나갔으므로 물릴 수 있다」로 열어
 * 두었지만, 이 시스템에서는 승인된 건이 재고 담당자의 **일감 목록**(「승인됐는데 아직 안 나간
 * 건」)에 올라가 있다. 담당자가 상자를 뜯으러 간 사이에 신청자가 거둬 버리면 그 헛걸음을
 * 아무도 설명할 수 없다. 되물릴 일이 있으면 담당자가 실행하지 않고 두면 된다.
 */
export function checkCanCancelPartIssue(status: PartIssueStatus, requestedBy: string, actorUserId: string): PartIssueGate {
  if (requestedBy !== actorUserId) return { ok: false, message: "본인이 올린 결재건만 거둘 수 있습니다." };
  if (status === "PENDING_APPROVAL") return { ok: true };
  return { ok: false, message: `거둘 수 없는 건입니다 (지금 ${PART_ISSUE_STATUS_LABELS[status]}).` };
}

/**
 * 반려에는 **사유가 있어야 한다.** 사유 없는 반려는 올린 사람이 무엇을 고쳐야 할지 알 수 없고,
 * 이 결재선은 반려되면 처음 단계부터 다시 올리는 구조라 그대로 또 올라온다.
 *
 * 🔴 표의 CHECK(`stock_issue_approval_steps_decision_metadata`)가 최종 방어선이고, 여기가
 * 사람에게 까닭을 말해 주는 앞단이다.
 */
export function checkRejectReason(note: string): PartIssueGate {
  if (note.trim().length === 0) return { ok: false, message: "반려 사유를 적어 주십시오." };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 줄별 「이번에 줄 수량」                                                */
/* ------------------------------------------------------------------ */

/**
 * 올릴 때 받은 줄별 수량이 **모양이라도 말이 되는가.**
 *
 * 🔴 「요청 수량보다 많지 않은가」·「남은 수량보다 많지 않은가」는 **여기서 보지 않는다** —
 * 그 규칙은 `src/lib/stock/issue.ts` 의 `buildIssueInput` 하나가 쥐고 있고, 실행 순간
 * `confirmRequest` 가 그것을 부른다. 같은 규칙을 여기 또 적으면 두 벌이 되고, 무엇보다 올릴
 * 때와 실행할 때 사이에 이미 나간 수량이 달라져 있을 수 있어 **올릴 때의 판정은 믿을 수 없다.**
 * 여기서 보는 것은 「빈 신청인가」처럼 시간이 지나도 변하지 않는 것뿐이다.
 */
export function checkIssueQuantities(quantities: readonly IssueQuantity[]): PartIssueGate {
  if (quantities.length === 0) return { ok: false, message: "내줄 부품을 한 줄 이상 골라 주십시오." };
  const seen = new Set<string>();
  for (const q of quantities) {
    if (typeof q.partId !== "string" || q.partId.trim().length === 0) return { ok: false, message: "부품이 비어 있는 줄이 있습니다." };
    if (!Number.isInteger(q.quantity) || q.quantity < 0) return { ok: false, message: "수량은 0 이상의 정수여야 합니다." };
    if (seen.has(q.partId)) return { ok: false, message: "같은 부품이 두 줄에 들어 있습니다." };
    seen.add(q.partId);
  }
  if (!quantities.some((q) => q.quantity > 0)) return { ok: false, message: "이번에 내줄 수량이 없습니다. 줄마다 내줄 수량을 적으십시오." };
  return { ok: true };
}

/**
 * jsonb 로 저장해 둔 줄별 수량을 **다시 믿을 수 있는 모양으로** 읽는다. 모양이 아니면 `null`.
 *
 * 🔴 jsonb 는 타입이 없다 — 저장할 때의 모양을 DB 가 지켜 주지 않는다. 실행은 이 값 그대로
 * 재고를 빼는 자리라, 읽는 쪽에서 한 번 더 본다. 손으로 고친 행이나 옛 판의 모양이 그대로
 * `confirmRequest` 로 흘러들면 「알 수 없는 오류」가 된다.
 */
export function readIssueQuantities(value: unknown): IssueQuantity[] | null {
  if (!Array.isArray(value)) return null;
  const out: IssueQuantity[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { partId, quantity } = raw as { partId?: unknown; quantity?: unknown };
    if (typeof partId !== "string" || partId.length === 0) return null;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) return null;
    out.push({ partId, quantity });
  }
  return out;
}

/**
 * 반출 신청의 jsonb(`stock_requests.payload`)에 적힌 **요청 비고**를 안전하게 읽는다.
 * 글자가 아니면 **빈 글자**다 (2026-10-22).
 *
 * 🔴 **`payload as EntryInput` 같은 맹목적 형변환을 쓰지 않는다.** 그 칸의 타입은
 * `Record<string, unknown>` 이고, 무엇이 들었는지 DB 도 타입도 보증하지 않는다:
 *  - **없음** — A/S 통로가 생기기 전에 올라온 옛 신청에는 `note` 칸이 **아예 없을 수 있다.**
 *  - **글자가 아님** — 손으로 고친 행이나 옛 판의 모양이면 숫자·객체·`null` 이 들어 있을 수 있다.
 *    그대로 화면에 실으면 `[object Object]` 가 「신청자가 적은 말」인 척 그려진다.
 *  - **빈 글자** — 아무것도 안 적고 올린 신청. 화면은 그때 **줄 자체를 그리지 않는다.**
 * 🔵 그래서 `null` 이 아니라 **빈 글자**를 돌려준다: 읽는 쪽이 「없다」와 「못 읽었다」를 가를 까닭이
 *    없기 때문이다(둘 다 보여 줄 말이 없다는 뜻이고, 그 판정은 `readIssueQuantities` 처럼 재고를
 *    움직이지 않는다).
 *
 * 🔴 **공백만 있는 글자도 빈 글자로 떨어뜨린다.** 안 그러면 따옴표만 남은 빈 상자가 그려져
 *    「비고가 지워졌나」로 읽힌다(화면이 사유에 대해 같은 까닭으로 같은 일을 한다).
 */
export function readRequestNote(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const { note } = value as { note?: unknown };
  if (typeof note !== "string") return "";
  return note.trim();
}

/* ------------------------------------------------------------------ */
/* 화면이 받는 모양 (11b)                                                */
/* ------------------------------------------------------------------ */

/** 결재 이력 한 줄 — 누가 언제 무엇을 했나. 이름·역할은 **올릴 때 복사해 굳힌 사본**이다. */
export type PartIssueStepView = {
  /** 1부터. 건너뛴 단계가 있으면 **번호가 건너뛴 채로** 온다(1 → 3). 고쳐 적지 않는다. */
  stepOrder: number;
  approverUserId: string;
  approverName: string;
  /** A/S 의 역할 코드. 사람이 읽는 이름은 `asRoleLabel`. */
  approverRole: string;
  status: PartIssueStepStatus;
  requestedAt: string;
  decidedAt: string | null;
  /** 결재자가 남긴 한마디. 반려면 사유다(비어 있을 수 없다). */
  note: string;
};

/** 결재건 한 줄. 반출 신청의 요약 글자를 함께 싣는다 — 결재자는 **무엇을 승인하는지** 봐야 한다. */
export type PartIssueView = {
  id: string;
  requestId: string;
  routeId: string;
  status: PartIssueStatus;
  /** 줄별 「이번에 줄 수량」. 실행 때 이 값으로 `confirmRequest` 를 부른다. */
  quantities: IssueQuantity[];
  /** 왜 이만큼 빼야 하는가. 결재자가 읽는 글이다. */
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  /** 실행이 만든 원장 머리. 실행 전에는 `null`. */
  entryId: string | null;
  executedByName: string | null;
  executedAt: string | null;
  /** 반출 신청 쪽 값 — 요약 글자와 종류. 결재 화면이 신청을 다시 읽지 않아도 되게 함께 싣는다. */
  requestSummary: string;
  requestType: EntryType;
  /**
   * **요청 비고** — 부품을 요청한 사람이 신청할 때 적은 말 (2026-10-22).
   *
   * 🔴 위의 `reason`(「신청 사유」)과 **다른 사람의 말이다.** 저것은 재고 담당자가 결재를 올리면서
   *    결재자에게 쓴 글이고(`stock_issue_approvals.reason`), 이것은 **신청한 사람**이 적어 신청에
   *    실려 온 글이다(`stock_requests.payload` 의 `note` — A/S 통로가 1000자로 잘라 싣는다).
   *    이름이 비슷해 섞어 심기 쉽다 — 섞으면 화면이 누구의 말인지 말할 수 없게 된다.
   * 🔵 **비어 있는 것이 정상이다**: 신청자가 안 적었거나, 재고 관리에서 직접 올린 신청은 늘 비어
   *    있다. 그때 화면은 그 줄을 **아예 그리지 않는다**(사유와 같은 규칙).
   * 🔴 jsonb 라 무엇이 들었는지 보증되지 않아 `readRequestNote` 하나로만 읽는다.
   */
  requestNote: string;
  /** 지금 결재 차례인 사람. 결재가 끝났거나 닫힌 건이면 `null`. */
  currentStep: { stepOrder: number; approverUserId: string; approverName: string } | null;
};

/** 한 건의 결재 이력 — 단계별로 누가 언제. `stepOrder` 순. */
export type PartIssueDetail = PartIssueView & { steps: PartIssueStepView[] };
