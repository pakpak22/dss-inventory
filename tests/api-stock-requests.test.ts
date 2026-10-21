import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApiUseRequest, parseApiStockRequest, resolveApiRequestLines, toApiStockRequest, type ApiPartRow } from "../src/lib/api/stock-requests";
import { checkBearerToken } from "../src/lib/api/token-gate";
import { env } from "../src/lib/env";
import { CANCELLABLE_REQUEST_SOURCES, CHARGE_LABEL, CHARGE_TYPES, REQUEST_SOURCE_LABEL, canCancelRequest } from "../src/lib/stock/codes";
import { MAX_LINES, MAX_QTY } from "../src/lib/stock/form";
import { REQUEST_SOURCES } from "../src/db/schema/stock-requests";

/**
 * A/S 가 부르는 **반출 신청 통로**의 울타리 (2026-10-15, `POST /api/v1/stock-requests`).
 *
 * 🔴 **바깥이 처음으로 쓰기를 하는 자리라** 규칙을 전부 순수 함수에 모아 두고 여기서 덮는다. DB 에 붙지 않는다.
 * 🔵 통로 파일 자체는 `server-only` 모듈(`lib/api/auth.ts`)을 거쳐 들어가므로 `npm test` 가 **불러올 수 없다**.
 *    그래서 토큰 판정도 순수 함수로 떼어 두었고(`lib/api/token-gate.ts`), 아래 토큰 묶음이 그것을 **실제 env 값**으로 확인한다.
 */

const BODY = {
  requestKey: "AS-REQ-2026-0007",
  intakeNumber: "d260701",
  requester: { sub: "kakao:12345", name: "홍길동" },
  lines: [
    { no: 165, quantity: 2, chargeType: "PAID" },
    { no: 7, quantity: 1, chargeType: "FREE" },
  ],
  reason: "증폭기 교체",
  note: "오후에 가져갑니다",
};

const message = (raw: unknown): string => {
  const r = parseApiStockRequest(raw);
  assert.equal(r.ok, false, "거절할 본문인데 통과했다");
  return r.ok ? "" : r.message;
};

describe("받는 값 — 제대로 온 본문 (2026-10-15)", () => {
  it("요청 번호·인수번호·신청자·줄을 그대로 받고, 인수번호는 대문자로 맞춘다", () => {
    const r = parseApiStockRequest(BODY);
    assert.ok(r.ok);
    assert.equal(r.value.requestKey, "AS-REQ-2026-0007");
    assert.equal(r.value.intakeNumber, "D260701", "소문자로 와도 저장은 대문자 — 화면 폼과 같은 관례");
    assert.deepEqual(r.value.requester, { sub: "kakao:12345", name: "홍길동" });
    assert.deepEqual(r.value.lines, [
      { no: 165, quantity: 2, chargeType: "PAID" },
      { no: 7, quantity: 1, chargeType: "FREE" },
    ]);
    assert.equal(r.value.reason, "증폭기 교체");
    assert.equal(r.value.note, "오후에 가져갑니다");
  });

  it("사유·메모는 선택이다 — 없으면 빈 글자", () => {
    const r = parseApiStockRequest({ ...BODY, reason: undefined, note: undefined });
    assert.ok(r.ok);
    assert.equal(r.value.reason, "");
    assert.equal(r.value.note, "");
  });

  it("앞뒤 공백은 떼고 받는다", () => {
    const r = parseApiStockRequest({ ...BODY, requestKey: "  AS-1  ", requester: { sub: " kakao:9 ", name: " 김아무개 " } });
    assert.ok(r.ok);
    assert.equal(r.value.requestKey, "AS-1");
    assert.deepEqual(r.value.requester, { sub: "kakao:9", name: "김아무개" });
  });
});

