import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTAKE_PARAM,
  MAX_STATUS_INTAKES,
  MAX_STATUS_KEYS,
  buildIntakeStatusResponse,
  buildStatusResponse,
  parseStatusIntakes,
  parseStatusKeys,
  parseStatusQuery,
  toApiRequestStatus,
  type IntakeStatusRow,
  type RequestStatusSource,
} from "../src/lib/api/stock-request-status";
import { checkBearerToken } from "../src/lib/api/token-gate";
import { env } from "../src/lib/env";
import { OWNER_LABEL } from "../src/lib/parts/codes";
import { AWAITING_EXECUTION_REQUEST_LABEL, CHARGE_LABEL, CLOSED_REQUEST_LABEL, INTAKE_NUMBER_RE, REQUEST_STATUS_LABEL } from "../src/lib/stock/codes";

/**
 * A/S 가 **올린 신청의 지금 상태를 물어 가는 통로**의 울타리 (2026-10-15, `GET /api/v1/stock-requests`).
 *
 * 🔴 올리는 통로와 같은 까닭으로 규칙을 전부 순수 함수에 모아 두고 여기서 덮는다 — 통로 파일은
 *    `server-only` 를 거쳐 들어가 `npm test` 가 **불러올 수 없다**(`tests/api-stock-requests.test.ts` 머리말).
 * 🔵 덮는 것 다섯: 여러 열쇠 · 없는 열쇠 · 상한 · 마감 판정 · 토큰(읽기 전용).
 */

/**
 * 🔵 **통로가 받는 줄의 모양을 그대로 빌린다** — 여기 손으로 적으면 통로가 칸을 늘린 날 본보기만 옛것이
 *    되고, 그 칸은 **시험이 영영 안 재는 칸**이 된다.
 */
type SourceLine = RequestStatusSource["lines"][number];

/**
 * 줄 하나의 본보기. 🔴 **칸마다 서로 다른 값**을 넣어 둔다 — 같은 값이 둘이면 옮겨 적다 뒤바뀐 것을
 * 시험이 못 본다(`customerName` 과 `name2` 처럼 둘 다 글자인 칸이 그렇다).
 */
const LINE: SourceLine = {
  partNo: 165,
  partName: "AMP-DEH-DV2H(13M)",
  quantity: 2,
  issued: 0,
  customerName: "증폭기 조립품",
  name2: "13M",
  kyosanPartNo: "KY-7788",
  drawingNo: "DWG-1001",
  owner: "KYOSAN",
  chargeType: "PAID",
  // 🔵 2026-10-22 에 줄이 한 칸 더 넓어졌다 — A/S 의 [O/H 부품 한 번에 담기]로 담긴 줄인가.
  //    본보기는 **참**으로 둔다: 거짓이면 옮겨 적기를 빠뜨려도 기본값과 같아 시험이 못 본다.
  fromOhTemplate: true,
};

const SOURCE: RequestStatusSource = {
  id: "0c0f1111-1111-4111-8111-111111111111",
  type: "USE",
  status: "PENDING",
  intakeNumber: "D260701",
  requesterSub: "portal-sub-aaaa-1111",
  requestedByName: "예시 신청자",
  requestedAt: "2026-10-15T01:00:00.000Z",
  // 🔵 **안 적고 올린 신청이 기본**이다 — 재고 관리 화면에서 올린 신청은 늘 비어 있다(2026-10-22).
  note: "",
  lines: [LINE],
  decidedByName: null,
  decidedAt: null,
  decisionNote: "",
  // 🔵 결재를 거치지 않은 반려가 기본이다 — 그때 `decision.byName` 은 2026-10-22 이전과
  //    한 글자도 다르지 않다(아래 「결재를 거친 반려」 묶음이 다른 경우를 잰다).
  decidedVia: null,
  hold: null,
  // 🔵 결재가 걸려 있지 않은 신청이 기본이다 — 그때 글자는 2026-10-21 이전과 한 글자도 다르지 않다.
  issueLock: null,
};

const source = (over: Partial<RequestStatusSource> = {}): RequestStatusSource => ({ ...SOURCE, ...over });

const keys = (qs: string): string[] => {
  const r = parseStatusKeys(new URLSearchParams(qs));
  assert.ok(r.ok, `받을 줄 알았는데 거절했다: ${r.ok ? "" : r.message}`);
  return r.keys;
};

const rejection = (qs: string): string => {
  const r = parseStatusKeys(new URLSearchParams(qs));
  assert.equal(r.ok, false, "거절할 조건인데 통과했다");
  return r.ok ? "" : r.message;
};

describe("묻는 법 — 열쇠는 A/S 쪽 요청 번호, 여러 개를 한 번에 (2026-10-15)", () => {
  it("🔴 여러 열쇠를 한 번에 묻는다 — 물어본 차례 그대로", () => {
    assert.deepEqual(keys("key=AS-3&key=AS-1&key=AS-2"), ["AS-3", "AS-1", "AS-2"]);
  });

  it("앞뒤 공백은 떼고, 빈 열쇠는 없는 것으로 본다", () => {
    assert.deepEqual(keys("key=++AS-1++&key=&key=AS-2"), ["AS-1", "AS-2"]);
  });

  it("같은 열쇠가 두 번 오면 한 번만 묻는다 — 같은 신청이 두 줄로 돌아가면 화면에 같은 줄이 둘 뜬다", () => {
    assert.deepEqual(keys("key=AS-1&key=AS-1&key=AS-2"), ["AS-1", "AS-2"]);
  });

  it("🔴 열쇠가 하나도 없으면 **전체를 주지 않고** 거절한다 (쓰는 법을 문구에 적어 준다)", () => {
    assert.match(rejection(""), /key/);
    assert.match(rejection("key=&key=++"), /requestKey/);
    assert.match(rejection("keys=AS-1"), /key=AS-REQ/, "이름을 틀리게 보냈을 때 올바른 꼴이 문구에 보여야 한다");
  });

  it("🔵 열쇠를 자르는 길이가 올리는 통로와 같다 — 안 맞추면 긴 열쇠로 올린 신청을 못 찾는다", () => {
    const long = "A".repeat(150);
    assert.deepEqual(keys(`key=${long}`), ["A".repeat(100)]);
  });
});

