import { resumeWorkbookAction, writeWorkbookNowAction } from "@/app/actions/workbook";
import { CopyPath } from "@/components/settings/CopyPath";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { WorkbookDiffView } from "@/components/settings/WorkbookDiffView";
import { requireRole } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatFileSize } from "@/lib/file-size";
import { getWorkbookState, listBackups, readParkedDiff, secondsUntilNextWrite } from "@/lib/excel/workbook-sync";

/**
 * 설정 — 엑셀 상태 `/settings/workbook` (관리자, DESIGN 2-7절·6-5절).
 * 마지막으로 쓴 시각·크기, 지금 상태(정상 / 사람이 손대 멈춤 / 오류), 치워 둔 파일 이름, [다시 쓰기 시작]·[지금 쓰기].
 * 파일 **경로**는 환경변수 것이고 화면에는 파일 이름만 보인다(절대경로를 사람 화면에 늘어놓지 않는다).
 */
export const metadata = { title: "엑셀 상태" };

const STATUS_LABEL = { OK: "정상", PARKED: "엑셀 수기입시 멈춤", ERROR: "쓰기 실패" } as const;
const BTN = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100";
const BTN_PRIMARY = "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800";

function when(d: Date | null): string {
  return d ? d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "-";
}
function fileName(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}
/** 파일 경로에서 폴더 경로. 구분자는 적힌 그대로 둔다(탐색기에 붙여 넣는 글자라서). */
function folderOf(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}
/** 폴더 아래 하위 폴더 경로. 원본 경로의 구분자(\\ 또는 /)를 그대로 쓴다. */
function joinPath(folder: string, name: string): string {
  const sep = folder.includes("\\") ? "\\" : "/";
  return `${folder}${sep}${name}`;
}

