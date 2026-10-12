import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { OidcError, verifyLogoutToken } from "@/lib/auth/oidc";
import { invalidateSessions } from "@/lib/auth/users";

/**
 * 백채널 로그아웃 수신부 (CLAUDE.md 6-8절). 포털에서 로그아웃하면 포털 서버가 여기로 `logout_token` 을 POST 한다.
 *
 * - 누구나 두드릴 수 있는 주소다. **서명 검증이 전부**다. 쿠키·Origin 은 보지 않는다(브라우저가 아니라 포털 서버가 부른다).
 * - 성공은 204. 실패는 400 (OIDC Back-Channel Logout 1.0 §2.8).
 * - 개발 중에는 포털에 이 주소가 등록되어 있지 않아 호출되지 않는다. NAS 로 옮길 때 담당자가 등록한다 (DESIGN 10-2절).
 */
export async function POST(request: NextRequest) {
  let logoutToken: string | null = null;
  try {
    const form = await request.formData();
    const v = form.get("logout_token");
    logoutToken = typeof v === "string" && v !== "" ? v : null;
  } catch {
    logoutToken = null;
  }
  if (!logoutToken) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    const key = await verifyLogoutToken(logoutToken);
    const n = await invalidateSessions(key);
    void writeAudit({ action: "BACKCHANNEL_LOGOUT", detail: { sub: key.sub, sid: key.sid, affected: n } });
    if (n === 0) console.warn("[backchannel-logout] 해당하는 사용자 없음", key);
    return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.warn("[backchannel-logout] 거절:", e instanceof Error ? e.message : e);
    const code = e instanceof OidcError ? "invalid_request" : "server_error";
    return NextResponse.json({ error: code }, { status: code === "server_error" ? 500 : 400 });
  }
}
