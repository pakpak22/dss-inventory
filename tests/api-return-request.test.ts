import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ENTRY_TYPES } from "../src/db/schema/stock";
import { isPartIssueApprovalRouteInForce } from "../src/lib/approval/part-issue-gate";
import { APPROVAL_EXEMPT_REQUEST_TYPES, WORKFLOW_KINDS, approvalRouteScopeForWorkflowKind, isApprovalExemptRequestType } from "../src/lib/approval/route";
import { allocateReturnLines } from "../src/lib/api/return-allocation";
import { pendingByTransaction, returnRequestLines, summarizeReturnCandidates, type ReturnableLine, type ReturnableLinePart } from "../src/lib/api/return-candidates";
import { API_REQUEST_TYPES, buildApiReturnRequest, parseApiStockRequest, type ApiReturnRequestInput } from "../src/lib/api/stock-requests";
import { CONFIRMATION_TYPES, ENTRY_TYPE_LABEL, needsConfirmation } from "../src/lib/stock/codes";
import { MAX_LINES, MAX_QTY } from "../src/lib/stock/form";

/**
 * A/S 가 올리는 **반환 신청** (2026-11-26, `POST /api/v1/stock-requests` 의 `type: "RETURN"`).
 *
 * 🔴 규칙을 전부 순수 함수에 모아 두고 여기서 덮는다 — 통로 파일도 읽는 질의도 `server-only` 를 거쳐
 *    들어가 `npm test` 가 **불러올 수 없다**(`tests/api-return-candidates.test.ts` 와 같은 사정).
 *    그래서 **DB 에서만 가려지는 울타리는 소스 글자로 잰다**(⑤·⑥·⑦). 🔵 재기 전에 **주석을 걷어낸다** —
 *    주석에 그 글자가 적혀 있으면 조건이 사라져도 시험이 통과한다(이 저장소에서 실제로 겪은 함정).
 *
 * 🔴 이 조각에서 가장 조용히 깨지는 것 둘, 그래서 ④와 ⑤가 있다:
 *   ④ **저장 모양이 앞 조각이 읽는 모양과 같아야 한다**(`payload.lines[].transactionId`). 어긋나면
 *      `pending` 이 **영영 0** 이고, 아무도 안 깨지는데 같은 부품을 두 번 신청해 넘기는 길이 열린다.
 *   ⑤ **반환은 결재를 안 탄다**(쓰는 분: 「반환에는 승인 절차가 필요 없어」). 갈래를 비워 두는 것만으로는
 *      안전하지 않다 — 비면 기존 「부품 불출」로 가고, 2026-11-26 개발 DB 실측으로 그 절차의 현재 판에는
 *      **단계가 3개 서 있다.** 이 시험이 없으면 이 결함은 **관리자가 결재를 켜는 날** 처음 드러난다.
 *
 * 🔴 실제 고객사명·사람 이름을 쓰지 않는다 — 공개 저장소에 박힌다.
 */

/* ------------------------------------------------------------------ */
/* 본보기                                                              */
/* ------------------------------------------------------------------ */

const PART_7: ReturnableLinePart = { no: 7, name: "예시 PCB-001", name2: "예시 보드", customerName: "예시 고객사 품명", kyosanPartNo: "C000000001", drawingNo: "WR00000AA001A", owner: "DSS" };
const PART_22: ReturnableLinePart = { no: 22, name: "예시 AMP-002", name2: "", customerName: "", kyosanPartNo: "", drawingNo: "", owner: "SERVICE_SPARE" };

const TX = (n: number): string => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const TX_A = TX(1);
const TX_B = TX(2);
const TX_C = TX(3);

function line(transactionId: string, part: ReturnableLinePart, taken: number, returned: number): ReturnableLine {
  return { transactionId, part, taken, returned };
}

const RETURN_BODY = {
  type: "RETURN",
  requestKey: "AS-RET-2026-0001",
  intakeNumber: "d260701",
  requester: { sub: "kakao:12345", name: "신청인" },
  lines: [{ no: 7, quantity: 2 }],
  note: "내일 가져다 드립니다",
};

