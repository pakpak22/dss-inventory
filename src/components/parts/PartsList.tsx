"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { toggleFavoriteAction } from "@/app/actions/favorites";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  OWNERS,
  OWNER_LABEL,
  formatMoney,
  formatQuantity,
  isLowStock,
  lowStockTitle,
} from "@/lib/parts/codes";
import { PART_FIELDS, type PartFieldKey } from "@/lib/parts/field-order";
import {
  ALL_FIELD_KEYS,
  PAGE_SIZES,
  SEARCH_FIELDS,
  applyFilter,
  applyPins,
  applySort,
  highlight,
  notePreview,
  paginate,
  parseListState,
  serializeListState,
  tokenize,
  type ListState,
  type SearchFieldKey,
  type SortKey,
} from "@/lib/parts/list-state";
import type { YearlyUsageAll } from "@/lib/legacy/queries";
import {
  FREQ_MIN_MAX,
  FREQ_MONTHS_MAX,
  FREQ_MONTHS_STEP,
  clampMin,
  frequentValues,
  type MonthlyUsage,
} from "@/lib/parts/frequent";
import type { PartItemRow, PartRow } from "@/lib/parts/types";
import { PartDetailDialog, type PartDetailData } from "./PartDetailDialog";
import { ScrollSelect } from "./ScrollSelect";

/**
 * 재고 현황 목록 (DESIGN 2-1절, 예시 화면 그대로).
 *
 * - 부품 전체를 서버에서 한 번에 받아 **여기서** 찾기·거르기·정렬·쪽을 한다. 계산은 전부 `list-state.ts`.
 * - 조건은 주소(searchParams)에 담고 `router.replace` 로 갱신한다 — 뒤로 가기가 동작한다 (CLAUDE.md 9-7절).
 *   상세 창만 `router.push` 다: 창을 열었다가 뒤로 가기로 닫는 것이 자연스럽다.
 * - 버튼 숨김은 UI 편의일 뿐이고 실제 차단은 서버에서 한다 (8-4절). 조각 2 에는 바꾸는 기능이 없다.
 * - 아이콘 라이브러리를 쓰지 않는다. 정렬 표시는 ▲▼ 글자 (9-1절).
 */
export interface PartsListProps {
  rows: PartRow[];
  items: PartItemRow[];
  /** 주소의 `part=No.` 부품의 이력·연도별 수량·사용된 제품 (서버가 읽어 내려준다). 창이 닫혀 있으면 빈 값. */
  detail: PartDetailData;
  /** 연도별 사용 수량 (조각 5, DESIGN 2-1절): 자료에 나오는 연도와 부품별 수량. 연도를 체크하면 칸이 생긴다. */
  yearly: YearlyUsageAll;
  /** 전환일(설정값). 실제 자료를 넣기 전에는 null. */
  transitionDate: string | null;
  /** 이 사람의 즐겨찾기 부품 id (2026-10-07). 별을 누르면 서버에 저장되고 그 부품이 위로 간다. */
  favorites: string[];
  /** 최근 36개월 월별 사용 통계 (legacy/queries.ts usageByMonth). 「자주 사용」 규칙은 여기서 주소 상태로 계산한다. */
  monthly: MonthlyUsage;
  /** 이번 달(서울) "YYYY-MM" — 서버가 준다(브라우저 시계를 믿지 않는다) */
  thisMonth: string;
  canRegister: boolean;
  canRecord: boolean;
}

const COLUMNS: ReadonlyArray<{
  key: SortKey;
  label: string;
  numeric?: boolean;
}> = [
  { key: "no", label: "No.", numeric: true },
  // 🔴 부품을 가리키는 다섯 칸은 **차례를 여기 적지 않는다**(2026-10-16) — `PART_FIELDS` 한 표가 쥐고,
  //    아래 `<tbody>` 도 **같은 표를 돌면서** 그린다. 머리글과 본문이 따로 적혀 한 칸씩 밀리던 자리였다.
  ...PART_FIELDS,
  { key: "quantity", label: "수량", numeric: true },
  { key: "supplyPrice", label: "공급가", numeric: true },
  { key: "quotePrice", label: "견적가", numeric: true },
  { key: "note", label: "비고" },
  { key: "itemName", label: "항목" },
  { key: "category", label: "분류" },
  { key: "owner", label: "소유" },
];

/**
 * 다섯 칸의 **그리는 법**. 🔴 차례는 여기 없다 — `PART_FIELDS` 를 돌면서 이 표를 찾아 쓴다.
 * `search` 는 찾은 글자에 노란 칠을 할 때 쓰는 「찾을 곳」 키(`SEARCH_FIELDS` 의 짧은 키)다.
 * 키가 하나라도 빠지면 tsc 가 잡는다(`Record<PartFieldKey, …>`).
 */
