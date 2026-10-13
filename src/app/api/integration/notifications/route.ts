import { PORTAL_TOKEN_PURPOSES, readBearerToken, verifyPortalServiceToken } from "@/lib/auth/portal-service-token";
import { findActiveUserByAuthSub } from "@/lib/auth/users";
import type { InventoryNotificationFeed } from "@/lib/notifications/bell-items";
import { listInventoryNotifications } from "@/lib/notifications/queries";

/**
 * ============================================================================
 * 「이 사람의 지금 재고 알림」을 밖으로 내주는 통로
 * ============================================================================
 * 통합 종이 쓴다 — 포털(dss-auth)이 등록된 시스템마다 이 통로에 물어 합친다. 그래야
 * A/S 든 게시판이든 휴가든 **어느 시스템에서 종을 열어도** 재고의 확인 대기·반려가 보인다.
 *
 * 화면의 종이 보는 **바로 그 목록**을 그대로 내준다(notifications/queries.ts →
 * bell-items.ts). 규칙을 두 벌로 적으면 같은 사람이 재고에서는 2건, 포털에서는 다른
 * 수를 보게 된다. 그 줄들은 이미 포털이 읽을 아홉 칸 모양이다(`key` 가 `client_id:id`
 * 이고 `href` 가 절대 주소다).
 *
 * 🔴 대상 사용자는 **토큰 안에서만** 온다. 쿼리 문자열을 읽지 않는다 — 읽으면 토큰
 * 하나로 아무 사람의 알림이나 볼 수 있는 문이 된다.
 *
 * ── 🔴 GET 이다 (POST 가 아니다) ────────────────────────────────────────
 * `dss-auth/docs/사이트-알림-통로.md` 의 POST 는 **반대 방향** — 사이트가 포털에 물을
 * 때의 것이고 자격도 `client_secret`(Basic)이다(notifications/portal.ts). 포털이
 * 우리에게 올 때는 GET 으로 오고, 자격은 포털이 RS256 으로 서명한 Bearer 토큰이다.
 * 읽기뿐이라 GET 이 맞고, 토큰을 쿼리가 아니라 `Authorization` 머리말로 받는 것은
 * 쿼리가 접근 로그에 그대로 남기 때문이다.
 *
 * ⚠️ 포털은 이 왕복을 **1.5초**만 기다린다(그쪽 READ_TIMEOUT_MS). 여기서 하는 일은
 * 색인을 타는 질의 셋뿐이다 — 사람 되짚기(users_auth_sub_uq) · 대기 집계
 * (stock_requests_status_idx) · 내 반려 목록(stock_requests_requester_idx).
 * ============================================================================
 */

/** 🔴 이 응답이 캐시되면 이미 처리한 신청이 남의 종에 계속 남는다. 모든 답에 붙인다. */
const NO_STORE = { "cache-control": "no-store" };

/** 되짚지 못한 사람의 답. 🔴 오류가 아니다(아래 주석). */
const EMPTY_FEED: InventoryNotificationFeed = { items: [], count: 0 };

export async function GET(request: Request): Promise<Response> {
  try {
    const verified = await verifyPortalServiceToken(readBearerToken(request.headers.get("authorization")), PORTAL_TOKEN_PURPOSES.notificationsRead);
    if (!verified.ok) {
      // 🔴 왜 거절했는지는 밖으로 내보내지 않는다 — 부르는 쪽이 맞혀 가며 두드릴
      //    실마리가 된다. 까닭은 서버 로그에만 남는다(auth/portal-service-token.ts).
      return Response.json({ error: "invalid_token" }, { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } });
    }

    // 🔴 이 시스템에 계정이 없는 사람은 **빈 목록**이다 — 오류가 아니다. 포털은 여러
    //    시스템에 같은 질문을 던지고, 재고 관리는 「지정된 사람만」 들어온다. 오류를
    //    돌려주면 포털의 종이 그 줄에서 상한 것처럼 보인다.
    const user = await findActiveUserByAuthSub(verified.subject);
    if (!user) return Response.json(EMPTY_FEED, { headers: NO_STORE });

    // 🔵 어떤 실패도 삼키고 빈 목록을 돌려주므로(그 파일 머리말) 여기서 따로 받아 낼
    //    것이 없다. 🔴 역할은 **DB 의 값**을 쓴다 — 개발용 「역할 바꿔 보기」는 쿠키라
    //    여기까지 따라오지 않고, 따라와서도 안 된다.
    const feed = await listInventoryNotifications({ id: user.id, role: user.role });
    return Response.json(feed, { headers: NO_STORE });
  } catch (e) {
    // 설정값이 빠졌거나(env 의 getter 가 던진다) 포털의 JWKS 를 못 읽었거나 DB 가 멎었다.
    // 안쪽 사정은 내보내지 않고 「지금은 안 된다」로만 답한다 — 포털은 이 줄만 빼고
    // 나머지를 그린다.
    console.error("[integration] 알림 목록을 내주지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
