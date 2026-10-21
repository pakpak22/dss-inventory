import Link from "next/link";
import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings/SettingsNav";
// 기간 글자는 위임 화면과 **같은 함수**로 만든다 — 두 곳이 따로 적으면 하루짜리 위임이 한쪽에서만 다르게 보인다.
import { formatDelegationPeriod } from "@/lib/approval/delegation-screen";
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
    const lines: Line[] = Object.entries(changes).map(([field, c]) => ({
      field: PART_FIELD_LABEL[field] ?? field,
      before: valueText(field, c.before, curBefore),
      after: valueText(field, c.after, curAfter),
    }));
    /**
     * 🔴 **바깥에서 채운 것이면 누가 채웠는지를 함께 보인다** (2026-10-16, 고객사 품명 통로).
     * 사람이 화면에서 고친 것과 A/S 통로로 들어온 것은 같은 행위(`PART_UPDATE`)로 남지만, 「이 이름
     * 누가 넣었지?」에 답할 자리가 이력뿐이다. 🔵 이름은 겹칠 수 있어 **포털 번호**까지 적는다
     * (반출 신청 취소에 「A/S 에서 거둠」을 적는 것과 같은 결). 옛 기록에는 이 칸이 없어 그대로 읽힌다.
     */
    const filledBy = d.filledBy as { sub?: unknown; name?: unknown } | undefined;
    if (filledBy) lines.push({ text: `A/S 통로로 채움 · 보낸 이름 ${String(filledBy.name ?? "")} · 포털 번호 ${String(filledBy.sub ?? "")}` });
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
  // 반출 신청 취소 — 🔴 **어디서 거뒀는지**가 보여야 한다 (2026-10-16, A/S 가 제 신청을 거두는 통로).
  // 화면에서 거둔 것과 A/S 통로로 거둔 것은 같은 행위(`STOCK_REQUEST_CANCELLED`)로 남지만, 「누가 접었나」를
  // 나중에 가릴 자리가 이력뿐이다. 🔵 출처 칸이 없는 옛 기록(화면 취소)은 요약 한 줄 그대로 읽힌다.
  if (row.action === "STOCK_REQUEST_CANCELLED") {
    const fromAs = d.source === "AS" ? ` · A/S 에서 거둠 (요청 번호 ${String(d.externalKey ?? "")})` : "";
    return [{ text: `${String(d.summary ?? "")}${fromAs}` }];
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
  // 승인 절차(결재선) — 🔴 판 자체가 이력이라 전용 이력 표가 없다. 그러니 이 줄만 읽고도
  // 「누가 누구를 몇 번째에 세웠나」가 보여야 한다(2026-10-12 사용자 지적: JSON 그대로는 안 된다).
  if (row.action === "APPROVAL_ROUTE_SAVED") {
    const names = (v: unknown) => {
      if (!Array.isArray(v) || v.length === 0) return "(없음 — 절차를 쓰지 않음)";
      return (v as Array<{ stepOrder?: unknown; approverName?: unknown }>)
        .map((s) => `${String(s.stepOrder ?? "")}. ${String(s.approverName ?? "")}`)
        .join(" ▶ ");
    };
    // 용도는 「대상」 칸이 한글로 말한다(describeTarget) — 여기서 코드를 또 내보내지 않는다.
    const prev = typeof d.previousVersion === "number" ? `${d.previousVersion}번째 판` : "첫 판";
    return [
      { text: `${prev} → ${String(d.version ?? "")}번째 판` },
      { field: "승인 단계", before: names(d.previousSteps), after: names(d.steps) },
    ];
  }
  /**
   * 결재권 위임 (2026-10-21, 조각 3) — 🔴 **이 줄만 읽고도 「누가 누구에게 언제까지 맡겼나」가
   * 보여야 한다.** 표의 줄은 지워지지 않지만 그것을 보는 화면은 본인 것뿐이라, 나중에 「이 건은 왜
   * 본인이 아닌 사람이 눌렀나」를 제3자가 되짚는 자리가 이력이다.
   *
   * 🔵 기간은 **사람이 적었던 날짜 그대로** 적는다 — `endsAt`(다음 날 0시)을 그리면 「26일까지
   *    맡겼네」로 읽힌다(실제로 적은 것은 25일까지다). 그래서 쓰는 쪽이 날짜 두 칸을 함께 남긴다.
   */
  if (row.action === "APPROVAL_DELEGATION_CREATED") {
    const lines: Line[] = [
      { text: `${String(d.delegateName ?? "")} 님에게 ${formatDelegationPeriod(String(d.startDate ?? ""), String(d.endDate ?? ""))} 동안 내 결재권을 맡김` },
    ];
    // 사유는 선택이다 — 비면 줄을 그리지 않는다(「없음」을 지어내지 않는다).
    if (d.reason) lines.push({ text: `사유: ${String(d.reason)}` });
    return lines;
  }
  if (row.action === "APPROVAL_DELEGATION_REVOKED") {
    return [{ text: `${String(d.delegateName ?? "")} 님에게 맡긴 위임(${String(d.endDate ?? "")}까지)을 되돌림` }];
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
  // O/H 부품 템플릿 (조각 8a) — 🔴 줄을 통째로 갈아 끼우는 저장이라, **이 줄만 읽고도 그때 무엇이
  // 들어 있었는지** 보여야 한다. 지난 줄을 되찾을 다른 자리가 없다.
  if (row.action === "OH_TEMPLATE_SAVED") {
    const items = Array.isArray(d.items) ? (d.items as Array<{ displayOrder?: unknown; partNameText?: unknown; quantity?: unknown; linked?: unknown }>) : [];
    const head = d.created
      ? "새 템플릿"
      : `${typeof d.previousVersion === "number" ? `${d.previousVersion}번째 판` : "이전 판"} → ${String(d.version ?? "")}번째 판`;
    const lines: Line[] = [{ text: `${head} · 기종 ${String(d.code ?? "")} · ${String(d.name ?? "")}` }];
    const previous = (d.previous ?? null) as { code?: unknown; name?: unknown } | null;
    // 머리 칸이 바뀐 것만 앞·뒤로 보여 준다. 안 바뀐 칸까지 줄을 만들면 부품 목록이 묻힌다.
    if (previous && String(previous.code ?? "") !== String(d.code ?? "")) {
      lines.push({ field: "기종 코드", before: String(previous.code ?? ""), after: String(d.code ?? "") });
    }
    if (previous && String(previous.name ?? "") !== String(d.name ?? "")) {
      lines.push({ field: "이름", before: String(previous.name ?? ""), after: String(d.name ?? "") });
    }
    lines.push({
      text:
        items.length === 0
          ? "부품 0줄 (비어 있음)"
          : `부품 ${items.length}줄: ${items
              .map((i) => `${String(i.displayOrder ?? "")}. ${String(i.partNameText ?? "")} ${String(i.quantity ?? "")}개${i.linked ? "" : " (재고 미연결)"}`)
              .join(" · ")}`,
    });
    return lines;
  }
  if (row.action === "OH_TEMPLATE_DELETED") {
    return [
      {
        text: (
          <>
            기종 {String(d.code ?? "")} · {String(d.name ?? "")} <span className="text-zinc-500">사유</span> {String(d.reason ?? "")}
          </>
        ),
      },
    ];
  }
  if (row.action === "OH_TEMPLATE_MODEL_LINKED" || row.action === "OH_TEMPLATE_MODEL_UNLINKED") {
    // 🔴 이름은 **그때 적어 둔 사본**이다. A/S 에서 이름이 바뀌어도 이 줄은 따라 바뀌지 않는다.
    const linked = row.action === "OH_TEMPLATE_MODEL_LINKED";
    return [{ text: `제품 모델 「${String(d.productModelName ?? "")}」 ${linked ? "연결" : "연결 해제"}` }];
  }
  if (row.action === "OH_PRICE_SET") {
    // 🔴 「정하지 않음」과 「0원」을 **다르게** 적는다. 둘을 같은 글자로 보이면 나중에 「왜 견적서에
    // 0원으로 나갔나」를 이력에서 가릴 수 없다(행이 없는 것과 0을 저장한 것은 다른 뜻이다).
    const won = (v: unknown) => (typeof v === "number" ? `₩${v.toLocaleString("ko-KR")}` : "(정하지 않음)");
    return [{ field: `O/H 단가 ${String(d.partName ?? "")}`, before: won(d.before), after: won(d.after) }];
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
