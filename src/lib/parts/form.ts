import { CATEGORIES, CURRENCIES, OWNERS, type Category, type Currency, type Owner } from "@/db/schema/codes";

/**
 * 부품 등록·수정 폼의 **검사** — 순수 함수. FormData 를 받아 저장할 값 또는 칸별 한국어 오류를 돌려준다.
 * 서버 액션이 부르고, 시험은 DB 없이 돈다. 🔴 클라이언트가 보낸 값은 여기서 전부 다시 검사한다 (CLAUDE.md 8-4절).
 *
 * 규칙 (DESIGN 2-3절):
 *  - 품명 필수. No. 는 프로그램이 매긴다(폼에 없다). 수량은 여기서 못 고친다(폼에 없다).
 *  - 품명2·교산 품번·도번·비고는 비면 빈 문자열. 공급가·견적가는 비면 null, 적으면 0 이상의 정수.
 */
export interface PartInput {
  name: string;
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
  supplyPrice: number | null;
  supplyCurrency: Currency;
  quotePrice: number | null;
  note: string;
  itemId: string;
  category: Category;
  owner: Owner;
}

export type PartField = keyof PartInput;
export type PartFieldErrors = Partial<Record<PartField | "form", string>>;

export type ParseResult<T, E> = { ok: true; value: T } | { ok: false; errors: E };

type FormLike = { get(name: string): FormDataEntryValue | string | null };

const TEXT_MAX = 200;
const NOTE_MAX = 4000;
const PRICE_MAX = 9_000_000_000_000; // 9조. bigint 범위 안이고 사람이 실수로 0 을 더 친 것도 걸러낸다

function text(fd: FormLike, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
}

/**
 * 엑셀 현황판은 빈 칸을 `-` 로 적는다. 사람이 그 습관대로 `-` 를 치면 **빈 값**으로 받는다.
 * 안 그러면 "-" 와 "" 가 다른 값이 되어 같은 이름 찾기·엑셀 쓰기가 어긋난다 (DESIGN 4-3절: 없으면 빈 값, 엑셀에는 `-`).
 * 품명은 필수 칸이라 손대지 않는다.
 */
const DASH_ONLY = /^[-–—－ㅡ]+$/;
function textOrEmpty(fd: FormLike, name: string): string {
  const v = text(fd, name);
  return DASH_ONLY.test(v) ? "" : v;
}

function price(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (raw === "") return { ok: true, value: null };
  const cleaned = raw.replace(/[,\s¥₩]/g, "");
  if (!/^\d+$/.test(cleaned)) return { ok: false };
  const n = Number(cleaned);
  if (!Number.isSafeInteger(n) || n > PRICE_MAX) return { ok: false };
  return { ok: true, value: n };
}

/**
 * @param itemIds 지금 있는(숨기지 않은) 항목 id 들. 폼이 보낸 항목이 실제로 있는지 확인한다.
 */
export function parsePartForm(fd: FormLike, itemIds: ReadonlySet<string>): ParseResult<PartInput, PartFieldErrors> {
  const errors: PartFieldErrors = {};

  const name = text(fd, "name");
  if (!name) errors.name = "품명을 입력하십시오.";
  else if (name.length > TEXT_MAX) errors.name = `품명은 ${TEXT_MAX}자 이하여야 합니다.`;

  const name2 = textOrEmpty(fd, "name2");
  if (name2.length > TEXT_MAX) errors.name2 = `품명2는 ${TEXT_MAX}자 이하여야 합니다.`;
  const kyosanPartNo = textOrEmpty(fd, "kyosanPartNo");
  if (kyosanPartNo.length > TEXT_MAX) errors.kyosanPartNo = `교산 품번은 ${TEXT_MAX}자 이하여야 합니다.`;
  const drawingNo = textOrEmpty(fd, "drawingNo");
  if (drawingNo.length > TEXT_MAX) errors.drawingNo = `도번은 ${TEXT_MAX}자 이하여야 합니다.`;

  const supply = price(text(fd, "supplyPrice"));
  if (!supply.ok) errors.supplyPrice = "공급가는 0 이상의 정수로 입력하십시오.";
  const currencyRaw = text(fd, "supplyCurrency") || "JPY";
  const supplyCurrency = (CURRENCIES as readonly string[]).includes(currencyRaw) ? (currencyRaw as Currency) : null;
  if (!supplyCurrency) errors.supplyCurrency = "공급가 통화를 고르십시오.";

  const quote = price(text(fd, "quotePrice"));
  if (!quote.ok) errors.quotePrice = "견적가는 0 이상의 정수로 입력하십시오.";

  const note = textOrEmpty(fd, "note");
  if (note.length > NOTE_MAX) errors.note = `비고는 ${NOTE_MAX}자 이하여야 합니다.`;

  const itemId = text(fd, "itemId");
  if (!itemId) errors.itemId = "항목을 고르십시오.";
  else if (!itemIds.has(itemId)) errors.itemId = "없는 항목입니다. 다시 고르십시오.";

  const categoryRaw = text(fd, "category");
  const category = (CATEGORIES as readonly string[]).includes(categoryRaw) ? (categoryRaw as Category) : null;
  if (!category) errors.category = "분류를 고르십시오.";

  const ownerRaw = text(fd, "owner");
  const owner = (OWNERS as readonly string[]).includes(ownerRaw) ? (ownerRaw as Owner) : null;
  if (!owner) errors.owner = "소유를 고르십시오.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      name2,
      kyosanPartNo,
      drawingNo,
      supplyPrice: supply.ok ? supply.value : null,
      supplyCurrency: supplyCurrency!,
      quotePrice: quote.ok ? quote.value : null,
      note,
      itemId,
      category: category!,
      owner: owner!,
    },
  };
}

