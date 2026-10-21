"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelPartIssueApproval, decidePartIssueApproval, executePartIssueApproval, rejectExecutionPartIssueApproval, requestPartIssueApproval } from "@/lib/approval/part-issue";
import { PART_ISSUE_ROUTE_GONE_MESSAGE } from "@/lib/approval/part-issue-gate";
import { requireRole, requireSession } from "@/lib/auth/session";
import { parseIssueQuantities } from "@/lib/stock/issue";
import { RETURN_TO_FIELD, safeReturnTo } from "@/lib/stock/return-to";

/**
 * ============================================================================
 * 부품 불출 결재 — 서버 액션 다섯 (2026-10-15, 조각 11b · 11c · 2026-10-21 실행 대기 반려)
 * ============================================================================
 * 모양은 `./stock.ts` 그대로다: 세션 → 값 꺼내기 → try/catch → `revalidatePath` → `redirect`.
 * 실패하면 **redirect 하지 않고** 상태로 돌려주어 그 카드 자리에 문구가 뜬다.
 *
 * ── 🔴 누가 누를 수 있나 ────────────────────────────────────────────────
 * **올리기·실행·실행 대기 반려가 관리자**(`requireRole("ADMIN", …)`)다 — 올리기는 지금 [확인]을
 * 대신하는 자리라 **[확인]과 같은 역할**이어야 하고(11c), 실행은 실제로 재고가 나가는 유일한
 * 단추이며, **실행 대기 반려는 그 실행을 멈추는 단추라 같은 문턱이어야 한다**(한쪽만 열면
 * 「내보낼 수는 있는데 멈출 수는 없는」 사람이 생긴다).
 * 승인·반려·거두기는 **로그인한 사람이면 통과시키고**, 실제 자격은 **서버 함수가 본다**:
 *  · 승인·반려 → 단계 줄을 `(결재건, REQUESTED, 결재자 = 내 포털 번호)` 로 집는다. 내 차례가
 *    아니면 0행이고 「지금 결재할 차례가 아닙니다」가 돌아온다.
 *  · 거두기 → `checkCanCancelPartIssue` + WHERE 에 `requested_by = 나` 와 상태를 함께 건다.
 * 🔴 여기서 역할로 막지 **않는** 까닭: **결재자는 역할과 무관하게 누구나 될 수 있다.** 관리자만
 *    통과시키면 결재선에 든 보기 권한자가 자기 차례를 영영 못 누른다.
 * 🔵 화면이 단추를 가리는 것(`canCancel` 따위)은 **편의일 뿐**이다 — 눌러도 거절당할 단추를 안
 *    내미는 것이고, 막는 울타리는 위에 적은 서버 쪽 WHERE 다.
 *
 * ── 🔴 실패 문구를 뭉개지 않는다 ────────────────────────────────────────
 * 서버가 돌려주는 문구를 **그대로** 사람에게 보인다. 「처리할 수 없습니다」로 접으면 절차를
 * 만들어야 하는지, 입고를 기다려야 하는지, 화면을 새로 고쳐야 하는지 알 수 없다(A/S 원본
 * `PartIssueApprovalScreen` 머리말의 까닭). 우리가 글을 지어내는 자리는 **예외로 터졌을 때**
 * 하나뿐이고, 그때도 영어 예외를 그대로 보여 주지 않는다(CLAUDE.md 10절).
 * ============================================================================
 */

export interface PartIssueActionState {
  /** 실패 사유 — **서버 문구 그대로**. 성공하면 redirect 하므로 이 자리는 비어 있다. */
  error: string | null;
}

const APPROVALS = "/approvals";

