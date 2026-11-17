import type { PartIssueApprovalHistoryRow, PartIssueHistoryRole } from "@/lib/approval/part-issue-history";
import { PART_ISSUE_APPROVAL_KIND } from "./portal-approvals";

/**
 * ============================================================================
 * 「이 사람이 이 기간에 한 결재」를 통합 승인함에 내줄 때의 모양 — 라우트가 아니라 여기에 둔다
 * ============================================================================
 * 통합 승인함(`dss-approvals`)이 사내 시스템 **셋**(A/S · 재고관리 · 휴가)에 같은 질문을
 * 던져 한 창에 모은다. 그래서 이 파일의 모양은 이 집의 사정이 아니라 **세 집이 글자
 * 그대로 맞춘 계약**이다 — 칸 이름 하나만 달라도 **그 집 것만 조용히 안 그려진다**(오류가
 * 아니라 빈 자리로 보인다).
 *
 * 틀은 옆의 `portal-approvals.ts`(「이 사람이 결재할 건」)를 그대로 따른다:
 *  · 판단은 전부 여기 있고 라우트에는 「토큰 꺼내 검증하고 이 함수 부르기」만 남는다.
 *  · DB 를 여기서 부르지 않고 **인자로 받는다** — 망도 DB 도 없이 그대로 시험할 수 있다.
 *  · 계정을 못 찾은 사람은 **빈 목록**이다(오류가 아니다. 아래 `buildPortalApprovalHistory`).
 *
 * ── 🔴 이 집의 갈래 이름 하나가 계약과 다르다 ──────────────────────────────
 * 이 집의 `PartIssueHistoryRole` 은 넷째 값을 **`UNRECORDED`** 라 부르고 계약은
 * **`UNKNOWN`** 이다. 안쪽 이름을 바꾸지 않았다 — 「기록이 없다」가 이 집에서는 더 정확한
 * 말이고(`decided_by_sub` 칸이 생긴 2026-10-21 이전 줄), 「모른다」는 **승인함이 세 집의
 * 말을 하나로 묶으려고** 고른 말이기 때문이다.
 * 🔴 그래서 **바꿔 적는 자리가 하나 생겼다**(`portalApprovalHistoryRelation`). 그 자리는
 * 어긋나도 오류가 나지 않는다 — 「내가 한 결재」가 「남이 대신한 것」으로 보이는 식으로
 * **조용히 틀린다.** 네 값이 각각 무엇으로 나가는지는 시험으로 못 박아 두었다
 * (tests/portal-approval-history.test.ts).
 *
 * ── 🔴 「누구의 내역인가」는 토큰에서만 온다 ────────────────────────────────
 * 기간 두 값은 쿼리에서 받지만 **사람은 받지 않는다.** 받는 순간 토큰 하나로 아무의 결재
 * 내역이나 보는 문이 된다(옆 통로들의 같은 울타리). 이 함수 묶음에는 애초에 사람을 넣을
 * 자리가 `subject`(= 토큰의 sub) 하나뿐이다.
 * ============================================================================
 */

/** 세 집이 함께 쓰는 갈래 값. 🔴 이 집 안쪽 이름(`UNRECORDED`)과 **일부러** 다르다(머리말). */
export type PortalApprovalHistoryRelation =
  /** 내가 내 자리를 눌렀다. */
  | "SELF"
  /** 내가 **남을 대신해** 눌렀다 — 상대는 그 자리의 주인. */
  | "ON_BEHALF"
  /** **내 자리를 남이** 눌렀다 — 상대는 누른 사람. */
  | "BY_DELEGATE"
  /** 누가 눌렀는지 **어디에도 안 적힌 옛 줄**. 상대는 없다. */
  | "UNKNOWN";

/**
 * 승인·반려 둘뿐이다. 🔴 이 집의 `PartIssueDecidedStepStatus` 를 그대로 쓰지 않고 **따로
 * 적는다** — 같은 글자지만 한쪽은 이 집 표의 상태값이고 이쪽은 세 집의 약속이다. 이 집이
 * 뒷날 상태 이름을 바꾸면 아래 `toPortalApprovalHistoryEntry` 의 대입에서 **tsc 가 먼저
 * 멈춘다**(그 자리가 계약이 깨지는 자리다).
 */
export type PortalApprovalHistoryDecision = "APPROVED" | "REJECTED";

