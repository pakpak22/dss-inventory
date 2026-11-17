import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Role } from "../src/db/schema/users";
import {
  OTHERS_DELEGATION_DELEGATED_ADMIN_MESSAGE,
  mayCreateOthersDelegation,
  mayManageOthersDelegations,
} from "../src/lib/approval/delegation-authority";
import { decideDelegatedRole, mayChangeApprovalRoute } from "../src/lib/approval/delegated-role";
import {
  DELEGATE_FOR_OTHERS_FORBIDDEN_MESSAGE,
  resolveDelegateFromDirectory,
  resolveDelegatorFromDirectory,
  validateDelegationInput,
} from "../src/lib/approval/delegation-input";
import { type AsUser, type AsUserDirectory } from "../src/lib/approval/directory";

/**
 * ============================================================================
 * 임시 `ADMIN` 의 울타리 하나와 「임시」 표시 (2026-11-17, 역할 위임 뒷마무리)
 * ============================================================================
 * 하루 앞서 선 조각(설계 B-10·B-11, `tests/delegated-role.test.ts`)이 **구멍 하나와 표시
 * 하나**를 남겼다.
 *
 * ── 🔴 구멍 — 임시 관리자가 **제 임기를 스스로 늘릴 수 있었다** ──────────
 * B-10 이 서면서 「`ADMIN` 이 맡긴 위임의 대리인은 기간 동안 `ADMIN`」이 됐다. 그 사람에게는
 * `mayManageOthersDelegations` 가 **참**이라 **남의 결재권까지** 맡길 수 있었는데(2026-10-26
 * 결정), 자기를 대리인으로 세우는 것은 **일부러 안 막혀 있고**(같은 날 결정 — 막는 자리 대신
 * `created_by_sub` 에 남는 기록을 두기로 했다) 위임 **기간에 상한도 없다.** 그래서
 * 「아무 진짜 `ADMIN` → 나」 위임을 길게 새로 만들면 **무기한 갱신**이 됐다 — 설계 D-7 ③ 의
 * 「역할을 바꾸는 기능은 `ADMIN` 에게도 없다」가 그 기능 하나로 무효가 된다.
 *
 * 🔴 **고친 방법**: 임시 관리자에게서 **「남의 결재권을 맡기는」 길 하나만** 닫았다(사용자
 * 결정). 🔵 **제 결재권을 맡기는 길은 그대로 열려 있다** — 누구나 하는 일이고 임기를 늘리는
 * 일과 아무 상관이 없다. 🔵 **되돌리기와 모두의 목록은 안 좁혔다** — ⑤가 그 결정을 못 박는다.
 *
 * ── 여기서 못 박는 것 일곱 ──────────────────────────────────────────────
 *  1. 🔴 임시 `ADMIN` 은 **남의** 결재권을 못 맡긴다 — **진짜 `ADMIN` 은 맡긴다**(②).
 *  2. 🔴 임시 `ADMIN` 도 **제** 결재권은 맡긴다 — 열어 두기로 한 길(③).
 *  3. 🔴 막힌 사람이 **까닭과 출구**를 읽는다. 「관리자만」이라는 **거짓말을 하지 않는다**(④).
 *  4. 🔴 **되돌리기는 안 좁혔다** — 「빠뜨린 것」이 아니라 **잰 뒤의 결정**이다(⑤).
 *  5. 🔴 그 뜻이 **쓰는 층에** 걸렸다 — 화면이 아니라(⑥).
 *  6. 🔴 머리말이 임시 관리자에게 **「임시」를 보여 준다**. 진짜 관리자에게는 **안 보여 준다**(⑦).
 *  7. 🔴 **B-10·B-11 이 안 깨졌다**(⑧).
 *
 * ── 🔴 규칙을 **베껴 적지 않는다** ──────────────────────────────────────
 * 아래 `맡겨본다` 는 서버가 하는 일을 **그대로** 한다(검증 → 결재권자 풀기 → 새 울타리). 울타리
 * 조건을 이 파일에 손으로 적으면 그 순간 「두 벌째 규칙」이 되어, 저쪽이 바뀌어도 여기만
 * 초록으로 남는다. 🔵 그 세 걸음이 **실제로 그 차례로** 쓰여 있는지는 ⑥이 소스 글자로 잰다.
 *
 * ── 🔴 이 저장소에는 DB 시험이 없다 ─────────────────────────────────────
 * 쓰는 층(`src/lib/approval/delegation-mutations.ts`)과 세션(`src/lib/auth/session.ts`)은
 * `server-only` 를 물고 있어 **불러올 수 없다** — 앞 조각과 같은 처방이다.
 *
 * 🔴 **값은 전부 가짜다** — 실제 사람 이름도 번호도 한 자 적지 않는다.
 * ============================================================================
 */

