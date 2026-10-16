/**
 * ============================================================================
 * A/S 제품 모델 명부 — 순수 규칙 (DB 도 망도 여기서 만지지 않는다)
 * ============================================================================
 * 제품 모델(105개)의 주인은 **A/S 관리 시스템**이다. 이 시스템에는 그 표가 없고, 템플릿에 이을
 * 때마다 A/S 통로(`GET {AS_API_BASE_URL}/product-models`)에서 받아 온다. 실제로 받아 오는 일은
 * `as-product-models.ts` 가 하고, 여기에는 **받아 온 것을 어떻게 읽는가**만 둔다 — 그래야 아래
 * 판정들에 DB 도 망도 없는 시험이 붙는다.
 *
 * `src/lib/approval/directory.ts`(A/S 사람 명부)와 **같은 모양**이다. 둘 다 같은 A/S 통로 묶음을
 * 쓰고 같은 사고(저쪽이 꺼짐)를 겪으므로, 다른 모양으로 만들면 같은 일이 두 가지로 보인다.
 *
 * ── 🔴 「못 받아 왔다」와 「빈 목록」은 다른 말이다 ───────────────────────
 * 이 파일이 존재하는 이유가 그 한 줄이다. 통로가 200 으로 빈 목록을 돌려주는 것은 「이을 수 있는
 * 모델이 한 개도 없다」는 **사실**이고, 응답을 못 읽은 것은 **모름**이다. 둘을 같게 다루면 A/S 가
 * 꺼진 동안 화면이 「모델이 없습니다」라고 적고, 관리자는 A/S 쪽 모델이 지워진 줄 안다.
 * 아래 `parseAsProductModelsResponse` 가 둘을 가른다: 모양이 아니면 `null`(부르는 쪽이
 * `unreachable` 로 바꾼다), 모양이면 빈 배열 그대로.
 *
 * 🔴 **받아 온 명부를 우리 DB 에 저장하지 않는다.** 예외는 템플릿에 이어 붙일 때 적는
 * `product_model_name` 하나뿐이고, 그것은 명부의 사본이 아니라 **「그때 이렇게 이었다」는 기록**
 * 이다(`src/db/schema/oh-templates.ts` 머리말).
 * ============================================================================
 */

/** A/S 통로가 돌려주는 제품 모델 한 줄. 칸은 둘뿐이다. */
export type AsProductModel = {
  /** 🔴 A/S 의 `product_models.id`. 이 id 로 잇는다 — 모델명으로 이으면 저쪽에서 이름을 고치는 날 끊긴다. */
  id: string;
  modelName: string;
};

export type AsProductModelDirectoryUnreachableReason = "not_configured" | "timeout" | "error";

/** 명부를 받아 왔는가. 🔴 성공과 실패를 구별해 들고 다닌다(머리말). */
export type AsProductModelDirectory =
  | { status: "ok"; models: AsProductModel[] }
  | { status: "unreachable"; reason: AsProductModelDirectoryUnreachableReason };

/**
 * 못 받아 온 까닭을 사람 말로. 🔴 셋 다 **「모델이 없습니다」라고 말하지 않는다** — 모르는 것을
 * 없는 것처럼 적으면 관리자가 A/S 쪽을 의심한다.
 *
 * 말투는 `src/lib/approval/directory.ts` 의 `AS_DIRECTORY_MESSAGES` 와 맞춘다(같은 A/S 통로가
 * 응답하지 않을 때의 말이라, 두 화면이 다른 말을 하면 같은 사고가 다른 일로 보인다).
 */
export const AS_PRODUCT_MODEL_MESSAGES: Record<AsProductModelDirectoryUnreachableReason, string> = {
  not_configured: "A/S 제품 모델 통로가 아직 연결되지 않았습니다.",
  timeout: "A/S 가 응답하지 않습니다.",
  error: "A/S 제품 모델 목록을 불러오지 못했습니다.",
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 통로 응답(JSON) → 모델 목록. **모양이 아니면 `null`** 이다.
 *
 * 🔴 `null` 과 빈 배열을 부르는 쪽이 구별해야 한다(머리말) — `null` 은 「못 읽었다」, `[]` 는
 * 「한 개도 없다」다. 키 이름이 바뀌면 이 함수 하나만 고친다.
 *
 * 응답 모양: `{ generatedAt, count, models: [{ id, modelName }] }`. `count` 는 보지 않는다 —
 * 실제로 읽은 줄 수가 답이고, 둘이 다르면 `count` 를 믿는 쪽이 틀린다.
 *
 * id 나 이름이 빈 줄은 **버린다** — 고르개에 올려 봐야 고를 수 없고, 저장하면 우리 표의
 * `product_model_name NOT NULL` 에서 「알 수 없는 오류」로 터진다.
 */
export function parseAsProductModelsResponse(json: unknown): AsProductModel[] | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = (json as { models?: unknown }).models;
  if (!Array.isArray(raw)) return null;

  const models: AsProductModel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = str(o.id);
    const modelName = str(o.modelName);
    if (id === "" || modelName === "") continue;
    models.push({ id, modelName });
  }
  return models;
}

