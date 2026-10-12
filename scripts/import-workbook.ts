/**
 * 현황판 엑셀 → 부품 319개 · 처음 수량 · 과거 기록 가져오기 (조각 5, DESIGN 5절·5-3절).
 *
 *   npm run db:import -- --check-only <현황판.xlsx> [--decisions <묶음판정.csv>] [--unmatched <못붙인것.csv>]
 *   npm run db:import -- --real       <현황판.xlsx>  --decisions <묶음판정.csv>  --unmatched <못붙인것.csv> [--transition-date YYYY-MM-DD]
 *
 * 🔴 `--check-only` 는 읽어서 세어 **출력만** 하고 DB 에 아무것도 쓰지 않는다 (DESIGN 10-3절 8번: 「사본으로 넣었다 지운다」는 쓰지 않는다).
 *    개발 중 실제 자료는 이 모드로만 시험한다.
 * 🔴 `--real` 은 **빈 DB 에만** 넣는다 — parts·stock_entries·legacy_records 가 비어 있지 않으면 거절한다.
 *    데모 자료(db:seed-demo) 위에 실자료를 섞는 일, 두 번 넣는 일을 막는다. 전부 한 트랜잭션이다.
 *    실제 자료를 넣는 날(전환일)은 담당자가 백업을 확인해 준 뒤, 사용자 승인 뒤에만 돌린다 (CLAUDE.md 11절·15절).
 *
 * 하는 일(--real):
 *  1. parts: No. 를 엑셀 그대로 넣고 번호표(parts_no_seq)를 그 뒤로 옮긴다 (DESIGN 4-3절). `-` 는 빈 값.
 *  2. 처음 수량: OPENING 한 건에 부품마다 한 줄 (DESIGN 4-4절). 수량 0 인 부품은 줄이 없다(원장은 delta≠0). 빈칸은 0.
 *  3. legacy_records: 사용처·입고 기입란을 적힌 그대로. 부품에 붙이는 규칙은 src/lib/legacy/match.ts.
 *     맞는 부품이 없는 줄은 넣지 않고 CSV(--unmatched)로 남긴다 (답변서).
 *  4. 전환일을 설정값(app_settings.transition_date)에 적는다 (DESIGN 2-7절). 기본은 오늘(서울).
 *  5. 감사 로그 WORKBOOK_IMPORT 한 줄.
 *
 * 묶음 판정표·못 붙인 CSV 는 데이터 폴더에 둔다(저장소에 넣지 않는다, DESIGN 5-3절). 경로는 인자로만 받는다 —
 * 호스트 절대경로를 코드에 적지 않는다 (CLAUDE.md 12-1절 5번).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { sql as rawSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { appSettings, SETTING_TRANSITION_DATE } from "../src/db/schema/app-settings";
import { auditLogs } from "../src/db/schema/audit-logs";
import type { Category, Owner } from "../src/db/schema/codes";
import { legacyRecords, type NewLegacyRecord } from "../src/db/schema/legacy-records";
import { partItems } from "../src/db/schema/part-items";
import { parts } from "../src/db/schema/parts";
import { stockBalances } from "../src/db/schema/stock-balances";
import { stockEntries, stockTransactions } from "../src/db/schema/stock";
import { workbookStates } from "../src/db/schema/workbook-states";
import { PART_ITEM_SEED } from "../src/db/seed/part-items";
import { buildPartIndex, csvCell, decisionKey, matchRecord, parseDecisionCsv, summarize, type GroupDecision, type MatchResult } from "../src/lib/legacy/match";
import { readColumnStyleIndexes, readKrwStyleIndexes } from "../src/lib/legacy/workbook-styles";
import { headerColumns, readLegacySheet, readPartsSheet, SHEET_PARTS, SHEET_RECEIVE, SHEET_USE, type LegacyRow, type WorkbookPart } from "../src/lib/legacy/workbook";
import { readSheetGrid } from "../src/lib/xlsx/sheet-grid";
import { resolveSheetPart, STYLES_PART } from "../src/lib/xlsx/workbook-parts";
import { ZipArchive } from "../src/lib/xlsx/zip-reader";
import { loadDotEnvLocal } from "./lib/dotenv-local";

const SCRIPT_NAME = "db:import (가져오기 스크립트)";

/** 엑셀 글자 → 코드값. 모르는 글자는 넣지 않고 멈춘다 — 조용히 기본값으로 가지 않는다. */
const OWNER_OF_TEXT: Record<string, Owner> = { DSS: "DSS", KYOSAN: "KYOSAN", 보수부재: "SERVICE_SPARE" };
const CATEGORY_OF_TEXT: Record<string, Category> = { RFG: "RFG", MB: "MB", 호환: "COMPATIBLE" };

