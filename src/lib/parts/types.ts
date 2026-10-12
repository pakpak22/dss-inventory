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
  kyosanPartNo: string;
  drawingNo: string;
  supplyPrice: number | null;
  supplyCurrency: Currency;
  quotePrice: number | null;
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
