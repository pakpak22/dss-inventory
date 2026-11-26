import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parts } from "@/db/schema/parts";
import { stockEntries, stockTransactions, type ChargeType, type EntryType, type Purpose } from "@/db/schema/stock";
// 🔴 **「대기 중인 반환 신청」을 빼는 셈은 저장소에 한 벌뿐이다** (2026-11-26) — A/S 가 묻는 통로와
//    반환 화면이 **같은 함수**를 쓴다. 두 벌로 적으면 한 부품에 두 화면이 **다른 최댓값**을 말하고,
//    담당자가 화면에서 전부 돌려주면 그 신청의 [반환 완료]가 나중에 넘쳐서 거절된다.
import { pendingByTransaction, remainingOf } from "@/lib/api/return-candidates";
import { sheetNoText } from "./codes";
import type { EntryListFilter } from "./form";
import { listPendingReturnPayloads } from "./requests";

/** 기록 내역·상세 창에 내려보내는 줄. 직렬화 가능한 값만. */
export interface EntryLineRow {
  id: string;
  partId: string;
  partNo: number;
  /** 부품의 「고객사 품명」(`parts.customer_name`). 🔴 아래 EntryRow 의 `customerName` — 그 건의 **고객사 이름**(`stock_entries.customer_name`) — 과 다른 것이다. */
  partCustomerName: string;
  partName: string;
  partName2: string;
  partDrawingNo: string;
  partKyosanPartNo: string;
  owner: string;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  chargeType: ChargeType | null;
  note: string;
  /** 이 줄을 되돌린 기록 취소 줄이 있나 */
  corrected: boolean;
  /** 이 줄이 되돌린 원래 줄(기록 취소·반환) */
  reversesTransactionId: string | null;
  returnsTransactionId: string | null;
}

export interface EntryRow {
  id: string;
  type: EntryType;
  occurredOn: string;
  sheetYear: number;
  sheetNo: number;
  intakeNumber: string;
  intakeUnverified: boolean;
  noRepairCase: boolean;
  customerName: string;
  productModel: string;
  usagePlace: string;
  purpose: Purpose | null;
  purposeText: string;
  counterparty: string;
  reason: string;
  note: string;
  createdByName: string;
  confirmedByName: string | null;
  createdAt: string;
  lines: EntryLineRow[];
}

const PAGE_SIZE = 30;

async function linesFor(entryIds: string[]): Promise<Map<string, EntryLineRow[]>> {
  const out = new Map<string, EntryLineRow[]>();
  if (entryIds.length === 0) return out;
  const rows = await db()
    .select({
      id: stockTransactions.id,
      entryId: stockTransactions.entryId,
      partId: stockTransactions.partId,
      partNo: parts.no,
      partCustomerName: parts.customerName, // 부품의 고객사 품명. 그 건의 고객사 이름(stockEntries.customerName)과 다른 칸이다.
      partName: parts.name,
      partName2: parts.name2,
      partDrawingNo: parts.drawingNo,
      partKyosanPartNo: parts.kyosanPartNo,
      owner: parts.owner,
      delta: stockTransactions.delta,
      quantityBefore: stockTransactions.quantityBefore,
      quantityAfter: stockTransactions.quantityAfter,
      chargeType: stockTransactions.chargeType,
      note: stockTransactions.note,
      reversesTransactionId: stockTransactions.reversesTransactionId,
      returnsTransactionId: stockTransactions.returnsTransactionId,
      corrected: sql<boolean>`exists (select 1 from stock_transactions r where r.reverses_transaction_id = ${stockTransactions.id})`,
    })
    .from(stockTransactions)
    .innerJoin(parts, eq(parts.id, stockTransactions.partId))
    .where(inArray(stockTransactions.entryId, entryIds))
    .orderBy(asc(stockTransactions.createdAt), asc(parts.no));
  for (const r of rows) {
    const { entryId, ...line } = r;
    const list = out.get(entryId) ?? [];
    list.push({ ...line, corrected: Boolean(line.corrected) });
    out.set(entryId, list);
  }
  return out;
}

