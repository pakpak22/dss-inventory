import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildReturnCandidatesResponse,
  parseReturnCandidatesQuery,
  pendingByTransaction,
  remainingOf,
  returnRequestLines,
  summarizeReturnCandidates,
  type ReturnableLine,
  type ReturnableLinePart,
} from "../src/lib/api/return-candidates";
import { checkBearerToken } from "../src/lib/api/token-gate";
import { env } from "../src/lib/env";
import { PENDING_REQUEST_STATUSES } from "../src/lib/stock/codes";
import type { EntryInput } from "../src/lib/stock/form";

/**
 * A/S 가 **「이 수리 건에서 무엇을 얼마나 돌려줄 수 있나」를 물어 가는 통로**의 울타리
 * (2026-11-26, `GET /api/v1/return-candidates`).
 *
 * 🔴 규칙을 전부 순수 함수에 모아 두고 여기서 덮는다 — 통로 파일도 읽는 질의도 `server-only` 를 거쳐
 *    들어가 `npm test` 가 **불러올 수 없다**(`tests/api-oh-templates.test.ts` 와 같은 사정).
 * 🔴 그래서 **DB 에서만 가려지는 울타리는 소스 글자로 잰다**(아래 ⑤). 🔵 재기 전에 **주석을 걷어낸다** —
 *    주석에 그 글자가 적혀 있으면 조건이 사라져도 시험이 통과한다(이 저장소에서 실제로 겪은 함정).
 *
 * 🔵 **`pending`(대기 중인 반환 신청)은 이 시험을 쓸 때 언제나 0 이었다** — 2026-11-26 개발 DB 실측으로
 *    `stock_requests` 29줄이 전부 `USE` 였고, 신청을 세우는 일은 「다음 조각」이었다. 🔴 **그 다음 조각이
 *    같은 날 왔다**: A/S 가 `POST /api/v1/stock-requests` 에 `type: "RETURN"` 으로 올린다
 *    (`tests/api-return-request.test.ts`). 그래서 아래 ③ 의 pending 시험들이 **시험 안에서 신청을 만들어**
 *    재던 것은 이제 실제로 일어나는 일이고, 그 뺄셈이 **먼저** 서 있었기에 같은 부품을 두 번 신청해
 *    넘기는 길이 처음부터 막혀 있었다.
 */

/* 🔴 실제 고객사명·사람 이름을 쓰지 않는다 — 공개 저장소에 박힌다. 부품 이름은 이 저장소의 데모 관례(「예시 」)를 따른다. */
const PART_7: ReturnableLinePart = { no: 7, name: "예시 PCB-001", name2: "예시 보드", customerName: "예시 고객사 품명", kyosanPartNo: "C000000001", drawingNo: "WR00000AA001A", owner: "DSS" };
const PART_22: ReturnableLinePart = { no: 22, name: "예시 AMP-002", name2: "", customerName: "", kyosanPartNo: "", drawingNo: "", owner: "SERVICE_SPARE" };
const PART_185: ReturnableLinePart = { no: 185, name: "예시 유량계", name2: "", customerName: "", kyosanPartNo: "", drawingNo: "", owner: "KYOSAN" };

const TX_A = "11111111-1111-4111-8111-111111111111";
const TX_B = "22222222-2222-4222-8222-222222222222";
const TX_C = "33333333-3333-4333-8333-333333333333";
const TX_D = "44444444-4444-4444-8444-444444444444";

function line(transactionId: string, part: ReturnableLinePart, taken: number, returned: number): ReturnableLine {
  return { transactionId, part, taken, returned };
}

/** 대기 중인 반환 신청 한 건. 🔴 **타입을 박아 둔다** — 신청 payload 의 칸 이름이 바뀌면 여기서 tsc 가 멈춘다. */
function returnRequest(lines: Array<{ transactionId: string; quantity: number }>): Extract<EntryInput, { type: "RETURN" }> {
  return { type: "RETURN", occurredOn: "2026-11-26", note: "", lines: lines.map((l) => ({ ...l, note: "" })) };
}

