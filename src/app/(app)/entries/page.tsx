import Link from "next/link";
import { CorrectButton, ReverifyButton } from "@/components/stock/EntryActions";
import { roleAtLeast } from "@/lib/auth/role";
import { requireSession } from "@/lib/auth/session";
import { OWNER_LABEL, formatQuantity } from "@/lib/parts/codes";
import { PART_FIELDS, type PartFieldKey } from "@/lib/parts/field-order";
import { CHARGE_LABEL, ENTRY_TYPES, ENTRY_TYPE_LABEL, PURPOSE_LABEL, formatDelta, sheetNoText, sheetOf } from "@/lib/stock/codes";
import { ALL_PART_SEARCH_FIELDS, PART_SEARCH_FIELDS, parseEntryListFilter } from "@/lib/stock/form";
import { requestSavedNotice, type RequestNotice } from "@/lib/stock/request-notice";
import { listEntries, type EntryLineRow, type EntryRow } from "@/lib/stock/queries";

/**
 * 기록 내역 `/entries` (모두, DESIGN 2-5절). 날짜 역순, 종류·기간·부품·담당·인수번호·「인수번호 확인 안 됨」으로 거르기.
 * [기록 취소] 는 관리자, [확인] 은 기록·관리자. 거르기는 주소에 담는다(평범한 GET 폼).
 *
 * 🔴 **맨 위의 「확인 대기」 구역은 2026-10-15 사용자 결정으로 걷어냈다.** 같은 날 생긴 부품 요청 관리
 *    (`/requests`)가 **같은 신청을 상태까지 다 보여 주어** 한 신청이 두 화면에 뜨고 있었다. 신청을 보고
 *    처리하는 자리는 이제 `/requests` 하나이고(머리말 「대기 N」 배지도 그 옆에 선다), 여기는 **수량이
 *    움직인 기록**만 다룬다. 신청자가 자기 신청을 거두는 [신청 취소]도 그 화면으로 옮겼다 —
 *    기능이 사라진 것이 아니라 자리가 하나로 모인 것이다(`RequestManagerScreen`).
 */
export const metadata = { title: "기록 내역" };

const FLABEL = "flex flex-col gap-1.5 text-sm font-medium text-zinc-700";
const FINPUT = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900";
const BTN = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100";
const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
/**
 * 다섯 칸의 **값과 꼴**. 🔴 차례는 여기 없다 — `PART_FIELDS` 를 돌면서 이 표를 찾아 쓴다(2026-10-16).
 * 줄이 들고 있는 칸 이름은 `part` 가 앞에 붙어(`partName2`) 부품 쪽 칸 이름과 다르므로 여기서 잇는다.
 */
const ENTRY_PART_CELL: Record<PartFieldKey, { td: string; of: (l: EntryLineRow) => string }> = {
  customerName: { td: "", of: (l) => l.partCustomerName },
  name: { td: "font-medium whitespace-nowrap text-zinc-900", of: (l) => l.partName },
  name2: { td: "whitespace-nowrap", of: (l) => l.partName2 },
  kyosanPartNo: { td: "font-mono whitespace-nowrap", of: (l) => l.partKyosanPartNo },
  drawingNo: { td: "font-mono whitespace-nowrap", of: (l) => l.partDrawingNo },
};

/** 저장 결과 한 줄. 회색은 알림, 주황은 **아직 남은 것이 있다**는 뜻 (부품 요청 관리 화면과 같은 모양). */
const NOTICE: Record<RequestNotice["tone"], string> = {
  info: "rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700",
  warn: "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900",
};

function typeBadge(type: EntryRow["type"]) {
  const color =
    type === "RECEIVE" || type === "RETURN" || type === "OPENING"
      ? "bg-emerald-50 text-emerald-800"
      : type === "USE" || type === "LOAN" || type === "DISPOSE"
        ? "bg-blue-50 text-blue-800"
        : type === "CORRECTION"
          ? "bg-red-50 text-red-800"
          : "bg-zinc-100 text-zinc-700";
  return <span className={`${BADGE} ${color}`}>{ENTRY_TYPE_LABEL[type]}</span>;
}

/**
 * 대제목 (2026-10-06 사용자 요청): 수리 건이면 **인수번호**, 수리 건이 없는 사용이면 「기타 사용」, 나머지는 종류와 상대·사유.
 * 아래 표는 엑셀 사용처 기입란·입고 기입란·수량 변경 기록의 칸을 그대로 보인다.
 */
