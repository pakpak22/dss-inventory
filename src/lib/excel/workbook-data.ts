import { asc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { partItems } from "@/db/schema/part-items";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import { stockEntries, stockTransactions } from "@/db/schema/stock";
import { OWNER_LABEL } from "@/lib/parts/codes";
import { ENTRY_TYPE_LABEL, sheetNoText, sheetOf } from "@/lib/stock/codes";
import type { CellValue, FullWorkbookInput } from "./full-workbook";
import { toChangeRow, toReceiveRow, toStockExportRow, toUseRow, type LedgerLine } from "./rows";

/**
 * 한 벌에 쓸 자료를 DB 에서 읽는다 (조각 7). 부품 전체 + 원장 전체(처음 수량 제외).
 *
 * 🔴 `server-only` 를 붙인 모듈(parts/queries.ts 등)을 부르지 않는다 — 이 모듈은 instrumentation(서버 시작 때 도는 1분 주기)에서도
 *    불리는데, 그 자리는 React 서버 컴포넌트 환경이 아니라 `server-only` 가 던진다. 그래서 부품 읽기를 여기서 따로 한다(listParts 와 같은 모양).
 */
export async function loadWorkbookData(): Promise<FullWorkbookInput> {
  const partRows = await db()
    .select({
      id: parts.id,
      no: parts.no,
      name: parts.name,
      name2: parts.name2,
      kyosanPartNo: parts.kyosanPartNo,
      drawingNo: parts.drawingNo,
      supplyPrice: parts.supplyPrice,
      supplyCurrency: parts.supplyCurrency,
      quotePrice: parts.quotePrice,
      note: parts.note,
      itemCode: partItems.code,
      itemName: partItems.name,
      category: parts.category,
      owner: parts.owner,
      quantity: stockBalances.quantity,
    })
    .from(parts)
    .innerJoin(partItems, eq(parts.itemId, partItems.id))
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(eq(parts.isDeleted, false))
    .orderBy(asc(parts.no));
  const partsOut = partRows.map((r) => toStockExportRow({ ...r, quantity: r.quantity ?? 0 }));

  // 원장 전체. 처음 수량(OPENING)은 부품 재고 현황의 바탕이라 시트에 줄로 적지 않는다 (DESIGN 6-2절의 수량 변경 기록 종류에 없다).
  const lines = await db()
    .select({
      transactionId: stockTransactions.id,
      entryId: stockEntries.id,
      type: stockEntries.type,
      occurredOn: stockEntries.occurredOn,
      sheetYear: stockEntries.sheetYear,
      sheetNo: stockEntries.sheetNo,
      intakeNumber: stockEntries.intakeNumber,
      noRepairCase: stockEntries.noRepairCase,
      usagePlace: stockEntries.usagePlace,
      purpose: stockEntries.purpose,
      purposeText: stockEntries.purposeText,
      counterparty: stockEntries.counterparty,
      reason: stockEntries.reason,
      entryNote: stockEntries.note,
      createdByName: stockEntries.createdByName,
      entryCreatedAt: stockEntries.createdAt,
      partNo: parts.no,
      partName: parts.name,
      partName2: parts.name2,
      partDrawingNo: parts.drawingNo,
      partKyosanPartNo: parts.kyosanPartNo,
      owner: parts.owner,
      delta: stockTransactions.delta,
      quantityBefore: stockTransactions.quantityBefore,
      quantityAfter: stockTransactions.quantityAfter,
      chargeType: stockTransactions.chargeType,
      lineNote: stockTransactions.note,
      returnsTransactionId: stockTransactions.returnsTransactionId,
      reversesTransactionId: stockTransactions.reversesTransactionId,
      lineCreatedAt: stockTransactions.createdAt,
    })
    .from(stockTransactions)
    .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
    .innerJoin(parts, eq(parts.id, stockTransactions.partId))
    .where(ne(stockEntries.type, "OPENING"))
    .orderBy(asc(stockEntries.occurredOn), asc(stockEntries.createdAt), asc(stockTransactions.createdAt), asc(parts.no));

  // 되돌린 원래 줄·소유 옮김의 상대 줄을 글자로. 모든 줄(처음 수량 포함)의 짧은 설명을 한 번에 만든다.
  const describe = new Map<string, string>();
  const allForDescribe = await db()
    .select({ id: stockTransactions.id, type: stockEntries.type, sheetYear: stockEntries.sheetYear, sheetNo: stockEntries.sheetNo, partNo: parts.no, delta: stockTransactions.delta })
    .from(stockTransactions)
    .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
    .innerJoin(parts, eq(parts.id, stockTransactions.partId));
  for (const t of allForDescribe) describe.set(t.id, `${ENTRY_TYPE_LABEL[t.type]} ${sheetNoText(t.type, t.sheetYear, t.sheetNo)} No.${t.partNo} ${t.delta > 0 ? "+" : ""}${t.delta}`);

  const byEntry = new Map<string, typeof lines>();
  for (const l of lines) byEntry.set(l.entryId, [...(byEntry.get(l.entryId) ?? []), l]);

  const useRows: CellValue[][] = [];
  const receiveRows: CellValue[][] = [];
  const changeRows: CellValue[][] = [];
  for (const l of lines) {
    const siblings = byEntry.get(l.entryId) ?? [];
    const lineIndex = siblings.findIndex((s) => s.transactionId === l.transactionId);
    const other = l.type === "TRANSFER" ? siblings.find((s) => s.transactionId !== l.transactionId) : undefined;
    const row: LedgerLine = {
      entryId: l.entryId,
      type: l.type,
      occurredOn: l.occurredOn,
      sheetNo: l.sheetNo,
      lineIndex,
      intakeNumber: l.intakeNumber,
      noRepairCase: l.noRepairCase,
      usagePlace: l.usagePlace,
      purpose: l.purpose,
      purposeText: l.purposeText,
      counterparty: l.counterparty,
      reason: l.reason,
      entryNote: l.entryNote,
      createdByName: l.createdByName,
      partName: l.partName,
      partName2: l.partName2,
      partDrawingNo: l.partDrawingNo,
      partKyosanPartNo: l.partKyosanPartNo,
      ownerLabel: OWNER_LABEL[l.owner],
      delta: l.delta,
      quantityBefore: l.quantityBefore,
      quantityAfter: l.quantityAfter,
      chargeType: l.chargeType,
      lineNote: l.lineNote,
      relatedText: (l.returnsTransactionId && describe.get(l.returnsTransactionId)) || (l.reversesTransactionId && describe.get(l.reversesTransactionId)) || "",
      transferCounterpart: other ? `No.${other.partNo} ${OWNER_LABEL[other.owner]}` : "",
    };
    const sheet = sheetOf(l.type);
    if (sheet === "USE") useRows.push(toUseRow(row));
    else if (sheet === "RECEIVE") receiveRows.push(toReceiveRow(row));
    else changeRows.push(toChangeRow(row));
  }
  return { parts: partsOut, useRows, receiveRows, changeRows };
}