const PART_CELL: Record<PartFieldKey, { td: string; inner?: string; search: SearchFieldKey }> = {
  // 고객사 품명은 한 줄로 둔다(두 줄로 접혀 보기 나빴다). 아주 긴 이름이 와도 표가 가로로 터지지 않게
  // 안쪽 칸에 상한을 두고 넘치면 … 로 줄인다 — 비고 칸이 쓰는 방식과 같고, 전체는 제목(title)과 상세 창에서 보인다.
  customerName: { td: "px-2.5 py-1.5", inner: "block max-w-56 truncate", search: "c" },
  name: { td: "px-2.5 py-1.5 font-medium text-zinc-900", search: "a" },
  name2: { td: "px-2.5 py-1.5", search: "b" },
  kyosanPartNo: { td: "px-2.5 py-1.5 font-mono text-xs whitespace-nowrap", search: "p" },
  drawingNo: { td: "px-2.5 py-1.5 font-mono text-xs whitespace-nowrap", search: "d" },
};

/** 다섯 칸 중 하나인가. `cellBody` 가 **같은 표**(`PART_FIELDS`·`PART_CELL`)로 넘길 때 쓴다. */
const PART_FIELD_KEY_SET: ReadonlySet<string> = new Set(PART_FIELDS.map((f) => f.key));
function isPartFieldKey(key: SortKey): key is PartFieldKey {
  return PART_FIELD_KEY_SET.has(key);
}

/**
 * 그 칸에 **적을 값이 없나**. 🔴 판정은 여기 하나지만 **어떻게 할지는 그리는 쪽이 정한다** —
 * 표는 `-` 를 적어 자리를 지키고(열이 밀리면 안 된다), 카드는 아예 안 그린다(「도번 -」이 줄마다
 * 서면 카드만 길어지고 정작 있는 값이 묻힌다).
 * 🔵 수량은 `0` 도 값이라 비었다고 하지 않는다.
 */
function isBlank(p: PartRow, key: SortKey): boolean {
  if (isPartFieldKey(key)) return p[key] === "";
  if (key === "note") return p.note.trim() === "";
  if (key === "supplyPrice") return p.supplyPrice === null;
  if (key === "quotePrice") return p.quotePrice === null;
  return false;
}

/**
 * 🔴 한계수량에 걸린 **수량 글자색이 적힌 유일한 자리**. 표의 `<td>` 와 카드가 **이 한 줄**을 본다 —
 *    두 곳에 따로 적으면 「표는 빨간데 카드는 검다」가 되고, 그 날 아무 오류도 안 난다.
 * 🔴 판정은 `isLowStock` 하나다(종·상세 창·질의가 보는 그 함수). 여기에 부등호를 손으로 적지 마라.
 * 🔴 **색만으로 알리지 않는다** — 부르는 쪽이 `lowStockTitle` 로 까닭을 함께 단다.
 */
const lowStockClass = (p: PartRow): string => (isLowStock(p.quantity, p.limitQuantity) ? "text-red-700" : "");

/**
 * 카드에서 **제 줄을 통째로 받는 칸**. 비고는 길어서 다른 칸과 한 줄에 서면 넘친다 —
 * 이름표와 값을 붙여 두는 규칙(`inline-block whitespace-nowrap`)을 지킬 수 없는 유일한 칸이다.
 * 🔵 **차례를 적는 자리가 아니다** — 어느 칸이 예외인지만 쥔다. 차례는 `COLUMNS` 가 그대로 쥔다.
 */
const CARD_FULL_LINE: ReadonlySet<SortKey> = new Set<SortKey>(["note"]);

const INPUT =
  "rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900";
const BTN =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BTN_PRIMARY =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50";
const BADGE =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

function ownerBadgeClass(owner: PartRow["owner"]): string {
  if (owner === "KYOSAN") return `${BADGE} bg-blue-50 text-blue-700`;
  if (owner === "SERVICE_SPARE") return `${BADGE} bg-amber-100 text-amber-800`;
  return `${BADGE} bg-zinc-100 text-zinc-700`;
}

export function OwnerBadge({ owner }: { owner: PartRow["owner"] }) {
  return <span className={ownerBadgeClass(owner)}>{OWNER_LABEL[owner]}</span>;
}

