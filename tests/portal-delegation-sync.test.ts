import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPortalDelegation,
  parsePortalDelegationCommand,
  type PortalDelegationCommand,
  type PortalDelegationPerson,
  type PortalDelegationStore,
} from "../src/lib/approval/portal-delegation-sync";

/**
 * ============================================================================
 * 승인함에서 온 결재권 위임을 받아 적기 (2026-11-16, 조각 6 · 설계 B-12)
 * ============================================================================
 * 이 통로는 **손으로 불러 볼 수 없다** — 포털이 RS256 으로 서명한 토큰을 들고 와야 열린다.
 * 그래서 판단을 라우트에서 내려(`src/lib/approval/portal-delegation-sync.ts`) DB 없이 그대로
 * 돌려 본다. 🔵 이 집의 `npm test` 는 DB 에 붙지 않는다.
 *
 * 여기서 지키는 것 다섯 — 🔴 전부 **조용히 틀리면 비싼** 자리다:
 *  1. **멱등**: 같은 `id` 로 두 번 와도 한 줄이다(포털이 재시도할 수 있다).
 *  2. 🔴 **계정이 없으면 `not_applicable` 이고 그것은 성공이다.** 오류로 답하면 포털이 전파
 *     실패로 보고 **지정 자체를 거절한다**(설계 B-13) — 재고관리 계정이 없는 사람에게는 A/S
 *     결재권조차 못 맡기게 된다.
 *  3. **모양이 틀리면 거절**한다(통로가 400 으로 옮긴다).
 *  4. **철회는 없는 줄에 와도 오류가 아니다** — 애초에 저장 안 했던 줄일 수 있다.
 *  5. 🔴 **시간대 없는 시각은 받지 않는다** — 개발 PC(KST)와 NAS(UTC)에서 아홉 시간 다른
 *     순간이 되고, 오류는 한 번도 안 난다.
 *
 * 🔴 자격증명(토큰)과 라우트의 울타리는 `tests/integration-delegations-route-source.test.ts` 와
 *    `tests/portal-service-token.test.ts` 가 본다 — 저쪽은 소스로, 토큰 판정은 실제로 돌려서.
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* 본보기 — 🔴 실제 사람 이름·번호를 쓰지 않는다(공개 저장소에 박힌다)   */
/* ------------------------------------------------------------------ */

const DELEGATOR_SUB = "portal-sub-aaaa";
const DELEGATE_SUB = "portal-sub-bbbb";
const ID = "11111111-1111-4111-8111-111111111111";

const DELEGATOR: PortalDelegationPerson = { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "홍길동" };
const DELEGATE: PortalDelegationPerson = { id: "bbbbbbbb-2222-4222-8222-222222222222", name: "김철수" };

/** 포털이 보내는 몸통 그대로(통로 규약). 시험마다 칸을 덮어 쓴다. */
function upsertBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "upsert",
    id: ID,
    delegatorSub: DELEGATOR_SUB,
    delegateSub: DELEGATE_SUB,
    startsAt: "2026-11-16T15:00:00.000Z",
    endsAt: "2026-11-20T15:00:00.000Z",
    reason: "출장",
    ...over,
  };
}

function revokeBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { action: "revoke", id: ID, revokedAt: "2026-11-18T05:00:00.000Z", ...over };
}

/** 몸통을 읽어 명령으로. 🔴 못 읽으면 시험을 거기서 멈춘다(엉뚱한 것을 재지 않도록). */
function parsed(body: Record<string, unknown>): PortalDelegationCommand {
  const result = parsePortalDelegationCommand(body);
  assert.ok(result.ok, `본보기 몸통을 못 읽었다: ${result.ok ? "" : result.message}`);
  return result.command;
}

/** 거절 메시지. 🔵 읽는 쪽이 포털 로그라 글자를 숨기지 않는다. */
function rejection(body: unknown): string {
  const result = parsePortalDelegationCommand(body);
  assert.equal(result.ok, false, "거절했어야 하는 몸통을 받아들였다");
  return result.ok ? "" : result.message;
}

/* ------------------------------------------------------------------ */
/* 가짜 저장소 — 표 대신 Map 하나                                       */
/* ------------------------------------------------------------------ */

type StoredRow = {
  delegatorSub: string;
  delegateSub: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  revokedAt: Date | null;
  /** 🔵 표에는 없는 칸이다 — 이름이 **감사 로그로** 넘어가는지 보려고 시험만 들고 있다. */
  names: [string, string];
};

