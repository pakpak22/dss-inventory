import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { approvalDelegations } from "../src/db/schema/approval-delegations";
import { portalApprovalDelegations } from "../src/db/schema/portal-approval-delegations";

/**
 * 승인함에서 받아 적는 위임 표의 모양 (2026-11-16, 조각 6 · 설계 B-12).
 *
 * DB 에 붙지 않는다 — 스키마 객체만 본다. 여기서 지키는 것은 **마이그레이션을 다시 만들 때
 * 조용히 바뀌면 안 되는 자리**다. 🔴 특히 **`id` 에 기본값이 없다**는 것 — 번호의 주인이
 * 포털이고, 그 한 칸이 멱등의 전부다.
 */

const table = getTableConfig(portalApprovalDelegations);
const own = getTableConfig(approvalDelegations);
const dialect = new PgDialect();

const columnOf = (name: string) => table.columns.find((c) => c.name === name);
const checkSql = (name: string) => {
  const found = table.checks.find((c) => c.name === name);
  return found === undefined ? null : dialect.sqlToQuery(found.value);
};

describe("표 이름과 열쇠", () => {
  it("🔴 `approval_delegations` 와 **다른 표다. 둘 다 산다**(설계 B-4)", () => {
    assert.equal(table.name, "portal_approval_delegations");
    assert.notEqual(table.name, own.name);
    // 🔴 저쪽 표에 칸이 생겨 이쪽을 대신하기 시작하면(= 한 표로 합치면) 「되돌리기 단추를
    //    그릴까」가 칸 하나에 매달린다. 저쪽이 그대로인지 함께 본다.
    assert.equal(own.name, "approval_delegations");
    assert.ok(own.columns.some((c) => c.name === "created_by_sub"), "저쪽 표가 바뀌었다 — 두 표의 성격이 섞였는지 보라");
  });

  it("🔴 기본키는 uuid 이고 **DB 가 채우지 않는다** — 포털이 보낸 번호를 그대로 적는다", () => {
    const id = columnOf("id");
    assert.ok(id);
    assert.equal(id.getSQLType(), "uuid");
    assert.equal(id.primary, true);
    // 🔴 `defaultRandom()` 이 붙으면 몸통에 id 가 빠져 온 날 **우리만 아는 번호**가 생기고,
    //    그 줄은 포털이 철회해도 영영 안 거둬진다. 제 표(approval_delegations)와 **다른 점**이다.
    assert.equal(id.hasDefault, false, "id 에 기본값이 생겼다 — 멱등이 깨진다");
    assert.equal(id.default, undefined);
    assert.equal(own.columns.find((c) => c.name === "id")?.hasDefault, true, "제 표는 반대로 DB 가 채운다(그 표의 주인이 이 집이다)");
  });

  it("🔴 사람 칸은 전부 text 로 된 **포털 번호**다 — `…_user_id` 가 하나도 없다", () => {
    for (const name of ["delegator_sub", "delegate_sub"]) {
      assert.equal(columnOf(name)?.getSQLType(), "text", `${name} 는 users.auth_sub 와 같은 모양이라야 한다`);
      assert.equal(columnOf(name)?.notNull, true, name);
    }
    assert.deepEqual(
      table.columns.filter((c) => c.name.endsWith("_user_id")).map((c) => c.name),
      [],
      "이름이 열쇠를 지킨다 — `…_user_id` 라는 칸이 생기면 거기에 다른 번호가 들어간다",
    );
  });
});

