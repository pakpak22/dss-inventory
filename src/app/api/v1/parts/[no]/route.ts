import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { partItems } from "@/db/schema/part-items";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import { NO_STORE, checkApiToken } from "@/lib/api/auth";
import { toApiPart } from "@/lib/api/parts";

/** GET /api/v1/parts/{no} — 부품 하나 (No. 로). 없거나 숨긴 것은 404. 설명은 API.md. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  const denied = checkApiToken(request);
  if (denied) return denied;

  const { no: raw } = await params;
  if (!/^\d+$/.test(raw)) return NextResponse.json({ error: "bad_request", message: "no 는 부품 No.(양의 정수)입니다." }, { status: 400, headers: NO_STORE });
  const no = Number(raw);

  const [r] = await db()
    .select({
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
      updatedAt: parts.updatedAt,
      quantity: stockBalances.quantity,
    })
    .from(parts)
    .innerJoin(partItems, eq(parts.itemId, partItems.id))
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(and(eq(parts.no, no), eq(parts.isDeleted, false)))
    .limit(1);

  if (!r) return NextResponse.json({ error: "not_found", message: `No. ${no} 부품이 없습니다.` }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ part: toApiPart({ ...r, quantity: r.quantity ?? 0 }) }, { headers: NO_STORE });
}
