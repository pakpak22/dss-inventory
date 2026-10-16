import type { Category, Currency, Owner } from "@/db/schema/codes";

/**
 * 목록·상세 화면에 내려보내는 부품 한 줄. **직렬화 가능한 값만** (서버 → 클라이언트 경계를 건넌다).
 * Date 도 Decimal 도 없다. 수량은 `stock_balances` 에서 가져와 붙였다.
 */
export interface PartRow {
  id: string;
  no: number;
  name: string;
  name2: string;
  /** 고객사에 나가는 서류(견적서)에 쓸 품명. 우리 품명과 다르다. 없으면 빈 문자열 (2026-10-14 결정). */
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  supplyPrice: number | null;
  supplyCurrency: Currency;
  quotePrice: number | null;
  /**
   * 한계수량 — 재고가 이 수 **이하가 되면** 종에 알린다 (2026-10-16, 같을 때도 알린다).
   * 🔴 `null` 은 「정하지 않음 = 알림 없음」이고 `0` 은 「하나도 안 남으면 알려라」는 정한 값이다
   *    (끄는 길은 비우는 것 하나뿐이다). `?? 0` 으로 뭉개지 마라.
   */
  limitQuantity: number | null;
  note: string;
  itemCode: string;
  itemName: string;
  category: Category;
  owner: Owner;
  quantity: number;
}

export interface PartItemRow {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}