function toEntryRow(e: typeof stockEntries.$inferSelect, lines: EntryLineRow[]): EntryRow {
  return {
    id: e.id,
    type: e.type,
    occurredOn: e.occurredOn,
    sheetYear: e.sheetYear,
    sheetNo: e.sheetNo,
    intakeNumber: e.intakeNumber,
    intakeUnverified: e.intakeUnverified,
    noRepairCase: e.noRepairCase,
    customerName: e.customerName,
    productModel: e.productModel,
    usagePlace: e.usagePlace,
    purpose: e.purpose,
    purposeText: e.purposeText,
    counterparty: e.counterparty,
    reason: e.reason,
    note: e.note,
    createdByName: e.createdByName,
    confirmedByName: e.confirmedByName,
    createdAt: e.createdAt.toISOString(),
    lines,
  };
}

/** 기록 내역 (DESIGN 2-5절): 날짜 역순, 거르기, 쪽. 부품으로 거를 때는 그 부품 줄이 든 건만. */
export async function listEntries(f: EntryListFilter): Promise<{ rows: EntryRow[]; total: number; pageSize: number }> {
  const conds = [];
  if (f.type) conds.push(eq(stockEntries.type, f.type));
  if (f.from) conds.push(gte(stockEntries.occurredOn, f.from));
  if (f.to) conds.push(lte(stockEntries.occurredOn, f.to));
  // 「담당」: 기록자(신청자)와 확인자 둘 다. 확인자만 맞는 건이 빠졌었다 (2026-10-07).
  if (f.actor) conds.push(or(ilike(stockEntries.createdByName, `%${f.actor}%`), ilike(stockEntries.confirmedByName, `%${f.actor}%`)));
  if (f.intakeNumber) conds.push(ilike(stockEntries.intakeNumber, `%${f.intakeNumber}%`));
  if (f.unverifiedOnly) conds.push(eq(stockEntries.intakeUnverified, true));
  if (f.text) {
    // 「내용 찾기」(2026-10-07): 제목·비고에 보이는 글자는 다 찾아진다. 머리의 글자 칸 + 줄 비고.
    const pat = `%${f.text}%`;
    conds.push(
      or(
        ilike(stockEntries.reason, pat),
        ilike(stockEntries.counterparty, pat),
        ilike(stockEntries.note, pat),
        ilike(stockEntries.customerName, pat),
        ilike(stockEntries.endUser, pat),
        ilike(stockEntries.productModel, pat),
        ilike(stockEntries.usagePlace, pat),
        ilike(stockEntries.purposeText, pat),
        sql`exists (select 1 from stock_transactions t where t.entry_id = ${stockEntries.id} and t.note ilike ${pat})`,
      ),
    );
  }
  if (f.partText) {
    // 「부품 찾기」: 체크한 곳 중 어디든 들어 있으면. No. 는 숫자일 때만 같은 값으로 본다.
    const pat = `%${f.partText}%`;
    const ors = [];
    if (f.partFields.includes("n") && /^\d+$/.test(f.partText)) ors.push(sql`p.no = ${Number(f.partText)}`);
    if (f.partFields.includes("a")) ors.push(sql`p.name ilike ${pat}`);
    if (f.partFields.includes("b")) ors.push(sql`p.name2 ilike ${pat}`);
    if (f.partFields.includes("d")) ors.push(sql`p.drawing_no ilike ${pat}`);
    if (f.partFields.includes("p")) ors.push(sql`p.kyosan_part_no ilike ${pat}`);
    // 🔴 이 `customer_name` 은 **부품**의 「고객사 품명」(parts.customer_name)이다.
    // 위 「내용 찾기」의 `stockEntries.customerName` — 그 건의 **고객사 이름**(stock_entries.customer_name) — 과 **다른 칸**이다.
    if (f.partFields.includes("c")) ors.push(sql`p.customer_name ilike ${pat}`);
    if (ors.length === 0) ors.push(sql`false`);
    conds.push(sql`exists (select 1 from stock_transactions t join parts p on p.id = t.part_id where t.entry_id = ${stockEntries.id} and (${sql.join(ors, sql` or `)}))`);
  }
  const where = conds.length > 0 ? and(...conds) : undefined;
  const [c] = await db().select({ n: count() }).from(stockEntries).where(where);
  const total = c?.n ?? 0;
  const heads = await db()
    .select()
    .from(stockEntries)
    .where(where)
    .orderBy(desc(stockEntries.occurredOn), desc(stockEntries.createdAt))
    .limit(PAGE_SIZE)
    .offset((f.page - 1) * PAGE_SIZE);
  const lines = await linesFor(heads.map((h) => h.id));
  return { rows: heads.map((h) => toEntryRow(h, lines.get(h.id) ?? [])), total, pageSize: PAGE_SIZE };
}

