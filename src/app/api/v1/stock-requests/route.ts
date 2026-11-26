import { inArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { parts } from "@/db/schema/parts";
import { listOpenPartIssueStatusesByRequest } from "@/lib/approval/part-issue";
import { partIssueLockFor, type PartIssueLock } from "@/lib/approval/part-issue-gate";
// 🔴 「누가 반려했나」는 재고 관리 화면의 반려 사유 상자와 **같은 조회**에서 받는다
//    (2026-10-22, 「세 번째 자리를 같은 이름으로」) — 손으로 새로 적지 않는다.
import { readPartIssueRejectionActorsByRequest } from "@/lib/approval/part-issue-screen-data";
import { NO_STORE, checkApiToken, checkApiWriteToken } from "@/lib/api/auth";
// 🔴 「대기 중인 반환 신청」을 세는 셈은 **앞 조각의 그것 하나**다 — 두 벌로 적으면 A/S 화면이 보여 준
//    최댓값과 여기서 받아 주는 수가 갈린다(`./return-allocation.ts` 머리말).
import { allocateReturnLines } from "@/lib/api/return-allocation";
import { pendingByTransaction } from "@/lib/api/return-candidates";
import { buildIntakeStatusResponse, buildStatusResponse, parseStatusQuery } from "@/lib/api/stock-request-status";
import { buildApiReturnRequest, buildApiUseRequest, parseApiStockRequest, resolveApiRequestLines, toApiStockRequest, type ApiReturnRequestInput } from "@/lib/api/stock-requests";
import { findActiveUserByAuthSub } from "@/lib/auth/users";
import { todaySeoul } from "@/lib/stock/codes";
import { returnableLinesByIntake } from "@/lib/stock/queries";
import { createRequest, findRequestByExternalKey, listPendingReturnPayloads, listRequestsByExternalKeys, listRequestsByIntakeNumbers } from "@/lib/stock/requests";

/**
 * POST /api/v1/stock-requests — A/S 가 올리는 **부품 반출 신청**과 **반환 신청**. 설명은 API.md 4·4-11절.
 *
 * 🔵 **2026-11-26 에 반환이 더해졌다** (`type: "RETURN"`). 가르는 자리는 아래 `value.type` 하나이고,
 *    **반출이 가던 길은 한 글자도 바뀌지 않았다** — 칸을 안 보내면 지금까지처럼 반출이다.
 *
 * 🔴 **바깥이 쓰기를 하는 첫 통로다.** 그래도 여기서 수량은 **한 개도 움직이지 않는다** — 「확인 대기」 신청
 *    한 줄이 설 뿐이고, 재고 담당자가 화면에서 [확인]을 눌러야 그때 원장에 떨어진다
 *    (2026-10-08 결정: 「신청은 A/S 에서, 승인은 재고관리에서」).
 * 🔴 **토큰이 읽기와 다르다**(`INVENTORY_WRITE_TOKEN`). 읽기 토큰으로 두드리면 401 이다(`lib/api/auth.ts`).
 * 🔴 **멱등**: 같은 `requestKey` 가 두 번 오면 새로 만들지 않고 **처음 만든 신청을 그대로** 돌려준다
 *    (201 새로 만듦 / 200 이미 있음, 본문의 `created`). 그래야 끊겼을 때 A/S 가 안심하고 다시 보낸다.
 * 🔴 **결과를 알려 주지 않는다.** 승인·반려는 A/S 가 **물어 간다**(2026-10-15 사용자 결정) — 되돌려 부르는
 *    길(웹훅)은 만들지 않았다. 재고관리가 A/S 를 부르는 통로는 인수번호 조회 하나뿐이다(API.md 4-6절).
 *    물어 가는 통로는 **이 파일 아래의 `GET`** 이다(2026-10-15, API.md 4-7절).
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
    // 🔴 **반환은 길이 다르다** (2026-11-26) — 줄을 원장 줄로 쪼개야 해서, 되짚는 것도 담는 것도 다르다.
    //    아래 반출 길은 **한 글자도 안 바뀌었다**(그 길에 가지를 치지 않고 여기서 갈라 보낸다).
    if (value.type === "RETURN") return await createReturnRequest(value);

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
      /**
       * 🔴 **수리 건의 종류는 `payload` 가 아니라 제 칸으로 간다** (2026-10-22) — 어느 승인 절차를
       *    붙일지가 여기서 갈린다. 모르는 글자는 이미 `parseApiStockRequest` 에서 `null` 로
       *    떨어졌고(「받은 것을 믿지 마라」), `null` 은 기존 「부품 불출」 절차다.
       */
      workflowKind: value.workflowKind,
      audit: { requesterSub: value.requester.sub, requesterName: value.requester.name, matchedUser: user ? user.name : null, intakeNumber: value.intakeNumber },
    });

    return NextResponse.json(toApiStockRequest(created, value.requestKey, "USE"), { status: created.created ? 201 : 200, headers: NO_STORE });
  } catch (e) {
    // 🔴 속사정을 밖으로 내보내지 않는다. A/S 는 **같은 requestKey 로 다시 보내면 되고**, 그래서 두 번 서지 않는다.
    console.error("[api] 반출 신청 만들기 실패:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "server_error", message: "신청을 만들지 못했습니다. 같은 requestKey 로 다시 보내십시오." }, { status: 500, headers: NO_STORE });
  }
}

