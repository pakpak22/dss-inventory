import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { approvalRoutes } from "./approval-routes";
import { stockEntries } from "./stock";
import { stockRequests } from "./stock-requests";

/**
 * ============================================================================
 * 부품 불출 결재 — 표 둘 (결재건 · 단계별 결재)
 * ============================================================================
 * 반출 신청(`stock_requests`)을 담당자가 그 자리에서 [확인]하는 대신 **여러 사람에게 순서대로**
 * 결재받는 길이다(2026-10-15, 조각 11a). 결재선은 새로 만들지 않고 이미 있는
 * `approval_routes` 의 `scope = 'PART_ISSUE'` 판을 그대로 쓴다.
 *
 * A/S 관리 시스템의 `vendor/dss-core/src/schema/inventory-part-issue-requests.ts` 를 옮겨 온
 * 것이다. 🔴 **원본은 표가 셋인데 여기는 둘이다.** 까닭이 둘:
 *
 *  1. **「신청 항목」 표를 두지 않는다.** 원본이 그 표를 둔 까닭은 줄별 수량을 담기 위해서인데,
 *     이 저장소는 줄별 수량이 **이미 흐르고 있다** — `confirmRequest(id, admin, { quantities })`
 *     가 줄별 「이번에 줄 수량」을 받고, `stock_requests.payload` 가 jsonb 로 신청 내용을 담는
 *     선례가 있다. 그래서 아래 `quantities` **jsonb 한 칸**에 담는다. 표를 더하면 같은 사실이
 *     두 곳(jsonb 와 줄 표)에 적힐 자리가 생긴다.
 *  2. **「직접 사용」 길이 없다.** 원본에는 요청 없이 바로 빼는 길이 있어 접수 건·사용처·절차
 *     작업 칸을 헤더가 들고 있어야 했다. 🔴 이 시스템은 **2026-10-15 결정으로 반출(사용·대여·
 *     폐기)이 누가 적든 요청으로 올라온다**(`stock-requests.ts` 머리말). 그래서 그 칸들이
 *     **필요 없고**, 반출 신청을 가리키는 칸은 **NOT NULL** 이다.
 *
 * ── 🔴 승인이 끝나도 재고는 자동으로 빠지지 않는다 ──────────────────────
 * 이 표들이 담는 것은 「빼도 된다」까지이고, **실제로 빼는 것은 재고 담당자가 따로 누른다.**
 * 그래서 상태에 `APPROVED` 와 `EXECUTED` 가 **따로** 있다 — 「결재는 끝났는데 아직 안 나갔다」가
 * 실재하는 상태다. 승인 트랜잭션 안에서 재고까지 빼지 않는 이유가 둘이다(원본 머리말 그대로):
 *
 *  1. 재고를 빼는 로직(수량 검사·잔량 갱신·회차·중복 방지)은 이미 검증돼 있다
 *     (`src/lib/stock/ledger.ts` · `issue.ts` · `requests.ts` 의 `confirmRequest`). 그것을 승인
 *     트랜잭션 안으로 끌어들이면 두 위험이 한 곳에서 만난다.
 *  2. 신청 시점과 마지막 승인 시점의 재고가 다르다. 승인이 곧 불출이면 **마지막 결재자가
 *     「재고 부족」으로 막힌다** — 결재자는 재고를 어찌할 수 없는 사람이다.
 *
 * ── 🔴 안전장치: 「부품 불출」 판이 하나도 없으면 이 기능은 없는 것과 같다 ──
 * `approval_routes` 에 `scope = 'PART_ISSUE'` 판이 없거나 단계가 0개인 판뿐이면, **재고
 * 담당자는 지금까지처럼 그 자리에서 바로 [확인]한다.** 이 표들에는 행이 한 줄도 생기지 않는다.
 * 이 약속이 없으면 기능을 올리는 순간 **관리자가 절차를 만들기 전까지 재고가 통째로 잠긴다.**
 * 판정을 표가 아니라 서버(`src/lib/approval/part-issue.ts`)가 쥐는 것은 의도다 — 판정을 두 곳에
 * 적으면 갈라진다.
 *
 * ── 🔴 사람에게 FK 를 걸 수 없다 ────────────────────────────────────────
 * 결재자는 A/S 쪽 계정일 수 있고, 이 시스템의 `users` 에는 여기 로그인한 적 있는 사람만
 * 들어온다. 그래서 사람을 가리키는 칸은 **전부 uuid 값으로만** 적고 이름·역할은 사본이다
 * (`approval-routes.ts` 머리말과 같은 까닭, `stock_request_issues.issued_by` 와 같은 관례).
 *
 * ── 소프트 삭제 네 칸을 두지 않는다 ─────────────────────────────────────
 * 결재건을 무르는 길은 `CANCELLED` 상태이지 삭제가 아니다. 결재 이력이 딸린 건이 휴지통으로
 * 사라지면 「누가 무엇을 승인했나」가 끊긴다.
 * ============================================================================
 */

