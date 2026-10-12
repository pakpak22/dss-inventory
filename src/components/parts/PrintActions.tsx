"use client";

/**
 * 인쇄 화면의 단추. 화면에서만 보이고 종이에는 안 나온다.
 * 🔴 열릴 때 인쇄 창을 자동으로 띄우지 않는다 (2026-10-07 사용자: 「미리보기가 둘이 된다. 미리보기 보고 나서 [인쇄]를 누르면 뜨게」).
 *    이 화면 자체가 미리보기이고, 인쇄 창은 사람이 [인쇄]를 눌렀을 때만.
 */
export function PrintActions() {
  return (
    <div className="no-print flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-700">
      <button type="button" onClick={() => window.print()} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800">
        인쇄
      </button>
      <button type="button" onClick={() => window.close()} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
        닫기
      </button>
      <span className="text-xs text-zinc-500">이 화면이 미리보기입니다. [인쇄]를 누르면 인쇄 창이 뜹니다. A4 가로이고, 「배경 그래픽」을 켜면 머리글 바탕색이 같이 나옵니다.</span>
    </div>
  );
}
