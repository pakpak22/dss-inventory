/**
 * 마이그레이션 적용. `npm run db:migrate` (개발) / tools 이미지 (NAS).
 *
 * 🔴 적용은 사용자 승인 뒤에만 돌린다 (CLAUDE.md 11절). 이 스크립트는 drizzle/ 폴더의
 *    생성된 SQL 을 순서대로 적용할 뿐, 자료를 지우거나 초기화하지 않는다.
 *
 * Linux 컨테이너에서도 돌아야 하므로 PowerShell 이 아니라 TypeScript(tsx) 다 (12-3절).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadDotEnvLocal } from "./lib/dotenv-local";

async function main(): Promise<void> {
  loadDotEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 이 비어 있습니다.");
  // PostgreSQL 의 NOTICE("schema already exists, skipping" 등)는 정상 진행이라 화면에 찍지 않는다.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    console.log("마이그레이션 적용 완료.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("마이그레이션 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
