import { CATEGORY_LABEL, OWNER_LABEL } from "@/lib/parts/codes";
import type { PartRow } from "@/lib/parts/types";
import { ENTRY_TYPE_LABEL, PURPOSE_LABEL, type ChargeType, type EntryType, type Purpose } from "@/lib/stock/codes";
import type { CellValue } from "./full-workbook";
import type { StockExportRow } from "./stock-workbook";

/**
 * 부품에서 **엑셀이 쓰는 12칸만** 뽑은 것. 🔴 `PartRow` 를 통째로 받지 않으려고 둔 타입이다 — 되돌리지 마라.
 *
 * 왜: 부품에 칸이 늘어도 엑셀로 새지 않게 하려는 것이다. 돌려주는 타입(`StockExportRow`)은 원래부터
 * 별개였지만 **받는 타입이 `PartRow` 였던 탓에** 부품에 칸 하나만 더해도 (a) 여기가 조용히 따라 넓어지고
 * (b) 손으로 같은 모양을 만드는 `workbook-data.ts` 의 부품 읽기가 타입에서 깨졌다
 * (2026-10-14 부품에 「고객사 품명」 칸을 더하다 실제로 깨졌다).
 * 좁혀 두면 「엑셀은 이 12칸만 받는다」가 타입으로 못 박혀 둘 다 일어나지 않는다.
 *
 * 🔴 이 파일에 엑셀로 안 나가는 칸의 **이름을 적지도 마라** — 유출 검사가 grep 이라 주석도 걸린다.
 * 🔵 엑셀에 칸을 **정말로 더해야 하면** 이 목록 + `StockExportRow` + `fillPartsSheet` 의 열 문자 +
 *    비교 코드의 `columns` + 가져오기 머리글 + 양식 `.xlsx` 를 한꺼번에 고쳐야 한다.
 */
type PartExportSource = Pick<
  PartRow,
  "no" | "name" | "name2" | "kyosanPartNo" | "drawingNo" | "quantity" | "supplyPrice" | "supplyCurrency" | "quotePrice" | "note" | "itemName" | "category" | "owner"
>;

/**
 * DB 줄 → 엑셀 칸 값 (순수 함수). 어느 시트에 어떤 글자로 쓰는지는 전부 여기 — 엑셀 모양이 바뀌면 여기 한 곳.
 * 엑셀 관용구는 사용처 기입란의 옛 줄을 따른다: 없는 글자는 `-`, 비고만 빈칸, 한 건의 둘째 줄부터는 No. 칸이 비어 있다.
 */
export function toStockExportRow(p: PartExportSource): StockExportRow {
  return {
    no: p.no,
    name: p.name,
    name2: p.name2,
    kyosanPartNo: p.kyosanPartNo,
    drawingNo: p.drawingNo,
    quantity: p.quantity,
    supplyPrice: p.supplyPrice,
    supplyCurrency: p.supplyCurrency,
    quotePrice: p.quotePrice,
    note: p.note,
    itemName: p.itemName,
    categoryLabel: CATEGORY_LABEL[p.category],
    ownerLabel: OWNER_LABEL[p.owner],
  };
}

/** 원장 한 줄 + 그 머리 — 엑셀 줄 하나의 재료 */
export interface LedgerLine {
  entryId: string;
  type: EntryType;
  occurredOn: string;
  sheetNo: number;
  /** 같은 건 안에서 몇 번째 줄인가 (0부터). 0 이 아니면 No. 칸을 비운다. */
  lineIndex: number;
  intakeNumber: string;
  noRepairCase: boolean;
  usagePlace: string;
  purpose: Purpose | null;
  purposeText: string;
  counterparty: string;
  reason: string;
  entryNote: string;
  createdByName: string;
  partName: string;
  partName2: string;
  partDrawingNo: string;
  partKyosanPartNo: string;
  ownerLabel: string;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  chargeType: ChargeType | null;
  lineNote: string;
  /** 반환·기록 취소가 되돌린 원래 줄의 짧은 설명 (없으면 빈 값) */
  relatedText: string;
  /** 소유 옮김의 상대 줄 (없으면 빈 값) */
  transferCounterpart: string;
}

const dash = (s: string) => (s === "" ? "-" : s);

/** 「목적 및 출하담당」: 「수리/정영빈」 꼴. 기타면 적은 글자. */
export function purposeActorText(purpose: Purpose | null, purposeText: string, actor: string): string {
  if (purpose === null) return actor;
  const p = purpose === "OTHER" ? purposeText || PURPOSE_LABEL.OTHER : PURPOSE_LABEL[purpose];
  return `${p}/${actor}`;
}

export function toUseRow(l: LedgerLine): CellValue[] {
  return [
    l.lineIndex === 0 ? l.sheetNo : null,
    { date: l.occurredOn },
    l.noRepairCase ? "-" : dash(l.intakeNumber),
    l.partName,
    dash(l.partName2),
    dash(l.partDrawingNo),
    dash(l.partKyosanPartNo),
    l.quantityBefore,
    Math.abs(l.delta),
    l.quantityAfter,
    purposeActorText(l.purpose, l.purposeText, l.createdByName),
    [l.lineNote, l.entryNote].filter(Boolean).join(" / "),
    l.ownerLabel,
    l.chargeType === "PAID" ? "유상" : l.chargeType === "FREE" ? "무상" : "-",
    l.noRepairCase ? dash(l.reason) : dash(l.usagePlace),
  ];
}

export function toReceiveRow(l: LedgerLine): CellValue[] {
  return [l.lineIndex === 0 ? l.sheetNo : null, { date: l.occurredOn }, l.partName, dash(l.partName2), dash(l.partDrawingNo), dash(l.partKyosanPartNo), l.quantityBefore, Math.abs(l.delta), l.quantityAfter, [l.lineNote, l.entryNote].filter(Boolean).join(" / "), l.ownerLabel];
}

/** 수량 변경 기록의 「상대」: 대여는 빌려준 곳, 소유 옮김은 상대 부품, 반환·기록 취소는 되돌린 원래 줄 */
export function changeCounterpartText(l: LedgerLine): string {
  switch (l.type) {
    case "LOAN":
      return dash(l.counterparty);
    case "TRANSFER":
      return dash(l.transferCounterpart);
    case "RETURN":
    case "CORRECTION":
      return dash(l.relatedText);
    default:
      return "-";
  }
}

export function toChangeRow(l: LedgerLine): CellValue[] {
  const note = [l.reason, l.lineNote, l.entryNote].filter(Boolean).join(" / ");
  return [
    l.lineIndex === 0 ? l.sheetNo : null,
    { date: l.occurredOn },
    ENTRY_TYPE_LABEL[l.type],
    l.partName,
    dash(l.partName2),
    dash(l.partDrawingNo),
    dash(l.partKyosanPartNo),
    l.quantityBefore,
    l.delta,
    l.quantityAfter,
    l.createdByName,
    note,
    l.ownerLabel,
    changeCounterpartText(l),
  ];
}
