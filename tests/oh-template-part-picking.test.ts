import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { describeOhPartLink, type OhPartLinkOption } from "../src/lib/oh/link-state";
import { overhaulUnitPriceFollowsQuote, resolveOverhaulUnitPrice } from "../src/lib/oh/unit-price";
import { PART_FIELDS } from "../src/lib/parts/field-order";

/**
 * ============================================================================
 * O/H 템플릿 — 부품을 **찾아서 고른다**, 단가를 **비워 두면 견적가가 쓰인다** (2026-10-22)
 * ============================================================================
 * 쓰는 분의 말 그대로:
 *   ① 「부품 고르기를 A/S 의 [수리 건 상세]와 같은 방식으로 — 검색 결과가 뜨고 그중에서 고른다」
 *   ② 「O/H 단가 칸에 기존 견적단가가 회색으로 비쳐 보이고, 임의로 고쳐 적을 수도 있어야 한다」
 *
 * ── 🔴 ② 의 답이 **같은 날 오후에 뒤집혔다** ────────────────────────────
 * 아침 커밋 `9d8df96` 은 ② 를 「**비쳐 주기만** 한다 — 비워 두면 **정하지 않음**이고,
 * `[견적가 N원 적용]` 단추를 **눌러야** 값이 들어간다」로 풀었고, 이 묶음의 시험 이름들이
 * 그렇게 적혀 있었다. 🔴 **그 글이 틀린 설계를 못 박고 있었다** — 단언은 맞으니 영영 통과한다.
 * 오후에 쓰는 분이 정하신 것:
 *
 *   「비워 두면 견적가가 자동으로 쓰인다. 나중에 견적가가 바뀌면 따라서 바뀐다.
 *    그렇게 되면 [견적가 적용]이라는 단추도 필요 없어질 테니까.」
 *
 * 그래서 이 묶음을 **지우지 않고 새 뜻으로 다시 썼다.** 바뀐 단언마다 까닭을 그 자리에 적었다.
 *
 * ── 🔵 그런데 「칸에 값을 미리 붓지 않는다」는 **그대로 남는다** — 까닭이 바뀌었을 뿐 ──
 * 아침의 까닭: 「부어 두면 『따라간다』와 『마침 같은 숫자를 적어 두었다』가 구별되지 않는다」.
 * 오후의 까닭: 🔴 **부어 두면 그 순간의 숫자에 박혀 「견적가가 바뀌면 따라 바뀐다」가 깨진다.**
 * 두 결정이 같은 자리를 지킨다. 바뀐 것은 **비어 있음의 뜻**이고(「정하지 않음」 → 「견적가를
 * 따른다」), 푸는 일은 **읽는 쪽 한 함수**(`resolveOverhaulUnitPrice`)가 맡는다.
 *
 * ── 🔴 이 화면에는 렌더 시험 틀이 없다 ──────────────────────────────────
 * 서버 액션을 물고 있어 그릴 수 없다(`tests/part-limit-quantity.test.ts` 머리말과 같은 사정).
 * 그래서 **파일 글자에서** 잰다. 느슨하지만, 여기서 지키는 둘은 어긋나도 **오류가 안 난다**:
 * 고르개가 도로 접히는 것도, 견적가가 값으로 새어 들어가는 것도 화면에서만 드러난다.
 * 🔵 다만 **푸는 규칙 자체는 순수 함수**라 글자가 아니라 **값으로** 잰다(아래 ②-가).
 *
 * 🔴 **재는 쪽을 좁힌다** — 주석을 떼고(`stripComments`), 그 줄을 그리는 자리만 잘라서 본다.
 *    이 시험이 설명하려고 인용한 글자가 그대로 세어지면 헛통과·헛실패가 난다(2026-10-16 의 함정).
 * ============================================================================
 */

const src = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 떼어 낸 코드만. JSX 의 중괄호 주석도 블록 주석이라 함께 떨어진다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const SCREEN = stripComments(src("src/components/settings/OhTemplateScreen.tsx"));

