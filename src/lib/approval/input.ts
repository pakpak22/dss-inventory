import {
  isApprovalRouteScope,
  isSameRouteStepList,
  stepOrderFromIndex,
  validateApprovalRouteSteps,
  type ApprovalRouteScope,
  type ApprovalRouteStepsIssueCode,
} from "./route";

/**
 * ============================================================================
 * 승인 절차(결재선) 입력 검증 — 형식만 본다
 * ============================================================================
 * A/S 의 `src/lib/validation/shipment-approval-route-input.ts` 를 동작 그대로 옮겨 온 것이다
 * (2026-10-15, 조각 ③b). **DB 도 세션도 망도 여기서 만지지 않는다** — 순수 함수여야 단위
 * 시험이 붙고, 그래야 「어떤 값을 받아들이는가」가 실제로 검증된다. 누가 적을 수 있는가(인가)는
 * 서버 액션이, 그 사람이 지금 A/S 명부에 있는가(자격)는 저장 경로가 맡는다.
 *
 * ── 🔴 규칙을 여기 다시 적지 않는다 ─────────────────────────────────────
 * 개수 상한·중복 인물·빈 자리는 `route.ts` 의 `validateApprovalRouteSteps` 가 정한다. 화면도
 * 그 함수를 보고 저장도 이 함수를 지나 그 함수를 본다 — 규칙이 적힌 곳이 하나여야 「화면은
 * 받아 주는데 저장이 거절한다」가 생기지 않는다. 여기가 더하는 것은 **바깥에서 들어온 값의
 * 모양**뿐이다: 객체인가, 배열인가, 원소가 문자열인가, uuid 형식인가, 용도가 목록에 있는가.
 *
 * ── 🔴 용도는 반드시 적혀 있어야 한다 — 기본값으로 채우지 않는다 ────────
 * 「없으면 부품 불출」로 채우면 용도를 빠뜨린 요청이 **조용히 어떤 절차를 덮어쓴다.** 지금
 * 용도가 하나뿐이라도 그렇게 한다 — 원본의 판단이고, 용도는 늘어날 자리다. 모르는 값도 같은
 * 이유로 거절한다: 표의 enum 이 결국 막아 주긴 하지만 거기까지 가면 사람에게는 「알 수 없는
 * 오류」로 보인다.
 *
 * ── 빈 자리는 여기서 말하지 않는다 ──────────────────────────────────────
 * 화면에서 [+ 단계 추가] 만 누르고 사람을 아직 고르지 않은 줄은 빈 문자열로 넘어온다. 그것을
 * 「uuid 형식이 아닙니다」로 거절하면 관리자는 무엇을 고쳐야 하는지 알 수 없다 — 규칙 쪽이
 * 그 자리에 할 말(`MISSING_APPROVER`, 「N번째 단계의 승인자를 선택해 주세요」)을 이미 갖고
 * 있으므로 그쪽으로 넘긴다. 값이 들어 있는데 형식이 아닌 경우만 여기서 걸린다(손으로 만든
 * 요청이다).
 * ============================================================================
 */

/**
 * 🔵 `src/lib/stock/form.ts` 에도 같은 정규식이 있지만 그것은 그 파일 안의 비공개 상수이고,
 * 그 모듈은 `./codes`(server-only)를 끌어온다 — 가져다 쓰면 이 파일이 서버 전용이 되어
 * DB 도 망도 없는 시험이 붙지 않게 된다. 그래서 여기 한 줄을 따로 둔다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApprovalRouteInputIssueCode =
  /** 요청 자체의 모양이 아니다 — 배열이 아니거나, 원소가 문자열/uuid 가 아니거나, 용도가 목록에 없다. */
  | "INVALID_INPUT"
  | ApprovalRouteStepsIssueCode;

export type ValidateApprovalRouteInputResult =
  | { ok: true; scope: ApprovalRouteScope; approverUserIds: string[] }
  | { ok: false; code: ApprovalRouteInputIssueCode; message: string };

