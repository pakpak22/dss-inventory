import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { OWNERS } from "../src/db/schema/codes";
import { CHARGE_TYPES } from "../src/db/schema/stock";
import { OWNER_LABEL } from "../src/lib/parts/codes";
import { CHARGE_LABEL } from "../src/lib/stock/codes";
import {
  partDetailHref,
  requestItemChargeTag,
  requestItemDetailGroups,
  requestItemDetails,
  requestItemOwnerTag,
  REQUEST_ITEM_DETAIL_FIELDS,
  REQUEST_ITEM_LEAD_FIELD,
  REQUEST_ITEM_OWNER_TAG_LABEL,
  type RequestItemLine,
  type RequestItemPart,
} from "../src/lib/stock/request-item-detail";

/**
 * ============================================================================
 * 부품 요청 관리 화면의 **신청 항목** 칸 (2026-10-16 쓰는 분 요청)
 * ============================================================================
 * 🔴 이 저장소에는 **화면 렌더 시험이 없다**(`tests/part-issue-screen.test.ts` 머리말). 그래서 규칙을
 * 순수 함수로 내려 두고 여기서 돌린다. 못 박는 것 넷:
 *  1. **무엇을 보이나** — 고객사 품명 · 품명2 · 교산 품번 · 도번. 차례가 뜻을 가진다.
 *  2. **빈 칸은 안 그린다** — 「없음」을 줄줄이 적으면 정작 있는 값이 묻힌다.
 *  3. 🔴 **지워진 부품에는 링크가 없다** — 눌러도 안 열리는 링크를 그리지 않는다.
 *  4. 🔵 **부품 상세로 가는 길은 이미 있는 것** — `/?part=No.`(재고 현황의 상세 창). 새 화면이 아니다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const part = (over: Partial<RequestItemPart> = {}): RequestItemPart => ({
  partNo: 165,
  owner: "KYOSAN",
  customerName: "증폭기 조립품",
  name2: "AMP 2",
  kyosanPartNo: "C090722733",
  drawingNo: "WR10136AA148B",
  ...over,
});

/** 🔴 **줄 쪽 값은 따로 빚는다** — 부품과 한 덩이로 두면 시험이 먼저 둘을 뭉뚱그리게 된다(순수 함수 머리말). */
const line = (over: Partial<RequestItemLine> = {}): RequestItemLine => ({ chargeType: "PAID", ...over });

describe("자세한 내용 — 무엇을 어떤 차례로 (2026-10-16)", () => {
  it("네 칸을 정해진 차례로 준다 — 고객사 품명이 맨 앞", () => {
    const d = requestItemDetails(part());
    assert.deepEqual(
      d.map((x) => x.label),
      ["고객사 품명", "품명2", "교산 품번", "도번"],
    );
    assert.deepEqual(d[0], { key: "customerName", label: "고객사 품명", value: "증폭기 조립품" });
    assert.equal(d[3].value, "WR10136AA148B");
  });

  it("🔵 보이는 칸 목록이 `parts` 의 칸 이름과 맞물려 있다 — 한쪽만 고치면 타입에서 깨진다", () => {
    assert.deepEqual(
      REQUEST_ITEM_DETAIL_FIELDS.map((f) => f.key),
      ["customerName", "name2", "kyosanPartNo", "drawingNo"],
    );
  });

  it("🔴 빈 칸은 그리지 않는다 — 있는 것만, 차례는 그대로", () => {
    const d = requestItemDetails(part({ name2: "", drawingNo: "" }));
    assert.deepEqual(
      d.map((x) => x.label),
      ["고객사 품명", "교산 품번"],
    );
  });

  it("공백만 있는 값도 없는 것으로 본다", () => {
    assert.deepEqual(requestItemDetails(part({ customerName: "   ", name2: "\t", kyosanPartNo: "", drawingNo: " " })), []);
  });

  it("값이 하나도 없으면 빈 목록이다 — 화면은 그 줄에 아무것도 안 그린다", () => {
    assert.deepEqual(requestItemDetails(part({ customerName: "", name2: "", kyosanPartNo: "", drawingNo: "" })), []);
  });

  it("🔴 지워진 부품은 네 칸이 비어 있어 저절로 빈 목록이 된다 — 막는 자리를 두 벌 두지 않는다", () => {
    assert.deepEqual(requestItemDetails({ partNo: null, owner: null, customerName: "", name2: "", kyosanPartNo: "", drawingNo: "" }), []);
  });
});

