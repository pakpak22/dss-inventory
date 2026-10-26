import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { stockRequests } from "@/db/schema/stock-requests";
import { users } from "@/db/schema/users";
import { requesterSubsToSkip, type RequesterSubs } from "./route";

/**
 * ============================================================================
 * 🔴 「이 건에서 건너뛸 사람은 누구누구인가」 — 서버가 읽는 **한 자리** (2026-10-26)
 * ============================================================================
 * 결재선 단계의 승인자가 **신청한 사람 본인**이면 그 단계를 건너뛴다. 그 「신청한 사람」이 둘이고
 * (원래 신청을 올린 사람 · [불출 신청] 단추를 눌러 결재를 올린 사람), 둘이 누구인지는 순수 함수
 * 한 곳에 적혀 있다(`./route.ts` 의 `requesterSubsToSkip` 머리말 — 이 조각이 생긴 까닭도 거기).
 * 이 파일이 하는 일은 그중 **첫째를 표에서 읽어 오는 것** 하나뿐이다.
 *
 * ── 🔴 왜 함수 하나로 묶었나 ────────────────────────────────────────────
 * 같은 질문을 세 자리가 한다. `./request-scope.ts`(「이 신청은 어느 절차를 타는가」)와 **같은
 * 모양의 자리**다:
 *  · 결재를 **올리는** 자리 — `./part-issue.ts` 의 `requestPartIssueApproval`
 *  · 사슬을 **잇는** 자리 — 같은 파일의 `decidePartIssueApproval`
 *  · 진행 그림을 **그리는** 자리 — `./part-issue-screen-data.ts`(묶음으로 읽는다, 아래)
 *
 * 🔴 **앞 둘이 다른 목록을 보면 결재선이 중간에 달라진다.** 올릴 때는 1단계가 없어졌는데 2단계
 * 승인 뒤에 그 1단계가 되살아나거나(번호가 작아 다시 후보가 되지는 않지만, 뒤쪽 단계에서 같은
 * 일이 일어난다), 올릴 때 남겨 둔 단계가 사슬에서 사라진다. 🔴 셋째가 갈리면 **화면만** 거짓말을
 * 한다 — 아무도 누르지 않을 칸이 「결재 대기」로 남아 있는 것처럼 보이고, 오류는 나지 않는다.
 *
 * ── 🔴 「원 신청자」를 읽는 규칙 — COALESCE 두 칸 ───────────────────────
 * `stock_requests` 는 신청자를 **두 칸**에 나눠 들고 있다(그 표 머리말):
 *  · `requester_sub` — A/S 에서 올라온 신청에 실려 온 **포털 번호.** 이 시스템에 계정이 없는
 *    사람도 신청할 수 있어서, 그런 신청을 나중에 되짚을 **유일한 열쇠**다.
 *  · `requested_by` — 이 시스템의 `users.id`(**빌 수 있다**). 재고 관리 화면에서 직접 올린
 *    신청은 이쪽만 있고 `requester_sub` 는 비어 있다.
 * 🔵 둘 다 있으면 **같은 사람이다** — A/S 통로가 받은 포털 번호로 사람을 찾아 id 를 채우기
 *    때문이다(`src/app/api/v1/stock-requests/route.ts` 의 `findActiveUserByAuthSub`). 그래서
 *    앞 칸을 먼저 보고, 없으면 `users` 로 되짚는다.
 *
 * ── 🔴 모르면 **건너뛰지 않는다** ───────────────────────────────────────
 * 신청 줄이 없거나(없는 신청), 두 칸이 다 비었거나, `requested_by` 가 가리키는 사람이 이 시스템
 * `users` 에 없으면 `null` 이다. 그 사람 몫만 목록에서 빠지고 **나머지는 그대로 돈다** — 근거
 * 없이 단계를 지우면 아무도 결재하지 않은 칸이 조용히 사라진다(`isRouteStepSkippedForRequester`).
 * 🔵 여기서 던지거나 가려내지 않는 까닭은 `./request-scope.ts` 와 같다: 부르는 자리가 바로 뒤에서
 *    제 트랜잭션 안에 그 신청을 다시 읽고 「없는 신청입니다」라고 **더 정확히** 말한다.
 * ============================================================================
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
/** 트랜잭션 안에서도 밖에서도 읽을 수 있게 — `./delegation-queries.ts` 와 같은 관례다. */
type Conn = ReturnType<typeof db> | Tx;

