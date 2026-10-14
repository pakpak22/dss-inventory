import "server-only";
import { env } from "@/lib/env";
import { parseAsUsersResponse, type AsUserDirectory } from "./directory";

/**
 * ============================================================================
 * A/S 사람 명부 받아 오기 — `GET {AS_API_BASE_URL}/users`
 * ============================================================================
 * 결재자는 A/S 의 사람이라 명부가 저쪽에 있다(2026-10-15 사용자 결정). `src/lib/stock/
 * intake-lookup.ts` 와 **같은 모양**이다 — 시간 제한을 걸고, 실패를 삼켜 뜻 있는 결과로
 * 바꾸고, 응답 모양을 맞추는 자리를 한 곳으로 모은다.
 *
 * 🔴 **GET 만 부른다.** 이 시스템이 A/S 에 무엇을 쓰는 길은 없다.
 *
 * 🔴 **받아 온 명부를 우리 DB 에 저장하지 않는다**(사본을 두지 않기로 했다). 예외는 결재선
 * 단계에 적는 이름·역할뿐이고, 그것은 명부의 사본이 아니라 **「그때 이렇게 저장했다」는
 * 기록**이다(`src/db/schema/approval-routes.ts` 머리말).
 *
 * ── 🔴 실패는 전부 unreachable 이다 — 빈 목록으로 바꾸지 않는다 ───────────
 * 주소가 없든, 늦든, 401 이든, 본문을 못 읽든 전부 「못 받아 왔다」다. 어느 하나라도
 * `{ status: "ok", users: [] }` 로 바꾸면 화면이 멀쩡한 결재선을 「A/S 명부에 없는 사람들」로
 * 그리고, 저장 경로는 확인 없이 통과시킨다. 그 갈림의 까닭은 `directory.ts` 머리말에 있다.
 * ============================================================================
 */

const TIMEOUT_MS = 5000;

export async function fetchAsUserDirectory(): Promise<AsUserDirectory> {
  const base = env.asApiBaseUrl;
  if (!base) return { status: "unreachable", reason: "not_configured" };

  const url = `${base.replace(/\/+$/, "")}/users`;
  const headers: Record<string, string> = { Accept: "application/json" };
  // 인수번호 조회와 **같은 토큰**이다 — A/S 쪽이 통로 셋을 공유 토큰 하나로 지킨다.
  const token = env.asLookupToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) {
      console.error("[as-users] A/S 응답", res.status);
      return { status: "unreachable", reason: "error" };
    }
    const users = parseAsUsersResponse(await res.json());
    if (users === null) {
      // 🔴 본문을 못 읽은 것은 「한 명도 없다」가 아니다. 빈 배열로 내려보내면 화면이
      //    저장된 결재선을 전부 「명부에 없음」으로 그린다.
      console.error("[as-users] A/S 응답 모양을 읽지 못했습니다.");
      return { status: "unreachable", reason: "error" };
    }
    return { status: "ok", users };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error("[as-users] 실패:", aborted ? "시간 초과" : e instanceof Error ? e.message : e);
    return { status: "unreachable", reason: aborted ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}