/**
 * 아직 어느 템플릿에도 안 붙은 모델만. **연결 고르개가 쓴다.**
 *
 * 원본(A/S)의 `listUnlinkedProductModels` 가 DB 조회 두 번으로 하던 일이다. 여기서는 모델 표가
 * 이 시스템에 없으므로 **받아 온 목록에서 걸러 낸다** — 그래서 순수 함수가 되고 시험이 붙는다.
 *
 * 🔴 **모델 하나는 템플릿 하나에만 붙는다**(`oh_part_template_models_model_uq`). 이미 붙은 것을
 * 고르개에서 빼 두지 않으면 사람이 고를 수는 있는데 저장이 거절당한다 — 거절 문구가 「어느
 * 템플릿에 붙어 있는지」를 말해 주긴 하지만, 애초에 고르게 하지 않는 편이 낫다.
 *
 * 차례는 **모델명 순**이다. 통로도 모델명 순으로 주지만 여기서 다시 맞춘다 — 고르개의 차례는
 * 화면이 믿는 값이고, 저쪽의 차례 규칙이 바뀌어도 이쪽이 흔들리지 않아야 한다.
 */
export function filterUnlinkedModels(
  models: readonly AsProductModel[],
  linkedModelIds: ReadonlySet<string>,
): AsProductModel[] {
  return models
    .filter((model) => !linkedModelIds.has(model.id))
    .sort((a, b) => a.modelName.localeCompare(b.modelName, "ko-KR"));
}

/**
 * 지금 어느 템플릿엔가 붙어 있는 모델 id 들. `filterUnlinkedModels` 에 넘길 값을 만든다.
 *
 * 🔵 템플릿 **전부**를 받는다(한 장이 아니라) — 모델은 템플릿 하나에만 붙으므로, 다른 템플릿에
 * 붙은 것도 이 템플릿의 고르개에서 빠져야 한다.
 *
 * 🔴 **받는 것은 「살아 있는 템플릿 전부」다**(`listOhTemplates` 가 지워진 것을 뺀다). 그래서
 * 지워진 템플릿에 걸린 모델은 고르개에 **그대로 올라온다** — 그것이 옳다. 아래
 * `decideProductModelLink` 가 그 모델을 받아 주므로, 고르개와 저장이 같은 말을 한다.
 */
export function linkedProductModelIds(
  templates: readonly { models: readonly { productModelId: string }[] }[],
): Set<string> {
  const ids = new Set<string>();
  for (const template of templates) {
    for (const model of template.models) ids.add(model.productModelId);
  }
  return ids;
}

/* ───────────────── 이미 붙어 있는 모델을 만났을 때 어떻게 하나 ───────────────── */

/**
 * 그 모델이 **지금 붙어 있는 줄**. `oh_part_template_models` 한 줄과 그 주인 템플릿의 상태다.
 * 없으면 `null` 을 넘긴다.
 */
export type ExistingProductModelLink = {
  templateId: string;
  templateName: string;
  /**
   * 🔴 **그 템플릿이 지워진(숨긴) 것인가.** 이 한 칸이 「사람이 풀 수 있는 연결」과
   * 「풀러 갈 데가 없는 연결」을 가른다 — 아래 머리말.
   */
  templateIsDeleted: boolean;
};

export type ProductModelLinkDecision =
  /** 이미 **이 템플릿**에 붙어 있다. 사람이 두 번 누른 것이고, 결과는 바라던 그대로다. */
  | { kind: "ALREADY" }
  /** 아무 데도 안 붙어 있다. 그냥 잇는다. */
  | { kind: "LINK" }
  /** 🔴 **지워진 템플릿**이 붙잡고 있다. 그 줄을 거둬들이고 잇는다(머리말). */
  | { kind: "TAKE_OVER"; fromTemplateName: string }
  /** 살아 있는 **다른** 템플릿에 붙어 있다. 거절하고, 어디로 가야 하는지 말해 준다. */
  | { kind: "BLOCKED"; message: string };

