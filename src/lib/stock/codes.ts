import { CHARGE_TYPES, ENTRY_TYPES, PURPOSES, type ChargeType, type EntryType, type Purpose, type Sheet } from "@/db/schema/stock";
import type { RequestSource, RequestStatus } from "@/db/schema/stock-requests";
/**
 * 🔴 **타입만 가져온다.** 값을 가져오면 되돌아오는 고리가 생긴다 — 저쪽
 * (`@/lib/approval/part-issue-gate`)은 `part-issue-rules.ts` 를 거쳐 **이 파일의 값**
 * (`reopenedRequestStatus`)을 다시 가져가기 때문이다. `import type` 은 컴파일할 때 지워지므로
 * 실제로 도는 코드에는 고리가 남지 않는다. 🔵 잠금을 **만드는** 자리는 끝까지 저쪽 하나다
 * (`partIssueLockFor`) — 여기서는 받은 값을 **읽기만** 한다.
 */
import type { PartIssueLock } from "@/lib/approval/part-issue-gate";

/**
 * 수량 변경 기록의 코드값 → 화면 글자 (DESIGN 4-1절). 저장은 영문, 화면은 한글. 화면 전체가 이 표 하나를 쓴다.
 */
export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  RECEIVE: "입고",
  USE: "사용",
  RETURN: "반환",
  DISPOSE: "폐기·불량",
  ADJUST: "조정",
  TRANSFER: "소유 옮김",
  LOAN: "대여",
  OPENING: "처음 수량",
  CORRECTION: "기록 취소",
};

/** 기록 화면에서 사람이 고르는 일곱 가지 (DESIGN 2-4절). 처음 수량·기록 취소는 따로. */
export const RECORDABLE_TYPES = ["USE", "RECEIVE", "RETURN", "DISPOSE", "ADJUST", "TRANSFER", "LOAN"] as const satisfies readonly EntryType[];
export type RecordableType = (typeof RECORDABLE_TYPES)[number];

/**
 * 담당자 확인을 거치는 종류 — 반출 계열 (2026-10-06 사용자 결정: 「신청 → 담당자 확인 → 반출」).
 * 입고·반환은 담당자가 하는 일이라 지금도 바로 원장에 쓰인다.
 *
 * 🔴 **2026-10-15 사용자 결정으로 바뀜: 누가 적든 반출은 요청으로 올라간다. 관리자도 예외가 아니다.**
 *    옛 규칙(2026-10-06)은 「기록 권한자가 적으면 확인 대기로, **관리자가 적으면 바로 원장에**」였다 —
 *    까닭은 「관리자가 직접 적으면 신청과 확인이 한 번이다」였다. 그런데 그러면 관리자가 「수량 변경 기록」에
 *    반출을 적을 때 **신청이 아예 만들어지지 않아** 부품 요청 관리(`/requests`)에 한 줄도 안 떴다
 *    (2026-10-15 실측 — 쓰는 분이 적었는데 그 화면에 없었다). 이제 역할을 보지 않는다.
 * 🔴 그래서 **매개변수가 하나다.** 역할을 넘기던 자리를 지워 두면 tsc 가 부르는 자리를 전부 잡아 준다.
 * 🔵 **관리자가 낸 요청은 본인이 확인하게 된다.** 지금 코드가 그걸 이미 감당한다 — `confirmRequest` 는
 *    신청한 사람을 원장의 `created_by`, 확인한 사람을 `confirmed_by` 로 적으므로 **같은 사람이어도 괜찮다**
 *    (`src/lib/stock/requests.ts`). 확인을 누르기 전까지 수량이 빠지지 않는 것이 이 결정의 핵심이다.
 * 🔵 **「누가 적을 수 있나」와는 다른 물음이다** — 그쪽은 아래 `ADMIN_ONLY_TYPES` 이고 이번에 손대지 않았다.
 */
export const CONFIRMATION_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(["USE", "LOAN", "DISPOSE"]);
export function needsConfirmation(type: EntryType): boolean {
  return CONFIRMATION_TYPES.has(type);
}

/** 관리자만 적을 수 있는 종류 (DESIGN 3절: 조정·소유 옮김·기록 취소) */
export const ADMIN_ONLY_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(["ADJUST", "TRANSFER", "CORRECTION", "OPENING"]);

/**
 * 반출 신청을 **세는 쪽**이 쓰는 두 묶음 (2026-10-14, 조각 4c. 설계 `docs/부품요청_이관_설계_2026-10-14.md` 5절).
 *
 * 🔵 **`PARTIAL`(일부만 나갔고 아직 남음)은 대기다.** 아직 줄 것이 남아 담당자가 계속 봐야 하기 때문이다
 *    (`src/db/schema/stock-requests.ts` 의 `REQUEST_STATUSES` 주석). 끝난 것으로 세면 대기 목록·머리말 배지·
 *    알림 종 어디에도 안 걸려 **화면에서 사라지고**, 그러면 그 신청을 다시 집을 수 없다.
 * 🔵 **`ON_HOLD`(담당자가 사유를 적어 멈춰 둠)도 대기다** (2026-10-15, 조각 10a). `PARTIAL` 과 **같은 논리**다 —
 *    보류는 「그만둔 것」이 아니라 「나중에 다시 볼 것」이라, 목록에서 사라지면 다시 집을 길이 없어 잊힌다.
 *    🔴 다만 **재촉하는 숫자**(머리말 배지·알림 종)에서는 뺀다 — 아래 `ACTIONABLE_REQUEST_STATUSES`.
 * 🔴 두 묶음이 `REQUEST_STATUSES` 를 **빠짐없이, 겹치지 않게** 덮는다. 상태를 더하고 여기를 안 고치면 그 상태의
 *    신청이 어느 목록에도 안 걸린다 — 원장은 안 깨지므로 아무 오류 없이 조용히 사라진다. 그 덮기는
 *    `tests/stock-requests.test.ts` 가 지킨다.
 * 🔵 **`IN_APPROVAL`(불출 결재가 돌고 있음)도 대기다** (2026-10-21, 조각 11e). `PARTIAL`·`ON_HOLD` 와 **같은
 *    논리**다 — 결재가 끝나면 다시 담당자 손으로 돌아오는 **중간** 자리이지 끝난 것이 아니고, 결정 묶음에
 *    넣으면 「결재 중」인 신청이 부품 요청 관리 목록의 「처리 중인 것」에서 사라져 아무도 안 본다.
 *    🔴 다만 **재촉하는 숫자**(머리말 배지·알림 종)에서는 뺀다 — 아래 `ACTIONABLE_REQUEST_STATUSES`.
 * 🔵 서버 전용이 아닌 이 파일에 둔다 — 세는 질의(`src/lib/stock/requests.ts`, server-only)와 시험이 **같은 한 벌**을 본다.
 *    「대기」를 가르는 글자가 적힌 곳은 여기 하나뿐이어야 머리말 배지와 알림 종이 어긋나지 않는다.
 */