function entryTitle(e: EntryRow): string {
  switch (e.type) {
    case "USE":
      return e.noRepairCase ? `기타 사용${e.reason ? ` — ${e.reason}` : ""}` : e.intakeNumber;
    case "LOAN":
      return `대여${e.counterparty ? ` — ${e.counterparty}` : ""}`;
    case "DISPOSE":
      return `폐기·불량${e.reason ? ` — ${e.reason}` : ""}`;
    case "ADJUST":
      return `조정${e.reason ? ` — ${e.reason}` : ""}`;
    case "CORRECTION":
      return `기록 취소${e.reason ? ` — ${e.reason}` : ""}`;
    default:
      return ENTRY_TYPE_LABEL[e.type];
  }
}

export default async function EntriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession("/entries");
  const canRecord = roleAtLeast(session.user.role, "STAFF");
  const isAdmin = roleAtLeast(session.user.role, "ADMIN");
  const sp = await searchParams;
  const f = parseEntryListFilter(sp);
  /**
   * **기록이 저장된** 뒤의 한 줄 — 기록 번호와 「인수번호 확인 안 됨」 (2026-10-15, 조각 10c).
   *
   * 🔴 **남긴 까닭**: 바로 원장에 적히는 길이 아직 이 화면으로 온다 — [기록 취소](`correctTransactionAction`)가
   *    `?saved=CH-…&type=CORRECTION` 으로 돌아온다. 지우면 취소해 놓고 아무 말이 없어진다.
   * 🔴 **결정 알림(`requestDecisionNotice` — 반려·마감·보류·보류 해제·신청 취소)은 걷어냈다.** 그 꼬리표는
   *    요청 단추가 붙이는 것이고, 단추는 이제 부품 요청 관리(`/requests`)에만 있다.
   * 🔵 문구는 그 화면과 **같은 한 벌**에서 온다(`request-notice.ts`) — 같은 일을 두 화면이 다르게 말하지 않게.
   */
  const savedNotice = requestSavedNotice(sp, "entries");
  const { rows, total, pageSize } = await listEntries(f);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (f.page - 1) * pageSize + 1;
  const to = Math.min(total, f.page * pageSize);
  const hasFilter = Boolean(f.type || f.from || f.to || f.partText || f.actor || f.text || f.intakeNumber || f.unverifiedOnly);
  const partFieldLabels = PART_SEARCH_FIELDS.filter((x) => f.partFields.includes(x.key)).map((x) => x.label);
  const conditionText = [
    f.type ? `종류 ${ENTRY_TYPE_LABEL[f.type]}` : "",
    f.from || f.to ? `날짜 ${f.from ?? ""}~${f.to ?? ""}` : "",
    f.partText ? `부품 「${f.partText}」${f.partFields.length < ALL_PART_SEARCH_FIELDS.length ? ` (${partFieldLabels.join("·")}에서)` : ""}` : "",
    f.actor ? `담당 「${f.actor}」` : "",
    f.text ? `내용 「${f.text}」` : "",
    f.intakeNumber ? `인수번호 「${f.intakeNumber}」` : "",
    f.unverifiedOnly ? "인수번호 확인 안 됨만" : "",
  ].filter(Boolean);
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (f.type) q.set("type", f.type);
    if (f.from) q.set("from", f.from);
    if (f.to) q.set("to", f.to);
    if (f.partText) q.set("part", f.partText);
    if (f.partFields.length < ALL_PART_SEARCH_FIELDS.length) q.set("pf", f.partFields.join(","));
    if (f.actor) q.set("actor", f.actor);
    if (f.text) q.set("text", f.text);
    if (f.intakeNumber) q.set("intake", f.intakeNumber);
    if (f.unverifiedOnly) q.set("unverified", "1");
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/entries?${s}` : "/entries";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900">기록 내역</h1>
        {canRecord ? (
          <Link href="/entries/new" className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800">
            수량 변경 기록
          </Link>
        ) : null}
      </div>

      <p className="text-xs text-zinc-500">
        수량이 움직인 기록입니다. 잘못 적은 줄은 지우지 않고 <b>[기록 취소]</b>로 되돌리는 줄을 새로 쌓습니다(관리자). 「인수번호 확인 안 됨」은 A/S 가 응답하지 않아 확인을 미룬 것이고 [확인]으로 다시 묻습니다.
      </p>

      {/* 저장 결과 — 기록 번호와 「인수번호 확인 안 됨」. 🔵 글자는 부품 요청 관리와 같은 한 벌에서 온다(위 savedNotice 주석). */}
      {savedNotice ? <p className={NOTICE[savedNotice.tone]}>{savedNotice.text}</p> : null}

      <form method="get" action="/entries" className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 no-print">
        <h2 className="text-base font-semibold text-zinc-900">필터</h2>

        {/* 배치는 자주 쓰는 순서 (2026-10-07 사용자): 부품 → 인수번호·날짜·종류 → 담당·내용은 접어 둠(비고로 찾을 일은 거의 없음) */}
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <label className={FLABEL}>
            부품 찾기
            <input name="part" defaultValue={f.partText} className={FINPUT} placeholder="예: 7, AMP-DEH, WR10136, C0907…" />
          </label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm font-medium text-zinc-700">찾을 곳</span>
            {PART_SEARCH_FIELDS.map((x) => (
              <label key={x.key} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-800">
                <input type="checkbox" name="pf" value={x.key} defaultChecked={f.partFields.includes(x.key)} className="h-4 w-4" />
                {x.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className={FLABEL}>
            인수번호 (일부만 쳐도 됨)
            <input name="intake" defaultValue={f.intakeNumber} className={`${FINPUT} font-mono uppercase`} placeholder="예: D2607" aria-label="인수번호" />
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-normal text-zinc-800">
              <input type="checkbox" name="unverified" value="1" defaultChecked={f.unverifiedOnly} className="h-4 w-4" />
              인수번호 확인 안 됨만
            </label>
          </div>
          <div className={FLABEL}>
            날짜
            <div className="flex items-center gap-2">
              <input type="date" name="from" defaultValue={f.from ?? ""} className={FINPUT} aria-label="날짜 부터" />
              <span className="text-zinc-500">~</span>
              <input type="date" name="to" defaultValue={f.to ?? ""} className={FINPUT} aria-label="날짜 까지" />
            </div>
          </div>
          <label className={FLABEL}>
            종류
            <select name="type" defaultValue={f.type ?? ""} className={FINPUT}>
              <option value="">전체</option>
              {ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ENTRY_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <details open={Boolean(f.actor || f.text)} className="rounded-md border border-dashed border-zinc-300 px-3 py-2">
          <summary className="cursor-pointer text-sm text-zinc-600 select-none">담당·내용으로 찾기 (자주 안 씀)</summary>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={FLABEL}>
              담당 (신청자·기록자·확인자 이름)
              <input name="actor" defaultValue={f.actor} className={FINPUT} placeholder="예: 정영빈" />
            </label>
            <label className={FLABEL}>
              {/* 「고객명」 → 「고객사 이름」: 부품 찾기에 「고객사 품명」이 생겨 둘이 나란히 보인다. 다른 것이니 라벨을 갈라 둔다. */}
              내용 (사유·빌려준 곳·고객사 이름·사용처·비고)
              <input name="text" defaultValue={f.text} className={FINPUT} placeholder="예: 상해수리소, 불량, 실사…" />
            </label>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            필터 적용
          </button>
          {hasFilter ? (
            <Link href="/entries" className={BTN}>
              조건 지우기
            </Link>
          ) : null}
          <span className="text-xs text-zinc-500">조건을 넣고 [필터 적용]을 누르거나 칸에서 Enter 를 치십시오.</span>
        </div>
      </form>

      {hasFilter ? (
        <p className="text-sm text-zinc-700">
          <span className="text-zinc-500">적용된 조건:</span> {conditionText.join(" · ")} <span className="text-zinc-500">→ {total}건</span>
        </p>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">{hasFilter ? "이 조건의 기록이 없습니다." : "아직 쌓인 기록이 없습니다."}</div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {rows.map((e) => {
              const sheet = sheetOf(e.type);
              const purposeActor = e.purpose ? `${e.purpose === "OTHER" ? e.purposeText || "기타" : PURPOSE_LABEL[e.purpose]}/${e.createdByName}` : e.createdByName;
              const TH = "px-2 py-1.5 font-medium whitespace-nowrap";
              const TD = "px-2 py-1 align-top";
              return (
                <li key={e.id} className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="tabular rounded-md bg-zinc-900 px-2 py-0.5 text-sm font-semibold text-white">{sheetNoText(e.type, e.sheetYear, e.sheetNo)}</span>
                    <h3 className="text-base font-semibold text-zinc-900">{entryTitle(e)}</h3>
                    {typeBadge(e.type)}
                    {e.intakeUnverified ? <span className={`${BADGE} bg-amber-100 text-amber-900`}>인수번호 확인 안 됨</span> : null}
                    <span className="tabular text-sm text-zinc-700">{e.occurredOn}</span>
                    <span className="text-sm text-zinc-700">
                      {e.confirmedByName ? (
                        <>
                          <span className="text-zinc-500">신청자:</span> <b>{e.createdByName}</b> <span className="text-zinc-500">· 확인자:</span> <b>{e.confirmedByName}</b>
                        </>
                      ) : (
                        <>
                          <span className="text-zinc-500">기록자:</span> <b>{e.createdByName}</b>
                        </>
                      )}
                    </span>
                    {e.intakeUnverified && canRecord ? <ReverifyButton entryId={e.id} /> : null}
                  </div>
                  {e.type === "USE" && (e.customerName || e.productModel || e.usagePlace) ? (
                    <p className="text-sm text-zinc-700">
                      {[e.customerName, e.productModel].filter(Boolean).join(" · ")}
                      {e.usagePlace ? <span className="font-mono text-xs text-zinc-500"> {e.usagePlace}</span> : null}
                    </p>
                  ) : null}
                  {e.note ? <p className="text-sm text-zinc-600">비고: {e.note}</p> : null}
                  <div className="overflow-x-auto rounded-md border border-zinc-200">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-50 text-left text-zinc-500">
                          <th className={TH}>No.</th>
                          <th className={TH}>날짜</th>
                          {sheet === "USE" ? <th className={TH}>인수번호</th> : null}
                          {sheet === "CHANGE" ? <th className={TH}>종류</th> : null}
                          {/* 🔴 다섯 칸의 차례는 `PART_FIELDS` 한 표가 쥔다 — 본문 <td> 도 같은 표를 돈다.
                              2026-10-16 까지 이 표만 **교산 품번과 도번이 뒤바뀌어** 있었다. */}
                          {PART_FIELDS.map((f) => (
                            <th key={f.key} className={TH}>
                              {f.label}
                            </th>
                          ))}
                          <th className={`${TH} text-right`}>현 재고</th>
                          <th className={`${TH} text-right`}>{sheet === "USE" ? "사용 재고" : sheet === "RECEIVE" ? "입고" : "변동"}</th>
                          <th className={`${TH} text-right`}>이후 재고</th>
                          {sheet === "USE" ? <th className={TH}>목적 및 출하담당</th> : null}
                          {sheet === "CHANGE" ? <th className={TH}>담당</th> : null}
                          <th className={TH}>비고</th>
                          <th className={TH}>소유</th>
                          {sheet === "USE" ? <th className={TH}>유상·무상</th> : null}
                          {sheet === "USE" ? <th className={TH}>사용처</th> : null}
                          {sheet === "CHANGE" ? <th className={TH}>상대</th> : null}
                          <th className={`${TH} no-print`} />
                        </tr>
                      </thead>
                      <tbody>
                        {e.lines.map((l) => (
                          <tr key={l.id} className={`border-t border-zinc-100 ${l.corrected ? "text-zinc-400 line-through" : ""}`}>
                            <td className={`${TD} tabular whitespace-nowrap text-zinc-500`}>{sheetNoText(e.type, e.sheetYear, e.sheetNo)}</td>
                            <td className={`${TD} tabular whitespace-nowrap`}>{e.occurredOn}</td>
                            {sheet === "USE" ? <td className={`${TD} font-mono whitespace-nowrap`}>{e.noRepairCase ? "-" : e.intakeNumber}</td> : null}
                            {sheet === "CHANGE" ? <td className={`${TD} whitespace-nowrap`}>{ENTRY_TYPE_LABEL[e.type]}</td> : null}
                            {/* 🔴 머리글과 **같은 표**(PART_FIELDS)를 돈다. 값과 꼴은 ENTRY_PART_CELL.
                                품명 칸만 부품 상세로 가는 링크가 되고, 고객사 품명은 아주 긴 이름이 와도 이미
                                넓은 이 표가 더 밀리지 않게 상한을 두고 넘치면 …(전체는 마우스로). */}
                            {PART_FIELDS.map((f) => {
                              const cell = ENTRY_PART_CELL[f.key];
                              return (
                                <td key={f.key} className={`${TD} ${cell.td}`} title={f.key === "customerName" ? l.partCustomerName : undefined}>
                                  {f.key === "name" ? (
                                    <Link href={`/?part=${l.partNo}`} className="underline decoration-zinc-300">
                                      <span className="font-normal text-zinc-500">No. {l.partNo}</span> {l.partName}
                                    </Link>
                                  ) : f.key === "customerName" ? (
                                    <span className="block max-w-48 truncate">{l.partCustomerName || "-"}</span>
                                  ) : (
                                    cell.of(l) || "-"
                                  )}
                                </td>
                              );
                            })}
                            <td className={`${TD} tabular text-right whitespace-nowrap`}>{formatQuantity(l.quantityBefore)}</td>
                            <td className={`${TD} tabular text-right whitespace-nowrap font-semibold`}>{sheet === "CHANGE" ? formatDelta(l.delta) : formatQuantity(Math.abs(l.delta))}</td>
                            <td className={`${TD} tabular text-right whitespace-nowrap`}>{formatQuantity(l.quantityAfter)}</td>
                            {sheet === "USE" ? <td className={`${TD} whitespace-nowrap`}>{purposeActor}</td> : null}
                            {sheet === "CHANGE" ? <td className={`${TD} whitespace-nowrap`}>{e.createdByName}</td> : null}
                            <td className={`${TD} max-w-64`}>
                              {l.note || (e.type === "DISPOSE" || e.type === "ADJUST" || e.type === "CORRECTION" ? e.reason : "")}
                              {l.corrected ? <span className={`${BADGE} ml-1 bg-red-50 text-red-800 no-underline`}>취소됨</span> : null}
                              {l.reversesTransactionId ? <span className="ml-1 text-zinc-500">(되돌림)</span> : null}
                            </td>
                            <td className={`${TD} whitespace-nowrap`}>{OWNER_LABEL[l.owner as keyof typeof OWNER_LABEL]}</td>
                            {sheet === "USE" ? <td className={`${TD} whitespace-nowrap`}>{l.chargeType ? CHARGE_LABEL[l.chargeType] : "-"}</td> : null}
                            {sheet === "USE" ? <td className={`${TD} font-mono whitespace-nowrap`}>{e.usagePlace || (e.noRepairCase ? e.reason : "-")}</td> : null}
                            {sheet === "CHANGE" ? (
                              <td className={`${TD} whitespace-nowrap`}>
                                {e.type === "LOAN"
                                  ? e.counterparty
                                  : e.type === "TRANSFER"
                                    ? e.lines
                                        .filter((o) => o.id !== l.id)
                                        .map((o) => `No. ${o.partNo} ${OWNER_LABEL[o.owner as keyof typeof OWNER_LABEL]}`)
                                        .join(", ")
                                    : e.type === "RETURN" && l.returnsTransactionId
                                      ? "원래 기록 되돌림"
                                      : "-"}
                              </td>
                            ) : null}
                            <td className={`${TD} text-right whitespace-nowrap no-print`}>
                              {isAdmin && !l.corrected && e.type !== "CORRECTION" ? (
                                <CorrectButton transactionId={l.id} label={`${e.occurredOn} ${ENTRY_TYPE_LABEL[e.type]} · No. ${l.partNo} ${l.partName} ${formatDelta(l.delta)}`} />
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 text-sm text-zinc-500">
          <span className="tabular">
            전체 {total}건 중 {from}-{to}건
          </span>
          <span className="flex items-center gap-2">
            {f.page > 1 ? (
              <Link href={href(f.page - 1)} className={BTN}>
                이전
              </Link>
            ) : (
              <span className={`${BTN} opacity-50`}>이전</span>
            )}
            <span className="tabular">
              {f.page} / {pages}
            </span>
            {f.page < pages ? (
              <Link href={href(f.page + 1)} className={BTN}>
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