/** 두 글자 사이만 자른다. 🔴 끝을 안 끊으면 뒤 글자에 걸려 헛통과한다. */
function slice(source: string, fromText: string, toText: string, what: string): string {
  const from = source.indexOf(fromText);
  assert.notEqual(from, -1, `${what}: 시작 글자를 못 찾았다 — 자를 자리를 다시 정해야 한다`);
  const to = source.indexOf(toText, from + fromText.length);
  assert.notEqual(to, -1, `${what}: 끝 글자를 못 찾았다 — 자를 자리를 다시 정해야 한다`);
  return source.slice(from, to);
}

/** 부품 줄 하나를 그리는 자리만. 끝은 줄 목록 뒤에 오는 안내문이다. */
const ITEM_ROW = slice(SCREEN, "items.map((row, index)", "재고에 이어지지 않은 줄이", "부품 줄");

/** 저장할 때 **보낼 단가 줄을 고르는** 자리만. */
const PRICE_ENTRIES = slice(SCREEN, "const priceEntries = [", "const result = await saveOhTemplateAction", "보낼 단가");

/** 저장된 단가를 칸에 채우는 함수만. */
const PRICE_DRAFT = slice(SCREEN, "function toPriceDraft", "function knownPriceParts", "단가 초안");

/** 접은 목록에 O/H 단가를 적는 함수만. 🔵 **편집 칸이 아니라 읽는 글자**다 — 거기는 푼 값을 적는다. */
const PRICE_TEXT = slice(SCREEN, "function priceText", "export function OhTemplateScreen", "접은 목록의 단가 글자");

/** 고르개가 받는 부품 목록을 읽는 질의만. */
const PART_OPTIONS_QUERY = slice(
  src("src/lib/oh/queries.ts"),
  "export async function listOhPartOptions",
  "export type OhTemplateForModel",
  "부품 목록 질의",
);

const PICKER = stripComments(src("src/components/parts/PartPicker.tsx"));
/** 자세한 줄을 그리는 조각만. 파일 끝까지라 끊을 글자가 없다. */
const DETAILED_ROW = PICKER.slice(PICKER.indexOf("function DetailedRow"));
/** 줄 모양이 갈리는 자리. 앞이 자세한 쪽, `) : (` 뒤가 **기본 쪽**이다. */
const ROW_BRANCH = slice(PICKER, "{detailed ? (", "</button>", "줄 모양 갈림");
const PLAIN_BRANCH = ROW_BRANCH.slice(ROW_BRANCH.indexOf(") : ("));

/* ──────────────── ① 찾아서 고른다 ──────────────── */

