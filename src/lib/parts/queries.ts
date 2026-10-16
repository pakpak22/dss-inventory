import "server-only";
import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { partItems } from "@/db/schema/part-items";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import type { PartItemRow, PartRow } from "./types";

/**
 * 부품 전체를 No. 순으로 한 번에 읽는다. 찾기·거르기·정렬은 화면(브라우저)에서 한다 —
 * 부품이 319개라 A/S 재고 목록과 같은 방식이 맞다 (DESIGN 2-1절). 1만 개가 되면 그때 서버 쪽으로 옮긴다.
 *
 * 숨긴(소프트 삭제) 부품은 빼고, 수량이 아직 없는 부품(stock_balances 줄이 없음)은 0 으로 본다.
 * 재고 0 인 부품도 항상 보인다 (REQUIREMENTS 3절).
 */
export async function listParts(): Promise<PartRow[]> {
  const rows = await db()
    .select({
      id: parts.id,
      no: parts.no,
      name: parts.name,
      name2: parts.name2,
      customerName: parts.customerName,
      kyosanPartNo: parts.kyosanPartNo,
      drawingNo: parts.drawingNo,
      supplyPrice: parts.supplyPrice,
      supplyCurrency: parts.supplyCurrency,
      quotePrice: parts.quotePrice,
      limitQuantity: parts.limitQuantity,
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

  return rows.map((r) => ({ ...r, quantity: r.quantity ?? 0 }));
}

/** 항목 목록(고르기 상자용). 숨긴 것은 빼고 차례대로. */
export async function listPartItems(): Promise<PartItemRow[]> {
  return db()
    .select({ id: partItems.id, code: partItems.code, name: partItems.name, sortOrder: partItems.sortOrder })
    .from(partItems)
    .where(eq(partItems.isDeleted, false))
    .orderBy(asc(partItems.sortOrder), asc(partItems.name));
}

/* ───────────── 조각 3: 수정 화면·변경 이력 ───────────── */

/** 수정 화면용 — 목록 줄에 항목 id 를 더한 것 (폼의 <select> 값). */
export interface PartEditRow extends PartRow {
  itemId: string;
}

/** No. 로 부품 하나. 숨긴 것은 없는 것으로 본다. */
export async function findPartByNo(no: number): Promise<PartEditRow | null> {
  const rows = await db()
    .select({
      id: parts.id,
      no: parts.no,
      name: parts.name,
      name2: parts.name2,
      customerName: parts.customerName,
      kyosanPartNo: parts.kyosanPartNo,
      drawingNo: parts.drawingNo,
      supplyPrice: parts.supplyPrice,
      supplyCurrency: parts.supplyCurrency,
      quotePrice: parts.quotePrice,
      limitQuantity: parts.limitQuantity,
      note: parts.note,
      itemId: parts.itemId,
      itemCode: partItems.code,
      itemName: partItems.name,
      category: parts.category,
      owner: parts.owner,
      quantity: stockBalances.quantity,
    })
    .from(parts)
    .innerJoin(partItems, eq(parts.itemId, partItems.id))
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(and(eq(parts.no, no), eq(parts.isDeleted, false)))
    .limit(1);
  const r = rows[0];
  return r ? { ...r, quantity: r.quantity ?? 0 } : null;
}

/* ------------------------------------------------------------------ */
/* 머리말의 알림 종이 쓰는 조회 (2026-10-16)                            */
/* 🔴 위의 함수들은 화면이 쓰고 있다 — 동작을 바꾸지 않고 **더하기만** 한다. */
/* ------------------------------------------------------------------ */

/** 종에 실을 「재고가 한계수량 이하인 부품」 한 줄. 종에 필요한 칸만 받는다. */
export interface LowStockPartRow {
  /** 사람이 읽는 번호. 🔵 알림 id 와 `/?part=` 주소가 **이 값**에서 나온다. */
  no: number;
  name: string;
  name2: string;
  /** 지금 재고. 🔴 목록의 「수량」과 **같은 값**이다(아래 머리말). */
  quantity: number;
  /** 🔴 여기까지 온 줄은 `null` 이 아니다 — WHERE 가 걸렀다. */
  limitQuantity: number;
}

/**
 * 재고가 한계수량 **이하인** 부품 — 모자란 만큼 큰 순서로 (2026-10-16 사용자 요청).
 *
 * ── 🔴 어느 수와 견주는가 ───────────────────────────────────────────────
 * **재고 현황 목록(`/`)이 「수량」으로 보여 주는 바로 그 값**과 견준다. 그 값은 위
 * `listParts()` 가 읽는 `stock_balances.quantity` 이고, 수량 줄이 아직 없는 부품은 **0** 으로
 * 본다(`leftJoin` + `coalesce`) — 저쪽의 `?? 0` 과 같은 말이다. 다른 수(예: 신청에 묶여 아직
 * 안 나간 수량을 뺀 잔량)를 쓰면 「목록엔 5개인데 알림은 모자라다고 한다」가 된다.
 *
 * ── 🔴 재고 **≤** 한계수량. **같을 때도 알린다** ───────────────────────
 * 2026-10-16 사용자 결정이다(처음엔 「미만」으로 만들었다가 같은 날 바뀌었다). 뜻은
 * 「한계수량까지 내려왔으면 이미 채울 때다」.
 * 🔴 **부등호를 여기에 손으로 적은 것이 아니다** — 뜻은 `lib/parts/codes.ts` 의 `isLowStock`
 *    한 곳에 있고(조립과 상세 창의 「부족」 딱지가 그것을 부른다), 이 WHERE 는 그 함수를 SQL 로
 *    옮긴 것이다. 🔴 **한쪽만 고치면 「종에는 뜨는데 눌러도 없는」 줄이 생긴다** — 둘을 함께 고쳐라.
 *    `tests/part-limit-quantity.test.ts` 가 두 자리가 같은 말인지 잰다.
 * 🔴 **한계수량 `0` 은 끄는 값이 아니다.** 재고가 0 이면 `0 <= 0` 이라 **울린다**(= 「하나도 안
 *    남으면 알려라」). 끄는 길은 **칸을 비우는 것(`null`) 하나뿐**이다.
 *
 * - 🔴 한계수량이 `null`(정하지 않음)인 부품은 아예 세지 않는다 — `IS NOT NULL` 이 그 울타리다.
 *   `coalesce(limit_quantity, 0)` 같은 것을 쓰면 **정하지 않은 부품이 재고 0 이 되는 순간 전부**
 *   알림 대상이 된다(「이하」가 된 뒤로는 더 날카로워진 함정이다).
 * - 🔴 **지워진(소프트 삭제) 부품은 세지 않는다** — `parts_not_deleted_idx` 를 타는 그 조건이다.
 * - `total` 은 **상한에 걸리기 전의 전체 종수**다. 종이 「그 밖에 N종」을 참말로 적으려면 필요하다.
 *   창 함수는 WHERE 뒤·LIMIT 앞에 계산되므로 세는 질의를 따로 보내지 않아도 된다 — 종은 모든
 *   화면에 딸려 오므로 왕복 한 번이 곧 모든 화면의 비용이다(`listRejectedRequestsFor` 와 같은 결).
 * - 차례는 **모자란 만큼(한계수량 − 재고)이 큰 순**, 같으면 No. 순. 상한에서 잘릴 때 급한 것이
 *   남아야 하기 때문이다.
 */
export async function listLowStockParts(limit: number): Promise<{ rows: LowStockPartRow[]; total: number }> {
  // 🔵 수량 줄이 없는 부품을 0 으로 보는 셈을 세 군데(WHERE·ORDER BY·결과)에서 같은 글자로 쓴다.
  const quantity = sql<number>`coalesce(${stockBalances.quantity}, 0)`;
  const rows = await db()
    .select({
      no: parts.no,
      name: parts.name,
      name2: parts.name2,
      quantity: quantity.mapWith(Number),
      limitQuantity: parts.limitQuantity,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(parts)
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(and(eq(parts.isDeleted, false), isNotNull(parts.limitQuantity), sql`coalesce(${stockBalances.quantity}, 0) <= ${parts.limitQuantity}`))
    .orderBy(sql`${parts.limitQuantity} - coalesce(${stockBalances.quantity}, 0) desc`, asc(parts.no))
    .limit(limit);
  if (rows.length === 0) return { rows: [], total: 0 };
  return {
    // 🔴 `limitQuantity` 는 WHERE 가 null 을 걸러 여기까지 올 수 없다. 타입만 좁힌다.
    rows: rows.map((r) => ({ no: r.no, name: r.name, name2: r.name2, quantity: r.quantity, limitQuantity: r.limitQuantity ?? 0 })),
    total: rows[0].total,
  };
}

/** 설정 화면용 — 항목 전체(숨긴 것 포함하지 않음) + 각 항목을 쓰는 부품 수. */
export interface PartItemAdminRow extends PartItemRow {
  partCount: number;
}

export async function listPartItemsForAdmin(): Promise<PartItemAdminRow[]> {
  const rows = await db()
    .select({
      id: partItems.id,
      code: partItems.code,
      name: partItems.name,
      sortOrder: partItems.sortOrder,
      partCount: sql<number>`count(${parts.id}) filter (where ${parts.isDeleted} = false)`.mapWith(Number),
    })
    .from(partItems)
    .leftJoin(parts, eq(parts.itemId, partItems.id))
    .where(eq(partItems.isDeleted, false))
    .groupBy(partItems.id)
    .orderBy(asc(partItems.sortOrder), asc(partItems.name));
  return rows;
}

/** 변경 이력 한 줄. 시각은 ISO 문자열(직렬화 가능). */
export interface AuditRow {
  id: string;
  occurredAt: string;
  actorName: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
}

export async function listAuditLogs(opts: { page: number; size: number; action: string | null; target?: string | null }): Promise<{ rows: AuditRow[]; total: number }> {
  const conds = [];
  if (opts.action) conds.push(eq(auditLogs.action, opts.action));
  if (opts.target) conds.push(eq(auditLogs.target, opts.target));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const [countRow] = await db().select({ n: count() }).from(auditLogs).where(where);
  const total = countRow?.n ?? 0;
  const offset = (Math.max(1, opts.page) - 1) * opts.size;
  const rows = await db()
    .select({
      id: auditLogs.id,
      occurredAt: auditLogs.occurredAt,
      actorName: auditLogs.actorName,
      action: auditLogs.action,
      target: auditLogs.target,
      detail: auditLogs.detail,
    })
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.occurredAt))
    .limit(opts.size)
    .offset(offset);
  return { rows: rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString(), detail: r.detail ?? null })), total };
}