describe("🔴 거절 — 무엇이 틀렸는지 말한다, 조용히 건너뛰지 않는다", () => {
  it("본문이 객체가 아니면 거절", () => {
    assert.match(message("hello"), /JSON 객체/);
    assert.match(message([BODY]), /JSON 객체/);
  });

  it("요청 번호가 없으면 거절 — 열쇠가 없으면 두 번 보냈을 때 두 번 선다", () => {
    assert.match(message({ ...BODY, requestKey: "" }), /requestKey/);
    assert.match(message({ ...BODY, requestKey: undefined }), /requestKey/);
  });

  it("인수번호 모양이 틀리면 거절 (D + 숫자 6자리)", () => {
    assert.match(message({ ...BODY, intakeNumber: "260701" }), /intakeNumber/);
    assert.match(message({ ...BODY, intakeNumber: "D26070" }), /intakeNumber/);
    assert.match(message({ ...BODY, intakeNumber: "" }), /intakeNumber/);
  });

  it("신청자의 포털 번호와 이름은 둘 다 있어야 하고, 각각 다른 말로 거절한다", () => {
    const noSub = message({ ...BODY, requester: { name: "홍길동" } });
    const noName = message({ ...BODY, requester: { sub: "kakao:1" } });
    assert.match(noSub, /requester\.sub/);
    assert.match(noName, /requester\.name/);
    assert.notEqual(noSub, noName);
  });

  it("🔴 줄 0개·없는 번호 모양·0개·소수는 **각각 다른 말**로 거절한다", () => {
    const empty = message({ ...BODY, lines: [] });
    const badNo = message({ ...BODY, lines: [{ no: 0, quantity: 1 }] });
    const zero = message({ ...BODY, lines: [{ no: 165, quantity: 0 }] });
    const fraction = message({ ...BODY, lines: [{ no: 165, quantity: 1.5 }] });
    assert.match(empty, /비어 있습니다/);
    assert.match(badNo, /no 는/);
    assert.match(zero, /quantity/);
    assert.match(fraction, /quantity/);
    assert.equal(new Set([empty, badNo, zero, fraction]).size, 4, "네 가지가 같은 말로 거절되면 A/S 쪽에서 무엇을 고칠지 모른다");
  });

  it("줄은 배열이어야 한다", () => {
    assert.match(message({ ...BODY, lines: undefined }), /lines 는/);
    assert.match(message({ ...BODY, lines: "165" }), /lines 는/);
  });

  it(`한 건에 ${MAX_LINES}줄까지 — 화면과 같은 상한이다`, () => {
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => ({ no: i + 1, quantity: 1, chargeType: "FREE" }));
    assert.match(message({ ...BODY, lines: many }), new RegExp(`${MAX_LINES}줄`));
    const just = parseApiStockRequest({ ...BODY, lines: many.slice(0, MAX_LINES) });
    assert.ok(just.ok, "딱 상한까지는 받는다");
  });

  it(`수량 상한도 화면과 같다 (${MAX_QTY})`, () => {
    assert.ok(parseApiStockRequest({ ...BODY, lines: [{ no: 1, quantity: MAX_QTY, chargeType: "PAID" }] }).ok);
    assert.match(message({ ...BODY, lines: [{ no: 1, quantity: MAX_QTY + 1, chargeType: "PAID" }] }), /quantity/);
  });

  it("🔴 글자로 온 숫자는 받지 않는다 — 기계가 보내는 값이라 조용히 고쳐 주는 편이 더 위험하다", () => {
    assert.match(message({ ...BODY, lines: [{ no: "165", quantity: 1, chargeType: "FREE" }] }), /no 는/);
    assert.match(message({ ...BODY, lines: [{ no: 165, quantity: "1", chargeType: "FREE" }] }), /quantity/);
  });

  it("같은 부품이 두 줄이면 거절한다 — 한 줄에 합치게 한다", () => {
    assert.match(
      message({
        ...BODY,
        lines: [
          { no: 165, quantity: 1, chargeType: "FREE" },
          { no: 165, quantity: 2, chargeType: "FREE" },
        ],
      }),
      /두 번 들어 있습니다/,
    );
  });

  it("몇 번째 줄이 틀렸는지 알려 준다", () => {
    assert.match(
      message({
        ...BODY,
        lines: [
          { no: 1, quantity: 1, chargeType: "FREE" },
          { no: 2, quantity: 0, chargeType: "FREE" },
        ],
      }),
      /2번째 줄/,
    );
  });
});

/**
 * 🔴 **유상·무상은 A/S 가 줄마다 보낸다 — 필수이고 기본값이 없다** (2026-10-15 담당자 결정).
 *
 * 담당자: 「한 건 안에서 부품마다 다른 일이 실제로 있다」. 그래서 건 단위가 아니라 줄 단위다.
 * 🔴 안 보낸 것을 한쪽으로 채워 주면 **틀린 청구가 조용히** 선다 — 재고가 어긋나는 것보다 늦게 드러난다.
 */