function fakeStore(): { store: PortalDelegationStore; rows: Map<string, StoredRow>; calls: { upsert: number; revoke: number } } {
  const rows = new Map<string, StoredRow>();
  const calls = { upsert: 0, revoke: 0 };
  const store: PortalDelegationStore = {
    async upsert({ command, delegator, delegate }) {
      calls.upsert += 1;
      // 🔴 **열쇠가 포털의 `id` 다.** 진짜 표에서는 PK + onConflictDoUpdate 가 같은 일을 한다
      //    (그 두 글자가 실제로 쓰였는지는 route-source 시험이 소스로 본다).
      rows.set(command.id, {
        delegatorSub: command.delegatorSub,
        delegateSub: command.delegateSub,
        startsAt: command.startsAt,
        endsAt: command.endsAt,
        reason: command.reason,
        revokedAt: command.revokedAt,
        names: [delegator.name, delegate.name],
      });
    },
    async revoke(id, revokedAt) {
      calls.revoke += 1;
      const row = rows.get(id);
      if (!row) return false;
      row.revokedAt = revokedAt;
      return true;
    },
  };
  return { store, rows, calls };
}

/** 이 시스템에 계정이 있는 사람들. 없는 번호를 물으면 `null`. */
function directory(people: Record<string, PortalDelegationPerson>): (sub: string) => Promise<PortalDelegationPerson | null> {
  return async (sub) => people[sub] ?? null;
}

const BOTH = directory({ [DELEGATOR_SUB]: DELEGATOR, [DELEGATE_SUB]: DELEGATE });
const NOBODY = directory({});

/* ================================================================== */

describe("승인함 위임 받아 적기 — 0. 무엇을 재고 있는가", () => {
  /**
   * 🔴 표본이 비어서 공짜로 통과하는 것을 막는다. 아래 시험들이 전부 「본보기 몸통」에 기대고
   *    있어서, 그 몸통이 애초에 안 읽히면 거절 시험들이 **이유도 없이 전부 통과**한다.
   */
  it("본보기 몸통 둘이 실제로 읽힌다 — 거절 시험이 공짜로 통과하지 않게", () => {
    const up = parsed(upsertBody());
    assert.equal(up.action, "upsert");
    const rv = parsed(revokeBody());
    assert.equal(rv.action, "revoke");
  });

  it("명부 본보기가 실제로 사람을 돌려준다", async () => {
    assert.deepEqual(await BOTH(DELEGATOR_SUB), DELEGATOR);
    assert.deepEqual(await BOTH(DELEGATE_SUB), DELEGATE);
    assert.equal(await NOBODY(DELEGATOR_SUB), null);
  });
});

describe("몸통 읽기 — 모양이 틀리면 거절한다(통로가 400)", () => {
  it("옳은 upsert 몸통은 값이 그대로 들어온다", () => {
    const command = parsed(upsertBody());
    assert.equal(command.action, "upsert");
    assert.equal(command.id, ID);
    if (command.action !== "upsert") return;
    assert.equal(command.delegatorSub, DELEGATOR_SUB);
    assert.equal(command.delegateSub, DELEGATE_SUB);
    assert.equal(command.startsAt.toISOString(), "2026-11-16T15:00:00.000Z");
    assert.equal(command.endsAt.toISOString(), "2026-11-20T15:00:00.000Z");
    assert.equal(command.reason, "출장");
    assert.equal(command.revokedAt, null, "upsert 는 살아 있는 줄이다");
  });

  it("옳은 revoke 몸통은 번호와 거둔 시각만 쓴다", () => {
    // 🔵 기간·사람 칸이 함께 와도 보지 않는다 — 「거두면서 기간이 바뀌는」 길을 만들지 않는다.
    const command = parsed(revokeBody({ startsAt: "2026-01-01T00:00:00.000Z", delegateSub: "portal-sub-zzzz" }));
    assert.equal(command.action, "revoke");
    if (command.action !== "revoke") return;
    assert.equal(command.id, ID);
    assert.equal(command.revokedAt.toISOString(), "2026-11-18T05:00:00.000Z");
    assert.ok(!("delegateSub" in command), "철회 명령에 사람 칸이 실리면 안 된다");
  });

  it("JSON 객체가 아니면 거절한다 (배열·글자·null)", () => {
    for (const body of [null, "upsert", 42, [upsertBody()]]) {
      assert.match(rejection(body), /JSON 객체/);
    }
  });

  it("action 이 둘 중 하나가 아니면 거절한다", () => {
    for (const action of [undefined, "", "delete", "UPSERT", 1]) {
      assert.match(rejection(upsertBody({ action })), /action/);
    }
  });

  it("🔴 id 가 uuid 가 아니면 거절한다 — 번호의 주인이 포털이다", () => {
    for (const id of [undefined, "", "not-a-uuid", "1111", 1111]) {
      assert.match(rejection(upsertBody({ id })), /uuid/);
      assert.match(rejection(revokeBody({ id })), /uuid/);
    }
  });

  it("사람 칸이 비면 거절한다", () => {
    assert.match(rejection(upsertBody({ delegatorSub: "" })), /delegatorSub/);
    assert.match(rejection(upsertBody({ delegateSub: undefined })), /delegateSub/);
    assert.match(rejection(upsertBody({ delegateSub: 7 })), /delegateSub/);
  });

  it("🔴 자기에게 맡기는 줄은 표의 CHECK 에 닿기 전에 거절한다 (500 이 아니라 400 이어야 한다)", () => {
    assert.match(rejection(upsertBody({ delegateSub: DELEGATOR_SUB })), /자기 자신/);
  });

  it("🔴 기간이 거꾸로이거나 길이가 0 이면 거절한다 — 반열린 구간이라 유효한 순간이 없다", () => {
    assert.match(rejection(upsertBody({ endsAt: "2026-11-15T15:00:00.000Z" })), /endsAt/);
    assert.match(rejection(upsertBody({ endsAt: "2026-11-16T15:00:00.000Z" })), /endsAt/);
  });

  it("🔴 시간대가 없는 시각은 거절한다 — 개발 PC 와 NAS 에서 아홉 시간 다른 순간이 된다", () => {
    for (const startsAt of ["2026-11-16T15:00:00", "2026-11-16", "2026", "내일", 1763305200000]) {
      assert.match(rejection(upsertBody({ startsAt })), /startsAt|endsAt/);
    }
    assert.match(rejection(revokeBody({ revokedAt: "2026-11-18T05:00:00" })), /revokedAt/);
    // 🔵 `+09:00` 도 시간대다 — 받아야 한다(포털이 Z 로 보내지만 규약은 ISO 8601 이다).
    const command = parsed(upsertBody({ startsAt: "2026-11-17T00:00:00+09:00" }));
    assert.equal(command.action === "upsert" && command.startsAt.toISOString(), "2026-11-16T15:00:00.000Z");
  });

  it("달력에 없는 날은 거절한다", () => {
    assert.match(rejection(upsertBody({ startsAt: "2026-02-30T00:00:00.000Z" })), /startsAt|endsAt/);
  });

});