describe("① 부품은 **찾아서 고른다** — 공용 고르개를 쓴다", () => {
  it("🔴 공용 `PartPicker` 를 불러 쓴다 — 이 화면이 제 고르개를 따로 만들지 않았다", () => {
    assert.ok(
      SCREEN.includes('import { PartPicker } from "@/components/parts/PartPicker";'),
      "공용 고르개를 안 쓴다 — 베끼면 한쪽만 고쳐지는 날 같은 일이 화면마다 다른 뜻이 된다",
    );
    assert.ok(ITEM_ROW.includes("<PartPicker"), "부품 줄에 고르개가 없다");
  });

  it("🔴 거르는 규칙을 이 화면에 다시 쓰지 않았다 — 규칙은 `src/lib/parts/search.ts` 한 곳이다", () => {
    for (const rule of ["matchesPartQuery", "tokenizePartQuery"]) {
      assert.ok(!SCREEN.includes(rule), `${rule} 가 화면으로 베껴졌다 — 시험이 붙어 있는 순수 함수 쪽을 써야 한다`);
    }
  });

  it("🔴 아직 아무것도 아닌 줄은 고르개가 **기본으로 펼쳐져** 있다 (2026-10-22 요청 1)", () => {
    const line = ITEM_ROW.split("\n").find((one) => one.includes("const pickerShown"));
    assert.ok(line, "pickerShown 이 없어졌다 — 고르개를 펼칠지 정하는 자리가 사라졌다");
    assert.ok(
      line.includes('link.kind === "EMPTY"'),
      "빈 줄에서 저절로 펼쳐지지 않는다 — 작은 글씨 뒤에 접혀 있던 것이 요청 1 의 까닭이었다",
    );
    assert.ok(
      line.includes("collapsedPickers"),
      "접은 줄을 기억하지 않는다 — 기본이 펼침이라 「안 접었다」를 알아야 닫기 단추가 듣는다",
    );
  });

  it("🔴 고르개를 그리는 조건이 그 판정(`pickerShown`)이다 — 예전처럼 펼친 줄 하나만 보지 않는다", () => {
    assert.ok(ITEM_ROW.includes("pickerShown && !busy"), "고르개를 pickerShown 으로 그리지 않는다");
    assert.ok(
      !ITEM_ROW.includes("{pickerKey === row.key && !busy"),
      "예전 조건이 남아 있다 — 빈 줄의 기본 펼침이 그 자리에서 다시 막힌다",
    );
  });

  it("🔴 이어지지 않은 줄에서는 찾는 칸이 **품명 칸보다 먼저** 선다 (글상자 둘이면 위엣것에 친다)", () => {
    const freeRow = slice(ITEM_ROW, "row.partId === null ? (", "aria-label={`${index + 1}번째 부품 품명`}", "자유 입력 줄");
    const pickerAt = freeRow.indexOf("{picker}");
    const inputAt = freeRow.indexOf("value={row.partNameText}");
    assert.notEqual(pickerAt, -1, "이어지지 않은 줄에 고르개가 안 꽂혀 있다");
    assert.notEqual(inputAt, -1, "품명 입력칸을 못 찾았다");
    assert.ok(pickerAt < inputAt, "품명 칸이 찾는 칸보다 먼저 선다 — A/S 의 [수리 건 상세]는 찾는 칸이 맨 위다");
  });

  it("🔵 **자유 입력을 없애지 않았다** — 재고 마스터에 없는 이름은 여전히 손으로 적는다", () => {
    assert.ok(
      ITEM_ROW.includes("changePartName(row.key, e.target.value)"),
      "품명을 직접 적는 길이 사라졌다 — 양식에서 옮겨 온 이름 중에 재고에 없는 것이 있다",
    );
  });

  it("고르개를 펼칠 줄의 판정 — 이음도 품명도 없으면 `EMPTY` 다 (공백만 친 것도 같다)", () => {
    const options: OhPartLinkOption[] = [];
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "" }, options), { kind: "EMPTY" });
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "   " }, options), { kind: "EMPTY" });
    // 🔴 품명을 치기 시작하면 더는 빈 줄이 아니다 — 그때 고르개가 접히는 것이 이 판정의 뜻이다.
    assert.deepEqual(describeOhPartLink({ partId: null, partNameText: "유량계" }, options), { kind: "UNLINKED" });
  });
});

/* ──────────────── ②-가 푸는 규칙 — 값으로 잰다 ──────────────── */

/**
 * 🔴 **뜻이 셋이고, 둘을 뭉개면 못 되돌린다.** 이 묶음만 글자가 아니라 값으로 재므로 실제
 * 동작을 지킨다 — 아래 ②-나(글자로 재는 쪽)가 다 통과해도 여기가 깨지면 숫자가 틀린 것이다.
 */
