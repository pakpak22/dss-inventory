import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { customerNameDenial, parseApiCustomerName, parsePartNoParam, toApiCustomerNameResponse } from "../src/lib/api/part-customer-name";
import { MAX_SUB } from "../src/lib/api/stock-requests";
import { checkBearerToken } from "../src/lib/api/token-gate";
// 🔵 변경 이력 화면이 그 칸을 **실제로** 푸는지 재려고 끌어온다(아래 「누가 채웠는지」 묶음).
import { auditDetailLines } from "../src/lib/audit-detail";
import { env } from "../src/lib/env";
import { customerNameFillAudit, type CustomerNameFiller } from "../src/lib/parts/customer-name";
import { CUSTOMER_NAME_MAX } from "../src/lib/parts/form";

/**
 * ============================================================================
 * 고객사 품명을 **바깥에서 채우는** 통로의 울타리
 * (2026-10-16, `POST /api/v1/parts/{no}/customer-name`. API.md 7절)
 * ============================================================================
 * 🔴 **재고 관리의 부품 자료를 바깥에서 고치는 첫 통로다.** 그래서 덮는 것이 많다 —
 *   1. 비어 있을 때만 채운다 / 이미 있으면 **덮지 않고 지금 값**을 돌려준다(`filled: false`)
 *   2. 빈 글자·공백만·`-` 는 거절 — **지우는 길이 아니다**
 *   3. 길이를 넘으면 **자르지 않고** 거절, 자는 화면 폼과 **같은 것**
 *   4. 없는 번호와 지워진 부품을 **각각 다른 말**로
 *   5. **읽기 토큰으로는 못 쓴다**, 토큰이 설정에 없으면 **닫힌다**
 *   6. 🔴 **누가 채웠는지**(포털 번호와 보내온 이름)가 이력에 남는다
 *
 * 🔵 통로 파일(`route.ts`)은 `server-only` 를 거쳐 들어가 `npm test` 가 불러올 수 없다. 그래서 규칙을
 *    순수 함수에 모아 두고 여기서 덮는다(다른 통로 시험들과 같은 까닭). **문지기를 어느 문으로 달았는지**만
 *    소스 글자로 잰다 — 약한 울타리인 것은 맞지만, 읽기 토큰으로 바꿔 달리는 날 여기서 깨진다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const body = (over: Record<string, unknown> = {}) => ({ customerName: "증폭기 조립품", filledBy: { sub: "portal-sub-aaaa-1111", name: "홍길동" }, ...over });

/** 거절을 기대하는 자리. 🔴 통과하면 그 자체가 실패다(울타리가 뚫린 것). */
const rejected = (raw: unknown) => {
  const r = parseApiCustomerName(raw);
  assert.equal(r.ok, false, `받아 주면 안 되는 값인데 통과했다: ${JSON.stringify(raw)}`);
  return r.ok ? ({} as never) : r;
};

