"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { parsePartForm, readPartFormValues, type PartFieldErrors, type PartFormValues } from "@/lib/parts/form";
import { createPart, deletePart, findDuplicateParts, updatePart, type DuplicatePart } from "@/lib/parts/mutations";
import { listPartItems } from "@/lib/parts/queries";

/**
 * 부품 등록·수정·삭제 서버 액션 (관리자). 🔴 레이아웃의 세션 검사와 **따로** 역할을 다시 검사한다 (CLAUDE.md 8-4절).
 * 폼이 보낸 값은 전부 다시 검사하고(form.ts), 영어 오류는 화면에 내지 않는다 (10절).
 *
 * useActionState 모양: (이전 상태, FormData) → 다음 상태. 성공하면 redirect 로 끝난다(상태를 돌려주지 않는다).
 */
export interface PartFormState {
  errors: PartFieldErrors;
  /** 같은 이름의 부품. 비어 있지 않으면 폼이 「그래도 저장」 확인을 받는다. */
  duplicates: DuplicatePart[];
  /** 되돌아올 때 입력값을 유지하려고 */
  values: PartFormValues | null;
}

// 🔴 "use server" 파일은 async 함수만 내보낼 수 있다. 처음 상태 상수는 폼 조각(PartForm.tsx)이 갖는다.

export async function savePartAction(_prev: PartFormState, formData: FormData): Promise<PartFormState> {
  const session = await requireRole("ADMIN");
  const actor = { id: session.user.id, name: session.user.name };
  const id = String(formData.get("id") ?? "").trim();
  const values = readPartFormValues(formData);

  const items = await listPartItems();
  const parsed = parsePartForm(formData, new Set(items.map((i) => i.id)));
  if (!parsed.ok) return { errors: parsed.errors, duplicates: [], values };

  if (formData.get("confirmDuplicate") !== "1") {
    const duplicates = await findDuplicateParts(parsed.value, id || undefined);
    if (duplicates.length > 0) return { errors: {}, duplicates, values };
  }

  let no: number;
  try {
    if (id) {
      const r = await updatePart(id, parsed.value, actor);
      if (!r.ok) return { errors: { form: "수정할 부품이 없습니다. 이미 지워졌을 수 있습니다." }, duplicates: [], values };
      no = r.no;
    } else {
      no = (await createPart(parsed.value, actor)).no;
    }
  } catch (e) {
    console.error("[parts] 저장 실패:", e instanceof Error ? e.message : e);
    return { errors: { form: "저장하지 못했습니다. 잠시 뒤 다시 시도하십시오." }, duplicates: [], values };
  }

  revalidatePath("/");
  redirect(`/?part=${no}`);
}

export interface DeletePartState {
  error: string | null;
}

const DELETE_MESSAGES = {
  not_found: "지울 부품이 없습니다. 이미 지워졌을 수 있습니다.",
  has_quantity: "수량이 남아 있는 부품은 지울 수 없습니다. 조정 기록으로 0 으로 맞춘 뒤 지우십시오.",
  has_records: "입고·사용 기록이 있는 부품은 지울 수 없습니다.",
} as const;

export async function deletePartAction(_prev: DeletePartState, formData: FormData): Promise<DeletePartState> {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!id) return { error: "지울 부품이 정해지지 않았습니다." };
  if (reason.length < 2) return { error: "삭제 사유를 적으십시오." };
  if (reason.length > 500) return { error: "삭제 사유는 500자 이하여야 합니다." };

  let result;
  try {
    result = await deletePart(id, reason, { id: session.user.id, name: session.user.name });
  } catch (e) {
    console.error("[parts] 삭제 실패:", e instanceof Error ? e.message : e);
    return { error: "지우지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!result.ok) return { error: DELETE_MESSAGES[result.code] };

  revalidatePath("/");
  redirect("/");
}
