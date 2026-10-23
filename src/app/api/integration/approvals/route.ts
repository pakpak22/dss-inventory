import { PORTAL_TOKEN_PURPOSES, readBearerToken, verifyPortalServiceToken } from "@/lib/auth/portal-service-token";
import { findActiveUserByAuthSub } from "@/lib/auth/users";
import { listPartIssueApprovalsToDecide } from "@/lib/approval/part-issue";
import { env } from "@/lib/env";
import { buildPortalApprovalInbox } from "@/lib/notifications/portal-approvals";

/**
 * ============================================================================
 * 「이 사람이 결재할 불출 신청」을 밖으로 내주는 통로 — 통합 승인함이 쓴다
 * ============================================================================
 * 새 사이트 `dss-approvals`(통합 승인함)가 사내 시스템마다 이 통로에 물어 한 창에
 * 모은다. 응답의 모양과 판단은 전부 notifications/portal-approvals.ts 에 있고,
 * 여기 남은 일은 「머리말에서 토큰 꺼내 검증하고 그 함수 부르기」뿐이다.
 *
 * 🔴 **틀은 알림 통로(../notifications/route.ts)를 그대로 따른다.** 왜 그래야
 * 하는지는 그 파일의 주석에 다 적혀 있다 — 여기서는 같은 규칙을 다시 못 박는
 * 것뿐이다:
 *  · 대상 사용자는 **토큰 안에서만** 온다. 쿼리 문자열을 읽지 않는다 — 읽으면
 *    토큰 하나로 **아무의 결재함이나** 볼 수 있는 문이 된다.
 *  · 링크는 절대 주소다. 기준 주소는 요청의 Host 가 아니라 환경에서 온다
 *    (env.ts 의 env.ownBaseUrl).
 *  · 응답을 캐시하지 않는다. 처리한 결재가 남의 승인함에 계속 남으면 안 된다.
 *  · GET 인 것은 읽기뿐이기 때문이고, 토큰을 쿼리가 아니라 `Authorization`
 *    머리말로 받는 것은 쿼리가 접근 로그에 그대로 남기 때문이다.
 *
 * 🔴 **승인·반려를 실행하는 길은 여기 없다.** 이 통로는 읽기 전용이고,
 * [승인하기] 는 `href` 가 가리키는 이 시스템의 결재 화면으로 **건너가기만**
 * 한다(2026-10-23 사용자 결정). 그래서 이 파일에 POST 가 없다.
 *
 * ── 🔴 토큰의 쓰임새는 아직 알림 읽기 그대로다 ──────────────────────────
 * `PORTAL_TOKEN_PURPOSES.notificationsRead` 를 요구한다. 「결재할 건」은 종과
 * 다른 것이라 쓰임새를 따로 두는 편이 최소 권한에 맞지만, 쓰임새 글자는 포털과의
 * **약속**이라 `dss-auth` 가 그 값을 굽기 시작한 뒤에야 여기서 요구할 수 있다
 * (먼저 바꾸면 승인함이 통째로 401 이 된다). A/S(RF_Service_System)·휴가
 * (dss-leave)의 같은 통로도 같은 판단으로 같은 쓰임새를 쓴다 — 양쪽을 함께 고치는
 * 날 `dss.approvals.read` 로 옮긴다.
 * 🔵 지금 상태가 새 자료를 여는 것은 아니다 — 이 통로가 내주는 결재는 종이 이미
 * 같은 토큰으로 내주던 그 사람 자신의 건이고, 자격 판정도 같은 조회가 한다.
 * ============================================================================
 */

/** 🔴 이 응답이 캐시되면 처리한 결재가 남의 승인함에 계속 남는다. 모든 답에 붙인다. */
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  try {
    const verified = await verifyPortalServiceToken(readBearerToken(request.headers.get("authorization")), PORTAL_TOKEN_PURPOSES.notificationsRead);
    if (!verified.ok) {
      // 🔴 왜 거절했는지는 밖으로 내보내지 않는다 — 부르는 쪽이 맞혀 가며 두드릴
      //    실마리가 된다. 까닭은 서버 로그에만 남는다(auth/portal-service-token.ts).
      return Response.json({ error: "invalid_token" }, { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } });
    }

    const inbox = await buildPortalApprovalInbox({
      subject: verified.subject,
      baseUrl: env.ownBaseUrl,
      // 🔴 이 시스템에 계정이 없는 사람은 **빈 목록**이다 — 오류가 아니다. 포털은
      //    여러 시스템에 같은 질문을 던지고, 재고 관리는 「지정된 사람만」 들어온다.
      findActor: findActiveUserByAuthSub,
      // 🔴 자격 판정을 새로 짓지 않는다 — 승인 요청건(/approvals) 화면 · 알림 종이
      //    이미 쓰고 있는 조회를 그대로 넘긴다(approval/part-issue.ts).
      listPendingApprovals: listPartIssueApprovalsToDecide,
    });

    return Response.json(inbox, { headers: NO_STORE });
  } catch (e) {
    // 설정값이 빠졌거나(env 의 getter 가 던진다) 포털의 JWKS 를 못 읽었거나 DB 가 멎었다.
    // 안쪽 사정은 내보내지 않고 「지금은 안 된다」로만 답한다 — 포털은 이 줄만 빼고
    // 나머지를 그린다.
    console.error("[integration] 승인함 목록을 내주지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
