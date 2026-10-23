import { formatMoney, formatQuantity, OWNER_LABEL } from "@/lib/parts/codes";
import type { Currency } from "@/db/schema/codes";
import { summarizeStockValue, usedCurrencies, type StockValueGroup, type StockValueRow } from "@/lib/parts/totals";

/**
 * ============================================================================
 * 재고 현황의 **부품 총 금액** 상자 (2026-10-23 쓰는 분 요청)
 * ============================================================================
 * 「검색 아래 우측의 빈 공간에 부품 총 금액(견적가, 공급가, 소유별로)」. 셈은 **수량 × 금액**이고
 * 셈하는 자리는 `@/lib/parts/totals` 다 — 이 저장소에는 화면 렌더 시험이 없어서, 돌려 볼 수
 * 있어야 하는 것은 순수 함수로 내려 둔다.
 *
 * 🔴 **금액 칸이 통화마다 선다.** 견적가는 언제나 원이지만 공급가는 부품마다 엔·원이 갈린다.
 *    한 칸에 뭉쳐 더하면 오류 없이 뜻 없는 숫자가 된다(그쪽 머리말).
 * 🔴 **금액이 비어 있는 부품 수를 적는다.** 적게 나온 합계를 전부인 것처럼 보이게 두지 않는다.
 * 🔵 **종이에는 안 나간다**(`no-print`) — 이 상자는 지금 거르개를 비추는 값이라, 조건이 안 적힌
 *    종이에 총액만 찍히면 무엇의 합계인지 알 수 없다. 인쇄는 전용 화면이 따로 있다.
 *
 * ── 🔴 좁은 화면은 **표가 아니다** (2026-10-23 눈 확인 뒤 고침) ────────────
 * 처음에는 어느 폭에서나 표를 그리고 넘치면 좌우로 굴리게 했는데, 폭 360px 짜리 폰에서는
 * **합계 줄의 견적가가 화면 밖으로 잘려** 제일 큰 숫자를 보려면 옆으로 밀어야 했다.
 * 총액은 훑어보는 값이라 **미는 순간 못 쓴다.** → `lg` 미만에서는 소유마다 **세로로 쌓는다.**
 *
 * 🔴 **두 모양이 같은 자료를 본다.** 숫자를 짓는 자리(`cells`)가 하나라, 한쪽만 고쳐져
 *    「표와 목록이 다른 금액을 말하는」 일이 생기지 않는다. 열 차례(공급가 → 견적가)도 거기
 *    한 곳에만 적혀 있다.
 * ============================================================================
 */

/** 열 이름. 🔵 통화를 적는다 — 「공급가」만으로는 엔인지 원인지 알 길이 없다. */
const supplyLabel = (c: Currency) => `공급가 (${c === "JPY" ? "엔" : "원"})`;

