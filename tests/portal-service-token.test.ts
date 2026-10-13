import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import {
  PORTAL_TOKEN_MAX_LIFETIME_SECONDS,
  PORTAL_TOKEN_PURPOSES,
  readBearerToken,
  verifyPortalTokenWithKey,
  type PortalTokenPurpose,
} from "../src/lib/auth/portal-service-token";

/**
 * 포털이 **사람 대신** 물으러 올 때의 자격. 이 통로는 **남의 알림을 볼 수 있는 문**이라
 * 이 검증이 그 문의 전부다. 하나만 틀려도 모든 통합 알림이 조용히 401 이 되는 값이다.
 *
 * 🔴 망을 타지 않는다 — 열쇠를 여기서 직접 만들어 넣는다(verifyPortalTokenWithKey).
 */

const ISSUER = "http://portal.test:3100";
const AUDIENCE = "dss-inventory";
const READ: PortalTokenPurpose = PORTAL_TOKEN_PURPOSES.notificationsRead;

let key: JWTVerifyGetKey;
let otherKey: JWTVerifyGetKey;
let portalPrivateKey: CryptoKey;
let sign: (claims: Record<string, unknown>, over?: { issuer?: string; audience?: string; exp?: string | number; iat?: number; noExp?: boolean }) => Promise<string>;

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  key = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", use: "sig", kid: "k1" }] });
  portalPrivateKey = privateKey;

  const other = await generateKeyPair("RS256");
  otherKey = createLocalJWKSet({ keys: [{ ...(await exportJWK(other.publicKey)), alg: "RS256", use: "sig", kid: "k2" }] });

  sign = async (claims, over = {}) => {
    let jwt = new SignJWT({ purpose: READ, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(over.issuer ?? ISSUER)
      .setAudience(over.audience ?? AUDIENCE)
      .setSubject(typeof claims.sub === "string" ? claims.sub : "portal-user-1")
      .setIssuedAt(over.iat);
    if (!over.noExp) jwt = jwt.setExpirationTime(over.exp ?? "2m");
    return jwt.sign(privateKey);
  };
});

async function verify(token: string | null, purpose: PortalTokenPurpose = READ, verifyKey?: JWTVerifyGetKey) {
  return verifyPortalTokenWithKey({ token, key: verifyKey ?? key, issuer: ISSUER, audience: AUDIENCE, purpose });
}

describe("통과하는 토큰", () => {
  it("포털이 제대로 구운 토큰은 sub 를 내준다", async () => {
    const result = await verify(await sign({ sub: "portal-user-1" }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.subject, "portal-user-1");
  });
});

describe("거절하는 여덟 가지", () => {
  it("1. 토큰이 없으면", async () => {
    assert.deepEqual(await verify(null), { ok: false, reason: "missing_token" });
    assert.deepEqual(await verify(""), { ok: false, reason: "missing_token" });
  });

  it("2. 서명이 우리가 아는 포털의 것이 아니면", async () => {
    const result = await verify(await sign({}), READ, otherKey);
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  });

  it("3. 발급자(iss)가 다르면", async () => {
    const result = await verify(await sign({}, { issuer: "http://가짜:3100" }));
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  });

  it("4. 수신자(aud)가 우리가 아니면 — 다른 시스템의 토큰을 들이밀 수 없다", async () => {
    const result = await verify(await sign({}, { audience: "dss-board" }));
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  });

  it("5. exp 가 아예 없으면 — 🔴 jose 는 그냥 통과시킨다", async () => {
    const result = await verify(await sign({}, { noExp: true }));
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  });

  it("5-1. 만료된 토큰이면(시계 오차 30초보다 멀리)", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    const result = await verify(await sign({}, { iat: past, exp: past + 60 }));
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  });

  it("6. 수명이 상한을 넘으면 — 새어 나간 토큰이 오래 쓸모 있으면 안 된다", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tooLong = await sign({}, { iat: now, exp: now + PORTAL_TOKEN_MAX_LIFETIME_SECONDS + 10 });
    assert.deepEqual(await verify(tooLong), { ok: false, reason: "lifetime_too_long" });

    const atLimit = await sign({}, { iat: now, exp: now + PORTAL_TOKEN_MAX_LIFETIME_SECONDS });
    assert.equal((await verify(atLimit)).ok, true);
  });

  it("7. nonce 가 있으면 — 로그인 때 받은 ID 토큰을 이 통로에 재사용할 수 없다", async () => {
    const result = await verify(await sign({ nonce: "N" }));
    assert.deepEqual(result, { ok: false, reason: "id_token" });
  });

  it("8. 용도(purpose)가 다르면 — 알림 읽기 토큰으로 설정을 고칠 수 없다", async () => {
    const readToken = await sign({ purpose: PORTAL_TOKEN_PURPOSES.notificationsRead });
    assert.deepEqual(await verify(readToken, PORTAL_TOKEN_PURPOSES.notificationSettingsWrite), { ok: false, reason: "wrong_purpose" });
    assert.deepEqual(await verify(readToken, PORTAL_TOKEN_PURPOSES.notificationSettingsRead), { ok: false, reason: "wrong_purpose" });
    assert.deepEqual(await verify(await sign({ purpose: undefined }), READ), { ok: false, reason: "wrong_purpose" });
  });

  it("9. sub 가 없으면 — 🔴 누구의 알림인지는 토큰 안에서만 온다", async () => {
    // 🔴 서명도 iss·aud·exp 도 **전부 맞는** 토큰이다. 막는 것은 sub 하나뿐이고,
    //    jose 의 requiredClaims 가 먼저 잡아 invalid_token 으로 돌아온다.
    const noSub = await new SignJWT({ purpose: READ })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(portalPrivateKey);
    assert.deepEqual(await verify(noSub), { ok: false, reason: "invalid_token" });

    // 빈 글자의 sub 도 통과하지 않는다.
    const emptySub = await sign({ sub: "" });
    assert.equal((await verify(emptySub)).ok, false);
  });
});

describe("용도 글자 — 🔴 저장소 넷이 똑같아야 한다", () => {
  it("포털·A/S·개선요청·게시판과 같은 값", () => {
    assert.deepEqual(PORTAL_TOKEN_PURPOSES, {
      notificationsRead: "dss.notifications.read",
      notificationSettingsRead: "dss.notification-settings.read",
      notificationSettingsWrite: "dss.notification-settings.write",
    });
  });
});

describe("Authorization 머리말 읽기", () => {
  it("Bearer 뒤의 토큰만 꺼낸다(대소문자·탭 허용)", () => {
    assert.equal(readBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(readBearerToken("bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(readBearerToken("Bearer\tabc.def.ghi  "), "abc.def.ghi");
  });

  it("없거나 모양이 다르면 null — 「토큰 없음」과 같은 답이다", () => {
    assert.equal(readBearerToken(null), null);
    assert.equal(readBearerToken(""), null);
    assert.equal(readBearerToken("Basic abc"), null);
    assert.equal(readBearerToken("Bearer"), null);
    assert.equal(readBearerToken("Bearer "), null);
    assert.equal(readBearerToken("Bearer a b"), null);
  });
});
