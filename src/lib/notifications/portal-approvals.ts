import type { PartIssueView } from "@/lib/approval/part-issue-rules";
import { ENTRY_TYPE_LABEL } from "@/lib/stock/codes";

/**
 * ============================================================================
 * 통합 승인함(`dss-approvals`)이 물어 올 때의 판단 — 라우트가 아니라 여기에 둔다
 * ============================================================================
 * 통합 승인함은 사내 시스템마다 「내가 결재할 건」을 **건별로** 물어 한 창에 모은다.
 * [승인하기] 는 그 신청의 화면으로 건너가기만 하고 승인·반려는 거기서 한다
 * (2026-10-23 사용자 결정) — 그래서 이 통로는 **읽기 전용**이고, 이 파일에도 쓰는
 * 함수가 하나도 없다.
 *
 * 응답 모양(id · kind · kindLabel · subject · detail · requestedAt · href)은
 * A/S(`RF_Service_System`)가 먼저 정한 세 시스템 공통 계약을 그대로 따른다 — 칸
 * 이름을 바꾸면 세 시스템을 함께 고쳐야 한다.
 *
 * ── 🔴 왜 통합 알림 통로(bell-items.ts)로 안 되는가 ──────────────────────────
 * 그 통로는 **종**을 위한 것이라 「결재할 불출 신청 N건」처럼 여러 건을 **한 줄로
 * 묶는다**(결재가 밀릴수록 종이 그 줄로만 가득 차는 것을 막으려는 설계 — 그 파일의
 * ⓪ 주석). 승인함은 **한 줄 = 한 결재 = 한 [승인하기]** 여야 해서 건별로 펼칠 자료가
 * 따로 필요하다. 그래서 종의 묶음을 바꾸지 않고 전용 통로를 따로 낸다.
 *
 * ── 🔴 `kindLabel` 이 이 시스템 화면의 말과 다른 까닭 ─────────────────────────
 * 이 화면 안에서는 그냥 「승인 요청건」·「내가 결재할 건」이지만, 승인함의 한 줄은
 * **다른 시스템의 줄과 섞여 서므로** 「무엇에 대한 결재인가」가 이름에 들어가야
 * 한다(2026-10-23 쓰는 분 결정 — A/S 의 `PORTAL_APPROVAL_KIND_LABELS` 주석과 같은
 * 까닭). 그래서 「부품 불출 결재」로 **일부러** 다르게 적는다. 한쪽을 고칠 때 다른
 * 쪽을 따라 고치지 마라 — 서로 다른 자리에서 쓰이는 서로 다른 이름이다.
 *
 * ── href: 그 결재 하나로 가는 주소 ────────────────────────────────────────────
 * 이 시스템에는 결재건별 상세 화면이 없다 — `/approvals` 한 장에 「내가 결재할
 * 건」·「실행할 건」·「진행 중인 내 신청」을 함께 나열한다. 새 화면을 만들지 않고,
 * 결재 카드마다 `id="approval-{결재건 id}"` 를 **더해**(components/stock/
 * IssueApprovalScreen.tsx) URL 조각(`#approval-{id}`)으로 그 카드까지 바로
 * 스크롤되게 한다 — dss-leave 가 같은 사정(건별 화면 없음)에서 쓴 방법 그대로다.
 * 지금 가능한 것 중 가장 좁은 주소다.
 *
 * ── 자격 판정을 새로 짓지 않는다 ────────────────────────────────────────────
 * 「이 사람이 지금 이 건을 결재할 차례인가」는 **한 줄도 여기 적지 않는다.**
 * `approval/part-issue.ts` 의 `listPartIssueApprovalsToDecide` 를 인자로 받아
 * 그대로 부른다 — 그 조회가 결재권 위임(대신할 수 있는 사람의 차례까지)을 이미
 * 가르고, `/approvals` 화면의 「내가 결재할 건」과 **같은 조회**다. 판정이 두 벌이
 * 되면 한쪽만 고쳐지는 날이 오고, 그것은 권한 구멍이다.
 *
 * DB 를 여기서 부르지 않고 인자로 받는 것은 이 시스템 종의 queries.ts 와 같은
 * 까닭이다: 판단을 DB 없이 그대로 시험할 수 있고, 라우트에는 「토큰 꺼내 검증하고
 * 이 함수 부르기」만 남는다.
 * ============================================================================
 */

/** 이 시스템이 내주는 결재의 갈래. 지금은 하나뿐이다. */
export const PART_ISSUE_APPROVAL_KIND = "PART_ISSUE_APPROVAL";

/**
 * 사람이 읽는 갈래 이름. 🔴 **이 시스템 화면의 이름표와 일부러 다르다**(위 머리말 참조).
 */
export const PART_ISSUE_APPROVAL_KIND_LABEL = "부품 불출 결재";