/** 부품 하나의 수량 이력 (상세 창 「이 프로그램에 쌓인 기록」). 최신이 위. */
export interface PartHistoryLine {
  transactionId: string;
  entryId: string;
  type: EntryType;
  occurredOn: string;
  sheetYear: number;
  sheetNo: number;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  chargeType: ChargeType | null;
  intakeNumber: string;
  intakeUnverified: boolean;
  usagePlace: string;
  counterparty: string;
  reason: string;
  note: string;
  createdByName: string;
  confirmedByName: string | null;
  corrected: boolean;
}

export async function partHistory(partId: string, limit = 200): Promise<PartHistoryLine[]> {
  const rows = await db()
    .select({
      transactionId: stockTransactions.id,
      entryId: stockEntries.id,
      type: stockEntries.type,
      occurredOn: stockEntries.occurredOn,
      sheetYear: stockEntries.sheetYear,
      sheetNo: stockEntries.sheetNo,
      delta: stockTransactions.delta,
      quantityBefore: stockTransactions.quantityBefore,
      quantityAfter: stockTransactions.quantityAfter,
      chargeType: stockTransactions.chargeType,
      intakeNumber: stockEntries.intakeNumber,
      intakeUnverified: stockEntries.intakeUnverified,
      usagePlace: stockEntries.usagePlace,
      counterparty: stockEntries.counterparty,
      reason: stockEntries.reason,
      note: stockTransactions.note,
      createdByName: stockEntries.createdByName,
      confirmedByName: stockEntries.confirmedByName,
      corrected: sql<boolean>`exists (select 1 from stock_transactions r where r.reverses_transaction_id = ${stockTransactions.id})`,
    })
    .from(stockTransactions)
    .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
    .where(eq(stockTransactions.partId, partId))
    .orderBy(desc(stockEntries.occurredOn), desc(stockTransactions.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, corrected: Boolean(r.corrected) }));
}

/** 반환 화면용: 이 부품의 사용·대여 줄 중 아직 돌아올 수량이 남은 것. */
export interface ReturnCandidate {
  transactionId: string;
  type: EntryType;
  occurredOn: string;
  sheetYear: number;
  sheetNo: number;
  intakeNumber: string;
  usagePlace: string;
  counterparty: string;
  taken: number;
  returned: number;
  /**
   * **대기 중인 반환 신청**에 이 줄로 적혀 있는 수량 (2026-11-26).
   *
   * 🔴 **화면에 적어야 하는 값이다.** 이 값만큼 아래 `remaining` 이 줄어드는데, 말해 주지 않으면
   *    담당자는 「어제는 5개였는데 왜 3개지」를 알 길이 없다 — 그 줄에 아무 표시도 남지 않는다.
   * 🔵 A/S 가 올린 반환 신청이 한 건도 없으면 언제나 0 이고, 화면은 0 일 때 아무것도 안 그린다.
   */
  pending: number;
  /** 지금 **돌려줄 수 있는** 수량 = `taken − returned − pending`. 🔴 통로가 A/S 에 내주는 값과 **같은 셈**이다. */
  remaining: number;
}

/**
 * 반환 후보를 읽는 **거르개** — **부품 하나로**(반환 화면) 또는 **인수번호 하나로**(A/S 통로).
 *
 * 🔴 **같은 뺄셈을 두 벌로 적지 않으려고 거르개만 갈아 끼운다** (2026-11-26). 「나간 수량 − 이미 돌아온
 *    수량」을 세는 자리가 둘이 되면, 기록 취소된 줄을 빼는 조건이나 「사용·대여만」 같은 조건이 한쪽에만
 *    더해지는 날이 온다 — 그때 두 화면이 **같은 부품에 다른 최댓값**을 말한다.
 */
type ReturnableFilter = { partId: string } | { intakeNumber: string };

/**
 * 부품 하나로 볼 때 읽는 줄 수의 뚜껑 — **100**. 🔵 옛 코드의 값 그대로다(반환 화면이 고르는 목록).
 *
 * 🔴 **인수번호로 볼 때는 뚜껑을 씌우지 않는다.** 거기서 자르면 `taken` 이 조용히 줄고, 그러면
 *    「돌려줄 수 있는 수량」이 **실제보다 작게** 나가 멀쩡한 반환이 막힌다 — 오류 없이 수량만 틀린다.
 *    한 수리 건에 달리는 반출 줄은 사람이 적는 수라 뚜껑이 없어도 몇십 줄이다.
 */