describe("몸통 읽기 — 사유와 거둔 시각의 가장자리", () => {
  it("사유가 없거나 null 이면 빈 글자다", () => {
    for (const reason of [undefined, null]) {
      const command = parsed(upsertBody({ reason }));
      assert.equal(command.action === "upsert" ? command.reason : "x", "");
    }
  });

  it("사유가 글자가 아니면 거절한다", () => {
    for (const reason of [7, { text: "출장" }, ["출장"]]) {
      assert.match(rejection(upsertBody({ reason })), /reason/);
    }
  });

  it("🔵 upsert 의 revokedAt 이 null 이면 「없음」과 같다 — 거절하면 멀쩡한 지정이 막힌다", () => {
    const command = parsed(upsertBody({ revokedAt: null }));
    assert.equal(command.action === "upsert" ? command.revokedAt : "x", null);
  });

  it("🔴 upsert 에 거둔 시각이 실려 오면 **버리지 않고** 그대로 적는다", () => {
    // 버리면 「거둔 줄 알았는데 안 거둬진」 상태가 생긴다(설계 B-13 이 더 위험하다고 못 박은 쪽).
    const command = parsed(upsertBody({ revokedAt: "2026-11-18T05:00:00.000Z" }));
    assert.equal(command.action === "upsert" ? command.revokedAt?.toISOString() : "x", "2026-11-18T05:00:00.000Z");
  });

  it("revoke 에 거둔 시각이 없으면 거절한다 — 그것 하나가 그 명령의 전부다", () => {
    assert.match(rejection(revokeBody({ revokedAt: undefined })), /revokedAt/);
    assert.match(rejection(revokeBody({ revokedAt: null })), /revokedAt/);
  });
});

