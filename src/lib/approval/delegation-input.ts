import {
  DIRECTORY_UNREACHABLE_SAVE_MESSAGE,
  type AsUserDirectory,
} from "./directory";

/**
 * ============================================================================
 * 결재권 위임 만들기 — 입력 검증과 **날짜 → 시각** 환산 (순수)
 * ============================================================================
 * DB 도 세션도 망도 여기서 만지지 않는다 — `./delegation.ts` · `./input.ts` 와 같은 자리다.
 * 그래야 아래 환산에 DB 없는 시험이 붙고, 「10월 25일까지」가 정말 25일 **하루 전체**를
 * 덮는지 사람이 돌려 볼 수 있다.
 *
 * ── 🔴 화면은 **날짜**를 말하고 표는 **시각**을 적는다 ──────────────────
 * 사람은 「10월 25일까지」라고 생각한다. 표는 반열린 구간이라 `starts_at <= now < ends_at`
 * 으로 판정한다(`./delegation.ts` 의 `isActiveDelegation`). 그래서 **끝나는 날의 다음 날
 * 0시**를 적어야 25일 23:59 까지가 포함된다. 적은 날짜를 그대로 넣으면 **종료일 당일에
 * 위임이 안 먹는데 아무도 오류를 못 본다** — 「왜 안 되지」만 남는 종류의 결함이라, 그
 * 환산을 화면 안에 적지 않고 여기 꺼내 시험으로 물어 둔다.
 *
 * ── 🔴 시간대는 `Asia/Seoul` 이다 ───────────────────────────────────────
 * 운영 서버(NAS)는 UTC 로 돈다(CLAUDE.md 10절). `new Date("2026-10-25")` 는 **UTC 0시**라
 * 한국에서는 **오전 9시**다 — 그대로 쓰면 위임이 아침 9시에 시작하고 종료일 아침 9시에
 * 끊긴다. 그래서 아래는 전부 **한국 시각 0시**를 손으로 만든다.
 *
 * 🔵 고정 오프셋(+09:00)으로 셈해도 되는 까닭: 한국은 1988년 이후 서머타임이 없다. 그래서
 *    「한국 시각 0시」 = `Date.UTC(y, m, d) - 9시간` 이 언제나 참이다. 다른 나라가 들어오는
 *    날에는 이 상수가 아니라 시간대 라이브러리가 필요하다 — 그때 고칠 자리가 여기 하나다.
 * ============================================================================
 */

/** 한국 표준시의 고정 오프셋. 🔵 서머타임이 없어 상수로 둘 수 있다(머리말). */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 🔵 `./input.ts` 에도 같은 정규식이 있지만 그것은 그 파일 안의 비공개 상수다. 가져다 쓰면
 * 두 모듈이 서로를 끌어와 「결재선 입력」과 「위임 입력」이 한 덩어리가 된다 — 한 줄을 따로 둔다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 바깥에서 들어온 글자가 uuid 모양인가. 🔵 위임 번호(되돌리기)도 이 자를 쓴다. */