describe("②-가 O/H 단가를 **푸는 함수** — 비면 견적가, 0 은 무상, 숫자는 그 숫자", () => {
  it("🔴 비어 있으면(`null`) **그 부품의 견적가**가 쓰인다 (2026-10-22 쓰는 분 결정)", () => {
    assert.equal(resolveOverhaulUnitPrice(null, 1_482_500), 1_482_500);
  });

  it("🔴 저장된 `0` 은 **0 그대로**다 — 「O/H 때는 무상」이 견적가 청구로 둔갑하면 안 된다", () => {
    // 🔴 `stored || quotePrice` 로 적으면 바로 여기서 깨진다. 오류가 안 나는 종류의 버그라
    //    이 한 줄이 유일한 방어선이다 — 받은 사람은 무상으로 약속받은 것을 청구당한다.
    assert.strictEqual(resolveOverhaulUnitPrice(0, 1_482_500), 0);
  });

  it("🔴 사람이 정한 숫자가 견적가를 **이긴다**", () => {
    assert.equal(resolveOverhaulUnitPrice(125_000, 990_000), 125_000);
  });

  it("🔴 둘 다 없으면 `null` — 따라갈 숫자가 없으니 받는 쪽이 칸을 비우고 사람이 채운다", () => {
    assert.strictEqual(resolveOverhaulUnitPrice(null, null), null);
  });

  it("🔴 견적가가 `0` 이어도 **0 이 흘러간다** — 「견적가 없음」과 「견적가 0원」도 다른 말이다", () => {
    assert.strictEqual(resolveOverhaulUnitPrice(null, 0), 0);
  });

  it("「견적가를 따라가는 중인가」는 **저장된 값이 비었는가**로만 판정한다", () => {
    assert.equal(overhaulUnitPriceFollowsQuote(null), true);
    // 🔴 0 은 사람이 정한 값이다 — 따라가는 중이 아니다.
    assert.equal(overhaulUnitPriceFollowsQuote(0), false);
    assert.equal(overhaulUnitPriceFollowsQuote(125_000), false);
  });

  it("🔴 푸는 자리는 **하나**다 — 통로가 제 폴백을 따로 적지 않고 그 함수를 부른다", () => {
    /**
     * 같은 폴백을 두 곳에서 각자 계산하면 언젠가 서로 다른 값을 말한다(이 묶음에서 실제로 겪은
     * 사고다). A/S 가 받는 값이 **이미 풀린 값**이어야 저쪽이 한 글자도 안 고친다.
     */
    const apiParts = stripComments(src("src/lib/api/parts.ts"));
    assert.ok(
      apiParts.includes("resolveOverhaulUnitPrice(p.overhaulUnitPrice, p.quotePrice)"),
      "통로가 푸는 함수를 안 부른다 — A/S 가 받는 값이 안 풀린 값이 된다",
    );
    for (const line of apiParts.split("\n")) {
      if (!line.includes("overhaulQuotePrice:")) continue;
      assert.ok(
        !/\?\?|\|\|/.test(line),
        `통로가 폴백을 손으로 적었다: ${line.trim()} — 규칙이 두 벌이 되는 첫 걸음이다`,
      );
    }
  });

  it("🔴 화면도 **그 함수**를 부른다 — 접은 목록이 제 폴백을 적지 않았다", () => {
    assert.ok(
      SCREEN.includes('from "@/lib/oh/unit-price"'),
      "화면이 푸는 함수를 안 쓴다 — 화면이 비친 숫자와 통로가 내보내는 숫자가 갈린다",
    );
    assert.ok(
      PRICE_TEXT.includes("resolveOverhaulUnitPrice"),
      "접은 목록의 O/H 단가 글자가 저장된 값만 본다 — 비어 있어도 견적가로 나가는데 「미정」이라고 적힌다",
    );
  });
});

/* ──────────────── ②-나 칸에 값을 미리 붓지 않는다 ──────────────── */

