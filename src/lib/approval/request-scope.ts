import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { stockRequests } from "@/db/schema/stock-requests";
import { approvalRouteScopeForWorkflowKind, isApprovalExemptRequestType, type ApprovalRouteScope } from "./route";

/**
 * ============================================================================
 * 🔴 「이 신청은 어느 절차를 타는가」 — 서버가 묻는 **한 자리** (2026-10-22)
 * ============================================================================
 * 신청에 적힌 **수리 건의 종류**(`stock_requests.workflow_kind`)를 읽어 순수 함수
 * (`approvalRouteScopeForWorkflowKind`)에 넘긴다. 하는 일은 그 둘뿐이다.
 *
 * ── 🔴 왜 함수 하나로 묶었나 ────────────────────────────────────────────
 * 같은 질문을 서버에서 두 자리가 한다:
 *  · 결재를 **올리는** 자리 — `./part-issue.ts` 의 `requestPartIssueApproval`
 *  · 담당자가 [확인]을 **바로 누르는** 길의 문 — `src/app/actions/stock.ts` 의 `confirmRequestAction`
 *
 * 🔴 **둘이 다른 용도를 보면 결재가 조용히 우회된다.** 실제로 그 구멍이 이렇게 생긴다:
 *    관리자가 **매쳐 절차만** 짜 두고 기존 「부품 불출」은 비워 둔다 → 올리는 자리는 매쳐 절차를
 *    요구하는데, [확인] 게이트가 「부품 불출이 비었으니 절차 없음」으로 읽고 **결재 없이 그 자리에서
 *    부품을 내준다.** 오류가 한 번도 나지 않아 아무도 신고하지 않는 종류의 결함이다.
 * 🔵 화면(`src/app/(app)/requests/page.tsx`)은 이 함수를 쓰지 않는다 — 신청을 **이미 묶음으로 읽어**
 *    두었으므로 줄마다 여기로 다시 물으면 질의가 신청 수만큼 는다. 대신 **같은 순수 함수**를 직접
 *    부른다. 세 자리가 한 짝표를 본다는 사실은 그래서 시험이 소스로 잰다(`tests/approval-route.test.ts`).
 *
 * ── 🔵 「없는 신청」도 기존 절차로 답한다 ───────────────────────────────
 * 줄이 없으면 「모름」과 같이 다룬다. 여기서 던지거나 가려내지 않는 까닭은, 부르는 두 자리가 바로
 * 뒤에서 **제 트랜잭션 안에서** 그 신청을 다시 읽고 「없는 신청입니다」라고 **더 정확히** 말하기
 * 때문이다. 여기서 먼저 가로채면 같은 말을 두 곳이 하게 되고, 그 둘은 언젠가 갈린다.
 *
 * 🔴 **번호가 uuid 모양인지는 보지 않는다.** 모양이 틀리면 이 질의가 터지고, 부르는 두 자리가
 *    **이미 `try` 로 감싸** 「잠시 뒤 다시 시도하십시오」로 답한다 — 재고는 한 개도 움직이지 않는다.
 *    여기에 정규식을 또 적으면 이 저장소에 uuid 검사가 세 벌이 된다(`src/lib/stock/form.ts`).
 *
 * ── 🔴 **`null` = 「이 신청은 결재를 타지 않는다」** (2026-11-26) ────────
 * 반환 신청이 그렇다(쓰는 분: 「반환에는 승인 절차가 필요 없어」). 가르는 규칙은 순수 함수
 * 하나이고(`./route.ts` 의 `isApprovalExemptRequestType`), 여기서는 **종류 칸을 한 칸 더 읽어**
 * 넘길 뿐이다.
 * 🔴 **「모름」(`workflow_kind` 가 비어 기존 「부품 불출」로 가는 것)과 전혀 다른 값이다** —
 *    저쪽은 「절차는 타는데 어느 것인지 가릴 재료가 없다」이고 이쪽은 「절차 자체를 안 탄다」다.
 *    그래서 기본 용도로 떨어뜨리지 않고 `null` 로 가른다: 기존 「부품 불출」에 결재선이 서 있으면
 *    (2026-11-26 개발 DB 실측 3단계) 떨어뜨리는 순간 반환이 조용히 결재 대상이 된다.
 * 🔴 **없는 신청은 여전히 「모름」이다**(`null` 이 아니다) — 그 갈래의 뜻을 지키려고 종류도
 *    기본값(`"USE"`)으로 떨어뜨린다. 없는 신청이 면제로 새면, 지워진 번호를 들고 두드렸을 때
 *    문이 열린 것처럼 보인다. 🔵 바로 뒤에서 부르는 두 자리가 제 트랜잭션 안에서 「없는 신청입니다」로
 *    더 정확히 말한다(위 머리말).
 * ============================================================================
 */
export async function getApprovalRouteScopeForRequest(requestId: string): Promise<ApprovalRouteScope | null> {
  // 🔴 **쓸 칸만 읽는다** — 신청 표에 칸이 늘어도 이 자리는 흔들리지 않는다.
  const [row] = await db().select({ type: stockRequests.type, workflowKind: stockRequests.workflowKind }).from(stockRequests).where(eq(stockRequests.id, requestId));
  if (isApprovalExemptRequestType(row?.type ?? "USE")) return null;
  return approvalRouteScopeForWorkflowKind(row?.workflowKind ?? null);
}
