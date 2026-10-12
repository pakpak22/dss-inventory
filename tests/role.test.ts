import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideRole, isRole, roleAtLeast, ROLE_LABEL } from "../src/lib/auth/role";

describe("decideRole — CLAUDE.md 8-2절 표 그대로", () => {
  it("role 클레임이 없으면 KEEP", () => {
    assert.deepEqual(decideRole(undefined), { kind: "KEEP" });
  });
  it("아는 값이면 APPLY", () => {
    assert.deepEqual(decideRole("ADMIN"), { kind: "APPLY", role: "ADMIN" });
    assert.deepEqual(decideRole("STAFF"), { kind: "APPLY", role: "STAFF" });
    assert.deepEqual(decideRole("VIEWER"), { kind: "APPLY", role: "VIEWER" });
  });
  it("모르는 값이면 REJECT — 빈 문자열·소문자·A/S 역할·null 전부", () => {
    for (const v of ["", "admin", "SUPER_ADMIN", "INVENTORY_MANAGER", null, 0, {}, []]) {
      const d = decideRole(v);
      assert.equal(d.kind, "REJECT", `${JSON.stringify(v)} 는 REJECT 여야 함`);
    }
  });
  it("isRole / roleAtLeast / ROLE_LABEL", () => {
    assert.equal(isRole("ADMIN"), true);
    assert.equal(isRole("Admin"), false);
    assert.equal(roleAtLeast("ADMIN", "STAFF"), true);
    assert.equal(roleAtLeast("STAFF", "ADMIN"), false);
    assert.equal(roleAtLeast("VIEWER", "VIEWER"), true);
    assert.equal(ROLE_LABEL.ADMIN, "관리자");
  });
});