/** 승인함에 서는 결재 내역 한 줄. 🔴 **이 모양이 세 집의 계약이다** — 칸 이름을 바꾸지 않는다. */
export type PortalApprovalHistoryEntry = {
  /**
   * 이 집 안에서 **유일**한 값.
   *
   * 🔴 **결재건 번호만으로는 모자란다.** 한 사람이 **같은 결재건에 두 줄**을 가질 수 있다 —
   * 1단계는 제 자리로 직접 누르고 3단계는 제 자리를 대리인이 눌러 준 식이다(결재선이 같은
   * 사람을 두 단계에 넣는 것을 막지 않는다. `part-issue-history.ts` 의 같은 주의). 그래서
   * 단계 번호까지 붙인다 — 빼면 승인함의 목록에서 **두 줄 중 하나가 사라진다.**
   */
  id: string;
  /** 사람이 알아보는 글자 — 무엇을 내주는 결재였나(반출 신청의 요약). */
  subject: string;
  /** 무슨 결재인가 — 이 집의 불출 결재 갈래 이름표(부품 불출 · 매쳐 · 제너레이터). */
  approvalName: string;
  /** 언제 눌렸나. ISO 8601. */
  decidedAt: string;
  /** 승인인가 반려인가. */
  decision: PortalApprovalHistoryDecision;
  /** 🔴 뜻은 **보는 사람 기준**이다(위 타입). */
  relation: PortalApprovalHistoryRelation;
  /**
   * 상대 사람 이름. 🔵 `relation` 에 따라 **가리키는 사람이 다르다** — `ON_BEHALF` 면 내가
   * 대신해 준 자리의 주인, `BY_DELEGATE` 면 내 자리를 눌러 준 사람. 나머지 둘은 `null` 이고,
   * `BY_DELEGATE` 인데 이름이 안 적힌 옛 줄도 `null` 이다(지어내지 않는다).
   */
  counterpartName: string | null;
  /** 🔴 **절대 주소** — 승인함은 다른 사이트라 상대 주소를 받으면 제 주소로 읽는다. */
  href: string;
};

/** 통로가 돌려주는 모양 전부. 🔴 칸이 `entries` 하나다 — 세는 수도 쪽도 계약에 없다. */
export type PortalApprovalHistory = { entries: PortalApprovalHistoryEntry[] };

/** 기간. 🔴 **반열린 구간** `[from, to)` 다 — 끝 시각은 들어가지 않는다(아래 파싱 함수). */
export type ApprovalHistoryPeriod = { from: Date; to: Date };

/** 계정을 못 찾았을 때의 답. 🔴 오류가 아니다 — 포털은 세 집에 같은 질문을 던진다. */
const EMPTY_HISTORY: PortalApprovalHistory = { entries: [] };

/**
 * 한 번에 내주는 줄 수의 상한.
 *
 * 🔵 조회(`listPartIssueApprovalHistoryFor`)는 상한을 스스로 정하지 않고 부르는 쪽에 맡겼다 —
 * 그 자리가 여기다. 이 집의 불출 결재는 한 사람이 한 달에 수십 건이라 500 이면 기간을 한 해로
 * 잡아도 남는다. 🔴 **넘치면 조용히 잘린다**(계약에 「더 있다」를 말할 칸이 없다) — 그래서
 * 세는 수가 아니라 **넉넉한 상한**으로 두었고, 잘릴 만큼 쌓이는 날에는 계약부터 고쳐야 한다.
 */
export const PORTAL_APPROVAL_HISTORY_LIMIT = 500;

/**
 * 결재건 번호 + 단계 번호 → 승인함 열쇠. 🔴 같은 단계에는 **언제나 같은 값**이 나온다.
 *
 * 🔵 앞머리는 「결재할 건」의 열쇠(`portalApprovalItemId`)와 같은 글자를 쓰되 마디가 하나 더
 *    붙으므로 둘이 부딪히지 않는다.
 */
export function portalApprovalHistoryItemId(approvalId: string, stepOrder: number): string {
  return `${PART_ISSUE_APPROVAL_KIND}:${approvalId}:${stepOrder}`;
}

/**
 * 🔴 **이 집의 갈래를 계약의 글자로 바꾸는 유일한 자리다**(머리말의 `UNRECORDED` ↔ `UNKNOWN`).
 *
 * 🔴 **상대가 누구인지도 여기서 갈린다.** `ON_BEHALF` 의 상대는 **자리 주인**이고
 * `BY_DELEGATE` 의 상대는 **누른 사람**이다 — 거꾸로 붙이면 승인함이 「내가 나를 대신했다」
 * 같은 줄을 그리고, 그래도 오류는 나지 않는다.
 *
 * 🔵 `switch` 로 적는 것은 갈래가 느는 날 **tsc 가 여기서 멈추게** 하려는 것이다. `else` 로
 *    뭉개면 새 갈래가 조용히 `UNKNOWN` 으로 나간다.
 */
