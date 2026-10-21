import { isActiveDelegation, type ApprovalDelegationPeriod } from "./delegation";

/**
 * ============================================================================
 * 결재권 위임 화면 — 순수 규칙 · 문구 · 화면이 받는 모양 (2026-10-21, 조각 3)
 * ============================================================================
 * 설정의 탭 「결재권 위임」(`/settings/delegations`, 2026-10-21 에 `/approvals` 에서 옮겨 옴)이
 * 그리는 구역(`src/components/approval/DelegationSection.tsx`)이 쓰는 **판정과 글자**를 여기 모은다.
 * 까닭은 `./part-issue-screen.ts` 머리말 그대로다:
 *
 *  1. 🔴 **이 저장소에는 화면 렌더 시험이 없다.** 화면 안에 적은 규칙은 아무도 돌려 보지 못한
 *     채 운영으로 나간다. 그래서 「지금 살아 있나」·「상자 색과 글자」·「0건일 때 뭐라고 하나」를
 *     여기 내려 두고 `tests/approval-delegation-screen.test.ts` 가 돌려 본다.
 *  2. 🔴 **서버/클라이언트 경계**: 이 파일은 `server-only` 를 직접도 타입으로도 끌어오지 않는다.
 *
 * ── 🔴 화면으로 내려가는 모양에는 **포털 번호가 없다** ──────────────────
 * 위임 한 줄에서 사람이 봐야 하는 것은 **이름과 기간**이지 번호가 아니다. 번호는 신원을
 * 가리키는 값이라 서버에서 끝낸다(`./part-issue-screen.ts` 와 같은 규약) — 아래 어느 타입에도
 * 번호를 담을 칸이 없다. 칸이 없으면 다음 사람이 실어 보낼 수도 없다.
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/* 지금 이 줄은 어디쯤인가                                                */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **넷이다.** 「살아 있음 / 끝남 / 되돌림」 셋만 두면 **아직 시작하지 않은 위임**이 갈 곳이
 * 없어 「끝남」으로 그려진다 — 다음 주 출장을 미리 적어 둔 사람에게 **거짓말**이고, 그때 사람은
 * 자기가 잘못 적은 줄 알고 같은 줄을 또 만든다.
 */
export type DelegationState = "SCHEDULED" | "ACTIVE" | "ENDED" | "REVOKED";

/** 🔴 색과 **짝인 글자**. 색만 보고 상태를 가르지 않게 화면은 언제나 둘을 함께 그린다(CLAUDE.md 9-7절). */
export const DELEGATION_STATE_LABELS: Record<DelegationState, string> = {
  SCHEDULED: "시작 전",
  ACTIVE: "맡기는 중",
  ENDED: "끝남",
  REVOKED: "되돌림",
};

/**
 * 🔵 색 계열은 결재건 배지(`./part-issue-screen.ts` 의 `PART_ISSUE_STATUS_BADGE`)와 맞춘다 —
 *    **같은 화면에 나란히 뜨므로** 주황은 기다리는 것, 파랑은 지금 도는 것, 회색은 끝난 것이다.
 */
export const DELEGATION_STATE_BADGE: Record<DelegationState, string> = {
  SCHEDULED: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-blue-100 text-blue-800",
  ENDED: "bg-zinc-100 text-zinc-500",
  REVOKED: "bg-zinc-100 text-zinc-500",
};

/** 배지의 글자와 색을 **한 번에** 고른다 — 따로 고르면 「되돌림인데 파랑」 같은 짝이 생긴다. */
export function delegationStateBadge(state: DelegationState): { label: string; className: string } {
  return { label: DELEGATION_STATE_LABELS[state], className: DELEGATION_STATE_BADGE[state] };
}

/**
 * 이 줄이 지금 어느 상태인가.
 *
 * 🔴 **되돌림이 먼저다.** 되돌리기는 기간을 줄여 적는 것이 아니라 깃발을 하나 세우는 것이라
 * (표 쪽 머리말), 기간부터 보면 되돌린 줄이 기간 안에서 「맡기는 중」으로 보인다.
 * 🔴 **「살아 있나」는 새로 적지 않는다** — 결재 판정 넷이 보는 바로 그 함수(`isActiveDelegation`)에
 * 묻는다. 여기 한 줄을 손으로 베껴 적으면 화면은 「맡기는 중」인데 눌러 보면 안 되는 날이 온다.
 */
export function delegationState(period: ApprovalDelegationPeriod, now: Date): DelegationState {
  if (period.revokedAt !== null) return "REVOKED";
  if (isActiveDelegation(period, now)) return "ACTIVE";
  return now.getTime() < period.startsAt.getTime() ? "SCHEDULED" : "ENDED";
}

/**
 * **되돌릴 수 있는가** — 🔵 울타리가 아니라 「[되돌리기]를 그릴까」다. 막는 자리는
 * `revokeApprovalDelegation` 의 조건절이고, 거기에는 **본인 것만**이 함께 걸려 있다.
 *
 * 🔵 **시작 전인 줄도 되돌릴 수 있다.** 미리 적어 둔 출장이 취소되는 일은 실제로 있고, 그때
 *    되돌릴 길이 없으면 그 기간이 올 때까지 남의 손에 결재권이 걸려 있게 된다.
 * 🔴 **이미 끝난 줄은 되돌리지 않는다.** 되돌릴 것이 없고, 지난 기간의 위임은 「그때 왜 저 사람이
 *    눌렀나」의 근거라 손대면 안 된다.
 */
