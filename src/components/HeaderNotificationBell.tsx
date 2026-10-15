import { NotificationBell } from "@dss/ui";
import type { Role } from "@/db/schema/users";
import { fetchPortalNotifications } from "@/lib/notifications/portal";
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
 * 두 물음은 **나란히** 나간다 — 우리 DB 가 포털을 기다릴 이유가 없다.
 * ============================================================================
 */
export async function HeaderNotificationBell({ userId, role, subject }: { userId: string; role: Role; subject: string }) {
  const [mine, others] = await Promise.all([listInventoryNotifications({ id: userId, role }), fetchPortalNotifications(subject)]);

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
    />
  );
}
