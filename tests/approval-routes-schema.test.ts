import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { approvalRouteSteps, approvalRoutes } from "../src/db/schema/approval-routes";

/**
 * 승인 절차(결재선) 표 둘의 모양 (2026-10-15, 조각 ③a — A/S 원본에서 옮겨 옴).
 *
 * DB 에 붙지 않는다 — 스키마 객체만 본다. 여기서 지키는 것은 **마이그레이션을 다시 만들 때
 * 조용히 바뀌면 안 되는 자리**다. 특히 「없어야 한다」가 많은 표라서, 다음 사람이 「규칙
 * 위반」으로 보고 칸을 더하면 여기서 깨진다.
 */

const routes = getTableConfig(approvalRoutes);
const steps = getTableConfig(approvalRouteSteps);

const columnOf = (table: ReturnType<typeof getTableConfig>, name: string) => table.columns.find((c) => c.name === name);

describe("표 이름 — 둘", () => {
  it("절차 한 판은 approval_routes", () => {
    assert.equal(routes.name, "approval_routes");
  });

  it("그 판의 단계들은 approval_route_steps", () => {
    assert.equal(steps.name, "approval_route_steps");
  });
});

describe("🔴 approval_routes 는 append-only — 없어야 하는 칸들", () => {
  it("updated_at 이 없다 — 고치는 길이 없으니 가리킬 것이 없다", () => {
    assert.equal(columnOf(routes, "updated_at"), undefined, "판은 고치지 않고 새 판을 얹는다");
  });

  it("🔴 소프트 삭제 4칸이 없다 — CLAUDE.md 11절은 지우는 표에 대한 규칙이다", () => {
    for (const name of ["is_deleted", "deleted_at", "deleted_by", "delete_reason"]) {
      assert.equal(columnOf(routes, name), undefined, `${name} 이 생겼다 — 이 표는 지우지 않으므로 예외다`);
    }
  });

  it("is_current 같은 깃발도 없다 — 「현재」는 그 용도의 가장 큰 version 하나로 정해진다", () => {
    assert.equal(columnOf(routes, "is_current"), undefined);
  });
});

describe("approval_routes — 칸", () => {
  it("🔴 scope 에 기본값이 없다 — 용도를 적지 않은 판이 조용히 어느 한쪽으로 들어가면 안 된다", () => {
    const col = columnOf(routes, "scope");
    assert.ok(col);
    assert.equal(col.notNull, true);
    assert.equal(col.default, undefined, "기본값을 두면 뜻을 숨긴 판이 생긴다");
  });

  it("scope 는 approval_route_scope enum 이다", () => {
    assert.equal(columnOf(routes, "scope")?.getSQLType(), "approval_route_scope");
  });

  it("version 은 notNull 정수이고 기본값이 없다 — 저장하는 쪽이 매긴다", () => {
    const col = columnOf(routes, "version");
    assert.ok(col);
    assert.equal(col.notNull, true);
    assert.equal(col.getSQLType(), "integer");
    assert.equal(col.default, undefined);
  });

  it("created_by 는 빌 수 있고, created_by_name 은 notNull — 이름이 없으면 「누가 바꿨나」가 안 보인다", () => {
    assert.equal(columnOf(routes, "created_by")?.notNull, false);
    const name = columnOf(routes, "created_by_name");
    assert.ok(name);
    assert.equal(name.notNull, true);
    assert.equal(name.getSQLType(), "text");
  });

  it("🔴 created_by 에 FK 가 없다 — A/S 의 사람들이 이 시스템의 users 에 없다", () => {
    const fk = routes.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "created_by"));
    assert.equal(fk, undefined, "FK 를 걸면 A/S 쪽 계정으로 저장한 판을 넣을 수 없다");
  });

  it("🔴 (scope, version) 이 유니크다 — 겹치는 순간 「현재 절차」가 둘이 된다", () => {
    const uq = routes.indexes.find((i) => i.config.name === "approval_routes_scope_version_uq");
    assert.ok(uq, "approval_routes_scope_version_uq 가 없다");
    assert.equal(uq.config.unique, true);
    assert.deepEqual(
      uq.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["scope", "version"],
      "용도를 빼고 version 에만 걸면 다른 용도끼리 번호를 나눠 쓰게 된다",
    );
  });
});