/**
 * 결재건 한 건이 지나가는 상태.
 *
 * 🔴 값 목록은 `src/lib/approval/part-issue-rules.ts` 의 `PART_ISSUE_STATUSES` 와 **글자 그대로
 * 같아야 한다.** 스키마 파일이 도메인 층을 가져오지 않는 이 저장소의 관례라 두 벌이 되고
 * (`approvalRouteScopeEnum` ↔ `APPROVAL_ROUTE_SCOPES` 와 같은 자리), 갈라지지 않도록
 * `tests/part-issue-approval.test.ts` 가 둘을 맞춰 본다.
 *
 * 🔴 **새 값은 반드시 맨 끝에 더한다.** `ALTER TYPE … ADD VALUE` 는 언제나 뒤에 붙으므로,
 * 가운데에 끼우면 코드의 차례와 DB 의 차례가 어긋나 다음 `db:generate` 가 있지도 않은 차이를
 * 감지한다(선례: `stock_request_status` 의 `PARTIAL` · `ON_HOLD`). 차례 자체에 뜻은 없다.
 *
 * 🔴 `EXECUTION_REJECTED` — **결재가 다 끝나 실행만 남은 건을 담당자가 막은 것**(2026-10-21).
 * 왜 `REJECTED` 를 재사용하지 않는지, 왜 `CANCELLED` 가 아닌지는 `part-issue-rules.ts` 의
 * `PART_ISSUE_STATUSES` 주석에 있다. 🔵 이 값은 아래 **부분 유니크 색인의 묶음에 없다** — 색인
 * 주석에 그 뜻을 적어 두었다.
 */
export const stockIssueApprovalStatusEnum = pgEnum("stock_issue_approval_status", ["PENDING_APPROVAL", "APPROVED", "EXECUTED", "REJECTED", "CANCELLED", "EXECUTION_REJECTED"]);

/**
 * 단계 한 줄의 상태.
 *
 * 🔴 **거둠에 해당하는 값이 없다.** 올린 사람이 거둬도 열려 있던 단계 줄은 `REQUESTED` 로
 * 남는다 — 거기 `REJECTED` 를 적으면 「그 사람이 반려했다」는 거짓이 된다. 대신 「내가 결재할
 * 건」 조회가 결재건의 상태(`PENDING_APPROVAL`)까지 보므로 거둔 건은 아무의 목록에도 안 뜬다.
 */
export const stockIssueApprovalStepStatusEnum = pgEnum("stock_issue_approval_step_status", ["REQUESTED", "APPROVED", "REJECTED"]);