/* ================================================================== */
/* ① 묻는 법 — 인수번호 하나                                           */
/* ================================================================== */
describe("① 돌려줄 수 있는 부품 — 묻는 법", () => {
  const parse = (qs: string) => parseReturnCandidatesQuery(new URLSearchParams(qs));

  it("인수번호 하나를 받는다", () => {
    const r = parse("intake=D260701");
    assert.ok(r.ok);
    assert.equal(r.intakeNumber, "D260701");
  });

  it("🔵 소문자로 물어도 찾는다 — 저장된 값이 언제나 대문자라, 못 찾았다고 하면 거짓말이다", () => {
    const r = parse("intake=d260701");
    assert.ok(r.ok);
    assert.equal(r.intakeNumber, "D260701");
  });

  it("🔴 intake 가 없으면 거절한다 — 조건이 빠졌을 때 조용히 전부를 내주지 않는다", () => {
    for (const qs of ["", "intake=", "intake=%20%20", "part=7"]) {
      const r = parse(qs);
      assert.equal(r.ok, false, `통과하면 안 되는 조건: ${JSON.stringify(qs)}`);
      if (!r.ok) assert.match(r.message, /인수번호/);
    }
  });

  it("🔴 모양이 틀리면 거절한다 — 「없는 건」인지 「오타」인지 가릴 수 있어야 한다", () => {
    for (const bad of ["D26070", "D2607011", "X260701", "D26070A", "D260701 D260702", "'; drop table parts; --"]) {
      const r = parse(`intake=${encodeURIComponent(bad)}`);
      assert.equal(r.ok, false, `통과하면 안 되는 인수번호: ${JSON.stringify(bad)}`);
    }
  });

  it("🔴 인수번호 둘을 함께 보내면 거절한다 — 줄이 부품별이라 어느 건의 몫인지 적을 자리가 없다", () => {
    const r = parse("intake=D260701&intake=D260702");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /하나/);
  });

  it("🔵 같은 번호가 두 번 온 것은 한 번 물은 것으로 본다 (부르는 쪽 목록에 중복이 있었을 뿐)", () => {
    const r = parse("intake=D260701&intake=d260701");
    assert.ok(r.ok);
    assert.equal(r.intakeNumber, "D260701");
  });
});

/* ================================================================== */
/* ② 대기 중인 반환 신청 읽기 — `pending` 의 재료                       */
/* ================================================================== */
describe("② 대기 중인 반환 신청 펴기", () => {
  it("🔵 대기 중인 반환 신청이 하나도 없으면 **빈 셈**이다 (A/S 가 아직 한 건도 안 올린 날)", () => {
    const pending = pendingByTransaction([]);
    assert.equal(pending.size, 0);
    assert.equal(pending.get(TX_A), undefined);
  });

  it("신청 payload 의 반환 줄을 편다 — 열쇠는 부품이 아니라 **원장 줄**이다", () => {
    const lines = returnRequestLines(returnRequest([{ transactionId: TX_A, quantity: 2 }]));
    assert.deepEqual(lines, [{ transactionId: TX_A, quantity: 2 }]);
  });

  it("여러 신청이 **같은 원장 줄**을 가리키면 더한다 — 둘을 따로 세면 둘 다 통과한다", () => {
    const pending = pendingByTransaction([returnRequest([{ transactionId: TX_A, quantity: 2 }]), returnRequest([{ transactionId: TX_A, quantity: 1 }, { transactionId: TX_B, quantity: 5 }])]);
    assert.equal(pending.get(TX_A), 3);
    assert.equal(pending.get(TX_B), 5);
  });

  it("🔴 모양이 깨진 줄은 건너뛴다 — 그 신청의 **성한 줄은 그대로 센다**", () => {
    const broken = { type: "RETURN", lines: [{ transactionId: TX_A, quantity: "2" }, { transactionId: "", quantity: 3 }, { quantity: 4 }, { transactionId: TX_B, quantity: 0 }, { transactionId: TX_B, quantity: -1 }, { transactionId: TX_B, quantity: 1.5 }, null, { transactionId: TX_C, quantity: 7 }] };
    assert.deepEqual(returnRequestLines(broken), [{ transactionId: TX_C, quantity: 7 }]);
  });

  it("payload 가 아예 다른 것이어도 터지지 않는다 (null·배열 아닌 lines·옛 신청)", () => {
    for (const payload of [null, undefined, 3, "", [], {}, { lines: null }, { lines: {} }, { type: "USE", lines: [{ partId: TX_A, quantity: 2 }] }]) {
      assert.deepEqual(returnRequestLines(payload), [], `터지거나 줄이 생겼다: ${JSON.stringify(payload)}`);
    }
  });

  it("🔴 「대기」를 가르는 상태 묶음은 이 저장소에 한 벌뿐이다 — 읽는 질의가 그것으로 거른다", () => {
    // 🔵 상태가 하나 늘어난 날 여기가 먼저 깨져, 「그 상태의 반환 신청도 pending 인가」를 묻게 한다.
    assert.deepEqual([...PENDING_REQUEST_STATUSES], ["PENDING", "CONFIRMING", "PARTIAL", "ON_HOLD", "IN_APPROVAL"]);
    for (const decided of ["CONFIRMED", "REJECTED", "CANCELLED"]) {
      assert.equal((PENDING_REQUEST_STATUSES as readonly string[]).includes(decided), false, `끝난 신청이 대기로 센다: ${decided}`);
    }
  });
});

