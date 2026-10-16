import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PART_FIELD_LABEL } from "../src/lib/audit-labels";
import { isLowStock, lowStockTitle } from "../src/lib/parts/codes";

/**
 * ============================================================================
 * 한계수량 — 칸 하나가 지켜야 하는 울타리들 (2026-10-16 사용자 요청)
 * ============================================================================
 * 「부품 상세, 부품등록에서 한계수량을 설정할 수 있도록. 한계수량 아래로 재고가 떨어졌을
 * 때에 알림이 뜨도록. 알림을 누르면 해당 부품 상세가 뜨도록.」
 *
 * 🔴 **부등호는 「이하」다** — 같은 날 사용자가 **「같을 때도 알린다」**로 정했다(처음 판은
 *    「미만」이었다). 그래서 **한계수량 `0` 은 끄는 값이 아니다**: 재고가 0 이면 `0 <= 0` 이라
 *    울린다(「하나도 안 남으면 알려라」). **끄는 길은 칸을 비우는 것(`null`) 하나뿐**이다.
 *
 * 🔴 **이 저장소에는 화면 렌더 시험도 DB 시험도 없다**(`tests/part-field-order.test.ts` 머리말).
 *    그래서 순수 함수로 잴 수 없는 넷 — 질의의 WHERE·ORDER BY, 화면의 자격, 서버 액션의 가드,
 *    「목록과 같은 수를 본다」 — 은 **파일 글자에서** 잰다. 느슨한 시험이지만, 느슨해도 있는 편이
 *    낫다: 이 넷은 하나만 어긋나도 **오류 없이 조용히** 틀린 알림이 된다.
 *
 * 🔵 값 자체의 규칙(`null` 과 `0` · 음수 거절)은 순수 함수라 `tests/parts-form.test.ts` 에서,
 *    줄을 빚는 규칙(같을 때도 알림 · 상한 · 주소)은 `tests/notifications-bell-items.test.ts` 에서 잰다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 주석을 떼어 낸 코드만. 🔴 **글자로 재는 시험은 주석까지 긁는다** — 함정을 설명하려고 주석에 적어
 * 둔 인용 때문에 시험이 깨진 적이 있다(2026-10-16). 설명을 지우는 대신 **재는 쪽을 좁힌다.**
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // 블록 주석(JSX 의 {/* … */} 포함)
    .replace(/\/\/.*$/gm, ""); // 줄 주석
}

/** 질의 `listLowStockParts` 의 본문만. 🔴 끝을 끊지 않으면 뒤 함수의 글자에 걸려 헛통과한다. */
function lowStockQuery(): string {
  const queries = src("src/lib/parts/queries.ts");
  const from = queries.indexOf("export async function listLowStockParts");
  assert.notEqual(from, -1, "listLowStockParts 가 없어졌거나 이름이 바뀌었다");
  const to = queries.indexOf("/** 설정 화면용", from);
  assert.notEqual(to, -1, "질의 뒤의 다음 함수를 못 찾았다 — 자를 자리를 다시 정해야 한다");
  return queries.slice(from, to);
}

describe("재고를 세는 수 — 목록이 보여 주는 그 값이어야 한다", () => {
  /**
   * 🔴 다른 수(예: 신청에 묶여 아직 안 나간 수량을 뺀 잔량)와 견주면 「목록엔 5개인데 알림은
   * 모자라다고 한다」가 된다. 재고 현황 목록(`listParts`)이 읽는 자리와 **같은 자리**를 읽는지 본다.
   *
   * 🔴 **「어딘가에 적혀 있나」로 재지 않는다** — 견주는 자리(WHERE)만 따로 본다. 처음엔 함수
   * 전체에서 글자를 찾았는데, WHERE 를 엉뚱한 칸으로 바꿔 놓아도 ORDER BY 에 남은 글자 때문에
   * **통과했다**(2026-10-16 역검증에서 잡았다).
   */
  it("🔴 **견주는 자리**가 `stock_balances.quantity` 다 — 목록과 같은 표·같은 칸", () => {
    const queries = src("src/lib/parts/queries.ts");
    const listParts = queries.slice(queries.indexOf("export async function listParts"), queries.indexOf("export async function listPartItems"));
    assert.ok(listParts.includes("quantity: stockBalances.quantity"), "목록이 더 이상 stock_balances 를 읽지 않는다 — 알림이 보는 수와 갈렸을 수 있다");
    const body = lowStockQuery();
    const compare = body.slice(body.indexOf(".where("), body.indexOf(".orderBy("));
    assert.ok(compare.includes("stockBalances.quantity"), "한계수량과 견주는 수가 stock_balances 가 아니다 — 「목록엔 5개인데 알림은 모자라다고 한다」가 된다");
  });

  it("🔴 수량 줄이 없는 부품을 **0 으로** 본다 — 목록의 `?? 0` 과 같은 말이다", () => {
    const queries = src("src/lib/parts/queries.ts");
    assert.ok(queries.includes("quantity: r.quantity ?? 0"), "목록이 수량 없는 부품을 0 으로 보지 않는다");
    const body = lowStockQuery();
    // 🔴 세 군데(WHERE·ORDER BY·돌려주는 값)가 **같은 글자**여야 한다 — 하나만 달라도 조용히 어긋난다.
    const sameShape = [...body.matchAll(/coalesce\(\$\{stockBalances\.quantity\}, 0\)/g)];
    assert.equal(sameShape.length, 3, `수량 줄 없는 부품을 0 으로 보는 셈이 세 군데 모두 같지 않다(${sameShape.length}군데)`);
    assert.ok(body.includes("leftJoin(stockBalances"), "innerJoin 이면 수량 줄이 없는 부품이 통째로 빠진다");
  });
});

