import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  delegatorSubsFor,
  isActiveDelegation,
  type ApprovalDelegationPeriod,
} from "../src/lib/approval/delegation";

/**
 * ============================================================================
 * 결재권 위임 — 순수 규칙 (2026-10-21, 조각 1)
 * ============================================================================
 * 이 저장소에는 DB 시험이 없다. 그래서 **서버가 기대는 규칙을 여기서 전부 돌려 본다** —
 * 다음 조각의 서버는 `src/lib/approval/delegation.ts` 를 부르기만 한다.
 *
 * 여기서 못 박는 것:
 *  1. **다섯 경계**를 정확한 시각으로 — 시작 직전·시작 그 순간·끝 직전·끝 그 순간·끝난 뒤.
 *     🔴 끝은 **포함하지 않는다**(반열린 구간). 잇대어 적은 두 위임이 **둘 다 유효한 순간**을
 *     갖지 않는 것이 그 규칙의 존재 이유이고, 그것도 여기서 잰다.
 *  2. **되돌린 위임은 기간 안이어도 안 된다** — 되돌리기는 기간을 줄여 적는 것이 아니라
 *     깃발을 하나 세우는 것이라, 기간만 보면 되돌린 뒤에도 계속 참이 된다.
 *  3. 🔴 **두 겹이 안 이어진다** — A→B 와 B→C 가 있어도 C 는 A 의 결재권을 못 쓴다.
 *  4. 한 사람이 **둘에게서** 위임받으면 둘 다 쓸 수 있다(두 사람이 동시에 출장 갈 수 있다).
 *  5. 🔴 **열쇠는 포털 번호다** — `users.id` 나 A/S 번호를 넘기면 빈 배열이다. 2026-10-15
 *     결함(열쇠를 섞어 「내가 결재할 건」이 영원히 빈 목록이 됨)의 울타리를 여기도 세운다.
 * ============================================================================
 */

/**
 * 가짜 포털 번호와 가짜 A/S 번호. 🔴 **일부러 다른 모양**으로 둔다 — 같은 값으로 두면 열쇠를
 * 바꿔 넘겨도 시험이 통과해 버려 울타리 구실을 못 한다(`part-issue-approval.test.ts` 와 같은 관례).
 */
const sub = (name: string) => `sub-${name}`;
const asId = (name: string) => `as-${name}`;

/** 기간 하나 — 2026-10-01 00:00 부터 2026-10-08 00:00 **직전**까지. */
const STARTS = new Date("2026-10-01T00:00:00.000Z");
const ENDS = new Date("2026-10-08T00:00:00.000Z");

/** 위임 한 줄. 되돌린 시각은 기본이 `null`(살아 있음). */
const delegation = (
  delegatorName: string,
  delegateName: string,
  over: Partial<ApprovalDelegationPeriod> = {},
): ApprovalDelegationPeriod => ({
  delegatorSub: sub(delegatorName),
  delegateSub: sub(delegateName),
  startsAt: STARTS,
  endsAt: ENDS,
  revokedAt: null,
  ...over,
});

describe("① 살아 있는 위임인가 — 다섯 경계", () => {
  const d = delegation("kim", "lee");

  it("시작 **직전** — 아직 아니다", () => {
    assert.equal(isActiveDelegation(d, new Date("2026-09-30T23:59:59.999Z")), false);
  });

  it("시작 **그 순간** — 시작은 포함한다", () => {
    assert.equal(isActiveDelegation(d, new Date("2026-10-01T00:00:00.000Z")), true, "시작 시각을 빼면 그날 0시에 올라온 건을 아무도 못 누른다");
  });

  it("기간 한가운데 — 참", () => {
    assert.equal(isActiveDelegation(d, new Date("2026-10-04T12:00:00.000Z")), true);
  });

  it("끝 **직전** — 아직 참이다", () => {
    assert.equal(isActiveDelegation(d, new Date("2026-10-07T23:59:59.999Z")), true);
  });

  it("🔴 끝 **그 순간** — 거짓이다. 끝은 포함하지 않는다(반열린 구간)", () => {
    assert.equal(
      isActiveDelegation(d, new Date("2026-10-08T00:00:00.000Z")),
      false,
      "끝을 포함하면 잇대어 적은 두 위임이 **둘 다 유효한 순간**을 갖는다",
    );
  });

  it("끝난 **뒤** — 거짓", () => {
    assert.equal(isActiveDelegation(d, new Date("2026-10-08T00:00:00.001Z")), false);
  });

  it("🔴 잇대어 적은 두 위임은 **겹치는 순간이 없다** — 넘어가는 그 순간에 뒤엣것 하나만 산다", () => {
    // 출장이 끝나는 날 다른 사람에게 다시 맡기는 일은 사람이 실제로 한다. 그 순간에 결재가
    // 들어오면 「누구의 권한으로 눌렀나」가 둘이 되어 나중에 그 건을 설명할 수 없다.
    const first = delegation("kim", "lee");
    const second = delegation("park", "lee", { startsAt: ENDS, endsAt: new Date("2026-10-15T00:00:00.000Z") });
    const at = ENDS;

    assert.equal(isActiveDelegation(first, at), false);
    assert.equal(isActiveDelegation(second, at), true);
    assert.deepEqual(delegatorSubsFor([first, second], sub("lee"), at), [sub("park")]);
  });
});

