"use server";

import { requireRole } from "@/lib/auth/session";
import { fetchAsProductModels } from "@/lib/oh/as-product-models";
import {
  OH_PRICE_FIELD_ERROR_PREFIX,
  isValidExpectedVersion,
  isValidOhTemplateId,
  parseOhPriceValue,
  validateOhPriceEntries,
  validateOhTemplateFields,
  type OhPriceEntry,
} from "@/lib/oh/input";
import {
  deleteOhTemplate,
  linkProductModel,
  saveOhTemplate,
  setPartOverhaulPrice,
  unlinkProductModel,
} from "@/lib/oh/mutations";
import { AS_PRODUCT_MODEL_MESSAGES } from "@/lib/oh/product-models";

/**
 * ============================================================================
 * 서버 액션: O/H 부품 템플릿 (정책 계층)
 * ============================================================================
 * 인가 → 입력 검증 → mutation. 순서가 곧 규칙이다. 그 아래 일(트랜잭션·낙관적 잠금·재고 연결
 * 확인과 품명 채우기·감사 기록)은 `src/lib/oh/mutations.ts` 가 자기 트랜잭션 안에서 한다.
 *
 * 🔴 **인가를 액션 안에서 다시 본다.** 화면이 메뉴를 숨기는 것은 편의일 뿐 차단이 아니다 —
 * 서버 액션은 네트워크 경계 너머에서 불리고, 그 경계에서 타입은 아무것도 막지 못한다. 모양은
 * `src/app/actions/part-items.ts` 와 같다(`requireRole` 은 자격이 모자라면 `/forbidden` 으로 돌린다).
 *
 * 🔴 **화면이 보낸 값을 그대로 믿지 않는다.** 검증을 여기서 한 번 더 태운다 — 화면과 **같은 순수
 * 함수**를 부르므로 규칙이 두 벌이 되지 않는다.
 *
 * 🔴 **예상 못한 오류는 삼키고 뜻 있는 한국어로 바꾼다.** 영어 예외·표 이름을 화면에 내보내지
 * 않는다(CLAUDE.md 10절).
 *
 * 🔴 **`revalidatePath` 를 부르지 않는다.** 이 값을 읽는 것은 설정 화면 하나이고, 그 화면이 저장
 * 뒤 `router.refresh()` 로 자기 화면만 다시 그린다(바로 앞 조각 `approval-routes.ts` 와 같다).
 * ============================================================================
 */

const UNEXPECTED = "처리하지 못했습니다. 잠시 뒤 다시 시도하십시오.";

export type OhActionResult =
  | { ok: true; id?: string; version?: number; message: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export type SaveOhTemplateActionInput = {
  /** `null` 이면 새로 만든다. */
  id: string | null;
  /** 🔴 고칠 때 화면이 들고 있던 판 번호. 지금 값과 다르면 저장을 거절한다. */
  expectedVersion: number | null;
  fields: Record<string, unknown>;
  /**
   * 부품별 O/H 단가. 같은 저장 단추에서 함께 온다.
   * **보내지 않으면 단가를 아예 건드리지 않는다** — 빈 배열(「고칠 칸이 없다」)과 뜻이 다르다.
   */
  prices?: unknown;
};

export async function saveOhTemplateAction(input: SaveOhTemplateActionInput): Promise<OhActionResult> {
  const session = await requireRole("ADMIN");

  const validation = validateOhTemplateFields(input.fields ?? {});
  if (!validation.ok) {
    return { ok: false, message: "입력값을 확인하십시오.", fieldErrors: validation.fieldErrors };
  }

  // 🔴 단가 검증도 **쓰기 전에** 끝낸다. 저장하다가 형식 오류를 만나면 트랜잭션이 되돌려지긴
  //    하지만, 감사 로그까지 썼다가 되돌리는 것보다 아예 시작하지 않는 편이 낫다.
  let prices: OhPriceEntry[] | undefined;
  if (input.prices !== undefined) {
    const checked = validateOhPriceEntries(input.prices);
    if (!checked.ok) {
      return {
        ok: false,
        message: "O/H 단가 입력을 확인하십시오.",
        // 🔴 키에 접두사를 붙인다. 단가 오류는 **부품 id** 를 키로 쓰는데, 템플릿 오류(칸 이름)와
        //    한 자루에 담기면 화면이 어느 칸에 붙일지 가릴 수 없다.
        fieldErrors: Object.fromEntries(
          Object.entries(checked.fieldErrors).map(([key, message]) => [`${OH_PRICE_FIELD_ERROR_PREFIX}${key}`, message]),
        ),
      };
    }
    prices = checked.data;
  }

  if (input.id !== null && !isValidOhTemplateId(input.id)) {
    return { ok: false, message: "해당 템플릿을 찾을 수 없습니다." };
  }
  if (input.id !== null && !isValidExpectedVersion(input.expectedVersion)) {
    // 판 번호가 없거나 모양이 아니면 **고치지 않는다.** 여기서 「없으면 1」로 채우면 낙관적
    // 잠금이 통째로 무력해진다.
    return { ok: false, message: "최신 정보를 다시 불러온 뒤 시도하십시오." };
  }

  try {
    const result = await saveOhTemplate({
      id: input.id,
      expectedVersion: input.id === null ? null : (input.expectedVersion as number),
      fields: validation.data,
      prices,
      actor: { id: session.user.id, name: session.user.name },
    });
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
    return {
      ok: true,
      id: result.id,
      version: result.version,
      message: result.created ? "템플릿을 등록했습니다." : "저장했습니다.",
    };
  } catch (e) {
    console.error("[oh-templates] 저장 실패:", e instanceof Error ? e.message : e);
    return { ok: false, message: UNEXPECTED };
  }
}

export async function deleteOhTemplateAction(input: { id: string; reason: string }): Promise<OhActionResult> {
  const session = await requireRole("ADMIN");

  if (!isValidOhTemplateId(input.id)) return { ok: false, message: "해당 템플릿을 찾을 수 없습니다." };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  // 사유를 받는 까닭은 `deletePart` 와 같다 — 지운 뒤에 「왜 없어졌나」를 답할 수 있어야 한다.
  if (reason === "") return { ok: false, message: "삭제 사유를 입력하십시오.", fieldErrors: { reason: "삭제 사유를 입력하십시오." } };
  if (reason.length > 1000) return { ok: false, message: "삭제 사유는 1000자를 넘을 수 없습니다." };

  try {
    const result = await deleteOhTemplate(input.id, reason, { id: session.user.id, name: session.user.name });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: `「${result.name}」 템플릿을 삭제했습니다.` };
  } catch (e) {
    console.error("[oh-templates] 삭제 실패:", e instanceof Error ? e.message : e);
    return { ok: false, message: UNEXPECTED };
  }
}