const src = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * 주석을 걷어낸 코드만. 🔴 **이 조각이 고친 파일들의 주석에는 울타리 이야기가 길게 적혀 있다** —
 * 「임시 관리자는 못 맡긴다」도, 「거두는 쪽은 안 본다」도 주석으로 한 번씩 더 적혀 있어서,
 * 주석이 코드 대신 걸리면 아래 단언이 **전부 공짜로 통과한다.** (`tests/delegated-role.test.ts`
 * 와 같은 자리·같은 함수다.)
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

/** 🔴 함수 하나만 잘라 낸다 — 파일 전체에서 찾으면 **옆 함수가 대신 통과시킨다.** */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 가 사라졌다 — 이 시험이 아무것도 안 재고 있다`);
  const end = source.indexOf("\nexport ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

/* ------------------------------------------------------------------ */
/* 본보기 — 전부 가짜 값                                                 */
/* ------------------------------------------------------------------ */

const uuid = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;

/** 🔵 A/S 사용자 id 와 포털 번호가 **다른 값**이라는 것을 본보기에서부터 못 박는다. */
const ME_ID = uuid("1");
/** 🔴 **진짜 관리자**다 — 임시 관리자가 임기를 늘리려고 노릴 바로 그 사람. */
const BOSS_ID = uuid("2");
const OTHER_ID = uuid("3");
const ME_SUB = "sub-me";
const BOSS_SUB = "sub-boss";

const asUser = (over: Partial<AsUser> & Pick<AsUser, "id" | "name">): AsUser => ({
  email: `${over.id}@example.com`,
  role: "AS_ENGINEER",
  ssoSubject: null,
  ...over,
});

const DIRECTORY: AsUserDirectory = {
  status: "ok",
  users: [
    asUser({ id: ME_ID, name: "나", ssoSubject: ME_SUB }),
    asUser({ id: BOSS_ID, name: "자리비운분", ssoSubject: BOSS_SUB }),
    asUser({ id: OTHER_ID, name: "다른분", ssoSubject: "sub-other" }),
  ],
};

const ACTOR = { name: "나", sub: ME_SUB };

const ROLES: readonly Role[] = ["VIEWER", "STAFF", "ADMIN"];

/**
 * 🔴 **세션이 만들어 주는 짝 그대로** 쓴다 — 역할과 깃발을 손으로 적어 두면 「세션은 저런 짝을
 *    만들지도 않는데 시험만 통과하는」 상태가 된다. 두 값은 언제나 함께 온다
 *    (`decideDelegatedRole` → `CurrentSession.user.role` · `CurrentSession.delegatedAdmin`).
 */
/** 기록 권한자가 **진짜 `ADMIN` 의 위임**을 받은 상태 — `{ role: "ADMIN", delegatedAdmin: true }`. */
const 임시관리자 = decideDelegatedRole("STAFF", ["ADMIN"]);
/** 진짜 관리자 — **위임을 받았어도** `{ role: "ADMIN", delegatedAdmin: false }`. */
const 진짜관리자 = decideDelegatedRole("ADMIN", ["ADMIN"]);

/**
 * 🔴 **서버의 길 그대로다**(머리말). `createApprovalDelegation` 이 트랜잭션을 열기 전에 하는
 * 세 걸음을 같은 차례로 밟는다 — 값만 가짜고 거치는 함수는 운영이 거치는 바로 그 셋이다.
 *
 * @param role 이번 요청에서 쓰이는 역할(승격됐으면 승격된 값).
 * @param delegatedAdmin 그 `ADMIN` 이 위임에서 왔는가.
 * @param delegatorUserId **누구의 결재권인가**(A/S 사용자 id). `null` 이면 비워 보낸 것 = 본인.
 * @param delegateUserId 대신할 분. 🔵 기본값은 제3자이고, ②가 **자기 자신**을 넣어 「임기를
 *   늘리는 바로 그 줄」을 돌려 본다.
 */
function 맡겨본다(
  role: Role,
  delegatedAdmin: boolean,
  delegatorUserId: string | null,
  delegateUserId: string = OTHER_ID,
): { ok: true; delegatorSub: string; isSelf: boolean } | { ok: false; code: string; message: string } {
  const validated = validateDelegationInput({
    // 🔵 화면은 안 고른 칸을 빈 글자로 보낸다 — 「비움 = 본인」이 그 자리에서 풀린다.
    delegatorUserId: delegatorUserId ?? "",
    delegateUserId,
    startDate: "2026-11-18",
    // 🔴 **기간 상한이 없다는 것**이 이 조각이 막는 구멍의 절반이다. 10년짜리도 검증을 지난다.
    endDate: "2036-11-30",
    reason: "출장",
  });
  assert.ok(validated.ok, "입력 검증에서 걸렸다 — 아래가 울타리가 아니라 날짜를 재고 있다");

  const delegator = resolveDelegatorFromDirectory(DIRECTORY, validated.delegatorUserId, ACTOR, mayManageOthersDelegations(role));
  if (!delegator.ok) return { ok: false, code: delegator.code, message: delegator.message };

  // 🔴 **이 조각이 더한 세 줄.** 본인 것이면 지나가고, 남의 것이면 임시 관리자를 거른다.
  if (!delegator.delegator.isSelf && !mayCreateOthersDelegation(role, delegatedAdmin)) {
    return { ok: false, code: "FORBIDDEN", message: OTHERS_DELEGATION_DELEGATED_ADMIN_MESSAGE };
  }

  // 🔵 여기까지 오면 서버는 「대신할 분」을 풀고 줄을 넣는다. 그 걸음도 막히지 않는다는 것을
  //    ②가 따로 확인한다(울타리가 **대리인 쪽에서** 걸린 것으로 오해하지 않게).
  return { ok: true, delegatorSub: delegator.delegator.sub, isSelf: delegator.delegator.isSelf };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 🔵 본보기가 비어 있지 않다 — 아래가 공짜로 통과하지 않게
 * ═════════════════════════════════════════════════════════════════════════ */

describe("① 🔵 본보기 — 「임시 관리자」와 「진짜 관리자」가 실제로 그 짝이다", () => {
  it("🔴 세션이 만들어 주는 짝 그대로다 — 둘 다 역할은 `ADMIN` 이고 깃발만 다르다", () => {
    assert.deepEqual(임시관리자, { role: "ADMIN", delegatedAdmin: true }, "임시 관리자 본보기가 임시가 아니다");
    assert.deepEqual(진짜관리자, { role: "ADMIN", delegatedAdmin: false }, "진짜 관리자가 임시로 둔갑했다");
    // 🔴 **역할만 보면 둘이 똑같다** — 이 조각이 깃발 하나로 갈라야 하는 까닭이 이것이다.
    assert.equal(임시관리자.role, 진짜관리자.role);
  });

  it("🔵 둘 다 **옛 자**(`mayManageOthersDelegations`)에는 참이다 — 그래서 구멍이 났었다", () => {
    assert.equal(mayManageOthersDelegations(임시관리자.role), true, "구멍이 애초에 없었다면 이 조각이 잴 것도 없다");
    assert.equal(mayManageOthersDelegations(진짜관리자.role), true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 🔴 임시 `ADMIN` 은 **남의** 결재권을 못 맡긴다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("② 🔴 남의 결재권 — 임시 관리자는 못 맡기고, 진짜 관리자는 맡긴다", () => {
  it("🔴 **임기를 늘리는 바로 그 줄**이 막힌다 — 「진짜 ADMIN → 나」를 10년짜리로", () => {
    // 🔴 이것이 이 조각이 막으려는 **그 한 줄**이다: 임시 관리자가 아무 진짜 관리자의 결재권을
    //    자기에게 길게 맡겨 두면, 다음 요청부터 그 위임이 **제 임기를 다시 찍어 낸다.**
    const r = 맡겨본다(임시관리자.role, 임시관리자.delegatedAdmin, BOSS_ID, ME_ID);
    assert.equal(r.ok, false, "임시 관리자가 제 임기를 무기한으로 늘렸다");
    assert.equal(r.code, "FORBIDDEN");
  });

  it("🔴 대리인이 **누구든** 막힌다 — 자기를 안 세워도 남의 결재권은 남의 결재권이다", () => {
    const r = 맡겨본다(임시관리자.role, 임시관리자.delegatedAdmin, BOSS_ID, OTHER_ID);
    assert.equal(r.ok, false, "대리인만 바꾸면 통과한다 — 울타리가 엉뚱한 칸을 보고 있다");
  });

  it("🔴 **진짜 관리자는 그대로 맡긴다** — 좁히면서 관리자에게서 무엇을 빼앗지 않았다", () => {
    const r = 맡겨본다(진짜관리자.role, 진짜관리자.delegatedAdmin, BOSS_ID, ME_ID);
    assert.ok(r.ok, "진짜 관리자까지 막혔다 — 2026-10-26 에 넓힌 길이 통째로 닫혔다");
    // 🔴 맡겨지는 것은 **고른 그 사람**의 결재권이다(누른 사람의 것이 아니다).
    assert.equal(r.delegatorSub, BOSS_SUB);
    assert.equal(r.isSelf, false);
  });

  it("🔵 **깃발 하나만으로 갈린다** — 같은 요청이 깃발만 내리면 통과한다", () => {
    // 🔵 이 줄이 없으면 「무언가 다른 까닭으로 막힌 것」과 구별할 수 없다(날짜·명부·대리인…).
    const 막힘 = 맡겨본다("ADMIN", true, BOSS_ID, ME_ID);
    const 통과 = 맡겨본다("ADMIN", false, BOSS_ID, ME_ID);
    assert.equal(막힘.ok, false);
    assert.ok(통과.ok, "깃발을 내려도 막힌다 — 울타리가 보는 것이 깃발이 아니다");
  });

  it("🔵 **대리인 쪽에서 막힌 것이 아니다** — 그 걸음은 지금도 멀쩡하다", () => {
    // 🔴 ②의 거절을 「자기 자신에게 맡겨서」로 오해하면 이 조각의 뜻이 통째로 뒤집힌다.
    //    결재권자(BOSS)와 대리인(나)이 다른 사람이라 그 검사는 애초에 안 걸린다.
    const r = resolveDelegateFromDirectory(DIRECTORY, ME_ID, BOSS_SUB);
    assert.ok(r.ok, "본보기가 대리인 쪽에서 막힌다 — ②가 엉뚱한 울타리를 재고 있다");
    assert.equal(r.delegate.sub, ME_SUB);
  });

  it("🔴 애초에 관리자가 아닌 사람은 **전과 같다** — 옛 문구로 거절된다", () => {
    for (const role of ["VIEWER", "STAFF"] as const) {
      const r = 맡겨본다(role, false, BOSS_ID);
      assert.equal(r.ok, false, `${role} 가 남의 결재권을 맡겼다`);
      assert.equal(r.message, DELEGATE_FOR_OTHERS_FORBIDDEN_MESSAGE, `${role} 에게 새 문구가 나갔다 — 그 사람은 위임을 받은 적이 없다`);
    }
  });

  it("🔴 자 자체도 같은 답을 낸다 — 역할 셋 × 깃발 둘 **전부**", () => {
    for (const role of ROLES) {
      // 🔵 깃발이 거짓이면 옛 자와 한 글자도 다르지 않다.
      assert.equal(mayCreateOthersDelegation(role, false), mayManageOthersDelegations(role), `${role} 의 평소 답이 바뀌었다`);
      // 🔴 깃발이 참이면 역할이 무엇이든 거짓이다.
      assert.equal(mayCreateOthersDelegation(role, true), false, `${role} + 임시 가 통과한다`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 🔵 임시 `ADMIN` 도 **제** 결재권은 맡긴다 — 열어 두기로 한 길
 * ═════════════════════════════════════════════════════════════════════════ */

describe("③ 🔵 본인 결재권은 임시 관리자도 그대로 맡긴다", () => {
  it("🔴 비워 보낸 요청(= 본인)은 **지나간다**", () => {
    // 🔴 여기가 막히면 임시 관리자는 **제 출장조차** 남에게 못 맡긴다 — 임기를 늘리는 일과
    //    아무 상관이 없는데 함께 닫히는 것이고, 증상은 「나만 위임이 안 된다」 하나뿐이다.
    const r = 맡겨본다(임시관리자.role, 임시관리자.delegatedAdmin, null);
    assert.ok(r.ok, "임시 관리자가 자기 결재권도 못 맡긴다 — 좁히려던 것보다 많이 좁혔다");
    assert.equal(r.isSelf, true);
    assert.equal(r.delegatorSub, ME_SUB);
  });

  it("🔴 고르개에서 **자기 이름을 골라도** 본인 위임이다 — 비워 보낸 것과 같은 결과", () => {
    // 🔴 「본인인가」는 포털 번호로 갈린다. 자격을 먼저 물으면 이 요청이 거절되고, 관리자
    //    고르개가 보이는 사람일수록 자기 이름을 고르는 일이 흔하다.
    const r = 맡겨본다(임시관리자.role, 임시관리자.delegatedAdmin, ME_ID);
    assert.ok(r.ok, "자기 이름을 골랐다는 이유로 막혔다");
    assert.equal(r.isSelf, true);
  });

  it("🔵 보기·기록 권한자의 본인 위임도 그대로다 — 이 조각은 그쪽을 건드리지 않았다", () => {
    for (const role of ROLES) {
      assert.ok(맡겨본다(role, false, null).ok, `${role} 의 본인 위임이 막혔다`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 🔴 막힌 사람이 **까닭과 출구**를 읽는다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("④ 🔴 거절 글 — 「권한이 없습니다」로 끝내지 않는다", () => {
  const 글 = OTHERS_DELEGATION_DELEGATED_ADMIN_MESSAGE;

  it("🔴 **무엇이 막았나** — 위임으로 받은 관리자 자격이라고 말해 준다", () => {
    // 🔴 이 사람의 머리말에는 「관리자 · ADMIN」이 떠 있다. 자격의 출처를 안 적으면 고장으로 읽는다.
    assert.match(글, /위임/, "무엇이 막았는지 안 적혀 있다");
    assert.match(글, /관리자 자격/, "받은 것이 무엇인지 안 적혀 있다");
  });

  it("🔴 **왜** 막는지 적혀 있다 — 제 임기를 스스로 늘리는 길이기 때문", () => {
    assert.match(글, /늘릴 수 있기 때문/, "왜 막는지 안 적혀 있다 — 까닭 없는 금지는 고장으로 읽힌다");
  });

  it("🔴 **무엇은 되는지**와 **어떻게 하는지**가 함께 적혀 있다", () => {
    assert.match(글, /본인 결재권은 그대로/, "되는 길을 안 알려 준다 — 사람이 제 위임까지 포기한다");
    assert.match(글, /관리자에게 요청/, "출구가 없다");
  });

  it("🔴 **「관리자만 됩니다」라고 거짓말하지 않는다** — 그 사람은 지금 관리자다", () => {
    assert.notEqual(글, DELEGATE_FOR_OTHERS_FORBIDDEN_MESSAGE, "옛 문구를 돌려쓴다 — 임시 관리자에게는 거짓말이다");
    assert.doesNotMatch(글, /관리자만/, "「관리자만 맡길 수 있다」가 남아 있다 — 읽는 사람이 자기가 관리자인 줄 안다");
    // 🔵 영어 개발자 메시지가 새어 나가지 않는다(CLAUDE.md 10절).
    assert.doesNotMatch(글, /forbidden|permission|role|admin/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 🔴 **되돌리기는 안 좁혔다** — 빠뜨린 것이 아니라 잰 뒤의 결정
 * ═════════════════════════════════════════════════════════════════════════ */

const MUTATIONS = codeOnly(src("src/lib/approval/delegation-mutations.ts"));

describe("⑤ 🔴 거두는 길은 임시 관리자에게도 열려 있다 — 좁힐 까닭이 없다", () => {
  const 거두기 = bodyOf(MUTATIONS, "export async function revokeApprovalDelegation(");

  it("🔵 **표본이 비어 있지 않다** — 거두는 함수를 제대로 잘라 냈나", () => {
    assert.ok(거두기.includes("approvalDelegations.revokedAt"), "거두는 본문을 못 집었다 — 아래가 아무것도 안 재고 있다");
    assert.ok(거두기.length > 400, `${거두기.length}자뿐이다 — 주석 걷어내기나 자르기가 깨졌다`);
  });

  it("🔴 조건절은 **2026-10-26 그대로**다 — 본인 것이거나 `ADMIN`", () => {
    assert.ok(거두기.includes("const mayRevokeOthers = mayManageOthersDelegations(actor.role);"), "거두기의 역할 울타리가 바뀌었다");
    assert.ok(
      거두기.includes("mayRevokeOthers ? undefined : eq(approvalDelegations.delegatorSub, actor.sub)"),
      "거두기의 인가 조건절이 사라졌다 — 남의 결재권을 아무나 거둔다",
    );
  });

  it("🔴 거두는 쪽은 깃발을 **아예 안 본다** — 끼워 넣으면 판단이 뒤집힌다", () => {
    // 🔴 거두기는 `revoked_at` 을 찍기만 하는 일이라 **어떤 위임도 새로 만들거나 늘리지
    //    못한다.** 임시 관리자가 이 함수로 할 수 있는 최대는 제 자격을 스스로 끊는 것이다.
    //    반대로 막으면, 자리 비운 관리자를 대신하라고 세운 사람이 **잘못 선 위임을 거둘 손을
    //    잃는다** — 넓히는 쪽만 열린 채 좁히는 쪽이 닫힌 상태가 된다.
    assert.equal(거두기.includes("delegatedAdmin"), false, "거두기가 깃발을 보기 시작했다 — 급할 때 거둘 손이 없어진다");
    assert.equal(거두기.includes("mayCreateOthersDelegation"), false, "맡기기의 자를 거두기에 가져다 댔다");
  });

  it("🔵 **읽기(모두의 목록)도 안 좁혔다** — 읽기로는 임기가 늘지 않는다", () => {
    const queries = codeOnly(src("src/lib/approval/delegation-queries.ts"));
    assert.ok(
      queries.includes('if (!mayManageOthersDelegations(actorRole)) return { ok: false, reason: "FORBIDDEN" }'),
      "모두의 목록 울타리가 바뀌었다 — 이 조각이 좁힌 것은 맡기기 하나다",
    );
    assert.equal(queries.includes("mayCreateOthersDelegation"), false, "읽기에까지 번졌다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ 🔴 그 뜻이 **쓰는 층에** 걸렸다 — 화면이 아니라
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑥ 🔴 울타리가 **서버**에 꽂혔다 — 화면이 고르개를 숨기는 것이 아니라", () => {
  const 맡기기 = bodyOf(MUTATIONS, "export async function createApprovalDelegation(");

  it("🔵 **표본이 비어 있지 않다** — 맡기는 함수를 제대로 잘라 냈나", () => {
    assert.ok(맡기기.includes(".insert(approvalDelegations)"), "맡기는 본문을 못 집었다 — 아래가 아무것도 안 재고 있다");
  });

  it("🔴 **본인인지 먼저 보고** 깃발로 거른다 — 두 조건이 그 차례로 한 줄에 있다", () => {
    assert.ok(
      맡기기.includes("if (!delegator.delegator.isSelf && !mayCreateOthersDelegation(actor.role, actor.delegatedAdmin)) {"),
      "울타리 줄이 없거나 모양이 달라졌다 — 차례가 뒤집히면 임시 관리자가 제 결재권도 못 맡긴다",
    );
    assert.ok(
      맡기기.includes('return { ok: false, code: "FORBIDDEN", message: OTHERS_DELEGATION_DELEGATED_ADMIN_MESSAGE };'),
      "막고서 까닭을 안 돌려준다",
    );
  });

  it("🔴 **줄을 넣기 전에** 막는다 — 넣고 나서 거절하면 늘어난 임기는 그대로 남는다", () => {
    const 울타리 = 맡기기.indexOf("mayCreateOthersDelegation(");
    const 넣기 = 맡기기.indexOf(".insert(approvalDelegations)");
    assert.ok(울타리 > 0 && 넣기 > 울타리, "울타리가 줄을 넣은 뒤에 있다");
  });

  it("🔴 깃발은 **세션에서** 온다 — 폼에서 읽으면 울타리가 통째로 없어진다", () => {
    const action = codeOnly(src("src/app/actions/approval-delegations.ts"));
    assert.ok(action.includes("delegatedAdmin: session.delegatedAdmin,"), "액션이 깃발을 안 넘긴다 — 울타리가 늘 열려 있거나 늘 닫혀 있다");
    assert.equal(action.includes('formData.get("delegatedAdmin")'), false, "깃발을 폼에서 읽는다 — 손으로 만든 요청이 울타리를 끈다");
    // 🔵 문은 그대로 `requireSession` 이다 — 역할로 막으면 본인 위임이 함께 막힌다(2026-10-21).
    assert.equal(action.includes("requireRole"), false, "위임 액션이 역할 문을 달았다 — 보기 권한자가 자기 위임을 못 만든다");
  });

  it("🔴 **화면은 그대로 고르개를 그린다** — 숨기면 막힌 까닭을 읽을 자리가 사라진다", () => {
    // 🔴 B-11 과 같은 판단이다(결재선 편집 화면도 안 숨겼다). 화면이 감추는 것은 어차피
    //    울타리가 아니고, 감추면 사람은 「고장났다」로 읽은 뒤 물어볼 곳도 없다.
    const screen = codeOnly(src("src/lib/approval/delegation-screen-data.ts"));
    assert.ok(screen.includes("canDelegateForOthers: mayManageOthersDelegations(actorRole),"), "고르개 판정이 바뀌었다 — 울타리가 화면으로 옮겨 갔다");
    assert.equal(screen.includes("delegatedAdmin"), false, "화면 자료가 깃발을 보기 시작했다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑦ 🔴 머리말이 **「임시」**를 보여 준다
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑦ 🔴 임시 관리자는 자기가 임시라는 것을 **화면에서** 안다", () => {
  const HEADER = codeOnly(src("src/components/AppHeader.tsx"));
  const 배지 = (() => {
    const start = HEADER.indexOf("function UserIdentity(");
    assert.notEqual(start, -1, "이름·역할 배지 조각이 사라졌다");
    const end = HEADER.indexOf("\nexport function AppHeader(", start);
    return HEADER.slice(start, end === -1 ? undefined : end);
  })();

  it("🔵 **표본이 비어 있지 않다** — 배지 조각을 제대로 잘라 냈나", () => {
    assert.ok(배지.includes("ROLE_LABEL[user.role]"), "역할 배지를 그리는 자리를 못 찾았다 — 아래가 아무것도 안 재고 있다");
    assert.ok(배지.length > 200, `${배지.length}자뿐이다 — 주석 걷어내기나 자르기가 깨졌다`);
  });

  it("🔴 **깃발이 참일 때만** 「임시」가 그려진다", () => {
    assert.match(배지, /\{user\.delegatedAdmin \? \(/, "「임시」가 깃발을 안 보고 그려진다");
    assert.match(배지, /임시\s*<\/Link>/, "「임시」라는 글자가 없다 — 배지가 예전과 같다");
    assert.match(배지, /\) : null\}/, "거짓일 때 무엇을 그리는지가 안 적혀 있다");
  });

  it("🔴 **진짜 관리자에게는 한 글자도 안 바뀐다**", () => {
    // 🔴 두 걸음을 **함께** 잰다: ① 진짜 관리자의 깃발은 언제나 거짓이고(판정 함수),
    //    ② 「임시」는 그 깃발이 참일 때만 그려진다(위). 둘 중 하나만 재면 뜻이 반쪽이다.
    assert.equal(진짜관리자.delegatedAdmin, false, "진짜 관리자에게 깃발이 선다 — 위임만 받아도 「임시」가 뜬다");
    assert.equal(decideDelegatedRole("ADMIN", []).delegatedAdmin, false);
    // 🔴 역할 배지 자체는 손대지 않았다.
    assert.ok(배지.includes("{ROLE_LABEL[user.role]} · {user.role}"), "역할 배지의 글자가 바뀌었다");
    assert.ok(배지.includes("bg-zinc-100"), "역할 배지의 생김새가 바뀌었다");
  });

  it("🔴 **기간을 보러 갈 길**을 알려 준다 — 「임시」만 적고 끝내지 않는다", () => {
    // 🔵 기간 자체는 안 싣기로 했다(머리말에 까닭). 대신 그 값이 줄마다 적혀 있는 화면으로
    //    한 번에 보낸다 — 길이 없으면 사람은 설정 탭 일곱 개를 뒤진다.
    assert.ok(배지.includes('href="/settings/delegations"'), "「임시」를 눌러도 아무 데도 안 간다");
    assert.match(배지, /title="[^"]*결재권 위임[^"]*"/, "어디서 기간을 보는지 글로도 안 적혀 있다");
  });

  it("🔴 **폰과 컴퓨터가 같은 배지를 그린다** — 두 벌로 베끼지 않았다", () => {
    // 🔴 머리말은 넓은 화면과 ☰ 서랍 두 곳에서 같은 조각을 쓴다. 칸이 갈리면 한쪽에만
    //    「임시」가 뜨고, 그 어긋남은 아무 오류도 내지 않는다.
    assert.equal(HEADER.split("<UserIdentity user={user} />").length - 1, 2, "두 자리가 같은 조각을 같은 값으로 안 쓴다");
    assert.equal(HEADER.split("function UserIdentity(").length - 1, 1, "배지 조각이 두 벌이 됐다");
    assert.equal(HEADER.split("user.delegatedAdmin").length - 1, 1, "깃발을 보는 자리가 둘이 됐다");
  });

  it("🔴 깃발이 **세션에서** 머리말까지 실제로 닿는다", () => {
    const layout = codeOnly(src("src/app/(app)/layout.tsx"));
    assert.ok(layout.includes("delegatedAdmin: session.delegatedAdmin,"), "레이아웃이 깃발을 안 내려보낸다 — 「임시」가 영영 안 뜬다");
    // 🔴 역할과 **짝으로** 내려간다 — 하나만 내려보내면 배지가 반쪽짜리 말을 한다.
    assert.ok(layout.includes("role: session.user.role,"), "역할과 깃발이 갈라졌다");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑧ 🔴 앞 조각(B-10·B-11)이 **안 깨졌다**
 * ═════════════════════════════════════════════════════════════════════════ */

describe("⑧ 🔴 B-10·B-11 은 그대로다 — 이 조각은 더하기만 했다", () => {
  it("🔴 B-10 — `ADMIN` 이 맡기면 역할은 여전히 따라간다", () => {
    assert.deepEqual(decideDelegatedRole("VIEWER", ["ADMIN"]), { role: "ADMIN", delegatedAdmin: true });
    assert.deepEqual(decideDelegatedRole("STAFF", ["STAFF"]), { role: "STAFF", delegatedAdmin: false });
  });

  it("🔴 B-11 — 결재선 설정은 여전히 임시 관리자에게 닫혀 있고 진짜 관리자에게 열려 있다", () => {
    assert.equal(mayChangeApprovalRoute(임시관리자.role, 임시관리자.delegatedAdmin), false);
    assert.equal(mayChangeApprovalRoute(진짜관리자.role, 진짜관리자.delegatedAdmin), true);
  });

  it("🔴 **두 울타리가 같은 깃발을 본다** — 세션 한 칸이 둘을 함께 연다", () => {
    // 🔴 둘이 다른 값을 보기 시작하면 「결재선은 막히는데 남의 위임은 되는」 반쪽 상태가 생기고,
    //    그 상태에서는 임기를 늘리는 길이 그대로 열려 있다.
    const route = codeOnly(src("src/app/actions/approval-routes.ts"));
    assert.ok(route.includes("mayChangeApprovalRoute(session.user.role, session.delegatedAdmin)"), "B-11 이 세션 깃발을 안 본다");
    const action = codeOnly(src("src/app/actions/approval-delegations.ts"));
    assert.ok(action.includes("delegatedAdmin: session.delegatedAdmin,"), "새 울타리가 세션 깃발을 안 본다");
  });
});
