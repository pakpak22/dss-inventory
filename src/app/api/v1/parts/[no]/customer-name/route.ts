import { NextResponse, type NextRequest } from "next/server";
import { NO_STORE, checkApiWriteToken } from "@/lib/api/auth";
import { customerNameDenial, parseApiCustomerName, parsePartNoParam, toApiCustomerNameResponse } from "@/lib/api/part-customer-name";
import { findActiveUserByAuthSub } from "@/lib/auth/users";
import { fillCustomerName } from "@/lib/parts/mutations";

/**
 * POST /api/v1/parts/{no}/customer-name — A/S 가 **고객사 품명을 채운다**. 설명은 API.md 7절.
 *
 * 🔴 **재고 관리의 부품 자료를 바깥에서 고치는 첫 통로다.** 지금까지 바깥이 쓰는 자리는 반출 신청을
 *    세우고 거두는 것뿐이었고 그것은 신청 표만 건드렸다 — 여기서는 **정본인 `parts` 의 칸 하나**가
 *    바뀐다. 그래서 규칙이 좁다: **비어 있을 때만 채우고, 덮지 않고, 지우지 않는다**
 *    (2026-10-14 사용자 결정. 설계 `docs/부품요청_이관_설계_2026-10-14.md` 7절).
 * 🔴 **쓰기 토큰이다**(`INVENTORY_WRITE_TOKEN`). 읽기 토큰으로 두드리면 401 이고, 재고 쪽에 쓰기 토큰이
 *    없으면 이 통로만 503 으로 닫힌다 — 비었다고 열어 두지 않는다.
 * 🔴 **이미 값이 있으면 오류가 아니다** — 덮지 않고 **지금 값**을 돌려준다(`filled: false`). 받는 쪽이
 *    「이미 있습니다 — 「…」」라고 말할 수 있어야 하기 때문이다. 올리는 통로의 `created: false`,
 *    거두는 통로의 `cancelled: false` 와 같은 정신이다.
 *
 * 검사·문구·판정은 전부 순수 함수에 있다(`src/lib/api/part-customer-name.ts`) — 시험이 DB 없이 덮는다.
 * 여기서 하는 일은 넷뿐이다: 문지기 · 번호와 본문 검사 · **포털 번호로 사람 되짚기** · 채우고 답하기.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  const denied = checkApiWriteToken(request);
  if (denied) return denied;

  const { no: rawNo } = await params;
  const no = parsePartNoParam(rawNo);
  if (no === null) return bad("주소의 no 는 부품 No.(1 이상의 정수)입니다. GET /api/v1/parts 의 no 를 쓰십시오.");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad("본문을 JSON 으로 읽지 못했습니다. Content-Type: application/json 으로 보내십시오.");
  }

  const parsed = parseApiCustomerName(raw);
  if (!parsed.ok) return bad(parsed.message);
  const { customerName, filledBy } = parsed.value;

  try {
    /**
     * 포털 번호로 사람을 잇는다. 🔴 **못 찾아도 채운다** — 반출 신청 통로와 같은 결이다(API.md 4-5절).
     * 막으면 현장에서 이름을 못 채우고, 그러면 이 기능이 있으나 마나다.
     * 🔵 이력에 보일 이름은 **찾았으면 우리 쪽 이름**을 쓴다(같은 사람이 화면마다 다른 이름으로 보이지
     *    않게). 보내온 이름은 `detail.filledBy` 에 그대로 남는다.
     */
    const user = await findActiveUserByAuthSub(filledBy.sub);
    const result = await fillCustomerName(no, customerName, { id: user?.id ?? null, name: user?.name ?? filledBy.name, sub: filledBy.sub, sentName: filledBy.name });
    if (!result.ok) {
      const d = customerNameDenial(result.code, no);
      return NextResponse.json({ error: d.error, message: d.message }, { status: d.status, headers: NO_STORE });
    }
    return NextResponse.json(toApiCustomerNameResponse(result.filled, result.part), { headers: NO_STORE });
  } catch (e) {
    // 🔴 속사정을 밖으로 내보내지 않는다. **같은 요청을 다시 보내면 된다** — 두 번 채워도 안전하다
    //    (두 번째는 「이미 있다」로 돌아간다).
    console.error("[api] 고객사 품명 채우기 실패:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "server_error", message: "고객사 품명을 채우지 못했습니다. 같은 요청을 다시 보내십시오." }, { status: 500, headers: NO_STORE });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: "bad_request", message }, { status: 400, headers: NO_STORE });
}
