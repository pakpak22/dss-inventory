import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { SETTINGS_TABS, visibleSettingsTabs } from "../src/components/settings/SettingsNav";

/**
 * ============================================================================
 * 설정 묶음의 자격 — 어느 탭을 누가 여는가 (2026-10-21)
 * ============================================================================
 * 이날 **권한을 넓혔다.** 그 전까지 설정은 통째로 관리자 자리였다:
 *
 *  | 바뀐 것 | 틀리면 |
 *  |---|---|
 *  | **결재권 위임**이 `/approvals` 에서 설정의 탭으로 옮겨 옴 | 자리만 옮기고 문을 `requireRole("ADMIN")` 으로 맞추면, 결재선에 든 **보기 권한자가 자기 위임을 영영 못 만든다** — 자리를 비우는 동안 그 건이 선다 |
 *  | **O/H 템플릿**을 모두에게 엶 (막는 자리 **여섯**) | 하나라도 남으면 **화면은 보이는데 저장이 거절되거나** 그 반대가 된다. **후자가 더 나쁘다** — 화면에 아무 표시도 안 남는다 |
 *  | 머리말 **[설정]** 이 모두에게 보임 | 모두에게 관리자 전용 첫 탭을 물리면 눌러 보는 사람마다 `/forbidden` 으로 튄다 |
 *
 * ── 🔴 왜 소스 글자로 재는가 ───────────────────────────────────────────
 * 이 저장소에는 **DB 시험도 화면 렌더 시험도 없다.** 인가가 걸린 자리는 서버 컴포넌트와 서버
 * 액션 안이라 순수 함수로는 닿지 않는다 — `tests/approval-delegation-create.test.ts` 가 쓰는
 * 방식을 그대로 쓴다. 🔵 다만 **탭 목록만은 글자가 아니라 값으로 센다**(`visibleSettingsTabs`
 * 를 불러서). 「몇 개가 보이나」는 돌려 볼 수 있는 질문이라 글자로 재면 손해다.
 *
 * 🔴 **주석까지 긁지 않는다.** 이 조각이 고친 파일들의 머리말에는 「`requireRole("ADMIN")` 이었다」
 * 「따라 바꾸지 마라」 같은 말이 일부러 적혀 있다 — 왜 열었는지가 거기 적혀 있어야 다음 사람이
 * 되돌리지 않는다. 주석이 코드 대신 걸리면 그 주석을 지우는 쪽으로 사람이 움직인다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 주석을 걷어낸 코드만. 🔵 줄 단위로 쳐 낸다 — 이 파일들에 정규식 리터럴도, `//` 가 든 문자열도
 * 없다(있으면 아래 시험이 **더 엄하게** 걸릴 뿐 느슨해지지 않는다).
 */
function codeOnly(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    // 한 줄 안에서 열고 닫는 블록 주석
    for (;;) {
      const open = line.indexOf("/*");
      if (open === -1) break;
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        line = line.slice(0, open);
        inBlock = true;
        break;
      }
      line = line.slice(0, open) + line.slice(close + 2);
    }
    const slash = line.indexOf("//");
    if (slash !== -1) line = line.slice(0, slash);
    out.push(line);
  }
  return out.join("\n");
}

const OH_PAGE = "src/app/(app)/settings/oh-templates/page.tsx";
const OH_ACTIONS = "src/app/actions/oh-templates.ts";
const DELEGATIONS_PAGE = "src/app/(app)/settings/delegations/page.tsx";
const APPROVALS_PAGE = "src/app/(app)/approvals/page.tsx";
const HEADER = "src/components/AppHeader.tsx";

