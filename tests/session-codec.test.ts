import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.AUTH_SESSION_SECRET = "a".repeat(43);
process.env.SSO_TX_SECRET = "b".repeat(43);
process.env.SESSION_HOURS = "12";

import { encodeSession, decodeSession, encodeSsoTx, decodeSsoTx, safeReturnTo } from "../src/lib/auth/session-codec";

describe("세션 코덱", () => {
  it("왕복", () => {
    const now = 1_700_000_000_000;
    const t = encodeSession({ uid: "u", sub: "s", name: "정영빈", role: "ADMIN", iat: now }, now);
    const p = decodeSession(t, now + 1000);
    assert.ok(p);
    assert.equal(p.role, "ADMIN");
    assert.equal(p.iat, now);
  });
  it("12시간 지나면 null", () => {
    const now = 1_700_000_000_000;
    const t = encodeSession({ uid: "u", sub: "s", name: "x", role: "VIEWER", iat: now }, now);
    assert.equal(decodeSession(t, now + 12 * 3600 * 1000 + 1000), null);
  });
  it("세션 키로 서명한 값은 왕복 쿠키 키로 열리지 않는다 (키가 다름)", () => {
    const t = encodeSession({ uid: "u", sub: "s", name: "x", role: "VIEWER", iat: 1 });
    assert.equal(decodeSsoTx(t), null);
  });
});

describe("로그인 왕복 쿠키", () => {
  it("왕복 + returnTo 정화", () => {
    const t = encodeSsoTx({ state: "S", nonce: "N", codeVerifier: "V", returnTo: "/entries?x=1" });
    const p = decodeSsoTx(t);
    assert.ok(p);
    assert.equal(p.returnTo, "/entries?x=1");
  });
  it("10분 지나면 null", () => {
    const now = 1_700_000_000_000;
    const t = encodeSsoTx({ state: "S", nonce: "N", codeVerifier: "V", returnTo: "/" }, now);
    assert.equal(decodeSsoTx(t, now + 10 * 60 * 1000 + 1000), null);
  });
});

describe("safeReturnTo — 열린 리다이렉트 방지", () => {
  it("사이트 안 경로만 통과", () => {
    assert.equal(safeReturnTo("/parts/new"), "/parts/new");
    assert.equal(safeReturnTo("//evil.example"), "/");
    assert.equal(safeReturnTo("/\\evil.example"), "/");
    assert.equal(safeReturnTo("http://evil.example"), "/");
    assert.equal(safeReturnTo("/api/auth/sso/start"), "/");
    assert.equal(safeReturnTo("/login?error=x"), "/");
    assert.equal(safeReturnTo(undefined), "/");
  });
});
