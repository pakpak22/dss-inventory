import { parsePriceText } from "@/lib/parts/form";

/**
 * ============================================================================
 * O/H 부품 템플릿 입력 검증 — 형식만 본다
 * ============================================================================
 * A/S 의 `src/lib/validation/oh-part-template-input.ts` 를 옮겨 온 것이다(2026-10-15, 조각 8a).
 * **DB 도 세션도 망도 여기서 만지지 않는다** — 순수 함수여야 단위 시험이 붙고, 그래야 「어떤
 * 값을 받아들이는가」가 실제로 검증된다. 누가 적을 수 있는가(인가)는 서버 액션이, 그 부품이
 * 정말 있는가(자료)는 저장 쪽이 맡는다.
 *
 * ── 🔴 13줄이 상한인 까닭은 **양식에서 온다** ───────────────────────────
 * OH 견적서 양식의 `2) OH 부품 비용` 칸은 **34~46행, 13줄**이다. 그보다 많이 담아 두면 견적서를
 * 만들 때 넘치는 줄이 갈 곳이 없고, **그때 조용히 자르면 청구해야 할 부품이 문서에서 사라진다.**
 * 그래서 여기서 미리 막는다. 상한만 늘리면 저장은 되지만 견적서에서 부품이 조용히 잘린다 —
 * 늘리려면 양식을 먼저 고쳐야 한다.
 *
 * ── 🔴 여기에 작업비가 없다 ─────────────────────────────────────────────
 * 한때 이 템플릿이 `O/H 작업비` 를 갖고 있었는데 **없앴다**(2026-08-31 A/S 쪽 사용자 정정).
 * 작업비는 부품이 아니라 **수리 작업**에 붙고, 오버홀도 그 목록의 한 줄일 뿐이다. 이 템플릿은
 * 「오버홀이면 어떤 부품을 쓰는가」만 답한다.
 *
 * ── 🔵 원본에 없는 것 하나: O/H 단가 ────────────────────────────────────
 * 원본에서는 단가 검증이 형제 파일(`part-overhaul-unit-price-input.ts`)에 따로 있었다. 이
 * 저장소에서는 O/H 쪽 파일이 넷뿐이라 한 파일에 둔다 — 다만 **금액 규칙 자체는 여기 적지 않고**
 * `parsePriceText`(부품 등록 폼의 공급가·견적가 규칙)를 부른다. 아래 머리말 참조.
 * ============================================================================
 */

/** 저장소 다른 검증 파일들과 같은 모양. id 는 uuid 다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidOhTemplateId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 🔴 OH 견적서 양식의 OH 부품 칸(34~46행). 위 「13줄이 상한인 까닭」 참조. */
export const MAX_OH_TEMPLATE_ITEMS = 13;

/**
 * 🔴 **기종 코드(`code`) 검증은 없앴다**(2026-10-15 사용자 결정, 조각 9a). 그 글자는 엑셀 양식의
 * `K11` 에서만 뜻이 있던 흔적이고, 지금은 제품 모델을 직접 잇는다. 까닭 전부는
 * `src/db/schema/oh-templates.ts` 머리말에.
 *
 * 🔵 **`name` 은 그대로 필수다.** 코드를 없앤 뒤로는 이름이 템플릿을 가리키는 유일한 글자라,
 * 비어도 된다고 풀면 「이름 없는 템플릿」이 목록에 서고 아무도 그것을 집어 말할 수 없다.
 */
const MAX_NAME = 100;
const MAX_PART_NAME = 200;
const MAX_NOTE = 1000;
/** `oh_part_template_items.quantity` 는 integer 다. 넘으면 DB 가 「알 수 없는 오류」로 터진다. */
const MAX_QUANTITY = 2_147_483_647;

export type OhTemplateItemInput = {
  /** 재고 마스터 연결. **null 이 정상이다** — 마스터에 없는 품목이 실제로 있다. */
  partId: string | null;
  partNameText: string;
  quantity: number;
};

export type OhTemplateFields = {
  name: string;
  note: string | null;
  items: OhTemplateItemInput[];
};

export type ValidateOhTemplateResult =
  | { ok: true; data: OhTemplateFields }
  | { ok: false; fieldErrors: Record<string, string> };