/** 승인함에 서는 한 줄. 🔴 **이 모양이 세 시스템의 계약이다** — 칸 이름을 바꾸지 않는다. */
export type PortalApprovalItem = {
  /**
   * 이 시스템 안에서 이 결재건을 가리키는 값 — 통합함이 목록의 열쇠로 쓴다.
   * `PART_ISSUE_APPROVAL:{결재건 id}` 모양이라 다시 물어도 같다(결재건 id 는 불변).
   *
   * 🔵 종 알림(bell-items.ts)은 여러 건을 한 줄로 묶어 내는 터라 건별 열쇠가 없다 —
   * 그래서 여기서 새로 짓는다. 묶음 줄의 고정 id(`ISSUE_APPROVALS_TO_DECIDE`)와
   * 부딪히지 않는다.
   */
  id: string;
  /** 기계가 읽는 갈래. */
  kind: string;
  /** 사람이 읽는 갈래 이름(위 상수). */
  kindLabel: string;
  /** 한 줄 제목 — 무엇을 내주는 결재인가(반출 신청의 요약 글자). */
  subject: string;
  /** 한 줄 보탬 — 신청 종류 · 결재를 올린 사람. */
  detail: string;
  /** ISO 8601. 이 결재건이 올라온 때. */
  requestedAt: string;
  /** 🔴 절대 주소 — 결재 화면의 그 카드까지 스크롤된다. */
  href: string;
};

export type PortalApprovalInbox = {
  items: PortalApprovalItem[];
  /**
   * 배지에 찍을 숫자. 🔴 `items.length` 다 — 종의 셈(묶음 한 줄 = 1)과 다르다.
   * 승인함은 한 줄이 한 번의 [승인하기]이므로 줄 수 그대로가 뜻이 맞다.
   */
  count: number;
};

/** 계정을 못 찾았을 때의 답. 🔴 오류가 아니다 — 포털은 여러 시스템에 같은 질문을 던진다. */
const EMPTY_INBOX: PortalApprovalInbox = { items: [], count: 0 };

/** 결재함 화면 — 카드마다 달린 조각(#approval-{id})으로 간다(위 머리말의 href 절). */
const APPROVALS_PATH = "/approvals";

/** 결재건 id → 승인함 열쇠. 🔴 같은 결재건에는 **언제나 같은 값**이 나온다. */
export function portalApprovalItemId(approvalId: string): string {
  return `${PART_ISSUE_APPROVAL_KIND}:${approvalId}`;
}

/**
 * 절대 주소인지 보고 끝의 슬래시를 떼어 낸다. bell-items.ts 의
 * `requireAbsoluteBaseUrl` 과 같은 규칙이다(그 파일 주석 참조) — 이 통로도 포털을
 * 거쳐 **다른 시스템의 종**에 실릴 수 있는 값이라 상대경로를 조용히 내보내지 않는다.
 */
function requireAbsoluteBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+(\/\S*)?$/.test(trimmed)) {
    throw new Error(`승인함 주소의 앞머리(baseUrl)는 http(s):// 로 시작하는 절대 주소여야 합니다(받은 값: ${baseUrl}).`);
  }
  return trimmed;
}

/**
 * 결재건 한 줄(`listPartIssueApprovalsToDecide` 가 돌려주는 모양) → 승인함 한 줄.
 *
 * 🔴 **「결재할 차례인가」를 여기서 다시 판정하지 않는다** — 받은 줄을 그대로 옮겨
 * 적을 뿐이다.
 */
export function toPortalApprovalItem(row: PartIssueView, baseUrl: string): PortalApprovalItem {
  const base = requireAbsoluteBaseUrl(baseUrl);
  return {
    id: portalApprovalItemId(row.id),
    kind: PART_ISSUE_APPROVAL_KIND,
    kindLabel: PART_ISSUE_APPROVAL_KIND_LABEL,
    // 반출 신청의 요약 글자 그대로다 — 화면의 결재 카드 머리글과 같은 값(IssueApprovalScreen.tsx).
    subject: row.requestSummary,
    detail: `${ENTRY_TYPE_LABEL[row.requestType]} · 결재 올린 사람 ${row.requestedByName}`,
    requestedAt: row.requestedAt,
    href: `${base}${APPROVALS_PATH}#approval-${row.id}`,
  };
}

/**
 * 「이 사람이 지금 결재해야 할 불출 신청」 전부.
 *
 * 🔴 대상 사람은 **`subject` 하나로만** 정해진다 — 토큰이 실어 온 값이고, 라우트는
 * 쿼리 문자열을 읽지 않는다. 되짚은 이 시스템 계정의 포털 번호(`authSub`)로만
 * 조회를 부르므로, 부르는 쪽이 남의 번호를 끼워 넣을 자리가 이 함수 안에 없다.
 *
 * 🔴 이 시스템에 계정이 없는 사람(포털 계정과 이어지지 않았거나 삭제된 계정)은
 * **빈 목록**이다. 오류가 아니다 — 포털은 여러 시스템에 같은 질문을 던지고, 재고
 * 관리에만 계정이 없는 사람은 흔하다(notifications/route.ts 와 같은 판단).
 */
export async function buildPortalApprovalInbox(params: {
  subject: string;
  baseUrl: string;
  findActor: (authSub: string) => Promise<{ authSub: string } | null>;
  listPendingApprovals: (approverSub: string) => Promise<readonly PartIssueView[]>;
}): Promise<PortalApprovalInbox> {
  const actor = await params.findActor(params.subject);
  if (!actor) return EMPTY_INBOX;

  // 🔴 **포털 번호는 되짚은 DB 의 값**(`actor.authSub`)을 쓴다 — 방금 그 번호로 찾아낸
  // 바로 그 줄이라 토큰의 subject 와 같은 값이고, notifications/queries.ts 의
  // `NotificationViewer.sub` 와 같은 관례다. users 를 다시 읽지 않는다.
  const rows = await params.listPendingApprovals(actor.authSub);
  const items = rows.map((row) => toPortalApprovalItem(row, params.baseUrl));
  return { items, count: items.length };
}
