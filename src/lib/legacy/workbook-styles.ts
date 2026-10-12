/**
 * 공급가의 통화(¥·₩)는 **칸 서식**에만 있다 — 값 칸에는 숫자뿐이다. sheet-grid 는 서식을 읽지 않으므로
 * 여기서 styles.xml 의 셀 서식 표(cellXfs)와 시트 XML 의 `s="N"` 을 직접 본다. 순수 함수 둘.
 *
 * 2026-10-01 현황판: numFmt 176 `[$¥-411]#,##0`(252줄), 177 `[$₩-412]#,##0`(2줄). ₩ 가 아니면 전부 엔으로 본다 —
 * 「엔이 기본, 국내 구매품만 원」(REQUIREMENTS 4-1절).
 */

/** cellXfs 의 몇 번째 서식(0부터)이 ₩ 인가 */
export function readKrwStyleIndexes(stylesXml: string): Set<number> {
  const krwFormatIds = new Set<string>();
  for (const m of stylesXml.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)) {
    if (m[2].includes("₩") || m[2].includes("&#8361;")) krwFormatIds.add(m[1]);
  }
  const out = new Set<number>();
  const block = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!block) return out;
  let i = 0;
  for (const xf of block[1].matchAll(/<xf\b[^>]*?\/?>/g)) {
    const id = /numFmtId="(\d+)"/.exec(xf[0])?.[1];
    if (id !== undefined && krwFormatIds.has(id)) out.add(i);
    i++;
  }
  return out;
}

/** 시트 XML 에서 한 열의 줄별 서식 번호. `<c r="G5" s="6" …>` 의 s. s 가 없는 칸은 0. */
export function readColumnStyleIndexes(sheetXml: string, column: string): Map<number, number> {
  const out = new Map<number, number>();
  const re = new RegExp(`<c\\s+r="${column}(\\d+)"([^>]*?)/?>`, "g");
  for (const m of sheetXml.matchAll(re)) {
    const s = /\bs="(\d+)"/.exec(m[2])?.[1];
    out.set(Number(m[1]), s === undefined ? 0 : Number(s));
  }
  return out;
}
