import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
// 🔴 `new URL(…).pathname` 을 그대로 쓰면 안 된다 — 이 PC 의 경로에 한글이 들어 있어
//    퍼센트 인코딩된 글자가 나오고, `readdirSync` 가 그 폴더를 못 찾는다(실측).
import { fileURLToPath } from "node:url";

import { actingApproverSubs, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";

/**
 * ============================================================================
 * 승인함에 맡긴 결재권 위임을 **제 표에서** 읽는다 (2026-11-16 저녁, 설계 조각 8)
 * ============================================================================
 * ── 🔴 이 파일의 뜻이 2026-11-16 저녁에 **뒤집혔다** ────────────────────
 * 조각 4 가 만든 이 시험은 「결재 길목에서 **포털에 묻는다**」를 못 박고 있었다(설계 B-3):
 * 묻는 통로의 규격·상한·던지지 않기, 「못 물었다」와 「없다」를 값에서 가르기, 묻는 자리 넷과
 * **되묻지 않는 자리 둘**. 그날 저녁에 설계 B-12 로 뒤집혀서 **포털이 지정·철회할 때 각
 * 시스템에 써 주고 각 시스템은 제 표만 읽는다** — 조각 6 이 받는 표와 통로를 만들었고, 조각 8
 * 이 그 표를 판정에 이으면서 **묻는 쪽을 통째로 걷어냈다.**
 *
 * 🔴 **그래서 옛 단언 가운데 여럿은 지운 것이 아니라 뜻을 뒤집은 것이다.** 무엇이 어떻게
 * 바뀌었는지는 각 단언 옆에 적어 두었다. 가장 중요한 뒤집힘은 이것이다:
 *
 *   옛: 「포털 쪽 목록은 **포털이 이미 판정한 결과**라 기간·되돌림을 여기서 **다시 보지
 *        않는다**」 (그래서 끝난 줄·거둔 줄도 그대로 들어왔다)
 *   지금: 「둘째 고지도 **이 집의 표**라 **같은 `isActiveDelegation` 으로 우리가 가린다**」
 *
 * 여기서 못 박는 것:
 *  1. 🔴 **합집합이되 이어 붙지 않는다**(설계 B-4) — 이 집 표로 A→B 이고 승인함 표로 B→C 여도
 *     C 는 A 를 못 얻는다. 막는 자리는 `actingApproverSubs` 하나다.
 *  2. 🔴 **두 표를 같은 자로 잰다** — 끝난 줄·거둔 줄·아직 시작 안 한 줄은 **양쪽 다** 빠진다.
 *  3. 🔴 **판정이 읽는 자리가 어디인가** — 두 표를 **같은 연결(`conn`)로** 읽는다.
 *  4. 🔴 **어디에서도 포털에 묻지 않는다** — 되돌아가면 여기서 깨진다.
 *
 * ── 🔴 이 저장소에는 DB 시험이 없다 ─────────────────────────────────────
 * 그래서 뜻은 순수 함수로 재고(①②), 「어느 자리가 무엇을 읽는가」는 **소스 글자**로 잰다(③④) —
 * `tests/part-issue-delegation.test.ts` 와 같은 방식이다. 표를 읽는 모듈
 * (`src/lib/approval/delegation-queries.ts`)은 `server-only` 를 물고 있어 **불러올 수 없다.**
 * ============================================================================
 */

const sub = (name: string) => `sub-${name}`;

const STARTS = new Date("2026-11-01T00:00:00.000Z");
const ENDS = new Date("2026-11-30T00:00:00.000Z");
const NOW = new Date("2026-11-16T12:00:00.000Z");

/**
 * 위임 한 줄. 🔵 **두 표가 같은 모양이라 지어내는 함수도 하나다** — 칸 이름도 기간 규칙도
 * `revoked_at` 깃발도 글자 그대로 같고, 그래서 같은 순수 함수가 둘을 잰다.
 */
const row = (delegatorName: string, delegateName: string, over: Partial<ApprovalDelegationPeriod> = {}): ApprovalDelegationPeriod => ({
  delegatorSub: sub(delegatorName),
  delegateSub: sub(delegateName),
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
  ...over,
});

/** 이 집의 표(`approval_delegations`) 한 줄. */
const own = row;
/** 승인함에서 맡겨 포털이 써 준 표(`portal_approval_delegations`) 한 줄. */
const portal = row;

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 🔴 **주석을 걷어낸 소스.** 아래 ③·④는 글자로 재는 시험이라 **주석이 답을 바꾼다.**
 *
 * 이 저장소는 「왜 그렇게 했는가」를 길게 적는 집이라, 「옛 `portal-acting-subs.ts` 를 걷어냈다」
 * 같은 **내력 설명이 곧 금지어를 품는다.** 걷어내지 않으면
 *  · 「묻지 않는다」를 재는 시험이 **설명 때문에** 깨지고(2026-11-16 에 실제로 넷이 깨졌다),
 *  · 🔴 더 나쁘게는 「읽는다」를 재는 시험이 **주석만으로 영영 통과**한다.
 * 둘째가 훨씬 비싸다 — 깨지는 쪽은 바로 보이지만 통과하는 쪽은 아무도 안 본다.
 */
const code = (relative: string): string =>
  src(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------------ */

describe("① 🔴 두 고지를 합친다 — 합집합이되 **이어 붙지 않는다** (설계 B-4)", () => {
  it("승인함 위임만 있어도 붙는다 — 이 조각의 전부다", () => {
    assert.deepEqual(actingApproverSubs([], sub("lee"), NOW, [portal("kim", "lee")]), [sub("lee"), sub("kim")]);
  });

  it("🔴 **이 집의 위임을 걷어내지 않았다** — 둘 다 산다", () => {
    // 🔴 설계 B-4 가 「둘 다 살려 둔다」였다. 승인함 쪽으로 갈아끼우면 이미 맡겨 둔 사람들이
    //    **아무 말 없이** 자격을 잃는다.
    const result = actingApproverSubs([own("kim", "lee")], sub("lee"), NOW, [portal("park", "lee")]);
    assert.deepEqual(result, [sub("lee"), sub("kim"), sub("park")]);
  });

  it("🔴 **본인이 맨 앞에 한 번만** — 자기에게 맡긴 줄이 섞여 와도 두 번 들어가지 않는다", () => {
    /**
     * 🔴 **뒤집힌 단언이다.** 옛 까닭은 「포털이 답의 맨 앞에 부른 사람 자신을 넣어 주므로」
     *    였는데(설계 C-2), 이제 그런 답 자체가 없다. 지금 막는 것은 **표에 자기에게 맡긴 줄이
     *    있을 때**다 — 두 표 다 `*_not_self` CHECK 가 있어 평소에는 안 닿지만, 닿으면 `inArray`
     *    에 같은 번호가 두 칸이 되어 **같은 건이 화면에 두 번 뜬다.**
     */
    const selfRow = portal("lee", "lee");
    const result = actingApproverSubs([], sub("lee"), NOW, [selfRow]);
    assert.deepEqual(result, [sub("lee")]);
    assert.equal(result.filter((one) => one === sub("lee")).length, 1);
    // 🔵 이 집 표에서 와도 마찬가지다 — 두 묶음이 같은 가지를 지난다.
    assert.deepEqual(actingApproverSubs([own("lee", "lee")], sub("lee"), NOW, []), [sub("lee")]);
  });

  it("두 고지에 **같은 사람**이 겹쳐 있어도 한 번만 — 겹쳐 지정하는 일은 실제로 생긴다", () => {
    // 🔵 설계 D-2: 두 곳에 겹쳐 지정해도 해롭지 않다(둘 다 대신할 수 있을 뿐). 다만 목록에
    //    두 번 들어가면 같은 건이 두 번 뜬다.
    assert.deepEqual(actingApproverSubs([own("kim", "lee")], sub("lee"), NOW, [portal("kim", "lee")]), [sub("lee"), sub("kim")]);
  });

  it("🔴 **고지를 갈아타며 두 겹이 생기지 않는다** — 이 집 A→B, 승인함 B→C 라도 C 는 A 를 못 얻는다", () => {
    /**
     * 🔴 **이 조각이 열어 둔 구멍이 바로 이것이다.** 한 고지 안에서는 `delegatorSubsFor` 가
     *    이어 붙이기를 막아 왔는데(A 는 C 를 모른다 · 고리가 생긴다), 고지가 둘이 되면서
     *    **두 고지를 갈아타며** 두 겹이 될 수 있게 됐다. 막는 자리는 `actingApproverSubs`
     *    하나뿐이라, 그 한 자리가 무너지면 **A 가 동의한 적 없는 사람에게 결재권이 넘어간다.**
     */
    const ownRows = [own("a", "b")];
    const portalRows = [portal("b", "c")];
    const asC = actingApproverSubs(ownRows, sub("c"), NOW, portalRows);
    assert.deepEqual(asC, [sub("c"), sub("b")], "c 가 a 의 결재권까지 얻었다 — 두 고지를 갈아타며 이어 붙었다");
    assert.equal(asC.includes(sub("a")), false);

    // 🔵 한 겹은 멀쩡히 돈다 — b 는 a 의 결재권을 그대로 쓴다.
    assert.deepEqual(actingApproverSubs(ownRows, sub("b"), NOW, portalRows), [sub("b"), sub("a")]);
  });

  it("🔴 반대 방향으로 갈아타도 마찬가지다 — 승인함 A→B, 이 집 B→C", () => {
    const ownRows = [own("b", "c")];
    const portalRows = [portal("a", "b")];
    const asC = actingApproverSubs(ownRows, sub("c"), NOW, portalRows);
    assert.deepEqual(asC, [sub("c"), sub("b")]);
    assert.equal(asC.includes(sub("a")), false, "c 가 승인함 쪽 한 겹까지 타고 올라갔다");
  });

  it("빈 글자는 목록에 안 들어간다 — 열쇠로 쓰이는 값이다", () => {
    // 🔵 두 표 다 `NOT NULL` 이고 받는 통로가 빈 글자를 400 으로 거절하므로 평소에는 안 닿는다.
    //    닿으면 그대로 `inArray` 의 한 칸이 된다.
    assert.deepEqual(actingApproverSubs([own("kim", "lee")], sub("lee"), NOW, [portal("kim", "lee", { delegatorSub: "" })]), [sub("lee"), sub("kim")]);
  });

  it("🔴 승인함 줄이 하나도 없으면 **이 고지가 생기기 전과 한 글자도 다르지 않다**", () => {
    assert.deepEqual(actingApproverSubs([own("kim", "lee")], sub("lee"), NOW, []), [sub("lee"), sub("kim")]);
    assert.deepEqual(actingApproverSubs([], sub("lee"), NOW, []), [sub("lee")]);
  });
});

describe("② 🔴 **두 표를 같은 자로 잰다** — 2026-11-16 저녁에 뒤집힌 자리", () => {
  /**
   * 🔴 **여기가 이 조각의 뜻이 바뀐 핵심이다.**
   *
   * 옛 시험 이름: 「끝난 줄·되돌린 줄은 **이 집 쪽만** 걸러진다 — 포털 쪽 기간 판정을 베껴 적지
   * 않았다」. 그때 둘째 고지는 **포털이 이미 판정해서 준 번호 목록**이라, 그 번호는 기간과
   * 상관없이 **무조건** 들어가는 것이 맞았다(규칙을 두 벌로 적지 않으려는 것이었다).
   *
   * 지금 둘째 고지는 **이 집의 표**다. 포털은 줄을 써 주기만 하고 「지금 살아 있나」는 읽는 쪽이
   * 가린다. 🔴 **가리지 않으면 거둔 위임과 끝난 위임이 영원히 듣는다** — 오류가 한 번도 안 나는
   * 가장 비싼 모양이다(설계 B-13: 「거둔 줄 알았는데 안 거둬진」).
   */
  it("🔴 **거둔 승인함 줄은 안 걸린다** — 기간이 남아 있어도", () => {
    const revoked = portal("kim", "lee", { revokedAt: new Date("2026-11-02T00:00:00.000Z") });
    assert.deepEqual(actingApproverSubs([], sub("lee"), NOW, [revoked]), [sub("lee")]);
  });

  it("🔴 **끝난 승인함 줄은 안 걸린다** — 끝은 포함하지 않는다(반열린 구간)", () => {
    const ended = portal("kim", "lee", { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-10T00:00:00.000Z") });
    assert.deepEqual(actingApproverSubs([], sub("lee"), NOW, [ended]), [sub("lee")]);
    // 🔵 끝 **그 순간부터** 거짓이다 — 이 집 표와 같은 자(`isActiveDelegation`)다.
    assert.deepEqual(actingApproverSubs([], sub("lee"), ENDS, [portal("kim", "lee")]), [sub("lee")]);
    assert.deepEqual(actingApproverSubs([], sub("lee"), new Date(ENDS.getTime() - 1), [portal("kim", "lee")]), [sub("lee"), sub("kim")]);
  });

  it("🔴 **아직 시작 안 한 승인함 줄은 안 걸린다** — 미리 적어 둔 위임이 먼저 열리면 안 된다", () => {
    assert.deepEqual(actingApproverSubs([], sub("lee"), new Date(STARTS.getTime() - 1), [portal("kim", "lee")]), [sub("lee")]);
    assert.deepEqual(actingApproverSubs([], sub("lee"), STARTS, [portal("kim", "lee")]), [sub("lee"), sub("kim")]);
  });

  it("🔴 **남의 줄은 내 목록을 늘리지 않는다** — `delegate_sub` 가 나일 때만 본다", () => {
    assert.deepEqual(actingApproverSubs([], sub("lee"), NOW, [portal("kim", "park")]), [sub("lee")]);
  });

  it("🔴 두 표에서 **같은 조건이 같게** 걸린다 — 한쪽만 느슨하면 거기로 새어 나간다", () => {
    // 🔵 같은 줄을 두 묶음에 각각 넣어 **답이 같은지** 본다. 갈리면 한 표의 거르기만 고쳐
    //    놓고 다른 표를 잊은 것이다.
    for (const over of [{}, { revokedAt: NOW }, { endsAt: new Date("2026-11-02T00:00:00.000Z") }, { startsAt: new Date("2026-11-20T00:00:00.000Z"), endsAt: new Date("2026-11-30T00:00:00.000Z") }]) {
      const asOwn = actingApproverSubs([own("kim", "lee", over)], sub("lee"), NOW, []);
      const asPortal = actingApproverSubs([], sub("lee"), NOW, [portal("kim", "lee", over)]);
      assert.deepEqual(asPortal, asOwn, `두 표가 같은 줄을 다르게 읽는다: ${JSON.stringify(over)}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* ③④ 아래는 **순수 함수로는 닿지 않는 자리**를 글자로 못 박는 시험이다.   */
/*     표를 읽는 모듈은 `server-only` 를 물고 있어 불러올 수 없다.         */
/* ------------------------------------------------------------------ */

const QUERIES = "src/lib/approval/delegation-queries.ts";

describe("③ 🔴 판정이 **제 표**를 읽는다 — 묻는 쪽을 대신한 자리", () => {
  const queries = code(QUERIES);
  const fnStart = queries.indexOf("export async function actingApproverSubsFor(");
  const fn = (() => {
    assert.notEqual(fnStart, -1, "actingApproverSubsFor 가 사라졌다 — 이 시험이 아무것도 안 재고 있다");
    const end = queries.indexOf("\nexport ", fnStart + 1);
    return queries.slice(fnStart, end === -1 ? undefined : end);
  })();

  it("🔴 **두 표를 읽는다** — 한쪽만 읽으면 그 고지의 위임이 통째로 안 듣는다", () => {
    assert.ok(fn.includes(".from(approvalDelegations)"), "이 집의 위임 표를 안 읽는다");
    assert.ok(fn.includes(".from(portalApprovalDelegations)"), "승인함 위임 표를 안 읽는다 — 맡겼는데 아무 데서도 안 듣는다");
  });

  it("🔴 **승인함 표에도 같은 조건 셋을 건다** — 색인 차례 그대로", () => {
    // 🔴 `portal_approval_delegations_delegate_idx` 가 `(delegate_sub, revoked_at, ends_at)` 다.
    //    한 조건이라도 빠지면 거둔 줄·끝난 줄이 판정에 들어오거나 표가 통째로 딸려 온다.
    assert.ok(fn.includes("eq(portalApprovalDelegations.delegateSub, actorSub)"), "대신할 사람으로 좁히지 않는다 — 남의 줄까지 읽는다");
    assert.ok(fn.includes("isNull(portalApprovalDelegations.revokedAt)"), "거둔 줄까지 읽는다");
    assert.ok(fn.includes("gt(portalApprovalDelegations.endsAt, now)"), "이미 끝난 줄까지 읽는다");
  });

  it("🔵 `starts_at` 은 **SQL 로 거르지 않는다** — 두 표 모두, 반열린 구간 판정은 한 곳에만 있다", () => {
    for (const column of ["approvalDelegations.startsAt", "portalApprovalDelegations.startsAt"]) {
      assert.ok(fn.includes(`startsAt: ${column}`), `${column} 을 안 읽어 온다 — 순수 함수가 거를 수 없다`);
      assert.equal(fn.split(column).length - 1, 1, `${column} 을 SQL 에서도 거르고 있다 — 반열린 구간 규칙이 두 벌이 된다`);
    }
  });

  it("🔴 **합치는 자리는 순수 함수 하나**다 — 여기서 이어 붙이면 두 겹을 막는 자리도 둘이 된다", () => {
    assert.ok(fn.includes("return actingApproverSubs(rows, actorSub, now, portalRows);"), "읽어 온 두 묶음을 **한 자리에서** 순수 판정에 넘기지 않는다");
  });

  it("🔴 **두 표를 같은 연결로 읽는다** — 결재 트랜잭션 안에서 한쪽만 밖으로 새면 안 된다", () => {
    /**
     * 🔴 `conn` 은 결재가 `FOR UPDATE` 로 잡아 둔 **그 트랜잭션**이다(`decidePartIssueApproval`).
     *    승인함 표만 `db()` 로 읽으면 읽은 뒤 집기 전 사이에 그 줄이 거둬질 수 있고, 그때
     *    **권한이 없는데 통과한 결재**가 한 건 남는다.
     * 🟢 묻던 시절에는 이 울타리를 둘째 고지에 걸 수 없었다 — 망 호출이라 거래 밖에서 미리
     *    받아 왔다. 제 표가 되면서 비로소 걸렸다.
     */
    assert.equal(fn.split("await conn").length - 1, 2, "두 표를 같은 연결(conn)로 읽지 않는다");
    assert.ok(!fn.includes("db()\n"), "표 하나를 트랜잭션 밖에서 읽는다");
  });

  it("🔴 **표를 읽는 층이 망을 타지 않는다** — 이 함수는 결재 트랜잭션 **안**에서 돈다", () => {
    assert.ok(!fn.includes("fetch("), "표를 읽는 층이 포털에 직접 묻는다 — 망 지연만큼 행 잠금이 붙들린다");
  });
});

describe("④ 🔴 **어디서도 포털에 결재권 위임을 묻지 않는다** (설계 B-12)", () => {
  /**
   * 🔴 **옛 시험을 넓힌 자리다.** 조각 4·6 에서는 「포털이 우리를 부르는 통로 **둘**에서만 안
   * 묻는다」였고(되물으면 서로 기다리는 짝이 된다), 나머지 **넷은 물어야** 했다. 지금은
   * **아무도 안 묻는다** — 그래서 통로 둘만 재면 **공짜로 통과한다.** 저장소 전체를 본다.
   *
   * 🔵 걸러 내는 이름은 걷어낸 것들이다. 되돌리려면 이 가운데 하나는 반드시 다시 나타난다.
   */
  const REMOVED = [
    "portal-acting-subs",
    "resolvePortalDelegations",
    "fetchPortalActingSubs",
    "PORTAL_DELEGATIONS_TIMEOUT_MS",
    "NO_PORTAL_DELEGATIONS",
    "notePortalDelegationOutage",
    "readPortalDelegationSubs",
    "portalDelegationUnavailable",
    "portalDelegatorSubs",
  ];

  /** `src/` 아래 모든 `.ts`·`.tsx`. 🔴 자리를 늘려도 저절로 걸리게 하려는 것이다. */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) sourceFiles(path, out);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
    }
    return out;
  }

  const files = sourceFiles(fileURLToPath(new URL("../src", import.meta.url)));

  it("🔵 **표본이 비어 있지 않다** — 아래 둘이 공짜로 통과하지 않게 먼저 센다", () => {
    // 🔴 걸을 파일을 한 장도 못 찾으면 아래 시험은 **무엇도 재지 않고** 초록이 된다.
    assert.ok(files.length > 100, `src 아래 파일을 ${files.length}개밖에 못 찾았다 — 걷는 길이 틀렸다`);
    assert.ok(
      files.some((path) => path.endsWith(join("approval", "delegation-queries.ts"))),
      "판정이 사는 파일이 표본에 없다",
    );
  });

  it("🔴 걷어낸 이름이 `src/` 어디에도 **한 번도** 안 나온다 — 되돌아가면 여기서 깨진다", () => {
    for (const path of files) {
      // 🔴 **주석은 걷어낸다**(이 파일 머리말). 내력을 적어 둔 주석이 곧 금지어를 품는다.
      const body = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const name of REMOVED) {
        assert.ok(!body.includes(name), `${path} 에 걷어낸 ${name} 이 남아 있다 — 묻는 길이 되살아났다`);
      }
    }
  });

  it("🔴 묻던 모듈 **파일 자체가 없다** — 아무도 안 부르는 죽은 코드로 남기지 않았다", () => {
    for (const relative of ["src/lib/approval/portal-acting-subs.ts", "src/lib/approval/portal-delegation.ts"]) {
      assert.equal(existsSync(new URL(`../${relative}`, import.meta.url)), false, `${relative} 이 아직 있다`);
    }
  });

  it("🟢 **받는 쪽은 그대로 산다** — 걷어낸 것은 묻는 쪽뿐이다", () => {
    /**
     * 🔴 걷어내다 조각 6 의 것을 함께 지우면 **표에 아무것도 안 쌓이고**, 그러면 판정이 제 표를
     *    읽어 봤자 영원히 빈 목록이다 — 오류는 한 번도 안 난다.
     */
    for (const relative of ["src/lib/approval/portal-delegation-sync.ts", "src/lib/approval/portal-delegation-store.ts", "src/app/api/integration/delegations/route.ts"]) {
      assert.equal(existsSync(new URL(`../${relative}`, import.meta.url)), true, `${relative} 이 사라졌다 — 받는 길이 끊겼다`);
    }
    const sync = code("src/lib/approval/portal-delegation-sync.ts");
    assert.ok(sync.includes("export function revokedAtOnConflict("), "한 방향 규칙(B-15)이 사라졌다 — 거둔 위임이 되살아난다");
    assert.ok(sync.includes("export async function applyPortalDelegation("), "전파를 적용하는 자리가 사라졌다");
    assert.ok(code("src/lib/approval/portal-delegation-store.ts").includes("revokedAtOnConflict(command.revokedAt)"), "쓰는 자리가 한 방향 규칙을 안 쓴다");
  });

  it("🟢 포털을 부르는 **다른 길들은 그대로다** — 걷어낸 것이 너무 넓지 않았다", () => {
    // 🔴 「포털에 묻지 마라」를 넓게 읽어 알림·명부·결재 알림까지 걷으면 종이 통째로 빈다.
    assert.ok(code("src/lib/notifications/portal.ts").includes("fetch("), "남의 알림을 받아 오는 길이 사라졌다");
    assert.ok(code("src/lib/approval/as-users.ts").includes("fetch("), "A/S 명부를 받아 오는 길이 사라졌다");
    // 🔵 이 파일은 제 손으로 fetch 하지 않는다 — 망 호출은 `./portal.ts` 가 쥐고 있다(위 줄).
    assert.ok(code("src/lib/notifications/approval-created-ping.ts").includes("notifyPortalApprovalCreated"), "결재 생김 알림 길이 사라졌다");
  });
});

describe("⑤ 🔴 위임 설정 화면이 **승인함 줄을 함께 읽는다**(설계 D-2)", () => {
  /**
   * 🔴 **두 번 뒤집힌 자리다.** 조각 4 때는 **포털에 물어서** 수를 받았고(「못 물은 0」과 「진짜
   * 0」을 가르려고 `unavailable` 칸이 있었다), 조각 8 에서 **제 표를 읽는 수**가 됐다.
   * 🔴 **2026-11-17(조각 3c)에 수 하나가 줄들이 됐다** — 화면이 그 수조차 안 그리고 있어서 쓰는
   * 분에게는 「위임되었다는 내용이 안 뜬다」로 보였다. 줄을 그리면서 **세던 함수는 걷어냈다**:
   * 같은 집합을 두 곳에서 세면 「N건이라는데 줄은 그보다 적은」 화면이 되고 오류는 안 난다.
   *
   * 🔴 **읽는 일 자체는 걷어내지 않았다.** 이 화면이 제 표만 보여 주면 「분명 맡겼는데 여기엔
   * 없다」가 되고(설계 D-2), 그것이 고지를 둘로 둔 대가다.
   */
  const screen = code("src/lib/approval/delegation-screen-data.ts");
  const queries = code(QUERIES);

  it("🔴 줄을 **제 표에서** 읽고, 거르는 자는 결재 판정과 **같은 순수 함수**다", () => {
    assert.ok(screen.includes("listPortalDelegationsIMade(actorSub, now)"), "화면이 승인함에 맡긴 줄을 안 읽는다 — 「맡겼는데 여기엔 없다」가 된다");
    assert.ok(screen.includes("listPortalDelegationsIActFor(actorSub, now)"), "화면이 승인함에서 맡은 줄을 안 읽는다");

    for (const [name, mustHave] of [
      ["listPortalDelegationsIMade", "eq(portalApprovalDelegations.delegatorSub, delegatorSub)"],
      ["listPortalDelegationsIActFor", "eq(portalApprovalDelegations.delegateSub, delegateSub)"],
    ] as const) {
      const fnStart = queries.indexOf(`export async function ${name}(`);
      assert.notEqual(fnStart, -1, `${name} 이 사라졌다 — 이 시험이 아무것도 안 재고 있다`);
      // 🔴 다음 `export` 까지만 자른다. 안 끊으면 뒤 함수의 글자에 걸려 헛통과한다.
      const rest = queries.slice(fnStart + 10);
      const fnEnd = rest.indexOf("\nexport ");
      const fn = fnEnd === -1 ? rest : rest.slice(0, fnEnd);
      assert.ok(fn.includes(".from(portalApprovalDelegations)"), `${name}: 제 표가 아니라 다른 데서 읽는다`);
      assert.ok(fn.includes(mustHave), `${name}: 방향이 뒤집혔다 — 맡긴 것과 맡은 것이 바뀌어 보인다`);
      // 🔴 이름은 **이 집 users 에서** 붙인다. 포털 표에는 이름 칸이 없다(세 시스템 공통 모양).
      assert.ok(fn.includes("counterpartName: users.name"), `${name}: 이름을 안 붙인다 — 화면에 포털 번호가 뜬다`);
      assert.ok(fn.includes(".leftJoin(users,"), `${name}: inner join 이면 이름 못 찾는 줄이 통째로 사라진다`);
    }

    // 🔴 「지금 대신하고 있나」는 결재 판정이 쓰는 그 함수로 거른다 — SQL 에 손으로 적으면
    //    반열린 구간 규칙이 한 벌 더 생긴다.
    assert.ok(
      queries.includes("return rows.filter((row) => isActiveDelegation(row, now)).map((row) => toPortalRowView(row, now));"),
      "대신하고 있는 줄을 순수 함수로 안 거른다 — 아직 시작도 안 한 위임이 「지금 대신하는 중」으로 보인다",
    );
  });

  it("🔴 **세는 자리가 하나다** — 걷어낸 수 세는 함수가 되살아나지 않았다", () => {
    // 🔵 수는 그린 줄을 센다(`portal.acting.length`). 따로 세면 언젠가 갈린다.
    assert.ok(!queries.includes("countPortalDelegationsIActFor"), "수를 따로 세는 함수가 돌아왔다 — 줄 수와 갈린다");
    assert.ok(!screen.includes("countPortalDelegationsIActFor"), "화면이 수를 또 센다");
    assert.ok(!queries.includes("count()"), "SQL 집계로 센다 — 끝난 줄·안 시작한 줄까지 세게 된다");
  });

  it("🔴 「못 물었다」 칸이 **없다** — 뜰 일 없는 경고를 그리지 않는다", () => {
    assert.ok(!screen.includes("unavailable"), "화면 자료에 「못 물었다」가 남아 있다 — 이제 못 물을 일이 없다");
    assert.ok(
      screen.includes("portal: { made: portalMade, acting: portalActing, href: approvalsDelegationHref(env.approvalsBaseUrl) }"),
      "화면이 받는 모양이 달라졌다",
    );
  });

  it("🔴 **번호는 서버에서 끝난다** — 화면이 받는 모양에 번호 칸이 없다", () => {
    // 🔵 이 파일 머리말의 명부 규칙과 같은 자리다 — 그냥 실으면 전 직원의 포털 번호가 나간다.
    assert.ok(!screen.includes("delegatorSubs"), "포털 번호 목록이 화면 자료까지 올라온다");
  });
});
