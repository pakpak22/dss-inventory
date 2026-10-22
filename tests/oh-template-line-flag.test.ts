import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildApiUseRequest, parseApiStockRequest, resolveApiRequestLines, type ApiPartRow } from "../src/lib/api/stock-requests";
import { toApiRequestStatus, type RequestStatusSource } from "../src/lib/api/stock-request-status";
import {
  REQUEST_ITEM_OH_TAG_CLASS,
  REQUEST_ITEM_OH_TAG_VALUE,
  requestItemChargeTag,
  requestItemOhTag,
  requestItemOwnerTag,
  type RequestItemLine,
  type RequestItemPart,
} from "../src/lib/stock/request-item-detail";

/**
 * ============================================================================
 * 🔴 **A/S 에서 [O/H 부품 한 번에 담기]로 담긴 줄에 표시가 따라붙는가** (2026-10-22)
 * ============================================================================
 * 쓰는 분: 「A/S 의 [수리 건 상세]에서 [O/H 부품 한 번에 담기]를 하면, 그 부품이 **O/H
 * 부품이라는 표시**를 **부품을 요청하는 모든 과정에 부품마다** 띄워 줘.」
 *
 * 재고 관리 쪽에서 그 표시가 서는 자리는 셋이다 — **[부품요청]의 신청 항목**, **[승인요청건]의
 * 신청 항목**, **[불출 신청] 팝업의 품목 목록**. 셋 다 같은 조각(`RequestItemDetails`)을 쓰므로
 * 여기서 재는 것은 **그 조각에 닿기까지 값이 끊기지 않는가**와 **딱지의 규칙**이다.
 *
 * 붙잡는 것 다섯 —
 *  ㉠ **받는다.** A/S 가 보낸 칸을 읽되, 🔴 **안 보냈다고 거절하지 않는다**(딱지 하나 때문에
 *     현장에서 부품을 못 받으면 안 된다). 유상/무상과 **일부러 다른** 다룸이다.
 *  ㉡ **적어 둔다.** 🔴 참일 때만 payload 에 칸이 선다 — 거짓이면 2026-10-22 전의 옛 줄과
 *     **같은 모양**이고, 그래서 읽는 규칙이 「없으면 아님」 하나로 끝난다.
 *  ㉢ **되돌려 보낸다.** A/S 는 재고 자료를 제 표에 저장하지 않아서, 올린 뒤의 화면은 전부
 *     이 통로가 준 것으로 그린다 — 안 실어 보내면 **담는 중에만 보이는** 딱지가 된다.
 *  ㉣ **딱지 규칙.** 참일 때만 서고, 🔴 「일반」 같은 딱지를 만들지 않는다(옛 신청이 「확인해
 *     보니 일반 부품」으로 단정돼 보인다).
 *  ㉤ 🔴 **범위 밖은 건드리지 않았다.** [기록 내역]과 원장(`stock_entries`)에는 이 칸이 없다 —
 *     거기까지 남기려면 마이그레이션이 생기고, 그것은 쓰는 분과 정한 범위 밖이다.
 *
 * 🔵 **칸 이름(`fromOhTemplate`)이 A/S 의 것과 같은가**는 한 저장소 안에서 잴 수 없다. 양쪽이
 *    각자 제 이름으로 통과하기 때문이다 — A/S 의 `scripts/check-inventory-contract.ts` 가 두
 *    저장소의 원본을 맞대어 잰다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 🔴 **주석을 뗀다.** 안 떼면 머리말에 적힌 글자를 「코드가 그렇게 돼 있다」로 세어 헛통과한다.
 * 🔵 `tests/part-limit-quantity.test.ts` 의 것과 같은 수법이다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // 블록 주석(JSX 의 {/* … */} 포함)
    .replace(/\/\/.*$/gm, ""); // 줄 주석
}

const BODY = {
  requestKey: "AS-REQ-OH-1",
  intakeNumber: "D260701",
  requester: { sub: "portal:1", name: "홍길동" },
  lines: [{ no: 165, quantity: 2, chargeType: "PAID" }],
};

