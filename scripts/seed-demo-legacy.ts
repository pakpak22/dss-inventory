/**
 * 만든 과거 기록(데모) 넣기. `npm run db:seed-demo-legacy`
 *
 * 조각 5 의 화면(전환일 이전 구역·연도별 사용 수량·사용된 제품)을 **실자료 없이** 확인하려고 둔다 (DESIGN 8절).
 * 실자료는 전환일에 `npm run db:import -- --real …` 로만 들어간다.
 *
 * 데모와 실자료를 가르는 장치 (seed-demo.ts 와 같다):
 *  - 부품이 전부 「예시 」로 시작할 때만 돈다. 실자료 부품이 하나라도 있으면 거절.
 *  - legacy_records 가 비어 있을 때만 돈다.
 *  - 전환일이 비어 있으면 데모용 값을 적는다(updated_by_name 에 「데모」라고 남긴다). 실자료 가져오기가 덮어쓴다.
 *  - 지우는 명령은 없다. 치우려면 개발 DB 를 통째로 다시 만든다.
 *
 * 값은 지어낸 것이다. 사람 이름은 실제 담당자 대신 「예시 」가 붙은 글자를 쓴다.
 */
import { sql as rawSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { appSettings, SETTING_TRANSITION_DATE } from "../src/db/schema/app-settings";
import { legacyRecords, type NewLegacyRecord } from "../src/db/schema/legacy-records";
import { parts } from "../src/db/schema/parts";
import { loadDotEnvLocal } from "./lib/dotenv-local";

const OWNER_TEXT: Record<string, string> = { DSS: "DSS", KYOSAN: "KYOSAN", SERVICE_SPARE: "보수부재" };
const MODELS = ["CMK300M-IC2", "RFK200FH-PS1", "MBK200-PS3", "KFK300M-IC", "CFK100-A"];
const PURPOSES = ["수리/예시 정영빈", "수리/예시 이남준", "수리/예시 최희만", "필드/예시 허진호", "수리/ 예시 정영빈"];
const DEMO_TRANSITION_DATE = "2026-10-01";

function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 이 비어 있습니다.");
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  try {
    const all = await db.select({ id: parts.id, no: parts.no, name: parts.name, name2: parts.name2, drawingNo: parts.drawingNo, owner: parts.owner, isDeleted: parts.isDeleted }).from(parts);
    if (all.length === 0) throw new Error("부품이 없습니다. 먼저 npm run db:seed-demo 를 돌리십시오.");
    // 지워진 부품은 보지 않는다 — 조각 3 시험 때 사람이 등록했다 지운 줄이 남아 있다(소프트 삭제). 과거 기록이 붙을 일도 없다.
    const real = all.filter((p) => !p.isDeleted && !p.name.startsWith("예시 "));
    if (real.length > 0) throw new Error(`「예시 」로 시작하지 않는 부품이 ${real.length}개 있습니다. 데모 과거 기록은 데모 부품에만 넣습니다.`);
    const [cnt] = await db.select({ n: rawSql<number>`count(*)`.mapWith(Number) }).from(legacyRecords);
    if ((cnt?.n ?? 0) > 0) throw new Error(`legacy_records 에 이미 ${cnt!.n}줄이 있습니다. 두 번 넣지 않습니다.`);

    const rnd = makeRandom(20261007);
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
    const live = all.filter((p) => !p.isDeleted).sort((a, b) => a.no - b.no);
    const chosen = live.filter(() => rnd() < 0.45);
    const records: NewLegacyRecord[] = [];
    let useRow = 2;
    let receiveRow = 2;
    let useNo = 0;
    let receiveNo = 0;
    for (const p of chosen) {
      const years = [2021, 2022, 2023, 2024, 2025, 2026].filter(() => rnd() < 0.6);
      let stock = 5 + Math.floor(rnd() * 40);
      for (const year of years) {
        // 입고 한두 번
        const receives = 1 + (rnd() < 0.3 ? 1 : 0);
        for (let i = 0; i < receives; i++) {
          const q = 5 + Math.floor(rnd() * 20);
          const m = String(1 + Math.floor(rnd() * 12)).padStart(2, "0");
          const d = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
          receiveNo++;
          const badDate = rnd() < 0.02;
          records.push({
            sheet: "RECEIVE",
            sourceRow: receiveRow++,
            sheetNo: receiveNo,
            occurredOn: badDate ? null : `${year}-${m}-${d}`,
            dateText: badDate ? `${year}-${m}-**` : `${year}-${m}-${d}`,
            intakeNumber: "",
            name: p.name,
            name2: p.name2 || "-",
            drawingNo: p.drawingNo || "-",
            kyosanPartNo: "-",
            stockBefore: stock,
            quantity: q,
            stockAfter: stock + q,
            purposeText: "",
            note: rnd() < 0.15 ? "YAC사양" : "",
            ownerText: OWNER_TEXT[p.owner],
            chargeText: "",
            usagePlace: "",
            anomaly: badDate ? `날짜 칸 「${year}-${m}-**」` : "",
            partId: p.id,
            matchStatus: rnd() < 0.08 ? "GROUP_DECIDED" : "CONFIRMED",
            matchNote: "",
          });
          stock += q;
        }
        // 사용 여러 번
        const uses = 1 + Math.floor(rnd() * 5);
        for (let i = 0; i < uses; i++) {
          const q = 1 + Math.floor(rnd() * 3);
          if (stock - q < 0) break;
          const m = String(1 + Math.floor(rnd() * 12)).padStart(2, "0");
          const d = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
          const model = pick(MODELS);
          const intake = `D${String(year).slice(2)}${m}${String(1 + Math.floor(rnd() * 9)).padStart(2, "0")}`;
          const serial = `W${String(1000 + Math.floor(rnd() * 9000))}`;
          const noCase = rnd() < 0.05;
          const mismatch = rnd() < 0.06;
          useNo++;
          records.push({
            sheet: "USE",
            sourceRow: useRow++,
            sheetNo: i === 0 ? useNo : null,
            occurredOn: `${year}-${m}-${d}`,
            dateText: `${year}-${m}-${d}`,
            intakeNumber: noCase ? "一" : intake,
            name: p.name,
            name2: p.name2 || "-",
            drawingNo: p.drawingNo || "-",
            kyosanPartNo: "-",
            stockBefore: stock,
            quantity: q,
            stockAfter: stock - q,
            purposeText: pick(PURPOSES),
            note: rnd() < 0.1 ? "예시 비고" : "",
            ownerText: mismatch ? (p.owner === "DSS" ? "KYOSAN" : "DSS") : OWNER_TEXT[p.owner],
            chargeText: noCase ? "-" : rnd() < 0.8 ? "유상" : "무상",
            usagePlace: noCase ? "" : `${intake}_${model}_${serial}_${2200000 + Math.floor(rnd() * 9999)}`,
            anomaly: "",
            partId: p.id,
            matchStatus: mismatch ? "OWNER_MISMATCH" : rnd() < 0.08 ? "GROUP_DECIDED" : "CONFIRMED",
            matchNote: mismatch ? `소유 불일치: 기록은 「${p.owner === "DSS" ? "KYOSAN" : "DSS"}」, 부품 No.${p.no} 은 「${OWNER_TEXT[p.owner]}」` : "",
          });
          stock -= q;
        }
      }
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < records.length; i += 500) await tx.insert(legacyRecords).values(records.slice(i, i + 500));
      await tx
        .insert(appSettings)
        .values({ key: SETTING_TRANSITION_DATE, value: DEMO_TRANSITION_DATE, updatedBy: null, updatedByName: "db:seed-demo-legacy (데모)" })
        .onConflictDoNothing();
    });
    const [t] = await db.select({ value: appSettings.value }).from(appSettings).where(rawSql`${appSettings.key} = ${SETTING_TRANSITION_DATE}`);
    console.log(`데모 과거 기록 ${records.length}건 넣음 (부품 ${chosen.length}개). 전환일 ${t?.value ?? "(없음)"}.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("데모 과거 기록 넣기 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
