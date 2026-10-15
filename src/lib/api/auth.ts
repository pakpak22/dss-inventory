import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { checkBearerToken, type TokenDenial } from "./token-gate";

/**
 * 다른 사내 시스템(A/S·PO)이 부르는 API 의 문지기 (REQUIREMENTS 7절 「A/S·PO에 부품 목록 내주기」).
 *
 * 사람이 아니라 **서버가 서버를** 부르므로 포털 로그인이 아니라 공유 토큰으로 가른다.
 *  - `Authorization: Bearer <토큰>`. 판정은 순수 함수 `./token-gate` 에 있다(시험이 거기를 본다).
 *  - 토큰이 설정되지 않았으면 통로가 **닫힌 것**(503). 비어 있다고 열어 두지 않는다 (CLAUDE.md 12-1절 6번).
 *  - 응답은 캐시하지 않는다.
 *
 * 🔴 **읽기와 쓰기의 토큰이 다르다** (2026-10-15). 읽기(`/api/v1/parts`)는 `INVENTORY_API_TOKEN`,
 *    쓰기(`POST /api/v1/stock-requests`)는 `INVENTORY_WRITE_TOKEN` 이다. 읽기 토큰은 여러 시스템이
 *    나눠 쓰는 값이라, 그것 하나로 재고를 **움직이는** 신청까지 만들 수 있으면 안 된다. 값이 다르므로
 *    읽기 토큰으로 쓰기 통로를 두드리면 401 이다.
 */
export function checkApiToken(request: Request): NextResponse | null {
  return denialResponse(checkBearerToken(env.inventoryApiToken, request.headers.get("authorization")));
}

/** 쓰기 통로의 문지기. 🔴 위와 **다른 환경변수**를 본다(`INVENTORY_WRITE_TOKEN`). 없으면 통로가 닫힌다(503). */
export function checkApiWriteToken(request: Request): NextResponse | null {
  return denialResponse(checkBearerToken(env.inventoryWriteToken, request.headers.get("authorization")));
}

function denialResponse(denial: TokenDenial | null): NextResponse | null {
  if (!denial) return null;
  const headers = denial.status === 401 ? { ...NO_STORE, "www-authenticate": "Bearer" } : NO_STORE;
  return NextResponse.json({ error: denial.error, message: denial.message }, { status: denial.status, headers });
}

export const NO_STORE = { "cache-control": "no-store" } as const;

export { safeEqual } from "./token-gate";