describe("🔴 한 번에 물을 수 있는 개수에 상한 (2026-10-15)", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => `key=AS-${i + 1}`)
      .join("&")
      .toString();

  it("상한은 50 — 이 저장소가 「한 번에 받는 양」에 쓰는 눈금이다 (한 신청의 줄 수와 같은 숫자)", () => {
    assert.equal(MAX_STATUS_KEYS, 50);
  });

  it("딱 상한까지는 받는다", () => {
    assert.equal(keys(many(MAX_STATUS_KEYS)).length, MAX_STATUS_KEYS);
  });

  it("🔴 넘으면 거절한다 — 몇 개까지인지와 몇 개를 받았는지를 적는다", () => {
    const m = rejection(many(MAX_STATUS_KEYS + 1));
    assert.match(m, new RegExp(`${MAX_STATUS_KEYS}개까지`));
    assert.match(m, new RegExp(`${MAX_STATUS_KEYS + 1}개`));
  });

  it("중복을 걷어낸 뒤의 수로 센다 — 실제로 읽는 양이 그것이다", () => {
    const repeated = Array.from({ length: MAX_STATUS_KEYS + 20 }, () => "key=AS-1").join("&");
    assert.deepEqual(keys(repeated), ["AS-1"]);
  });
});

describe("🔴 없는 열쇠 — 조용히 빠뜨리지 않는다 (2026-10-15)", () => {
  const found = new Map([
    ["AS-1", source()],
    ["AS-3", source({ id: "0c0f3333-3333-4333-8333-333333333333" })],
  ]);

  it("물어본 만큼 돌아온다 — 찾은 것 + 못 찾은 것 = 물어본 열쇠 수", () => {
    const r = buildStatusResponse(["AS-1", "AS-2", "AS-3"], found, "2026-10-15T05:00:00.000Z");
    assert.equal(r.count, 2);
    assert.equal(r.count + r.notFound.length, 3);
  });

  it("🔴 못 찾은 열쇠가 **무엇인지** 돌아온다 — 안 그러면 A/S 가 「아직 안 올라갔나, 지워졌나」를 모른다", () => {
    const r = buildStatusResponse(["AS-1", "AS-2", "AS-3"], found, "2026-10-15T05:00:00.000Z");
    assert.deepEqual(r.notFound, ["AS-2"]);
  });

  it("하나도 못 찾아도 오류가 아니다 — 빈 목록과 못 찾은 열쇠 전부", () => {
    const r = buildStatusResponse(["AS-9", "AS-8"], new Map(), "2026-10-15T05:00:00.000Z");
    assert.deepEqual(r.requests, []);
    assert.equal(r.count, 0);
    assert.deepEqual(r.notFound, ["AS-9", "AS-8"]);
  });

  it("찾은 것은 **물어본 차례 그대로** 돌아오고, 물어본 열쇠를 그대로 달고 온다", () => {
    const r = buildStatusResponse(["AS-3", "AS-2", "AS-1"], found, "2026-10-15T05:00:00.000Z");
    assert.deepEqual(
      r.requests.map((q) => q.requestKey),
      ["AS-3", "AS-1"],
    );
    assert.equal(r.requests[0].id, "0c0f3333-3333-4333-8333-333333333333", "열쇠와 신청이 뒤바뀌면 안 된다");
  });

  it("보낸 시각이 실린다", () => {
    assert.equal(buildStatusResponse([], new Map(), "2026-10-15T05:00:00.000Z").generatedAt, "2026-10-15T05:00:00.000Z");
  });
});

describe("돌려주는 모양 — 화면이 그릴 수 있을 만큼 (2026-10-15)", () => {
  it("칸은 이것뿐이다 — 약속이라 이름을 바꾸거나 빼지 않는다", () => {
    assert.deepEqual(
      Object.keys(toApiRequestStatus("AS-1", source())).sort(),
      // 🔵 `note` 는 2026-10-22 에 더한 칸이다 — **최상위**이고 `decision` 안이 아니다(아래 묶음).
      ["closed", "decision", "hold", "id", "intakeNumber", "lines", "note", "requestKey", "requestedAt", "requester", "status", "type"].sort(),
    );
  });

  it("🔵 인수번호가 함께 간다 — 열쇠로 물었을 때도 같은 모양이다 (2026-10-15 에 더한 칸)", () => {
    assert.equal(toApiRequestStatus("AS-1", source({ intakeNumber: "D260701" })).intakeNumber, "D260701");
  });

  /**
   * 🔴 **A/S 가 「내가 올린 줄」을 가리는 값은 포털 번호뿐이다** (2026-10-16 에 더한 칸).
   *    저쪽은 `requestKey` 를 저장하지 않으므로, 이 칸이 없으면 **[요청 취소] 단추를 아무 줄에도 못 그린다** —
   *    거두는 통로(API.md 4-9절)를 부를 길이 사라지는데 화면은 멀쩡해 보이고 오류도 안 난다.
   */
  it("🔴 A/S 에서 올라온 신청은 **포털 번호가 실린다** — 거두는 통로를 부를 유일한 열쇠다", () => {
    const q = toApiRequestStatus("AS-1", source({ requesterSub: "portal-sub-aaaa-1111", requestedByName: "예시 신청자" }));
    assert.deepEqual(q.requester, { sub: "portal-sub-aaaa-1111", name: "예시 신청자" });
  });

  it("🔴 재고 관리에서 직접 올린 신청은 **`null`** 이다 — 빈 글자가 아니고, 지어내지 않는다", () => {
    const q = toApiRequestStatus(null, source({ requesterSub: null, requestedByName: "정영빈" }));
    assert.equal(q.requester.sub, null);
    assert.notEqual(q.requester.sub, "", "빈 글자로 채우면 「번호가 없는 것」과 「번호가 빈 사람」이 같아진다");
  });

  it("🔵 이름은 둘 다 실린다 — 보여 주는 값이다(가르는 값은 번호다. 동명이인이면 남의 신청이 열린다)", () => {
    assert.equal(toApiRequestStatus("AS-1", source({ requesterSub: "s-1", requestedByName: "홍길동" })).requester.name, "홍길동");
    assert.equal(toApiRequestStatus(null, source({ requesterSub: null, requestedByName: "홍길동" })).requester.name, "홍길동");
  });

  it("🔴 상태는 코드와 **사람이 읽을 글자**를 함께 — 글자는 화면이 쓰는 표에서 온다", () => {
    assert.deepEqual(toApiRequestStatus("AS-1", source()).status, { code: "PENDING", label: REQUEST_STATUS_LABEL.PENDING });
    assert.deepEqual(toApiRequestStatus("AS-1", source({ status: "REJECTED" })).status, { code: "REJECTED", label: REQUEST_STATUS_LABEL.REJECTED });
  });

  it("🔴 줄마다 **요청 수량과 이미 나간 수량** (남은 수량은 뺄셈이라 칸을 두지 않는다)", () => {
    const q = toApiRequestStatus("AS-1", source({ status: "PARTIAL", lines: [{ ...LINE, quantity: 8, issued: 5 }] }));
    assert.deepEqual(q.lines, [
      {
        no: 165,
        name: "AMP-DEH-DV2H(13M)",
        customerName: "증폭기 조립품",
        name2: "13M",
        kyosanPartNo: "KY-7788",
        drawingNo: "DWG-1001",
        owner: { code: "KYOSAN", label: OWNER_LABEL.KYOSAN },
        quantity: 8,
        issued: 5,
        chargeType: { code: "PAID", label: CHARGE_LABEL.PAID },
        // 🔵 2026-10-22 에 한 칸 더 — 본보기 줄(`LINE`)이 참이라 그대로 실려 나온다.
        fromOhTemplate: true,
      },
    ]);
  });

  it("그 사이 지워진 부품은 번호가 null 이다 — 지어내지 않는다", () => {
    const q = toApiRequestStatus(
      "AS-1",
      source({ lines: [{ ...GONE_LINE, quantity: 1, issued: 0 }] }),
    );
    assert.equal(q.lines[0].no, null);
    assert.equal(q.lines[0].name, "(지워진 부품)");
  });
});

