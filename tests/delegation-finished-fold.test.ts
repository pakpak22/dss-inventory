import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isActiveDelegation, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";
import {
  delegationFinishedToggleLabel,
  delegationFinishedTruncatedNotice,
  delegationState,
  foldDelegationList,
  DELEGATION_FINISHED_ELSEWHERE_LOCAL,
  DELEGATION_FINISHED_ELSEWHERE_PORTAL,
  type DelegationState,
} from "../src/lib/approval/delegation-screen";

/**
 * ============================================================================
 * 끝난 위임을 **접어 둔다** (2026-11-17)
 * ============================================================================
 * 쓰는 분의 말: 「‘내가 대신하고 있는 것’에 이미 만료된 위임건들이 쌓인다. 만료되면 거기서
 * 없어져도 될 것 같다.」 **지우지 않고 접는** 쪽으로 갔다 — 지난 위임은 「그때 왜 저 사람이
 * 눌렀나」의 근거라 사라지면 안 된다.
 *
 * ── 🔴 이 집은 **거꾸로**였다 ──────────────────────────────────────────
 * 「내가 대신하고 있는 것」 두 묶음(제 표 · 승인함)은 애초에 **살아 있는 줄만** 읽었다. 그래서
 * 기간이 지나면 그 줄을 **다시 볼 길이 아예 없었다** — 「모두의 결재권 위임」은 관리자만 보는
 * 데다 제 표만 읽고(승인함 줄은 거기 한 줄도 없다), 변경 이력은 맡긴 사람 쪽 이야기다. 그래서
 * 이 집에서 접기는 **감추는 일이 아니라 보이게 하는 일**이고, 아래 ⑥이 그것을 잰다.
 *
 * ── 🔴 이 저장소에는 화면 렌더 시험도 DB 시험도 없다 ───────────────────
 * 그래서 뜻은 **순수 함수로** 재고(①~④), 「그 뜻이 정말 그 자리에 걸렸나」는 **소스 글자**로
 * 잰다(⑤~⑦ — `tests/portal-delegation-screen.test.ts` 와 같은 방식).
 * 🔴 **주석은 걷어내고 본다.** 이 집은 「왜 그렇게 했는가」를 길게 적어서, 「~하지 않는다」는
 *    설명이 곧 금지어를 품는다. 걷어내지 않으면 **있어야 할 것**을 재는 쪽이 주석만으로 영영
 *    통과한다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 떼어 낸 코드만. 🔴 줄 주석은 **줄 처음에 선 것만** 지운다(글자 안의 빗금을 안 건드리게). */
