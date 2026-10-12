import "server-only";
import { usageByMonth } from "@/lib/legacy/queries";
import { listFavoritePartIds } from "@/lib/parts/favorites";
import { currentMonthSeoul, frequentValues } from "@/lib/parts/frequent";
import { applyFilter, applyPins, applySort, parseListState, type ListState } from "@/lib/parts/list-state";
import { listParts } from "@/lib/parts/queries";
import type { PartRow } from "@/lib/parts/types";

/**
 * 「지금 조건에 맞는 부품 전체」를 **화면과 같은 차례로** (조각 6: 인쇄·엑셀 내려받기, REQUIREMENTS 3절).
 *
 * 목록 화면의 찾기·거르기·정렬·위로 올리기는 전부 순수 함수(list-state.ts)라 서버에서도 같은 주소로 같은 결과가 나온다.
 * 쪽 나누기와 상세 창은 무시한다 — 인쇄·내려받기는 전체다. 즐겨찾기는 그 사람 것이라 userId 가 필요하다.
 */
export async function selectPartsForState(params: URLSearchParams, userId: string): Promise<{ rows: PartRow[]; state: ListState; total: number }> {
  const state = parseListState(params);
  const [all, favorites, monthly] = await Promise.all([listParts(), listFavoritePartIds(userId), usageByMonth()]);
  const frequent = frequentValues(monthly, state.rule, currentMonthSeoul());
  const rows = applyPins(applySort(applyFilter(all, state), state), new Set(favorites), frequent, state);
  return { rows, state, total: all.length };
}
