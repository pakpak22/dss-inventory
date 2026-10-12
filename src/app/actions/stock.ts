"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { roleAtLeast } from "@/lib/auth/role";
import { requireRole } from "@/lib/auth/session";
import { ADMIN_ONLY_TYPES, needsConfirmation, sheetNoText, todaySeoul } from "@/lib/stock/codes";
import { cancelRequest, confirmRequest, createRequest, rejectRequest } from "@/lib/stock/requests";
import { parseEntryForm, type EntryFieldErrors } from "@/lib/stock/form";
import { LOOKUP_MESSAGES, lookupIntake, type IntakeInfo } from "@/lib/stock/intake-lookup";
import { correctTransaction, ledgerErrorMessage, recordEntry, reverifyIntake } from "@/lib/stock/ledger";

/**
 * 수량 변경 기록 서버 액션 (기록·관리자). 🔴 역할은 액션에서 다시 검사한다 (CLAUDE.md 8-4절).
 * 조정·소유 옮김·기록 취소는 관리자만 (DESIGN 3절).
 */
export interface EntryFormState {
  errors: EntryFieldErrors;
  /** 저장이 아니라 [확인] 만 눌렀을 때의 인수번호 조회 결과 */
  lookup: { kind: "found"; info: IntakeInfo } | { kind: "message"; text: string; soft: boolean } | null;
  /**
   * 저장(또는 신청)이 끝났음. 화면은 넘어가지 않고 **그 자리에 남아** 팝업을 띄우고 자료를 다시 읽는다
   * (담당자 답변3 5번, A/S 2026-09-17 결정: 수량을 반복해 적는 화면이라). `key` 는 매번 달라야 폼이 새 저장을 알아챈다.
   */
  saved: { key: number; kind: "entry" | "request"; type: string; sheetYear: number | null; sheetNo: number | null; intakeUnverified: boolean } | null;
}

export async function saveEntryAction(_prev: EntryFormState, formData: FormData): Promise<EntryFormState> {
  const session = await requireRole("STAFF", "/entries/new");
  const actor = { id: session.user.id, name: session.user.name };
  const parsed = parseEntryForm(formData, todaySeoul());
  if (!parsed.ok) return { errors: parsed.errors, lookup: null, saved: null };
  if (ADMIN_ONLY_TYPES.has(parsed.value.type) && !roleAtLeast(session.user.role, "ADMIN")) {
    return { errors: { form: "이 종류의 기록은 관리자만 할 수 있습니다." }, lookup: null, saved: null };
  }

  // 반출 계열을 기록 권한자가 적으면 확인 대기로 (2026-10-06 확인 단계). 관리자는 바로 원장에.
  if (needsConfirmation(parsed.value.type, roleAtLeast(session.user.role, "ADMIN"))) {
    try {
      await createRequest(parsed.value, actor);
    } catch (e) {
      console.error("[stock] 신청 실패:", e instanceof Error ? e.message : e);
      return { errors: { form: "신청하지 못했습니다. 잠시 뒤 다시 시도하십시오." }, lookup: null, saved: null };
    }
    revalidatePath("/entries");
    revalidatePath("/", "layout");
    return { errors: {}, lookup: null, saved: { key: Date.now(), kind: "request", type: parsed.value.type, sheetYear: null, sheetNo: null, intakeUnverified: false } };
  }

  let result;
  try {
    result = await recordEntry(parsed.value, actor);
  } catch (e) {
    console.error("[stock] 기록 실패:", e instanceof Error ? e.message : e);
    return { errors: { form: "저장하지 못했습니다. 잠시 뒤 다시 시도하십시오." }, lookup: null, saved: null };
  }
  if (!result.ok) return { errors: { form: ledgerErrorMessage(result.error) }, lookup: null, saved: null };

  revalidatePath("/");
  revalidatePath("/entries");
  return { errors: {}, lookup: null, saved: { key: Date.now(), kind: "entry", type: result.type, sheetYear: result.sheetYear, sheetNo: result.sheetNo, intakeUnverified: result.intakeUnverified } };
}