const code = (relative: string): string =>
  src(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SECTION = code("src/components/approval/DelegationSection.tsx");
const QUERIES = code("src/lib/approval/delegation-queries.ts");

/** 함수 하나만 잘라 낸다 — 🔴 파일 전체에서 찾으면 **옆 함수가 대신 통과시킨다.** */
function bodyOf(source: string, declaration: string): string {
  const at = source.indexOf(declaration);
  assert.notEqual(at, -1, `${declaration} 가 사라졌다 — 이 시험이 아무것도 안 재고 있다`);
  const rest = source.slice(at + 10);
  const end = rest.indexOf("\nexport ");
  const body = end === -1 ? rest : rest.slice(0, end);
  // 🔵 **표본이 비어서 공짜로 통과하지 않게** 먼저 센다.
  assert.ok(body.length > 100, `${declaration}: 잘라 낸 자리가 너무 짧다(${body.length}자)`);
  return body;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 🔴 접는 셈 — 살아 있는 줄은 그대로, 끝난 줄은 상한까지
 * ═════════════════════════════════════════════════════════════════════════ */

/** 줄 대신 쓰는 가짜 값. 🔵 뜻이 없는 숫자여야 「무엇을 세는지」가 또렷하다. */
const rows = (count: number, from = 0): number[] => Array.from({ length: count }, (_, i) => from + i);
const same = (row: number): number => row;

describe("① 🔴 접는 셈 (`foldDelegationList`)", () => {
  it("살아 있는 줄은 **전부** 펴진 쪽에, 끝난 줄은 접힌 쪽에", () => {
    const fold = foldDelegationList(rows(3), rows(2, 100), 50, same);
    assert.deepEqual(fold.live, [0, 1, 2], "살아 있는 줄이 접힌 쪽으로 샜다");
    assert.deepEqual(fold.finished, [100, 101], "끝난 줄이 접기 안에 안 들어왔다 — 이 조각이 고치려던 바로 그 일이다");
    assert.equal(fold.finishedTruncated, false, "줄이 둘뿐인데 잘렸다고 말한다");
  });

  it("🔴 **살아 있는 쪽에는 상한이 없다** — 되돌려야 할 줄이 상한에 밀리면 안 된다", () => {
    // 🔴 2026-11-17 이전에는 상한이 **목록 전체**에 걸려 있었다. 끝난 줄이 쌓여 50을 채우면
    //    되돌릴 수 있는 줄이 화면에서 **말없이** 사라지는 모양이었다.
    const fold = foldDelegationList(rows(120), [], 50, same);
    assert.equal(fold.live.length, 120, "살아 있는 줄이 잘렸다");
  });

  it("🔴 상한을 넘으면 **상한만큼만** 남기고 「더 있다」를 켠다 — 한 줄 더 읽은 그 줄은 버린다", () => {
    // 🔴 버리지 않으면 51번째 줄이 조용히 화면에 뜬다(오류는 안 난다).
    const fold = foldDelegationList([], rows(51), 50, same);
    assert.equal(fold.finished.length, 50, "읽어 온 한 줄 더를 그대로 그린다");
    assert.equal(fold.finishedTruncated, true, "잘렸는데 말하지 않는다 — 「이게 전부」로 읽힌다");
    assert.equal(fold.finished.at(-1), 49, "잘라 내는 쪽이 뒤가 아니다 — 최근 것부터 남아야 한다");
  });

  it("🔴 **딱 상한만큼**이면 잘렸다고 말하지 않는다 — 경계에서 거짓말하지 않게", () => {
    const fold = foldDelegationList([], rows(50), 50, same);
    assert.equal(fold.finished.length, 50);
    assert.equal(fold.finishedTruncated, false, "꽉 찬 날과 넘친 날을 같은 답으로 만들었다");
  });

  it("🔵 0건이면 빈 목록이고, 화면은 그때 **접기 자체를 안 그린다**(⑤에서 잰다)", () => {
    const fold = foldDelegationList([], [], 50, same);
    assert.deepEqual(fold.finished, []);
    assert.equal(fold.finishedTruncated, false);
  });

  it("🔵 상한을 **그대로 싣는다** — 화면이 숫자를 글자로 박지 않게", () => {
    assert.equal(foldDelegationList([], [], 7, same).finishedLimit, 7);
  });

  it("🔵 **두 묶음 모두** 화면 줄로 옮겨 적는다 — 한쪽만 날것으로 내려가지 않게", () => {
    const fold = foldDelegationList([1], [2], 50, (row) => `#${row}`);
    assert.deepEqual(fold.live, ["#1"]);
    assert.deepEqual(fold.finished, ["#2"], "접힌 쪽을 옮겨 적지 않으면 화면이 날것을 받는다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 🔴 「끝났다」의 자가 **배지와 같은 말**을 한다
 * ═════════════════════════════════════════════════════════════════════════ */

const STARTS = new Date("2026-10-19T15:00:00.000Z"); // 10/20 0시(한국)
const ENDS = new Date("2026-10-25T15:00:00.000Z"); //  10/26 0시(한국) — 구간 밖 첫 순간

const period = (over: Partial<ApprovalDelegationPeriod> = {}): ApprovalDelegationPeriod => ({
  delegatorSub: "sub-a",
  delegateSub: "sub-b",
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
  ...over,
});

/**
 * 🔴 **두 질의가 거는 조건을 TS 로 그대로 옮겨 적은 것**(`or(isNotNull(revoked_at), lte(ends_at, now))`).
 * 이 식 자체를 재는 것이 아니라, **이 식과 배지가 같은 말을 하는가**를 잰다 — 갈리면 접기 머리에
 * 「끝난 위임 3건」이라고 써 놓고 안에 「맡기는 중」 배지가 뜬다.
 * 🔵 글자가 그 자리에 정말 그렇게 적혀 있는지는 ⑥이 소스로 본다(두 겹이라야 뜻이 있다).
 */
const sqlSaysFinished = (row: ApprovalDelegationPeriod, now: Date): boolean =>
  row.revokedAt !== null || row.endsAt.getTime() <= now.getTime();

const FINISHED_STATES: DelegationState[] = ["ENDED", "REVOKED"];

describe("② 🔴 접히는 줄과 「끝남·되돌림」 배지가 **같은 집합**이다", () => {
  const cases: [string, ApprovalDelegationPeriod, Date][] = [
    ["기간 안 — 맡기는 중", period(), new Date("2026-10-22T03:00:00.000Z")],
    ["아직 시작 전", period(), new Date("2026-10-01T03:00:00.000Z")],
    ["기간이 지남", period(), new Date("2026-11-01T03:00:00.000Z")],
    ["끝 그 순간(반열린 구간)", period(), ENDS],
    ["끝 1ms 전", period(), new Date(ENDS.getTime() - 1)],
    ["되돌림 — 기간 안", period({ revokedAt: new Date("2026-10-21T00:00:00.000Z") }), new Date("2026-10-22T03:00:00.000Z")],
    ["되돌림 — 시작 전", period({ revokedAt: new Date("2026-10-02T00:00:00.000Z") }), new Date("2026-10-03T03:00:00.000Z")],
  ];

  for (const [what, row, now] of cases) {
    it(`${what}`, () => {
      const state = delegationState(row, now);
      assert.equal(
        sqlSaysFinished(row, now),
        FINISHED_STATES.includes(state),
        `접는 자와 배지가 갈린다(배지: ${state}) — 접기 머리의 건수와 안의 줄이 다른 말을 하게 된다`,
      );
    });
  }

  it("🔴 **「시작 전」은 끝난 쪽이 아니다** — 다음 주 출장을 미리 적어 둔 줄을 접어 버리면 안 된다", () => {
    const before = new Date("2026-10-01T03:00:00.000Z");
    assert.equal(delegationState(period(), before), "SCHEDULED");
    assert.equal(sqlSaysFinished(period(), before), false, "아직 오지도 않은 위임이 「끝난 위임」 안으로 들어간다");
    // 🔵 살아 있는 쪽을 가리는 자도 「끝났다」의 반대편 그대로다.
    assert.equal(isActiveDelegation(period(), before), false, "시작 전인데 「지금 대신하는 중」이라고 한다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 🔵 접기 단추의 글자 — 다섯 자리가 **같은 말**을 한다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("③ 접기 단추의 글자", () => {
  it("접혀 있으면 **건수**를 적는다", () => {
    assert.equal(delegationFinishedToggleLabel(false, 3, false), "끝난 위임 보기 (3건)");
  });

  it("🔴 잘렸으면 `+` 가 붙는다 — 「3건」이라고 단정하지 않는다", () => {
    assert.equal(delegationFinishedToggleLabel(false, 50, true), "끝난 위임 보기 (50건+)");
  });

  it("펴져 있으면 접는 말이고, 그때는 건수를 안 적는다(줄이 눈앞에 있다)", () => {
    const open = delegationFinishedToggleLabel(true, 3, true);
    assert.equal(open, "끝난 위임 접기");
    assert.doesNotMatch(open, /\d/, "펴 놓고도 건수를 적으면 줄 수와 어긋나는 날이 온다");
  });

  it("🔵 하십시오체·한국어다 — 영어 코드가 단추에 나가지 않는다(CLAUDE.md 10절)", () => {
    for (const label of [delegationFinishedToggleLabel(false, 0, false), delegationFinishedToggleLabel(true, 0, false)]) {
      assert.match(label, /끝난 위임/);
      assert.doesNotMatch(label, /[A-Za-z]/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 잘렸다는 안내 — **갈 곳이 묶음마다 다르다**
 * ═════════════════════════════════════════════════════════════════════════ */

describe("④ 잘렸을 때 하는 말", () => {
  it("상한을 **글자로 박지 않는다** — 조회가 넘긴 수가 그대로 들어간다", () => {
    assert.match(delegationFinishedTruncatedNotice(50), /최근 50건/);
    assert.match(delegationFinishedTruncatedNotice(7), /최근 7건/);
  });

  it("🔴 더 앞의 기록이 **어디 있는지**를 말한다 — 「이게 전부」로 읽히면 안 된다", () => {
    assert.match(delegationFinishedTruncatedNotice(50), new RegExp(DELEGATION_FINISHED_ELSEWHERE_LOCAL));
    assert.match(delegationFinishedTruncatedNotice(50, DELEGATION_FINISHED_ELSEWHERE_PORTAL), new RegExp(DELEGATION_FINISHED_ELSEWHERE_PORTAL));
  });

  it("🔴 **승인함 줄을 이 집 변경 이력으로 보내지 않는다** — 거기엔 한 줄도 없다", () => {
    // 🔴 포털이 써 준 사본이라(`portal_approval_delegations`) 이 집 변경 이력에 안 남는다.
    //    한 글자로 두면 둘 중 한쪽은 **없는 곳으로 사람을 보낸다.**
    assert.notEqual(DELEGATION_FINISHED_ELSEWHERE_LOCAL, DELEGATION_FINISHED_ELSEWHERE_PORTAL);
    const portal = delegationFinishedTruncatedNotice(50, DELEGATION_FINISHED_ELSEWHERE_PORTAL);
    assert.ok(!portal.includes(DELEGATION_FINISHED_ELSEWHERE_LOCAL), `승인함 줄을 ${DELEGATION_FINISHED_ELSEWHERE_LOCAL} 로 보낸다`);
  });

  it("🔵 기본값이 이 집 쪽이다 — 2026-11-17 에 안 건드린 「모두의」 묶음이 그대로 돌아간다", () => {
    assert.equal(delegationFinishedTruncatedNotice(50), delegationFinishedTruncatedNotice(50, DELEGATION_FINISHED_ELSEWHERE_LOCAL));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 🔴 화면 — 네 묶음이 **각자** 접힌다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑤ 화면이 접기를 어떻게 그리나 (소스 글자)", () => {
  it("🔵 **표본이 비어 있지 않다** — 아래 단언들이 공짜로 통과하지 않게 먼저 센다", () => {
    assert.ok(SECTION.includes("function FinishedFold("), "접기 부품이 없다");
    assert.ok(SECTION.length > 5000, "화면 파일을 잘못 읽었다");
  });

  it("🔴 **네 묶음에 하나씩** 달렸다 — 「내가 맡긴 것」·「대신하고 있는 것」 × (제 표 · 승인함)", () => {
    assert.equal(SECTION.split("<FinishedFold").length - 1, 4, "접기가 넷이 아니다 — 묶음 하나가 빠졌거나 덤으로 붙었다");
    for (const fold of ["fold={made}", "fold={acting}", "fold={portal.made}", "fold={portal.acting}"]) {
      assert.ok(SECTION.includes(fold), `${fold} 묶음에 접기가 없다`);
    }
  });

  it("🔴 **펼침 상태를 따로 기억한다** — 한쪽을 펴면 다른 쪽도 펴지면 안 된다", () => {
    const names = ["showMadeFinished", "showActingFinished", "showPortalMadeFinished", "showPortalActingFinished"];
    for (const name of names) {
      assert.ok(SECTION.includes(`const [${name}, set`), `${name} 칸이 없다 — 네 묶음이 한 칸을 나눠 쓰면 함께 펴진다`);
      assert.ok(SECTION.includes(`open={${name}}`), `${name} 를 접기에 안 넘긴다`);
    }
    assert.equal(new Set(names).size, names.length);
    // 🔴 한 칸으로 되돌리면 빨개진다 — 넷이 **서로 다른** 칸을 받는지까지 본다.
    for (const name of names) {
      assert.equal(SECTION.split(`open={${name}}`).length - 1, 1, `${name} 를 두 묶음이 함께 쓴다`);
    }
  });

  it("🔴 **끝난 것이 0건이면 접기를 아예 안 그린다** — 눌러 봐야 「없습니다」만 나오는 단추는 안 둔다", () => {
    const fold = SECTION.slice(SECTION.indexOf("function FinishedFold("), SECTION.indexOf("export function DelegationSection("));
    assert.ok(fold.length > 200, "접기 부품을 잘못 잘랐다");
    assert.ok(fold.includes("if (fold.finished.length === 0) return null;"), "0건일 때도 단추를 그린다");
  });

  it("🔵 **살아 있는 줄은 접기 밖**에 그대로 있다 — 접은 것은 끝난 줄뿐이다", () => {
    for (const live of ["{made.live.map(", "{acting.live.map(", "{portal.made.live.map(", "{portal.acting.live.map("]) {
      assert.ok(SECTION.includes(live), `${live} 가 사라졌다 — 살아 있는 줄까지 접혔다`);
    }
    // 🔵 0건일 때 하는 말도 그대로다(묶음을 감추지 않는다 — 「없다」와 「나와 상관없다」는 다른 말).
    for (const nothing of ["{DELEGATION_NOTHING_I_MADE}", "{DELEGATION_NOTHING_ACTING}"]) {
      assert.ok(SECTION.includes(nothing), `${nothing} 가 사라졌다`);
    }
  });

  it("🔵 **접힌 안의 줄도 같은 부품으로** 그린다 — 접었다고 다르게 생기지 않는다", () => {
    for (const [group, row] of [
      ["{made.finished.map(", "<DelegationRow"],
      ["{acting.finished.map(", "<DelegationRow"],
      ["{portal.made.finished.map(", "<PortalDelegationRow"],
      ["{portal.acting.finished.map(", "<PortalDelegationRow"],
    ] as const) {
      const at = SECTION.indexOf(group);
      assert.notEqual(at, -1, `${group} 가 없다 — 접기 안이 비어 있다`);
      assert.ok(SECTION.slice(at, at + 400).includes(row), `${group} 안을 ${row} 로 안 그린다`);
    }
  });

  it("🔴 승인함 쪽 접기는 **승인함으로** 보낸다 — 이 집 변경 이력에는 그 줄이 없다", () => {
    assert.equal(SECTION.split("where={DELEGATION_FINISHED_ELSEWHERE_PORTAL}").length - 1, 2, "승인함 두 묶음 가운데 하나가 엉뚱한 곳을 가리킨다");
  });

  it("🔴 승인함 접기에도 **[되돌리기]가 없다** — 이 집에는 그 줄을 거두는 통로 자체가 없다", () => {
    const portalFolds = SECTION.slice(SECTION.indexOf("fold={portal.made}"), SECTION.indexOf("{all && ("));
    assert.ok(portalFolds.length > 200, "승인함 접기를 잘못 잘랐다");
    for (const forbidden of ["되돌리기", "revoke", "canRevoke"]) {
      assert.ok(!portalFolds.includes(forbidden), `승인함 접기에 ${forbidden} 가 있다`);
    }
  });

  it("🔵 「모두의 결재권 위임」 접기는 **글자만** 같은 자로 바꿨다 — 동작은 그대로다", () => {
    // 🔵 그 묶음은 2026-10-26 부터 제 접기를 갖고 있었고 이 조각은 건드리지 않았다. 다만 다섯
    //    단추가 서로 다른 말을 하면 사람이 결함으로 읽어서, 글자를 정하는 함수만 함께 쓴다.
    assert.ok(SECTION.includes("delegationFinishedToggleLabel(showFinished, all.finished.length, all.finishedTruncated)"), "모두의 묶음이 글자를 손으로 적는다");
    assert.ok(SECTION.includes("{all.finished.length === 0 ? ("), "모두의 묶음의 0건 처리가 사라졌다 — 그 묶음은 0건에도 단추를 그린다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ 🔴 조회 — 끝난 줄을 **가져오기는 하는가**
 * ═════════════════════════════════════════════════════════════════════════ */

const SCREEN_QUERIES = [
  "export async function listDelegationsIMade(",
  "export async function listDelegationsIActFor(",
  "export async function listPortalDelegationsIMade(",
  "export async function listPortalDelegationsIActFor(",
] as const;

describe("⑥ 🔴 네 조회가 **살아 있는 것과 끝난 것을 갈라** 읽는다", () => {
  it("🔴 끝난 줄을 읽는 조건이 **넷 모두**에 있다 — 없으면 접기가 영원히 빈다", () => {
    // 🔴 「내가 대신하고 있는 것」 둘은 2026-11-17 이전에 이 조건이 **아예 없었다.** 그래서
    //    만료된 줄을 볼 길이 한 군데도 없었고, 그것이 이 조각의 핵심이다.
    for (const name of SCREEN_QUERIES) {
      const body = bodyOf(QUERIES, name);
      assert.ok(body.includes("isNotNull("), `${name}: 거둔 줄을 안 읽는다`);
      assert.ok(body.includes("lte("), `${name}: 기간이 끝난 줄을 안 읽는다`);
      assert.ok(body.includes("isNull("), `${name}: 살아 있는 줄을 가리는 조건이 사라졌다`);
      assert.ok(body.includes("gt("), `${name}: 살아 있는 줄을 가리는 조건이 사라졌다`);
    }
  });

  it("🔴 **상한은 접히는 쪽에만** 걸린다 — 살아 있는 줄이 상한에 밀리면 안 된다", () => {
    for (const name of SCREEN_QUERIES) {
      const body = bodyOf(QUERIES, name);
      assert.equal(body.split(".limit(").length - 1, 1, `${name}: 상한이 하나가 아니다 — 살아 있는 질의에도 걸렸다`);
      assert.ok(body.includes(".limit(FINISHED_DELEGATION_LIMIT + 1)"), `${name}: 한 줄 더 읽지 않는다 — 꽉 찬 날과 넘친 날을 가를 수 없다`);
    }
  });

  it("🔴 **셈은 순수 함수에 맡긴다** — 목록마다 적으면 한쪽에서 `slice` 를 빠뜨린다", () => {
    for (const name of SCREEN_QUERIES) {
      const body = bodyOf(QUERIES, name);
      assert.ok(body.includes("foldDelegationList(live, finishedPage, FINISHED_DELEGATION_LIMIT,"), `${name}: 접는 셈을 제 손으로 한다`);
      assert.ok(!body.includes("finishedTruncated"), `${name}: 「더 있다」를 제 손으로 센다 — 두 벌이 되면 한쪽만 고치는 날이 온다`);
    }
  });

  it("🔴 두 질의가 **같은 「지금」**을 쓴다 — 그 사이에 줄이 새거나 겹치지 않게", () => {
    for (const name of SCREEN_QUERIES) {
      const body = bodyOf(QUERIES, name);
      assert.ok(!body.includes("sql`now()`"), `${name}: 질의가 각자 지금을 묻는다`);
      assert.ok(!body.includes("new Date()", body.indexOf("{")), `${name}: 본문에서 지금을 또 만든다`);
    }
  });

  it("🔵 상한 상수가 **하나다** — 묶음마다 다른 N 으로 「최근 N건」이라고 말하지 않는다", () => {
    assert.ok(!QUERIES.includes("DELEGATION_LIST_LIMIT"), "옛 상한이 남아 있다 — 같은 화면에서 두 가지 N 이 보인다");
    assert.equal(QUERIES.split("const FINISHED_DELEGATION_LIMIT").length - 1, 1, "상한 상수가 두 번 선언됐다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑦ 🔴 **결재 판정과 역할 위임은 안 바뀌었다**
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑦ 🔴 손대지 않은 자리 — 결재 판정 · 역할 위임", () => {
  const 판정 = bodyOf(QUERIES, "export async function actingApproverSubsFor(");
  const 역할 = bodyOf(QUERIES, "export async function activeDelegatorRolesFor(");
  const 알림 = bodyOf(QUERIES, "export async function activeDelegateSubsFor(");

  it("🔴 결재 판정은 여전히 **살아 있는 줄만** 읽는다 — 접기를 만들다 여기까지 넓히면 끝난 위임이 결재권을 준다", () => {
    for (const 금지 of ["isNotNull(", "lte(", "foldDelegationList", "finished"]) {
      assert.ok(!판정.includes(금지), `결재 판정이 끝난 줄까지 본다: ${금지}`);
    }
    assert.ok(판정.includes("return actingApproverSubs(rows, actorSub, now, portalRows);"), "합치는 자리가 바뀌었다");
  });

  it("🔴 **알림이 읽는 조회**도 그대로다 — 끝난 위임의 대리인에게 메일이 가면 안 된다", () => {
    for (const 금지 of ["isNotNull(", "lte(", "foldDelegationList"]) {
      assert.ok(!알림.includes(금지), `알림 조회가 끝난 줄까지 본다: ${금지}`);
    }
    assert.ok(알림.includes("return activeDelegateSubs(rows, delegatorSub, now, portalRows);"), "합치는 자리가 바뀌었다");
  });

  it("🔴 **역할 위임**은 결재 판정에 그대로 얹혀 있다 — 화면용 조회를 끌어다 쓰지 않는다", () => {
    assert.ok(역할.includes("delegatorSubsOf(await actingApproverSubsFor(actorSub, db(), now), actorSub)"), "역할 위임이 다른 길로 묻기 시작했다");
    for (const 금지 of ["listDelegationsIActFor", "listPortalDelegationsIActFor", "foldDelegationList", "finished"]) {
      assert.ok(!역할.includes(금지), `역할 위임이 화면용 조회를 본다: ${금지}`);
    }
  });

  it("🔴 화면용 조회 넷을 부르는 곳은 **위임 화면 하나**다 — 결재 길목이 접기를 읽지 않는다", () => {
    const screen = code("src/lib/approval/delegation-screen-data.ts");
    for (const name of ["listDelegationsIMade", "listDelegationsIActFor", "listPortalDelegationsIMade", "listPortalDelegationsIActFor"]) {
      assert.ok(screen.includes(`${name}(actorSub, now)`), `위임 화면이 ${name} 를 안 읽는다`);
    }
    // 🔵 결재·역할·알림 쪽 모듈이 이 조회들을 끌어오면 그 길에 상한과 접기가 따라붙는다.
    for (const relative of [
      "src/lib/approval/part-issue-gate.ts",
      "src/lib/approval/delegated-role.ts",
      "src/lib/notifications/approval-created-ping.ts",
    ]) {
      const body = code(relative);
      for (const name of ["listDelegationsIActFor", "listPortalDelegationsIActFor"]) {
        assert.ok(!body.includes(name), `${relative} 가 화면용 조회를 쓴다`);
      }
    }
  });
});
