import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import type { Owner } from "@/db/schema/codes";
import { partItems } from "@/db/schema/part-items";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import { auditValues } from "@/lib/audit";
import { markWorkbookDirty } from "@/lib/excel/workbook-sync";
import { partHasTransactions } from "@/lib/stock/queries";
import { customerNameFillAudit, type CustomerNameFiller } from "./customer-name";
import { diffPartInput, type PartChanges, type PartInput, type PartItemFieldErrors, type PartItemInput } from "./form";

/**
 * 부품·항목을 **바꾸는** 일 (조각 3). 서버 액션만 부른다.
 *
 * 규칙:
 *  - 본 작업과 감사 로그를 **한 트랜잭션**에 쓴다 (CLAUDE.md 2-0절: 누가 언제 무엇을 했는지). 둘 중 하나만 되는 일은 없다.
 *  - 수량은 여기서 건드리지 않는다. 등록 때 stock_balances 에 0 줄을 만드는 것까지만 (수량은 조각 4 의 원장이 바꾼다).
 *  - 지우기는 소프트 삭제 4칸 (11절). 물리 DELETE 는 없다.
 */
export interface Actor {
  id: string;
  name: string;
}

export interface DuplicatePart {
  no: number;
  name: string;
  name2: string;
  drawingNo: string;
  owner: Owner;
  quantity: number;
  /** 품명·품명2·도번·소유가 **전부** 같은가. false 면 품명만 같은 것. */
  exact: boolean;
}

/**
 * 같은 이름의 부품 (DESIGN 2-3절). 금지가 아니라 **보여 주고 확인**만 받는다 —
 * 구입 명목이 달라 같은 이름을 따로 세는 부품이 실제로 16묶음 있다 (REQUIREMENTS 4-1절).
 *
 * 품명이 같은 것을 전부 돌려주고, 네 칸(품명·품명2·도번·소유)이 다 같은 것은 `exact` 로 표시한다.
 * 처음엔 네 칸이 다 같을 때만 보여 줬는데, 사용자가 품명만 같은 경우에도 경고를 기대했다(2026-10-06 확인).
 * 경고일 뿐이라 넓혀도 해롭지 않다. exact 가 앞에 온다.
 */
export async function findDuplicateParts(input: Pick<PartInput, "name" | "name2" | "drawingNo" | "owner">, excludeId?: string): Promise<DuplicatePart[]> {
  const conds = [eq(parts.isDeleted, false), eq(parts.name, input.name)];
  if (excludeId) conds.push(ne(parts.id, excludeId));
  const rows = await db()
    .select({
      no: parts.no,
      name: parts.name,
      name2: parts.name2,
      drawingNo: parts.drawingNo,
      owner: parts.owner,
      quantity: stockBalances.quantity,
    })
    .from(parts)
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(and(...conds))
    .orderBy(asc(parts.no));
  return rows
    .map((r) => ({
      ...r,
      quantity: r.quantity ?? 0,
      exact: r.name2 === input.name2 && r.drawingNo === input.drawingNo && r.owner === input.owner,
    }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.no - b.no);
}

async function itemCodeOf(itemId: string): Promise<string> {
  const [r] = await db().select({ code: partItems.code }).from(partItems).where(eq(partItems.id, itemId)).limit(1);
  return r?.code ?? itemId;
}

export async function createPart(input: PartInput, actor: Actor): Promise<{ no: number }> {
  const itemCode = await itemCodeOf(input.itemId);
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(parts)
      .values({ ...input, createdBy: actor.id, updatedBy: actor.id })
      .returning({ id: parts.id, no: parts.no });
    await tx.insert(stockBalances).values({ partId: row.id, quantity: 0 });
    await markWorkbookDirty(tx); // 부품·항목이 바뀌면 엑셀 한 벌 「써야 함」 (조각 7)
    await tx.insert(auditLogs).values(
      auditValues({
        action: "PART_CREATE",
        actorId: actor.id,
        actorName: actor.name,
        target: `parts:No.${row.no}`,
        detail: { name: input.name, name2: input.name2, drawingNo: input.drawingNo, owner: input.owner, category: input.category, itemCode },
      }),
    );
    return { no: row.no };
  });
}