describe("받는 값 — 채울 이름과 채운 사람 (2026-10-16)", () => {
  it("둘 다 오면 받는다 — 앞뒤 공백은 뗀다", () => {
    const r = parseApiCustomerName(body({ customerName: "  증폭기 조립품  " }));
    assert.ok(r.ok, r.ok ? "" : r.message);
    assert.equal(r.value.customerName, "증폭기 조립품");
    assert.deepEqual(r.value.filledBy, { sub: "portal-sub-aaaa-1111", name: "홍길동" });
  });

  it("🔴 빈 글자·공백만은 거절한다 — 이 통로에 **지우는 길은 없다**", () => {
    for (const v of ["", "   ", "\t", "\n", "  \r\n  "]) {
      const r = rejected(body({ customerName: v }));
      assert.match(r.message, /채우기만|비어/, `거절 문구가 「지우는 길이 아니다」를 말하지 않는다: ${r.message}`);
    }
  });

  it("🔴 「-」 뿐이면 거절한다 — 이 저장소에서 `-` 는 **없음**이다", () => {
    // 🔵 화면 폼이 `-` 를 빈 값으로 받는 그 자(`CUSTOMER_NAME_DASH_ONLY`)를 통로도 쓴다.
    //    값으로 받아 두면 서류에 `-` 가 이름으로 찍히고, 그 뒤로는 「이미 차 있다」가 되어 영영 못 고친다.
    for (const v of ["-", "--", "–", "—", "－", "ㅡ", " - "]) rejected(body({ customerName: v }));
  });

  it("🔴 길이를 넘으면 **잘라서 받지 않고** 거절한다 — 고객사에 나가는 이름이다", () => {
    const ok = parseApiCustomerName(body({ customerName: "가".repeat(CUSTOMER_NAME_MAX) }));
    assert.ok(ok.ok, "상한 길이는 받아야 한다");
    assert.equal(ok.value.customerName.length, CUSTOMER_NAME_MAX);

    const r = rejected(body({ customerName: "가".repeat(CUSTOMER_NAME_MAX + 1) }));
    assert.match(r.message, new RegExp(String(CUSTOMER_NAME_MAX)), "몇 자까지인지 말해야 고칠 수 있다");
  });

  it("🔵 길이 자는 화면 폼과 **같은 것**이다 — 같은 칸이 들어온 길에 따라 달라지지 않게", () => {
    // 폼 쪽 문구에 박힌 숫자와 통로가 쓰는 숫자가 같은 곳에서 온다(`form.ts` 가 내준 CUSTOMER_NAME_MAX).
    assert.match(src("src/lib/parts/form.ts"), /export \{ TEXT_MAX as CUSTOMER_NAME_MAX/);
    assert.equal(typeof CUSTOMER_NAME_MAX, "number");
  });

  it("🔴 customerName 이 글자가 아니면 거절한다 — 기계가 보내는 값이라 조용히 고쳐 주지 않는다", () => {
    for (const v of [null, 7, true, ["가"], { ko: "가" }, undefined]) rejected(body({ customerName: v }));
  });

  it("🔴 채운 사람(포털 번호·이름)이 빠지면 거절한다 — 바깥 쓰기라 「누가」가 필수다", () => {
    for (const filledBy of [undefined, {}, { sub: "s" }, { name: "홍길동" }, { sub: "  ", name: "홍길동" }, { sub: "s", name: "   " }, "홍길동"]) {
      const r = rejected(body({ filledBy }));
      assert.match(r.message, /filledBy/);
    }
  });

  it("사람 칸은 신청 통로와 **같은 자**로 다듬는다 (앞뒤 공백·같은 길이)", () => {
    const r = parseApiCustomerName(body({ filledBy: { sub: `  ${"s".repeat(MAX_SUB + 50)}  `, name: "  홍길동  " } }));
    assert.ok(r.ok, r.ok ? "" : r.message);
    assert.equal(r.value.filledBy.sub.length, MAX_SUB);
    assert.equal(r.value.filledBy.name, "홍길동");
  });

  it("본문이 JSON 객체가 아니면 거절한다", () => {
    for (const v of [null, "문자열", 7, [body()]]) rejected(v);
  });
});

describe("주소의 No. (2026-10-16)", () => {
  it("양의 정수만 받는다", () => {
    assert.equal(parsePartNoParam("165"), 165);
    assert.equal(parsePartNoParam("1"), 1);
    assert.equal(parsePartNoParam("007"), 7); // 🔵 `GET /api/v1/parts/{no}` 와 같은 자다
  });

  it("🔴 글자가 섞이거나 0 이하면 받지 않는다 — 조용히 아무 부품이나 고치지 않게", () => {
    for (const v of ["", " ", "0", "-3", "7번", "1.5", "No.7", "abc", "165 ", "٣"]) {
      assert.equal(parsePartNoParam(v), null, `받으면 안 되는 값인데 받았다: ${JSON.stringify(v)}`);
    }
  });
});

describe("🔴 없는 번호와 지워진 부품을 각각 다른 말로 (2026-10-16)", () => {
  it("없는 번호는 404 not_found", () => {
    const d = customerNameDenial("not_found", 999);
    assert.equal(d.status, 404);
    assert.equal(d.error, "not_found");
    assert.match(d.message, /999/);
  });

  it("지워진 부품은 410 gone — 번호를 고쳐 봐야 소용없는 일이라 다르게 말한다", () => {
    const d = customerNameDenial("deleted", 86);
    assert.equal(d.status, 410);
    assert.equal(d.error, "gone");
    assert.match(d.message, /86/);
    assert.match(d.message, /숨긴|지운/);
  });

  it("🔴 두 거절이 **상태·이름·문구 셋 다** 다르다 — 한 가지로 뭉개면 오타인지 치운 부품인지 못 가린다", () => {
    const a = customerNameDenial("not_found", 7);
    const b = customerNameDenial("deleted", 7);
    assert.notEqual(a.status, b.status);
    assert.notEqual(a.error, b.error);
    assert.notEqual(a.message, b.message);
  });
});

describe("🔴 돌려주는 모양 — 이미 있으면 덮지 않고 지금 값을 준다 (2026-10-16)", () => {
  it("채웠으면 filled: true 와 채운 값", () => {
    const r = toApiCustomerNameResponse(true, { no: 165, name: "AMP-DEH-DV2H(13M)", customerName: "증폭기 조립품" });
    assert.deepEqual(r, { filled: true, part: { no: 165, name: "AMP-DEH-DV2H(13M)", customerName: "증폭기 조립품" } });
  });

  it("🔴 이미 있었으면 filled: false 이고 `part.customerName` 이 **지금 값**이다 — 받는 쪽이 「이미 있습니다 — 「…」」라고 말할 수 있게", () => {
    const r = toApiCustomerNameResponse(false, { no: 165, name: "AMP-DEH-DV2H(13M)", customerName: "먼저 적힌 이름" });
    assert.equal(r.filled, false);
    assert.equal(r.part.customerName, "먼저 적힌 이름", "덮어쓴 값이 아니라 지금 값이어야 한다");
  });

  it("🔵 쓸 칸만 실어 보낸다 — 부품 표에 칸이 늘어도 바깥 모양은 그대로", () => {
    const r = toApiCustomerNameResponse(true, { no: 1, name: "품", customerName: "고객", note: "비밀", id: "uuid" } as never);
    assert.deepEqual(Object.keys(r.part).sort(), ["customerName", "name", "no"]);
  });
});

describe("🔴 누가 채웠는지 이력에 남는다 (2026-10-16)", () => {
  const filler = (over: Partial<CustomerNameFiller> = {}): CustomerNameFiller => ({ id: null, name: "홍길동", sub: "portal-sub-aaaa-1111", sentName: "홍길동", ...over });

  it("🔴 포털 번호와 **보내온 이름**이 남는다 — 이름은 겹치므로 번호가 진짜 열쇠다", () => {
    const d = customerNameFillAudit("증폭기 조립품", filler({ id: "user-uuid", name: "정영빈", sentName: "홍길동" }));
    assert.deepEqual(d.filledBy, { sub: "portal-sub-aaaa-1111", name: "홍길동" }, "보내온 이름을 그대로 남겨야 한다");
    assert.equal(d.matchedUser, "정영빈", "우리 쪽에서 찾은 이름은 따로 남는다");
    assert.equal(d.via, "API", "화면에서 고친 기록과 가를 칸");
  });

  it("재고 관리에 없는 사람이어도 번호와 이름이 남는다", () => {
    const d = customerNameFillAudit("증폭기 조립품", filler());
    assert.deepEqual(d.filledBy, { sub: "portal-sub-aaaa-1111", name: "홍길동" });
    assert.equal(d.matchedUser, null, "못 찾았으면 지어내지 않는다");
  });

  it("🔵 변경 이력 화면이 그대로 푸는 모양이다 — before 는 **언제나 빈 글자**(비어 있을 때만 채우므로)", () => {
    const d = customerNameFillAudit("증폭기 조립품", filler()) as { changes: Record<string, { before: unknown; after: unknown }> };
    assert.deepEqual(d.changes.customerName, { before: "", after: "증폭기 조립품" });
  });

  it("🔴 DB 를 고치는 쪽이 이 함수를 쓴다 — 여기를 안 거치면 「누가」가 통째로 빠진다", () => {
    const m = src("src/lib/parts/mutations.ts");
    assert.match(m, /customerNameFillAudit\(customerName, filler\)/, "fillCustomerName 이 이력을 손으로 빚고 있다");
  });

  /**
   * 🔴 2026-10-23 에 **재는 방식을 바꿨다.** 그 전에는 `audit/page.tsx` 의 **소스 글자**에 `filledBy`·
   *    「포털 번호」가 들어 있는지만 봤다(약한 울타리 — 주석에만 적혀 있어도 통과한다). 같은 날 그
   *    규칙이 순수 모듈 `src/lib/audit-detail.ts` 로 내려가면서 **돌려 볼 수 있게** 되었으므로,
   *    이제 **실제로 나오는 글자**를 잰다. 단언을 약하게 한 것이 아니라 강하게 한 것이다.
   * 🔵 화면이 그 모듈을 거치는지는 바로 아래 시험이 소스 글자로 본다 — 두 시험이 한 쌍이다.
   */
  it("🔴 변경 이력 화면이 그 칸을 보여 준다 — 남기기만 하고 안 보이면 「누가 넣었지?」에 답할 수 없다", () => {
    const detail = customerNameFillAudit("증폭기 조립품", filler({ id: "user-uuid", name: "정영빈", sentName: "홍길동" }));
    const lines = auditDetailLines("PART_UPDATE", detail, { entryNos: new Map() });
    assert.equal(lines.unknown, false, "JSON 그대로 나가면 안 된다");
    const who = lines.lines.find((l) => l.kind === "text" && l.text.includes("A/S 통로로 채움"));
    assert.ok(who && who.kind === "text", `「누가 채웠나」 줄이 없다: ${JSON.stringify(lines.lines)}`);
    assert.match(who.text, /보낸 이름 홍길동/);
    assert.match(who.text, /포털 번호 portal-sub-aaaa-1111/);
  });

  it("🔴 변경 이력 화면이 그 모듈을 거친다 — 화면이 제 글자를 따로 빚으면 위 시험이 헛돈다", () => {
    const page = src("src/app/(app)/audit/page.tsx");
    assert.match(page, /auditDetailLines\(r\.action, r\.detail/);
  });
});

describe("🔴 쓰기 토큰 전용 — 읽기 토큰으로는 못 채우고, 토큰이 없으면 닫힌다 (2026-10-16)", () => {
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

  it("🔴 읽기 토큰으로 두드리면 401 — 부품 목록을 가져가는 여러 시스템이 나눠 쓰는 값이다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.notEqual(env.inventoryApiToken, env.inventoryWriteToken);
      const d = checkBearerToken(env.inventoryWriteToken, `Bearer ${READ}`);
      assert.ok(d, "읽기 토큰이 쓰는 통로를 지나갔다");
      assert.equal(d.status, 401);
    });
  });

  it("맞는 쓰기 토큰은 지나간다", () => {
    withEnv({ INVENTORY_API_TOKEN: READ, INVENTORY_WRITE_TOKEN: WRITE }, () => {
      assert.equal(checkBearerToken(env.inventoryWriteToken, `Bearer ${WRITE}`), null);
    });
  });

  it("🔴 통로가 **쓰기 문**에 달려 있다 — 읽기 문지기로 바꿔 달리면 여기서 깨진다", () => {
    const route = src("src/app/api/v1/parts/[no]/customer-name/route.ts");
    assert.match(route, /checkApiWriteToken\(request\)/);
    assert.doesNotMatch(route, /checkApiToken\(/, "읽기 문지기가 섞여 들어왔다");
  });
});