const USE_BODY = {
  requestKey: "AS-REQ-2026-0007",
  intakeNumber: "D260701",
  requester: { sub: "kakao:12345", name: "신청인" },
  lines: [{ no: 165, quantity: 2, chargeType: "PAID" }],
};

const message = (raw: unknown): string => {
  const r = parseApiStockRequest(raw);
  assert.equal(r.ok, false, "거절할 본문인데 통과했다");
  return r.ok ? "" : r.message;
};

/** 반환으로 읽힌 값만 꺼낸다 — 🔴 종류가 뒤집히면 여기서 선다(좁히기가 곧 전제다). */
function returnValue(raw: unknown): ApiReturnRequestInput {
  const r = parseApiStockRequest(raw);
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.type, "RETURN", "반환으로 안 읽혔다");
  return r.value as ApiReturnRequestInput;
}

const src = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ================================================================== */
/* ① 종류 — 「사용」과 「반환」 둘뿐이다                                 */
/* ================================================================== */
describe("① 🔴 바깥이 고를 수 있는 종류는 둘뿐이다", () => {
  it("🔵 칸이 없으면 「사용」이다 — A/S 의 기존 호출이 한 글자도 안 바뀐다", () => {
    const r = parseApiStockRequest(USE_BODY);
    assert.ok(r.ok, "종류 칸이 없다고 거절했다 — 그날부터 부품 불출 신청이 통째로 막힌다");
    assert.equal(r.value.type, "USE");
  });

  it("🔵 `null` 도 「안 보냄」과 같이 본다", () => {
    const r = parseApiStockRequest({ ...USE_BODY, type: null });
    assert.ok(r.ok);
    assert.equal(r.value.type, "USE");
  });

  it("「USE」를 적어 보내도 같다", () => {
    const r = parseApiStockRequest({ ...USE_BODY, type: "USE" });
    assert.ok(r.ok);
    assert.equal(r.value.type, "USE");
  });

  it("🔴 **「RETURN」이 열렸다** — 인수번호·부품별 수량·비고를 그대로 받는다", () => {
    const value = returnValue(RETURN_BODY);
    assert.equal(value.intakeNumber, "D260701", "소문자로 와도 저장은 대문자");
    assert.deepEqual(value.lines, [{ no: 7, quantity: 2 }]);
    assert.equal(value.note, "내일 가져다 드립니다");
    assert.deepEqual(value.requester, { sub: "kakao:12345", name: "신청인" });
  });

  it("🔴 **그 밖의 종류는 전부 거절된다** — 원장이 아는 종류라도 마찬가지다", () => {
    const rejected = ENTRY_TYPES.filter((t) => !(API_REQUEST_TYPES as readonly string[]).includes(t));
    assert.ok(rejected.length > 0, "거절할 종류가 하나도 없다 — 표본이 비었다");
    for (const type of rejected) {
      const m = message({ ...USE_BODY, type });
      assert.match(m, /type 은/, `${type} 가 통과했다`);
    }
  });

  it("🔴 모르는 글자·대소문자·다른 타입도 거절한다 (조용히 「사용」으로 떨어뜨리지 않는다)", () => {
    for (const bad of ["return", "Return", "RETURN ", " USE", "", "  ", "반환", 0, 1, true, {}, [], ["RETURN"]]) {
      const m = message({ ...USE_BODY, type: bad });
      assert.match(m, /type 은/, `통과하면 안 되는 종류: ${JSON.stringify(bad)}`);
    }
  });

  it("거절 문구는 받을 수 있는 값을 **코드값 한 벌에서** 만들어 보여 준다", () => {
    const m = message({ ...USE_BODY, type: "LOAN" });
    for (const t of API_REQUEST_TYPES) {
      assert.ok(m.includes(t), `${t} 가 문구에 없다`);
      assert.ok(m.includes(ENTRY_TYPE_LABEL[t]), `${ENTRY_TYPE_LABEL[t]} 가 문구에 없다`);
    }
    assert.ok(m.includes("LOAN"), "받은 값을 안 적어 준다");
  });

  it("🔴 열린 둘은 원장이 아는 종류다 — 글자를 손으로 적다 틀리면 tsc 가 멈춘다", () => {
    assert.deepEqual([...API_REQUEST_TYPES], ["USE", "RETURN"]);
    for (const t of API_REQUEST_TYPES) assert.ok((ENTRY_TYPES as readonly string[]).includes(t), `${t} 가 원장에 없는 종류다`);
  });
});

