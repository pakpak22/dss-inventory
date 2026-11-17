import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDelegations } from "@/db/schema/approval-delegations";
// 🔴 **둘째 고지**다(2026-11-16, 설계 B-12). 승인함에서 맡긴 위임을 포털이 써 주는 표이고,
//    여기서는 **읽기만** 한다 — 쓰는 자리는 `./portal-delegation-store.ts` 하나다.
import { portalApprovalDelegations } from "@/db/schema/portal-approval-delegations";
// 🔵 **이름을 붙이려고** 끌어온다(2026-11-17, 조각 3c). 포털 표에는 이름 칸이 없고
//    이 집은 `users.auth_sub` 가 곧 포털 번호라 바로 맞댈 수 있다.
import { users, type Role } from "@/db/schema/users";
import { actingApproverSubs, activeDelegateSubs, isActiveDelegation, type ActingApproverSubs } from "./delegation";
import { mayManageOthersDelegations } from "./delegation-authority";
// 🔵 **역할 위임**(2026-11-17, 설계 B-10). 본인을 빼는 규칙만 가져온다 — 「임시 관리자인가」를
//    가르는 판정 자체는 그 순수 모듈이 쥐고, 여기서는 **읽어다 넘기기**만 한다.
import { delegatorSubsOf } from "./delegated-role";
import { seoulDateText, seoulEndDateText } from "./delegation-input";
// 🔵 **몸통 모양과 상한**은 순수 모듈이 쥔다(2026-11-17, 조각 9a). 이 파일은 `server-only` 을
//    물고 있어 시험이 못 불러오는데, 저쪽은 안 물어서 그대로 돌려 볼 수 있다.
import { DELEGATION_AUDIT_LIMIT, type DelegationAuditRow } from "./portal-delegation-list";
import {
  canRevokeDelegation,
  delegationState,
  // 🔵 **접는 셈은 순수 모듈이 쥔다**(2026-11-17) — 이 파일은 `server-only` 을 물고 있어 시험이
  //    불러올 수 없다. 저쪽에 두어야 「넘쳤다고 말하는가」를 돌려 볼 수 있다.
  foldDelegationList,
  type AllDelegationRowView,
  type AllDelegationsView,
  // 🔵 **접기를 가진 묶음이 받는 모양**(2026-11-17). 화면 쪽 순수 모듈이 쥔다 — 저쪽은
  //    `server-only` 을 안 물어서 시험이 그대로 불러 볼 수 있다.
  type DelegationFoldView,
  type DelegationRowView,
  type PortalDelegationRowView,
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
 *
 * ── 🔴 2026-11-16 저녁: 읽을 표가 **둘**이 됐다 (설계 B-12) ──────────────
 * 그 전에는 둘째 고지(승인함에 맡긴 위임)를 **결재 길목에서 포털에 물어** 받았다(B-3). 뒤집힌
 * 뒤로는 포털이 지정·철회할 때 **써 주고**, 우리는 `portal_approval_delegations` 를 읽는다.
 * 🟢 그래서 **결재 길목에 망 호출이 하나도 없다** — 이 파일의 함수가 결재 트랜잭션 **안에서**
 * 도는데도 안심인 까닭이고, 「포털이 멎으면 대리인만 조용히 막힌다」(옛 B-6)는 상태 자체가
 * 없어졌다. 🔵 두 표는 색인 모양도 조건절도 같다 — 아래 질의들이 짝지어 글자까지 닮은 것이 그
 * 때문이다(판정 둘 · 알림 둘 · 화면 둘).
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
 *   🟢 **이제 두 표 모두 그 울타리 안에 있다**(2026-11-16 저녁, 설계 B-12). 승인함 위임을 포털에
 *   **묻던** 동안에는 그 값만 거래 밖에서 미리 받아 온 것이라 「되돌려진 직후 몇 밀리초」가
 *   열려 있었는데, 제 표를 읽게 되면서 그 틈이 사라졌다.
 * @param now 🔴 **판정과 기록이 같은 순간이어야 한다.** 결재 쪽은 단계 줄의 `decided_at` 에
 *   적는 그 시각을 그대로 넘긴다. 둘이 갈리면 기간이 끝나는 즈음의 결재가 유효했는지를
 *   나중에 설명할 수 없다. 🔵 두 질의와 순수 판정이 **같은 한 값**을 본다.
 */
export async function actingApproverSubsFor(actorSub: string, conn: Conn = db(), now: Date = new Date()): Promise<ActingApproverSubs> {
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

  /**
   * 🔴 **둘째 고지 — 승인함에서 맡긴 위임**(2026-11-16, 설계 B-12). 조건절이 위와 **글자까지
   *    같은 모양**이고, 색인(`portal_approval_delegations_delegate_idx`)도 같은 차례로 깔려 있다
   *    — 두 표를 같은 함수가 같은 조건으로 읽기 때문이다(표 쪽 주석).
   * 🔴 **나란히(`Promise.all`) 세우지 않는다.** 이 함수는 결재 트랜잭션 **안에서도** 불리는데
   *    (아래 `conn`), 한 거래는 연결 하나를 잡고 있어 같은 연결에 두 질의를 겹쳐 밀어 넣는 꼴이
   *    된다. 둘 다 색인을 타는 가벼운 질의라 차례로 해도 싸고, 🟢 **애초에 여기 있던 2초짜리 망
   *    호출이 통째로 사라진 자리**라 왕복 하나가 느는 것은 셈에 들지도 않는다.
   */
  const portalRows = await conn
    .select({
      delegatorSub: portalApprovalDelegations.delegatorSub,
      delegateSub: portalApprovalDelegations.delegateSub,
      startsAt: portalApprovalDelegations.startsAt,
      endsAt: portalApprovalDelegations.endsAt,
      revokedAt: portalApprovalDelegations.revokedAt,
    })
    .from(portalApprovalDelegations)
    .where(
      and(
        eq(portalApprovalDelegations.delegateSub, actorSub),
        isNull(portalApprovalDelegations.revokedAt),
        gt(portalApprovalDelegations.endsAt, now),
      ),
    );

  // 🔵 `delegate_sub` 로 이미 좁혔지만 그 조건을 순수 함수에 **다시 맡긴다** — 걸러 내는 일을
  //    부르는 쪽에 떠넘기지 않는 것이 그 함수의 약속이고, 여기서 빼면 그 약속에 기대는 다른
  //    부르는 쪽이 생겼을 때 조용히 갈린다. `starts_at` 도 거기서 걸린다(머리말).
  // 🔴 **합치는 자리도 그 함수 하나다**(2026-11-16). 두 묶음을 여기서 이어 붙이면 합치는 규칙이
  //    두 벌이 되고, 두 겹(A→B·B→C)을 막는 자리도 함께 둘이 된다.
  return actingApproverSubs(rows, actorSub, now, portalRows);
}

/**
 * 「지금 이 사람이 **대신하는 사람들의 역할**」 — 역할 위임(2026-11-17, 설계 B-10)이 묻는 단
 * 하나의 질문이다. 그 가운데 `ADMIN` 이 있으면 이 사람은 **기간 동안 임시 `ADMIN`** 이고,
 * 그 판정은 순수 모듈(`./delegated-role.ts` 의 `decideDelegatedRole`)이 한다.
 *
 * ── 🔴 판정을 **새로 짓지 않는다** ─────────────────────────────────────
 * 기간(반열린 구간) · 되돌림 · 두 고지 합치기 · 두 겹 막기는 **바로 위 함수가 이미** 한다.
 * 이 함수가 제 손으로 하는 일은 둘뿐이다: 그 목록에서 **본인을 빼고**(순수 함수), 남은 번호의
 * **역할을 읽어 온다.** 🔴 거르는 조건을 여기 한 줄이라도 적으면 반열린 구간 규칙이 한 벌 더
 * 생기고, 「결재는 되는데 역할은 안 넘어오는」(또는 그 반대의) 짝이 조용히 생긴다.
 *
 * ── 🔴 `users.role` 을 **바꿔 쓰지 않는다** (설계 D-7 ④) ────────────────
 * 역할 칸은 **읽기만** 한다. 이 집은 역할을 매 요청마다 다시 읽으므로 여기서 계산하면 기간이
 * 끝날 때 **저절로** 닫힌다 — 칸에 적어 두는 길로 가면 여는 조건과 닫는 조건이 다른 곳에
 * 생기고, 화면에서 내릴 수 없는 권한이 남는다.
 *
 * ── 🔴 **지워진 사람은 역할을 넘기지 않는다** ───────────────────────────
 * 세션(`findActiveUserById`)과 포털 통로(`findActiveUserByAuthSub`)가 지워진 사람을 「못 찾은
 * 것」으로 치는 것과 **같은 줄**이다. 한쪽만 느슨하면 **그만둔 사람의 계정이 임시 관리자를 계속
 * 찍어 낸다** — 그 사람은 로그인도 못 하므로 아무도 알아채지 못한다.
 *
 * 🔵 **이 집에 로그인한 적 없는 위임자는 역할이 없다.** 결재선·위임은 A/S 명부에서 고르므로
 *    `users` 에 줄이 없는 사람도 결재권자가 될 수 있고(`./directory.ts` 머리말), 그 위임은
 *    **결재권만** 넘긴다. 아래 질의가 그런 번호를 그냥 못 찾을 뿐이라 따로 다룰 것이 없다.
 * 🔵 **질의는 많아야 셋**이다(두 고지 + 역할 한 번). 대신하는 사람이 없으면 셋째는 안 돈다.
 *    🔴 **진짜 `ADMIN` 에게는 아예 부르지 않는다** — 더 얻을 것이 없어서이고, 거르는 자리는
 *    부르는 쪽(`src/lib/auth/session.ts`) 한 곳이다.
 *
 * @param actorSub 「지금 그 사람」의 포털 번호(세션의 `sub` · `users.auth_sub`).
 * @param now 🔴 **한 번 만들어 둘 다에 같은 값**을 넘긴다 — 위임 판정과 역할 읽기가 같은 순간을
 *   봐야 기간이 끝나는 즈음의 요청을 나중에 설명할 수 있다.
 */
export async function activeDelegatorRolesFor(actorSub: string, now: Date = new Date()): Promise<Role[]> {
  /**
   * 🔴 **트랜잭션 밖이다.** 부르는 자리가 세션을 읽는 길 하나뿐이고(화면·액션이 시작하기
   *    전이다), 그래서 위 함수에 이 집의 연결을 그대로 넘긴다 — 결재 길목이 제 거래를 넘기는
   *    것과 다른 점이 여기 하나다.
   * 🔴 **본인 번호를 빼는 일은 순수 함수에 맡긴다**(`delegatorSubsOf`). 맨 앞이 본인이라는
   *    약속에 기대 `slice(1)` 로 적으면 차례가 바뀌는 날 엉뚱한 사람의 역할을 물려받는다.
   */
  const delegatorSubs = delegatorSubsOf(await actingApproverSubsFor(actorSub, db(), now), actorSub);
  // 🔵 대신하는 사람이 없으면 읽을 역할도 없다. `inArray(…, [])` 를 피하는 뜻도 있다 — drizzle 은
  //    그것을 `false` 로 구워 조용히 0행을 돌려준다(`actingApproverSubs` 머리말의 같은 함정).
  if (delegatorSubs.length === 0) return [];

  const rows = await db()
    .select({ role: users.role })
    .from(users)
    .where(and(inArray(users.authSub, delegatorSubs), eq(users.isDeleted, false)));
  // 🔵 누구의 역할인지는 버린다 — 묻는 것이 「그 가운데 `ADMIN` 이 있나」 하나라서다. 사람과
  //    역할을 짝지어 들고 가면 그 짝을 화면에 그리고 싶어지고, 그러면 번호가 따라 내려간다.
  return rows.map((row) => row.role);
}

/**
 * 위 `actingApproverSubsFor` 를 **거꾸로** — 이 결재권자의 자리를 지금 대신 누를 수 있는
 * 사람들의 포털 번호 (2026-10-24, 결재 생김 알림).
 *
 * 🔴 **알림에만 쓴다.** 「누를 수 있나」를 가르는 자리는 지금도 앞으로도 위
 * `actingApproverSubsFor` 하나다 — 까닭은 `./delegation.ts` 의 `delegateSubsFor` 머리말.
 * 거르는 규칙(되돌림·반열린 구간)은 그 순수 함수가 **위 둘과 똑같이** 쥔다.
 *
 * 🔴 **이 조회에는 색인이 없다.** 두 표 모두 색인은 받는 쪽(`delegate_sub`)으로 깔려 있다
 * (`listDelegationsIMade` 와 같은 사정). 🔵 그래도 여기 두는 까닭: 이 조회는 **결재가 한 건
 * 생길 때 한 번**만 돈다 — 모든 화면에 딸려 오는 알림 종의 길이 아니다. 한 사람이 맡기는 줄은
 * 몇 줄이고 표 전체도 아직 두 자릿수다. 늘어나면 `(delegator_sub, …)` 색인을 더해야 하고,
 * 그것은 스키마 변경이라 이 조각의 일이 아니다.
 *
 * 🔴 **`starts_at` 은 WHERE 에 넣지 않는다** — 위 둘과 같은 까닭이고(색인에 없다), 아직
 * 시작하지 않은 줄은 순수 함수가 거른다. 여기 조건을 손으로 적으면 반열린 구간이 세 벌이 된다.
 *
 * ── 🟢 **승인함 위임도 2026-11-17 에 여기 붙었다** (설계 D-8 ①) ──────────
 * 표가 이 집에 들어온 2026-11-16 저녁(설계 B-12)부터 판정(위 `actingApproverSubsFor`)은 두 표를
 * 봤는데 **이 방향만 제 표 하나를 읽고 있었다.** 그래서 승인함에서 맡은 대리인에게는 「결재가
 * 생겼다」 **즉시 알림(메일)만** 안 갔다 — 종·결재 화면·[승인] 단추는 판정이 두 표를 합치게
 * 되면서 이미 멀쩡했고, 포털의 주기 작업도 평소처럼 주웠다.
 * 🔴 **그래서 증상이 「메일이 한 바퀴 늦게 온다」 하나뿐이라 아무도 신고하지 않는 모양이었다.**
 * 위임이 없애려던 기다림이 바로 그 한 바퀴다.
 *
 * 🔴 **거르는 규칙을 한 줄도 새로 적지 않았다.** 아래 두 질의의 조건절은 위
 * `actingApproverSubsFor` 가 거는 셋과 **글자까지 같고**(안 거둔 줄 · 아직 안 끝난 줄), 다른
 * 것은 찾는 칸 하나(`delegate_sub` ↔ `delegator_sub`)뿐이다. 합치고 겹침을 걷는 일도 순수 함수
 * `activeDelegateSubs` **한 자리**에서 하고, 그 안에서 두 묶음을 같은 `delegateSubsFor` 로
 * 거른다 — 정방향이 `actingApproverSubs` 한 자리에서 합치는 것과 같은 모양이다.
 * 🔴 **`revoked_at` 은 읽는 쪽에서 「깃발이 섰으면 빠진다」만 본다** — 한 방향 규칙(B-15)은
 *    쓰는 쪽(`./portal-delegation-sync.ts`)의 일이고, 두 표가 여기서 똑같이 다뤄진다.
 */
export async function activeDelegateSubsFor(delegatorSub: string, now: Date = new Date()): Promise<string[]> {
  /**
   * 🔴 **나란히 세우는 것이 짝 함수와 다른 유일한 점이다.** 위 `actingApproverSubsFor` 가 두
   *    질의를 차례로 미는 까닭은 그 함수가 **결재 트랜잭션 안에서도** 불리기 때문이다(`conn`) —
   *    한 거래는 연결 하나를 잡고 있어 겹쳐 밀어 넣는 꼴이 된다. 이 함수는 `conn` 을 받지
   *    않는다: 부르는 자리가 **커밋이 끝난 뒤의 알림**(`src/lib/notifications/approval-created-ping.ts`)
   *    하나뿐이라 언제나 트랜잭션 밖이고, 그래서 아래 `listAllDelegations` 처럼 함께 읽는다.
   * 🔴 **이 함수가 `conn` 을 받게 되는 날 이 자리를 차례로 되돌려야 한다.**
   * 🔵 「지금」은 **한 번 만들어 둘 다에 같은 값**을 넘긴다(`now` 매개변수) — 질의마다 제각기
   *    재면 두 질의 사이에 끝난 줄이 한쪽에서만 빠진다.
   */
  const [rows, portalRows] = await Promise.all([
    db()
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
      ),
    db()
      .select({
        delegatorSub: portalApprovalDelegations.delegatorSub,
        delegateSub: portalApprovalDelegations.delegateSub,
        startsAt: portalApprovalDelegations.startsAt,
        endsAt: portalApprovalDelegations.endsAt,
        revokedAt: portalApprovalDelegations.revokedAt,
      })
      .from(portalApprovalDelegations)
      .where(
        and(
          eq(portalApprovalDelegations.delegatorSub, delegatorSub),
          isNull(portalApprovalDelegations.revokedAt),
          gt(portalApprovalDelegations.endsAt, now),
        ),
      ),
  ]);

  // 🔵 `delegator_sub` 로 이미 좁혔지만 그 조건을 순수 함수에 **다시 맡긴다**(위와 같은 약속).
  // 🔴 **합치는 자리도 그 함수 하나다** — 여기서 이어 붙이면 겹침을 걷는 규칙이 두 벌이 되고,
  //    두 겹(A→B·B→C)을 막는 자리도 함께 둘이 된다(`actingApproverSubsFor` 와 같은 까닭).
  return activeDelegateSubs(rows, delegatorSub, now, portalRows);
}