/**
 * ============================================================================
 * 🔴 **넷 중 고객사 품명이 앞선다** (2026-10-21 쓰는 분 요청)
 * ============================================================================
 * 「다섯 칸 중 고객사 품명을 가장 뚜렷하게 — 고객사와 말을 주고받을 때 쓰는 이름이다.」
 *
 * 🔵 **「굵게 보인다」는 여기서 못 잰다**(화면 렌더 시험이 없다). 대신 **고를 수 있는 값**으로 잰다:
 *    앞세울 칸이 무엇인지 · 비면 어떻게 되는지 · 값을 잃거나 겹치지 않는지. 꾸밈이 실제로 갈리는지는
 *    맨 아래 묶음이 화면 조각의 글자에서 본다.
 * ============================================================================
 */
describe("앞세우는 칸 — 고객사 품명 (2026-10-21)", () => {
  it("🔴 앞세우는 칸은 고객사 품명이다 — 그리고 보이는 넷 중 하나다", () => {
    assert.equal(REQUEST_ITEM_LEAD_FIELD, "customerName");
    assert.ok(
      REQUEST_ITEM_DETAIL_FIELDS.some((f) => f.key === REQUEST_ITEM_LEAD_FIELD),
      "앞세우는 칸이 보이는 목록에 없다 — 그러면 영영 안 그려진다",
    );
  });

  it("고객사 품명이 `lead`, 나머지 셋이 `rest` — 차례는 표 그대로", () => {
    const { lead, rest } = requestItemDetailGroups(part());
    assert.deepEqual(lead, { key: "customerName", label: "고객사 품명", value: "증폭기 조립품" });
    assert.deepEqual(
      rest.map((d) => d.label),
      ["품명2", "교산 품번", "도번"],
    );
  });

  it("🔴 고객사 품명이 비면 `lead` 가 `null` — **빈 자리를 만들지 않는다**", () => {
    const { lead, rest } = requestItemDetailGroups(part({ customerName: "" }));
    assert.equal(lead, null);
    // 🔵 나머지는 그대로 선다 — 앞 줄이 없다고 뒤가 함께 사라지면 볼 수 있던 값까지 잃는다.
    assert.deepEqual(
      rest.map((d) => d.label),
      ["품명2", "교산 품번", "도번"],
    );
  });

  it("공백만 있는 고객사 품명도 비어 있는 것으로 본다", () => {
    assert.equal(requestItemDetailGroups(part({ customerName: "   " })).lead, null);
  });

  it("🔴 비어도 **품명으로 대신 세우지 않는다** — 윗줄이 이미 품명이라 같은 글자가 두 번 나온다", () => {
    const { lead, rest } = requestItemDetailGroups(part({ customerName: "", name2: "", kyosanPartNo: "", drawingNo: "" }));
    assert.equal(lead, null);
    assert.deepEqual(rest, []);
    // 🔵 대신 세우려면 칸부터 늘려야 한다 — `RequestItemPart` 에 품명 칸이 아예 없다.
    assert.ok(!("name" in part()), "RequestItemPart 에 품명 칸이 생겼다 — 대신 세우는 길이 열렸으니 결정을 다시 보라");
  });

  it("🔵 값을 잃지도 겹치지도 않는다 — `lead` + `rest` = 원래 목록 (전수)", () => {
    const yes = "값";
    for (let mask = 0; mask < 16; mask += 1) {
      const over = {
        customerName: mask & 1 ? yes : "",
        name2: mask & 2 ? yes : "",
        kyosanPartNo: mask & 4 ? yes : "",
        drawingNo: mask & 8 ? yes : "",
      };
      const all = requestItemDetails(part(over));
      const { lead, rest } = requestItemDetailGroups(part(over));
      assert.deepEqual([...(lead === null ? [] : [lead]), ...rest].map((d) => d.key).sort(), all.map((d) => d.key).sort(), `mask ${mask}`);
      assert.ok(!rest.some((d) => d.key === REQUEST_ITEM_LEAD_FIELD), `mask ${mask}: 앞세운 칸이 뒤에도 남았다`);
    }
  });
});

describe("🔴 품명을 누르면 부품 상세 — 지워진 부품에는 링크가 없다 (2026-10-16)", () => {
  it("번호가 있으면 이미 있는 길로 간다 (`/?part=No.`)", () => {
    assert.equal(partDetailHref(165), "/?part=165");
    assert.equal(partDetailHref(1), "/?part=1");
  });

  it("🔴 번호가 없으면(지워진 부품) `null` — 눌러도 안 열리는 링크를 그리지 않는다", () => {
    assert.equal(partDetailHref(null), null);
  });

  it("🔵 다른 화면이 쓰는 길과 **같은 모양**이다 — 새 주소를 만들지 않았다", () => {
    // 기록 내역(`/entries`)이 부품 상세로 가는 길. 이 글자가 바뀌면 그쪽도 같이 바뀌어야 한다.
    assert.match(src("src/app/(app)/entries/page.tsx"), /\/\?part=\$\{l\.partNo\}/);
  });
});

