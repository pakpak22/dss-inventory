import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ENTRY_TYPES } from "../src/db/schema/stock";
import { allocateReturnLines } from "../src/lib/api/return-allocation";
import type { ReturnableLine, ReturnableLinePart } from "../src/lib/api/return-candidates";
import { buildApiReturnRequest, parseApiStockRequest, type ApiReturnRequestInput } from "../src/lib/api/stock-requests";
import { isApprovalExemptRequestType } from "../src/lib/approval/route";
import type { EntryInput } from "../src/lib/stock/form";
import { buildIssueInput } from "../src/lib/stock/issue";
import {
  isReturnRequest,
  returnRequestIntakeNumber,
  returnRequestPartLines,
  returnSourceText,
  returnedQuantityOf,
  RETURN_CONFIRM_BUSY_LABEL,
  RETURN_CONFIRM_BUTTON_LABEL,
  RETURN_CONFIRM_NOTICE,
  RETURN_CONFIRM_SUBMIT_LABEL,
  RETURN_CONFIRM_TITLE,
  RETURN_ITEMS_DONE_HEADER,
  RETURN_SOURCE_LABEL,
  type ReturnLineOrigin,
} from "../src/lib/stock/return-request-view";

/**
 * ============================================================================
 * 반환 신청이 **화면에 보인다** — 부품 줄 · 인수번호 · [반환] → [반환 완료] (2026-11-26)
 * ============================================================================
 * 앞 조각으로 A/S 가 올리는 반환 신청이 서기 시작했는데, 부품 요청 관리 화면에서 그 신청은
 * **「반환 · 2026-11-26」 한 줄**이었다 — 부품 줄도 인수번호도 없었다. 쓰는 분의 말이
 * 「**한 번 더 내용을 확인**하고 [반환 완료]」라서, **무엇을 돌려받는지 안 보이면 그 말 자체가
 * 성립하지 않는다.**
 *
 * 🔴 **「있는가」로 재지 않는다.** 종류 라벨 「반환」은 그 전에도 떴다 — 안 뜨던 것은 **부품 줄과
 *    인수번호**다. 그래서 아래는 전부 **무엇이 보이는가**를 값으로 잰다.
 * 🔴 되짚는 질의(`returnLineOriginsOf`)도 화면 조각도 `server-only`·JSX 라 `npm test` 가 불러올 수
 *    없다. 그래서 **규칙은 순수 함수로 재고, DB·화면에서만 가려지는 울타리는 소스 글자로 잰다** —
 *    `tests/api-return-request.test.ts` 와 같은 사정·같은 처방이다. 🔵 재기 전에 **주석을 걷어낸다**:
 *    주석에 그 글자가 적혀 있으면 조건이 사라져도 시험이 통과한다(이 저장소에서 실제로 겪은 함정).
 *
 * 🔴 실제 고객사명·사람 이름을 쓰지 않는다 — 공개 저장소에 박힌다.
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* 본보기                                                              */
/* ------------------------------------------------------------------ */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 🔴 주석을 걷어낸 코드만 (위 머리말). */
const codeOnly = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const PART_7: ReturnableLinePart = { no: 7, name: "예시 PCB-001", name2: "예시 보드", customerName: "예시 고객사 품명", kyosanPartNo: "C000000001", drawingNo: "WR00000AA001A", owner: "DSS" };

/** uuid 꼴 본보기 — 원장 줄 번호와 부품 id 를 눈으로 가를 수 있게 숫자를 되풀이한다. */
const ID = (n: number): string => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const TX_A = ID(1);
const TX_B = ID(2);
const TX_C = ID(3);
const PART_7_ID = ID(7);
const PART_22_ID = ID(8);

const D1 = "D260701";
const D2 = "D260702";

function origins(entries: ReadonlyArray<readonly [string, ReturnLineOrigin]>): Map<string, ReturnLineOrigin> {
  return new Map(entries);
}

function returnInput(lines: ReadonlyArray<{ transactionId: string; quantity: number }>): EntryInput {
  return { type: "RETURN", occurredOn: "2026-11-26", note: "", lines: lines.map((l) => ({ ...l, note: "" })) };
}

