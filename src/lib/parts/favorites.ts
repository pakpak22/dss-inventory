import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { partFavorites } from "@/db/schema/part-favorites";

/** 이 사람이 별표를 붙인 부품 id 들 */
export async function listFavoritePartIds(userId: string): Promise<string[]> {
  const rows = await db().select({ partId: partFavorites.partId }).from(partFavorites).where(eq(partFavorites.userId, userId));
  return rows.map((r) => r.partId);
}

/** 별표 켜고 끄기. 돌아오는 값은 바뀐 뒤 상태. 같은 사람이 두 번 눌러도 UNIQUE 가 막는다(onConflictDoNothing). */
export async function toggleFavorite(userId: string, partId: string): Promise<{ favorite: boolean }> {
  const [existing] = await db()
    .select({ id: partFavorites.id })
    .from(partFavorites)
    .where(and(eq(partFavorites.userId, userId), eq(partFavorites.partId, partId)))
    .limit(1);
  if (existing) {
    await db().delete(partFavorites).where(eq(partFavorites.id, existing.id));
    return { favorite: false };
  }
  await db().insert(partFavorites).values({ userId, partId }).onConflictDoNothing();
  return { favorite: true };
}