describe("🔴 유상·무상 — 줄마다, 필수, 기본값 없음 (2026-10-15)", () => {
  const line = (over: Record<string, unknown>) => ({ ...BODY, lines: [{ no: 165, quantity: 1, ...over }] });

  it("🔴 빠지면 거절한다 — 다른 거절들과 **다른 말**로", () => {
    const missing = message(line({}));
    assert.match(missing, /chargeType/);
    assert.match(missing, /기본값이 없으니/);
    // 다른 거절 문구들과 섞이지 않는다
    const others = [message({ ...BODY, lines: [] }), message(line({ quantity: 0 })), message(line({ no: 0 })), message({ ...BODY, intakeNumber: "" })];
    for (const other of others) assert.notEqual(missing, other);
  });

  it("🔴 모르는 값도 거절한다 — 한글·소문자·null·숫자 전부", () => {
    for (const bad of ["유상", "무상", "paid", "free", "", null, 0, 1, true, {}]) {
      const m = message(line({ chargeType: bad }));
      assert.match(m, /chargeType/, `통과하면 안 되는 값: ${JSON.stringify(bad)}`);
    }
  });

  it("거절 문구는 받을 수 있는 값을 코드값 한 벌에서 만들어 보여 준다", () => {
    const m = message(line({ chargeType: "paid" }));
    for (const c of CHARGE_TYPES) {
      assert.ok(m.includes(c), `${c} 가 문구에 없다`);
      assert.ok(m.includes(CHARGE_LABEL[c]), `${CHARGE_LABEL[c]} 가 문구에 없다`);
    }
  });

  it("아는 값 둘은 받는다", () => {
    for (const c of CHARGE_TYPES) assert.ok(parseApiStockRequest(line({ chargeType: c })).ok, c);
  });

  it("🔴 한 요청에 유상과 무상이 **섞여도** 받는다 (담당자: 한 건 안에서 부품마다 다르다)", () => {
    const r = parseApiStockRequest({
      ...BODY,
      lines: [
        { no: 165, quantity: 2, chargeType: "PAID" },
        { no: 7, quantity: 1, chargeType: "FREE" },
        { no: 9, quantity: 3, chargeType: "PAID" },
      ],
    });
    assert.ok(r.ok);
    assert.deepEqual(
      r.value.lines.map((l) => l.chargeType),
      ["PAID", "FREE", "PAID"],
    );
  });

  it("🔴 섞인 값이 **줄마다 제 값으로** 신청에 들어간다 (부품 되짚기를 지나도 뒤바뀌지 않는다)", () => {
    const parsed = parseApiStockRequest({
      ...BODY,
      lines: [
        { no: 165, quantity: 2, chargeType: "PAID" },
        { no: 7, quantity: 1, chargeType: "FREE" },
      ],
    });
    assert.ok(parsed.ok);
    const resolved = resolveApiRequestLines(parsed.value.lines, [
      { no: 165, id: "11111111-1111-4111-8111-111111111111", isDeleted: false },
      { no: 7, id: "22222222-2222-4222-8222-222222222222", isDeleted: false },
    ]);
    assert.ok(resolved.ok);
    const input = buildApiUseRequest(parsed.value, resolved.lines, "2026-10-15");
    assert.ok(input.type === "USE");
    assert.deepEqual(
      input.lines.map((l) => [l.partId, l.chargeType]),
      [
        ["11111111-1111-4111-8111-111111111111", "PAID"],
        ["22222222-2222-4222-8222-222222222222", "FREE"],
      ],
    );
  });
});

describe("부품 No. 되짚기 — 없는 번호와 숨긴 부품을 가른다", () => {
  const rows: ApiPartRow[] = [
    { no: 165, id: "11111111-1111-4111-8111-111111111111", isDeleted: false },
    { no: 7, id: "22222222-2222-4222-8222-222222222222", isDeleted: false },
    { no: 86, id: "33333333-3333-4333-8333-333333333333", isDeleted: true },
  ];

  it("다 있으면 부품 id 로 바뀐다 — 차례·수량·유상무상 그대로", () => {
    const r = resolveApiRequestLines(
      [
        { no: 165, quantity: 2, chargeType: "PAID" },
        { no: 7, quantity: 1, chargeType: "FREE" },
      ],
      rows,
    );
    assert.ok(r.ok);
    assert.deepEqual(r.lines, [
      { partId: "11111111-1111-4111-8111-111111111111", quantity: 2, chargeType: "PAID" },
      { partId: "22222222-2222-4222-8222-222222222222", quantity: 1, chargeType: "FREE" },
    ]);
  });

  it("🔴 없는 번호는 **번호를 적어** 거절한다 (조용히 빼지 않는다)", () => {
    const r = resolveApiRequestLines(
      [
        { no: 165, quantity: 1, chargeType: "FREE" },
        { no: 9999, quantity: 1, chargeType: "FREE" },
      ],
      rows,
    );
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.message, /9999/);
  });

  it("🔴 숨긴(지운) 부품은 **다른 말**로 거절한다 — 오타인지 치운 부품인지 가려야 고칠 수 있다", () => {
    const missing = resolveApiRequestLines([{ no: 9999, quantity: 1, chargeType: "FREE" }], rows);
    const hidden = resolveApiRequestLines([{ no: 86, quantity: 1, chargeType: "FREE" }], rows);
    assert.equal(missing.ok, false);
    assert.equal(hidden.ok, false);
    assert.match(hidden.ok ? "" : hidden.message, /숨긴/);
    assert.notEqual(missing.ok ? "" : missing.message, hidden.ok ? "" : hidden.message);
  });
});