describe("① 🔴 O/H 템플릿 — 막던 여섯 자리가 **전부** 열렸다", () => {
  it("서버 액션 다섯이 `requireSession` 이고, 그 파일에 `requireRole` 이 **한 자리도** 없다", () => {
    const code = codeOnly(src(OH_ACTIONS));
    // 🔴 다섯 액션 전부. 하나라도 남으면 **화면은 보이는데 저장만 거절된다**.
    for (const fn of [
      "saveOhTemplateAction",
      "deleteOhTemplateAction",
      "linkProductModelAction",
      "unlinkProductModelAction",
      "setOhPriceAction",
    ]) {
      const start = code.indexOf(`export async function ${fn}(`);
      assert.notEqual(start, -1, `${fn} 이 사라졌다`);
      // 🔵 다음 export 까지만 본다 — 옆 함수가 대신 통과시키지 않게(같은 helper 의 까닭).
      const next = code.indexOf("\nexport ", start + 1);
      const body = code.slice(start, next === -1 ? undefined : next);
      assert.match(body, /await requireSession\(/, `${fn} 이 세션 문을 안 지난다`);
      assert.ok(!body.includes("requireRole"), `${fn} 이 아직 역할로 막는다 — 화면은 보이는데 저장만 거절된다`);
    }
    assert.equal(code.includes("requireRole"), false, "코드에 requireRole 이 남아 있다 — 여섯 중 하나가 안 열렸다");
    assert.match(code, /import \{ requireSession \} from "@\/lib\/auth\/session";/, "문지기를 바꿔 가져오지 않았다");
  });

  it("화면도 `requireSession` 이다 — 액션만 열고 화면을 잠가 두면 아무도 못 들어온다", () => {
    const code = codeOnly(src(OH_PAGE));
    assert.match(code, /await requireSession\("\/settings\/oh-templates"\)/, "화면이 아직 역할로 막는다");
    assert.equal(code.includes("requireRole"), false, "화면 코드에 requireRole 이 남아 있다");
  });

  it("🔴 같은 모양으로 적힌 **다른** 액션의 `requireRole` 은 그대로다 — 따라 바꾸지 않았다", () => {
    // 권한을 넓히는 조각은 옆으로 번지기 쉽다. 이 줄이 그 울타리다.
    const items = codeOnly(src("src/app/actions/part-items.ts"));
    assert.match(items, /requireRole\("ADMIN"\)/, "항목 관리 액션의 관리자 가드가 사라졌다 — 이 조각이 건드릴 자리가 아니다");
    const parts = codeOnly(src("src/app/actions/parts.ts"));
    assert.match(parts, /requireRole\("ADMIN"\)/, "부품 액션의 관리자 가드가 사라졌다 — 이 조각이 건드릴 자리가 아니다");
  });
});

describe("② 🔴 설정의 **나머지** 탭은 여전히 관리자 전용이다", () => {
  /** 🔵 주소까지 함께 본다 — `requireRole` 만 보면 되돌아갈 자리를 엉뚱한 데로 적어도 통과한다. */
  const ADMIN_ONLY: [string, string][] = [
    ["src/app/(app)/settings/items/page.tsx", "/settings/items"],
    ["src/app/(app)/settings/transition/page.tsx", "/settings/transition"],
    ["src/app/(app)/settings/workbook/page.tsx", "/settings/workbook"],
    ["src/app/(app)/settings/workbook/apply/page.tsx", "/settings/workbook/apply"],
    ["src/app/(app)/settings/approval-routes/page.tsx", "/settings/approval-routes"],
    ["src/app/(app)/audit/page.tsx", "/audit"],
  ];

  for (const [file, path] of ADMIN_ONLY) {
    it(`${path} 는 \`requireRole("ADMIN")\` 이다`, () => {
      const code = codeOnly(src(file));
      assert.ok(
        code.includes(`await requireRole("ADMIN", "${path}")`),
        `${path} 의 관리자 문이 사라졌다 — 설정에서 연 것은 결재권 위임과 O/H 템플릿 **둘뿐**이다`,
      );
    });
  }
});

describe("③ 🔴 결재권 위임 화면은 `requireSession` 이다 — 설정에 있다고 ADMIN 으로 맞추지 않았다", () => {
  it("문과 돌아갈 자리", () => {
    const code = codeOnly(src(DELEGATIONS_PAGE));
    assert.match(code, /await requireSession\("\/settings\/delegations"\)/);
    assert.equal(code.includes("requireRole"), false, "보기 권한자가 자기 위임을 못 만든다");
  });

  it("🔴 맡기기·되돌리기가 **이 화면으로** 돌아온다 — 옛 주소면 성공 문구가 그릴 자리를 잃는다", () => {
    const code = codeOnly(src("src/app/actions/approval-delegations.ts"));
    assert.match(code, /= "\/settings\/delegations"/, "돌아갈 자리가 옛 주소(/approvals)에 머물러 있다");
    assert.equal(code.includes('"/approvals"'), false, "액션이 아직 결재 화면으로 돌려보낸다 — 거기엔 위임 구역이 없다");
  });
});

describe("④ 🔴 `/approvals` 에 위임 **구역**은 없고 **링크**만 남았다", () => {
  const page = src(APPROVALS_PAGE);

  it("구역도, 그 자료를 읽는 질의도 옮겨 갔다", () => {
    const code = codeOnly(page);
    assert.equal(code.includes("<DelegationSection"), false, "위임 구역이 아직 결재 화면에 있다 — 두 곳에 있으면 같은 일을 두 자리에서 한다");
    assert.equal(code.includes("DelegationSection"), false, "쓰지도 않는 조각을 아직 가져온다");
    // 🔴 읽기를 안 옮기면 결재 화면이 **쓰지도 않을 A/S 명부 호출**(망을 타고, 최대 5초)을 매번 기다린다.
    assert.equal(code.includes("readDelegationScreen"), false, "결재 화면이 아직 위임 자료를 읽는다");
    assert.equal(code.includes("delegationNotice"), false, "그릴 구역이 없는데 꼬리표만 읽는다");
  });

  it("🔵 **길은 남아 있다** — 결재자가 날마다 오는 화면이 여기라 출장 전에 찾는 자리도 여기다", () => {
    const code = codeOnly(page);
    assert.match(code, /href="\/settings\/delegations"/, "결재 화면에서 위임으로 가는 길이 끊겼다");
  });

  it("결재 화면의 문은 **그대로** `requireSession` 이다", () => {
    const code = codeOnly(page);
    assert.match(code, /await requireSession\("\/approvals"\)/);
    assert.equal(code.includes("requireRole"), false, "결재 화면이 역할로 막기 시작했다");
  });
});

describe("⑤ 탭 줄 — 일반 사용자에게 **둘**, 관리자에게 **전부**", () => {
  it("모두가 쓰는 탭은 결재권 위임 · O/H 템플릿 **둘뿐**이다", () => {
    const everyone = visibleSettingsTabs(false);
    assert.deepEqual(
      everyone.map((t) => t.key),
      ["delegations", "oh"],
      "일반 사용자에게 보이는 탭이 둘이 아니다",
    );
    assert.deepEqual(
      everyone.map((t) => t.href),
      ["/settings/delegations", "/settings/oh-templates"],
      "열린 탭의 주소가 실제로 연 화면과 다르다",
    );
    assert.deepEqual(everyone.map((t) => t.label), ["결재권 위임", "O/H 템플릿"]);
  });

  it("관리자는 **전부** 본다 — 넓히면서 관리자에게서 무엇을 빼앗지 않았다", () => {
    assert.deepEqual(
      visibleSettingsTabs(true).map((t) => t.key),
      SETTINGS_TABS.map((t) => t.key),
      "관리자 탭이 줄었다",
    );
    assert.equal(SETTINGS_TABS.length, 7);
  });

  it("🔴 **감추는 것은 울타리가 아니다** — 열린 둘 말고는 전부 관리자 화면이 따로 막는다", () => {
    // 이 줄은 ② 와 짝이다: 탭을 지워도 주소를 손으로 치면 들어가지고, 그때 막는 것은 그 화면이다.
    const adminTabs = SETTINGS_TABS.filter((t) => !t.everyone).map((t) => t.href);
    assert.deepEqual(adminTabs, ["/settings/items", "/settings/transition", "/settings/workbook", "/settings/approval-routes", "/audit"]);
  });
});

describe("⑥ 🔴 머리말 [설정] — 역할로 **가리지 않는다**", () => {
  const header = codeOnly(src(HEADER));

  it("`isAdmin &&` 로 감싸지 않는다", () => {
    const start = header.indexOf("href={isAdmin ?");
    assert.notEqual(start, -1, "[설정] 링크가 역할로 갈라지는 주소를 쓰지 않는다");
    assert.equal(header.includes("{isAdmin && ("), false, "[설정] 이 다시 관리자에게만 보인다 — 보기 권한자가 자기 위임을 만들러 갈 길이 없다");
  });

  it("🔴 **가는 곳**이 역할에 따라 갈린다 — 일반 사용자를 관리자 전용 탭으로 보내면 바로 `/forbidden` 이다", () => {
    assert.match(
      header,
      /href=\{isAdmin \? "\/settings\/items" : "\/settings\/delegations"\}/,
      "[설정] 이 모두를 같은 곳으로 보낸다",
    );
    // 🔵 일반 사용자가 가는 곳은 **자기에게 열린 첫 탭**이어야 한다(탭 차례가 바뀌면 여기도 바뀐다).
    assert.equal(visibleSettingsTabs(false)[0].href, "/settings/delegations", "[설정] 이 보내는 곳과 첫 탭이 어긋났다");
    assert.equal(visibleSettingsTabs(true)[0].href, "/settings/items", "관리자가 가는 곳과 첫 탭이 어긋났다");
  });
});
