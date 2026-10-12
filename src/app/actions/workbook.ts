"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { applyExcel } from "@/lib/excel/workbook-apply-run";
import { resumeWorkbook, writeWorkbookNow } from "@/lib/excel/workbook-sync";

/**
 * 엑셀 상태 화면의 단추 둘 (관리자, DESIGN 2-7절). 평범한 <form action> 으로 쓴다 — 스크립트가 늦게 붙어도 눌린다.
 * 서버 액션은 Next 가 Origin 을 Host 와 대조해 CSRF 를 막는다.
 */
export async function resumeWorkbookAction(): Promise<void> {
  const session = await requireRole("ADMIN", "/settings/workbook");
  await resumeWorkbook({ id: session.user.id, name: session.user.name });
  revalidatePath("/settings/workbook");
  revalidatePath("/", "layout");
}

export async function writeWorkbookNowAction(): Promise<void> {
  await requireRole("ADMIN", "/settings/workbook");
  try {
    await writeWorkbookNow();
  } catch (e) {
    // 결과는 상태 표에 남는다(ERROR). 화면은 상태를 다시 읽어 보여 준다.
    console.error("[workbook] 지금 쓰기 실패:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/settings/workbook");
  revalidatePath("/", "layout");
}

/**
 * [엑셀 기준 적용] → [원장에 적기] (관리자, 조각 8-B, DESIGN 6-6절). 확인 화면의 폼에서 온다.
 * 성공·실패 모두 주소로 돌아간다(평범한 <form action>, 되돌아올 상태 없음). 🔴 redirect 는 try 밖에서 — 던지는 방식이라 catch 에 잡히면 안 된다.
 */
export async function applyExcelAction(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN", "/settings/workbook/apply");
  const fingerprint = String(formData.get("fingerprint") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const confirmed = formData.get("confirm") === "on";
  if (!fingerprint || !reason || !confirmed) {
    redirect(`/settings/workbook/apply?error=${encodeURIComponent("사유를 적고 확인 칸에 표시한 뒤 누르십시오.")}`);
  }
  const r = await applyExcel(fingerprint, reason, { id: session.user.id, name: session.user.name });
  revalidatePath("/settings/workbook");
  revalidatePath("/settings/workbook/apply");
  revalidatePath("/", "layout");
  revalidatePath("/entries");
  if (!r.ok) redirect(`/settings/workbook/apply?error=${encodeURIComponent(r.message)}`);
  redirect(`/settings/workbook?applied=${r.count}&summary=${encodeURIComponent(r.summary)}`);
}