/* ================================================================== */
/* ② 반환 줄 — 부품 번호와 수량뿐                                       */
/* ================================================================== */
describe("② 반환 줄은 부품 번호와 수량뿐이다", () => {
  it("🔴 유상·무상을 **요구하지 않는다** — 돈이 걸린 값은 나갈 때 정해졌다", () => {
    const value = returnValue(RETURN_BODY);
    assert.deepEqual(Object.keys(value.lines[0]).sort(), ["no", "quantity"]);
  });

  it("🔵 유상·무상을 **보내도 거절하지 않고 그냥 안 본다** (불출 줄 모양을 베껴 보낼 수 있다)", () => {
    const value = returnValue({ ...RETURN_BODY, lines: [{ no: 7, quantity: 2, chargeType: "PAID", fromOhTemplate: true }] });
    assert.deepEqual(value.lines, [{ no: 7, quantity: 2 }], "안 보는 칸이 신청에 섞여 들어갔다");
  });

  it("🔴 **사유(reason)는 거절한다** — 반환 기록에 그 칸이 없어 받아 두면 그대로 사라진다", () => {
    const m = message({ ...RETURN_BODY, reason: "오배송" });
    assert.match(m, /reason/);
    assert.match(m, /note/, "무엇으로 보내야 하는지 안 알려 준다");
    assert.match(m, /오배송/, "받은 값을 안 적어 준다");
  });

  it("🔵 빈 사유는 그냥 지나간다 — 「적을 말이 없다」라 잃을 것이 없다", () => {
    assert.ok(parseApiStockRequest({ ...RETURN_BODY, reason: "" }).ok);
    assert.ok(parseApiStockRequest({ ...RETURN_BODY, reason: "   " }).ok, "공백만 든 값도 빈 글자다");
  });

  it("🔵 **사용 신청의 사유는 그대로 받는다** — 이 울타리는 반환 하나에만 걸린다", () => {
    const r = parseApiStockRequest({ ...USE_BODY, reason: "증폭기 교체" });
    assert.ok(r.ok);
    assert.equal(r.value.reason, "증폭기 교체");
  });

  it("부품 번호·수량 검사는 **사용과 같다** — 공통 검사가 두 벌이 되지 않았다", () => {
    assert.match(message({ ...RETURN_BODY, lines: [] }), /비어 있습니다/);
    assert.match(message({ ...RETURN_BODY, lines: [{ no: 0, quantity: 1 }] }), /no 는/);
    assert.match(message({ ...RETURN_BODY, lines: [{ no: "7", quantity: 1 }] }), /no 는/);
    assert.match(message({ ...RETURN_BODY, lines: [{ no: 7, quantity: 0 }] }), /quantity/);
    assert.match(message({ ...RETURN_BODY, lines: [{ no: 7, quantity: 1.5 }] }), /quantity/);
    assert.match(message({ ...RETURN_BODY, lines: [{ no: 7, quantity: MAX_QTY + 1 }] }), /quantity/);
    assert.match(message({ ...RETURN_BODY, lines: [{ no: 7, quantity: 1 }, { no: 7, quantity: 2 }] }), /두 번 들어 있습니다/);
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => ({ no: i + 1, quantity: 1 }));
    assert.match(message({ ...RETURN_BODY, lines: many }), new RegExp(`${MAX_LINES}줄`));
  });

  it("인수번호·요청 번호·신청자는 사용과 같은 울타리다", () => {
    assert.match(message({ ...RETURN_BODY, intakeNumber: "260701" }), /intakeNumber/);
    assert.match(message({ ...RETURN_BODY, requestKey: "" }), /requestKey/);
    assert.match(message({ ...RETURN_BODY, requester: { name: "아무개" } }), /requester\.sub/);
  });
});

