import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDelegations } from "@/db/schema/approval-delegations";
import { actingApproverSubs, type ActingApproverSubs } from "./delegation";

/**
 * ============================================================================
 * 결재권 위임 — 읽기
 * ============================================================================
 * 판정은 `./delegation.ts` 가 순수 함수로 쥐고 있다. 이 파일은 **그 함수가 볼 줄만 골라
 * 온다** — 순수 규칙(`./route.ts`)과 읽기(`./queries.ts`)를 가른 자리와 같은 짝이다.
 *
 * ── 🔴 표를 통째로 읽어 JS 에서 거르지 않는다 ───────────────────────────
 * 위임 표에는 지난 기간의 줄이 **지워지지 않고 쌓인다**(되돌리기도 지우기가 아니라 깃발이다 —
 * 표 쪽 머리말). 그래서 해가 바뀌면 통째 읽기는 점점 느려지고, 느려지는 자리가 하필 **모든
 * 화면에 딸려 오는 알림 종**이다. 조각 1이 그 조회를 위해 색인을 깔아 두었다 —
 * `approval_delegations_delegate_idx (delegate_sub, revoked_at, ends_at)`. 아래 WHERE 의 칸
 * 차례가 그 색인의 차례다.
 *
 * 🔵 `starts_at` 은 **여기서 거르지 않는다.** 색인에 없기 때문이고(까닭은 표 쪽 주석), 앞의
 * 셋으로 좁히고 나면 남는 줄이 몇 줄이라 그 자리에서 순수 함수가 걸러도 된다. 끝을 포함하지
 * 않는 반열린 구간 판정도 거기 한 곳에만 있어야 한다(`isActiveDelegation`).
 * ============================================================================
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
/** 트랜잭션 안에서도 밖에서도 읽을 수 있게 — `src/lib/excel/workbook-sync.ts` 와 같은 관례다. */
type Conn = ReturnType<typeof db> | Tx;

/**
 * 「지금 이 사람의 자격으로 누를 수 있는 결재자 번호」 전부 — 본인 + 지금 대신할 수 있는
 * 결재권자들. **네 자리가 이 값을 받는다**(까닭은 `./delegation.ts` 의 `actingApproverSubs`).
 *
 * @param actorSub 누르려는 사람의 **포털 번호**(세션의 `sub` · `users.auth_sub`).
 * @param conn 🔴 **쓰기와 같은 트랜잭션을 넘겨라.** 결재를 집는 자리(`decidePartIssueApproval`)
 *   에서 이것을 밖에서 읽으면, 읽은 뒤 집기 전 사이에 위임이 끝나거나 되돌려질 수 있고 그때
 *   「권한이 없는데 통과한」 결재가 한 건 남는다. 기본값이 `db()` 라 **안 넘겨도 오류가 나지
 *   않는다** — 그래서 여기 적어 둔다.
 * @param now 🔴 **판정과 기록이 같은 순간이어야 한다.** 결재 쪽은 단계 줄의 `decided_at` 에
 *   적는 그 시각을 그대로 넘긴다. 둘이 갈리면 기간이 끝나는 즈음의 결재가 유효했는지를
 *   나중에 설명할 수 없다.
 */
export async function actingApproverSubsFor(
  actorSub: string,
  conn: Conn = db(),
  now: Date = new Date(),
): Promise<ActingApproverSubs> {
  const rows = await conn
    .select({
      delegatorSub: approvalDelegations.delegatorSub,
      delegateSub: approvalDelegations.delegateSub,
      startsAt: approvalDelegations.startsAt,
      endsAt: approvalDelegations.endsAt,
      revokedAt: approvalDelegations.revokedAt,
    })
    .from(approvalDelegations)
    .where(
      and(
        eq(approvalDelegations.delegateSub, actorSub),
        isNull(approvalDelegations.revokedAt),
        gt(approvalDelegations.endsAt, now),
      ),
    );

  // 🔵 `delegate_sub` 로 이미 좁혔지만 그 조건을 순수 함수에 **다시 맡긴다** — 걸러 내는 일을
  //    부르는 쪽에 떠넘기지 않는 것이 그 함수의 약속이고, 여기서 빼면 그 약속에 기대는 다른
  //    부르는 쪽이 생겼을 때 조용히 갈린다.
  return actingApproverSubs(rows, actorSub, now);
}
