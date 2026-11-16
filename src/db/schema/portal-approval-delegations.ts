import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * ============================================================================
 * 승인함에서 **받아 적는** 결재권 위임 — 포털이 써 주는 자리 (2026-11-16, 조각 6)
 * ============================================================================
 * 통합 승인함(`dss-approvals`)에서 맡긴 위임을 **포털(dss-auth)이 각 시스템에 전파**하고,
 * 각 시스템은 **제 표만 읽는다.** 그 받는 자리가 이 표다. 들어오는 길은
 * `src/app/api/integration/delegations/route.ts` 하나뿐이다.
 *
 * ── ⓓ 🔴 2026-11-16 저녁에 **방식이 뒤집혔다**(설계 B-12) ────────────────
 * 그 전(2026-11-13, B-3)에는 **결재할 때마다 포털에 물었다**(`./approval/portal-acting-subs.ts`).
 * 뒤집은 까닭은 셋이다 — 결재 길목에서 **망 호출이 사라지고**, 포털이 멈춰도 결재가 멀쩡하고,
 * 종·메뉴·배지에 공짜로 붙는다. 대신 **전파가 한 곳이라도 실패하면 포털이 지정 자체를
 * 거절한다**(B-13). 설계 전문은 `dss-approvals/DELEGATION_DESIGN.md` 다.
 * 🔵 **「묻는 쪽」은 아직 그대로 살아 있다** — 걷어내는 것은 다음 조각의 일이고, 지금 걷으면
 *    이 표가 비어 있는 동안 포털 위임이 통째로 안 듣는다.
 *
 * ── ⓒ 🔴 `approval_delegations` 와 **다른 표다. 둘 다 산다**(설계 B-4) ────
 * 저쪽은 **이 시스템 안에서** 맡긴 위임이고 이쪽은 **승인함에서 맡긴** 위임이다. 칸을 더해
 * 한 표로 합치지 않은 까닭이 셋이다:
 *  · ⓐ 🔴 **`id` 의 주인이 포털이다.** 이 집이 만들지 않고 받아 적는다(그래서 아래
 *    `defaultRandom()` 이 없다). 같은 줄을 양쪽이 **같은 번호**로 가리켜야 철회와 어긋남
 *    점검이 맞는다(설계 B-12 의 5번).
 *  · ⓑ 🔴 **이 줄은 이 시스템 화면에서 되돌릴 수 없다** — 거두는 곳은 **승인함**뿐이다.
 *    저쪽 줄은 여기서 되돌린다(설정 화면의 [되돌리기]). 한 표에 섞으면 「되돌리기 단추를
 *    그릴까」가 칸 하나에 매달리고, 그 칸을 잘못 읽는 날 **거둘 수 없는 줄에 단추가 뜬다.**
 *  · 세 시스템(A/S·재고관리·휴가)이 **같은 이름·같은 모양**의 표를 쓴다. 집집마다 다른
 *    모양으로 받으면 포털이 집집마다 다른 몸통을 보내야 한다.
 *
 * ── ⓔ 🔴 열쇠가 `sub` 인 까닭 — **이 집은 변환이 없다** ──────────────────
 * 포털이 보내는 것은 포털 `users.id`(= ID 토큰의 `sub`)이고, 이 시스템의 `users.auth_sub` 가
 * **곧 그 값**이다(CLAUDE.md 6-6절). 결재 판정의 열쇠도 같은 번호라
 * (`approval_routes.approver_sub`), 받은 값을 **그대로** 적는다 — 바꾸다 틀릴 자리 자체가 없다.
 * 🔵 A/S 는 `users.sso_subject` 로 한 단, 휴가는 `web_users` → `web_employees` 로 두 단을
 *    거친다(설계 C-3). 그 집들의 표에는 변환한 제 열쇠가 들어가고, 여기만 번호가 그대로다.
 * 🔴 **그래도 「이 시스템에 계정이 있는가」는 본다** — 없으면 저장하지 않고
 *    `not_applicable` 로 답한다(오류가 아니다. 통로 파일 머리말). 여기서 결재할 일이 없는
 *    사람에게는 위임도 뜻이 없고, 오류로 답하면 **재고관리 계정이 없는 사람에게는 위임을
 *    아예 못 맡기게 된다**(포털이 전파 실패로 보고 지정을 거절한다 — 설계 B-13).
 *
 * ── 🔴 사람에 대한 외래키가 없다 ────────────────────────────────────────
 * `approval_delegations` 와 **같은 까닭**이다 — 재고 관리의 `users` 에는 여기 로그인한 적
 * 있는 사람만 들어온다. FK 를 걸면 저장이 **오류**가 되는데, 우리가 하려는 답은 오류가 아니라
 * `not_applicable` 이다. 🔵 이름 사본 칸도 두지 않는다: 포털이 보내는 몸통에 이름이 없고
 * (통로 규약), 세 시스템이 같은 모양이어야 한다. 「그때 누구였나」는 **감사 로그**에 남는다
 * (`PORTAL_DELEGATION_SYNCED` 의 detail — `./approval/portal-delegation-store.ts`).
 *
 * ── 🔴 줄을 지우는 길을 만들지 않는다 ───────────────────────────────────
 * 되돌리기는 `revoked_at` 을 찍는 것이다. 지우면 **그 기간에 난 결재를 나중에 설명할 수 없다.**
 * 🔵 그래서 소프트 삭제 네 칸도 두지 않는다(`approval_delegations` 와 같은 예외).
 * ============================================================================
 */
