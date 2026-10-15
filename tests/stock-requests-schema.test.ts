import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { REQUEST_SOURCES, stockRequests } from "../src/db/schema/stock-requests";

/**
 * 반출 신청 표의 모양 — **A/S 가 쓰기 시작하면서 바뀐 자리** (2026-10-15).
 *
 * DB 에 붙지 않는다. 스키마 객체만 본다. 여기서 지키는 것은 **마이그레이션을 다시 만들 때 조용히
 * 되돌아가면 안 되는 자리**다 — 특히 `requested_by` 의 NOT NULL 은 한 번 되살아나면 A/S 에서 온
 * 신청이 **들어오다 깨지고**, 그 증상은 통로를 불러 봐야만 보인다.
 */

const table = getTableConfig(stockRequests);
const columnOf = (name: string) => table.columns.find((c) => c.name === name);

describe("출처 칸 — 어디서 올라왔나", () => {
  it("source 는 stock_request_source enum 이고 기본값이 「재고 관리에서 직접」이다", () => {
    const col = columnOf("source");
    assert.ok(col, "source 칸이 없다");
    assert.equal(col.getSQLType(), "stock_request_source");
    assert.equal(col.notNull, true);
    assert.equal(col.default, "INVENTORY", "기본값이 없으면 옛 신청의 출처가 비어 「어디서 왔는지 모르는」 줄이 된다");
  });

  it("🔴 값은 언제나 맨 뒤에 더한다 — 가운데 끼우면 마이그레이션이 enum 타입을 다시 만든다", () => {
    assert.deepEqual([...REQUEST_SOURCES], ["INVENTORY", "AS"]);
  });
});

describe("바깥 요청 번호 — 같은 신청이 두 번 서지 않게", () => {
  it("external_key 는 글자이고 비어 있을 수 있다", () => {
    const col = columnOf("external_key");
    assert.ok(col, "external_key 칸이 없다");
    assert.equal(col.getSQLType(), "text");
    assert.equal(col.notNull, false, "재고 관리에서 직접 올린 신청은 바깥 번호가 없다");
  });

  it("🔴 중복 불가 — 진짜 울타리는 화면 검사가 아니라 이 색인이다", () => {
    const uq = table.indexes.find((i) => i.config.name === "stock_requests_external_key_uq");
    assert.ok(uq, "stock_requests_external_key_uq 가 없으면 두 호출이 같은 순간 들어왔을 때 신청이 두 번 선다");
    assert.equal(uq.config.unique, true);
    assert.deepEqual(
      uq.config.columns.map((c) => ("name" in c ? c.name : String(c))),
      ["external_key"],
    );
    assert.equal(uq.config.where, undefined, "조건을 걸지 않는다 — PostgreSQL 의 UNIQUE 는 NULL 을 서로 다른 값으로 보므로 빈 칸끼리는 부딪히지 않는다");
  });
});

describe("🔴 신청자 — 이 시스템에 없는 사람일 수 있다", () => {
  it("requested_by 는 **NOT NULL 이 아니다** — A/S 신청자는 재고 관리 users 에 없을 수 있다", () => {
    const col = columnOf("requested_by");
    assert.ok(col);
    assert.equal(col.notNull, false, "되살리면 A/S 에서 온 신청이 들어오다 깨진다(사람을 못 찾으면 넣을 값이 없다)");
  });

  it("이름은 언제나 있다 — id 가 없어도 「누가 신청했나」는 남아야 한다", () => {
    assert.equal(columnOf("requested_by_name")?.notNull, true);
  });

  it("🔴 신청자에 FK 가 없다 — 걸면 이 시스템에 없는 사람의 신청을 넣을 수 없다", () => {
    const fk = table.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "requested_by"));
    assert.equal(fk, undefined);
  });

  it("포털 번호 칸이 있고 비어 있을 수 있다 — 사람을 되짚을 유일한 열쇠다", () => {
    const col = columnOf("requester_sub");
    assert.ok(col, "requester_sub 가 없으면 지금 못 찾은 사람을 나중에도 영영 못 잇는다");
    assert.equal(col.getSQLType(), "text", "users.auth_sub 와 같은 모양이라야 비교가 어긋나지 않는다");
    assert.equal(col.notNull, false);
  });
});

describe("색인", () => {
  it("상태·신청자·바깥 번호 셋뿐이다", () => {
    assert.deepEqual(
      table.indexes.map((i) => i.config.name).sort(),
      ["stock_requests_external_key_uq", "stock_requests_requester_idx", "stock_requests_status_idx"],
    );
  });
});