export function StockTotals({ rows, className = "" }: { rows: readonly StockValueRow[]; className?: string }) {
  const summary = summarizeStockValue(rows);
  const currencies = usedCurrencies(rows);

  // 🔵 셀 것이 없으면 빈 상자를 세우지 않는다 — 「₩0」은 0원어치 있다는 뜻으로 읽힌다.
  if (summary.total.parts === 0) return null;

  /**
   * 🔴 **금액 칸을 짓는 유일한 자리.** 차례는 **공급가 → 견적가**다(2026-10-23 쓰는 분 지정).
   *    표와 좁은 화면 목록이 **둘 다 이것을 돈다** — 한쪽에 다시 적으면 열 이름과 숫자가
   *    어긋나는 날이 오는데, 그것은 오류가 아니라 **틀린 금액**이라 아무도 신고하지 않는다.
   */
  const cells = (group: StockValueGroup) => [
    ...currencies.map((c) => ({ key: c as string, label: supplyLabel(c), text: formatMoney(group.supply[c], c) })),
    { key: "quote", label: "견적가", text: formatMoney(group.quote, "KRW") },
  ];

  /** 소유 줄들 + (둘 이상일 때만) 합계 줄. 🔵 소유가 하나뿐이면 합계는 바로 위와 같은 숫자다. */
  const lines = [
    ...summary.byOwner.map((g) => ({ key: g.owner, label: OWNER_LABEL[g.owner], group: g as StockValueGroup, sum: false })),
    ...(summary.byOwner.length > 1 ? [{ key: "TOTAL", label: "합계", group: summary.total, sum: true }] : []),
  ];

  const missing = summary.total.quoteMissing + summary.total.supplyMissing;
  const TH = "py-0.5 pl-4 text-right font-normal";

  return (
    // 🔵 `lg:w-fit` 로 내용만큼만 차지한다 — 좁은 화면에서는 제 폭으로 펴진다.
    <div className={`no-print rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 lg:w-fit ${className}`}>
      <p className="text-xs font-semibold break-keep text-zinc-800">
        부품 총 금액 <span className="font-normal text-zinc-500">(수량 × 금액 · 지금 조건에 맞는 {formatQuantity(summary.total.parts)}개)</span>
      </p>

      {/* ── 좁은 화면: 소유마다 세로로 쌓는다. 가로로 미는 일이 없다. ── */}
      <ul className="mt-1.5 flex flex-col gap-1.5 lg:hidden">
        {lines.map((line) => (
          <li key={line.key} className={line.sum ? "border-t-2 border-zinc-300 pt-1.5" : "border-t border-zinc-200 pt-1.5 first:border-t-0 first:pt-0"}>
            <div className={`flex items-baseline justify-between gap-2 ${line.sum ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>
              <span className="text-xs break-keep">{line.label}</span>
              <span className="tabular text-xs whitespace-nowrap">{formatQuantity(line.group.quantity)}개</span>
            </div>
            <dl className="mt-0.5 flex flex-col gap-0.5">
              {cells(line.group).map((cell) => (
                <div key={cell.key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs whitespace-nowrap text-zinc-400">{cell.label}</dt>
                  <dd className={`tabular text-xs whitespace-nowrap ${line.sum ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>{cell.text}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* ── 넓은 화면: 표. 열이 줄 맞춰 서야 소유끼리 견주기 쉽다. ── */}
      <table className="mt-1.5 hidden w-full text-xs lg:table">
        <thead>
          <tr className="text-zinc-400">
            <th scope="col" className="py-0.5 pr-2 text-left font-normal">
              소유
            </th>
            <th scope="col" className={TH}>
              수량
            </th>
            {cells(summary.total).map((cell) => (
              <th key={cell.key} scope="col" className={TH}>
                {cell.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.key}
              className={line.sum ? "border-t-2 border-zinc-300 font-semibold text-zinc-900" : "border-t border-zinc-200 text-zinc-700"}
            >
              <th scope="row" className={`${line.sum ? "pt-1 pb-0.5" : "py-0.5"} pr-2 text-left whitespace-nowrap ${line.sum ? "" : "font-normal"}`}>
                {line.label}
              </th>
              <td className={`tabular ${line.sum ? "pt-1 pb-0.5" : "py-0.5"} pl-4 text-right whitespace-nowrap`}>{formatQuantity(line.group.quantity)}</td>
              {cells(line.group).map((cell) => (
                <td key={cell.key} className={`tabular ${line.sum ? "pt-1 pb-0.5" : "py-0.5"} pl-4 text-right whitespace-nowrap`}>
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 🔴 못 센 부품을 **말한다.** 안 적으면 적게 나온 합계가 전부인 것처럼 보인다. */}
      {missing > 0 ? (
        <p className="mt-1.5 text-xs break-keep text-amber-800" title="금액 칸이 비어 있는 부품입니다. 0원이 아니라 아직 적지 않은 것이라 합계에 넣지 않았습니다.">
          금액이 비어 합계에서 빠진 부품: 견적가 {summary.total.quoteMissing}개 · 공급가 {summary.total.supplyMissing}개
        </p>
      ) : null}
    </div>
  );
}
