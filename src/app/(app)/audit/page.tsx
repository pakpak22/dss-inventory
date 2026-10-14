import Link from "next/link";
import type { ReactNode } from "react";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, PART_FIELD_LABEL, describeTarget, isAuditAction } from "@/lib/audit-labels";
import { requireRole } from "@/lib/auth/session";
import { formatFileSize } from "@/lib/file-size";
import { CATEGORY_LABEL, OWNER_LABEL, isCategory, isOwner } from "@/lib/parts/codes";
import { listAuditLogs, type AuditRow } from "@/lib/parts/queries";
import { entryNosByIds } from "@/lib/stock/queries";

/**
 * 변경 이력 `/audit` (관리자, DESIGN 2-6절). 시간 역순, 행위로 거르기, 쪽 나누기(서버에서 — 로그는 끝없이 쌓인다).
 * 🔴 지우는 버튼은 없다. append-only (CLAUDE.md 11절).
 *
 * 표 모양: 시각 · 누가 · 행위 · 대상 · **칸 · 변경 전 · 변경 후**. 부품 수정은 **바뀐 칸마다 한 줄**로 펼친다
 * (한 칸에 줄로 쌓으면 둘째 줄이 눈에 안 띈다 — 2026-10-06 사용자 확인). 앞 네 칸은 rowSpan 으로 묶는다.
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

const CURRENCY_TEXT: Record<string, string> = { JPY: "¥ 엔", KRW: "₩ 원" };

/**
 * 앞·뒤 값을 사람이 읽는 글자로. 금액에는 통화 기호를 붙인다 (2026-10-06 사용자 요청).
 * 견적가는 항상 원. 공급가는 그 기록에 남긴 통화(detail.supplyCurrency.before/after)를 따르고,
 * 그 값이 없는 옛 기록은 기본 통화(엔)로 본다.
 */
function valueText(field: string, v: unknown, currency: string): string {
  if (v === null || v === undefined || v === "") return "(없음)";
  if (field === "owner" && isOwner(v)) return OWNER_LABEL[v];
  if (field === "category" && isCategory(v)) return CATEGORY_LABEL[v];
  if (field === "supplyCurrency") return CURRENCY_TEXT[String(v)] ?? String(v);
  if (typeof v === "number") {
    const n = v.toLocaleString("ko-KR");
    if (field === "quotePrice") return `₩${n}`;
    if (field === "supplyPrice") return `${currency === "KRW" ? "₩" : "¥"}${n}`;
    return n;
  }
  return String(v);
}

/** 한 이력을 표의 줄들로. 부품 수정은 바뀐 칸마다 [칸, 전, 후], 나머지는 한 줄 설명. */
type Line = { field: string; before: string; after: string } | { text: ReactNode };

