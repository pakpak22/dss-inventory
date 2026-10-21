import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * ============================================================================
 * 승인 절차(결재선) — 한 판(version)씩 쌓는 표 둘
 * ============================================================================
 * 한 가지 일을 **여러 사람에게 순서대로** 결재받기 위한 절차다. A/S 관리 시스템에서
 * 원본 모양 그대로 옮겨 온다(2026-10-15, 조각 ③a. 원본은
 * `RF_Service_System/vendor/dss-core/src/schema/shipment-approval-routes.ts`).
 *
 * 어느 절차인지는 `scope` 칸 하나가 정한다. 지금 있는 값은 셋이다 — `'PART_ISSUE'`(부품 불출) ·
 * `'PART_ISSUE_MATCHER'`(매쳐 부품 불출) · `'PART_ISSUE_GENERATOR'`(제너레이터 부품 불출).
 *
 * 🔴 **뒤의 둘은 아직 아무도 쓰지 않는다**(2026-10-22). 매쳐·제너레이터에 **다른 결재 순서**를
 * 지정할 수 있게 그릇만 먼저 만든 것이고, 신청이 올라올 때 어느 쪽을 붙일지는 다음 조각이다 —
 * 지금은 모든 부품 불출 신청이 여전히 `'PART_ISSUE'` 로 간다(`src/app/actions/stock.ts` ·
 * `src/lib/approval/part-issue.ts` 가 그 값을 글자 그대로 쓴다).
 *
 * 설계 결정(원본 2026-09-09, 사용자 승인):
 *  · 한 용도에 절차는 **하나**뿐이다. 고객사별·금액별 분기는 없다.
 *  · 순서는 **일렬**이다 — 갈래도 병렬 승인도 없다.
 *  · 반려되면 처음 단계부터 다시 요청한다.
 *
 * ── 🔴 왜 판(version)으로 쌓는가 ────────────────────────────────────────
 * 이 저장소는 물리 삭제를 금지한다(CLAUDE.md 11절). 그래서 절차를 고칠 때 기존 줄을
 * 지우고 다시 쓰지 않는다 — **새 판을 하나 더 얹는다.** 이 모양을 고른 이유가 셋이다:
 *
 *  1. **지운 기록이 남는다.** 「누가 언제 결재선을 바꿨나」가 표 자체에 남는다. 인가에
 *     관계된 설정이라 별도의 이력 표를 두지 않고도 추적이 끊기지 않는다.
 *  2. **진행 중인 건이 흔들리지 않는다.** 나중 조각에서 승인 요청에 「몇 번째 판으로
 *     요청했는지」만 적어 두면, 관리자가 절차를 바꿔도 이미 요청된 건은 옛 판을 그대로
 *     따라간다. 요청 시점의 결재선을 복사해 굳히는 표가 따로 필요 없다.
 *  3. **순서 바꾸기가 안전하다.** 줄을 위아래로 옮길 때 step_order 가 잠깐 겹치는 문제
 *     (유니크 위반)가 원천적으로 없다 — 새 판을 통째로 새로 쓰기 때문이다. 「임시로 999 를
 *     넣었다가 되돌린다」 같은 우회가 필요 없다.
 *
 * ── 🔴 「현재 절차」 = **그 용도 안에서** version 이 가장 큰 판 ────────────
 * is_current 같은 칸을 두지 않는다. 같은 사실이 두 곳(정렬 순서와 깃발)에 적히면 언젠가
 * 갈라지고, 그때 「현재」가 둘이 되거나 0개가 된다. 현재 판은 언제나
 * `WHERE scope = ? ORDER BY version DESC LIMIT 1` 하나로 정해진다.
 *
 * 판 번호도 **용도 안에서** 센다 — 유니크가 (scope, version) 인 이유가 그것이다.
 *
 * ── 🔴 이 표가 비어 있으면 앱은 이 기능이 없던 때와 완전히 같이 동작한다 ──
 * 판이 하나도 없는 것이 정상 초기 상태다. 단계 0개인 판도 마찬가지다 — 「절차를 쓰지
 * 않겠다」는 뜻이므로 지금까지처럼 재고 담당자가 그 자리에서 바로 처리한다(빈 판과 판
 * 없음을 굳이 구분하지 않는다).
 *
 * ── 🔴 사람에게 FK 를 걸 수 없다 — 이 시스템의 가장 큰 차이 ───────────────
 * 원본에서는 승인자가 A/S 의 `users` 를 가리키는 진짜 FK 다. **이 시스템에는 그 사람들이
 * 없다** — 재고 관리의 `users` 에는 이 시스템에 로그인한 적 있는 사람만 들어오기 때문이다.
 * 그래서 승인자는 **A/S 의 ID 를 글자(uuid 값)로 적어 둘 뿐**이고, 데이터베이스가 그 존재를
 * 지켜 줄 수는 없다. 이름·역할은 **받아 올 때 떠 온 사본**이고 정본은 언제나 A/S 다.
 * 이 저장소가 이미 같은 방식을 쓴다 — `stock_request_issues` 가 `issued_by`(누구)와
 * `issued_by_name`(그때의 이름)을 둘 다 적고, `oh_part_template_models` 도 같다.
 * ============================================================================
 */