const ROWS: ApiPartRow[] = [
  { no: 165, id: "11111111-1111-4111-8111-111111111111", isDeleted: false },
  { no: 7, id: "22222222-2222-4222-8222-222222222222", isDeleted: false },
];

/** 본문 → 신청 payload 까지 한 번에. 🔵 가운데 되짚기를 건너뛰지 않는다(거기서도 떨어질 수 있다). */
function payloadFor(body: unknown) {
  const parsed = parseApiStockRequest(body);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  const resolved = resolveApiRequestLines(parsed.value.lines, ROWS);
  assert.ok(resolved.ok, resolved.ok ? "" : resolved.message);
  const input = buildApiUseRequest(parsed.value, resolved.lines, "2026-10-22");
  assert.ok(input.type === "USE");
  return input;
}

describe("㉠ 받는다 — 안 보냈다고 거절하지 않는다", () => {
  it("🔴 보낸 줄은 참이다", () => {
    const r = parseApiStockRequest({ ...BODY, lines: [{ no: 165, quantity: 1, chargeType: "PAID", fromOhTemplate: true }] });
    assert.ok(r.ok);
    assert.equal(r.value.lines[0].fromOhTemplate, true);
  });

  it("🔴 **칸을 안 보내도 받는다** — 거짓으로 눕고 신청은 선다 (유상/무상과 일부러 다르다)", () => {
    const r = parseApiStockRequest(BODY);
    assert.ok(r.ok, "O/H 표시가 없다고 신청을 거절했다 — 현장에서 부품을 못 받는다");
    assert.equal(r.value.lines[0].fromOhTemplate, false);
  });

  it("🔴 참이 아닌 것은 전부 거짓이다 — 글자 `\"true\"` 도 숫자 1 도 고쳐 주지 않는다", () => {
    for (const bad of ["true", "TRUE", 1, "1", {}, [], null] as unknown[]) {
      const r = parseApiStockRequest({ ...BODY, lines: [{ no: 165, quantity: 1, chargeType: "PAID", fromOhTemplate: bad }] });
      assert.ok(r.ok, `${JSON.stringify(bad)} 때문에 신청이 거절됐다`);
      assert.equal(r.value.lines[0].fromOhTemplate, false, JSON.stringify(bad) ?? "undefined");
    }
  });

  it("🔵 **줄마다 제 값**이다 — 한 신청 안에 섞여 들어와도 뒤바뀌지 않는다", () => {
    const r = parseApiStockRequest({
      ...BODY,
      lines: [
        { no: 165, quantity: 1, chargeType: "PAID", fromOhTemplate: true },
        { no: 7, quantity: 2, chargeType: "FREE", fromOhTemplate: false },
      ],
    });
    assert.ok(r.ok);
    assert.deepEqual(
      r.value.lines.map((l) => [l.no, l.fromOhTemplate]),
      [
        [165, true],
        [7, false],
      ],
    );
  });
});

describe("㉡ 적어 둔다 — 🔴 참일 때만 칸이 선다 (옛 줄과 같은 모양)", () => {
  it("참이면 payload 줄에 칸이 선다", () => {
    const input = payloadFor({ ...BODY, lines: [{ no: 165, quantity: 2, chargeType: "PAID", fromOhTemplate: true }] });
    assert.equal(input.lines[0].fromOhTemplate, true);
  });

  it("🔴 거짓이면 **칸 자체가 없다** — 2026-10-22 전에 올라간 줄과 한 글자도 다르지 않다", () => {
    const input = payloadFor(BODY);
    assert.ok(!Object.hasOwn(input.lines[0], "fromOhTemplate"), "거짓을 적어 두었다 — 옛 줄과 모양이 갈린다");
  });

  it("🔵 되짚기를 지나도 **줄마다 제 값**이다 — 부품 id 로 바뀌면서 뒤바뀌지 않는다", () => {
    const input = payloadFor({
      ...BODY,
      lines: [
        { no: 165, quantity: 1, chargeType: "PAID", fromOhTemplate: true },
        { no: 7, quantity: 2, chargeType: "FREE", fromOhTemplate: false },
      ],
    });
    assert.deepEqual(
      input.lines.map((l) => [l.partId, l.fromOhTemplate === true]),
      [
        ["11111111-1111-4111-8111-111111111111", true],
        ["22222222-2222-4222-8222-222222222222", false],
      ],
    );
  });

  it("🔴 **수량·유상무상·비고는 한 글자도 안 바뀌었다** — 이 조각은 표시 하나를 더한다", () => {
    const input = payloadFor({ ...BODY, lines: [{ no: 165, quantity: 2, chargeType: "PAID", fromOhTemplate: true }] });
    assert.equal(input.lines[0].quantity, 2);
    assert.equal(input.lines[0].chargeType, "PAID");
    assert.equal(input.lines[0].actualQuantity, null);
    assert.equal(input.lines[0].note, "");
  });
});

