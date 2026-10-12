/**
 * 항목 19종 넣기. `npm run db:seed-items`
 *
 * 데모가 아니라 **기준 자료**다 (src/db/seed/part-items.ts). 몇 번 돌려도 같다(코드가 같으면 건너뛴다) —
 * 이미 있는 항목의 이름·차례는 **건드리지 않는다.** 관리자가 화면에서 바꾼 값을 덮어쓰면 안 되기 때문이다.
 * 지우는 일은 하지 않는다.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { partItems } from "../src/db/schema/part-items";
import { PART_ITEM_SEED } from "../src/db/seed/part-items";
import { loadDotEnvLocal } from "./lib/dotenv-local";

async function main(): Promise<void> {
  loadDotEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 이 비어 있습니다.");
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  try {
    let added = 0;
    for (const [i, item] of PART_ITEM_SEED.entries()) {
      const exists = await db.select({ id: partItems.id }).from(partItems).where(eq(partItems.code, item.code)).limit(1);
      if (exists.length > 0) continue;
      await db.insert(partItems).values({ code: item.code, name: item.name, sortOrder: (i + 1) * 10 });
      added++;
    }
    console.log(`항목 ${PART_ITEM_SEED.length}종 중 ${added}종 넣음 (나머지는 이미 있음).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("항목 넣기 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