interface Args {
  mode: "check-only" | "real";
  workbook: string;
  decisions: string | null;
  unmatched: string | null;
  transitionDate: string | null;
}

function usage(): never {
  console.error(
    [
      "쓰는 법:",
      "  npm run db:import -- --check-only <현황판.xlsx> [--decisions <묶음판정.csv>] [--unmatched <못붙인것.csv>]",
      "  npm run db:import -- --real <현황판.xlsx> --decisions <묶음판정.csv> --unmatched <못붙인것.csv> [--transition-date YYYY-MM-DD]",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  let mode: Args["mode"] | null = null;
  let workbook: string | null = null;
  let decisions: string | null = null;
  let unmatched: string | null = null;
  let transitionDate: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usage();
      return v;
    };
    if (a === "--check-only") {
      mode = "check-only";
      workbook = next();
    } else if (a === "--real") {
      mode = "real";
      workbook = next();
    } else if (a === "--decisions") decisions = next();
    else if (a === "--unmatched") unmatched = next();
    else if (a === "--transition-date") transitionDate = next();
    else usage();
  }
  if (!mode || !workbook) usage();
  if (mode === "real" && (!decisions || !unmatched)) {
    console.error("--real 에는 --decisions 와 --unmatched 가 둘 다 필요합니다.");
    usage();
  }
  if (transitionDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(transitionDate)) {
    console.error("--transition-date 는 YYYY-MM-DD 꼴입니다.");
    usage();
  }
  return { mode, workbook, decisions, unmatched, transitionDate };
}

function todaySeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

interface Loaded {
  parts: WorkbookPart[];
  rows: LegacyRow[];
  results: MatchResult[];
  decisions: Map<string, GroupDecision>;
  problems: string[];
}

/** 엑셀과 판정표를 읽고 대조한다. DB 는 모른다. */
function load(args: Args): Loaded {
  const archive = ZipArchive.fromFile(args.workbook);
  const grids = {
    parts: readSheetGrid(archive, SHEET_PARTS),
    use: readSheetGrid(archive, SHEET_USE),
    receive: readSheetGrid(archive, SHEET_RECEIVE),
  };
  for (const [name, g] of [
    [SHEET_PARTS, grids.parts],
    [SHEET_USE, grids.use],
    [SHEET_RECEIVE, grids.receive],
  ] as const) {
    if (!g) throw new Error(`「${name}」 시트가 없습니다.`);
  }

  // 공급가 통화는 칸 서식에서 (workbook-styles.ts)
  const krw = readKrwStyleIndexes(archive.readTextOrNull(STYLES_PART) ?? "");
  const priceCol = headerColumns(grids.parts!, SHEET_PARTS, ["공급가"]).get("공급가")!;
  const styleOfRow = readColumnStyleIndexes(archive.readText(resolveSheetPart(archive, SHEET_PARTS)), priceCol);
  const partsRead = readPartsSheet(grids.parts!, (row) => (krw.has(styleOfRow.get(row) ?? 0) ? "KRW" : "JPY"));

  const problems: string[] = [];
  const itemNames = new Set(PART_ITEM_SEED.map((s) => s.name));
  const seenNo = new Set<number>();
  for (const p of partsRead) {
    if (seenNo.has(p.no)) problems.push(`부품 ${p.row}행: No.${p.no} 이(가) 두 번 나옴`);
    seenNo.add(p.no);
    if (!p.name) problems.push(`부품 ${p.row}행 (No.${p.no}): 품명이 비어 있음`);
    if (!itemNames.has(p.itemName)) problems.push(`부품 ${p.row}행 (No.${p.no}): 항목 「${p.itemName}」 을 모름`);
    if (!(p.categoryText in CATEGORY_OF_TEXT)) problems.push(`부품 ${p.row}행 (No.${p.no}): 분류 「${p.categoryText}」 을 모름`);
    if (!(p.ownerText in OWNER_OF_TEXT)) problems.push(`부품 ${p.row}행 (No.${p.no}): 소유 「${p.ownerText}」 을 모름`);
    if (p.anomaly) problems.push(`부품 ${p.row}행 (No.${p.no}): ${p.anomaly}`);
  }

  const rows = [...readLegacySheet(grids.use!, "USE"), ...readLegacySheet(grids.receive!, "RECEIVE")];
  const decisions = new Map<string, GroupDecision>();
  if (args.decisions) {
    for (const d of parseDecisionCsv(readFileSync(args.decisions, "utf8"))) decisions.set(decisionKey(d.sheet, d.row), d);
  }
  // 대조는 엑셀 글자 그대로 — 부품 쪽도 `-` 를 바꾸기 전 글자(workbook.ts 머리 주석)
  const index = buildPartIndex(partsRead.map((p) => ({ no: p.no, name: p.name, name2: p.rawName2, drawingNo: p.rawDrawingNo, ownerText: p.ownerText })));
  const results = rows.map((r) => matchRecord(r, index, decisions));
  return { parts: partsRead, rows, results, decisions, problems };
}