/* ------------------------------------------------------------------ */
/* 화면에 보여 줄 줄들 (2026-10-21, 조각 3)                              */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **끝난 줄을 몇 개까지 가져올까.** 화면의 다섯 묶음이 **이 하나를 함께 쓴다**(네 사람 묶음 +
 * 「모두의 결재권 위임」).
 *
 * ── 🔴 2026-11-17: 상한의 **뜻이 바뀌었다** ────────────────────────────
 * 그전에는 `DELEGATION_LIST_LIMIT` 이 **목록 전체**에 걸려 있었다. 「내가 맡긴 것」은 살아 있는
 * 줄과 끝난 줄이 한 목록에 섞여 있었고, 51번째 줄부터는 **말없이 잘렸다** — 끝난 줄이 쌓여
 * 상한을 채우면 **되돌려야 할 줄이 화면에서 사라지는** 모양이었다. 이제 상한은 **접히는 쪽에만**
 * 걸고, 펴 두는 쪽(살아 있는 줄)에는 걸지 않는다. 끝난 줄이 쌓여도 살아 있는 줄을 밀어내지
 * 못하고, 접힌 쪽이 잘리면 화면이 그 사실을 말해 준다.
 *
 * 🔵 50 에 깊은 뜻은 없다 — 「한 화면에서 훑을 수 있는 양」이다. 더 뒤까지 찾아야 하면 이 집 줄은
 * 변경 이력이, 승인함에서 온 줄은 승인함이 영구 기록이다.
 * 🔴 **묶음마다 다른 수를 쓰지 않는다.** 한 화면에 나란히 선 묶음들이 저마다 다른 N 으로
 * 「최근 N건」이라고 말하면 사람은 그것을 결함으로 읽는다(A/S 의 같은 자리 주석).
 */
