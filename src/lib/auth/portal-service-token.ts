import { jwtVerify, type JWTPayload } from "jose";
import { env } from "@/lib/env";
import { portalJwks } from "./oidc";

/**
 * ============================================================================
 * 포털이 **사람 대신** 이 시스템에 물으러 올 때의 자격 — 서명 토큰
 * ============================================================================
 * 통합 알림 종은 포털(dss-auth)이 등록된 시스템마다 「이 사람의 지금 알림 내놔」라고
 * 물어 모은다. 그 통로(api/integration/notifications)는 **남의 알림을 볼 수 있는 문**
 * 이므로, 이 파일의 검증이 그 문의 전부다.
 *
 * 🔴 **방향이 반대인 길과 헷갈리지 말 것.** 이 시스템이 포털에 묻는 길
 * (notifications/portal.ts)은 자격이 `client_secret`(Basic)이고 메서드가 POST 다.
 * `dss-auth/docs/사이트-알림-통로.md` 가 적은 것이 그쪽이다. **이 파일은 그 반대 방향**
 * — 포털이 RS256 으로 서명한 토큰을 들고 우리에게 **GET** 으로 오는 길이고, 우리는
 * 포털의 공개키(JWKS)로 검증만 한다.
 *
 * 새로 설계하지 않았다 — 사내 게시판(dss-board)·개선요청(dss-improvements)·A/S
 * (RF_Service_System)의 같은 이름 파일과 한 글자씩 맞춘 것이고, 굽는 쪽(dss-auth 의
 * lib/oidc/service-token.ts)이 요구하는 것을 그대로 받는다.
 *
 * 확인하는 것 여덟:
 *  1. **서명** — 우리가 아는 포털의 공개키(JWKS)로만 검증된다.
 *  2. **발급자**(iss) — 우리가 아는 포털이어야 한다.
 *  3. **수신자**(aud) — 우리 client_id(`dss-inventory`)여야 한다. 다른 시스템에 발급된
 *     토큰을 여기로 들이밀 수 없다.
 *  4. **만료**(exp) — 없으면 거절한다. 🔴 jose 는 exp 가 아예 없으면 「만료 없음」으로
 *     **통과시킨다.** 영원히 사는 토큰은 한 번 새면 영원히 새는 문이다.
 *  5. **수명** — `exp − iat` 가 상한(600초)을 넘으면 거절한다. 짧게 굽는 것은 포털의
 *     몫이지만(지금 120초), 규율은 받는 쪽에서도 한 번 못 박는다.
 *  6. **nonce 가 없을 것** — 있으면 ID 토큰이다. 로그인 때 받은 ID 토큰을 이 통로에
 *     재사용하지 못하게 한다(verifyLogoutToken 이 긋는 줄과 같다).
 *  7. **용도**(purpose) — 이 통로를 위해 구운 토큰인가. 알림을 읽으려고 구운 토큰으로
 *     설정을 고칠 수 없어야 한다(최소 권한).
 *  8. **sub 가 있을 것** — 🔴 **누구의 알림인지는 토큰 안에서만 온다.** 쿼리 문자열로
 *     받으면 토큰 하나로 아무 사람의 알림이나 볼 수 있다.
 *
 * ⚠️ 한 번 쓴 토큰을 다시 쓰는 것(replay)은 막지 않는다 — 쓴 jti 를 적어 둘 표가
 * 필요하고 이번 조각은 스키마를 건드리지 않는다. 수명이 짧고(5번) 토큰이 오가는 곳이
 * 사내망 안의 서버끼리라 지금은 수명으로 막는다. 사내망 밖으로 나가면 다시 볼 것.
 *
 * ⚠️ `server-only` 를 import 하지 않는다 — 이 저장소에는 그 패키지가 있지만, 넣으면
 * 위 여덟 가지를 시험할 수 없게 된다. 대신 **열쇠·발급자·수신자를 인자로 받는 함수**로
 * 판정을 빼 두어 네트워크 없이 그대로 돌려 본다(tests/portal-service-token.test.ts).
 * 하나만 틀려도 모든 통합 알림이 조용히 401 이 되는 값이다.
 * ============================================================================
 */

/**
 * 토큰이 무엇을 하러 왔는가. 통로마다 다른 값을 요구한다.
 *
 * 🔴 이 글자들은 **포털의 PORTAL_SERVICE_TOKEN_PURPOSES 와, 다른 사내 시스템들의
 * PORTAL_TOKEN_PURPOSES 와 똑같아야 한다.** 한쪽만 바꾸면 그 통로만 401 이 되고,
 * 증상은 「알림이 안 온다」 하나로 뭉뚱그려진다. 저장소가 여럿이라 컴파일러가 잡아
 * 주지 못하는 자리다 — 고칠 때는 모두 함께.
 */
export const PORTAL_TOKEN_PURPOSES = {
  /** 「이 사람의 지금 알림」 읽기. */
  notificationsRead: "dss.notifications.read",
  /** 알림 설정 읽기. */
  notificationSettingsRead: "dss.notification-settings.read",
  /** 알림 설정 저장. */
  notificationSettingsWrite: "dss.notification-settings.write",
} as const;

export type PortalTokenPurpose = (typeof PORTAL_TOKEN_PURPOSES)[keyof typeof PORTAL_TOKEN_PURPOSES];

/**
 * 토큰 수명의 상한(초). 포털은 이보다 짧게 구워야 한다(지금 120초).
 * 🔴 다른 사내 시스템과 **같은 값**이다.
 */
export const PORTAL_TOKEN_MAX_LIFETIME_SECONDS = 600;

/** 서버 둘의 시계가 조금 어긋나도 통과시킨다. oidc.ts 의 clockTolerance 와 같은 값. */
export const PORTAL_TOKEN_CLOCK_TOLERANCE_SECONDS = 30;