export type UpdatePartResult = { ok: true; no: number; changes: PartChanges } | { ok: false; code: "not_found" };

export async function updatePart(id: string, input: PartInput, actor: Actor): Promise<UpdatePartResult> {
  const [before] = await db().select().from(parts).where(and(eq(parts.id, id), eq(parts.isDeleted, false))).limit(1);
  if (!before) return { ok: false, code: "not_found" };

  const beforeInput: PartInput = {
    name: before.name,
    name2: before.name2,
    customerName: before.customerName,
    kyosanPartNo: before.kyosanPartNo,
    drawingNo: before.drawingNo,
    supplyPrice: before.supplyPrice,
    supplyCurrency: before.supplyCurrency,
    quotePrice: before.quotePrice,
    note: before.note,
    itemId: before.itemId,
    category: before.category,
    owner: before.owner,
  };
  const changes = diffPartInput(beforeInput, input);
  if (Object.keys(changes).length === 0) return { ok: true, no: before.no, changes };

  // 감사 로그에는 항목을 id 가 아니라 코드로 남긴다 (사람이 읽는 값).
  if (changes.itemId) {
    changes.itemId = { before: await itemCodeOf(before.itemId), after: await itemCodeOf(input.itemId) };
  }

  const now = new Date();
  await db().transaction(async (tx) => {
    await tx
      .update(parts)
      .set({ ...input, updatedBy: actor.id, updatedAt: now })
      .where(eq(parts.id, id));
    await markWorkbookDirty(tx); // 부품·항목이 바뀌면 엑셀 한 벌 「써야 함」 (조각 7)
    await tx.insert(auditLogs).values(
      auditValues({
        action: "PART_UPDATE",
        actorId: actor.id,
        actorName: actor.name,
        target: `parts:No.${before.no}`,
        // supplyCurrency 는 바뀌지 않아도 남긴다 — 변경 이력 화면이 공급가 앞·뒤 값에 ¥/₩ 를 붙일 때 쓴다.
        detail: { changes, supplyCurrency: { before: before.supplyCurrency, after: input.supplyCurrency } },
      }),
    );
  });
  return { ok: true, no: before.no, changes };
}

export type UpdateCustomerNameResult = { ok: true; no: number; changed: boolean } | { ok: false; code: "not_found" };

/**
 * 고객사 품명 **하나만** 고친다 (조각 1, 2026-10-14 사용자 결정 (다)).
 *
 * 왜 `updatePart` 를 안 쓰고 길을 따로 내는가: 부품의 다른 칸(품명·단가 등)은 **ADMIN 전용**이고
 * 이 칸만 **STAFF 이상**이다. 🔴 `updatePart` 의 가드를 STAFF 로 내리면 품명·단가까지 함께 열린다.
 * 그래서 가드가 다른 저장 길을 따로 두고, 여기서는 **이 칸 말고는 아무것도 건드리지 않는다.**
 *
 * 🔵 이력은 기존 부품 수정과 **같은 길**을 탄다 — `PART_UPDATE` + `detail.changes`.
 *    `/audit` 의 `linesOf` 가 그대로 풀어 `PART_FIELD_LABEL` 로 「고객사 품명」이라고 그린다.
 *    (`supplyCurrency` 는 안 넣는다. 공급가가 안 바뀌니 쓸 데가 없고, 그쪽은 `?? "JPY"` 로 받는다.)
 *
 * 🔵 사람이 직접 고칠 때는 **이미 값이 있어도 덮어쓴다.** 「덮어쓰지 않는다」(결정 ②)는 나중에
 *    A/S 에서 값이 들어올 때의 규칙(조각 5~8)이다 — 여기에 걸면 사람이 제 오타를 못 고친다.
 *
 * 🔵 `markWorkbookDirty` 를 **부르지 않는다**: 엑셀 한 벌에 고객사 품명 칸이 없어 다시 쓸 것이 없다.
 *    나중에 엑셀에 넣게 되면 여기도 같이 고쳐야 한다.
 */
