import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * 감사 로그 — append-only. 지우는 UI 를 만들지 않는다 (CLAUDE.md 11절, DESIGN 4-6절).
 *
 * 조각 1 에서는 로그인·로그아웃·로그인 거절만 쌓는다. 조각 3 에서 화면(`/audit`)과
 * 부품 등록·수정·삭제·수량 변경 기록이 더해진다.
 *
 * `actor_name` 을 따로 두는 이유: 사람 이름은 포털에서 바뀔 수 있다. "그때 누구였나" 를 남기려면
 * 그 시점의 이름을 복사해 둬야 한다 (과거 기록의 담당자 글자를 그대로 두는 것과 같은 이유).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** 행위자. 로그인 거절처럼 사람이 아직 users 에 없을 수도 있어 null 허용 */
    actorId: uuid("actor_id"),
    actorName: text("actor_name"),
    /** 예: LOGIN, LOGIN_REJECTED, LOGOUT, BACKCHANNEL_LOGOUT */
    action: text("action").notNull(),
    /** 예: "users:<uuid>", "parts:No.165" */
    target: text("target"),
    /** 바뀐 칸의 앞·뒤 값, 거절 사유 코드 등 */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_logs_occurred_at_idx").on(t.occurredAt), index("audit_logs_actor_idx").on(t.actorId)],
);

export type AuditLog = typeof auditLogs.$inferSelect;
