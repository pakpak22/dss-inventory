import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, SETTING_TRANSITION_DATE } from "@/db/schema/app-settings";
import { legacyRecords, type LegacyMatchStatus, type LegacySheet } from "@/db/schema/legacy-records";
import { stockEntries, stockTransactions } from "@/db/schema/stock";
import { currentMonthSeoul, FREQ_MONTHS_MAX, monthMinus, type MonthlyUsage } from "@/lib/parts/frequent";
import { addYearly, mergeYearly, productModelOf, toYearlyRecord, yearOf, yearsIn, type YearlyMap, type YearlyRecord } from "./yearly";

/**
 * 과거 기록·연도별 수량·전환일 읽기 (조각 5). 쓰기는 가져오기 스크립트뿐이다 — 화면에서 과거 기록을 고치는 길은 없다.
 */

/** 전환일(YYYY-MM-DD). 실제 자료를 넣기 전에는 null → 화면은 「전환 전」. */
export async function getTransitionDate(): Promise<{ value: string; updatedAt: string; updatedByName: string } | null> {
  const [row] = await db().select().from(appSettings).where(eq(appSettings.key, SETTING_TRANSITION_DATE)).limit(1);
  return row ? { value: row.value, updatedAt: row.updatedAt.toISOString(), updatedByName: row.updatedByName } : null;
}

/** 확인된 과거 기록 — 연도별 수량에 넣는 것 (DESIGN 5절: 앞의 두 갈래) */
const COUNTED: readonly LegacyMatchStatus[] = ["CONFIRMED", "GROUP_DECIDED"];

export interface LegacyHistoryLine {
  id: string;
  sheet: LegacySheet;
  sourceRow: number;
  sheetNo: number | null;
  occurredOn: string | null;
  dateText: string;
  intakeNumber: string;
  stockBefore: number | null;
  quantity: number | null;
  stockAfter: number | null;
  purposeText: string;
  note: string;
  ownerText: string;
  chargeText: string;
  usagePlace: string;
  matchStatus: LegacyMatchStatus;
  matchNote: string;
  anomaly: string;
}

/** 부품 하나의 과거 기록 (상세 창 「전환일 이전 — 참고용」). 최신이 위. 날짜 없는 줄은 맨 아래. */
export async function legacyHistory(partId: string, limit = 500): Promise<LegacyHistoryLine[]> {
  return db()
    .select({
      id: legacyRecords.id,
      sheet: legacyRecords.sheet,
      sourceRow: legacyRecords.sourceRow,
      sheetNo: legacyRecords.sheetNo,
      occurredOn: legacyRecords.occurredOn,
      dateText: legacyRecords.dateText,
      intakeNumber: legacyRecords.intakeNumber,
      stockBefore: legacyRecords.stockBefore,
      quantity: legacyRecords.quantity,
      stockAfter: legacyRecords.stockAfter,
      purposeText: legacyRecords.purposeText,
      note: legacyRecords.note,
      ownerText: legacyRecords.ownerText,
      chargeText: legacyRecords.chargeText,
      usagePlace: legacyRecords.usagePlace,
      matchStatus: legacyRecords.matchStatus,
      matchNote: legacyRecords.matchNote,
      anomaly: legacyRecords.anomaly,
    })
    .from(legacyRecords)
    .where(eq(legacyRecords.partId, partId))
    .orderBy(sql`${legacyRecords.occurredOn} desc nulls last`, desc(legacyRecords.sourceRow))
    .limit(limit);
}

/**
 * 원장의 연도별 사용 — 사용 줄(취소되지 않은 것)의 수량에서 그 줄에 대한 반환(취소되지 않은 것)을 뺀다 (DESIGN 4-4절).
 * 반환은 **원래 사용의 해**에서 뺀다 — 「그 해의 사용 − 그 사용에 대한 반환」. 대여(LOAN)는 넣지 않는다.
 * 같은 꼴로 입고(RECEIVE)도 센다 — 상세 창의 「연도별 입고·사용」.
 */