/**
 * **반환 신청 세우기** (2026-11-26). 규칙과 모양은 전부 순수 함수에 있다
 * (`lib/api/stock-requests.ts` · `lib/api/return-allocation.ts`) — 여기서 하는 일은 넷이다:
 * 이미 들어온 신청인지 보기 · 돌려줄 수 있는 줄과 대기 중인 신청 읽기 · 쪼개기 · 신청 만들기.
 *
 * ── 🔴 **멱등을 「세기 전에」 가려야 한다** ──────────────────────────────
 * 반출과 달리 반환은 신청을 만들기 **전에** 「얼마나 돌려줄 수 있나」를 세는데, 그 셈이 **대기 중인
 * 반환 신청을 뺀다.** 그래서 끊겨서 같은 `requestKey` 로 다시 보내면 **처음 만든 제 신청에 막혀**
 * 「남은 것보다 많습니다」로 400 이 나간다 — A/S 는 그것을 「안 들어갔다」로 읽고 사람이 손으로 확인하게
 * 된다. 🔴 그래서 **여기서 먼저 찾아본다.** `createRequest` 안의 멱등 되돌림은 그대로 두었다(진짜
 * 울타리는 표의 UNIQUE 다 — 그 함수 머리말).
 * 🔵 **반출 길에는 이 미리 찾기를 더하지 않았다** — 거기엔 「제 신청에 제가 막히는」 셈이 없어
 *    `createRequest` 의 되돌림으로 충분하고, 호출마다 질의를 하나 더 얹을 까닭이 없다.
 *
 * 🔴 **마지막 울타리는 여기가 아니다.** 서로 다른 열쇠로 **같은 순간** 두 건이 들어오면 둘 다 같은
 *    `pending` 을 보고 둘 다 설 수 있다. 그때 넘치는 쪽은 담당자가 [확인]을 누르는 순간 원장이
 *    **잠그고 다시 세어** 거절한다(`ledger.ts` 의 `return_exceeds`). 이 통로는 **수량을 한 개도
 *    움직이지 않는다.**
 */
