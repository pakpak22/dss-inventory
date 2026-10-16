import { CATEGORIES, CURRENCIES, OWNERS, type Category, type Currency, type Owner } from "@/db/schema/codes";
import { MAX_QTY } from "@/lib/stock/form";

/**
 * 부품 등록·수정 폼의 **검사** — 순수 함수. FormData 를 받아 저장할 값 또는 칸별 한국어 오류를 돌려준다.
 * 서버 액션이 부르고, 시험은 DB 없이 돈다. 🔴 클라이언트가 보낸 값은 여기서 전부 다시 검사한다 (CLAUDE.md 8-4절).
 *
 * 규칙 (DESIGN 2-3절):
 *  - 품명 필수. No. 는 프로그램이 매긴다(폼에 없다). 수량은 여기서 못 고친다(폼에 없다).
 *  - 품명2·고객사 품명·교산 품번·도번·비고는 비면 빈 문자열. 공급가·견적가는 비면 null, 적으면 0 이상의 정수.
 *  - 한계수량은 비면 null(= 정하지 않음 = 알리지 않음), 적으면 0 이상의 정수 (2026-10-16).
 */
export interface PartInput {
  name: string;
  name2: string;
  /**
   * 고객사 품명 — 고객사에 나가는 서류(견적서)에 쓸 이름. 우리 품명(`name`)과 다르다 (2026-10-14 결정).
   * 🔴 「이미 값이 있으면 덮어쓰지 않는다」는 규칙은 **A/S 에서 값이 들어올 때**를 위한 것이고
   *    사람이 이 폼에서 직접 고치는 길에는 걸지 않는다 — 걸면 사람이 오타를 못 고친다.
   */
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  supplyPrice: number | null;
  supplyCurrency: Currency;
  quotePrice: number | null;
  /**
   * 한계수량 — 재고가 **이 수 이하가 되면** 종에 알린다 (2026-10-16 사용자 요청, **같을 때도 알린다**).
   *
   * 🔴 **`null` 과 `0` 이 다르다.** `null` 은 「정하지 않았다」라 그 부품은 아예 알림 대상이 아니고,
   *    `0` 은 「하나도 안 남으면 알려라」는 **정한 값**이다 — 재고가 0 이면 `0 <= 0` 이라 울린다.
   *    🔴 **그래서 `0` 은 끄는 값이 아니다. 끄려면 칸을 비운다(`null`).** 부등호가 「미만」이던
   *    잠깐 동안에는 0 이 사실상 끄는 값이었는데 **지금은 아니다**(뜻은 `lib/parts/codes.ts` 의
   *    `isLowStock`). `?? 0` 으로 뭉개면 정하지 않은 부품이 재고 0 이 되는 순간 전부 울린다.
   *    「빈 칸과 0 은 다르다」는 결 자체는 금액 칸(공급가·견적가)이 이미 지키는 규칙 그대로다.
   * 🔴 음수는 받지 않는다(아래 parseLimitQuantityText).
   */
  limitQuantity: number | null;
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

/**
 * 🔵 **바깥 통로가 같은 자를 쓰도록 이름만 내보낸다** (2026-10-16,
 * `POST /api/v1/parts/{no}/customer-name` — `src/lib/api/part-customer-name.ts`).
 *
 * 🔴 **같은 칸인데 들어온 길에 따라 값이 달라지면 안 된다.** 화면에서 201자를 치면 거절당하는데
 *    A/S 에서 보낸 201자는 들어가 버리면, 같은 부품의 같은 칸이 어디서 고쳤느냐로 갈린다
 *    (바로 위 `parseCustomerName` 이 길이를 베껴 적지 않는 것과 **같은 까닭**이고, 반출 신청 통로가
 *    `MAX_KEY` 를 되읽는 통로에 내주는 것과도 같은 관례다).
 * 🔴 `-` 한 글자도 함께 내준다 — 엑셀 습관으로 적힌 `-` 는 이 저장소 어디서나 **「없음」**이다.
 *    그것을 값으로 받아 두면 고객사에 나가는 서류에 `-` 가 이름으로 찍히고, 그 뒤로는 칸이
 *    「이미 차 있다」가 되어 **이 통로로는 영영 못 고친다**(덮어쓰지 않으므로).
 * 🔴 **동작은 한 글자도 바뀌지 않았다** — 이 파일 안에서 쓰는 자리는 그대로다.
 */
export { TEXT_MAX as CUSTOMER_NAME_MAX, DASH_ONLY as CUSTOMER_NAME_DASH_ONLY };

/**
 * 금액 칸 한 벌의 규칙. 🔴 **빈 칸과 0 은 다르다** — 빈 칸은 `null`(모름·정하지 않음)이고 `0` 은 값이다.
 *
 * 🔵 내보내는 까닭(2026-10-15, 조각 8a): O/H 단가(`src/lib/oh/input.ts`)가 **같은 함수를 부른다.**
 * 금액 규칙을 두 벌로 적으면 한쪽만 고쳐지는 날 견적가와 O/H 단가가 서로 다른 값을 받아들인다 —
 * 둘 다 같은 견적서로 흘러가므로 어긋나도 눈에 띄지 않는다.
 */
export function parsePriceText(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (raw === "") return { ok: true, value: null };
  const cleaned = raw.replace(/[,\s¥₩]/g, "");
  if (!/^\d+$/.test(cleaned)) return { ok: false };
  const n = Number(cleaned);
  if (!Number.isSafeInteger(n) || n > PRICE_MAX) return { ok: false };
  return { ok: true, value: n };
}

/**
 * 한계수량 칸의 규칙 (2026-10-16). 🔴 **빈 칸과 0 은 다르다** — 빈 칸은 `null`(정하지 않음 = 알림 없음)이고
 * `0` 은 정한 값이다. 금액 칸과 **같은 결**이고, 다른 점은 상한뿐이다.
 *
 * 🔴 상한을 여기서 새로 정하지 않는다 — 한 건에 적을 수 있는 수량의 상한(`MAX_QTY`, `lib/stock/form.ts`)을
 *    그대로 쓴다. 한계수량이 그보다 커질 까닭이 없고, 숫자를 따로 적으면 언젠가 두 벌이 갈린다.
 * 🔴 **음수는 모양에서 걸린다** — `^\d+$` 라 `-1` 은 애초에 통과하지 못한다. 「0 이상」을 부등호로
 *    한 번 더 적지 않는 까닭이 그것이다.
 *
 * 🔵 내보내는 까닭: 상세 창에서 이 칸 하나만 고치는 길(`parseLimitQuantity`)과 폼 전체 검사가 **같은 자를**
 *    써야 한다 — 같은 칸인데 어디서 고쳤느냐로 받는 값이 달라지면 안 된다(`parseCustomerName` 과 같은 관례).
 */
export function parseLimitQuantityText(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (raw === "") return { ok: true, value: null };
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return { ok: false };
  const n = Number(cleaned);
  if (!Number.isSafeInteger(n) || n > MAX_QTY) return { ok: false };
  return { ok: true, value: n };
}

/** 한계수량 칸이 틀렸을 때의 한 문장. 🔴 두 길(폼 전체·상세 창)이 **같은 글자**를 쓴다. */
export const LIMIT_QUANTITY_ERROR = `한계수량은 0 이상의 정수로 입력하십시오(${MAX_QTY.toLocaleString("ko-KR")} 이하). 비우면 알리지 않습니다.`;

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
  const customerName = textOrEmpty(fd, "customerName");
  if (customerName.length > TEXT_MAX) errors.customerName = `고객사 품명은 ${TEXT_MAX}자 이하여야 합니다.`;
  const kyosanPartNo = textOrEmpty(fd, "kyosanPartNo");
  if (kyosanPartNo.length > TEXT_MAX) errors.kyosanPartNo = `교산 품번은 ${TEXT_MAX}자 이하여야 합니다.`;
  const drawingNo = textOrEmpty(fd, "drawingNo");
  if (drawingNo.length > TEXT_MAX) errors.drawingNo = `도번은 ${TEXT_MAX}자 이하여야 합니다.`;