/**
 * 서버 액션과 저장 경로가 화면에서 받은 값을 그대로 믿지 않기 위해 부른다.
 *
 * 받는 모양은 `{ scope, approverUserIds: string[] }` 다. 순서 번호를 받지 않는 이유(배열의
 * 자리가 곧 순서다)는 `route.ts` 머리말에 있다.
 *
 * 🔴 **빈 배열은 정상이다.** 「절차를 쓰지 않겠다」는 뜻이고, 판은 지우지 않으므로
 * (append-only) 0개짜리 판을 얹는 것이 한 번 켠 절차를 끄는 유일한 출구다.
 */
export function validateApprovalRouteInput(input: unknown): ValidateApprovalRouteInputResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "승인 절차 입력을 확인할 수 없습니다." };
  }

  const { approverUserIds, scope } = input as { approverUserIds?: unknown; scope?: unknown };
  if (!isApprovalRouteScope(scope)) {
    return { ok: false, code: "INVALID_INPUT", message: "어떤 승인 절차인지 확인할 수 없습니다." };
  }
  if (!Array.isArray(approverUserIds)) {
    return { ok: false, code: "INVALID_INPUT", message: "승인 단계 목록을 확인할 수 없습니다." };
  }

  for (let index = 0; index < approverUserIds.length; index += 1) {
    const raw: unknown = approverUserIds[index];
    if (typeof raw !== "string") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: `${stepOrderFromIndex(index)}번째 단계의 승인자 정보를 확인할 수 없습니다.`,
      };
    }
    // 아직 안 고른 자리는 규칙 쪽이 말하게 둔다(머리말).
    if (raw.trim().length === 0) continue;
    if (!UUID_RE.test(raw)) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: `${stepOrderFromIndex(index)}번째 단계의 승인자 정보를 확인할 수 없습니다.`,
      };
    }
  }

  const checked = validateApprovalRouteSteps(approverUserIds as string[]);
  if (!checked.ok) return { ok: false, code: checked.code, message: checked.message };

  // 새 배열로 돌려준다 — 부르는 쪽이 받은 배열을 그대로 트랜잭션에 실어 보내므로, 요청
  // 객체와 자리를 나눠 쓰지 않는 편이 안전하다.
  return { ok: true, scope, approverUserIds: [...(approverUserIds as string[])] };
}

/**
 * 새 판을 얹어야 하는가 — **바뀐 게 없으면 만들지 않는다.**
 *
 * 🔴 판은 지우지 않으므로(append-only), 이 판정이 없으면 [저장] 을 누를 때마다 똑같은 판이
 * 하나씩 쌓여 「누가 언제 결재선을 바꿨나」가 잡음에 묻힌다. 비교는 `isSameRouteStepList` 로
 * 한다 — 화면의 「저장하지 않은 변경이 있습니다」와 **같은 함수**다. 두 곳이 각자 비교식을
 * 적으면 화면은 「바뀌었다」는데 저장은 「그대로다」라고 답하는 날이 온다. 순서만 달라도 다른
 * 절차다.
 *
 * 🔴 **판이 하나도 없으면 언제나 참이다.** 판이 없는 상태에서 0개짜리를 저장하는 것은
 * 「절차를 쓰지 않기로 했다」를 **처음으로 기록하는 일**이라, 남길 판도 감사 기록도 있어야
 * 한다. 여기서 「둘 다 비었으니 같다」로 끊으면 화면이 적어야 할 「현재 N번째 판」이 영영
 * 생기지 않는다.
 *
 * @param current 지금 판의 승인자 id 들. 판이 하나도 없으면 `null`.
 */
export function shouldCreateNewVersion(
  current: readonly string[] | null,
  next: readonly string[],
): boolean {
  if (current === null) return true;
  return !isSameRouteStepList(current, next);
}