export function isUuidText(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** `YYYY-MM-DD` 를 쪼갠다. 달력에 없는 날(2026-02-30)이면 `null`. */
function parseDateText(date: string): { year: number; month: number; day: number } | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // 🔴 `Date.UTC` 는 범위를 넘는 값을 **조용히 넘긴다**(2026-02-30 → 3월 2일). 되읽어 같은
  //    날인지 보지 않으면 사람이 적은 적 없는 날짜로 위임이 선다.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * 그날 **한국 시각 0시**의 절대 시각. 달력에 없는 날이면 `null`.
 *
 * 🔵 `day` 가 그달의 마지막 날을 넘으면 `Date.UTC` 가 다음 달로 넘겨 준다 — 아래
 *    `seoulNextDayStart` 가 10/31 → 11/01, 12/31 → 다음 해 1/1 을 그 성질로 얻는다.
 */
function seoulMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

/** 「그날 0시(한국)」 — 위임이 **시작하는** 순간. */
export function seoulDayStart(date: string): Date | null {
  const parts = parseDateText(date);
  return parts === null ? null : seoulMidnight(parts.year, parts.month, parts.day);
}

/**
 * 🔴 「그 **다음 날** 0시(한국)」 — 위임이 **끝나는** 순간. 여기가 이 파일의 핵심이다.
 *
 * 반열린 구간이라 끝은 포함되지 않으므로(`isActiveDelegation`), 「10월 25일까지」의 끝은
 * **10월 26일 0시**다. 그래야 25일 23:59:59 가 포함되고 26일 0시부터 끊긴다.
 */
export function seoulNextDayStart(date: string): Date | null {
  const parts = parseDateText(date);
  return parts === null ? null : seoulMidnight(parts.year, parts.month, parts.day + 1);
}

/**
 * 표에 적힌 **끝나는 시각**을 사람이 적었던 **종료일**로 되돌린다 — 화면에 「10월 25일까지」로
 * 보여 주기 위해서다. 🔴 `ends_at` 을 그대로 그리면 **하루 뒤 날짜**가 보인다(10/26).
 *
 * 🔵 1밀리초를 빼서 「그 구간의 마지막 순간」이 어느 날인지를 묻는다 — 위 `seoulNextDayStart`
 *    의 정확한 역함수이고, 둘이 왕복하는지는 시험이 본다.
 */
export function seoulEndDateText(endsAt: Date): string {
  return seoulDateText(new Date(endsAt.getTime() - 1));
}

/** 그 순간이 한국에서 며칠인가 — `YYYY-MM-DD`. 🔴 시간대를 박는다(CLAUDE.md 10절). */
export function seoulDateText(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/* ------------------------------------------------------------------ */
/* 새 위임 입력                                                          */
/* ------------------------------------------------------------------ */

/**
 * 화면이 보내는 값.
 *
 * ── 🔴 2026-10-26: 「누구의 결재권인가」 칸이 생겼다 ────────────────────
 * 그 전에는 이 타입에 그 칸이 **아예 없었고**, 서버가 세션에서 꺼내 넣었다. 자리를 갑자기
 * 비우게 된 사람(병가·사고)은 본인이 설정할 수 없어서, **관리자가 남의 결재권도** 맡길 수
 * 있게 넓혔다(사용자 결정. A/S 를 같은 날 같은 방식으로 바꿨다).
 *
 * 🔴 **그래도 포털 번호(`sub`)는 끝까지 화면에서 오지 않는다.** 여기 오는 것은 **A/S 사용자
 * id** 이고, 번호로 푸는 일은 서버가 명부를 보고 한다(`resolveDelegatorFromDirectory`).
 * 번호를 그대로 받는 칸을 두면 손으로 만든 요청이 **명부에 없는 사람의 결재권까지** 넘길 수
 * 있다 — 그때는 아무도 그 줄을 설명할 수 없다.
 * 🔴 **인가는 이 파일이 하지 않는다.** 「남의 것을 맡길 수 있나」는 역할 사다리로 가르고, 그
 * 울타리는 `./delegation-mutations.ts` 안에 있다(서버 액션은 지금도 `requireSession` 이다).
 *
 * 🔵 대신할 사람도 **A/S 사용자 id** 로 온다. 포털 번호는 화면에 내려보내지 않으므로
 *    (`./directory.ts` 머리말) 번호로 푸는 일은 서버가 명부를 보고 한다.
 */
export type DelegationFormInput = {
  /**
   * 🔴 **누구의 결재권인가** — A/S 사용자 id. **비었으면 본인**이다.
   *
   * 🔵 비움을 본인으로 읽는 까닭이 둘이다. ① 관리자가 아닌 사람의 화면에는 이 고르개가
   *    **아예 그려지지 않는다**(잠긴 고르개를 두지 않는다) — 그 화면이 보내는 요청에는 이
   *    칸이 없다. ② 세션에는 포털 번호만 있고 **그 사람의 A/S id 는 모른다.** 그래서
   *    「본인」을 가리키는 A/S id 를 화면이 적어 보낼 방법이 애초에 없다.
   */
  delegatorUserId?: string;
  delegateUserId: string;
  /** `YYYY-MM-DD`. 그날 **한국 시각 0시**부터. */
  startDate: string;
  /** `YYYY-MM-DD`. 🔴 **그날 하루가 전부 포함된다**(끝은 다음 날 0시로 적힌다). */
  endDate: string;
  /** 왜 맡기는가. 🔵 비워도 된다 — 안 적었다고 위임을 막을 일은 아니다(표 쪽 주석). */
  reason: string;
};

export type DelegationInputIssueCode =
  /** 요청 자체의 모양이 아니다 — 객체가 아니거나 칸이 글자가 아니다(손으로 만든 요청). */
  | "INVALID_INPUT"
  | "MISSING_DELEGATE"
  | "MISSING_DATE"
  | "INVALID_DATE"
  | "PERIOD_REVERSED";

export type ValidateDelegationInputResult =
  | {
      ok: true;
      /**
       * 🔴 **누구의 결재권인가** — A/S 사용자 id, 또는 `null`(= 본인).
       *
       * 🔴 여기 담기는 것은 **아직 아무 권한도 확인되지 않은 값**이다. 「그 사람이 명부에
       *    있나」·「남의 것을 맡길 자격이 있나」는 `resolveDelegatorFromDirectory` 가 가른다.
       */
      delegatorUserId: string | null;
      delegateUserId: string;
      /** 사람이 적은 그대로 — 화면에 되돌려 보여 줄 때 쓴다. */
      startDate: string;
      endDate: string;
      reason: string;
      /** 표에 넣을 시각 둘. 🔴 `endsAt` 은 **종료일의 다음 날 0시**다(머리말). */
      startsAt: Date;
      endsAt: Date;
    }
  | { ok: false; code: DelegationInputIssueCode; message: string };

/** 사유 길이 상한. 🔵 서버 액션들이 쓰는 `cleanNote` 와 같은 자(500자). */
export const DELEGATION_REASON_MAX = 500;

/**
 * 화면에서 받은 값을 그대로 믿지 않는다 — 이 함수는 **화면을 거치지 않고도** 불린다.
 *
 * 🔴 **기간이 거꾸로면 여기서 막는다.** DB CHECK(`approval_delegations_period_valid`)도 막지만,
 * 거기까지 가면 사람에게는 「알 수 없는 오류」로 보인다(CLAUDE.md 10절 — 영어 개발자 메시지를
 * 화면에 내지 않는다). 🔵 시작일과 종료일이 **같은 날은 정상**이다: 그 하루 전체를 덮는다.
 */
export function validateDelegationInput(input: unknown): ValidateDelegationInputResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "위임 입력을 확인할 수 없습니다." };
  }
  const { delegatorUserId, delegateUserId, startDate, endDate, reason } = input as Record<string, unknown>;

  /**
   * 🔴 **비었으면 본인이다** — 「안 골랐다」가 아니라 **기본값**이라 거절하지 않는다. 관리자가
   *    아닌 사람의 화면에는 이 칸이 아예 없고(고르개를 그리지 않는다), 그 요청도 그대로 돌아야
   *    한다. 🔴 값이 **있는데 uuid 가 아니면** 거절한다 — 조용히 본인으로 되돌리면 「남의
   *    결재권을 맡기려 했는데 내 것이 맡겨진」 줄이 오류 없이 하나 생긴다.
   */
  const delegator =
    delegatorUserId === undefined || delegatorUserId === null || (typeof delegatorUserId === "string" && delegatorUserId.trim() === "")
      ? null
      : delegatorUserId;
  if (delegator !== null && !isUuidText(delegator)) {
    return { ok: false, code: "INVALID_INPUT", message: "누구의 결재권인지 확인할 수 없습니다. 목록에서 다시 고르십시오." };
  }

  if (typeof delegateUserId !== "string" || delegateUserId.trim() === "") {
    return { ok: false, code: "MISSING_DELEGATE", message: "대신할 분을 고르십시오." };
  }
  if (!isUuidText(delegateUserId)) {
    return { ok: false, code: "INVALID_INPUT", message: "대신할 분을 확인할 수 없습니다. 목록에서 다시 고르십시오." };
  }

  for (const [value, label] of [
    [startDate, "시작일"],
    [endDate, "종료일"],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") {
      return { ok: false, code: "MISSING_DATE", message: `${label}을 고르십시오.` };
    }
  }

  const startsAt = seoulDayStart(startDate as string);
  if (startsAt === null) {
    return { ok: false, code: "INVALID_DATE", message: "시작일을 확인할 수 없습니다. 날짜를 다시 고르십시오." };
  }
  // 🔴 **다음 날 0시**다(머리말). 적은 날짜를 그대로 넣으면 종료일 당일에 위임이 안 먹는다.
  const endsAt = seoulNextDayStart(endDate as string);
  if (endsAt === null) {
    return { ok: false, code: "INVALID_DATE", message: "종료일을 확인할 수 없습니다. 날짜를 다시 고르십시오." };
  }

  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, code: "PERIOD_REVERSED", message: "종료일이 시작일보다 앞섭니다. 기간을 다시 고르십시오." };
  }

  return {
    ok: true,
    delegatorUserId: delegator,
    delegateUserId,
    startDate: startDate as string,
    endDate: endDate as string,
    // 🔵 줄바꿈과 겹친 공백을 한 칸으로 — 이 저장소의 서버 액션들과 같은 잣대다.
    reason: typeof reason === "string" ? reason.replace(/\s+/g, " ").trim().slice(0, DELEGATION_REASON_MAX) : "",
    startsAt,
    endsAt,
  };
}