function taken(transactionId: string, part: ReturnableLinePart, qty: number): ReturnableLine {
  return { transactionId, part, taken: qty, returned: 0 };
}

/* ------------------------------------------------------------------ */

describe("① 🔴 반환 신청의 **부품 줄**이 선다 — 그 전에는 빈 배열이었다", () => {
  it("🔴 원장 줄을 되짚으면 **어느 부품의 몇 개인지**가 나온다", () => {
    const lines = returnRequestPartLines(returnInput([{ transactionId: TX_A, quantity: 2 }]), origins([[TX_A, { partId: PART_7_ID, intakeNumber: D1 }]]));
    assert.deepEqual(lines, [{ partId: PART_7_ID, quantity: 2, intakeNumbers: [D1] }]);
  });

  it("🔴 **재료가 없으면 빈 목록이다** — 그것이 이 조각 전의 모습이고, 되짚지 않는 자리는 아직 그렇다", () => {
    // 🔵 표본이 비어 공짜로 통과하지 않게, 바로 위에서 **같은 입력이 줄을 낸다**는 것을 이미 쟀다.
    assert.deepEqual(returnRequestPartLines(returnInput([{ transactionId: TX_A, quantity: 2 }]), origins([])), [{ partId: TX_A, quantity: 2, intakeNumbers: [] }]);
  });

  it("🔴 **같은 부품이 원장 줄 둘로 쪼개져 있으면 한 줄로 합친다** — 쪼갠 것은 우리이고 신청자는 5개를 보냈다", () => {
    const lines = returnRequestPartLines(
      returnInput([
        { transactionId: TX_A, quantity: 3 },
        { transactionId: TX_B, quantity: 2 },
      ]),
      origins([
        [TX_A, { partId: PART_7_ID, intakeNumber: D1 }],
        [TX_B, { partId: PART_7_ID, intakeNumber: D1 }],
      ]),
    );
    assert.deepEqual(lines, [{ partId: PART_7_ID, quantity: 5, intakeNumbers: [D1] }], "쪼개진 줄이 그대로 둘로 보인다");
  });

  it("🔴 합치면 **열쇠가 겹치지 않는다** — 화면이 이 값을 React 의 key 로 쓴다", () => {
    const lines = returnRequestPartLines(
      returnInput([
        { transactionId: TX_A, quantity: 1 },
        { transactionId: TX_B, quantity: 1 },
        { transactionId: TX_C, quantity: 4 },
      ]),
      origins([
        [TX_A, { partId: PART_7_ID, intakeNumber: D1 }],
        [TX_B, { partId: PART_22_ID, intakeNumber: D1 }],
        [TX_C, { partId: PART_7_ID, intakeNumber: D1 }],
      ]),
    );
    assert.equal(new Set(lines.map((l) => l.partId)).size, lines.length, "같은 열쇠가 두 줄에 있다");
    // 🔵 차례는 payload 에 적힌 차례다 — 부품 번호로 다시 세우지 않는다.
    assert.deepEqual(
      lines.map((l) => [l.partId, l.quantity]),
      [
        [PART_7_ID, 5],
        [PART_22_ID, 1],
      ],
    );
  });

  it("🔴 **못 되짚은 줄도 사라지지 않는다** — 수량이 조용히 빠지면 화면과 원장이 갈린다", () => {
    const lines = returnRequestPartLines(
      returnInput([
        { transactionId: TX_A, quantity: 2 },
        { transactionId: TX_B, quantity: 3 },
      ]),
      origins([[TX_A, { partId: PART_7_ID, intakeNumber: D1 }]]),
    );
    assert.equal(lines.length, 2, "되짚지 못한 줄이 목록에서 사라졌다");
    assert.deepEqual(lines[1], { partId: TX_B, quantity: 3, intakeNumbers: [] }, "못 되짚은 줄의 열쇠가 원장 줄 번호가 아니다");
    assert.equal(
      lines.reduce((a, l) => a + l.quantity, 0),
      5,
      "합계가 신청한 수량과 다르다",
    );
  });

  it("🔵 **반환이 아닌 종류는 빈 목록**이다 — 종류를 부르는 쪽이 또 가리지 않게", () => {
    const use: EntryInput = {
      type: "USE",
      occurredOn: "2026-11-26",
      intakeNumber: D1,
      noRepairCase: false,
      reason: "",
      purpose: "REPAIR",
      purposeText: "",
      note: "",
      lines: [{ partId: PART_7_ID, quantity: 2, chargeType: "PAID", note: "", actualQuantity: null }],
    };
    assert.deepEqual(returnRequestPartLines(use, origins([[TX_A, { partId: PART_7_ID, intakeNumber: D1 }]])), []);
  });

  /**
   * 🔴 **A/S 가 실제로 세우는 payload 를 그대로 먹여 본다.** 두 함수가 **같은 모양의 양쪽 끝**이라
   *    (`buildApiReturnRequest` 가 적고 `returnRequestPartLines` 가 읽는다), 한쪽이 칸 이름을 바꾸면
   *    화면에서 **줄이 통째로 사라지는데 오류는 하나도 안 난다.**
   */
  it("🔴 통로가 세우는 payload 를 그대로 읽어 **부품 줄이 선다**", () => {
    const parsed = parseApiStockRequest({
      type: "RETURN",
      requestKey: "AS-RET-2026-0001",
      intakeNumber: D1,
      requester: { sub: "kakao:00000", name: "예시 신청인" },
      lines: [{ no: 7, quantity: 5 }],
      note: "내일 가져다 드립니다",
    });
    assert.ok(parsed.ok, "본보기가 통로 검사에서 거절됐다 — 시험이 재는 것이 없다");
    const allocated = allocateReturnLines((parsed.value as ApiReturnRequestInput).lines, [taken(TX_A, PART_7, 3), taken(TX_B, PART_7, 4)], new Map());
    assert.ok(allocated.ok, "본보기를 원장 줄에 못 나눴다");
    const payload = buildApiReturnRequest(parsed.value as ApiReturnRequestInput, allocated.lines, "2026-11-26");

    const lines = returnRequestPartLines(
      payload,
      origins([
        [TX_A, { partId: PART_7_ID, intakeNumber: D1 }],
        [TX_B, { partId: PART_7_ID, intakeNumber: D1 }],
      ]),
    );
    assert.deepEqual(lines, [{ partId: PART_7_ID, quantity: 5, intakeNumbers: [D1] }], "저쪽이 보낸 「No. 7 을 5개」와 화면이 보는 줄이 갈렸다");
  });
});

