/**
 * ============================================================================
 * 승인함에서 온 결재권 위임을 **받아 적는 판단** — 라우트가 아니라 여기에 둔다
 * ============================================================================
 * 2026-11-16 저녁에 방식이 뒤집혔다(설계 B-12): 포털이 **지정·철회할 때 각 시스템에
 * 전파하고**, 각 시스템은 제 표만 읽는다. 이 파일은 그 전파를 받아 「저장할지 말지」를
 * 가르는 자리다. 표는 `@/db/schema/portal-approval-delegations`, 들어오는 길은
 * `app/api/integration/delegations/route.ts` 하나다.
 *
 * ── 🔴 DB 도 망도 여기서 만지지 않는다 ──────────────────────────────────
 * 사람을 되짚는 일(`findActor`)과 줄을 쓰는 일(`store`)을 **인자로 받는다.** 이 집의
 * `notifications/portal-approvals.ts` 가 같은 모양이고 같은 까닭이다 — 이 통로는 포털이
 * 서명한 토큰을 들고 와야 열려서 **손으로 불러 볼 수 없다.** 판단을 여기 내려 두면
 * 멱등·`not_applicable`·거절을 **DB 없이 그대로 시험**할 수 있고(`tests/portal-delegation-
 * sync.test.ts`), 라우트에는 「토큰 꺼내 검증하고 이 함수 부르기」만 남는다.
 *
 * ── 🔴 `not_applicable` 은 **오류가 아니다** ────────────────────────────
 * 위임자나 대리인이 **이 시스템에 계정이 없으면** 저장할 수 없는데, 그것은 고장이 아니다 —
 * 그 사람은 여기서 결재할 일이 없으니 위임도 뜻이 없다. 🔴 오류로 답하면 포털이 **전파
 * 실패**로 보고 **지정 자체를 거절한다**(설계 B-13). 그러면 「재고관리 계정이 없는 사람에게는
 * 위임을 아예 못 맡기는」 일이 생긴다 — 재고관리와 아무 상관없는 A/S 결재권까지 막힌다.
 *
 * ── 🔴 멱등은 **포털이 정한 `id`** 가 쥔다 ──────────────────────────────
 * 같은 `id` 로 두 번 와도 한 줄이다(PK + 덮어쓰기). 포털은 전파가 실패로 보이면 다시 보낼 수
 * 있고(끊긴 응답은 저쪽이 이미 저장했을 수도 있다), 그때 줄이 둘이 되면 **거두는 철회가 한
 * 줄만 맞힌다.** 그래서 번호를 이 집이 새로 만들지 않는다.
 *
 * ── 🔵 「묻는 쪽」을 여기서 걷어내지 않는다 ─────────────────────────────
 * `./portal-acting-subs.ts`(결재할 때마다 포털에 묻는 길)는 아직 그대로 돌아간다. 이 표가 아직
 * 판정에 안 이어져 있어서(조각 8), 지금 걷으면 포털 위임이 **통째로 안 듣는다.**
 * ============================================================================
 */

/**
 * 🔵 `./delegation-input.ts` 의 것과 같은 자다. 가져다 쓰지 않는 까닭도 그 파일이 `./input.ts`
 * 의 것을 안 가져다 쓴 까닭과 같다 — 저쪽은 **사람이 화면에서 고른 값**을 재는 자리이고
 * 이쪽은 **포털이 보낸 몸통**을 재는 자리다. 한 줄이라 따로 둔다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 🔴 **시간대가 반드시 붙어 있어야 한다**(`Z` 또는 `+09:00`).
 *
 * `new Date("2026-11-16T00:00:00")` 은 **그 서버의 지역 시각**으로 읽힌다 — 개발 PC(KST)와
 * 운영 NAS(UTC)에서 **아홉 시간 다른 순간**이 되고, 오류는 한 번도 안 난다. 위임의 시작·끝이
 * 아홉 시간 어긋나면 「맡겼는데 아침에 안 듣는다」가 되는데 그 까닭을 아무도 못 찾는다.
 * 🔵 포털이 보내는 값은 `Date.toISOString()`(끝이 `Z`)이라 평소에는 걸리지 않는다. 걸렸다면
 *    몸통이 우리가 아는 그 모양이 아닌 것이고, 그때는 **거절하는 쪽이 맞다**.
 */