/** 사용 화면의 [확인]: 인수번호로 A/S 에 물어 보여 준다. 저장할 때 서버가 다시 묻는다 (DESIGN 7절). */
export async function lookupIntakeAction(_prev: EntryFormState, formData: FormData): Promise<EntryFormState> {
  await requireRole("STAFF", "/entries/new");
  const n = String(formData.get("intakeNumber") ?? "").trim().toUpperCase();
  const r = await lookupIntake(n);
  if (r.status === "found") return { errors: {}, lookup: { kind: "found", info: r.info }, saved: null };
  if (r.status === "unreachable") return { errors: {}, lookup: { kind: "message", text: LOOKUP_MESSAGES[r.reason], soft: true }, saved: null };
  return { errors: {}, lookup: { kind: "message", text: LOOKUP_MESSAGES[r.status], soft: false }, saved: null };
}

export interface CorrectState {
  error: string | null;
}

export async function correctTransactionAction(_prev: CorrectState, formData: FormData): Promise<CorrectState> {
  const session = await requireRole("ADMIN", "/entries");
  const id = String(formData.get("transactionId") ?? "");
  const reason = String(formData.get("reason") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!id) return { error: "취소할 줄이 정해지지 않았습니다." };
  if (reason.length < 2) return { error: "취소 사유를 적으십시오." };
  let r;
  try {
    r = await correctTransaction(id, reason, { id: session.user.id, name: session.user.name }, todaySeoul());
  } catch (e) {
    console.error("[stock] 기록 취소 실패:", e instanceof Error ? e.message : e);
    return { error: "취소하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: ledgerErrorMessage(r.error) };
  revalidatePath("/");
  revalidatePath("/entries");
  redirect(`/entries?saved=${sheetNoText("CORRECTION", r.sheetYear, r.sheetNo)}&type=CORRECTION`);
}

export interface ReverifyState {
  message: string | null;
  ok: boolean;
}

export async function reverifyIntakeAction(_prev: ReverifyState, formData: FormData): Promise<ReverifyState> {
  const session = await requireRole("STAFF", "/entries");
  const id = String(formData.get("entryId") ?? "");
  const r = await reverifyIntake(id, { id: session.user.id, name: session.user.name });
  if (r.ok) {
    revalidatePath("/entries");
    return { ok: true, message: "인수번호가 확인되었습니다." };
  }
  if (r.code === "not_found") return { ok: false, message: "그런 인수번호가 A/S 에 없습니다. 기록을 취소하고 다시 적으십시오." };
  if (r.code === "unreachable") return { ok: false, message: "A/S 가 아직 응답하지 않습니다. 나중에 다시 누르십시오." };
  return { ok: false, message: "확인할 기록이 없습니다." };
}

/* ───────────── 확인 대기 신청 (2026-10-06 확인 단계) ───────────── */

export interface RequestActionState {
  error: string | null;
}

export async function confirmRequestAction(_prev: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const session = await requireRole("ADMIN", "/entries");
  const id = String(formData.get("requestId") ?? "");
  if (!id) return { error: "신청이 정해지지 않았습니다." };
  let r;
  try {
    r = await confirmRequest(id, { id: session.user.id, name: session.user.name });
  } catch (e) {
    console.error("[stock] 확인 실패:", e instanceof Error ? e.message : e);
    return { error: "확인하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message };
  revalidatePath("/");
  revalidatePath("/entries");
  revalidatePath("/", "layout");
  const flag = r.result.intakeUnverified ? "&unverified=1" : "";
  redirect(`/entries?saved=${sheetNoText(r.result.type, r.result.sheetYear, r.result.sheetNo)}&type=${r.result.type}${flag}`);
}

export async function rejectRequestAction(_prev: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const session = await requireRole("ADMIN", "/entries");
  const id = String(formData.get("requestId") ?? "");
  const note = String(formData.get("note") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!id) return { error: "신청이 정해지지 않았습니다." };
  if (note.length < 2) return { error: "반려 사유를 적으십시오." };
  const r = await rejectRequest(id, note, { id: session.user.id, name: session.user.name });
  if (!r.ok) return { error: r.message ?? "반려하지 못했습니다." };
  revalidatePath("/entries");
  revalidatePath("/", "layout");
  redirect("/entries?rejected=1");
}

export async function cancelRequestAction(_prev: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const session = await requireRole("STAFF", "/entries");
  const id = String(formData.get("requestId") ?? "");
  if (!id) return { error: "신청이 정해지지 않았습니다." };
  const r = await cancelRequest(id, { id: session.user.id, name: session.user.name });
  if (!r.ok) return { error: r.message ?? "취소하지 못했습니다." };
  revalidatePath("/entries");
  revalidatePath("/", "layout");
  redirect("/entries?cancelled=1");
}
