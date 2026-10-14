"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { parseCustomerName, parsePartForm, readPartFormValues, type PartFieldErrors, type PartFormValues } from "@/lib/parts/form";
import { createPart, deletePart, findDuplicateParts, updateCustomerName, updatePart, type DuplicatePart } from "@/lib/parts/mutations";
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

/* ───────────── 고객사 품명만 고치는 전용 길 (STAFF 이상) ───────────── */

export interface CustomerNameState {
  error: string | null;
  /**
   * 저장이 끝난 **횟수**. 0 이면 아직 저장 전. 화면은 이 값이 바뀌는 것으로 새 저장을 알아챈다.
   *
   * 왜 boolean 이 아닌가: 같은 칸을 잇달아 두 번 저장하면 값이 안 바뀌어 **둘째 저장을 못 알아챈다**
   * (칸이 안 닫히고 서버 자료도 다시 안 읽는다).
   * 왜 시각(`Date.now()`)이 아닌가: 여기는 **서버 시계**라 브라우저 시계와 어긋날 수 있고,
   * 같은 밀리초에 두 번이면 또 겹친다. 앞 상태에서 1 을 더하면 반드시 달라진다.
   * 🔴 오류로 돌아갈 때는 이 값을 **그대로** 넘긴다 — 올리면 화면이 「저장됐다」로 보고 칸을 닫는다.
   */
  saveCount: number;
}

/**
 * 고객사 품명 하나만 저장한다 (2026-10-14 사용자 결정 (다)).
 *
 * 🔴 여기만 `requireRole("STAFF")` 다. 부품의 다른 칸은 위 `savePartAction` 의 `requireRole("ADMIN")` 이
 *    그대로 막는다 — 기존 가드는 **내리지 않았다.**
 * 🔵 `requireRole` 은 「그 역할 **이상**」이다(`roleAtLeast`, RANK VIEWER 0 < STAFF 1 < ADMIN 2).
 *    그래서 STAFF 도 ADMIN 도 통과하고 VIEWER 만 막힌다 — 「정확히 STAFF」가 아니다.
 *
 * 성공해도 redirect 하지 않는다: 상세 창이 열린 채로 그 자리에서 고치는 길이라, 돌아가면 창이 닫힌다.
 */
export async function saveCustomerNameAction(prev: CustomerNameState, formData: FormData): Promise<CustomerNameState> {
  const session = await requireRole("STAFF");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "고칠 부품이 정해지지 않았습니다.", saveCount: prev.saveCount };

  const parsed = parseCustomerName(formData);
  if (!parsed.ok) return { error: parsed.errors, saveCount: prev.saveCount };

  let result;
  try {
    result = await updateCustomerName(id, parsed.value, { id: session.user.id, name: session.user.name });
  } catch (e) {
    console.error("[parts] 고객사 품명 저장 실패:", e instanceof Error ? e.message : e);
    return { error: "저장하지 못했습니다. 잠시 뒤 다시 시도하십시오.", saveCount: prev.saveCount };
  }
  if (!result.ok) return { error: "고칠 부품이 없습니다. 이미 지워졌을 수 있습니다.", saveCount: prev.saveCount };

  revalidatePath("/");
  return { error: null, saveCount: prev.saveCount + 1 };
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
