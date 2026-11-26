import { NextResponse, type NextRequest } from "next/server";
import { NO_STORE, checkApiToken } from "@/lib/api/auth";
import { buildReturnCandidatesResponse, parseReturnCandidatesQuery, pendingByTransaction, summarizeReturnCandidates } from "@/lib/api/return-candidates";
import { returnableLinesByIntake } from "@/lib/stock/queries";
import { listPendingReturnPayloads } from "@/lib/stock/requests";

/**
 * GET /api/v1/return-candidates?intake=D260701 — A/S 가 **「이 수리 건에서 무엇을 얼마나 돌려줄 수 있나」**를
 * 물어 간다. 설명은 API.md 8절, 규칙과 모양은 전부 `src/lib/api/return-candidates.ts`(순수 함수).
 *
 * 🔴 **읽기 토큰이다**(`INVENTORY_API_TOKEN`) — 부품 목록·신청 상태와 **같은 문**이다. 이 통로는 재고를
 *    한 개도 움직이지 않는다(신청을 세우지도 않는다). 쓰기 토큰(`INVENTORY_WRITE_TOKEN`)은 재고를
 *    **움직이는** 신청을 만드는 자리에만 쓴다(`lib/api/auth.ts` 머리말). 쓰기 토큰으로 두드리면 401 이다 —
 *    두 값이 다른 환경변수에서 오기 때문이고, 그것을 시험이 지킨다.
 * 🔴 **쓰기를 한 줄도 하지 않는다.** 반환 **신청을 받는 일**은 다음 조각이고, 이 파일에는 그때도
 *    POST 가 생기지 않는다(신청을 만드는 통로는 `stock-requests` 쪽 모양을 따른다).
 *
 * 여기서 하는 일은 셋뿐이다: 인수번호 가리기 · 나간 줄과 대기 중인 반환 신청 읽기 · 순수 함수에 넘기기.
 */
export async function GET(request: NextRequest) {
  const denied = checkApiToken(request);
  if (denied) return denied;

  const parsed = parseReturnCandidatesQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: "bad_request", message: parsed.message }, { status: 400, headers: NO_STORE });

  try {
    const lines = await returnableLinesByIntake(parsed.intakeNumber);
    // 🔵 **나간 줄이 하나도 없으면 신청 표를 열지 않는다** — 없는 인수번호를 물어보는 호출(오타·아직
    //    아무것도 안 나간 건)이 흔하고, 그때 읽어 봐야 뺄 것이 없다. 🔴 「빠르게」가 아니라 **답이
    //    같아서** 건너뛰는 것이다: 줄이 없으면 묶을 부품도 없어 목록은 어차피 빈다.
    const pending = lines.length === 0 ? new Map<string, number>() : pendingByTransaction(await listPendingReturnPayloads());
    const candidates = summarizeReturnCandidates(lines, pending);
    return NextResponse.json(buildReturnCandidatesResponse(parsed.intakeNumber, candidates, new Date().toISOString()), { headers: NO_STORE });
  } catch (e) {
    // 🔴 속사정을 밖으로 내보내지 않는다. 읽기라 다시 물어도 안전하므로 그렇게 말해 준다.
    console.error("[api] 반환 가능 부품 읽기 실패:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "server_error", message: "돌려줄 수 있는 부품을 읽지 못했습니다. 잠시 뒤 다시 물으십시오." }, { status: 500, headers: NO_STORE });
  }
}
