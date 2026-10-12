import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * 다른 사내 시스템(A/S·PO)이 부르는 읽기 전용 API 의 문지기 (REQUIREMENTS 7절 「A/S·PO에 부품 목록 내주기」).
 *
 * 사람이 아니라 **서버가 서버를** 부르므로 포털 로그인이 아니라 공유 토큰(`INVENTORY_API_TOKEN`)으로 가른다.
 *  - `Authorization: Bearer <토큰>`. 글자 단위 비교는 길이가 새지 않게 timingSafeEqual.
 *  - 토큰이 설정되지 않았으면 통로가 **닫힌 것**(503). 비어 있다고 열어 두지 않는다 (CLAUDE.md 12-1절 6번: 조용한 기본값 금지).
 *  - 응답은 캐시하지 않는다.
 */
export function checkApiToken(request: Request): NextResponse | null {
  const expected = env.inventoryApiToken;
  if (!expected) {
    return NextResponse.json({ error: "api_closed", message: "API 토큰이 설정되지 않아 통로가 닫혀 있습니다." }, { status: 503, headers: NO_STORE });
  }
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const given = m ? m[1].trim() : "";
  if (!given || !safeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorized", message: "토큰이 없거나 맞지 않습니다." }, { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } });
  }
  return null;
}

export const NO_STORE = { "cache-control": "no-store" } as const;

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
