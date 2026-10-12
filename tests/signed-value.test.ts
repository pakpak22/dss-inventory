import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signValue, verifyValue } from "../src/lib/auth/signed-value";

const SECRET = "x".repeat(40);

describe("signValue / verifyValue", () => {
  it("서명한 값을 그대로 돌려받는다", () => {
    const now = 1_700_000_000_000;
    const t = signValue({ uid: "u1", name: "홍길동" }, SECRET, 60, now);
    const v = verifyValue<{ uid: string; name: string }>(t, SECRET, now + 1000);
    assert.ok(v);
    assert.equal(v.uid, "u1");
    assert.equal(v.name, "홍길동");
    assert.equal(v.exp, Math.floor(now / 1000) + 60);
  });
  it("만료되면 null", () => {
    const now = 1_700_000_000_000;
    const t = signValue({ a: 1 }, SECRET, 60, now);
    assert.equal(verifyValue(t, SECRET, now + 61_000), null);
  });
  it("다른 키로는 열리지 않는다", () => {
    const t = signValue({ a: 1 }, SECRET, 60);
    assert.equal(verifyValue(t, "y".repeat(40)), null);
  });
  it("payload 를 바꿔치기하면 null (서명 불일치)", () => {
    const t = signValue({ uid: "u1" }, SECRET, 60);
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "u2", exp: 9_999_999_999 })).toString("base64url") + "." + sig;
    assert.equal(verifyValue(forged, SECRET), null);
  });
  it("깨진 값·빈 값은 null", () => {
    assert.equal(verifyValue(undefined, SECRET), null);
    assert.equal(verifyValue("", SECRET), null);
    assert.equal(verifyValue("abc", SECRET), null);
    assert.equal(verifyValue("abc.def", SECRET), null);
    assert.equal(verifyValue(".", SECRET), null);
  });
});