const ISO_WITH_ZONE_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** 포털이 보낸 한 번의 전파. 🔴 **모양은 세 시스템 공통 규약이다** — 칸 이름을 바꾸지 않는다. */
export type PortalDelegationCommand =
  | {
      action: "upsert";
      /** 🔴 포털이 정한 번호. 이 집이 만들지 않는다. */
      id: string;
      delegatorSub: string;
      delegateSub: string;
      startsAt: Date;
      endsAt: Date;
      reason: string;
      /**
       * 🔵 평소에는 `null` 이다(`upsert` 는 살아 있는 줄을 쓴다). 몸통에 값이 실려 오면 그대로
       * 적는다 — 까닭은 아래 `parsePortalDelegationCommand` 주석.
       */
      revokedAt: Date | null;
    }
  | {
      action: "revoke";
      id: string;
      revokedAt: Date;
    };

/**
 * 🔴 **둘 다 성공이다.** `not_applicable` 은 「이 시스템에는 해당 없다」이고 오류가 아니다
 * (머리말). 포털은 둘 다 200 으로 받는다.
 */
export type PortalDelegationOutcome = "stored" | "not_applicable";

export type ParsePortalDelegationResult =
  | { ok: true; command: PortalDelegationCommand }
  /**
   * 🔵 글자는 **포털 로그를 읽는 사람**에게 하는 말이다(사람이 보는 화면이 아니다). 그래서
   * 「어느 칸이 왜 틀렸나」를 분명히 적는다 — 토큰 거절과 달리 여기서 숨길 것이 없다.
   * 몸통은 이미 자격을 통과한 포털이 보낸 것이고, 모양이 틀렸다는 사실 자체가 단서다.
   */
  | { ok: false; message: string };

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

/**
 * 시각 한 칸. 모양이 틀렸거나 달력에 없는 날이면 `null`.
 *
 * 🔴 `new Date(...)` 만으로는 모자란다. 셋을 따로 본다:
 *  1. **모양** — `new Date("2026")` 도 통과하고 시간대 없는 글자도 통과한다(위 정규식 주석).
 *  2. **읽히는가** — 달이 13 이거나 시가 25 면 `Invalid Date` 다.
 *  3. 🔴 **달력에 있는 날인가** — `2026-02-30` 은 **조용히 3월 2일로 넘어간다**(2026-11-16 실측.
 *     `delegation-input.ts` 의 `parseDateText` 가 같은 함정을 같은 수법으로 막는다). 되읽어
 *     같은 날인지 보지 않으면 **포털이 보낸 적 없는 날짜**로 위임이 선다.
 */
function readInstant(source: Record<string, unknown>, key: string): Date | null {
  const text = readString(source, key);
  if (text === null) return null;
  const shape = ISO_WITH_ZONE_RE.exec(text);
  if (shape === null) return null;

  const at = new Date(text);
  if (Number.isNaN(at.getTime())) return null;

  const [year, month, day] = [Number(shape[1]), Number(shape[2]), Number(shape[3])];
  // 🔵 날짜 칸만 따로 되읽는다 — 시간대가 붙어 있으면 `at` 의 UTC 날짜가 하루 밀릴 수 있어
  //    `at` 으로는 못 잰다(`2026-11-17T00:00:00+09:00` 는 UTC 로 11월 16일이다).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;

  return at;
}