/* ================================================================== */
/* ③ 합치기 — 부품별 taken · returned · pending · remaining            */
/* ================================================================== */
describe("③ 부품별로 합쳐 돌려줄 수 있는 수량을 센다", () => {
  const none = new Map<string, number>();

  it("나간 수량·돌아온 수량·남은 수량 — 한 부품에 여러 줄이면 **합친 한 줄**이다", () => {
    const rows = summarizeReturnCandidates([line(TX_A, PART_7, 5, 1), line(TX_B, PART_7, 3, 0)], none);
    assert.equal(rows.length, 1, "같은 부품이 두 줄로 나갔다");
    assert.equal(rows[0].no, 7);
    assert.equal(rows[0].taken, 8);
    assert.equal(rows[0].returned, 1);
    assert.equal(rows[0].pending, 0);
    assert.equal(rows[0].remaining, 7);
  });

  it("부품을 알아보는 값이 함께 간다 — 받는 쪽이 줄을 그릴 수 있게 (소유는 `{ code, label }`)", () => {
    const [row] = summarizeReturnCandidates([line(TX_A, PART_7, 2, 0)], none);
    assert.equal(row.name, "예시 PCB-001");
    assert.equal(row.name2, "예시 보드");
    assert.equal(row.customerName, "예시 고객사 품명");
    assert.equal(row.kyosanPartNo, "C000000001");
    assert.equal(row.drawingNo, "WR00000AA001A");
    assert.deepEqual(row.owner, { code: "DSS", label: "DSS" });
    // 🔴 우리 내부 원장 줄 번호는 내주지 않는다 — A/S 가 그것을 보관하게 되는 모양을 피해 왔다.
    assert.equal("transactionId" in row, false);
    assert.deepEqual(Object.keys(row).sort(), ["customerName", "drawingNo", "kyosanPartNo", "name", "name2", "no", "owner", "pending", "remaining", "returned", "taken"]);
  });

  it("🔴 다 돌아온 부품(`remaining` 0)은 목록에서 **빠진다** — 0 을 적고 거절당하는 줄을 세우지 않는다", () => {
    const lines = [line(TX_A, PART_7, 4, 4), line(TX_B, PART_22, 2, 0)];
    const rows = summarizeReturnCandidates(lines, none);
    // 🔵 표본이 비어 공짜로 통과하지 않게 — 재료에 그 부품이 **있었다**는 것을 먼저 못 박는다.
    assert.equal(lines.filter((l) => l.part.no === 7).length, 1);
    assert.deepEqual(rows.map((r) => r.no), [22]);
  });

  it("🔴 한 줄은 다 돌아오고 다른 줄은 남았으면 **남은 만큼만** 선다 (줄별로 끊어 세지 않는다)", () => {
    const [row] = summarizeReturnCandidates([line(TX_A, PART_7, 4, 4), line(TX_B, PART_7, 3, 1)], none);
    assert.equal(row.taken, 7);
    assert.equal(row.returned, 5);
    assert.equal(row.remaining, 2);
  });

  it("🔴 `remaining` 은 **음수로 안 나간다** — 셈 자체를 눌러 본다", () => {
    // 🔴 목록으로만 재면 **표본이 빈다** — 음수 줄은 거르개에서 빠져 for 문이 한 번도 안 돌고, 그러면
    //    깎는 줄을 지워도 시험이 통과한다. 그래서 셈하는 함수를 직접 누른다.
    assert.equal(remainingOf(5, 1, 0), 4);
    assert.equal(remainingOf(2, 5, 0), 0, "돌아온 수량이 더 많은 어긋난 자료");
    assert.equal(remainingOf(4, 0, 99), 0, "신청이 남은 것보다 많은 자리");
    assert.equal(remainingOf(0, 3, 3), 0);
  });

  it("🔴 어긋난 자료(돌아온 수량 > 나간 수량)는 **목록에서 빠지고**, 성한 부품은 그대로 선다", () => {
    const lines = [line(TX_A, PART_7, 2, 5), line(TX_B, PART_22, 1, 0)];
    assert.equal(lines.filter((l) => l.part.no === 7).length, 1, "재료에 그 부품이 있었다");
    assert.deepEqual(summarizeReturnCandidates(lines, none).map((r) => r.no), [22], "음수 줄이 목록에 섰다");
  });

  it("🔴 **내주는 줄은 모두 `remaining` 이 1 이상**이다 — 조합을 훑어 잰다(표본이 비면 깨진다)", () => {
    let shown = 0;
    let dropped = 0;
    for (const taken of [1, 2, 3, 5, 8]) {
      for (const returned of [0, 1, 3, 8, 11]) {
        for (const quantity of [0, 1, 2, 7]) {
          const pending = quantity === 0 ? none : pendingByTransaction([returnRequest([{ transactionId: TX_A, quantity }])]);
          const rows = summarizeReturnCandidates([line(TX_A, PART_7, taken, returned)], pending);
          if (rows.length === 0) {
            dropped += 1;
            assert.ok(taken - returned - quantity <= 0, `남은 것이 있는데 빠졌다: ${taken}/${returned}/${quantity}`);
            continue;
          }
          shown += 1;
          assert.equal(rows[0].remaining, taken - returned - quantity, `셈이 틀렸다: ${taken}/${returned}/${quantity}`);
          assert.ok(rows[0].remaining > 0, `0 이하가 목록에 섰다: ${rows[0].remaining}`);
        }
      }
    }
    // 🔵 두 갈래가 **둘 다 실제로 돌았는지** 못 박는다 — 한쪽이 0 이면 그 갈래는 재지 않은 것이다.
    assert.ok(shown > 0, "서는 줄이 한 번도 안 나왔다 — 재지 않은 시험이다");
    assert.ok(dropped > 0, "빠지는 줄이 한 번도 안 나왔다 — 재지 않은 시험이다");
  });

  it("🔴 **대기 중인 반환 신청이 있으면 그만큼 `remaining` 이 준다** — 🔵 그런 신청은 통로가 세운다(여기서는 시험용으로 만든다)", () => {
    const pending = pendingByTransaction([returnRequest([{ transactionId: TX_A, quantity: 2 }])]);
    const [row] = summarizeReturnCandidates([line(TX_A, PART_7, 5, 1)], pending);
    assert.equal(row.taken, 5);
    assert.equal(row.returned, 1);
    assert.equal(row.pending, 2);
    assert.equal(row.remaining, 2, "대기 중인 신청을 빼지 않으면 같은 부품을 두 번 돌려주는 신청이 선다");
  });

  it("🔴 대기 중인 신청이 남은 것을 **다 덮으면** 그 부품은 목록에서 빠진다 (두 번째 신청을 못 세운다)", () => {
    const pending = pendingByTransaction([returnRequest([{ transactionId: TX_A, quantity: 4 }])]);
    const rows = summarizeReturnCandidates([line(TX_A, PART_7, 4, 0), line(TX_C, PART_22, 1, 0)], pending);
    assert.deepEqual(rows.map((r) => r.no), [22]);
  });

  it("🔴 신청 수량이 남은 것보다 많아도 음수로 안 나간다 (부분 불출은 조금 많이 세는 쪽이다)", () => {
    const pending = pendingByTransaction([returnRequest([{ transactionId: TX_A, quantity: 99 }])]);
    assert.deepEqual(summarizeReturnCandidates([line(TX_A, PART_7, 4, 0)], pending), []);
  });

  it("🔵 **다른 줄에 걸린 신청은 이 부품을 안 깎는다** — 짝은 원장 줄 번호로 맞춘다", () => {
    const pending = pendingByTransaction([returnRequest([{ transactionId: TX_D, quantity: 3 }])]);
    const [row] = summarizeReturnCandidates([line(TX_A, PART_7, 5, 0)], pending);
    assert.equal(row.pending, 0);
    assert.equal(row.remaining, 5);
  });

  it("🔵 한 부품의 **여러 줄에 걸린 신청**은 그 부품에서 다 빠진다", () => {
    const pending = pendingByTransaction([returnRequest([{ transactionId: TX_A, quantity: 1 }, { transactionId: TX_B, quantity: 2 }])]);
    const [row] = summarizeReturnCandidates([line(TX_A, PART_7, 5, 0), line(TX_B, PART_7, 5, 0)], pending);
    assert.equal(row.pending, 3);
    assert.equal(row.remaining, 7);
  });

  it("차례는 **부품 No. 오름차순** — DB 가 주는 차례에 기대지 않는다(새로고침마다 줄이 바뀌면 안 된다)", () => {
    const rows = summarizeReturnCandidates([line(TX_A, PART_185, 1, 0), line(TX_B, PART_7, 1, 0), line(TX_C, PART_22, 1, 0)], none);
    assert.deepEqual(rows.map((r) => r.no), [7, 22, 185]);
  });

  it("나간 것이 없으면 빈 목록이다 — **오류가 아니다**(없는 인수번호·아직 아무것도 안 나간 건)", () => {
    assert.deepEqual(summarizeReturnCandidates([], none), []);
  });
});