export function validateOhTemplateFields(raw: Record<string, unknown>): ValidateOhTemplateResult {
  const fieldErrors: Record<string, string> = {};

  function required(key: string, label: string, max: number): string {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") {
      fieldErrors[key] = `${label}을(를) 입력하십시오.`;
      return "";
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
      fieldErrors[key] = `${label}은(는) ${max}자를 넘을 수 없습니다.`;
      return "";
    }
    return trimmed;
  }

  const name = required("name", "이름", MAX_NAME);

  let note: string | null = null;
  const rawNote = raw.note;
  if (typeof rawNote === "string" && rawNote.trim() !== "") {
    if (rawNote.trim().length > MAX_NOTE) fieldErrors.note = `비고는 ${MAX_NOTE}자를 넘을 수 없습니다.`;
    else note = rawNote.trim();
  }

  const items: OhTemplateItemInput[] = [];
  const rawItems = raw.items;
  if (rawItems !== null && rawItems !== undefined) {
    if (!Array.isArray(rawItems)) {
      fieldErrors.items = "부품 목록을 확인할 수 없습니다.";
    } else if (rawItems.length > MAX_OH_TEMPLATE_ITEMS) {
      // 양식의 칸이 13줄이다. 넘치면 견적서에서 갈 곳이 없다(파일 머리말).
      fieldErrors.items = `OH 견적서 양식의 부품 칸이 ${MAX_OH_TEMPLATE_ITEMS}줄이라 그보다 많이 담을 수 없습니다.`;
    } else {
      rawItems.forEach((entry, index) => {
        const at = (field: string) => `items.${index}.${field}`;
        const line = index + 1;
        if (typeof entry !== "object" || entry === null) {
          fieldErrors[`items.${index}`] = `${line}번째 줄을 확인할 수 없습니다.`;
          return;
        }
        const row = entry as Record<string, unknown>;

        const partNameText = typeof row.partNameText === "string" ? row.partNameText.trim() : "";
        if (partNameText === "") fieldErrors[at("partNameText")] = `${line}번째 부품의 품명을 입력하십시오.`;
        else if (partNameText.length > MAX_PART_NAME) {
          fieldErrors[at("partNameText")] = `${line}번째 부품의 품명은 ${MAX_PART_NAME}자를 넘을 수 없습니다.`;
        }

        const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
          fieldErrors[at("quantity")] = `${line}번째 부품의 수량은 1 이상의 정수여야 합니다.`;
        }

        let partId: string | null = null;
        if (row.partId !== null && row.partId !== undefined && row.partId !== "") {
          if (!isValidOhTemplateId(row.partId)) {
            fieldErrors[at("partId")] = `${line}번째 부품의 재고 연결을 확인할 수 없습니다.`;
          } else partId = row.partId as string;
        }

        items.push({ partId, partNameText, quantity });
      });
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { name, note, items } };
}

/* ───────────────────────── 부품별 O/H 단가 ───────────────────────── */

/**
 * O/H 단가 칸의 오류 키에 붙는 접두사.
 *
 * O/H 템플릿 화면은 **템플릿 칸과 단가 칸을 한 표에서** 편집한다. 두 검증이 서로 다른 것을 키로
 * 쓰는데(템플릿은 칸 이름, 단가는 **부품 id**) 한 자루에 담기면 화면은 어느 쪽 오류인지 가릴 수
 * 없다. 그래서 단가 오류에만 이 접두사를 붙인다.
 */
export const OH_PRICE_FIELD_ERROR_PREFIX = "ohPrice:";

/** O/H 단가 한 칸. 🔴 `unitPrice: null` 은 「정하지 않음」 — 저장 쪽이 그 줄을 **지운다.** */
export type OhPriceEntry = {
  partId: string;
  unitPrice: number | null;
};

export type ValidateOhPriceEntriesResult =
  | { ok: true; data: OhPriceEntry[] }
  | { ok: false; fieldErrors: Record<string, string> };

const PRICE_MESSAGE = "O/H 단가는 0 이상의 정수로 입력하십시오.";