/* ------------------------------------------------------------------ */
/* 「누구의 결재권인가」를 명부에서 풀기 (2026-10-26)                      */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **누구의 결재권을 맡기는가** — 포털 번호까지 확정된 결과.
 *
 * 🔵 `isSelf` 를 함께 돌려주는 까닭: 「본인이 맡겼나, 관리자가 대신 세웠나」는 표에서
 *    `created_by_sub` 와 `delegator_sub` 를 맞대어야 나오는데, 그 판정을 쓰는 자리가 셋이다
 *    (감사 기록 · 화면 글자 · 「자기 것이면 누구나」 울타리). 세 곳이 각자 번호를 견주면
 *    그중 하나가 뒤집히는 날이 오고, 뒤집혀도 오류는 나지 않는다.
 */
export type ResolvedDelegator = { name: string; sub: string; isSelf: boolean };

export type ResolveDelegatorResult =
  | { ok: true; delegator: ResolvedDelegator }
  | {
      ok: false;
      code: "DIRECTORY_UNREACHABLE" | "UNKNOWN_DELEGATOR" | "NO_SSO_SUBJECT" | "FORBIDDEN";
      message: string;
    };

/** 명부에서 못 찾은 결재권자. 🔵 대신할 분 쪽과 **같은 말투**다 — 「없는 사람」이 아니라 「지금 못 찾는다」. */
export const UNKNOWN_DELEGATOR_MESSAGE =
  "결재권자를 지금 A/S 명부에서 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 고르십시오.";

