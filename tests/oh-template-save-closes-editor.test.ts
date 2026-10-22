import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ============================================================================
 * O/H 템플릿 — **저장하면 편집기가 닫히고 목록이 다시 그려진다** (2026-10-22 요청 2)
 * ============================================================================
 * 쓰는 분의 말 그대로:
 *   「새 템플릿을 만들고 저장을 누르면 화면이 리프레시 되면서 팝업이 뜨는데, 기존의 템플릿을
 *    저장하면 리프레시 되지는 않고 팝업만 뜨네. 리프레시 되면서 팝업이 뜨도록 해줘.」
 *
 * ── 🔴 `router.refresh()` 는 **그때도 돌고 있었다** ──────────────────────
 * 두 자리 다 `done()` 을 불렀고 `done()` 안에서 다시 읽기가 돌았다. 갈린 것은 **편집기를
 * 닫느냐** 하나였다. 새 템플릿 쪽은 `setCreating(false)` 로 닫았고, 기존 템플릿 쪽은
 * `onSaved={done}` 이라 **열린 채**로 남았다. 열려 있는 편집기는 제 입력값을 지역 상태
 * (`name`·`items`·`prices`)로 들고 있어서, 서버에서 다시 읽어 온 자료가 화면에 한 글자도
 * 비치지 않는다 — 그래서 「팝업만 뜨고 리프레시가 안 된다」로 보였다.
 *
 * ── 🔴 이 시험이 막는 것: **한쪽만 고치는 날** ──────────────────────────
 * 둘은 같은 `TemplateEditor` 의 같은 [저장] 단추이고, 자리만 다르다. 한쪽 모양이 틀어지면
 * 그 자리에서만 조용히 예전 증상으로 돌아간다 — **오류가 안 난다.** 그래서 둘을 **같은
 * 모양인지**까지 견준다.
 *
 * ── 🔴 이 화면에는 렌더 시험 틀이 없다 ──────────────────────────────────
 * 서버 액션을 물고 있어 그릴 수 없다(`tests/oh-template-part-picking.test.ts` 머리말과 같은
 * 사정). 그래서 **파일 글자에서** 잰다.
 * 🔴 **주석을 떼고 재는 쪽을 좁힌다**(`stripComments` + `slice`) — 이 저장소에서 설명하려고
 *    인용한 주석 글자가 그대로 세어져 헛통과·헛실패가 난 적이 있다(2026-10-16).
 * ============================================================================
 */

const src = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 떼어 낸 코드만. JSX 의 중괄호 주석도 블록 주석이라 함께 떨어진다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const SCREEN = stripComments(src("src/components/settings/OhTemplateScreen.tsx"));

/** 두 글자 사이만 자른다. 🔴 끝을 안 끊으면 뒤 글자에 걸려 헛통과한다. */
function slice(source: string, fromText: string, toText: string, what: string): string {
  const from = source.indexOf(fromText);
  assert.notEqual(from, -1, `${what}: 시작 글자를 못 찾았다 — 자를 자리를 다시 정해야 한다`);
  const to = source.indexOf(toText, from + fromText.length);
  assert.notEqual(to, -1, `${what}: 끝 글자를 못 찾았다 — 자를 자리를 다시 정해야 한다`);
  return source.slice(from, to);
}

/** 들여쓰기·줄바꿈을 지운다 — 줄을 어떻게 접었는지로 시험이 갈리면 안 된다. */
const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** 새 템플릿을 만드는 자리의 편집기. */
const NEW_EDITOR = slice(SCREEN, "{creating && (", "{templates.length === 0 ?", "새 템플릿 편집기");
/** 목록에서 [편집] 으로 펼친 기존 템플릿의 편집기. */
const EXISTING_EDITOR = slice(SCREEN, "{isOpen ? (", "<ItemPreview", "기존 템플릿 편집기");

/**
 * 저장에 성공했을 때 도는 손잡이만 잘라 낸다.
 * 🔴 끝을 `onClose=` 로 끊는다 — 안 끊으면 `onClose` 쪽의 `setOpenId(null)` 이 함께 들어와
 *    「닫고 있다」가 **저장과 상관없이** 참이 되어 버린다(헛통과).
 */
