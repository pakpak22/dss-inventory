import { RequestManagerScreen } from "@/components/stock/RequestManagerScreen";
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
   * 🔴 **지금 보는 사람의 id** — 화면이 「내가 낸 신청인가」를 가려 [신청 취소]를 그린다 (2026-10-15).
   *    기록 내역에 있던 그 단추를 여기로 옮긴 것이고, 비교는 `requestedBy` 와의 **id 대조**다(이름이 아니다 —
   *    동명이인이면 남의 신청을 거둘 단추가 그려진다).
   * 🔵 **이 값은 울타리가 아니다.** 실제로 막는 자리는 `cancelRequestAction` → `cancelRequest` 의 WHERE 이고,
   *    거기서 **「본인이 낸, 아직 PENDING 인 것」만** 받는다. 화면은 눌러도 거절당할 단추를 안 내미는 것뿐이다.
   */
  return <RequestManagerScreen requests={requests} notices={notices} isAdmin={isAdmin} currentUserId={session.user.id} />;
}