/**
 * 신청 묶음 → 그 신청을 **원래 올린 사람의 포털 번호.** 못 구한 신청은 **키가 아예 없다**
 * (`null` 을 담지 않는다 — 「모른다」와 「안 물어봤다」를 가를 까닭이 없고, 받는 쪽은 둘 다
 * `?? null` 로 떨어뜨린다).
 *
 * 🔵 **묶음으로 읽는 길을 안쪽에 둔 까닭**: 진행 그림은 줄마다 묻지 않아야 한다(신청이 20건이면
 * 질의가 20번이 된다). 한 건짜리(`requesterSubsToSkipFor`)도 이것을 부르므로 위 COALESCE 규칙이
 * 두 벌이 되지 않는다.
 * 🔴 **`users` 를 `is_deleted` 로 거르지 않는다.** 여기서 구하는 것은 「그 사람이 지금 쓸 수 있는
 * 계정인가」가 아니라 **「그 사람이 누구인가」**다. 계정을 끈 사람이 신청해 둔 건이라도 그 사람의
 * 단계는 똑같이 건너뛰어야 한다 — 거르면 **꺼진 계정의 신청에서만** 건너뛰기가 조용히 달라진다.
 */
export async function originalRequesterSubsByRequest(
  requestIds: readonly string[],
  conn: Conn = db(),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return out;

  const rows = await conn
    .select({
      id: stockRequests.id,
      requesterSub: stockRequests.requesterSub,
      // 🔵 `leftJoin` 이다 — `requested_by` 는 빌 수 있고(A/S 신청자는 계정이 없을 수 있다),
      //    가리키는 사람이 사라졌을 수도 있다. 그때는 이 칸이 `null` 로 온다.
      requestedBySub: users.authSub,
    })
    .from(stockRequests)
    .leftJoin(users, eq(users.id, stockRequests.requestedBy))
    .where(inArray(stockRequests.id, ids));

  for (const row of rows) {
    // 🔴 COALESCE 의 차례가 곧 머리말의 규칙이다 — 실려 온 포털 번호가 먼저, 없으면 `users` 로 되짚는다.
    const sub = row.requesterSub ?? row.requestedBySub;
    if (sub !== null) out.set(row.id, sub);
  }
  return out;
}

/**
 * 결재건 한 건에서 **건너뛸 사람들**의 포털 번호. 🔴 **올리는 자리와 사슬 잇는 자리가 이 함수
 * 하나를 부른다**(머리말).
 *
 * @param requestId 그 결재건이 붙어 있는 반출 신청(`stock_requests.id`).
 * @param raisedBySub [불출 신청] 단추를 눌러 **결재를 올린 사람**의 포털 번호. 🔴 올리는 자리는
 *   세션의 `sub` 를 그대로 넘기고, 사슬 잇는 자리는 결재건에 적힌 `requested_by`(이 시스템의
 *   `users.id`)를 포털 번호로 되짚어 넘긴다 — **그 둘은 같은 사람의 같은 값**이다(로그인할 때
 *   `users.auth_sub` 에 적히는 그 번호). 모르면 `null` 이고, 그러면 그 사람 몫만 빠진다.
 * @param conn 🔴 **쓰기와 같은 트랜잭션을 넘겨라.** 사슬을 잇는 자리는 결재건 행을 `FOR UPDATE`
 *   로 잡아 둔 뒤에 이것을 읽는다 — 밖에서 읽으면 그 사이에 신청 쪽 칸이 달라질 수 있다.
 *   🔵 기본값이 `db()` 라 **안 넘겨도 오류가 나지 않는다**(`./delegation-queries.ts` 의 같은 주의).
 */
export async function requesterSubsToSkipFor(
  requestId: string,
  raisedBySub: string | null,
  conn: Conn = db(),
): Promise<RequesterSubs> {
  const subs = await originalRequesterSubsByRequest([requestId], conn);
  // 🔴 묶는 일은 순수 함수가 한다 — 「건너뛸 사람은 둘」이 적힌 자리는 거기 하나다.
  return requesterSubsToSkip(raisedBySub, subs.get(requestId) ?? null);
}
