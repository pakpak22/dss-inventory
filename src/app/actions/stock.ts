"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { roleAtLeast } from "@/lib/auth/role";
import { requireRole } from "@/lib/auth/session";
import { ADMIN_ONLY_TYPES, needsConfirmation, sheetNoText, todaySeoul } from "@/lib/stock/codes";
import { cancelRequest, closeRequest, confirmRequest, createRequest, holdRequest, rejectRequest, releaseRequestHold } from "@/lib/stock/requests";
import { parseEntryForm, type EntryFieldErrors } from "@/lib/stock/form";
import { parseIssueQuantities } from "@/lib/stock/issue";
import { LOOKUP_MESSAGES, lookupIntake, type IntakeInfo } from "@/lib/stock/intake-lookup";
import { correctTransaction, ledgerErrorMessage, recordEntry, reverifyIntake } from "@/lib/stock/ledger";
import { RETURN_TO_FIELD, safeReturnTo } from "@/lib/stock/return-to";

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

  // 반출 계열은 **누가 적든** 확인 대기로 (2026-10-15 사용자 결정. 10-06 의 「관리자는 바로 원장에」를 뒤집은 것 —
  // 그 까닭은 codes.ts 의 needsConfirmation 주석에). 관리자가 낸 요청은 본인이 확인하게 되고, 그래도 괜찮다.
  if (needsConfirmation(parsed.value.type)) {
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

/**
 * 🔴 **아래 여섯은 끝나고 「누른 자리」로 돌아간다** (2026-10-15, 조각 10c). 같은 단추 묶음을 기록 내역(`/entries`)과
 *    부품 요청 관리(`/requests`)가 같이 쓰므로, 늘 기록 내역으로 보내면 `/requests` 에서 누른 사람은 보던 목록을 잃는다.
 *    화면이 숨은 칸으로 실어 보낸 자리를 **그대로 믿지 않고** `safeReturnTo` 로 거른다 — 그 울타리와 까닭은
 *    `src/lib/stock/return-to.ts` 한 곳에 있다. 붙이는 꼬리표는 돌아간 화면이 읽어 한 줄로 말해 준다
 *    (`src/lib/stock/request-notice.ts`).
 */

export interface RequestActionState {
  error: string | null;
}

/**
 * 신청 확인 = 불출. 🔵 줄별 「이번에 줄 수량」을 **받을 자리**가 있다 (2026-10-14, 조각 4b).
 * 🔵 조각 4d 에서 화면이 그 자리를 쓴다 — 다만 **칸을 다 비우면 아무것도 안 보낸다.**
 *    안 보내면 `quantities` 가 `null` 이라 **남은 수량 전부**이고, 그것이 조각 4b 까지의 동작 그대로다.
 */
export async function confirmRequestAction(_prev: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const session = await requireRole("ADMIN", "/entries");
  const id = String(formData.get("requestId") ?? "");
  if (!id) return { error: "신청이 정해지지 않았습니다." };
  const parsed = parseIssueQuantities(formData.get("quantities"));
  if (!parsed.ok) return { error: parsed.message };
  const note = String(formData.get("issueNote") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  let r;
  try {
    r = await confirmRequest(id, { id: session.user.id, name: session.user.name }, { quantities: parsed.quantities ?? undefined, note });
  } catch (e) {
    console.error("[stock] 확인 실패:", e instanceof Error ? e.message : e);
    return { error: "확인하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message };
  revalidatePath("/");
  revalidatePath("/entries");
  revalidatePath("/", "layout");
  const flag = r.result.intakeUnverified ? "&unverified=1" : "";
  // 🔵 아직 남은 수량이 있으면 화면이 「신청은 확인 대기에 그대로 남아 있다」를 말해 준다 (조각 4d).
  const left = r.done ? "" : `&remaining=${r.remaining}`;
  redirect(`${safeReturnTo(formData.get(RETURN_TO_FIELD))}?saved=${sheetNoText(r.result.type, r.result.sheetYear, r.result.sheetNo)}&type=${r.result.type}${flag}${left}`);
}

/**
 * 마감 = 「남은 것 그만 주기」 (2026-10-14 사용자 결정, 조각 4d). 🔴 **반려가 아니다** — 이미 나간 수량은 그대로 두고
 * 남은 수량만 접는다. 그래서 사유를 꼭 받는다(반려와 같은 관례).
 */
export async function closeRequestAction(_prev: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const session = await requireRole("ADMIN", "/entries");
  const id = String(formData.get("requestId") ?? "");
  const note = String(formData.get("note") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!id) return { error: "신청이 정해지지 않았습니다." };
  if (note.length < 2) return { error: "마감 사유를 적으십시오." };
  let r;
  try {
    r = await closeRequest(id, note, { id: session.user.id, name: session.user.name });
  } catch (e) {
    console.error("[stock] 마감 실패:", e instanceof Error ? e.message : e);
    return { error: "마감하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message ?? "마감하지 못했습니다." };
  revalidatePath("/entries");
  revalidatePath("/", "layout");
  redirect(`${safeReturnTo(formData.get(RETURN_TO_FIELD))}?closed=1`);
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
  redirect(`${safeReturnTo(formData.get(RETURN_TO_FIELD))}?rejected=1`);
}

/**
 * 보류 = 「멈춰 두기」 (2026-10-15, 조각 10a). 🔴 **반려도 마감도 아니다** — 나중에 풀면 멈추기 전 자리로 돌아간다.
 * 사유를 꼭 받는다(반려·마감과 같은 관례): 왜 멈췄는지가 안 남으면 나중에 아무도 못 푼다.
 */
export async function holdRequestAction(_prev: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const session = await requireRole("ADMIN", "/entries");
  const id = String(formData.get("requestId") ?? "");
  const reason = String(formData.get("reason") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!id) return { error: "신청이 정해지지 않았습니다." };
  if (reason.length < 2) return { error: "보류 사유를 적으십시오." };
  let r;
  try {
    r = await holdRequest(id, reason, { id: session.user.id, name: session.user.name });
  } catch (e) {
    console.error("[stock] 보류 실패:", e instanceof Error ? e.message : e);
    return { error: "보류하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message ?? "보류하지 못했습니다." };
  revalidatePath("/entries");
  // 🔵 머리말 「대기 N」 배지와 알림 종이 줄어든다 — 보류는 재촉하는 숫자에서 빠진다(stock/codes.ts 의 ACTIONABLE_REQUEST_STATUSES).
  revalidatePath("/", "layout");
  redirect(`${safeReturnTo(formData.get(RETURN_TO_FIELD))}?held=1`);
}

/** 보류 풀기. 🔵 **사유를 받지 않는다** — 「다시 진행한다」는 뜻뿐이라 적을 것이 없다(`releaseRequestHold` 주석). */
export async function releaseHoldAction(_prev: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const session = await requireRole("ADMIN", "/entries");
  const id = String(formData.get("requestId") ?? "");
  if (!id) return { error: "신청이 정해지지 않았습니다." };
  let r;
  try {
    r = await releaseRequestHold(id, { id: session.user.id, name: session.user.name });
  } catch (e) {
    console.error("[stock] 보류 해제 실패:", e instanceof Error ? e.message : e);
    return { error: "보류를 풀지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message ?? "보류를 풀지 못했습니다." };
  revalidatePath("/entries");
  revalidatePath("/", "layout");
  redirect(`${safeReturnTo(formData.get(RETURN_TO_FIELD))}?holdReleased=1`);
}

export async function cancelRequestAction(_prev: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const session = await requireRole("STAFF", "/entries");
  const id = String(formData.get("requestId") ?? "");
  if (!id) return { error: "신청이 정해지지 않았습니다." };
  const r = await cancelRequest(id, { id: session.user.id, name: session.user.name });
  if (!r.ok) return { error: r.message ?? "취소하지 못했습니다." };
  revalidatePath("/entries");
  revalidatePath("/", "layout");
  redirect(`${safeReturnTo(formData.get(RETURN_TO_FIELD))}?cancelled=1`);
}
