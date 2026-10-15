import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_STATUS_KEYS, buildStatusResponse, parseStatusKeys, toApiRequestStatus, type RequestStatusSource } from "../src/lib/api/stock-request-status";
import { checkBearerToken } from "../src/lib/api/token-gate";
import { env } from "../src/lib/env";
import { CLOSED_REQUEST_LABEL, REQUEST_STATUS_LABEL } from "../src/lib/stock/codes";

/**
 * A/S 가 **올린 신청의 지금 상태를 물어 가는 통로**의 울타리 (2026-10-15, `GET /api/v1/stock-requests`).
 *
 * 🔴 올리는 통로와 같은 까닭으로 규칙을 전부 순수 함수에 모아 두고 여기서 덮는다 — 통로 파일은
 *    `server-only` 를 거쳐 들어가 `npm test` 가 **불러올 수 없다**(`tests/api-stock-requests.test.ts` 머리말).
 * 🔵 덮는 것 다섯: 여러 열쇠 · 없는 열쇠 · 상한 · 마감 판정 · 토큰(읽기 전용).
 */

const LINE = { partNo: 165, partName: "AMP-DEH-DV2H(13M)", quantity: 2, issued: 0 };

const SOURCE: RequestStatusSource = {
  id: "0c0f1111-1111-4111-8111-111111111111",
  type: "USE",
  status: "PENDING",
  requestedAt: "2026-10-15T01:00:00.000Z",
  lines: [LINE],
  decidedByName: null,
  decidedAt: null,
  decisionNote: "",
  hold: null,
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
    assert.deepEqual(Object.keys(toApiRequestStatus("AS-1", source())).sort(), ["closed", "decision", "hold", "id", "lines", "requestKey", "requestedAt", "status", "type"].sort());
  });

  it("🔴 상태는 코드와 **사람이 읽을 글자**를 함께 — 글자는 화면이 쓰는 표에서 온다", () => {
    assert.deepEqual(toApiRequestStatus("AS-1", source()).status, { code: "PENDING", label: REQUEST_STATUS_LABEL.PENDING });
    assert.deepEqual(toApiRequestStatus("AS-1", source({ status: "REJECTED" })).status, { code: "REJECTED", label: REQUEST_STATUS_LABEL.REJECTED });
  });

  it("🔴 줄마다 **요청 수량과 이미 나간 수량** (남은 수량은 뺄셈이라 칸을 두지 않는다)", () => {
    const q = toApiRequestStatus("AS-1", source({ status: "PARTIAL", lines: [{ ...LINE, quantity: 8, issued: 5 }] }));
    assert.deepEqual(q.lines, [{ no: 165, name: "AMP-DEH-DV2H(13M)", quantity: 8, issued: 5 }]);
  });

  it("그 사이 지워진 부품은 번호가 null 이다 — 지어내지 않는다", () => {
    const q = toApiRequestStatus("AS-1", source({ lines: [{ partNo: null, partName: "(지워진 부품)", quantity: 1, issued: 0 }] }));
    assert.equal(q.lines[0].no, null);
    assert.equal(q.lines[0].name, "(지워진 부품)");
  });

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
    for (const status of ["PENDING", "CONFIRMING", "PARTIAL", "ON_HOLD", "REJECTED", "CANCELLED"] as const) {
      const q = toApiRequestStatus("AS-1", source({ status, lines: [{ ...LINE, quantity: 8, issued: 5 }] }));
      assert.equal(q.closed, false, status);
      assert.equal(q.status.label, REQUEST_STATUS_LABEL[status], status);
    }
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
