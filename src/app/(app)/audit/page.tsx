import Link from "next/link";
import { SettingsNav } from "@/components/settings/SettingsNav";
// 🔴 「내용」 칸 글자를 짓는 규칙은 **이 파일에 없다** — 순수 모듈 `@/lib/audit-detail` 하나가 쥐고 있고
//    `tests/audit-detail.test.ts` 가 행위 전부를 돌려 본다. 까닭은 그 파일 머리말(분기를 빠뜨려도
//    아무도 모르던 일이 실제로 있었다). 여기는 **그려 주기만** 한다.
import { auditDetailLines, unknownAuditDetail, type AuditDetailLine } from "@/lib/audit-detail";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, describeTarget, isAuditAction } from "@/lib/audit-labels";
import { requireRole } from "@/lib/auth/session";
import { listAuditLogs } from "@/lib/parts/queries";
import { entryNosByIds } from "@/lib/stock/queries";

/**
 * 변경 이력 `/audit` (관리자, DESIGN 2-6절). 시간 역순, 행위로 거르기, 쪽 나누기(서버에서 — 로그는 끝없이 쌓인다).
 * 🔴 지우는 버튼은 없다. append-only (CLAUDE.md 11절).
 *
 * 표 모양: 시각 · 누가 · 행위 · 대상 · **칸 · 변경 전 · 변경 후**. 부품 수정은 **바뀐 칸마다 한 줄**로 펼친다
 * (한 칸에 줄로 쌓으면 둘째 줄이 눈에 안 띈다 — 2026-10-06 사용자 확인). 앞 네 칸은 rowSpan 으로 묶는다.
 *
 * 🔵 **설정 묶음의 한 탭이다** (2026-10-15 사용자 요청: 머리말에서 뺐다). 🔴 주소는 `/audit` 그대로 — 옮기면
 *    열려 있는 탭·즐겨찾기·부품 상세의 [변경 이력] 링크가 깨진다. 탭 줄은 `SettingsNav`.
 */
export const metadata = { title: "변경 이력" };

const PAGE_SIZE = 50;
const BTN = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100";
const TD = "px-2.5 py-1.5 align-top";

const fmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * 「내용」 칸 한 줄을 표의 칸으로 그린다.
 *
 * 🔵 **색·`<code>` 같은 그리기를 아는 곳은 여기뿐이다** — 글자는 전부 `auditDetailLines` 가 짓는다
 *    (그 파일 머리말의 「JSX 를 돌려주지 않는다」와 짝이다. 그래야 시험이 리액트 없이 돌아간다).
 * 🔴 `unknown` 이면 아는 모양이 아니어서 **JSON 이 그대로** 들어 있다 — 날것임이 보이게 `<code>` 로
 *    그린다. 숨기면 새 행위가 생겼을 때 원인을 못 찾는다.
 */
