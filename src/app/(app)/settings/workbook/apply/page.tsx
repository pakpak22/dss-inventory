import { SettingsNav } from "@/components/settings/SettingsNav";
import { WorkbookApplyView } from "@/components/settings/WorkbookApplyView";
import { requireRole } from "@/lib/auth/session";
import { readParkedPlan } from "@/lib/excel/workbook-apply-run";
import { summarizePlan } from "@/lib/excel/workbook-apply";

/**
 * 설정 — 엑셀 상태 — [엑셀 기준 적용] 확인 화면 `/settings/workbook/apply` (관리자, 조각 8-B, DESIGN 6-6절).
 * 관리자 승인 관문: 치워 둔 파일에서 바꿀 기록을 전부 보여 주고, 사유를 받아, 한 번 더 누르게 한다. 여기서 보여 준 계획의 지문이
 * 적용 때 다시 세운 계획과 같아야 쓰인다(그 사이 엑셀·수량이 바뀌었으면 거절).
 */
export const metadata = { title: "엑셀 기준 적용" };

export default async function WorkbookApplyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN", "/settings/workbook/apply");
  const sp = await searchParams;
  const error = typeof sp.error === "string" && sp.error !== "" ? sp.error : null;
  const planned = await readParkedPlan();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        설정 <span className="font-normal text-zinc-500">· 엑셀 상태 · 엑셀 기준 적용</span>
      </h1>
      {/* 🔵 `isAdmin` 은 탭 줄을 가르는 값일 뿐 울타리가 아니다. 이 화면은 바로 위 `requireRole("ADMIN")` 을
          지나왔으므로 여기 선 사람은 관리자다 — 모두가 쓰는 탭 둘(결재권 위임 · O/H 템플릿)만 보일 까닭이 없다. */}
      <SettingsNav current="workbook" isAdmin />

      {planned.available ? (
        <>
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            수기입 파일 <span className="font-mono text-xs">{planned.plan.parkedFile}</span> 에서 사람이 적은 것을 프로그램 기록으로 바꿉니다 — <b>{summarizePlan(planned.plan)}</b>. 아래를 확인하고 사유를 적은 뒤 [원장에 적기]를 누르십시오.
          </p>
          <WorkbookApplyView plan={planned.plan} error={error} />
        </>
      ) : (
        <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</p> : null}
          <p>
            {planned.reason === "not_parked"
              ? "지금은 멈춤 상태가 아닙니다. 적용할 수기입 파일이 없습니다."
              : planned.reason === "no_baseline"
                ? "비교할 기준 파일(프로그램이 마지막으로 만든 현황판 엑셀)이 없어 자동으로 바꿀 수 없습니다. [수기입 파일 내려받기]로 받아 직접 견준 뒤 평소 화면에서 적으십시오."
                : `수기입 파일을 견줄 수 없습니다: ${planned.message ?? ""}`}
          </p>
          <a href="/settings/workbook" className="w-fit rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
            엑셀 상태로 돌아가기
          </a>
        </section>
      )}
    </div>
  );
}