describe("approval_route_steps — 칸", () => {
  it("route_id 는 notNull 이고 판을 가리킨다(cascade)", () => {
    assert.equal(columnOf(steps, "route_id")?.notNull, true);
    const fk = steps.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "route_id"));
    assert.ok(fk, "route_id 에 FK 가 없다 — 고아 단계를 막을 길이 사라진다");
    assert.equal(fk.onDelete, "cascade");
    assert.equal(fk.reference().foreignTable, approvalRoutes);
  });

  it("step_order·approver_user_id·approver_name·approver_role 은 전부 notNull", () => {
    for (const name of ["step_order", "approver_user_id", "approver_name", "approver_role"]) {
      assert.equal(columnOf(steps, name)?.notNull, true, name);
    }
  });

  it("🔴 approver_user_id 에 FK 가 없다 — A/S 의 ID 를 글자로 적어 둘 뿐이다", () => {
    const fk = steps.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "approver_user_id"));
    assert.equal(fk, undefined, "FK 를 걸면 A/S 의 결재자 대부분을 아예 넣을 수 없다");
  });

  it("🔴 포털 번호 칸이 있고 **nullable** 이다 — 이 칸이 생기기 전에 저장된 옛 판에는 값이 없다", () => {
    const col = columnOf(steps, "approver_sub");
    assert.ok(col, "approver_sub 가 없으면 결재자를 알아볼 길이 없다(A/S 번호는 이 시스템의 로그인 번호가 아니다)");
    assert.equal(col.getSQLType(), "text", "users.auth_sub 와 같은 모양이라야 비교가 어긋나지 않는다");
    assert.equal(col.notNull, false, "NOT NULL 로 올리면 개발 DB 의 옛 판 둘 때문에 마이그레이션이 멈춘다");
  });

  it("🔴 approver_user_id 는 그대로 남는다 — 뜻을 갈아끼우지 않는다", () => {
    // 포털 번호가 생겼다고 A/S 번호를 지우거나 그 칸에 포털 번호를 넣지 않는다. 그러면 칸
    // 이름이 거짓이 되고, A/S 명부로 되짚는 길이 사라진다.
    assert.equal(columnOf(steps, "approver_user_id")?.getSQLType(), "uuid");
    assert.equal(columnOf(steps, "approver_user_id")?.notNull, true);
  });

  it("approver_name·approver_role 은 글자 사본이다 — 정본은 A/S 다", () => {
    assert.equal(columnOf(steps, "approver_name")?.getSQLType(), "text");
    assert.equal(columnOf(steps, "approver_role")?.getSQLType(), "text");
  });

  it("한 판 안에서 순서는 한 번만 — (route_id, step_order) 유니크", () => {
    const uq = steps.indexes.find((i) => i.config.name === "approval_route_steps_order_uq");
    assert.ok(uq, "approval_route_steps_order_uq 가 없다");
    assert.equal(uq.config.unique, true);
    assert.deepEqual(
      uq.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["route_id", "step_order"],
    );
  });

  it("🔴 한 판 안에서 같은 사람은 한 번만 — 두 번이면 「내 차례인가」가 두 번 참이 된다", () => {
    const uq = steps.indexes.find((i) => i.config.name === "approval_route_steps_approver_uq");
    assert.ok(uq, "approval_route_steps_approver_uq 가 없으면 순차 승인이 성립하지 않는다");
    assert.equal(uq.config.unique, true);
    assert.deepEqual(
      uq.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["route_id", "approver_user_id"],
    );
  });

  it("승인자로 찾는 인덱스가 있다 — 「지금 내 차례인가」 조회가 이 사람으로 들어온다", () => {
    const idx = steps.indexes.find((i) => i.config.name === "approval_route_steps_approver_idx");
    assert.ok(idx, "approval_route_steps_approver_idx 가 없다");
    assert.equal(idx.config.unique, false);
  });

  it("step_order >= 1 을 DB 가 막는다 — stepOrderFromIndex(index + 1) 와 짝이다", () => {
    const names = steps.checks.map((c) => c.name).sort();
    assert.deepEqual(names, ["approval_route_steps_step_order_positive"]);
  });

  it("🔴 「최소 한 줄」 제약이 없다 — 단계 0개인 판이 절차를 끄는 유일한 출구다", () => {
    // DB 로는 표현할 수도 없지만, 여기 적어 두는 것은 다음 사람이 애플리케이션 쪽에
    // 「0개 금지」를 넣으려 할 때 까닭을 먼저 읽게 하기 위해서다.
    assert.equal(steps.checks.length, 1, "CHECK 는 step_order 하나뿐이다");
  });
});
