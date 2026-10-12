import { env } from "@/lib/env";
import { SSO_TX_TTL_SECONDS } from "./session-codec";

/**
 * 쿠키 이름은 이 시스템 고유값 (CLAUDE.md 13절). 🔴 쿠키는 포트를 가리지 않는다 —
 * 다른 사내 시스템과 같은 이름을 쓰면 한쪽 로그인이 다른 쪽을 덮는다. A/S 에서 실제로 났던 구멍.
 */
export const SESSION_COOKIE = "inventory_session";
export const SSO_TX_COOKIE = "inventory_sso_tx";
export const SERVICE_MENU_COOKIE = "inventory_service_menu";
/** 개발 전용 역할 바꿔 보기 (env.devRoleOverride 가 참일 때만 읽는다) */
export const DEV_ROLE_COOKIE = "inventory_dev_role";

/** 세션·메뉴바 쿠키 옵션. `secure` 는 HTTPS 뒤에서만 (6-7절). */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: env.sessionCookieSecure,
    maxAge: env.sessionHours * 3600,
  };
}

/** 로그인 왕복 쿠키는 /api/auth/sso 경로에만 붙인다 — 다른 요청에 실려 다닐 이유가 없다. */
export function ssoTxCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/api/auth/sso",
    secure: env.sessionCookieSecure,
    maxAge: SSO_TX_TTL_SECONDS,
  };
}

/** 지우기용 — 같은 path 로 지워야 브라우저가 같은 쿠키로 본다. */
export function expiredCookieOptions(path: string) {
  return { httpOnly: true, sameSite: "lax" as const, path, secure: env.sessionCookieSecure, maxAge: 0 };
}