/* ================================================================== */
/* ④ 돌려주는 모양                                                     */
/* ================================================================== */
describe("④ 돌려주는 모양", () => {
  it("물어본 인수번호와 센 수가 함께 간다", () => {
    const candidates = summarizeReturnCandidates([line(TX_A, PART_7, 3, 0)], new Map());
    const res = buildReturnCandidatesResponse("D260701", candidates, "2026-11-26T01:00:00.000Z");
    assert.deepEqual(Object.keys(res).sort(), ["candidates", "count", "generatedAt", "intakeNumber"]);
    assert.equal(res.intakeNumber, "D260701");
    assert.equal(res.generatedAt, "2026-11-26T01:00:00.000Z");
    assert.equal(res.count, 1);
    assert.equal(res.count, res.candidates.length);
  });

  it("🔴 없는 인수번호는 **빈 목록**이다 — 404 가 아니다 (아직 아무것도 안 나간 건과 가릴 수 없다)", () => {
    const res = buildReturnCandidatesResponse("D999999", summarizeReturnCandidates([], new Map()), "2026-11-26T01:00:00.000Z");
    assert.equal(res.count, 0);
    assert.deepEqual(res.candidates, []);
    assert.equal(res.intakeNumber, "D999999");
  });
});

/* ================================================================== */
/* ⑤ 🔴 DB 에서만 가려지는 울타리 — 소스 글자로 잰다                    */
/* ================================================================== */
/**
 * `src/lib/stock/queries.ts`·`requests.ts` 는 `server-only` 라 여기서 불러올 수 없고, 이 저장소에는 DB
 * 시험이 없다. 그런데 아래 조건들은 **빠지면 조용히 틀린 값이 나간다**(취소된 반출을 돌려줄 수 있다고
 * 하고 · 다른 수리 건의 부품이 섞여 나가고 · 끝난 신청이 `pending` 으로 잡힌다). 글자로라도 못 박는다.
 *
 * 🔵 **주석을 먼저 걷어낸다** — 「있어야 한다」 쪽 검사는 주석에 그 글자가 적혀 있는 것만으로 영영
 *    통과한다(이 저장소에서 실제로 겪은 함정).
 */