function Marked({ text, toks }: { text: string; toks: readonly string[] }) {
  const pieces = highlight(text, toks);
  if (pieces.length === 0) return null;
  return (
    <>
      {pieces.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-amber-200 px-px text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function PartsList({
  rows,
  items,
  detail,
  yearly,
  transitionDate,
  favorites,
  monthly,
  thisMonth,
  canRegister,
  canRecord,
}: PartsListProps) {
  const router = useRouter();
  // 즐겨찾기: 서버 값에 방금 누른 것을 겹쳐 바로 보이게(낙관적). 서버가 revalidate 하면 favorites 가 새로 와서 겹침은 사라진다.
  const [favOverride, setFavOverride] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [, startFavorite] = useTransition();
  const favoriteSet = useMemo(() => {
    const set = new Set(favorites);
    for (const [id, on] of favOverride)
      if (on) set.add(id);
      else set.delete(id);
    return set;
  }, [favorites, favOverride]);
  function toggleFavorite(partId: string) {
    const next = !favoriteSet.has(partId);
    setFavOverride((m) => new Map(m).set(partId, next));
    startFavorite(async () => {
      const r = await toggleFavoriteAction(partId);
      if (!r.ok) setFavOverride((m) => new Map(m).set(partId, !next));
    });
  }
  // 연도별 사용 수량 체크란은 접어 둔다(2026-10-07 사용자). 연도를 골라 둔 주소로 열면 펼친 채로.
  const [showYears, setShowYears] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseListState(searchParams), [searchParams]);

  // 찾기 칸은 글자를 칠 때마다 주소를 바꾸면 무겁다. 입력은 로컬에 두고 잠깐 뒤에 주소로 옮긴다.
  //
  // 주소의 q 가 바뀌었을 때 입력 칸을 맞추는 규칙: **우리가 방금 밀어 넣은 값이 돌아온 것이면 건드리지 않는다**
  // (사람이 그 사이에 더 친 글자를 지우면 안 된다). 뒤로 가기·조건 지우기처럼 바깥에서 바뀐 것이면 맞춘다.
  // effect 안에서 setState 하지 않고 렌더 중에 파생 상태를 맞추는 React 권장 방식이다.
  const [qInput, setQInput] = useState(state.q);
  const [seenUrlQ, setSeenUrlQ] = useState(state.q);
  const [pushedQ, setPushedQ] = useState<string | null>(null);
  if (seenUrlQ !== state.q) {
    setSeenUrlQ(state.q);
    if (pushedQ !== state.q) setQInput(state.q);
  }
  useEffect(() => {
    if (qInput === state.q) return;
    const id = setTimeout(() => {
      setPushedQ(qInput);
      update({ q: qInput, page: 1 });
    }, 200);
    return () => clearTimeout(id);
    // update 는 렌더마다 새 함수다. 넣으면 매 렌더 타이머가 다시 걸리므로 입력값만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput, state.q]);

  /**
   * 주소 바꾸기. 찾기·거르기·정렬·쪽·연도·자주 사용 기준은 **서버를 부르지 않는다** (2026-10-07 사용자: 「버튼 하나 누를 때마다 시간이 엄청 걸린다」).
   * router.replace 는 주소만 바뀌어도 서버 컴포넌트를 다시 그려(RSC 왕복) 부품 전체를 또 읽어 왔다. 부품은 이미 브라우저에 다 있으니
   * 브라우저 history 로 주소만 바꾼다 — Next 가 useSearchParams 를 그에 맞춰 갱신한다(Next 14.1+ 「Native History API」).
   * **상세 창을 새로 열 때만** 서버가 필요하다(그 부품의 이력·과거 기록을 읽어 내려준다) → router.push.
   */
  function navigate(next: ListState, push = false) {
    const qs = serializeListState(next).toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    const opensOtherDetail = next.part !== null && next.part !== state.part;
    if (opensOtherDetail) {
      if (push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
      return;
    }
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }
  function update(patch: Partial<ListState>) {
    navigate({ ...state, ...patch });
  }

  const toks = tokenize(state.q);
  const frequentMap = useMemo(
    () => frequentValues(monthly, state.rule, thisMonth),
    [monthly, state.rule, thisMonth],
  );
  // 자주 사용 기준 패널은 접어 둔다. 기준 숫자 칸은 치는 동안 주소를 바꾸면 무거우니 로컬에 두고 놓을 때 반영한다.
  const [showRule, setShowRule] = useState(false);
  const [minInput, setMinInput] = useState(String(state.rule.min));
  const [seenMin, setSeenMin] = useState(state.rule.min);
  if (seenMin !== state.rule.min) {
    setSeenMin(state.rule.min);
    setMinInput(String(state.rule.min));
  }
  function commitMin() {
    const v = clampMin(Number(minInput));
    setMinInput(String(v));
    if (v !== state.rule.min)
      update({ rule: { ...state.rule, min: v }, page: 1 });
  }
  const filtered = useMemo(
    () =>
      applyPins(
        applySort(applyFilter(rows, state), state),
        favoriteSet,
        frequentMap,
        state,
      ),
    [rows, state, favoriteSet, frequentMap],
  );
  const page = paginate(filtered, state);
  const activeFields = new Set<SearchFieldKey>(state.fields);
  const tk = (key: SearchFieldKey) => (activeFields.has(key) ? toks : []);

  const detailPart =
    state.part === null
      ? null
      : (rows.find((p) => p.no === state.part) ?? null);
  const exportQs = serializeListState({ ...state, part: null, page: 1, size: 0 }).toString();
  const exportQuery = exportQs ? `?${exportQs}` : "";
  const hasFilter = Boolean(
    state.q.trim() || state.item || state.category || state.owner,
  );

  function toggleField(key: SearchFieldKey) {
    const next = activeFields.has(key)
      ? state.fields.filter((k) => k !== key)
      : ALL_FIELD_KEYS.filter((k) => k === key || activeFields.has(k));
    if (next.length === 0) return; // 찾을 곳은 하나 이상 남긴다
    update({ fields: next, page: 1 });
  }
  function sortBy(key: SortKey) {
    if (state.sort === key) update({ desc: !state.desc, page: 1 });
    else update({ sort: key, desc: false, page: 1 });
  }
  function reset() {
    navigate({
      ...state,
      q: "",
      fields: [...ALL_FIELD_KEYS],
      item: "",
      category: "",
      owner: "",
      years: [],
      frequent: false,
      page: 1,
    });
  }
  function toggleYear(year: number) {
    const next = state.years.includes(year)
      ? state.years.filter((y) => y !== year)
      : [...state.years, year].sort((a, b) => b - a);
    update({ years: next });
  }
  const yearColumns = state.years.filter((y) => yearly.years.includes(y));
  const usageOf = (partId: string, year: number) =>
    yearly.usage[partId]?.[String(year)] ?? 0;
  function openDetail(no: number) {
    navigate({ ...state, part: no }, true);
  }
  function closeDetail() {
    navigate({ ...state, part: null });
  }

  /**
   * ★ 즐겨찾기 단추. 🔴 **표의 줄과 카드가 같은 이 함수를 쓴다** — 특히 `e.stopPropagation()` 이
   *    여기 한 번만 적혀 있어야 한다. 베껴 적은 쪽에서 그 한 줄이 빠지면 줄·카드 전체가 상세를 여는
   *    자리라서 **별을 누를 때마다 상세 상자가 열린다.**
   */
  function favoriteStar(p: PartRow) {
    const on = favoriteSet.has(p.id);
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(p.id);
        }}
        className={`rounded px-1 text-base leading-none ${on ? "text-amber-500 hover:text-amber-600" : "text-zinc-300 hover:text-amber-400"}`}
        aria-pressed={on}
        aria-label={on ? "즐겨찾기 끄기" : "즐겨찾기 켜기"}
        title={on ? "즐겨찾기 끄기" : "즐겨찾기 — 누르면 항상 위에 보입니다"}
      >
        {on ? "★" : "☆"}
      </button>
    );
  }

  /**
   * 칸 하나의 **값**을 그린다. 🔴 **표의 `<td>` 와 카드가 같은 이 함수를 쓴다** — 칸이 하나 늘 때
   *    고칠 자리가 한 군데여야 한다(위 `COLUMNS` 주석과 같은 까닭: 따로 적으면 한쪽만 고쳐진다).
   * 🔵 **꼴은 여기 없다** — 칸 넓이·줄바꿈은 표가 `PART_CELL`·`<td>` 로, 카드가 제 묶음으로 입힌다.
   * 🔵 **비었을 때 무엇을 적을지도 여기 없다** — 판정만 `isBlank` 에 있고 처리는 부르는 쪽이 한다.
   */
  function cellBody(p: PartRow, key: SortKey): ReactNode {
    // 다섯 칸은 찾은 글자에 노란 칠을 한다. 어느 「찾을 곳」의 글자인지는 `PART_CELL` 이 쥔다.
    if (isPartFieldKey(key)) return <Marked text={p[key]} toks={tk(PART_CELL[key].search)} />;
    switch (key) {
      case "no":
        return p.no;
      case "quantity":
        return formatQuantity(p.quantity);
      case "supplyPrice":
        return formatMoney(p.supplyPrice, p.supplyCurrency);
      case "quotePrice":
        return formatMoney(p.quotePrice, "KRW");
      case "note": {
        const preview = notePreview(p.note, tk("m"));
        return (
          <>
            {preview.clippedStart ? "…" : ""}
            <Marked text={preview.text} toks={tk("m")} />
            {preview.clippedEnd ? "…" : ""}
          </>
        );
      }
      case "itemName":
        return p.itemName;
      case "category":
        return CATEGORY_LABEL[p.category];
      case "owner":
        return <OwnerBadge owner={p.owner} />;
      default: {
        // 🔴 칸이 하나 늘면 **여기서 tsc 가 멈춘다** — 표에만 더하고 카드를 잊는 일을 막는다.
        const unhandled: never = key;
        return unhandled;
      }
    }
  }

  const itemCount = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  const ownerCount = new Map<string, number>();
  for (const p of rows) {
    itemCount.set(p.itemCode, (itemCount.get(p.itemCode) ?? 0) + 1);
    categoryCount.set(p.category, (categoryCount.get(p.category) ?? 0) + 1);
    ownerCount.set(p.owner, (ownerCount.get(p.owner) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900">재고 현황</h1>
        <div className="flex flex-wrap gap-2 no-print">
          {/* 조각 6: 지금 조건에 맞는 부품 **전체**(쪽·상세 창 무시). 주소 조건을 그대로 넘기면 서버가 같은 순수 함수로 같은 차례를 만든다. */}
          <a href={`/print/parts${exportQuery}`} target="_blank" rel="noopener" className={BTN} title="지금 조건에 맞는 부품 전체를 A4 가로로. 손으로 적는 「확인」 칸이 있습니다.">
            인쇄
          </a>
          <a href={`/api/export/parts${exportQuery}`} className={BTN} title="지금 조건에 맞는 부품 전체를 현황판과 같은 서식의 엑셀로.">
            엑셀 내려받기
          </a>
          {canRecord && (
            <Link href="/entries/new" className={BTN}>
              수량 변경 기록
            </Link>
          )}
          {canRegister && (
            <Link href="/parts/new" className={BTN_PRIMARY}>
              부품 등록
            </Link>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-col gap-3 p-4 no-print">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-1 basis-80 flex-col gap-1 text-xs text-zinc-500">
              찾기
              <input
                type="search"
                className={`${INPUT} w-full`}
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="찾을 글자. 띄어 쓰면 모두 들어 있는 부품만 남습니다"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              항목
              {/* 19개라 네이티브 select 는 너무 길다 → 다섯 줄만 보이고 굴리는 상자 (2026-10-07) */}
              <ScrollSelect
                ariaLabel="항목"
                className="w-44"
                value={state.item}
                onChange={(v) => update({ item: v, page: 1 })}
                options={[{ value: "", label: "전체" }, ...items.map((it) => ({ value: it.code, label: `${it.name} (${itemCount.get(it.code) ?? 0})` }))]}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              분류
              <select
                className={INPUT}
                value={state.category}
                onChange={(e) => update({ category: e.target.value, page: 1 })}
              >
                <option value="">전체</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]} ({categoryCount.get(c) ?? 0})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              소유
              <select
                className={INPUT}
                value={state.owner}
                onChange={(e) => update({ owner: e.target.value, page: 1 })}
              >
                <option value="">전체</option>
                {OWNERS.map((o) => (
                  <option key={o} value={o}>
                    {OWNER_LABEL[o]} ({ownerCount.get(o) ?? 0})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={BTN}
              onClick={reset}
              disabled={
                !hasFilter &&
                state.fields.length === ALL_FIELD_KEYS.length &&
                state.years.length === 0 &&
                !state.frequent
              }
            >
              조건 지우기
            </button>
          </div>
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1"
            role="group"
            aria-label="찾을 곳"
          >
            <span className="text-xs text-zinc-500">찾을 곳</span>
            {SEARCH_FIELDS.map((f) => (
              <label
                key={f.key}
                className="inline-flex cursor-pointer items-center gap-1.5 text-sm whitespace-nowrap text-zinc-700"
              >
                <input
                  type="checkbox"
                  checked={activeFields.has(f.key)}
                  onChange={() => toggleField(f.key)}
                />
                {f.label}
              </label>
            ))}
          </div>
          {/* 위로 올리기 (2026-10-07): 즐겨찾기(별)는 항상 위, 자주 사용하는 부품은 체크했을 때 그다음. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm whitespace-nowrap text-zinc-700">
              <input
                type="checkbox"
                checked={state.frequent}
                onChange={() => update({ frequent: !state.frequent, page: 1 })}
              />
              자주 사용하는 부품 위로{" "}
              <span className="text-xs text-zinc-500">
                ({frequentMap.size}개 · 최근 {state.rule.months}개월{" "}
                {state.rule.mode === "n"
                  ? `출납 ${state.rule.min}번 이상`
                  : "사용 수량 많은 순"}
                )
              </span>
            </label>
            <button
              type="button"
              className={BTN}
              onClick={() => setShowRule((v) => !v)}
              aria-expanded={showRule}
            >
              기준 {showRule ? "▴" : "▾"}
            </button>
            <span className="text-xs text-zinc-500">
              ★ 즐겨찾기 {favoriteSet.size}개는 항상 위에 보입니다. 줄의 별을
              누르면 켜고 끕니다.
            </span>
          </div>
          {showRule ? (
            <div
              className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3"
              role="group"
              aria-label="자주 사용 기준"
            >
              <div className="flex flex-col gap-1 text-xs text-zinc-500">
                재는 것
                <div className="flex overflow-hidden rounded-md border border-zinc-300 text-sm">
                  {(["n", "q"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        update({ rule: { ...state.rule, mode: m }, page: 1 })
                      }
                      aria-pressed={state.rule.mode === m}
                      className={`px-3 py-1 ${state.rule.mode === m ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-100"}`}
                    >
                      {m === "n" ? "출납 횟수" : "사용 수량"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex min-w-64 flex-1 basis-64 flex-col gap-1 text-xs text-zinc-500">
                최근 기간{" "}
                <b className="text-sm text-zinc-900">{state.rule.months}개월</b>{" "}
                <span>
                  (한 칸 {FREQ_MONTHS_STEP}개월, {FREQ_MONTHS_MAX}개월까지)
                </span>
                <input
                  type="range"
                  min={FREQ_MONTHS_STEP}
                  max={FREQ_MONTHS_MAX}
                  step={FREQ_MONTHS_STEP}
                  value={state.rule.months}
                  onChange={(e) =>
                    update({
                      rule: { ...state.rule, months: Number(e.target.value) },
                      page: 1,
                    })
                  }
                  className="w-full"
                  aria-label="최근 기간(개월)"
                />
              </label>
              {state.rule.mode === "n" ? (
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  기준 (번 이상)
                  <input
                    type="number"
                    min={1}
                    max={FREQ_MIN_MAX}
                    value={minInput}
                    onChange={(e) => setMinInput(e.target.value)}
                    onBlur={commitMin}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitMin();
                    }}
                    className={`${INPUT} w-24 text-right`}
                    aria-label="기준 숫자"
                  />
                </label>
              ) : null}
              <span className="text-xs text-zinc-500">
                이번 달을 포함해 셉니다. 입고·반환·대여는 세지 않습니다.{" "}
                {state.rule.mode === "n"
                  ? "출납 횟수는 사용 기록 줄 수이고, 기준 이상인 부품이 횟수 많은 순으로 올라갑니다."
                  : "그 기간에 한 개라도 쓴 부품이 수량 많은 순으로 올라갑니다. 기준은 없습니다."}
              </span>
            </div>
          ) : null}
          {/* 연도별 사용 수량 (DESIGN 2-1절): 연도를 체크하면 그 해 사용 수량 칸이 생긴다. 이 숫자를 보고 주문한다. 체크란은 단추로 접어 둔다. */}
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1"
            role="group"
            aria-label="연도별 사용 수량"
          >
            <button
              type="button"
              className={BTN}
              onClick={() => setShowYears((v) => !v)}
              aria-expanded={showYears || state.years.length > 0}
            >
              연도별 사용 수량 {showYears || state.years.length > 0 ? "▴" : "▾"}
            </button>
            {!showYears && state.years.length > 0 ? (
              <span className="text-xs text-zinc-500">
                {state.years.map((y) => `${y}년`).join(" · ")} 칸을 보는 중
              </span>
            ) : null}
            {showYears || state.years.length > 0 ? (
              yearly.years.length === 0 ? (
                <span className="text-xs text-zinc-400">
                  아직 사용 기록이 없습니다.
                </span>
              ) : (
                yearly.years.map((y) => (
                  <label
                    key={y}
                    className="inline-flex cursor-pointer items-center gap-1.5 text-sm whitespace-nowrap text-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={state.years.includes(y)}
                      onChange={() => toggleYear(y)}
                    />
                    {y}년
                  </label>
                ))
              )
            ) : null}
            {yearColumns.length > 0 && yearly.excludedLegacy > 0 ? (
              <span
                className="text-xs text-amber-800"
                title="엑셀 과거 기록 중 소유가 맞지 않아 부품에만 붙여 둔 사용 기록. 연도별 수량에 넣지 않습니다."
              >
                확인되지 않은 과거 기록 {yearly.excludedLegacy}건 제외
              </span>
            ) : null}
          </div>
        </div>

        {page.total === 0 ? (
          <div className="border-t border-zinc-200 p-8 text-center text-sm text-zinc-500">
            {hasFilter
              ? "이 조건으로 등록된 부품이 없습니다."
              : "아직 등록된 부품이 없습니다."}
          </div>
        ) : (
          <>
            {/*
              ── 📱 **좁은 화면(lg 미만)은 줄 하나가 카드 한 장이다** (2026-10-22 쓰는 분 요청) ──
              가로 스크롤이 있어 글자가 찌그러지지는 않지만, 폭 360px 짜리 휴대폰에서 열 열세 개짜리
              표를 좌우로 밀어 보는 것은 실제로는 못 쓴다 — 첫 두 칸만 보이고 나머지는 화면 밖이다.

              🔴 **카드는 열 목록을 다시 적지 않는다.** 표가 도는 그 표(`COLUMNS`·`PART_FIELDS`·
                 `PART_CELL`·`yearColumns`)를 **그대로 돌고**, 값은 표와 **같은 `cellBody`** 가 그린다.
                 세 번째 사본을 만들면 「차례가 어긋나 값이 한 칸씩 밀리던」 그 자리(아래 `<tbody>`
                 주석)가 되돌아온다. 칸이 하나 늘 때 고칠 곳은 한 군데여야 한다.
              🔴 **겹치는 것은 배치뿐이다** — 1024px 이상에서는 아래 표가 지금 그대로 선다.
              🔴 **인쇄는 언제나 표다**(`no-print`·`print:block`). [인쇄] 단추는 전용 화면
                 (`/print/parts`)으로 가지만, 사람이 이 화면에서 Ctrl+P 를 누를 수 있다. A4 가로는
                 CSS 로 약 1047px 이라 `lg`(1024px) 경계에 아슬아슬하게 걸린다 — 여백·배율에 따라
                 1024px 아래로 떨어지면 종이에 카드가 나간다. 운에 맡기지 않고 못 박아 둔다.
                 (`tests/parts-list-cards.test.ts` 가 이 두 글자를 잰다.)
            */}
            <div className="no-print border-t border-zinc-200 lg:hidden">
              {/*
                🔴 **정렬 고르개** — 카드에는 머리글이 없어 `<th>` 안의 정렬 단추가 사라진다. 같은
                   `sortBy`·`state.sort`·`state.desc` 를 쓰고, 고를 수 있는 칸은 `COLUMNS` 가 안다.
                🔵 모양은 위 거르기 상자의 「분류」·「소유」 고르개와 같다 — 새 모양을 만들지 않는다.
                   휴대폰에서는 네이티브 `select` 가 운영체제 고르개로 열려 가장 누르기 쉽다.
              */}
              <div className="flex flex-wrap items-end gap-2 px-3 py-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  정렬
                  <select
                    className={INPUT}
                    value={state.sort}
                    onChange={(e) => sortBy(e.target.value as SortKey)}
                  >
                    {COLUMNS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={BTN}
                  onClick={() => sortBy(state.sort)}
                  title="누르면 오름차순·내림차순이 바뀝니다"
                >
                  {state.desc ? "▼ 내림차순" : "▲ 오름차순"}
                </button>
              </div>
              <ul className="divide-y divide-zinc-100 border-t border-zinc-200">
                {page.rows.map((p) => {
                  // 머리줄에 세울 칸. 🔴 고객사 품명이 **빈 부품이 많다**(없으면 빈 문자열) — 그때는
                  //    품명이 선다. 머리줄이 비면 이 카드가 어느 부품인지 가릴 글자가 없어진다.
                  const headKey: PartFieldKey = p.customerName ? "customerName" : "name";
                  // 🔴 머리줄·수량 줄에 **이미 선 칸은 뺀다** — 같은 글자가 두 번 서면 카드만 길어진다.
                  // 🔵 값이 빈 칸도 뺀다(`isBlank` 주석).
                  const cols = COLUMNS.filter(
                    (c) => c.key !== "no" && c.key !== "quantity" && c.key !== headKey && !isBlank(p, c.key),
                  );
                  return (
                    <li key={p.id}>
                      {/* 🔴 줄을 눌러 상세 열기·Enter 키는 표의 `<tr>` 과 **같은 규칙**이다. */}
                      <div
                        tabIndex={0}
                        onClick={() => {
                          if (!String(window.getSelection() ?? "")) openDetail(p.no);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") openDetail(p.no);
                        }}
                        className="flex cursor-pointer flex-col gap-1 px-3 py-2.5 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-zinc-900"
                      >
                        {/* 맨 윗줄: ★ · No. · 그 부품을 가리키는 가장 중요한 글자 */}
                        <div className="flex items-start gap-1.5">
                          {favoriteStar(p)}
                          <span className="tabular pt-0.5 text-xs text-zinc-500">{cellBody(p, "no")}</span>
                          <span className="min-w-0 flex-1 text-sm font-medium break-keep text-zinc-900">
                            {cellBody(p, headKey)}
                          </span>
                        </div>
                        {/* 숫자는 한 줄에 모은다 — `.tabular` 로 세로가 맞는다. */}
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                          <span className="whitespace-nowrap">
                            수량{" "}
                            <b
                              className={`tabular text-sm ${lowStockClass(p)}`}
                              title={lowStockTitle(p.quantity, p.limitQuantity)}
                            >
                              {cellBody(p, "quantity")}
                            </b>
                          </span>
                          {yearColumns.map((y) => (
                            <span key={`y${y}`} className="whitespace-nowrap text-amber-800">
                              {y}년 사용 <b className="tabular">{formatQuantity(usageOf(p.id, y))}</b>
                            </span>
                          ))}
                        </div>
                        {cols.length > 0 ? (
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-zinc-600">
                            {cols.map((c) => (
                              /* 🔴 **이름표와 값은 한 쌍으로 붙어 다닌다** — 좁은 칸에서 이름표만 윗줄에
                                  남고 값이 아랫줄로 떨어진 적이 있다(`stock/RepairCaseInfo.tsx` 가 같은
                                  문제를 겪고 고친 방식 그대로다). `inline-block` 이 **함께** 있어야 쌍이
                                  통째로 내려간다 — `whitespace-nowrap` 만으로는 inline 상자가 쪼개진다.
                                  🔵 비고만 제 줄을 받는다(`CARD_FULL_LINE`) — 길어서 한 쌍으로 묶을 수 없다. */
                              <span
                                key={c.key}
                                className={CARD_FULL_LINE.has(c.key) ? "basis-full break-keep" : "inline-block whitespace-nowrap"}
                              >
                                <span className="text-zinc-400">{c.label} </span>
                                {cellBody(p, c.key)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="hidden overflow-x-auto border-t border-zinc-200 lg:block print:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-xs text-zinc-500">
                  <th
                    scope="col"
                    className="border-b border-zinc-200 px-1 py-2 text-center font-medium"
                    title="즐겨찾기"
                  >
                    ★
                  </th>
                  {COLUMNS.flatMap((c) => {
                    const on = state.sort === c.key;
                    const th = (
                      <th
                        key={c.key}
                        scope="col"
                        className={`border-b border-zinc-200 p-0 font-medium whitespace-nowrap ${c.numeric ? "text-right" : ""}`}
                        aria-sort={
                          on
                            ? state.desc
                              ? "descending"
                              : "ascending"
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          onClick={() => sortBy(c.key)}
                          className={`block w-full px-2.5 py-2 text-left hover:text-zinc-900 ${c.numeric ? "text-right" : ""} ${on ? "font-semibold text-zinc-900" : ""}`}
                        >
                          {c.label}
                          {on ? (state.desc ? " ▼" : " ▲") : ""}
                        </button>
                      </th>
                    );
                    // 연도 칸은 수량 바로 뒤. 정렬 단추는 없다(정렬은 고정 칸만, list-state.ts).
                    if (c.key !== "quantity") return [th];
                    return [
                      th,
                      ...yearColumns.map((y) => (
                        <th
                          key={`y${y}`}
                          scope="col"
                          className="border-b border-zinc-200 bg-amber-50 px-2.5 py-2 text-right font-medium whitespace-nowrap text-amber-900"
                        >
                          {y}년 사용
                        </th>
                      )),
                    ];
                  })}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((p) => {
                  return (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      onClick={() => {
                        if (!String(window.getSelection() ?? ""))
                          openDetail(p.no);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openDetail(p.no);
                      }}
                      className="cursor-pointer border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-zinc-900"
                    >
                      {/* 🔴 ★ 는 카드와 **같은 함수**가 그린다 — `stopPropagation` 이 한 자리여야 한다. */}
                      <td className="px-1 py-1 text-center">{favoriteStar(p)}</td>
                      <td className="tabular px-2.5 py-1.5 text-right text-zinc-500">
                        {cellBody(p, "no")}
                      </td>
                      {/* 🔴 다섯 칸은 머리글(위 COLUMNS)과 **같은 표**(PART_FIELDS)를 돈다 — 둘을 따로 적어
                          두었더니 차례가 어긋나면 값이 한 칸씩 밀리는 자리였다. 꼴은 PART_CELL.
                          🔵 값을 그리는 것은 카드와 **같은 `cellBody`** 다. 빈 칸에 `-` 를 적는 것은
                             표만의 규칙이라 여기 남는다(카드는 그 칸을 아예 안 그린다). */}
                      {PART_FIELDS.map((f) => {
                        const cell = PART_CELL[f.key];
                        const body = isBlank(p, f.key) ? (
                          <span className="text-zinc-400">-</span>
                        ) : (
                          cellBody(p, f.key)
                        );
                        return (
                          <td
                            key={f.key}
                            className={cell.td}
                            title={f.key === "customerName" ? p.customerName : undefined}
                          >
                            {cell.inner ? <span className={cell.inner}>{body}</span> : body}
                          </td>
                        );
                      })}
                      {/*
                        🔴 **한계수량에 걸리면 수량 글자가 붉다** (2026-10-16 쓰는 분 요청:
                           「한계수량 이하이면 재고현황 표에서 해당 부품의 수량이 빨간색 붉은 글씨로」).
                        🔴 **판정은 `isLowStock` 하나다** — 종(`notifications/bell-items.ts`)과 상세 창의
                           「부족」 딱지가 보는 그 함수다. 여기에 부등호를 손으로 적으면 네 번째 자리가
                           생겨 언젠가 **목록만 안 빨개지는** 날이 온다.
                        🔴 **색만으로 알리지 않는다** — `title` 로 까닭을 함께 단다(그 함수 주석).
                        🔵 **수량 칸만 칠한다.** 줄 전체를 칠하면 다른 칸의 글자까지 뜻이 바뀐다.
                        🔵 한계수량을 정하지 않은 부품(`null`)은 **지금 그대로** 검다.
                      */}
                      <td
                        className={`tabular px-2.5 py-1.5 text-right font-semibold whitespace-nowrap ${lowStockClass(p)}`}
                        title={lowStockTitle(p.quantity, p.limitQuantity)}
                      >
                        {cellBody(p, "quantity")}
                      </td>
                      {yearColumns.map((y) => (
                        <td
                          key={`y${y}`}
                          className="tabular bg-amber-50/60 px-2.5 py-1.5 text-right whitespace-nowrap"
                        >
                          {usageOf(p.id, y) === 0 ? (
                            <span className="text-zinc-400">0</span>
                          ) : (
                            formatQuantity(usageOf(p.id, y))
                          )}
                        </td>
                      ))}
                      <td className="tabular px-2.5 py-1.5 text-right whitespace-nowrap">
                        {cellBody(p, "supplyPrice")}
                      </td>
                      <td className="tabular px-2.5 py-1.5 text-right whitespace-nowrap">
                        {cellBody(p, "quotePrice")}
                      </td>
                      <td
                        className="max-w-80 px-2.5 py-1.5 text-zinc-700"
                        title={p.note}
                      >
                        {cellBody(p, "note")}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        {cellBody(p, "itemName")}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        {cellBody(p, "category")}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {cellBody(p, "owner")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 text-sm text-zinc-500 no-print">
          <span className="tabular">
            전체 {page.total}건 중 {page.from}-{page.to}건
            {page.total !== rows.length
              ? ` · 등록된 부품 ${rows.length}건`
              : ""}
          </span>
          <span className="flex items-center gap-2">
            <select
              className={INPUT}
              aria-label="한 쪽에 보일 건수"
              value={state.size}
              onChange={(e) =>
                update({ size: Number(e.target.value), page: 1 })
              }
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "전체" : `${n}건`}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={BTN}
              disabled={page.page <= 1}
              onClick={() => update({ page: page.page - 1 })}
            >
              이전
            </button>
            <span className="tabular">
              {page.page} / {page.pages}
            </span>
            <button
              type="button"
              className={BTN}
              disabled={page.page >= page.pages}
              onClick={() => update({ page: page.page + 1 })}
            >
              다음
            </button>
          </span>
        </div>
      </section>

      {/* 🔵 좁은 화면에는 머리글이 없다 — 한 문장만 갈아 끼운다(1024px 이상의 글자는 그대로다). */}
      <p className="text-xs text-zinc-500 no-print">
        행을 누르면 비고 전체와 이력이 보입니다.{" "}
        <span className="hidden lg:inline">
          머리글을 누르면 그 칸 기준으로 정렬됩니다.
        </span>
        <span className="lg:hidden">
          정렬은 목록 위의 고르개에서 바꿉니다.
        </span>
      </p>

      <PartDetailDialog
        part={detailPart}
        missingNo={
          state.part !== null && detailPart === null ? state.part : null
        }
        canEdit={canRegister}
        canRecord={canRecord}
        detail={detail}
        transitionDate={transitionDate}
        onClose={closeDetail}
      />
    </div>
  );
}