describe("②-나 비워 둔 칸은 **비운 채로 저장**된다 — 견적가를 칸에 붓지 않는다", () => {
  it("🔴 단가 칸의 값은 사람이 적은 글자(`priceRaw`)뿐이다", () => {
    assert.ok(ITEM_ROW.includes("value={priceRaw}"), "단가 칸이 사람이 적은 글자를 그리지 않는다");
  });

  it("🔴 견적가가 **값 자리(`value`)에 닿지 않는다** — 닿으면 그 숫자에 박혀 안 따라간다", () => {
    /**
     * 🔵 **아침 결정에서 넘어온 단언이고, 까닭만 바뀌었다.** 그때는 「『따라간다』와 『마침 같은
     * 숫자를 적어 두었다』가 구별되지 않는다」였다. 지금은 더 곧은 까닭이 있다 — 값을 부으면
     * 사람이 적은 것과 똑같이 **저장**되고, 그 뒤로 견적가가 바뀌어도 템플릿은 옛 숫자에 묶인다.
     * 쓰는 분이 정한 「나중에 견적가가 바뀌면 따라서 바뀐다」가 바로 그 자리에서 깨진다.
     */
    for (const line of ITEM_ROW.split("\n")) {
      if (!line.includes("quotePrice")) continue;
      assert.ok(
        !/\bvalue=/.test(line),
        `견적가가 값 자리로 샜다: ${line.trim()} — 저장돼 버려 견적가를 더는 안 따라간다`,
      );
    }
  });

  it("🔴 **`[견적가 적용]` 단추가 없다** — 안 눌러도 쓰이므로 할 일이 없어졌다 (2026-10-22 오후)", () => {
    /**
     * 🔴 아침에는 이 단추가 ② 의 **답**이었다(`changePrice` 로 칸에 값을 실제로 넣는 몸짓).
     *    오후 결정으로 두 가지가 동시에 참이 됐다: ⓐ 안 눌러도 견적가가 쓰이니 할 일이 없고,
     *    ⓑ 누르면 그 순간의 숫자가 **박혀** 새 결정을 정면으로 깬다. 쓰는 분의 말 그대로
     *    「그렇게 되면 [견적가 적용]이라는 단추도 필요 없어질 테니까」.
     * 🔵 화면에서 **두 줄로 깨져** 보이고 있던 것도 그 단추다.
     */
    assert.ok(
      !ITEM_ROW.includes("changePrice(row.partId, String(quotePrice))"),
      "견적가를 칸에 붓는 몸짓이 남아 있다 — 누르면 그 숫자에 박혀 더는 안 따라간다",
    );
    assert.ok(!ITEM_ROW.includes("적용"), "단가 칸에 [적용] 단추가 남아 있다");
  });

  it("🔴 비치는 글자는 **숫자 하나**다 — 말을 붙이면 칸에서 잘린다", () => {
    /**
     * 🔴 단가 칸은 `ITEM_GRID` 에서 `7rem`(약 112px)이다. 아침 판은 `미정 · 견적가 1,482,500원`
     *    을 비춰 **잘렸다.** 쓰는 분의 원래 말이 「기존 견적단가가 **회색 글씨로 자동으로 적혀
     *    있고**」였으니 적혀 있어야 할 것은 숫자이고, 칸 머리글이 이미 `O/H 단가 (원)` 라고
     *    말하고 있어 「견적가」·「원」을 또 넣을 자리가 아니다. 어디서 온 숫자인지는 `title` 이 민다.
     */
    const hint = ITEM_ROW.split("\n").find((one) => one.includes("const quoteHint"));
    assert.ok(hint, "비칠 글자를 빚는 자리가 없어졌다");
    assert.ok(hint.includes("toLocaleString"), "세 자리마다 쉼표를 안 찍는다 — 긴 금액을 눈으로 못 읽는다");
    assert.ok(!hint.includes("견적가") && !hint.includes("원"), `비치는 글자에 말이 붙었다: ${hint.trim()}`);

    const priceCell = slice(ITEM_ROW, "value={priceRaw}", "{priceServerError &&", "단가 칸");
    const placeholder = slice(priceCell, "placeholder={", "title={", "비치는 글자");
    assert.ok(placeholder.includes("quoteHint"), "견적가가 placeholder 로 안 비친다");
    assert.ok(!placeholder.includes("·"), `비치는 글자를 둘 이어 붙였다: ${placeholder.trim()} — 칸에서 잘린다`);
    // 🔴 「저장 뒤 표시」가 **먼저**다 — 새로 이은 부품은 이미 정해 둔 단가가 있을 수 있어
    //    견적가를 비추면 「이 부품은 견적가로 나간다」는 틀린 말이 된다(화면 머리말).
    assert.ok(
      placeholder.indexOf("priceUnknown") < placeholder.indexOf("quoteHint"),
      "모르는 줄에까지 견적가를 비춘다 — 이미 정해 둔 O/H 단가가 있을 수 있다",
    );
  });

  it("🔴 저장에 보내는 단가는 여전히 **아는 값과 사람이 손댄 값**뿐이다 — 견적가가 저장 길에 없다", () => {
    assert.ok(PRICE_ENTRIES.includes("knownPrices.has"), "이미 저장돼 있던 값을 가리는 잣대가 사라졌다");
    assert.ok(PRICE_ENTRIES.includes("touchedPrices.has"), "사람이 손댄 칸을 가리는 잣대가 사라졌다");
    assert.ok(
      !PRICE_ENTRIES.includes("quotePrice"),
      "견적가가 저장 길로 들어왔다 — 아무도 안 적은 값이 O/H 단가로 저장된다",
    );
  });

  it("🔴 **편집 칸의 초안**을 빚을 때도 견적가로 메우지 않는다 — `null` 은 빈 글자 그대로다", () => {
    /**
     * 🔴 여기서 메우면 다음 저장이 그 숫자를 **진짜로 적는다** — 아무도 안 친 값이 저장되고,
     *    그 뒤로 견적가가 바뀌어도 안 따라간다. 🔵 푼 값을 적는 자리는 **읽는 글자**(`priceText`)
     *    뿐이고, 거기는 저장 길에 닿지 않는다(②-가의 마지막 단언이 그쪽을 지킨다).
     */
    assert.ok(!PRICE_DRAFT.includes("quotePrice"), "편집 칸의 초안에 견적가가 섞였다");
    assert.ok(
      PRICE_DRAFT.includes('item.ohPrice === null ? "" :'),
      "「비어 있음」이 빈 글자로 안 간다 — 0 으로 메우면 그 자리에서 「무상」이 된다",
    );
  });

  it("🔵 견적가는 **이미 있는 길**로 온다 — 부품 목록 질의에 칸 하나를 더했을 뿐이다", () => {
    assert.ok(
      PART_OPTIONS_QUERY.includes("quotePrice: parts.quotePrice"),
      "고르개가 받는 목록에 견적가가 없다 — 화면이 비치고 풀 값을 어디서도 못 받는다",
    );
    /**
     * 🔴 **견적가 줄만 본다.** 처음에는 질의 전체에 `?? 0` 이 없는지로 쟀는데, 2026-10-22 에
     * 재고 수량이 실리면서 **맞는 `?? 0` 이 하나 생겼다**(수량 줄이 없는 부품은 0개다 — 아래 ⑤).
     * 질의 전체로 재면 그 옳은 한 줄 때문에 이 시험이 빨개지고, 느슨하게 풀면 견적가의 `?? 0`
     * 도 함께 통과한다. 그래서 **재는 쪽을 견적가 줄로 좁힌다** — 금액의 `null` 은 「정하지
     * 않음」이고 0(무상)과 다르다는 것이 이 단언의 본래 뜻이다.
     */
    for (const line of PART_OPTIONS_QUERY.split("\n")) {
      if (!line.includes("quotePrice")) continue;
      assert.ok(
        !line.includes("?? 0") && !line.includes("|| 0"),
        `견적가의 「정하지 않음」을 0 으로 뭉갰다: ${line.trim()} — 정하지 않은 부품이 0원으로 비친다`,
      );
    }
  });
});