describe("⑤ 🔴 읽는 조건을 소스로 잰다 (주석을 걷어낸 뒤)", () => {
  const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const queries = stripComments(src("src/lib/stock/queries.ts"));
  /** `readReturnableTransactions` 의 **본문만** 잘라 낸다 — 다른 함수의 글자가 섞이면 잘못 센다. */
  const readBody = (() => {
    const start = queries.indexOf("async function readReturnableTransactions");
    assert.notEqual(start, -1, "readReturnableTransactions 를 찾지 못했다 — 이름이 바뀌었으면 시험도 함께 고쳐라");
    const rest = queries.slice(start);
    const end = rest.indexOf("\nexport ");
    return end === -1 ? rest : rest.slice(0, end);
  })();

  it("🔴 되돌릴 수 있는 것은 **사용·대여**뿐이다 — 입고·폐기·조정이 섞이면 원장이 거절한다", () => {
    assert.match(readBody, /inArray\(stockEntries\.type, \["USE", "LOAN"\]\)/);
  });

  it("🔴 **인수번호로 거른다** — 안 걸면 다른 수리 건의 부품이 섞여 나간다", () => {
    assert.match(readBody, /eq\(stockEntries\.intakeNumber, filter\.intakeNumber\)/);
  });

  it("🔴 **기록 취소된 줄과 + 줄은 뺀다** — 취소된 반출은 나간 적이 없는 것이다", () => {
    assert.match(readBody, /filter\(\(r\) => !r\.corrected && r\.delta < 0\)/);
  });

  it("🔴 「이미 돌아온 수량」은 **그 줄을 가리키는 반환 줄의 합**이다 — 원장의 검사와 같은 식이어야 한다", () => {
    assert.match(readBody, /returns_transaction_id = \$\{stockTransactions\.id\}/);
    const ledger = stripComments(src("src/lib/stock/ledger.ts"));
    assert.match(ledger, /eq\(stockTransactions\.returnsTransactionId, s\.id\)/, "원장의 반환 검사가 바뀌었다 — 두 식이 갈리면 화면과 저장이 다른 말을 한다");
  });

  it("🔴 인수번호로 읽을 때는 **뚜껑(limit)을 씌우지 않는다** — 잘리면 `taken` 이 줄어 멀쩡한 반환이 막힌다", () => {
    const intakeBranch = readBody.slice(readBody.indexOf("? await rows.orderBy"));
    assert.notEqual(intakeBranch, "", "거르개 갈래를 찾지 못했다");
    const [partBranch, rest] = [intakeBranch.slice(0, intakeBranch.indexOf(": await")), intakeBranch.slice(intakeBranch.indexOf(": await"))];
    assert.match(partBranch, /\.limit\(PART_RETURN_CANDIDATE_LIMIT\)/, "부품 하나로 볼 때의 뚜껑이 사라졌다");
    assert.equal(rest.includes(".limit("), false, "인수번호 갈래에 뚜껑이 생겼다");
  });

  it("🔴 **같은 뺄셈을 두 벌로 적지 않는다** — 두 통로가 같은 읽기를 지난다", () => {
    assert.equal(queries.split("returns_transaction_id =").length - 1, 1, "「이미 돌아온 수량」을 세는 자리가 둘이 됐다");
    assert.match(queries, /export async function returnCandidates\(partId: string\)[\s\S]{0,200}readReturnableTransactions\(\{ partId \}\)/);
    assert.match(queries, /export async function returnableLinesByIntake\(intakeNumber: string\)[\s\S]{0,200}readReturnableTransactions\(\{ intakeNumber \}\)/);
  });

  it("🔴 대기 중인 반환 신청은 **type=RETURN + 대기 상태 묶음**으로만 읽는다", () => {
    const requests = stripComments(src("src/lib/stock/requests.ts"));
    const start = requests.indexOf("export async function listPendingReturnPayloads");
    assert.notEqual(start, -1, "listPendingReturnPayloads 를 찾지 못했다");
    const body = requests.slice(start, start + 600);
    assert.match(body, /eq\(stockRequests\.type, "RETURN"\)/, "반출 신청까지 반환으로 센다");
    assert.match(body, /inArray\(stockRequests\.status, \[\.\.\.PENDING_REQUEST_STATUSES\]\)/, "대기 묶음을 손으로 적으면 상태가 늘어난 날 조용히 빠진다");
    assert.equal(body.includes(".limit("), false, "잘리면 pending 이 작아져 넘치는 반환을 열어 준다");
  });
});

