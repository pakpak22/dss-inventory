import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * **요청 비고**가 [부품 요청] 목록과 **불출 신청 팝업**에 선다 (2026-10-22)
 * ============================================================================
 * 비고는 2026-10-22 에 A/S 쪽 요청 화면에 열렸고, 값은 신청의 jsonb(`stock_requests.payload` 의
 * `note`)에 실려 온다. 쓰는 분이 눈으로 확인한 뒤 **두 가지**를 더 요청했다:
 *
 *  1. 「[부품 요청]에서 [A/S]에서 온 비고를 **인수번호에 이어서 적지 말고 따로 구분감 있게**」
 *  2. 「[부품요청]에서 **불출 신청을 눌렀을 때 나오는 팝업**에도 비고를 확인할 수 있게」
 *
 * 🔴 여기서 못 박는 것 다섯:
 *  1. **목록에서 둘이 갈라져 있다** — `aboutOf` 가 비고를 ` · ` 로 이어 붙이지 않는다. 이어 붙이면
 *     「D260701 · 교체 바랍니다」가 한 덩어리로 읽혀 인수번호가 어디서 끝나는지 눈으로 못 가린다.
 *  2. **비면 아무것도 안 그린다** — 재고 관리에서 직접 올린 신청은 **늘** 비어 있어서, 「요청 비고: -」가
 *     모든 줄에 붙으면 표만 길어지고 정작 적힌 말이 묻힌다.
 *  3. **팝업에서 읽는 글과 치는 칸이 갈라져 있다** — 「신청 사유」는 담당자가 결재자에게 **지금 치는**
 *     글이고 요청 비고는 신청한 사람이 **이미 적어 보낸** 글이다. 읽는 글이 입력 칸처럼 보이면 사람은
 *     고칠 수 있다고 믿는다.
 *  4. **잘라서 숨기지 않는다** — 읽으라고 적은 글이고(A/S 통로가 1000자까지 싣는다), 접으면 「없는 말」과
 *     구별되지 않는다.
 *  5. **[기록내역]과 [승인요청건]은 건드리지 않았다** — 쓰는 분이 [부품 요청] 쪽만 나누라고 했고,
 *     승인 요청건의 같은 줄은 같은 날 눈 확인을 통과했다.
 *
 * 🔵 이 저장소에는 **화면 렌더 시험이 없다.** 그래서 화면의 모양은 소스 글자로 잰다 —
 *    `tests/part-issue-screen.test.ts`·`tests/request-item-detail.test.ts` 와 같은 처방이다.
 *    약한 울타리인 것은 맞지만, 갈라 둔 자리가 다시 합쳐지거나 빈 울타리가 사라지는 날 여기서 깨진다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const screen = src("src/components/stock/RequestManagerScreen.tsx");
const actions = src("src/components/stock/RequestActions.tsx");