const FINISHED_DELEGATION_LIMIT = 50;

/**
 * 🔵 **접는 셈은 여기 없다** — 순수 모듈의 `foldDelegationList` 가 쥔다. 이 파일은 `server-only`
 *    을 물고 있어 시험이 불러올 수 없고, 이 집에는 DB 시험도 없다. 셈을 여기 두면 「넘쳤다고
 *    말하는가」를 **아무도 돌려 보지 못한 채** 운영으로 나간다. 아래 넷은 **읽어 와서 넘기기만**
 *    한다 — 상한도 함께 넘긴다.
 */

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
 * **내가 맡긴 것** — 되돌린 줄과 끝난 줄까지 **전부** 보여 준다. 🔵 2026-11-17 부터 한 목록이
 * 아니라 **둘**이다: 살아 있는 줄은 펴 두고, 끝난 줄은 접힌 쪽으로 보낸다.
 *
 * 🔴 지난 줄을 감추지 않는 까닭: 위임은 「이 기간에 그 건을 누가 대신 눌렀나」를 나중에 설명하기
 * 위한 기록이다(표 쪽 머리말). 살아 있는 것만 보이면 「분명 맡겼는데 흔적이 없다」가 된다.
 *
 * ── 🔴 2026-11-17: **조용히 자르던 것**을 멈췄다 ────────────────────────
 * 그전에는 한 질의가 섞인 목록을 50줄까지 읽고 **아무 말 없이** 잘랐다. 끝난 줄이 쌓여 상한을
 * 채우면 **되돌려야 할 살아 있는 줄이 화면에서 사라지는데**, 오류는 한 줄도 안 난다. 이제 상한은
 * 접히는 쪽에만 걸리고, 잘렸으면 화면이 그 사실을 말해 준다(`finishedTruncated`).
 *
 * 🔴 **두 질의의 조건은 서로 정확한 여집합**이고 🔴 **「지금」을 한 번 만들어 둘 다에 같은 값**으로
 * 넘긴다 — 각자 `now()` 를 쓰면 두 질의 사이에 끝난 줄이 양쪽에서 빠지거나 양쪽에 들어간다
 * (`listAllDelegations` 와 같은 모양·같은 까닭).
 *
 * 🔴 **이 조회에는 색인이 없다.** 표의 색인은 받는 쪽(`delegate_sub`)으로 깔려 있다(그쪽이 모든
 * 화면에 딸려 오는 알림 종의 길이라서다). 이 조회는 `/settings/delegations` 를 열 때 한 번뿐이고 한 사람이
 * 맡기는 줄이 몇 줄이라 지금은 그대로 둔다 — 늘어나면 `(delegator_sub, starts_at)` 색인을 더해야
 * 하고, 그것은 스키마 변경이라 이 조각의 일이 아니다. 🔵 질의가 둘이 돼도 같은 판단이다.
 */