/**
 * 이 절차가 **무엇을 결재하는가**.
 *
 * 🔴 값 목록은 `src/lib/approval/route.ts` 의 `APPROVAL_ROUTE_SCOPES` 와 **글자 그대로 같아야
 * 한다**. 여기서 다시 적는 이유는 스키마 파일이 도메인 층을 가져오지 않기 때문이고
 * (`stock-requests.ts` 의 `REQUEST_STATUSES` 와 같은 자리다), 두 벌이 갈라지지 않도록
 * `tests/approval-route.test.ts` 가 둘을 맞춰 본다.
 *
 * 🔴 **나중에 용도가 늘면 반드시 맨 끝에 더한다.** `ALTER TYPE … ADD VALUE` 는 언제나 뒤에
 * 붙으므로, 가운데에 끼워 넣으면 코드의 차례와 DB 의 차례가 어긋나 다음 `db:generate` 가
 * 있지도 않은 차이를 감지한다. (`stock_request_status` 에 `PARTIAL` 을 맨 뒤에 붙인 것과
 * 같은 까닭이다.) 차례 자체에 뜻은 없다.
 *
 * 🔴 **`'PART_ISSUE'` 를 빼지 마라.** 지금 올라가 있는 결재건이 그 값을 가리키고 있고,
 * `stock_issue_approvals.route_id` → `approval_routes` 가 `RESTRICT` 라 지우면 아예 막힌다.
 * 2026-10-22 에 더한 값 둘은 **맨 끝에** 붙였다 — 그래야 옛 값의 차례가 흔들리지 않는다.
 */
export const approvalRouteScopeEnum = pgEnum("approval_route_scope", [
  "PART_ISSUE",
  "PART_ISSUE_MATCHER",
  "PART_ISSUE_GENERATOR",
]);

/**
 * 절차 한 판. **한 번 쓰면 바뀌지 않는다**(append-only).
 *
 * 🔴 **그래서 `updated_at` 도, 소프트 삭제 네 칸(is_deleted·deleted_at·deleted_by·
 * delete_reason)도 두지 않는다.** 고치는 길이 없으니 「마지막으로 고친 시각」이 가리킬 것이
 * 없고, 판을 지우는 대신 새 판을 얹으므로 휴지통에서 되살릴 일도 없다.
 *
 * 🔴 **CLAUDE.md 11절의 「소프트 삭제 4컬럼 고정」은 지우는 표에 대한 규칙이다.** 이 표는
 * 지우지 않으므로 그 규칙의 예외이고, 네 칸이 없는 것은 빠뜨린 것이 아니라 설계다. 칸을
 * 더하면 쓰이지 않는 칸이 되고, 다음 사람은 「왜 안 쓰지」를 묻다가 지우는 길을 열게 된다.
 * `stock_request_issues` · `legacy_records` 가 쓰는 것과 같은 append 계열 규약이다.
 *
 * 절차 이름 칸은 두지 않는다 — 용도마다 절차가 하나뿐이라 이름이 구별할 것이 없다.
 */
