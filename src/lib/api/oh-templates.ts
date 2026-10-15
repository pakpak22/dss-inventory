/**
 * ============================================================================
 * A/S 가 **「이 장비의 O/H 부품 목록」을 읽어 가는 통로**의 검사와 모양 — 순수 함수
 * (2026-10-15, `GET /api/v1/oh-templates`)
 * ============================================================================
 * O/H 부품 템플릿은 2026-10-15 에 A/S 에서 **재고 관리로 옮겨 왔다**(조각 5·8·9). 옮긴 뒤로
 * 정본은 이쪽 표(`oh_part_templates` · `oh_part_template_items` · `oh_part_template_models`)다.
 * 그런데 **A/S 가 그것을 읽어 갈 통로가 없었다** — 통로가 없으면 A/S 는 제 옛 표를 계속 보게 되고,
 * 옮긴 뜻이 그대로 사라진다. 이 파일이 그 통로의 규칙이다.
 *
 * ── 🔴 잇는 열쇠는 **A/S 의 제품 모델 id** 하나다 ─────────────────────────
 * 우리 `oh_part_template_models.product_model_id` 에 적혀 있는 값이 바로 **A/S 의
 * `product_models.id`** 다(그 표 머리말: 「제품 모델 표가 이 시스템에 없다 … A/S 의 ID 를 글자로
 * 적어 둘 뿐」). 그 값은 A/S 자신이 `GET /api/v1/product-models` 로 내준 것을 관리자가 화면에서
 * 골라 적은 것이라, **A/S 는 묻고 싶은 장비의 모델 id 를 이미 들고 있다**
 * (A/S 쪽 `findOhTemplateForRepairCase` 도 같은 값으로 찾는다: 수리 건 → 제품 → `product_models.id`).
 *
 * 🔴 **이름으로 잇지 않는다.** 우리 표의 `product_model_name` 은 **이을 때 떠 온 사본**이고 정본은
 * 언제나 A/S 다 — 저쪽에서 이름을 고치면 이쪽 값은 따라 바뀌지 않으므로, 이름으로 맞추는 통로는
 * 이름을 고치는 날 **조용히 빈 답**을 돌려준다. 그래서 받는 값은 id 뿐이고, id 꼴이 아니면 거절한다.
 *
 * ── 🔴 **O/H 단가는 내보내지 않는다** ────────────────────────────────────
 * A/S 화면이 쓰는 것은 「무엇을 몇 개」다. 단가는 견적 쪽 값이고(`part_overhaul_unit_prices`),
 * 「행이 없다(정하지 않음)」와 「0(무상)」을 가려 읽어야 하는 값이라 부품 요청 통로에 실어 보내면
 * 읽는 쪽이 `?? 0` 으로 뭉갠다. 그래서 **아래 모양에 그 칸이 없고**, 읽는 질의도 그 표를 열지 않는다.
 *
 * ── 🔴 **안 이어진 줄을 감추지 않는다** ──────────────────────────────────
 * 템플릿 줄의 `part_id` 는 **비는 것이 정상이다**(양식에서 옮겨 온 이름 중에 재고 마스터에 없는 것이
 * 있다). 그 줄을 빼고 보내면 A/S 는 받은 줄만 보고 **다 담겼다고 믿는다** — 정작 필요한 부품을
 * 빠뜨린 채 요청이 나간다. A/S 화면은 지금 그 사실을 사람에게 알려 주고 있으므로
 * (`PartRequestSection.tsx`: 「재고에 없어 담지 못함(직접 찾아 담아 주세요): …」), 우리가 감추면
 * 그 말을 못 하게 된다. 그래서 **줄은 전부 보내고** `linked` 로 그 사실을 짚는다.
 * ============================================================================
 */

/** 🔵 `src/lib/oh/input.ts` 와 같은 꼴. 저쪽은 화면이 보낸 값을, 여기는 바깥 시스템이 보낸 값을 본다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 묻는 칸 이름. 🔵 `model` 이 아니라 `modelId` 인 까닭: **이름을 넣으면 안 되는 자리**임을 이름이 말해야 한다. */
export const MODEL_ID_PARAM = "modelId";

