import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ENTRY_TYPES, type EntryType } from "../src/db/schema/stock";
import { ENTRY_TYPE_LABEL } from "../src/lib/stock/codes";
import { entryTitle, type EntryTitleSource } from "../src/lib/stock/entry-title";
import { returnRequestIntakeNumber, soleIntakeNumber } from "../src/lib/stock/return-request-view";

/**
 * ============================================================================
 * 기록 내역(원장)의 **건 머리글** — 반환 건에 수리건 인수번호가 선다 (2026-11-26)
 * ============================================================================
 * 쓰는 분이 화면을 보고 짚었다: 「검은 글씨로 **[반환]이라고 적힌 부분을 수리건 인수번호로**」.
 * 그 자리는 사용 건에서 `D261099` 가 서는 자리인데, 반환에서는 **바로 옆 딱지와 똑같은 「반환」**이
 * 서 있었다 — 한 줄에 같은 말이 두 번 뜨고, 「어느 수리 건을 돌려받는가」는 어디에도 없었다.
 *
 * 🔴 **「있는가」로 재지 않는다.** 글자 「반환」은 그 전에도 떴다 — 바뀐 것은 **무엇이 뜨는가**다.
 *    그래서 아래는 전부 값으로 잰다: 반환에는 인수번호가 뜨고, **종류 이름은 안 뜬다**.
 * 🔴 **사용·다른 종류는 한 글자도 안 바뀌었다**는 것도 같은 무게로 잰다. 이 조각은 **더하기만** 했고,
 *    입고·폐기·조정·소유 옮김에 인수번호가 뜨면 그것은 거짓말이다.
 * 🔵 되짚는 질의(`returnLineOriginsOf`)와 화면 조각은 `server-only`·JSX 라 `npm test` 가 못 부른다.
 *    그래서 **규칙은 순수 함수로 재고, 서버·화면에서만 가려지는 울타리는 소스 글자로 잰다** —
 *    `tests/return-request-view.test.ts` 와 같은 사정·같은 처방이다. 🔵 재기 전에 **주석을 걷어낸다**:
 *    주석에 그 글자가 적혀 있으면 조건이 사라져도 시험이 통과한다(이 저장소에서 실제로 겪은 함정).
 *
 * 🔴 실제 고객사명·사람 이름을 쓰지 않는다 — 공개 저장소에 박힌다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 🔴 주석을 걷어낸 코드만 (위 머리말). */
const codeOnly = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** 인수번호 본보기 — 꼴만 진짜다(D + 숫자 6). */
const D1 = "D260701";
const D2 = "D260702";

function entry(over: Partial<EntryTitleSource> & { type: EntryType }): EntryTitleSource {
  return { intakeNumber: "", noRepairCase: false, reason: "", counterparty: "", returnIntakeNumbers: [], ...over };
}

/* ------------------------------------------------------------------ */

describe("① 🔴 반환 건의 머리글은 **수리건 인수번호**다 — 그 전에는 종류 이름이었다", () => {
  it("🔴 되짚은 인수번호가 그대로 선다", () => {
    assert.equal(entryTitle(entry({ type: "RETURN", returnIntakeNumbers: [D1] })), D1);
  });

  it("🔴 **종류 이름 「반환」이 그 자리에 안 뜬다** — 옆 딱지가 이미 같은 말을 한다", () => {
    const title = entryTitle(entry({ type: "RETURN", returnIntakeNumbers: [D1] }));
    // 🔵 표본이 비어 공짜로 통과하지 않게, **옆 딱지가 쓰는 글자**를 함께 집어 둔다. 그 글자가 바뀌면
    //    이 시험이 무엇과 견주는지도 함께 바뀌어야 한다.
    assert.equal(ENTRY_TYPE_LABEL.RETURN, "반환", "종류 딱지의 글자가 바뀌었다 — 시험이 낡았다");
    assert.notEqual(title, ENTRY_TYPE_LABEL.RETURN, "머리글이 옛 모양(종류 이름)으로 돌아갔다");
    assert.ok(!title.includes("반환"), `머리글에 「반환」이 섞였다: ${title}`);
  });

  it("🔵 같은 건에서 쪼개진 줄이 여럿이어도 **한 번만** 적힌다", () => {
    assert.equal(entryTitle(entry({ type: "RETURN", returnIntakeNumbers: [D1, D1] })), D1);
  });

  it("🔴 반환 건 **자신의** 인수번호 칸은 보지 않는다 — 원장의 반환 갈래가 그 칸을 안 쓴다(언제나 빈 글자)", () => {
    // 🔵 혹시 그 칸이 채워져 있어도 머리글은 **되짚은 값**이다. 둘이 갈리면 되짚은 쪽이 참말이다.
    assert.equal(entryTitle(entry({ type: "RETURN", intakeNumber: D2, returnIntakeNumbers: [D1] })), D1);
    assert.equal(entryTitle(entry({ type: "RETURN", intakeNumber: D2 })), "", "반환이 제 칸을 읽는다");
  });
});