export const PENDING_REQUEST_STATUSES = ["PENDING", "CONFIRMING", "PARTIAL", "ON_HOLD", "IN_APPROVAL"] as const satisfies readonly RequestStatus[];

/** 더 볼 일이 없는 것 — 신청한 사람에게 결과로만 보인다. 🔴 `PARTIAL`·`ON_HOLD` 는 여기 **없다**(위 주석). */
export const DECIDED_REQUEST_STATUSES = ["CONFIRMED", "REJECTED", "CANCELLED"] as const satisfies readonly RequestStatus[];

/**
 * 지금 **담당자가 손댈 수 있는** 신청 — 머리말 「대기 N」 배지와 알림 종이 세는 묶음 (2026-10-15, 조각 10a).
 *
 * 🔴 **세는 묶음(`PENDING_REQUEST_STATUSES`)에서 보류(`ON_HOLD`)만 뺀 것이다.** 담당자가 사유를 적어
 *    **일부러 멈춰 둔** 것을 「대기 N」으로 세면 매일 재촉하는 숫자가 되어, 보류를 걸어 둔 뜻이 사라진다.
 *    대기 **목록**에는 그대로 보인다(위 주석) — 안 보이면 잊히기 때문이다. 「목록에 보인다」와
 *    「숫자로 재촉한다」는 뜻이 다르다. 그래서 묶음을 또 하나 둔다.
 * 🔴 **`IN_APPROVAL`(결재 중)도 뺀다** (2026-10-21, 조각 11e). 보류와 **같은 까닭**이고, 이쪽이 더 분명하다 —
 *    결재가 도는 동안 담당자가 그 신청에 할 수 있는 일이 **하나도 없다**(확인·반려·마감·보류가 전부 막힌다).
 *    그런데도 「대기 N」에 세면 담당자는 매일 그 숫자를 보고 화면을 열었다가 **누를 단추가 없다**는 것을
 *    확인하고 닫게 된다. 그 신청이 다시 일감이 되는 것은 결재가 끝나 「승인 요청건」에 [실행]이 서는 순간이고,
 *    그 숫자는 결재 쪽 종(`summarizePartIssueApprovalsToDecide`·실행 대기 목록)이 따로 세고 있다.
 * 🔴 **배지(`countPendingRequests`)와 종(`summarizePendingRequests`)이 반드시 이 한 묶음을 같이 본다.**
 *    둘이 갈리면 「배지에는 있는데 종에는 없는」 신청이 생긴다(`src/lib/stock/requests.ts` 의 두 함수 주석).
 */
export const ACTIONABLE_REQUEST_STATUSES = ["PENDING", "CONFIRMING", "PARTIAL"] as const satisfies readonly RequestStatus[];

/**
 * 담당자가 **집을 수 있는** 상태 — 아직 아무것도 안 나간 것(PENDING)과 일부만 나간 것(PARTIAL) (2026-10-14, 조각 4d).
 *
 * 🔴 **세는 묶음(`PENDING_REQUEST_STATUSES`)과 다른 것이다.** 거기엔 `CONFIRMING`(다른 담당자가 **지금** 집고 있는 것)이
 *    들어 있는데, 그 신청에 [확인] 단추를 그리면 눌러도 집기에서 거절당한다. 「대기로 센다」와 「지금 집을 수 있다」는
 *    뜻이 다르다 — 그래서 묶음을 둘로 둔다.
 * 🔴 **화면과 서버가 이 한 벌을 같이 본다**(`src/lib/stock/requests.ts` 의 `claimRequest`,
 *    `src/app/(app)/entries/page.tsx` 의 단추 그리기). 조각 4c 까지는 화면이 `status === "PENDING"` 만 보고 그려서
 *    일부 나간 신청이 대기 목록에 **보이는데 누를 수 없었다** — 「보이는데 못 누르는 줄」이 생기는 자리다.
 *
 * 🔴 **`IN_APPROVAL`(결재 중)은 여기 넣지 않는다** (2026-10-21, 조각 11e). 넣으면 사람이 누르는 [확인]이
 *    **결재가 도는 중인 신청에서 그대로 재고를 뺀다.** 지금 그 길에 달린 문은 「절차가 쓰이고 있는가」
 *    하나뿐이라(`confirmRequestAction` → `isPartIssueApprovalRouteInForce`), 관리자가 결재선을 끄는 순간
 *    살아 있는 결재건이 있는 신청에도 문이 열린다 — 그러면 결재를 받던 부품이 한 번, 나중에 [실행]으로 또
 *    한 번 나간다. **상태를 여기서 빼 두면 그 틈이 상태 자체로 막힌다.**
 *    🔵 그래서 **결재를 다 받은 건을 실행하는 길은 묶음이 다르다** — 아래 `EXECUTABLE_REQUEST_STATUSES`.
 * 🔵 이 묶음은 **[보류]가 걸리는 묶음이기도 하다**(`holdRequest`) — 그래서 결재 중인 신청은 보류도 저절로 막힌다.
 */
export const CLAIMABLE_REQUEST_STATUSES = ["PENDING", "PARTIAL"] as const satisfies readonly RequestStatus[];
export type ClaimableRequestStatus = (typeof CLAIMABLE_REQUEST_STATUSES)[number];

/** 🔵 좁히는 검사다 — 화면이 단추 묶음에 넘기는 상태가 **둘 중 하나임을 타입이 보증**한다(그래서 거기서 「반려냐 마감이냐」를 가를 수 있다). */
export function isClaimableRequest(status: RequestStatus): status is ClaimableRequestStatus {
  return (CLAIMABLE_REQUEST_STATUSES as readonly RequestStatus[]).includes(status);
}

