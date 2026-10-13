import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { env } from "@/lib/env";
import type { LoginErrorCode } from "./errors";

/**
 * dss-auth(통합 로그인 포털)에 OIDC 클라이언트로 붙는 부분. CLAUDE.md 6절을 그대로 옮겼다.
 * 이 파일은 Next.js 를 모른다 — 쿠키·리다이렉트는 라우트 핸들러(src/app/api/auth/sso/*)가 한다.
 *
 * 🔴 엔드포인트 주소를 하드코딩하지 않는다. discovery 문서를 읽고 짧게 캐싱한다 (6-3절).
 */

export class OidcError extends Error {
  constructor(
    public readonly code: LoginErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = "OidcError";
  }
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  jwks_uri: string;
}

const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

type Cache = { discovery?: { value: Discovery; fetchedAt: number }; jwks?: JWTVerifyGetKey };
const cache = globalThis as unknown as { __dssInventoryOidc?: Cache };
function store(): Cache {
  return (cache.__dssInventoryOidc ??= {});
}

export async function getDiscovery(now = Date.now()): Promise<Discovery> {
  const c = store();
  if (c.discovery && now - c.discovery.fetchedAt < DISCOVERY_TTL_MS) return c.discovery.value;

  const url = `${env.ssoIssuer}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    // 담당자 PC 가 꺼져 있거나 주소가 바뀐 경우. 사용자에게는 "연결할 수 없음" 만 보인다.
    throw new OidcError("portal_unreachable", `discovery fetch failed: ${String(e)}`);
  }
  if (!res.ok) throw new OidcError("portal_unreachable", `discovery ${res.status}`);

  const json = (await res.json()) as Partial<Discovery>;
  if (!json.issuer || !json.authorization_endpoint || !json.token_endpoint || !json.jwks_uri) {
    throw new OidcError("portal_unreachable", "discovery 문서에 필요한 항목이 없음");
  }
  // iss 가 우리가 설정한 issuer 와 다르면 엉뚱한 서버다. 토큰 검증도 어차피 실패하지만 여기서 먼저 막는다.
  if (json.issuer.replace(/\/+$/, "") !== env.ssoIssuer) {
    throw new OidcError("portal_unreachable", `issuer 불일치: ${json.issuer}`);
  }
  const value = json as Discovery;
  c.discovery = { value, fetchedAt: now };
  return value;
}

/**
 * JWKS 는 한 번 만들어 재사용한다 — jose 가 캐시와 키 교체를 처리한다. 지연 생성 (6-4절).
 *
 * 🔴 **한 벌을 돌려쓴다.** ID 토큰·로그아웃 토큰과 포털 서비스 토큰(auth/portal-service-token.ts)이
 * 같은 캐시를 본다 — 두 벌로 나누면 포털이 열쇠를 바꾸는 날 한쪽만 늦게 따라간다.
 */
export function portalJwks(): JWTVerifyGetKey {
  const c = store();
  return (c.jwks ??= createRemoteJWKSet(new URL(`${env.ssoIssuer}/.well-known/jwks.json`), {
    timeoutDuration: FETCH_TIMEOUT_MS,
  }));
}

export const OIDC_SCOPE = "openid profile email";

export interface AuthorizeParams {
  state: string;
  nonce: string;
  codeChallenge: string;
}

/** /authorize 로 보낼 주소. PKCE S256 · nonce · state 전부 필수 (6-3절). */
export function buildAuthorizeUrl(discovery: Pick<Discovery, "authorization_endpoint">, p: AuthorizeParams): string {
  const u = new URL(discovery.authorization_endpoint);
  u.searchParams.set("client_id", env.ssoClientId);
  u.searchParams.set("redirect_uri", env.ssoRedirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", OIDC_SCOPE);
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** 인가 코드를 ID 토큰으로 바꾼다. 서버에서만 한다 — client_secret 이 들어간다 (6-2절 5번). */
export async function exchangeCode(
  discovery: Pick<Discovery, "token_endpoint">,
  code: string,
  codeVerifier: string,
): Promise<{ idToken: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.ssoRedirectUri,
    code_verifier: codeVerifier,
    client_id: env.ssoClientId,
    client_secret: env.ssoClientSecret,
  });
  let res: Response;
  try {
    res = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new OidcError("portal_unreachable", `token fetch failed: ${String(e)}`);
  }
  if (!res.ok) {
    // 본문에 포털의 error 코드가 있지만 사용자에게 보여 주지 않는다. 서버 로그용으로만 담는다.
    const text = await res.text().catch(() => "");
    throw new OidcError("token_exchange_failed", `token ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id_token?: unknown };
  if (typeof json.id_token !== "string" || json.id_token === "") {
    throw new OidcError("token_exchange_failed", "id_token 없음");
  }
  return { idToken: json.id_token };
}

/** 포털 메뉴바(@dss/ui)가 쓰는 시스템 목록 항목. ID 토큰의 dss_services 클레임 (6-5절). */
export interface DssService {
  id: string;
  name: string;
  url: string;
  icon?: string;
}

/**
 * ID 토큰에서 꺼낸 것. 🔴 `email` 과 `role` 은 "없으면 키 자체가 없다" — undefined 와 빈 값을 가른다.
 * 부서·사번은 실려 오지 않는다.
 */
export interface IdTokenClaims {
  sub: string;
  sid?: string;
  name: string;
  email?: string;
  /** 키가 없으면 undefined. 값이 있으면 그대로(검증은 decideRole 이 한다) */
  role: unknown;
  roleClaimPresent: boolean;
  dssServices: DssService[];
  /** 토큰 만료(초). 세션 수명 참고용 */
  exp?: number;
}

