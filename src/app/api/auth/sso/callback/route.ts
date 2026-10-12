import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import {
  SERVICE_MENU_COOKIE,
  SESSION_COOKIE,
  SSO_TX_COOKIE,
  expiredCookieOptions,
  sessionCookieOptions,
} from "@/lib/auth/cookies";
import type { LoginErrorCode } from "@/lib/auth/errors";
import { exchangeCode, getDiscovery, OidcError, verifyIdToken } from "@/lib/auth/oidc";
import { encodeServiceMenu } from "@/lib/auth/service-menu-cookie";
import { decodeSsoTx, encodeSession } from "@/lib/auth/session-codec";
import { upsertUserFromLogin } from "@/lib/auth/users";

/**
 * 포털에서 돌아오는 곳 (CLAUDE.md 6-2절 4~6번). 등록된 redirect_uri 와 글자 단위로 같아야 한다:
 * http://localhost:3800/api/auth/sso/callback
 *
 * 실패는 전부 /login?error=<code> 로 보낸다. 상세 사유는 서버 로그·감사 로그에만 남긴다 (6-4절).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const txCookie = request.cookies.get(SSO_TX_COOKIE)?.value;

  const fail = (code: LoginErrorCode, detail: string, extra?: Record<string, unknown>) => {
    console.warn(`[sso/callback] ${code}: ${detail}`);
    void writeAudit({ action: "LOGIN_REJECTED", detail: { code, detail, ...extra } });
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, request.url));
    res.cookies.set(SSO_TX_COOKIE, "", expiredCookieOptions("/api/auth/sso"));
    return res;
  };

  const tx = decodeSsoTx(txCookie);
  if (!tx) return fail("tx_expired", "왕복 쿠키 없음 또는 만료");

  // 포털이 거절한 경우 (접근 허가 없음 등)
  const portalError = q.get("error");
  if (portalError) return fail("portal_denied", `portal error=${portalError} ${q.get("error_description") ?? ""}`);

  const state = q.get("state") ?? "";
  const code = q.get("code") ?? "";
  if (!safeEqual(state, tx.state)) return fail("state_mismatch", "state 불일치");
  if (!code) return fail("token_exchange_failed", "code 없음");

  try {
    const discovery = await getDiscovery();
    const { idToken } = await exchangeCode(discovery, code, tx.codeVerifier);
    const claims = await verifyIdToken(idToken, tx.nonce);

    const result = await upsertUserFromLogin(claims);
    if (!result.ok) return fail(result.code, result.detail, { sub: claims.sub, name: claims.name });

    const now = Date.now();
    const session = encodeSession(
      { uid: result.user.id, sub: claims.sub, sid: claims.sid, name: result.user.name, role: result.user.role, iat: now },
      now,
    );

    void writeAudit({
      action: "LOGIN",
      actorId: result.user.id,
      actorName: result.user.name,
      target: `users:${result.user.id}`,
      detail: { role: result.user.role, roleClaimPresent: claims.roleClaimPresent },
    });

    const res = NextResponse.redirect(new URL(tx.returnTo, request.url));
    res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
    res.cookies.set(SERVICE_MENU_COOKIE, encodeServiceMenu(claims.dssServices, now), sessionCookieOptions());
    res.cookies.set(SSO_TX_COOKIE, "", expiredCookieOptions("/api/auth/sso"));
    return res;
  } catch (e) {
    if (e instanceof OidcError) return fail(e.code, e.message);
    return fail("server_error", e instanceof Error ? e.message : String(e));
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}