/**
 * 제품 모델을 템플릿에 잇는다.
 *
 * 🔴 **모델 이름을 화면에서 받지 않는다.** A/S 명부를 **여기서 다시 받아 와** 그 이름을 쓴다 —
 * 우리 표에 적히는 `product_model_name` 은 「그때 이렇게 이었다」는 기록이라, 화면이 보낸 글자를
 * 그대로 적으면 거짓이 남을 수 있다(바로 앞 조각 `approval/mutations.ts` 의 같은 판단).
 *
 * 🔴 **못 받아 왔으면 잇지 않는다.** 확인할 수 없는 채로 이으면 없는 모델이 템플릿에 붙는다 —
 * 화면에서 「모른다」로 적는 것과 정반대의 판단인데, 보는 것은 이미 저장된 사실이고 여기서 하는
 * 것은 **새 사실을 만드는 일**이기 때문이다.
 */
export async function linkProductModelAction(input: { templateId: string; productModelId: string }): Promise<OhActionResult> {
  const session = await requireRole("ADMIN");

  if (!isValidOhTemplateId(input.templateId) || !isValidOhTemplateId(input.productModelId)) {
    return { ok: false, message: "요청 정보를 확인할 수 없습니다." };
  }

  try {
    const directory = await fetchAsProductModels();
    if (directory.status !== "ok") {
      return { ok: false, message: `${AS_PRODUCT_MODEL_MESSAGES[directory.reason]} 연결하지 못했습니다.` };
    }
    const model = directory.models.find((m) => m.id === input.productModelId);
    if (!model) {
      return { ok: false, message: "그 제품 모델을 A/S 명부에서 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 고르십시오." };
    }

    const result = await linkProductModel(input.templateId, model.id, model.modelName, {
      id: session.user.id,
      name: session.user.name,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: `${model.modelName} 을(를) 연결했습니다.` };
  } catch (e) {
    console.error("[oh-templates] 모델 연결 실패:", e instanceof Error ? e.message : e);
    return { ok: false, message: UNEXPECTED };
  }
}

export async function unlinkProductModelAction(input: { linkId: string }): Promise<OhActionResult> {
  const session = await requireRole("ADMIN");

  if (!isValidOhTemplateId(input.linkId)) return { ok: false, message: "요청 정보를 확인할 수 없습니다." };

  try {
    const result = await unlinkProductModel(input.linkId, { id: session.user.id, name: session.user.name });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: "연결을 풀었습니다." };
  } catch (e) {
    console.error("[oh-templates] 모델 연결 해제 실패:", e instanceof Error ? e.message : e);
    return { ok: false, message: UNEXPECTED };
  }
}

/**
 * 부품 하나의 O/H 단가만 고친다(템플릿 저장과 따로 쓰는 길).
 * 🔴 빈 값은 0 이 아니라 **지우기**다 — `parseOhPriceValue` 가 둘을 가른다.
 */
export async function setOhPriceAction(input: { partId: string; unitPrice: unknown }): Promise<OhActionResult> {
  const session = await requireRole("ADMIN");

  if (!isValidOhTemplateId(input.partId)) return { ok: false, message: "부품을 확인할 수 없습니다." };
  const parsed = parseOhPriceValue(input.unitPrice);
  if (!parsed.ok) return { ok: false, message: parsed.message, fieldErrors: { unitPrice: parsed.message } };

  try {
    const result = await setPartOverhaulPrice(input.partId, parsed.value, {
      id: session.user.id,
      name: session.user.name,
    });
    if (!result.ok) return { ok: false, message: result.message };
    // 🔴 「바뀐 게 없다」를 「저장했다」와 구별해 말해 준다 — 같은 값을 다시 저장하면 쓰지 않으므로
    //    (updated_by 를 지키려고), 성공 문구만 보이면 관리자는 이력이 쌓였다고 오해한다.
    if (!result.changed) return { ok: true, message: "변경된 내용이 없습니다." };
    return { ok: true, message: parsed.value === null ? "O/H 단가를 지웠습니다." : "O/H 단가를 저장했습니다." };
  } catch (e) {
    console.error("[oh-templates] O/H 단가 저장 실패:", e instanceof Error ? e.message : e);
    return { ok: false, message: UNEXPECTED };
  }
}
