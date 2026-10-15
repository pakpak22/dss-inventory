import { NextResponse, type NextRequest } from "next/server";
import { NO_STORE, checkApiToken } from "@/lib/api/auth";
import { buildOhTemplateResponse, parseOhTemplateQuery } from "@/lib/api/oh-templates";
import { findOhTemplateByProductModel } from "@/lib/oh/queries";

/**
 * GET /api/v1/oh-templates?modelId=… — **이 장비(제품 모델)의 O/H 템플릿 부품 목록**.
 * 설명은 API.md 6절, 규칙과 모양은 전부 `src/lib/api/oh-templates.ts`(순수 함수).
 *
 * 🔴 **왜 냈나**: O/H 부품 템플릿은 2026-10-15 에 A/S 에서 이쪽으로 옮겨 왔는데 **A/S 가 그것을 읽어 갈
 *    통로가 없었다.** 통로가 없으면 A/S 는 제 옛 표를 계속 보고, 옮긴 뜻이 사라진다.
 * 🔴 **읽기 토큰이다**(`INVENTORY_API_TOKEN`, API.md 1절) — 부품 목록과 같은 문이다. 이 통로는 재고를
 *    한 개도 움직이지 않는다. 쓰기 토큰으로 두드리면 401 이고, 읽기 토큰이 설정되지 않았으면 503 이다.
 * 🔴 **열쇠는 A/S 의 제품 모델 id** 하나다. 이름으로 찾지 않는다(이름은 바뀐다 — 순수 함수 머리말).
 * 🔴 **O/H 단가는 나가지 않는다.** 읽는 질의가 그 표를 아예 열지 않는다(`lib/oh/queries.ts`).
 * 🔴 **재고에 안 이어진 줄도 그대로 나간다**(`linked: false`). 감추면 A/S 가 「담지 못한 줄」을 사람에게
 *    알려 줄 수 없다.
 *
 * 여기서 하는 일은 둘뿐이다: 모델 id 읽기 · 그 모델의 템플릿 되읽기.
 */
export async function GET(request: NextRequest) {
  const denied = checkApiToken(request);
  if (denied) return denied;

  const parsed = parseOhTemplateQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: "bad_request", message: parsed.message }, { status: 400, headers: NO_STORE });

  const found = await findOhTemplateByProductModel(parsed.modelId);
  // 🔵 못 찾은 것은 **오류가 아니다** — `template: null` 로 200 이다(순수 함수 머리말).
  return NextResponse.json(buildOhTemplateResponse(parsed.modelId, found, new Date().toISOString()), { headers: NO_STORE });
}