/**
 * 🔴 **남의 결재권을 맡기려 했는데 자격이 없다.** 화면에서는 관리자가 아니면 고르개를 아예
 * 그리지 않으므로, 이 문구가 보이는 것은 **손으로 만든 요청**이거나 보는 사이에 역할이 내려간
 * 경우뿐이다. 🔵 그래도 사람 말로 적는다 — 「알 수 없는 오류」로 뭉개면 그때 무슨 일이
 * 일어났는지 아무도 되짚지 못한다(CLAUDE.md 10절).
 */
export const DELEGATE_FOR_OTHERS_FORBIDDEN_MESSAGE =
  "남의 결재권은 관리자만 맡길 수 있습니다. 본인 결재권은 그대로 맡기실 수 있습니다.";

/**
 * 포털 번호가 없는 **결재권자**를 거절하는 문구. 🔴 대신할 분 쪽(`noSsoDelegateMessage`)과
 * 글자를 나눠 둔다 — 두 칸 중 **어느 쪽이 막혔는지**를 말해 주지 않으면 관리자는 멀쩡한
 * 대리인을 몇 번 바꿔 고르다 포기한다.
 */
export function noSsoDelegatorMessage(name: string): string {
  return `${name} 님은 아직 통합 로그인으로 들어온 적이 없어 그분의 결재권을 맡길 수 없습니다. 그 분이 통합 로그인으로 한 번 들어온 뒤에 다시 고르십시오.`;
}

