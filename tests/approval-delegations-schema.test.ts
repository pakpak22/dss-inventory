import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { approvalDelegations } from "../src/db/schema/approval-delegations";

/**
 * 결재권 위임 표의 모양 (2026-10-21, 조각 1).
 *
 * DB 에 붙지 않는다 — 스키마 객체만 본다. 여기서 지키는 것은 **마이그레이션을 다시 만들 때
 * 조용히 바뀌면 안 되는 자리**다. 특히 「없어야 한다」가 많은 표라서(사람 FK · 소프트 삭제),
 * 다음 사람이 「규칙 위반」으로 보고 칸을 더하면 여기서 깨진다.
 */

const table = getTableConfig(approvalDelegations);
const dialect = new PgDialect();

const columnOf = (name: string) => table.columns.find((c) => c.name === name);
const checkSql = (name: string) => {
  const found = table.checks.find((c) => c.name === name);
  return found === undefined ? null : dialect.sqlToQuery(found.value);
};

describe("표 이름과 열쇠", () => {
  it("approval_delegations 다", () => {
    assert.equal(table.name, "approval_delegations");
  });

  it("기본키는 uuid 이고 DB 가 채운다", () => {
    const id = columnOf("id");
    assert.ok(id);
    assert.equal(id.getSQLType(), "uuid");
    assert.equal(id.primary, true);
  });

  it("🔴 사람 칸은 전부 text 로 된 **포털 번호**다 — `…_user_id` 가 하나도 없다", () => {
    // 🔴 2026-10-15 결함의 울타리. uuid 칸이 섞여 들어오면 다음 사람이 거기에 `users.id` 나
    //    A/S 번호를 넣고, 그 순간 「누구인가」가 영영 안 맞는다.
    for (const name of ["delegator_sub", "delegate_sub", "created_by_sub", "revoked_by_sub"]) {
      assert.equal(columnOf(name)?.getSQLType(), "text", `${name} 는 users.auth_sub 와 같은 모양이라야 한다`);
    }
    assert.deepEqual(
      table.columns.filter((c) => c.name.endsWith("_user_id")).map((c) => c.name),
      [],
      "이름이 열쇠를 지킨다 — `…_user_id` 라는 칸이 생기면 거기에 다른 번호가 들어간다",
    );
  });
});

describe("칸", () => {
  it("맡긴 사람·받은 사람과 그때의 이름이 전부 notNull", () => {
    for (const name of ["delegator_sub", "delegator_name", "delegate_sub", "delegate_name"]) {
      assert.equal(columnOf(name)?.notNull, true, name);
    }
  });

  it("🔵 이름을 함께 적는다 — 그 사람이 없어지거나 이름이 바뀌어도 「그때 누구였는지」가 남아야 한다", () => {
    assert.equal(columnOf("delegator_name")?.getSQLType(), "text");
    assert.equal(columnOf("delegate_name")?.getSQLType(), "text");
  });

  it("기간 두 칸은 timestamptz 이고 notNull, 기본값이 없다 — 적는 쪽이 정한다", () => {
    for (const name of ["starts_at", "ends_at"]) {
      const col = columnOf(name);
      assert.ok(col, name);
      assert.equal(col.getSQLType(), "timestamp with time zone", "운영 서버(NAS)가 UTC 라 시간대 없는 칸은 쓰지 않는다");
      assert.equal(col.notNull, true, name);
      assert.equal(col.default, undefined, name);
    }
  });

  it("사유는 notNull 이고 기본값이 빈 글자 — 안 적었다고 위임을 막을 일은 아니다", () => {
    assert.equal(columnOf("reason")?.notNull, true);
    assert.equal(columnOf("reason")?.default, "");
  });

  it("🔴 「누가 열었나」와 「누구의 권한인가」는 다른 물음이다 — 🔵 지금은 같은 값이어도 칸은 따로 둔다", () => {
    // 2026-10-21 결정으로 **결재권자 본인만** 위임을 만든다 — 그래서 `created_by_sub` 는
    // 당분간 `delegator_sub` 와 언제나 같은 값이다. 그래도 칸을 합치지 않는 까닭이 아래 메시지다.
    assert.equal(columnOf("created_by_sub")?.notNull, true, "값이 같다고 지우면 둘이 갈리는 날 그때까지 쌓인 기록에는 과거에 답이 없다");
    assert.equal(columnOf("created_by_name")?.notNull, true);
  });

  it("되돌림 세 칸은 빌 수 있다 — 되돌리기 전에는 비어 있다", () => {
    for (const name of ["revoked_at", "revoked_by_sub", "revoked_by_name"]) {
      const col = columnOf(name);
      assert.ok(col, name);
      assert.equal(col.notNull, false, name);
    }
  });

  it("🔴 사람에 대한 FK 가 하나도 없다 — 이 시스템에 그 사람들이 없다(명부는 A/S 에서 받아 온다)", () => {
    assert.deepEqual(table.foreignKeys, [], "FK 를 걸면 A/S 쪽 결재자 대부분을 아예 넣을 수 없다");
  });

  it("🔴 소프트 삭제 4칸이 없다 — 되돌리기는 revoked_at 을 찍는 것이지 삭제가 아니다", () => {
    for (const name of ["is_deleted", "deleted_at", "deleted_by", "delete_reason"]) {
      assert.equal(columnOf(name), undefined, `${name} 이 생겼다 — 지우면 그 기간에 난 결재를 나중에 설명할 수 없다`);
    }
  });
});