/** 폼이 되돌아올 때 입력값을 다시 채우려고, 문자열 그대로 꺼낸다. */
export const PART_FORM_FIELDS = ["name", "name2", "kyosanPartNo", "drawingNo", "supplyPrice", "supplyCurrency", "quotePrice", "note", "itemId", "category", "owner"] as const;
export type PartFormValues = Record<(typeof PART_FORM_FIELDS)[number], string>;

export function readPartFormValues(fd: FormLike): PartFormValues {
  const out = {} as PartFormValues;
  for (const f of PART_FORM_FIELDS) out[f] = text(fd, f);
  return out;
}

/** 저장된 부품 → 폼 값 (수정 화면의 처음 값) */
export function partToFormValues(p: {
  name: string;
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
  supplyPrice: number | null;
  supplyCurrency: Currency;
  quotePrice: number | null;
  note: string;
  itemId: string;
  category: Category;
  owner: Owner;
}): PartFormValues {
  return {
    name: p.name,
    name2: p.name2,
    kyosanPartNo: p.kyosanPartNo,
    drawingNo: p.drawingNo,
    supplyPrice: p.supplyPrice === null ? "" : String(p.supplyPrice),
    supplyCurrency: p.supplyCurrency,
    quotePrice: p.quotePrice === null ? "" : String(p.quotePrice),
    note: p.note,
    itemId: p.itemId,
    category: p.category,
    owner: p.owner,
  };
}

/**
 * 수정에서 무엇이 바뀌었나. 감사 로그의 「앞·뒤 값」(DESIGN 4-6절). 바뀐 칸만 담는다.
 */
export type PartChanges = Partial<Record<PartField, { before: string | number | null; after: string | number | null }>>;

export function diffPartInput(before: PartInput, after: PartInput): PartChanges {
  const out: PartChanges = {};
  for (const k of Object.keys(after) as PartField[]) {
    if (before[k] !== after[k]) out[k] = { before: before[k], after: after[k] };
  }
  return out;
}

/* ───────────── 항목 ───────────── */

export interface PartItemInput {
  code: string;
  name: string;
}
export type PartItemFieldErrors = Partial<Record<keyof PartItemInput | "form", string>>;

const ITEM_CODE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

/** 항목 추가 폼. 코드는 영문 대문자·숫자·밑줄(바깥에 내주는 값), 이름은 한글 화면 글자. */
export function parsePartItemForm(fd: FormLike): ParseResult<PartItemInput, PartItemFieldErrors> {
  const errors: PartItemFieldErrors = {};
  const code = text(fd, "code").toUpperCase();
  if (!code) errors.code = "코드를 입력하십시오.";
  else if (!ITEM_CODE_RE.test(code)) errors.code = "코드는 영문 대문자로 시작하고 영문·숫자·밑줄만 쓸 수 있습니다 (40자 이하).";
  const name = text(fd, "name");
  if (!name) errors.name = "이름을 입력하십시오.";
  else if (name.length > 50) errors.name = "이름은 50자 이하여야 합니다.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { code, name } };
}
