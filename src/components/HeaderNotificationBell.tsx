import { NotificationBell } from "@dss/ui";
import type { Role } from "@/db/schema/users";
import { dismissNotificationAction } from "@/app/actions/notifications";
import { fetchPortalNotifications, withoutDismissed } from "@/lib/notifications/portal";
import { listInventoryNotifications } from "@/lib/notifications/queries";

/**
 * ============================================================================
 * 머리말의 알림 종 — **이 시스템의 알림 + 다른 시스템들의 알림**
 * ============================================================================
 * 사내 시스템이 여럿인데(A/S · 계측기 · 개선요청 · PO/내자 · 휴가 · 게시판 · 재고)
 * 「어느 시스템에서 종을 열어도 같은 알림을 본다」가 목표다. 그래서 길이 둘이다:
 *
 *   ① 재고 → 포털  (notifications/portal.ts)  POST · Basic client_secret · 남의 알림을 받아 온다
 *   ② 포털 → 재고                              GET  · 포털이 서명한 Bearer · 우리 알림을 내준다
 *                                              (app/api/integration/notifications)
 *
 * ── 🔴 자기 알림은 자기가 붙인다 ────────────────────────────────────────
 * 포털은 **부른 사이트 자신에게는 묻지 않는다.** 그래서 ① 의 답에는 재고의 알림이 들어
 * 있지 않고, 들어 있어서도 안 된다 — 포털은 30초 캐시를 들기 때문에, 자기 알림까지
 * 거기서 받으면 **방금 확인한 신청이 30초 동안 종에 남는다**(사람이 지금 보고 있는 바로
 * 이 화면에서). 그래서 여기서 **우리 DB 의 목록**과 **포털이 준 목록**을 합친다. 둘은
 * 겹치지 않는다.
 *
 * 🔴 **자기 것이 앞, 포털에서 온 것이 뒤**다. 지금 재고 관리를 보고 있는 사람의 할 일이
 *    먼저 보여야 하고, 받은 목록은 다시 섞지 않는다 — 포털이 정한 차례가 있다.
 *
 * ── 🔴 개수는 두 쪽을 **더한다**(다시 세지 않는다) ──────────────────────
 * 묶음은 받은 숫자를 그대로 찍는다(@dss/ui README 7절). 양쪽 count 모두 「그 시스템이
 * 센 진짜 개수」다. `items.length` 로 다시 세면 둘 다 거짓이 된다.
 *
 * ── 🔴 머리말의 「대기 N」 배지를 **대신하지 않는다** ────────────────────
 * 그 배지는 「부품 요청」 메뉴 옆에 그대로 남는다(2026-10-15 에 「기록 내역」에서 옮겨
 * 왔다 — 신청이 보이는 자리가 `/requests` 하나가 됐다). 역할이 다르다: 배지는 **그
 * 화면에 할 일이 있다**는 표시이고, 종은 **여러 시스템의 알림을 모으는 자리**다.
 *
 * ── 🔴 둘 다 던지지 않는다 ──────────────────────────────────────────────
 * DB 가 멎어도(queries.ts 가 삼킨다) 포털이 죽거나 거절해도(portal.ts 가 삼킨다) 빈
 * 목록이 온다. 그래서 한쪽이 없으면 **나머지만** 그려지고, 둘 다 없으면 종이 아예
 * 그려지지 않는다 — 어느 경우에도 화면은 뜬다. 그래서 이 자리에 error boundary 가
 * 필요 없다.
 *
 * ── 🔴 지우기(✕)는 **포털에 적힌다** ───────────────────────────────────
 * 「확인했다」는 그 알림을 만든 시스템에만 적을 수 있지만, 「그만 보겠다」는 포털에
 * 적힌다(2026-10-19). 그래서 어느 시스템에서 지우든 사내 시스템 **전부의 종**에서
 * 사라진다. 적는 자리는 서버 액션이다 — 평범한 함수는 클라이언트 경계를 건너지
 * 못하고, 중계 통로를 뚫으면 위에서 피한 「시크릿을 다루는 자리」가 늘어난다
 * (app/actions/notifications.ts).
 *
 * 🔴 **제 줄은 우리가 걸러야 한다.** 남의 줄은 포털이 걸러서 보내지만(items 에서
 *    빠지고 count 도 줄어 있다), 재고관리의 알림은 포털이 애초에 보내지 않아
 *    손댈 수 없다 — 그것을 거르라고 포털이 `dismissed` 를 함께 보낸다. 안 거르면
 *    **「재고관리에서 지웠는데 재고관리 종에만 그대로 뜬다」**가 된다. 거르는 함수
 *    (withoutDismissed)가 **개수까지 함께 줄인다** — 줄은 빠졌는데 배지 숫자가
 *    그대로면 「눌러도 안 없어지는 숫자」가 된다.
 *
 * 🔵 포털이 보낸 `others.count` 는 **손대지 않는다.** 남의 줄 몫이고 지움이 이미
 *    반영돼 있다. 줄이는 것은 우리가 더한 제 줄 몫뿐이다.
 *
 * 두 물음은 **나란히** 나간다 — 우리 DB 가 포털을 기다릴 이유가 없다.
 * ============================================================================
 */
