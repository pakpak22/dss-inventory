import { PrintActions } from "@/components/parts/PrintActions";
import { requireSession } from "@/lib/auth/session";
import { listPartItems } from "@/lib/parts/queries";
import { CATEGORY_LABEL, OWNER_LABEL, formatMoney, formatQuantity } from "@/lib/parts/codes";
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
              <th className={TH}>품명</th>
              <th className={TH}>품명2</th>
              <th className={TH}>교산 품번</th>
              <th className={TH}>도번</th>
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
                <td className={`${TD} font-medium`}>{p.name}</td>
                <td className={TD}>{p.name2 || "-"}</td>
                <td className={`${TD} font-mono`}>{p.kyosanPartNo || "-"}</td>
                <td className={`${TD} font-mono`}>{p.drawingNo || "-"}</td>
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
                <td className={`${TD} text-center text-zinc-500`} colSpan={13}>
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