async function ledgerYearly(type: "USE" | "RECEIVE", partId: string | null): Promise<YearlyMap> {
  const rows = (await db().execute(sql`
    select t.part_id as part_id,
           extract(year from e.occurred_on)::int as year,
           sum(abs(t.delta) - coalesce((
             select sum(r.delta) from stock_transactions r
             where r.returns_transaction_id = t.id
               and not exists (select 1 from stock_transactions x where x.reverses_transaction_id = r.id)
           ), 0))::int as quantity
    from stock_transactions t
    join stock_entries e on e.id = t.entry_id
    where e.type = ${type}
      and not exists (select 1 from stock_transactions x where x.reverses_transaction_id = t.id)
      ${partId === null ? sql`` : sql`and t.part_id = ${partId}`}
    group by t.part_id, extract(year from e.occurred_on)`)) as unknown as Array<{ part_id: string; year: number; quantity: number }>;
  const out: YearlyMap = new Map();
  for (const r of rows) if (r.quantity !== 0) addYearly(out, r.part_id, Number(r.year), Number(r.quantity));
  return out;
}

async function legacyYearly(sheet: LegacySheet, partId: string | null): Promise<YearlyMap> {
  const rows = await db()
    .select({ partId: legacyRecords.partId, occurredOn: legacyRecords.occurredOn, dateText: legacyRecords.dateText, quantity: legacyRecords.quantity })
    .from(legacyRecords)
    .where(and(eq(legacyRecords.sheet, sheet), inArray(legacyRecords.matchStatus, [...COUNTED]), ...(partId === null ? [] : [eq(legacyRecords.partId, partId)])));
  const out: YearlyMap = new Map();
  for (const r of rows) {
    if (r.quantity === null) continue;
    const y = yearOf(r.occurredOn, r.dateText);
    if (y !== null) addYearly(out, r.partId, y, r.quantity);
  }
  return out;
}

async function excludedLegacyCount(partId: string | null): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(legacyRecords)
    .where(and(eq(legacyRecords.sheet, "USE"), eq(legacyRecords.matchStatus, "OWNER_MISMATCH"), ...(partId === null ? [] : [eq(legacyRecords.partId, partId)])));
  return row?.n ?? 0;
}

export interface YearlyUsageAll {
  /** 자료에 나오는 연도, 최신이 앞 */
  years: number[];
  usage: YearlyRecord;
  /** 연도별 사용 수량에서 뺀 「소유 불일치」 과거 사용 기록 수 (화면: 「확인되지 않은 과거 기록 N건 제외」) */
  excludedLegacy: number;
}

/** 목록의 연도 칸 — 부품 전체. 과거 기록(확인된 것) + 원장. */
export async function yearlyUsageAll(): Promise<YearlyUsageAll> {
  const [legacy, ledger, excludedLegacy] = await Promise.all([legacyYearly("USE", null), ledgerYearly("USE", null), excludedLegacyCount(null)]);
  const merged = mergeYearly(legacy, ledger);
  return { years: yearsIn(merged), usage: toYearlyRecord(merged), excludedLegacy };
}

export interface PartYearlyRow {
  year: number;
  used: number;
  received: number;
}

/** 상세 창의 「연도별 입고·사용 수량」 — 부품 하나. 최신 연도가 위. */
export async function partYearly(partId: string): Promise<{ rows: PartYearlyRow[]; excludedLegacy: number }> {
  const [lu, lr, tu, tr, excludedLegacy] = await Promise.all([
    legacyYearly("USE", partId),
    legacyYearly("RECEIVE", partId),
    ledgerYearly("USE", partId),
    ledgerYearly("RECEIVE", partId),
    excludedLegacyCount(partId),
  ]);
  const used = mergeYearly(lu, tu).get(partId) ?? new Map<number, number>();
  const received = mergeYearly(lr, tr).get(partId) ?? new Map<number, number>();
  const years = [...new Set([...used.keys(), ...received.keys()])].sort((a, b) => b - a);
  return { rows: years.map((year) => ({ year, used: used.get(year) ?? 0, received: received.get(year) ?? 0 })), excludedLegacy };
}