  const supply = parsePriceText(text(fd, "supplyPrice"));
  if (!supply.ok) errors.supplyPrice = "공급가는 0 이상의 정수로 입력하십시오.";
  const currencyRaw = text(fd, "supplyCurrency") || "JPY";
  const supplyCurrency = (CURRENCIES as readonly string[]).includes(currencyRaw) ? (currencyRaw as Currency) : null;
  if (!supplyCurrency) errors.supplyCurrency = "공급가 통화를 고르십시오.";

  const quote = parsePriceText(text(fd, "quotePrice"));
  if (!quote.ok) errors.quotePrice = "견적가는 0 이상의 정수로 입력하십시오.";

  const limitQuantity = parseLimitQuantityText(text(fd, "limitQuantity"));
  if (!limitQuantity.ok) errors.limitQuantity = LIMIT_QUANTITY_ERROR;

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
      customerName,
      kyosanPartNo,
      drawingNo,
      supplyPrice: supply.ok ? supply.value : null,
      supplyCurrency: supplyCurrency!,
      quotePrice: quote.ok ? quote.value : null,
      limitQuantity: limitQuantity.ok ? limitQuantity.value : null,
      note,
      itemId,
      category: category!,
      owner: owner!,
    },
  };
}

/**
 * 고객사 품명 **하나만** 고치는 전용 길의 검사 (2026-10-14 사용자 결정 (다): 이 칸만 STAFF 이상).
 * 폼 전체 검사와 **같은 규칙**을 쓴다 — 앞뒤 공백 정리, 엑셀 습관대로 친 `-` 는 빈 값, 200자 이하.
 * 🔴 규칙을 여기에 베껴 적지 않고 `textOrEmpty`·`TEXT_MAX` 를 그대로 쓴다. 두 길이 다르게 받으면
 *    같은 칸인데 어디서 고쳤느냐에 따라 값이 달라진다.
 */
