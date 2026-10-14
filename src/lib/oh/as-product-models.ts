import "server-only";
import { env } from "@/lib/env";
import { parseAsProductModelsResponse, type AsProductModelDirectory } from "./product-models";

/**
 * ============================================================================
 * A/S 제품 모델 받아 오기 — `GET {AS_API_BASE_URL}/product-models`
 * ============================================================================
 * 제품 모델의 주인은 A/S 다(2026-10-15). `src/lib/approval/as-users.ts` 와 **같은 모양**이다 —
 * 시간 제한을 걸고, 실패를 삼켜 뜻 있는 결과로 바꾸고, 응답 모양을 맞추는 자리를 한 곳으로 모은다.
 * 토큰도 같다: A/S 쪽이 통로 셋(인수번호·사람 명부·제품 모델)을 공유 토큰 하나로 지킨다.
 *
 * 🔴 **GET 만 부른다.** 이 시스템이 A/S 에 무엇을 쓰는 길은 없다.
 *
 * 🔴 **받아 온 명부를 우리 DB 에 저장하지 않는다.** 예외는 템플릿에 이어 붙일 때 적는
 * `product_model_name` 하나뿐이고, 그것은 사본이 아니라 「그때 이렇게 이었다」는 기록이다.
 *
 * ── 🔴 실패는 전부 unreachable 이다 — 빈 목록으로 바꾸지 않는다 ───────────
 * 주소가 없든, 늦든, 401 이든, 본문을 못 읽든 전부 「못 받아 왔다」다. 어느 하나라도
 * `{ status: "ok", models: [] }` 로 바꾸면 화면이 「이을 수 있는 모델이 없습니다」라고 적고,
 * 관리자는 A/S 쪽 모델이 지워진 줄 안다. 그 갈림의 까닭은 `product-models.ts` 머리말에 있다.
 * ============================================================================
 */

const TIMEOUT_MS = 5000;

export async function fetchAsProductModels(): Promise<AsProductModelDirectory> {
  const base = env.asApiBaseUrl;
  if (!base) return { status: "unreachable", reason: "not_configured" };

  const url = `${base.replace(/\/+$/, "")}/product-models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = env.asLookupToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) {
      console.error("[as-product-models] A/S 응답", res.status);
      return { status: "unreachable", reason: "error" };
    }
    const models = parseAsProductModelsResponse(await res.json());
    if (models === null) {
      // 🔴 본문을 못 읽은 것은 「한 개도 없다」가 아니다(머리말).
      console.error("[as-product-models] A/S 응답 모양을 읽지 못했습니다.");
      return { status: "unreachable", reason: "error" };
    }
    return { status: "ok", models };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error("[as-product-models] 실패:", aborted ? "시간 초과" : e instanceof Error ? e.message : e);
    return { status: "unreachable", reason: aborted ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}