export async function updateCustomerName(id: string, customerName: string, actor: Actor): Promise<UpdateCustomerNameResult> {
  const [before] = await db()
    .select({ id: parts.id, no: parts.no, customerName: parts.customerName })
    .from(parts)
    .where(and(eq(parts.id, id), eq(parts.isDeleted, false)))
    .limit(1);
  if (!before) return { ok: false, code: "not_found" };
  if (before.customerName === customerName) return { ok: true, no: before.no, changed: false };

  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(parts).set({ customerName, updatedBy: actor.id, updatedAt: now }).where(eq(parts.id, id));
    await tx.insert(auditLogs).values(
      auditValues({
        action: "PART_UPDATE",
        actorId: actor.id,
        actorName: actor.name,
        target: `parts:No.${before.no}`,
        detail: { changes: { customerName: { before: before.customerName, after: customerName } } },
      }),
    );
  });
  return { ok: true, no: before.no, changed: true };
}

export type FillCustomerNameResult = { ok: true; filled: boolean; part: { no: number; name: string; customerName: string } } | { ok: false; code: "not_found" | "deleted" };

/**
 * 고객사 품명을 **비어 있을 때만** 채운다 — 바깥(A/S) 통로 전용 (2026-10-16, 설계 7절의 2026-10-14 결정).
 *
 * 🔴 **바로 위 `updateCustomerName` 과 일부러 다른 함수다.** 저쪽은 **사람이 화면에서** 고치는 길이라
 *    이미 값이 있어도 덮어쓴다(안 그러면 제 오타를 못 고친다). 이쪽은 **바깥에서 들어오는 쓰기**라
 *    덮어쓰지 않는다 — A/S 쪽 한 사람의 오타가 고객사에 나가는 서류의 이름을 조용히 갈아치우면
 *    재고 쪽에서는 바뀐 줄도 모른다. 🔴 **두 규칙을 한 함수에 깃발로 합치지 않는다**: 깃발은 언젠가
 *    반대로 넘어오고, 그날 조용히 덮어써진다.
 *
 * 🔴 **채우기만 한다.** 빈 값으로 지우는 길은 이 함수에도, 통로에도 없다(값 검사는
 *    `lib/api/part-customer-name.ts`). 여기서는 **이 칸 말고 아무것도 건드리지 않는다.**
 *
 * 🔴 **비어 있을 때만」은 `WHERE` 로 지킨다**(읽고 나서 쓰기 사이에 다른 호출이 채울 수 있다).
 *    그 다툼에서 진 호출은 **오류가 아니라** 「이미 있다」로 돌아간다 — 두 번 보내도 안전하다는 결이
 *    반출 신청(`created: false`)·거두기(`cancelled: false`)와 같다.
 *
 * 🔵 이력은 사람이 고칠 때와 **같은 길**이다 — `PART_UPDATE` + `detail.changes.customerName`.
 *    🔴 거기에 **누가 채웠는지**(`detail.filledBy` = 포털 번호와 보내온 이름)를 더한다. 바깥에서
 *    들어오는 쓰기라 「이 이름 누가 넣었지?」가 반드시 나오고, 그때 답할 자리가 이력뿐이다.
 *    `/audit` 이 그 칸을 보고 「A/S 통로로 채움」 한 줄을 더 그린다(`linesOf`).
 *
 * 🔵 `markWorkbookDirty` 를 부르지 않는 까닭은 `updateCustomerName` 과 같다 — 엑셀 한 벌에 이 칸이 없다.
 */
