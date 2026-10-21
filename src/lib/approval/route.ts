/**
 * ============================================================================
 * 승인 절차(결재선) — 순수 규칙
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. **저장 경로와 편집 화면이 같은 함수 하나**를 보게
 * 하려고 따로 뺀 자리다 — 규칙을 두 곳에 적어 두면 화면은 받아 주는데 저장이 거절하거나
 * (사람이 무엇을 고쳐야 할지 모른다), 반대로 화면만 막고 저장은 열려 있는(손으로 만든
 * 요청이 통과한다) 상태가 된다.
 *
 * A/S 관리 시스템의 `src/lib/domain/shipment-approval-route.ts` 를 **동작 그대로** 옮겨 온
 * 것이다(2026-10-15, 조각 ③a). 바꾼 것은 이름에서 `shipment` 를 뗀 것과, 이 시스템에 없는
 * 용도(출하·견적서) 둘을 뺀 것뿐이다.
 *
 * 표 구조와 「판(version)으로 쌓는 이유」는 `src/db/schema/approval-routes.ts` 머리말에 있다.
 *
 * ── 🔴 순서는 배열의 자리(index)가 정한다 ───────────────────────────────
 * 이 층은 **순서 번호를 입력으로 받지 않는다.** 승인자 id 를 담은 배열 하나만 받고, 저장할
 * 때 `step_order = index + 1` 로 매긴다(`stepOrderFromIndex` — 그 규칙이 적힌 곳은 여기
 * 하나뿐이다).
 *
 * 번호를 받으면 「빠진 번호(1,2,4)」·「겹친 번호(1,2,2)」·「0 이나 음수」·「번호와 배열 순서가
 * 어긋남」을 전부 검사해야 하고, 그 검사가 하나라도 틀리면 표의 유니크
 * (route_id, step_order)가 저장 시점에 터진다 — 사람에게는 「알 수 없는 오류」로 보인다.
 * 배열의 자리를 그대로 쓰면 그 네 가지 실패가 **존재할 수 없다.** 화면의 「위로/아래로」
 * 단추도 배열 원소를 옮기기만 하면 끝난다.
 *
 * ── 🔴 uuid 형식은 여기서 보지 않는다 ───────────────────────────────────
 * 형식 검사는 **저장 경로가** 한다. 같은 정규식을 여기서 또 쓰면 두 벌이 된다(이 저장소에도
 * 이미 `src/lib/stock/form.ts` 의 `UUID_RE` 가 있다). 여기서 보는 것은 「사람이 화면에서
 * 고칠 수 있는 것」뿐이다: 몇 명인가, 같은 사람이 두 번 들어갔는가, 빈 자리가 남았는가.
 * ============================================================================
 */

