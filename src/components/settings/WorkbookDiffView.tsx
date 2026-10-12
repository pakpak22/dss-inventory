import type { SheetDiff, WorkbookDiff } from "@/lib/excel/workbook-diff";

/**
 * 치워 둔 파일 vs 프로그램 기준본의 차이 (조각 8-A, 관리자 화면). 서버 컴포넌트 — 보여 주기만 한다.
 * 바뀐 줄은 「칸: 전 → 후」로, 더한·사라진 줄은 시트 칸 그대로 표로. 너무 많으면 앞부분만 보이고 수를 알린다.
 */
const MAX = 100;

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="border-b border-zinc-100 px-2 py-1 align-top text-zinc-800">{children}</td>;
}

function FullTable({ columns, rows }: { columns: string[]; rows: { label: string; values: string[] }[] }) {
  const shown = rows.slice(0, MAX);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-50 text-left text-zinc-500">
            <th className="px-2 py-1 font-medium">줄</th>
            {columns.map((c, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-1 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              <Cell>
                <span className="whitespace-nowrap font-medium text-zinc-500">{r.label}</span>
              </Cell>
              {r.values.map((v, j) => (
                <Cell key={j}>{v === "" ? <span className="text-zinc-300">·</span> : v}</Cell>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX ? <p className="mt-1 text-xs text-zinc-500">외 {(rows.length - MAX).toLocaleString("ko-KR")}줄 더. 전부 보려면 수기입 파일을 내려받으십시오.</p> : null}
    </div>
  );
}

function SheetBlock({ s }: { s: SheetDiff }) {
  const n = s.changed.length + s.added.length + s.removed.length;
  if (n === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-zinc-900">
        {s.sheet} <span className="font-normal text-zinc-500">· 바뀐 {s.changed.length} · 더한 {s.added.length} · 사라진 {s.removed.length}</span>
      </h3>

      {s.changed.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-zinc-500">바뀐 줄</p>
          <ul className="flex flex-col gap-1">
            {s.changed.slice(0, MAX).map((r, i) => (
              <li key={i} className="text-xs text-zinc-800">
                <span className="font-medium text-zinc-500">{r.label}</span>{" "}
                {r.cells.map((c, j) => (
                  <span key={j} className="mr-2 inline-block">
                    {c.label}: <span className="text-red-700 line-through">{c.before === "" ? "(빈칸)" : c.before}</span> → <span className="text-emerald-700">{c.after === "" ? "(빈칸)" : c.after}</span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {s.changed.length > MAX ? <p className="text-xs text-zinc-500">외 {(s.changed.length - MAX).toLocaleString("ko-KR")}줄 더.</p> : null}
        </div>
      ) : null}

      {s.added.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-emerald-700">더한 줄 (사람이 엑셀에 새로 적음)</p>
          <FullTable columns={s.columns} rows={s.added} />
        </div>
      ) : null}

      {s.removed.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-red-700">사라진 줄 (프로그램엔 있는데 엑셀에서 지움)</p>
          <FullTable columns={s.columns} rows={s.removed} />
        </div>
      ) : null}
    </div>
  );
}

export function WorkbookDiffView({ diff }: { diff: WorkbookDiff }) {
  if (diff.totalChanges === 0) {
    return <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">값 차이가 없습니다. 엑셀을 열어 저장만 한 것으로 보입니다. [프로그램 기준 적용]을 누르면 바로 다시 씁니다.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-700">
        수기입 파일과 기준 파일(프로그램이 마지막으로 만든 현황판 엑셀)을 견준 결과입니다. 모두 <b>{diff.totalChanges.toLocaleString("ko-KR")}</b>군데가 다릅니다.
      </p>
      {diff.sheets.map((s) => (
        <SheetBlock key={s.sheet} s={s} />
      ))}
    </div>
  );
}