/** 왜 거절했는가. 🔴 부르는 쪽으로는 내보내지 않는다 — 서버 로그에만 남긴다. */
export type PortalTokenRejection = "missing_token" | "invalid_token" | "id_token" | "wrong_purpose" | "lifetime_too_long" | "no_subject";

export type PortalTokenResult =
  | {
      ok: true;
      /** 🔴 포털 쪽 사용자 id(= ID 토큰의 sub). 이 시스템의 `users.id` 가 **아니다**(users.auth_sub 다). */
      subject: string;
      payload: JWTPayload;
    }
  | { ok: false; reason: PortalTokenRejection };

/**
 * 검증에 쓸 열쇠. 실제로는 포털의 JWKS 이고, 시험에서는 그 자리에 직접 만든 열쇠를 넣는다 —
 * 그래야 「서명이 틀린 토큰」·「만료된 토큰」·「nonce 가 있는 토큰」을 망 없이 돌려 볼 수 있다.
 */
type VerifyKey = Parameters<typeof jwtVerify>[1];

/**
 * 열쇠·발급자·수신자를 **인자로 받아** 검증한다. 판정이 전부 여기 있고, 환경을 읽는 것은
 * 아래 wrapper 하나뿐이다.
 */
export async function verifyPortalTokenWithKey(params: {
  token: string | null;
  key: VerifyKey;
  issuer: string;
  audience: string;
  purpose: PortalTokenPurpose;
}): Promise<PortalTokenResult> {
  if (params.token === null || params.token === "") {
    return { ok: false, reason: "missing_token" };
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(params.token, params.key, {
      issuer: params.issuer,
      audience: params.audience,
      // 🔴 none·HS256 을 받아들이지 않는다. oidc.ts 가 ID 토큰과 로그아웃 토큰에 똑같이 긋는
      //    줄이고, 포털은 세 가지 모두 RS256 으로 굽는다.
      algorithms: ["RS256"],
      clockTolerance: PORTAL_TOKEN_CLOCK_TOLERANCE_SECONDS,
      // 🔴 없으면 「검사할 것이 없다」가 되어 통과한다. 셋 다 반드시 있어야 한다.
      requiredClaims: ["exp", "iat", "sub"],
    }));
  } catch (e) {
    // 🔴 토큰 자체를 찍지 않는다 — 접근 로그에 남으면 그것으로 다시 부를 수 있다.
    //    jose 의 code 는 정해진 글자(ERR_JWT_EXPIRED 등)라 값이 새지 않으면서
    //    「서명이 틀린 것」과 「만료된 것」을 갈라 준다.
    console.error("[portal-token] 토큰 검증 실패:", {
      name: e instanceof Error ? e.name : "unknown",
      code: e instanceof Error && "code" in e ? String(e.code) : "unknown",
    });
    return { ok: false, reason: "invalid_token" };
  }

  // jwtVerify 는 서명·iss·aud·exp 까지만 본다. 아래는 우리가 따로 요구한다.

  if (payload.nonce !== undefined) {
    console.error("[portal-token] nonce 가 있는 토큰입니다(ID 토큰일 수 있음).");
    return { ok: false, reason: "id_token" };
  }

  if (payload.purpose !== params.purpose) {
    console.error("[portal-token] 이 통로의 토큰이 아닙니다.");
    return { ok: false, reason: "wrong_purpose" };
  }

  // requiredClaims 가 둘 다 있음을 보장하므로 숫자로 읽을 수 있다.
  const lifetime = Number(payload.exp) - Number(payload.iat);
  if (!Number.isFinite(lifetime) || lifetime > PORTAL_TOKEN_MAX_LIFETIME_SECONDS) {
    console.error("[portal-token] 토큰 수명이 너무 깁니다.");
    return { ok: false, reason: "lifetime_too_long" };
  }

  if (typeof payload.sub !== "string" || payload.sub === "") {
    console.error("[portal-token] sub 가 없습니다.");
    return { ok: false, reason: "no_subject" };
  }

  return { ok: true, subject: payload.sub, payload };
}

/**
 * 실제 요청이 쓰는 입구 — 환경에서 발급자·수신자를, oidc.ts 의 JWKS 캐시에서 공개키를 읽어
 * 위 판정에 넘긴다.
 *
 * 🔴 **JWKS 한 벌을 돌려쓴다.** 열쇠를 새로 만들지 않고 ID 토큰·로그아웃 토큰이 쓰는 그
 * 캐시(auth/oidc.ts 의 portalJwks)를 그대로 부른다 — 두 벌로 나누면 캐시도 두 벌이 되고,
 * 포털이 열쇠를 바꾸는 날 한쪽만 늦게 따라간다.
 */
export async function verifyPortalServiceToken(token: string | null, purpose: PortalTokenPurpose): Promise<PortalTokenResult> {
  return verifyPortalTokenWithKey({
    token,
    key: portalJwks(),
    // 🔴 iss 는 env 값 그대로 쓴다(끝 슬래시까지). verifyIdToken 과 같은 줄이다.
    issuer: env.ssoIssuer,
    audience: env.ssoClientId,
    purpose,
  });
}

/**
 * `Authorization: Bearer <토큰>` 에서 토큰만 꺼낸다. 머리말이 없거나 모양이 다르면 null —
 * 부르는 쪽에는 「토큰 없음」과 같은 답을 준다.
 *
 * 토큰을 쿼리 문자열이 아니라 머리말로 받는 이유: 쿼리는 서버 접근 로그와 브라우저
 * 히스토리에 그대로 남는다.
 */
export function readBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorizationHeader);
  return match ? match[1] : null;
}
