import { PORTAL_TOKEN_PURPOSES, readBearerToken, verifyPortalServiceToken } from "@/lib/auth/portal-service-token";
import { findActiveUserByAuthSub } from "@/lib/auth/users";
import { listPartIssueApprovalHistoryFor } from "@/lib/approval/part-issue";
import { env } from "@/lib/env";
import { PORTAL_APPROVAL_HISTORY_LIMIT, buildPortalApprovalHistory, parseApprovalHistoryPeriod } from "@/lib/notifications/portal-approval-history";

/**
 * ============================================================================
 * 「이 사람이 이 기간에 한 결재」를 밖으로 내주는 통로 — 통합 승인함이 쓴다
 * ============================================================================
 * `GET /api/integration/approval-history?from=<ISO8601>&to=<ISO8601>`
 *
 * 통합 승인함(`dss-approvals`)이 사내 시스템 **셋**(A/S · 재고관리 · 휴가)에 같은 질문을
 * 던져 한 창에 모은다. 응답의 모양과 판단은 전부
 * `notifications/portal-approval-history.ts` 에 있고, 여기 남은 일은 「머리말에서 토큰 꺼내
 * 검증하고 · 기간 둘 읽고 · 그 함수 부르기」뿐이다.
 *
 * 🔴 **틀은 옆의 승인함 통로(../approvals/route.ts)를 그대로 따른다.** 왜 그래야 하는지는
 * 그 파일과 알림 통로(../notifications/route.ts)의 주석에 다 적혀 있다 — 여기서는 같은
 * 규칙을 다시 못 박고, **다른 한 가지**만 덧붙인다:
 *  · 대상 사용자는 **토큰 안에서만** 온다. 🔴 **쿼리에서 사람을 읽지 않는다** — 읽는 순간
 *    토큰 하나로 **아무의 결재 내역이나** 보는 문이 된다.
 *  · 🔴 **다른 한 가지**: 이 통로는 쿼리를 읽는다. 다만 읽는 것이 **기간 두 값뿐**이다.
 *    옆 통로들은 쿼리를 아예 안 읽어 「사람을 못 고른다」가 저절로 지켜졌지만, 여기서는
 *    읽는 열쇠가 `from`·`to` 둘로 **한정되는지**가 그 울타리다
 *    (tests/integration-approval-history-route-source.test.ts 가 글자로 지킨다).
 *  · 링크는 절대 주소다. 기준 주소는 요청의 Host 가 아니라 환경에서 온다(env.ownBaseUrl).
 *    🔴 `request.url` 을 쓰지만 **쿼리만** 꺼낸다 — next dev 에서 그 주소의 호스트는 들어온
 *    Host 와 상관없이 `localhost` 다. 호스트를 거기서 읽으면 조용히 엉뚱한 링크가 나간다.
 *  · 응답을 캐시하지 않는다.
 *  · GET 인 것은 읽기뿐이기 때문이고, 토큰을 쿼리가 아니라 `Authorization` 머리말로 받는
 *    것은 쿼리가 접근 로그에 그대로 남기 때문이다.
 *
 * ── 🔴 차례가 있다: 토큰 먼저, 기간 나중 ────────────────────────────────────
 * 기간이 틀렸다는 것도 **자격을 보인 쪽에만** 말해 준다. 거꾸로 하면 토큰 없이 두드려 보는
 * 쪽이 「400 이냐 401 이냐」로 통로가 살아 있는지를 알아낸다.
 *
 * ── 🔴 토큰의 쓰임새는 아직 알림 읽기 그대로다 ─────────────────────────────
 * 옆 승인함 통로와 **같은 판단**이다(그 파일의 같은 절). 쓰임새 글자는 포털과의 약속이라
 * `dss-auth` 가 굽기 시작한 뒤에야 여기서 요구할 수 있고, 먼저 바꾸면 승인함이 통째로 401 이
 * 된다. 세 집의 같은 통로를 함께 고치는 날 `dss.approvals.read` 로 옮긴다.
 * ============================================================================
 */

/** 🔴 이 응답이 캐시되면 남의 승인함에 남의 결재 내역이 남는다. 모든 답에 붙인다. */
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  try {
    const verified = await verifyPortalServiceToken(readBearerToken(request.headers.get("authorization")), PORTAL_TOKEN_PURPOSES.notificationsRead);
    if (!verified.ok) {
      // 🔴 왜 거절했는지는 밖으로 내보내지 않는다 — 부르는 쪽이 맞혀 가며 두드릴
      //    실마리가 된다. 까닭은 서버 로그에만 남는다(auth/portal-service-token.ts).
      return Response.json({ error: "invalid_token" }, { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } });
    }

    // 🔴 **쿼리에서 꺼내는 것은 이 둘뿐이다.** 사람을 고르는 열쇠를 여기 더하지 마라.
    const query = new URL(request.url).searchParams;
    const parsed = parseApprovalHistoryPeriod({ from: query.get("from"), to: query.get("to") });
    if (!parsed.ok) {
      // 🔴 **400 이다(500 이 아니다).** 포털은 둘을 다르게 다룬다 — 500 은 다시 보낼 만하고,
      //    400 은 다시 보내도 같다. 🔴 글자도 계약이다(`invalid_period`) — 까닭을 덧붙이지
      //    않는 것은 세 집이 **같은 몸통**을 돌려주기로 한 약속이기 때문이다.
      return Response.json({ error: "invalid_period" }, { status: 400, headers: NO_STORE });
    }

    const history = await buildPortalApprovalHistory({
      subject: verified.subject,
      period: parsed.period,
      baseUrl: env.ownBaseUrl,
      limit: PORTAL_APPROVAL_HISTORY_LIMIT,
      // 🔴 이 시스템에 계정이 없는 사람은 **빈 목록**이다 — 오류가 아니다. 포털은 세 집에
      //    같은 질문을 던지고, 한 집이 오류를 뱉으면 나머지 둘까지 못 그릴 수 있다.
      findActor: findActiveUserByAuthSub,
      // 🔴 갈래 판정을 새로 짓지 않는다 — 조각 10a 가 만든 조회를 **그대로** 넘긴다
      //    (approval/part-issue.ts). 감싸지 않고 함수 자체를 넘기는 것이 「여기서는 다르게
      //    센다」를 만들 자리가 없다는 뜻이다(옆 승인함 통로가 그 겹 때문에 한 번 틀렸다).
      listHistory: listPartIssueApprovalHistoryFor,
    });

    return Response.json(history, { headers: NO_STORE });
  } catch (e) {
    // 설정값이 빠졌거나(env 의 getter 가 던진다) 포털의 JWKS 를 못 읽었거나 DB 가 멎었다.
    // 안쪽 사정은 내보내지 않고 「지금은 안 된다」로만 답한다 — 포털은 이 집만 빼고 나머지를
    // 그린다.
    console.error("[integration] 결재 내역을 내주지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