/**
 * 거절 문구. 🔴 **살아 있는 템플릿에만 쓴다** — 「그쪽 연결을 먼저 푸십시오」는 **갈 수 있는 곳이
 * 있을 때만** 참말이다. 지워진 템플릿은 목록에 뜨지 않고 되살리기 화면도 없으므로, 그 이름으로
 * 이 말을 하면 사람에게 **갈 수 없는 곳**을 가리키는 셈이 된다(2026-10-16 실제로 그랬다).
 */
export function productModelLinkBlockedMessage(productModelName: string, templateName: string): string {
  return `${productModelName} 은(는) 이미 「${templateName}」 템플릿에 연결되어 있습니다. 그쪽 연결을 먼저 푸십시오.`;
}

/**
 * ============================================================================
 * 🔴 이을 수 있나 — 그리고 못 이으면 **사람이 빠져나갈 길이 있나** (2026-10-16 결함 수리)
 * ============================================================================
 * 「모델 하나는 템플릿 하나에만」은 DB 의 unique(`oh_part_template_models_model_uq`)가 지키는
 * 규칙이고, 그 인덱스에는 **`WHERE is_deleted = false` 같은 조건이 없다** — 템플릿을 지워도
 * 그 줄은 표에 남아 모델 id 를 계속 붙잡는다.
 *
 * 그래서 고치기 전에는 이런 막다른 길이 있었다: 템플릿을 지우면 화면에서 사라지는데, 그 템플릿에
 * 걸린 모델을 다른 템플릿에 이으려 하면 **「지워진 템플릿에 가서 연결을 푸십시오」**라고 막았다.
 * 갈 곳이 없으므로 그 모델은 영영 다시 이을 수 없었다.
 *
 * ── 그래서 지워진 템플릿의 연결은 **막지 않고 거둬들인다** ─────────────────
 * 옛 줄은 **지운다**(옮기지 않는다). 까닭 둘:
 *   ① DB 의 unique 가 전역이라 **그냥 새로 잇는 길이 없다** — 옛 줄이 남아 있으면 insert 가
 *      23505 로 거절된다. 비워 둘 칸도 없다(`product_model_id` 는 NOT NULL).
 *   ② 지워진 템플릿이 그 모델을 **계속 가리킬 까닭이 없다.** 지워진 템플릿은 「이 장비의 O/H
 *      부품」을 더 이상 답하지 않는다(`findOhTemplateByProductModel` 이 지워진 것을 뺀다).
 *
 * ── 🔵 되살리면 어떻게 되나 ────────────────────────────────────────────────
 * 이 저장소에는 **되살리기 화면이 없다**(관리자가 DB 에서 `is_deleted` 를 되돌리는 것이 유일한
 * 길이다). 그렇게 되살려도 **모델 하나에 템플릿 둘**은 생기지 않는다 — 거둬들일 때 옛 줄을
 * 지웠으므로 되살아난 템플릿에는 그 모델이 **없다.** 모델은 사람이 나중에 이어 둔 쪽에 그대로
 * 붙어 있고, 그것이 사람이 마지막으로 한 말이다. 「지웠다가 되살렸더니 모델이 사라졌다」가 될 수
 * 있지만, 그 사이에 **사람이 그 모델을 다른 템플릿에 손수 이었을 때만** 그렇다. 감사 로그에
 * 거둬들인 줄(`OH_TEMPLATE_MODEL_UNLINKED`)이 남으므로 어디로 갔는지 답할 수 있다.
 *
 * @param targetTemplateId 이으려는 템플릿. 🔴 부르는 쪽이 **살아 있는지 이미 확인한 뒤**여야 한다.
 */
export function decideProductModelLink(
  targetTemplateId: string,
  productModelName: string,
  existing: ExistingProductModelLink | null,
): ProductModelLinkDecision {
  if (!existing) return { kind: "LINK" };
  // 같은 템플릿에 다시 거는 것은 그냥 성공이다(두 번 누른 것이고, 결과는 바라던 그대로다).
  if (existing.templateId === targetTemplateId) return { kind: "ALREADY" };
  // 🔴 지워진 템플릿이 붙잡고 있으면 **막지 않는다** — 사람이 풀러 갈 곳이 없다(머리말).
  if (existing.templateIsDeleted) return { kind: "TAKE_OVER", fromTemplateName: existing.templateName };
  return { kind: "BLOCKED", message: productModelLinkBlockedMessage(productModelName, existing.templateName) };
}
