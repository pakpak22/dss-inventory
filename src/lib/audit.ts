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
  /**
   * 보류 걸기·풀기 (2026-10-15, 조각 10a).
   * 🔴 **보류 사유가 영영 남는 곳은 여기뿐이다** — 신청 표의 `hold_reason` 은 풀 때 비워지고(지금 보류 중인 것만
   *    들고 있다), 감사 로그는 append-only 다. 그래서 거는 쪽 `detail.reason` 에 사유를 싣는다.
   */
  | "STOCK_REQUEST_HELD"
  | "STOCK_REQUEST_HOLD_RELEASED"
  /**
   * 부품 불출 결재 — 다섯 (2026-10-15, 조각 11a). 반출 신청 하나를 여러 사람에게 순서대로 결재받는 길이다.
   *
   * 🔴 **`APPROVED` 와 `EXECUTED` 를 가른 것이 여기에도 그대로 나타난다** — 「승인했다」와
   *    「실제로 뺐다」는 다른 사건이고, 이력에서 둘이 같은 글자로 보이면 「승인만 났지 아직 안
   *    나간 것」을 나중에 가려낼 수 없다.
   * 🔵 반출 신청 쪽 `STOCK_REQUEST_*` 와 **일부러 다른 이름**이다. 저쪽은 「담당자가 확인했다」
   *    한 번이고, 이쪽은 그 앞에 붙는 결재 사슬이다. 실행이 성공하면 **둘 다** 남는다 —
   *    `STOCK_ISSUE_APPROVAL_EXECUTED`(결재건이 실행됐다)와 `confirmRequest` 가 쓰는
   *    `STOCK_REQUEST_CONFIRMED`·`_PARTIAL`(신청이 나갔다). 겹쳐 보이지만 가리키는 것이 다르다.
   */
  | "STOCK_ISSUE_APPROVAL_REQUESTED"
  | "STOCK_ISSUE_APPROVAL_APPROVED"
  | "STOCK_ISSUE_APPROVAL_REJECTED"
  | "STOCK_ISSUE_APPROVAL_EXECUTED"
  | "STOCK_ISSUE_APPROVAL_CANCELLED"
  /**
   * **실행 대기에서 담당자가 막았다** (2026-10-21).
   *
   * 🔴 `STOCK_ISSUE_APPROVAL_REJECTED` 를 **재사용하지 않는다.** 저것은 결재자가 **결재 중에**
   *    반려한 것이고 사유가 **단계 줄**에 적힌다. 이쪽은 결재가 다 끝난 뒤 담당자가 막은 것이라
   *    사유가 **결재건 쪽 칸**(`execution_rejected_reason`)에 적힌다 — 같은 글자로 남기면
   *    되짚는 사람이 「누가 왜 막았나」를 **엉뚱한 표에서** 찾게 된다.
   * 🔵 `STOCK_ISSUE_APPROVAL_CANCELLED`(거둠)와도 다르다: 그것은 **올린 사람이** 무르는 길이다.
   */
  | "STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED"
  | "WORKBOOK_IMPORT"
  | "WORKBOOK_PARKED"
  | "WORKBOOK_RESUMED"
  | "WORKBOOK_EXCEL_APPLIED"
  /** 승인 절차(결재선)에 판을 하나 얹었다 (조각 ③b). 판 자체가 이력이라 전용 이력 표를 두지 않는다. */
  | "APPROVAL_ROUTE_SAVED"
  /**
   * 결재권 위임 — 맡기기와 되돌리기 (2026-10-21, 조각 3).
   *
   * 🔴 **승인 절차 변경과 가른다.** 결재선은 「누가 결재하게 돼 있나」를 바꾸는 일이고, 위임은
   *    결재선을 한 글자도 건드리지 않은 채 **누를 수 있는 사람만 늘리는** 일이다. 이력에서 둘이
   *    같은 글자로 보이면 「결재선은 그대로인데 왜 저 사람이 눌렀지」에 답할 수 없다.
   * 🔵 되돌리기를 따로 두는 까닭: 표는 줄을 지우지 않고 깃발만 세우므로, 「언제 거뒀나」가
   *    남는 곳이 `revoked_at` 과 이 줄 둘이다 — 사람이 이력을 훑을 때 보는 것은 이쪽이다.
   */
  | "APPROVAL_DELEGATION_CREATED"
  | "APPROVAL_DELEGATION_REVOKED"
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