export type ParseOhTemplateQueryResult = { ok: true; modelId: string } | { ok: false; message: string };

/**
 * `?modelId=<A/S 의 product_models.id>` 를 읽는다.
 *
 * 🔴 **빠지면 거절한다.** 조건이 없을 때 조용히 템플릿 전부를 내주지 않는다 —
 *    `GET /api/v1/parts` 가 모르는 값을 400 으로 돌려주는 것, `GET /api/v1/stock-requests` 가 열쇠 없는
 *    호출을 거절하는 것과 같은 까닭이다.
 * 🔴 **id 꼴이 아니면 거절한다.** 두 가지를 막는다: ① 이름(`RFG-15`)을 보내는 실수 — 받아서 못 찾으면
 *    「템플릿이 없다」와 구별되지 않는다. ② 아무 글자나 그대로 DB 의 uuid 칸에 견주러 보내는 것 —
 *    그러면 400 이어야 할 일이 500 으로 터진다.
 */
export function parseOhTemplateQuery(params: URLSearchParams): ParseOhTemplateQueryResult {
  const raw = (params.get(MODEL_ID_PARAM) ?? "").trim();
  if (raw === "") {
    return {
      ok: false,
      message: `${MODEL_ID_PARAM} 에 제품 모델 id 를 보내십시오. 예: ?${MODEL_ID_PARAM}=3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d (A/S 의 product_models.id)`,
    };
  }
  if (!UUID_RE.test(raw)) {
    return {
      ok: false,
      message: `${MODEL_ID_PARAM} 는 제품 모델 id(uuid)여야 합니다. 모델 이름으로는 찾지 않습니다 — 이름은 바뀌기 때문입니다.`,
    };
  }
  return { ok: true, modelId: raw };
}

/**
 * 템플릿 줄 하나 — **무엇을 몇 개**.
 *
 * 🔴 이 모양도 다른 시스템이 의존하는 **약속**이다. 칸을 더하는 것은 괜찮지만 이름을 바꾸거나 빼지 않는다
 *    (API.md 머리말).
 */
export interface ApiOhTemplateItem {
  /** 템플릿에 적힌 차례. 1부터. 🔵 **차례 자체가 뜻을 갖는다**(양식의 부품 순서 그대로다) */
  displayOrder: number;
  /**
   * 재고 관리의 부품 No. **안 이어진 줄이면 `null`** 이다.
   *
   * 🔴 지어내지 않는다. 그리고 **숨긴(지운) 부품도 `null`** 이다 — 숨긴 부품의 번호를 내주면 A/S 가 그것을
   *    담아 반출 신청을 올리고, 그 신청은 `POST /api/v1/stock-requests` 에서 **통째로 400** 이 된다
   *    (「없는 No. 와 숨긴 부품은 거절한다」, API.md 4-3절). 한 줄 때문에 요청 전체가 막히는 셈이다.
   */
  no: number | null;
  /**
   * **템플릿에 적혀 있는 이름 그대로.** 언제나 있다(`part_name_text` 는 NOT NULL).
   * 🔵 안 이어진 줄에서 사람에게 보여 줄 이름이 이것이고, 견적서에 찍히는 값도 이것이다.
   */
  name: string;
  /**
   * 이어진 재고 부품의 **지금 품명**. 안 이어진 줄이면 `null`.
   * 🔵 위 `name` 과 **다를 수 있다**(이은 뒤 재고 쪽에서 품명을 고친 경우). 둘 다 주는 까닭은
   *    재고에 담을 때는 재고의 이름으로 보여 주는 편이 사람에게 덜 헷갈리기 때문이다.
   */
  partName: string | null;
  /** 이 기종을 O/H 할 때 들어가는 수량. 1 이상 */
  quantity: number;
  /**
   * 🔴 **재고 마스터에 이어져 있는가.** `false` 면 A/S 가 부품 요청에 **담을 수 없는 줄**이다
   *    — 조용히 빼지 말고 사람에게 알려야 한다(이 파일 머리말).
   * 🔵 `no !== null` 과 언제나 같은 값이고, 한 자리(`toApiOhTemplateItem`)에서 그렇게 만든다.
   *    그런데도 칸을 두는 까닭: 읽는 쪽이 「번호가 없네」를 **빠진 값**으로 읽고 넘어가지 않도록
   *    **사실로 적어 주는 것**이다. 이 통로를 낸 이유의 절반이 이 한 칸이다.
   */
  linked: boolean;
}