export async function HeaderNotificationBell({ userId, role, subject }: { userId: string; role: Role; subject: string }) {
  // 🔴 `subject` 는 **포털 번호**(`session.user.authSub`)다. 포털에 남의 알림을 물을 때 쓰던
  //    그 값을 우리 질의에도 그대로 넘긴다 — 「지금 내 차례인 불출 결재」가 그 번호로만 갈린다
  //    (notifications/queries.ts 의 `NotificationViewer.sub`). **users 를 다시 읽지 않는다.**
  const [raw, others] = await Promise.all([listInventoryNotifications({ id: userId, role, sub: subject }), fetchPortalNotifications(subject)]);

  // 🔴 이 한 줄이 없으면 「여기서 지웠는데 여기서만 그대로 뜬다」가 된다(위 머리말).
  const mine = withoutDismissed(raw, others.dismissed);

  const items = [...mine.items, ...others.items];

  // 🔴 **알림이 0건이면 머리말이 예전과 글자 하나 다르지 않아야 한다.** 묶음도 빈
  //    목록이면 스스로 아무것도 그리지 않지만(그쪽 시험), 여기서 한 겹 더 막아 둔다.
  if (items.length === 0) return null;

  return (
    <NotificationBell
      items={items}
      // 🔴 두 쪽을 **더한다**(위 머리말). items.length 가 아니다.
      count={mine.count + others.count}
      label="알림"
      // onAcknowledge 를 넘기지 않는다 — 이 시스템의 알림은 **상태가 바뀌면 사라지고**
      // (확인·반려하면 대기가 빠지고, 반려는 7일 뒤 저절로 — notifications/bell-items.ts),
      // 포털에서 온 줄은 그 알림을 만든 시스템에서만 확인을 적을 수 있다.
      //
      // colorScheme 도 넘기지 않는다. 이 사이트는 밝은 화면뿐이라 기본값 "host"
      // (조상에 .dark 가 있을 때만 어두워진다)가 그대로 옳다(@dss/ui README 4절).
      //
      // 🔴 `onDismiss` 를 **넘겼을 때만** 줄마다 ✕ 가 그려진다(@dss/ui). 넘기는 것은
      //    서버 액션이라 번들에는 이름표만 나가고 `client_secret` 은 서버에 남는다 —
      //    이 조각에 "use client" 가 없는 것이 그 판단의 짝이다.
      onDismiss={dismissNotificationAction}
      // 🔴 `canDismiss` 는 넘기지 않는다 = **모든 줄에 ✕ 가 선다.** 제 줄도 지울 수
      //    있다. 한때 A/S 가 「처리해야 사라지는 제 할 일」은 못 지우게 가렸는데,
      //    2026-10-20 에 그 규칙을 **풀었다**(A/S 의 551641f) — 다른 시스템의 종에서는
      //    어차피 지워지므로, 막는 것이 아니라 헷갈리게 만들고 있었기 때문이다.
      //    같은 까닭이 여기에도 그대로 적용된다.
    />
  );
}