/**
 * **결재를 다 받은 건을 실행할 때** 집을 수 있는 상태 (2026-10-21, 조각 11e).
 *
 * 🔴 **위 `CLAIMABLE_REQUEST_STATUSES` 보다 넓다.** 결재를 올리면 신청이 `IN_APPROVAL` 로 가는데,
 *    실행은 `confirmRequest` 를 거쳐 원장을 쓰므로 그 상태를 **집을 수 있어야 한다.** 여기를 안 넓히면
 *    **결재를 다 받고도 [실행]이 「이미 처리된 신청」으로 거절당한다.**
 * 🔴 **그런데 `PENDING`·`PARTIAL` 도 그대로 들어 있다.** 이 조각이 나가기 **전에** 올라간 결재건은 신청이
 *    아직 `PENDING`(또는 `PARTIAL`)인 채로 살아 있다 — `IN_APPROVAL` 하나만 집게 하면 **그 건들이 결재를
 *    다 받고도 영영 실행되지 않는다.** 넓혀 두어도 새는 곳이 없다: 이 묶음을 쓰는 길은 결재건이 `APPROVED`
 *    일 때만 열리고(`checkCanExecutePartIssue`), 한 신청에 살아 있는 결재건은 하나뿐이다(부분 유니크 색인).
 * 🔵 **두 묶음을 가르는 자리는 `confirmRequest` 의 매개변수 하나**다(`ConfirmOptions.via`) — 사람이 누르는
 *    [확인]과 결재 실행이 **같은 함수**를 부르기 때문이다. 문을 그 함수 안에 달면 실행까지 막힌다는 것은
 *    `src/lib/approval/part-issue-gate.ts` 머리말에 적힌 그대로이고, 여기서는 **막는 대신 묶음을 가른다.**
 * 🔵 **차례에 뜻이 있다.** `claimRequest` 는 되돌릴 자리를 알아야 해서 상태마다 한 번씩 집어 보는데
 *    (그 함수 주석), 실행하는 길에서 거의 언제나 맞는 것은 `IN_APPROVAL` 이라 **맨 앞**에 둔다.
 */
export const EXECUTABLE_REQUEST_STATUSES = ["IN_APPROVAL", ...CLAIMABLE_REQUEST_STATUSES] as const satisfies readonly RequestStatus[];

/**
 * **[반려]가 받는 상태** — 아직 아무것도 안 나간 것뿐이다 (2026-10-14 부터의 규칙을 2026-10-21 에 묶음으로 뽑았다).
 *
 * 🔵 값은 `rejectRequest` 가 처음부터 WHERE 에 걸던 `PENDING` 그대로다. **동작이 바뀐 것이 아니라**,
 *    「결재 중(`IN_APPROVAL`)인 신청은 반려되지 않는다」를 시험이 돌려 볼 수 있게 글자로 꺼낸 것이다
 *    (이 저장소에는 DB 시험이 없다 — `src/lib/approval/part-issue-rules.ts` 머리말).
 * 🔴 **마감(`closeRequest`)은 `PARTIAL` 만 받는다** — 반려는 「하나도 안 준다」, 마감은 「준 것은 두고 나머지만
 *    접는다」라 묶음이 겹치지 않는다(아래 `isClosedRequest` 주석).
 */
export const REJECTABLE_REQUEST_STATUSES = ["PENDING"] as const satisfies readonly RequestStatus[];

export function isRejectableRequest(status: RequestStatus): boolean {
  return (REJECTABLE_REQUEST_STATUSES as readonly RequestStatus[]).includes(status);
}

/**
 * **다시 열릴 때 돌아갈 자리** — 이미 나간 것이 있으면 `PARTIAL`, 하나도 없으면 `PENDING`.
 *
 * 🔴 **돌아갈 상태를 칸에 적어 두지 않고 센다.** 적어 두면 그 사이 사정이 달라졌을 때 옛 상태로 되돌아가
 *    실제와 어긋난다 — 나간 수량에서 다시 구하는 편이 언제나 맞다(A/S 쪽 `statusAfterHoldRelease` 의 까닭 그대로).
 * 🔵 **쓰는 자리가 둘이다**: 보류 풀기(`releaseRequestHold`)와 불출 결재 거두기
 *    (`cancelPartIssueApproval` → `requestStatusAfterPartIssue`). 둘 다 「담당자 손으로 돌려놓는다」는 같은 일이라
 *    규칙도 하나여야 한다 — 손으로 두 벌 적으면 한쪽만 `PARTIAL` 을 잊는 날이 온다.
 */
export function reopenedRequestStatus(issuedTotal: number): RequestStatus {
  return issuedTotal > 0 ? "PARTIAL" : "PENDING";
}

/**
 * 신청이 **어디서 올라왔나** → 화면 글자 (2026-10-15, A/S 반출 신청 통로).
 *
 * 🔴 `Record` 로 둔 까닭은 위 `REQUEST_STATUS_LABEL` 과 같다 — 출처를 하나 더하고 여기를 안 고치면 **tsc 가 멈춘다.**
 * 🔵 재고 관리에서 직접 올린 것은 **글자를 비운다**(`""`). 거의 전부가 그것이라, 줄마다 「재고 관리」가 붙으면
 *    눈에 띄어야 할 「A/S」가 묻힌다. 표식은 **다른 데서 온 것에만** 붙인다.
 */
export const REQUEST_SOURCE_LABEL: Record<RequestSource, string> = {
  INVENTORY: "",
  AS: "A/S",
};

/**
 * 신청한 사람이 **거둘 수 있는 출처** — 재고 관리에서 직접 올린 것뿐이다 (2026-10-15).
 *
 * 🔴 **A/S 에서 올라온 신청은 재고 관리에서 취소되지 않는다.** 저쪽에 「이 부품 내 달라」가 열린 채 남아 있는데
 *    이쪽에서 접으면, A/S 는 영영 답을 못 받고 사람은 기다린다. 거두는 것은 **낸 쪽(A/S)의 몫**이다.
 * 🔴 **화면과 서버가 이 한 벌을 같이 본다** — 아래 `canCancelRequest`(화면이 단추를 그릴지)와
 *    `src/lib/stock/requests.ts` 의 `cancelRequest`(실제로 막는 WHERE). 손으로 두 벌 적으면 언젠가 갈린다.
 */
export const CANCELLABLE_REQUEST_SOURCES = ["INVENTORY"] as const satisfies readonly RequestSource[];

