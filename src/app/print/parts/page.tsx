import { PrintActions } from "@/components/parts/PrintActions";
import { requireSession } from "@/lib/auth/session";
import { listPartItems } from "@/lib/parts/queries";
import { CATEGORY_LABEL, OWNER_LABEL, formatMoney, formatQuantity } from "@/lib/parts/codes";
import { PART_FIELDS, type PartFieldKey } from "@/lib/parts/field-order";
import { SEARCH_FIELDS, ALL_FIELD_KEYS } from "@/lib/parts/list-state";
import { selectPartsForState } from "@/lib/parts/selection";
import { todaySeoul } from "@/lib/stock/codes";

/**
 * 재고 현황 인쇄 `/print/parts?<목록 주소와 같은 조건>` (조각 6, REQUIREMENTS 3절).
 *
 * 「지금 조건에 맞는 부품 전체를 A4 가로로. 공급가·견적가를 넣고, 손으로 적는 "확인" 빈칸을 둔다.」
 * 목록 화면을 그대로 인쇄하지 않는 이유: 쪽 나누기·필터 상자·단추가 섞이고, 쪽마다 머리글을 되풀이하려면 표 하나짜리 화면이 맞다.
 * 머리말(앱 레이아웃) 없이 따로 둔 화면이라 세션 검사를 여기서 한다. 종이에 안 나올 것은 `.no-print`.
 */
export const metadata = { title: "재고 현황 인쇄" };

const TH = "border border-zinc-400 bg-zinc-100 px-1.5 py-1 text-left text-[10px] font-semibold whitespace-nowrap";
const TD = "border border-zinc-300 px-1.5 py-0.5 align-top text-[10px]";
/** 다섯 칸의 **꼴**만. 차례는 `PART_FIELDS` 가 쥔다(2026-10-16). */
const PRINT_CELL: Record<PartFieldKey, string> = {
  customerName: "",
  name: "font-medium",
  name2: "",
  kyosanPartNo: "font-mono",
  drawingNo: "font-mono",
};

export default async function PrintPartsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession("/print/parts");
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (one !== undefined) params.set(k, one);
  }
  const [{ rows, state, total }, items] = await Promise.all([selectPartsForState(params, session.user.id), listPartItems()]);
  const conditions = [
    state.q.trim() ? `찾기 「${state.q.trim()}」${state.fields.length < ALL_FIELD_KEYS.length ? ` (${SEARCH_FIELDS.filter((f) => state.fields.includes(f.key)).map((f) => f.label).join("·")})` : ""}` : "",
    state.item ? `항목 ${items.find((it) => it.code === state.item)?.name ?? state.item}` : "",
    state.category ? `분류 ${CATEGORY_LABEL[state.category as keyof typeof CATEGORY_LABEL] ?? state.category}` : "",
    state.owner ? `소유 ${OWNER_LABEL[state.owner as keyof typeof OWNER_LABEL] ?? state.owner}` : "",
    state.frequent ? "자주 사용하는 부품 위로" : "",
  ].filter(Boolean);

  return (
    <div className="min-h-full bg-white text-zinc-900">
      <PrintActions />
      <div className="p-4 print:p-0">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-base font-semibold">재고 현황</h1>
          <p className="text-[10px] text-zinc-600">
            {conditions.length > 0 ? `조건: ${conditions.join(" · ")} · ` : ""}
            {rows.length === total ? `부품 ${total}개` : `부품 ${rows.length}개 (전체 ${total}개 중)`} · 인쇄 {todaySeoul()} · {session.user.name}
          </p>
        </div>
        <table className="print-table w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} text-right`}>No.</th>
              {/* 🔴 다섯 칸의 차례는 `PART_FIELDS` 한 표가 쥔다 — 본문 <td> 도 같은 표를 돈다(2026-10-16). */}
              {PART_FIELDS.map((f) => (
                <th key={f.key} className={TH}>
                  {f.label}
                </th>
              ))}
              <th className={`${TH} text-right`}>수량</th>
              <th className={`${TH} text-right`}>공급가</th>
              <th className={`${TH} text-right`}>견적가</th>
              <th className={TH}>비고</th>
              <th className={TH}>항목</th>
              <th className={TH}>분류</th>
              <th className={TH}>소유</th>
              <th className={`${TH} w-16 text-center`}>확인</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="break-inside-avoid">
                <td className={`${TD} tabular text-right`}>{p.no}</td>
                {PART_FIELDS.map((f) => (
                  <td key={f.key} className={`${TD} ${PRINT_CELL[f.key]}`}>
                    {p[f.key] || "-"}
                  </td>
                ))}
                {/*
                  🔴 **종이에는 한계수량 빨강을 칠하지 않는다** (2026-10-16 결정, 화면에만 칠한다).
                     까닭 셋: ① 흑백으로 뽑으면 붉은 글씨가 **뜻 없는 회색**이 된다 — 색이 유일한
                     신호인데 그 신호가 인쇄에서 사라진다(이 화면은 `td` 에 `print-color-adjust`
                     를 걸지 않는다. 걸린 곳은 머리글 배경뿐이다 — globals.css).
                     ② 화면에서는 `title` 이 까닭을 말해 주지만 **종이에는 마우스가 없다.**
                     ③ 쓰는 분이 짚은 곳은 「재고현황 **표**」이고, 이 화면은 쓰임이 다르다
                     (손으로 적는 「확인」 칸이 있는 A4 가로).
                  🔵 종이에 뜻을 담으려면 색이 아니라 **글자**(한계수량 열이나 표식)가 필요한데,
                     그것은 열을 늘리는 설계 결정이라 쓰는 분 승인이 먼저다. **일부러 비워 둔 자리다.**
                */}
                <td className={`${TD} tabular text-right font-semibold`}>{formatQuantity(p.quantity)}</td>
                <td className={`${TD} tabular text-right whitespace-nowrap`}>{formatMoney(p.supplyPrice, p.supplyCurrency)}</td>
                <td className={`${TD} tabular text-right whitespace-nowrap`}>{formatMoney(p.quotePrice, "KRW")}</td>
                <td className={`${TD} max-w-72 whitespace-pre-wrap`}>{p.note}</td>
                <td className={`${TD} whitespace-nowrap`}>{p.itemName}</td>
                <td className={`${TD} whitespace-nowrap`}>{CATEGORY_LABEL[p.category]}</td>
                <td className={`${TD} whitespace-nowrap`}>{OWNER_LABEL[p.owner]}</td>
                <td className={TD} />
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className={`${TD} text-center text-zinc-500`} colSpan={14}>
                  이 조건에 맞는 부품이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
