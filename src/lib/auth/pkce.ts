import { createHash, randomBytes } from "node:crypto";

/**
 * PKCE(S256) 와 state·nonce 생성. 포털은 `plain` 을 지원하지 않고 S256 만 받는다 (CLAUDE.md 6-3절).
 * RFC 7636: verifier 는 43~128자의 [A-Za-z0-9-._~]. base64url(32바이트) = 43자라 딱 맞는다.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function codeChallengeS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomToken(32);
  return { codeVerifier, codeChallenge: codeChallengeS256(codeVerifier) };
}