export function canRevokeDelegation(state: DelegationState): boolean {
  return state === "ACTIVE" || state === "SCHEDULED";
}

/* ------------------------------------------------------------------ */
/* 화면이 받는 모양                                                      */
/* ------------------------------------------------------------------ */

/**
 * 위임 한 줄. 🔴 **포털 번호도 A/S 번호도 담지 않는다**(머리말).
 *
 * 🔵 **「상대방」 한 칸이다** — 「내가 맡긴 것」에서는 대신할 사람, 「내가 대신하고 있는 것」에서는
 *    결재권자다. 두 칸을 두고 한쪽만 채우면 그리는 쪽이 매번 어느 칸인지 고르게 되고, 그 선택이
 *    한 번 틀리면 **누가 누구에게 맡겼는지가 뒤집혀 보인다.**
 */
export type DelegationRowView = {
  id: string;
  /** 상대방 이름 — **그때 적어 둔 사본**이다(정본은 A/S). */
  counterpartName: string;
  /** 사람이 적은 그대로의 시작일 `YYYY-MM-DD`. */
  startDate: string;
  /** 🔴 사람이 적은 **종료일**이다 — 표의 `ends_at`(다음 날 0시)이 아니다(`./delegation-input.ts`). */
  endDate: string;
  /** 🔵 비어 있을 수 있다. 비면 화면은 **그 줄을 그리지 않는다**(「없음」을 지어내지 않는다). */
  reason: string;
  state: DelegationState;
  /** 되돌린 사람의 이름. 되돌리기 전에는 `null`. */
  revokedByName: string | null;
  /** 🔵 서버 판정(`canRevokeDelegation`). 울타리가 아니라 「그릴까」다. */
  canRevoke: boolean;
};

/** 기간 한 줄 — 「2026-10-20 ~ 2026-10-25」. 🔵 하루짜리는 날짜 하나로 적는다(둘이 같으면 눈에 거슬린다). */
export function formatDelegationPeriod(startDate: string, endDate: string): string {
  return startDate === endDate ? `${startDate} 하루` : `${startDate} ~ ${endDate}`;
}

/* ------------------------------------------------------------------ */
/* 0건일 때 하는 말                                                      */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **묶음을 감추지 않는다.** 「지금 맡긴 것이 없다」와 「이 기능이 나와 상관없다」는 다른 말이고,
 * 감추면 사람은 둘을 구분하지 못한다(`./part-issue-screen.ts` 의 같은 규칙).
 */
export const DELEGATION_NOTHING_I_MADE = "맡겨 둔 결재권이 없습니다.";

/**
 * 🔴 이 묶음이 **없으면 대리인은 「왜 이 건이 내 결재 목록에 떴는지」를 알 수 없다.** 0건일 때도
 * 그렇게 말해 두어야, 남의 건이 떴을 때 여기를 보면 답이 있다는 것을 알게 된다.
 */
export const DELEGATION_NOTHING_ACTING = "지금 대신하고 있는 결재권이 없습니다.";

/** A/S 명부를 못 받아 왔을 때 덧붙이는 말. 🔴 「한 명도 없습니다」라고 말하지 않는다. */
export const DELEGATION_DIRECTORY_UNREACHABLE_SUFFIX = "지금은 새로 맡길 수 없습니다. 아래 목록은 저장된 내용 그대로입니다.";

/* ------------------------------------------------------------------ */
/* 단추를 누르고 돌아왔을 때의 한 줄                                      */
/* ------------------------------------------------------------------ */

/**
 * 🔵 모양은 `./part-issue-screen.ts` 의 `PartIssueNotice` 와 **같은 자리**다(한 화면의 같은 줄에
 *    뜬다). 톤이 `info` 하나뿐이라 타입을 따로 둔다 — 쓰지 않는 `warn` 을 받아 두면 화면이
 *    그리지도 않을 색 분기를 들고 있게 된다.
 */
export type DelegationNotice = { text: string };

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): boolean => v === "1";

/**
 * 맡기기·되돌리기가 **성공한 뒤** 돌아온 자리에서 할 한 줄. 꼬리표가 없으면 `null`.
 *
 * 🔵 **실패는 여기로 오지 않는다** — 실패는 서버 액션이 돌려주는 문구를 그 자리에 그대로 보여
 *    준다(`partIssueNotice` 와 같은 규약).
 */
export function delegationNotice(sp: Params): DelegationNotice | null {
  if (one(sp.delegated)) {
    return { text: "결재권을 맡겼습니다. 그 기간에는 그분도 내 차례를 대신 누를 수 있습니다 — 내가 직접 누르는 길은 그대로 열려 있습니다." };
  }
  if (one(sp.delegationRevoked)) {
    return { text: "위임을 되돌렸습니다. 이제 그분은 내 차례를 누를 수 없습니다 — 지난 기간에 그분이 누른 건은 그대로 남습니다." };
  }
  return null;
}