describe("🔴 화면이 이 규칙을 실제로 쓴다 (2026-10-16)", () => {
  const screen = src("src/components/stock/RequestManagerScreen.tsx");

  it("🔴 링크를 손으로 빚지 않는다 — 그러면 지워진 부품에도 링크가 달린다", () => {
    assert.match(screen, /partDetailHref\(l\.partNo\)/);
    assert.doesNotMatch(screen, /\?part=\$\{/, "화면이 부품 상세 주소를 직접 만들고 있다");
  });

  it("🔴 링크는 **번호가 있을 때만** 그린다 — 삼항의 양쪽이 링크와 글자로 갈린다", () => {
    assert.match(screen, /href \? \(/, "href 가 null 일 때의 갈림이 없다");
  });

  it("🔵 열을 늘리지 않았다 — 표 머리글은 전과 같은 다섯 칸이다(품목·요청·불출·남음·가용)", () => {
    for (const head of ["품목", "요청", "불출", "남음", "가용"]) assert.ok(screen.includes(head), head);
    // 자세한 내용은 품목 칸 **안**에 작은 글씨로 들어간다 — 열로 세우면 가로 스크롤이 네 칸 더 길어진다.
    assert.doesNotMatch(screen, /고객사 품명\n?\s*<\/th>/, "자세한 내용이 열로 올라갔다");
  });
});

/**
 * ============================================================================
 * 🔴 **세 화면이 같은 한 조각을 쓴다** (2026-10-21, 쓰는 분 접수 5번)
 * ============================================================================
 * 「부품 요청 관리」에만 있던 작은 글씨 목록이 **불출 신청 팝업**과 **승인 요청건**에도 서게 됐다.
 * 모양을 세 곳에 베껴 적으면 「값이 없으면 안 그린다」는 규칙이 세 벌이 되고, 한 곳만 `-` 로 고쳐도
 * 그 화면에서만 빈 자리가 생긴다 — 이 저장소에는 화면 렌더 시험이 없어 아무도 못 본다.
 * 그래서 markup 을 `RequestItemDetails` 하나로 모으고, **세 화면이 그것을 부르는지**를 여기서 잰다.
 * ============================================================================
 */
describe("🔴 세 화면이 같은 조각을 쓴다 (2026-10-21, 접수 5번)", () => {
  const piece = src("src/components/stock/RequestItemDetails.tsx");

  it("규칙을 다시 적지 않고 순수 함수를 부른다 — 라벨도 차례도 「무엇을 앞세울지」도 조각 안에 없다", () => {
    assert.match(piece, /requestItemDetailGroups\(item\)/, "조각이 규칙을 따로 적고 있다");
    for (const label of ["고객사 품명", "품명2", "교산 품번", "도번"]) {
      assert.ok(!piece.includes(`>${label}<`), `라벨(${label})을 조각에 손으로 적었다 — 차례가 두 곳이 된다`);
    }
    assert.ok(!piece.includes('"customerName"'), "조각이 앞세울 칸을 제 안에 적었다 — 그 결정이 두 곳이 된다");
  });

  it("🔴 값이 하나도 없으면 **아무것도 안 그린다** — 빈 상자도 여백도 남기지 않는다", () => {
    assert.match(piece, /if \(lead === null && tags\.length === 0 && rest\.length === 0\) return null;/, "셋 다 비었을 때 null 로 끝내는 줄이 사라졌다");
    assert.match(piece, /\{lead === null \? null : \(/, "고객사 품명이 비어도 그 줄을 그린다 — 빈 자리가 생긴다");
    assert.match(piece, /\{tags\.length === 0 \? null : \(/, "딱지가 하나도 없어도 그 줄을 그린다 — 빈 자리가 생긴다");
    assert.match(piece, /\{rest\.length === 0 \? null : \(/, "나머지가 비어도 그 줄을 그린다 — 빈 자리가 생긴다");
  });

  /**
   * 🔴 **색만으로 가르지 않는다**(CLAUDE.md 9-7절). 「굵게 보인다」는 못 재지만, **색이 아닌 가름이
   * 실제로 있는지**는 글자에서 잴 수 있다 — 굵기와 크기 둘 다 갈려 있어야 한다.
   */
  it("🔴 고객사 품명과 나머지가 **색 말고도** 다른 꾸밈을 받는다 — 굵기와 크기", () => {
    // 🔵 **나머지 줄이 열리는 자리에서 자른다** — 앞뒤 어느 쪽 꾸밈인지를 자리로 가른다(둘 다 `mt-0.5 block` 으로 시작한다).
    const parts = piece.split("{rest.length === 0 ? null : (");
    assert.equal(parts.length, 2, "나머지 줄의 갈림을 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    const lead = /className="mt-0\.5 block ([^"]+)"/.exec(parts[0]);
    const rest = /className="mt-0\.5 block ([^"]+)"/.exec(parts[1]);
    assert.ok(lead !== null && rest !== null, "두 줄의 꾸밈을 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.notEqual(lead[1], rest[1], "두 줄이 같은 꾸밈을 받는다 — 앞세운 것이 앞서 보이지 않는다");
    assert.ok(lead[1].includes("font-medium"), "앞세운 줄이 굵지 않다 — 색만으로 가르고 있다");
    assert.ok(!rest[1].includes("font-medium"), "나머지도 굵다 — 굵기로는 갈리지 않는다");
    // 🔵 크기도 갈린다: 앞세운 줄이 한 치수 크다.
    assert.ok(lead[1].includes("text-xs"), "앞세운 줄의 글자 크기가 바뀌었다");
    assert.ok(rest[1].includes("text-[11px]"), "나머지 줄의 글자 크기가 바뀌었다 — 두 줄이 같은 크기면 크기로는 안 갈린다");
  });

  for (const file of ["src/components/stock/RequestManagerScreen.tsx", "src/components/stock/RequestActions.tsx", "src/components/stock/IssueApprovalScreen.tsx"]) {
    it(`${file} — 조각을 부른다(모양을 베껴 적지 않았다)`, () => {
      const text = src(file);
      assert.match(text, /<RequestItemDetails item=\{l\} \/>/, "조각을 쓰지 않는다");
      // 🔴 조각 밖에서 규칙을 또 부르면 모양이 다시 갈린다 — 부르는 자리는 조각 하나다.
      assert.ok(!text.includes("requestItemDetails("), "화면이 순수 함수를 직접 불러 제 모양으로 그린다");
    });
  }

  /**
   * 🔴 **조회는 한 글자도 안 고쳤다.** 넷은 `listAllRequests` 가 2026-10-16 부터 싣고 있었고
   * (`RequestLineView`), 결재건 줄로 **옮겨지지 않아** 승인 요청건에서만 안 보이던 것이다.
   * 🔵 줄을 못 찾으면 **빈 글자**다 — 「-」 같은 글자를 지어내면 화면이 빈 자리를 만든다.
   */
  it("🔴 승인 요청건의 줄에도 넷이 실린다 — 없으면 빈 글자이지 지어낸 글자가 아니다", () => {
    const data = src("src/lib/approval/part-issue-screen-data.ts");
    for (const key of ["customerName", "name2", "kyosanPartNo", "drawingNo"]) {
      assert.ok(data.includes(`${key}: line?.${key} ?? ""`), `결재건 줄에 ${key} 가 빈 글자 기본값으로 안 실린다`);
    }
  });
});

/**
 * ============================================================================
 * 🔴 **소유구분과 유상/무상** — 성격이 다른 값 둘 (2026-10-21 쓰는 분 요청)
 * ============================================================================
 * 「[승인 요청건]과 [부품 요청]의 부품 상세에 **소유구분**과 **유상/무상**이 보이게.」
 *
 * 🔴 **이 묶음이 지키는 것은 「보인다」가 아니라 「둘이 안 섞인다」이다.**
 *  · **소유구분은 부품을 따라간다** — `parts.owner`. 어느 신청에서 보든 같다.
 *  · **유상/무상은 그 줄의 값이다** — 신청 payload 의 줄마다 붙고, 같은 부품이라도 줄마다 다를 수 있다.
 * 뭉뚱그리면 「이 **부품**은 유상인가요?」라는 **답 없는 물음**이 생기고, 틀리면 **비용이 잘못 간다.**
 * 그래서 값이 맞는지뿐 아니라 **타입이 갈려 있는지**까지 여기서 잰다.
 * ============================================================================
 */
describe("🔵 소유구분 딱지 — 부품의 것 (2026-10-21)", () => {
  it("값이 있으면 딱지가 서고, 글자는 `OWNER_LABEL` 한 표에서 온다", () => {
    const tag = requestItemOwnerTag(part({ owner: "KYOSAN" }));
    assert.deepEqual(tag, { key: "owner", label: REQUEST_ITEM_OWNER_TAG_LABEL, value: OWNER_LABEL.KYOSAN, className: tag!.className });
    assert.equal(tag!.value, "KYOSAN");
  });

  it("소유 셋이 모두 제 글자로 풀린다 (전수) — 코드값이 화면에 새어 나가지 않는다", () => {
    for (const owner of OWNERS) {
      const tag = requestItemOwnerTag(part({ owner }));
      assert.equal(tag!.value, OWNER_LABEL[owner], owner);
      assert.equal(tag!.key, "owner", owner);
    }
  });

  it("🔴 소유가 없으면(지워진 부품) `null` — **빈 자리도 하이픈도 만들지 않는다**", () => {
    assert.equal(requestItemOwnerTag(part({ owner: null })), null);
  });

  it("🔵 소유구분은 **글자 목록 넷에 끼어들지 않는다** — 딱지로 서는 값이다", () => {
    assert.ok(
      !REQUEST_ITEM_DETAIL_FIELDS.some((f) => (f.key as string) === "owner"),
      "소유가 작은 글씨 목록에 들어갔다 — 그러면 품번·도번과 같은 무게로 흘려 적힌다",
    );
    assert.ok(!requestItemDetails(part()).some((d) => (d.key as string) === "owner"));
  });
});

describe("🔴 유상/무상 딱지 — 그 줄의 것 (2026-10-21)", () => {
  it("값이 있으면 딱지가 서고, 글자는 `CHARGE_LABEL` 한 표에서 온다", () => {
    assert.equal(requestItemChargeTag(line({ chargeType: "PAID" }))!.value, CHARGE_LABEL.PAID);
    assert.equal(requestItemChargeTag(line({ chargeType: "FREE" }))!.value, CHARGE_LABEL.FREE);
    assert.equal(requestItemChargeTag(line())!.key, "chargeType");
  });

  it("둘 다 제 글자로 풀린다 (전수)", () => {
    for (const charge of CHARGE_TYPES) {
      assert.equal(requestItemChargeTag(line({ chargeType: charge }))!.value, CHARGE_LABEL[charge], charge);
    }
  });

  /**
   * 🔵 **비어 있는 것이 정상인 자리가 있다** — 유상/무상은 **사용(반출)에서만** 있는 값이다.
   *    대여·폐기 신청의 줄(`SimpleLine`)에는 처음부터 그 칸이 없다. 빠뜨린 것이 아니라 **없는 것**이라,
   *    딱지를 안 그리는 것이 참말이다.
   */
  it("🔴 값이 없으면 `null` — 반출이 아닌 신청에는 처음부터 없는 값이다", () => {
    assert.equal(requestItemChargeTag(line({ chargeType: null })), null);
    const form = src("src/lib/stock/form.ts");
    assert.match(form, /export interface UseLine \{[\s\S]*?chargeType/, "사용 줄에서 유상/무상이 사라졌다");
    const simple = /export interface SimpleLine \{([\s\S]*?)\n\}/.exec(form);
    assert.ok(simple !== null, "SimpleLine 을 못 찾았다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(!simple![1].includes("chargeType"), "대여·폐기 줄에도 유상/무상이 생겼다 — 「없는 것이 정상」이 더 이상 참이 아니니 규칙을 다시 보라");
  });

  it("🔵 사용 신청에서는 **줄마다 반드시 받는다** — 기본값이 없어 비는 일이 없다", () => {
    // 화면 폼과 바깥 통로 양쪽이 같은 울타리를 친다. 한쪽만 풀리면 빈 유상/무상이 들어온다.
    assert.match(src("src/lib/stock/form.ts"), /유상·무상을 고르십시오/);
    assert.match(src("src/lib/api/stock-requests.ts"), /기본값이 없으니 줄마다 보내십시오/);
  });
});

describe("🔴 둘이 서로 다른 성격임이 **코드에** 드러난다 (2026-10-21)", () => {
  const rules = src("src/lib/stock/request-item-detail.ts");
  /** 🔵 이름 뒤를 막는다(`(?![A-Za-z0-9_])`) — 안 막으면 `RequestItemPart` 가 `RequestItemPartText` 를 먼저 집는다. */
  const body = (name: string): string => {
    const m = new RegExp(`export interface ${name}(?![A-Za-z0-9_])[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(rules);
    assert.ok(m !== null, `${name} 을 못 찾았다 — 모양이 바뀌었으면 시험도 함께 고쳐라`);
    return m![1];
  };

  it("🔴 유상/무상이 **부품 쪽 묶음에 들어가 있지 않다** — 그것은 줄의 값이다", () => {
    assert.ok(body("RequestItemPart").includes("owner"), "소유구분이 부품 쪽 묶음에서 빠졌다");
    assert.ok(!body("RequestItemPart").includes("chargeType"), "유상/무상이 부품 쪽 묶음에 들어갔다 — 「이 부품은 유상인가요?」라는 틀린 물음이 생긴다");
    assert.ok(body("RequestItemLine").includes("chargeType"), "줄 쪽 묶음에서 유상/무상이 빠졌다");
    assert.ok(!body("RequestItemLine").includes("owner"), "소유구분이 줄 쪽 묶음에 들어갔다 — 신청마다 달라질 수 있는 값으로 읽힌다");
  });

  /**
   * 🔴 **같은 부품이라도 줄마다 유상/무상이 다를 수 있다.** 소유는 그대로인데 딱지 하나만 갈리는 것이
   * 「성격이 다르다」의 실제 모습이다 — 한 묶음으로 뭉뚱그리면 이 짝을 만들 수 없다.
   */
  it("🔴 같은 부품, 다른 줄 — 소유는 같고 유상/무상만 갈린다", () => {
    const p = part({ owner: "DSS" });
    const paid = { ...p, ...line({ chargeType: "PAID" }) };
    const free = { ...p, ...line({ chargeType: "FREE" }) };
    assert.deepEqual(requestItemOwnerTag(paid), requestItemOwnerTag(free));
    assert.notDeepEqual(requestItemChargeTag(paid), requestItemChargeTag(free));
  });

  it("🔵 서로의 값 없이도 제 딱지를 낸다 — 두 함수가 묻는 것이 갈려 있다", () => {
    // 부품만 있고 줄 값이 없어도 소유 딱지는 선다(그 반대도 마찬가지).
    assert.notEqual(requestItemOwnerTag(part({ owner: "SERVICE_SPARE" })), null);
    assert.notEqual(requestItemChargeTag({ chargeType: "FREE" }), null);
  });

  it("🔴 딱지 개수가 **있는 값의 수** 그대로다 (전수 네 짝) — 없는 값이 빈 자리를 만들지 않는다", () => {
    for (const owner of [null, "KYOSAN"] as const) {
      for (const charge of [null, "PAID"] as const) {
        const item = { ...part({ owner }), ...line({ chargeType: charge }) };
        const tags = [requestItemOwnerTag(item), requestItemChargeTag(item)].filter((t) => t !== null);
        assert.equal(tags.length, (owner === null ? 0 : 1) + (charge === null ? 0 : 1), `owner=${owner} charge=${charge}`);
      }
    }
  });
});

describe("🔴 딱지가 **색 말고도** 갈린다 (2026-10-21, CLAUDE.md 9-7절)", () => {
  it("🔴 유상과 무상 — 글자가 다르고, 꾸밈도 다르다", () => {
    const paid = requestItemChargeTag(line({ chargeType: "PAID" }))!;
    const free = requestItemChargeTag(line({ chargeType: "FREE" }))!;
    // ① 글자: 색을 전부 지워도 이 가름은 남는다.
    assert.equal(paid.value, "유상");
    assert.equal(free.value, "무상");
    assert.notEqual(paid.value, free.value);
    // ② 바탕이 차 있나: 한쪽만 칠해져 있다 — 흑백으로 찍어도 보인다.
    assert.ok(paid.className.includes("bg-amber-50"), "유상의 바탕이 사라졌다 — 색조 말고 가를 것이 글자뿐이 된다");
    assert.ok(free.className.includes("bg-white"), "무상이 칠해졌다 — 「한쪽만 차 있다」는 가름이 사라진다");
    assert.notEqual(paid.className, free.className);
  });

  it("🔴 소유 딱지와 유상/무상 딱지 — 라벨과 굵기로 갈린다", () => {
    const owner = requestItemOwnerTag(part({ owner: "KYOSAN" }))!;
    const charge = requestItemChargeTag(line())!;
    // ① 라벨: 소유에만 붙는다(값만으로는 무슨 칸인지 모른다). 유상/무상은 값 자체가 말이 된다.
    assert.equal(owner.label, "소유");
    assert.equal(charge.label, "", "유상/무상에 라벨을 달았다 — 같은 말이 두 번 나오고 딱지가 길어져 오히려 묻힌다");
    // ② 굵기: 돈이 걸린 값만 굵다.
    assert.ok(charge.className.includes("font-semibold"), "유상/무상이 굵지 않다 — 흘려 적으면 놓친다");
    assert.ok(!owner.className.includes("font-semibold"), "소유도 굵다 — 굵기로는 갈리지 않고, 돈이 걸린 값이 묻힌다");
  });

  it("🔵 딱지의 글자와 꾸밈을 **한 자리에서 함께** 고른다 — 따로 두면 한쪽만 늘어난다", () => {
    for (const tag of [requestItemOwnerTag(part())!, requestItemChargeTag(line())!]) {
      assert.equal(typeof tag.value, "string");
      assert.ok(tag.value.length > 0, "값이 빈 딱지가 섰다");
      assert.ok(tag.className.length > 0, "꾸밈 없는 딱지가 섰다");
    }
  });
});

describe("🔴 화면 조각이 딱지를 그리고, 앞자리는 그대로다 (2026-10-21)", () => {
  const piece = src("src/components/stock/RequestItemDetails.tsx");

  it("🔴 규칙을 다시 적지 않고 **두 함수를 따로** 부른다 — 한 함수로 합치면 가름이 사라진다", () => {
    assert.match(piece, /requestItemOwnerTag\(item\)/, "조각이 소유 딱지를 순수 함수로 묻지 않는다");
    assert.match(piece, /requestItemChargeTag\(item\)/, "조각이 유상/무상 딱지를 순수 함수로 묻지 않는다");
    assert.ok(!piece.includes("OWNER_LABEL"), "조각이 소유 글자를 제 안에서 푼다 — 표가 두 곳이 된다");
    assert.ok(!piece.includes("CHARGE_LABEL"), "조각이 유상/무상 글자를 제 안에서 푼다 — 표가 두 곳이 된다");
    for (const word of ["유상", "무상", "KYOSAN"]) {
      assert.ok(!piece.includes(`>${word}<`), `딱지 글자(${word})를 조각에 손으로 적었다`);
    }
  });

  /**
   * 🔴 **고객사 품명의 앞자리를 빼앗지 않는다.** 앞자리는 「눈으로 훑어 찾는 값」으로 2026-10-21 에
   * 정해진 것이고, 딱지는 **줄을 고른 뒤에 확인하는 값**이다. 그렇다고 맨 뒤로 보내지도 않는다 —
   * 유상/무상은 돈이 걸린 값이라 품번·도번 뒤에 흘려 적으면 놓친다.
   */
  it("🔴 차례가 ① 고객사 품명 ② 딱지 ③ 나머지 글자다", () => {
    const leadAt = piece.indexOf("{lead === null ? null : (");
    const tagsAt = piece.indexOf("{tags.length === 0 ? null : (");
    const restAt = piece.indexOf("{rest.length === 0 ? null : (");
    assert.ok(leadAt >= 0 && tagsAt >= 0 && restAt >= 0, "세 갈림을 못 찾았다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(leadAt < tagsAt, "딱지가 고객사 품명보다 먼저 선다 — 앞자리를 빼앗았다");
    assert.ok(tagsAt < restAt, "딱지가 품번·도번 뒤로 밀렸다 — 유상/무상을 흘려 적으면 놓친다");
  });

  it("🔴 소유구분을 그리는 자리가 **조각 하나뿐**이다 — 부품 요청 관리가 제 모양으로 또 그리지 않는다", () => {
    const screen = src("src/components/stock/RequestManagerScreen.tsx");
    assert.ok(!screen.includes("OWNER_LABEL["), "화면이 소유를 따로 그린다 — 2026-10-21 전처럼 값이 없을 때 하이픈이 되살아난다");
  });
});

describe("🔴 조회·중간이 둘을 실어 나른다, 쓰기는 그대로다 (2026-10-21)", () => {
  const queries = src("src/lib/stock/requests.ts");

  it("🔵 소유구분은 **이미 오고 있던 값**이다 — 부품 표에서 읽어 줄에 싣는다", () => {
    assert.match(queries, /owner: parts\.owner/, "부품 조회가 소유를 안 읽는다");
    assert.match(queries, /owner: p\?\.owner \?\? null/, "신청 줄에 소유가 안 실린다 — 지어낸 기본값이 들어갔을 수도 있다");
  });

  it("🔴 유상/무상은 **신청 payload 에서** 온다 — 부품 표가 아니다", () => {
    assert.match(queries, /chargeType: isChargeType\(l\.chargeType\) \? l\.chargeType : null/, "payload 의 유상/무상을 거르지 않고 그대로 쓴다");
    assert.match(queries, /chargeType: l\.chargeType/, "신청 줄에 유상/무상이 안 실린다");
    assert.ok(!queries.includes("chargeType: p?.chargeType"), "유상/무상을 부품 표에서 읽고 있다 — 그것은 줄의 값이다");
  });

  /**
   * 🔴 **바로 앞 조각과 똑같은 자리에서 또 끊겨 있었다.** 넷을 옮겨 적으면서 바로 윗줄의 `owner` 를
   * 건너뛴 것이라, 조회에는 와 있는데 「승인 요청건」에서만 소유가 안 보였다.
   */
  it("🔴 승인 요청건의 줄로 **옮겨 적는다** — 없으면 `null` 이지 지어낸 값이 아니다", () => {
    const data = src("src/lib/approval/part-issue-screen-data.ts");
    assert.ok(data.includes("owner: line?.owner ?? null"), "결재건 줄에 소유가 안 실린다");
    assert.ok(data.includes("chargeType: line?.chargeType ?? null"), "결재건 줄에 유상/무상이 안 실린다");
  });

  it("🔴 **쓰기 쪽이 한 글자도 안 바뀌었다** — 유상/무상은 payload 에서 **읽기만** 한다", () => {
    const touched = queries.split("\n").filter((l) => l.includes("chargeType"));
    assert.ok(touched.length > 0, "조회가 유상/무상을 싣지 않는다");
    for (const l of touched) {
      for (const write of [".insert(", ".update(", ".set(", ".values("]) {
        assert.ok(!l.includes(write), `유상/무상이 쓰는 문장에 끼어들었다: ${l.trim()}`);
      }
    }
  });

  it("🔴 **스키마를 안 건드렸다** — 유상/무상은 신청 표의 칸이 아니라 payload 안에 있다", () => {
    assert.ok(!src("src/db/schema/stock-requests.ts").includes("chargeType"), "신청 표에 유상/무상 칸을 만들었다 — payload 에 이미 있다");
  });

  /**
   * 🔴 **2026-10-21 에 뒤집힌 시험이다.** 이 자리는 원래 「바깥(A/S) 통로로는 **안 나간다**」를 지키고
   * 있었다 — 그날 아침까지는 참말이었다. 같은 날 오후 쓰는 분 요청으로 **A/S 의 반출 신청 줄에도 같은
   * 내용을 보이기로** 했고(「어느 부품인지 가릴 수 없다」), 그래서 통로를 **넓혔다.**
   *
   * 🔴 **그렇다고 단언을 지우지 않는다.** 원래 시험이 지키던 것은 「유상/무상이 안 나간다」가 아니라
   *    **「칸을 하나씩 손으로 옮겨 적어 경계가 저절로 서 있다」**였다. 그 울타리는 그대로이고, 여기서
   *    재는 것도 그것이다 — **화면 줄에만 있는 칸은 여전히 안 나간다.**
   * 🔵 `partId`(A/S 가 쓸 수 없는 우리 UUID)와 `available`(지금 재고. 재고 담당의 정보다)이 그 둘이다.
   *    통로가 `{ ...l }` 로 줄을 통째로 펴 보내는 날 이 시험이 먼저 깨진다.
   */
  it("🔴 바깥(A/S) 통로는 **칸을 하나씩 손으로 옮겨 적는다** — 화면 줄에만 있는 칸은 안 나간다", () => {
    /* 🔵 **주석 줄은 뺀다** — 이 파일의 머리말이 「`partId` 는 안 나간다」를 글로 적어 두고 있어서,
       날글자로 재면 그 설명 자체에 걸린다. 가르는 법은 이 저장소가 쓰는 그것이다(줄의 첫 글자). */
    const api = src("src/lib/api/stock-request-status.ts")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
      })
      .join("\n");
    // ㉠ 넓힌 것 — 2026-10-21 에 A/S 도 받기로 한 값들.
    for (const field of ["customerName", "name2", "kyosanPartNo", "drawingNo", "owner", "chargeType"]) {
      assert.ok(api.includes(`${field}:`), `A/S 가 받는 줄에 ${field} 가 안 실린다`);
    }
    // ㉡ 🔴 넓히지 않은 것 — 그 경계가 아직 서 있는가.
    assert.ok(!api.includes("partId"), "우리 쪽 UUID 가 바깥으로 새어 나간다 — A/S 는 부품을 No. 로 가리킨다");
    assert.ok(!api.includes("available"), "지금 재고가 바깥으로 새어 나간다 — 재고 담당의 정보다");
    // ㉢ 🔴 통째로 펴 보내는 길이 생기지 않았다 — 그 한 줄이 위 둘을 한꺼번에 무너뜨린다.
    assert.ok(!/lines:\s*r\.lines(?!\.map)/.test(api), "신청 줄을 통째로 펴 보낸다 — 칸이 느는 대로 따라 나간다");
  });
});