export async function listDelegationsIMade(delegatorSub: string, now: Date = new Date()): Promise<DelegationFoldView<DelegationRowView>> {
  /**
   * 🔵 **칸 묶음을 모듈 꼭대기로 빼지 않았다**(2026-11-17 실측). 이 파일의 함수 사이에 둔 `const`
   *    는 **바로 위 함수의 본문으로 읽힌다** — 시험이 소스를 「다음 `export` 까지」로 잘라 보기
   *    때문이고(이 집에는 구워진 SQL 을 보는 길이 없다), 알림 쪽 시험은 그 안에서 `startsAt` 이
   *    **몇 번 나오나**로 「SQL 에서도 거르는가」를 잰다. 빼 두면 그 셈이 2가 되어 멀쩡한 조회가
   *    빨개진다. 🔴 두 목록의 칸은 **「상대방」 한 칸만 다르다** — 한쪽에 칸을 더하면 여기도 함께.
   */
  const columns = {
    id: approvalDelegations.id,
    /** 🔵 판정 함수(`delegationState` → `isActiveDelegation`)가 **위임 한 줄 전체**를 받는다(위 `toRowView` 주석). */
    delegatorSub: approvalDelegations.delegatorSub,
    delegateSub: approvalDelegations.delegateSub,
    // 맡긴 목록에서 보이는 상대방은 **대신할 사람**이다.
    counterpartName: approvalDelegations.delegateName,
    startsAt: approvalDelegations.startsAt,
    endsAt: approvalDelegations.endsAt,
    revokedAt: approvalDelegations.revokedAt,
    revokedByName: approvalDelegations.revokedByName,
    reason: approvalDelegations.reason,
  };
  const mine = eq(approvalDelegations.delegatorSub, delegatorSub);
  const isLive = and(isNull(approvalDelegations.revokedAt), gt(approvalDelegations.endsAt, now));
  // 위의 **정확한 여집합**: 되돌렸거나(기간과 무관하다) 기간이 끝났거나.
  const isFinished = or(isNotNull(approvalDelegations.revokedAt), lte(approvalDelegations.endsAt, now));

  const [live, finishedPage] = await Promise.all([
    // 최근에 시작하는 것이 위로. 🔵 차례에 뜻을 더 붙이지 않는다 — 상태는 배지가 말한다.
    db().select(columns).from(approvalDelegations).where(and(mine, isLive)).orderBy(desc(approvalDelegations.startsAt)),
    db()
      .select(columns)
      .from(approvalDelegations)
      .where(and(mine, isFinished))
      .orderBy(desc(approvalDelegations.startsAt))
      // 🔵 한 줄 더 받아 「더 있다」를 센다(`foldDelegationList` 머리말).
      .limit(FINISHED_DELEGATION_LIMIT + 1),
  ]);

  return foldDelegationList(live, finishedPage, FINISHED_DELEGATION_LIMIT, (row) => toRowView(row, now, true));
}

