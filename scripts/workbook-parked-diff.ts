/**
 * 치워 둔 파일 vs 프로그램 기준본 차이를 터미널에 찍는다 (조각 8-A 점검용, 운영에서도 같은 명령).
 *   npm run workbook:parked-diff            — 차이(8-A)
 *   npm run workbook:parked-diff -- --plan  — 차이 + [엑셀 기준 적용] 계획(8-B: 원장에 적을 건·반영 불가 줄). 적지는 않는다.
 * DB 는 읽기만. 화면(/settings/workbook, /settings/workbook/apply)이 보여 주는 것과 같은 결과다.
 * 🔴 node --conditions=react-server 로 돈다(계획 쪽이 ledger 를 거쳐 server-only 를 끌어온다). 최상위 await 금지(CJS).
 */
import { loadDotEnvLocal } from "./lib/dotenv-local";
loadDotEnvLocal();
import { readParkedDiff } from "../src/lib/excel/workbook-sync";
import { readParkedPlan } from "../src/lib/excel/workbook-apply-run";
import { summarizePlan } from "../src/lib/excel/workbook-apply";

async function main(): Promise<void> {
  const r = await readParkedDiff();
  if (!r.available) {
    console.log(`차이 없음/볼 수 없음: ${r.reason}${r.message ? ` — ${r.message}` : ""} (치워 둔 파일: ${r.parkedFile ?? "없음"})`);
    return;
  }
  console.log(`치워 둔 파일: ${r.parkedFile} · 바뀐/더한/사라진 줄 합계 ${r.diff.totalChanges}`);
  for (const s of r.diff.sheets) {
    if (s.changed.length + s.added.length + s.removed.length === 0) continue;
    console.log(`\n[${s.sheet}] 바뀐 ${s.changed.length} · 더한 ${s.added.length} · 사라진 ${s.removed.length}`);
    for (const row of s.changed) for (const c of row.cells) console.log(`  ${row.label} · ${c.label}(${c.col}): ${c.before} → ${c.after}`);
    for (const row of s.added) console.log(`  + ${row.label}: ${row.values.join(" | ")}`);
    for (const row of s.removed) console.log(`  - ${row.label}: ${row.values.join(" | ")}`);
  }
  if (!process.argv.includes("--plan")) return;
  const planned = await readParkedPlan();
  if (!planned.available) {
    console.log(`
[계획] 세울 수 없음: ${planned.reason}${planned.message ? ` — ${planned.message}` : ""}`);
    return;
  }
  const plan = planned.plan;
  console.log(`
[엑셀 기준 적용 계획] ${summarizePlan(plan)} · 지문 ${plan.fingerprint.slice(0, 12)}…`);
  for (const e of plan.entries) console.log(`  + ${e.sheet} ${e.rowLabel} → ${e.summary}${e.excelNote ? ` · 비고 「${e.excelNote}」` : ""}`);
  for (const r of plan.reconcile) console.log(`  = No. ${r.partNo} ${r.partName}: 프로그램 ${r.programQuantity} → 반영 뒤 ${r.expectedQuantity} / 엑셀 ${r.excelQuantity} → ${r.adjustDelta === 0 ? "조정 없음" : `조정 ${r.adjustDelta > 0 ? "+" : ""}${r.adjustDelta}`}`);
  for (const k of plan.skipped) console.log(`  ! ${k.sheet} ${k.rowLabel} — ${k.reason}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
