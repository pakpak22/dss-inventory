import { DrawingNoStyleForm } from "@/components/settings/DrawingNoStyleForm";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { requireRole } from "@/lib/auth/session";
import { readDrawingNoStyleSetting } from "@/lib/stock/drawing-no-style-queries";

/**
 * 설정 — **도번 표시** `/settings/drawing-no` (관리자, 2026-11-20 쓰는 분 요청).
 *
 * 「재고 담당자가 **도번을 보면서 불출을 실행**한다 — 지금은 너무 작고 눈에 안 띈다.」 그래서 도번을
 * 제 줄로 빼내 크게 세우고(`RequestItemDetails`), 그 모양을 여기서 고른다.
 *
 * 🔴 **화면이 숨기는 것은 편의일 뿐 차단이 아니다.** 여기서 역할을 보고, 저장하는 서버 액션이
 *    자기 자리에서 **다시** 본다(`src/app/actions/drawing-no-style.ts`).
 * 🔵 **관리자 전용인 까닭**: 한 사람이 고른 모양이 **쓰는 사람 모두의 화면**에 선다. 사람마다 다르게
 *    보이는 값이면 각자 고르게 두었겠지만, 이것은 한 벌뿐인 설정이다.
 * 🔵 읽는 것은 「값」만이 아니라 「누가 언제 바꿨나」까지다 — 모두의 화면이 바뀌는 값이라, 달라져 있을
 *    때 **누구에게 물어야 하는지**가 화면에 있어야 한다.
 */
export const metadata = { title: "도번 표시" };

export default async function DrawingNoSettingsPage() {
  await requireRole("ADMIN", "/settings/drawing-no");
  const setting = await readDrawingNoStyleSetting();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        설정 <span className="font-normal text-zinc-500">· 도번 표시</span>
      </h1>
      {/* 🔵 `isAdmin` 은 탭 줄을 가르는 값일 뿐 울타리가 아니다. 이 화면은 바로 위 `requireRole("ADMIN")` 을
          지나왔으므로 여기 선 사람은 관리자다 — 모두가 쓰는 탭 둘(결재권 위임 · O/H 템플릿)만 보일 까닭이 없다. */}
      <SettingsNav current="drawingNo" isAdmin />

      <DrawingNoStyleForm saved={setting.style} savedAt={setting.savedAt} savedByName={setting.savedByName} />
    </div>
  );
}
