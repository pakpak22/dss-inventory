import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

// env 는 getter 라 테스트에서 process.env 를 먼저 채운다. 실제 포털에는 닿지 않는다.
process.env.SSO_ISSUER = "http://portal.test:3100";
process.env.SSO_CLIENT_ID = "dss-inventory";
process.env.SSO_CLIENT_SECRET = "test-secret";
process.env.SSO_REDIRECT_URI = "http://localhost:3800/api/auth/sso/callback";

// env 는 getter 라 위에서 process.env 를 채운 뒤 호출 시점에 읽힌다. 정적 import 여도 안전하다.
import { buildAuthorizeUrl, verifyIdToken, verifyLogoutToken, OidcError, BACKCHANNEL_EVENT } from "../src/lib/auth/oidc";

let keySet: JWTVerifyGetKey;
let sign: (claims: Record<string, unknown>, alg?: string) => Promise<string>;

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  keySet = createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "k1" }] });
  sign = async (claims, alg = "RS256") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg, kid: "k1" })
      .setIssuer("http://portal.test:3100")
      .setAudience("dss-inventory")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
});

describe("buildAuthorizeUrl", () => {
  it("PKCE S256 · nonce · state 가 전부 들어간다", () => {
    const url = new URL(
      buildAuthorizeUrl(
        { authorization_endpoint: "http://portal.test:3100/api/oidc/authorize" },
        { state: "S", nonce: "N", codeChallenge: "C" },
      ),
    );
    assert.equal(url.origin + url.pathname, "http://portal.test:3100/api/oidc/authorize");
    assert.equal(url.searchParams.get("client_id"), "dss-inventory");
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3800/api/auth/sso/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "openid profile email");
    assert.equal(url.searchParams.get("state"), "S");
    assert.equal(url.searchParams.get("nonce"), "N");
    assert.equal(url.searchParams.get("code_challenge"), "C");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });
});

describe("verifyIdToken", () => {
  it("정상 토큰: sub·name·email·role·dss_services 를 꺼낸다", async () => {
    const t = await sign({
      sub: "uuid-1",
      sid: "sid-1",
      nonce: "N",
      name: "정영빈",
      preferred_username: "정영빈",
      email: "a@b.c",
      role: "ADMIN",
      dss_services: [{ id: "dss-inventory", name: "재고 관리", url: "http://localhost:3800/", icon: "📦" }, { bad: 1 }],
    });
    const c = await verifyIdToken(t, "N", keySet);
    assert.equal(c.sub, "uuid-1");
    assert.equal(c.sid, "sid-1");
    assert.equal(c.name, "정영빈");
    assert.equal(c.email, "a@b.c");
    assert.equal(c.role, "ADMIN");
    assert.equal(c.roleClaimPresent, true);
    assert.equal(c.dssServices.length, 1);
    assert.equal(c.dssServices[0].icon, "📦");
  });
  it("email·role 키가 없으면 undefined 이고 roleClaimPresent 는 false", async () => {
    const t = await sign({ sub: "uuid-2", nonce: "N", name: "홍길동" });
    const c = await verifyIdToken(t, "N", keySet);
    assert.equal(c.email, undefined);
    assert.equal(c.role, undefined);
    assert.equal(c.roleClaimPresent, false);
    assert.deepEqual(c.dssServices, []);
  });
  it("nonce 가 다르면 거절", async () => {
    const t = await sign({ sub: "uuid-1", nonce: "OTHER", name: "x" });
    await assert.rejects(verifyIdToken(t, "N", keySet), (e: unknown) => e instanceof OidcError && e.code === "invalid_id_token");
  });
  it("sub 가 없으면 거절", async () => {
    const t = await sign({ nonce: "N", name: "x" });
    await assert.rejects(verifyIdToken(t, "N", keySet), (e: unknown) => e instanceof OidcError && e.code === "invalid_id_token");
  });
  it("aud 가 다르면 거절", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const t = await new SignJWT({ sub: "u", nonce: "N" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("http://portal.test:3100")
      .setAudience("other-client")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await assert.rejects(verifyIdToken(t, "N", keySet), (e: unknown) => e instanceof OidcError);
  });
  it("alg=none 은 거절", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "u", nonce: "N", iss: "http://portal.test:3100", aud: "dss-inventory", exp: 9_999_999_999 }),
    ).toString("base64url");
    await assert.rejects(verifyIdToken(`${header}.${payload}.`, "N", keySet), (e: unknown) => e instanceof OidcError);
  });
});

describe("verifyLogoutToken", () => {
  it("정상 logout_token", async () => {
    const t = await sign({ sub: "uuid-1", sid: "sid-1", events: { [BACKCHANNEL_EVENT]: {} } });
    assert.deepEqual(await verifyLogoutToken(t, keySet), { sub: "uuid-1", sid: "sid-1" });
  });
  it("nonce 가 있으면 거절 (ID 토큰 밀어넣기)", async () => {
    const t = await sign({ sub: "uuid-1", nonce: "N", events: { [BACKCHANNEL_EVENT]: {} } });
    await assert.rejects(verifyLogoutToken(t, keySet));
  });
  it("events 가 없으면 거절", async () => {
    const t = await sign({ sub: "uuid-1" });
    await assert.rejects(verifyLogoutToken(t, keySet));
  });
});