/**
 * 화면이 보낸 **「누구의 결재권인가」**(A/S 사용자 id, 또는 `null` = 본인)를 풀어 **포털 번호와
 * 이름**을 얻고, 그 자리에서 **인가까지 가른다**.
 *
 * ── 🔴 2026-10-26: 「본인만」에서 「본인 또는 관리자」로 넓혔다 ──────────
 * 그 전에는 서버가 세션의 번호를 그대로 적었다. 자리를 갑자기 비우게 된 사람(병가·사고)은
 * **본인이 설정할 수 없다**는 것이 바뀐 까닭이다. 🔴 **좁히는 변경이 아니다** — 지금까지
 * 자기 결재권을 맡길 수 있던 사람은 역할과 무관하게 그대로 맡길 수 있다.
 *
 * ── 🔴 「본인인가」는 **포털 번호로** 가른다 ────────────────────────────
 * 화면이 보내는 것은 A/S 번호이고 세션이 아는 것은 포털 번호라, 번호를 풀기 **전에는 견줄
 * 수조차 없다.** 그래서 관리자가 고르개에서 **자기 이름을 골라도** 그 줄은 「본인 위임」이다 —
 * 비워 보낸 것과 같은 결과가 되어야 하고, 그 판정이 여기 한 곳에 있다.
 *
 * ── 🔵 자격을 **맨 마지막에** 묻는 까닭 ────────────────────────────────
 * 명부에서 풀기 → 번호 없음 → 자격 차례다. 자격을 먼저 물으면 관리자가 아닌 사람이 **자기
 * 번호를 골라 보냈을 때** 거절당한다 — 「본인 것이면 누구나」가 깨진다. 🔵 명부 자체는 이미
 * 로그인한 모두에게 내려가므로(대신할 분 고르개), 이 차례가 새로 흘리는 것은 없다.
 *
 * @param delegatorUserId 화면이 고른 **A/S 사용자 id**. `null` 이면 **본인**이다.
 * @param actor 지금 로그인한 사람의 이름과 **포털 번호**. 🔴 세션에서 꺼낸 값이어야 한다.
 * @param mayDelegateForOthers **남의 결재권까지 맡길 수 있는가.** 🔴 부르는 쪽
 *   (`./delegation-mutations.ts`)이 역할 사다리(`roleAtLeast(role, "ADMIN")`)로 셈해 넘긴다 —
 *   이 파일은 순수해야 해서 역할표를 끌어오지 않는다. 🔴 화면이 보낸 값을 여기 넘기지 마라.
 */