/**
 * 포털이 보낸 몸통을 읽는다. 🔴 **그대로 믿지 않는다** — 여기서 거절하면 통로가 400 이고,
 * 포털은 그것을 **전파 실패**로 보고 지정 자체를 거절한다(설계 B-13). 즉 **조용히 틀리는 길이
 * 없다.**
 *
 * ── 🔵 모르는 칸은 그냥 지나간다 ────────────────────────────────────────
 * 포털이 나중에 칸을 더해도(조각 9 의 점검 값 따위) 이 통로가 먼저 깨지지 않게 한다. 보는
 * 것은 우리가 쓰는 칸뿐이다.
 *
 * ── 🔴 `upsert` 에 `revokedAt` 이 실려 오면 **그대로 적는다** ────────────
 * 통로 규약은 「`upsert` 에는 `revokedAt` 이 없다」지만, 실려 온 값을 **버리지 않는다.**
 * 버리면 「거둔 줄 알았는데 안 거둬진」 상태가 생기고, 설계 B-13 이 **그쪽이 더 위험하다**고
 * 못 박았다. 🔵 `null` 은 「없음」과 같게 다룬다 — 포털이 제 표의 줄을 통째로 실어 보내면
 * `revokedAt: null` 이 딸려 오기 쉽고, 그것을 400 으로 거절하면 **멀쩡한 지정이 막힌다.**
 */
export function parsePortalDelegationCommand(payload: unknown): ParsePortalDelegationResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, message: "몸통이 JSON 객체가 아닙니다." };
  }
  const body = payload as Record<string, unknown>;

  const action = readString(body, "action");
  if (action !== "upsert" && action !== "revoke") {
    return { ok: false, message: 'action 은 "upsert" 또는 "revoke" 여야 합니다.' };
  }

  const id = readString(body, "id");
  if (id === null || !UUID_RE.test(id)) {
    return { ok: false, message: "id 가 uuid 가 아닙니다." };
  }

  if (action === "revoke") {
    // 🔵 철회는 `id` 와 `revokedAt` 만 쓴다(통로 규약). 기간·사람 칸이 함께 와도 보지 않는다 —
    //    그 값으로 줄을 고치기 시작하면 「거두면서 기간이 바뀌는」 길이 생긴다.
    const revokedAt = readInstant(body, "revokedAt");
    if (revokedAt === null) {
      return { ok: false, message: "revokedAt 이 시간대가 붙은 ISO 8601 시각이 아닙니다." };
    }
    return { ok: true, command: { action, id, revokedAt } };
  }

  const delegatorSub = readString(body, "delegatorSub");
  const delegateSub = readString(body, "delegateSub");
  if (delegatorSub === null || delegatorSub === "" || delegateSub === null || delegateSub === "") {
    return { ok: false, message: "delegatorSub · delegateSub 가 있어야 합니다." };
  }
  /**
   * 🔴 **표의 CHECK 와 같은 잣대를 여기서 먼저 댄다.** DB 까지 보내면 그 줄은 예외로 터지고
   *    포털에는 500 으로 보인다 — 500 과 400 은 포털이 다르게 다룬다(다시 보낼지 말지).
   */
  if (delegatorSub === delegateSub) {
    return { ok: false, message: "자기 자신에게 맡기는 위임은 받지 않습니다." };
  }

  const startsAt = readInstant(body, "startsAt");
  const endsAt = readInstant(body, "endsAt");
  if (startsAt === null || endsAt === null) {
    return { ok: false, message: "startsAt · endsAt 이 시간대가 붙은 ISO 8601 시각이어야 합니다." };
  }
  // 🔴 표의 `portal_approval_delegations_period_valid` 와 같은 잣대(`>`). 기간이 거꾸로인 줄은
  //    영원히 유효하지 않은데 화면에는 멀쩡해 보인다.
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, message: "endsAt 이 startsAt 보다 뒤여야 합니다." };
  }

  const rawReason = body.reason;
  // 🔵 안 보냈거나 `null` 이면 빈 글자다 — 사유는 선택이고, 없다고 위임을 막을 일은 아니다.
  //    🔴 다만 **글자가 아닌 값**(숫자·객체)은 거절한다. 우리가 아는 그 몸통이 아니다.
  if (rawReason !== undefined && rawReason !== null && typeof rawReason !== "string") {
    return { ok: false, message: "reason 은 글자여야 합니다." };
  }
  const reason = typeof rawReason === "string" ? rawReason : "";

  const rawRevokedAt = body.revokedAt;
  let revokedAt: Date | null = null;
  if (rawRevokedAt !== undefined && rawRevokedAt !== null) {
    revokedAt = readInstant(body, "revokedAt");
    if (revokedAt === null) {
      return { ok: false, message: "revokedAt 이 시간대가 붙은 ISO 8601 시각이 아닙니다." };
    }
  }

  return { ok: true, command: { action, id, delegatorSub, delegateSub, startsAt, endsAt, reason, revokedAt } };
}