/** 결재건 — 「이 반출 신청을 이만큼 내보내도 될까요」 한 건. */
export const stockIssueApprovals = pgTable(
  "stock_issue_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 어느 반출 신청인가. 🔴 **NOT NULL** — 이 시스템에는 요청을 거치지 않는 반출이 없다
     * (머리말 2번). 비울 수 있게 두면 「요청 없는 결재건」이라는, 실행할 길이 없는 행이 생긴다.
     */
    requestId: uuid("request_id")
      .notNull()
      .references(() => stockRequests.id, { onDelete: "restrict" }),
    /**
     * 🔴 **어느 판으로 올렸는가.** 관리자가 절차를 바꾸면 새 판이 얹히지만(append-only), 이미
     * 올라간 건은 여기 적힌 **옛 판을 끝까지 따라간다**(`approval-routes.ts` 머리말 2번의 까닭
     * 그대로). 올릴 때의 결재선을 복사해 굳히는 표가 따로 필요 없는 이유다.
     *
     * NOT NULL 이다 — 판이 없으면 결재건 자체가 만들어지지 않는다(머리말의 안전장치).
     * RESTRICT 는 방어선이다(판은 실제로 지우지 않는다).
     */
    routeId: uuid("route_id")
      .notNull()
      .references(() => approvalRoutes.id, { onDelete: "restrict" }),
    status: stockIssueApprovalStatusEnum("status").notNull().default("PENDING_APPROVAL"),
    /**
     * 줄별 「이번에 줄 수량」. 실행할 때 이 값 그대로 `confirmRequest(…, { quantities })` 에
     * 넘어간다.
     *
     * 🔴 **무엇을 승인했는지 못 박아 두는 자리다.** 승인은 「해도 된다」이고 실행은 나중이라,
     * 적어 두지 않으면 「승인받은 것과 다른 수량이 나갔다」를 나중에 밝혀낼 방법이 없다.
     * 🔵 줄 표를 두지 않고 jsonb 한 칸인 까닭은 머리말 1번. 모양은 `{ partId, quantity }[]` 이고
     * jsonb 는 그것을 지켜 주지 않으므로 **읽는 쪽이 한 번 더 본다**(`readIssueQuantities`).
     */
    quantities: jsonb("quantities").$type<Array<{ partId: string; quantity: number }>>().notNull(),
    /** 왜 이만큼 빼야 하는가. **결재자가 읽는 글**이다. */
    reason: text("reason").notNull().default(""),
    /** 올린 사람. 🔵 **FK 없음**(머리말) — 이름은 그때의 사본이다(이 저장소의 관례). */
    requestedBy: uuid("requested_by").notNull(),
    requestedByName: text("requested_by_name").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * 실행이 만든 원장 머리. **실행 전에는 비어 있다.**
     *
     * 🔵 `stock_entries.request_id` 에 걸린 UNIQUE 를 피하려고 회차 표가 생긴 것과 달리
     * (`stock_request_issues` 주석 1번), 이 칸은 **거꾸로 가리키기만** 한다 — 원장 쪽은 한 글자도
     * 바뀌지 않았다. 여러 회차로 나가면 마지막 회차의 건이 적힌다(신청 표의 `entry_id` 와 같은 규약).
     */
    entryId: uuid("entry_id").references(() => stockEntries.id, { onDelete: "restrict" }),
    /** 실제로 뺀 사람과 그때의 이름·시각. 🔴 상태가 `EXECUTED` 인 것과 이 칸들이 찬 것은 같은 말이다(아래 CHECK). */
    executedBy: uuid("executed_by"),
    executedByName: text("executed_by_name"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    /**
     * 🔴 **실행 대기에서 막은 사람**과 그때의 이름·시각·사유 (2026-10-21).
     *
     * 위 실행 칸 셋(`executed_*`)과 **같은 모양**이다 — 사람에 FK 가 없고(머리말), 이름은 그때의
     * 사본이며, 상태(`EXECUTION_REJECTED`)와 한 쌍이다(아래 새 CHECK).
     *
     * ── 🔴 **사유를 결재건 쪽에 두는 까닭** ─────────────────────────────
     * 결재 중 반려의 사유는 **단계 줄**(`stock_issue_approval_steps.note`)에 적힌다. 그런데 실행
     * 대기에는 **열린 단계가 하나도 없다** — 단계는 전부 `APPROVED` 로 닫혔다. 거기 아무 줄에나
     * 사유를 적으면 「그 결재자가 반려했다」는 거짓이 되고, 사유만을 위해 가짜 단계 줄을 하나
     * 더 넣으면 「열린 줄은 하나뿐」(단계 표의 부분 유니크 색인)이 지키던 사슬이 흐트러진다.
     * 그래서 **결재건 쪽에 칸을 둔다**(2026-10-21 쓰는 분 결정 ④).
     *
     * 🔴 **넷 다 널 허용이다.** 이미 있는 결재건들이 살아남아야 한다 — NOT NULL 로 올리면
     * 그 줄들 때문에 마이그레이션이 그 자리에서 멈춘다(`decided_by_sub` 를 nullable 로 둔 것과
     * 같은 까닭).
     * 🔴 **사유 칸은 `''` 기본값을 두지 않는다.** 위 `reason`(올릴 때의 글)은 선택이라
     * `NOT NULL DEFAULT ''` 인데, **반려 사유는 필수다**(`checkRejectReason`). 빈 글자를 기본값으로
     * 두면 「안 적었다」와 「반려한 적 없다」가 같은 모양이 되어 아래 CHECK 가 가를 수 없다.
     */
    executionRejectedBy: uuid("execution_rejected_by"),
    executionRejectedByName: text("execution_rejected_by_name"),
    executionRejectedAt: timestamp("execution_rejected_at", { withTimezone: true }),
    executionRejectedReason: text("execution_rejected_reason"),
  },
  (t) => [
    /**
     * 🔴 **한 반출 신청에 살아 있는 결재건은 하나뿐이다.**
     *
     * 11c 가 「결재 중인 신청은 담당자가 바로 확인하지 못한다」로 잠글 때 기대는 사실이 이것이고,
     * **화면 검사만으로는 두 번 올라가는 것을 못 막는다**(두 사람이 같은 신청을 동시에 올릴 수
     * 있고, 화면을 거치지 않고 부를 수도 있다). 닫힌 건(`EXECUTED`·`REJECTED`·`CANCELLED`·
     * `EXECUTION_REJECTED`)은 세지 않으므로, 반려된 뒤 처음 단계부터 다시 올리는 길은 그대로
     * 열려 있다.
     *
     * 🔴 **`EXECUTION_REJECTED` 를 더하면서 조건절을 고치지 않았다 — 그게 맞는 동작이다**
     * (2026-10-21). 새 값은 `in (…)` 목록에 없으므로 **저절로 색인에서 빠져** 그 신청에 결재건을
     * 다시 올릴 수 있게 된다. 닫힌 건을 살아 있는 것으로 세면 그 신청의 [확인] 자리가 **영원히
     * 잠긴 채** 남는다(`partIssueLockFor`). 까닭 셋은 `part-issue-rules.ts` 의
     * `OPEN_PART_ISSUE_STATUSES` 주석에 적어 두었다.
     *
     * 🔴 묶는 상태 목록은 `part-issue-rules.ts` 의 `OPEN_PART_ISSUE_STATUSES` 와 같아야 한다 —
     * 시험이 그 둘을 맞춰 본다.
     */
    uniqueIndex("stock_issue_approvals_request_open_uq")
      .on(t.requestId)
      .where(sql`status in ('PENDING_APPROVAL', 'APPROVED')`),
    /** 「결재 대기」·「승인됐는데 아직 안 나간 것」 목록이 상태로 훑는다. */
    index("stock_issue_approvals_status_idx").on(t.status, t.requestedAt),
    /** 「내가 올린 진행 중인 건」이 이 사람으로 들어온다. */
    index("stock_issue_approvals_requester_idx").on(t.requestedBy, t.status),
    /**
     * 실행 기록과 상태는 **같은 말이다.** 「실행됨인데 실행한 사람이 없다」도, 「실행 기록은
     * 있는데 상태는 승인됨」도 실재해서는 안 된다. 원본의
     * `inventory_part_issue_requests_execution_metadata` 와 같은 모양이고, 원장 머리까지
     * 한 쌍에 넣었다 — 실행의 결과물이 그것이기 때문이다.
     */
    check(
      "stock_issue_approvals_execution_metadata",
      sql`
        (status <> 'EXECUTED' AND executed_by IS NULL AND executed_by_name IS NULL AND executed_at IS NULL AND entry_id IS NULL)
        OR
        (status = 'EXECUTED' AND executed_by IS NOT NULL AND executed_by_name IS NOT NULL AND executed_at IS NOT NULL AND entry_id IS NOT NULL)
      `,
    ),
    /**
     * 🔴 **실행 대기 반려 기록과 상태도 같은 말이다** (2026-10-21). 위 실행 쌍과 같은 모양이고,
     * **사유까지 한 쌍에 넣었다** — 사유 없는 반려는 올린 사람이 무엇을 고쳐야 할지 알 수 없고,
     * 앞단(`checkRejectReason`)만으로는 서버 함수를 직접 부르는 길이 열려 있다.
     *
     * ── 🔴 위 `…_execution_metadata` 를 **건드리지 않고 따로 둔 까닭** ────
     * 저 제약에 새 칸을 끌어들이면 **옛 줄이 전부 걸려 마이그레이션이 그 자리에서 실패한다**
     * (단계 표의 `…_decision_metadata` 에 `decided_by` 를 넣지 않은 것과 같은 까닭). 따로 두면
     * 옛 줄은 네 칸이 전부 NULL 이라 **첫 갈래로 통과한다** — 상태가 무엇이든 그렇다.
     *
     * ── 🔴 `status::text` 다. **`::text` 를 지우지 마라** ─────────────────
     * 위 제약처럼 `status <> 'EXECUTION_REJECTED'` 로 적으면 **이 마이그레이션이 적용 때
     * 깨진다.** `ALTER TYPE … ADD VALUE` 로 갓 더한 enum 값은 **같은 트랜잭션 안에서 쓸 수 없고**
     * (PostgreSQL: `unsafe use of new value … of enum type`), drizzle 의 migrator 는 밀린
     * 마이그레이션 **전부를 한 트랜잭션**으로 돌린다(`drizzle-orm/pg-core/dialect.js` 의
     * `session.transaction`). 파일을 둘로 쪼개도 같은 트랜잭션이라 소용없다.
     * 🔵 `status::text` 로 견주면 글자 상수가 enum 으로 변환되지 않아(= `enum_in` 을 거치지
     *    않아) 그 제한에 걸리지 않는다. 옛 줄의 상태는 **이미 커밋된** 값이라 읽는 쪽도 안전하다.
     * 🔵 뜻은 똑같다 — enum 값은 글자가 곧 값이다.
     */
    check(
      "stock_issue_approvals_execution_rejection_metadata",
      sql`
        (status::text <> 'EXECUTION_REJECTED' AND execution_rejected_by IS NULL AND execution_rejected_by_name IS NULL AND execution_rejected_at IS NULL AND execution_rejected_reason IS NULL)
        OR
        (status::text = 'EXECUTION_REJECTED' AND execution_rejected_by IS NOT NULL AND execution_rejected_by_name IS NOT NULL AND execution_rejected_at IS NOT NULL AND execution_rejected_reason IS NOT NULL AND execution_rejected_reason <> '')
      `,
    ),
  ],
);