/* ──────────── ③ 결과 줄에 그 부품에 대한 내용이 다 나온다 ──────────── */

describe("③ 결과 줄 — **그 부품에 대한 내용이 한 줄에 다 나온다** (2026-10-22 요청 1)", () => {
  it("🔴 줄 차례가 A/S 와 같다 — 고객사 품명 · No.품명 · 품번들/소유/재고 · [추가]", () => {
    const customerAt = DETAILED_ROW.indexOf("FIELD_LABEL.customerName");
    const headAt = DETAILED_ROW.indexOf("No. {part.no}");
    const metaAt = DETAILED_ROW.indexOf("pieces.map(");
    const addAt = DETAILED_ROW.indexOf("추가");
    for (const [what, at] of [["고객사 품명", customerAt], ["No.·품명", headAt], ["셋째 줄", metaAt], ["추가", addAt]] as const) {
      assert.notEqual(at, -1, `${what} 가 자세한 줄에 없다`);
    }
    assert.ok(customerAt < headAt, "고객사 품명이 첫 줄이 아니다 — A/S 는 그것이 맨 위다");
    assert.ok(headAt < metaAt, "No.·품명이 둘째 줄이 아니다");
    assert.ok(metaAt < addAt, "[추가] 딱지가 글보다 앞에 선다");
  });

  it("🔴 고객사 품명이 비면 **「없음」을 적는다** — 빈 자리로 두면 모르고 고른다", () => {
    assert.ok(
      DETAILED_ROW.includes("{FIELD_LABEL.customerName} 없음"),
      "비었을 때 아무 말도 안 한다 — 그 줄은 견적서의 품명 칸이 비어 나간다",
    );
  });

  it("🔴 이름표를 화면에 박지 않는다 — 말도 차례도 `PART_FIELDS` 한 곳이 쥔다", () => {
    assert.ok(DETAILED_ROW.includes("FIELD_LABEL.customerName"), "고객사 품명 이름표를 글자로 박았다");
    assert.ok(PICKER.includes("ID_FIELDS = PART_FIELDS.filter"), "셋째 줄의 칸 차례를 따로 적었다");
    // 🔴 차례의 정본은 그 표다 — 교산 품번이 도번보다 앞이다(2026-10-16 쓰는 분 요청).
    const keys = PART_FIELDS.map((f) => f.key);
    assert.ok(keys.indexOf("kyosanPartNo") < keys.indexOf("drawingNo"), "표의 차례가 뒤집혔다");
  });

  it("🔴 셋째 줄 차례 — 품번들 → 소유 → 재고", () => {
    const idAt = DETAILED_ROW.indexOf("for (const field of ID_FIELDS)");
    const ownerAt = DETAILED_ROW.indexOf('key: "owner"');
    const stockAt = DETAILED_ROW.indexOf('key: "stock"');
    assert.ok(idAt !== -1 && ownerAt !== -1 && stockAt !== -1, "셋째 줄의 토막 셋 중 빠진 것이 있다");
    assert.ok(idAt < ownerAt, "품번들이 소유보다 뒤에 선다");
    assert.ok(ownerAt < stockAt, "소유가 재고보다 뒤에 선다");
  });

  it("🔴 **값에만** 색이 들어간다 — 이름표(「재고」·「도번」)는 회색 그대로다", () => {
    assert.ok(
      /재고 <span className=\{VALUE_HIGHLIGHT\}>\{formatQuantity\(part\.quantity\)\}개<\/span>/.test(DETAILED_ROW),
      "재고 수에 색이 없거나 이름표까지 색이 번졌다",
    );
    assert.ok(
      /field\.key === "drawingNo" \? <span className=\{VALUE_HIGHLIGHT\}>\{value\}<\/span> : value/.test(DETAILED_ROW),
      "도번 값에 색이 없다 — 또는 글자를 짐작해 견주고 있다(키로 갈라야 한다)",
    );
  });

  it("🔵 「(불러온 때 기준)」을 따라 적지 않았다 — 여기서는 참이 아닌 단서다", () => {
    assert.ok(
      !DETAILED_ROW.includes("불러온 때 기준"),
      "남의 시스템에서 받아 올 때 붙이는 꼬리말을 베꼈다 — 여기 수는 제 DB 에서 같은 렌더에 읽힌다",
    );
  });

  it("🔴 값이 없는 칸은 **안 그린다** — 「교산 품번 없음」이 줄줄이 적히면 있는 값이 묻힌다", () => {
    assert.ok(DETAILED_ROW.includes('if (value === "") continue;'), "빈 품번 칸을 거르지 않는다");
  });
});