/**
 * **바깥 통로로** 거둘 수 있는 출처 — A/S 에서 올라온 것뿐이다
 * (2026-10-16, `POST /api/v1/stock-requests/cancel`. API.md 4-9절).
 *
 * 🔴 **위 `CANCELLABLE_REQUEST_SOURCES` 와 짝이고, 겹치지 않는다.** 거두는 문은 하나뿐이고 **낸 쪽에만**
 *    열린다 — 화면에서 올린 것은 화면에서, A/S 가 올린 것은 A/S 에서. 한 출처가 양쪽에 들어가면 같은
 *    신청을 두 곳에서 접을 수 있게 되고, 그러면 저쪽에 열린 요청이 답을 못 받는 일이 되돌아온다.
 *    🔵 두 묶음이 **빠짐없이 덮는지**를 시험이 본다(`tests/api-stock-request-cancel.test.ts`) — 출처를
 *    하나 더하고 어느 쪽에도 안 넣으면 그 신청은 **아무도 거둘 수 없는 신청**이 된다.
 * 🔴 **화면과 서버가 아니라, 판정과 WHERE 가 이 한 벌을 같이 본다** —
 *    `src/lib/api/stock-request-cancel.ts` 의 `judgeApiCancel`(거절 문구를 고르는 자리)과
 *    `src/lib/stock/requests.ts` 의 `cancelExternalRequest`(실제로 막는 WHERE).
 */
export const EXTERNALLY_CANCELLABLE_REQUEST_SOURCES = ["AS"] as const satisfies readonly RequestSource[];

/**
 * 「내가 거둘 수 있는 신청인가」 — 출처 · 상태 · 본인 셋을 함께 본다 (2026-10-15).
 *
 * 🔵 **울타리가 아니라 단추를 그릴지의 판정이다.** 실제로 막는 자리는 `cancelRequest` 의 WHERE 이고,
 *    거기도 **같은 세 조건**을 건다. 여기를 지워도 쓰기는 안 뚫린다.
 * 🔴 `requestedBy` 가 `null` 이면(= A/S 에서 왔고 재고 관리에 없는 사람) 누구와도 같지 않다 — 지어낸 기본값을
 *    넣지 않는다. SQL 쪽도 `NULL = <내 id>` 가 참이 되지 않아 **저절로** 같은 답을 낸다.
 * 🔵 **결재 중(`IN_APPROVAL`)인 신청도 저절로 막힌다** (2026-10-21) — 아래 한 줄이 `PENDING` 만 받기 때문이다.
 *    신청자가 거두면 결재건은 살아남아 결재자에게 계속 뜨므로(**이미 취소된 요청을 결재하게 된다**) 막는 것이 맞고,
 *    막는 자리를 새로 더하지 않는다. 거두고 싶으면 결재를 올린 담당자가 먼저 결재건을 거둬야 한다(그러면
 *    신청이 `PENDING` 으로 돌아와 이 단추가 다시 선다). A/S 쪽 [요청 취소]도 같은 자리에서 저절로 잠긴다
 *    (저쪽 `CANCELLABLE_STATUS_CODE = "PENDING"`, 그리고 `cancelExternalRequest` 의 WHERE).
 */
export function canCancelRequest(request: { source: RequestSource; status: RequestStatus; requestedBy: string | null }, actorUserId: string): boolean {
  if (!(CANCELLABLE_REQUEST_SOURCES as readonly RequestSource[]).includes(request.source)) return false;
  if (request.status !== "PENDING") return false;
  return request.requestedBy !== null && request.requestedBy === actorUserId;
}

/**
 * 마감된 신청인가 — 「준 것은 그대로 두고 **남은 것만** 접은」 것 (2026-10-14 사용자 결정, 조각 4d).
 *
 * 🔵 **상태를 새로 만들지 않았다.** 마감된 신청은 더 볼 일이 없으므로 기존 `CONFIRMED` 로 닫고(`DECIDED_REQUEST_STATUSES`),
 *    「다 나감」과 「마감」은 **세어서** 가린다 — 회차 표 주석 3번(「남은 수량은 세어서 안다, 요약 칸을 일부러 안 뒀다」)과
 *    같은 방식이다. 상태값을 더하면 enum 마이그레이션이 또 필요하고, 적용 전까지 단추가 깨진다.
 * 🔴 **이력에서 반려와 가르는 것은 상태가 아니라 감사 행위다** — `STOCK_REQUEST_CLOSED`(반출 마감) ≠
 *    `STOCK_REQUEST_REJECTED`(반출 반려). 반려는 「하나도 안 준다」, 마감은 「준 것은 두고 나머지만 접는다」이다.
 * 🔴 **「나간 것이 하나라도 있을 것」을 함께 본다.** 회차 표가 생기기 전(조각 4a 이전)에 확인된 신청은 회차 줄이
 *    하나도 없어 `issued` 가 전부 0 이다 — 그 조건이 없으면 **옛 신청이 전부 마감으로 보인다.**
 *    마감은 `PARTIAL` 에서만 할 수 있고 `PARTIAL` 은 한 줄이라도 나가야 되는 상태라, 이 조건이 그 둘을 가른다.
 */
export function isClosedRequest(status: RequestStatus, lines: readonly { quantity: number; issued: number }[]): boolean {
  if (status !== "CONFIRMED") return false;
  return lines.some((l) => l.issued > 0) && lines.some((l) => l.issued < l.quantity);
}

/**
 * 신청 상태 → 화면 글자 (2026-10-15, 조각 10b. 부품 요청 관리 화면).
 *
 * 🔴 **`Record` 로 둔 까닭**: 상태를 하나 더하고 여기를 안 고치면 **tsc 가 멈춘다.** 화면이 `status` 를 그대로
 *    보이던 때에는 영문 코드가 그냥 새어 나갔고(CLAUDE.md 10절: 코드값을 화면에 내지 않는다) 아무도 못 알아챘다.
 * 🔵 글자는 **기록 내역의 「확인 대기」 구역이 쓰던 것 그대로**다(「처리 중」·「일부 나감」·「반려」·「취소」).
 *    그 구역은 2026-10-15 에 걷어냈지만 글자는 옮겨 왔다 — 쓰는 분이 이미 그 말로 부르고 있어서,
 *    화면이 옮겨 갔다고 낱말까지 바꾸면 같은 것이 다른 것으로 읽힌다. 표는 **한 곳에** 둔다.
 * 🔵 **「결재 중」은 결재건 쪽 글자와 같다**(`PART_ISSUE_STATUS_LABELS.PENDING_APPROVAL`). 신청 줄과 결재건 줄이
 *    같은 순간을 다른 말로 부르면, 두 화면을 오가는 담당자가 서로 다른 일인 줄 안다.
 * 🔵 차례에 뜻을 둔다 — 거르개가 이 표의 **적힌 차례**로 돈다(아래 `REQUEST_STATUS_ORDER`). 그래서
 *    「결재 중」을 스키마의 맨 뒤가 아니라 일이 흘러가는 자리(대기 다음)에 적는다.
 */
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: "대기",
  IN_APPROVAL: "결재 중",
  CONFIRMING: "처리 중",
  PARTIAL: "일부 나감",
  CONFIRMED: "확인됨",
  REJECTED: "반려",
  CANCELLED: "취소",
  ON_HOLD: "보류",
};

