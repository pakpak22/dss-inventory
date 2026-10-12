/**
 * 연도별 사용 수량과 「사용된 제품」의 순수 계산 (DESIGN 2-1·2-2·4-4절).
 *
 * 연도별 사용 수량 = 원장의 사용 − 그 사용에 대한 반환 − 취소한 것(원장 쪽은 SQL 이 센다, queries.ts)
 *                  + 과거 기록 중 **확인된 것**(CONFIRMED·GROUP_DECIDED)의 사용. 소유 불일치는 뺀다. 대여는 넣지 않는다.
 * 이 숫자를 보고 주문하므로(REQUIREMENTS 3절) 뺀 것은 화면에 「확인되지 않은 과거 기록 N건 제외」로 적는다.
 */

/** 기록의 연도. 날짜가 있으면 거기서, 없으면 적힌 글자(`2023-07-**`)의 앞 네 자리에서. 그것도 아니면 null. */
export function yearOf(occurredOn: string | null, dateText: string): number | null {
  const m = /^(\d{4})/.exec(occurredOn ?? dateText);
  return m ? Number(m[1]) : null;
}

/** 엑셀 사용처 글자 `인수번호_기종_S/N_L/N` 에서 기종. 그 모양이 아니면 빈 값. */
export function productModelOf(usagePlace: string): string {
  const parts = usagePlace.split("_");
  return parts.length >= 2 ? parts[1].trim() : "";
}

/** 부품 → 연도 → 수량. 같은 (부품, 연도) 는 더한다. */
export type YearlyMap = Map<string, Map<number, number>>;

export function addYearly(map: YearlyMap, partId: string, year: number, quantity: number): void {
  let y = map.get(partId);
  if (!y) map.set(partId, (y = new Map()));
  y.set(year, (y.get(year) ?? 0) + quantity);
}

export function mergeYearly(...maps: YearlyMap[]): YearlyMap {
  const out: YearlyMap = new Map();
  for (const m of maps) for (const [partId, years] of m) for (const [year, q] of years) addYearly(out, partId, year, q);
  return out;
}

/** 자료에 나오는 연도들, 최신이 앞. */
export function yearsIn(map: YearlyMap): number[] {
  const set = new Set<number>();
  for (const years of map.values()) for (const y of years.keys()) set.add(y);
  return [...set].sort((a, b) => b - a);
}

/** 클라이언트로 내려보낼 직렬화 모양: { partId: { "2024": 3 } } */
export type YearlyRecord = Record<string, Record<string, number>>;

export function toYearlyRecord(map: YearlyMap): YearlyRecord {
  const out: YearlyRecord = {};
  for (const [partId, years] of map) {
    const o: Record<string, number> = {};
    for (const [y, q] of [...years].sort((a, b) => a[0] - b[0])) o[String(y)] = q;
    out[partId] = o;
  }
  return out;
}
