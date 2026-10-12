"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { toggleFavorite } from "@/lib/parts/favorites";

/**
 * 즐겨찾기 별표 켜고 끄기 (2026-10-07). 로그인한 사람이면 누구나 — 역할 검사 없음(개인 표시).
 * 서버 액션은 Next 가 Origin 을 Host 와 대조해 CSRF 를 막는다 (Next 16 문서 server-actions).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function toggleFavoriteAction(partId: string): Promise<{ ok: boolean; favorite: boolean }> {
  const session = await requireSession("/");
  if (!UUID_RE.test(partId)) return { ok: false, favorite: false };
  try {
    const r = await toggleFavorite(session.user.id, partId);
    revalidatePath("/");
    return { ok: true, favorite: r.favorite };
  } catch (e) {
    console.error("[favorites] 저장 실패:", e instanceof Error ? e.message : e);
    return { ok: false, favorite: false };
  }
}