describe("① [부품 요청] 목록 — 인수번호와 요청 비고가 **따로** 그려진다 (2026-10-22)", () => {
  /** 🔵 「무엇에」 칸의 글자를 짓는 함수 본문만 떼어 본다 — 비고가 거기 섞여 들어갔는지를 자리로 가른다. */
  const aboutBody = (): string => {
    const parts = screen.split("function aboutOf(");
    assert.equal(parts.length, 2, "aboutOf 를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    return parts[1].split("\n}")[0];
  };

  it("🔴 `aboutOf` 가 비고를 **이어 붙이지 않는다** — 인수번호 하나만 짓는다", () => {
    const body = aboutBody();
    assert.ok(!body.includes("note"), "「무엇에」 글자에 비고가 섞여 들어갔다 — 둘이 한 덩어리로 읽힌다");
    assert.ok(!body.includes(" · "), "인수번호 뒤에 무언가를 이어 붙이고 있다");
    // 🔵 짓던 머리말 셋은 그대로다(인수번호 · 빌려준 곳 · 사유).
    for (const head of ["수리 건 없음", "빌려준 곳", "사유"]) assert.ok(body.includes(head), `${head} 갈래가 사라졌다`);
  });

  it("🔴 비고는 **이름표를 단 제 줄**로 그린다 — 이름표는 「요청 비고」", () => {
    assert.ok(screen.includes("function RequestNote("), "비고를 그리는 조각이 없다");
    assert.ok(screen.includes("요청 비고"), "이름표가 없다 — 이름표가 없으면 인수번호 밑에 붙은 말이 무엇인지 모른다");
    assert.ok(screen.includes("<RequestNote note={r.note} />"), "「무엇에」 칸이 비고 줄을 안 그린다");
  });

  it("🔴 **비면 아무것도 안 그린다** — 재고 관리에서 올린 신청은 늘 비어 있다", () => {
    assert.ok(/function RequestNote\([\s\S]{0,200}?if \(!note\) return null;/.test(screen), "비었을 때 빠져나오는 울타리가 없다");
    assert.ok(!/note \|\| ["“-]/.test(screen), "비었을 때 「없음」·「-」 같은 글자를 지어낸다");
  });

  it("🔴 길어도 **잘라서 숨기지 않는다** — 읽으라고 적은 글이다", () => {
    assert.ok(!/\{note\.(slice|substring|substr)\(/.test(screen), "비고를 잘라서 보여 준다");
    assert.ok(!/line-clamp[^"]*"[^"]*\{note\}/s.test(screen), "비고를 줄 수로 접어 숨긴다");
    // 🔵 표 칸 안이라 넘치지만 않게 한다 — 적은 사람의 줄바꿈은 살린다.
    assert.ok(/function RequestNote\([\s\S]{0,600}?whitespace-pre-wrap/.test(screen), "적은 사람의 줄바꿈이 뭉개진다");
    assert.ok(/function RequestNote\([\s\S]{0,600}?break-words/.test(screen), "긴 글이 표 칸을 밀어낸다");
  });

  it("🔵 「무엇에」 칸이 비면 지금까지처럼 `-` 다 — 비고가 그 자리를 대신하지 않는다", () => {
    assert.ok(screen.includes('{aboutOf(r) || <span className="text-zinc-400">-</span>}'), "인수번호가 없을 때의 `-` 가 사라졌다");
  });
});

describe("② 불출 신청 팝업 — 읽는 글과 치는 칸을 갈라 세운다 (2026-10-22)", () => {
  it("🔴 팝업이 비고를 **받는다** — 값은 신청 줄에서 오고, 팝업이 payload 를 다시 뜯지 않는다", () => {
    assert.ok(actions.includes("requestNote: string;"), "단추 묶음이 비고를 안 받는다");
    assert.ok(!actions.includes("requestNote?:"), "기본값을 주면 쓰는 화면이 느는 날 말없이 「비고 없음」으로 굳는다");
    // 🔵 뽑는 자리는 신청 줄 하나다 — 팝업이 jsonb 를 다시 뜯으면(`readRequestNote` 를 직접 부르면) 규칙이 둘이 된다.
    assert.ok(!actions.includes("readRequestNote("), "팝업이 신청의 jsonb 를 직접 뜯고 있다 — 뽑는 자리가 둘이 된다");
    assert.ok(screen.includes("requestNote={r.note}"), "목록이 팝업에 비고를 안 넘긴다");
  });

  it("🔴 **읽기 전용이다** — 입력 칸으로 그리지 않는다", () => {
    assert.ok(/\{requestNote \? \(\s*<p/.test(actions), "비고를 <p> 가 아닌 것으로 그린다 — 입력 칸처럼 보이면 고칠 수 있다고 믿는다");
    assert.ok(!/(input|textarea)[^>]*\{?requestNote/.test(actions), "비고가 입력 칸에 실려 있다");
    assert.ok(!actions.includes('name="requestNote"'), "비고가 폼 칸으로 올라간다 — 읽는 글이 저장된다");
  });

  it("🔴 **자리로 가른다** — 비고는 맨 위, 「신청 사유」 입력 칸은 아래", () => {
    const note = actions.indexOf("{requestNote ? (");
    const reason = actions.indexOf('<input name="reason"');
    const quantities = actions.indexOf("{lines.map((l) => (");
    assert.ok(note > 0 && reason > 0 && quantities > 0, "자리를 찾지 못했다 — 모양이 바뀌었으면 시험도 함께 고쳐라");
    assert.ok(note < quantities, "비고가 줄 목록 아래로 내려갔다 — 결재를 올리기 전에 읽는 글이다");
    assert.ok(note < reason, "비고가 「신청 사유」 칸 아래에 붙었다 — 둘이 한 묶음으로 읽힌다");
  });

  it("🔴 **이름표로도 가른다** — 승인 요청건에 선 것과 같은 말이다", () => {
    const label = "요청 비고 (신청한 사람이 적은 말): “{";
    assert.ok(actions.includes(`${label}requestNote}”`), "팝업의 이름표에 누구의 말인지가 없다");
    // 🔵 같은 날 승인 요청건에 세운 줄과 **같은 말**이어야 두 화면을 오가는 담당자가 같은 것으로 읽는다.
    assert.ok(src("src/components/stock/IssueApprovalScreen.tsx").includes(`${label}card.requestNote}”`), "승인 요청건의 이름표가 바뀌었다 — 두 화면이 다른 말을 한다");
  });

  it("🔴 「신청 사유」의 동작은 **한 글자도 안 바뀌었다** — 선택이고, 이름도 그대로다", () => {
    // 🔴 **칸 하나를 통째로** 잰다 — `required`·`minLength` 가 슬그머니 붙는 날 여기서 깨진다.
    //    🔵 보류 상자의 사유 칸도 이름이 `reason` 이라(그쪽은 필수다) 이름만으로는 가를 수 없다.
    assert.ok(actions.includes('<input name="reason" maxLength={500} className={FIELD} placeholder={PART_ISSUE_REASON_PLACEHOLDER} />'), "「신청 사유」 칸이 바뀌었다 — 이 조각은 그 칸을 건드리지 않는다");
    assert.ok(actions.includes('out.set("reason", reason)'), "「신청 사유」를 보내는 줄이 바뀌었다");
  });
});

describe("③ 건드리지 않은 두 화면 (2026-10-22)", () => {
  it("🔵 [기록내역]은 처음부터 비고를 **제 줄**에 그리고 있었다 — 그래서 한 글자도 안 고쳤다", () => {
    // 🔴 이 조각이 고친 것은 **이어 붙이던 [부품 요청] 쪽뿐**이다. 거기가 오히려 이 화면을 따라간 것이다.
    assert.ok(src("src/app/(app)/entries/page.tsx").includes("{e.note ? <p"), "기록 내역의 비고 줄이 바뀌었다");
  });

  it("🔵 [승인요청건]의 요청 비고는 **같은 날 눈 확인을 통과한 그대로**다", () => {
    const approvals = src("src/components/stock/IssueApprovalScreen.tsx");
    assert.ok(approvals.includes("{card.requestNote ? ("), "승인 요청건의 빈 울타리가 사라졌다");
    assert.ok(approvals.includes("신청 사유: “{card.reason}”"), "승인 요청건의 「신청 사유」 줄이 바뀌었다");
  });
});