describe("질의의 울타리 셋", () => {
  it("🔴 한계수량이 null 인 부품은 세지 않는다 — `IS NOT NULL` 이 그 울타리다", () => {
    assert.ok(lowStockQuery().includes("isNotNull(parts.limitQuantity)"), "정하지 않은 부품까지 알림 대상이 된다");
  });

  it("🔴 지워진(소프트 삭제) 부품은 세지 않는다", () => {
    assert.ok(lowStockQuery().includes("eq(parts.isDeleted, false)"), "지워진 부품이 종에 뜬다 — 눌러도 「부품이 없습니다」가 나온다");
  });

  it("🔴 **이하**다 — 같을 때도 알린다 (2026-10-16 사용자 결정)", () => {
    const sql = lowStockQuery();
    assert.ok(sql.includes("<= ${parts.limitQuantity}"), "질의가 「이하」가 아니다 — 한계수량에 딱 맞춘 부품이 종에 안 뜬다");
    assert.ok(!sql.includes("< ${parts.limitQuantity}"), "질의가 아직 「미만」이다(`<`)");
    // 뜻이 적힌 자리는 순수 함수라 직접 돌려 본다.
    assert.equal(isLowStock(5, 5), true);
    assert.equal(isLowStock(6, 5), false);
  });

  /**
   * 🔴 **한쪽만 고치면 「종에는 뜨는데 눌러도 없는」 줄이 생긴다.** 그래서 부등호를 글자로 두 번
   * 적어 두고 눈으로 맞춰 보는 대신, **양쪽에서 부등호를 뽑아 같은지 센다** — 한쪽만 바꾸면
   * 여기서 깨진다. (2026-10-16 에 실제로 「미만 → 이하」로 한 번 바뀐 자리다.)
   */
  it("🔴 뜻(`isLowStock`)과 질의의 WHERE 가 **같은 부등호**를 쓴다", () => {
    const fn = /return quantity (<=?) limit;/.exec(src("src/lib/parts/codes.ts"));
    const where = /coalesce\(\$\{stockBalances\.quantity\}, 0\) (<=?) \$\{parts\.limitQuantity\}/.exec(lowStockQuery());
    assert.ok(fn, "isLowStock 의 부등호를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
    assert.ok(where, "질의의 부등호를 못 찾았다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라");
    assert.equal(where[1], fn[1], `뜻은 \`${fn[1]}\` 인데 질의는 \`${where[1]}\` 다 — 종에는 뜨는데 눌러도 없는 줄이 생긴다`);
  });

  it("🔵 모자란 만큼 큰 순 — 상한에서 잘릴 때 급한 것이 남는다", () => {
    assert.ok(lowStockQuery().includes("desc"), "차례를 정하지 않으면 잘릴 때 무엇이 남을지 알 수 없다");
  });
});

/**
 * 🔴 **「0 은 끄는 값이 아니다」가 화면 글자에도 적혀 있어야 한다.** 설명이 반만 맞으면 사람이
 * 0 을 「끄기」로 쓰고, 그 부품은 재고가 0 이 되는 날 조용히 울린다. 세 자리(등록 폼·상세 창·
 * 포털 설정 표)가 같은 말을 하는지 본다.
 */
describe("화면 글자가 새 뜻과 맞는가 (2026-10-16 「이하」로 바뀐 뒤)", () => {
  it("🔴 등록 폼이 「같거나 적어지면」과 「비워 두십시오」를 둘 다 말한다", () => {
    const form = src("src/components/parts/PartForm.tsx");
    assert.ok(form.includes("같거나 적어지면"), "폼 설명이 아직 「보다 적어지면」이다 — 같을 때도 알리는데 거짓말이 된다");
    assert.ok(form.includes("비워 두십시오"), "끄는 길(비우기)이 폼에 안 적혀 있다");
  });

  it("🔴 상세 창도 같은 말을 한다", () => {
    const dialog = src("src/components/parts/PartDetailDialog.tsx");
    assert.ok(dialog.includes("같거나 적어지면"), "상세 창 설명이 아직 「보다 적어지면」이다");
    assert.ok(dialog.includes("알리지 않으려면 비워 두십시오"), "끄는 길(비우기)이 상세 창에 안 적혀 있다");
  });

  /**
   * 🔴 **주석을 빼고 잰다.** 처음엔 파일 글자 전체에서 `quantity < value` 를 찾았는데, 바로 그
   * 함정을 설명하려고 **주석에 적어 둔 인용**이 걸려 시험이 깨졌다(2026-10-16). 글자로 재는
   * 시험은 주석까지 긁는다는 것을 잊지 마라 — 지우는 쪽으로 풀면 설명이 사라지므로 **재는
   * 쪽을 좁힌다.**
   */
  it("🔴 「부족」 딱지가 종과 **같은 함수**를 본다 — 손으로 적은 부등호가 없다", () => {
    const dialog = src("src/components/parts/PartDetailDialog.tsx");
    assert.ok(dialog.includes("isLowStock(quantity, value)"), "딱지가 공용 함수를 안 쓴다 — 「상세엔 부족이라는데 종은 조용하다」가 된다");
    const code = stripComments(dialog);
    assert.ok(!/quantity <=? value/.test(code), "딱지에 부등호를 손으로 적어 두었다 — 한쪽만 고쳐지는 날이 온다");
  });
});

/**
 * ============================================================================
 * 재고 현황 표의 **붉은 수량** (2026-10-16 쓰는 분 요청)
 * ============================================================================
 * 「한계수량 이하이면 재고현황 표에서 해당 부품의 수량이 빨간색 붉은 글씨로 칠해지도록」
 *
 * 🔴 **이 저장소에는 화면 렌더 시험이 없다**(이 파일 머리말) — 칠해지는 **조건**은 순수 함수
 *    (`isLowStock`)로 직접 재고, 「그 함수를 쓰는가」는 파일 글자에서 잰다.
 */
describe("재고 현황 표의 붉은 수량 (2026-10-16)", () => {
  it("🔴 판정이 **그 함수 하나**를 본다 — 손으로 적은 부등호가 없다", () => {
    const list = src("src/components/parts/PartsList.tsx");
    assert.ok(list.includes("isLowStock(p.quantity, p.limitQuantity)"), "목록이 공용 함수를 안 쓴다 — 종·상세와 갈라진다");
    const code = stripComments(list);
    assert.ok(!/limitQuantity\s*[<>]=?/.test(code), "목록에 부등호를 손으로 적어 두었다");
    assert.ok(!/[<>]=?\s*p\.limitQuantity/.test(code), "목록에 부등호를 손으로 적어 두었다");
  });

  it("🔴 **수량 칸만** 칠한다 — 붉은 글자색이 그 한 칸에만 붙는다", () => {
    const code = stripComments(src("src/components/parts/PartsList.tsx"));
    const reds = [...code.matchAll(/text-red-\d{3}/g)];
    assert.equal(reds.length, 1, `목록에 붉은 글자색이 ${reds.length}군데다 — 수량 칸 하나여야 한다(줄 전체를 칠하지 않는다)`);
    // 그 한 군데가 수량 칸인지: 같은 식 안에 판정이 함께 있어야 한다.
    assert.ok(/isLowStock\(p\.quantity, p\.limitQuantity\) \? "text-red-700" : ""/.test(code), "붉은 색이 수량 칸의 판정에 달려 있지 않다");
  });

  it("🔵 색만으로 알리지 않는다 — 수량 칸에 까닭이 글자로도 달린다", () => {
    const code = stripComments(src("src/components/parts/PartsList.tsx"));
    assert.ok(code.includes("title={lowStockTitle(p.quantity, p.limitQuantity)}"), "붉은 칸에 title 이 없다 — 색을 못 가리는 사람에게는 아무 표시도 없는 것과 같다");
  });

  it("🔴 걸리지 않은 부품에는 title 이 없다 — 모든 칸에 글이 붙으면 신호가 아니다", () => {
    assert.equal(lowStockTitle(6, 5), undefined);
    assert.equal(lowStockTitle(0, null), undefined, "한계수량을 정하지 않은 부품은 그대로 둔다");
  });

  it("🔴 걸린 부품의 글은 두 수를 그대로 말한다 — 같을 때도 0 일 때도", () => {
    assert.equal(lowStockTitle(5, 5), "한계수량 5개 이하입니다. 지금 재고 5개 — 채워 넣을 때입니다.");
    assert.equal(lowStockTitle(0, 0), "한계수량 0개 이하입니다. 지금 재고 0개 — 채워 넣을 때입니다.");
    assert.equal(lowStockTitle(2, 1200), "한계수량 1,200개 이하입니다. 지금 재고 2개 — 채워 넣을 때입니다.");
  });

  /**
   * 🔴 **종이에는 칠하지 않기로 했다**(2026-10-16). 흑백으로 뽑으면 붉은 글씨가 뜻 없는 회색이 되고,
   * 종이에는 `title` 을 띄울 마우스도 없다 — 색이 유일한 신호인데 그 신호가 사라진다. **일부러 비워
   * 둔 자리**라, 다음 사람이 「빠뜨렸다」고 보고 조용히 넣지 않도록 여기서도 못 박는다.
   */
  it("🔴 인쇄 화면은 칠하지 않는다 — 결정이고 빠뜨린 것이 아니다", () => {
    const print = src("src/app/print/parts/page.tsx");
    assert.ok(!/text-red-\d{3}/.test(stripComments(print)), "인쇄 화면에 붉은 글자색이 생겼다 — 흑백에서 뜻 없는 회색이 된다. 바꾸려면 쓰는 분 승인이 먼저다");
    assert.ok(print.includes("종이에는 한계수량 빨강을 칠하지 않는다"), "그 결정의 까닭이 인쇄 화면에서 사라졌다");
  });
});

/**
 * 🔴 **판정이 적힌 자리는 하나다.** 지금 그 함수를 보는 곳이 **넷**이다 — 질의의 WHERE · 종의 조립 ·
 * 상세 창의 딱지 · 재고 현황 표의 붉은 수량. 다섯째가 생기는 날 손으로 적은 부등호를 들고 오면
 * 「목록만 안 빨개진다」·「종에는 뜨는데 눌러도 없다」가 된다.
 */
describe("🔴 네 자리가 한 함수를 본다", () => {
  it("세 화면·묶음이 `isLowStock` 을 부르고, 어느 쪽도 부등호를 손으로 적지 않는다", () => {
    const callers = [
      ["src/lib/notifications/bell-items.ts", "isLowStock(row.quantity, row.limitQuantity)"],
      ["src/components/parts/PartDetailDialog.tsx", "isLowStock(quantity, value)"],
      ["src/components/parts/PartsList.tsx", "isLowStock(p.quantity, p.limitQuantity)"],
    ] as const;
    for (const [file, call] of callers) {
      const code = stripComments(src(file));
      assert.ok(code.includes(call), `${file} 가 공용 판정을 안 쓴다`);
      assert.ok(!/limitQuantity\s*[<>]=?/.test(code), `${file} 에 부등호를 손으로 적어 두었다`);
    }
    // 네 번째 자리(질의의 WHERE)는 SQL 이라 글자로 잴 수 없다 — 위 「같은 부등호를 쓴다」가 그 몫이다.
    assert.ok(lowStockQuery().includes("<= ${parts.limitQuantity}"));
  });
});

describe("고치는 길 — 자격과 이력", () => {
  /**
   * 🔴 **자른 범위를 파일 끝까지 두지 않는다.** 처음엔 그렇게 적었다가, 가드를 STAFF 로 내려
   * 놓아도 **뒤에 있는 `deletePartAction` 의 `requireRole("ADMIN")`** 에 걸려 시험이 통과했다
   * (2026-10-16 역검증에서 잡았다). 아래 이력 시험도 같은 함정이었다 — `fillCustomerName` 이
   * 같은 글자를 들고 있다.
   */
  it("🔴 상세 창의 한계수량은 **관리자(ADMIN)** 만 고친다 — 기존 가드를 내리지 않았다", () => {
    const actions = src("src/app/actions/parts.ts");
    const action = actions.slice(actions.indexOf("export async function saveLimitQuantityAction"), actions.indexOf("export interface DeletePartState"));
    assert.notEqual(action, "", "saveLimitQuantityAction 이 없어졌거나 자리가 바뀌었다");
    assert.ok(action.includes('requireRole("ADMIN")'), "한계수량 저장이 관리자 가드를 안 지난다");
    // 🔵 고객사 품명은 2026-10-14 에 그 칸만 따로 STAFF 로 정한 것이다 — 그 가드는 그대로 둔다.
    const customerName = actions.slice(actions.indexOf("export async function saveCustomerNameAction"), actions.indexOf("export async function saveLimitQuantityAction"));
    assert.ok(customerName.includes('requireRole("STAFF")'), "고객사 품명의 가드가 바뀌었다 — 이 조각이 건드릴 자리가 아니다");
  });

  it("🔴 화면도 같은 문턱을 본다 — `canEdit`(관리자)이지 `canRecord` 가 아니다", () => {
    const dialog = src("src/components/parts/PartDetailDialog.tsx");
    assert.ok(dialog.includes("<LimitQuantityField"), "상세 창에 한계수량 칸이 없다");
    const tag = dialog.slice(dialog.indexOf("<LimitQuantityField"));
    assert.ok(tag.slice(0, tag.indexOf("/>")).includes("canEdit={canEdit}"), "한계수량 칸의 [고치기] 가 관리자 아닌 사람에게도 보인다");
  });

  it("🔴 바꾼 것이 변경 이력에 남는다 — 안 남기면 알림이 왜 꺼졌는지 아무도 모른다", () => {
    const mutations = src("src/lib/parts/mutations.ts");
    // 🔴 끝을 반드시 끊는다 — 파일 끝까지 자르면 `fillCustomerName` 의 같은 글자에 걸려 통과한다(위 주석).
    const fn = mutations.slice(mutations.indexOf("export async function updateLimitQuantity"), mutations.indexOf("export type FillCustomerNameResult"));
    assert.notEqual(fn, "", "updateLimitQuantity 가 없어졌거나 자리가 바뀌었다");
    assert.ok(fn.includes('action: "PART_UPDATE"'), "한계수량 변경이 감사 로그에 안 남는다");
    assert.ok(fn.includes("changes: { limitQuantity:"), "앞·뒤 값이 안 남는다");
    // 🔵 `/audit` 이 그 칸을 한글로 그린다.
    assert.equal(PART_FIELD_LABEL.limitQuantity, "한계수량");
  });

  it("🔴 한 트랜잭션 안에서 — 값만 바뀌고 이력이 빠지는 일은 없다", () => {
    const mutations = src("src/lib/parts/mutations.ts");
    const fn = mutations.slice(mutations.indexOf("export async function updateLimitQuantity"), mutations.indexOf("export type FillCustomerNameResult"));
    assert.ok(fn.includes("db().transaction("), "한계수량 저장이 트랜잭션 밖에 있다");
    // 🔴 이 칸 말고는 아무것도 건드리지 않는다 — 폼 전체를 덮어쓰면 적지 않은 칸이 지워진다.
    assert.ok(fn.includes(".set({ limitQuantity, updatedBy: actor.id, updatedAt: now })"), "한계수량 말고 다른 칸까지 쓰고 있다");
  });
});

describe("등록 폼에도 칸이 있다", () => {
  it("🔴 부품 등록·수정 폼이 `limitQuantity` 를 보낸다", () => {
    const form = src("src/components/parts/PartForm.tsx");
    assert.ok(form.includes('name="limitQuantity"'), "폼에 한계수량 칸이 없다 — 등록할 때 정할 길이 없어진다");
    assert.ok(form.includes("한계수량"), "라벨이 사용자가 쓴 말(한계수량)이 아니다");
  });

  it("🔴 등록 화면의 처음 값이 **빈 칸**이다 — 새 부품은 알림을 켜지 않는다", () => {
    const page = src("src/app/(app)/parts/new/page.tsx");
    assert.ok(page.includes('limitQuantity: ""'), "등록 화면이 한계수량에 값을 미리 넣는다 — 모든 새 부품이 알림 대상이 된다");
  });
});