/**
 * **내가 대신하고 있는 것**(읽기 전용).
 *
 * 🔴 **이것이 없으면 대리인은 「왜 이 건이 내 결재 목록에 떴는지」를 알 수 없다.** 결재건 카드에는
 * 결재선의 **원래 사람** 이름이 적혀 있어, 자기 이름이 없는 건이 자기 목록에 뜬다 — 까닭이 적힌
 * 곳이 이 묶음뿐이다.
 *
 * ── 🔴 2026-11-17: **끝난 줄을 처음으로 가져온다** ──────────────────────
 * 그전에는 질의가 살아 있는 줄만 읽어서, 기간이 지나면 그 줄을 **다시 볼 길이 아예 없었다** —
 * 「모두의 결재권 위임」은 제 표만 읽고(승인함 줄은 거기 없다), 변경 이력은 맡긴 사람 쪽 이야기다.
 * 대리인에게는 「내가 그때 누른 까닭」을 보여 줄 자리가 한 군데도 없었다.
 *
 * 🔵 **펴 두는 쪽의 뜻은 안 바뀌었다** — 여전히 「지금 대신하는 중」뿐이다(아래 순수 함수 거르기).
 * 🔵 살아 있는 쪽 조건절은 위 `actingApproverSubsFor` 와 **같은 모양**이다(색인 차례도 같다).
 *    그쪽은 번호만, 이쪽은 사람이 읽을 이름과 기간까지 읽는다 — 결재 판정에 이름을 끌어들이지
 *    않으려고 나눠 둔다.
 */
export async function listDelegationsIActFor(delegateSub: string, now: Date = new Date()): Promise<DelegationFoldView<DelegationRowView>> {
  /** 🔵 위 `listDelegationsIMade` 와 **「상대방」 한 칸만 다르다**(그 자리에 왜 공용 상수가 아닌지 적어 두었다). */
  const columns = {
    id: approvalDelegations.id,
    delegatorSub: approvalDelegations.delegatorSub,
    delegateSub: approvalDelegations.delegateSub,
    // 대신하는 목록에서 보이는 상대방은 **결재권자**다.
    counterpartName: approvalDelegations.delegatorName,
    startsAt: approvalDelegations.startsAt,
    endsAt: approvalDelegations.endsAt,
    revokedAt: approvalDelegations.revokedAt,
    revokedByName: approvalDelegations.revokedByName,
    reason: approvalDelegations.reason,
  };
  const mine = eq(approvalDelegations.delegateSub, delegateSub);
  const isLive = and(isNull(approvalDelegations.revokedAt), gt(approvalDelegations.endsAt, now));
  // 위의 **정확한 여집합**: 되돌렸거나 기간이 끝났거나. 🔴 접히는 쪽이 받는 것이 바로 이 줄들이다.
  const isFinished = or(isNotNull(approvalDelegations.revokedAt), lte(approvalDelegations.endsAt, now));

  const [liveRows, finishedPage] = await Promise.all([
    db().select(columns).from(approvalDelegations).where(and(mine, isLive)).orderBy(desc(approvalDelegations.startsAt)),
    db()
      .select(columns)
      .from(approvalDelegations)
      .where(and(mine, isFinished))
      .orderBy(desc(approvalDelegations.startsAt))
      .limit(FINISHED_DELEGATION_LIMIT + 1),
  ]);

  /**
   * 🔴 **아직 시작하지 않은 줄은 여기서 뺀다.** 위 WHERE 는 색인에 맞춰 `starts_at` 을 보지
   *    않으므로(그쪽 주석), 미리 적어 둔 위임이 섞여 들어온다. 「지금 대신하고 있는 것」이라고
   *    적어 놓고 아직 시작도 안 한 줄을 보이면, 대리인은 **지금 누를 수 있다고 믿는다.**
   * 🔵 거르는 자는 결재 판정이 쓰는 그 함수다 — 여기 조건을 손으로 적으면 반열린 구간이 두 벌이 된다.
   * 🔴 **접히는 쪽에는 이 거르개를 걸지 않는다.** 저쪽은 이미 「끝났거나 되돌렸다」로 좁혀 둔
   *    여집합이라, 여기서 또 거르면 **접기 안이 언제나 비어** 이 조각이 고치려던 일이 안 된다.
   */
  // 🔵 맡긴 사람이 아니므로 `canRevoke` 는 거짓이다 — 되돌리기는 맡긴 사람만 할 수 있다(toRowView 주석).
  const live = liveRows.filter((row) => isActiveDelegation(row, now));
  return foldDelegationList(live, finishedPage, FINISHED_DELEGATION_LIMIT, (row) => toRowView(row, now, false));
}

