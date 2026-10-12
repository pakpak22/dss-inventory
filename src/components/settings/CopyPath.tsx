"use client";

import { useState } from "react";

/**
 * 경로 한 줄 + [복사] (2026-10-07 사용자: 「폴더 바로 뜨게」). 웹 화면은 PC 의 탐색기를 직접 열 수 없다 — 브라우저가 http 화면에서
 * file:// 로 가는 것을 막는다. 그래서 경로를 복사해 탐색기 주소창에 붙여 넣는 길을 둔다. NAS 공유 폴더(\\\\NAS\\…)도 같은 방법으로 열린다.
 */
export function CopyPath({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // 클립보드가 막힌 환경(http 가 아닌 곳 등)이면 글자를 전체 선택해 두는 것으로 대신한다
      const sel = window.getSelection();
      const el = document.getElementById(`path-${label}`);
      if (sel && el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-zinc-500">{label}</span>
      <span id={`path-${label}`} className="font-mono text-xs break-all text-zinc-900 select-all">
        {value}
      </span>
      <button type="button" onClick={copy} className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100">
        {done ? "복사됨" : "복사"}
      </button>
    </div>
  );
}
