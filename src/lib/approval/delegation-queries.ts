import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDelegations } from "@/db/schema/approval-delegations";
import { actingApproverSubs, delegateSubsFor, isActiveDelegation, type ActingApproverSubs } from "./delegation";
import { seoulDateText, seoulEndDateText } from "./delegation-input";
import { canRevokeDelegation, delegationState, type DelegationRowView } from "./delegation-screen";

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

/**
 * 바로 위를 **거꾸로** — 이 결재권자의 자리를 지금 대신 누를 수 있는 사람들의 포털 번호
 * (2026-10-24, 결재 생김 알림).
 *
 * 🔴 **알림에만 쓴다.** 「누를 수 있나」를 가르는 자리는 지금도 앞으로도 위
 * `actingApproverSubsFor` 하나다 — 까닭은 `./delegation.ts` 의 `delegateSubsFor` 머리말.
 * 거르는 규칙(되돌림·반열린 구간)은 그 순수 함수가 **위 둘과 똑같이** 쥔다.
 *
 * 🔴 **이 조회에는 색인이 없다.** 표의 색인은 받는 쪽(`delegate_sub`)으로 깔려 있다
 * (`listDelegationsIMade` 와 같은 사정). 🔵 그래도 여기 두는 까닭: 이 조회는 **결재가 한 건
 * 생길 때 한 번**만 돈다 — 모든 화면에 딸려 오는 알림 종의 길이 아니다. 한 사람이 맡기는 줄은
 * 몇 줄이고 표 전체도 아직 두 자릿수다. 늘어나면 `(delegator_sub, …)` 색인을 더해야 하고,
 * 그것은 스키마 변경이라 이 조각의 일이 아니다.
 *
 * 🔴 **`starts_at` 은 WHERE 에 넣지 않는다** — 위 둘과 같은 까닭이고(색인에 없다), 아직
 * 시작하지 않은 줄은 순수 함수가 거른다. 여기 조건을 손으로 적으면 반열린 구간이 세 벌이 된다.
 */
export async function activeDelegateSubsFor(delegatorSub: string, now: Date = new Date()): Promise<string[]> {
  const rows = await db()
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
        eq(approvalDelegations.delegatorSub, delegatorSub),
        isNull(approvalDelegations.revokedAt),
        gt(approvalDelegations.endsAt, now),
      ),
    );

  // 🔵 `delegator_sub` 로 이미 좁혔지만 그 조건을 순수 함수에 **다시 맡긴다**(위와 같은 약속).
  return delegateSubsFor(rows, delegatorSub, now);
}

/* ------------------------------------------------------------------ */
/* 화면에 보여 줄 줄들 (2026-10-21, 조각 3)                              */
/* ------------------------------------------------------------------ */

/**
 * 「내가 맡긴 것」 한 번에 읽을 줄 수의 상한.
 *
 * 🔴 **이 표는 지워지지 않는다**(되돌리기도 깃발이다 — 표 쪽 머리말). 해가 지나면 끝난 줄이
 * 쌓이고, 상한이 없으면 화면이 수백 줄을 그린다. 🔵 사람이 보는 것은 사실상 맨 위 몇 줄이다.
 */
const DELEGATION_LIST_LIMIT = 50;

/**
 * 표 한 줄에서 화면 줄로. 🔴 **번호 두 칸(`…_sub`)이 여기서 끝난다** — 화면이 받는 모양에는
 * 번호를 담을 칸이 없다(`./delegation-screen.ts` 머리말).
 *
 * 🔵 그래서 부르는 쪽이 번호 둘을 **그대로** 넘긴다. 판정 함수(`delegationState` → 그 안의
 *    `isActiveDelegation`)가 받는 모양이 위임 한 줄 전체이고, 빈 글자 같은 가짜 값을 끼워 맞춰
 *    넘기면 **빈 글자가 열쇠로 쓰이는 길**이 한 줄 생긴다 — 다음 사람이 그것을 따라 한다.
 */
function toRowView(
  row: {
    id: string;
    delegatorSub: string;
    delegateSub: string;
    counterpartName: string;
    startsAt: Date;
    endsAt: Date;
    revokedAt: Date | null;
    revokedByName: string | null;
    reason: string;
  },
  now: Date,
  /**
   * 🔴 **내가 맡긴 줄인가.** 거짓이면 `canRevoke` 는 상태와 무관하게 거짓이다 — **되돌리기는
   * 맡긴 사람만** 할 수 있고(조건절의 `delegator_sub = 내 번호`), 받은 사람에게 참으로 실어
   * 보내면 다음 사람이 그 칸을 보고 **눌러도 거절당하는 단추**를 그린다.
   */
  mine: boolean,
): DelegationRowView {
  const state = delegationState(row, now);
  return {
    id: row.id,
    counterpartName: row.counterpartName,
    startDate: seoulDateText(row.startsAt),
    // 🔴 사람이 적었던 종료일로 되돌려 적는다 — `ends_at` 을 그대로 그리면 **하루 뒤**가 보인다.
    endDate: seoulEndDateText(row.endsAt),
    reason: row.reason,
    state,
    revokedByName: row.revokedByName,
    canRevoke: mine && canRevokeDelegation(state),
  };
}

