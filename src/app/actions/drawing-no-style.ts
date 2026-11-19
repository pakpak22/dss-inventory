"use server";

import { requireRole } from "@/lib/auth/session";
import { validateDrawingNoStyleInput } from "@/lib/stock/drawing-no-style";
import { saveDrawingNoStyle } from "@/lib/stock/drawing-no-style-queries";

/**
 * ============================================================================
 * 서버 액션: **도번 표시 모양** 저장 (2026-11-20)
 * ============================================================================
 * 다른 서버 액션과 같은 층위의 일만 한다 — 인가, 입력 검증, 예상 못한 오류 은닉. 값을 푸는 규칙은
 * 순수 함수(`validateDrawingNoStyleInput`), 적는 일은 `saveDrawingNoStyle` 이 한다.
 *
 * 🔴 **인가를 액션 안에서 다시 본다.** 설정 탭을 안 그리는 것은 편의일 뿐 차단이 아니다 — 서버
 *    액션은 망 너머에서 불리고, 그 경계에서 타입은 아무것도 막지 못한다
 *    (`src/app/actions/approval-routes.ts` 머리말의 같은 까닭).
 * 🔴 **검증을 건너뛰지 않는다.** 화면이 보내는 값은 고르개가 낸 것뿐이지만, 이 값은 **모든 사람의
 *    화면에 인라인 `style` 로 그대로 들어간다** — 손으로 만든 요청이 보낸 글자를 그대로 저장하면
 *    그 글자가 전 직원의 화면에 실린다.
 * 🔴 **검증이 깨진 칸을 메우지 않는다**(엄한 쪽을 쓴다). 메우면 사람이 보낸 적 없는 값이 조용히
 *    저장되고 화면은 「저장했습니다」라고 말한다 — 까닭은 `drawing-no-style.ts` 의 그 함수 주석.
 * 🔴 **`revalidatePath` 를 부르지 않는다.** 저장 뒤 설정 화면이 `router.refresh()` 로 제 화면을
 *    다시 그리고, 그때 인증 구간 레이아웃이 새 값을 다시 읽어 내려보낸다(`approval-routes` 와 같다).
 * ============================================================================
 */

export type SaveDrawingNoStyleResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * @param input 화면이 고른 넷. 🔴 **타입이 맞다고 믿지 않는다** — 아래에서 `unknown` 으로 다시 잰다.
 *   모양을 적어 두는 것은 화면 쪽이 무엇을 보내야 하는지 알게 하려는 것뿐이다.
 */
export async function saveDrawingNoStyleAction(input: { pill: boolean; fontSize: number; textColor: string; pillColor: string }): Promise<SaveDrawingNoStyleResult> {
  const session = await requireRole("ADMIN");

  const validated = validateDrawingNoStyleInput(input);
  if (!validated.ok) return { ok: false, message: validated.message };

  try {
    await saveDrawingNoStyle(validated.value, { id: session.user.id, name: session.user.name });
  } catch (e) {
    console.error("[drawing-no-style] 저장 실패:", e instanceof Error ? e.message : e);
    return { ok: false, message: "저장하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }

  return { ok: true, message: "도번 표시 모양을 저장했습니다." };
}