function linesOf(row: AuditRow, entryNos: Map<string, string>): Line[] {
  const d = row.detail;
  if (!d) return [{ text: "" }];
  if (row.action === "PART_UPDATE" && d.changes && typeof d.changes === "object") {
    const changes = d.changes as Record<string, { before: unknown; after: unknown }>;
    const cur = (d.supplyCurrency ?? {}) as { before?: unknown; after?: unknown };
    const curBefore = String(cur.before ?? changes.supplyCurrency?.before ?? "JPY");
    const curAfter = String(cur.after ?? changes.supplyCurrency?.after ?? "JPY");
    const lines = Object.entries(changes).map(([field, c]) => ({
      field: PART_FIELD_LABEL[field] ?? field,
      before: valueText(field, c.before, curBefore),
      after: valueText(field, c.after, curAfter),
    }));
    return lines.length > 0 ? lines : [{ text: "바뀐 칸 없음" }];
  }
  if (row.action === "PART_CREATE") {
    return [
      {
        text: `${String(d.name ?? "")}${d.name2 ? ` · ${String(d.name2)}` : ""}${d.owner && isOwner(d.owner) ? ` · ${OWNER_LABEL[d.owner]}` : ""}`,
      },
    ];
  }
  if (row.action === "PART_DELETE") {
    return [
      {
        text: (
          <>
            {String(d.name ?? "")} <span className="text-zinc-500">사유</span> {String(d.reason ?? "")}
          </>
        ),
      },
    ];
  }
  if ((row.action === "STOCK_ENTRY" || row.action === "STOCK_CORRECTION") && Array.isArray(d.lines)) {
    // 수량 기록: 부품 줄마다 [부품, 전, 후]. 자세한 것(인수번호·사유)은 기록 내역에서.
    const lines = (d.lines as Array<{ partNo?: unknown; delta?: unknown; before?: unknown; after?: unknown }>).map((l) => ({
      field: `부품 No. ${String(l.partNo ?? "")} (${typeof l.delta === "number" ? (l.delta > 0 ? `+${l.delta}` : String(l.delta)) : ""})`,
      before: `${String(l.before ?? "")}개`,
      after: `${String(l.after ?? "")}개`,
    }));
    const head = `${String(d.occurredOn ?? "")}${d.intakeNumber ? ` · ${String(d.intakeNumber)}` : ""}${d.intakeUnverified ? " · 인수번호 확인 안 됨" : ""}`;
    return [{ text: head }, ...lines];
  }
  if (row.action === "INTAKE_VERIFIED") return [{ text: `${String(d.intakeNumber ?? "")} → ${String(d.productModel ?? "")}` }];
  // 반출 마감 — 🔴 반려와 **다르게** 읽혀야 한다(2026-10-14, 조각 4d). 준 것과 안 준 것을 숫자로 적는다.
  if (row.action === "STOCK_REQUEST_CLOSED") {
    const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString("ko-KR") : String(v ?? 0));
    return [
      { text: `${String(d.summary ?? "")} (신청자 ${String(d.requestedBy ?? "")})` },
      { text: `요청 ${n(d.requested)}개 중 ${n(d.issued)}개를 내주고, 남은 ${n(d.remaining)}개는 주지 않는 것으로 마감 · 사유: ${String(d.note ?? "")}` },
    ];
  }
  if (row.action === "PART_ITEM_CREATE") return [{ text: String(d.name ?? "") }];
  if (row.action === "PART_ITEM_REORDER") return [{ text: `${d.direction === "up" ? "위로" : "아래로"} (${String(d.swappedWith ?? "")} 와 자리 바꿈)` }];
  if (row.action === "LOGIN") return [{ text: `역할 ${String(d.role ?? "")}` }];
  // 엑셀 한 벌 관련 셋 — 파일 이름·건수를 글자로 (2026-10-12 사용자 지적: 엑셀 기준 적용 이력이 JSON 그대로 보였다)
  if (row.action === "WORKBOOK_PARKED") {
    return [{ text: `수기입 파일을 「${String(d.parkedFile ?? "")}」 로 따로 보관하고 멈춤${typeof d.size === "number" ? ` · ${formatFileSize(d.size)}` : ""}` }];
  }
  if (row.action === "WORKBOOK_EXCEL_APPLIED") {
    // 번호를 detail 에 남기기 전의 기록은 entryIds 로 번호를 찾아 보인다(entryNos 맵)
    const nos = Array.isArray(d.entryNos) ? (d.entryNos as unknown[]).map(String) : Array.isArray(d.entryIds) ? (d.entryIds as unknown[]).map((id) => entryNos.get(String(id))).filter((v): v is string => typeof v === "string") : [];
    const count = typeof d.entryCount === "number" ? d.entryCount : nos.length;
    const skipped = typeof d.skippedCount === "number" ? d.skippedCount : 0;
    return [
      { text: `수기입 파일 「${String(d.parkedFile ?? "")}」 · 사유: ${String(d.reason ?? "")}` },
      { text: String(d.summary ?? "") },
      { text: `원장에 적은 기록 ${count.toLocaleString("ko-KR")}건${nos.length > 0 ? `: ${nos.join(", ")}` : ""} · 자동 반영하지 않은 줄 ${skipped.toLocaleString("ko-KR")}줄` },
    ];
  }
  if (row.action === "WORKBOOK_IMPORT") {
    const legacy = (d.legacy ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString("ko-KR") : String(v ?? 0));
    return [
      { text: `${String(d.file ?? "")} · 전환일 ${String(d.transitionDate ?? "")}` },
      { text: `부품 ${n(d.parts)}개 · 처음 수량 줄 ${n(d.openingLines)}개` },
      { text: `과거 기록: 확인 ${n(legacy.confirmed)} · 묶음 판정 ${n(legacy.groupDecided)} · 소유 불일치 ${n(legacy.ownerMismatch)} · 못 붙임 ${n(legacy.unmatched)}` },
    ];
  }
  // 모르는 모양은 JSON 그대로 (숨기면 원인을 못 찾는다)
  return [{ text: <code className="font-mono text-xs break-all text-zinc-500">{JSON.stringify(d)}</code> }];
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
        <h1 className="text-xl font-semibold text-zinc-900">
          변경 이력
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
                  const lines = linesOf(r, entryNos);
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
                      {"field" in line ? (
                        <>
                          <td className={`${TD} whitespace-nowrap text-zinc-500`}>{line.field}</td>
                          <td className={`${TD} max-w-80 whitespace-pre-wrap text-zinc-500`}>{line.before}</td>
                          <td className={`${TD} max-w-80 whitespace-pre-wrap font-medium text-zinc-900`}>{line.after}</td>
                        </>
                      ) : (
                        <td colSpan={3} className={`${TD} text-zinc-700`}>
                          {line.text}
                        </td>
                      )}
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