/* ------------------------------------------------------------------ */
/* 통합 승인함에서 맡긴 위임 — 읽기만 (2026-11-17, 조각 3c)               */
/* ------------------------------------------------------------------ */

/**
 * ── 🔴 왜 이 두 조회가 생겼나 ───────────────────────────────────────────
 * 전파는 2026-11-16 부터 제대로 돌고 있었다 — 승인함에서 맡긴 줄이 이 집 표에 **살아서**
 * 들어오고, 판정(`actingApproverSubsFor`)도 그 줄을 본다. 그런데 **위임 화면이 제 표만
 * 그리고 있었다**: 맡긴 사람이 재고관리를 열면 「맡긴 위임이 없습니다」가 떴다. 설계 D-2 가
 * 「각 화면에서 **어디에 지정된 위임인가**를 구별해 보여 줄 것」이라고 못 박은 바로 그 자리다.
 *
 * ── 🔴 **수를 세는 함수를 이 둘로 바꿨다**(2026-11-17) ──────────────────
 * 그 전에는 `countPortalDelegationsIActFor` 가 「저쪽에도 N건」만 세어 올렸다. 줄을 그리게
 * 되면서 **같은 집합을 두 번 세게 되는데**, 두 벌이 되면 한쪽만 고치는 날 「N건이라면서 줄은
 * 그보다 적게 보이는」 화면이 된다 — 오류는 한 번도 안 난다. 수는 이제 **그린 줄을 세어**
 * 쓴다(`acting.length`). 🔵 그래서 **셈이 한 칸 달라질 수 있다**: 옛 함수는 사람 수(같은
 * 결재권자가 두 줄이면 1)였고 지금은 줄 수다. 같은 화면의 다른 묶음들이 전부 **건수**라
 * 그쪽에 맞췄다.
 *
 * ── 🔴 이름은 **이 집 `users` 에서 붙인다** ─────────────────────────────
 * 포털 표에는 이름 칸이 없다(세 시스템 공통 모양 — 표 쪽 머리말). 이 집은 `users.auth_sub` 가
 * 곧 포털 번호라 `LEFT JOIN` 한 번이면 된다. 🔵 유일 색인(`users_auth_sub_uq`)이 있어 줄이
 * 불어나지 않는다.
 * 🔴 **`is_deleted` 를 보지 않는 것은 일부러다.** 판정에 쓰는 `findActiveUserByAuthSub` 와
 *    **다르다** — 저쪽은 「이 사람이 지금 자격이 있나」이고 여기는 **표시**다. 지워진 계정의
 *    이름이라도 보이는 쪽이, 「이름을 알 수 없는 분」보다 지난 위임을 설명한다.
 * 🔴 **못 찾아도 줄을 빼지 않는다** — 빼면 이 조각이 고치려던 「맡겼는데 여기엔 없다」가 그대로
 *    돌아온다. 그릴 글자는 `portalDelegationCounterpartLabel` 이 정한다.
 *
 * ── 🔴 색인이 한쪽에만 있다 ─────────────────────────────────────────────
 * 표의 색인은 받는 쪽(`delegate_sub`)으로 깔려 있어 **「내가 맡긴 것」에는 없다** — 제 표 위임의
 * `listDelegationsIMade` 와 똑같은 사정이고 같은 판단을 한다(설정 탭을 열 때 한 번, 한 사람이
 * 맡기는 줄은 몇 줄). 늘어나면 `(delegator_sub, …)` 색인을 더해야 하고 그것은 스키마 변경이다.
 */
const PORTAL_ROW_COLUMNS = {
  id: portalApprovalDelegations.id,
  /** 🔵 판정 함수(`delegationState` → `isActiveDelegation`)가 **위임 한 줄 전체**를 받는다(위 `toRowView` 와 같은 까닭). */
  delegatorSub: portalApprovalDelegations.delegatorSub,
  delegateSub: portalApprovalDelegations.delegateSub,
  startsAt: portalApprovalDelegations.startsAt,
  endsAt: portalApprovalDelegations.endsAt,
  revokedAt: portalApprovalDelegations.revokedAt,
  reason: portalApprovalDelegations.reason,
} as const;

/**
 * 표 한 줄 → 승인함 줄 한 줄. 🔴 **번호 두 칸이 여기서 끝난다**(위 `toRowView` 와 같은 규약).
 *
 * 🔴 **`canRevoke` 를 싣지 않는다 — 실을 칸이 없다.** 돌려주는 타입에 그 칸이 아예 없어서
 * (`./delegation-screen.ts` 의 `PortalDelegationRowView`), 「거짓을 실어야 한다」를 약속으로
 * 지키지 않는다. 이 줄을 거두는 곳은 승인함뿐이고 이 집에는 되돌리는 통로 자체가 없다.
 */
