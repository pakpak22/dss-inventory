import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { partOverhaulUnitPrices } from "@/db/schema/oh-templates";
import { partItems } from "@/db/schema/part-items";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import { NO_STORE, checkApiToken } from "@/lib/api/auth";
import { toApiPart } from "@/lib/api/parts";
import { API_PART_BALANCE_JOIN, API_PART_COLUMNS, API_PART_ITEM_JOIN, API_PART_OVERHAUL_PRICE_JOIN } from "@/lib/api/parts-query";

/** GET /api/v1/parts/{no} — 부품 하나 (No. 로). 없거나 숨긴 것은 404. 설명은 API.md. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  const denied = checkApiToken(request);
  if (denied) return denied;

  const { no: raw } = await params;
  if (!/^\d+$/.test(raw)) return NextResponse.json({ error: "bad_request", message: "no 는 부품 No.(양의 정수)입니다." }, { status: 400, headers: NO_STORE });
  const no = Number(raw);

  const [r] = await db()
    // 🔵 칸 한 벌과 잇는 법을 목록과 **함께 쓴다** — 따로 적으면 칸을 더하는 날 한쪽만 고쳐진다.
    .select(API_PART_COLUMNS)
    .from(parts)
    .innerJoin(partItems, API_PART_ITEM_JOIN)
    .leftJoin(stockBalances, API_PART_BALANCE_JOIN)
    .leftJoin(partOverhaulUnitPrices, API_PART_OVERHAUL_PRICE_JOIN)
    .where(and(eq(parts.no, no), eq(parts.isDeleted, false)))
    .limit(1);

  if (!r) return NextResponse.json({ error: "not_found", message: `No. ${no} 부품이 없습니다.` }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ part: toApiPart({ ...r, quantity: r.quantity ?? 0 }) }, { headers: NO_STORE });
}
