/**
 * 만든 자료(데모 부품) 넣기. `npm run db:seed-demo`
 *
 * 🔴 실제 자료(부품 319개·과거 기록)는 담당자가 백업을 확인해 준 뒤 조각 5 의 가져오기 스크립트로 넣는다.
 *    그 전까지 조각 2~7 은 이 **만든 자료**로 확인한다 (DESIGN 8절).
 *
 * 데모와 실자료를 가르는 장치 (CLAUDE.md 2-0절):
 *  - 품명이 전부 「예시 」로 시작한다. 한눈에 보이고, 찾기로 걸러진다.
 *  - **부품이 하나라도 있으면 돌지 않는다.** 실자료 위에 데모가 섞이는 일을 막는다.
 *  - 지우는 명령은 두지 않는다. 데모를 치우려면 개발 DB 를 통째로 다시 만든다
 *    (`npm run db:down -- -v` 뒤 `db:up`·`db:migrate`). 실자료가 든 DB 에서 그 명령을 칠 일은 없다.
 *
 * 수량은 조각 4(원장) 전이라 stock_balances 에 바로 넣는다. 조각 4 가 들어오면 「처음 수량」 기록으로 바뀐다.
 * 값은 전부 지어낸 것이다 — 실제 품번·도번·가격과 겹치지 않도록 DEMO 가 들어간 글자를 쓴다.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { CATEGORIES, OWNERS, type Category, type Owner } from "../src/db/schema/codes";
import { partItems } from "../src/db/schema/part-items";
import { parts } from "../src/db/schema/parts";
import { stockBalances } from "../src/db/schema/stock-balances";
import { PART_ITEM_SEED } from "../src/db/seed/part-items";
import { loadDotEnvLocal } from "./lib/dotenv-local";

const NOTES = [
  "",
  "",
  "2024.04.07 재고 100EA시 주문 필요",
  "241217 공급가격 상승 87만엔 -->118만엔\n241218 견적가격 1200만 -->1550만으로 결정",
  "트랜스 조립형(4) , 19개 오래됨",
  "국내 구매품. 세금계산서 별도",
  "YAC사양 전용. 일반 기종에 쓰지 말 것",
  "",
  "2025.03 입고분부터 포장 단위 변경 (10EA → 5EA)\n구형과 호환되지 않음\n잔량 소진 후 신형으로 전환",
];

interface DemoPart {
  name: string;
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
  supplyPrice: number | null;
  supplyCurrency: "JPY" | "KRW";
  quotePrice: number | null;
  note: string;
  itemCode: string;
  category: Category;
  owner: Owner;
  quantity: number;
}

/** 결정적(같은 값이 매번 나온다) 의사난수. 시험·화면 확인에서 숫자가 흔들리지 않게. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function buildDemoParts(): DemoPart[] {
  const rnd = makeRandom(20261006);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const out: DemoPart[] = [];
  let n = 0;
  for (const item of PART_ITEM_SEED) {
    // 항목마다 2~5개. PCB 는 좀 더.
    const count = item.code === "PCB" ? 8 : 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      n++;
      const idx = String(n).padStart(3, "0");
      const owner = pick(OWNERS);
      const category = pick(CATEGORIES);
      const krw = rnd() < 0.15;
      const hasSupply = rnd() > 0.12;
      const hasQuote = rnd() > 0.1;
      const supplyBase = krw ? 5000 + Math.floor(rnd() * 400) * 1000 : 200 + Math.floor(rnd() * 600) * 100;
      out.push({
        name: `예시 ${item.name}-${idx}`,
        name2: rnd() < 0.45 ? `DEMO-${item.code}-${idx}` : "",
        kyosanPartNo: rnd() < 0.7 ? `C0DEMO${idx}` : "",
        drawingNo: rnd() < 0.8 ? `WRDEMO${idx}A` : "",
        supplyPrice: hasSupply ? supplyBase : null,
        supplyCurrency: krw ? "KRW" : "JPY",
        quotePrice: hasQuote ? supplyBase * (krw ? 2 : 25) : null,
        note: pick(NOTES),
        itemCode: item.code,
        category,
        owner,
        quantity: rnd() < 0.12 ? 0 : Math.floor(rnd() * 120),
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 이 비어 있습니다.");
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  try {
    const existing = await db.select({ id: parts.id }).from(parts).limit(1);
    if (existing.length > 0) {
      throw new Error("parts 표에 이미 부품이 있습니다. 데모는 빈 DB 에만 넣습니다 — 실자료 위에 섞지 않습니다.");
    }
    const items = await db.select({ id: partItems.id, code: partItems.code }).from(partItems);
    const itemId = new Map(items.map((it) => [it.code, it.id]));
    const missing = PART_ITEM_SEED.filter((s) => !itemId.has(s.code)).map((s) => s.code);
    if (missing.length > 0) {
      throw new Error(`항목이 아직 없습니다: ${missing.join(", ")}. 먼저 npm run db:seed-items 를 돌리십시오.`);
    }

    const demo = buildDemoParts();
    await db.transaction(async (tx) => {
      for (const d of demo) {
        const [row] = await tx
          .insert(parts)
          .values({
            name: d.name,
            name2: d.name2,
            kyosanPartNo: d.kyosanPartNo,
            drawingNo: d.drawingNo,
            supplyPrice: d.supplyPrice,
            supplyCurrency: d.supplyCurrency,
            quotePrice: d.quotePrice,
            note: d.note,
            itemId: itemId.get(d.itemCode)!,
            category: d.category,
            owner: d.owner,
          })
          .returning({ id: parts.id });
        await tx.insert(stockBalances).values({ partId: row.id, quantity: d.quantity });
      }
    });
    console.log(`데모 부품 ${demo.length}개 넣음 (품명이 전부 「예시 」로 시작).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("데모 자료 넣기 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