export async function fillCustomerName(no: number, customerName: string, filler: CustomerNameFiller): Promise<FillCustomerNameResult> {
  // 🔴 숨긴 부품을 여기서 거르지 않는다 — **「없다」와 「치웠다」를 다른 말로** 돌려주어야 한다(통로가 가른다).
  const [before] = await db().select({ id: parts.id, no: parts.no, name: parts.name, customerName: parts.customerName, isDeleted: parts.isDeleted }).from(parts).where(eq(parts.no, no)).limit(1);
  if (!before) return { ok: false, code: "not_found" };
  if (before.isDeleted) return { ok: false, code: "deleted" };
  if (before.customerName !== "") return { ok: true, filled: false, part: { no: before.no, name: before.name, customerName: before.customerName } };

  const now = new Date();
  const filled = await db().transaction(async (tx) => {
    const [row] = await tx
      .update(parts)
      // 🔴 `updatedBy` 는 **찾은 사람만** 적는다. 우리 `users` 에 없는 사람을 적을 자리가 없어서인데,
      //    null 은 이 칸에서 이미 「사람이 아닌 길로 들어왔다」는 뜻이다(표 주석: 가져오기 스크립트).
      //    누가 채웠는지는 **감사 로그**가 번호까지 들고 있다.
      .set({ customerName, updatedBy: filler.id, updatedAt: now })
      // 🔴 **비어 있을 때만** — 읽은 뒤 여기 오기까지 다른 호출이 채웠으면 0행이고, 그러면 덮지 않는다.
      .where(and(eq(parts.id, before.id), eq(parts.customerName, ""), eq(parts.isDeleted, false)))
      .returning({ no: parts.no, name: parts.name, customerName: parts.customerName });
    if (!row) return null; // 🔵 쓴 것이 없으므로 이 트랜잭션은 빈 채로 끝난다(감사 로그도 안 남는다).
    await tx.insert(auditLogs).values(
      auditValues({
        action: "PART_UPDATE",
        actorId: filler.id,
        actorName: filler.name,
        target: `parts:No.${row.no}`,
        // 🔴 **누가 채웠나**(포털 번호와 보내온 이름)를 포함해 남길 내용은 순수 함수가 빚는다 —
        //    이 파일은 `server-only` 라 시험이 불러올 수 없어서다(`./customer-name.ts` 머리말).
        detail: customerNameFillAudit(customerName, filler),
      }),
    );
    return row;
  });

  // 🔵 다툼에서 졌다 — 지금 값을 다시 읽어 「이미 있다」로 돌려준다. 지어내지 않는다.
  if (!filled) {
    const [now2] = await db().select({ no: parts.no, name: parts.name, customerName: parts.customerName }).from(parts).where(eq(parts.id, before.id)).limit(1);
    return { ok: true, filled: false, part: now2 ?? { no: before.no, name: before.name, customerName } };
  }
  return { ok: true, filled: true, part: filled };
}

export type DeletePartResult = { ok: true; no: number } | { ok: false; code: "not_found" | "has_quantity" | "has_records" };

/**
 * 삭제 — 관리자만, **입고·사용 기록이 없는 부품에만** (REQUIREMENTS 8절). 사유를 남긴다.
 *
 * 조각 4 전에는 원장(stock_transactions)이 없으므로 「수량이 남아 있으면 못 지운다」로 같은 뜻을 지킨다.
 * 조각 4 가 들어오면 원장 줄 수를 세는 검사가 여기에 더해진다.
 */
