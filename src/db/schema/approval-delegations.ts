import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * ============================================================================
 * 결재권 위임 — 「A 의 결재권을 이 기간 동안 B 가 대신한다」
 * ============================================================================
 * 결재권자가 출장·휴가로 자리를 비우면 그 건이 **선다**(2026-10-21, 조각 1). 그 자리를 메우는
 * 표다. 판정 규칙은 `src/lib/approval/delegation.ts` 가 순수 함수로 쥐고 있고, 이 표는 그
 * 함수가 볼 값을 적어 둘 뿐이다.
 *
 * ── 🔴 승인 절차 안의 사람은 **바꾸지 않는다** ──────────────────────────
 * `approval_routes` · `approval_route_steps` 는 한 글자도 건드리지 않는다. 결재선을 고쳐
 * 대리인을 끼워 넣는 길도 있었지만, 그러면 「원래 누가 결재하게 돼 있었나」가 사라지고 휴가가
 * 끝났을 때 되돌릴 근거도 없어진다. 결재선은 그대로 두고 **누를 수 있는 사람만 늘린다.**
 *
 * ── 🔴 열쇠는 **포털 번호**(`sub`)다 ────────────────────────────────────
 * 이 시스템의 `users.id`(uuid) 도, A/S 번호(`approver_user_id`) 도 아니다. 그 둘을 섞어
 * 2026-10-15 에 실제 장애가 났다 — 「내가 결재할 건」이 영원히 빈 목록이 되는, 코드는 맞고 값만
 * 안 맞는 결함이다(까닭은 `approval-routes.ts` 의 `approver_sub` 주석과 `src/lib/approval/
 * directory.ts` 머리말). 그래서 이 표의 사람 칸은 **전부 `text` 로 된 포털 번호**이고, 칸 이름도
 * 전부 `…_sub` 다. 이름이 열쇠를 지킨다 — `…_user_id` 라는 이름이 하나라도 섞이면 다음 사람이
 * 거기에 `users.id` 를 넣는다.
 *
 * ── 🔴 사람에 대한 외래키가 없다 ────────────────────────────────────────
 * **이 시스템에 그 사람들이 없다** — 재고 관리의 `users` 에는 여기 로그인한 적 있는 사람만
 * 들어오고, 결재자 명부는 A/S 에서 받아 온다. 결재선 표(`approval_routes` · `approval_route_
 * steps`)가 **같은 까닭으로** FK 없이 번호만 적고 이름을 사본으로 들고 있다 — 그 모양을 그대로
 * 따른다. FK 를 걸면 A/S 쪽 결재자 대부분을 아예 넣을 수 없다.
 *
 * ── 🔵 이름을 함께 적는 까닭 ────────────────────────────────────────────
 * 번호만 적어 두면 **그 사람이 나중에 없어지거나 이름이 바뀌었을 때 「그때 누구였는지」가
 * 어디에도 안 남는다.** 위임은 「이 기간에 그 건을 누가 대신 눌렀나」를 나중에 설명하기 위한
 * 기록이라, 설명할 사람의 이름이 빠지면 절반이 빈다. 정본은 언제나 A/S 이고, 거기서 이름이
 * 바뀌어도 여기 값은 따라 바뀌지 않는다 — 그것이 사본을 두는 목적이다
 * (`approval_route_steps.approver_name` 과 같은 규약).
 *
 * ── 🔴 줄을 지우는 길을 만들지 않는다 ───────────────────────────────────
 * 되돌리기는 `revoked_at` 을 찍는 것이다. 지우면 **그 기간에 난 결재를 나중에 설명할 수 없다** —
 * 「이 건은 왜 본인이 아닌 사람이 눌렀나」의 답이 이 표에만 있기 때문이다.
 * 🔵 그래서 소프트 삭제 네 칸(`is_deleted` 등)도 두지 않는다. CLAUDE.md 11절의 「소프트 삭제 4칸
 * 고정」은 **지우는 표에 대한 규칙**이고, 이 표는 지우지 않는다(`approval_routes` 와 같은 예외).
 * 되돌림은 삭제가 아니다 — 지난 기간의 위임은 되돌린 뒤에도 그대로 읽혀야 한다.
 * ============================================================================
 */