export function parseCustomerName(fd: FormLike): ParseResult<string, string> {
  const v = textOrEmpty(fd, "customerName");
  if (v.length > TEXT_MAX) return { ok: false, errors: `고객사 품명은 ${TEXT_MAX}자 이하여야 합니다.` };
  return { ok: true, value: v };
}

/**
 * 한계수량 **하나만** 고치는 전용 길의 검사 — 상세 창에서 그 자리에서 고친다 (2026-10-16).
 * 🔴 규칙을 베껴 적지 않고 `parseLimitQuantityText` 를 그대로 쓴다. 두 길이 다르게 받으면 같은 칸인데
 *    어디서 고쳤느냐에 따라 값이 달라진다(`parseCustomerName` 과 같은 까닭).
 * 🔵 **칸을 비우면 null** 이다 — 「알림을 끈다」가 그 길이다.
 */
export function parseLimitQuantity(fd: FormLike): ParseResult<number | null, string> {
  const r = parseLimitQuantityText(text(fd, "limitQuantity"));
  if (!r.ok) return { ok: false, errors: LIMIT_QUANTITY_ERROR };
  return { ok: true, value: r.value };
}

/** 폼이 되돌아올 때 입력값을 다시 채우려고, 문자열 그대로 꺼낸다. */
export const PART_FORM_FIELDS = [
  "name",
  "name2",
  "customerName",
  "kyosanPartNo",
  "drawingNo",
  "supplyPrice",
  "supplyCurrency",
  "quotePrice",
  "limitQuantity",
  "note",
  "itemId",
  "category",
  "owner",
] as const;
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
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  supplyPrice: number | null;
  supplyCurrency: Currency;
  quotePrice: number | null;
  limitQuantity: number | null;
  note: string;
  itemId: string;
  category: Category;
  owner: Owner;
}): PartFormValues {
  return {
    name: p.name,
    name2: p.name2,
    customerName: p.customerName,
    kyosanPartNo: p.kyosanPartNo,
    drawingNo: p.drawingNo,
    supplyPrice: p.supplyPrice === null ? "" : String(p.supplyPrice),
    supplyCurrency: p.supplyCurrency,
    quotePrice: p.quotePrice === null ? "" : String(p.quotePrice),
    // 🔴 `null`(정하지 않음)만 빈 칸이다. `0` 은 정한 값이라 "0" 으로 그린다 — 금액 칸과 같은 결.
    limitQuantity: p.limitQuantity === null ? "" : String(p.limitQuantity),
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
