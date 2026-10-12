"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { parsePartItemForm, type PartItemFieldErrors } from "@/lib/parts/form";
import { createPartItem, movePartItem } from "@/lib/parts/mutations";

/**
 * 항목 관리 서버 액션 (관리자, DESIGN 2-7절). 추가와 차례만 — 이름 바꾸기·지우기는 없다.
 * 항목 이름은 엑셀 가져오기와 엑셀 쓰기가 대조하는 글자라, 바꾸는 일은 담당자와 정한 뒤에 넣는다.
 */
export interface PartItemFormState {
  errors: PartItemFieldErrors;
  values: { code: string; name: string };
  /** 방금 추가된 항목 이름. 폼을 비우고 「추가되었습니다」를 보여 준다. */
  added: string | null;
}

// 🔴 "use server" 파일은 async 함수만 내보낼 수 있다. 처음 상태 상수는 폼 조각(PartItemAddForm.tsx)이 갖는다.

export async function createPartItemAction(_prev: PartItemFormState, formData: FormData): Promise<PartItemFormState> {
  const session = await requireRole("ADMIN");
  const values = { code: String(formData.get("code") ?? "").trim(), name: String(formData.get("name") ?? "").trim() };
  const parsed = parsePartItemForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, values, added: null };

  try {
    const r = await createPartItem(parsed.value, { id: session.user.id, name: session.user.name });
    if (!r.ok) return { errors: r.errors, values, added: null };
  } catch (e) {
    console.error("[part-items] 추가 실패:", e instanceof Error ? e.message : e);
    return { errors: { form: "추가하지 못했습니다. 잠시 뒤 다시 시도하십시오." }, values, added: null };
  }

  revalidatePath("/settings/items");
  revalidatePath("/");
  return { errors: {}, values: { code: "", name: "" }, added: parsed.value.name };
}

/** 평범한 <form action> 으로 쓴다 — 스크립트가 없어도 눌린다. */
export async function movePartItemAction(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const dir = formData.get("dir") === "up" ? "up" : "down";
  if (!id) return;
  await movePartItem(id, dir, { id: session.user.id, name: session.user.name });
  revalidatePath("/settings/items");
  revalidatePath("/");
}