/**
 * ============================================================================
 * 🔴 줄에 **어느 부품인지**가 실린다 (2026-10-21, 쓰는 분 요청)
 * ============================================================================
 * A/S 의 반출 신청 줄에는 `No. 165 AMP-… — 요청 2 / 불출 0` 만 떠서, 같은 품명이 여럿인 묶음
 * (REQUIREMENTS 4-1절 — 실제로 16개 있다)에서는 **어느 것인지 가릴 수 없었다.**
 *
 * 🔵 **조회는 전부터 싣고 있었다** — `RequestLineView` 가 2026-10-16 부터 자세한 내용 넷을,
 *    2026-10-21 에 유상/무상을 들고 다녔고 재고 관리 화면이 그것을 그리고 있었다. 끊겨 있던
 *    자리는 **이 통로가 칸을 손으로 옮겨 적는 `toApiRequestStatus`** 하나였다.
 * 🔴 **부품의 것과 줄의 것을 갈라 둔다** — 소유구분은 부품을 따라가고 유상/무상은 그 줄의 값이다
 *    (`ApiRequestStatusLineValues` 머리말). 아래 두 묶음이 그 가름을 재는 자리다.
 * ============================================================================
 */
/** 그 사이 지워진 부품의 줄. 🔴 되짚을 부품이 없어 글자 넷이 **빈 글자**이고 소유는 `null` 이다. */
const GONE_LINE: SourceLine = {
  partNo: null,
  partName: "(지워진 부품)",
  quantity: 1,
  issued: 0,
  customerName: "",
  name2: "",
  kyosanPartNo: "",
  drawingNo: "",
  owner: null,
  chargeType: "FREE",
  // 🔵 지워진 부품이어도 **그 줄의 값**은 그대로다 — O/H 표시는 부품이 아니라 줄에 적힌다.
  fromOhTemplate: false,
};

describe("🔴 줄에 어느 부품인지가 실린다 — 부품 쪽 값 (2026-10-21)", () => {
  const lineOf = (over: Partial<SourceLine> = {}) => toApiRequestStatus("AS-1", source({ lines: [{ ...LINE, ...over }] })).lines[0];

  it("🔴 자세한 내용 넷이 그대로 간다 — 고객사 품명 · 품명2 · 교산 품번 · 도번", () => {
    const l = lineOf();
    assert.equal(l.customerName, "증폭기 조립품");
    assert.equal(l.name2, "13M");
    assert.equal(l.kyosanPartNo, "KY-7788");
    assert.equal(l.drawingNo, "DWG-1001");
  });

  it("🔴 `-` 만 적힌 칸을 여기서 다듬지 않는다 — 값으로 셀지는 보는 쪽이 정한다", () => {
    // 자료가 엑셀에서 넘어와 빈칸 대신 `-` 가 적힌 줄이 많다. 미리 다듬으면 두 시스템이 같은 칸을
    // 다르게 읽게 된다(A/S 의 `partFieldValue` ↔ 재고 쪽 `DASH_ONLY`).
    assert.equal(lineOf({ kyosanPartNo: "-" }).kyosanPartNo, "-");
  });

  it("🔴 소유구분은 코드와 글자를 함께 — 글자는 `OWNER_LABEL` 한 표에서 온다", () => {
    assert.deepEqual(lineOf().owner, { code: "KYOSAN", label: OWNER_LABEL.KYOSAN });
    assert.deepEqual(lineOf({ owner: "SERVICE_SPARE" }).owner, { code: "SERVICE_SPARE", label: OWNER_LABEL.SERVICE_SPARE });
  });

  it("🔴 부품을 못 찾으면 소유는 `null` 이고 글자 넷은 빈 글자다 — 기본값을 지어내지 않는다", () => {
    const l = toApiRequestStatus("AS-1", source({ lines: [GONE_LINE] })).lines[0];
    assert.equal(l.owner, null);
    assert.deepEqual([l.customerName, l.name2, l.kyosanPartNo, l.drawingNo], ["", "", "", ""]);
  });
});

