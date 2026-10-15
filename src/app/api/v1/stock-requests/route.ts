import { inArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { parts } from "@/db/schema/parts";
import { NO_STORE, checkApiWriteToken } from "@/lib/api/auth";
import { buildApiUseRequest, parseApiStockRequest, resolveApiRequestLines, toApiStockRequest } from "@/lib/api/stock-requests";
import { findActiveUserByAuthSub } from "@/lib/auth/users";
import { todaySeoul } from "@/lib/stock/codes";
import { createRequest } from "@/lib/stock/requests";

/**
 * POST /api/v1/stock-requests — A/S 가 올리는 **부품 반출 신청**. 설명은 API.md 4절.
 *
 * 🔴 **바깥이 쓰기를 하는 첫 통로다.** 그래도 여기서 수량은 **한 개도 움직이지 않는다** — 「확인 대기」 신청
 *    한 줄이 설 뿐이고, 재고 담당자가 화면에서 [확인]을 눌러야 그때 원장에 떨어진다
 *    (2026-10-08 결정: 「신청은 A/S 에서, 승인은 재고관리에서」).
 * 🔴 **토큰이 읽기와 다르다**(`INVENTORY_WRITE_TOKEN`). 읽기 토큰으로 두드리면 401 이다(`lib/api/auth.ts`).
 * 🔴 **멱등**: 같은 `requestKey` 가 두 번 오면 새로 만들지 않고 **처음 만든 신청을 그대로** 돌려준다
 *    (201 새로 만듦 / 200 이미 있음, 본문의 `created`). 그래야 끊겼을 때 A/S 가 안심하고 다시 보낸다.
 * 🔴 **결과를 알려 주지 않는다.** 승인·반려는 A/S 가 **물어 간다**(2026-10-15 사용자 결정) — 되돌려 부르는
 *    길(웹훅)은 만들지 않았다. 재고관리가 A/S 를 부르는 통로는 인수번호 조회 하나뿐이다(API.md 4-2절).
 *
 * 규칙·검사는 전부 순수 함수에 있다(`src/lib/api/stock-requests.ts`). 여기서 하는 일은 셋뿐이다:
 * 부품 No. 되짚기 · 포털 번호로 사람 되짚기 · `createRequest` 부르기.
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

  const parsed = parseApiStockRequest(raw);
  if (!parsed.ok) return bad(parsed.message);
  const value = parsed.value;

  try {
    // 1. 부품 No. → 부품. 🔴 없는 번호·숨긴 부품은 **각각 다른 말로** 거절한다. 조용히 건너뛰지 않는다.
    const found = await db()
      .select({ no: parts.no, id: parts.id, isDeleted: parts.isDeleted })
      .from(parts)
      .where(
        inArray(
          parts.no,
          value.lines.map((l) => l.no),
        ),
      );
    const resolved = resolveApiRequestLines(value.lines, found);
    if (!resolved.ok) return bad(resolved.message);

    // 2. 포털 번호로 사람을 잇는다. 🔴 **못 찾아도 신청은 받는다** — 막으면 현장에서 요청을 못 낸다
    //    (2026-10-15 사용자 결정). 그때는 id 없이 이름과 포털 번호만 남는다.
    //    🔵 이름은 **찾았으면 우리 쪽 이름**을 쓴다. 같은 사람이 화면마다 다른 이름으로 보이지 않게.
    //       A/S 가 보낸 이름은 감사 로그에 그대로 남긴다(아래 `audit`).
    const user = await findActiveUserByAuthSub(value.requester.sub);

    const created = await createRequest(buildApiUseRequest(value, resolved.lines, todaySeoul()), { id: user?.id ?? null, name: user?.name ?? value.requester.name }, {
      source: "AS",
      externalKey: value.requestKey,
      requesterSub: value.requester.sub,
      audit: { requesterSub: value.requester.sub, requesterName: value.requester.name, matchedUser: user ? user.name : null, intakeNumber: value.intakeNumber },
    });

    return NextResponse.json(toApiStockRequest(created, value.requestKey, "USE"), { status: created.created ? 201 : 200, headers: NO_STORE });
  } catch (e) {
    // 🔴 속사정을 밖으로 내보내지 않는다. A/S 는 **같은 requestKey 로 다시 보내면 되고**, 그래서 두 번 서지 않는다.
    console.error("[api] 반출 신청 만들기 실패:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "server_error", message: "신청을 만들지 못했습니다. 같은 requestKey 로 다시 보내십시오." }, { status: 500, headers: NO_STORE });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: "bad_request", message }, { status: 400, headers: NO_STORE });
}
