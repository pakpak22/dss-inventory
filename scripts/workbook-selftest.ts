/**
 * 엑셀 한 벌 쓰기·백업 자체 점검 (조각 8, 2026-10-08 사용자 요청).
 *
 *   npm run workbook:selftest
 *
 * 하는 일: 지금 한 벌을 **한 번 쓰고**(평소 1분 주기와 같은 길, `writeWorkbookNow`), 그 결과로 다음 네 파일이 실제로 생겼는지·열리는지 확인한다.
 *   1) 원본 한 벌            STOCK_WORKBOOK_PATH
 *   2) 비교 기준본(그림자)    INVENTORY_DATA_DIR/baseline/<이름>
 *   3) 일일 백업            INVENTORY_DATA_DIR/backup/<이름>_YYYY-MM-DD.xlsx
 *   4) 월별 영구 백업        <원본 폴더>/OLD/<이름>_YYYY-MM.xlsx
 *
 * 🔴 경로를 코드에 박지 않는다 — 전부 환경변수에서 온다(CLAUDE.md 12-1절). 그래서 **운영(NAS)에 이식돼도 같은 명령으로 그대로 돈다.**
 * 🔴 실제 자료를 바꾸지 않는다 — DB 는 읽기만 하고, 엑셀 한 벌과 그 백업만 쓴다. 누가 원본을 손댔으면(PARKED) 덮어쓰지 않고 그 사실을 알린다.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { backupFileName, backupStem, monthlyBackupFileName } from "../src/lib/excel/workbook-backup";
import { writeWorkbookNow } from "../src/lib/excel/workbook-sync";
import { env } from "../src/lib/env";
import { readSheetGrid } from "../src/lib/xlsx/sheet-grid";
import { ZipArchive } from "../src/lib/xlsx/zip-reader";
import { loadDotEnvLocal } from "./lib/dotenv-local";

const SHEETS = ["부품 재고 현황", "사용처 기입란", "입고 기입란", "수량 변경 기록"];

function seoul(now: Date, withDay: boolean): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", ...(withDay ? { day: "2-digit" } : {}) });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return withDay ? `${p.year}-${p.month}-${p.day}` : `${p.year}-${p.month}`;
}

/** 파일이 있고(크기 > 0) 네 시트가 열리면 통과. */
async function checkWorkbookFile(label: string, filePath: string): Promise<boolean> {
  try {
    const st = await stat(filePath);
    if (st.size === 0) throw new Error("크기 0");
    const archive = ZipArchive.fromBuffer(await readFile(filePath));
    const missing = SHEETS.filter((name) => readSheetGrid(archive, name) === null);
    if (missing.length > 0) throw new Error(`시트 없음: ${missing.join(", ")}`);
    console.log(`  ✓ ${label}  (${st.size.toLocaleString("ko-KR")} B)  ${filePath}`);
    return true;
  } catch (e) {
    console.log(`  ✗ ${label}  — ${e instanceof Error ? e.message : e}  ${filePath}`);
    return false;
  }
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const now = new Date();
  const wb = env.stockWorkbookPath;
  const stem = backupStem(path.basename(wb));

  console.log("엑셀 한 벌 쓰기·백업 자체 점검");
  console.log("한 벌을 한 번 씁니다…");
  const result = await writeWorkbookNow();
  if (result.outcome !== "written") {
    if (result.outcome === "parked") {
      console.error(`\n✗ 멈춤: 누군가 원본 엑셀을 직접 고쳐 「${result.parkedFile}」 로 치워 두었습니다. 설정 > 엑셀 상태에서 처리한 뒤 다시 실행하십시오.`);
    } else {
      console.error(`\n✗ 쓰지 못했습니다 (${result.outcome}${"message" in result ? `: ${result.message}` : ""}).`);
    }
    process.exit(1);
  }
  console.log(`썼습니다: 부품 ${result.rows.parts} · 사용 ${result.rows.use} · 입고 ${result.rows.receive} · 변경 ${result.rows.change}줄 (${result.size.toLocaleString("ko-KR")} B)\n`);

  const checks: Array<[string, string]> = [
    ["원본 한 벌", wb],
    ["비교 기준본(그림자)", path.join(env.inventoryDataDir, "baseline", path.basename(wb))],
    ["일일 백업", path.join(env.inventoryDataDir, "backup", backupFileName(stem, seoul(now, true)))],
    ["월별 영구 백업(OLD)", path.join(path.dirname(wb), "OLD", monthlyBackupFileName(stem, seoul(now, false)))],
  ];
  let ok = true;
  for (const [label, p] of checks) ok = (await checkWorkbookFile(label, p)) && ok;

  console.log(ok ? "\n✅ 통과 — 네 파일 모두 생겼고 정상으로 열립니다." : "\n✗ 실패 — 위의 ✗ 를 보십시오.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("점검 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
