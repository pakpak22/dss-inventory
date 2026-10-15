import Link from "next/link";

/**
 * 설정 묶음의 길잡이 (DESIGN 2-7절: 항목 관리 · 전환일 · 엑셀 상태). 머리말의 「설정」은 항목 관리로 가고, 여기서 갈아탄다.
 */
const ITEMS = [
  { key: "items", href: "/settings/items", label: "항목 관리" },
  { key: "transition", href: "/settings/transition", label: "전환일" },
  { key: "workbook", href: "/settings/workbook", label: "엑셀 상태" },
  { key: "approval", href: "/settings/approval-routes", label: "승인 절차" },
  { key: "oh", href: "/settings/oh-templates", label: "O/H 템플릿" },
  /**
   * 변경 이력 — 머리말에서 여기로 옮겼다 (2026-10-15 사용자 요청. 머리말에 「부품 요청」이 들어오면서 자리를 바꿨다).
   * 🔴 **주소는 `/audit` 그대로다.** `/settings/audit` 로 옮기면 열려 있는 탭·즐겨찾기·부품 상세의 [변경 이력]
   *    링크(`/audit?part=No.`)가 깨지고, 얻는 것이 없다. 탭 자리만 여기이고 화면은 그대로 산다.
   */
  { key: "audit", href: "/audit", label: "변경 이력" },
] as const;

export function SettingsNav({ current }: { current: (typeof ITEMS)[number]["key"] }) {
  return (
    <nav aria-label="설정" className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 no-print">
      {ITEMS.map((it) =>
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
