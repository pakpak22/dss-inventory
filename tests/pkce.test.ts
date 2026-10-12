import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeChallengeS256, createPkcePair, randomToken } from "../src/lib/auth/pkce";

describe("PKCE S256", () => {
  it("RFC 7636 부록 B 의 예시와 같다", () => {
    // verifier → challenge 예시 (RFC 7636 Appendix B)
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    assert.equal(codeChallengeS256(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("verifier 는 43자 이상의 허용 문자만", () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    assert.ok(codeVerifier.length >= 43 && codeVerifier.length <= 128);
    assert.match(codeVerifier, /^[A-Za-z0-9\-._~]+$/);
    assert.equal(codeChallenge, codeChallengeS256(codeVerifier));
  });
  it("randomToken 은 매번 다르다", () => {
    assert.notEqual(randomToken(), randomToken());
  });
});