export function portalApprovalHistoryRelation(role: PartIssueHistoryRole): {
  relation: PortalApprovalHistoryRelation;
  counterpartName: string | null;
} {
  switch (role.kind) {
    case "SELF":
      return { relation: "SELF", counterpartName: null };
    case "ON_BEHALF":
      // 내가 **누구를** 대신했나 = 그 자리의 주인.
      return { relation: "ON_BEHALF", counterpartName: role.approverName };
    case "BY_DELEGATE":
      // 내 자리를 **누가** 눌렀나. 🔵 번호만 있고 이름이 안 적힌 줄은 `null` 그대로 간다.
      return { relation: "BY_DELEGATE", counterpartName: role.delegateName };
    case "UNRECORDED":
      // 🔴 여기가 이름이 갈리는 그 자리다(머리말). 「본인」으로도 「대리」로도 접지 않는다.
      return { relation: "UNKNOWN", counterpartName: null };
  }
}

/**
 * 조회 한 줄 → 승인함 한 줄.
 *
 * 🔴 **갈래를 여기서 다시 가르지 않는다** — 받은 `role` 을 글자만 바꿔 옮긴다. 두 벌이 되면
 * 「결재 내역」과 이 집 화면이 같은 줄을 다르게 말한다.
 * 🔴 **주소도 짓지 않는다** — 조회가 이미 `partIssueApprovalHref` 를 지나 절대 주소로 실어 온다.
 */
export function toPortalApprovalHistoryEntry(row: PartIssueApprovalHistoryRow): PortalApprovalHistoryEntry {
  const { relation, counterpartName } = portalApprovalHistoryRelation(row.role);
  return {
    id: portalApprovalHistoryItemId(row.approvalId, row.stepOrder),
    // 반출 신청의 요약 글자 그대로다 — 「결재할 건」의 `subject` 와 같은 값(portal-approvals.ts).
    subject: row.summary,
    // 🔵 이름표가 적힌 곳은 `approval/route.ts` 하나다 — 조회가 `partIssueScopeLabel` 로 이미 풀었다.
    approvalName: row.scopeLabel,
    decidedAt: row.decidedAt,
    decision: row.decision,
    relation,
    counterpartName,
    href: row.href,
  };
}

/**
 * 쿼리로 받은 글자 둘 → 기간. 🔴 **못 읽으면 `ok: false` 다** — 부르는 쪽이 400 으로 답한다.
 *
 * ── 🔴 반열린 구간 `[from, to)` ────────────────────────────────────────────
 * 여기서는 글자를 시각으로 바꾸기만 하고 **경계를 손대지 않는다**(1ms 를 더하거나 빼지
 * 않는다). 끝을 빼는 일은 조회의 `lt(decidedAt, to)` 가 한다 — 보정을 여기서도 하면 두 벌이
 * 되어 한쪽만 고쳐지는 날 **경계 시각의 결재가 양쪽 기간에 모두** 뜬다(위임 기간을 잇대어
 * 적었을 때 「누구의 권한으로 눌렀나」가 둘이 되는 자리).
 *
 * ── 🔴 **시간대가 붙은 ISO 8601 만 받는다**(세 집이 같은 글자로 맞춘 규칙) ──
 * `Date` 에 그냥 넘기면 **어느 순간인지가 정해지지 않은 글자**가 통과한다. 그런 글자는
 * 오류를 내지 않고 **읽는 기계의 지역 시간**으로 해석되므로, 같은 요청이 개발 PC(KST)와
 * NAS 컨테이너(UTC)에서 **아홉 시간** 다른 기간이 된다. 증상은 「월말 하루치가 안 보인다」
 * 하나뿐이라 아무도 원인을 못 찾는다. 걸러야 할 꼴 넷(전부 실측):
 *  · `"2026-11-01T00:00:00"` — T 까지 붙어 가장 그럴듯한데 **시간대가 없다.** 지역 시간으로 읽힌다.
 *  · `"2026-11-01"` — **날짜만**. UTC 자정으로 읽혀 한국 시간 11월 1일 **오전 9시**가 되고,
 *    「11월」을 물었는데 첫날 아홉 시간이 조용히 빠진다.
 *  · `"0"` — `NaN` 이 아니다. 이 PC 실측으로 `1999-12-31T15:00:00Z`(= 한국 시간 2000-01-01).
 *  · `"2026"` — 2026-01-01 로 읽힌다.
 * 뒤 둘은 숫자 하나가 **26년치 기간**으로 둔갑하는 자리다 — 오류도 안 나고 목록도 안 빈다.
 *
 * 🔵 **좁히는 쪽이 위험하지 않은가**(좁게 받는 집만 400 을 내면 그 집 것만 승인함에서 빠진다):
 * 그래서 규칙을 이 집이 혼자 정하지 않았다. **세 집이 같은 정규식을 쓴다**(2026-11-17, 휴가
 * 집에서 먼저 적고 A/S·재고관리가 그대로 베꼈다). 포털이 보낼 값(`toISOString()` 꼴 ·
 * `+09:00` 꼴 · 초·밀리초를 줄인 꼴)은 전부 통과한다.
 * 🔵 모양을 지나도 **한 번 더** 거른다 — `"2026-13-99T00:00:00Z"` 는 모양이 맞고 `NaN` 이다.
 *
 * ── 🔵 뒤집힌 기간(`from >= to`)은 거절하지 않는다 ────────────────────────
 * 「읽을 수 없는 값」이 아니라 **아무것도 안 걸리는 값**이다. 조회가 자연히 빈 목록을 내주므로
 * 여기서 따로 막지 않는다 — 막으면 계약에 없는 400 이 이 집에서만 난다.
 */