/* ------------------------------------------------------------------ */

describe("② 🔴 **인수번호**가 선다 — 반환 payload 에는 그 칸이 아예 없다", () => {
  it("🔴 되짚은 원장 줄의 인수번호가 줄에 붙는다", () => {
    const lines = returnRequestPartLines(returnInput([{ transactionId: TX_A, quantity: 1 }]), origins([[TX_A, { partId: PART_7_ID, intakeNumber: D1 }]]));
    assert.deepEqual(lines[0].intakeNumbers, [D1]);
    assert.equal(returnRequestIntakeNumber(lines), D1);
  });

  it("🔵 같은 건에서 쪼개진 줄이 여럿이어도 **한 번만** 적힌다", () => {
    const lines = returnRequestPartLines(
      returnInput([
        { transactionId: TX_A, quantity: 1 },
        { transactionId: TX_B, quantity: 1 },
      ]),
      origins([
        [TX_A, { partId: PART_7_ID, intakeNumber: D1 }],
        [TX_B, { partId: PART_7_ID, intakeNumber: D1 }],
      ]),
    );
    assert.deepEqual(lines[0].intakeNumbers, [D1]);
  });

  it("🔴 **수리 건이 섞여 있으면 신청 전체의 인수번호는 빈 글자다** — 하나를 골라 적으면 나머지가 없는 것처럼 보인다", () => {
    const lines = returnRequestPartLines(
      returnInput([
        { transactionId: TX_A, quantity: 1 },
        { transactionId: TX_B, quantity: 1 },
      ]),
      origins([
        [TX_A, { partId: PART_7_ID, intakeNumber: D1 }],
        [TX_B, { partId: PART_22_ID, intakeNumber: D2 }],
      ]),
    );
    assert.equal(returnRequestIntakeNumber(lines), "", "둘 중 하나를 골라 적었다");
    // 🔵 그때도 **줄마다는 보인다** — 신청 전체에서만 말을 아낀다.
    assert.deepEqual(lines.map((l) => l.intakeNumbers), [[D1], [D2]]);
  });

  it("🔵 「수리 건 없음」으로 나간 줄을 되돌리면 **빈 글자를 지어내 담지 않는다**", () => {
    const lines = returnRequestPartLines(returnInput([{ transactionId: TX_A, quantity: 1 }]), origins([[TX_A, { partId: PART_7_ID, intakeNumber: "" }]]));
    assert.deepEqual(lines[0].intakeNumbers, []);
    assert.equal(returnRequestIntakeNumber(lines), "");
    assert.equal(returnSourceText(lines[0].intakeNumbers), "", "화면이 빈 자리를 만든다");
  });

  it("🔵 줄에 적는 글자 — 이름표가 있고, 없으면 빈 글자다", () => {
    assert.equal(returnSourceText([D1]), D1);
    assert.equal(returnSourceText([D1, D2]), `${D1}, ${D2}`);
    assert.equal(returnSourceText([]), "");
    assert.ok(RETURN_SOURCE_LABEL.trim().length > 0, "이름표가 비면 밑에 붙은 번호가 무엇인지 모른다");
  });
});

