import { clampMin, clampMonths, DEFAULT_RULE, isFrequentMode, type FrequentRule } from "./frequent";
import type { PartRow } from "./types";

/**
 * 재고 현황 목록의 **상태와 계산** — 전부 순수 함수다. 브라우저도 DB 도 모른다.
 * 화면(`PartsList.tsx`)은 이것을 부르기만 하고, 시험(`tests/list-state.test.ts`)은 DB 없이 돈다.
 *
 * 찾기·거르기·정렬·쪽은 **주소(searchParams)에 담는다** (DESIGN 2-1절, CLAUDE.md 9-7절).
 * 뒤로 가기를 누르면 보던 조건으로 돌아오고, 주소를 복사해 주면 같은 화면이 열린다.
 * 기본값과 같은 것은 주소에 쓰지 않는다 — 아무것도 안 고른 첫 화면의 주소는 `/` 그대로다.
 */

/**
 * 찾을 곳. 표에 보이는 글자 칸들. 키는 주소에 들어가므로 짧게 — **이미 쓰는 글자와 겹치면 안 된다**
 * (겹치면 주소에 담긴 옛 설정이 엉뚱한 칸으로 읽힌다).
 *
 * 🔴 **차례는 `src/lib/parts/field-order.ts` 의 `PART_FIELDS` 를 따른다**(2026-10-16) — 표의 열 차례도
 * 그 표가 쥐고 있어 둘이 저절로 맞는다. 비고는 그 다섯에 없는 칸이라 뒤에 따로 선다.
 * 라벨로 맞물린 것을 `tests/part-field-order.test.ts` 가 잰다.
 */
export const SEARCH_FIELDS = [
  { key: "c", field: "customerName", label: "고객사 품명" },
  { key: "a", field: "name", label: "품명" },
  { key: "b", field: "name2", label: "품명2" },
  { key: "p", field: "kyosanPartNo", label: "교산 품번" },
  { key: "d", field: "drawingNo", label: "도번" },
  { key: "m", field: "note", label: "비고" },
] as const;
export type SearchFieldKey = (typeof SEARCH_FIELDS)[number]["key"];
export type SearchField = (typeof SEARCH_FIELDS)[number]["field"];

export const ALL_FIELD_KEYS: readonly SearchFieldKey[] = SEARCH_FIELDS.map((f) => f.key);

/** 정렬할 수 있는 칸. 머리글을 누르면 바뀐다. */
export const SORT_KEYS = [
  "no",
  "customerName",
  "name",
  "name2",
  "kyosanPartNo",
  "drawingNo",
  "quantity",
  "supplyPrice",
  "quotePrice",
  "note",
  "itemName",
  "category",
  "owner",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
const NUMERIC_SORT: ReadonlySet<SortKey> = new Set<SortKey>(["no", "quantity", "supplyPrice", "quotePrice"]);

/** 한 쪽에 보일 건수. 0 = 전체 (기본, REQUIREMENTS 3절 「한 번에 전체 보기가 기본」). */
export const PAGE_SIZES = [0, 10, 20, 50] as const;

export interface ListState {
  q: string;
  /** 찾을 곳. 비지 않는다 — 하나 이상 남긴다. */
  fields: SearchFieldKey[];
  /** 항목 코드. "" = 전체 */
  item: string;
  /** 분류 코드. "" = 전체 */
  category: string;
  /** 소유 코드. "" = 전체 */
  owner: string;
  sort: SortKey;
  desc: boolean;
  page: number;
  size: number;
  /** 상세 창에 띄울 부품 No. null = 닫힘 */
  part: number | null;
  /** 연도별 사용 수량 칸을 켠 연도들 (조각 5, DESIGN 2-1절). 비어 있으면 칸 없음. 최신이 앞. */
  years: number[];
  /** 「자주 사용하는 부품 위로」 체크 (2026-10-07). 주소 `freq=1`. */
  frequent: boolean;
  /** 자주 사용 기준 (2026-10-07): 횟수/수량(`fm`), 최근 N개월(`fp`, 짝수 2~36), 기준 숫자(`ft`). 기본값과 같으면 주소에 없다. */
  rule: FrequentRule;
}

export const DEFAULT_STATE: ListState = {
  q: "",
  fields: [...ALL_FIELD_KEYS],
  item: "",
  category: "",
  owner: "",
  sort: "no",
  desc: false,
  page: 1,
  size: 0,
  part: null,
  years: [],
  frequent: false,
  rule: { ...DEFAULT_RULE },
};

type ParamSource = { get(name: string): string | null };

function isSortKey(v: string): v is SortKey {
  return (SORT_KEYS as readonly string[]).includes(v);
}
function isFieldKey(v: string): v is SearchFieldKey {
  return (ALL_FIELD_KEYS as readonly string[]).includes(v);
}

/** 주소 → 상태. 이상한 값은 조용히 기본값으로 (주소는 사람이 손으로 고칠 수 있다). */
export function parseListState(params: ParamSource): ListState {
  const s: ListState = { ...DEFAULT_STATE, fields: [...ALL_FIELD_KEYS] };
  s.q = (params.get("q") ?? "").slice(0, 200);
  const f = params.get("f");
  if (f !== null) {
    const picked = f.split(",").filter(isFieldKey);
    if (picked.length > 0) s.fields = ALL_FIELD_KEYS.filter((k) => picked.includes(k));
  }
  s.item = params.get("item") ?? "";
  s.category = params.get("cls") ?? "";
  s.owner = params.get("own") ?? "";
  const sort = params.get("sort");
  if (sort !== null && isSortKey(sort)) s.sort = sort;
  s.desc = params.get("desc") === "1";
  const page = Number(params.get("page") ?? "1");
  s.page = Number.isInteger(page) && page >= 1 ? page : 1;
  const size = Number(params.get("size") ?? "0");
  s.size = (PAGE_SIZES as readonly number[]).includes(size) ? size : 0;
  const partRaw = params.get("part");
  const part = Number(partRaw);
  s.part = partRaw !== null && Number.isInteger(part) && part >= 1 ? part : null;
  const y = params.get("y");
  if (y !== null) {
    const years = y
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 2000 && n <= 2100);
    s.years = [...new Set(years)].sort((a, b) => b - a);
  }
  s.frequent = params.get("freq") === "1";
  const fm = params.get("fm");
  const fp = params.get("fp");
  const ft = params.get("ft");
  s.rule = {
    mode: isFrequentMode(fm) ? fm : DEFAULT_RULE.mode,
    months: fp === null ? DEFAULT_RULE.months : clampMonths(Number(fp)),
    min: ft === null ? DEFAULT_RULE.min : clampMin(Number(ft)),
  };
  return s;
}

