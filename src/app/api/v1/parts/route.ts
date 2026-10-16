import { and, asc, eq, gte } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { partOverhaulUnitPrices } from "@/db/schema/oh-templates";
import { partItems } from "@/db/schema/part-items";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import { NO_STORE, checkApiToken } from "@/lib/api/auth";
import { matchesQuery, parseApiPartsFilter, toApiPart } from "@/lib/api/parts";
import { API_PART_BALANCE_JOIN, API_PART_COLUMNS, API_PART_ITEM_JOIN, API_PART_OVERHAUL_PRICE_JOIN } from "@/lib/api/parts-query";

/**
 * GET /api/v1/parts — 부품 목록 (읽기 전용, 다른 사내 시스템용). 설명은 API.md.
 *
 * 쿼리: owner · category · item(항목 코드) · q(찾기) · since(ISO 시각, 그 뒤에 바뀐 것만).
 * 응답: { generatedAt, count, parts: ApiPart[] } No. 순. 숨긴(삭제) 부품은 빠진다.
 * 부품이 수백 개라 쪽 나누기는 두지 않는다. 1만 개가 되면 그때.
 */
export async function GET(request: NextRequest) {
  const denied = checkApiToken(request);
  if (denied) return denied;

  const parsed = parseApiPartsFilter(request.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: "bad_request", message: parsed.error }, { status: 400, headers: NO_STORE });
  const f = parsed.filter;

  const conds = [eq(parts.isDeleted, false)];
  if (f.owner) conds.push(eq(parts.owner, f.owner));
  if (f.category) conds.push(eq(parts.category, f.category));
  if (f.item) conds.push(eq(partItems.code, f.item));
  if (f.since) conds.push(gte(parts.updatedAt, f.since));

  const rows = await db()
    .select(API_PART_COLUMNS)
    .from(parts)
    .innerJoin(partItems, API_PART_ITEM_JOIN)
    .leftJoin(stockBalances, API_PART_BALANCE_JOIN)
    // 🔴 LEFT — O/H 단가를 정한 부품만 줄이 있다. INNER 로 이으면 나머지가 목록에서 사라진다.
    .leftJoin(partOverhaulUnitPrices, API_PART_OVERHAUL_PRICE_JOIN)
    .where(and(...conds))
    .orderBy(asc(parts.no));

  const list = rows.filter((r) => matchesQuery(r, f.q)).map((r) => toApiPart({ ...r, quantity: r.quantity ?? 0 }));
  return NextResponse.json({ generatedAt: new Date().toISOString(), count: list.length, parts: list }, { headers: NO_STORE });
}
