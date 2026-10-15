import { timingSafeEqual } from "node:crypto";

/**
 * 바깥 시스템(A/S·PO)이 내는 공유 토큰의 **판정만** — 순수 함수 (2026-10-15, A/S 반출 신청 통로).
 *
 * 🔵 `auth.ts` 에서 떼어 왔다. 저쪽은 `server-only` 라 시험이 **불러올 수조차 없어서**(`npm test` 는
 *    react-server 조건 없이 돈다), 「읽기 토큰으로는 쓰기가 안 된다」·「토큰이 없으면 닫힌다」 같은
 *    울타리를 시험으로 지킬 길이 없었다. 판정을 여기 두면 시험이 **실제 env 값**으로 확인한다
 *    (`tests/api-stock-requests.test.ts`).
 * 🔴 **동작은 한 글자도 바꾸지 않았다** — 응답 코드(401·503)도, 오류 이름도, 문구도 전과 같다.
 *    `NextResponse` 로 빚는 일은 그대로 `auth.ts` 가 한다.
 */
export interface TokenDenial {
  /** 401 토큰이 없거나 틀림 · 503 우리 쪽에 토큰이 설정되지 않아 통로가 닫힘 */
  status: 401 | 503;
  error: "unauthorized" | "api_closed";
  message: string;
}

/**
 * 토큰이 맞으면 `null`, 아니면 거절 사유.
 *
 * 🔴 **설정이 비어 있으면 열어 두지 않고 닫는다**(503). 비면 통과시키는 기본값은 조용히 문을 여는
 *    것이라 가장 위험하다 (CLAUDE.md 12-1절 6번).
 * 🔴 글자 비교는 `timingSafeEqual` — 길이가 새지 않게.
 */
export function checkBearerToken(expected: string | null, authorizationHeader: string | null): TokenDenial | null {
  if (!expected) {
    return { status: 503, error: "api_closed", message: "API 토큰이 설정되지 않아 통로가 닫혀 있습니다." };
  }
  const m = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? "");
  const given = m ? m[1].trim() : "";
  if (!given || !safeEqual(given, expected)) {
    return { status: 401, error: "unauthorized", message: "토큰이 없거나 맞지 않습니다." };
  }
  return null;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