function onSavedHandler(block: string, what: string): string {
  const at = block.indexOf("onSaved=");
  assert.notEqual(at, -1, `${what}: onSaved 가 없다 — 저장 뒤에 할 일을 넘기지 않는다`);
  const end = block.indexOf("onClose=", at);
  assert.notEqual(end, -1, `${what}: onSaved 다음의 onClose 를 못 찾았다 — 자를 자리를 다시 정해야 한다`);
  return block.slice(at, end);
}

/**
 * 두 자리. `close` 는 **그 자리에서 편집기를 닫는 몸짓**이다 — 새 템플릿은 만들기 카드를
 * 접고(`creating`), 기존 템플릿은 펼쳐 둔 줄을 접는다(`openId`).
 */
const SIDES = [
  {
    what: "새 템플릿",
    block: NEW_EDITOR,
    close: "setCreating(false)",
    symptom: "등록한 뒤에도 빈 [새 템플릿] 카드가 그대로 남는다",
  },
  {
    what: "기존 템플릿",
    block: EXISTING_EDITOR,
    close: "setOpenId(null)",
    symptom: "편집기가 열린 채 남아, 지역 상태가 다시 읽어 온 자료를 덮는다 (2026-10-22 신고)",
  },
] as const;

describe("① 저장에 성공하면 **편집기를 닫고** 알린다 — 두 자리가 같은 모양이다", () => {
  for (const side of SIDES) {
    const handler = onSavedHandler(side.block, side.what);

    it(`🔴 ${side.what}: 손잡이가 \`onSaved={done}\` 이 아니다 — 그냥 넘기면 안 닫힌다`, () => {
      assert.ok(
        !/onSaved=\{done\}/.test(squash(handler)),
        `${side.what}: 저장 뒤에 ${side.close} 없이 done 만 부른다 — ${side.symptom}`,
      );
    });

    it(`🔴 ${side.what}: **닫고 나서** done 을 부른다 (${side.close} → done)`, () => {
      const closeAt = handler.indexOf(side.close);
      const doneAt = handler.indexOf("done(");
      assert.notEqual(closeAt, -1, `${side.what}: 닫는 몸짓(${side.close})이 없다 — ${side.symptom}`);
      assert.notEqual(doneAt, -1, `${side.what}: done 을 안 부른다 — 팝업도 다시 읽기도 사라진다`);
      assert.ok(closeAt < doneAt, `${side.what}: done 을 부른 뒤에 닫는다 — 차례가 두 자리에서 달라졌다`);
    });

    it(`🔵 ${side.what}: 저장이 끝났다는 **말을 그대로 넘긴다**(\`done(saved)\`) — 팝업에 적힐 글이다`, () => {
      assert.ok(
        squash(handler).includes("done(saved)"),
        `${side.what}: 서버가 보낸 말을 안 넘긴다 — 팝업이 빈 채로 뜬다`,
      );
    });
  }

  it("🔴 두 자리가 **글자까지 같은 모양**이다 — 닫는 몸짓의 이름만 다르다", () => {
    /**
     * 🔴 이 단언 하나가 「나중에 한쪽만 고치는 날」을 막는다. 둘은 같은 `TemplateEditor` 의 같은
     *    [저장] 단추이고 자리만 다르다 — 한쪽에만 손을 대면 그 자리에서만 조용히 다르게 군다.
     * 🔵 닫는 몸짓은 자리마다 이름이 다를 수밖에 없어(`creating` vs `openId`) 그 한 낱말만
     *    같은 딱지로 바꿔 놓고 견준다.
     */
    const shapes = SIDES.map((side) => squash(onSavedHandler(side.block, side.what)).replace(side.close, "<닫기>"));
    assert.equal(
      shapes[0],
      shapes[1],
      `두 자리의 저장 뒤 처리가 갈렸다:\n  새 템플릿: ${shapes[0]}\n  기존 템플릿: ${shapes[1]}`,
    );
  });
});