/**
 * **내가 맡긴 것** — 되돌린 줄과 끝난 줄까지 **전부** 보여 준다.
 *
 * 🔴 지난 줄을 감추지 않는 까닭: 위임은 「이 기간에 그 건을 누가 대신 눌렀나」를 나중에 설명하기
 * 위한 기록이다(표 쪽 머리말). 살아 있는 것만 보이면 「분명 맡겼는데 흔적이 없다」가 된다.
 *
 * 🔴 **이 조회에는 색인이 없다.** 표의 색인은 받는 쪽(`delegate_sub`)으로 깔려 있다(그쪽이 모든
 * 화면에 딸려 오는 알림 종의 길이라서다). 이 조회는 `/settings/delegations` 를 열 때 한 번뿐이고 한 사람이
 * 맡기는 줄이 몇 줄이라 지금은 그대로 둔다 — 늘어나면 `(delegator_sub, starts_at)` 색인을 더해야
 * 하고, 그것은 스키마 변경이라 이 조각의 일이 아니다.
 */
export async function listDelegationsIMade(delegatorSub: string, now: Date = new Date()): Promise<DelegationRowView[]> {
  const rows = await db()
    .select({
      id: approvalDelegations.id,
      delegatorSub: approvalDelegations.delegatorSub,
      delegateSub: approvalDelegations.delegateSub,
      counterpartName: approvalDelegations.delegateName,
      startsAt: approvalDelegations.startsAt,
      endsAt: approvalDelegations.endsAt,
      revokedAt: approvalDelegations.revokedAt,
      revokedByName: approvalDelegations.revokedByName,
      reason: approvalDelegations.reason,
    })
    .from(approvalDelegations)
    .where(eq(approvalDelegations.delegatorSub, delegatorSub))
    // 최근에 시작하는 것이 위로. 🔵 차례에 뜻을 더 붙이지 않는다 — 상태는 배지가 말한다.
    .orderBy(desc(approvalDelegations.startsAt))
    .limit(DELEGATION_LIST_LIMIT);

  return rows.map((row) => toRowView(row, now, true));
}

/**
 * **내가 지금 대신하고 있는 것**(읽기 전용).
 *
 * 🔴 **이것이 없으면 대리인은 「왜 이 건이 내 결재 목록에 떴는지」를 알 수 없다.** 결재건 카드에는
 * 결재선의 **원래 사람** 이름이 적혀 있어, 자기 이름이 없는 건이 자기 목록에 뜬다 — 까닭이 적힌
 * 곳이 이 묶음뿐이다.
 *
 * 🔵 조건절은 위 `actingApproverSubsFor` 와 **같은 모양**이다(색인 차례도 같다). 그쪽은 번호만,
 *    이쪽은 사람이 읽을 이름과 기간까지 읽는다 — 결재 판정에 이름을 끌어들이지 않으려고 나눠 둔다.
 */
export async function listDelegationsIActFor(delegateSub: string, now: Date = new Date()): Promise<DelegationRowView[]> {
  const rows = await db()
    .select({
      id: approvalDelegations.id,
      delegatorSub: approvalDelegations.delegatorSub,
      delegateSub: approvalDelegations.delegateSub,
      counterpartName: approvalDelegations.delegatorName,
      startsAt: approvalDelegations.startsAt,
      endsAt: approvalDelegations.endsAt,
      revokedAt: approvalDelegations.revokedAt,
      revokedByName: approvalDelegations.revokedByName,
      reason: approvalDelegations.reason,
    })
    .from(approvalDelegations)
    .where(
      and(
        eq(approvalDelegations.delegateSub, delegateSub),
        isNull(approvalDelegations.revokedAt),
        gt(approvalDelegations.endsAt, now),
      ),
    )
    .orderBy(desc(approvalDelegations.startsAt))
    .limit(DELEGATION_LIST_LIMIT);

  /**
   * 🔴 **아직 시작하지 않은 줄은 여기서 뺀다.** 위 WHERE 는 색인에 맞춰 `starts_at` 을 보지
   *    않으므로(그쪽 주석), 미리 적어 둔 위임이 섞여 들어온다. 「지금 대신하고 있는 것」이라고
   *    적어 놓고 아직 시작도 안 한 줄을 보이면, 대리인은 **지금 누를 수 있다고 믿는다.**
   * 🔵 거르는 자는 결재 판정이 쓰는 그 함수다 — 여기 조건을 손으로 적으면 반열린 구간이 두 벌이 된다.
   */
  // 🔵 맡긴 사람이 아니므로 `canRevoke` 는 거짓이다 — 되돌리기는 맡긴 사람만 할 수 있다(toRowView 주석).
  return rows.filter((row) => isActiveDelegation(row, now)).map((row) => toRowView(row, now, false));
}