export const approvalRoutes = pgTable(
  "approval_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 어느 절차인가. 🔴 **기본값을 두지 않는다.** 기본값을 남겨 두면 용도를 적지 않은 판이
     * 조용히 어느 한쪽 절차로 들어가고, 그러면 다음 사람이 「저쪽을 저장했는데 이쪽이
     * 바뀌었다」를 만나게 된다. 뜻을 숨기는 기본값은 두지 않는다.
     */
    scope: approvalRouteScopeEnum("scope").notNull(),
    /** 1 부터. **그 용도 안에서** 가장 큰 값이 곧 「현재 절차」다. */
    version: integer("version").notNull(),
    /**
     * 이 판을 만든 사람. 🔵 **FK 없음** — 이 저장소의 관례이기도 하고(`parts.deleted_by` ·
     * `stock_request_issues.issued_by` 도 FK 가 없다), 결재선을 고치는 사람이 A/S 쪽 계정일
     * 수 있어 이 시스템의 `users` 에 그 줄이 없을 수 있다.
     */
    createdBy: uuid("created_by"),
    /**
     * 그때의 이름 사본. 🔴 **id 만 적어 두면 「누가 언제 결재선을 바꿨나」가 사람에게
     * 안 보인다** — 이 표가 이력 표를 대신하는 까닭이 그 질문이므로 이름이 없으면 절반이
     * 빈다. 정본은 A/S 이고, 나중에 거기서 이름이 바뀌어도 여기 값은 따라 바뀌지 않는다.
     */
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * 판 번호는 **한 용도 안에서** 겹치지 않는다 — 「현재 절차」의 정의가 그 용도의 가장 큰
     * version 에 걸려 있으므로, 겹치는 순간 현재가 둘이 된다.
     *
     * 🔵 반대로 **다른 용도끼리는 같은 번호를 써도 된다.** 사람이 읽는 번호는 「이 절차의 몇
     * 번째 판인가」이지 표 전체의 일련번호가 아니다.
     */
    uniqueIndex("approval_routes_scope_version_uq").on(t.scope, t.version),
  ],
);

/**
 * 그 판의 단계들. 위에서부터 순서대로 결재한다.
 *
 * 🔴 **단계 0개인 판도 정상이다** — 「절차를 쓰지 않겠다」는 뜻이고, 판은 지우지 않으므로
 * (append-only) **0개짜리 판을 얹는 것이 한 번 켠 절차를 끄는 유일한 출구다.** 그래서 여기에
 * 「최소 한 줄」 제약을 두지 않는다. 두면 관리자는 한 번 만든 절차를 되돌릴 방법이 영영
 * 없어진다.
 *
 * 상한(10단계)은 순수 로직 쪽에 있다 — `src/lib/approval/route.ts` 의 `MAX_APPROVAL_ROUTE_STEPS`.
 */