/**
 * ============================================================================
 * 🔴 빈 값은 0 이 아니다
 * ============================================================================
 * 칸을 비운 것은 「O/H 단가를 정하지 않았다」는 뜻이고, 저장 쪽에서 그 줄을 **지우는** 신호다
 * (`null` 로 돌려준다). 0 으로 바꿔 저장하면 「정하지 않음」을 다시 표현할 방법이 사라지고,
 * **O/H 견적서가 정하지 않은 부품을 0원으로 청구하게 된다.** 0 은 그 자체로 「오버홀 때는 무상으로
 * 주는 부품」이라는 뜻이다(`src/db/schema/oh-templates.ts` 의 `part_overhaul_unit_prices` 머리말).
 *
 * 🔴 **금액 규칙을 두 벌로 만들지 않는다.** 쉼표·통화 기호 처리, 0 이상 정수, 자릿수 상한은
 * `src/lib/parts/form.ts` 의 `parsePriceText` 한 곳에 있고 이 함수는 그것을 **부른다.** 규칙이
 * 두 파일에 갈라져 있으면 한쪽만 고쳐지는 날 견적가와 O/H 단가가 서로 다른 값을 받아들인다 —
 * 둘 다 같은 견적서로 흘러가므로 어긋나도 눈에 띄지 않는다.
 *
 * 받는 모양은 셋이다: 빈 글자·`null`·`undefined` 는 「정하지 않음」, 글자는 그대로, 숫자는 글자로
 * 바꿔 같은 규칙에 태운다(소수점·음수·지수 표기는 그 규칙이 거른다).
 * ============================================================================
 */
export function parseOhPriceValue(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  let text: string;
  if (typeof raw === "number") {
    // 🔴 유한한 수가 아니면 글자로 바꿔 봐야 "NaN"·"Infinity" 가 되어 규칙이 거르지만,
    //    여기서 먼저 끊는 편이 뜻이 분명하다.
    if (!Number.isFinite(raw)) return { ok: false, message: PRICE_MESSAGE };
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.trim();
  } else {
    return { ok: false, message: PRICE_MESSAGE };
  }

  const parsed = parsePriceText(text);
  if (!parsed.ok) return { ok: false, message: PRICE_MESSAGE };
  return { ok: true, value: parsed.value };
}

/**
 * 화면이 한 번에 보내는 여러 부품의 O/H 단가를 통째로 검증한다.
 *
 * O/H 템플릿 화면은 부품 열몇 개의 단가를 **한 표에서 한 단추로** 저장한다. 그래서 **하나라도
 * 틀리면 전부 거절한다** — 반쯤 저장되면 어느 부품의 단가가 살아 있는지 화면과 DB 가 달라진다.
 * 같은 부품이 두 번 오는 것도 거절한다: 어느 쪽이 뜻인지 알 수 없고, 이 표는 부품마다 한 줄이라
 * 두 값 중 하나는 반드시 사라진다.
 *
 * 🔴 **보내지 않은 부품은 건드리지 않는다**(= 지금 값 그대로). 빈 배열은 「고칠 칸이 없다」이고,
 * 아예 보내지 않는 것은 「단가는 이번 저장의 일이 아니다」다 — 부르는 쪽이 둘을 구별해 보낸다.
 */
export function validateOhPriceEntries(raw: unknown): ValidateOhPriceEntriesResult {
  const fieldErrors: Record<string, string> = {};

  if (!Array.isArray(raw)) {
    return { ok: false, fieldErrors: { partId: "O/H 단가 입력을 확인할 수 없습니다." } };
  }

  const entries: OhPriceEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      fieldErrors.partId = "O/H 단가 입력을 확인할 수 없습니다.";
      continue;
    }

    const partId = (item as { partId?: unknown }).partId;
    if (!isValidOhTemplateId(partId)) {
      // 알 수 없는 부품은 붙일 줄이 없다. 조용히 버리지 않는 까닭은, 화면이 보낸 줄 하나가
      // 통째로 사라지면 사람은 저장됐다고 믿기 때문이다.
      fieldErrors.partId = "부품을 확인할 수 없습니다.";
      continue;
    }
    if (seen.has(partId)) {
      fieldErrors[partId] = "같은 부품이 두 번 들어왔습니다.";
      continue;
    }
    seen.add(partId);

    const parsed = parseOhPriceValue((item as { unitPrice?: unknown }).unitPrice);
    if (!parsed.ok) {
      fieldErrors[partId] = parsed.message;
      continue;
    }

    entries.push({ partId, unitPrice: parsed.value });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: entries };
}