describe("신청에 담기는 내용 — 화면이 만드는 것과 같은 모양", () => {
  const value = (() => {
    const r = parseApiStockRequest(BODY);
    assert.ok(r.ok);
    return r.value;
  })();
  const input = buildApiUseRequest(value, [{ partId: "11111111-1111-4111-8111-111111111111", quantity: 2, chargeType: "PAID" }], "2026-10-15");

  it("🔴 종류는 「사용」 고정이다 — 바깥이 종류를 고르지 않는다", () => {
    assert.equal(input.type, "USE");
  });

  it("인수번호가 실리고 「수리 건 없음」이 아니다", () => {
    assert.ok(input.type === "USE");
    assert.equal(input.intakeNumber, "D260701");
    assert.equal(input.noRepairCase, false);
  });

  it("목적은 수리, 날짜는 넘겨 준 오늘", () => {
    assert.ok(input.type === "USE");
    assert.equal(input.purpose, "REPAIR");
    assert.equal(input.purposeText, "");
    assert.equal(input.occurredOn, "2026-10-15");
  });

  it("🔴 줄은 부품 id·수량·**바깥이 보낸 유상무상**으로 들어간다 (여기서 정하지 않는다)", () => {
    assert.ok(input.type === "USE");
    assert.deepEqual(input.lines, [{ partId: "11111111-1111-4111-8111-111111111111", quantity: 2, chargeType: "PAID", note: "", actualQuantity: null }]);
  });

  it("사유와 메모가 실린다", () => {
    assert.ok(input.type === "USE");
    assert.equal(input.reason, "증폭기 교체");
    assert.equal(input.note, "오후에 가져갑니다");
  });
});

describe("🔴 돌려주는 모양 — 새로 만들었는지 이미 있던 것인지 구별한다", () => {
  it("처음 만들면 created: true", () => {
    const r = toApiStockRequest({ id: "abc", status: "PENDING", created: true }, "AS-1", "USE");
    assert.deepEqual(r, { created: true, request: { id: "abc", requestKey: "AS-1", type: "USE", status: { code: "PENDING", label: "대기" } } });
  });

  it("같은 열쇠로 다시 오면 created: false — 같은 신청을 그대로 돌려준다", () => {
    const again = toApiStockRequest({ id: "abc", status: "PENDING", created: false }, "AS-1", "USE");
    assert.equal(again.created, false);
    assert.equal(again.request.id, "abc", "🔴 두 번째 호출이 **같은 신청**을 가리켜야 한다");
  });

  it("상태는 코드와 한글을 함께 — 부품 목록의 owner·item 과 같은 관례", () => {
    const r = toApiStockRequest({ id: "abc", status: "REJECTED", created: false }, "AS-1", "USE");
    assert.deepEqual(r.request.status, { code: "REJECTED", label: "반려" });
  });
});

/**
 * 🔴 **토큰이 읽기와 다르다.** 읽기 토큰은 부품 목록을 가져가는 여러 시스템이 나눠 쓰는 값이라,
 *    그것 하나로 재고를 움직이는 신청까지 만들 수 있으면 안 된다.
 */