/** 템플릿 한 장. */
export interface ApiOhTemplate {
  /** 재고 쪽 템플릿 번호. 사람에게 물을 때 쓴다 */
  id: string;
  /** 🔴 템플릿을 가리키는 유일한 글자(2026-10-15 에 기종 코드를 없앴다 — 스키마 머리말) */
  name: string;
  /** 비고. 없으면 `""` — `GET /api/v1/parts` 의 글자 칸과 같은 관례다 */
  note: string;
  items: ApiOhTemplateItem[];
}

/**
 * 재고 쪽 읽기(`lib/oh/queries.ts` 의 `findOhTemplateByProductModel`)가 돌려주는 모양에서 **이 통로가
 * 쓰는 칸만** 추린 것.
 *
 * 🔴 그 타입을 직접 끌어오지 않는 까닭: 저 파일은 `server-only` 라 `npm test` 가 **불러올 수조차 없다**.
 *    여기(순수 함수)에 모양만 적어 두면 시험이 DB 없이 덮고, 두 모양이 어긋나면 통로 파일에서 tsc 가 멈춘다
 *    (`./stock-request-status.ts` 의 `RequestStatusSource` 와 같은 판단).
 */
export interface OhTemplateSource {
  id: string;
  name: string;
  note: string | null;
  items: readonly {
    displayOrder: number;
    partNameText: string;
    quantity: number;
    /** 🔴 **숨긴 부품은 여기서 이미 `null`** 이다(질의가 `is_deleted = false` 로 이어 읽는다) */
    partNo: number | null;
    partName: string | null;
  }[];
}

export function toApiOhTemplateItem(item: OhTemplateSource["items"][number]): ApiOhTemplateItem {
  return {
    displayOrder: item.displayOrder,
    no: item.partNo,
    name: item.partNameText,
    partName: item.partName,
    quantity: item.quantity,
    // 🔴 한 자리에서 만든다 — 두 곳에서 세면 언젠가 어긋나고, 어긋나면 담을 수 없는 줄이 담긴다.
    linked: item.partNo !== null,
  };
}

export function toApiOhTemplate(t: OhTemplateSource): ApiOhTemplate {
  return {
    id: t.id,
    name: t.name,
    note: t.note ?? "",
    items: t.items.map(toApiOhTemplateItem),
  };
}

export interface ApiOhTemplateResponse {
  generatedAt: string;
  /** 🔵 **물어본 모델 id 를 그대로** 돌려준다 — A/S 가 제 장비와 짝지을 수 있게 */
  modelId: string;
  /**
   * 🔴 **이 모델에 이어진 템플릿이 없으면 `null` 이다. 오류가 아니다.**
   *    A/S 쪽에서도 「null 이 정상이다」가 이미 적혀 있다(`PartRequestSection` 의 `ohTemplate` 프롭:
   *    모델을 안 이어 두었거나 O/H 템플릿이 없는 기종이면 없다). 404 로 돌려주면 저쪽은 **통로가 깨진 것**과
   *    **이어 둔 템플릿이 없는 것**을 가릴 수 없다.
   * 🔵 **지워진(숨긴) 템플릿도 `null`** 이다 — 질의가 걸러 낸다.
   */
  template: ApiOhTemplate | null;
}

export function buildOhTemplateResponse(modelId: string, found: OhTemplateSource | null, generatedAt: string): ApiOhTemplateResponse {
  return { generatedAt, modelId, template: found ? toApiOhTemplate(found) : null };
}
