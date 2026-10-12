import { readFileSync } from "node:fs";

/**
 * `.env.local` 을 process.env 에 싣는다. tsx 로 도는 스크립트(migrate·seed)가 쓴다.
 * 개발 PC 에만 있는 파일이라 없으면 그냥 넘어간다 — 컨테이너(NAS)에서는 환경변수만 쓴다.
 * 이미 있는 환경변수는 덮어쓰지 않는다.
 */
export function loadDotEnvLocal(): void {
  try {
    for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (!(key in process.env)) process.env[key] = line.slice(eq + 1).trim();
    }
  } catch {
    /* 컨테이너: 환경변수만 쓴다 */
  }
}
