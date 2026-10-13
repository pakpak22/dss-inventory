import { PORTAL_TOKEN_PURPOSES, readBearerToken, verifyPortalServiceToken, type PortalTokenPurpose, type PortalTokenResult } from "@/lib/auth/portal-service-token";
import { findActiveUserByAuthSub } from "@/lib/auth/users";
import { readPortalNotificationSettings, writePortalNotificationSettings, type PortalActor } from "@/lib/notifications/settings";

/**
 * ============================================================================
 * 알림 **설정**을 밖에서 읽고 쓰는 통로
 * ============================================================================
 * 🔴 **이 통로가 없으면 404 가 난다.** 포털(dss-auth)은 알림 통로를 가진 시스템에 주소를
 * 둘 물으러 온다 — 목록(`/api/integration/notifications`)과 설정(여기). 설정이 404 면
 * 포털 관리자 화면에서 재고 관리가 「지금은 불러올 수 없습니다」로 그려진다. **고장이
 * 아닌데 상한 것처럼 보인다.**
 *
 * 이 파일에는 **판단이 없다.** 머리말에서 토큰을 꺼내 검증하고, 사람을 되짚는 함수를
 * 쥐여 주고, 돌아온 답을 그대로 JSON 으로 옮길 뿐이다. 무엇을 내주고 무엇을 거절하는지는
 * 전부 lib/notifications/settings.ts 에 있다.
 *
 * ── 자격은 알림 목록 통로와 **같다** ────────────────────────────────────
 * 포털이 RS256 으로 서명한 Bearer 토큰이고 검증은 auth/portal-service-token.ts 하나가
 * 한다. 🔴 다만 **용도(purpose)가 다르다** — 알림을 읽으려고 구운 토큰으로 설정을 열거나
 * 고칠 수 없다(최소 권한). 읽기와 쓰기도 서로 다른 용도다.
 *
 * ── 🔴 쓰기는 PUT 이다 ──────────────────────────────────────────────────
 * 포털이 PUT 으로 보낸다(dss-auth 의 notifications/gather.ts 의 pushNotificationSettings).
 * 그리고 이 시스템은 **언제나 403 으로 거절한다** — 저장할 표가 없기 때문이고, 까닭은
 * lib 쪽 머리말에 적어 두었다. 포털은 403 을 정상 응답으로 다루고 우리가 보낸 문장을
 * 그 자리에 그린다.
 * ============================================================================
 */

/** 🔴 설정 표가 캐시되면 바뀐 규칙이 포털 화면에 옛말로 남는다. 모든 답에 붙인다. */
const NO_STORE = { "cache-control": "no-store" };

function invalidToken(): Response {
  // 🔴 왜 거절했는지는 밖으로 내보내지 않는다 — 맞혀 가며 두드릴 실마리가 된다.
  return Response.json({ error: "invalid_token" }, { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } });
}

function temporarilyUnavailable(e: unknown): Response {
  // 설정값이 빠졌거나(env 의 getter 가 던진다) 포털의 JWKS 를 못 읽었거나 DB 가 멎었다.
  console.error("[integration] 알림 설정 통로가 실패했습니다:", { name: e instanceof Error ? e.name : "unknown" });
  return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: NO_STORE });
}

/**
 * 포털 쪽 sub 로 이 시스템의 사람을 찾는다. 없으면 null.
 * 🔴 알림 목록 통로와 **같은 함수**를 부른다 — 한쪽만 느슨해지면 이 시스템에서 막힌
 * 사람이 포털에서는 통과한다.
 */
async function findActor(subject: string): Promise<PortalActor | null> {
  const user = await findActiveUserByAuthSub(subject);
  return user ? { id: user.id, role: user.role } : null;
}

/** 두 메서드가 같은 순서로 같은 것을 확인한다 — 한쪽만 느슨해지지 않게 묶어 둔다. */
async function authenticate(request: Request, purpose: PortalTokenPurpose): Promise<PortalTokenResult> {
  return verifyPortalServiceToken(readBearerToken(request.headers.get("authorization")), purpose);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const verified = await authenticate(request, PORTAL_TOKEN_PURPOSES.notificationSettingsRead);
    if (!verified.ok) return invalidToken();

    const result = await readPortalNotificationSettings({ subject: verified.subject, findActor });
    if (!result.ok) {
      return Response.json({ error: "forbidden", message: result.message }, { status: result.status, headers: NO_STORE });
    }
    return Response.json(result.value, { headers: NO_STORE });
  } catch (e) {
    return temporarilyUnavailable(e);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const verified = await authenticate(request, PORTAL_TOKEN_PURPOSES.notificationSettingsWrite);
    if (!verified.ok) return invalidToken();

    // 🔴 본문을 읽지 않는다. 어떤 값이 와도 저장하지 않으므로, 모양을 따져 400 을
    //    돌려주면 「모양만 맞추면 저장된다」는 거짓 신호를 준다. 답은 하나다 —
    //    이 시스템은 설정을 바꿀 수 없다.
    const result = await writePortalNotificationSettings({ subject: verified.subject, findActor });
    return Response.json({ error: "forbidden", message: result.message }, { status: result.status, headers: NO_STORE });
  } catch (e) {
    return temporarilyUnavailable(e);
  }
}