/**
 * 거르개가 도는 차례 — 글자 표에서 **뽑아 쓴다**(따로 적으면 상태를 더했을 때 한쪽만 고쳐진다).
 *
 * 🔴 스키마의 `REQUEST_STATUSES` 를 쓰지 않는 까닭 둘: ① 저쪽은 enum 마이그레이션 때문에 **새 값이 맨 뒤에 붙는**
 *    차례라(PARTIAL·ON_HOLD) 사람이 읽을 차례가 아니다. ② 값으로 끌어오면 **클라이언트 묶음에 표 정의(drizzle)가
 *    딸려 온다** — 타입만 쓰면 컴파일할 때 지워진다.
 */
export const REQUEST_STATUS_ORDER: readonly RequestStatus[] = Object.keys(REQUEST_STATUS_LABEL) as RequestStatus[];

/**
 * 상태 배지 색 (2026-10-15, 조각 10b. A/S 쪽 `PartRequestManagerScreen` 의 색을 그대로 옮기고 `dark:` 만 뺐다 —
 * 이 저장소에는 다크 모드가 없다).
 *
 * 🔵 요청 관리는 **「지금 손댈 것이 무엇인가」를 훑는 화면**이라, 처리 대기 중인 것과 이미 끝난 것이 한눈에 갈려야 한다.
 * 🔴 **보류를 대기와 다른 색으로 둔다**(보라 ↔ 주황). 「멈춰 있다」가 한눈에 보여야 하기 때문이다 — 같은 주황이면
 *    지금 처리해야 할 것으로 착각하고 눌러 보게 되는데, 보류 중에는 확인도 반려도 마감도 막혀 있다(requests.ts).
 * 🔵 글자 표와 마찬가지로 **이 표를 보는 자리는 한 곳**이다(부품 요청 관리) — 2026-10-15 에 기록 내역의
 *    「확인 대기」 구역을 걷어내면서 그렇게 됐다. 그래도 색을 화면 파일에 흩지 않는다: 글자와 색은 짝이고,
 *    짝이 갈리면 「마감인데 초록」 같은 줄이 생긴다(아래 `requestStatusBadge`).
 * 🔴 **「결재 중」도 대기와 다른 색이다**(남색 ↔ 주황, 2026-10-21). 보류와 같은 까닭이다 — 결재가 도는 동안
 *    담당자가 그 신청에 할 수 있는 일이 하나도 없는데(확인·반려·마감·보류가 전부 막힌다) 대기와 같은 주황이면
 *    지금 처리해야 할 것으로 보고 눌러 보게 된다. 🔵 **보류(보라)와도 가른다**: 보류는 「사람이 일부러 멈춰 둔
 *    것」이고 결재 중은 「남이 들고 있어 나아가는 중」이라, 담당자가 해야 할 일(풀기 ↔ 기다리기)이 다르다.
 */
export const REQUEST_STATUS_BADGE: Record<RequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  IN_APPROVAL: "bg-indigo-100 text-indigo-800",
  CONFIRMING: "bg-zinc-200 text-zinc-700",
  PARTIAL: "bg-blue-100 text-blue-800",
  CONFIRMED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-zinc-100 text-zinc-500",
  ON_HOLD: "bg-violet-100 text-violet-800",
};

/**
 * 마감된 신청의 글자와 색.
 *
 * 🔴 **마감은 상태값이 아니다** — 상태는 `CONFIRMED` 이고, 가르는 자리는 위 `isClosedRequest` 하나뿐이다(그 주석).
 *    그래서 표에 여덟 번째 칸을 만들지 않고 따로 둔다. 상태를 새로 만들면 enum 마이그레이션이 또 필요하다.
 * 🔵 색은 기록 내역 화면이 쓰던 마감 배지 그대로다(2026-10-14, 조각 4d).
 */
export const CLOSED_REQUEST_LABEL = "마감";
export const CLOSED_REQUEST_BADGE = "bg-amber-100 text-amber-900";

/**
 * **결재가 끝나 [실행]만 남은** 신청의 글자와 색 (2026-10-21, 조각 11f).
 *
 * 🔴 **「실행 대기」도 상태값이 아니다** — 바로 위 「마감」과 **같은 길**이다(그 주석). 상태는 그대로 두고
 *    (보통 `IN_APPROVAL`), 가르는 값은 서버가 이미 내려보내는 잠금 하나뿐이다 —
 *    `src/lib/approval/part-issue-gate.ts` 의 `partIssueLockFor` 가 `AWAITING_EXECUTION` 이라 답한 것.
 *    상태를 새로 만들면 enum 마이그레이션이 또 필요하고, 적용 전까지 단추가 깨진다.
 * 🔵 글자는 그 잠금이 이미 쓰던 말에서 왔다(`PART_ISSUE_LOCK_LABELS.AWAITING_EXECUTION` = 「실행 대기 중」).
 *    배지는 한 낱말 자리라 「중」만 뗐다 — 같은 것을 가리키는 말이 둘로 갈리지 않게 그 이상은 바꾸지 않는다.
 * 🔴 **색이 「결재 중」과 달라야 한다.** 담당자가 할 일이 다르기 때문이다 — 「결재 중」은 결재자를
 *    **기다리는** 것이고, 「실행 대기」는 **사람이 「승인 요청건」에 가서 누르면 되는** 것이다. 같은 색이면
 *    기다릴 것으로 보고 지나친다.
 * 🔵 청록을 고른 까닭: 위 여덟 색(주황·남색·회색 둘·파랑·초록·빨강·보라)과 마감의 주황, 어느 것과도
 *    겹치지 않는 남은 계열이다. 초록(확인됨)과 가까워 보이지만 색조가 갈려 「끝났다」로 읽히지 않는다.
 *    🔴 그 「겹치지 않음」은 눈이 아니라 **시험이 전수로** 지킨다(`tests/stock-requests.test.ts`).
 */
