import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ohPartTemplateItems, ohPartTemplates } from "../src/db/schema/oh-templates";

/**
 * O/H 부품 템플릿 표 둘의 모양 (2026-10-14, 조각 5a).
 *
 * DB 에 붙지 않는다 — 스키마 객체만 본다. 여기서 지키는 것은 **마이그레이션을 다시 만들 때
 * 조용히 바뀌면 안 되는 자리**다. 특히 「빌 수 있다」 둘은 값이 들어오는 모양 자체라
 * notNull 로 바뀌는 순간 옮겨 올 자료의 일부를 넣을 수 없게 된다.
 */

const templates = getTableConfig(ohPartTemplates);
const items = getTableConfig(ohPartTemplateItems);

const columnOf = (table: ReturnType<typeof getTableConfig>, name: string) => table.columns.find((c) => c.name === name);

describe("표 이름", () => {
  it("템플릿 머리는 oh_part_templates", () => {
    assert.equal(templates.name, "oh_part_templates");
  });

  it("템플릿에 든 부품 줄은 oh_part_template_items", () => {
    assert.equal(items.name, "oh_part_template_items");
  });
});

describe("소프트 삭제 4컬럼 — 이름·개수 고정 (CLAUDE.md 11절)", () => {
  it("템플릿 머리에 네 칸이 이름 그대로 있다", () => {
    for (const name of ["is_deleted", "deleted_at", "deleted_by", "delete_reason"]) {
      assert.ok(columnOf(templates, name), `${name} 이 없다`);
    }
  });

  it("is_deleted 는 notNull 이고 기본 false", () => {
    const col = columnOf(templates, "is_deleted");
    assert.ok(col);
    assert.equal(col.notNull, true);
    assert.equal(col.default, false);
  });

  it("나머지 셋은 빌 수 있다 — 지우지 않은 줄에는 값이 없다", () => {
    for (const name of ["deleted_at", "deleted_by", "delete_reason"]) {
      assert.equal(columnOf(templates, name)?.notNull, false, name);
    }
  });
});

describe("🔴 빌 수 있어야 하는 칸 둘", () => {
  it("part_id 는 비는 것이 정상이다 — 재고 마스터에 없는 이름이 있다", () => {
    const col = columnOf(items, "part_id");
    assert.ok(col);
    assert.equal(col.notNull, false, "notNull 로 바꾸면 「유량계」 같은 줄을 아예 넣을 수 없다");
  });

  it("oh_price 는 비어 있을 수 있다 — 일반 단가로 대신 채우지 않는다", () => {
    const col = columnOf(items, "oh_price");
    assert.ok(col);
    assert.equal(col.notNull, false, "모르는 단가와 0원은 다르다");
  });
});

describe("반드시 있어야 하는 칸", () => {
  it("template_id 는 notNull — 주인 없는 줄은 없다", () => {
    assert.equal(columnOf(items, "template_id")?.notNull, true);
  });

  it("code·name 은 notNull, note 는 빌 수 있다", () => {
    assert.equal(columnOf(templates, "code")?.notNull, true);
    assert.equal(columnOf(templates, "name")?.notNull, true);
    assert.equal(columnOf(templates, "note")?.notNull, false);
  });

  it("display_order·part_name_text·quantity 는 notNull", () => {
    for (const name of ["display_order", "part_name_text", "quantity"]) {
      assert.equal(columnOf(items, name)?.notNull, true, name);
    }
  });
});

describe("기종 코드는 글자다", () => {
  it("301A 같은 것이 생길 수 있어 숫자로 두지 않았다", () => {
    assert.equal(columnOf(templates, "code")?.getSQLType(), "text");
  });
});

describe("인덱스·제약", () => {
  it("템플릿 코드는 지우지 않은 줄 안에서만 유일하다", () => {
    const uq = templates.indexes.find((i) => i.config.name === "oh_part_templates_code_uq");
    assert.ok(uq, "oh_part_templates_code_uq 가 없다");
    assert.equal(uq.config.unique, true);
    assert.ok(uq.config.where, "부분 인덱스가 아니면 지운 코드를 다시 쓸 수 없다");
  });

  it("한 템플릿 안에서 차례는 한 번만", () => {
    const uq = items.indexes.find((i) => i.config.name === "oh_part_template_items_template_order_uq");
    assert.ok(uq);
    assert.equal(uq.config.unique, true);
  });

  it("수량은 양수, O/H 단가는 음수가 아니다", () => {
    const names = items.checks.map((c) => c.name).sort();
    assert.deepEqual(names, ["oh_part_template_items_oh_price_not_negative", "oh_part_template_items_quantity_positive"]);
  });
});