function toPortalRowView(
  row: {
    id: string;
    delegatorSub: string;
    delegateSub: string;
    counterpartName: string | null;
    startsAt: Date;
    endsAt: Date;
    revokedAt: Date | null;
    reason: string;
  },
  now: Date,
): PortalDelegationRowView {
  return {
    id: row.id,
    counterpartName: row.counterpartName,
    startDate: seoulDateText(row.startsAt),
    // 🔴 사람이 보는 마지막 날로 되돌려 적는다 — `ends_at` 을 그대로 그리면 **하루 뒤**가 보인다.
    endDate: seoulEndDateText(row.endsAt),
    reason: row.reason,
    // 🔴 상태도 **제 표 위임과 같은 자**로 잰다(`delegationState` → `isActiveDelegation`).
    //    여기 조건을 손으로 적으면 반열린 구간 규칙이 한 벌 더 생긴다.
    state: delegationState(row, now),
  };
}

/**
 * **승인함에서 내가 맡긴 것** — 되돌린 줄과 끝난 줄까지 **전부**.
 *
 * 🔵 제 표 쪽 `listDelegationsIMade` 와 **같은 규칙·같은 차례**다(지난 줄을 감추지 않는 까닭도
 *    그쪽 머리말 그대로다: 「분명 맡겼는데 흔적이 없다」가 되지 않게).
 */
export async function listPortalDelegationsIMade(
  delegatorSub: string,
  now: Date = new Date(),
): Promise<DelegationFoldView<PortalDelegationRowView>> {
  const mine = eq(portalApprovalDelegations.delegatorSub, delegatorSub);
  const isLive = and(isNull(portalApprovalDelegations.revokedAt), gt(portalApprovalDelegations.endsAt, now));
  // 위의 **정확한 여집합**: 거뒀거나(기간과 무관하다) 기간이 끝났거나.
  const isFinished = or(isNotNull(portalApprovalDelegations.revokedAt), lte(portalApprovalDelegations.endsAt, now));

  const [live, finishedPage] = await Promise.all([
    db()
      .select({ ...PORTAL_ROW_COLUMNS, counterpartName: users.name })
      .from(portalApprovalDelegations)
      // 맡긴 목록에서 보이는 상대방은 **대신할 사람**이다.
      .leftJoin(users, eq(users.authSub, portalApprovalDelegations.delegateSub))
      .where(and(mine, isLive))
      .orderBy(desc(portalApprovalDelegations.startsAt)),
    db()
      .select({ ...PORTAL_ROW_COLUMNS, counterpartName: users.name })
      .from(portalApprovalDelegations)
      .leftJoin(users, eq(users.authSub, portalApprovalDelegations.delegateSub))
      .where(and(mine, isFinished))
      .orderBy(desc(portalApprovalDelegations.startsAt))
      .limit(FINISHED_DELEGATION_LIMIT + 1),
  ]);

  return foldDelegationList(live, finishedPage, FINISHED_DELEGATION_LIMIT, (row) => toPortalRowView(row, now));
}

/**
 * **승인함에서 맡아 지금 내가 대신하고 있는 것**.
 *
 * 🔵 조건절도 뒤의 거르기도 제 표 쪽 `listDelegationsIActFor` 와 **글자까지 같은 모양**이다 —
 *    색인 차례(`portal_approval_delegations_delegate_idx`)도 같다.
 * 🔴 **아직 시작하지 않은 줄은 여기서 뺀다**(그쪽과 같은 까닭): WHERE 가 색인에 맞춰
 *    `starts_at` 을 안 보므로 미리 적어 둔 위임이 섞여 들어오고, 「지금 대신하고 있는 것」이라
 *    적어 놓고 그 줄을 보이면 대리인은 **지금 누를 수 있다고 믿는다.**
 */
export async function listPortalDelegationsIActFor(
  delegateSub: string,
  now: Date = new Date(),
): Promise<DelegationFoldView<PortalDelegationRowView>> {
  const mine = eq(portalApprovalDelegations.delegateSub, delegateSub);
  const isLive = and(isNull(portalApprovalDelegations.revokedAt), gt(portalApprovalDelegations.endsAt, now));
  // 위의 **정확한 여집합**: 거뒀거나 기간이 끝났거나. 🔴 접히는 쪽이 받는 것이 바로 이 줄들이다.
  const isFinished = or(isNotNull(portalApprovalDelegations.revokedAt), lte(portalApprovalDelegations.endsAt, now));

  const [liveRows, finishedPage] = await Promise.all([
    db()
      .select({ ...PORTAL_ROW_COLUMNS, counterpartName: users.name })
      .from(portalApprovalDelegations)
      // 대신하는 목록에서 보이는 상대방은 **결재권자**다.
      .leftJoin(users, eq(users.authSub, portalApprovalDelegations.delegatorSub))
      .where(and(mine, isLive))
      .orderBy(desc(portalApprovalDelegations.startsAt)),
    db()
      .select({ ...PORTAL_ROW_COLUMNS, counterpartName: users.name })
      .from(portalApprovalDelegations)
      .leftJoin(users, eq(users.authSub, portalApprovalDelegations.delegatorSub))
      .where(and(mine, isFinished))
      .orderBy(desc(portalApprovalDelegations.startsAt))
      .limit(FINISHED_DELEGATION_LIMIT + 1),
  ]);

  // 🔴 **접히는 쪽에는 이 거르개를 걸지 않는다** — 저쪽은 이미 「끝났거나 거뒀다」로 좁혀 둔
  //    여집합이라, 여기서 또 거르면 접기 안이 언제나 빈다(제 표 쪽과 같은 자리).
  const live = liveRows.filter((row) => isActiveDelegation(row, now));
  return foldDelegationList(live, finishedPage, FINISHED_DELEGATION_LIMIT, (row) => toPortalRowView(row, now));
}

