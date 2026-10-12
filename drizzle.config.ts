import { defineConfig } from "drizzle-kit";

// 마이그레이션 SQL 은 항상 `npm run db:generate` 로 만든다. 생성된 SQL 을 손으로 고치지 않는다.
// 적용(`npm run db:migrate`)은 사용자 승인 뒤에만. (CLAUDE.md 11절)
//
// drizzle-kit 은 .env.local 을 스스로 읽지 않으므로 여기서 직접 읽는다.
// DATABASE_URL 이 없어도 `generate` 는 돌아야 하기 때문에(스키마만 보면 된다) 빈 값일 때 던지지 않는다.
import { readFileSync } from "node:fs";

function loadDotEnvLocal(): void {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.local 이 없으면 (CI·컨테이너) 환경변수만 쓴다.
  }
}
loadDotEnvLocal();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
