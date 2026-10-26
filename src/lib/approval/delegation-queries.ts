import "server-only";
import { and, desc, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDelegations } from "@/db/schema/approval-delegations";
import type { Role } from "@/db/schema/users";
import { actingApproverSubs, delegateSubsFor, isActiveDelegation, type ActingApproverSubs } from "./delegation";
import { mayManageOthersDelegations } from "./delegation-authority";
import { seoulDateText, seoulEndDateText } from "./delegation-input";
import {
  canRevokeDelegation,
  delegationState,
  type AllDelegationRowView,
  type AllDelegationsView,
  type DelegationRowView,
} from "./delegation-screen";

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
   * 🔴 **내가 맡긴 줄인가.** 거짓이면 `canRevoke` 는 상태와 무관하게 거짓이다 — **대리인은 제가
   * 맡은 위임을 거둘 수 없고**(맡은 사람이 스스로 자격을 버리면 맡긴 사람이 모르는 사이에 그
   * 차례가 다시 선다), 참으로 실어 보내면 다음 사람이 그 칸을 보고 **눌러도 거절당하는 단추**를
   * 그린다.
   *
   * 🔵 2026-10-26 에 되돌리기가 **본인 또는 `ADMIN`** 으로 넓어졌지만 이 칸은 그대로다 —
   *    관리자인 대리인은 「모두의 결재권 위임」 묶음에서 **제 역할로** 거두고, 그쪽은 `canRevoke`
   *    를 따로 셈한다(`toAllRowView`). 여기서 역할을 보기 시작하면 「받은 것도 거둘 수 있다」가
   *    되어 위 울타리가 화면에서만 풀린다.
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

/* ------------------------------------------------------------------ */
/* 모두의 결재권 위임 — 관리 권한이 있는 사람만 (2026-10-26)              */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **끝난 줄을 몇 개까지 가져올까.** 살아 있는 줄에는 상한을 두지 않는다 — 그 집합은 「지금
 * 자리를 비운 사람 수」라 본질적으로 작고, 🔴 **상한에 밀려 되돌려야 할 줄이 안 보이는 것이 이
 * 묶음에서 가장 나쁜 일**이다(이 묶음을 더한 까닭 자체가 「관리자가 방금 세운 줄을 찾아 거둘
 * 길이 없다」였다). 상한이 필요한 쪽은 끝난 줄뿐이다 — 이 표는 줄을 지우지 않아(표 쪽 머리말)
 * 해가 갈수록 쌓이기만 한다.
 *
 * 🔵 50 에 깊은 뜻은 없다. 「한 화면에서 훑을 수 있는 양」이고(위 `DELEGATION_LIST_LIMIT` 과 같은
 * 자), 더 뒤까지 찾아야 하면 변경 이력이 영구 기록이다 — 맡길 때도 거둘 때도 한 줄씩 남는다.
 * 잘렸다는 사실은 화면이 말해 준다.
 */
const FINISHED_DELEGATION_LIMIT = 50;

/**
 * 🔴 **거절은 빈 목록이 아니라 `ok: false`** 다(아래 함수 머리말). 🔵 `view` 의 모양은 화면 쪽
 * 순수 모듈에 있다 — 화면이 받는 모양이고, 그 파일은 `server-only` 를 끌어오지 않는다.
 *
 * 🔵 `live` 집합은 되돌리기가 받아 주는 집합과 **정확히 같다**(`revoked_at IS NULL AND
 *    ends_at > now`). 그래서 그 목록의 모든 줄에 [되돌리기]가 붙고, 눌러도 거절당하는 줄이
 *    섞이지 않는다.
 */
export type AllDelegationsResult = { ok: true; view: AllDelegationsView } | { ok: false; reason: "FORBIDDEN" };

/** 한 줄이 필요로 하는 칸 — 두 조회가 **같은 모양**을 돌려주어야 화면이 같은 부품으로 그린다. */
const ALL_ROW_COLUMNS = {
  id: approvalDelegations.id,
  delegatorSub: approvalDelegations.delegatorSub,
  delegateSub: approvalDelegations.delegateSub,
  delegatorName: approvalDelegations.delegatorName,
  delegateName: approvalDelegations.delegateName,
  startsAt: approvalDelegations.startsAt,
  endsAt: approvalDelegations.endsAt,
  revokedAt: approvalDelegations.revokedAt,
  revokedByName: approvalDelegations.revokedByName,
  reason: approvalDelegations.reason,
  createdBySub: approvalDelegations.createdBySub,
  createdByName: approvalDelegations.createdByName,
} as const;

/**
 * 표 한 줄 → 모두의 목록 한 줄. 🔴 **번호 세 칸이 여기서 끝난다** — 화면이 받는 모양에는
 * 번호를 담을 칸이 없다(`./delegation-screen.ts` 머리말).
 *
 * 🔴 **「본인이 맡겼나」를 여기서 가른다.** `created_by_sub` 와 `delegator_sub` 를 맞대는 일이
 * 서버에서 끝나야 번호 두 개를 화면으로 내려보내지 않는다.
 */
