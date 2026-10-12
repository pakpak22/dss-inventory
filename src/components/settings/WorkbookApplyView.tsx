import { applyExcelAction } from "@/app/actions/workbook";
import type { ApplyPlan } from "@/lib/excel/workbook-apply";
import { ENTRY_TYPE_LABEL } from "@/lib/stock/codes";

/**
 * [엑셀 기준 적용] 확인 화면의 본문 (조각 8-B, 관리자, DESIGN 6-6절). 서버 컴포넌트.
 * 적을 기록 N건 · 부품 수량 맞춤 · 반영 불가 줄(이유) · 사유 칸 · 확인 체크 · [원장에 적기].
 * 평범한 <form action> — 되돌아올 상태가 없고(성공·실패 모두 주소로 돌아간다), 스크립트가 늦게 붙어도 눌린다.
 */
const TH = "whitespace-nowrap px-2 py-1 text-left text-xs font-medium text-zinc-500";
const TD = "border-b border-zinc-100 px-2 py-1 align-top text-xs text-zinc-800";
const BTN_DANGER = "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";

export function WorkbookApplyView({ plan, error }: { plan: ApplyPlan; error: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">
          원장에 적을 기록 <span className="font-normal text-zinc-500">· {plan.totalEntries.toLocaleString("ko-KR")}건</span>
        </h2>
        {plan.entries.length === 0 ? (
          <p className="text-sm text-zinc-500">기입란·수량 변경 기록에 더한 줄 가운데 자동으로 바꿀 수 있는 것이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-zinc-50">
                <tr>
                  <th className={TH}>엑셀 줄</th>
                  <th className={TH}>종류</th>
                  <th className={TH}>날짜</th>
                  <th className={TH}>부품</th>
                  <th className={`${TH} text-right`}>변동</th>
                  <th className={TH}>내용</th>
                  <th className={TH}>엑셀 비고</th>
                </tr>
              </thead>
              <tbody>
                {plan.entries.map((e, i) => (
                  <tr key={i}>
                    <td className={`${TD} whitespace-nowrap text-zinc-500`}>
                      {e.sheet} {e.rowLabel}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{ENTRY_TYPE_LABEL[e.input.type]}</td>
                    <td className={`${TD} tabular whitespace-nowrap`}>{e.input.occurredOn}</td>
                    <td className={TD}>
                      No. {e.partNo} {e.partName}
                    </td>
                    <td className={`${TD} tabular text-right ${e.delta < 0 ? "text-red-700" : "text-emerald-700"}`}>
                      {e.delta > 0 ? "+" : ""}
                      {e.delta.toLocaleString("ko-KR")}
                    </td>
                    <td className={TD}>{e.summary}</td>
                    <td className={TD}>{e.excelNote || <span className="text-zinc-300">·</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {plan.reconcile.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1">
            <p className="text-xs font-medium text-zinc-500">부품 재고 현황의 수량 맞춤 — 위 기록을 반영한 뒤 남는 차이만 조정합니다(두 번 빼지 않게)</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className={TH}>부품</th>
                    <th className={`${TH} text-right`}>지금 프로그램</th>
                    <th className={`${TH} text-right`}>위 기록 반영 뒤</th>
                    <th className={`${TH} text-right`}>엑셀에 적힌 수량</th>
                    <th className={`${TH} text-right`}>조정</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.reconcile.map((r, i) => (
                    <tr key={i}>
                      <td className={TD}>
                        No. {r.partNo} {r.partName}
                      </td>
                      <td className={`${TD} tabular text-right`}>{r.programQuantity.toLocaleString("ko-KR")}</td>
                      <td className={`${TD} tabular text-right`}>{r.expectedQuantity.toLocaleString("ko-KR")}</td>
                      <td className={`${TD} tabular text-right`}>{r.excelQuantity.toLocaleString("ko-KR")}</td>
                      <td className={`${TD} tabular text-right ${r.adjustDelta === 0 ? "text-zinc-400" : r.adjustDelta < 0 ? "text-red-700" : "text-emerald-700"}`}>
                        {r.adjustDelta === 0 ? "없음(같음)" : `${r.adjustDelta > 0 ? "+" : ""}${r.adjustDelta.toLocaleString("ko-KR")} 조정`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {plan.skipped.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">
            자동으로 반영하지 않는 줄 <span className="font-normal text-zinc-500">· {plan.skipped.length.toLocaleString("ko-KR")}줄</span>
          </h2>
          <p className="text-xs text-zinc-600">아래는 원장에 적지 않습니다. 필요하면 적용 뒤 평소 화면(사용·입고·조정·부품 수정·기록 취소)에서 직접 처리하십시오.</p>
          <ul className="flex flex-col gap-1">
            {plan.skipped.map((s, i) => (
              <li key={i} className="text-xs text-zinc-800">
                <span className="font-medium text-zinc-500">
                  {s.sheet} {s.rowLabel}
                </span>{" "}
                — {s.reason}
                {s.values.length > 0 ? <span className="ml-1 text-zinc-500">[{s.values.filter((v) => v !== "").join(" | ")}]</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">원장에 적기</h2>
        {plan.totalEntries === 0 ? (
          <p className="text-sm text-zinc-600">적을 기록이 없어 단추가 없습니다. 엑셀 상태 화면으로 돌아가 [프로그램 기준 적용]을 누르면 프로그램 기록대로 현황판 엑셀을 다시 만듭니다.</p>
        ) : (
          <form action={applyExcelAction} className="flex flex-col gap-3">
            <input type="hidden" name="fingerprint" value={plan.fingerprint} />
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              사유 *
              <input name="reason" required maxLength={200} placeholder="예: 10/12 서버 점검 중 엑셀에 적은 사용 2건 반영" className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900" />
            </label>
            <label className="flex items-start gap-2 text-sm text-zinc-800">
              <input type="checkbox" name="confirm" required className="mt-0.5" />
              <span>
                위 <b>{plan.totalEntries.toLocaleString("ko-KR")}건</b>을 원장에 적습니다. 적은 뒤에는 되돌릴 수 없고, 잘못된 건은 기록 취소를 건마다 해야 합니다. 수기입 파일은 남고, 1분 안에 프로그램이 현황판 엑셀을 다시 만듭니다.
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={BTN_DANGER}>
                원장에 적기
              </button>
              <a href="/settings/workbook" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
                돌아가기
              </a>
              <span className="text-xs text-zinc-500">하나라도 거절되면(수량 부족 등) 전부 적지 않고 이유를 보입니다.</span>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
