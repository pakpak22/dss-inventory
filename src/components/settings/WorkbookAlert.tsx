import Link from "next/link";
import type { WorkbookStatus } from "@/db/schema/workbook-states";

/** 관리자 화면 위쪽의 알림 띠 — 엑셀 한 벌이 멈춰 있을 때만 (DESIGN 2-7절 「멈춘 동안에는 관리자 화면 위쪽에 알림 띠」). */
export function WorkbookAlert({ status, parkedFile, errorCount }: { status: WorkbookStatus; parkedFile: string | null; errorCount: number }) {
  const parked = status === "PARKED";
  return (
    <div className={`no-print border-b px-4 py-2 text-sm ${parked ? "border-amber-300 bg-amber-50 text-amber-900" : "border-red-300 bg-red-50 text-red-900"}`}>
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2">
        <span>
          {parked ? (
            <>
              <b>현황판 엑셀 자동 갱신이 멈춰 있습니다.</b> 누군가 엑셀에 수기입한 것이 발견되어 그 파일을 <span className="font-mono">{parkedFile}</span> 로 보관했습니다(수기입 파일). [엑셀 상태 보기]에서 무엇이 바뀌었는지 확인하고 처리하십시오.
            </>
          ) : (
            <>
              <b>현황판 엑셀 자동 갱신이 {errorCount}번 연속 실패했습니다.</b> 엑셀 파일이 열려 있으면 닫으십시오. 1분마다 다시 시도합니다.
            </>
          )}
        </span>
        <Link href="/settings/workbook" className="rounded-md border border-current px-2.5 py-1 text-xs font-medium hover:bg-white/60">
          엑셀 상태 보기
        </Link>
      </div>
    </div>
  );
}