describe("② 되돌린 위임", () => {
  it("🔴 기간 **안**이어도 안 된다 — 되돌리기는 기간을 줄여 적는 것이 아니다", () => {
    const revoked = delegation("kim", "lee", { revokedAt: new Date("2026-10-03T09:00:00.000Z") });
    const at = new Date("2026-10-04T12:00:00.000Z");

    assert.equal(isActiveDelegation(revoked, at), false, "기간만 보면 되돌린 뒤에도 계속 참이 된다");
    assert.deepEqual(delegatorSubsFor([revoked], sub("lee"), at), []);
  });

  it("되돌린 시각보다 **앞선** 시각으로 물어도 거짓이다 — 깃발 하나로 판정한다", () => {
    // 🔵 「되돌리기 전에는 유효했다」를 되살리려면 그 시각까지 봐야 하지만, 그 길은 열지
    //    않는다 — 결재는 지금 누를 수 있는가만 묻고, 지난 일은 결재 단계 줄에 남는다.
    const revoked = delegation("kim", "lee", { revokedAt: new Date("2026-10-05T00:00:00.000Z") });
    assert.equal(isActiveDelegation(revoked, new Date("2026-10-02T00:00:00.000Z")), false);
  });
});

describe("③ 이 사람이 지금 누구의 결재권을 쓸 수 있나", () => {
  const at = new Date("2026-10-04T12:00:00.000Z");

  it("위임받은 적이 없으면 빈 배열", () => {
    assert.deepEqual(delegatorSubsFor([delegation("kim", "lee")], sub("cho"), at), []);
  });

  it("받은 사람에게만 돌아간다 — 맡긴 사람은 남의 결재권을 얻지 않는다", () => {
    const rows = [delegation("kim", "lee")];
    assert.deepEqual(delegatorSubsFor(rows, sub("lee"), at), [sub("kim")]);
    assert.deepEqual(delegatorSubsFor(rows, sub("kim"), at), [], "방향이 거꾸로 돌면 맡긴 사람이 자기 대리인의 권한을 쓰게 된다");
  });

  it("🔵 한 사람이 **둘에게서** 위임받으면 둘 다 쓸 수 있다 — 두 사람이 동시에 출장 갈 수 있다", () => {
    const rows = [delegation("kim", "lee"), delegation("park", "lee")];
    assert.deepEqual(delegatorSubsFor(rows, sub("lee"), at), [sub("kim"), sub("park")]);
  });

  it("같은 결재권자가 여러 줄로 겹쳐 있어도 번호는 한 번만 — 겹치면 같은 건이 목록에 두 번 뜬다", () => {
    const rows = [
      delegation("kim", "lee"),
      delegation("kim", "lee", { startsAt: new Date("2026-10-03T00:00:00.000Z"), endsAt: new Date("2026-10-20T00:00:00.000Z") }),
    ];
    assert.deepEqual(delegatorSubsFor(rows, sub("lee"), at), [sub("kim")]);
  });

  it("기간이 지난 줄·되돌린 줄은 섞여 있어도 걸러진다", () => {
    const rows = [
      delegation("kim", "lee", { startsAt: new Date("2026-09-01T00:00:00.000Z"), endsAt: new Date("2026-09-10T00:00:00.000Z") }),
      delegation("park", "lee", { revokedAt: new Date("2026-10-02T00:00:00.000Z") }),
      delegation("cho", "lee"),
      delegation("kim", "han"),
    ];
    assert.deepEqual(delegatorSubsFor(rows, sub("lee"), at), [sub("cho")]);
  });

  it("🔴 A/S 번호를 넘기면 빈 배열이다 — 열쇠는 포털 번호다", () => {
    // 🔴 2026-10-15 결함의 울타리. 오류는 안 나고 「막힌 것처럼」만 보여서, 이 시험이 없으면
    //    열쇠가 다시 뒤바뀌어도 아무도 모른다.
    assert.deepEqual(delegatorSubsFor([delegation("kim", "lee")], asId("lee"), at), []);
  });
});

describe("④ 🔴 이어 붙지 않는다 — 위임은 한 겹이다", () => {
  const at = new Date("2026-10-04T12:00:00.000Z");
  /** A→B 와 B→C 가 **둘 다 살아 있다.** */
  const rows = [delegation("a", "b"), delegation("b", "c")];

  it("C 는 B 의 결재권만 얻는다 — **A 의 것은 못 쓴다**", () => {
    assert.deepEqual(
      delegatorSubsFor(rows, sub("c"), at),
      [sub("b")],
      "A 가 맡긴 사람은 B 뿐이다. 이어 붙이면 A 가 동의한 적 없는 사람에게 결재권이 넘어간다",
    );
  });

  it("B 는 A 의 결재권을 그대로 얻는다 — 한 겹은 멀쩡히 돈다", () => {
    assert.deepEqual(delegatorSubsFor(rows, sub("b"), at), [sub("a")]);
  });

  it("고리(A→B, B→A)가 있어도 끝난다 — 서로 한 겹씩만", () => {
    // 이어 붙이기를 열면 이 모양에서 끝나지 않는다. 깊이 제한을 두는 길도 있지만 그 숫자에
    // 뜻을 붙일 방법이 없다(왜 2단계는 되고 3단계는 안 되는가).
    const loop = [delegation("a", "b"), delegation("b", "a")];
    assert.deepEqual(delegatorSubsFor(loop, sub("a"), at), [sub("b")]);
    assert.deepEqual(delegatorSubsFor(loop, sub("b"), at), [sub("a")]);
  });
});
