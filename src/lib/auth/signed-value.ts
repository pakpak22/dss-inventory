import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 쿠키에 담는 값을 HMAC-SHA256 으로 서명한다. 세션 쿠키·로그인 왕복 쿠키·메뉴바 쿠키가 모두 이걸 쓴다.
 *
 * 왜 직접 만드나: 인증 라이브러리(NextAuth 등)는 금지이고(CLAUDE.md 5절), 필요한 것은
 * "서버가 쓴 값이 맞고, 아직 유효한가" 둘뿐이다. node:crypto 로 충분하다.
 *
 * 왜 서명하나: 서명하지 않으면 사용자가 `code_verifier` 를 바꿔치기해 PKCE 를 무력화하거나,
 * 세션 쿠키의 사용자 ID 를 고쳐 다른 사람이 될 수 있다 (6-3절).
 *
 * 형식: base64url(JSON payload) + "." + base64url(HMAC)
 * payload 에는 항상 `exp`(초 단위 epoch) 가 들어간다. 지난 값은 서명이 맞아도 버린다.
 */

export type SignedPayload<T> = T & { exp: number };

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signValue<T extends object>(payload: T, secret: string, ttlSeconds: number, now = Date.now()): string {
  const body: SignedPayload<T> = { ...payload, exp: Math.floor(now / 1000) + ttlSeconds };
  const encoded = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  return `${encoded}.${b64url(hmac(secret, encoded))}`;
}

/**
 * 서명과 만료를 확인하고 payload 를 돌려준다. 어긋나면 **예외 대신 null** — 쿠키가 깨진 것은
 * 사용자 잘못일 수 있고, 로그인 실패로 조용히 처리하면 된다 (6-4절 "예외를 밖으로 던지지 말고").
 */
export function verifyValue<T extends object>(token: string | undefined | null, secret: string, now = Date.now()): SignedPayload<T> | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expected: Buffer;
  let given: Buffer;
  try {
    expected = hmac(secret, encoded);
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const exp = (payload as { exp?: unknown }).exp;
  if (typeof exp !== "number" || exp * 1000 <= now) return null;
  return payload as SignedPayload<T>;
}