/* ================================================================== */
/* ③ 쪼개기 — 부품+수량 → 원장 줄                                       */
/* ================================================================== */
describe("③ 🔴 부품+수량을 원장 줄로 쪼갠다 — 먼저 나간 줄부터", () => {
  const none = new Map<string, number>();

  it("한 줄이면 그 줄에 담긴다 — 모양은 `ReturnLine`({ transactionId, quantity, note })", () => {
    const r = allocateReturnLines([{ no: 7, quantity: 2 }], [line(TX_A, PART_7, 5, 0)], none);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [{ transactionId: TX_A, quantity: 2, note: "" }]);
  });

  it("🔴 **먼저 나간 줄부터 채운다** — 첫 줄을 다 쓰고 다음 줄로 넘어간다", () => {
    // 🔵 읽어 온 차례가 곧 「먼저 나간 차례」다(`readReturnableTransactions` 가 거래 생성 순으로 준다).
    const r = allocateReturnLines([{ no: 7, quantity: 4 }], [line(TX_A, PART_7, 3, 0), line(TX_B, PART_7, 5, 0)], none);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [
      { transactionId: TX_A, quantity: 3, note: "" },
      { transactionId: TX_B, quantity: 1, note: "" },
    ]);
  });

  it("🔴 차례를 바꾸면 **담기는 줄도 바뀐다** — 차례에 기대는 규칙임을 못 박는다", () => {
    const r = allocateReturnLines([{ no: 7, quantity: 4 }], [line(TX_B, PART_7, 5, 0), line(TX_A, PART_7, 3, 0)], none);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [{ transactionId: TX_B, quantity: 4, note: "" }]);
  });

  it("이미 돌아온 수량이 있는 줄에는 **남은 만큼만** 담는다", () => {
    const r = allocateReturnLines([{ no: 7, quantity: 3 }], [line(TX_A, PART_7, 5, 4), line(TX_B, PART_7, 5, 3)], none);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [
      { transactionId: TX_A, quantity: 1, note: "" },
      { transactionId: TX_B, quantity: 2, note: "" },
    ]);
  });

  it("🔴 **대기 중인 반환 신청이 걸린 줄은 그만큼 비켜 간다** — 같은 줄을 두 번 쓰지 않는다", () => {
    const pending = pendingByTransaction([buildApiReturnRequest(returnValue(RETURN_BODY), [{ transactionId: TX_A, quantity: 3, note: "" }], "2026-11-26")]);
    assert.equal(pending.get(TX_A), 3, "대기분 표본이 비었다");
    const r = allocateReturnLines([{ no: 7, quantity: 2 }], [line(TX_A, PART_7, 3, 0), line(TX_B, PART_7, 5, 0)], pending);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [{ transactionId: TX_B, quantity: 2, note: "" }], "대기 중인 신청이 찬 줄에 또 담았다");
  });

  it("다 찬 줄은 건너뛴다 — **수량 0 짜리 줄을 만들지 않는다**", () => {
    const r = allocateReturnLines([{ no: 7, quantity: 1 }], [line(TX_A, PART_7, 2, 2), line(TX_B, PART_7, 1, 0)], none);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [{ transactionId: TX_B, quantity: 1, note: "" }]);
  });

  it("한 건에 여러 부품 — 부품마다 제 줄에만 담긴다", () => {
    const r = allocateReturnLines(
      [
        { no: 7, quantity: 1 },
        { no: 22, quantity: 2 },
      ],
      [line(TX_A, PART_7, 1, 0), line(TX_B, PART_22, 2, 0), line(TX_C, PART_7, 4, 0)],
      none,
    );
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [
      { transactionId: TX_A, quantity: 1, note: "" },
      { transactionId: TX_B, quantity: 2, note: "" },
    ]);
  });

  it("🔴 **남은 것보다 많이 요청하면 거절하고, 얼마가 남았는지를 말에 담는다**", () => {
    const r = allocateReturnLines([{ no: 7, quantity: 5 }], [line(TX_A, PART_7, 5, 2)], none);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.message, /No\. 7/);
    assert.match(r.message, /3개까지/, "남은 수량이 말에 없다 — A/S 화면이 그 말을 그대로 보여 준다");
    assert.match(r.message, /5개/, "요청한 수량이 말에 없다");
  });

  it("🔴 **대기 중인 신청까지 뺀 수**로 말한다 — 화면이 보여 준 최댓값과 같은 셈이다", () => {
    const pending = pendingByTransaction([{ type: "RETURN", lines: [{ transactionId: TX_A, quantity: 2 }] }]);
    const r = allocateReturnLines([{ no: 7, quantity: 4 }], [line(TX_A, PART_7, 5, 0)], pending);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.message, /3개까지/);
    // 🔵 앞 조각의 셈과 **같은 수**임을 맞대어 본다 — 두 벌이면 여기서 갈린다.
    assert.equal(summarizeReturnCandidates([line(TX_A, PART_7, 5, 0)], pending)[0].remaining, 3);
  });

  it("딱 남은 만큼은 받아 준다 — 경계가 열려 있다", () => {
    const r = allocateReturnLines([{ no: 7, quantity: 3 }], [line(TX_A, PART_7, 5, 2)], none);
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [{ transactionId: TX_A, quantity: 3, note: "" }]);
  });

  it("🔴 나간 적 없는 부품은 **다른 말**로 거절한다", () => {
    const r = allocateReturnLines([{ no: 99, quantity: 1 }], [line(TX_A, PART_7, 5, 0)], none);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.message, /No\. 99/);
    assert.match(r.message, /return-candidates/, "어디서 다시 확인하는지 안 알려 준다");
    const tooMany = allocateReturnLines([{ no: 7, quantity: 9 }], [line(TX_A, PART_7, 5, 0)], none);
    assert.notEqual(r.message, tooMany.ok ? "" : tooMany.message, "「없는 부품」과 「넘쳤다」가 같은 말로 거절된다");
  });

  it("이미 다 돌아온 부품도 같은 자리에서 거절한다 (목록에서 줄째 빠진다)", () => {
    const r = allocateReturnLines([{ no: 7, quantity: 1 }], [line(TX_A, PART_7, 3, 3)], none);
    assert.equal(r.ok, false);
  });

  it("🔴 **한 줄이라도 틀리면 통째로 거절한다** — 성한 줄만 담아 세우지 않는다", () => {
    const r = allocateReturnLines(
      [
        { no: 7, quantity: 1 },
        { no: 99, quantity: 1 },
      ],
      [line(TX_A, PART_7, 5, 0)],
      none,
    );
    assert.equal(r.ok, false);
  });

  it(`🔴 쪼갠 줄이 ${MAX_LINES}줄을 넘으면 거절한다 — 상한이 화면과 같다`, () => {
    const lines = Array.from({ length: MAX_LINES + 1 }, (_, i) => line(TX(i % 9), { ...PART_7 }, 1, 0));
    // 🔵 번호가 겹치지 않게 다시 매긴다 — 같은 줄 번호가 둘이면 재는 것이 달라진다.
    const unique = lines.map((l, i) => ({ ...l, transactionId: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000` }));
    const r = allocateReturnLines([{ no: 7, quantity: MAX_LINES + 1 }], unique, none);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, new RegExp(`${MAX_LINES}줄`));
    // 🔵 딱 상한까지는 받는다.
    const just = allocateReturnLines([{ no: 7, quantity: MAX_LINES }], unique.slice(0, MAX_LINES), none);
    assert.ok(just.ok);
    assert.equal(just.lines.length, MAX_LINES);
  });

  it("나간 줄이 하나도 없으면 전부 거절된다 (없는 인수번호로 물은 꼴)", () => {
    const r = allocateReturnLines([{ no: 7, quantity: 1 }], [], none);
    assert.equal(r.ok, false);
  });

  it("입력을 건드리지 않는다 — 순수 함수다", () => {
    const requested = [{ no: 7, quantity: 2 }];
    const candidates = [line(TX_A, PART_7, 5, 0)];
    const snapshot = JSON.stringify({ requested, candidates });
    allocateReturnLines(requested, candidates, none);
    assert.equal(JSON.stringify({ requested, candidates }), snapshot);
  });
});

/* ================================================================== */
/* ④ 🔴 저장 모양 — 앞 조각이 **실제로** 읽는다                         */
/* ================================================================== */
describe("④ 🔴 저장된 모양을 앞 조각의 `returnRequestLines` 가 읽는다", () => {
  const value = returnValue(RETURN_BODY);
  const allocated = allocateReturnLines(value.lines, [line(TX_A, PART_7, 1, 0), line(TX_B, PART_7, 4, 0)], new Map());
  assert.ok(allocated.ok);
  const payload = buildApiReturnRequest(value, allocated.lines, "2026-11-26");

  it("종류·날짜·비고가 실린다 — 날짜는 넘겨 준 오늘", () => {
    assert.equal(payload.type, "RETURN");
    assert.equal(payload.occurredOn, "2026-11-26");
    assert.equal(payload.note, "내일 가져다 드립니다");
  });

  it("🔴 줄의 칸이 `ReturnLine` 셋 그대로다 — 새 모양을 발명하지 않았다", () => {
    assert.ok(payload.type === "RETURN");
    for (const l of payload.lines) assert.deepEqual(Object.keys(l).sort(), ["note", "quantity", "transactionId"]);
  });

  it("🔴 **앞 조각이 그 줄을 읽는다** — 모양이 어긋나면 여기서 잡힌다", () => {
    const read = returnRequestLines(payload);
    assert.deepEqual(read, [
      { transactionId: TX_A, quantity: 1 },
      { transactionId: TX_B, quantity: 1 },
    ]);
    assert.equal(
      read.reduce((a, l) => a + l.quantity, 0),
      2,
      "신청한 수량과 읽힌 수량이 다르다",
    );
  });

  it("🔴 **`pending` 이 실제로 올라가고 `remaining` 이 그만큼 준다** (앞 조각의 셈으로 끝까지)", () => {
    const candidates = [line(TX_A, PART_7, 1, 0), line(TX_B, PART_7, 4, 0)];
    const before = summarizeReturnCandidates(candidates, new Map())[0];
    assert.equal(before.pending, 0, "표본이 비었다 — 세울 신청이 없으면 아래가 공짜로 통과한다");
    assert.equal(before.remaining, 5);

    const after = summarizeReturnCandidates(candidates, pendingByTransaction([payload]))[0];
    assert.equal(after.taken, 5, "나간 수량이 흔들렸다");
    assert.equal(after.returned, 0, "돌아온 수량이 흔들렸다");
    assert.equal(after.pending, 2, "신청을 세웠는데 pending 이 안 올랐다 — 저장 모양이 어긋났다");
    assert.equal(after.remaining, 3, "remaining 이 신청한 만큼 안 줄었다");
  });

  it("🔴 **인수번호는 payload 에 담기지 않는다** — 되돌리는 원장 줄이 이미 들고 있다", () => {
    assert.ok(!JSON.stringify(payload).includes("D260701"), "반환 payload 에 인수번호가 섞여 들어갔다");
  });

  it("🔵 수리 건의 종류도 payload 에 담기지 않는다 (사용 신청과 같은 관례)", () => {
    const withKind = returnValue({ ...RETURN_BODY, workflowKind: "MATCHER" });
    assert.equal(withKind.workflowKind, "MATCHER", "종류를 못 받았다 — 신청 표의 제 칸으로 가는 값이다");
    const built = buildApiReturnRequest(withKind, allocated.lines, "2026-11-26");
    assert.ok(!JSON.stringify(built).includes("MATCHER"));
  });
});

/* ================================================================== */
/* ⑤ 🔴 결재 — 반환은 타지 않는다 (켜져 있어도)                         */
/* ================================================================== */
describe("⑤ 🔴 반환은 승인 절차를 타지 않는다 — **켜져 있어도**", () => {
  /** 🔴 2026-11-26 개발 DB 실측: 「부품 불출」의 현재 판(version 17)에 단계가 **3개** 서 있다. */
  const ROUTE_IN_FORCE = { steps: [{ stepOrder: 1 }, { stepOrder: 2 }, { stepOrder: 3 }] };

  it("표본 확인 — 이 절차는 **켜져 있다**(꺼져 있으면 아래가 공짜로 통과한다)", () => {
    assert.equal(isPartIssueApprovalRouteInForce(ROUTE_IN_FORCE), true);
    assert.equal(isPartIssueApprovalRouteInForce({ steps: [] }), false, "단계 0개는 꺼진 것이다");
    assert.equal(isPartIssueApprovalRouteInForce(null), false);
  });

  it("🔴 **절차가 켜져 있어도** 반환 신청은 결재 대상이 아니다 — 네 갈래 전부", () => {
    // 🔵 화면이 줄마다 세우는 그 식 그대로다(`src/app/(app)/requests/page.tsx`).
    const required = (type: "USE" | "RETURN", kind: (typeof WORKFLOW_KINDS)[number] | null) => {
      const scope = approvalRouteScopeForWorkflowKind(kind);
      assert.ok(scope, "용도를 못 골랐다");
      return !isApprovalExemptRequestType(type) && isPartIssueApprovalRouteInForce(ROUTE_IN_FORCE);
    };
    for (const kind of [null, ...WORKFLOW_KINDS]) {
      assert.equal(required("USE", kind), true, `반출이 결재를 안 탄다: ${String(kind)} — 표본이 뒤집혔다`);
      assert.equal(required("RETURN", kind), false, `반환이 결재를 탄다: ${String(kind)}`);
    }
  });

  it("🔴 면제는 **반환 하나**다 — 나머지 종류는 전부 그대로 결재를 탄다", () => {
    assert.deepEqual([...APPROVAL_EXEMPT_REQUEST_TYPES], ["RETURN"]);
    assert.equal(isApprovalExemptRequestType("RETURN"), true);
    for (const type of ENTRY_TYPES) {
      if (type === "RETURN") continue;
      assert.equal(isApprovalExemptRequestType(type), false, `${type} 까지 결재에서 빠졌다`);
    }
  });

  it("🔴 **세 자리가 모두 종류를 먼저 묻는다** (소스로 잰다 — 전부 server-only 사슬이다)", () => {
    // ① 화면 — 줄마다.
    const page = stripComments(src("src/app/(app)/requests/page.tsx"));
    const built = page.split("\n").find((l) => l.includes("approvalRequiredByRequest[r.id] ="));
    assert.ok(built, "줄별 값을 세우는 자리를 찾지 못했다 — 시험이 낡았다");
    assert.ok(built.includes("isApprovalExemptRequestType(r.type)"), "화면이 종류를 안 본다 — 반환에 [불출 신청] 단추가 선다");
    assert.ok(built.includes("approvalRouteScopeForWorkflowKind(r.workflowKind)"), "짝표를 안 거친다");

    // ② 서버가 묻는 한 자리 — 종류 칸을 읽어 순수 함수에 넘긴다.
    const scopeReader = stripComments(src("src/lib/approval/request-scope.ts"));
    assert.match(scopeReader, /stockRequests\.type/, "신청의 종류 칸을 안 읽는다");
    assert.match(scopeReader, /isApprovalExemptRequestType\(/, "면제 판정을 안 거친다");
    assert.match(scopeReader, /Promise<ApprovalRouteScope \| null>/, "「안 탄다」를 돌려줄 자리가 없다");

    // ③ [확인] 게이트 — 용도가 없으면 판을 읽지도 않는다.
    const action = stripComments(src("src/app/actions/stock.ts"));
    assert.match(action, /scope !== null && isPartIssueApprovalRouteInForce\(/, "면제된 신청에도 판을 걸어 본다");

    // ④ 결재를 올리는 자리 — 거기서도 멈춘다.
    const raise = stripComments(src("src/lib/approval/part-issue.ts"));
    const nullGate = raise.indexOf("if (scope === null)");
    assert.notEqual(nullGate, -1, "올리는 자리가 면제를 모른다 — 옛 화면에서 누르면 반환에 결재가 선다");
    assert.ok(nullGate < raise.indexOf("getCurrentApprovalRouteWithSubs(scope)"), "판을 읽은 **뒤**에 가린다 — tsc 가 먼저 멈출 자리다");
  });
});

/* ================================================================== */
/* ⑥ 🔴 담당자가 직접 넣는 반환은 전과 똑같다                            */
/* ================================================================== */
describe("⑥ 🔴 화면에서 담당자가 적는 반환은 **요청으로 서지 않는다**", () => {
  it("확인을 거치는 종류 묶음이 그대로다 — 반환은 거기 없다", () => {
    assert.deepEqual([...CONFIRMATION_TYPES].sort(), ["DISPOSE", "LOAN", "USE"]);
    assert.equal(needsConfirmation("RETURN"), false, "반환이 확인 대기로 들어가면 **담당자가 화면에서 적던 반환까지** 요청으로 선다");
    assert.equal(needsConfirmation("RECEIVE"), false);
    for (const t of ["USE", "LOAN", "DISPOSE"] as const) assert.equal(needsConfirmation(t), true, t);
  });

  it("🔴 화면 저장 길은 그 묶음으로 가른다 — 한 글자도 안 바뀌었다 (소스)", () => {
    const action = stripComments(src("src/app/actions/stock.ts"));
    assert.match(action, /if \(needsConfirmation\(parsed\.value\.type\)\) \{/, "화면 저장이 종류 묶음으로 가르지 않는다");
    assert.match(action, /await recordEntry\(parsed\.value, actor\)/, "확인을 안 거치는 종류가 원장으로 바로 가는 길이 사라졌다");
  });

  it("🔴 **바깥에서 온 것인가**로 갈린다 — 신청 표가 그 구분을 들고 있다 (소스)", () => {
    // 🔵 2026-11-26 개발 DB 실측: `stock_request_source` = [INVENTORY, AS], 쌓인 신청은 INVENTORY 7 · AS 22.
    const schema = stripComments(src("src/db/schema/stock-requests.ts"));
    assert.match(schema, /REQUEST_SOURCES = \["INVENTORY", "AS"\]/, "출처 묶음이 바뀌었다");
    assert.match(schema, /source: requestSourceEnum\("source"\)\.notNull\(\)\.default\("INVENTORY"\)/, "기본값이 INVENTORY 가 아니다");
    const route = stripComments(src("src/app/api/v1/stock-requests/route.ts"));
    assert.match(route, /source: "AS"/, "통로가 출처를 안 적는다 — 화면에서 올린 것과 섞인다");
  });
});

/* ================================================================== */
/* ⑦ 🔴 기존 반환 화면도 대기분을 뺀다                                  */
/* ================================================================== */
describe("⑦ 🔴 반환 화면의 최댓값도 대기 중인 신청만큼 준다 (소스로 잰다)", () => {
  const queries = stripComments(src("src/lib/stock/queries.ts"));
  const body = (() => {
    const start = queries.indexOf("export async function returnCandidates(partId: string)");
    assert.notEqual(start, -1, "returnCandidates 를 찾지 못했다 — 이름이 바뀌었으면 시험도 함께 고쳐라");
    const rest = queries.slice(start + 1);
    const end = rest.indexOf("\nexport ");
    return end === -1 ? rest : rest.slice(0, end);
  })();

  it("🔴 대기 중인 반환 신청을 읽어 와 뺀다 — 안 빼면 두 화면이 다른 최댓값을 말한다", () => {
    assert.match(body, /pendingByTransaction\(await listPendingReturnPayloads\(\)\)/, "대기 중인 신청을 안 읽는다");
    assert.match(body, /remainingOf\(-r\.delta, r\.returned, waiting\)/, "통로와 같은 셈 함수를 안 쓴다");
  });

  it("🔴 **셈 함수가 한 벌이다** — 화면이 제 나름대로 빼지 않는다", () => {
    assert.ok(!/remaining: -r\.delta - r\.returned/.test(body), "옛 뺄셈(대기분을 모르는 식)이 남아 있다");
    assert.equal(queries.split("remainingOf(").length - 1, 1, "셈을 부르는 자리가 둘이 됐다");
  });

  it("🔵 줄이 없으면 신청 표를 열지 않는다 — 답이 같아서다(읽는 통로와 같은 건너뛰기)", () => {
    assert.match(body, /rows\.length === 0 \? new Map<string, number>\(\)/);
  });

  it("🔴 **화면이 「신청 중」을 적는다** — 말 안 하면 왜 줄었는지 알 길이 없다", () => {
    const form = stripComments(src("src/components/stock/EntryForm.tsx"));
    assert.match(form, /신청 중 \$\{c\.pending\}개/, "줄어든 까닭을 화면이 말하지 않는다");
    assert.match(form, /c\.pending > 0 \?/, "0 일 때도 그린다 — 거의 언제나 0 이라 잡음이 된다");
    assert.match(form, /max=\{c\.remaining\}/, "최댓값이 remaining 이 아니다");
  });
});