function DetailCells({ line, unknown }: { line: AuditDetailLine; unknown: boolean }) {
  if (line.kind === "field") {
    return (
      <>
        <td className={`${TD} whitespace-nowrap text-zinc-500`}>{line.field}</td>
        <td className={`${TD} max-w-80 whitespace-pre-wrap text-zinc-500`}>{line.before}</td>
        <td className={`${TD} max-w-80 whitespace-pre-wrap font-medium text-zinc-900`}>{line.after}</td>
      </>
    );
  }
  return (
    <td colSpan={3} className={`${TD} text-zinc-700`}>
      {unknown ? (
        <code className="font-mono text-xs break-all text-zinc-500">{line.text}</code>
      ) : (
        <>
          {line.text}
          {/* 「사유」만 흐리게 — 부품 삭제·O/H 템플릿 삭제가 예전부터 그리던 꼴 그대로다. */}
          {line.reason !== undefined ? (
            <>
              {" "}
              <span className="text-zinc-500">사유</span> {line.reason}
            </>
          ) : null}
        </>
      )}
    </td>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; action?: string; part?: string }> }) {
  await requireRole("ADMIN", "/audit");
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const action = isAuditAction(sp.action) ? sp.action : null;
  // 부품 하나의 이력만 (상세 창의 [변경 이력] 에서 온다). 주소의 part=No.
  const partNo = /^\d+$/.test(sp.part ?? "") ? Number(sp.part) : null;
  const target = partNo !== null ? `parts:No.${partNo}` : null;
  const { rows, total } = await listAuditLogs({ page, size: PAGE_SIZE, action, target });
  // 옛 「엑셀 기준 적용」 기록(번호 없이 uuid 만 남긴 것)의 기록 번호를 한 번에 찾는다
  const idsToResolve = rows.flatMap((r) => (r.action === "WORKBOOK_EXCEL_APPLIED" && r.detail && !Array.isArray(r.detail.entryNos) && Array.isArray(r.detail.entryIds) ? (r.detail.entryIds as unknown[]).map(String) : []));
  const entryNos = await entryNosByIds(idsToResolve);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const href = (p: number) =>
    `/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(partNo !== null ? { part: String(partNo) } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 🔵 제목 꼴은 설정 묶음의 다른 탭과 같게 (2026-10-15, 조각 10c) — 「설정 · O/H 템플릿」처럼.
            🔴 부품으로 걸러 볼 때 붙는 「· 부품 No. N」과 그 옆 링크 둘은 그대로 둔다. */}
        <h1 className="text-xl font-semibold text-zinc-900">
          설정 <span className="font-normal text-zinc-500">· 변경 이력</span>
          {partNo !== null ? (
            <span className="font-normal text-zinc-500">
              {" "}
              · 부품 No. {partNo}{" "}
              <Link href={`/?part=${partNo}`} className="text-sm underline">
                상세로
              </Link>{" "}
              <Link href="/audit" className="text-sm underline">
                전체 보기
              </Link>
            </span>
          ) : null}
        </h1>
        <form method="get" action="/audit" className="flex items-end gap-2">
          {partNo !== null ? <input type="hidden" name="part" value={partNo} /> : null}
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            행위
            <select name="action" defaultValue={action ?? ""} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900">
              <option value="">전체</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {AUDIT_ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={BTN}>
            보기
          </button>
        </form>
      </div>
      {/* 🔵 `isAdmin` 은 탭 줄을 가르는 값일 뿐 울타리가 아니다. 이 화면은 바로 위 `requireRole("ADMIN")` 을
          지나왔으므로 여기 선 사람은 관리자다 — 모두가 쓰는 탭 둘(결재권 위임 · O/H 템플릿)만 보일 까닭이 없다. */}
      <SettingsNav current="audit" isAdmin />

      <p className="text-xs text-zinc-500">
        누가 언제 무엇을 했는지 전부 쌓이는 곳입니다(부품 등록·수정·삭제, 수량 기록, 로그인). 수량이 어떻게 움직였는지 보려면{" "}
        <Link href="/entries" className="underline">
          기록 내역
        </Link>
        이 더 읽기 쉽습니다.
      </p>

      <section className="rounded-lg border border-zinc-200 bg-white">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">{action || partNo !== null ? "이 조건의 이력이 없습니다." : "아직 쌓인 이력이 없습니다."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-xs text-zinc-500">
                  <th className="border-b border-zinc-200 px-2.5 py-2 font-medium whitespace-nowrap">시각</th>
                  <th className="border-b border-zinc-200 px-2.5 py-2 font-medium whitespace-nowrap">누가</th>
                  <th className="border-b border-zinc-200 px-2.5 py-2 font-medium whitespace-nowrap">행위</th>
                  <th className="border-b border-zinc-200 px-2.5 py-2 font-medium whitespace-nowrap">대상</th>
                  <th className="border-b border-zinc-200 px-2.5 py-2 font-medium whitespace-nowrap">칸</th>
                  <th className="border-b border-zinc-200 px-2.5 py-2 font-medium">변경 전</th>
                  <th className="border-b border-zinc-200 px-2.5 py-2 font-medium">변경 후</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // 🔵 `action` 은 글자 칸이라 글자표에 없는 값이 들어 있을 수 있다(옛 줄·손으로 넣은 줄).
                  //    그때도 숨기지 않고 JSON 을 그대로 보인다 — 모르는 모양을 다루는 길이 하나뿐이어야 한다.
                  const detail = isAuditAction(r.action) ? auditDetailLines(r.action, r.detail, { entryNos }) : unknownAuditDetail(r.detail);
                  const lines = detail.lines;
                  const n = lines.length;
                  return lines.map((line, i) => (
                    <tr key={`${r.id}-${i}`} className={`${i === n - 1 ? "border-b border-zinc-200" : "border-b border-dashed border-zinc-100"} last:border-0 hover:bg-zinc-50`}>
                      {i === 0 ? (
                        <>
                          <td rowSpan={n} className={`${TD} tabular whitespace-nowrap text-zinc-700`}>
                            {fmt.format(new Date(r.occurredAt))}
                          </td>
                          <td rowSpan={n} className={`${TD} whitespace-nowrap`}>
                            {r.actorName ?? <span className="text-zinc-400">-</span>}
                          </td>
                          <td rowSpan={n} className={`${TD} whitespace-nowrap`}>
                            {isAuditAction(r.action) ? AUDIT_ACTION_LABEL[r.action] : r.action}
                          </td>
                          <td rowSpan={n} className={`${TD} whitespace-nowrap`}>
                            {r.target?.startsWith("parts:No.") ? (
                              <Link href={`/?part=${r.target.slice("parts:No.".length)}`} className="underline">
                                {describeTarget(r.target)}
                              </Link>
                            ) : (
                              describeTarget(r.target)
                            )}
                          </td>
                        </>
                      ) : null}
                      <DetailCells line={line} unknown={detail.unknown} />
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 text-sm text-zinc-500">
          <span className="tabular">
            전체 {total}건 중 {from}-{to}건
          </span>
          <span className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={href(page - 1)} className={BTN}>
                이전
              </Link>
            ) : (
              <span className={`${BTN} opacity-50`}>이전</span>
            )}
            <span className="tabular">
              {page} / {pages}
            </span>
            {page < pages ? (
              <Link href={href(page + 1)} className={BTN}>
                다음
              </Link>
            ) : (
              <span className={`${BTN} opacity-50`}>다음</span>
            )}
          </span>
        </div>
      </section>
    </div>
  );
}
