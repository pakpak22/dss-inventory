import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  ohPartTemplateItems,
  ohPartTemplateModels,
  ohPartTemplates,
  partOverhaulUnitPrices,
} from "../src/db/schema/oh-templates";

/**
 * O/H 부품 템플릿 표 넷의 모양 (2026-10-15, 조각 5a′ — A/S 원본 모양으로 다시 세움).
 *
 * DB 에 붙지 않는다 — 스키마 객체만 본다. 여기서 지키는 것은 **마이그레이션을 다시 만들 때
 * 조용히 바뀌면 안 되는 자리**다. 특히 「빌 수 있다」와 「없어야 한다」는 값이 들어오는 모양
 * 자체라, 한 칸만 바뀌어도 옮겨 올 자료의 일부를 넣을 수 없게 되거나 지운 설계가 되살아난다.
 */

const templates = getTableConfig(ohPartTemplates);
const items = getTableConfig(ohPartTemplateItems);
const models = getTableConfig(ohPartTemplateModels);
const prices = getTableConfig(partOverhaulUnitPrices);

const columnOf = (table: ReturnType<typeof getTableConfig>, name: string) => table.columns.find((c) => c.name === name);

describe("표 이름 — 넷", () => {
  it("템플릿 머리는 oh_part_templates", () => {
    assert.equal(templates.name, "oh_part_templates");
  });

  it("템플릿에 든 부품 줄은 oh_part_template_items", () => {
    assert.equal(items.name, "oh_part_template_items");
  });

  it("제품 모델 잇기는 oh_part_template_models", () => {
    assert.equal(models.name, "oh_part_template_models");
  });

  it("O/H 단가는 part_overhaul_unit_prices — 원본(A/S)과 같은 이름", () => {
    assert.equal(prices.name, "part_overhaul_unit_prices");
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

describe("🔴 낙관적 잠금 — version", () => {
  it("version 은 notNull 이고 기본 1", () => {
    const col = columnOf(templates, "version");
    assert.ok(col, "version 이 없으면 나중에 저장한 사람이 앞사람 것을 조용히 덮는다");
    assert.equal(col.notNull, true);
    assert.equal(col.default, 1);
  });

  it("version 은 정수다 — 1씩 올린다", () => {
    assert.equal(columnOf(templates, "version")?.getSQLType(), "integer");
  });
});

describe("🔴 없어야 하는 칸 둘 — 되살리지 마라", () => {
  it("sort_order 는 없다 — 원본 화면에 차례 바꾸기가 없고 이름 순으로 본다", () => {
    assert.equal(columnOf(templates, "sort_order"), undefined);
  });

  it("차례용 부분 인덱스도 없다", () => {
    const idx = templates.indexes.find((i) => i.config.name === "oh_part_templates_not_deleted_idx");
    assert.equal(idx, undefined);
  });

  it("oh_price 는 템플릿 줄에 없다 — 단가는 부품당 하나로 별도 표에 산다", () => {
    assert.equal(columnOf(items, "oh_price"), undefined);
  });

  it("단가 CHECK 도 템플릿 줄에서 사라졌다 — 수량 검사 하나만 남는다", () => {
    const names = items.checks.map((c) => c.name).sort();
    assert.deepEqual(names, ["oh_part_template_items_quantity_positive"]);
  });
});

describe("🔴 빌 수 있어야 하는 칸", () => {
  it("part_id 는 비는 것이 정상이다 — 재고 마스터에 없는 이름이 있다", () => {
    const col = columnOf(items, "part_id");
    assert.ok(col);
    assert.equal(col.notNull, false, "notNull 로 바꾸면 「유량계」 같은 줄을 아예 넣을 수 없다");
  });

  it("created_by·updated_by 는 빌 수 있다 — 옮겨 온 줄에는 사람이 없다", () => {
    for (const name of ["created_by", "updated_by"]) {
      assert.equal(columnOf(templates, name)?.notNull, false, name);
    }
  });
});

describe("반드시 있어야 하는 칸", () => {
  it("template_id 는 notNull — 주인 없는 줄은 없다", () => {
    assert.equal(columnOf(items, "template_id")?.notNull, true);
  });

  it("name 은 notNull, note 는 빌 수 있다", () => {
    assert.equal(columnOf(templates, "name")?.notNull, true);
    assert.equal(columnOf(templates, "note")?.notNull, false);
  });

  it("display_order·part_name_text·quantity 는 notNull", () => {
    for (const name of ["display_order", "part_name_text", "quantity"]) {
      assert.equal(columnOf(items, name)?.notNull, true, name);
    }
  });
});

describe("🔴 기종 코드 칸은 없앴다 (2026-10-15, 조각 9a)", () => {
  it("code 칸이 없다 — 양식의 K11 흔적이고, 지금은 제품 모델을 직접 잇는다", () => {
    assert.equal(
      columnOf(templates, "code"),
      undefined,
      "되살리면 템플릿을 가리키는 열쇠가 둘이 되어 어긋났을 때 어느 쪽이 진짜인지 답할 수 없다",
    );
  });

  it("코드 부분 unique 도 사라졌다", () => {
    const uq = templates.indexes.find((i) => i.config.name === "oh_part_templates_code_uq");
    assert.equal(uq, undefined);
  });

  it("이름은 글자다", () => {
    assert.equal(columnOf(templates, "name")?.getSQLType(), "text");
  });
});

describe("제품 모델 잇기", () => {
  it("product_model_id 는 notNull", () => {
    assert.equal(columnOf(models, "product_model_id")?.notNull, true);
  });

  it("🔴 product_model_id 는 unique — 모델 하나는 템플릿 하나에만 붙는다", () => {
    const uq = models.indexes.find((i) => i.config.name === "oh_part_template_models_model_uq");
    assert.ok(uq, "oh_part_template_models_model_uq 가 없으면 「이 모델의 O/H 부품」이 두 가지가 된다");
    assert.equal(uq.config.unique, true);
  });

  it("🔴 product_model_id 에 FK 가 없다 — 제품 모델 표가 이 시스템에 없다", () => {
    const fk = models.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "product_model_id"));
    assert.equal(fk, undefined, "A/S 의 ID 를 글자로 적어 둘 뿐이다");
  });

  it("product_model_name 은 notNull — A/S 가 꺼져 있어도 어느 모델인지 남아야 한다", () => {
    const col = columnOf(models, "product_model_name");
    assert.ok(col);
    assert.equal(col.notNull, true);
    assert.equal(col.getSQLType(), "text");
  });

  it("template_id 는 notNull 이고 템플릿별로 찾을 인덱스가 있다", () => {
    assert.equal(columnOf(models, "template_id")?.notNull, true);
    assert.ok(models.indexes.find((i) => i.config.name === "oh_part_template_models_template_idx"));
  });

  it("created_by 는 빌 수 있다", () => {
    assert.equal(columnOf(models, "created_by")?.notNull, false);
  });
});

describe("O/H 단가 — 부품당 하나", () => {
  it("part_id 는 notNull", () => {
    assert.equal(columnOf(prices, "part_id")?.notNull, true);
  });

  it("unit_price 는 notNull — 행이 있으면 값이 있다(「정하지 않음」은 행이 없는 것)", () => {
    const col = columnOf(prices, "unit_price");
    assert.ok(col);
    assert.equal(col.notNull, true);
  });

  it("🔵 unit_price 는 bigint(원 단위) — 이 저장소의 돈 칸과 같은 모양", () => {
    assert.equal(columnOf(prices, "unit_price")?.getSQLType(), "bigint");
  });

  it("🔴 part_id 는 unique — 부품당 한 줄", () => {
    const uq = prices.indexes.find((i) => i.config.name === "part_overhaul_unit_prices_part_uq");
    assert.ok(uq, "part_overhaul_unit_prices_part_uq 가 없다");
    assert.equal(uq.config.unique, true);
  });

  it("음수 단가는 DB 가 막는다", () => {
    const names = prices.checks.map((c) => c.name).sort();
    assert.deepEqual(names, ["part_overhaul_unit_prices_not_negative"]);
  });

  it("updated_by 는 빌 수 있다 — FK 없음(관례)", () => {
    assert.equal(columnOf(prices, "updated_by")?.notNull, false);
  });
});

describe("인덱스·제약", () => {
  it("템플릿 이름은 지우지 않은 줄 안에서만 유일하다", () => {
    const uq = templates.indexes.find((i) => i.config.name === "oh_part_templates_name_uq");
    assert.ok(uq, "oh_part_templates_name_uq 가 없으면 같은 이름이 둘 서고 사람이 어느 것을 고칠지 모른다");
    assert.equal(uq.config.unique, true);
    assert.ok(uq.config.where, "부분 인덱스가 아니면 지운 이름을 다시 쓸 수 없다");
  });

  it("한 템플릿 안에서 차례는 한 번만", () => {
    const uq = items.indexes.find((i) => i.config.name === "oh_part_template_items_template_order_uq");
    assert.ok(uq);
    assert.equal(uq.config.unique, true);
  });
});