describe("칸", () => {
  it("🔴 칸은 여덟뿐이다 — 세 시스템(A/S·재고관리·휴가)이 **같은 모양**을 쓴다", () => {
    assert.deepEqual(
      table.columns.map((c) => c.name).sort(),
      ["delegate_sub", "delegator_sub", "ends_at", "id", "reason", "revoked_at", "starts_at", "synced_at"],
    );
  });

  it("🔵 이름 사본 칸이 없다 — 포털이 보내는 몸통에 이름이 없다", () => {
    // 「그때 누구였나」는 감사 로그(PORTAL_DELEGATION_SYNCED)가 들고 있다. 여기 칸을 더하면
    // 세 시스템의 모양이 갈리고, 포털이 집집마다 다른 몸통을 보내야 한다.
    for (const name of ["delegator_name", "delegate_name", "created_by_sub", "created_by_name"]) {
      assert.equal(columnOf(name), undefined, `${name} 이 생겼다 — 통로 규약에 없는 값이다`);
    }
  });

  it("기간 두 칸은 timestamptz 이고 notNull, 기본값이 없다 — 포털이 정한다", () => {
    for (const name of ["starts_at", "ends_at"]) {
      const col = columnOf(name);
      assert.ok(col, name);
      assert.equal(col.getSQLType(), "timestamp with time zone", "운영 서버(NAS)가 UTC 라 시간대 없는 칸은 쓰지 않는다");
      assert.equal(col.notNull, true, name);
      assert.equal(col.hasDefault, false, name);
    }
  });

  it("사유는 notNull 이고 기본값이 빈 글자", () => {
    assert.equal(columnOf("reason")?.notNull, true);
    assert.equal(columnOf("reason")?.default, "");
  });

  it("거둔 시각은 빌 수 있다 — 비어 있으면 살아 있는 줄이다", () => {
    const col = columnOf("revoked_at");
    assert.ok(col);
    assert.equal(col.getSQLType(), "timestamp with time zone");
    assert.equal(col.notNull, false);
  });

  it("🔴 `synced_at` 은 notNull 이고 기본값이 now() — 조각 9(어긋남 점검)가 쓴다", () => {
    const col = columnOf("synced_at");
    assert.ok(col, "언제 받았는지가 없으면 양쪽이 어긋나도 영영 조용하다(설계 B-14)");
    assert.equal(col.getSQLType(), "timestamp with time zone");
    assert.equal(col.notNull, true);
    assert.equal(col.hasDefault, true);
  });

  it("🔴 사람에 대한 FK 가 하나도 없다 — 없는 사람은 **오류가 아니라** `not_applicable` 이다", () => {
    assert.deepEqual(table.foreignKeys, [], "FK 를 걸면 저장이 오류가 되고, 포털이 지정 자체를 거절한다(B-13)");
  });

  it("🔴 소프트 삭제 4칸이 없다 — 거두기는 revoked_at 을 찍는 것이지 삭제가 아니다", () => {
    for (const name of ["is_deleted", "deleted_at", "deleted_by", "delete_reason"]) {
      assert.equal(columnOf(name), undefined, `${name} 이 생겼다 — 지우면 그 기간에 난 결재를 나중에 설명할 수 없다`);
    }
  });
});

describe("🔴 DB 가 막는 것", () => {
  it("CHECK 는 둘뿐이다 — 기간이 거꾸로인 줄과 자기에게 맡기는 줄", () => {
    assert.deepEqual(table.checks.map((c) => c.name).sort(), [
      "portal_approval_delegations_not_self",
      "portal_approval_delegations_period_valid",
    ]);
  });

  it("끝이 시작보다 앞서면 막는다 — `ends_at > starts_at`", () => {
    const q = checkSql("portal_approval_delegations_period_valid");
    assert.ok(q, "영원히 유효하지 않은 줄이 멀쩡해 보인다");
    assert.match(q.sql, /"ends_at"\s*>\s*"[^"]*"\."starts_at"/);
    assert.doesNotMatch(q.sql, />=/, "시작과 끝이 같으면 유효한 순간이 하나도 없다(반열린 구간)");
  });

  it("자기에게 맡기는 줄을 막는다 — `delegate_sub <> delegator_sub`", () => {
    const q = checkSql("portal_approval_delegations_not_self");
    assert.ok(q);
    assert.match(q.sql, /"delegate_sub"\s*<>\s*"[^"]*"\."delegator_sub"/);
  });

  it("🔴 CHECK 에 자리표시자가 없다 — `$1` 이 구워지면 그 마이그레이션은 **적용 때** 깨진다", () => {
    for (const c of table.checks) {
      const q = dialect.sqlToQuery(c.value);
      assert.deepEqual(q.params, [], `${c.name} 에 바인딩 값이 생겼다`);
      assert.doesNotMatch(q.sql, /\$\d/, `${c.name} 에 자리표시자가 구워졌다`);
    }
  });
});

describe("색인", () => {
  it("🔴 「지금 내가 누구의 결재권을 쓸 수 있나」가 (받은 사람, 거둠, 끝) 색인으로 들어온다", () => {
    const idx = table.indexes.find((i) => i.config.name === "portal_approval_delegations_delegate_idx");
    assert.ok(idx, "색인이 없으면 결재 화면마다 이 표를 통째로 훑는다");
    assert.equal(idx.config.unique, false);
    assert.deepEqual(
      idx.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["delegate_sub", "revoked_at", "ends_at"],
      "제 표의 색인과 같은 차례다 — 같은 함수가 두 표를 같은 조건으로 읽는다(조각 8)",
    );
  });

  it("🔵 유니크 색인이 없다 — 한 사람이 둘 이상에게서 위임받을 수 있다", () => {
    assert.deepEqual(
      table.indexes.filter((i) => i.config.unique).map((i) => i.config.name),
      [],
    );
  });
});