describe("🔴 유상/무상은 **그 줄의 값**이다 — 부품의 속성이 아니다 (2026-10-21)", () => {
  const chargeOf = (chargeType: SourceLine["chargeType"]) =>
    toApiRequestStatus("AS-1", source({ lines: [{ ...LINE, chargeType }] })).lines[0].chargeType;

  it("코드와 글자를 함께 — 글자는 `CHARGE_LABEL` 한 표에서 온다", () => {
    assert.deepEqual(chargeOf("PAID"), { code: "PAID", label: CHARGE_LABEL.PAID });
    assert.deepEqual(chargeOf("FREE"), { code: "FREE", label: CHARGE_LABEL.FREE });
  });

  it("🔴 없으면 `null` 이다 — 대여·폐기 줄에는 처음부터 없는 칸이라 **없는 것이지 못 찾은 것이 아니다**", () => {
    assert.equal(chargeOf(null), null);
  });

  it("🔴 **같은 신청 안에서도 줄마다 다를 수 있다** — 부품에 매달린 값이면 이 시험이 설 수 없다", () => {
    const q = toApiRequestStatus(
      "AS-1",
      source({
        lines: [
          { ...LINE, chargeType: "PAID" },
          // 🔴 **같은 부품 번호**인데 다른 줄이다. 부품의 속성으로 다루면 둘이 같은 값이 된다.
          { ...LINE, chargeType: "FREE" },
        ],
      }),
    );
    assert.deepEqual(
      q.lines.map((l) => l.chargeType?.code),
      ["PAID", "FREE"],
    );
    // 🔵 소유는 부품의 것이라 같은 부품이면 같다 — 그 가름이 실제로 서 있는지 함께 본다.
    assert.deepEqual(
      q.lines.map((l) => l.owner?.code),
      ["KYOSAN", "KYOSAN"],
    );
  });

  it("🔴 부품을 못 찾아도 유상/무상은 남는다 — 부품 표가 아니라 신청 줄에서 오는 값이다", () => {
    assert.deepEqual(toApiRequestStatus("AS-1", source({ lines: [GONE_LINE] })).lines[0].chargeType, {
      code: "FREE",
      label: CHARGE_LABEL.FREE,
    });
  });
});

describe("돌려주는 모양 — 결정과 보류 (2026-10-15)", () => {

  it("결정 전에는 decision 이 null 이다 (일부 나간 신청도 아직 결정이 아니다)", () => {
    assert.equal(toApiRequestStatus("AS-1", source()).decision, null);
    assert.equal(toApiRequestStatus("AS-1", source({ status: "PARTIAL", lines: [{ ...LINE, quantity: 8, issued: 5 }] })).decision, null);
  });

  it("결정한 사람·시각·사유가 실린다 (반려 사유가 여기 온다)", () => {
    const q = toApiRequestStatus("AS-1", source({ status: "REJECTED", decidedByName: "정영빈", decidedAt: "2026-10-15T04:00:00.000Z", decisionNote: "재고가 없습니다" }));
    assert.deepEqual(q.decision, { byName: "정영빈", at: "2026-10-15T04:00:00.000Z", note: "재고가 없습니다" });
  });

  it("🔴 보류 중이면 **사유까지** 내준다 — 「기다리라」는 말은 왜인지가 전부다", () => {
    const q = toApiRequestStatus("AS-1", source({ status: "ON_HOLD", hold: { reason: "다음 주 입고 뒤에", heldByName: "정영빈", heldAt: "2026-10-15T03:00:00.000Z" } }));
    assert.deepEqual(q.hold, { reason: "다음 주 입고 뒤에", byName: "정영빈", at: "2026-10-15T03:00:00.000Z" });
    assert.equal(q.status.label, REQUEST_STATUS_LABEL.ON_HOLD);
  });

  it("보류가 아니면 hold 는 null 이다", () => {
    assert.equal(toApiRequestStatus("AS-1", source()).hold, null);
  });
});

/**
 * ============================================================================
 * 🔴 **요청 비고를 A/S 가 되읽는다** (2026-10-22)
 * ============================================================================
 * 값은 2026-10-22 부터 신청에 저장되고 있었는데(`stock_requests.payload` 의 `note`), 이 통로가
 * `decision.note`(반려 사유)와 `hold.reason`(보류 사유)만 내주어 **A/S 는 제가 적어 보낸 말을
 * 되읽을 수 없었다.** 쓰는 분 요청으로 최상위에 칸 하나를 더한 자리다.
 *
 * 🔴 여기서 못 박는 것 넷:
 *  1. **최상위다** — `decision` 안이 아니다. 결정 전에도 적힌 말은 있다.
 *  2. **없으면 `null` 이 아니라 빈 글자다** — 「일어났나」가 아니라 「적힌 말」이라서다. `null` 이
 *     섞이면 받는 쪽이 검사를 두 벌 하게 되고, 한쪽을 빠뜨린 날 화면에 「null」이 그려진다.
 *  3. **글자가 아닌 payload 에서도 안 터진다** — jsonb 라 옛 신청에는 칸이 아예 없고, 손으로 고친
 *     행에는 숫자·객체가 들어 있을 수 있다. 그대로 실으면 「[object Object]」가 신청자의 말인 척한다.
 *  4. **읽는 규칙이 `readRequestNote` 한 벌이다** — 화면(승인 요청건)과 이 통로가 같은 함수를 쓴다.
 * ============================================================================
 */
describe("🔴 요청 비고 — 최상위 `note` 로 내준다 (2026-10-22)", () => {
  it("🔴 **최상위**에 실린다 — `decision` 안이 아니다(결정 전에도 적힌 말은 있다)", () => {
    const q = toApiRequestStatus("AS-1", source({ note: "접촉 불량이라 2개만 먼저" }));
    assert.equal(q.note, "접촉 불량이라 2개만 먼저");
    assert.equal(q.decision, null, "아직 결정 전인데 결정 칸이 섰다");
  });

  it("🔴 안 적었으면 **빈 글자**다 — `null`·`undefined` 가 아니다", () => {
    const q = toApiRequestStatus("AS-1", source({ note: "" }));
    assert.equal(q.note, "");
    assert.notEqual(q.note, null, "null 을 내보내면 받는 쪽이 검사를 두 벌 해야 한다");
    assert.equal(typeof q.note, "string");
  });

  it("🔴 앞뒤 공백만 있는 글은 **빈 글자로 떨어진다** — 따옴표만 남은 상자를 그리지 않게", () => {
    assert.equal(toApiRequestStatus("AS-1", source({ note: "   \n  " })).note, "");
    assert.equal(toApiRequestStatus("AS-1", source({ note: "  교체 바랍니다  " })).note, "교체 바랍니다");
  });

  /**
   * 🔴 **타입이 `string` 이라고 런타임에도 글자인 것은 아니다.** 저 값은 jsonb 를 통째로 형변환해 만든
   * 것이라(`lib/stock/requests.ts` 의 `toRow`), 옛 신청에는 칸이 아예 없고 손으로 고친 행에는 아무거나
   * 들어 있을 수 있다. 🔵 그래서 **타입을 뚫고** 넣어 본다 — 운영에서 실제로 올 수 있는 값들이다.
   */
  it("🔴 글자가 아닌 값이 들어 있어도 **안 터지고 빈 글자**다 (숫자·객체·null·배열·없음)", () => {
    for (const bad of [42, { 뭔가: "객체" }, null, ["배열"], undefined]) {
      const q = toApiRequestStatus("AS-1", source({ note: bad as unknown as string }));
      assert.equal(q.note, "", `${JSON.stringify(bad) ?? "undefined"} 가 빈 글자로 안 떨어졌다`);
    }
  });

  it("🔵 **묻는 법 둘이 같은 값을 준다** — 열쇠로 묻든 인수번호로 묻든 신청 하나는 한 모양이다", () => {
    const row = source({ note: "같은 말이 와야 한다" });
    const byKey = buildStatusResponse(["AS-1"], new Map([["AS-1", row]]), "2026-10-22T10:00:00.000Z");
    const byIntake = buildIntakeStatusResponse([{ requestKey: "AS-1", request: row }], "2026-10-22T10:00:00.000Z");
    assert.equal(byKey.requests[0].note, "같은 말이 와야 한다");
    assert.deepEqual(byIntake.requests[0], byKey.requests[0]);
  });

  it("🔴 반려 사유(`decision.note`)와 **다른 칸**이다 — 섞이면 누구의 말인지 알 수 없다", () => {
    const q = toApiRequestStatus(
      "AS-1",
      source({ note: "신청한 사람이 적은 말", status: "REJECTED", decidedByName: "정영빈", decidedAt: "2026-10-22T04:00:00.000Z", decisionNote: "담당자가 반려한 까닭" }),
    );
    assert.equal(q.note, "신청한 사람이 적은 말");
    assert.equal(q.decision?.note, "담당자가 반려한 까닭");
    assert.notEqual(q.note, q.decision?.note);
  });
});