function report(args: Args, L: Loaded): void {
  const bySheet = (sheet: "USE" | "RECEIVE") => summarize(L.results.filter((_, i) => L.rows[i].sheet === sheet));
  const u = bySheet("USE");
  const r = bySheet("RECEIVE");
  const krwCount = L.parts.filter((p) => p.supplyCurrency === "KRW").length;
  console.log(`파일: ${args.workbook}`);
  console.log(`부품: ${L.parts.length}개 (No. ${Math.min(...L.parts.map((p) => p.no))}~${Math.max(...L.parts.map((p) => p.no))}, 수량 합 ${L.parts.reduce((s, p) => s + p.quantity, 0).toLocaleString("ko-KR")}, 공급가 ₩ ${krwCount}개)`);
  console.log(`판정표: ${args.decisions ? `${L.decisions.size}건 (${args.decisions})` : "없음"}`);
  console.log("");
  console.log("갈래                     사용    입고");
  console.log(`한 No.로 정해짐        ${String(u.confirmed).padStart(5)}   ${String(r.confirmed).padStart(5)}`);
  console.log(`묶음 판정              ${String(u.groupDecided).padStart(5)}   ${String(r.groupDecided).padStart(5)}`);
  console.log(`소유 불일치            ${String(u.ownerMismatch).padStart(5)}   ${String(r.ownerMismatch).padStart(5)}`);
  console.log(`맞는 부품 없음(안 넣음) ${String(u.unmatched).padStart(5)}   ${String(r.unmatched).padStart(5)}`);
  console.log(`합계                   ${String(L.rows.filter((x) => x.sheet === "USE").length).padStart(5)}   ${String(L.rows.filter((x) => x.sheet === "RECEIVE").length).padStart(5)}`);
  console.log("");
  const unmatched = L.rows.map((row, i) => ({ row, res: L.results[i] })).filter((x) => x.res.status === "UNMATCHED");
  if (unmatched.length > 0) {
    console.log(`못 붙인 ${unmatched.length}건:`);
    for (const { row, res } of unmatched) {
      const sheetName = row.sheet === "USE" ? SHEET_USE : SHEET_RECEIVE;
      console.log(`  ${sheetName} ${row.row}행 ${row.dateText} 「${row.name}」 ${row.name2} ${row.drawingNo} ${row.ownerText} — ${res.status === "UNMATCHED" ? res.reason : ""}`);
    }
    console.log("");
  }
  const anomalies = L.rows.filter((x) => x.anomaly);
  if (anomalies.length > 0) {
    console.log(`칸에 그대로 못 담은 줄 ${anomalies.length}건 (null 로 넣고 사정을 anomaly 칸에 남긴다):`);
    for (const x of anomalies) console.log(`  ${x.sheet === "USE" ? SHEET_USE : SHEET_RECEIVE} ${x.row}행: ${x.anomaly}`);
    console.log("");
  }
  if (L.problems.length > 0) {
    console.log(`🔴 부품 시트 문제 ${L.problems.length}건 — --real 은 이것이 0 이어야 돈다:`);
    for (const p of L.problems) console.log(`  ${p}`);
    console.log("");
  }
}