describe("🔴 저장 — 멱등", () => {
  it("같은 id 로 두 번 보내도 **한 줄**이다", async () => {
    const { store, rows, calls } = fakeStore();
    const first = await applyPortalDelegation({ command: parsed(upsertBody()), findActor: BOTH, store });
    const second = await applyPortalDelegation({ command: parsed(upsertBody()), findActor: BOTH, store });
    assert.equal(first.outcome, "stored");
    assert.equal(second.outcome, "stored");
    assert.equal(calls.upsert, 2, "두 번 다 저장을 시도해야 한다(포털의 재시도를 막지 않는다)");
    assert.equal(rows.size, 1, "줄이 둘이 되면 철회가 한 줄만 맞힌다");
  });

  it("두 번째가 **덮어쓴다** — 기간·사유를 고쳐 다시 보내는 것이 평범한 길이다", async () => {
    const { store, rows } = fakeStore();
    await applyPortalDelegation({ command: parsed(upsertBody()), findActor: BOTH, store });
    await applyPortalDelegation({
      command: parsed(upsertBody({ endsAt: "2026-11-25T15:00:00.000Z", reason: "병가" })),
      findActor: BOTH,
      store,
    });
    assert.equal(rows.size, 1);
    const row = rows.get(ID);
    assert.ok(row);
    assert.equal(row.endsAt.toISOString(), "2026-11-25T15:00:00.000Z");
    assert.equal(row.reason, "병가");
  });

  it("🔵 이름은 **이 시스템에서 되짚은 값**이 넘어간다 — 표에 이름 칸이 없어 감사 로그가 받는다", async () => {
    const { store, rows } = fakeStore();
    await applyPortalDelegation({ command: parsed(upsertBody()), findActor: BOTH, store });
    assert.deepEqual(rows.get(ID)?.names, ["홍길동", "김철수"]);
  });
});

describe("🔴 저장 — 계정이 없으면 `not_applicable`(오류가 아니다)", () => {
  it("위임자가 이 시스템에 없으면 저장하지 않고 성공으로 답한다", async () => {
    const { store, rows, calls } = fakeStore();
    const result = await applyPortalDelegation({
      command: parsed(upsertBody()),
      findActor: directory({ [DELEGATE_SUB]: DELEGATE }),
      store,
    });
    assert.equal(result.outcome, "not_applicable");
    assert.equal(calls.upsert, 0, "저장을 시도하면 안 된다");
    assert.equal(rows.size, 0);
  });

  it("대리인이 이 시스템에 없어도 같다", async () => {
    const { store, calls } = fakeStore();
    const result = await applyPortalDelegation({
      command: parsed(upsertBody()),
      findActor: directory({ [DELEGATOR_SUB]: DELEGATOR }),
      store,
    });
    assert.equal(result.outcome, "not_applicable");
    assert.equal(calls.upsert, 0);
  });

  it("둘 다 없어도 **던지지 않는다** — 오류로 답하면 포털이 지정 자체를 거절한다(B-13)", async () => {
    const { store } = fakeStore();
    const result = await applyPortalDelegation({ command: parsed(upsertBody()), findActor: NOBODY, store });
    assert.equal(result.outcome, "not_applicable");
  });
});

describe("🔴 철회", () => {
  it("저장해 둔 줄을 거두면 포털이 보낸 시각이 찍힌다 (받은 시각이 아니다)", async () => {
    const { store, rows } = fakeStore();
    await applyPortalDelegation({ command: parsed(upsertBody()), findActor: BOTH, store });
    const result = await applyPortalDelegation({ command: parsed(revokeBody()), findActor: BOTH, store });
    assert.equal(result.outcome, "stored");
    assert.equal(rows.get(ID)?.revokedAt?.toISOString(), "2026-11-18T05:00:00.000Z");
  });

  it("🔴 같은 철회가 두 번 와도 값이 같다 — 멱등", async () => {
    const { store, rows } = fakeStore();
    await applyPortalDelegation({ command: parsed(upsertBody()), findActor: BOTH, store });
    await applyPortalDelegation({ command: parsed(revokeBody()), findActor: BOTH, store });
    const again = await applyPortalDelegation({ command: parsed(revokeBody()), findActor: BOTH, store });
    assert.equal(again.outcome, "stored");
    assert.equal(rows.size, 1);
    assert.equal(rows.get(ID)?.revokedAt?.toISOString(), "2026-11-18T05:00:00.000Z");
  });

  it("🔴 없는 줄에 와도 오류가 아니다 — 애초에 `not_applicable` 로 저장 안 했던 줄일 수 있다", async () => {
    const { store, rows } = fakeStore();
    const result = await applyPortalDelegation({ command: parsed(revokeBody()), findActor: BOTH, store });
    assert.equal(result.outcome, "not_applicable");
    assert.equal(rows.size, 0);
  });

  it("🔴 철회는 **사람을 되짚지 않는다** — 그 사이 계정이 지워져도 거둔다", async () => {
    const { store, rows } = fakeStore();
    await applyPortalDelegation({ command: parsed(upsertBody()), findActor: BOTH, store });
    // 「거둬야 할 줄을 남겨 두는」 쪽이 훨씬 위험하다(설계 B-13).
    const result = await applyPortalDelegation({ command: parsed(revokeBody()), findActor: NOBODY, store });
    assert.equal(result.outcome, "stored");
    assert.ok(rows.get(ID)?.revokedAt);
  });
});