/**
 * 🔴 **마감은 상태값이 아니라 세어서 가린다** (2026-10-14 재고 쪽 결정).
 *    규칙이 적힌 자리는 `lib/stock/codes.ts` 의 `isClosedRequest` 하나뿐이고, 이 통로도 그것을 그대로 부른다.
 */
describe("🔴 마감 — 상태가 아니라 세어서 가린다 (2026-10-15)", () => {
  const confirmed = (lines: { quantity: number; issued: number }[]) =>
    toApiRequestStatus("AS-1", source({ status: "CONFIRMED", lines: lines.map((l) => ({ ...LINE, ...l })), decidedByName: "정영빈", decidedAt: "2026-10-15T04:00:00.000Z" }));

  it("일부만 나간 채 닫힌 신청은 마감이다 — code 는 CONFIRMED 인데 label 은 「마감」", () => {
    const q = confirmed([{ quantity: 8, issued: 5 }]);
    assert.equal(q.closed, true);
    assert.equal(q.status.code, "CONFIRMED");
    assert.equal(q.status.label, CLOSED_REQUEST_LABEL);
  });

  it("다 나간 신청은 마감이 아니다 — 「확인됨」", () => {
    const q = confirmed([{ quantity: 8, issued: 8 }]);
    assert.equal(q.closed, false);
    assert.equal(q.status.label, REQUEST_STATUS_LABEL.CONFIRMED);
  });

  it("🔴 하나도 안 나간 채 확인된 옛 신청(회차 표가 생기기 전)은 마감이 아니다", () => {
    assert.equal(confirmed([{ quantity: 8, issued: 0 }]).closed, false);
  });

  it("아직 안 끝난 신청은 어느 것도 마감이 아니다", () => {
    for (const status of ["PENDING", "CONFIRMING", "PARTIAL", "ON_HOLD", "REJECTED", "CANCELLED", "IN_APPROVAL"] as const) {
      const q = toApiRequestStatus("AS-1", source({ status, lines: [{ ...LINE, quantity: 8, issued: 5 }] }));
      assert.equal(q.closed, false, status);
      assert.equal(q.status.label, REQUEST_STATUS_LABEL[status], status);
    }
  });
});

/**
 * 🔴 **「실행 대기」도 상태값이 아니다** (2026-10-21, 조각 11f).
 *
 * 같은 건이 재고 관리 화면에서는 「실행 대기」인데 A/S 수리 건 상세에서는 「결재 중」으로 보이면, 두 사람이
 * 전화로 맞춰 볼 때 서로 다른 것을 말하게 된다. 그래서 이 통로도 **같은 함수**(`requestStatusLabel`)로
 * 글자를 고른다 — 🔴 **다만 `code` 는 손대지 않는다**: A/S 가 그 값으로 [요청 취소] 단추를 가린다.
 */
describe("🔴 실행 대기 — 글자만 바뀌고 code 는 그대로 (2026-10-21, 조각 11f)", () => {
  it("결재가 끝나 실행만 남으면 label 이 「실행 대기」다", () => {
    const q = toApiRequestStatus("AS-1", source({ status: "IN_APPROVAL", issueLock: "AWAITING_EXECUTION" }));
    assert.equal(q.status.label, AWAITING_EXECUTION_REQUEST_LABEL);
    assert.notEqual(q.status.label, REQUEST_STATUS_LABEL.IN_APPROVAL);
  });

  it("🔴 **`code` 는 한 글자도 바뀌지 않는다** — A/S 가 이 값으로 [요청 취소] 단추를 가린다", () => {
    for (const status of ["IN_APPROVAL", "PENDING", "PARTIAL"] as const) {
      const q = toApiRequestStatus("AS-1", source({ status, issueLock: "AWAITING_EXECUTION" }));
      assert.equal(q.status.code, status, status);
    }
    // 🔴 저쪽이 단추를 여는 조건 그대로 — 글자가 바뀌어도 그 판정은 흔들리지 않는다.
    assert.equal(toApiRequestStatus("AS-1", source({ status: "PENDING", issueLock: "AWAITING_EXECUTION" })).status.code, "PENDING");
  });

  it("🔵 결재가 **도는 중**이면 지금까지와 같은 「결재 중」이다 — 바뀌는 것은 실행 대기 하나뿐", () => {
    const q = toApiRequestStatus("AS-1", source({ status: "IN_APPROVAL", issueLock: "AWAITING_APPROVAL" }));
    assert.equal(q.status.label, REQUEST_STATUS_LABEL.IN_APPROVAL);
    assert.equal(q.status.code, "IN_APPROVAL");
  });

  it("🔴 결재가 **없는** 신청은 글자가 2026-10-21 이전과 한 글자도 다르지 않다", () => {
    for (const status of ["PENDING", "CONFIRMING", "PARTIAL", "ON_HOLD", "REJECTED", "CANCELLED", "IN_APPROVAL", "CONFIRMED"] as const) {
      const q = toApiRequestStatus("AS-1", source({ status, issueLock: null }));
      assert.equal(q.status.label, REQUEST_STATUS_LABEL[status], status);
    }
  });

  it("🔴 마감이 「실행 대기」를 이긴다 — 재고 관리 화면과 같은 차례다", () => {
    const q = toApiRequestStatus(
      "AS-1",
      source({ status: "CONFIRMED", issueLock: "AWAITING_EXECUTION", lines: [{ ...LINE, quantity: 8, issued: 5 }], decidedByName: "정영빈", decidedAt: "2026-10-21T04:00:00.000Z" }),
    );
    assert.equal(q.closed, true);
    assert.equal(q.status.label, CLOSED_REQUEST_LABEL);
  });

  it("🔴 돌려주는 칸이 늘지 않는다 — 잠금은 글자를 고르는 데만 쓰고 밖으로 내보내지 않는다", () => {
    const withLock = toApiRequestStatus("AS-1", source({ issueLock: "AWAITING_EXECUTION" }));
    const without = toApiRequestStatus("AS-1", source({ issueLock: null }));
    assert.deepEqual(Object.keys(withLock).sort(), Object.keys(without).sort());
  });

  it("🔵 두 묻는 법이 같은 줄을 지난다 — 열쇠로 묻든 인수번호로 묻든 같은 글자다", () => {
    const row = source({ status: "IN_APPROVAL", issueLock: "AWAITING_EXECUTION" });
    const byKey = buildStatusResponse(["AS-1"], new Map([["AS-1", row]]), "2026-10-21T10:00:00.000Z");
    const byIntake = buildIntakeStatusResponse([{ requestKey: "AS-1", request: row }], "2026-10-21T10:00:00.000Z");
    assert.equal(byKey.requests[0]?.status.label, AWAITING_EXECUTION_REQUEST_LABEL);
    assert.deepEqual(byKey.requests[0], byIntake.requests[0]);
  });
});