/**
 * ── 🔴 절차의 「용도」 ───────────────────────────────────────────────────
 * 이 절차가 **무엇을 결재하는가**. 판(version)은 용도 안에서 세고, 「현재 절차」도 용도 안에서
 * 정해진다 — 한 용도의 절차를 고쳐도 다른 용도는 흔들리지 않는다.
 *
 * 값 목록이 적힌 곳은 둘이다: 여기와 표의 enum(`src/db/schema/approval-routes.ts` 의
 * `approvalRouteScopeEnum`). 이 저장소의 스키마 파일은 도메인 층을 가져오지 않으므로
 * 두 벌이 되고, 갈라지지 않도록 이 파일의 시험(`tests/approval-route.test.ts`)이 둘을 맞춰
 * 본다. 갈라지면 화면은 받아 주는데 저장이 22P02 로 터지거나 그 반대가 된다.
 *
 * 🔴 **새 용도는 맨 끝에 적는다** — 표의 enum 은 `ALTER TYPE … ADD VALUE` 로 뒤에 붙고,
 * 이 파일의 시험이 순서까지 맞대어 본다.
 *
 * ── 🔴 뒤의 둘에 **실제로 신청이 간다** (2026-10-22, 가려 붙이기) ────────
 * 그릇만 있던 자리에 길이 뚫렸다. 신청마다 딸린 **수리 건의 종류**(`stock_requests.workflow_kind`)로
 * 가려 붙이고, 그 짝표는 이 파일 아래 `approvalRouteScopeForWorkflowKind` 하나뿐이다. 읽는 자리
 * 셋(결재 올리기 · [확인] 게이트 · 담당자 화면)이 전부 그것을 거친다 — 하나라도 글자로 박힌
 * 용도를 읽으면 **결재가 조용히 우회된다**(`./request-scope.ts` 머리말에 그 구멍의 모양).
 *
 * 🔴 **그런데 아래 이름표(`APPROVAL_ROUTE_SCOPE_LABELS`)와 빈 상태 안내
 * (`APPROVAL_ROUTE_EMPTY_NOTICES`)의 말은 아직 옛말이다** — 매쳐·제너레이터 쪽이 「아직 이 절차로
 * 오지 않습니다」라고 하는데 이제 온다. 🔵 그 글자를 고치는 것은 **쓰는 분이 정할 일**이라(그 문장을
 * 못 박는 시험이 따로 있다) 이 조각에서 손대지 않았다. 고치는 조각이 오면
 * `./part-issue.ts` 의 `NO_ROUTE` 문구도 함께 본다.
 */
export const APPROVAL_ROUTE_SCOPES = ["PART_ISSUE", "PART_ISSUE_MATCHER", "PART_ISSUE_GENERATOR"] as const;
export type ApprovalRouteScope = (typeof APPROVAL_ROUTE_SCOPES)[number];

/**
 * 🔴 **용도의 이름표가 적힌 유일한 곳.** 코드 값(`PART_ISSUE`)은 사람이 읽을 말이 아니므로
 * 화면에 그대로 내보내지 않는다.
 *
 * 편집 화면의 용도 고르는 자리·설명 문장·저장 결과 문구가 전부 여기를 본다. 두 곳에 적으면
 * 같은 절차가 화면마다 다른 이름으로 불리고, 관리자는 그것이 같은 것인지 알 수 없다.
 *
 * 🔴 **Record 로 둔다** — 용도를 하나 더하면 여기 빠진 자리를 컴파일러가 바로 잡는다. 이름표
 * 없는 용도가 화면에 코드 값으로 새어 나가는 일이 없다.
 *
 * ── 🔴 「부품 불출」의 이름표를 **지금은 바꾸지 않는다** (2026-10-22) ────
 * 매쳐·제너레이터가 생겼으니 첫째 용도에 「옛 절차」·「(사용 안 함)」 같은 말을 붙이고 싶어
 * 지지만, 그렇게 적으면 **지금 당장 거짓말**이 된다. 이유가 셋이다:
 *
 *  1. **아직 모든 신청이 그리로 간다.** 가려 붙이기는 다음 조각이고, 그때까지 「부품 불출」은
 *     옛것이 아니라 **실제로 돌고 있는 유일한 절차**다. 먼저 적어 두면 관리자는 멀쩡히 도는
 *     절차를 꺼진 것으로 읽고 손대지 않는다.
 *  2. **감사 로그가 이 표를 그릴 때마다 다시 읽는다**(`src/lib/audit-labels.ts` 의
 *     `approval_routes:<scope>`). 이름표를 갈면 **이미 쌓인 옛 줄까지** 새 이름으로 보여서,
 *     그때 관리자가 무엇을 고쳤는지가 흐려진다 — 감사 로그는 append-only 인데 화면의 말만
 *     소급해 바뀌는 셈이다.
 *  3. 같은 절차가 어제와 다른 이름으로 불리면 용어가 섞인다(CLAUDE.md 10절).
 *
 * 🔵 **다음 조각에서 신청이 매쳐·제너레이터로 갈린 뒤**에는 이 용도가 실제로 옛것이 된다.
 * 이름표를 고칠 자리는 그때다.
 */
