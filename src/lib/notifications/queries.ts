import "server-only";
import type { Role } from "@/db/schema/users";
import { env } from "@/lib/env";
import { listRejectedRequestsFor, summarizePendingRequests } from "@/lib/stock/requests";
import { buildInventoryNotificationItems, NOTIFICATION_MAX_ITEMS, receivesPendingNotification, rejectionCutoff, type InventoryNotificationFeed } from "./bell-items";

/**
 * ============================================================================
 * 종에 실을 **이 시스템 자신의 알림**을 그 사람 기준으로 가져온다
 * ============================================================================
 * 규칙은 전부 notifications/bell-items.ts 에 있다. 이 파일은 그 순수 계산에
 * **재료를 날라다 주는 자리**다 — 대기 요약, 반려된 내 신청, 이 시스템의 주소, client_id.
 *
 * ── 🔴 스키마를 건드리지 않는다 ─────────────────────────────────────────
 * 새 표도 마이그레이션도 없다. 재료가 이미 `stock_requests` 에 다 있다:
 *   status            PENDING·CONFIRMING(대기) · REJECTED(반려)
 *   requested_by      누가 냈는가 — 색인 stock_requests_requester_idx
 *   decided_at        언제 결정됐는가 — 「7일」을 여기에 긋는다
 *
 * ── 🔴 여기서 던지지 않는다 ─────────────────────────────────────────────
 * 이 값은 **모든 화면의 머리말**에 실린다. DB 가 멎었든, 설정이 빠져 이 시스템의
 * 주소를 못 만들든(env.ownBaseUrl 은 던진다), 종 하나 때문에 사이트 전체가 못 쓰게
 * 되면 안 된다. 그래서 어떤 실패도 **빈 목록**으로 돌아간다.
 *
 * ⚠️ 로그에는 **오류의 종류만** 남긴다. 사람 이름·부품명·사유 본문·주소는 싣지 않는다.
 * ============================================================================
 */

const EMPTY: InventoryNotificationFeed = { items: [], count: 0 };

/** 종이 보는 사람. 🔴 `requireSession()` 이 읽은 **살아 있는 users 행**이어야 한다. */
export type NotificationViewer = {
  /** `users.id`. 쿠키에 박힌 값이나 요청 본문에서 온 값을 넘기면 남의 알림을 보게 된다. */
  id: string;
  role: Role;
};

/**
 * 이 사람의 알림 — 줄과 **진짜 개수**.
 *
 * 두 질의는 **나란히** 나간다. 대기 요약은 ADMIN 일 때만 묻는다 — 다른 역할에게는
 * 어차피 줄이 만들어지지 않으므로(bell-items.ts) 왕복 한 번이 그대로 낭비다.
 */
export async function listInventoryNotifications(viewer: NotificationViewer, now = new Date()): Promise<InventoryNotificationFeed> {
  try {
    const [pending, rejected] = await Promise.all([
      // 🔴 「누가 받는가」를 여기서 다시 적지 않는다 — 조립이 쓰는 그 함수를 그대로 본다.
      receivesPendingNotification(viewer.role) ? summarizePendingRequests() : Promise.resolve({ count: 0, oldestAt: null }),
      // 🔴 「7일」을 여기서 손으로 적지 않는다 — 조립과 **같은 함수**로 선을 긋는다.
      listRejectedRequestsFor(viewer.id, rejectionCutoff(now), NOTIFICATION_MAX_ITEMS),
    ]);

    if (pending.count === 0 && rejected.rows.length === 0) return EMPTY;

    return buildInventoryNotificationItems({
      role: viewer.role,
      pending,
      rejected: rejected.rows,
      rejectedTotal: rejected.total,
      now,
      // 주소를 못 만들면 여기서 던진다 — 아래 catch 가 받는다(env.ts 의 ownBaseUrlFrom).
      baseUrl: env.ownBaseUrl,
      sourceId: env.ssoClientId,
    });
  } catch (e) {
    // 🔴 오류의 **종류만** 남긴다. 값(이름·부품명·사유·주소)은 싣지 않는다.
    console.error("[notifications] 알림 목록을 만들지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return EMPTY;
  }
}