function writeUnmatchedCsv(path: string, L: Loaded): number {
  const header = ["시트", "행", "No.", "날짜", "인수번호", "품명", "품명2", "도번", "교산 품번", "현 재고", "수량", "이후 재고", "목적 및 출하담당", "비고", "소유", "발주현황", "사용처", "까닭"];
  const lines = [header.join(",")];
  let n = 0;
  L.rows.forEach((row, i) => {
    const res = L.results[i];
    if (res.status !== "UNMATCHED") return;
    n++;
    lines.push(
      [
        row.sheet === "USE" ? SHEET_USE : SHEET_RECEIVE,
        row.row,
        row.sheetNo,
        row.dateText,
        row.intakeNumber,
        row.name,
        row.name2,
        row.drawingNo,
        row.kyosanPartNo,
        row.stockBefore,
        row.quantity,
        row.stockAfter,
        row.purposeText,
        row.note,
        row.ownerText,
        row.chargeText,
        row.usagePlace,
        res.reason,
      ]
        .map(csvCell)
        .join(","),
    );
  });
  writeFileSync(path, `﻿${lines.join("\r\n")}\r\n`, "utf8");
  return n;
}

async function importReal(args: Args, L: Loaded): Promise<void> {
  if (L.problems.length > 0) throw new Error(`부품 시트에 문제가 ${L.problems.length}건 있어 넣지 않습니다. 위 목록을 고친 뒤 다시 돌리십시오.`);
  const missingDecisions = L.results.filter((r) => r.status === "UNMATCHED" && r.reason.includes("판정표")).length;
  if (missingDecisions > 0) throw new Error(`묶음인데 판정표로 못 정한 기록이 ${missingDecisions}건입니다. 판정표를 확인하십시오.`);

  loadDotEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 이 비어 있습니다.");
  const transitionDate = args.transitionDate ?? todaySeoul();
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  try {
    // 빈 DB 에만 (머리 주석). 셋 다 본다 — 하나만 비어 있는 어중간한 상태도 거절.
    for (const [label, table] of [
      ["parts", parts],
      ["stock_entries", stockEntries],
      ["legacy_records", legacyRecords],
    ] as const) {
      const [row] = await db.select({ n: rawSql<number>`count(*)`.mapWith(Number) }).from(table);
      if ((row?.n ?? 0) > 0) throw new Error(`${label} 표에 이미 ${row!.n}줄이 있습니다. 가져오기는 빈 DB 에만 합니다 — 데모 위에 실자료를 섞지 않습니다.`);
    }
    const items = await db.select({ id: partItems.id, name: partItems.name }).from(partItems);
    const itemIdByName = new Map(items.map((it) => [it.name, it.id]));
    const missingItems = [...new Set(L.parts.map((p) => p.itemName))].filter((n) => !itemIdByName.has(n));
    if (missingItems.length > 0) throw new Error(`항목이 DB 에 없습니다: ${missingItems.join(", ")}. 먼저 npm run db:seed-items 를 돌리십시오.`);

    await db.transaction(async (tx) => {
      // 1. 부품 — No. 그대로
      const partIdByNo = new Map<number, string>();
      for (const p of L.parts) {
        const [row] = await tx
          .insert(parts)
          .values({
            no: p.no,
            name: p.name,
            name2: p.name2,
            kyosanPartNo: p.kyosanPartNo,
            drawingNo: p.drawingNo,
            supplyPrice: p.supplyPrice,
            supplyCurrency: p.supplyCurrency,
            quotePrice: p.quotePrice,
            note: p.note,
            itemId: itemIdByName.get(p.itemName)!,
            category: CATEGORY_OF_TEXT[p.categoryText],
            owner: OWNER_OF_TEXT[p.ownerText],
            createdBy: null,
            updatedBy: null,
          })
          .returning({ id: parts.id });
        partIdByNo.set(p.no, row.id);
      }
      const maxNo = Math.max(...L.parts.map((p) => p.no));
      await tx.execute(rawSql`select setval('parts_no_seq', ${maxNo})`);

      // 2. 처음 수량 — OPENING 한 건, 부품마다 한 줄 (0 은 줄 없음). 캐시는 모든 부품에.
      const year = Number(transitionDate.slice(0, 4));
      const [entry] = await tx
        .insert(stockEntries)
        .values({ type: "OPENING", sheet: "CHANGE", occurredOn: transitionDate, sheetYear: year, sheetNo: 1, note: "현황판 엑셀의 수량 그대로 (가져오기)", createdBy: null, createdByName: SCRIPT_NAME })
        .returning({ id: stockEntries.id });
      let opened = 0;
      for (const p of L.parts) {
        const partId = partIdByNo.get(p.no)!;
        await tx.insert(stockBalances).values({ partId, quantity: p.quantity });
        if (p.quantity > 0) {
          await tx.insert(stockTransactions).values({ entryId: entry.id, partId, delta: p.quantity, quantityBefore: 0, quantityAfter: p.quantity, note: "" });
          opened++;
        }
      }

      // 3. 과거 기록 — 적힌 그대로, 500줄씩
      const records: NewLegacyRecord[] = [];
      L.rows.forEach((row, i) => {
        const res = L.results[i];
        if (res.status === "UNMATCHED") return;
        records.push({
          sheet: row.sheet,
          sourceRow: row.row,
          sheetNo: row.sheetNo,
          occurredOn: row.occurredOn,
          dateText: row.dateText,
          intakeNumber: row.intakeNumber,
          name: row.name,
          name2: row.name2,
          drawingNo: row.drawingNo,
          kyosanPartNo: row.kyosanPartNo,
          stockBefore: row.stockBefore,
          quantity: row.quantity,
          stockAfter: row.stockAfter,
          purposeText: row.purposeText,
          note: row.note,
          ownerText: row.ownerText,
          chargeText: row.chargeText,
          usagePlace: row.usagePlace,
          anomaly: row.anomaly,
          partId: partIdByNo.get(res.no)!,
          matchStatus: res.status,
          matchNote: res.note,
        });
      });
      for (let i = 0; i < records.length; i += 500) await tx.insert(legacyRecords).values(records.slice(i, i + 500));

      // 4. 전환일
      await tx
        .insert(appSettings)
        .values({ key: SETTING_TRANSITION_DATE, value: transitionDate, updatedBy: null, updatedByName: SCRIPT_NAME })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: transitionDate, updatedAt: new Date(), updatedBy: null, updatedByName: SCRIPT_NAME } });

      // 4-1. 엑셀 한 벌 「써야 함」 — 서버가 켜지면 1분 안에 한 벌을 쓴다 (조각 7). 한 줄뿐인 표의 고정 id (workbook-sync.ts 와 같다).
      await tx
        .insert(workbookStates)
        .values({ id: "00000000-0000-4000-8000-000000000001", dirtyAt: new Date() })
        .onConflictDoUpdate({ target: workbookStates.id, set: { dirtyAt: new Date(), updatedAt: new Date() } });

      // 5. 감사 로그
      const s = summarize(L.results);
      await tx.insert(auditLogs).values({
        action: "WORKBOOK_IMPORT",
        actorId: null,
        actorName: SCRIPT_NAME,
        target: "workbook",
        detail: {
          file: args.workbook.replace(/\\/g, "/").split("/").pop() ?? "",
          parts: L.parts.length,
          openingLines: opened,
          legacy: { confirmed: s.confirmed, groupDecided: s.groupDecided, ownerMismatch: s.ownerMismatch, unmatched: s.unmatched },
          transitionDate,
        },
      });
      console.log(`넣음: 부품 ${L.parts.length}개, 처음 수량 줄 ${opened}개, 과거 기록 ${records.length}건. 전환일 ${transitionDate}.`);
    });
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const L = load(args);
  report(args, L);
  if (args.unmatched) {
    const n = writeUnmatchedCsv(args.unmatched, L);
    console.log(`못 붙인 ${n}건을 CSV 로 남김: ${args.unmatched}`);
  }
  if (args.mode === "check-only") {
    console.log("검사만 — DB 에는 아무것도 쓰지 않았습니다.");
    return;
  }
  await importReal(args, L);
}

main().catch((e) => {
  console.error("가져오기 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
