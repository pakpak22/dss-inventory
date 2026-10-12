import Link from "next/link";

/**
 * 설정 묶음의 길잡이 (DESIGN 2-7절: 항목 관리 · 전환일 · 엑셀 상태). 머리말의 「설정」은 항목 관리로 가고, 여기서 갈아탄다.
 */
const ITEMS = [
  { key: "items", href: "/settings/items", label: "항목 관리" },
  { key: "transition", href: "/settings/transition", label: "전환일" },
  { key: "workbook", href: "/settings/workbook", label: "엑셀 상태" },
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