describe("㉢ 되돌려 보낸다 — 안 보내면 「담는 중에만 보이는」 딱지가 된다", () => {
  const source = (over: Partial<RequestStatusSource["lines"][number]> = {}): RequestStatusSource => ({
    id: "r1",
    type: "USE",
    status: "PENDING",
    intakeNumber: "D260701",
    requesterSub: "portal:1",
    requestedByName: "홍길동",
    requestedAt: "2026-10-22T01:00:00.000Z",
    note: "",
    lines: [
      {
        partNo: 165,
        partName: "AMP",
        quantity: 2,
        issued: 0,
        customerName: "",
        name2: "",
        kyosanPartNo: "",
        drawingNo: "",
        owner: "KYOSAN",
        chargeType: "PAID",
        fromOhTemplate: false,
        ...over,
      },
    ],
    decidedByName: null,
    decidedAt: null,
    decisionNote: "",
    decidedVia: null,
    hold: null,
    issueLock: null,
  });

  it("참인 줄이 참으로 나간다", () => {
    assert.equal(toApiRequestStatus("AS-1", source({ fromOhTemplate: true })).lines[0].fromOhTemplate, true);
  });

  it("🔴 **언제나 칸이 선다** — 거짓이어도 뺀다면 저쪽 점검이 「안 보내게 된 날」을 못 잡는다", () => {
    const line = toApiRequestStatus("AS-1", source()).lines[0] as unknown as Record<string, unknown>;
    assert.ok(Object.hasOwn(line, "fromOhTemplate"), "거짓이라고 칸을 빼 버렸다");
    assert.equal(line.fromOhTemplate, false);
  });

  it("🔵 **지워진 부품의 줄에도 남는다** — 부품이 아니라 그 줄에 적힌 값이다", () => {
    const line = toApiRequestStatus("AS-1", source({ partNo: null, partName: "(지워진 부품)", owner: null, fromOhTemplate: true })).lines[0];
    assert.equal(line.no, null);
    assert.equal(line.owner, null);
    assert.equal(line.fromOhTemplate, true, "부품을 못 찾았다고 줄의 값까지 지웠다");
  });
});