/**
 * ID 토큰 검증 — 하나라도 빠뜨리면 안 된다 (6-4절).
 * `keySet` 은 테스트에서 로컬 키를 넣기 위한 것이고, 실제로는 포털 JWKS 다.
 */
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
  keySet: JWTVerifyGetKey = portalJwks(),
): Promise<IdTokenClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, keySet, {
      issuer: env.ssoIssuer, // 끝 슬래시까지 정확히 일치
      audience: env.ssoClientId,
      algorithms: ["RS256"], // none · HS256 거부
      clockTolerance: 30,
    }));
  } catch (e) {
    throw new OidcError("invalid_id_token", `jwtVerify: ${e instanceof Error ? e.message : String(e)}`);
  }
  // 🔴 nonce 는 jose 가 보지 않는다. 직접 대조 — 빼면 ID 토큰 재사용 구멍.
  if (payload.nonce !== expectedNonce) throw new OidcError("invalid_id_token", "nonce 불일치");
  if (typeof payload.sub !== "string" || payload.sub === "") throw new OidcError("invalid_id_token", "sub 없음");

  const name =
    typeof payload.name === "string" && payload.name.trim() !== ""
      ? payload.name.trim()
      : typeof payload.preferred_username === "string" && payload.preferred_username.trim() !== ""
        ? payload.preferred_username.trim()
        : "(이름 없음)";

  const roleClaimPresent = Object.prototype.hasOwnProperty.call(payload, "role");

  return {
    sub: payload.sub,
    sid: typeof payload.sid === "string" ? payload.sid : undefined,
    name,
    email: typeof payload.email === "string" && payload.email !== "" ? payload.email : undefined,
    role: roleClaimPresent ? payload.role : undefined,
    roleClaimPresent,
    dssServices: normalizeServices(payload.dss_services),
    exp: payload.exp,
  };
}

function normalizeServices(raw: unknown): DssService[] {
  if (!Array.isArray(raw)) return [];
  const out: DssService[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string" || typeof o.url !== "string") continue;
    out.push({ id: o.id, name: o.name, url: o.url, icon: typeof o.icon === "string" ? o.icon : undefined });
  }
  return out;
}

/**
 * 백채널 로그아웃 토큰 검증 (6-8절). 누구나 두드릴 수 있는 주소라 **서명 검증이 전부**다.
 * - `nonce` 가 있으면 거절 (ID 토큰을 밀어넣는 공격 방지)
 * - `events` 에 backchannel-logout 이벤트 필수
 * - `sub` 또는 `sid` 중 하나는 있어야 한다
 */
export const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

export async function verifyLogoutToken(
  logoutToken: string,
  keySet: JWTVerifyGetKey = portalJwks(),
): Promise<{ sub?: string; sid?: string }> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(logoutToken, keySet, {
      issuer: env.ssoIssuer,
      audience: env.ssoClientId,
      algorithms: ["RS256"],
      clockTolerance: 30,
    }));
  } catch (e) {
    throw new OidcError("invalid_id_token", `logout_token: ${e instanceof Error ? e.message : String(e)}`);
  }
  if ("nonce" in payload) throw new OidcError("invalid_id_token", "logout_token 에 nonce 가 있음");
  const events = payload.events;
  if (typeof events !== "object" || events === null || !(BACKCHANNEL_EVENT in (events as object))) {
    throw new OidcError("invalid_id_token", "logout_token 에 backchannel-logout 이벤트 없음");
  }
  const sub = typeof payload.sub === "string" && payload.sub !== "" ? payload.sub : undefined;
  const sid = typeof payload.sid === "string" && payload.sid !== "" ? payload.sid : undefined;
  if (!sub && !sid) throw new OidcError("invalid_id_token", "logout_token 에 sub·sid 둘 다 없음");
  return { sub, sid };
}

/**
 * 포털 로그아웃 주소(`end_session_endpoint`). 여기로 보내면 포털의 SSO 세션까지 끊긴다.
 * discovery 에 그 항목이 없으면 null — 부르는 쪽이 물러설 길을 고른다.
 *
 * 🔴 **돌아갈 주소(`post_logout_redirect_uri`)를 붙이지 않는다.** 포털은 `id_token_hint` 와
 * `post_logout_redirect_uri` 가 **둘 다** 있을 때만 그 주소로 돌려보내고, 아니면 자기 로그인
 * 화면에 머물게 한다. 로그아웃한 사람이 있어야 할 곳이 바로 거기다 — 재고 로그인 화면으로
 * 돌아오면 「포털로 가세요」 한 장을 더 거칠 뿐이고, 공용 PC 에서는 방금 모든 시스템에서
 * 나간 사람을 다시 이 사이트 앞에 세우는 꼴이 된다.
 * 애초에 붙일 수도 없다: 이 시스템은 id_token 을 어디에도 보관하지 않아(콜백이 검증만 하고
 * 버린다) `id_token_hint` 를 만들 수 없다.
 *
 * 🔵 discovery 를 못 읽으면 `getDiscovery` 가 `OidcError("portal_unreachable")` 를 던진다.
 * 그 경우에도 **이 사이트에서는 이미 나가 있어야** 하므로, 부르는 쪽이 세션을 먼저 끊고
 * 나서 이 함수를 부른다 (actions/auth.ts).
 */
export async function buildLogoutUrl(): Promise<string | null> {
  const discovery = await getDiscovery();
  if (!discovery.end_session_endpoint) return null;

  const u = new URL(discovery.end_session_endpoint);
  u.searchParams.set("client_id", env.ssoClientId);
  return u.toString();
}
