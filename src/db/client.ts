import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * DB 연결. 이 시스템 전용 DB 하나만 쓴다 — dss-auth·A/S 의 DB 에는 접속하지 않는다 (CLAUDE.md 1절).
 *
 * 개발 서버(next dev)는 모듈을 여러 번 다시 불러오므로 globalThis 에 한 번만 만들어 둔다.
 * 안 그러면 저장할 때마다 연결 풀이 새로 생겨 PostgreSQL 연결 수가 바닥난다.
 *
 * 연결은 **처음 쓸 때** 만든다 — `next build` 가 DATABASE_URL 없이 돌아야 하기 때문 (env.ts 참고).
 */
type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __dssInventoryDb?: Db; __dssInventorySql?: ReturnType<typeof postgres> };

function create(): Db {
  const sql = postgres(env.databaseUrl, {
    // DS218+ 는 RAM 이 작다. 연결을 많이 열지 않는다.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // NAS 는 UTC 로 돈다. 날짜 표시는 코드에서 Asia/Seoul 로 명시한다 (CLAUDE.md 10절).
    // 여기서 세션 타임존을 바꾸지 않는다 — timestamptz 는 어차피 절대 시각이다.
  });
  globalForDb.__dssInventorySql = sql;
  return drizzle(sql, { schema, casing: "snake_case" });
}

export function db(): Db {
  return (globalForDb.__dssInventoryDb ??= create());
}

export { schema };