const PART_RETURN_CANDIDATE_LIMIT = 100;

/**
 * 되돌릴 수 있는 **원장 줄**을 읽는다 — 사용·대여의 나간 줄 중 기록 취소되지 않은 것.
 *
 * 🔴 **「이미 돌아온 수량」을 세는 식은 원장의 검사(`lib/stock/ledger.ts` 의 `return_exceeds`)와 같은 식이다** —
 *    그 줄을 가리키는 반환 줄의 `delta` 합. 그쪽이 **잠그고 다시 세는** 마지막 울타리라, 여기가 더 느슨해도
 *    더 빡빡해도 안 되고 **같아야** 한다.
 */
async function readReturnableTransactions(filter: ReturnableFilter) {
  const rows = db()
    .select({
      transactionId: stockTransactions.id,
      type: stockEntries.type,
      occurredOn: stockEntries.occurredOn,
      sheetYear: stockEntries.sheetYear,
      sheetNo: stockEntries.sheetNo,
      intakeNumber: stockEntries.intakeNumber,
      usagePlace: stockEntries.usagePlace,
      counterparty: stockEntries.counterparty,
      delta: stockTransactions.delta,
      partNo: parts.no,
      partName: parts.name,
      partName2: parts.name2,
      partCustomerName: parts.customerName,
      partKyosanPartNo: parts.kyosanPartNo,
      partDrawingNo: parts.drawingNo,
      owner: parts.owner,
      returned: sql<number>`coalesce((select sum(r.delta) from stock_transactions r where r.returns_transaction_id = ${stockTransactions.id}), 0)`.mapWith(Number),
      corrected: sql<boolean>`exists (select 1 from stock_transactions r where r.reverses_transaction_id = ${stockTransactions.id})`,
    })
    .from(stockTransactions)
    .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
    // 🔵 부품을 여기서 잇는다 — 숨긴 부품도 그대로 온다. 원장 줄이 있는 부품은 **삭제가 막혀 있어**
    //    (`lib/parts/mutations.ts`) 여기 걸릴 일이 없고, 그래도 생기면 **감추는 것보다 보이는 쪽**이 맞다:
    //    이미 나간 물건이고 돌려받을 길이 없어지면 재고가 영영 어긋난다.
    .innerJoin(parts, eq(parts.id, stockTransactions.partId))
    .where(and("partId" in filter ? eq(stockTransactions.partId, filter.partId) : eq(stockEntries.intakeNumber, filter.intakeNumber), inArray(stockEntries.type, ["USE", "LOAN"])));
  const found =
    "partId" in filter
      ? await rows.orderBy(desc(stockEntries.occurredOn), desc(stockTransactions.createdAt)).limit(PART_RETURN_CANDIDATE_LIMIT)
      : await rows.orderBy(asc(parts.no), asc(stockTransactions.createdAt));
  // 🔴 **기록 취소된 줄과 + 줄은 뺀다.** 취소된 반출은 나간 적이 없는 것이고(되돌리는 줄이 이미 쌓였다),
  //    + 줄은 같은 건에 섞여 들어온 되돌림이라 「나간 수량」이 아니다.
  return found.filter((r) => !r.corrected && r.delta < 0);
}

/**
 * 반환 화면이 고르는 줄 — 🔴 **대기 중인 반환 신청까지 뺀 최댓값**을 준다 (2026-11-26).
 *
 * ── 🔴 **왜 뺄셈이 늘었나** ────────────────────────────────────────────
 * 그 전에는 `나간 − 이미 반환` 이었고, A/S 가 올린 **대기 중인 반환 신청을 몰랐다.** 같은 날 A/S 에서
 * 반환 신청이 올라오기 시작했으므로(`POST /api/v1/stock-requests` 의 `type: "RETURN"`) 그대로 두면
 * **한 부품에 두 화면이 다른 최댓값**을 말한다: 담당자가 이 화면에서 전부 돌려주면, 나중에 그 신청의
 * [확인]이 원장에서 **넘쳐서 거절된다**(`ledger.ts` 의 `return_exceeds`) — 그때는 A/S 쪽에 「접수됨」이
 * 떠 있고 어디서 어긋났는지 아무도 모른다.
 * 🔵 **셈은 통로와 같은 함수 하나다**(`remainingOf`) — 여기서 다시 적으면 그 갈림이 또 생긴다.
 * 🔴 **줄이 한 줄도 없으면 신청 표를 열지 않는다** — 뺄 것이 없어 **답이 같다**(읽는 통로와 같은 건너뛰기).
 */