/* ================================================================== */
/* ⑥ 🔴 읽기 토큰 전용 · 쓰기를 한 줄도 하지 않는다                     */
/* ================================================================== */
describe("⑥ 🔴 토큰 — 읽기 토큰 전용(`/api/v1/stock-requests` 의 GET 과 같은 문)", () => {
  const READ = "read-".padEnd(40, "r");
  const WRITE = "write-".padEnd(44, "w");

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

  it("🔴 토큰이 없거나 틀리면 거절한다 (401)", () => {
    withEnv({ INVENTORY_API_TOKEN: READ }, () => {
      for (const header of [null, "", "Bearer ", "Basic abc", `Token ${READ}`, `Bearer ${READ}x`, "Bearer read-rrr"]) {
        const d = checkBearerToken(env.inventoryApiToken, header);
        assert.ok(d, `통과하면 안 되는 머리말: ${JSON.stringify(header)}`);
        assert.equal(d.status, 401);
        assert.equal(d.error, "unauthorized");
      }
      assert.equal(checkBearerToken(env.inventoryApiToken, `Bearer ${READ}`), null, "맞는 토큰이 막혔다");
    });
  });

  it("🔴 읽기 토큰이 설정에 없으면 열어 두지 않고 닫는다 (503)", () => {
    withEnv({ INVENTORY_API_TOKEN: undefined }, () => {
      const d = checkBearerToken(env.inventoryApiToken, `Bearer ${READ}`);
      assert.ok(d);
      assert.equal(d.status, 503);
      assert.equal(d.error, "api_closed");
    });
  });

  it("🔴 쓰기 토큰으로 두드리면 401 — 두 값이 다른 환경변수에서 온다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.notEqual(env.inventoryApiToken, env.inventoryWriteToken);
      const d = checkBearerToken(env.inventoryApiToken, `Bearer ${WRITE}`);
      assert.ok(d, "쓰기 토큰이 읽기 통로를 지나갔다");
      assert.equal(d.status, 401);
    });
  });

  it("🔴 통로 파일이 **읽기** 문지기를 쓰고, 틀린 조건은 400 으로 돌려준다", () => {
    const route = readFileSync(new URL("../src/app/api/v1/return-candidates/route.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.match(route, /const denied = checkApiToken\(request\);/, "읽기 문지기가 사라졌다");
    assert.match(route, /if \(denied\) return denied;/, "문지기의 판정을 쓰지 않는다");
    assert.equal(route.includes("checkApiWriteToken"), false, "읽기 통로에 쓰기 문지기가 달렸다");
    assert.match(route, /status: 400/, "틀린 조건을 400 으로 돌려주지 않는다");
    assert.match(route, /headers: NO_STORE/, "응답을 캐시하지 말라는 머리말이 빠졌다");
  });

  it("🔴 **쓰기를 한 줄도 하지 않는다** — 이 통로에는 POST 가 없다", () => {
    const route = readFileSync(new URL("../src/app/api/v1/return-candidates/route.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(route.includes(`export async function ${method}`), false, `${method} 가 생겼다 — 이 조각은 읽기만 한다`);
    }
    for (const writer of ["recordEntry", "createRequest", "confirmRequest", "db().insert", "db().update", "db().delete"]) {
      assert.equal(route.includes(writer), false, `쓰는 호출이 들어왔다: ${writer}`);
    }
  });
});