/* ------------------------------------------------------------------ */

describe("② 🔴 인수번호를 **못 찾았을 때** — 빈 자리로 둔다", () => {
  it("🔴 되짚을 것이 없으면 빈 글자다 (대여·「수리 건 없음」 반출을 되돌린 반환)", () => {
    assert.equal(entryTitle(entry({ type: "RETURN" })), "");
  });

  it("🔴 **수리 건이 섞여 있으면 하나를 골라 적지 않는다** — 나머지 건이 없는 것처럼 보인다", () => {
    assert.equal(entryTitle(entry({ type: "RETURN", returnIntakeNumbers: [D1, D2] })), "");
  });

  it("🔴 그때도 **「반환」으로 되돌아가지 않는다** — 고치기 전 모습 그대로가 된다", () => {
    for (const numbers of [[], [D1, D2]]) {
      const title = entryTitle(entry({ type: "RETURN", returnIntakeNumbers: numbers }));
      assert.equal(title, "", "빈 글자가 아니다");
      assert.notEqual(title, ENTRY_TYPE_LABEL.RETURN);
    }
  });

  it("🔴 화면은 **빈 머리글을 아예 안 그린다** — 빈 `<h3>` 는 설명 없는 틈을 만든다", () => {
    const page = codeOnly(src("src/app/(app)/entries/page.tsx"));
    assert.ok(page.includes("const title = entryTitle(e);"), "머리글을 한 번 빚어 두는 자리가 사라졌다");
    assert.ok(
      page.includes('{title ? <h3 className="text-base font-semibold text-zinc-900">{title}</h3> : null}'),
      "빈 머리글을 그대로 세운다 — 모양이 바뀌었으면 이 시험도 함께 고쳐라",
    );
  });
});

/* ------------------------------------------------------------------ */

describe("③ 🔴 **사용 건의 머리글은 전과 같다** — 이 조각은 더하기만 했다", () => {
  it("수리 건이 있는 사용은 인수번호", () => {
    assert.equal(entryTitle(entry({ type: "USE", intakeNumber: D1 })), D1);
  });

  it("「수리 건 없음」 사용은 「기타 사용 — 사유」, 사유가 없으면 「기타 사용」", () => {
    assert.equal(entryTitle(entry({ type: "USE", noRepairCase: true, reason: "예시 사유" })), "기타 사용 — 예시 사유");
    assert.equal(entryTitle(entry({ type: "USE", noRepairCase: true })), "기타 사용");
  });

  it("🔴 되짚은 인수번호가 실려 있어도 사용은 **제 칸만** 본다", () => {
    assert.equal(entryTitle(entry({ type: "USE", intakeNumber: D1, returnIntakeNumbers: [D2] })), D1);
  });
});

/* ------------------------------------------------------------------ */

describe("④ 🔴 **다른 종류의 머리글은 안 바뀐다** — 그쪽에 인수번호가 뜨면 안 된다", () => {
  it("종류와 상대·사유 그대로", () => {
    assert.equal(entryTitle(entry({ type: "LOAN", counterparty: "예시 상대처" })), "대여 — 예시 상대처");
    assert.equal(entryTitle(entry({ type: "LOAN" })), "대여");
    assert.equal(entryTitle(entry({ type: "DISPOSE", reason: "불량" })), "폐기·불량 — 불량");
    assert.equal(entryTitle(entry({ type: "ADJUST", reason: "정기 실사" })), "조정 — 정기 실사");
    assert.equal(entryTitle(entry({ type: "CORRECTION", reason: "실수" })), "기록 취소 — 실수");
    assert.equal(entryTitle(entry({ type: "RECEIVE" })), "입고");
    assert.equal(entryTitle(entry({ type: "TRANSFER" })), "소유 옮김");
    assert.equal(entryTitle(entry({ type: "OPENING" })), "처음 수량");
  });

  it("🔴 반환이 아닌 종류에는 **되짚은 인수번호가 실려도 안 뜬다**", () => {
    const others = ENTRY_TYPES.filter((t) => t !== "RETURN");
    assert.equal(others.length, ENTRY_TYPES.length - 1, "종류 목록이 비었다 — 시험이 아무것도 안 돌고 있다");
    for (const type of others) {
      const title = entryTitle(entry({ type, returnIntakeNumbers: [D1] }));
      assert.ok(!title.includes(D1), `${type} 머리글에 인수번호가 떴다: ${title}`);
    }
  });

  it("🔵 인수번호가 뜨는 종류는 **사용과 반환 둘뿐**이다", () => {
    const shows = ENTRY_TYPES.filter((type) => entryTitle(entry({ type, intakeNumber: D1, returnIntakeNumbers: [D1] })).includes(D1));
    assert.deepEqual(shows, ["USE", "RETURN"], "인수번호가 뜨는 종류가 바뀌었다 — 결정이 바뀌었으면 시험도 함께 고쳐라");
  });
});

/* ------------------------------------------------------------------ */

