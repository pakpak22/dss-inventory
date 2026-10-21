import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REQUEST_SOURCES, type RequestStatus } from "../src/db/schema/stock-requests";
import { judgeApiCancel, parseApiCancelRequest, toApiCancelResponse, type CancelSubject } from "../src/lib/api/stock-request-cancel";
import { toApiRequestStatus, type RequestStatusSource } from "../src/lib/api/stock-request-status";
import { MAX_KEY } from "../src/lib/api/stock-requests";
import { checkBearerToken } from "../src/lib/api/token-gate";
import { env } from "../src/lib/env";
import { CANCELLABLE_REQUEST_SOURCES, EXTERNALLY_CANCELLABLE_REQUEST_SOURCES, REQUEST_STATUS_LABEL } from "../src/lib/stock/codes";

/**
 * A/S 가 **제가 올린 신청을 거두는 통로**의 울타리 (2026-10-16, `POST /api/v1/stock-requests/cancel`).
 *
 * 🔴 올리는·되읽는 통로와 같은 까닭으로 규칙을 전부 순수 함수에 모아 두고 여기서 덮는다 — 통로 파일은
 *    `server-only` 를 거쳐 들어가 `npm test` 가 **불러올 수 없다**(`tests/api-stock-requests.test.ts` 머리말).
 * 🔵 덮는 것 일곱: 본문 검사 · 조건 셋이 **각각 다른 말** · 두 번 보내도 안전 · 남의 신청 · 재고 관리에서
 *    올린 신청 · 출처 한 벌이 빠짐없이 덮는가 · 토큰(쓰기 전용).
 */

const SUB = "portal-sub-aaaa-1111";
const OTHER_SUB = "portal-sub-bbbb-2222";

const subject = (over: Partial<CancelSubject> = {}): CancelSubject => ({ source: "AS", status: "PENDING", requesterSub: SUB, ...over });

/** 거절을 기대하는 자리. 🔴 통과하면 그 자체가 실패다(울타리가 뚫린 것). */
const denied = (found: CancelSubject | null, sub = SUB) => {
  const j = judgeApiCancel(found, sub);
  assert.equal(j.ok, false, "거둬 주면 안 되는 신청인데 통과했다");
  return j.ok ? ({} as never) : j;
};

/** 통과를 기대하는 자리. */
const allowed = (found: CancelSubject, sub = SUB) => {
  const j = judgeApiCancel(found, sub);
  assert.ok(j.ok, `거둘 수 있어야 하는데 거절했다: ${j.ok ? "" : j.message}`);
  return j;
};

describe("받는 값 — 열쇠와 올린 사람의 포털 번호 둘뿐 (2026-10-16)", () => {
  it("둘 다 오면 받는다", () => {
    const r = parseApiCancelRequest({ requestKey: "AS-REQ-2026-0007", requester: { sub: SUB } });
    assert.ok(r.ok, r.ok ? "" : r.message);
    assert.deepEqual(r.value, { requestKey: "AS-REQ-2026-0007", requesterSub: SUB });
  });

  it("🔵 다듬기가 올리는 통로와 같다 — 앞뒤 공백을 떼고 같은 길이로 자른다", () => {
    const r = parseApiCancelRequest({ requestKey: `  ${"A".repeat(MAX_KEY + 50)}  `, requester: { sub: "  s  " } });
    assert.ok(r.ok, r.ok ? "" : r.message);
    assert.equal(r.value.requestKey, "A".repeat(MAX_KEY), "올릴 때 잘려 저장된 열쇠를 거둘 때 안 자르면 같은 글자로 보내도 못 찾는다");
    assert.equal(r.value.requesterSub, "s");
  });

  it("🔴 열쇠가 없으면 거절한다 — 조용히 아무것이나 거두지 않는다", () => {
    for (const body of [{}, { requestKey: "" }, { requestKey: "   " }, { requestKey: 7 }, { requester: { sub: SUB } }]) {
      const r = parseApiCancelRequest({ ...body, requester: { sub: SUB } });
      assert.equal(r.ok, false, JSON.stringify(body));
      if (!r.ok) assert.match(r.message, /requestKey/);
    }
  });

  it("🔴 포털 번호가 없으면 거절한다 — 본인인지 가릴 길이 사라진다", () => {
    for (const requester of [undefined, {}, { sub: "" }, { sub: 3 }, "홍길동"]) {
      const r = parseApiCancelRequest({ requestKey: "AS-1", requester });
      assert.equal(r.ok, false, JSON.stringify(requester ?? null));
      if (!r.ok) assert.match(r.message, /requester\.sub/);
    }
  });

  it("본문이 객체가 아니면 거절한다", () => {
    for (const raw of [null, [], "문자열", 7]) {
      assert.equal(parseApiCancelRequest(raw).ok, false, JSON.stringify(raw));
    }
  });
});