export const APPROVAL_ROUTE_SCOPE_LABELS: Record<ApprovalRouteScope, string> = {
  PART_ISSUE: "부품 불출",
  // 🔴 「매쳐」다. 「매처」·「메쳐」가 아니다 — A/S 쪽 글자로 통일한다(2026-10-22 사용자 결정).
  PART_ISSUE_MATCHER: "매쳐 부품 불출",
  PART_ISSUE_GENERATOR: "제너레이터 부품 불출",
};

/**
 * 그 용도의 절차가 **비어 있을 때 지금 무슨 일이 일어나는가** — 한 문장.
 *
 * 🔴 단계 0개는 「절차를 쓰지 않겠다」는 정상적인 뜻이고, 그때 앱이 어떻게 도는지는
 * **용도마다 다르다.** 한 문장으로 뭉뚱그리면 용도가 늘었을 때 그중 하나에게는 거짓말이
 * 된다 — 원본에서 실제로 그 일이 있었다(출하만을 말하던 문장이 용도가 늘자 그대로 틀린
 * 말이 됐다). 용도가 하나뿐이던 때부터 Record 로 둔 까닭이고, 2026-10-22 에 용도가 셋이 되면서
 * 바로 그 일이 일어났다 — 아래 두 문장은 첫째 용도의 문장과 **말하는 사실 자체가 다르다**.
 *
 * 🔴 **편집 화면의 빈 상태와 저장 결과 문구가 같은 문장을 쓴다.** 두 곳에 각자 적으면 화면은
 * 「담당자가 처리합니다」라는데 저장은 다른 말을 하는 날이 온다.
 *
 * 🔴 **지금 사실이 아닌 말을 적지 않는다.** 매쳐·제너레이터는 절차가 비어서 담당자가 바로
 * 불출하는 것이 아니라, **아직 그 용도로 오는 신청 자체가 없다.** 첫째 용도의 문장을 베껴
 * 붙이면 관리자는 「여기에 단계를 넣으면 매쳐 신청이 걸린다」고 읽고, 넣어 두고 기다리다가
 * 아무 일도 안 일어나는 것을 보게 된다.
 */
export const APPROVAL_ROUTE_EMPTY_NOTICES: Record<ApprovalRouteScope, string> = {
  PART_ISSUE: "지금은 재고 담당자가 그 자리에서 바로 불출합니다.",
  PART_ISSUE_MATCHER:
    "매쳐 부품 불출 신청은 아직 이 절차로 오지 않습니다. 지금은 모든 부품 불출이 「부품 불출」 절차를 따릅니다.",
  PART_ISSUE_GENERATOR:
    "제너레이터 부품 불출 신청은 아직 이 절차로 오지 않습니다. 지금은 모든 부품 불출이 「부품 불출」 절차를 따릅니다.",
};

/**
 * 바깥에서 들어온 값이 쓸 수 있는 용도인가.
 *
 * 🔴 서버 액션이 **화면이 보낸 용도를 그대로 믿지 않기** 위해 부른다. 형식만 본다 — 그 용도의
 * 절차를 이 사람이 고칠 수 있는가(인가)는 자료를 봐야 알 수 있으므로 저장 경로가 자기
 * 트랜잭션 안에서 맡는다.
 */
export function isApprovalRouteScope(value: unknown): value is ApprovalRouteScope {
  return typeof value === "string" && (APPROVAL_ROUTE_SCOPES as readonly string[]).includes(value);
}