describe("⑤ 🔴 「섞이면 말을 아낀다」 규칙이 **한 벌**이다", () => {
  it("🔴 두 화면이 같은 답을 낸다 — 원장 머리글과 부품 요청 관리의 「무엇에」 칸", () => {
    for (const numbers of [[], [D1], [D1, D1], [D1, D2]]) {
      const viaRequest = returnRequestIntakeNumber([{ partId: "p", quantity: 1, intakeNumbers: [...numbers] }]);
      assert.equal(soleIntakeNumber(numbers), viaRequest, `갈래가 갈렸다: [${numbers.join(", ")}]`);
      assert.equal(entryTitle(entry({ type: "RETURN", returnIntakeNumbers: numbers })), viaRequest);
    }
  });

  it("🔴 **빈 글자는 갈래로 세지 않는다** — 세면 멀쩡한 번호까지 지워진다", () => {
    assert.equal(soleIntakeNumber([D1, ""]), D1);
    assert.equal(soleIntakeNumber([""]), "");
  });

  it("🔴 규칙을 두 벌로 적지 않았다 — 양쪽이 `soleIntakeNumber` 를 부른다", () => {
    const view = codeOnly(src("src/lib/stock/return-request-view.ts"));
    const body = view.split("export function returnRequestIntakeNumber(")[1]?.split("\n}")[0] ?? "";
    assert.ok(body.length > 0, "returnRequestIntakeNumber 를 못 찾았다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(body.includes("soleIntakeNumber("), "신청 쪽이 규칙을 다시 적고 있다");
    assert.ok(codeOnly(src("src/lib/stock/entry-title.ts")).includes("soleIntakeNumber("), "원장 머리글이 규칙을 다시 적고 있다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑥ 🔴 서버가 실제로 **되짚어** 내려보낸다 — 안 하면 위의 규칙이 빈 입력만 받는다", () => {
  const queries = codeOnly(src("src/lib/stock/queries.ts"));
  const body = queries.split("async function returnIntakeNumbersFor(")[1]?.split("\n}\n")[0] ?? "";

  it("🔴 되짚는 질의를 **두 벌로 적지 않았다** — 부품 요청 관리와 같은 함수다", () => {
    assert.ok(body.length > 0, "되짚는 자리를 못 찾았다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(body.includes("await returnLineOriginsOf("), "원장 줄을 되짚지 않는다 — 머리글에 그릴 것이 없다");
    assert.ok(codeOnly(src("src/lib/stock/requests.ts")).includes("export async function returnLineOriginsOf("), "되짚는 질의가 밖에서 안 보인다");
  });

  it("🔴 **반환 건이 없으면 질의를 안 보낸다** — 기록 내역의 거의 전부가 사용·입고다", () => {
    assert.ok(body.includes("if (sourceIdsByEntry.size === 0) return out;"), "반환이 없어도 질의를 보낸다");
    assert.ok(body.includes('if (h.type !== "RETURN") continue;'), "반환이 아닌 건의 줄까지 되짚는다");
  });

  it("🔴 읽어 놓고 **안 넘기면** 머리글이 그대로 빈다", () => {
    assert.ok(queries.includes("const returnIntakes = await returnIntakeNumbersFor(heads, lines);"), "목록이 되짚지 않는다");
    assert.ok(queries.includes("toEntryRow(h, lines.get(h.id) ?? [], returnIntakes.get(h.id) ?? [])"), "되짚은 값을 줄로 안 넘긴다");
    assert.ok(queries.includes("returnIntakeNumbers,"), "EntryRow 에 그 칸을 안 싣는다");
  });

  it("🔵 빈 인수번호는 **담지 않는다** — 담으면 갈래를 하나 더 세게 된다", () => {
    assert.ok(body.includes('if (intake !== "" && !numbers.includes(intake)) numbers.push(intake);'), "빈 글자·중복을 거르는 줄이 바뀌었다");
  });
});

/* ------------------------------------------------------------------ */

describe("⑦ 🔵 화면은 **글자 규칙을 스스로 적지 않는다**", () => {
  const page = codeOnly(src("src/app/(app)/entries/page.tsx"));

  it("🔴 머리글 규칙은 순수 함수에서 온다 — 화면 파일은 시험이 못 부른다", () => {
    assert.ok(page.includes('import { entryTitle } from "@/lib/stock/entry-title";'), "화면이 머리글 함수를 안 가져온다");
    assert.ok(!page.includes("function entryTitle("), "규칙이 화면에 다시 적혔다 — 두 벌이 되면 한쪽만 고쳐진다");
  });

  it("🔴 머리글 글자가 화면에 **박혀 있지 않다**", () => {
    for (const label of ["기타 사용", "폐기·불량", "기록 취소 —"]) {
      assert.ok(!page.includes(label), `화면에 머리글 글자(${label})가 박혀 있다`);
    }
    assert.ok(codeOnly(src("src/lib/stock/entry-title.ts")).includes("기타 사용"), "글자가 적힌 그 한 곳이 사라졌다 — 시험이 낡았다");
  });
});