export const AWAITING_EXECUTION_REQUEST_LABEL = "실행 대기";
export const AWAITING_EXECUTION_REQUEST_BADGE = "bg-teal-100 text-teal-800";

/**
 * 「결재가 끝나 실행만 남았나」 — 서버가 내려보낸 잠금 하나로 가린다.
 *
 * 🔵 **아무도 다시 세지 않는다.** 잠금을 만드는 자리는 `partIssueLockFor` 하나이고, 화면도 바깥 통로도
 *    그 값을 받아 여기로 넘기기만 한다. 글자 고르기와 거르기가 **같은 이 한 줄**을 보게 두는 것이
 *    「목록의 글자」와 「거르개가 고르는 것」이 갈리지 않게 하는 자리다.
 */
function awaitsExecution(lock: PartIssueLock | null): boolean {
  return lock === "AWAITING_EXECUTION";
}

/**
 * 지금 이 신청을 **뭐라고 부르고 무슨 색으로 그릴까** — 글자와 색을 **한 번에** 고른다.
 *
 * 🔴 **따로 고르지 않는 까닭**: 「실행 대기인데 남색」 같은 짝이 생긴다(위 `REQUEST_STATUS_BADGE` 주석의
 *    경고 그대로). 아래 두 함수는 **반드시** 이 한 곳을 지나간다.
 * 🔴 **차례를 글자로 못 박는다 — ① 마감 ② 실행 대기 ③ 상태 표.** 마감된 신청에 살아 있는 결재건이
 *    남아 있을 수는 없지만(실행하면 결재건이 닫힌다), 차례를 적어 두지 않으면 그런 줄이 하나라도 생기는
 *    날 **같은 신청이 화면마다 다른 이름으로 불린다.** 적어 두면 그때도 답이 하나다.
 */
function requestStatusDisplay(status: RequestStatus, closed: boolean, lock: PartIssueLock | null): { label: string; badge: string } {
  if (closed) return { label: CLOSED_REQUEST_LABEL, badge: CLOSED_REQUEST_BADGE };
  if (awaitsExecution(lock)) return { label: AWAITING_EXECUTION_REQUEST_LABEL, badge: AWAITING_EXECUTION_REQUEST_BADGE };
  return { label: REQUEST_STATUS_LABEL[status], badge: REQUEST_STATUS_BADGE[status] };
}

/**
 * 화면에 보일 글자 — 마감된 신청은 「확인됨」이 아니라 「마감」이고, 결재가 끝나 실행만 남은 신청은
 * 「결재 중」이 아니라 「실행 대기」다.
 *
 * @param closed `isClosedRequest` 가 센 값.
 * @param lock 그 신청을 붙들고 있는 결재건의 잠금. 결재가 걸려 있지 않으면 `null`.
 *   🔴 **기본값을 두지 않는다.** 두면 부르는 자리가 늘 때 아무 말 없이 「잠금 없음」으로 굳어
 *   한 화면만 옛 글자를 보여 준다 — 오류가 아니라 **빠짐**이라 아무도 신고하지 않는다.
 *   잠금이 없는 자리는 `null` 이라고 **적어서** 말한다.
 */
export function requestStatusLabel(status: RequestStatus, closed: boolean, lock: PartIssueLock | null): string {
  return requestStatusDisplay(status, closed, lock).label;
}

/** 위와 짝이 되는 배지 색. 🔴 **같은 한 곳**에서 고른다 — 따로 고르면 「마감인데 초록」 같은 짝이 생긴다. */
export function requestStatusBadge(status: RequestStatus, closed: boolean, lock: PartIssueLock | null): string {
  return requestStatusDisplay(status, closed, lock).badge;
}

/* ------------------------------------------------------------------ */
/* 신청 줄에 서는 사유 상자 둘 — 보류 사유 · 결정 사유 (2026-10-21)       */
/* ------------------------------------------------------------------ */

/**
 * 사유 상자의 색 한 벌 — 상자 바탕 · 본문 · 아랫줄(누가·언제).
 *
 * 🔵 셋을 **한 덩이**로 두는 까닭: 바탕만 바꾸고 글자색을 두고 오면 연한 바탕에 연한 글자가 남는다.
 *    배지가 바탕·글자를 한 글자로 묶어 두는 것(`REQUEST_STATUS_BADGE`)과 같은 까닭이고, 여기는 줄이
 *    둘이라 묶음이 셋이 됐을 뿐이다.
 */
export interface ReasonBoxTone {
  box: string;
  body: string;
  meta: string;
}

/**
 * 보류 사유 상자의 색 (2026-10-15 조각 10a 에 화면 파일이 들고 있던 것을 2026-10-21 에 여기로 옮겼다 —
 * **보이는 모양은 한 픽셀도 바뀌지 않았다**).
 *
 * 🔴 옮긴 까닭은 바로 아래 결정 사유 상자가 **이 색과 달라야** 하기 때문이다. 색이 화면 파일에 흩어져
 *    있으면 「다르다」를 시험이 재지 못하고 눈으로만 재게 되는데, 이 저장소에는 화면 렌더 시험이 없다.
 * 🔵 보라를 쓰는 까닭은 상태 배지의 보류와 같다(`REQUEST_STATUS_BADGE` 주석): 「사람이 일부러 멈춰 둔 것」이고
 *    담당자가 **풀어 줘야** 나아간다.
 */
export const HOLD_REASON_TONE: ReasonBoxTone = { box: "bg-violet-50", body: "text-violet-900", meta: "text-violet-700" };