/**
 * ============================================================================
 * 🔴 수리 건의 **종류** → 그 신청이 따를 **절차** (2026-10-22)
 * ============================================================================
 * A/S 는 **종류만** 보낸다(`workflowKind`). 어느 절차를 붙일지는 **이쪽이 정한다** — 그래야
 * 나중에 짝을 바꿔도 이미 쌓인 신청 자료를 한 줄도 고치지 않는다(저쪽이 절차 이름을 보내면
 * 짝이 바뀌는 날 옛 줄이 통째로 거짓이 된다).
 *
 * 🔴 **짝이 적힌 곳은 아래 표 하나뿐이다.** 「이 종류면 저 절차」를 부르는 자리마다 손으로
 * 적으면, 그중 하나만 안 고쳐지는 날이 온다 — 그때 생기는 결함은 **오류가 아니라 「결재 없이
 * 그냥 나감」**이라 아무도 신고하지 않는다. 그래서 표를 내보내지 않고(직접 읽으면 그것이 곧
 * 두 벌이다) **이 함수 하나로만** 쓴다.
 *
 * ── 쓰는 분이 정한 짝 (2026-10-22) ──────────────────────────────────────
 *   매쳐            → 매쳐 부품 불출
 *   제너레이터       → 제너레이터 부품 불출
 *   🔴 토탈 컨트롤러 → **제너레이터와 같은 절차**. 따로 용도를 만들지 않는다 — 결재 받는 사람이
 *      같기 때문이고, 용도를 늘리면 관리자가 **또 한 벌을 짜 둬야** 하는데 짜 두기 전까지
 *      그 신청은 절차 없이 바로 나간다.
 *   모름(`null`)    → 기존 「부품 불출」
 *
 * 🔴 **「모름」이 기존 절차로 가는 것이 이 조각의 안전장치다.** 칸이 비어 있는 **옛 신청**이
 * 전부 여기로 오고, 수리 건이 없는 신청·재고 관리에서 직접 올린 신청도 여기로 온다. 다른
 * 자리로 보내면 관리자가 짜 둔 적 없는 절차를 가리켜 **결재 없이 나가는 길**이 열린다.
 * ============================================================================
 */

/**
 * A/S 가 보내는 종류. 🔴 **절차 이름이 아니다**(위 머리말).
 * 🔴 **값 목록이 적힌 곳은 둘이다** — 여기와 표의 enum(`src/db/schema/stock-requests.ts` 의
 * `REQUEST_WORKFLOW_KINDS`). 도메인 층이 db 층을 가져오지 않는 관례 탓에 두 벌이 되고,
 * `APPROVAL_ROUTE_SCOPES` 와 똑같이 시험이 둘을 맞대어 본다.
 */
export const WORKFLOW_KINDS = ["MATCHER", "GENERATOR", "TOTAL_CONTROLLER"] as const;
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];

/**
 * 바깥이 보낸 종류가 **우리가 아는 값인가.**
 *
 * 🔴 **모르는 글자가 와도 터지지 않는다** — 거짓을 돌려줄 뿐이고, 부르는 쪽은 그것을 「모름」
 * (`null`)으로 떨어뜨린다(`src/lib/api/stock-requests.ts`). A/S 가 종류를 하나 더 만드는 날
 * 우리 쪽이 **신청 자체를 거절하면** 현장에서 부품을 못 받는다. 떨어뜨리면 그 신청은 기존
 * 절차를 따라 **평소대로** 처리된다.
 */
export function isWorkflowKind(value: unknown): value is WorkflowKind {
  return typeof value === "string" && (WORKFLOW_KINDS as readonly string[]).includes(value);
}

/**
 * 🔴 **짝이 적힌 유일한 자리.** 내보내지 않는다 — 부르는 쪽이 표를 직접 읽기 시작하면 그것이
 * 곧 두 벌이고, 「모름」을 어디로 보낼지(아래 함수)가 그때 빠진다.
 *
 * 🔴 **Record 로 둔다** — 종류를 하나 더하면 빠진 자리를 컴파일러가 바로 잡는다. 짝이 없는
 * 종류가 조용히 「모름」으로 떨어져 기존 절차로 새어 나가는 일이 없다.
 */
