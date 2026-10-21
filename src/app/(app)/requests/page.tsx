import { RequestManagerScreen } from "@/components/stock/RequestManagerScreen";
import { isPartIssueApprovalRouteInForce, partIssueLockFor, type PartIssueLock } from "@/lib/approval/part-issue-gate";
import { listOpenPartIssueStatusesByRequest } from "@/lib/approval/part-issue";
import type { IssueApprovalTrailView } from "@/lib/approval/part-issue-screen";
import { readPartIssueTrailsByRequest } from "@/lib/approval/part-issue-screen-data";
import { getCurrentApprovalRoute } from "@/lib/approval/queries";
import { roleAtLeast } from "@/lib/auth/role";
import { requireRole } from "@/lib/auth/session";
import { requestDecisionNotice, requestSavedNotice, type RequestNotice } from "@/lib/stock/request-notice";
import { listAllRequests } from "@/lib/stock/requests";

/**
 * 부품 요청 관리 `/requests` (기록 권한 이상, 2026-10-15 조각 10b. A/S 의 같은 화면을 옮겨 왔다).
 *
 * 담당자가 반출 신청을 **한자리에서 훑고 처리하는** 자리다. **상태를 가리지 않고 전부** 보며 화면에서 거른다.
 *
 * 🔴 **신청이 보이는 자리는 이 화면 하나다** (2026-10-15 사용자 결정). 기록 내역(`/entries`) 맨 위에 있던
 *    「확인 대기」 구역은 같은 날 걷어냈다 — 같은 신청이 두 화면에 떴기 때문이다. 머리말의 「대기 N」 배지도
 *    역할과 무관하게 「부품 요청」 옆에 선다.
 * 🔴 **문을 STAFF 로 연 것도 2026-10-15 사용자 결정이다 — 신청자도 「보기만」 한다.** 같은 날 반출이
 *    누가 적든 요청으로 올라가게 바뀌었고(`src/lib/stock/codes.ts` 의 `needsConfirmation`), 그러면 자기 요청이
 *    어디까지 갔는지 볼 자리가 신청자에게도 있어야 한다. 확인·반려·마감·보류 **단추는 관리자에게만** 그린다
 *    (아래 `isAdmin`). 🔵 딱 하나 예외가 **[신청 취소]** — 본인이 낸 대기 신청은 신청자가 거둔다(아래 `currentUserId`).
 * 🔴 **역할은 서버가 판정한다**(CLAUDE.md 8-4절). 머리말에서 링크를 숨기는 것도, 화면에서 단추를 안 그리는 것도
 *    **편의일 뿐**이다. 쓰기를 실제로 막는 울타리는 각 서버 액션의 `requireRole("ADMIN", …)` 이고
 *    (`src/app/actions/stock.ts` 의 confirm·reject·close·hold·releaseHold), 그건 이미 거기 있다.
 *    🔵 뒤에 읽는 사람이 **이 화면의 조건을 「막는 자리」로 믿지 않게** 적어 둔다 — 여기를 지워도 쓰기는 안 뚫린다.
 * 🔴 **서버/클라이언트 경계**: 자료를 읽는 것은 여기(서버 컴포넌트)뿐이고, 화면 조각은 `server-only` 모듈을
 *    **직접도 타입으로도** 끌어오지 않는다(그쪽 파일의 머리말 주석).
 */
