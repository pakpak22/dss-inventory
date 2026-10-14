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
  | "WORKBOOK_EXCEL_APPLIED"
  /** 승인 절차(결재선)에 판을 하나 얹었다 (조각 ③b). 판 자체가 이력이라 전용 이력 표를 두지 않는다. */
  | "APPROVAL_ROUTE_SAVED"
  /**
   * O/H 부품 템플릿 (조각 8a). 🔵 **마이그레이션이 필요 없다** — `audit_logs.action` 은 글자 칸이다.
   * 🔴 여기와 `audit-labels.ts` **둘 다**에 적어야 한다(한쪽만 더하면 타입 검사가 잡아 준다).
   *
   * 저장은 등록·수정을 가르지 않는다 — 부품 줄을 통째로 갈아 끼우는 한 가지 일이고, 「처음인가」는
   * detail 의 `created` 와 판 번호가 말해 준다.
   */
  | "OH_TEMPLATE_SAVED"
  | "OH_TEMPLATE_DELETED"
  | "OH_TEMPLATE_MODEL_LINKED"
  | "OH_TEMPLATE_MODEL_UNLINKED"
  /** 부품당 O/H 단가. 🔴 대상이 **부품**이라 부품 상세의 [변경 이력]에서 함께 보인다. */
  | "OH_PRICE_SET";

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