const APPROVAL_ROUTE_SCOPE_BY_WORKFLOW_KIND: Record<WorkflowKind, ApprovalRouteScope> = {
  MATCHER: "PART_ISSUE_MATCHER",
  GENERATOR: "PART_ISSUE_GENERATOR",
  // 🔴 제너레이터와 **같이 간다**(2026-10-22 쓰는 분 결정, 위 머리말). 오타가 아니다.
  TOTAL_CONTROLLER: "PART_ISSUE_GENERATOR",
};

/**
 * 그 신청이 따를 절차. 🔴 **「모름」(`null`)은 기존 「부품 불출」**이다(위 머리말).
 *
 * 🔵 **순수 함수다** — DB 도 세션도 보지 않는다. 그래서 세 자리(결재 올리기·[확인] 게이트·
 * 화면)가 전부 이것을 거치고, `npm test` 가 네 갈래를 전부 돌려 본다.
 */
export function approvalRouteScopeForWorkflowKind(kind: WorkflowKind | null): ApprovalRouteScope {
  if (kind === null) return "PART_ISSUE";
  return APPROVAL_ROUTE_SCOPE_BY_WORKFLOW_KIND[kind];
}

/**
 * 한 절차에 둘 수 있는 단계의 최대 개수.
 *
 * 10 인 이유: 순차 승인이 10단계면 그 자체로 이미 병목이고(한 사람이 자리를 비우면 그만큼
 * 일이 멈춘다), 편집 화면도 그보다 길어지면 한눈에 다루지 못한다. 무엇보다 **상한이 없으면
 * 실수 한 번으로 결재가 영영 끝나지 않는 절차가 만들어진다** — 붙여넣기 한 번에 수십 줄이
 * 들어가도 표는 그대로 받는다.
 *
 * 0 개는 상한과 무관하게 정상이다(아래 참조).
 */
export const MAX_APPROVAL_ROUTE_STEPS = 10;

export type ApprovalRouteStepsIssueCode =
  /** 상한을 넘었다. */
  | "TOO_MANY_STEPS"
  /** 같은 사람이 두 번 들어 있다. */
  | "DUPLICATE_APPROVER"
  /** 승인자를 고르지 않은 자리가 있다. */
  | "MISSING_APPROVER";

export type ApprovalRouteStepsValidationResult =
  | { ok: true }
  | { ok: false; code: ApprovalRouteStepsIssueCode; message: string };

/**
 * 배열의 자리(0부터)를 표에 적을 순서 번호(1부터)로 옮긴다.
 *
 * 규칙이 적힌 곳을 하나로 묶어 두기 위한 함수다 — 저장 경로가 `index + 1` 을 직접 쓰기
 * 시작하면, 나중에 이 규칙이 바뀔 때(예: 0부터) 한쪽만 고쳐진다. 표의
 * CHECK (step_order >= 1) 가 이것과 짝이다.
 */
export function stepOrderFromIndex(index: number): number {
  return index + 1;
}

/**
 * 절차 단계 목록이 저장할 수 있는 모양인가.
 *
 * **0개는 허용한다.** 「절차를 쓰지 않겠다」는 정상적인 뜻이고, 그때 앱은 지금까지처럼 재고
 * 담당자가 그 자리에서 바로 처리한다. 여기서 0개를 막으면 관리자는 한 번 만든 절차를 되돌릴
 * 방법이 없어진다 — 판은 지우지 않기 때문이다(append-only).
 *
 * 메시지는 무엇을 고쳐야 하는지까지 적는다. 「저장할 수 없습니다」만 돌려주면 관리자는 같은
 * 값을 몇 번 더 눌러 보다가 포기한다.
 */
