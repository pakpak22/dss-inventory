import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  approvalsDelegationHref,
  portalDelegationCounterpartLabel,
  APPROVALS_DELEGATION_PATH,
  DELEGATION_SOURCE_PORTAL,
  PORTAL_DELEGATION_HEADING,
  PORTAL_DELEGATION_NOTHING_ACTING,
  PORTAL_DELEGATION_NOTHING_MADE,
  PORTAL_DELEGATION_REVOKE_HINT,
  PORTAL_DELEGATION_UNKNOWN_NAME,
} from "../src/lib/approval/delegation-screen";

/**
 * ============================================================================
 * 위임 화면의 **통합 승인함 묶음** (2026-11-17, 조각 3c · 설계 D-2)
 * ============================================================================
 * 쓰는 분이 승인함에서 위임을 맡기고 재고관리를 열었는데 **「위임되었다는 내용이 안 뜬다」**고
 * 했다. 전파도 판정도 멀쩡했고(줄이 `portal_approval_delegations` 에 살아 있었다) **화면이
 * 제 표만 그리고 있던** 것이었다. 그 묶음을 더하면서 지키는 것:
 *
 *  1. 🔴 **승인함에서 온 줄에는 [되돌리기]가 없다.** 이 집에는 그 줄을 거두는 통로 자체가 없어
 *     (표 머리말 ⓑ), 단추를 그리면 **눌러도 거절조차 안 되는 단추**가 된다.
 *  2. 🔴 **여기서 맡긴 줄에는 그대로 있다** — 1번을 넓게 읽어 제 표 줄의 단추까지 걷으면
 *     위임을 거둘 길이 통째로 사라진다. 🔵 그래서 **둘을 함께** 잰다.
 *  3. 🔴 **출처가 글자로 갈린다**(설계 D-2) — 색이 아니라 글자다. 되돌리려고 찾을 때 어느 줄이
 *     어디 것인지가 그 자리에서 보여야 한다.
 *  4. 🔴 **환경변수가 없어도 화면이 그려진다** — 승인함 주소를 아직 안 넣은 곳에서 설정 탭이
 *     통째로 안 열리면, 위임을 보러 온 사람이 **제 위임도 못 본다.**
 *  5. 🔴 **0건이어도 묶음을 그린다** — 0건이 보여야 「전파가 안 닿았구나」를 안다. 감추면 쓰는
 *     분이 본 그 화면으로 돌아간다.
 *  6. 🔴 **「모두의 결재권 위임」 묶음이 제 울타리를 말한다**(⑤, 2026-11-17 뒤늦게 고침). 이
 *     묶음을 세우면서 그 아래 묶음의 설명문을 **같이 안 고쳤고**, 「모든 분의 결재권 위임을
 *     봅니다」가 그대로 남아 있었다 — 승인함에서 맡긴 줄은 거기 한 줄도 안 뜨는데도. 관리자는
 *     그 묶음만 읽고 「다 봤다」고 믿었고 **오류는 한 줄도 안 났다.**
 *
 * ── 🔴 이 저장소에는 화면 렌더 시험이 없다 ──────────────────────────────
 * 그래서 뜻은 순수 함수로 재고(③④), 「화면이 무엇을 그리나」는 **소스 글자**로 잰다
 * (`tests/portal-delegation.test.ts` 와 같은 방식).
 * 🔴 **주석은 걷어내고 본다** — 이 집은 「왜 그렇게 했는가」를 길게 적어서, 「단추를 그리지
 *    않는다」는 **설명이 곧 금지어를 품는다.** 걷어내지 않으면 금지 쪽은 설명 때문에 깨지고,
 *    더 나쁘게는 **있어야 할 것**을 재는 쪽이 주석만으로 영영 통과한다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석을 떼어 낸 코드만. JSX 의 중괄호 주석도 블록 주석이라 함께 떨어진다.
 *
 * 🔴 줄 주석은 **줄 처음에 선 것만** 지운다. 줄 어디서든 빗금 둘 뒤를 통째로 지우면 글자 안의
 *    `http://` 도 함께 날아가고, 그러면 아래 「주소를 코드에 박지 않았다」가 **언제나 통과**한다.
 *
 * 🔴 **주석 안에 정규식 조각을 그대로 적지 마라**(2026-11-17 실측). 별표 뒤에 빗금이 오는 조각을
 *    설명하려고 적었더니 그 자리가 **블록 주석의 끝**으로 읽혀, 남은 설명이 코드로 파싱되면서
 *    파일이 통째로 안 열렸다. 오류 자리는 스무 줄 아래의 엉뚱한 곳으로 찍힌다.
 */