/**
 * 단계별 결재 — 위에서부터 순서대로. **앞 단계를 `APPROVED` 로 바꾼 뒤에 다음 줄을 넣는다.**
 *
 * 🔴 **미리 전부 넣어 두지 않는다.** 그러면 「내가 결재할 건」 목록에 아직 차례가 아닌 건이
 * 섞이고, 그것을 걸러 내려면 「몇 번째까지 끝났나」를 세는 규칙이 하나 더 생긴다. 사슬로 두면
 * **열려 있는 줄이 곧 지금 차례**다.
 *
 * 🔴 다음에 결재할 단계를 고르는 규칙을 이 표가 다시 적지 않는다 — `src/lib/approval/route.ts`
 * 의 `findNextRouteStepToApprove` 하나가 쥐고 있고(신청자 본인 단계는 건너뛴다), 이 표는 그
 * 함수가 고른 단계를 적어 둘 뿐이다.
 *
 * 요청·결정이 함께 쌓이는 append 계열 표다. 결정은 그 줄의 결정 칸을 **한 번** 채우는 것으로
 * 끝나고, 그 뒤로는 고치지 않는다.
 */
export const stockIssueApprovalSteps = pgTable(
  "stock_issue_approval_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 🔵 **RESTRICT 다** — 결재건이 사라지면서 「누가 언제 무엇을 승인했나」가 함께 사라지면 안
     * 된다. 실제로는 결재건을 지우지 않으므로(무르는 길은 `CANCELLED` 상태다) 방어선이다.
     */
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => stockIssueApprovals.id, { onDelete: "restrict" }),
    /**
     * 그 판 안에서 몇 번째 단계인가(1부터).
     *
     * 🔴 **건너뛴 번호는 건너뛴 채로 적는다**(1 → 3). 1,2 로 고쳐 적으면 다음 단계를 찾을 때 옛
     * 판을 이어 셀 수 없다(`findNextRouteStepToApprove` 주석).
     */
    stepOrder: integer("step_order").notNull(),
    /** 이 단계를 결재할 사람. 🔴 **FK 없음**(머리말) — A/S 의 사용자 ID 를 글자로 적어 둘 뿐이다. */
    approverUserId: uuid("approver_user_id").notNull(),
    /**
     * 🔴 **포털(통합 로그인) 번호 — 「지금 내 차례인가」를 가르는 열쇠다**(2026-10-15 결정).
     *
     * 위 `approver_user_id` 는 A/S 의 번호이고 **이 시스템의 로그인 번호가 아니다.** 그것으로
     * 결재자를 찾으면 「내가 결재할 건」이 **영원히 빈 목록**이 된다 — 코드는 맞고 값이 안 맞는
     * 결함이라 시험으로도 안 잡힌다(까닭은 `src/lib/approval/directory.ts` 머리말).
     *
     * 🔴 **NOT NULL 이다.** 새로 만드는 줄에는 언제나 있다 — 올릴 때 결재선 단계에서 **복사해
     * 굳히고**(`part-issue.ts`), 결재선에 번호 없는 단계가 하나라도 있으면 결재건 자체를 만들지
     * 않는다(`planPartIssueApproval` 의 `MISSING_SUB`). 비울 수 있게 두면 **아무도 열 수 없는
     * 단계**가 생기고, 그 건은 영영 결재되지 않은 채 반출 신청을 붙들고 있게 된다.
     * 🔵 결재선 쪽(`approval_route_steps.approver_sub`)은 **nullable** 이다 — 거기에는 이 칸이
     * 생기기 전에 저장된 옛 판이 있다. 이 표는 그 칸이 생길 때 0행이었다(실측).
     */
    approverSub: text("approver_sub").notNull(),
    /**
     * 🔴 **올릴 때 결재선 단계에서 복사해 굳힌** 이름·역할이다. 결재선의 사본을 또 베끼는 셈이지만,
     * 그래야 나중에 결재선이 바뀌어도 「그때 누가 결재하게 돼 있었나」가 참말로 남는다. 정본은
     * 언제나 A/S 다.
     */
    approverName: text("approver_name").notNull(),
    approverRole: text("approver_role").notNull(),
    status: stockIssueApprovalStepStatusEnum("status").notNull().default("REQUESTED"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /**
     * 🔴 **실제로 누른 사람**의 포털 번호와 그때의 이름 (2026-10-21, 결재권 위임).
     *
     * 이 표에는 원래 「누가 눌렀는가」 칸이 없었다. 적힌 사람(`approver_sub`)만 누를 수 있게
     * 막아 두어 **「적힌 사람 = 누른 사람」이 언제나 참**이었기 때문이다. **위임이 그 전제를
     * 깬다** — 대리인이 누르면 둘이 달라진다(`src/db/schema/approval-delegations.ts`).
     *
     * 🔴 **값은 세 가지 뜻을 가진다:**
     *  · `NULL` — **이 칸이 생기기 전**에 결재된 옛 줄이다. 🔴 **「본인이 눌렀다」는 뜻이
     *    아니다.** 옛 줄에는 누가 눌렀는지가 어디에도 안 적혀 있다(그때는 적힐 자리가 없었다).
     *    그 둘을 같은 것으로 읽으면 과거를 지어내게 된다.
     *  · `decided_by_sub = approver_sub` — **본인**이 눌렀다.
     *  · `decided_by_sub <> approver_sub` — **대리인**이 눌렀다.
     *
     * 🔵 **본인이 눌러도 언제나 적는다**(2026-10-21 조각 2부터 — `decidePartIssueApproval` 의
     *    단계 UPDATE 한 자리가 승인·반려 둘 다에 적는다). 본인일 때
     * 비워 두면 「본인」과 「옛날 것」이 **같은 모양**이 되어 영영 가를 수 없다 — 그 순간 위의
     * 세 갈래가 둘로 뭉개지고, 「대리인이 누른 건을 전부 보여 달라」에 답할 수 없게 된다.
     *
     * 🔴 **nullable 이다.** 옛 줄이 살아남아야 한다 — NOT NULL 로 올리면 이미 결재된 줄들
     * 때문에 마이그레이션이 그 자리에서 멈춘다(`approval_route_steps.approver_sub` 를 nullable
     * 로 둔 것과 같은 까닭).
     *
     * 🔴 **아래 `…_decision_metadata` CHECK 에 이 칸을 끌어들이지 마라.** 그 제약은
     * `status`·`decided_at`·`note` 만 본다. 거기에 「결정됐으면 누른 사람도 있어야 한다」를
     * 더하면 **옛 줄이 전부 걸려 마이그레이션이 실패한다.**
     */
    decidedBySub: text("decided_by_sub"),
    decidedByName: text("decided_by_name"),
    /** 결재자가 남기는 한마디. 반려면 **사유**이고 비어 있을 수 없다(아래 CHECK). */
    note: text("note").notNull().default(""),
  },
  (t) => [
    /** 한 결재건 안에서 단계 번호는 한 번만. 사슬이 같은 단계를 두 번 열 수 없다. */
    uniqueIndex("stock_issue_approval_steps_order_uq").on(t.approvalId, t.stepOrder),
    /**
     * 🔴 한 결재건에 아직 결정되지 않은(`REQUESTED`) 줄은 **하나뿐이다.** 원본의
     * `inventory_part_issue_approvals_one_active_request` 를 그대로 본떴다 — 「한 번에 한 단계」가
     * 이 색인 하나에 걸려 있다. 서버의 트랜잭션(결재건 행 `FOR UPDATE` + 상태를 WHERE 에 건
     * UPDATE)이 1차 방어선이고, 이 색인은 경쟁 조건을 「드물다」가 아니라 「불가능하다」로 만든다.
     */
    uniqueIndex("stock_issue_approval_steps_one_open_uq").on(t.approvalId).where(sql`status = 'REQUESTED'`),
    /**
     * 🔴 **「내가 결재할 건」은 이 색인으로 들어온다** — 열쇠는 **포털 번호**다
     * (`listPartIssueApprovalsToDecide`). A/S 번호로 찾으면 아무것도 안 나온다(위 칸 주석).
     */
    index("stock_issue_approval_steps_approver_sub_idx").on(t.approverSub, t.status),
    /**
     * A/S 번호 쪽 색인. 🔵 **지우지 않고 남긴다** — 「그 사람이 어느 결재선에 있었나」를 A/S
     * 명부로 되짚는 길이고, 지우려면 `DROP INDEX` 가 마이그레이션에 들어간다(이 조각은 칸을
     * 더하기만 한다). 조회 경로는 위 색인으로 옮겼다.
     */
    index("stock_issue_approval_steps_approver_idx").on(t.approverUserId, t.status),
    /** `stepOrderFromIndex`(index + 1) 와 짝이다. 0 이나 음수는 그 판의 어느 단계와도 짝지어지지 않는다. */
    check("stock_issue_approval_steps_step_order_positive", sql`${t.stepOrder} >= 1`),
    /**
     * 결정 정보의 짝. `REQUESTED` 면 결정 시각이 비어 있고, **반려는 사유가 필수다** — 사유 없는
     * 반려는 올린 사람이 무엇을 고쳐야 할지 알 수 없고, 이 결재선은 반려되면 처음 단계부터 다시
     * 올리는 구조라 그대로 또 올라온다. 앞단은 `checkRejectReason` 이고 여기가 최종 방어선이다.
     */
    check(
      "stock_issue_approval_steps_decision_metadata",
      sql`
        (status = 'REQUESTED' AND decided_at IS NULL)
        OR
        (status = 'APPROVED' AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_at IS NOT NULL AND note <> '')
      `,
    ),
  ],
);

export type StockIssueApproval = typeof stockIssueApprovals.$inferSelect;
export type StockIssueApprovalStep = typeof stockIssueApprovalSteps.$inferSelect;