export function validateApprovalRouteSteps(
  approverUserIds: readonly string[],
): ApprovalRouteStepsValidationResult {
  if (approverUserIds.length > MAX_APPROVAL_ROUTE_STEPS) {
    return {
      ok: false,
      code: "TOO_MANY_STEPS",
      message: `승인 단계는 최대 ${MAX_APPROVAL_ROUTE_STEPS}개까지 둘 수 있습니다. 지금 ${approverUserIds.length}개입니다.`,
    };
  }

  const seen = new Set<string>();
  for (let index = 0; index < approverUserIds.length; index += 1) {
    const raw = approverUserIds[index];
    // 화면에서 「단계 추가」만 누르고 사람을 아직 고르지 않은 빈 줄이 그대로 넘어오는 길이
    // 실제로 있다. 공백만 든 값도 같은 것으로 본다.
    const approverUserId = typeof raw === "string" ? raw.trim() : "";
    if (approverUserId.length === 0) {
      return {
        ok: false,
        code: "MISSING_APPROVER",
        message: `${stepOrderFromIndex(index)}번째 단계의 승인자를 선택해 주세요.`,
      };
    }

    if (seen.has(approverUserId)) {
      return {
        ok: false,
        code: "DUPLICATE_APPROVER",
        message: `같은 사람이 승인 단계에 두 번 들어 있습니다 (${stepOrderFromIndex(index)}번째 단계). 한 사람은 한 번만 지정할 수 있습니다.`,
      };
    }
    seen.add(approverUserId);
  }

  return { ok: true };
}

/**
 * ============================================================================
 * 🔴 요청자 본인 단계는 건너뛴다 — 「다음에 결재할 단계」 고르기
 * ============================================================================
 * 자기가 올린 것을 자기가 결재하는 칸을 없앤다. 결재선이 [김철수 · 이영희 · 박대표]인데
 * 이영희가 요청하면 1단계 김철수 → (2단계 건너뜀) → 3단계 박대표다.
 *
 * 🔴 **처음 요청할 때만이 아니라 사슬이 나아갈 때마다 본다.** 그래서 규칙을 순수 함수 하나로
 * 내려 두고 **요청 경로와 사슬 잇는 자리가 같은 함수를 부른다.** 두 곳에 각자 적으면
 * 「요청할 때는 건너뛰는데 사슬에서는 안 건너뛴다」가 되고, 그때 요청자는 자기 차례를 받아
 * 자기가 올린 것을 결재하게 된다.
 *
 * 진행 미리보기(승인 카드)도 같은 판정을 봐야 한다 — 건너뛴 단계를 「완료」로 칠하면 아무도
 * 승인하지 않은 칸이 승인된 것처럼 보인다. 그래서 갈림 자체는 `isRouteStepSkippedForRequester`
 * 한 곳에 적고 셋이 그것을 부른다.
 * ============================================================================
 */

/**
 * 이 층이 단계 하나에서 보는 것 — 몇 번째이고 **누구인가(포털 번호)**. 표를 읽는 층의 단계
 * 타입들이 이 모양을 이미 만족하므로, 그쪽 타입을 그대로 넘기고 **그대로 돌려받는다**(아래
 * 함수가 제네릭인 이유다 — 돌려받은 값에서 그쪽 층의 다른 칸도 계속 쓸 수 있다).
 *
 * 🔴 도메인 층은 db 층을 가져오지 않는다. 같은 모양을 여기 한 벌 적어 두는 것이 관례다.
 *
 * ── 🔴 열쇠는 `approverSub`(포털 번호)이지 `approverUserId`(A/S 번호)가 아니다 ──
 * 사람을 가르는 일은 **전부** 포털 번호로 한다(2026-10-15 사용자 결정,
 * `./directory.ts` 머리말). A/S 번호는 이 시스템의 로그인 번호가 아니라서, 그것으로 견주면
 * 「내 차례인가」가 **언제나 거짓**이 된다 — 코드는 맞고 값이 안 맞는 결함이라 시험으로도
 * 안 잡힌다. 그래서 칸 이름을 `…Sub` 로 둔다: `approverUserId` 라는 이름이 남아 있으면 다음
 * 사람이 거기에 `users.id` 를 넘긴다(이번 결함이 바로 그렇게 생겼다).
 *
 * 🔵 `null` 인 것은 **옛 판**이다 — 포털 번호를 적기 전에 저장된 단계(개발 DB 에 둘 있다).
 * 그런 단계가 섞인 결재선으로는 결재건을 올릴 수 없다(`planPartIssueApproval`).
 */