const code = (relative: string): string =>
  src(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SECTION = code("src/components/approval/DelegationSection.tsx");
const QUERIES = code("src/lib/approval/delegation-queries.ts");
const SCREEN = code("src/lib/approval/delegation-screen.ts");
const ENV = code("src/lib/env.ts");

/** 두 글자 사이만 자른다. 🔴 끝을 안 끊으면 뒤 글자에 걸려 헛통과한다. */
function slice(source: string, fromText: string, toText: string, what: string): string {
  const from = source.indexOf(fromText);
  assert.notEqual(from, -1, `${what}: 시작 글자(${fromText})를 못 찾았다 — 자를 자리를 다시 정해야 한다`);
  const to = source.indexOf(toText, from + fromText.length);
  assert.notEqual(to, -1, `${what}: 끝 글자(${toText})를 못 찾았다 — 자를 자리를 다시 정해야 한다`);
  const cut = source.slice(from, to);
  // 🔵 **표본이 비어서 공짜로 통과하지 않게.** 잘라 낸 것이 한 줄짜리면 뒤의 단언은 아무것도 안 잰다.
  assert.ok(cut.length > 50, `${what}: 잘라 낸 자리가 너무 짧다(${cut.length}자) — 무엇을 재는지부터 틀렸다`);
  return cut;
}

/** 승인함 줄 한 줄을 그리는 부품의 본문. */
const PORTAL_ROW = slice(SECTION, "function PortalDelegationRow(", "export function DelegationSection(", "승인함 줄 부품");
/**
 * 「내가 맡긴 것」(제 표) 묶음의 본문 — 되돌리기 단추가 사는 자리.
 *
 * 🔵 **자르는 글자가 2026-11-17 에 바뀌었다**(`made` → `made.live`). 그날 네 묶음이 「끝난 위임」
 *    접기를 갖게 되면서 목록이 **살아 있는 줄과 끝난 줄 둘**로 갈렸다 — 재는 것은 그대로다.
 */
const MADE_GROUP = slice(SECTION, "{made.live.length === 0 ? (", "{acting.live.length === 0 ? (", "제 표 「내가 맡긴 것」 묶음");
/** 승인함 묶음의 JSX. */
const PORTAL_GROUP = slice(SECTION, "{PORTAL_DELEGATION_HEADING}", "{all && (", "승인함 묶음");
/**
 * 「모두의 결재권 위임」 묶음의 **설명문 한 문단**(⑤가 재는 것).
 *
 * 🔴 묶음 전체가 아니라 **그 문단만** 자른다 — 묶음에는 줄마다의 글자·0건 문구·단추가 섞여 있어,
 *    통째로 재면 「승인함」이라는 낱말이 **엉뚱한 자리**에서 걸려 아래 단언들이 헛통과한다.
 * 🔵 문단의 첫 글자가 바뀌면 `slice` 가 **큰 소리로 멈춘다**(조용히 0자를 재지 않는다).
 */
const ALL_GROUP = slice(SECTION, "{all && (", "</section>", "모두의 묶음");
const ALL_NOTE = slice(ALL_GROUP, "관리 권한이 있어", "</p>", "모두의 묶음 설명문");

describe("① 🔴 [되돌리기]는 **여기서 맡긴 줄에만** 그려진다", () => {
  it("🔴 승인함 줄을 그리는 부품에 단추도, 단추를 켜는 칸도 없다", () => {
    for (const forbidden of ["되돌리기", "revoke", "canRevoke"]) {
      assert.ok(!PORTAL_ROW.includes(forbidden), `승인함 줄 부품에 ${forbidden} 가 있다 — 여기서는 거둘 수 없는 줄이다`);
    }
    // 🔴 묶음 전체로도 본다 — 부품 밖(묶음 JSX)에 단추를 붙이면 위 단언을 비켜 간다.
    for (const forbidden of ["되돌리기", "revoke"]) {
      assert.ok(!PORTAL_GROUP.includes(forbidden), `승인함 묶음에 ${forbidden} 가 있다`);
    }
  });

  it("🔴 돌려받는 **모양에 `canRevoke` 칸 자체가 없다** — 약속이 아니라 모양으로 막는다", () => {
    const type = slice(SCREEN, "export type PortalDelegationRowView = {", "};", "승인함 줄 타입");
    assert.ok(type.includes("counterpartName"), "타입을 잘못 잘랐다 — 이 시험이 아무것도 안 재고 있다");
    assert.ok(!type.includes("canRevoke"), "칸이 생겼다 — 다음 사람이 참을 실어 보내면 거절조차 안 되는 단추가 뜬다");
    // 🔵 「누가 되돌렸나」도 없다 — 포털 몸통에 그 칸이 없어 영원히 null 이다.
    assert.ok(!type.includes("revokedByName"), "영원히 null 인 칸을 두면 다음 사람이 까닭을 찾아 헤맨다");

    const toView = slice(QUERIES, "function toPortalRowView(", "export async function listPortalDelegationsIMade(", "승인함 줄 만드는 자리");
    assert.ok(toView.includes("state: delegationState(row, now)"), "상태를 안 싣는다 — 시험이 엉뚱한 자리를 보고 있다");
    assert.ok(!toView.includes("canRevoke"), "조회가 되돌리기 칸을 싣기 시작했다");
  });

  it("🔴 **여기서 맡긴 줄의 단추는 그대로다** — 금지를 넓게 읽어 멀쩡한 길까지 막지 않았다", () => {
    assert.ok(MADE_GROUP.includes("row.canRevoke ?"), "제 표 줄의 되돌리기 판정이 사라졌다");
    assert.ok(MADE_GROUP.includes("되돌리기"), "제 표 줄에서 되돌리기 단추가 사라졌다 — 위임을 거둘 길이 없어진다");
    assert.ok(MADE_GROUP.includes('name="delegationId"'), "되돌리기 폼이 줄 번호를 안 보낸다");
  });
});

describe("② 🔴 출처가 **글자로** 갈린다 (설계 D-2)", () => {
  it("딱지 글자가 비어 있지 않고 「승인함」이라고 말한다", () => {
    assert.ok(DELEGATION_SOURCE_PORTAL.trim().length > 0, "딱지가 빈 글자다 — 색만 남으면 출처를 못 읽는다");
    assert.ok(DELEGATION_SOURCE_PORTAL.includes("승인함"), "딱지가 어디 것인지 말해 주지 않는다");
    assert.ok(PORTAL_DELEGATION_HEADING.includes("승인함"), "묶음 제목이 어디 것인지 말해 주지 않는다");
  });

  it("🔴 **줄마다** 붙는다 — 묶음 제목만으로 가르지 않는다", () => {
    assert.ok(PORTAL_ROW.includes("{DELEGATION_SOURCE_PORTAL}"), "줄에 출처 딱지가 없다 — 줄을 하나씩 읽는 사람에게는 제목이 멀다");
    // 🔴 색만으로 가르지 않는다(CLAUDE.md 9-7절) — 상태 배지도 글자와 함께 그린다.
    assert.ok(PORTAL_ROW.includes("{badge.label}"), "상태를 색으로만 그린다");
  });

  it("🔴 제 표 줄에는 그 딱지가 **없다** — 두 묶음이 같은 얼굴이면 가른 뜻이 없다", () => {
    const localRow = slice(SECTION, "function DelegationRow(", "function AllDelegationRow(", "제 표 줄 부품");
    assert.ok(localRow.includes("counterpartName"), "부품을 잘못 잘랐다");
    assert.ok(!localRow.includes("DELEGATION_SOURCE_PORTAL"), "제 표 줄에 「통합 승인함」 딱지가 붙었다");
  });

  it("🔴 0건이어도 묶음을 **그린다** — 감추면 「전파가 안 닿았다」를 알 길이 없다", () => {
    assert.ok(PORTAL_GROUP.includes("{PORTAL_DELEGATION_NOTHING_MADE}"), "맡긴 것이 0건일 때 아무 말도 안 한다");
    assert.ok(PORTAL_GROUP.includes("{PORTAL_DELEGATION_NOTHING_ACTING}"), "대신하는 것이 0건일 때 아무 말도 안 한다");
    for (const text of [PORTAL_DELEGATION_NOTHING_MADE, PORTAL_DELEGATION_NOTHING_ACTING]) {
      assert.ok(text.includes("승인함"), `0건 문구가 어느 묶음 이야기인지 말해 주지 않는다: ${text}`);
    }
    // 🔴 묶음 전체를 조건으로 감싸면 0건일 때 통째로 사라진다 — 관리자 묶음(`{all && (`)과 다른 점이다.
    assert.ok(!SECTION.includes("{portal && ("), "자료가 있을 때만 묶음을 그린다 — 0건이 사라진다");
  });
});

describe("③ 🔴 이름을 못 찾는 줄을 어떻게 그리나", () => {
  it("못 찾으면 **줄은 그리고 이름 자리에만** 그 사실을 적는다", () => {
    assert.ok(PORTAL_DELEGATION_UNKNOWN_NAME.trim().length > 0, "빈 글자를 그리면 `님` 앞이 비어 더 헷갈린다");
    assert.equal(portalDelegationCounterpartLabel(null), PORTAL_DELEGATION_UNKNOWN_NAME);
    assert.equal(portalDelegationCounterpartLabel(""), PORTAL_DELEGATION_UNKNOWN_NAME, "빈 이름도 못 찾은 것으로 친다");
    assert.equal(portalDelegationCounterpartLabel("   "), PORTAL_DELEGATION_UNKNOWN_NAME, "공백만 든 이름도 마찬가지다");
  });

  it("찾았으면 **그대로** 그린다 — 가짜 이름을 지어내지 않는다", () => {
    assert.equal(portalDelegationCounterpartLabel("홍길동"), "홍길동");
    assert.equal(portalDelegationCounterpartLabel("  홍길동  "), "홍길동", "앞뒤 공백만 걷는다");
  });

  it("🔴 화면이 **그 함수를 거쳐** 그린다 — 날것을 그리면 null 이 그대로 나간다", () => {
    assert.ok(PORTAL_ROW.includes("portalDelegationCounterpartLabel(row.counterpartName)"), "이름을 날것으로 그린다");
  });

  it("🔴 조회가 **못 찾은 줄을 빼지 않는다** — `leftJoin` 이다", () => {
    for (const name of ["listPortalDelegationsIMade", "listPortalDelegationsIActFor"]) {
      const at = QUERIES.indexOf(`export async function ${name}(`);
      assert.notEqual(at, -1, `${name} 이 없다`);
      const rest = QUERIES.slice(at + 10);
      const end = rest.indexOf("\nexport ");
      const fn = end === -1 ? rest : rest.slice(0, end);
      assert.ok(fn.includes(".leftJoin(users,"), `${name}: inner join 이면 이름 못 찾는 줄이 통째로 사라진다 — 「맡겼는데 없다」가 돌아온다`);
    }
  });
});

describe("④ 🔴 승인함 주소 — **없어도 화면이 그려진다**", () => {
  it("주소를 모르면 링크가 `null` 이다 — 빈 주소로 가는 단추를 만들지 않는다", () => {
    assert.equal(approvalsDelegationHref(null), null);
    assert.equal(approvalsDelegationHref(""), null, "빈 값도 모르는 것으로 친다");
    assert.equal(approvalsDelegationHref("   "), null, "공백만 든 값도 마찬가지다");
  });

  it("알면 승인함의 위임 화면으로 간다 — 끝 슬래시를 붙여도 깨지지 않는다", () => {
    assert.equal(approvalsDelegationHref("http://10.0.0.9:3900"), `http://10.0.0.9:3900${APPROVALS_DELEGATION_PATH}`);
    assert.equal(approvalsDelegationHref("http://10.0.0.9:3900/"), `http://10.0.0.9:3900${APPROVALS_DELEGATION_PATH}`);
    assert.equal(approvalsDelegationHref("http://10.0.0.9:3900///"), `http://10.0.0.9:3900${APPROVALS_DELEGATION_PATH}`);
    assert.equal(approvalsDelegationHref("  http://10.0.0.9:3900  "), `http://10.0.0.9:3900${APPROVALS_DELEGATION_PATH}`);
    assert.ok(APPROVALS_DELEGATION_PATH.startsWith("/"), "경로가 슬래시로 시작하지 않으면 앞머리와 붙어 버린다");
  });

  it("🔴 **안내 글자는 링크 조건 밖**에 있다 — 주소가 없어도 어디로 가야 하는지는 말해 준다", () => {
    const hintAt = PORTAL_GROUP.indexOf("{PORTAL_DELEGATION_REVOKE_HINT}");
    const condAt = PORTAL_GROUP.indexOf("{portal.href ? (");
    assert.notEqual(hintAt, -1, "안내 글자를 안 그린다 — 「여기서는 못 거둔다」를 말할 자리가 없어진다");
    assert.notEqual(condAt, -1, "링크를 조건 없이 그린다 — 주소가 없으면 빈 링크가 뜬다");
    assert.ok(hintAt < condAt, "안내 글자가 링크 조건 안으로 들어갔다 — 주소가 없으면 아무 말도 안 하게 된다");
    assert.ok(PORTAL_DELEGATION_REVOKE_HINT.includes("승인함"), "어디로 가야 하는지를 글자로 말해 주지 않는다");
  });

  it("🔴 환경변수가 **서버를 막지 않는다** — `optional` 이고 시작 검사 목록에도 없다", () => {
    assert.ok(ENV.includes('optional("APPROVALS_BASE_URL", "")'), "required 로 읽으면 주소를 안 넣은 곳에서 설정 탭이 통째로 안 열린다");
    const startup = slice(ENV, "export function assertEnvOnStartup(", "for (const [, check]", "시작 검사 목록");
    assert.ok(startup.includes("DATABASE_URL"), "목록을 잘못 잘랐다");
    assert.ok(!startup.includes("APPROVALS_BASE_URL"), "시작 검사에 넣으면 주소가 없는 곳에서 서버가 안 뜬다");
  });

  it("🔴 **주소를 코드에 박지 않았다** — 앞머리는 환경변수에서만 온다", () => {
    for (const [what, source] of [
      ["화면 부품", SECTION],
      ["화면 자료", code("src/lib/approval/delegation-screen-data.ts")],
      ["순수 모듈", SCREEN],
    ] as const) {
      assert.ok(!source.includes("http://"), `${what} 에 주소가 박혀 있다 — 운영에서 엉뚱한 데로 간다`);
      assert.ok(!source.includes("https://"), `${what} 에 주소가 박혀 있다`);
    }
    assert.ok(code("src/lib/approval/delegation-screen-data.ts").includes("env.approvalsBaseUrl"), "환경변수를 안 읽는다 — 링크가 영영 안 뜬다");
  });
});

describe("⑤ 🔴 「모두의 결재권 위임」 설명문이 **제 울타리를 말한다**", () => {
  it("🔴 **승인함 줄은 여기 없다**고 적혀 있다 — 이 한 줄이 핵심이다", () => {
    /**
     * 🔴 이 단언이 없으면 다음 사람이 그 문장을 지워도 **아무것도 빨개지지 않는다.** 그러면
     *    관리자는 이 묶음만 읽고 「모든 위임을 다 봤다」고 믿는다 — 조회도 판정도 멀쩡해서
     *    오류는 한 줄도 안 난다(설계 D-2 를 세울 때 실제로 그대로 남아 있던 문장이다).
     */
    assert.ok(ALL_NOTE.includes("{PORTAL_DELEGATION_HEADING}"), "설명문이 승인함 묶음을 **이름으로** 가리키지 않는다");
    assert.ok(ALL_NOTE.includes("여기 없습니다"), "「여기 없다」가 빠졌다 — 가리키기만 하고 없다는 말을 안 하면 뜻이 뒤집힌다");
    assert.ok(ALL_NOTE.includes("그 묶음에서만"), "어디서 보이는지를 안 적는다 — 「없다」만 적으면 막다른 길이다");
  });

  it("🔵 옛 글자 「모든 분의」가 **없다** — 되돌리면 빨개진다", () => {
    assert.ok(!ALL_NOTE.includes("모든 분의"), "「모든 분의 결재권 위임」이 돌아왔다 — 승인함 줄은 이 묶음에 한 줄도 안 뜬다");
  });

  it("🔵 **겹친다는 사실은 그대로 살아 있다** — 일부러 적어 둔 것이다", () => {
    // 🔴 걸러 내지 않는 쪽을 골랐으므로(그 자리 주석), 겹친다는 말이 사라지면 사람은 같은 줄이
    //    두 번 보이는 까닭을 모른 채 빠진 줄을 찾아 헤맨다.
    assert.ok(ALL_NOTE.includes("다시 보입니다"), "겹친다는 사실이 사라졌다");
    for (const name of ["내가 맡긴 것", "내가 대신하고 있는 것"]) {
      assert.ok(ALL_NOTE.includes(name), `어느 묶음과 겹치는지를 안 적는다: ${name}`);
    }
    // 🔴 자리 말로 가리키지 않는다 — (라)가 끼어든 지금 「위의 두 묶음」은 (다)·(라)로 읽히고,
    //    (라)는 **겹치지 않는 묶음**이다. 이 집과 A/S 의 묶음 차례가 서로 다르기도 하다.
    assert.ok(!ALL_NOTE.includes("위의 두 묶음"), "자리 말로 되돌아갔다 — 묶음이 하나 끼어드는 날 조용히 틀린다");
  });

  it("🔴 묶음 이름을 **손으로 베껴 적지 않았다** — 상수로 부른다", () => {
    // 🔴 베껴 적으면 제목 상수만 고치는 날 두 자리가 어긋나고, tsc 는 글자를 모르니 침묵한다.
    assert.ok(!ALL_NOTE.includes(PORTAL_DELEGATION_HEADING), `제목 글자(${PORTAL_DELEGATION_HEADING})를 손으로 적었다`);
  });

  it("🔴 설명문이 **사실인지 조회로** 맞대어 본다 — 모두의 목록은 제 표만 읽는다", () => {
    /**
     * 🔵 글자끼리만 재면 「설명문이 조회와 맞나」는 영영 안 드러난다. 다음 사람이 이 묶음에
     *    승인함 표를 합치는 날 **설명문이 거짓이 되는데**, 그때 빨개질 자리가 여기다.
     */
    const listAll = slice(QUERIES, "export async function listAllDelegations(", "\n}\n", "모두의 목록 조회");
    assert.ok(listAll.includes(".from(approvalDelegations)"), "조회를 잘못 잘랐다 — 이 시험이 아무것도 안 재고 있다");
    assert.ok(!listAll.includes("portalApprovalDelegations"), "모두의 목록이 승인함 표까지 읽는다 — 설명문을 함께 고쳐야 한다");
  });
});