export function resolveDelegatorFromDirectory(
  directory: AsUserDirectory,
  delegatorUserId: string | null,
  actor: { name: string; sub: string },
  mayDelegateForOthers: boolean,
): ResolveDelegatorResult {
  // 비워 보낸 것 = 본인. 🔵 명부를 못 받아 왔어도 **본인 위임은 선다** — 이름도 번호도 세션에
  //    있고, 명부가 필요한 것은 대신할 분 쪽이다(그쪽이 따로 거절한다).
  if (delegatorUserId === null) {
    return { ok: true, delegator: { name: actor.name, sub: actor.sub, isSelf: true } };
  }

  if (directory.status !== "ok") {
    return { ok: false, code: "DIRECTORY_UNREACHABLE", message: DIRECTORY_UNREACHABLE_SAVE_MESSAGE };
  }

  const user = directory.users.find((candidate) => candidate.id === delegatorUserId);
  if (!user) return { ok: false, code: "UNKNOWN_DELEGATOR", message: UNKNOWN_DELEGATOR_MESSAGE };
  // 🔴 번호가 없으면 그 사람의 결재권이라는 것을 **가리킬 수가 없다** — 결재 판정의 열쇠가
  //    포털 번호이기 때문이다(`./directory.ts` 머리말). 세워 봐야 아무 일도 일어나지 않는다.
  if (user.ssoSubject === null) {
    return { ok: false, code: "NO_SSO_SUBJECT", message: noSsoDelegatorMessage(user.name) };
  }

  /**
   * 🔴 자기 번호를 골랐으면 **본인 위임**이다 — 자격을 묻지 않는다(머리말).
   * 🔵 이름은 **세션의 것**을 쓴다. 이 시스템에 로그인한 그 사람의 이름이고, 「그때 누구였나」를
   *    남기려고 사본으로 적는 칸이다(표 쪽 머리말). 명부와 갈리면 로그인한 쪽이 맞다.
   */
  if (user.ssoSubject === actor.sub) {
    return { ok: true, delegator: { name: actor.name, sub: actor.sub, isSelf: true } };
  }

  // 🔴 여기부터가 **넓힌 자리**다. 남의 결재권은 관리자만.
  if (!mayDelegateForOthers) {
    return { ok: false, code: "FORBIDDEN", message: DELEGATE_FOR_OTHERS_FORBIDDEN_MESSAGE };
  }
  return { ok: true, delegator: { name: user.name, sub: user.ssoSubject, isSelf: false } };
}

/* ------------------------------------------------------------------ */
/* 고른 사람을 명부에서 풀기                                              */
/* ------------------------------------------------------------------ */

/** 🔴 포털 번호까지 확인된 사람. 통과한 뒤에는 `null` 검사가 다시 나오지 않아야 한다. */
export type ResolvedDelegate = { id: string; name: string; sub: string };

export type ResolveDelegateResult =
  | { ok: true; delegate: ResolvedDelegate }
  | {
      ok: false;
      code: "DIRECTORY_UNREACHABLE" | "UNKNOWN_DELEGATE" | "NO_SSO_SUBJECT" | "SELF_DELEGATION";
      message: string;
    };

/**
 * 🔴 **자기 자신에게 맡기는 줄은 사람에게 말로 알려 준다.** DB CHECK
 * (`approval_delegations_not_self`)도 막지만 그 오류를 그대로 보이면 「알 수 없는 오류」가 된다.
 *
 * 🔴 **「결재권자 본인」이지 「누르는 사람」이 아니다**(2026-10-26). 관리자가 남의 결재권도
 * 맡길 수 있게 되면서, 막히는 것은 **A 의 결재권을 A 에게** 맡기는 뜻 없는 줄 하나뿐이다 —
 * 관리자가 **자기를 대리인으로** 세우는 것(A → 관리자)은 막지 않기로 했다(사용자 결정).
 * 그래서 문구에서 「자기 자신에게」라는 말을 걷었다: 관리자에게는 거짓말이 된다.
 */
export const SELF_DELEGATION_MESSAGE = "결재권자 본인을 대신할 분으로 고를 수는 없습니다. 다른 분을 고르십시오.";

/** 명부에서 사라진 사람. 🔵 「없는 사람」이 아니라 「지금 못 찾는다」로 말한다. */
export const UNKNOWN_DELEGATE_MESSAGE = "고르신 분을 지금 A/S 명부에서 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 고르십시오.";