export type RouteStepAssignment = {
  /** 1부터. */
  stepOrder: number;
  /** 포털 번호. 옛 판에는 없다(`null`). */
  approverSub: string | null;
};

/**
 * 이 단계를 **건너뛰는가** — 그 단계의 승인자가 그 요청을 올린 사람인가.
 *
 * 🔴 견주는 것은 **포털 번호 둘**이다. 신청자 쪽은 이 시스템의 `users.auth_sub`, 단계 쪽은
 * 저장해 둔 `approver_sub` — 둘 다 포털이 준 같은 값이라야 같은 사람이 같은 사람으로 보인다.
 * A/S 번호로 견주면 건너뛰기가 **조용히 작동하지 않고**, 신청자가 자기 건을 결재하게 된다.
 *
 * 둘 중 하나라도 모르면(`null`) 언제나 거짓이다. 건너뛸 근거가 없으면 결재선은 예전 그대로
 * 도는 것이 맞다 — 여기서 참을 돌려주면 아무도 결재하지 않은 단계가 조용히 사라진다.
 */
export function isRouteStepSkippedForRequester(
  approverSub: string | null,
  requesterSub: string | null,
): boolean {
  if (requesterSub === null || approverSub === null) return false;
  return approverSub === requesterSub;
}

/**
 * `completedStepOrder` 다음에 **실제로 결재할** 단계. 없으면 `null`.
 *
 * @param steps 그 판의 단계들. 순서가 뒤섞여 있어도 된다 — 아래에서 번호가 가장 작은 것을
 *   고르므로 부르는 쪽의 정렬에 기대지 않는다.
 * @param completedStepOrder 지금까지 온 단계 번호. **처음 요청이면 0** 이다(0보다 큰 번호만
 *   후보가 되므로 1단계부터 본다).
 * @param requesterSub 그 사슬을 시작한 사람의 **포털 번호**. 사슬이 나아가도 바뀌지 않는다 —
 *   방금 결재한 사람이 아니라 요청 행에 적힌 요청자다. 🔴 이름이 `…Sub` 인 까닭은 위
 *   `RouteStepAssignment` 주석에 있다(`users.id` 를 넘기면 건너뛰기가 조용히 꺼진다).
 *
 * 🔴 **돌려주는 단계의 번호를 1로 고쳐 적지 않는다.** 건너뛴 뒤의 실제 번호(예: 2)가 그대로
 * 표에 들어가야 한다 — 다음 단계를 찾을 때 그 번호로 옛 판을 이어 세기 때문이다.
 *
 * `null` 의 뜻은 부르는 자리마다 다르다:
 *  - 요청 경로: 단계가 있는데 남는 단계가 하나도 없다 → **요청을 거절한다**(혼자 짜인
 *    결재선은 결재 없는 것과 같아진다).
 *  - 사슬 잇는 자리: 뒤에 결재할 사람이 없다 → **다음 행을 만들지 않는다**. 그러면 최신 행이
 *    APPROVED 로 남아 문이 열린다(정상이다).
 * 두 뜻을 이 함수가 가르지 않는 것은 의도다 — 여기서 가르려면 「요청인가 사슬인가」를 인자로
 * 받아야 하고, 그 순간 규칙 하나가 둘로 갈라진다.
 */