/** 사유·한마디 다듬기 — 줄바꿈과 겹친 공백을 한 칸으로(이 저장소의 다른 액션과 같은 잣대). */
function cleanNote(raw: FormDataEntryValue | null): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/**
 * 올리기 — 부품 요청 관리(`/requests`)의 **[불출 신청]** 이 부른다 (2026-10-15, 조각 11c).
 *
 * ── 🔴 왜 `./stock.ts` 가 아니라 여기인가 ──────────────────────────────
 * `./stock.ts` 는 **원장으로 가는 길**이다(확인·마감·반려·보류·취소 — 전부 `src/lib/stock/` 을
 * 부른다). 이 액션은 **원장에 한 글자도 쓰지 않는다**: 결재건을 하나 만들 뿐이고, 부르는 함수도
 * 실패 코드도(`NO_ROUTE`·`ROUTE_MISSING_SUB`·`ALREADY_OPEN`) 전부 결재 쪽 말이다. 결재 쪽 말을
 * `./stock.ts` 에 섞으면 그 파일을 읽는 사람이 **[확인]이 결재를 거치는지 아닌지**를 한눈에 알
 * 수 없게 된다 — 지금은 그 파일에 문이 한 줄 있고(`confirmRequestAction`), 길은 여기 있다.
 *
 * ── 🔴 돌아갈 자리는 **누른 자리**다 ───────────────────────────────────
 * 이 단추는 `/requests` 에 붙어 있고, 거기서 누른 사람을 `/approvals` 로 끌고 가면 보던 목록과
 * 걸러 둔 상태를 잃는다. 🔵 그래서 [확인]과 **같은 관례**로 돌아간다 — 화면이 실은 자리를
 * `safeReturnTo` 로 거르고(열린 리다이렉트 울타리, `src/lib/stock/return-to.ts`) 거기에 꼬리표를
 * 붙인다. 「어디로 가면 보이는지」는 돌아간 화면의 한 줄이 말해 준다.
 *
 * ── 🔴 실패 문구를 그대로 보인다. 딱 하나만 갈아 끼운다 ────────────────
 * `NO_ROUTE` 는 **오류가 아니다** — 「그 사이 절차가 꺼졌다」는 뜻이라, 서버가 주는 「절차가
 * 없습니다 …」를 그대로 보이면 사람은 무엇을 해야 할지 모른다. 지금 할 수 있는 일
 * (화면을 새로 고치면 [확인]으로 돌아온다)을 말해 주는 문구로 바꾼다. 나머지 셋은 **그대로**다.
 */