/* ------------------------------------------------------------------ */
/* 묻는 법 둘째 — **인수번호로** (2026-10-15)                            */
/* 🔴 A/S 는 제 요청 번호를 저장하지 않는다. 열쇠로만 물 수 있으면       */
/*    되읽는 통로가 사실상 닫혀 있는 것과 같다.                          */
/* ------------------------------------------------------------------ */

const intakes = (qs: string): string[] => {
  const r = parseStatusIntakes(new URLSearchParams(qs));
  assert.ok(r.ok, `받을 줄 알았는데 거절했다: ${r.ok ? "" : r.message}`);
  return r.intakeNumbers;
};

const intakeRejection = (qs: string): string => {
  const r = parseStatusIntakes(new URLSearchParams(qs));
  assert.equal(r.ok, false, "거절할 조건인데 통과했다");
  return r.ok ? "" : r.message;
};

const queryOf = (qs: string) => {
  const r = parseStatusQuery(new URLSearchParams(qs));
  assert.ok(r.ok, `받을 줄 알았는데 거절했다: ${r.ok ? "" : r.message}`);
  return r.query;
};

const queryRejection = (qs: string): string => {
  const r = parseStatusQuery(new URLSearchParams(qs));
  assert.equal(r.ok, false, "거절할 조건인데 통과했다");
  return r.ok ? "" : r.message;
};

describe("묻는 법 — 인수번호로도 묻는다 (2026-10-15)", () => {
  it("쿼리 이름은 intake 다 — 주소에 적히는 글자라 바꾸면 약속이 깨진다", () => {
    assert.equal(INTAKE_PARAM, "intake");
  });

  it("여러 개를 한 번에 묻는다", () => {
    assert.deepEqual(intakes("intake=D260701&intake=D260702"), ["D260701", "D260702"]);
  });

  it("🔵 소문자로 보내도 찾는다 — 저장된 값이 언제나 대문자다(올리는 통로·화면 폼이 올려 둔다)", () => {
    assert.deepEqual(intakes("intake=d260701"), ["D260701"]);
  });

  it("앞뒤 공백은 떼고, 빈 값은 없는 것으로 본다", () => {
    assert.deepEqual(intakes("intake=++D260701++&intake=&intake=D260702"), ["D260701", "D260702"]);
  });

  it("같은 번호가 두 번 오면 한 번만 묻는다", () => {
    assert.deepEqual(intakes("intake=D260701&intake=d260701"), ["D260701"]);
  });

  it("🔴 모양이 틀리면 거절한다 — 조용히 「못 찾음」으로 돌리면 오타인지 없는 건인지 못 가린다", () => {
    for (const bad of ["D26070", "D2607011", "X260701", "D26070A", "260701", "홍길동", "D-260701"]) {
      const m = intakeRejection(`intake=${encodeURIComponent(bad)}`);
      assert.match(m, /인수번호/, bad);
      assert.ok(m.includes(bad), `무엇을 받았는지 문구에 적어야 고칠 수 있다: ${bad}`);
    }
  });

  /**
   * 🔴 모양을 **여기서 새로 적지 않았다** — `lib/stock/codes.ts` 의 `INTAKE_NUMBER_RE` 를 그대로 쓴다.
   *    그것을 글자로 베껴 두면 화면·올리는 통로·엑셀 가져오기가 보는 모양과 언젠가 갈린다.
   *    🔵 그래서 이 시험은 **그 정규식과 받고 거절하는 것이 한 글자도 어긋나지 않는지**를 잰다.
   */
  it("🔴 받고 거절하는 경계가 `INTAKE_NUMBER_RE` 와 똑같다", () => {
    for (const sample of ["D260701", "d260701", "D000000", "D26070", "D2607012", "E260701", "D26070 1", "", "  "]) {
      const value = sample.trim().toUpperCase();
      const r = parseStatusIntakes(new URLSearchParams([["intake", sample]]));
      // 빈 값은 「안 보낸 것」이라 모양 거절이 아니라 「하나 이상 보내라」로 떨어진다.
      if (value === "") {
        assert.equal(r.ok, false, sample);
        continue;
      }
      assert.equal(r.ok, INTAKE_NUMBER_RE.test(value), `정규식과 어긋난다: ${JSON.stringify(sample)}`);
    }
  });

  it("🔴 인수번호가 하나도 없으면 전체를 주지 않고 거절한다", () => {
    assert.match(intakeRejection(""), /인수번호/);
    assert.match(intakeRejection("intake=&intake=++"), /intake=D260701/);
  });
});

