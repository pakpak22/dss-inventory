import { NextResponse, type NextRequest } from "next/server";
import { SSO_TX_COOKIE, ssoTxCookieOptions } from "@/lib/auth/cookies";
import { buildAuthorizeUrl, getDiscovery, OidcError } from "@/lib/auth/oidc";
import { createPkcePair, randomToken } from "@/lib/auth/pkce";
import { encodeSsoTx, safeReturnTo } from "@/lib/auth/session-codec";

/**
 * 로그인 시작 (CLAUDE.md 6-2절 1~2번).
 * PKCE verifier·state·nonce 를 만들어 **서명된 10분짜리 쿠키**에 넣고 포털 /authorize 로 보낸다.
 * DB 표를 새로 만들지 않는다 (6-3절).
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  let discovery;
  try {
    discovery = await getDiscovery();
  } catch (e) {
    const code = e instanceof OidcError ? e.code : "server_error";
    console.error("[sso/start]", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL(`/login?error=${code}`, request.url));
  }

  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = randomToken(24);
  const nonce = randomToken(24);

  const res = NextResponse.redirect(buildAuthorizeUrl(discovery, { state, nonce, codeChallenge }));
  res.cookies.set(SSO_TX_COOKIE, encodeSsoTx({ state, nonce, codeVerifier, returnTo }), ssoTxCookieOptions());
  return res;
}
