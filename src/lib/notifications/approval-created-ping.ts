import "server-only";
import { activeDelegateSubsFor } from "@/lib/approval/delegation-queries";
import { notifyPortalApprovalCreated } from "./portal";

/**
 * ============================================================================
 * 결재가 생긴 **뒤에** 포털을 한 번 쿡 찌른다 (2026-10-24)
 * ============================================================================
 * 포털(dss-auth)이 결재 알림 메일을 보내는데, 지금은 **주기적으로 물어** 보는 방식이라
 * 결재가 생긴 순간이 아니라 그 다음 차례에 메일이 나간다. 쓰는 분이 「결재건이 생기자마자
 * 메일이 보내졌으면 좋겠다」고 해서(2026-10-24) 그 틈을 메우는 한 줄을 더한 것이다.
 *
 * 🔴 **이 파일이 하는 일은 「누구에게 알릴지 모으기」뿐이다.** 망으로 나가는 일은
 * `./portal.ts` 의 `notifyPortalApprovalCreated` 가 하고, 거기에 **무엇이 실리는지**(= 포털
 * 번호 하나뿐, 신청 번호도 품명도 아니다)와 왜 그래야 하는지가 적혀 있다.
 *
 * ── 🔴 **부르는 자리는 커밋이 끝난 뒤다** ───────────────────────────────
 * 부르는 쪽은 `src/lib/approval/part-issue.ts` 의 두 자리이고 **둘 다 트랜잭션 밖**이다:
 *  ① 결재를 올려 첫 단계가 선 뒤      (`requestPartIssueApproval`)
 *  ② 한 단계가 승인돼 다음 단계가 선 뒤 (`decidePartIssueApproval`)
 * 🔴 트랜잭션 **안**에서 부르면 포털이 멎었을 때 **신청 자체가 실패**한다. 결재 저장은 이
 * 알림보다 비교할 수 없이 중요하고, 알림은 못 보내도 **포털의 주기 작업이 줍는다.**
 *
 * 🔴 그래서 이 함수는 **무슨 일이 있어도 던지지 않는다.** 포털이 404(통로가 아직 없다)·500·
 * 타임아웃으로 답해도, 아래 위임 조회가 터져도, 사람에게는 아무 일도 일어나지 않아야 한다 —
 * 결재는 이미 저장됐다. 까닭은 서버 로그에만 남는다.
 *
 * ── 🔴 누구에게 가는가 — **판정을 새로 짓지 않는다** ────────────────────
 * 「이 사람이 결재할 건인가」는 `listPartIssueApprovalsToDecide` 가 이미 가린다. 그 조회는
 * 단계에 적힌 결재자 본인뿐 아니라 **지금 그를 대신할 수 있는 대리인의 목록에도** 그 건을
 * 띄운다(`actingApproverSubs`). 그래서 알림도 **그 판정을 뒤집어** 쓴다:
 *
 *     알릴 사람 = 단계에 적힌 결재자 + 지금 그를 대신할 수 있는 사람들
 *
 * 🔴 **대리인을 빼면 위임 기능이 반쪽이 된다** — 자리를 비운 사람에게 메일이 가고, 정작 눌러야
 * 할 사람은 주기 작업을 기다린다. 뒤집어 보는 함수는 저장소에 하나뿐이고
 * (`approval/delegation.ts` 의 `delegateSubsFor`), 거르는 규칙은 결재 판정이 쓰는 그
 * `isActiveDelegation` 그대로다.
 * ============================================================================
 */

/**
 * 「이 자리에 결재할 차례가 생겼다」를 포털에 알린다. 🔴 **던지지 않는다**(머리말).
 *
 * @param approverSub 그 단계에 적힌 결재자의 **포털 번호**(`stock_issue_approval_steps.approver_sub`).
 *   🔴 **비어 있으면 아무도 부르지 않고 로그에 남긴다.** 지금 표는 이 칸이 `NOT NULL` 이고
 *   결재선에 번호 없는 단계가 있으면 결재건 자체가 서지 않으므로(`planPartIssueApproval` 의
 *   `MISSING_SUB`) 이 자리는 실제로는 비지 않는다. 그래도 받아 두는 까닭은, 비는 날이 오면
 *   **증상이 「메일이 안 온다」 하나뿐**이라 아무도 신고하지 않기 때문이다 — 로그 한 줄이
 *   그때의 유일한 단서가 된다.
 */
export async function pingPortalApprovalCreated(approverSub: string | null): Promise<void> {
  try {
    if (approverSub === null || approverSub === "") {
      // 🔵 번호 자체는 찍지 않는다(없으니 찍을 것도 없다). 사람을 가리키는 값은 이 집의
      //    포털 통로 어디에서도 로그에 남기지 않는다(`./portal.ts` 의 같은 규칙).
      console.warn("[approvals] 결재자의 포털 번호가 없어 포털에 알리지 않았습니다. 메일은 포털의 주기 작업이 보냅니다.");
      return;
    }

    /**
     * 🔴 **대리인까지 모은다**(머리말). 🔵 이 조회가 터져도 **적힌 결재자에게는 알린다** —
     *    위임은 보탬이지 전제가 아니고, 둘 다 놓치는 것보다 한쪽이라도 보내는 편이 낫다.
     */
    let delegateSubs: readonly string[] = [];
    try {
      delegateSubs = await activeDelegateSubsFor(approverSub);
    } catch (e) {
      console.error("[approvals] 대리인을 읽지 못해 결재자에게만 알립니다:", { name: e instanceof Error ? e.name : "unknown" });
    }

    // 🔴 **적힌 결재자가 맨 앞**이다 — 포털이 칸을 하나만 읽는 구현이어도 그 사람에게는 간다
    //    (`notifyPortalApprovalCreated` 의 차례 주석).
    await notifyPortalApprovalCreated([approverSub, ...delegateSubs]);
  } catch (e) {
    /**
     * 🔴 **마지막 울타리다.** 아래쪽이 이미 저마다 삼키지만(위 조회 · 포털 왕복), 설정값이
     *    빠져 getter 가 던지는 길 같은 것이 하나라도 새면 **이미 저장된 결재가 실패로 보인다.**
     */
    console.error("[approvals] 결재 생김을 알리는 중에 예상 못 한 오류:", { name: e instanceof Error ? e.name : "unknown" });
  }
}