describe("🔴 인수번호 상한 — 열쇠와 다른 눈금을 쓴다 (2026-10-15)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `intake=D2607${String(i + 1).padStart(2, "0")}`).join("&");

  it("상한은 10 — 열쇠(50)보다 적다. 열쇠 하나는 신청 하나지만 인수번호 하나는 신청 여러 건이다", () => {
    assert.equal(MAX_STATUS_INTAKES, 10);
    assert.ok(MAX_STATUS_INTAKES < MAX_STATUS_KEYS, "인수번호 상한이 열쇠 상한보다 작아야 한다");
  });

  it("딱 상한까지는 받는다", () => {
    assert.equal(intakes(many(MAX_STATUS_INTAKES)).length, MAX_STATUS_INTAKES);
  });

  it("🔴 넘으면 거절한다 — 몇 개까지인지와 몇 개를 받았는지를 적는다", () => {
    const m = intakeRejection(many(MAX_STATUS_INTAKES + 1));
    assert.match(m, new RegExp(`${MAX_STATUS_INTAKES}개까지`));
    assert.match(m, new RegExp(`${MAX_STATUS_INTAKES + 1}개`));
  });

  it("중복을 걷어낸 뒤의 수로 센다 — 실제로 읽는 양이 그것이다", () => {
    const repeated = Array.from({ length: MAX_STATUS_INTAKES + 20 }, () => "intake=D260701").join("&");
    assert.deepEqual(intakes(repeated), ["D260701"]);
  });
});

describe("🔴 묻는 법 가리기 — 섞어 보내면 거절한다 (2026-10-15)", () => {
  it("열쇠만 보내면 열쇠 길이다", () => {
    assert.deepEqual(queryOf("key=AS-1&key=AS-2"), { mode: "key", keys: ["AS-1", "AS-2"] });
  });

  it("인수번호만 보내면 인수번호 길이다", () => {
    assert.deepEqual(queryOf("intake=D260701"), { mode: "intake", intakeNumbers: ["D260701"] });
  });

  it("🔴 둘을 함께 보내면 400 — 돌려줄 차례의 뜻이 섞이고 같은 신청이 두 번 실린다", () => {
    const m = queryRejection("key=AS-1&intake=D260701");
    assert.match(m, /함께 보낼 수 없습니다/);
    assert.match(m, /key/);
    assert.match(m, /intake/);
  });

  it("🔵 섞였는지는 **다듬기 전에** 본다 — 인수번호가 틀린 모양이어도 「섞어 보냈다」를 말해 준다", () => {
    assert.match(queryRejection("key=AS-1&intake=XXX"), /함께 보낼 수 없습니다/);
  });

  it("🔴 둘 다 없으면 400 — 조용히 전부를 주지 않고, 두 가지 묻는 법을 문구에 적는다", () => {
    const m = queryRejection("");
    assert.match(m, /key=AS-REQ/);
    assert.match(m, /intake=D260701/);
  });

  it("빈 값만 보낸 쪽은 **안 보낸 것**으로 본다 — 섞었다고 거절하지 않는다", () => {
    assert.deepEqual(queryOf("key=AS-1&intake="), { mode: "key", keys: ["AS-1"] });
    assert.deepEqual(queryOf("intake=D260701&key=++"), { mode: "intake", intakeNumbers: ["D260701"] });
  });

  it("한 가지 길로만 보냈어도 그 길의 울타리는 그대로 선다 (상한·모양)", () => {
    assert.match(queryRejection(Array.from({ length: MAX_STATUS_KEYS + 1 }, (_, i) => `key=AS-${i}`).join("&")), new RegExp(`${MAX_STATUS_KEYS}개까지`));
    assert.match(queryRejection("intake=D26070"), /인수번호/);
  });
});

