import type { Role } from "@/db/schema/users";
import { env } from "@/lib/env";
import { signValue, verifyValue } from "./signed-value";

/**
 * 이 시스템만의 세션 값 (CLAUDE.md 6-7절). 포털의 dss_sso 쿠키는 읽지 않는다.
 *
 * 쿠키에는 서명된 이 payload 만 들어간다. 역할·이름은 **표시와 빠른 판정용 사본**이고,
 * 진짜 판정은 매 요청마다 DB 의 users 를 다시 읽어서 한다 (session.ts) — 백채널 로그아웃이
 * `sessions_valid_from` 을 올리면 즉시 끊겨야 하기 때문. "성능" 으로 DB 읽기를 걷어내지 마라 (6-8절).
 */
export interface SessionPayload {
  /** users.id */
  uid: string;
  /** 포털 sub — 백채널 로그아웃 대조용 */
  sub: string;
  /** 포털 세션 id (있으면) */
  sid?: string;
  name: string;
  role: Role;
  /** 발급 시각(ms). users.sessions_valid_from 과 비교한다 */
  iat: number;
}

export function encodeSession(p: SessionPayload, now = Date.now()): string {
  return signValue(p, env.authSessionSecret, env.sessionHours * 3600, now);
}

export function decodeSession(token: string | undefined | null, now = Date.now()): SessionPayload | null {
  const v = verifyValue<SessionPayload>(token, env.authSessionSecret, now);
  if (!v) return null;
  if (typeof v.uid !== "string" || typeof v.sub !== "string" || typeof v.iat !== "number") return null;
  return v;
}

/** 로그인 왕복 쿠키 — /api/auth/sso/start 가 쓰고 callback 이 읽는다. 10분. (6-3절) */
export interface SsoTxPayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** 로그인 뒤 돌아갈 경로 (같은 사이트의 경로만) */
  returnTo: string;
}

export const SSO_TX_TTL_SECONDS = 10 * 60;

export function encodeSsoTx(p: SsoTxPayload, now = Date.now()): string {
  return signValue(p, env.ssoTxSecret, SSO_TX_TTL_SECONDS, now);
}

export function decodeSsoTx(token: string | undefined | null, now = Date.now()): SsoTxPayload | null {
  const v = verifyValue<SsoTxPayload>(token, env.ssoTxSecret, now);
  if (!v) return null;
  if (typeof v.state !== "string" || typeof v.nonce !== "string" || typeof v.codeVerifier !== "string") return null;
  return { state: v.state, nonce: v.nonce, codeVerifier: v.codeVerifier, returnTo: safeReturnTo(v.returnTo) };
}

/**
 * 로그인 뒤 돌아갈 곳은 **이 사이트 안의 경로**만 허용한다. 바깥 주소나 `//evil` 같은 값을 넣어
 * 로그인 직후 다른 사이트로 보내는 열린 리다이렉트를 막는다.
 */
export function safeReturnTo(v: unknown): string {
  if (typeof v !== "string") return "/";
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  if (v.startsWith("/api/") || v.startsWith("/login")) return "/";
  return v;
}