describe("🔴 DB 가 막는 것", () => {
  it("CHECK 는 둘뿐이다 — 기간이 거꾸로인 줄과 자기에게 맡기는 줄", () => {
    assert.deepEqual(table.checks.map((c) => c.name).sort(), ["approval_delegations_not_self", "approval_delegations_period_valid"]);
  });

  it("끝이 시작보다 앞서면 막는다 — `ends_at > starts_at`", () => {
    const q = checkSql("approval_delegations_period_valid");
    assert.ok(q, "approval_delegations_period_valid 가 없다 — 영원히 유효하지 않은 줄이 멀쩡해 보인다");
    assert.match(q.sql, /"ends_at"\s*>\s*"[^"]*"\."starts_at"/);
    assert.doesNotMatch(q.sql, />=/, "시작과 끝이 같으면 유효한 순간이 하나도 없다(반열린 구간)");
  });

  it("🔴 자기에게 맡기는 줄을 막는다 — `delegate_sub <> delegator_sub`", () => {
    const q = checkSql("approval_delegations_not_self");
    assert.ok(q, "approval_delegations_not_self 가 없으면 「대리인이 눌렀다」 판정이 본인에 대해 참이 될 수 있다");
    assert.match(q.sql, /"delegate_sub"\s*<>\s*"[^"]*"\."delegator_sub"/);
  });

  it("🔴 CHECK 에 자리표시자가 없다 — `$1` 이 구워지면 그 마이그레이션은 **적용 때** 깨진다", () => {
    // 🔴 drizzle 의 sql 템플릿에 상수를 넘기면 바인딩 자리로 구워진다(`CHECK ("id" = $1)`).
    //    오류 없이 생성되고 돌릴 때 터지는 결함이라, 생성 전에 여기서 막는다.
    for (const c of table.checks) {
      const q = dialect.sqlToQuery(c.value);
      assert.deepEqual(q.params, [], `${c.name} 에 바인딩 값이 생겼다`);
      assert.doesNotMatch(q.sql, /\$\d/, `${c.name} 에 자리표시자가 구워졌다`);
    }
  });
});

describe("색인", () => {
  it("🔴 「지금 내가 누구의 결재권을 쓸 수 있나」가 (받은 사람, 되돌림, 끝) 색인으로 들어온다", () => {
    const idx = table.indexes.find((i) => i.config.name === "approval_delegations_delegate_idx");
    assert.ok(idx, "색인이 없으면 결재 화면마다 이 표를 통째로 훑는다");
    assert.equal(idx.config.unique, false);
    assert.deepEqual(
      idx.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["delegate_sub", "revoked_at", "ends_at"],
      "칸 차례가 조회의 차례다 — 받은 사람으로 찾고, 살아 있고, 아직 안 끝난 줄",
    );
  });

  it("🔵 유니크 색인이 없다 — 같은 사람이 **둘 이상에게서** 위임받을 수 있다", () => {
    // 두 사람이 동시에 출장 갈 수 있고, 한 사람이 기간을 나눠 여러 줄로 맡길 수도 있다.
    // 여기에 유니크를 걸면 그 둘이 막힌다.
    assert.deepEqual(
      table.indexes.filter((i) => i.config.unique).map((i) => i.config.name),
      [],
    );
  });
});