export const approvalRouteSteps = pgTable(
  "approval_route_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 단계는 판에 딸린 것이라 판이 사라지면 함께 사라진다 — 여기만 CASCADE 다. 실제로는 판을
     * 지우지 않으므로(append-only) 이것은 고아 행을 만들지 않기 위한 방어선이지, 쓰라고 열어
     * 둔 길이 아니다.
     */
    routeId: uuid("route_id")
      .notNull()
      .references(() => approvalRoutes.id, { onDelete: "cascade" }),
    /** 1 부터. 배열의 자리(index + 1)로 매긴다 — `src/lib/approval/route.ts` 의 `stepOrderFromIndex`. */
    stepOrder: integer("step_order").notNull(),
    /**
     * 이 단계를 결재할 사람. 🔴 **FK 없음** — A/S 의 사용자 ID 를 글자로 적어 둘 뿐이다(머리말).
     * 재고 관리의 `users` 에는 이 시스템에 로그인한 적 있는 사람만 들어오므로, FK 를 걸면
     * A/S 의 결재자 대부분을 아예 넣을 수 없다.
     */
    approverUserId: uuid("approver_user_id").notNull(),
    /**
     * 🔴 **포털(통합 로그인) 번호** — 이 시스템 `users.auth_sub` 와 같은 값이고, **결재자 판정의
     * 열쇠다**(2026-10-15 사용자 결정).
     *
     * 위 `approver_user_id` 는 A/S 의 번호라 **이 시스템의 로그인 번호가 아니다.** 같은 사람이
     * 시스템마다 다른 번호를 갖기 때문에(실측: 재고 `users.id` ≠ A/S `users.id` ≠ 포털 `sub`),
     * A/S 번호로 「내가 결재할 건」을 찾으면 **영원히 빈 목록**이 된다. 두 번호를 **둘 다** 적어
     * 두는 까닭이 그것이다 — 포털 번호는 사람을 가르고, A/S 번호는 명부로 되짚는다.
     * 🔴 `approver_user_id` 의 뜻을 갈아끼우지 마라. 칸 이름이 거짓이 된다.
     *
     * 🔵 **nullable 이다.** 이 칸이 생기기 전에 저장된 옛 판에는 값이 없다(개발 DB 에 둘 있다).
     * 새로 저장하는 판에는 언제나 들어간다 — 번호가 없는 사람은 저장 자체가 거절되기 때문이다
     * (`src/lib/approval/directory.ts` 의 `resolveApproversFromDirectory`). 값이 없는 단계가
     * 섞인 판으로는 **결재건을 올릴 수 없다**(`planPartIssueApproval` 의 `MISSING_SUB`) —
     * 그래야 아무도 열 수 없는 결재가 생기지 않는다.
     *
     * 🔵 `text` 다 — 포털의 `sub` 는 지금은 uuid 모양이지만 규격상 **불투명한 글자**이고,
     * 이 저장소의 `users.auth_sub` 도 `text` 다. 둘이 짝이라야 비교가 어긋나지 않는다.
     */
    approverSub: text("approver_sub"),
    /**
     * 받아 올 때의 이름·역할 사본. 정본은 A/S 다(머리말).
     *
     * 🔴 **이름을 적어 두는 까닭**: A/S 가 꺼져 있어도 「누가 결재선에 있나」가 보여야 하고,
     * 그 사람이 나중에 없어져도 **조용히 사라지면 안 된다.** 원본에 그 규칙이 적혀 있다 —
     * 「자격을 잃은 사람을 조용히 빼지 않는다. 줄은 그대로 두고 왜 안 되는지를 그 자리에
     * 적는다. 조용히 빼면 절차가 짧아진 것처럼 보이고 「왜 결재가 안 넘어가지」를 아무도 답할
     * 수 없다.」 이름이 없으면 그 자리에 적을 말이 「알 수 없는 사람」밖에 없다.
     */
    approverName: text("approver_name").notNull(),
    approverRole: text("approver_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** 한 판 안에서 순서가 겹치지 않는다. */
    uniqueIndex("approval_route_steps_order_uq").on(t.routeId, t.stepOrder),
    /**
     * 🔴 한 판 안에서 같은 사람이 두 번 나오지 않는다. 나오면 「지금 내 차례인가」가 한 건에
     * 대해 **두 번 참**이 되어 순차 승인이라는 말 자체가 성립하지 않는다. 사람에게 이유를
     * 말해 주는 앞단은 `validateApprovalRouteSteps` 이고, **이 유니크가 최종 방어선이다.**
     */
    uniqueIndex("approval_route_steps_approver_uq").on(t.routeId, t.approverUserId),
    /**
     * A/S 번호로 되짚는 길. 🔵 「지금 내 차례인가」는 **이 색인을 타지 않는다** — 그 판정은
     * 포털 번호로 하고(위 `approver_sub`), 결재건 쪽 표에서 돈다.
     */
    index("approval_route_steps_approver_idx").on(t.approverUserId),
    /** 표의 CHECK 와 `stepOrderFromIndex`(index + 1) 가 짝이다. */
    check("approval_route_steps_step_order_positive", sql`${t.stepOrder} >= 1`),
  ],
);

export type ApprovalRoute = typeof approvalRoutes.$inferSelect;
export type NewApprovalRoute = typeof approvalRoutes.$inferInsert;
export type ApprovalRouteStep = typeof approvalRouteSteps.$inferSelect;
export type NewApprovalRouteStep = typeof approvalRouteSteps.$inferInsert;