export default async function WorkbookSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN", "/settings/workbook");
  const sp = await searchParams;
  // [엑셀 기준 적용] 직후 (조각 8-B)
  const applied = typeof sp.applied === "string" && /^\d+$/.test(sp.applied) ? Number(sp.applied) : null;
  const appliedSummary = typeof sp.summary === "string" ? sp.summary : "";
  const s = await getWorkbookState();
  const status = s?.status ?? "OK";
  const waiting = secondsUntilNextWrite(s);
  // 멈춤일 때만 치워 둔 파일과 기준본을 견준다 (조각 8-A). 읽기만 한다.
  const parkedDiff = status === "PARKED" ? await readParkedDiff() : null;
  const backups = await listBackups();
  // 백업 폴더(사람이 탐색기로 가는 경로). 월별 OLD 는 원본 바로 옆, 일일 backup 은 데이터 폴더(원본 폴더의 한 단계 위) 아래.
  const shareFolder = folderOf(env.stockWorkbookSharePath);
  const oldFolder = joinPath(shareFolder, "OLD");
  const dailyFolder = joinPath(folderOf(shareFolder), "backup");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        설정 <span className="font-normal text-zinc-500">· 엑셀 상태</span>
      </h1>
      <SettingsNav current="workbook" />

      {applied !== null ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          엑셀에서 적은 내용을 원장에 <b>{applied.toLocaleString("ko-KR")}건</b> 적었습니다{appliedSummary ? ` (${appliedSummary})` : ""}. 1분 안에 현황판 엑셀을 다시 만듭니다. 기록은 기록 내역에서 볼 수 있습니다.
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-medium ${status === "OK" ? "bg-emerald-50 text-emerald-800" : status === "PARKED" ? "bg-amber-100 text-amber-900" : "bg-red-50 text-red-800"}`}>
            {STATUS_LABEL[status]}
          </span>
          <span className="text-sm text-zinc-600">
            양식 파일 <span className="font-mono text-xs">{fileName(env.stockWorkbookTemplatePath)}</span>
          </span>
        </div>
        {/* 원본은 서버 폴더에 있다. 사람이 찾아가는 경로를 보인다 (2026-10-07 사용자: 「파일 경로로, 폴더 바로 뜨게」). 웹은 탐색기를 못 열어 [복사]로. */}
        <div className="flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <CopyPath label="폴더 경로" value={folderOf(env.stockWorkbookSharePath)} />
          <CopyPath label="파일 경로" value={env.stockWorkbookSharePath} />
          <p className="text-xs text-zinc-500">[복사] 뒤 탐색기 주소창(Win+E → Ctrl+L)에 붙여 넣으면 바로 열립니다. 원본에 직접 적으면 다음 주기에 「엑셀 수기입시 멈춤」이 됩니다 — 적는 일은 프로그램에서 하십시오.</p>
        </div>

        {/* 백업 안내 + 두 폴더 (2026-10-08 사용자 요청: 「백업 쌓이고 있다는 안내랑 폴더 링크」). 경로 복사 방식은 원본과 같다(웹은 탐색기를 못 연다). */}
        <div className="flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <p className="text-sm text-zinc-700">
            <b>백업이 자동으로 쌓이고 있습니다.</b> 월별 영구 백업 {backups.monthly.count.toLocaleString("ko-KR")}개{backups.monthly.latest ? ` (최근 ${backups.monthly.latest})` : ""} · 일일 백업 {backups.daily.count.toLocaleString("ko-KR")}개{backups.daily.latest ? ` (최근 ${backups.daily.latest})` : ""}.
          </p>
          <CopyPath label="월별 폴더" value={oldFolder} />
          <CopyPath label="일일 폴더" value={dailyFolder} />
          <p className="text-xs text-zinc-500">
            <b>월별</b> 백업은 원본 옆 <span className="font-mono">OLD</span> 폴더에 달마다 한 개씩 <b>영구</b> 보관됩니다(지우지 않습니다). <b>일일</b> 백업은 하루 한 개씩 {backups.daily.keepDays}일간 보관됩니다. [복사] 뒤 탐색기 주소창에 붙여 넣으면 열립니다.
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-zinc-500">마지막으로 쓴 시각</dt>
            <dd className="tabular">{when(s?.writtenAt ?? null)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-zinc-500">현재 파일 크기</dt>
            <dd className="tabular">
              {/* sha256 지문은 프로그램이 「사람이 손댔나」를 가리는 데만 쓰는 값이라 화면에 안 보인다(2026-10-12 사용자: 「지문」이 어려움). 마우스를 올리면 보인다 */}
              <span title={s?.writtenSha256 ? `sha256 ${s.writtenSha256}` : undefined}>{s?.writtenSize !== null && s?.writtenSize !== undefined ? formatFileSize(s.writtenSize) : "-"}</span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-zinc-500">엑셀에 아직 반영 안 된 변경</dt>
            <dd>{s?.dirtyAt ? `있음 — ${when(s.dirtyAt)} 부터${waiting !== null && waiting > 0 ? ` (약 ${waiting}초 뒤 반영)` : " (다음 차례에 반영)"}` : "없음 — 엑셀이 프로그램과 같습니다"}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-zinc-500">수기입 파일</dt>
            <dd className="font-mono text-xs">{s?.parkedFile ? `${s.parkedFile} (${when(s.parkedAt ?? null)})` : "-"}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-zinc-500">일일 백업 (하루 한 개, {backups.daily.keepDays}일 보관 · 데이터 폴더)</dt>
            <dd>{backups.daily.count > 0 ? `${backups.daily.count.toLocaleString("ko-KR")}개 · 최근 ${backups.daily.latest}` : "아직 없음 — 현황판 엑셀을 처음 만들 때 생깁니다"}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-zinc-500">월별 영구 백업 (달에 한 개 · 원본 폴더의 OLD)</dt>
            <dd>{backups.monthly.count > 0 ? `${backups.monthly.count.toLocaleString("ko-KR")}개 · 최근 ${backups.monthly.latest}` : "아직 없음 — 현황판 엑셀을 처음 만들 때 생깁니다"}</dd>
          </div>
          {s?.errorMessage ? (
            <div className="flex flex-col gap-0.5 sm:col-span-2">
              <dt className="text-xs text-zinc-500">마지막 실패 ({s.errorCount}번 연속)</dt>
              <dd className="text-red-800">{s.errorMessage}</dd>
            </div>
          ) : null}
          {s?.resumedAt ? (
            <div className="flex flex-col gap-0.5 sm:col-span-2">
              <dt className="text-xs text-zinc-500">마지막 [다시 쓰기 시작]</dt>
              <dd>
                {s.resumedByName} · <span className="tabular">{when(s.resumedAt)}</span>
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3">
          {status === "PARKED" ? (
            <>
              <form action={resumeWorkbookAction}>
                <button type="submit" className={BTN_PRIMARY} title="엑셀에 직접 적은 내용은 버리고, 프로그램 기록대로 다시 만듭니다. 수기입 파일은 그대로 남습니다.">
                  프로그램 기준 적용
                </button>
              </form>
              <a href="/settings/workbook/apply" className={BTN} title="엑셀에서 더한 줄·바뀐 수량을 프로그램 기록으로 바꿉니다. 확인 화면에서 내용을 보고 사유를 적은 뒤 한 번 더 눌러야 쓰입니다.">
                엑셀 기준 적용 준비
              </a>
              <a href="/api/workbook/parked/file" className={BTN} title="엑셀에 수기입한 그 파일을 그대로 내려받습니다.">
                수기입 파일 내려받기
              </a>
            </>
          ) : null}
          <form action={writeWorkbookNowAction}>
            <button type="submit" className={BTN} disabled={status === "PARKED"} title={status === "PARKED" ? "먼저 아래에서 처리하십시오." : "1분을 기다리지 않고 지금 씁니다."}>
              지금 쓰기
            </button>
          </form>
          <a href="/api/workbook/file" className={BTN} title="원본이 아니라 사본입니다. 사본에 적어도 원본·프로그램에 반영되지 않습니다.">
            사본 내려받기
          </a>
          <span className="text-xs text-zinc-500">수량·부품이 바뀌면 1분쯤 모았다가 현황판 엑셀을 통째로 다시 만듭니다. 원본은 위 폴더에 있고, 단추는 사본을 내려줍니다.</span>
        </div>
      </section>

      {status === "PARKED" ? (
        <section className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">엑셀에 수기입한 내용</h2>
          {parkedDiff?.available ? (
            <WorkbookDiffView diff={parkedDiff.diff} />
          ) : (
            <p className="text-sm text-zinc-600">
              {parkedDiff?.reason === "no_baseline"
                ? "비교할 기준 파일(프로그램이 마지막으로 만든 현황판 엑셀)이 없어 무엇이 바뀌었는지 자동으로 보여 드릴 수 없습니다(이 기능이 붙기 전에 멈춘 경우). [수기입 파일 내려받기]로 받아 직접 견주십시오."
                : parkedDiff?.reason === "error"
                  ? `비교 중 문제가 생겼습니다: ${parkedDiff.message ?? ""}. [수기입 파일 내려받기]로 받아 직접 견주십시오.`
                  : "수기입 파일을 찾지 못했습니다."}
            </p>
          )}
          <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
            <p>
              <b>처리하는 법.</b> <b>[프로그램 기준 적용]</b> — 엑셀에서 적은 것은 버리고 프로그램 기록대로 다시 만듭니다(수기입 파일은 남습니다). 엑셀에 적은 내용을 살리려면, 위 바뀐 내용을 보고 <b>평소 화면(사용·입고·조정 등)에서 프로그램에 직접 적은</b> 뒤 [프로그램 기준 적용]을 누르십시오.
            </p>
            <p className="mt-1">
              <b>[엑셀 기준 적용 준비]</b> — 엑셀에서 더한 줄(사용·입고·조정·폐기·대여)과 바뀐 수량을 프로그램 기록으로 한 번에 바꿉니다. 확인 화면에서 적을 기록·반영하지 않는 줄·사유를 보고 <b>한 번 더</b> 눌러야 원장에 쓰입니다. 기존 줄을 고치거나 지운 것, 반환·소유 옮김은 자동으로 반영하지 않습니다.
            </p>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
        <h2 className="text-sm font-semibold text-zinc-900">멈추는 경우</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <b>엑셀 수기입시 멈춤</b>: 다시 만들기 전에 지금 파일이 프로그램이 마지막으로 만든 것과 다르면 누군가 엑셀에 직접 적은 것입니다. 덮어쓰지 않고 그 파일을 <span className="font-mono">현황판_사람수정_날짜-시각.xlsx</span> 로 옆에 치워 둡니다.
            그 내용을 프로그램에 옮겨 넣은 뒤 [다시 쓰기 시작]을 누르면 1분 안에 새로 만듭니다. 수기입 파일은 지우지 않습니다.
          </li>
          <li>
            <b>쓰기 실패</b>: 누가 엑셀을 열어 두어 파일 이름을 바꾸지 못하면 다음 차례(1분 뒤)에 다시 해 봅니다. 여러 번 실패하면 위쪽 띠로 알립니다.
          </li>
          <li>임시 파일에 다 쓴 뒤 이름을 바꾸므로, 쓰는 도중 전원이 나가도 반쯤 쓰인 파일이 남지 않습니다.</li>
        </ul>
      </section>
    </div>
  );
}