async function createReturnRequest(value: ApiReturnRequestInput) {
  const already = await findRequestByExternalKey(value.requestKey);
  if (already) {
    // 🔴 **저장된 줄의 종류**로 답한다 — 이번에 보낸 종류가 아니다(같은 열쇠를 다른 종류로 다시 쓰면 둘이 갈린다).
    return NextResponse.json(toApiStockRequest({ id: already.id, status: already.status, created: false }, value.requestKey, already.type), { status: 200, headers: NO_STORE });
  }

  const candidates = await returnableLinesByIntake(value.intakeNumber);
  /**
   * 🔵 **나간 줄이 하나도 없으면 신청 표를 열지 않는다** — 뺄 것이 없어 **답이 같기** 때문이다
   *    (「빠르게」가 아니다). 그때는 아래 쪼개기가 줄마다 「돌려줄 수 있는 부품이 아닙니다」로 거절한다.
   *    🔵 읽는 통로(`GET /api/v1/return-candidates`)가 하는 것과 **같은 건너뛰기**다.
   */
  const pending = candidates.length === 0 ? new Map<string, number>() : pendingByTransaction(await listPendingReturnPayloads());
  const allocated = allocateReturnLines(value.lines, candidates, pending);
  if (!allocated.ok) return bad(allocated.message);

  // 🔵 사람 되짚기는 반출과 **같은 규칙**이다 — 못 찾아도 신청은 받는다(위 POST 2번 주석).
  const user = await findActiveUserByAuthSub(value.requester.sub);
  const created = await createRequest(buildApiReturnRequest(value, allocated.lines, todaySeoul()), { id: user?.id ?? null, name: user?.name ?? value.requester.name }, {
    source: "AS",
    externalKey: value.requestKey,
    requesterSub: value.requester.sub,
    /**
     * 🔵 **종류를 그대로 싣는다.** 반환은 결재를 타지 않으므로(`lib/approval/route.ts` 의
     *    `isApprovalExemptRequestType`) 이 값이 절차를 고르지는 않지만, 「어느 수리 건의 것이었나」는
     *    나중에 쓰이는 사실이고 반출 신청과 칸이 달라질 까닭이 없다.
     */
    workflowKind: value.workflowKind,
    // 🔴 **인수번호와 쪼갠 줄 수를 이력에 남긴다** — payload 를 안 펴고도 「무엇이 몇 줄로 들어갔나」를 볼 수 있게.
    audit: { requesterSub: value.requester.sub, requesterName: value.requester.name, matchedUser: user ? user.name : null, intakeNumber: value.intakeNumber, returnLines: allocated.lines.length },
  });
  return NextResponse.json(toApiStockRequest(created, value.requestKey, "RETURN"), { status: created.created ? 201 : 200, headers: NO_STORE });
}

/**
 * GET /api/v1/stock-requests?key=…  또는  ?intake=… — A/S 가 **신청이 지금 어떻게 됐는지 물어 간다**.
 * 설명은 API.md 4-7절, 규칙과 모양은 전부 `src/lib/api/stock-request-status.ts`(순수 함수).
 *
 * 🔴 **읽기 토큰이다**(`INVENTORY_API_TOKEN`). 바로 위 POST 와 **같은 주소인데 토큰이 다르다** — 가르는 것은
 *    주소가 아니라 **하는 일**이다. 읽기 토큰은 부품 목록을 가져가는 여러 시스템이 나눠 쓰는 값이라 재고를
 *    움직이는 신청을 만들 수 없어야 하고, 거꾸로 **읽기만 하는 이 통로에 쓰기 토큰을 요구할 까닭은 없다.**
 *    (쓰기 토큰으로 두드리면 401 이다 — 두 값이 다르기 때문이고, 그것을 시험이 지킨다.)
 * 🔵 **묻는 법이 둘이다** (2026-10-15 에 인수번호를 더했다. 열쇠로 묻는 길은 한 글자도 바뀌지 않았다):
 *   - `key` **A/S 쪽 요청 번호**(`requestKey`). 물어본 차례 그대로, 못 찾은 열쇠는 `notFound` 에.
 *   - `intake` **인수번호**. 🔴 그 수리 건의 반출 신청을 **누가 올렸든** 최근 것부터. A/S 는 제 요청 번호를
 *     저장하지 않아서(2026-10-15 사용자 결정) 열쇠로만 물을 수 있으면 되읽을 길이 사실상 없다.
 * 🔴 **둘을 함께 보내면 400** 이고, **둘 다 없어도 400** 이다(까닭은 `parseStatusQuery` 주석).
 *
 * 여기서 하는 일은 둘뿐이다: 묻는 법 가리기 · 그것으로 신청 되읽기.
 */
