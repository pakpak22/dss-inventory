"use client";

import { useEffect } from "react";

/**
 * 인증 구간의 오류 화면. 🔴 영어 개발자 메시지(스택·원시 예외·테이블명)를 사용자에게 보이지 않는다 (CLAUDE.md 10절).
 * 상세는 서버 로그와 브라우저 콘솔에만 남긴다. DB 가 꺼져 있을 때 가장 자주 본다.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dss-inventory] 화면 오류:", error);
  }, [error]);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
      <p className="text-zinc-900">화면을 불러오지 못했습니다.</p>
      <p className="mt-2">잠시 뒤 다시 시도하십시오. 계속 그러면 담당자(최희만)에게 알려 주십시오.</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-zinc-400">오류 번호 {error.digest}</p> : null}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
      >
        다시 시도
      </button>
    </div>
  );
}