/* ──────────── ④ 안 켠 자리는 글자 하나 안 바뀐다 ──────────── */

describe("④ `detailed` 를 **안 넘긴 자리는 그대로**다 — 이 고르개를 쓰는 다섯 자리", () => {
  it("🔴 기본값이 꺼짐이다 — 넘기지 않으면 예전 길로 간다", () => {
    assert.ok(PICKER.includes("detailed = false,"), "기본값이 없다 — 안 넘긴 화면이 함께 바뀐다");
  });

  it("🔴 기본 줄의 겉모양 글자가 **그대로**다", () => {
    assert.ok(
      PICKER.includes(
        '"flex w-full flex-col gap-0.5 border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50 last:border-0"',
      ),
      "기본 줄의 모양이 바뀌었다 — 안 켠 다섯 자리가 함께 바뀐다",
    );
  });

  it("🔴 기본 줄의 내용이 **그대로**다 — 머리줄 · 고객사 품명 · 소유/지금 수량/도번", () => {
    assert.ok(PLAIN_BRANCH.includes('<span className="text-zinc-500">No. {p.no}</span> {p.name}'), "머리줄이 바뀌었다");
    assert.ok(
      PLAIN_BRANCH.includes('<span className="text-xs text-zinc-500">고객사 품명 · {p.customerName}</span>'),
      "고객사 품명 줄이 바뀌었다",
    );
    assert.ok(PLAIN_BRANCH.includes("{meta ?"), "소유·지금 수량·도번 줄이 바뀌었다");
    // 🔴 자세한 쪽의 글자가 기본 쪽으로 새지 않았다.
    assert.ok(!PLAIN_BRANCH.includes("DetailedRow"), "기본 쪽이 자세한 줄을 그린다");
    assert.ok(!PLAIN_BRANCH.includes("추가"), "기본 줄에 [추가] 딱지가 생겼다");
  });

  it("🔴 **다섯 자리가 `detailed` 를 안 넘긴다** — 재고 기록 화면은 예전 그대로다", () => {
    const entry = stripComments(src("src/components/stock/EntryForm.tsx"));
    assert.equal([...entry.matchAll(/<PartPicker/g)].length, 5, "고르개를 쓰는 자리 수가 달라졌다");
    assert.ok(!entry.includes("detailed"), "재고 기록 화면이 자세한 줄을 켰다 — 쓰는 분이 요청한 화면이 아니다");
  });

  it("🔵 켜는 자리는 **O/H 템플릿 하나**다", () => {
    assert.equal([...SCREEN.matchAll(/detailed/g)].length, 1, "O/H 템플릿 화면에서 켜는 자리가 하나가 아니다");
    assert.ok(ITEM_ROW.includes("detailed"), "O/H 템플릿의 고르개가 안 켜져 있다");
  });
});