export async function GET(request: NextRequest) {
  const denied = checkApiToken(request);
  if (denied) return denied;

  const parsed = parseStatusQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return bad(parsed.message);
  const generatedAt = new Date().toISOString();

  if (parsed.query.mode === "intake") {
    // 🔵 열쇠가 없는 신청(재고 관리에서 직접 올린 것)도 함께 온다 — 차례와 `notFound` 는 순수 함수가 정한다.
    const rows = await listRequestsByIntakeNumbers(parsed.query.intakeNumbers);
    const locks = await issueLocksOf(rows.map((r) => r.request.id));
    // 🔴 「누가 반려했나」도 **묶음으로 한 번에** 읽는다 — 바로 위 잠금과 같은 까닭이다(머리말).
    const decisionActors = await readPartIssueRejectionActorsByRequest(rows.map((r) => r.request.id));
    return NextResponse.json(
      buildIntakeStatusResponse(
        rows.map((r) => ({
          requestKey: r.externalKey,
          request: { ...r.request, issueLock: locks.get(r.request.id) ?? null, decidedVia: decisionActors.get(r.request.id) ?? null },
        })),
        generatedAt,
      ),
      { headers: NO_STORE },
    );
  }

  const found = await listRequestsByExternalKeys(parsed.query.keys);
  const locks = await issueLocksOf(found.map((f) => f.request.id));
  // 🔴 「누가 반려했나」도 **묶음으로 한 번에** 읽는다 — 바로 위 잠금과 같은 까닭이다(머리말).
  const decisionActors = await readPartIssueRejectionActorsByRequest(found.map((f) => f.request.id));
  // 🔵 찾은 것을 열쇠로 묶어 순수 함수에 넘긴다 — 「물어본 차례 그대로」와 「못 찾은 열쇠」를 거기서 가린다.
  const byKey = new Map(
    found.map((f) => [f.externalKey, { ...f.request, issueLock: locks.get(f.request.id) ?? null, decidedVia: decisionActors.get(f.request.id) ?? null }]),
  );
  return NextResponse.json(buildStatusResponse(parsed.query.keys, byKey, generatedAt), { headers: NO_STORE });
}

/**
 * 신청 묶음에 달린 **살아 있는 결재건의 잠금** (2026-10-21, 조각 11f). 잠긴 신청만 들어 있다.
 *
 * 🔴 **재고 관리 화면이 쓰는 것과 같은 조회·같은 판정이다** — 묶음 조회는
 * `listOpenPartIssueStatusesByRequest`, 「승인 대기인가 · 실행 대기인가」는 `partIssueLockFor`
 * (`src/app/(app)/requests/page.tsx` 의 같은 자리). 비슷한 것을 여기 새로 적으면 **같은 신청을
 * 화면은 「실행 대기」, A/S 는 「결재 중」으로 부르는 날**이 온다.
 * 🔴 **줄마다 묻지 않는다.** 이 통로는 신청을 여러 건 한 번에 내주므로(열쇠 50개·인수번호 10개),
 * 줄마다 물으면 호출 한 번이 질의 수십 번이 된다. 빈 입력이면 조회가 DB 를 부르지도 않는다.
 * 🔵 **상태 글자만 달라진다.** A/S 가 단추를 가리는 데 쓰는 `code` 는 손대지 않는다
 * (`lib/api/stock-request-status.ts` 의 `status` 주석).
 */
async function issueLocksOf(requestIds: readonly string[]): Promise<Map<string, PartIssueLock>> {
  const open = await listOpenPartIssueStatusesByRequest(requestIds);
  const locks = new Map<string, PartIssueLock>();
  for (const [requestId, statuses] of open) {
    const lock = partIssueLockFor(statuses);
    if (lock !== null) locks.set(requestId, lock);
  }
  return locks;
}

function bad(message: string) {
  return NextResponse.json({ error: "bad_request", message }, { status: 400, headers: NO_STORE });
}