export async function requestPartIssueAction(_prev: PartIssueActionState, formData: FormData): Promise<PartIssueActionState> {
  // 🔴 [확인]과 **같은 역할**이다 — 이 단추가 [확인]을 대신하므로 문턱이 달라지면 안 된다.
  const session = await requireRole("ADMIN", "/requests");
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return { error: "신청이 정해지지 않았습니다." };

  /**
   * 🔴 줄별 수량은 **반드시 와야 한다.** [확인]은 칸을 다 비우면 「남은 수량 전부」로 읽지만
   *    (`confirmRequestAction`), 결재는 **무엇을 얼마나 내보내겠다는 약속**이라 그 약속이
   *    비어 있으면 결재자가 승인할 대상이 없다. 화면도 빈 칸을 남은 수량으로 채워 보낸다.
   * 🔵 값의 많고 적음은 여기서 보지 않는다 — 그 규칙은 실행 순간 `buildIssueInput` 하나가
   *    쥐고 있고, 올릴 때와 실행할 때 사이에 이미 나간 수량이 달라져 있을 수 있다.
   */
  const parsed = parseIssueQuantities(formData.get("quantities"));
  if (!parsed.ok) return { error: parsed.message };
  if (parsed.quantities === null) return { error: "이번에 내줄 수량을 줄마다 적으십시오." };

  /**
   * 🔵 **사유는 선택이다**(2026-10-15 쓰는 분 결정). 비어 있으면 빈 글자가 그대로 간다 —
   *    DB 칸이 `text NOT NULL DEFAULT ''` 라 받아 주고(실측), 결재 화면은 비면 그 줄을 그리지
   *    않는다. 🔴 화면 쪽 `required`·`minLength` 도 **같이** 풀었다(`RequestActions.tsx`) —
   *    한쪽만 풀면 눌러도 거절당하거나 아예 못 누른다.
   * 🔴 [반려] 사유는 **그대로 필수**다(아래 `decidePartIssueAction`). 이 완화는 올릴 때의
   *    사유 하나에만 걸린다.
   */
  const reason = cleanNote(formData.get("reason"));

  let r;
  try {
    // 🔴 결재자 판정의 열쇠는 **포털 번호**다 — 신청자 본인 단계 건너뛰기가 그 번호로 돈다.
    r = await requestPartIssueApproval(requestId, parsed.quantities, reason, { id: session.user.id, name: session.user.name, sub: session.user.authSub });
  } catch (e) {
    console.error("[part-issue] 결재 올리기 실패:", e instanceof Error ? e.message : e);
    return { error: "결재를 올리지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.code === "NO_ROUTE" ? PART_ISSUE_ROUTE_GONE_MESSAGE : r.message };

  // 🔵 재고는 움직이지 않았다 — 목록·머리말의 「대기 N」 을 다시 세지 않는다. 바뀐 것은 이 두 화면뿐이다.
  revalidatePath("/requests");
  revalidatePath(APPROVALS);
  /**
   * 🔴 **곧바로 승인된 건을 그냥 「올렸습니다」로 말하면 거짓이다** — 결재선이 전부 신청자
   *    본인이면 기다릴 사람이 없어 그 자리에서 `APPROVED` 가 된다(`planPartIssueApproval` 의
   *    `AUTO_APPROVED`). 그때는 **지금 바로 실행할 수 있다**는 것을 알려 줘야 한다.
   */
  redirect(`${safeReturnTo(formData.get(RETURN_TO_FIELD))}?issueRequested=1${r.status === "APPROVED" ? "&autoApproved=1" : ""}`);
}

/**
 * 승인 · 반려.
 *
 * ── 🔵 **승인은 단추 하나로 끝난다** (2026-10-15 쓰는 분 결정) ───────────
 * 승인할 때 한마디를 받던 칸과 **그 길을 없앴다.** 화면에 입력 칸이 없을 뿐 아니라 여기서도
 * 승인일 때는 `note` 를 **읽지 않는다** — 읽어 두면 칸이 사라진 뒤에도 손으로 보낸 값이 단계
 * 줄에 적히는 길이 남는다. 승인의 `note` 는 언제나 빈 글자다.
 * 🔵 표의 CHECK(`stock_issue_approval_steps_decision_metadata`)는 **승인에 빈 글자를 허락한다**
 *    (`APPROVED AND decided_at IS NOT NULL`). 실측으로 확인했다.
 * 🔵 [실행]의 「이번 회차에 남길 말」은 그대로 둔다 — 그것은 불출 회차에 적히는 말이라 쓸모가
 *    있고(「2개는 다음 주에」), 이번에 걷어낸 것은 **승인할 때 받던 한마디** 하나다.
 *
 * ── 🔴 **반려에는 사유가 필수**(두 글자 이상) ───────────────────────────
 * 사유 없는 반려는 올린 사람이 무엇을 고쳐야 할지 알 수 없고, 이 결재선은 반려되면 처음
 * 단계부터 다시 올리는 구조라 그대로 또 올라온다. 🔴 **승인 쪽을 푼 것이 이 울타리를 건드리지
 * 않는다** — 위 CHECK 가 `REJECTED AND note <> ''` 로 빈 사유를 거절하고, 여기와
 * `checkRejectReason` 이 그 앞을 지킨다.
 * 🔵 두 글자 울타리는 이 저장소의 반려·마감·보류와 **같은 잣대**다(`./stock.ts`).
 */
export async function decidePartIssueAction(_prev: PartIssueActionState, formData: FormData): Promise<PartIssueActionState> {
  const session = await requireSession(APPROVALS);
  const id = String(formData.get("approvalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id) return { error: "결재건이 정해지지 않았습니다." };
  if (decision !== "APPROVED" && decision !== "REJECTED") return { error: "승인인지 반려인지 알 수 없습니다. 화면을 새로 고치고 다시 보십시오." };
  // 🔴 **반려일 때만** 읽는다(머리말) — 승인에는 한마디를 받지 않는다.
  const note = decision === "REJECTED" ? cleanNote(formData.get("note")) : "";
  if (decision === "REJECTED" && note.length < 2) return { error: "반려 사유를 적으십시오." };

  let r;
  try {
    /**
     * 🔴 결재자 판정의 열쇠는 **포털 번호**(`session.user.authSub`)다. `users.id` 를 넘기면
     *    아무도 자기 차례를 집지 못한다 — 그래서 `PartIssueActor` 가 `sub` 를 **타입으로**
     *    요구한다(`src/lib/approval/part-issue.ts` 머리말).
     */
    r = await decidePartIssueApproval(id, decision, note, { id: session.user.id, name: session.user.name, sub: session.user.authSub });
  } catch (e) {
    console.error("[part-issue] 결재 실패:", e instanceof Error ? e.message : e);
    return { error: "결재하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message };

  revalidatePath(APPROVALS);
  // 🔵 승인·반려로는 재고도 신청 상태도 움직이지 않는다 — 머리말의 「대기 N」 을 다시 세지 않는다.
  redirect(`${APPROVALS}?${decision === "APPROVED" ? "approved" : "rejected"}=1`);
}

/**
 * 실행 — **실제로 부품이 나가는 단추.** 🔴 관리자만.
 *
 * 🔵 한마디(이번 회차에 남길 말)는 선택이고, 그대로 `confirmRequest` 의 회차 줄에 들어간다.
 * 🔴 막혔을 때(재고 부족·보류 중 등) **결재건은 `APPROVED` 로 그대로 남는다.** 그 사실은 화면이
 *    묶음 머리에 늘 적어 두므로(`PART_ISSUE_EXECUTION_STANDING_NOTICE`) 여기서는 서버 문구만
 *    그대로 돌려준다 — 덧붙이면 「이미 불출된 건입니다」 같은 문구에는 거짓말이 된다.
 */
export async function executePartIssueAction(_prev: PartIssueActionState, formData: FormData): Promise<PartIssueActionState> {
  const session = await requireRole("ADMIN", APPROVALS);
  const id = String(formData.get("approvalId") ?? "");
  const note = cleanNote(formData.get("note"));
  if (!id) return { error: "결재건이 정해지지 않았습니다." };

  let r;
  try {
    r = await executePartIssueApproval(id, { id: session.user.id, name: session.user.name }, note);
  } catch (e) {
    console.error("[part-issue] 실행 실패:", e instanceof Error ? e.message : e);
    return { error: "실행하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message };

  // 🔴 재고가 움직였다 — 목록·기록 내역·부품 요청 관리와 머리말의 「대기 N」 까지 다시 읽게 한다
  //    (`./stock.ts` 의 확인 액션과 같은 자리들).
  revalidatePath("/");
  revalidatePath("/entries");
  revalidatePath("/requests");
  revalidatePath(APPROVALS);
  revalidatePath("/", "layout");
  redirect(`${APPROVALS}?executed=1&issued=${r.issuing}&remaining=${r.remaining}`);
}

/**
 * 실행 대기에서 반려 — **[실행] 옆의 단추.** 🔴 관리자만([실행]과 **같은 울타리**).
 *
 * 🔴 **문턱이 [실행]과 같아야 한다.** 멈추는 일은 내보내는 일과 같은 무게이고, 한쪽만 열어 두면
 *    「내보낼 수는 있는데 멈출 수는 없는」(또는 그 반대의) 사람이 생긴다. 쓰는 분이 정한 것도
 *    관리자 하나다(확인·반려·마감·보류·실행이 전부 관리자다).
 *
 * 🔴 **사유는 필수다**(두 글자 이상) — 이 저장소의 반려·마감·보류와 **같은 잣대**이고(`./stock.ts`),
 *    아래 서버 함수의 `checkRejectReason` 과 표의 CHECK 가 그 뒤를 두 번 더 지킨다. 왜 막혔는지가
 *    없으면 신청자는 무엇을 고쳐야 할지 모른 채 같은 신청을 다시 낸다.
 *
 * 🔵 돌아갈 자리는 `/approvals` 다 — 이 단추가 거기 붙어 있다([실행]과 같다).
 */
export async function rejectExecutionPartIssueAction(_prev: PartIssueActionState, formData: FormData): Promise<PartIssueActionState> {
  // 🔴 [실행]과 **같은 역할**이다(머리말).
  const session = await requireRole("ADMIN", APPROVALS);
  const id = String(formData.get("approvalId") ?? "");
  const note = cleanNote(formData.get("note"));
  if (!id) return { error: "결재건이 정해지지 않았습니다." };
  if (note.length < 2) return { error: "반려 사유를 적으십시오." };

  let r;
  try {
    r = await rejectExecutionPartIssueApproval(id, { id: session.user.id, name: session.user.name }, note);
  } catch (e) {
    console.error("[part-issue] 실행 대기 반려 실패:", e instanceof Error ? e.message : e);
    return { error: "반려하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message };

  /**
   * 🔴 **재고는 움직이지 않았지만 반출 신청은 닫혔다** — `/requests` 의 목록과 거기 그려지는
   *    결재선 그림이 바뀐다. 🔵 머리말의 「대기 N」은 다시 세지 않는다: 그 숫자가 세는 묶음
   *    (`ACTIONABLE_REQUEST_STATUSES`)에 `IN_APPROVAL` 도 `REJECTED` 도 없어 **값이 그대로**다.
   */
  revalidatePath("/requests");
  revalidatePath(APPROVALS);
  redirect(`${APPROVALS}?executionRejected=1`);
}

/**
 * 거두기 — 올린 사람이 **아직 결재 전일 때만.** 판정은 전부 서버 함수가 한다(머리말).
 * 🔵 사유를 받지 않는다 — 올린 사람이 자기 것을 무르는 일이라 남에게 설명할 것이 없고,
 *    누가 언제 거뒀는지는 감사 로그에 남는다(`STOCK_ISSUE_APPROVAL_CANCELLED`).
 */
export async function cancelPartIssueAction(_prev: PartIssueActionState, formData: FormData): Promise<PartIssueActionState> {
  const session = await requireSession(APPROVALS);
  const id = String(formData.get("approvalId") ?? "");
  if (!id) return { error: "결재건이 정해지지 않았습니다." };

  let r;
  try {
    r = await cancelPartIssueApproval(id, { id: session.user.id, name: session.user.name });
  } catch (e) {
    console.error("[part-issue] 거두기 실패:", e instanceof Error ? e.message : e);
    return { error: "거두지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message };

  revalidatePath(APPROVALS);
  redirect(`${APPROVALS}?cancelled=1`);
}
