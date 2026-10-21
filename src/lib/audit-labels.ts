import { APPROVAL_ROUTE_SCOPE_LABELS, isApprovalRouteScope } from "./approval/route";
import type { AuditAction } from "./audit";
import { isEntryType, sheetNoText } from "./stock/codes";

/**
 * 변경 이력 화면(`/audit`)의 글자표. 행위 코드·칸 이름을 한글로 (CLAUDE.md 10절: 테이블명·코드를 화면에 내지 않는다).
 */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: "로그인",
  LOGIN_REJECTED: "로그인 거절",
  LOGOUT: "로그아웃",
  BACKCHANNEL_LOGOUT: "포털 로그아웃(세션 끊음)",
  PART_CREATE: "부품 등록",
  PART_UPDATE: "부품 수정",
  PART_DELETE: "부품 삭제",
  PART_ITEM_CREATE: "항목 추가",
  PART_ITEM_REORDER: "항목 순서 변경",
  STOCK_ENTRY: "수량 변경 기록",
  STOCK_CORRECTION: "기록 취소",
  INTAKE_VERIFIED: "인수번호 확인",
  STOCK_REQUEST: "반출 신청",
  STOCK_REQUEST_CONFIRMED: "반출 확인",
  // 일부 수량만 내주고 요청이 열린 채 남은 회차 (2026-10-14, 조각 4b). 「확인」과 나눈 까닭: 이력에서
  // 「다 나갔다」와 「아직 남았다」가 구별되지 않으면 나중에 무엇이 왜 남았는지 따질 수 없다.
  STOCK_REQUEST_PARTIAL: "반출 일부 불출",
  // 🔴 **반려와 다른 행위다** (2026-10-14 사용자 결정, 조각 4d). 반려는 「하나도 안 준다」, 마감은 「준 것은 그대로 두고
  // 남은 것만 접는다」이다. 이력에서 둘이 같은 글자로 보이면 나중에 「3개는 줬는데 왜 반려지?」가 된다.
  STOCK_REQUEST_CLOSED: "반출 마감(남은 수량 그만 주기)",
  STOCK_REQUEST_REJECTED: "반출 반려",
  STOCK_REQUEST_CANCELLED: "반출 신청 취소",
  // 🔴 **반려·마감과 또 다른 행위다** (2026-10-15, 조각 10a). 반려·마감은 접는 것이고, 보류는 **멈춰 두는 것**이라
  // 나중에 풀려서 다시 살아난다. 이력에서 셋이 같은 글자로 보이면 「접었다는데 왜 또 나왔지?」가 된다.
  STOCK_REQUEST_HELD: "반출 보류",
  STOCK_REQUEST_HOLD_RELEASED: "반출 보류 해제",
  // 🔴 「결재 승인」과 「불출 실행」은 **다른 사건이다** (2026-10-15, 조각 11a). 승인은 「빼도 된다」까지이고
  // 실제로 빼는 것은 재고 담당자가 따로 누른다 — 이력에서 둘이 같은 글자로 보이면 「승인은 났는데 아직 안
  // 나간 것」을 나중에 가려낼 수 없다.
  STOCK_ISSUE_APPROVAL_REQUESTED: "불출 결재 올림",
  STOCK_ISSUE_APPROVAL_APPROVED: "불출 결재 승인",
  STOCK_ISSUE_APPROVAL_REJECTED: "불출 결재 반려",
  STOCK_ISSUE_APPROVAL_EXECUTED: "불출 결재 실행(반출)",
  STOCK_ISSUE_APPROVAL_CANCELLED: "불출 결재 거둠",
  WORKBOOK_IMPORT: "현황판 엑셀 가져오기",
  WORKBOOK_PARKED: "현황판 엑셀 멈춤(엑셀 수기입)",
  WORKBOOK_RESUMED: "현황판 엑셀 다시 쓰기 시작",
  WORKBOOK_EXCEL_APPLIED: "엑셀 기준 적용(수기입 파일 → 원장)",
  APPROVAL_ROUTE_SAVED: "승인 절차 변경",
  // 🔴 「승인 절차 변경」과 **다른 일이다** (2026-10-21, 조각 3). 결재선은 그대로 두고 **누를 수 있는
  // 사람만 늘린다** — 둘이 같은 글자로 보이면 「결재선은 안 바뀌었는데 왜 저 사람이 눌렀지」의 답이
  // 이력에서 사라진다.
  APPROVAL_DELEGATION_CREATED: "결재권 위임",
  APPROVAL_DELEGATION_REVOKED: "결재권 위임 되돌림",
  OH_TEMPLATE_SAVED: "O/H 템플릿 저장",
  OH_TEMPLATE_DELETED: "O/H 템플릿 삭제",
  OH_TEMPLATE_MODEL_LINKED: "O/H 템플릿 모델 연결",
  OH_TEMPLATE_MODEL_UNLINKED: "O/H 템플릿 모델 연결 해제",
  OH_PRICE_SET: "O/H 단가 변경",
};

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[];