export async function deletePart(id: string, reason: string, actor: Actor): Promise<DeletePartResult> {
  const [row] = await db()
    .select({ id: parts.id, no: parts.no, name: parts.name, quantity: stockBalances.quantity })
    .from(parts)
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(and(eq(parts.id, id), eq(parts.isDeleted, false)))
    .limit(1);
  if (!row) return { ok: false, code: "not_found" };
  if ((row.quantity ?? 0) > 0) return { ok: false, code: "has_quantity" };
  if (await partHasTransactions(id)) return { ok: false, code: "has_records" };

  const now = new Date();
  await db().transaction(async (tx) => {
    await tx
      .update(parts)
      .set({ isDeleted: true, deletedAt: now, deletedBy: actor.id, deleteReason: reason, updatedBy: actor.id, updatedAt: now })
      .where(eq(parts.id, id));
    await markWorkbookDirty(tx); // 부품·항목이 바뀌면 엑셀 한 벌 「써야 함」 (조각 7)
    await tx.insert(auditLogs).values(
      auditValues({
        action: "PART_DELETE",
        actorId: actor.id,
        actorName: actor.name,
        target: `parts:No.${row.no}`,
        detail: { name: row.name, reason },
      }),
    );
  });
  return { ok: true, no: row.no };
}

/* ───────────── 항목 ───────────── */

export type CreatePartItemResult = { ok: true } | { ok: false; errors: PartItemFieldErrors };

export async function createPartItem(input: PartItemInput, actor: Actor): Promise<CreatePartItemResult> {
  const all = await db().select({ code: partItems.code, name: partItems.name, sortOrder: partItems.sortOrder, isDeleted: partItems.isDeleted }).from(partItems);
  const errors: PartItemFieldErrors = {};
  // 숨긴 항목과도 겹치면 안 된다 — code 에 UNIQUE 인덱스가 있어 DB 가 거절하고, 사람에게는 이 문구가 낫다.
  if (all.some((r) => r.code === input.code)) errors.code = "이미 있는 코드입니다.";
  if (all.some((r) => !r.isDeleted && r.name === input.name)) errors.name = "이미 있는 이름입니다.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const maxOrder = all.filter((r) => !r.isDeleted).reduce((m, r) => Math.max(m, r.sortOrder), 0);
  await db().transaction(async (tx) => {
    await tx.insert(partItems).values({ code: input.code, name: input.name, sortOrder: maxOrder + 10 });
    await markWorkbookDirty(tx); // 부품·항목이 바뀌면 엑셀 한 벌 「써야 함」 (조각 7)
    await tx.insert(auditLogs).values(
      auditValues({ action: "PART_ITEM_CREATE", actorId: actor.id, actorName: actor.name, target: `part_items:${input.code}`, detail: { name: input.name } }),
    );
  });
  return { ok: true };
}

/** 항목 차례를 한 칸 올리거나 내린다. 이웃과 sort_order 를 맞바꾼다. 끝이면 아무 일도 없다. */
export async function movePartItem(id: string, direction: "up" | "down", actor: Actor): Promise<void> {
  const rows = await db()
    .select({ id: partItems.id, code: partItems.code, sortOrder: partItems.sortOrder })
    .from(partItems)
    .where(eq(partItems.isDeleted, false))
    .orderBy(asc(partItems.sortOrder), asc(partItems.name));
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const other = direction === "up" ? rows[idx - 1] : rows[idx + 1];
  if (!other) return;
  const me = rows[idx];
  // 같은 sort_order 가 겹쳐 있던 경우(시드 전·후 섞임)에도 자리가 바뀌도록, 겹치면 번호를 다시 매긴다.
  let mine = other.sortOrder;
  const theirs = me.sortOrder;
  if (mine === theirs) {
    mine = direction === "up" ? theirs - 1 : theirs + 1;
  }
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(partItems).set({ sortOrder: mine, updatedAt: now }).where(eq(partItems.id, me.id));
    await tx.update(partItems).set({ sortOrder: theirs, updatedAt: now }).where(eq(partItems.id, other.id));
    await markWorkbookDirty(tx); // 부품·항목이 바뀌면 엑셀 한 벌 「써야 함」 (조각 7)
    await tx.insert(auditLogs).values(
      auditValues({
        action: "PART_ITEM_REORDER",
        actorId: actor.id,
        actorName: actor.name,
        target: `part_items:${me.code}`,
        detail: { direction, swappedWith: other.code },
      }),
    );
  });
}