export const approvalDelegations = pgTable(
  "approval_delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 결재권자 — 자리를 비우는 사람의 **포털 번호**. 🔵 **FK 없음**(머리말). */
    delegatorSub: text("delegator_sub").notNull(),
    /** 그때의 이름 사본. 정본은 A/S 다(머리말). */
    delegatorName: text("delegator_name").notNull(),
    /** 대신할 사람의 **포털 번호**. 🔵 **FK 없음**(머리말). */
    delegateSub: text("delegate_sub").notNull(),
    delegateName: text("delegate_name").notNull(),
    /**
     * 기간. 🔴 **끝은 포함하지 않는다**(반열린 구간 `[starts_at, ends_at)`). 판정이 적힌 곳은
     * `src/lib/approval/delegation.ts` 의 `isActiveDelegation` 하나뿐이고, 까닭도 거기 있다 —
     * 끝을 포함하면 잇대어 적은 두 위임이 **둘 다 유효한 순간**을 갖는다.
     */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** 왜 맡기는가(출장·휴가 따위). 🔵 비어 있어도 된다 — 적지 않았다고 위임을 막을 일은 아니다. */
    reason: text("reason").notNull().default(""),
    /**
     * 이 줄을 만든 사람. 🔴 **지금은 결재권자 본인만 위임을 만든다**(2026-10-21 결정). 그래서
     * `created_by_sub` 는 당분간 `delegator_sub` 와 **언제나 같은 값**이다.
     *
     * 🔴 **관리자가 남의 결재권을 대신 넘기는 길은 두지 않는다.** 권한이 새기 때문이다 —
     * 관리자가 남의 결재권을 넘길 수 있으면 **자기 자신을 아무의 대리인으로 세워** 모든 결재를
     * 혼자 통과시킬 수 있다. 그러면 `mayDecidePartIssueStep` 이 일부러 막아 둔 「관리자라고 남의
     * 단계를 대신 누를 수 없다」가 **설정 화면으로 우회된다.**
     *
     * 🔴 **그래도 칸을 따로 둔다.** 「누가 이 권한을 열었나」와 「누구의 권한인가」는 **다른
     * 물음**이고, 나중에 둘이 갈리는 날 칸이 없으면 **그때까지 쌓인 기록에는 답이 영영 없다.**
     * 🔴 값이 같다고 칸을 지우지 마라 — 지우는 순간 과거를 되살릴 길이 사라진다.
     *
     * 🔴 **울타리는 이 칸이 아니라 쓰는 쪽에 있다.** `delegator_sub` 는 화면이 보내는 값이
     * 아니라 **서버가 세션에서 꺼내 넣는다**(조각 3). 화면이 보낸 값을 믿으면 남의 결재권을
     * 넘기는 요청을 손으로 만들 수 있다. 🔵 되돌리기도 마찬가지로 **본인 것만**이다.
     */
    createdBySub: text("created_by_sub").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * 되돌린 시각. 아직 살아 있으면 `null`.
     *
     * 🔴 **지우는 대신 이 칸을 찍는다**(머리말). 기간이 남아 있어도 이 칸이 차 있으면 그 위임은
     * 죽은 것이다 — 기간만 보고 판정하면 되돌린 뒤에도 계속 참이 된다.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** 되돌린 사람의 포털 번호와 그때의 이름. 🔵 되돌리기 전에는 비어 있다. */
    revokedBySub: text("revoked_by_sub"),
    revokedByName: text("revoked_by_name"),
  },
  (t) => [
    /**
     * 기간이 거꾸로인 줄은 **DB 가 막는다.** 끝이 시작보다 앞서면 그 위임은 영원히 유효하지
     * 않은데, 화면에는 멀쩡한 줄로 보인다 — 「맡겼는데 왜 안 되지」의 답을 아무도 못 찾는다.
     *
     * 🔵 `>` 다(`>=` 가 아니다). 시작과 끝이 같으면 유효한 순간이 하나도 없다(반열린 구간).
     */
    check("approval_delegations_period_valid", sql`${t.endsAt} > ${t.startsAt}`),
    /**
     * 🔴 **자기에게 맡기는 줄은 DB 가 막는다.** 아무 뜻도 없는 줄인데, 있으면 「대리인이 눌렀다」
     * 판정(`decided_by_sub <> approver_sub`)이 본인에 대해 참이 될 수 있어 이력이 거짓이 된다.
     */
    check("approval_delegations_not_self", sql`${t.delegateSub} <> ${t.delegatorSub}`),
    /**
     * 🔴 **「지금 내가 누구의 결재권을 쓸 수 있나」가 이 색인으로 들어온다** — 대신할 사람으로
     * 찾고, 되돌리지 않았고(`revoked_at IS NULL`), 아직 안 끝난(`ends_at > now`) 줄만 본다.
     * 칸 차례가 그 조회의 차례다.
     *
     * 🔵 `starts_at` 은 색인에 넣지 않는다 — 앞의 셋으로 좁히고 나면 남는 줄이 몇 줄이라
     * 시작 시각은 그 자리에서 걸러도 된다. 넣으면 색인만 커진다.
     */
    index("approval_delegations_delegate_idx").on(t.delegateSub, t.revokedAt, t.endsAt),
  ],
);

export type ApprovalDelegation = typeof approvalDelegations.$inferSelect;
export type NewApprovalDelegation = typeof approvalDelegations.$inferInsert;