function toAllRowView(
  row: {
    id: string;
    /** 🔵 판정 함수(`delegationState` → `isActiveDelegation`)가 **위임 한 줄 전체**를 받는다 — 번호 둘을 그대로 넘긴다(위 `toRowView` 와 같은 까닭). */
    delegatorSub: string;
    delegateSub: string;
    delegatorName: string;
    delegateName: string;
    startsAt: Date;
    endsAt: Date;
    revokedAt: Date | null;
    revokedByName: string | null;
    reason: string;
    createdBySub: string;
    createdByName: string;
  },
  now: Date,
): AllDelegationRowView {
  const state = delegationState(row, now);
  return {
    id: row.id,
    delegatorName: row.delegatorName,
    delegateName: row.delegateName,
    startDate: seoulDateText(row.startsAt),
    // 🔴 사람이 적었던 종료일로 되돌려 적는다 — `ends_at` 을 그대로 그리면 **하루 뒤**가 보인다.
    endDate: seoulEndDateText(row.endsAt),
    reason: row.reason,
    state,
    revokedByName: row.revokedByName,
    createdByName: row.createdByName,
    createdBySelf: row.createdBySub === row.delegatorSub,
    /**
     * 🔵 **보는 사람을 묻지 않는다.** 이 목록은 관리 권한이 있는 사람에게만 내려가고(아래
     *    거절), 그 사람은 아무 줄이나 거둘 수 있다 — 되돌리기 조건절이 그렇게 넓어졌다.
     */
    canRevoke: canRevokeDelegation(state),
  };
}

/**
 * **모든 사람의** 결재권 위임. 🔴 관리 권한이 있는 사람만 받을 수 있다.
 *
 * ── 🔴 이 묶음이 왜 있나 ───────────────────────────────────────────────
 * 관리자가 A→B 위임을 세워도 위 두 목록에는 **한 줄도 안 뜬다** — 둘 다 「내가 결재권자」 또는
 * 「내가 대리인」인 줄만 담는데 세운 사람은 둘 다 아니다. 그러면 방금 만든 것이 안 나타나
 * **저장이 안 된 것처럼 보이고**, 되돌릴 권한이 있는데도 그 줄을 집을 길이 없다. A/S 에서
 * 실제로 겪은 일이라 넓히는 날 함께 만든다.
 *
 * ── 🔴 인가를 **이 함수가** 본다. 화면·페이지에 맡기지 않는다 ───────────
 * 이 파일의 다른 조회들과 달리 여기만 제 손으로 묻는다. 돌려주는 것이 **남의 줄**이라서다 —
 * 화면이 가리는 데 그치면 이 함수를 부르는 **새 자리**(다음에 생길 통로·스크립트)가 생기는
 * 날 조용히 다 새어 나간다.
 *
 * 🔴 **거절은 빈 목록이 아니라 `ok: false`** 다. 빈 목록으로 돌려주면 「권한이 없다」와 「아직
 * 아무도 안 맡겼다」가 **같은 값**이 되고, 화면은 둘을 구별해 말할 수 없다. 거절한 값에는
 * `view` 칸 자체가 없어서, 부르는 쪽이 `ok` 를 안 보고 꺼내려 하면 `tsc` 가 멈춘다.
 *
 * ── 왜 두 질의인가, 그리고 왜 겹치지 않는가 ─────────────────────────────
 * 상한이 필요한 쪽이 한쪽뿐이라 한 질의로는 표현되지 않는다(위 상수 주석). 두 질의의 조건은
 * **서로 정확한 여집합**이고, 🔴 **「지금」을 한 번 만들어 둘 다에 같은 값으로 넘긴다** — 각자
 * `now()` 를 쓰면 두 질의 사이에 끝난 줄이 양쪽에서 빠지거나 양쪽에 들어간다.
 *
 * 🔴 **이 조회에도 색인이 없다.** 표의 색인은 받는 쪽(`delegate_sub`)으로 깔려 있다. 이 조회는
 * 설정 탭을 **관리자가** 열 때만 돌고 표 전체가 아직 두 자릿수라 그대로 둔다 — 늘어나면 색인을
 * 더해야 하고, 그것은 스키마 변경이라 이 조각의 일이 아니다.
 */
export async function listAllDelegations(actorRole: Role, now: Date = new Date()): Promise<AllDelegationsResult> {
  if (!mayManageOthersDelegations(actorRole)) return { ok: false, reason: "FORBIDDEN" };

  const isLive = and(isNull(approvalDelegations.revokedAt), gt(approvalDelegations.endsAt, now));
  // 위의 **정확한 여집합**: 되돌렸거나(기간과 무관하다) 기간이 끝났거나.
  const isFinished = or(isNotNull(approvalDelegations.revokedAt), lte(approvalDelegations.endsAt, now));

  const [live, finishedPage] = await Promise.all([
    db().select(ALL_ROW_COLUMNS).from(approvalDelegations).where(isLive).orderBy(desc(approvalDelegations.startsAt)),
    db()
      .select(ALL_ROW_COLUMNS)
      .from(approvalDelegations)
      .where(isFinished)
      .orderBy(desc(approvalDelegations.startsAt))
      // 🔵 한 건 더 받아 「더 있다」를 센다. 따로 세면 그 사이에 줄이 늘어 「더 있다는데 다
      //    보인다」가 될 수 있고, 질의가 하나 더 는다.
      .limit(FINISHED_DELEGATION_LIMIT + 1),
  ]);

  const finishedTruncated = finishedPage.length > FINISHED_DELEGATION_LIMIT;
  return {
    ok: true,
    view: {
      live: live.map((row) => toAllRowView(row, now)),
      finished: (finishedTruncated ? finishedPage.slice(0, FINISHED_DELEGATION_LIMIT) : finishedPage).map((row) => toAllRowView(row, now)),
      finishedTruncated,
      finishedLimit: FINISHED_DELEGATION_LIMIT,
    },
  };
}