/**
 * 결정 사유 상자의 색 (2026-10-21).
 *
 * 🔴 **보류(보라)와 달라야 한다.** 보류는 「멈춰 있다 — 담당자가 풀면 다시 간다」이고 결정은 「끝났다 —
 *    더 손댈 것이 없다」라서, 담당자가 그 줄에 해야 할 일이 정반대다. 같은 색이면 멈춘 줄을 찾으려고
 *    훑을 때 끝난 줄이 함께 걸린다.
 * 🔵 **중립색(zinc)을 고른 까닭 셋.** ① 이 저장소의 중립색이 zinc 다(CLAUDE.md 9-3절: 「중립색은 zinc 를
 *    쓴다 — 사내 다수파」). ② **색조가 없는 것이 뜻에 맞는다**: 이 상자는 반려(나쁜 소식)와 마감(정상적인
 *    마무리)을 **둘 다** 담는다. 빨강을 고르면 마감이 사고처럼 보이고, 주황을 고르면 반려가 아직 할 일처럼
 *    보인다. 색조가 있는 상자는 「네가 뭔가 해야 한다」로 읽히는데 여기는 할 일이 없다. ③ A/S 쪽에서 **같은
 *    자료를 그리는 짝**(`PartRequestSection` 의 결정 구역)도 중립색이다 — 두 화면이 같은 것을 다른 색으로
 *    그리면 오가는 사람이 다른 것인 줄 안다.
 * 🔴 **바탕을 100 으로 둔다(50 이 아니다).** A/S 쪽 짝은 50 인데, 거기는 흰 카드 위에 서고 여기는 **표의 줄**
 *    위에 선다. 이 표의 줄은 `hover` 에 zinc-50 으로 바뀌므로(`RequestManagerScreen` 의 `tr`), 50 으로 두면
 *    **마우스를 얹는 순간 상자가 사라진다.**
 */
export const DECISION_NOTE_TONE: ReasonBoxTone = { box: "bg-zinc-100", body: "text-zinc-800", meta: "text-zinc-600" };

/**
 * 결정 사유 상자에 그릴 것 — **그릴지 말지**와 **글자·색**을 한 곳에서 고른다.
 *
 * 🔴 **사유가 비면 `null` 이다 — 빈 상자를 그리지 않는다.** A/S 쪽 짝이 같은 규칙이고
 *    (`PartRequestSection`: 사유가 있을 때만 그린다), **두 화면이 같은 규칙을 써야** 오가는 사람이
 *    「저쪽엔 있는데 여기엔 왜 없지」로 헷갈리지 않는다.
 * 🔴 **「취소」에는 사유라는 개념이 아예 없다.** 거두는 함수(`cancelRequest`·`cancelExternalRequest`,
 *    `./requests`)가 사유를 **받지 않는다** — 누가·언제만 적고 `decision_note` 는 빈 글자 그대로다.
 *    그래서 취소된 신청에는 이 상자가 안 선다. 🔵 다음 사람이 「취소 사유가 왜 안 보이지」로 헤매지 않게
 *    적어 둔다: 안 보이는 것이 아니라 **처음부터 없다**. 보이게 하려면 거두는 쪽에서 사유를 받아야 한다.
 * 🔵 사유가 적히는 자리는 둘뿐이다 — **반려**(`rejectRequest`)와 **마감**(`closeRequest`). 확인됨은
 *    사유를 받지 않으므로 저절로 안 그려지고, 결재에서 반려된 건은 그 반려 사유가 신청의 이 칸으로
 *    복사돼 온다(`lib/approval/part-issue-rules.ts`).
 * 🔴 **글자는 셋으로 갈린다.** 상자 위에 선 상태 배지가 「마감」인데 상자가 「반려 사유」라고 하면 같은 줄이
 *    두 말을 한다. 가르는 차례는 상태 배지와 **같다 — ① 마감 ② 반려 ③ 그 밖**(`requestStatusDisplay`).
 *    🔵 ③은 지금 도달하지 않는다(사유가 적히는 자리가 둘뿐이라). 그래도 두는 까닭은 「반려」로 뭉개면
 *       나중에 사유를 적는 자리가 하나 더 생겼을 때 **그 줄이 반려라고 거짓말을 하기** 때문이다.
 */
export const DECISION_NOTE_LABEL_CLOSED = "마감 사유";
export const DECISION_NOTE_LABEL_REJECTED = "반려 사유";
export const DECISION_NOTE_LABEL_OTHER = "결정 사유";

export interface RequestDecisionNoteView {
  label: string;
  tone: ReasonBoxTone;
  note: string;
  /** 결정한 사람. 🔴 옛 줄은 비어 있을 수 있어 `null` 을 빈 글자로 눕힌다 — 화면이 「null」을 찍지 않게. */
  byName: string;
  /** 결정한 때. 없으면 `null` 이고, 그때 화면은 **아랫줄에서 시각만 뺀다**(상자는 그대로 선다). */
  at: string | null;
}

export function requestDecisionNote(request: {
  status: RequestStatus;
  closed: boolean;
  decisionNote: string;
  decidedByName: string | null;
  decidedAt: string | null;
}): RequestDecisionNoteView | null {
  const note = request.decisionNote.trim();
  if (note === "") return null;
  const label = request.closed ? DECISION_NOTE_LABEL_CLOSED : request.status === "REJECTED" ? DECISION_NOTE_LABEL_REJECTED : DECISION_NOTE_LABEL_OTHER;
  return { label, tone: DECISION_NOTE_TONE, note, byName: request.decidedByName ?? "", at: request.decidedAt };
}

/* ------------------------------------------------------------------ */
/* 상태 거르개 — 상태 여덟에 「실행 대기」가 하나 더 선다 (2026-10-21)     */
/* ------------------------------------------------------------------ */

/**
 * 거르개의 「실행 대기」 칸이 쓰는 값.
 *
 * 🔵 **잠금의 글자를 그대로 쓴다**(`PartIssueLock` 의 `AWAITING_EXECUTION`). 거르는 조건이 곧 그 잠금이라,
 *    글자를 새로 지으면 둘을 맞춰 보는 사람이 같은 것인지 알 수 없다.
 * 🔴 상태 이름(`RequestStatus`)과 **겹치지 않는 글자여야 한다** — 겹치면 거르개 값 하나가 두 뜻이 된다.
 */
export const AWAITING_EXECUTION_FILTER = "AWAITING_EXECUTION";

/** 거르개가 고를 수 있는 값 — 「전체 상태」 · 상태 여덟 · 「실행 대기」. */
export type RequestStatusFilter = "ALL" | RequestStatus | typeof AWAITING_EXECUTION_FILTER;