describe("🔴 거둘 수 있는 조건 셋 — 하나라도 어긋나면 각각 다른 말로 (2026-10-16)", () => {
  it("① 그 열쇠의 신청이 있을 것 — 없으면 404", () => {
    const d = denied(null);
    assert.equal(d.status, 404);
    assert.equal(d.error, "not_found");
    assert.match(d.message, /requestKey/, "오타를 고칠 수 있게 무엇을 보내야 하는지 적는다");
  });

  it("🔴 없는 열쇠를 「거뒀다」로 답하지 않는다 — 저쪽이 거둔 줄 알고 끝낸다", () => {
    assert.equal(judgeApiCancel(null, SUB).ok, false);
  });

  it("② 올린 사람 본인일 것 — 남의 신청은 403", () => {
    const d = denied(subject({ requesterSub: OTHER_SUB }));
    assert.equal(d.status, 403);
    assert.equal(d.error, "forbidden");
    assert.match(d.message, /올린 사람/);
  });

  it("🔴 포털 번호가 비어 있는 신청은 누구의 것도 아니다 — 빈 값끼리 맞아떨어지지 않는다", () => {
    assert.equal(denied(subject({ requesterSub: null })).status, 403);
    assert.equal(denied(subject({ requesterSub: null }), "").status, 403, "빈 번호로 물어도 통과하면 안 된다");
  });

  it("③ 아직 대기일 것 — 나갔거나 집혔거나 결정된 신청은 409 이고, **지금 상태를 글자로** 말해 준다", () => {
    for (const status of ["CONFIRMING", "PARTIAL", "CONFIRMED", "REJECTED", "ON_HOLD", "IN_APPROVAL"] as const satisfies readonly RequestStatus[]) {
      const d = denied(subject({ status }));
      assert.equal(d.status, 409, status);
      assert.equal(d.error, "conflict", status);
      assert.ok(d.message.includes(REQUEST_STATUS_LABEL[status]), `「${REQUEST_STATUS_LABEL[status]}」가 문구에 없다: ${d.message}`);
    }
  });

  it("본인이 낸 대기 신청은 거둬진다", () => {
    const j = allowed(subject());
    assert.equal(j.already, false, "이번 호출이 거둔 것이다");
    assert.equal(j.target.status, "PENDING", "거둘 줄을 그대로 돌려줘야 통로가 다시 찾지 않는다");
  });

  it("🔴 네 거절이 **서로 다른 말**이다 — 무엇이 어긋났는지 저쪽 화면에 그대로 떠야 한다", () => {
    const messages = [
      denied(null).message,
      denied(subject({ source: "INVENTORY" })).message,
      denied(subject({ requesterSub: OTHER_SUB })).message,
      denied(subject({ status: "PARTIAL" })).message,
    ];
    assert.equal(new Set(messages).size, 4, `거절 문구가 겹친다: ${JSON.stringify(messages)}`);
  });
});