export const metadata = { title: "부품 요청 관리" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole("STAFF", "/requests");
  const isAdmin = roleAtLeast(session.user.role, "ADMIN");
  const sp = await searchParams;
  const requests = await listAllRequests();
  /**
   * 단추를 누르고 **여기로 돌아왔을 때** 할 한 줄 (2026-10-15, 조각 10c).
   * 🔴 돌아왔는데 아무 말이 없으면 눌렀는데 아무 일도 안 난 것처럼 보인다.
   * 🔵 문구는 기록 내역과 **같은 한 벌**에서 온다(`request-notice.ts`) — 두 화면이 같은 일을 다르게 말하지 않게.
   */
  const notices = [requestSavedNotice(sp, "requests"), requestDecisionNotice(sp, "requests")].filter((n): n is RequestNotice => n !== null);

  /**
   * 🔴 **부품 불출 결재의 문 — 판정은 여기(서버)서 하고 화면은 받은 대로 그린다** (2026-10-15, 조각 11c).
   *    화면이 다시 판정하면 「단추는 보이는데 누르면 거절」이나 그 반대가 되고, **후자는 화면에 아무 표시도
   *    남기지 않아 더 나쁘다**(A/S 원본 `PartRequestManagerScreen` 의 까닭 그대로). 판을 읽는 것도 여기서
   *    한다 — 클라이언트가 DB 를 읽게 두지 않는다.
   *
   * ① **절차가 지금 쓰이고 있는가** — 판이 없거나 단계가 0개면 거짓이고, 그때 이 화면은 지금까지와
   *    **한 글자도 다르지 않다**(`isPartIssueApprovalRouteInForce`).
   *    🔵 포털 번호가 **빠진** 조회(`getCurrentApprovalRoute`)를 쓴다 — 여기서 필요한 것은 단계 수뿐이고,
   *       번호가 든 모양을 집어 오면 다음 사람이 그대로 화면에 실어 보낼 수 있다(`queries.ts` 머리말).
   * ② **신청마다 살아 있는 결재건이 있는가, 있다면 어느 자리인가** — 신청 묶음으로 **한 번에** 읽고
   *    (`listOpenPartIssueStatusesByRequest`), 「승인 대기인가 · 실행 대기인가」 판정은 `partIssueLockFor`
   *    한 곳에서 한다. **잠긴 신청만** 담는다.
   *    🔴 ①과 **따로 간다.** 절차를 꺼도 이미 올라간 결재건은 살아 있어 결재·실행될 수 있고, 그 사이
   *       [확인]으로 한 번 더 내보내면 **같은 부품이 두 번 나간다.**
   */
  /**
   * ③ **결재선 진행 그림에 먹일 자료** (2026-10-21, 조각 11f. 쓰는 분 요청: 「`/requests` 에서도 결재
   *    진행 상황을 보고 싶다」). 결재가 걸린 신청만 들어 있다.
   *    🔴 **「승인 요청건」이 쓰는 그 길을 그대로 쓴다**(`readPartIssueTrailsByRequest`). 그림이 그려야
   *       하는 단계는 **그 결재건이 타고 있는 판**이지 지금 설정된 판이 아니다 — 현재 판을 집어다 그리면
   *       절차를 바꾼 뒤 옛 건을 볼 때 **없는 결재자가 그려진다**(`IssueApprovalTrail` 머리말).
   *    🔵 **여기(서버)서만 읽는다.** 화면 조각은 클라이언트 묶음이라 `server-only` 사슬을 물면 빌드가
   *       깨진다 — 아래 `issueTrails` 는 **값만** 내려간다.
   */
  const [route, openApprovals, trailsByRequest] = await Promise.all([
    getCurrentApprovalRoute("PART_ISSUE"),
    listOpenPartIssueStatusesByRequest(requests.map((r) => r.id)),
    readPartIssueTrailsByRequest(requests.map((r) => r.id)),
  ]);
  const approvalRequired = isPartIssueApprovalRouteInForce(route);
  const issueLocks: Record<string, PartIssueLock> = {};
  for (const [requestId, statuses] of openApprovals) {
    const lock = partIssueLockFor(statuses);
    if (lock !== null) issueLocks[requestId] = lock;
  }
  // 🔵 `Map` 이 아니라 평범한 객체로 내려보낸다 — 바로 위 `issueLocks` 와 같은 모양이어야 화면이 둘을 같게 다룬다.
  const issueTrails: Record<string, IssueApprovalTrailView> = Object.fromEntries(trailsByRequest);

  /**
   * 🔴 **지금 보는 사람의 id** — 화면이 「내가 낸 신청인가」를 가려 [신청 취소]를 그린다 (2026-10-15).
   *    기록 내역에 있던 그 단추를 여기로 옮긴 것이고, 비교는 `requestedBy` 와의 **id 대조**다(이름이 아니다 —
   *    동명이인이면 남의 신청을 거둘 단추가 그려진다).
   * 🔵 **이 값은 울타리가 아니다.** 실제로 막는 자리는 `cancelRequestAction` → `cancelRequest` 의 WHERE 이고,
   *    거기서 **「본인이 낸, 아직 PENDING 인 것」만** 받는다. 화면은 눌러도 거절당할 단추를 안 내미는 것뿐이다.
   */
  return (
    <RequestManagerScreen
      requests={requests}
      notices={notices}
      isAdmin={isAdmin}
      currentUserId={session.user.id}
      approvalRequired={approvalRequired}
      issueLocks={issueLocks}
      issueTrails={issueTrails}
    />
  );
}