/**
 * 거르개가 도는 차례 — 🔴 **상태 차례(`REQUEST_STATUS_ORDER`)에서 뽑아 쓴다.** 따로 적으면 상태를 하나
 * 더했을 때 한쪽만 고쳐진다.
 *
 * 🔵 「실행 대기」를 **「결재 중」 바로 뒤**에 끼운다 — 일이 흘러가는 차례가 그렇고(결재가 끝나면 실행이다),
 *    서로 갈라야 하는 둘이 나란히 서야 사람이 「이 둘이 다르구나」를 고르개에서 바로 본다.
 */
export const REQUEST_STATUS_FILTER_ORDER: readonly Exclude<RequestStatusFilter, "ALL">[] = REQUEST_STATUS_ORDER.flatMap((s) =>
  s === "IN_APPROVAL" ? [s, AWAITING_EXECUTION_FILTER] : [s],
);

/**
 * 고르개에 보일 글자 — 🔴 **[상태] 칸의 글자와 같은 한 벌에서 온다.** 다르면 사람은 고른 것과 보이는 것이
 * 같은 것인 줄 모른다.
 */
export function requestStatusFilterLabel(filter: Exclude<RequestStatusFilter, "ALL">): string {
  return filter === AWAITING_EXECUTION_FILTER ? AWAITING_EXECUTION_REQUEST_LABEL : REQUEST_STATUS_LABEL[filter];
}

/**
 * 그 줄이 지금 거르개에 걸리나 — **순수 함수**다.
 *
 * 🔴 **「결재 중」으로 걸렀을 때 실행 대기 줄이 섞이면 안 된다.** 둘은 상태가 같고(`IN_APPROVAL`) 잠금만
 *    다른 경우가 보통이라, 상태만 보고 거르면 한 쪽을 고를 길이 아예 없다. 그래서 **실행을 기다리는 줄은
 *    상태 쪽 칸에서 빼고**(아래 `!awaiting`), 「실행 대기」 칸에서만 나오게 한다 — 목록의 글자가
 *    「실행 대기」인 줄은 고르개에서도 「실행 대기」다.
 * 🔵 **화면에 손으로 적지 않고 여기 두는 까닭**: 이 저장소에는 화면 렌더 시험이 없다. 화면 안에 적은
 *    조건은 아무도 돌려 보지 못한 채 운영으로 나간다(`src/lib/approval/part-issue-screen.ts` 머리말과
 *    같은 까닭이고, 같은 처방이다).
 * 🔵 **`codes.ts` 에 둔 까닭**: 가르는 데 필요한 글자(상태 표·「실행 대기」)가 전부 이 파일에 있다.
 *    잠금 쪽(`part-issue-gate.ts`)에 두면 **거기서 상태 표를 되가져가야** 하고, 그러면 글자와 거르기가
 *    두 파일에 나뉜다.
 */
export function requestMatchesStatusFilter(filter: RequestStatusFilter, row: { status: RequestStatus; issueLock: PartIssueLock | null }): boolean {
  if (filter === "ALL") return true;
  const awaiting = awaitsExecution(row.issueLock);
  if (filter === AWAITING_EXECUTION_FILTER) return awaiting;
  return !awaiting && row.status === filter;
}

export const PURPOSE_LABEL: Record<Purpose, string> = {
  REPAIR: "수리",
  FIELD: "필드",
  OTHER: "기타",
};

export const CHARGE_LABEL: Record<ChargeType, string> = {
  PAID: "유상",
  FREE: "무상",
};

export const SHEET_LABEL: Record<Sheet, string> = {
  USE: "사용처 기입란",
  RECEIVE: "입고 기입란",
  CHANGE: "수량 변경 기록",
};

/** 종류 → 엑셀 시트. 사용은 사용처 기입란, 입고는 입고 기입란, 나머지는 새 시트 「수량 변경 기록」 (DESIGN 6-2절). */
export function sheetOf(type: EntryType): Sheet {
  if (type === "USE") return "USE";
  if (type === "RECEIVE") return "RECEIVE";
  return "CHANGE";
}

/** 그 종류에서 수량이 늘어나나(+) 줄어드나(−). ADJUST·CORRECTION 은 어느 쪽이든. TRANSFER 는 두 줄(−, +). */
export function signOf(type: EntryType): 1 | -1 | 0 {
  switch (type) {
    case "RECEIVE":
    case "RETURN":
    case "OPENING":
      return 1;
    case "USE":
    case "DISPOSE":
    case "LOAN":
      return -1;
    default:
      return 0;
  }
}

export function isEntryType(v: unknown): v is EntryType {
  return typeof v === "string" && (ENTRY_TYPES as readonly string[]).includes(v);
}
export function isRecordableType(v: unknown): v is RecordableType {
  return typeof v === "string" && (RECORDABLE_TYPES as readonly string[]).includes(v);
}
export function isPurpose(v: unknown): v is Purpose {
  return typeof v === "string" && (PURPOSES as readonly string[]).includes(v);
}
export function isChargeType(v: unknown): v is ChargeType {
  return typeof v === "string" && (CHARGE_TYPES as readonly string[]).includes(v);
}

/**
 * 기록 번호 글자. 시트별 영문 두 글자 + 연도 + 순번 → "US-2026-84".
 * 🔴 "2026-84" 만으로는 견적서 번호와 겹쳐 보인다(2026-10-06 사용자 지적). 앞 두 글자는 **시트**를 뜻한다
 * (순번도 시트별로 따로 세므로): US 사용처 기입란 · RC 입고 기입란 · CH 수량 변경 기록. 바꾸려면 여기 한 곳.
 */
export const SHEET_PREFIX: Record<Sheet, string> = { USE: "US", RECEIVE: "RC", CHANGE: "CH" };
export function sheetNoText(type: EntryType, year: number, no: number): string {
  return `${SHEET_PREFIX[sheetOf(type)]}-${year}-${no}`;
}

/** 인수번호 모양: D + 숫자 6자리 (DESIGN 7절) */
export const INTAKE_NUMBER_RE = /^D\d{6}$/;

/** 증감 표시: +3 / −2 (마이너스는 U+2212 로 눈에 잘 띄게) */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta.toLocaleString("ko-KR")}` : `−${Math.abs(delta).toLocaleString("ko-KR")}`;
}

/** 오늘 (Asia/Seoul, YYYY-MM-DD). 운영 서버가 UTC 라 꼭 시간대를 박는다 (CLAUDE.md 10절). */
export function todaySeoul(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export { ENTRY_TYPES, PURPOSES, CHARGE_TYPES };
export type { EntryType, Purpose, ChargeType, Sheet };