describe("② 닫아도 **안전하다** — 손잡이는 성공했을 때만 불린다", () => {
  /**
   * 🔴 이것이 깨지면 **사람이 적던 내용이 사라진다.** 저장이 거절당했는데 편집기가 닫히면
   *    지역 상태가 통째로 버려지고, 다시 열면 서버에 있던 옛 자료가 올라온다.
   */
  const SAVE = slice(SCREEN, "async function save()", "const unlinkedInDraft", "저장 함수");

  it("🔴 `onSaved` 가 **실패 때 빠져나가는 return 뒤**에서만 불린다", () => {
    const guardAt = SAVE.indexOf("if (!result.ok)");
    const returnAt = SAVE.indexOf("return;", guardAt === -1 ? 0 : guardAt);
    const onSavedAt = SAVE.indexOf("onSaved(");
    assert.notEqual(guardAt, -1, "실패를 가리는 자리가 없어졌다 — 거절당해도 성공처럼 군다");
    assert.notEqual(returnAt, -1, "실패했을 때 빠져나가지 않는다");
    assert.notEqual(onSavedAt, -1, "저장이 끝나도 아무에게도 안 알린다");
    assert.ok(returnAt < onSavedAt, "실패해도 onSaved 가 불린다 — 편집기가 닫혀 적던 내용이 사라진다");
  });

  it("🔴 `onSaved` 를 부르는 자리가 **하나**다 — 실패 길에 따로 불러 두지 않았다", () => {
    assert.equal(
      [...SAVE.matchAll(/onSaved\(/g)].length,
      1,
      "저장 함수가 onSaved 를 여러 자리에서 부른다 — 그중 하나가 실패 길일 수 있다",
    );
  });

  it("🔴 삭제도 같다 — 거절당하면 `onDone` 을 안 부른다", () => {
    /**
     * 🔵 삭제 쪽(`DeleteTemplateDialog`)은 **기존 템플릿의 `onSaved` 를 그대로 받는다**
     *    (`onDone={onSaved}`). 그래서 위 ① 을 고치면 지운 뒤에도 편집기가 닫힌다 — 그 템플릿
     *    자체가 목록에서 사라지므로 그게 맞다. 다만 **거절당했을 때는 닫히면 안 된다**:
     *    적어 둔 삭제 사유가 사라지고, 사람은 왜 안 지워졌는지 적힌 글도 못 읽는다.
     */
    const REMOVE = slice(SCREEN, "async function remove()", "return (", "삭제 함수");
    // 🔴 **거절을 가리는 자리에서부터** 센다 — 그냥 첫 `return;` 으로 재면 맨 위의
    //    `if (pending) return;` 에 걸려, 거절 검사를 통째로 지워도 조용히 통과한다.
    const guardAt = REMOVE.indexOf("if (!result.ok)");
    assert.notEqual(guardAt, -1, "삭제가 거절당한 것을 안 가린다");
    const returnAt = REMOVE.indexOf("return;", guardAt);
    const onDoneAt = REMOVE.indexOf("onDone(");
    assert.notEqual(returnAt, -1, "삭제가 거절당해도 빠져나가지 않는다");
    assert.notEqual(onDoneAt, -1, "지운 뒤에 아무에게도 안 알린다");
    assert.ok(returnAt < onDoneAt, "삭제가 거절당해도 onDone 이 불린다 — 적어 둔 삭제 사유가 사라진다");
  });
});

describe("③ `done()` 은 그대로다 — 팝업을 띄우고 **다시 읽는다**", () => {
  /** 🔴 이 조각은 「저장 뒤에 무엇이 보이느냐」만 바꿨다. 다시 읽기 자체는 처음부터 맞게 돌았다. */
  const DONE = slice(SCREEN, "function done(saved: string)", "return (", "알림 + 다시 읽기");

  it("🔴 서버 자료를 다시 읽는다(`router.refresh()`)", () => {
    assert.ok(DONE.includes("router.refresh()"), "다시 읽지 않는다 — 목록이 옛 값 그대로 남는다");
  });

  it("🔴 팝업을 띄우고, 띠 메시지는 지운다", () => {
    assert.ok(DONE.includes("setPopup(saved)"), "팝업이 안 뜬다");
    assert.ok(DONE.includes("setMessage(null)"), "오류 띠가 성공 뒤에도 남는다");
  });
});