export function findNextRouteStepToApprove<T extends RouteStepAssignment>(
  steps: readonly T[],
  completedStepOrder: number,
  requesterSub: string | null,
): T | null {
  let next: T | null = null;
  for (const step of steps) {
    if (step.stepOrder <= completedStepOrder) continue;
    if (isRouteStepSkippedForRequester(step.approverSub, requesterSub)) continue;
    if (next === null || step.stepOrder < next.stepOrder) next = step;
  }
  return next;
}

/**
 * ── 편집 도우미 ─────────────────────────────────────────────────────────
 * 편집 화면이 목록을 만질 때 쓰는 배열 조작이다. 화면 안에 두지 않고 여기로 내린 이유가
 * 둘이다:
 *
 *  1. **그 화면은 렌더 시험이 붙지 않는다.** 서버 액션을 물고 있고 그 사슬 끝에 `server-only`
 *     가 있어서다. 실수가 나기 쉬운 부분(경계에서 한 칸 어긋나기, 원본을 그대로 뒤집어
 *     놓기)만 순수 함수로 내려 두면 그 부분은 시험할 수 있다.
 *  2. 🔴 **`isSameRouteStepList` 는 화면만의 것이 아니다.** 저장 경로가 「바뀐 게 없으면 새
 *     판을 만들지 않는다」를 판정할 때 같은 함수를 쓴다. 두 곳이 각자 비교식을 적으면 화면은
 *     「바뀌었다」는데 저장은 「그대로다」라고 답하는 날이 온다.
 *
 * 🔴 **넷 다 입력 배열을 건드리지 않는다.** 언제나 새 배열을 돌려준다 — 범위를 벗어나 아무
 * 일도 일어나지 않는 경우에도 그렇다. React 상태로 쓰이는 배열이라, 제자리에서 뒤집으면
 * 화면이 다시 그려지지 않은 채 자료만 달라진다.
 */

/**
 * index 자리의 단계를 한 칸 위로. **맨 위에서 더 올리려 하면 내용이 그대로인 새 배열을
 * 돌려준다** — 던지지 않는다.
 *
 * 화면은 맨 위 줄의 [▲] 를 비활성으로 두지만, 그것과 별개로 여기서도 조용히 아무 일이 없어야
 * 한다. 단추가 눌리는 길(키보드, 비활성 처리를 빠뜨린 다음 판)은 언제든 열릴 수 있고, 그때
 * 오류 상자가 뜨는 것은 사람에게 「고장」이다.
 */
export function moveRouteStepUp(list: readonly string[], index: number): string[] {
  const next = [...list];
  if (index <= 0 || index >= next.length) return next;
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return next;
}

/** index 자리의 단계를 한 칸 아래로. 맨 아래에서 더 내리려 하면 그대로. */
export function moveRouteStepDown(list: readonly string[], index: number): string[] {
  const next = [...list];
  if (index < 0 || index >= next.length - 1) return next;
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return next;
}

/** index 자리의 단계를 뺀다. 범위를 벗어나면 내용이 그대로인 새 배열. */
export function removeRouteStep(list: readonly string[], index: number): string[] {
  const next = [...list];
  if (index < 0 || index >= next.length) return next;
  next.splice(index, 1);
  return next;
}

/**
 * 두 승인자 목록이 **순서까지** 같은가.
 *
 * 🔴 순서가 다르면 다른 절차다. 같은 사람 둘이라도 누가 먼저 보느냐가 결재선의 뜻 그
 * 자체이므로, 순서만 바꾼 저장은 새 판이 되어야 한다.
 *
 * 저장 경로가 이 함수로 「바뀐 게 없으면 새 판을 만들지 않는다」를 판정한다. 판은 지우지
 * 않으므로(append-only), 저장 단추를 두 번 누르면 똑같은 판이 둘 쌓여 「누가 언제 결재선을
 * 바꿨나」가 잡음에 묻힌다.
 */
export function isSameRouteStepList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
