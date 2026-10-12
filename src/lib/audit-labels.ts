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
  STOCK_REQUEST_REJECTED: "반출 반려",
  STOCK_REQUEST_CANCELLED: "반출 신청 취소",
  WORKBOOK_IMPORT: "현황판 엑셀 가져오기",
  WORKBOOK_PARKED: "현황판 엑셀 멈춤(엑셀 수기입)",
  WORKBOOK_RESUMED: "현황판 엑셀 다시 쓰기 시작",
  WORKBOOK_EXCEL_APPLIED: "엑셀 기준 적용(수기입 파일 → 원장)",
};

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[];

export function isAuditAction(v: unknown): v is AuditAction {
  return typeof v === "string" && v in AUDIT_ACTION_LABEL;
}

/** 부품 칸 이름 (수정 앞·뒤 값을 보여 줄 때) */
export const PART_FIELD_LABEL: Record<string, string> = {
  name: "품명",
  name2: "품명2",
  kyosanPartNo: "교산 품번",
  drawingNo: "도번",
  supplyPrice: "공급가",
  supplyCurrency: "공급가 통화",
  quotePrice: "견적가",
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
  if (kind === "workbook") return "현황판 엑셀";
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