export const portalApprovalDelegations = pgTable(
  "portal_approval_delegations",
  {
    /**
     * 🔴 **포털이 정한 번호를 그대로 적는다.** `defaultRandom()` 을 붙이지 마라 — 붙이면
     * 몸통에 `id` 가 빠져 온 날 **우리만 아는 번호**가 생기고, 그 줄은 포털이 철회해도
     * 영영 안 거둬진다(「거둔 줄 알았는데 안 거둬진」 쪽이 더 위험하다 — 설계 B-13).
     * 멱등도 이 칸이 쥔다: 같은 번호로 두 번 와도 **한 줄**이다(PK + onConflictDoUpdate).
     */
    id: uuid("id").primaryKey(),
    /** 결재권자 — 자리를 비우는 사람의 **포털 번호**. 🔵 **FK 없음**(머리말). */
    delegatorSub: text("delegator_sub").notNull(),
    /** 대신할 사람의 **포털 번호**. 🔵 **FK 없음**(머리말). */
    delegateSub: text("delegate_sub").notNull(),
    /**
     * 기간. 🔴 **끝은 포함하지 않는다**(반열린 구간 `[starts_at, ends_at)`) — 판정이 적힌 곳은
     * `./approval/delegation.ts` 의 `isActiveDelegation` 하나뿐이고, 이 표도 그 함수로 읽힌다
     * (조각 8). 🔴 **날짜 환산은 이 집이 하지 않는다** — 포털이 ISO 8601 시각으로 보낸다.
     */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** 왜 맡겼는가. 🔵 포털이 빈 글자로 보낼 수 있다 — 안 적었다고 위임을 막을 일은 아니다. */
    reason: text("reason").notNull().default(""),
    /**
     * 거둔 시각. 아직 살아 있으면 `null`.
     *
     * 🔴 **값을 포털이 정한다.** 받은 시각(`now()`)으로 갈아 적지 마라 — 같은 철회가 두 번
     * 와도 **같은 값**이어야 멱등이고, 「포털에는 어제 거둔 것으로 적혀 있는데 여기는 오늘」
     * 같은 어긋남이 조각 9 의 점검에서 거짓 경보가 된다.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /**
     * 🔴 **언제 받았나.** 줄이 만들어진 때도 고쳐진 때도 아니고 **마지막으로 전파가 닿은 때**다.
     *
     * 조각 9(어긋남 점검)가 이 칸을 쓴다 — B-13 이 있어도 **전파 뒤 포털 저장이 실패하는 틈**은
     * 남고(설계 B-14), 그 어긋남은 맞대어 보지 않으면 **영영 조용하다.** 그때 「양쪽이 같은 줄을
     * 보고 있나」를 묻는 자리가 이 값이다.
     * 🔵 `created_at` 을 따로 두지 않는다 — 이 표의 줄은 이 집이 만드는 것이 아니라서 「여기서
     *    처음 만들어진 때」가 뜻을 갖는 값이 아니다. 만든 때는 **포털 표**에 있다.
     */
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * 기간이 거꾸로인 줄은 **DB 가 막는다.** 영원히 유효하지 않은데 화면에는 멀쩡한 줄로 보인다.
     * 🔵 `>` 다(`>=` 가 아니다) — 시작과 끝이 같으면 유효한 순간이 하나도 없다(반열린 구간).
     * 🔴 받는 통로가 **같은 잣대로 먼저 거른다**(400). 여기까지 와서 터지면 포털에는 500 으로
     *    보이고, 500 과 400 은 포털이 다르게 다룬다(다시 보낼지 말지).
     */
    check("portal_approval_delegations_period_valid", sql`${t.endsAt} > ${t.startsAt}`),
    /**
     * 🔴 **자기에게 맡기는 줄은 DB 가 막는다.** 아무 뜻도 없는 줄인데, 있으면 「대리인이 눌렀다」
     * 판정이 본인에 대해 참이 될 수 있어 이력이 거짓이 된다. 포털 표에도 같은 CHECK 가 있어
     * 평소에는 닿지 않는다 — 닿았다면 **몸통이 뒤틀려 온 것**이고, 통로가 400 으로 먼저 돌려준다.
     */
    check("portal_approval_delegations_not_self", sql`${t.delegateSub} <> ${t.delegatorSub}`),
    /**
     * 🔴 **「지금 내가 누구의 결재권을 쓸 수 있나」가 이 색인으로 들어온다**(조각 8) — 대신할
     * 사람으로 찾고, 안 거뒀고(`revoked_at IS NULL`), 아직 안 끝난(`ends_at > now`) 줄만 본다.
     * 칸 차례가 그 조회의 차례이고, `approval_delegations_delegate_idx` 와 **같은 모양**이다 —
     * 두 표를 같은 함수가 같은 조건으로 읽기 때문이다.
     * 🔵 `starts_at` 은 넣지 않는다(앞의 셋으로 좁히면 몇 줄이라 그 자리에서 걸러도 된다).
     */
    index("portal_approval_delegations_delegate_idx").on(t.delegateSub, t.revokedAt, t.endsAt),
  ],
);

export type PortalApprovalDelegation = typeof portalApprovalDelegations.$inferSelect;
export type NewPortalApprovalDelegation = typeof portalApprovalDelegations.$inferInsert;