/** 상태 → 주소. 기본값과 같은 것은 쓰지 않는다. */
export function serializeListState(s: ListState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.q.trim()) p.set("q", s.q);
  if (s.fields.length !== ALL_FIELD_KEYS.length) p.set("f", s.fields.join(","));
  if (s.item) p.set("item", s.item);
  if (s.category) p.set("cls", s.category);
  if (s.owner) p.set("own", s.owner);
  if (s.sort !== "no") p.set("sort", s.sort);
  if (s.desc) p.set("desc", "1");
  if (s.page > 1) p.set("page", String(s.page));
  if (s.size !== 0) p.set("size", String(s.size));
  if (s.part !== null) p.set("part", String(s.part));
  if (s.years.length > 0) p.set("y", s.years.join(","));
  if (s.frequent) p.set("freq", "1");
  if (s.rule.mode !== DEFAULT_RULE.mode) p.set("fm", s.rule.mode);
  if (s.rule.months !== DEFAULT_RULE.months) p.set("fp", String(s.rule.months));
  // 수량 모드는 기준이 없으므로 ft 를 쓰지 않는다
  if (s.rule.mode === "n" && s.rule.min !== DEFAULT_RULE.min) p.set("ft", String(s.rule.min));
  return p;
}

/** 찾는 글자를 낱말로. 띄어 쓰면 낱말이 **모두** 들어 있는 부품만 남는다 (REQUIREMENTS 3절). */
export function tokenize(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

function fieldOf(key: SearchFieldKey): SearchField {
  const found = SEARCH_FIELDS.find((f) => f.key === key);
  return found ? found.field : "name";
}

export function applyFilter(rows: readonly PartRow[], s: ListState): PartRow[] {
  const toks = tokenize(s.q);
  const fields = s.fields.map(fieldOf);
  return rows.filter((p) => {
    if (s.item && p.itemCode !== s.item) return false;
    if (s.category && p.category !== s.category) return false;
    if (s.owner && p.owner !== s.owner) return false;
    if (toks.length === 0) return true;
    const hay = fields.map((f) => p[f].toLowerCase());
    return toks.every((t) => hay.some((h) => h.includes(t)));
  });
}

function compare(a: PartRow, b: PartRow, key: SortKey): number {
  if (NUMERIC_SORT.has(key)) {
    const x = a[key] as number | null;
    const y = b[key] as number | null;
    // 값이 없는 것은 항상 뒤로 (오름·내림 상관없이)
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  }
  return String(a[key]).localeCompare(String(b[key]), "ko");
}

/** 정렬. 같은 값끼리는 No. 순으로 (결과가 흔들리지 않게). */
export function applySort(rows: readonly PartRow[], s: ListState): PartRow[] {
  const dir = s.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const r = compare(a, b, s.sort);
    const nullish = NUMERIC_SORT.has(s.sort) && (a[s.sort] === null || b[s.sort] === null);
    // null 은 방향과 상관없이 뒤로 가야 하므로 dir 를 곱하지 않는다
    return (nullish ? r : r * dir) || a.no - b.no;
  });
}