export async function returnCandidates(partId: string): Promise<ReturnCandidate[]> {
  const rows = await readReturnableTransactions({ partId });
  const pending = rows.length === 0 ? new Map<string, number>() : pendingByTransaction(await listPendingReturnPayloads());
  return rows
    .map((r) => {
      const waiting = pending.get(r.transactionId) ?? 0;
      return {
        transactionId: r.transactionId,
        type: r.type,
        occurredOn: r.occurredOn,
        sheetYear: r.sheetYear,
        sheetNo: r.sheetNo,
        intakeNumber: r.intakeNumber,
        usagePlace: r.usagePlace,
        counterparty: r.counterparty,
        taken: -r.delta,
        returned: r.returned,
        pending: waiting,
        remaining: remainingOf(-r.delta, r.returned, waiting),
      };
    })
    .filter((r) => r.remaining > 0);
}

/**
 * **인수번호 하나로** 되돌릴 수 있는 줄 — A/S 가 묻는 통로(`GET /api/v1/return-candidates`)가 쓴다
 * (2026-11-26. 설명은 API.md 8절, 규칙과 모양은 `lib/api/return-candidates.ts`).
 *
 * 🔵 **합치지 않고 줄 그대로 올려 보낸다.** 부품별로 묶고 대기 중인 신청을 빼는 일은 순수 함수가 한다
 *    (`summarizeReturnCandidates`) — 그래야 「0 인 부품은 빼고 준다」·「음수로 안 나간다」 같은 규칙을
 *    **DB 없이** 시험이 덮는다. 이 저장소에는 DB 시험이 없다.
 * 🔴 **남은 수량이 0 인 줄도 뺀 채로 올리지 않는다.** 그 줄도 `taken`·`returned` 에 보태야 부품 합계가
 *    참말이 된다 — 여기서 미리 걸러 내면 「나간 적이 없는 것」처럼 보인다.
 * 🔵 돌려주는 모양은 `lib/api/return-candidates.ts` 의 `ReturnableLine` 과 같아야 하고, 어긋나면 통로
 *    파일(`src/app/api/v1/return-candidates/route.ts`)에서 tsc 가 멈춘다 — 서로 끌어오지 않고 **맞물리는
 *    자리에서** 잰다(선례: `RequestStatusSource`).
 */
export async function returnableLinesByIntake(intakeNumber: string) {
  const rows = await readReturnableTransactions({ intakeNumber });
  return rows.map((r) => ({
    transactionId: r.transactionId,
    part: {
      no: r.partNo,
      name: r.partName,
      name2: r.partName2,
      customerName: r.partCustomerName,
      kyosanPartNo: r.partKyosanPartNo,
      drawingNo: r.partDrawingNo,
      owner: r.owner,
    },
    taken: -r.delta,
    returned: r.returned,
  }));
}

/** 부품에 원장 줄이 있나 (삭제 막기 — 조각 3 mutations.ts 의 TODO) */
export async function partHasTransactions(partId: string): Promise<boolean> {
  const [r] = await db().select({ n: count() }).from(stockTransactions).where(eq(stockTransactions.partId, partId));
  return (r?.n ?? 0) > 0;
}

/**
 * 기록 id(uuid) → 사람이 읽는 번호(US-2026-10 꼴). 변경 이력 화면이 옛 「엑셀 기준 적용」 기록(번호를 detail 에 안 남긴 것)을
 * 보여 줄 때만 쓴다 — 감사 로그는 append-only 라 고쳐 넣지 않고 볼 때 찾는다. 모르는 id 는 빠진다.
 */
export async function entryNosByIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await db()
    .select({ id: stockEntries.id, type: stockEntries.type, sheetYear: stockEntries.sheetYear, sheetNo: stockEntries.sheetNo })
    .from(stockEntries)
    .where(inArray(stockEntries.id, ids));
  for (const r of rows) out.set(r.id, sheetNoText(r.type, r.sheetYear, r.sheetNo));
  return out;
}