export function isAuditAction(v: unknown): v is AuditAction {
  return typeof v === "string" && v in AUDIT_ACTION_LABEL;
}

/** 부품 칸 이름 (수정 앞·뒤 값을 보여 줄 때) */
export const PART_FIELD_LABEL: Record<string, string> = {
  name: "품명",
  name2: "품명2",
  customerName: "고객사 품명",
  kyosanPartNo: "교산 품번",
  drawingNo: "도번",
  supplyPrice: "공급가",
  supplyCurrency: "공급가 통화",
  quotePrice: "견적가",
  // 재고가 이 수 이하가 되면 종에 알린다 (2026-10-16). 🔴 이력에 남아야 「누가 한계수량을 내려서
  // 알림이 꺼졌는지」를 나중에 따질 수 있다 — 값이 비면(`null`) 이력에 「없음」으로 그려진다.
  limitQuantity: "한계수량",
  note: "비고",
  itemCode: "항목",
  category: "분류",
  owner: "소유",
};

/**
 * 대상 글자. "parts:No.165" → "부품 No. 165", "users:<uuid>" → "사용자", "part_items:PCB" → "항목 PCB".
 * 모르는 모양은 그대로 보여 준다 (숨기면 원인을 못 찾는다).
 */
export function describeTarget(target: string | null): string {
  if (!target) return "";
  const [kind, rest] = target.split(":", 2);
  if (kind === "parts" && rest?.startsWith("No.")) return `부품 No. ${rest.slice(3)}`;
  if (kind === "users") return "사용자";
  if (kind === "part_items") return `항목 ${rest ?? ""}`.trim();
  if (kind === "requests") return "확인 대기 신청";
  // "issue_approvals:<uuid>" → "부품 불출 결재". uuid 는 사람에게 뜻이 없어 붙이지 않는다
  // (「기록 번호 entryNos」 때와 같은 까닭 — CLAUDE.md 10-12 기록).
  if (kind === "issue_approvals") return "부품 불출 결재";
  if (kind === "workbook") return "현황판 엑셀";
  // "oh_templates:표준 O/H" → "O/H 템플릿 표준 O/H". 2026-10-15 에 기종 코드를 없앤 뒤로 대상
  // 글자는 **템플릿 이름**이다. 🔵 그 전에 쌓인 줄에는 코드("oh_templates:301")가 남아 있는데,
  // 감사 로그는 append-only 라 고쳐 넣지 않는다 — 둘 다 그대로 보여 준다.
  if (kind === "oh_templates") return `O/H 템플릿 ${rest ?? ""}`.trim();
  // "approval_delegations:<uuid>" → "결재권 위임". uuid 는 사람에게 뜻이 없어 붙이지 않는다
  // (위 issue_approvals 와 같은 까닭) — 누구에게 맡겼는지는 상세(detail)의 이름이 말해 준다.
  if (kind === "approval_delegations") return "결재권 위임";
  // "approval_routes:PART_ISSUE" → "승인 절차 · 부품 불출". 용도 이름표가 적힌 곳은 approval/route.ts 하나다.
  if (kind === "approval_routes") {
    const label = isApprovalRouteScope(rest) ? APPROVAL_ROUTE_SCOPE_LABELS[rest] : rest;
    return label ? `승인 절차 · ${label}` : "승인 절차";
  }
  // "entries:USE-2026-84" → "기록 사용 US-2026-84"
  if (kind === "entries" && rest) {
    const m = /^([A-Z]+)-(\d+)-(\d+)$/.exec(rest);
    if (m && isEntryType(m[1])) {
      const label: Record<string, string> = { RECEIVE: "입고", USE: "사용", RETURN: "반환", DISPOSE: "폐기·불량", ADJUST: "조정", TRANSFER: "소유 옮김", LOAN: "대여", OPENING: "처음 수량", CORRECTION: "기록 취소" };
      return `기록 ${label[m[1]]} ${sheetNoText(m[1], Number(m[2]), Number(m[3]))}`;
    }
  }
  return target;
}