/**
 * 위로 올리기 (2026-10-07): **즐겨찾기 → (체크했으면) 자주 사용하는 부품 → 나머지.**
 * 즐겨찾기·나머지 묶음 안에서는 정렬 차례를 지키고, 자주 사용 묶음은 **잰 값(횟수 또는 수량)이 큰 순**(같으면 No. 순).
 * 정렬 뒤·쪽 나누기 전에 부른다 — 올린 것이 1쪽 맨 위에 와야 한다. 즐겨찾기는 체크와 상관없이 항상 위다(별을 누르면 바로 올라간다).
 */
export function applyPins(rows: readonly PartRow[], favorites: ReadonlySet<string>, frequent: ReadonlyMap<string, number>, s: ListState): PartRow[] {
  const fav: PartRow[] = [];
  const freq: PartRow[] = [];
  const rest: PartRow[] = [];
  for (const p of rows) {
    if (favorites.has(p.id)) fav.push(p);
    else if (s.frequent && frequent.has(p.id)) freq.push(p);
    else rest.push(p);
  }
  freq.sort((a, b) => (frequent.get(b.id) ?? 0) - (frequent.get(a.id) ?? 0) || a.no - b.no);
  return [...fav, ...freq, ...rest];
}

export interface PageResult {
  rows: PartRow[];
  total: number;
  /** 1부터. 비어 있으면 0 */
  from: number;
  to: number;
  page: number;
  pages: number;
}

export function paginate(rows: readonly PartRow[], s: ListState): PageResult {
  const total = rows.length;
  const size = s.size === 0 ? Math.max(total, 1) : s.size;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, s.page), pages);
  const start = (page - 1) * size;
  const shown = rows.slice(start, start + size);
  return { rows: shown, total, from: total === 0 ? 0 : start + 1, to: start + shown.length, page, pages };
}

export interface TextPiece {
  text: string;
  hit: boolean;
}

/** 찾은 글자를 표시하려고 글자를 조각낸다. 대소문자는 가리지 않는다. */
export function highlight(text: string, toks: readonly string[]): TextPiece[] {
  if (!text) return [];
  if (toks.length === 0) return [{ text, hit: false }];
  const low = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const t of toks) {
    let i = 0;
    while ((i = low.indexOf(t, i)) >= 0) {
      ranges.push([i, i + t.length]);
      i += t.length;
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const out: TextPiece[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (e <= pos) continue;
    const from = Math.max(s, pos);
    if (from > pos) out.push({ text: text.slice(pos, from), hit: false });
    out.push({ text: text.slice(from, e), hit: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}

export const NOTE_PREVIEW_LENGTH = 30;

/** 비고를 한 줄로 (줄바꿈은 " / "). 목록에서는 줄여 보이고, 행을 누르면 전체가 보인다 (REQUIREMENTS 3절). */
export function noteOneLine(note: string): string {
  return note.replace(/\s*\r?\n\s*/g, " / ").trim();
}

export interface NotePreview {
  text: string;
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * 비고 미리보기. 줄이되, 찾는 글자가 뒤쪽에 있으면 **그 둘레**를 보여 준다 — 안 그러면 비고에서 찾았다는데
 * 보이지 않는 줄이 생긴다 (예시 화면의 noteCell 과 같은 규칙).
 */
export function notePreview(note: string, toks: readonly string[], limit = NOTE_PREVIEW_LENGTH): NotePreview {
  const t = noteOneLine(note);
  if (t.length <= limit) return { text: t, clippedStart: false, clippedEnd: false };
  const low = t.toLowerCase();
  let at = -1;
  for (const k of toks) {
    const i = low.indexOf(k);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at > limit - 6) {
    const s = Math.max(0, at - 10);
    return { text: t.slice(s, s + limit), clippedStart: s > 0, clippedEnd: s + limit < t.length };
  }
  return { text: t.slice(0, limit), clippedStart: false, clippedEnd: true };
}