/* ------------------------------------------------------------------ */

describe("③ 🔴 「반환」 칸이 **음수로 안 간다** — 회차 집계가 부호를 뒤집어 준다", () => {
  it("🔴 반환은 delta 가 양수라 `sum(-delta)` 가 **음수**로 온다 — 뒤집어 받는다", () => {
    assert.equal(returnedQuantityOf(-5), 5, "화면에 「반환 −5」가 그대로 나간다");
  });

  it("🔴 **0 아래로는 안 내려간다** — 기록 취소 따위로 어긋나도 화면이 음수를 안 그린다", () => {
    assert.equal(returnedQuantityOf(3), 0);
    assert.equal(returnedQuantityOf(0), 0);
  });
});

/* ------------------------------------------------------------------ */

describe("④ 🔴 [반환 완료]가 원장에 **신청한 그대로** 쓴다", () => {
  /**
   * 🔴 화면은 수량을 **안 보낸다**(아래 ⑤). 그러면 서버는 `want` 가 `null` 이고, 반환은
   *    `buildIssueInput` 이 **payload 를 통째로** 원장에 넘긴다 — 그 길이 끊기면 담당자가
   *    [반환 완료]를 눌러도 **아무 줄도 안 들어가거나** 수량이 달라진다.
   */
  const payload = returnInput([
    { transactionId: TX_A, quantity: 3 },
    { transactionId: TX_B, quantity: 2 },
  ]);

  it("🔴 수량을 안 받으면 **payload 그대로** 원장에 간다", () => {
    const r = buildIssueInput(payload, null, new Map(), new Map());
    assert.ok(r.ok);
    assert.equal(r.plan.input, payload, "원장에 넘기는 입력이 신청 payload 가 아니다");
    assert.ok(r.plan.input !== null && r.plan.input.type === "RETURN");
    assert.deepEqual(
      r.plan.input.lines.map((l) => [l.transactionId, l.quantity]),
      [
        [TX_A, 3],
        [TX_B, 2],
      ],
      "원장으로 가는 줄이 신청한 줄과 다르다",
    );
  });

  it("🔴 **한 번에 끝난다** — 남은 수량이 0 이라 신청이 열린 채 남지 않는다", () => {
    const r = buildIssueInput(payload, null, new Map(), new Map());
    assert.ok(r.ok);
    assert.equal(r.plan.remaining, 0, "남은 수량이 있으면 신청이 `PARTIAL` 로 남아 [마감]을 눌러야 한다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑤ 🔴 **수량을 고칠 수 없다** — 신청한 그대로 받는다 (쓰는 분이 고치는 자리를 말한 적이 없다)", () => {
  const actions = codeOnly(src("src/components/stock/RequestActions.tsx"));

  it("🔴 반환이면 수량 입력 칸을 **안 그린다**", () => {
    const at = actions.indexOf('name={`q:${l.partId}`}');
    assert.notEqual(at, -1, "수량 칸을 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    const before = actions.slice(0, at);
    assert.ok(before.lastIndexOf("isReturn ? (") > before.lastIndexOf("{lines.map((l) => ("), "수량 칸이 반환 갈래 밖에 있다 — 반환 상자에서도 고칠 수 있다");
  });

  it("🔴 반환이면 **수량을 서버로 보내지도 않는다** — 없는 칸을 읽어 되채운 값이 나가면 안 된다", () => {
    const body = actions.split("const submitIssue = ")[1]?.split("\n  };")[0] ?? "";
    assert.ok(body.length > 0, "submitIssue 를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    const ret = body.indexOf("if (isReturn) {");
    const quantities = body.indexOf('out.set("quantities"');
    assert.notEqual(ret, -1, "반환 갈래가 사라졌다");
    assert.notEqual(quantities, -1, "수량을 싣는 줄이 사라졌다 — 시험이 낡았다");
    assert.ok(ret < quantities, "반환 갈래가 수량을 싣는 줄보다 뒤에 있다");
    const retBranch = body.slice(ret, body.indexOf("return;", ret));
    assert.ok(!retBranch.includes("readQuantities"), "반환이 없는 수량 칸을 읽는다");
    assert.ok(!retBranch.includes("quantities"), "반환이 수량을 보낸다 — 신청한 그대로가 아니게 된다");
  });

  it("🔵 **왜 못 고치는지 상자가 말한다** — 옆 상자는 수량을 받으므로, 안 적으면 고장으로 읽힌다", () => {
    assert.ok(RETURN_CONFIRM_NOTICE.includes("고칠 수 없"), "수량을 못 고친다는 말이 없다");
    assert.ok(actions.includes("RETURN_CONFIRM_NOTICE"), "상자가 그 안내를 안 그린다");
  });

  it("🔴 **사용 신청 쪽은 한 글자도 안 바뀌었다** — 칸을 비우면 아예 안 보낸다(= 남은 수량 전부)", () => {
    assert.ok(actions.includes('if (lines.some((l) => String(form.get(`q:${l.partId}`) ?? "").trim() !== "")) {'), "사용 쪽의 「한 칸도 안 적었으면 안 보낸다」가 바뀌었다");
    assert.ok(actions.includes("startTransition(() => confirmAction(out))"), "사용 쪽이 가던 길이 사라졌다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑥ 🔴 **결재가 켜져 있어도 반환에는 결재 단추가 안 선다**", () => {
  const page = codeOnly(src("src/app/(app)/requests/page.tsx"));
  const scope = codeOnly(src("src/lib/approval/request-scope.ts"));
  const actions = codeOnly(src("src/components/stock/RequestActions.tsx"));

  it("🔴 종류로 못 박혀 있다 — 갈래를 비우는 것만으로는 기존 「부품 불출」로 끌려간다", () => {
    assert.equal(isApprovalExemptRequestType("RETURN"), true);
    // 🔵 표본이 비어 공짜로 통과하지 않게, **면제가 아닌 종류**도 함께 센다.
    const exempt = ENTRY_TYPES.filter((t) => isApprovalExemptRequestType(t));
    assert.deepEqual(exempt, ["RETURN"], "면제되는 종류가 반환 하나가 아니다 — 결정이 바뀌었으면 시험도 함께 고쳐라");
  });

  it("🔴 화면이 단추를 고를 때 **면제를 먼저 묻는다** — 안 물으면 반환 줄이 [불출 신청]이 된다", () => {
    assert.ok(page.includes("!isApprovalExemptRequestType(r.type) && (inForceByScope.get(approvalRouteScopeForWorkflowKind(r.workflowKind)) ?? false)"), "줄마다의 결재 판정에서 면제가 빠졌다");
  });

  it("🔴 서버 쪽 문도 면제를 먼저 묻는다 — 화면만 고치면 옛 화면을 띄워 둔 탭에서 막힌다", () => {
    assert.ok(scope.includes('if (isApprovalExemptRequestType(row?.type ?? "USE")) return null;'), "[확인] 게이트가 면제를 안 묻는다");
  });

  it("🔴 반환 단추의 글자는 **결재 쪽 두 이름 중 어느 것도 아니다**", () => {
    assert.notEqual(RETURN_CONFIRM_BUTTON_LABEL, "확인");
    assert.notEqual(RETURN_CONFIRM_BUTTON_LABEL, "불출 신청");
    assert.ok(actions.includes("isReturn ? RETURN_CONFIRM_BUTTON_LABEL : partIssueConfirmLabel(approvalRequired)"), "반환 줄도 결재 쪽 이름표를 쓴다");
  });

  it("🔴 반환 상자에는 **「신청 사유」 칸이 없다** — 결재자에게 하는 말인데 결재가 없다", () => {
    // 🔵 **쓰이는 자리로 집는다** — 맨 위 import 줄에도 같은 글자가 있어 그것으로 집으면 헛통과한다.
    const at = actions.indexOf("{PART_ISSUE_REASON_LABEL}");
    assert.notEqual(at, -1, "「신청 사유」 칸을 찾지 못했다 — 시험이 낡았다");
    assert.ok(actions.slice(0, at).includes("{isReturn ? null : approvalRequired ? ("), "반환에도 「신청 사유」 칸이 선다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑦ 화면에 서는 글자 — 적힌 자리가 **한 곳**이다", () => {
  it("🔴 끝내는 단추는 [반환 완료]다 — 쓰는 분이 글자까지 정했다", () => {
    assert.equal(RETURN_CONFIRM_SUBMIT_LABEL, "반환 완료");
    assert.equal(RETURN_CONFIRM_BUTTON_LABEL, "반환");
  });

  it("🔴 글자를 화면에 **박아 두지 않았다** — 두 벌이 되면 고치는 날 한쪽만 바뀐다", () => {
    // 🔵 주석에 적힌 「반환 완료」는 설명이다. 재는 것은 **따옴표에 박힌 글자**.
    for (const file of ["src/components/stock/RequestActions.tsx", "src/components/stock/RequestManagerScreen.tsx"]) {
      assert.ok(!/["'`]반환 완료["'`]/.test(codeOnly(src(file))), `${file} 에 「반환 완료」가 글자로 박혀 있다`);
    }
    assert.ok(/["'`]반환 완료["'`]/.test(src("src/lib/stock/return-request-view.ts")), "글자가 적힌 그 한 곳이 사라졌다 — 시험이 낡았다");
  });

  it("🔴 신청 항목 표의 「불출」이 반환에서는 다른 말이다 — 부품이 나간 것이 아니라 들어온 것이다", () => {
    assert.notEqual(RETURN_ITEMS_DONE_HEADER, "불출");
    const screen = codeOnly(src("src/components/stock/RequestManagerScreen.tsx"));
    assert.ok(screen.includes('{isReturn ? RETURN_ITEMS_DONE_HEADER : "불출"}'), "머리글이 종류를 안 본다");
  });

  it("🔴 반환에는 **「가용」 칸이 아예 없다** — 재고를 쓰는 것이 아니라 더하는 일이라 빨간 경보가 늘 켜진다", () => {
    const screen = codeOnly(src("src/components/stock/RequestManagerScreen.tsx"));
    const at = screen.indexOf("지금 재고로는 남은 수량을 다 내줄 수 없습니다.");
    assert.notEqual(at, -1, "「가용」 칸의 경보 문구를 못 찾았다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(screen.slice(0, at).lastIndexOf("{isReturn ? null : (") > screen.slice(0, at).lastIndexOf("</td>"), "가용 칸이 반환에서도 선다");
  });

  it("🔵 상자의 제목·기다리는 글자도 한 벌에서 온다", () => {
    for (const label of [RETURN_CONFIRM_TITLE, RETURN_CONFIRM_BUSY_LABEL, RETURN_CONFIRM_NOTICE]) {
      assert.ok(label.trim().length > 0);
      // 🔴 영어 개발자 글자가 사람 화면에 나가지 않는다 (CLAUDE.md 10절).
      assert.ok(!/[A-Za-z_]{4,}/.test(label), `영문이 섞였다: ${label}`);
    }
    assert.ok(RETURN_CONFIRM_NOTICE.includes("승인 절차"), "결재를 안 탄다는 말이 없다 — 담당자가 결재를 기다린다");
  });

  it("🔴 「이 신청이 반환인가」를 묻는 자리가 **한 곳**이다 — 화면이 종류를 손으로 견주지 않는다", () => {
    assert.equal(isReturnRequest("RETURN"), true);
    for (const t of ENTRY_TYPES) if (t !== "RETURN") assert.equal(isReturnRequest(t), false, t);
    for (const file of ["src/components/stock/RequestActions.tsx", "src/components/stock/RequestManagerScreen.tsx"]) {
      assert.ok(!/===\s*["']RETURN["']/.test(codeOnly(src(file))), `${file} 이 종류를 손으로 견준다 — 같은 대접을 받을 종류가 늘면 한 자리가 빠진다`);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("⑧ 🔴 목록의 「무엇에」 칸에도 인수번호가 선다", () => {
  const screen = codeOnly(src("src/components/stock/RequestManagerScreen.tsx"));

  it("🔴 반환 갈래가 있다 — 그 전에는 `-` 만 섰다", () => {
    const body = screen.split("function aboutOf(")[1]?.split("\n}")[0] ?? "";
    assert.ok(body.length > 0, "aboutOf 를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(/isReturnRequest\(r\.type\)\s*\?\s*r\.intakeNumber/.test(body), "반환에서 인수번호를 안 적는다");
    // 🔵 다른 갈래는 그대로다 — 이 조각은 **더하기만** 했다.
    for (const head of ["수리 건 없음", "빌려준 곳", "사유"]) assert.ok(body.includes(head), `${head} 갈래가 사라졌다`);
  });

  it("🔴 줄마다의 수리 건도 **같은 조각**이 그린다 — 목록과 상자가 두 벌이 되지 않게", () => {
    assert.ok(screen.includes("<ReturnSourceLine intakeNumbers={l.returnIntakeNumbers} />"), "목록의 신청 항목에 수리 건 줄이 없다");
    assert.ok(codeOnly(src("src/components/stock/RequestActions.tsx")).includes("<ReturnSourceLine intakeNumbers={l.returnIntakeNumbers} />"), "확인 상자에 수리 건 줄이 없다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑨ 🔴 서버가 실제로 **되짚어** 내려보낸다 — 안 하면 위의 모든 규칙이 빈 입력만 받는다", () => {
  const requests = codeOnly(src("src/lib/stock/requests.ts"));

  it("🔴 원장 줄에서 **부품과 인수번호**를 읽는다 — 둘 중 하나라도 빠지면 화면에 그릴 것이 없다", () => {
    assert.ok(requests.includes("async function returnLineOriginsOf("), "되짚는 질의가 없다");
    assert.ok(requests.includes("select({ id: stockTransactions.id, partId: stockTransactions.partId, intakeNumber: stockEntries.intakeNumber })"), "되짚는 질의가 읽는 칸이 바뀌었다");
    assert.ok(requests.includes("innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))"), "인수번호가 있는 원장 건과 안 잇는다");
  });

  it("🔴 목록을 빚는 길이 그 값을 **쓴다** — 읽어 놓고 안 넘기면 줄이 그대로 빈다", () => {
    assert.ok(requests.includes("const origins = await returnLineOriginsOf(returnTransactionIdsOf(inputs));"), "목록이 되짚지 않는다");
    assert.ok(requests.includes("toRow(r, names, issued.get(r.id) ?? new Map(), origins)"), "되짚은 값을 줄로 안 넘긴다");
  });

  it("🔴 **반환이 한 건도 없으면 질의를 안 보낸다** — 목록의 거의 전부가 사용 신청이다", () => {
    const body = requests.split("async function returnLineOriginsOf(")[1]?.split("\n}")[0] ?? "";
    assert.ok(body.includes("if (ids.length === 0) return out;"), "번호가 없어도 질의를 보낸다");
  });

  it("🔵 **요약 글자에도 들어간다** — 감사 로그와 알림 종이 그 글자를 그대로 쓴다", () => {
    assert.ok(requests.includes("buildRequestSummary(input, names, origins)"), "신청을 만들 때 되짚은 값을 요약에 안 넘긴다");
  });
});

/* ------------------------------------------------------------------ */

/**
 * ============================================================================
 * ⑩ 🔴 A/S 의 [이 수리 건의 반출 신청] 목록에 **반환 줄도 걸린다** (2026-11-26)
 * ============================================================================
 * 쓰는 분: 「반환 요청한 것도 [수리건 상세]의 [이 수리건의 반출 신청]에 **뜨도록**」. 그 목록은
 * `GET /api/v1/stock-requests?intake=…` 로 걸리는데, **반환 payload 에는 `intakeNumber` 칸이 아예
 * 없다** — 그 칸 하나로 거르던 질의는 반환을 **한 줄도** 못 찾는다.
 *
 * 🔴 **2026-11-26 실측으로 그 구멍을 눈으로 봤다**: 같은 인수번호로 물었더니 19줄이 아니라 **17줄**이
 *    돌아왔고 전부 `USE` 였다. 같은 건에 서 있던 반환 신청 2건은 응답에 없었다.
 * 🔴 **오류가 하나도 안 난다.** 저쪽 화면은 그냥 「없다」고 말하고, 올린 사람은 제 요청이 사라진 줄
 *    안다 — 거기서 [요청 취소]를 누를 길도 함께 사라진다.
 * ============================================================================
 */
describe("⑩ 🔴 인수번호로 물으면 **반환 신청도 걸린다**", () => {
  const requests = codeOnly(src("src/lib/stock/requests.ts"));

  it("🔴 조건이 **둘**이다 — payload 의 칸 하나로는 반환이 안 걸린다", () => {
    assert.ok(
      requests.includes("or(inArray(sql`${stockRequests.payload}->>'intakeNumber'`, unique), returnRequestMatchesIntake(unique))"),
      "인수번호 조회가 반환 조건을 안 건다 — A/S 의 [이 수리 건의 반출 신청]에서 반환 줄이 조용히 사라진다",
    );
  });

  const body = requests.split("function returnRequestMatchesIntake(")[1]?.split("\n}")[0] ?? "";

  it("🔴 반환 줄이 가리키는 **원장 줄**을 되짚어 건다", () => {
    assert.ok(body.length > 0, "그 조건을 짓는 함수를 못 찾았다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(body.includes("join stock_transactions return_tx"), "원장 줄과 안 잇는다");
    assert.ok(body.includes("join stock_entries return_entry"), "인수번호가 있는 원장 건과 안 잇는다");
    assert.ok(body.includes("return_entry.intake_number in"), "인수번호로 안 거른다");
  });

  it("🔴 **종류를 함께 건다** — 안 걸면 사용 신청의 부품 id 를 원장 줄 번호로 맞춰 보게 된다", () => {
    assert.ok(/= 'RETURN'/.test(body), "종류 조건이 사라졌다");
  });

  it("🔴 **깨진 값 하나로 응답이 통째로 500 이 되지 않는다** — 캐스팅이 아니라 글자로 견준다", () => {
    assert.ok(body.includes("return_tx.id::text = return_line ->> 'transactionId'"), "uuid 로 캐스팅한다 — payload 에 모양이 깨진 글자가 하나라도 있으면 그 수리 건의 응답이 통째로 터진다");
    assert.ok(!/\)::uuid/.test(body), "uuid 캐스팅이 돌아왔다");
  });

  it("🔴 `lines` 가 배열이 아닌 payload(조정·소유 옮김)에서도 안 터진다 — `and` 가 아니라 `case` 로 막는다", () => {
    assert.ok(body.includes("case when jsonb_typeof"), "배열이 아닌 payload 를 그대로 펴려 한다");
    assert.ok(body.includes("else '[]'::jsonb end"), "배열이 아닐 때 빈 배열로 안 눕힌다");
  });
});
