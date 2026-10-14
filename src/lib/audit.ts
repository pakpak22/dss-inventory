import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";

/**
 * 감사 로그 쓰기. append-only (CLAUDE.md 11절).
 *
 * 두 가지 쓰임:
 *  - `writeAudit(input)`: 로그인·로그아웃처럼 **본 작업과 따로** 남기는 것. 실패해도 본 작업을 막지 않는다
 *    (로그인이 감사 로그 때문에 안 되면 사람들이 시스템을 못 쓰고, 그 편이 더 큰 사고다). 서버 로그에는 남긴다.
 *  - `auditValues(input)` 을 트랜잭션 안에서 `tx.insert(auditLogs).values(...)` 로: 부품 등록·수정·삭제·수량 변경처럼
 *    **"기록이 곧 본 작업"** 인 경우. 본 작업과 한 묶음으로 되거나 둘 다 안 되거나.
 */
export type AuditAction =
  | "LOGIN"
  | "LOGIN_REJECTED"
  | "LOGOUT"
  | "BACKCHANNEL_LOGOUT"
  | "PART_CREATE"
  | "PART_UPDATE"
  | "PART_DELETE"
  | "PART_ITEM_CREATE"
  | "PART_ITEM_REORDER"
  | "STOCK_ENTRY"
  | "STOCK_CORRECTION"
  | "INTAKE_VERIFIED"
  | "STOCK_REQUEST"
  | "STOCK_REQUEST_CONFIRMED"
  | "STOCK_REQUEST_PARTIAL"
  | "STOCK_REQUEST_CLOSED"
  | "STOCK_REQUEST_REJECTED"
  | "STOCK_REQUEST_CANCELLED"
  | "WORKBOOK_IMPORT"
  | "WORKBOOK_PARKED"
  | "WORKBOOK_RESUMED"
  | "WORKBOOK_EXCEL_APPLIED";

export interface AuditInput {
  action: AuditAction;
  actorId?: string | null;
  actorName?: string | null;
  /** 예: "users:<uuid>", "parts:No.165", "part_items:PCB" */
  target?: string | null;
  detail?: Record<string, unknown>;
}

export function auditValues(input: AuditInput): typeof auditLogs.$inferInsert {
  return {
    action: input.action,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    target: input.target ?? null,
    detail: input.detail ?? null,
  };
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db().insert(auditLogs).values(auditValues(input));
  } catch (e) {
    console.error("[audit] 감사 로그 쓰기 실패:", input.action, e instanceof Error ? e.message : e);
  }
}