/* ──────────── ⑤ 재고 수는 재고 현황이 읽는 그 수다 ──────────── */

describe("⑤ 재고 수·소유를 **이미 있는 길로** 싣는다", () => {
  it("🔴 소유와 재고 수가 고르개까지 간다 — 없으면 셋째 줄이 반쪽이 된다", () => {
    assert.ok(PART_OPTIONS_QUERY.includes("owner: parts.owner"), "소유를 안 싣는다");
    assert.ok(PART_OPTIONS_QUERY.includes("quantity: stockBalances.quantity"), "재고 수를 안 싣는다");
  });

  it("🔴 **재고 현황이 읽는 그 자리**를 읽는다 — 새로 세는 식을 만들지 않았다", () => {
    const join = "leftJoin(stockBalances, eq(stockBalances.partId, parts.id))";
    assert.ok(PART_OPTIONS_QUERY.includes(join), "재고를 잇는 자리가 다르다");
    const list = stripComments(src("src/lib/parts/queries.ts"));
    assert.ok(list.includes(join), "재고 현황 목록이 잇는 자리가 바뀌었다 — 둘이 같은 말이어야 한다");
  });

  it("🔴 수량 줄이 없는 부품은 **0 개**다 — 「0개」와 「모름」이 섞이지 않는다", () => {
    assert.ok(
      PART_OPTIONS_QUERY.includes("quantity: row.quantity ?? 0"),
      "수량 줄이 없는 부품의 재고가 비어 흘러간다 — 고르개가 그 줄의 재고를 아예 안 그린다",
    );
  });
});
