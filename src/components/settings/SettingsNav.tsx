import Link from "next/link";

/**
 * 설정 묶음의 길잡이 (DESIGN 2-7절: 항목 관리 · 전환일 · 엑셀 상태). 머리말의 「설정」에서 들어와 여기서 갈아탄다.
 *
 * ── 🔴 설정이 더 이상 「통째로 관리자 자리」가 아니다 (2026-10-21) ──────
 * 탭 둘(**결재권 위임 · O/H 템플릿**)은 **로그인한 모두**가 쓴다(`everyone: true`).
 *  - **결재권 위임**: 결재자는 역할과 무관하게 누구나 될 수 있다(결재선은 A/S 명부에서 고르고,
 *    보기 권한자가 거기 들어 있는 경우가 실제로 있다). 역할로 막으면 그분이 자기 위임을 영영
 *    못 만들고, 자리를 비우는 동안 그 건이 선다 — 이 기능이 풀려던 문제 그 자체다.
 *  - **O/H 템플릿**: 2026-10-21 사용자 결정으로 열었다.
 *
 * 🔵 **여기서 탭을 감추는 것은 편의일 뿐 울타리가 아니다.** 실제로 막는 자리는 **각 페이지의
 *    `requireRole`/`requireSession` 과 서버 액션**이다(CLAUDE.md 8-4절). 이 줄을 통째로 지워도
 *    쓰기는 안 뚫린다 — 관리자 탭 주소를 손으로 쳐 들어가면 `/forbidden` 으로 튄다.
 *
 * 🔴 **목록과 가르는 규칙을 밖으로 낸다**(`SETTINGS_TABS` · `visibleSettingsTabs`). 이 저장소에는
 *    화면 렌더 시험이 없어서, 안에 둔 채로 두면 「일반 사용자에게 몇 개가 보이나」를 아무도
 *    돌려 보지 못한 채 운영으로 나간다(`src/lib/approval/delegation-screen.ts` 머리말의 같은 까닭).
 *    `tests/settings-access.test.ts` 가 이 둘을 불러서 센다.
 */
export const SETTINGS_TABS = [
  { key: "items", href: "/settings/items", label: "항목 관리", everyone: false },
  { key: "transition", href: "/settings/transition", label: "전환일", everyone: false },
  { key: "workbook", href: "/settings/workbook", label: "엑셀 상태", everyone: false },
  { key: "approval", href: "/settings/approval-routes", label: "승인 절차", everyone: false },
  /**
   * 결재권 위임 — 「승인 요청건」(`/approvals`)에서 여기로 옮겼다 (2026-10-21 사용자 요청).
   * 🔵 옮기면서 `/approvals` 에는 **한 줄 링크**를 남겼다. 결재자가 날마다 오는 화면이 거기라,
   *    출장 전에 거기서 바로 올 수 있어야 한다.
   */
  { key: "delegations", href: "/settings/delegations", label: "결재권 위임", everyone: true },
  { key: "oh", href: "/settings/oh-templates", label: "O/H 템플릿", everyone: true },
  /**
   * 변경 이력 — 머리말에서 여기로 옮겼다 (2026-10-15 사용자 요청. 머리말에 「부품 요청」이 들어오면서 자리를 바꿨다).
   * 🔴 **주소는 `/audit` 그대로다.** `/settings/audit` 로 옮기면 열려 있는 탭·즐겨찾기·부품 상세의 [변경 이력]
   *    링크(`/audit?part=No.`)가 깨지고, 얻는 것이 없다. 탭 자리만 여기이고 화면은 그대로 산다.
   */
  { key: "audit", href: "/audit", label: "변경 이력", everyone: false },
] as const;

export type SettingsTabKey = (typeof SETTINGS_TABS)[number]["key"];

/**
 * 지금 이 사람에게 **그릴** 탭. 🔵 **편의일 뿐 울타리가 아니다**(위 머리말) — 그래서 이름도
 * 「visible(보이는)」이지 「allowed(되는)」가 아니다.
 */
export function visibleSettingsTabs(isAdmin: boolean): readonly (typeof SETTINGS_TABS)[number][] {
  return SETTINGS_TABS.filter((it) => isAdmin || it.everyone);
}

/**
 * @param isAdmin 관리자 전용 탭까지 보일지. 🔵 **편의일 뿐 울타리가 아니다**(위 머리말).
 *   관리자 전용 화면은 `requireRole("ADMIN")` 을 이미 지나왔으므로 거기서는 `isAdmin` 으로 넘긴다.
 */
export function SettingsNav({ current, isAdmin }: { current: SettingsTabKey; isAdmin: boolean }) {
  const items = visibleSettingsTabs(isAdmin);
  return (
    <nav aria-label="설정" className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 no-print">
      {items.map((it) =>
        it.key === current ? (
          <span key={it.key} className="rounded-md bg-zinc-900 px-2.5 py-1 text-sm font-medium text-white" aria-current="page">
            {it.label}
          </span>
        ) : (
          <Link key={it.key} href={it.href} className="rounded-md px-2.5 py-1 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
            {it.label}
          </Link>
        ),
      )}
    </nav>
  );
}