/**
 * 「자주 사용하는 부품」의 재료 — 최근 36개월의 **월별 사용 통계** (2026-10-07 사용자: 기준을 화면에서 바로 조절).
 * 부품 → 달("YYYY-MM") → [건수, 수량]. 원장 사용 줄(취소된 것 제외, 반환은 빼지 않음 — 「출납」이므로) + 확인된 과거 사용 기록.
 * 규칙(횟수/수량 · 기간 · 숫자)은 화면이 주소 상태로 계산한다 (src/lib/parts/frequent.ts).
 */
export async function usageByMonth(now = new Date()): Promise<MonthlyUsage> {
  const from = `${monthMinus(currentMonthSeoul(now), FREQ_MONTHS_MAX - 1)}-01`;
  const rows = (await db().execute(sql`
    select part_id, to_char(d, 'YYYY-MM') as month, count(*)::int as n, sum(q)::int as q from (
      select t.part_id, e.occurred_on as d, abs(t.delta) as q
      from stock_transactions t join stock_entries e on e.id = t.entry_id
      where e.type = 'USE' and e.occurred_on >= ${from}::date
        and not exists (select 1 from stock_transactions x where x.reverses_transaction_id = t.id)
      union all
      select l.part_id, l.occurred_on as d, coalesce(l.quantity, 0) as q
      from legacy_records l
      where l.sheet = 'USE' and l.match_status in ('CONFIRMED', 'GROUP_DECIDED') and l.occurred_on >= ${from}::date
    ) u group by part_id, to_char(d, 'YYYY-MM')`)) as unknown as Array<{ part_id: string; month: string; n: number; q: number }>;
  const out: MonthlyUsage = {};
  for (const r of rows) (out[r.part_id] ??= {})[r.month] = [Number(r.n), Number(r.q)];
  return out;
}

export interface ProductUse {
  model: string;
  count: number;
}

/**
 * 「사용된 제품」 — 인수번호로 찾은 기종별 건수 (DESIGN 2-2절). 과거 기록은 사용처 글자(`인수번호_기종_…`)에서 기종을 꺼내고,
 * 원장은 머리의 `product_model`. 건수는 **기록 줄 수**다(한 건에 같은 부품이 두 줄이면 둘). 기종을 모르는 줄은 세지 않는다.
 */
export async function partProducts(partId: string): Promise<ProductUse[]> {
  const [legacy, ledger] = await Promise.all([
    db()
      .select({ usagePlace: legacyRecords.usagePlace })
      .from(legacyRecords)
      .where(and(eq(legacyRecords.partId, partId), eq(legacyRecords.sheet, "USE"), inArray(legacyRecords.matchStatus, [...COUNTED]))),
    db()
      .select({ model: stockEntries.productModel })
      .from(stockTransactions)
      .innerJoin(stockEntries, eq(stockEntries.id, stockTransactions.entryId))
      .where(
        and(
          eq(stockTransactions.partId, partId),
          eq(stockEntries.type, "USE"),
          sql`not exists (select 1 from stock_transactions x where x.reverses_transaction_id = ${stockTransactions.id})`,
        ),
      ),
  ]);
  const count = new Map<string, number>();
  for (const r of legacy) {
    const m = productModelOf(r.usagePlace);
    if (m) count.set(m, (count.get(m) ?? 0) + 1);
  }
  for (const r of ledger) if (r.model) count.set(r.model, (count.get(r.model) ?? 0) + 1);
  return [...count]
    .map(([model, n]) => ({ model, count: n }))
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
}
