import { NextResponse, type NextRequest } from "next/server";
import { NO_STORE, checkApiWriteToken } from "@/lib/api/auth";
import { judgeApiCancel, parseApiCancelRequest, toApiCancelResponse, type CancelDenial } from "@/lib/api/stock-request-cancel";
import { toApiRequestStatus } from "@/lib/api/stock-request-status";
import { cancelExternalRequest, findExternalRequestForCancel, listRequestsByExternalKeys } from "@/lib/stock/requests";

/**
 * POST /api/v1/stock-requests/cancel — A/S 가 **제가 올린 신청을 거둔다**. 설명은 API.md 4-9절.
 *
 * 🔴 **까닭**: 올리는 통로는 열렸는데 거둘 길이 없었다. 재고 관리는 A/S 에서 온 신청을 제 화면에서
 *    거두지 못하게 막아 두었고(거두면 저쪽에 열린 요청이 영영 답을 못 받는다), A/S 쪽에는 통로가
 *    없었다 — **잘못 올리면 아무도 되돌릴 수 없었다.** 거두는 것이 낸 쪽의 몫이라면 낸 쪽이 거둘
 *    문을 함께 내주어야 한다.
 * 🔴 **쓰기 토큰이다**(`INVENTORY_WRITE_TOKEN`). 재고를 한 개도 움직이지 않지만 신청의 상태를 바꾼다 —
 *    읽기 토큰으로 두드리면 401 이고, 재고 쪽에 쓰기 토큰이 없으면 이 통로만 503 으로 닫힌다.
 * 🔴 **조건 셋을 각각 다른 말로** 거절한다(있을 것 · 본인일 것 · 아직 대기일 것). 판정과 문구는 전부
 *    순수 함수에 있다(`src/lib/api/stock-request-cancel.ts` 의 `judgeApiCancel`) — 시험이 DB 없이 덮는다.
 * 🔴 **이미 거둔 것은 오류가 아니다** — 같은 요청이 두 번 와도 「거둬져 있다」를 그대로 돌려준다
 *    (`cancelled: false`, 200). 올리는 통로의 `created: false` 와 같은 정신이다.
 *
 * 여기서 하는 일은 넷뿐이다: 문지기 · 본문 검사 · 되짚기와 판정 · 거두고 **상태 통로와 같은 줄**로 답하기.
 */
export async function POST(request: NextRequest) {
  const denied = checkApiWriteToken(request);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad("본문을 JSON 으로 읽지 못했습니다. Content-Type: application/json 으로 보내십시오.");
  }

  const parsed = parseApiCancelRequest(raw);
  if (!parsed.ok) return bad(parsed.message);
  const { requestKey, requesterSub } = parsed.value;

  try {
    /**
     * 🔵 **두 바퀴까지 본다.** 판정과 거두기 사이에 상태가 바뀌면(같은 요청이 **동시에** 두 번 들어와
     *    한쪽이 먼저 거뒀거나, 담당자가 방금 집었거나) UPDATE 가 0행이다. 그때 「이미 처리됐습니다」로
     *    끝내면 🔴 **두 번 보내도 안전하다는 약속이 바로 그 자리에서 깨진다** — 다시 읽으면 그 신청은
     *    `CANCELLED` 라 두 번째 바퀴가 「거둬져 있다」로 답한다. 담당자가 집은 것이라면 그때는 제대로
     *    409 가 나간다. 어느 쪽이든 **다시 읽은 사실**로 답한다.
     */
    for (let attempt = 0; attempt < 2; attempt++) {
      const found = await findExternalRequestForCancel(requestKey);
      const judged = judgeApiCancel(found, requesterSub);
      if (!judged.ok) return deny(judged);
      if (judged.already) return await respond(requestKey, false);
      if (await cancelExternalRequest(judged.target, requesterSub)) return await respond(requestKey, true);
    }
    // 두 바퀴가 다 어긋났다 — 드문 경쟁이다. 지어내지 말고 「다시 보내라」로 끝낸다.
    return NextResponse.json(
      { error: "conflict", message: "그 사이에 신청 상태가 바뀌었습니다. 잠시 뒤 같은 requestKey 로 다시 보내십시오." },
      { status: 409, headers: NO_STORE },
    );
  } catch (e) {
    // 🔴 속사정을 밖으로 내보내지 않는다. **같은 요청을 다시 보내면 되고**, 두 번 거둬도 안전하다.
    console.error("[api] 반출 신청 거두기 실패:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "server_error", message: "신청을 거두지 못했습니다. 같은 requestKey 로 다시 보내십시오." }, { status: 500, headers: NO_STORE });
  }
}

/**
 * 거둔 뒤(또는 이미 거둬져 있는) 신청을 **상태 통로와 같은 줄 모양**으로 돌려준다.
 *
 * 🔵 줄을 빚는 길은 `listRequestsByExternalKeys` → `toApiRequestStatus` 하나뿐이다 — 거두고 나서 A/S 가
 *    상태를 **다시 묻지 않아도** 되고, 그때 받는 값과 여기서 받는 값이 한 글자도 다르지 않다.
 */
async function respond(requestKey: string, cancelled: boolean) {
  const [row] = await listRequestsByExternalKeys([requestKey]);
  if (!row) {
    // 방금 읽은 신청이 사라지는 길은 없다(신청은 지우지 않는다). 그래도 지어내지 않는다.
    return NextResponse.json({ error: "server_error", message: "거둔 신청을 다시 읽지 못했습니다. GET /api/v1/stock-requests 로 상태를 확인하십시오." }, { status: 500, headers: NO_STORE });
  }
  /**
   * 🔵 **거둔 신청에는 살아 있는 결재건이 없다** (2026-10-21, 조각 11f에서 칸이 생겼다). 바깥에서 거둘 수 있는
   *    것은 아직 대기(`PENDING`)인 신청뿐이고(`cancelExternalRequest` 의 WHERE), 결재가 올라간 신청은 그
   *    상태가 아니다. 그래서 여기서는 결재건을 **읽지 않고** `null` 이라고 적어서 말한다 —
   *    읽어 본 적이 없다는 사실을 칸에 드러내 두면, 나중에 거두는 규칙이 넓어질 때 여기가 눈에 걸린다.
   */
  // 🔵 **같은 까닭으로 `decidedVia` 도 `null` 이다**(2026-10-22) — 거둔 신청은 `decidedAt` 자체가 없어
  //    `decision` 이 통째로 `null` 이 되므로(`toApiRequestStatus`), `decidedVia` 값은 어차피 안 쓰인다.
  return NextResponse.json(toApiCancelResponse(cancelled, toApiRequestStatus(requestKey, { ...row.request, issueLock: null, decidedVia: null })), { headers: NO_STORE });
}

function deny(d: CancelDenial) {
  return NextResponse.json({ error: d.error, message: d.message }, { status: d.status, headers: NO_STORE });
}

function bad(message: string) {
  return NextResponse.json({ error: "bad_request", message }, { status: 400, headers: NO_STORE });
}