describe("🔴 쓰기 토큰 — 읽기 토큰으로는 못 만들고, 설정이 없으면 닫힌다", () => {
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

  it("🔴 토큰이 설정에 없으면 열어 두지 않고 닫는다 (503)", () => {
    withEnv({ INVENTORY_WRITE_TOKEN: undefined }, () => {
      const d = checkBearerToken(env.inventoryWriteToken, `Bearer ${WRITE}`);
      assert.ok(d);
      assert.equal(d.status, 503);
      assert.equal(d.error, "api_closed");
    });
  });

  it("🔴 읽기 토큰으로 쓰기 통로를 두드리면 401 — 두 값이 다른 환경변수에서 온다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.equal(env.inventoryApiToken, READ);
      assert.equal(env.inventoryWriteToken, WRITE);
      assert.notEqual(env.inventoryApiToken, env.inventoryWriteToken);
      const d = checkBearerToken(env.inventoryWriteToken, `Bearer ${READ}`);
      assert.ok(d, "읽기 토큰이 쓰기 통로를 지나갔다");
      assert.equal(d.status, 401);
      assert.equal(d.error, "unauthorized");
    });
  });

  it("맞는 쓰기 토큰은 지나간다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.equal(checkBearerToken(env.inventoryWriteToken, `Bearer ${WRITE}`), null);
      assert.equal(checkBearerToken(env.inventoryWriteToken, `bearer ${WRITE}`), null, "머리말 대소문자는 가리지 않는다");
    });
  });

  it("머리말이 없거나 모양이 다르면 401", () => {
    for (const header of [null, "", "Basic abc", "Bearer ", `Token ${WRITE}`]) {
      const d = checkBearerToken(WRITE, header);
      assert.ok(d, `통과하면 안 되는 머리말: ${JSON.stringify(header)}`);
      assert.equal(d.status, 401);
    }
  });

  it("쓰기 토큰도 32자 미만이면 시작할 때 던진다", () => {
    withEnv({ INVENTORY_WRITE_TOKEN: "짧다" }, () => {
      assert.throws(() => env.inventoryWriteToken, /32자/);
    });
  });
});

/**
 * 🔴 **A/S 에서 올라온 신청은 재고 관리에서 거둬지지 않는다.** 저쪽에 「이 부품 내 달라」가 열린 채 남아 있는데
 *    이쪽에서 접으면 A/S 는 영영 답을 못 받는다. 화면의 단추와 서버의 WHERE 가 **같은 한 벌**을 본다.
 */
describe("🔴 바깥 신청은 재고 관리에서 취소되지 않는다 (2026-10-15)", () => {
  const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("거둘 수 있는 출처는 재고 관리에서 직접 올린 것뿐이다", () => {
    assert.deepEqual([...CANCELLABLE_REQUEST_SOURCES], ["INVENTORY"]);
  });

  it("내가 낸 대기 신청은 거둘 수 있다", () => {
    assert.equal(canCancelRequest({ source: "INVENTORY", status: "PENDING", requestedBy: ME }, ME), true);
  });

  it("🔴 A/S 에서 온 신청은 **내 포털 번호로 이어져 있어도** 못 거둔다", () => {
    assert.equal(canCancelRequest({ source: "AS", status: "PENDING", requestedBy: ME }, ME), false, "A/S 가 거둔다 — 이쪽에서 접으면 저쪽이 답을 못 받는다");
  });

  it("사람을 못 찾은 A/S 신청(requestedBy 없음)도 당연히 못 거둔다", () => {
    assert.equal(canCancelRequest({ source: "AS", status: "PENDING", requestedBy: null }, ME), false);
    assert.equal(canCancelRequest({ source: "INVENTORY", status: "PENDING", requestedBy: null }, ME), false, "id 가 없으면 누구와도 같지 않다");
  });

  it("남의 신청·대기가 아닌 신청은 못 거둔다 (전부터의 규칙)", () => {
    assert.equal(canCancelRequest({ source: "INVENTORY", status: "PENDING", requestedBy: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, ME), false);
    for (const status of ["PARTIAL", "CONFIRMING", "ON_HOLD", "CONFIRMED", "REJECTED", "CANCELLED", "IN_APPROVAL"] as const) {
      assert.equal(canCancelRequest({ source: "INVENTORY", status, requestedBy: ME }, ME), false, status);
    }
  });
});

describe("출처 글자 (2026-10-15)", () => {
  it("출처를 빠짐없이 덮는다 — 더하고 여기를 안 고치면 tsc 가 먼저 멈춘다", () => {
    assert.deepEqual(Object.keys(REQUEST_SOURCE_LABEL).sort(), [...REQUEST_SOURCES].sort());
  });

  it("🔵 재고 관리에서 직접 올린 것은 표식이 없다 — 거의 전부라서, 붙이면 A/S 가 묻힌다", () => {
    assert.equal(REQUEST_SOURCE_LABEL.INVENTORY, "");
    assert.equal(REQUEST_SOURCE_LABEL.AS, "A/S");
  });
});