/**
 * 포털 번호가 없는 사람을 거절하는 문구. 🔴 **누구인지와 고치는 길**을 함께 적는다 —
 * `./directory.ts` 의 `noSsoSubjectSaveMessage` 와 같은 판단이고, 거기 말투를 따른다.
 */
export function noSsoDelegateMessage(name: string): string {
  return `${name} 님은 아직 통합 로그인으로 들어온 적이 없어 결재권을 맡길 수 없습니다. 그 분이 통합 로그인으로 한 번 들어온 뒤에 다시 고르십시오.`;
}

/**
 * 화면이 보낸 **A/S 사용자 id** 를 명부에서 풀어 **포털 번호와 이름**을 얻는다.
 * (`./directory.ts` 의 `resolveApproversFromDirectory` 와 같은 자리·같은 판단이다.)
 *
 * ── 🔴 못 받아 왔으면 거절한다. 「한 명도 없다」로 바꾸지 않는다 ─────────
 * 확인할 수 없는 채로 위임을 세우면 번호 없는 사람이 대리인이 되어 **아무 일도 일어나지
 * 않는다**(그 사람이 로그인해도 우리가 알아볼 수 없다). 보는 화면에서 「모른다」로 적는 것과
 * 정반대의 판단인데, 여기서 하는 것은 **새 사실을 만드는 일**이기 때문이다.
 *
 * ── 🔴 「같은 사람인가」는 **포털 번호로** 가른다 ────────────────────────
 * 화면이 보내는 것은 A/S 번호이고 번호 열쇠는 포털 번호라, 번호를 풀기 **전에는 견줄 수조차
 * 없다.** 그래서 이 순서다(풀기 → 같은 사람 → 번호 없음이 아니라, 풀기 → 번호 없음 → 같은
 * 사람). 🔵 번호가 없는 사람은 애초에 결재권자일 수 없다 — 결재 판정의 열쇠가 그 번호다.
 *
 * @param delegatorSub **결재권자**의 포털 번호. 🔴 **화면이 보낸 값을 그대로 넘기지 마라** —
 *   `resolveDelegatorFromDirectory` 를 지나 **자격까지 확인된** 번호여야 한다. 그 함수를 건너
 *   뛰고 여기 날것을 넘기면 남의 결재권을 넘기는 요청이 오류 없이 통과한다.
 *   🔵 2026-10-26 전까지는 「= 지금 로그인한 사람」이었다. 관리자가 남의 결재권도 맡길 수 있게
 *   넓히면서 **둘이 갈렸고**, 그래서 아래 「자기 자신」 판정도 **누르는 사람이 아니라 결재권자**를
 *   기준으로 한다 — 관리자가 **자기를 대리인으로** 세우는 것은 막지 않기로 했다(사용자 결정).
 */
export function resolveDelegateFromDirectory(
  directory: AsUserDirectory,
  delegateUserId: string,
  delegatorSub: string,
): ResolveDelegateResult {
  if (directory.status !== "ok") {
    return { ok: false, code: "DIRECTORY_UNREACHABLE", message: DIRECTORY_UNREACHABLE_SAVE_MESSAGE };
  }

  const user = directory.users.find((candidate) => candidate.id === delegateUserId);
  if (!user) return { ok: false, code: "UNKNOWN_DELEGATE", message: UNKNOWN_DELEGATE_MESSAGE };
  // 🔴 번호가 없으면 위임이 **성립하지 않는다** — 화면이 고르지 못하게 잠가 두지만 화면 검사만 믿지 않는다.
  if (user.ssoSubject === null) {
    return { ok: false, code: "NO_SSO_SUBJECT", message: noSsoDelegateMessage(user.name) };
  }
  if (user.ssoSubject === delegatorSub) {
    return { ok: false, code: "SELF_DELEGATION", message: SELF_DELEGATION_MESSAGE };
  }

  return { ok: true, delegate: { id: user.id, name: user.name, sub: user.ssoSubject } };
}