describe("🔴 인수번호로 물었을 때 돌려주는 것 (2026-10-15)", () => {
  const row = (over: Partial<RequestStatusSource>, requestKey: string | null = "AS-1"): IntakeStatusRow => ({ requestKey, request: source(over) });

  const older = row({ id: "0c0f1111-1111-4111-8111-111111111111", requestedAt: "2026-10-13T01:00:00.000Z" }, "AS-1");
  const newer = row({ id: "0c0f2222-2222-4222-8222-222222222222", requestedAt: "2026-10-15T09:00:00.000Z" }, "AS-2");
  const middle = row({ id: "0c0f3333-3333-4333-8333-333333333333", requestedAt: "2026-10-14T05:00:00.000Z" }, null);

  it("🔴 신청한 시각이 **늦은 것이 위**다 — 그 수리 건의 최근 요청부터 보는 화면이다", () => {
    const r = buildIntakeStatusResponse([older, newer, middle], "2026-10-15T10:00:00.000Z");
    assert.deepEqual(
      r.requests.map((q) => q.requestedAt),
      ["2026-10-15T09:00:00.000Z", "2026-10-14T05:00:00.000Z", "2026-10-13T01:00:00.000Z"],
    );
  });

  it("🔵 시각이 같으면 신청 번호로 갈라 **늘 같은 차례**다 — 안 그러면 새로고침마다 줄이 바뀐다", () => {
    const a = row({ id: "0c0faaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", requestedAt: "2026-10-15T09:00:00.000Z" });
    const b = row({ id: "0c0fbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", requestedAt: "2026-10-15T09:00:00.000Z" });
    for (const given of [[a, b], [b, a]]) {
      assert.deepEqual(
        buildIntakeStatusResponse(given, "2026-10-15T10:00:00.000Z").requests.map((q) => q.id),
        ["0c0fbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "0c0faaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      );
    }
  });

  it("준 목록을 **제자리에서 뒤집지 않는다** — 부르는 쪽 배열을 건드리면 안 된다", () => {
    const given = [older, newer];
    buildIntakeStatusResponse(given, "2026-10-15T10:00:00.000Z");
    assert.deepEqual(
      given.map((g) => g.request.id),
      [older.request.id, newer.request.id],
    );
  });

  it("🔴 **열쇠 없이 올라온 신청도 함께** 온다 — 그 건에 나간 부품을 반만 보여 주면 안 된다", () => {
    const r = buildIntakeStatusResponse([older, middle], "2026-10-15T10:00:00.000Z");
    assert.equal(r.count, 2);
    const noKey = r.requests.find((q) => q.id === "0c0f3333-3333-4333-8333-333333333333");
    assert.ok(noKey, "재고 관리에서 직접 올린 신청이 빠졌다");
    assert.equal(noKey.requestKey, null, "없는 열쇠를 지어내지 않는다");
    assert.equal(r.requests.filter((q) => q.requestKey === "AS-1").length, 1, "열쇠가 있는 신청은 그대로 달고 온다");
  });

  it("🔴 `notFound` 는 **언제나 빈 목록**이다 — 그 칸은 열쇠로 물었을 때만 뜻이 있다", () => {
    assert.deepEqual(buildIntakeStatusResponse([], "2026-10-15T10:00:00.000Z").notFound, []);
    assert.deepEqual(buildIntakeStatusResponse([older], "2026-10-15T10:00:00.000Z").notFound, []);
  });

  it("아무 신청도 없는 인수번호는 오류가 아니다 — 빈 목록과 count 0", () => {
    const r = buildIntakeStatusResponse([], "2026-10-15T10:00:00.000Z");
    assert.deepEqual(r.requests, []);
    assert.equal(r.count, 0);
    assert.equal(r.generatedAt, "2026-10-15T10:00:00.000Z");
  });

  it("🔴 **열쇠로 물었을 때와 같은 모양**이다 — 받는 쪽이 두 벌을 다루지 않게", () => {
    const byIntake = buildIntakeStatusResponse([older], "2026-10-15T10:00:00.000Z");
    const byKey = buildStatusResponse(["AS-1"], new Map([["AS-1", source()]]), "2026-10-15T10:00:00.000Z");
    assert.deepEqual(Object.keys(byIntake).sort(), Object.keys(byKey).sort());
    assert.deepEqual(Object.keys(byIntake.requests[0]).sort(), Object.keys(byKey.requests[0]).sort());
  });

  it("🔴 **포털 번호도 여기서 똑같이 실린다** — 한쪽만 실으면 묻는 법에 따라 취소 단추가 그려졌다 말았다 한다", () => {
    const fromAs = row({ id: "0c0f5555-5555-4555-8555-555555555555", requesterSub: "portal-sub-aaaa-1111", requestedByName: "예시 신청자" }, "AS-9");
    const fromInventory = row({ id: "0c0f6666-6666-4666-8666-666666666666", requesterSub: null, requestedByName: "정영빈" }, null);
    const r = buildIntakeStatusResponse([fromAs, fromInventory], "2026-10-15T10:00:00.000Z");
    const byId = new Map(r.requests.map((q) => [q.id, q.requester]));
    assert.deepEqual(byId.get("0c0f5555-5555-4555-8555-555555555555"), { sub: "portal-sub-aaaa-1111", name: "예시 신청자" });
    assert.deepEqual(byId.get("0c0f6666-6666-4666-8666-666666666666"), { sub: null, name: "정영빈" }, "재고 관리에서 올린 신청은 번호가 null 이다 — 열쇠가 null 인 것과 짝이다");
  });

  it("🔵 어느 수리 건의 것인지 줄마다 적혀 온다 — 인수번호를 여러 개 물을 수 있기 때문이다", () => {
    const r = buildIntakeStatusResponse([row({ intakeNumber: "D260701" }), row({ id: "0c0f4444-4444-4444-8444-444444444444", intakeNumber: "D260702" })], "2026-10-15T10:00:00.000Z");
    assert.deepEqual(new Set(r.requests.map((q) => q.intakeNumber)), new Set(["D260701", "D260702"]));
  });
});

/**
 * 🔴 **읽기 토큰으로 연다.** 부품 목록과 같은 문이다 — 이 통로는 재고를 **한 개도 움직이지 않는다.**
 *    거꾸로 쓰기 토큰은 신청을 **만드는** 자리에만 쓴다. 두 값이 다르므로 서로의 문을 열지 못한다.
 */
describe("🔴 읽기 토큰 전용 — 쓰기 토큰으로는 못 읽고, 토큰이 없으면 닫힌다 (2026-10-15)", () => {
  const READ = "read-".padEnd(40, "r");
  const WRITE = "write-".padEnd(40, "w");

  const withEnv = (vars: Record<string, string | undefined>, run: () => void) => {
    const saved = { INVENTORY_API_TOKEN: process.env.INVENTORY_API_TOKEN, INVENTORY_WRITE_TOKEN: process.env.INVENTORY_WRITE_TOKEN };
    try {
      for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      run();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it("🔴 읽기 토큰이 설정에 없으면 열어 두지 않고 닫는다 (503)", () => {
    withEnv({ INVENTORY_API_TOKEN: undefined }, () => {
      const d = checkBearerToken(env.inventoryApiToken, `Bearer ${READ}`);
      assert.ok(d);
      assert.equal(d.status, 503);
      assert.equal(d.error, "api_closed");
    });
  });

  it("🔴 쓰기 토큰으로 이 통로를 두드리면 401 — 두 값이 다른 환경변수에서 온다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.notEqual(env.inventoryApiToken, env.inventoryWriteToken);
      const d = checkBearerToken(env.inventoryApiToken, `Bearer ${WRITE}`);
      assert.ok(d, "쓰기 토큰이 읽기 통로를 지나갔다");
      assert.equal(d.status, 401);
      assert.equal(d.error, "unauthorized");
    });
  });

  it("맞는 읽기 토큰은 지나간다 — 부품 목록과 같은 문이다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.equal(checkBearerToken(env.inventoryApiToken, `Bearer ${READ}`), null);
    });
  });

  it("머리말이 없거나 모양이 다르면 401", () => {
    for (const header of [null, "", "Basic abc", "Bearer ", `Token ${READ}`]) {
      const d = checkBearerToken(READ, header);
      assert.ok(d, `통과하면 안 되는 머리말: ${JSON.stringify(header)}`);
      assert.equal(d.status, 401);
    }
  });

  /**
   * 🔵 역검증에서 찾은 빈틈(2026-10-15): 위 두 토큰이 **둘 다 40자**라, 길이가 다를 때 가르는 가지
   * (`safeEqual` 의 길이 비교)를 어느 시험도 밟지 않았다. 그 줄을 「길이가 다르면 통과」로 뒤집어도
   * 시험이 전부 통과했다. 길이가 다른 틀린 토큰을 한 줄 넣어 그 가지를 덮는다.
   */
  it("🔴 길이가 다른 틀린 토큰도 401 — 길이로 가르는 가지까지 덮는다", () => {
    const d = checkBearerToken(READ, "Bearer 짧은토큰");
    assert.ok(d, "길이가 다른 토큰이 지나갔다");
    assert.equal(d.status, 401);
  });
});