/**
 * 이 시스템에서 그 사람을 되짚은 결과. 🔵 이름은 **감사 로그에 남길 사본**이다 — 표에는 이름
 * 칸이 없다(세 시스템 공통 모양이라 못 더한다).
 */
export type PortalDelegationPerson = { id: string; name: string };

/** 줄을 쓰는 일. 🔴 **판단은 여기 없다** — 시키는 대로 쓰고 「썼나」만 돌려준다. */
export type PortalDelegationStore = {
  /** 있으면 덮어쓰고 없으면 넣는다. 🔴 같은 `id` 로 두 번 와도 **한 줄**이어야 한다. */
  upsert(row: {
    command: Extract<PortalDelegationCommand, { action: "upsert" }>;
    delegator: PortalDelegationPerson;
    delegate: PortalDelegationPerson;
  }): Promise<void>;
  /**
   * 그 줄의 `revoked_at` 을 세운다.
   * @returns 🔴 **그 번호의 줄이 없었으면 `false`** — 오류가 아니다(애초에 `not_applicable` 로
   *   저장하지 않았던 줄일 수 있다).
   */
  revoke(id: string, revokedAt: Date): Promise<boolean>;
};

/**
 * 전파 한 번을 적용한다.
 *
 * @param findActor 포털 번호로 이 시스템의 **살아 있는** 사람을 되짚는다. 없으면 `null`.
 *   🔴 알림·승인함 통로와 **같은 함수**(`findActiveUserByAuthSub`)를 넘겨야 한다 — 한쪽만
 *   느슨해지면 이 시스템에서 막힌 사람이 포털에서는 통과한다.
 *
 * ── 🔴 철회는 **사람을 되짚지 않는다** ──────────────────────────────────
 * 줄이 있으면 거두고 없으면 `not_applicable` 이다. 그 줄이 있다는 사실이 곧 「저장할 때 두 사람
 * 다 여기 있었다」는 뜻이고, 그 사이에 계정이 지워졌다고 **거두기를 거를 수는 없다** — 거둬야 할
 * 줄을 남겨 두는 쪽이 훨씬 위험하다(설계 B-13: 「거둔 줄 알았는데 안 거둬진」).
 */
export async function applyPortalDelegation(params: {
  command: PortalDelegationCommand;
  findActor: (sub: string) => Promise<PortalDelegationPerson | null>;
  store: PortalDelegationStore;
}): Promise<{ outcome: PortalDelegationOutcome }> {
  const { command, findActor, store } = params;

  if (command.action === "revoke") {
    const revoked = await store.revoke(command.id, command.revokedAt);
    return { outcome: revoked ? "stored" : "not_applicable" };
  }

  /**
   * 🔴 **둘 중 하나라도 이 시스템에 없으면 저장하지 않는다**(머리말). 대리인만 있어도 안 된다 —
   * 결재권의 주인이 여기 없으면 여기에는 대신 누를 차례 자체가 없고, 반대로 위임자만 있으면
   * 대리인이 이 시스템에 로그인할 수 없어 그 줄은 아무 일도 하지 않는다.
   * 🔵 둘을 **함께** 묻는다 — 한쪽이 없을 때 다른 쪽을 안 묻는 것으로 아낄 것이 없고(한 번에
   *    두 줄 조회), 가지가 하나면 「어느 쪽이 없었나」를 나중에 가를 필요도 없다.
   */
  const [delegator, delegate] = await Promise.all([findActor(command.delegatorSub), findActor(command.delegateSub)]);
  if (delegator === null || delegate === null) {
    return { outcome: "not_applicable" };
  }

  await store.upsert({ command, delegator, delegate });
  return { outcome: "stored" };
}