export function parseApprovalHistoryPeriod(input: { from: string | null; to: string | null }): { ok: true; period: ApprovalHistoryPeriod } | { ok: false } {
  const from = parseInstant(input.from);
  const to = parseInstant(input.to);
  if (from === null || to === null) return { ok: false };
  return { ok: true, period: { from, to } };
}

/**
 * 🔴 **시간대가 반드시 붙은 ISO 8601.** 세 집이 **글자 그대로 같은 정규식**을 쓴다 — 고칠 때는
 * 셋을 함께. 끝의 `Z` 나 `+09:00` 이 없으면 통과시키지 않는 것이 이 규칙의 전부다(위 함수의
 * 까닭). 초와 밀리초는 없어도 된다.
 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** 글자 하나 → 시각. 없거나 못 읽으면 `null`. */
function parseInstant(value: string | null): Date | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!ISO_WITH_ZONE.test(trimmed)) return null;
  const date = new Date(trimmed);
  // 🔵 모양이 맞아도 없는 날일 수 있다(`2026-13-99T00:00:00Z`).
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 「이 사람이 이 기간에 한 결재」 전부.
 *
 * 🔴 대상 사람은 **`subject` 하나로만** 정해진다 — 토큰이 실어 온 값이고, 라우트는 쿼리에서
 * 기간 둘만 읽는다. 부르는 쪽이 남의 번호를 끼워 넣을 자리가 이 함수 안에 없다.
 *
 * 🔴 이 집에 계정이 없는 사람은 **빈 목록**이다. 오류가 아니다 — 포털은 세 집에 같은 질문을
 * 던지고, 한 집이 오류를 뱉으면 **나머지 둘까지 못 그릴 수 있다.** 재고 관리는 「지정된
 * 사람만」 들어오므로 여기에만 계정이 없는 사람이 흔하다(notifications/route.ts 와 같은 판단).
 *
 * 🔵 **열쇠를 바꾸지 않는다.** 이 집의 `users.auth_sub` 가 포털 `sub` 그대로라 변환이 없다
 *    (A/S 는 다르다). 그래도 토큰의 값이 아니라 **되짚은 DB 의 값**(`actor.authSub`)을 넘기는
 *    것은 옆 통로들과 같은 관례다 — 방금 그 번호로 찾아낸 바로 그 줄이다.
 */
export async function buildPortalApprovalHistory(params: {
  subject: string;
  period: ApprovalHistoryPeriod;
  baseUrl: string;
  limit: number;
  findActor: (authSub: string) => Promise<{ authSub: string } | null>;
  listHistory: (args: { sub: string; from: Date; to: Date; baseUrl: string; limit: number }) => Promise<{ rows: readonly PartIssueApprovalHistoryRow[] }>;
}): Promise<PortalApprovalHistory> {
  const actor = await params.findActor(params.subject);
  if (!actor) return EMPTY_HISTORY;

  const { rows } = await params.listHistory({
    sub: actor.authSub,
    // 🔴 받은 경계를 **그대로** 넘긴다(위 파싱 함수의 까닭).
    from: params.period.from,
    to: params.period.to,
    baseUrl: params.baseUrl,
    limit: params.limit,
  });
  return { entries: rows.map(toPortalApprovalHistoryEntry) };
}
