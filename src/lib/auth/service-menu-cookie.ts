import { env } from "@/lib/env";
import type { DssService } from "./oidc";
import { signValue, verifyValue } from "./signed-value";

/**
 * 시스템 오가기 메뉴 목록. ID 토큰의 `dss_services` 에서 오는데 userinfo 에는 없어서(6-5절)
 * 로그인할 때 **별도 서명 쿠키**에 담아 두고 매 요청에 읽는다 (9-5절).
 * 서명하는 이유: 사용자가 쿠키를 고쳐 머리말에 엉뚱한 링크를 끼워 넣지 못하게.
 */
export function encodeServiceMenu(services: DssService[], now = Date.now()): string {
  return signValue({ s: services }, env.authSessionSecret, env.sessionHours * 3600, now);
}

export function decodeServiceMenu(token: string | undefined | null, now = Date.now()): DssService[] {
  const v = verifyValue<{ s: unknown }>(token, env.authSessionSecret, now);
  if (!v || !Array.isArray(v.s)) return [];
  return v.s.filter(
    (x): x is DssService =>
      typeof x === "object" && x !== null && typeof (x as DssService).id === "string" && typeof (x as DssService).url === "string",
  );
}