describe("㉣ 딱지 — 🔴 참일 때만 서고, 「일반」을 만들지 않는다", () => {
  const part = (over: Partial<RequestItemPart> = {}): RequestItemPart => ({
    partNo: 165,
    owner: "KYOSAN",
    customerName: "",
    name2: "",
    kyosanPartNo: "",
    drawingNo: "",
    ...over,
  });
  const line = (over: Partial<RequestItemLine> = {}): RequestItemLine => ({ chargeType: "PAID", fromOhTemplate: false, ...over });

  it("아니면 아무것도 안 그린다 — 「일반」 딱지가 없다", () => {
    assert.equal(requestItemOhTag(line()), null);
  });

  it("맞으면 정해 둔 글자 하나다 — 화면이 아니라 상수가 쥔다", () => {
    const tag = requestItemOhTag(line({ fromOhTemplate: true }));
    assert.ok(tag !== null);
    assert.equal(tag.key, "oh");
    assert.equal(tag.value, REQUEST_ITEM_OH_TAG_VALUE);
    assert.equal(tag.label, "", "「O/H」 앞에 라벨을 달면 같은 말이 두 번 나온다");
  });

  it("🔴 낱말이 「O/H」다 — 「오버홀」로 풀지 않는다 (이 저장소가 쓰는 말)", () => {
    assert.equal(REQUEST_ITEM_OH_TAG_VALUE, "O/H");
  });

  it("🔴 이웃 딱지 둘과 **색 말고도** 갈린다 — 글자가 섞일 수 없다", () => {
    const oh = requestItemOhTag(line({ fromOhTemplate: true }))!;
    const owner = requestItemOwnerTag(part())!;
    const charge = requestItemChargeTag(line())!;
    assert.notEqual(oh.value, owner.value);
    assert.notEqual(oh.value, charge.value);
    assert.notEqual(oh.className, owner.className);
    assert.notEqual(oh.className, charge.className);
    // 바탕이 차 있고 굵다 — 흑백으로 찍어도 「칠해져 있다」가 보인다.
    assert.ok(REQUEST_ITEM_OH_TAG_CLASS.includes("bg-violet-50"));
    assert.ok(REQUEST_ITEM_OH_TAG_CLASS.includes("font-semibold"));
  });

  it("🔴 **묻는 것이 줄의 값이다** — 부품 쪽 묶음에 그 칸이 없다", () => {
    const rules = stripComments(src("src/lib/stock/request-item-detail.ts"));
    const body = (name: string): string => {
      const m = new RegExp(`export interface ${name}(?![A-Za-z0-9_])[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(rules);
      assert.ok(m !== null, `${name} 을 못 찾았다`);
      return m![1];
    };
    assert.ok(body("RequestItemLine").includes("fromOhTemplate"), "줄 쪽 묶음에서 빠졌다");
    assert.ok(!body("RequestItemPart").includes("fromOhTemplate"), "부품 쪽 묶음에 들어갔다 — 「이 부품은 O/H 인가요?」라는 틀린 물음이 생긴다");
  });

  it("🔴 화면 조각이 **순수 함수로** 묻는다 — 세 화면이 그 조각 하나를 쓴다", () => {
    const piece = stripComments(src("src/components/stock/RequestItemDetails.tsx"));
    assert.match(piece, /requestItemOhTag\(item\)/, "조각이 O/H 딱지를 순수 함수로 묻지 않는다");
    assert.ok(!piece.includes("O/H"), "딱지 글자를 조각에 손으로 적었다 — 말이 바뀌는 날 이 줄만 옛말을 한다");
    assert.ok(!piece.includes(REQUEST_ITEM_OH_TAG_CLASS), "딱지 꾸밈을 조각에 베껴 적었다");
  });

  it("🔴 **승인 요청건으로도 옮겨 적힌다** — 그 자리에서만 빠지는 사고가 전에 두 번 있었다", () => {
    const data = stripComments(src("src/lib/approval/part-issue-screen-data.ts"));
    assert.match(data, /fromOhTemplate: line\?\.fromOhTemplate \?\? false,/, "결재건 줄로 안 옮겨진다 — 승인 요청건에서만 딱지가 안 보인다");
  });

  it("🔴 **신청 payload 에서 읽는다** — 지금 템플릿을 다시 보지 않는다", () => {
    const requests = stripComments(src("src/lib/stock/requests.ts"));
    assert.match(requests, /fromOhTemplate: l\.fromOhTemplate === true/, "payload 의 그 칸을 「없으면 아님」으로 읽지 않는다");
    assert.ok(!requests.includes("ohTemplate"), "신청을 읽으면서 O/H 템플릿을 들여다본다 — 템플릿이 바뀌면 옛 신청의 표시가 달라진다");
  });
});

describe("㉤ 🔴 범위 밖은 건드리지 않았다 — [기록 내역]·원장에는 그 칸이 없다", () => {
  it("원장 표(stock_entries 둘레)에 칸이 생기지 않았다 — 생기면 마이그레이션이다", () => {
    for (const file of ["src/db/schema/stock.ts", "src/lib/stock/ledger.ts"]) {
      assert.ok(!src(file).includes("fromOhTemplate"), `${file} 에 그 칸이 들어갔다 — 범위 밖이다`);
    }
  });

  it("신청 표에도 칸이 생기지 않았다 — 값은 payload(jsonb) 안에 있다", () => {
    assert.ok(!src("src/db/schema/stock-requests.ts").includes("fromOhTemplate"), "신청 표에 칸이 생겼다 — 마이그레이션이다");
  });
});