describe("🔴 이미 거둔 것은 오류가 아니다 — 두 번 보내도 안전 (2026-10-16)", () => {
  it("같은 요청이 두 번 오면 「거둬져 있다」를 그대로 돌려준다", () => {
    const j = allowed(subject({ status: "CANCELLED" }));
    assert.equal(j.already, true, "올리는 통로의 created:false 와 같은 정신이다");
  });

  it("🔴 그래도 출처·본인을 **먼저** 본다 — 남의 신청 상태를 떠보는 창이 되면 안 된다", () => {
    assert.equal(denied(subject({ status: "CANCELLED", requesterSub: OTHER_SUB })).error, "forbidden");
    assert.equal(denied(subject({ status: "CANCELLED", source: "INVENTORY" })).error, "forbidden");
  });
});

describe("🔴 재고 관리에서 올린 신청은 이 통로로 거둬지지 않는다 (2026-10-16)", () => {
  it("출처가 AS 가 아니면 403 이고, 어디서 거두면 되는지 말해 준다", () => {
    const d = denied(subject({ source: "INVENTORY" }));
    assert.equal(d.status, 403);
    assert.equal(d.error, "forbidden");
    assert.match(d.message, /재고 관리 화면/);
  });

  it("🔴 본인 번호가 적혀 있어도 출처가 다르면 못 거둔다 — 판정을 「열쇠가 없을 것」에 기대지 않는다", () => {
    assert.equal(judgeApiCancel(subject({ source: "INVENTORY", requesterSub: SUB }), SUB).ok, false);
  });

  it("바깥 통로로 거둘 수 있는 출처는 A/S 뿐이다", () => {
    assert.deepEqual([...EXTERNALLY_CANCELLABLE_REQUEST_SOURCES], ["AS"]);
  });

  it("🔴 두 묶음이 겹치지 않고 **빠짐없이 덮는다** — 어느 쪽에도 없는 출처는 아무도 못 거두는 신청이 된다", () => {
    const screen = [...CANCELLABLE_REQUEST_SOURCES] as string[];
    const external = [...EXTERNALLY_CANCELLABLE_REQUEST_SOURCES] as string[];
    assert.deepEqual(
      [...screen, ...external].sort(),
      [...REQUEST_SOURCES].sort(),
      "거두는 문은 출처마다 **정확히 하나**여야 한다 (겹치면 두 곳에서 접히고, 비면 영영 못 접는다)",
    );
  });
});