/* ------------------------------------------------------------------ */
/* 모두의 결재권 위임 — 관리 권한이 있는 사람만 (2026-10-26)              */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **끝난 줄의 상한은 위에 있다**(`FINISHED_DELEGATION_LIMIT`). 2026-10-26 에는 이 묶음만
 * 쓰던 값이라 여기 있었는데, 2026-11-17 에 사람 묶음 넷이 같은 접기를 갖게 되면서 **한 자리로
 * 모았다** — 한 화면에 나란히 선 묶음들이 저마다 다른 N 으로 「최근 N건」이라고 말하면 안 된다.
 *
 * 🔴 **살아 있는 줄에는 상한을 두지 않는다**(아래 질의에 `.limit(` 이 없는 까닭). 그 집합은
 * 「지금 자리를 비운 사람 수」라 본질적으로 작고, **상한에 밀려 되돌려야 할 줄이 안 보이는 것이
 * 이 묶음에서 가장 나쁜 일**이다 — 이 묶음을 더한 까닭 자체가 「관리자가 방금 세운 줄을 찾아
 * 거둘 길이 없다」였다. 상한이 필요한 쪽은 끝난 줄뿐이다(표가 줄을 지우지 않아 쌓이기만 한다).
 */

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

/* ------------------------------------------------------------------ */
/* 🔴 포털의 어긋남 점검이 읽는다 — **거르개가 없는** 자리 (조각 9a)      */
/* ------------------------------------------------------------------ */

/**
 * 「이 집이 지금 가진 승인함 위임 전부」. 🔴 **`where` 가 한 줄도 없는 것이 이 조회의 전부다.**
 * 살아 있는 것·끝난 것·**거둔 것**을 다 준다 — 포털과 맞대어 볼 때 「포털은 거뒀는데 집에서는
 * 살아 있는」 줄이 가장 위험한 어긋남인데(설계 B-13), 거른 목록으로는 그 줄이 **양쪽에서
 * 똑같이 안 보인다.**
 * 🔴 그래서 **위의 화면용 조회 넷 가운데 어느 것도 빌려 쓸 수 없다** — 둘은 사람으로 좁히고,
 *    `listAllDelegations` 는 아예 **제 표**(`approval_delegations`)를 읽는다.
 *
 * 🔴 **사람 칸을 안 고른다.** 고른 뒤에 안 싣는 것이 아니라 아예 안 읽는다 — 몸통을 짓는
 * 자리(`./portal-delegation-list.ts` 의 `buildDelegationListReply`)와 **두 겹**으로 막아 둔
 * 것은, 한 겹만 있으면 다음 사람이 「조회는 다 읽어 두고 고를 때 가리자」로 쉽게 무너뜨리기
 * 때문이다. 🔵 이 집은 `auth_sub` 가 곧 포털 번호라 이름을 붙이기가 가장 쉬워서 더 그렇다.
 *
 * 🔴 **차례를 못 박는다**(번호 오름차순). 상한에 걸려 잘릴 때 **어느 줄이 잘리는가**가 호출마다
 * 달라지면, 점검이 돌 때마다 다른 줄을 「집에 없다」로 읽는다.
 *
 * 🔴 **상한보다 한 줄 더 읽는다**(`limit + 1`). 그 한 줄이 「넘쳤다」를 가리는 유일한 길이고,
 * 딱 상한만큼 읽으면 **정확히 상한만큼 있는 날**과 **넘친 날**이 같은 답이 된다. 세어서
 * 잘라내는 것은 몸통을 짓는 쪽이다 — 🔴 **그러니 이 함수가 돌려주는 줄 수를 그대로 내보내면
 * 안 된다.** 🔵 바로 위 `listAllDelegations` 가 화면 목록에 쓰는 셈법과 같다.
 *
 * 🔵 **질의를 만들기만 하는 함수를 따로 둔 까닭.** 이 파일은 `server-only` 를 물고 있어 시험이
 * 불러올 수 없고, 이 집에는 구워진 SQL 을 보는 방식도 없다(`.toSQL()` 을 쓰는 자리가 저장소에
 * 하나도 없다 — 2026-11-17 실측). 그래서 울타리는 **소스 글자**로 친다
 * (`tests/portal-delegation-list.test.ts`) — 함수를 작게 떼어 두면 그 시험이 **이 본문만**
 * 잘라서 「거르개가 끼었나」를 볼 수 있다.
 */
export function delegationsForAuditQuery(limit: number = DELEGATION_AUDIT_LIMIT) {
  return db()
    .select({
      id: portalApprovalDelegations.id,
      startsAt: portalApprovalDelegations.startsAt,
      endsAt: portalApprovalDelegations.endsAt,
      revokedAt: portalApprovalDelegations.revokedAt,
    })
    .from(portalApprovalDelegations)
    .orderBy(asc(portalApprovalDelegations.id))
    .limit(limit + 1);
}

/**
 * 🔴 **읽기 갈래의 입구.** 부르는 곳은 `app/api/integration/delegations/route.ts` 하나다.
 *
 * 🔴 **던지는 것을 삼키지 않는다** — 못 읽은 것을 빈 목록으로 답하면 점검이 그것을 「이 집에
 * 위임이 하나도 없다」로 읽고, **DB 가 앓는 날 모든 위임이 어긋난 것으로 보고된다.** 통로가
 * 「지금은 안 된다」로 답한다(그쪽 머리말).
 */
export async function loadDelegationsForAudit(limit: number = DELEGATION_AUDIT_LIMIT): Promise<DelegationAuditRow[]> {
  return delegationsForAuditQuery(limit);
}