describe("돌려주는 모양 — 상태 통로와 같은 줄 (2026-10-16)", () => {
  const SOURCE: RequestStatusSource = {
    id: "0c0f1111-1111-4111-8111-111111111111",
    type: "USE",
    status: "CANCELLED",
    intakeNumber: "D260701",
    requesterSub: "portal-sub-aaaa-1111",
    requestedByName: "예시 신청자",
    requestedAt: "2026-10-16T01:00:00.000Z",
    // 🔵 2026-10-22 에 **요청 비고**가 최상위 칸으로 섰다 — 거두는 통로도 상태 통로가 빚은 줄을
    //    그대로 싣는다(아래 첫 시험). 안 적고 올린 신청이 기본이라 빈 글자다.
    note: "",
    // 🔵 2026-10-21 에 줄이 넓어졌다 — 부품 쪽 값 다섯(자세한 내용 넷 · 소유)과 줄 쪽 값 유상/무상.
    //    거두는 통로는 **상태 통로가 빚은 줄을 그대로** 싣기만 하므로(아래 첫 시험), 여기서는 모양만 맞춘다.
    lines: [
      {
        partNo: 165,
        partName: "예시 증폭기 PCB",
        quantity: 2,
        issued: 0,
        customerName: "증폭기 조립품",
        name2: "13M",
        kyosanPartNo: "KY-7788",
        drawingNo: "DWG-1001",
        owner: "KYOSAN",
        chargeType: "PAID",
      },
    ],
    decidedByName: "예시 신청자",
    decidedAt: "2026-10-16T02:00:00.000Z",
    decisionNote: "",
    hold: null,
    // 🔵 거둔 신청에는 살아 있는 결재건이 없다 — 바깥에서 거둘 수 있는 것은 아직 대기인 신청뿐이다(통로의 주석).
    issueLock: null,
  };

  it("🔵 받는 쪽이 모양 두 벌을 다루지 않게 — 상태 통로가 주는 줄 그대로다", () => {
    const row = toApiRequestStatus("AS-REQ-2026-0007", SOURCE);
    const res = toApiCancelResponse(true, row);
    assert.deepEqual(res.request, row);
    assert.equal(res.request.status.code, "CANCELLED");
    assert.equal(res.request.status.label, REQUEST_STATUS_LABEL.CANCELLED);
    assert.equal(res.request.requestKey, "AS-REQ-2026-0007");
    // 🔵 줄의 칸은 **상태 통로가 정한다** — 여기서 다시 적으면 저쪽이 칸을 늘린 날 이 시험만 옛것이 되고,
    //    「같은 줄 모양」이라는 이 조각의 뜻은 바로 위 `deepEqual(res.request, row)` 가 이미 못 박고 있다.
    assert.deepEqual(res.request.lines, toApiRequestStatus("AS-REQ-2026-0007", SOURCE).lines);
    assert.equal(res.request.lines[0].no, 165);
    assert.equal(res.request.lines[0].name, "예시 증폭기 PCB");
  });

  it("🔴 **신청자도 그대로 실린다** — 거둔 뒤에도 저쪽이 「내 줄」을 가릴 수 있어야 한다 (2026-10-16)", () => {
    const res = toApiCancelResponse(true, toApiRequestStatus("AS-REQ-2026-0007", SOURCE));
    assert.deepEqual(res.request.requester, { sub: "portal-sub-aaaa-1111", name: "예시 신청자" });
  });

  it("🔴 `cancelled` 는 **이번 호출이 거뒀나**다 — 두 번째 호출은 false 이고, 상태는 둘 다 CANCELLED 다", () => {
    const row = toApiRequestStatus("AS-REQ-2026-0007", SOURCE);
    assert.equal(toApiCancelResponse(true, row).cancelled, true);
    assert.equal(toApiCancelResponse(false, row).cancelled, false);
    assert.equal(toApiCancelResponse(false, row).request.status.code, "CANCELLED", "지금 상태를 말하는 칸은 언제나 status 다");
  });
});

/**
 * 🔴 **쓰기 토큰으로 연다.** 재고를 한 개도 움직이지 않지만 **신청의 상태를 바꾼다** — 읽기 토큰은
 *    부품 목록을 가져가는 여러 시스템이 나눠 쓰는 값이라, 그것으로 남의 신청을 접게 둘 수 없다.
 */
describe("🔴 쓰기 토큰 전용 — 읽기 토큰으로는 못 거두고, 토큰이 없으면 닫힌다 (2026-10-16)", () => {
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

  it("🔴 쓰기 토큰이 설정에 없으면 열어 두지 않고 닫는다 (503)", () => {
    withEnv({ INVENTORY_WRITE_TOKEN: undefined, INVENTORY_API_TOKEN: READ }, () => {
      const d = checkBearerToken(env.inventoryWriteToken, `Bearer ${WRITE}`);
      assert.ok(d, "토큰이 없는데 통로가 열렸다");
      assert.equal(d.status, 503);
      assert.equal(d.error, "api_closed");
    });
  });

  it("🔴 읽기 토큰으로 이 통로를 두드리면 401 — 두 값이 다른 환경변수에서 온다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.notEqual(env.inventoryApiToken, env.inventoryWriteToken);
      const d = checkBearerToken(env.inventoryWriteToken, `Bearer ${READ}`);
      assert.ok(d, "읽기 토큰이 거두는 통로를 지나갔다");
      assert.equal(d.status, 401);
      assert.equal(d.error, "unauthorized");
    });
  });

  it("맞는 쓰기 토큰은 지나간다 — 올리는 통로와 같은 문이다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.equal(checkBearerToken(env.inventoryWriteToken, `Bearer ${WRITE}`), null);
    });
  });
});
