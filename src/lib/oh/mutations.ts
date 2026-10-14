import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import {
  ohPartTemplateItems,
  ohPartTemplateModels,
  ohPartTemplates,
  partOverhaulUnitPrices,
} from "@/db/schema/oh-templates";
import { parts } from "@/db/schema/parts";
import { auditValues } from "@/lib/audit";
import type { OhPriceEntry, OhTemplateFields } from "./input";

/**
 * ============================================================================
 * O/H 부품 템플릿 — 만들고 고치고 모델을 잇는다
 * ============================================================================
 * A/S 의 `src/lib/db/mutations/oh-part-templates.ts` 와 `part-overhaul-unit-prices.ts` 의
 * **판단을 그대로** 옮겨 온 것이다(2026-10-15, 조각 8a). 이 계층은 **기계**이고, 누가 고칠 수
 * 있는지는 서버 액션이 본다(`src/app/actions/oh-templates.ts`).
 *
 * ── 부품 줄은 통째로 갈아 끼운다 ────────────────────────────────────────
 * 폼이 목록을 통째로 편집하므로, 저장이 받는 것은 「이 템플릿의 부품은 지금부터 이것이 전부」라는
 * 말이다. 차례는 **저장하는 쪽이 1부터** 매긴다(배열 자리 + 1) — 화면이 보낸 번호를 믿지 않는다.
 * **양식의 부품 순서가 그대로 뜻을 갖는다**(휴즈 22개가 셋째 줄인 데는 이유가 있다).
 *
 * ── 🔴 이어진 줄의 품명은 **서버가 정한다**(2026-10-15, 조각 9b) ────────
 * 2026-10-15 까지는 화면의 품명 칸이 `<input list>` 라 「골랐다」는 사건이 없고 글자만 왔다.
 * 그래서 연결을 만드는 유일한 몸짓이 **이름 일치**였고, 이 자리에서 `resolvePartLinkId` 가
 * 글자로 연결을 다시 매겼다(어긋나면 풀었다). **이제 진짜 고르개가 있다** — 연결은 고를 때
 * 맺히고, 그 줄의 품명은 사람이 치는 글자가 아니라 **그 부품의 고객사 품명**
 * (`parts.customer_name`)이다. 그래서 다시 매길 것이 없어 그 함수를 지웠다.
 *
 * 대신 이 자리에서 하는 일이 둘이다:
 *  1. **화면이 보낸 `part_id` 를 믿지 않는다.** 지금 살아 있는(안 지워진) 부품인지 확인하고,
 *     아니면 그 줄을 짚어 **거절한다**. 조용히 `null` 로 풀면 이어 두었던 줄이 자유 입력 줄로
 *     바뀌어 버리는데, 그것은 사람이 시키지 않은 변화다.
 *  2. **`part_name_text` 를 그 부품의 고객사 품명으로 채운다.** 화면이 보낸 글자를 쓰지 않는다 —
 *     견적서에 찍히는 이름의 정본은 `parts.customer_name` 이고, 화면이 들고 있던 값은 그 사이
 *     바뀌었을 수 있다. 🔴 **고객사 품명이 비어 있으면 품명도 빈 글자다**(2026-10-15 사용자 결정).
 *     우리 품명으로 대신 채우지 않는다 — O/H 단가가 없을 때 일반 단가로 대신 채우지 않는 것과
 *     같은 규칙이고, 채우면 고객사에 **우리 내부 이름이 찍혀 나간다.**
 *
 * 🔵 자유 입력 줄(`part_id` 가 `null`)은 그대로다 — 재고 마스터에 없는 이름이 실제로 있고,
 * 그 줄의 품명은 사람이 적은 글자 그것뿐이다.
 * 🔵 화면은 같은 잣대를 `link-state.ts` 의 `describeOhPartLink` 로 본다(고객사 품명이 비었으면
 * 빨간 딱지, 지워진 부품이면 연결 풀기). 한쪽만 고치면 저장 결과가 화면과 달라진다.
 *
 * ── 모델 연결은 저장과 따로 움직인다 ────────────────────────────────────
 * 부품 목록을 고치는 일과 모델을 잇는 일은 사람에게 다른 행동이고, 한 번의 저장으로 묶으면
 * 「모델 하나 붙이려다 부품 목록까지 통째로 다시 보내는」 모양이 된다.
 *
 * ── 🔴 부품별 O/H 단가도 **같은 트랜잭션에서** 저장한다 ─────────────────
 * 화면이 부품 목록과 부품별 O/H 단가를 한 표에서 한 단추로 저장한다. 앞은 이 표에, 단가는
 * `part_overhaul_unit_prices` 에 사는데, 트랜잭션을 따로 열면 「부품 목록은 저장됐는데 단가는 안
 * 된」 반쪽 상태가 생긴다. 게다가 이 저장은 `version` 을 올리므로 **실패한 저장이 버전만
 * 올려놓고 끝난다** — 그러면 화면은 다음 저장에서 까닭 없이 충돌을 만난다.
 *
 * ── 🔴 거절은 반드시 **던진다** ─────────────────────────────────────────
 * 트랜잭션 콜백에서 그냥 `return` 하면 **커밋된다.** 아무것도 쓰기 전의 거절이라면 빈 트랜잭션이
 * 커밋될 뿐 무해하지만, 단가 저장은 템플릿을 이미 고친 뒤에 돌기 때문에 거기서 반환하면 **템플릿만
 * 저장되고 단가는 빠진 채 커밋된다.** 한 트랜잭션으로 묶은 까닭이 통째로 무너진다. 자리마다 다르게
 * 하지 않고 전부 던진다 — 「여기는 반환해도 되는 자리인가」를 매번 따지게 만들면 언젠가 틀린다.
 * ============================================================================
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** 템플릿을 고치는 사람. 이 시스템의 세션에서 온다. */
export type OhActor = { id: string; name: string };

export type OhTemplateResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type SaveOhTemplateResult =
  | { ok: true; id: string; version: number; created: boolean }
  | { ok: false; code: OhTemplateResultCode; message: string; fieldErrors?: Record<string, string> };

const CONFLICT_MESSAGE = "다른 사람이 먼저 저장했습니다. 새로 고친 뒤 다시 시도하십시오.";
const NOT_FOUND_MESSAGE = "해당 템플릿을 찾을 수 없습니다.";
const PART_NOT_FOUND_MESSAGE = "해당 부품을 찾을 수 없습니다.";

/** 거절을 트랜잭션 밖으로 던지기 위한 신호(머리말). */
class OhRejected extends Error {
  constructor(readonly result: { ok: false; code: OhTemplateResultCode; message: string; fieldErrors?: Record<string, string> }) {
    super(result.message);
    this.name = "OhRejected";
  }
}

function reject(code: OhTemplateResultCode, message: string, fieldErrors?: Record<string, string>): never {
  throw new OhRejected({ ok: false, code, message, fieldErrors });
}

/**
 * 살아 있는 템플릿 중 같은 **이름**이 있는가. 🔴 **지운 이름은 다시 쓸 수 있다**(부분 unique 와
 * 같은 잣대).
 *
 * 🔵 2026-10-15 까지는 **기종 코드**로 보던 검사다. 코드를 없애면서 이름으로 옮겼다 — 이름이
 * 템플릿을 가리키는 유일한 글자가 되었으므로, 같은 이름이 둘 서면 사람이 어느 것을 고칠지
 * 알 수 없다(`src/db/schema/oh-templates.ts` 머리말).
 */
async function nameTaken(tx: Tx, name: string, excludeId: string | null): Promise<boolean> {
  const conditions = [eq(ohPartTemplates.name, name), eq(ohPartTemplates.isDeleted, false)];
  if (excludeId) conditions.push(ne(ohPartTemplates.id, excludeId));
  const [row] = await tx.select({ id: ohPartTemplates.id }).from(ohPartTemplates).where(and(...conditions)).limit(1);
  return Boolean(row);
}

/** 부품 줄을 통째로 다시 쓴다. 차례는 **여기서** 1부터 매긴다(머리말). */
async function replaceItems(
  tx: Tx,
  templateId: string,
  items: readonly { partId: string | null; partNameText: string; quantity: number }[],
) {
  await tx.delete(ohPartTemplateItems).where(eq(ohPartTemplateItems.templateId, templateId));
  if (items.length === 0) return;
  await tx.insert(ohPartTemplateItems).values(
    items.map((item, index) => ({
      templateId,
      displayOrder: index + 1,
      partId: item.partId,
      partNameText: item.partNameText,
      quantity: item.quantity,
    })),
  );
}

/* ───────────────────────── 부품별 O/H 단가 ───────────────────────── */

/**
 * 부품 한 칸분의 단가 저장. 지우기·넣기·그대로 두기 셋 중 하나이고, 실제로 쓴 칸의 수(0 또는 1)를
 * 돌려준다. **트랜잭션도 권한 검사도 여기서 하지 않는다** — 부르는 쪽이 이미 마쳤다.
 *
 *  · 🔴 **빈 값은 0 으로 저장하지 않고 행을 지운다.** 「정하지 않음」과 「0원(무상)」은 다른 뜻이다
 *    (`src/db/schema/oh-templates.ts` 머리말). 0 으로 바꿔 저장하면 O/H 견적서가 정하지 않은
 *    부품을 0원으로 청구하게 된다.
 *  · **바뀌지 않은 칸은 쓰지 않는다.** 저장을 눌렀다는 이유만으로 `updated_by`·`updated_at` 이
 *    갈아엎어지면, 「누가 이 O/H 단가를 정했나」를 물었을 때 실제로 정한 사람이 아니라 마지막으로
 *    저장 단추를 누른 사람이 나온다.
 *  · 행을 지울 때도 감사는 **같은 행위(`OH_PRICE_SET`)로** 남긴다 — 지움도 「단가를 이렇게
 *    정했다」의 한 갈래이고, 지우기 전용 행위를 따로 두면 이력에서 한 칸의 역사가 둘로 갈린다.
 */
async function applyOnePrice(
  tx: Tx,
  params: { partId: string; partNo: number; partName: string; unitPrice: number | null; actor: OhActor },
): Promise<number> {
  const { partId, unitPrice } = params;

  const [previous] = await tx
    .select({ id: partOverhaulUnitPrices.id, unitPrice: partOverhaulUnitPrices.unitPrice })
    .from(partOverhaulUnitPrices)
    .where(eq(partOverhaulUnitPrices.partId, partId));

  const audit = (before: number | null, after: number | null) =>
    tx.insert(auditLogs).values(
      auditValues({
        action: "OH_PRICE_SET",
        actorId: params.actor.id,
        actorName: params.actor.name,
        // 🔵 대상은 **부품**이다. 그래야 부품 상세의 [변경 이력](`/audit?part=No.`)에서 함께 보인다.
        target: `parts:No.${params.partNo}`,
        detail: { partName: params.partName, before, after },
      }),
    );

  // ── 비운 칸 = 정하지 않음 → 행을 지운다(0 으로 저장하지 않는다) ────────
  if (unitPrice === null) {
    if (!previous) return 0;
    await tx.delete(partOverhaulUnitPrices).where(eq(partOverhaulUnitPrices.id, previous.id));
    await audit(previous.unitPrice, null);
    return 1;
  }

  // ── 바뀌지 않았으면 쓰지 않는다 ────────────────────────────────────────
  // 🔵 원본은 `numeric` 이라 문자열 비교를 조심해야 했지만(DB 가 "125000.00" 을 돌려준다),
  //    이 저장소는 `bigint`(원 단위)라 숫자끼리 그대로 견준다.
  if (previous && previous.unitPrice === unitPrice) return 0;

  await tx
    .insert(partOverhaulUnitPrices)
    .values({ partId, unitPrice, updatedBy: params.actor.id })
    .onConflictDoUpdate({
      // 부품마다 한 줄이므로 충돌 대상도 part_id 한 칸이다.
      target: partOverhaulUnitPrices.partId,
      set: { unitPrice, updatedBy: params.actor.id, updatedAt: new Date() },
    });
  await audit(previous?.unitPrice ?? null, unitPrice);
  return 1;
}

/**
 * 줄들을 **남의 트랜잭션 안에서** 적용한다. `saveOhTemplate` 과 `setPartOverhaulPrice` 가 이 함수
 * 하나를 함께 쓴다 — 잠금 순서와 「하나라도 없으면 전부 거절」 규칙을 두 곳에 베껴 두면 한쪽만
 * 고쳐지는 날 두 진입점이 다르게 행동한다.
 *
 * ⚠️ 여러 부품을 한꺼번에 잡으므로 **잡는 순서를 id 로 고정한다.** 두 사람이 겹치는 부품 목록을
 * 서로 다른 순서로 저장하면 교착(deadlock)이 난다. 순서가 같으면 뒤엣사람이 기다렸다 이어서 할 뿐이다.
 *
 * 🔴 하나라도 없으면 **전부 거절한다.** 없는 부품을 조용히 건너뛰면 사람은 그 줄까지 저장됐다고 믿는다.
 */
async function applyPricesInTx(
  tx: Tx,
  entries: readonly OhPriceEntry[],
  actor: OhActor,
): Promise<number> {
  // 고칠 줄이 없으면 질의를 열지 않는다(inArray 에 빈 배열을 넘기지 않기 위한 방어이기도 하다).
  if (entries.length === 0) return 0;

  const partIds = entries.map((entry) => entry.partId);
  const locked = await tx
    .select({ id: parts.id, no: parts.no, name: parts.name })
    .from(parts)
    .where(and(inArray(parts.id, partIds), eq(parts.isDeleted, false)))
    // 🔴 잡는 순서를 고정한다 — 위 머리말의 교착 이야기.
    .orderBy(parts.id)
    .for("update");

  const byId = new Map(locked.map((part) => [part.id, part]));
  if (byId.size !== partIds.length) reject("NOT_FOUND", PART_NOT_FOUND_MESSAGE);

  let changed = 0;
  for (const entry of entries) {
    const part = byId.get(entry.partId);
    if (!part) reject("NOT_FOUND", PART_NOT_FOUND_MESSAGE);
    changed += await applyOnePrice(tx, {
      partId: entry.partId,
      partNo: part.no,
      partName: part.name,
      unitPrice: entry.unitPrice,
      actor,
    });
  }
  return changed;
}

export type SetOhPriceResult = { ok: true; changed: boolean } | { ok: false; message: string };

/**
 * 부품 하나의 O/H 단가. 🔴 `null` 이면 그 줄을 **지운다** — 「행이 없다」와 「0을 저장했다」는 다르다.
 *
 * 🔵 템플릿 저장과 따로 쓸 수 있는 길이다(화면이 단가 칸 하나만 고쳐 보낼 때). 규칙은 위
 * `applyPricesInTx` 를 그대로 지나므로 두 길이 다르게 행동하지 않는다.
 */
export async function setPartOverhaulPrice(
  partId: string,
  unitPrice: number | null,
  actor: OhActor,
): Promise<SetOhPriceResult> {
  try {
    const changed = await db().transaction(async (tx) => applyPricesInTx(tx, [{ partId, unitPrice }], actor));
    return { ok: true, changed: changed > 0 };
  } catch (err) {
    if (err instanceof OhRejected) return { ok: false, message: err.result.message };
    throw err;
  }
}

/* ───────────────────────── 템플릿 저장 ───────────────────────── */

export type SaveOhTemplateParams = {
  /** `null` 이면 새로 만든다. */
  id: string | null;
  /** 🔴 고칠 때 **반드시** 보낸다. 지금 `version` 과 다르면 거절한다. 새로 만들 때는 `null`. */
  expectedVersion: number | null;
  fields: OhTemplateFields;
  /**
   * 부품별 O/H 단가. 같은 트랜잭션에서 함께 저장된다(머리말).
   * **보내지 않으면(`undefined`) 단가를 아예 건드리지 않는다** — 빈 배열(「고칠 칸이 없다」)과 뜻이 다르다.
   */
  prices?: readonly OhPriceEntry[];
  actor: OhActor;
};

/**
 * 머리(이름·비고)와 부품 줄 전체를 한 번에 저장한다. 🔵 원본은 `createOhTemplate` 과
 * `updateOhTemplate` 둘로 나뉘어 있는데, 여기서는 **한 함수**다 — 두 길이 공유하는 것(이름 중복
 * 검사 · 재고 연결·품명 정하기 · 줄 갈아 끼우기 · 단가 · 감사)이 거의 전부라, 나눠 두면 한쪽만
 * 고쳐지는 자리가 그만큼 는다. 가르는 것은 `id` 하나다.
 */
export async function saveOhTemplate(params: SaveOhTemplateParams): Promise<SaveOhTemplateResult> {
  const { fields, actor } = params;
  try {
    return await db().transaction(async (tx): Promise<SaveOhTemplateResult> => {
      // ── 1. 고치는 경우: 줄을 잡고 판 번호를 맞춰 본다 ──────────────────
      let previous: { name: string; note: string | null; version: number } | null = null;
      if (params.id !== null) {
        const [existing] = await tx
          .select({
            id: ohPartTemplates.id,
            version: ohPartTemplates.version,
            isDeleted: ohPartTemplates.isDeleted,
            // 감사의 이전 값. 어차피 이 줄을 잡으려고 읽으므로 질의를 새로 열지 않는다.
            name: ohPartTemplates.name,
            note: ohPartTemplates.note,
          })
          .from(ohPartTemplates)
          .where(eq(ohPartTemplates.id, params.id))
          .limit(1)
          .for("update");

        if (!existing || existing.isDeleted) reject("NOT_FOUND", NOT_FOUND_MESSAGE);
        // 🔴 낙관적 잠금. 이 검사가 없으면 나중에 저장한 사람이 앞사람 것을 **조용히** 덮고,
        //    덮인 쪽은 자기 저장이 성공했다고 믿으므로 아무도 알아차리지 못한다.
        if (existing.version !== params.expectedVersion) reject("CONFLICT", CONFLICT_MESSAGE);
        previous = { name: existing.name, note: existing.note, version: existing.version };
      }

      // ── 2. 이름 중복 — **안 지워진 것만** 본다(부분 unique 와 같은 잣대) ─
      if (await nameTaken(tx, fields.name, params.id)) {
        reject("VALIDATION_ERROR", `「${fields.name}」 이라는 이름의 템플릿이 이미 있습니다.`, {
          name: `「${fields.name}」 이라는 이름의 템플릿이 이미 있습니다.`,
        });
      }

      // ── 3. 🔴 이어진 줄의 연결과 품명을 **서버가 정한다**(머리말) ────────
      //    화면이 보낸 partId 는 「살아 있는 부품인가」를 확인하고, 품명은 그 부품의 고객사
      //    품명으로 채운다(비어 있으면 빈 글자 그대로). 자유 입력 줄은 보낸 글자 그대로.
      const livePartRows = await tx
        .select({ id: parts.id, no: parts.no, customerName: parts.customerName })
        .from(parts)
        .where(eq(parts.isDeleted, false));
      const livePartById = new Map(livePartRows.map((part) => [part.id, part]));
      const items = fields.items.map((item, index) => {
        if (item.partId === null) {
          return { partId: null, partNameText: item.partNameText, quantity: item.quantity };
        }
        const part = livePartById.get(item.partId);
        // 🔴 없거나 지워진 부품이면 그 줄을 짚어 거절한다. 조용히 풀지 않는다(머리말).
        if (!part) {
          reject("VALIDATION_ERROR", PART_NOT_FOUND_MESSAGE, {
            [`items.${index}.partId`]: `${index + 1}번째 줄이 이어 둔 부품을 찾을 수 없습니다. 연결을 풀고 다시 고르십시오.`,
          });
        }
        return { partId: part.id, partNameText: part.customerName, quantity: item.quantity };
      });

      // ── 4. 머리 ────────────────────────────────────────────────────────
      let templateId: string;
      let version: number;
      if (params.id === null) {
        const [created] = await tx
          .insert(ohPartTemplates)
          .values({
            name: fields.name,
            note: fields.note,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: ohPartTemplates.id, version: ohPartTemplates.version });
        templateId = created.id;
        version = created.version;
      } else {
        const [updated] = await tx
          .update(ohPartTemplates)
          .set({
            name: fields.name,
            note: fields.note,
            version: sql`${ohPartTemplates.version} + 1`,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(ohPartTemplates.id, params.id))
          .returning({ id: ohPartTemplates.id, version: ohPartTemplates.version });
        templateId = updated.id;
        version = updated.version;
      }

      // ── 5. 부품 줄 ─────────────────────────────────────────────────────
      //    🔴 판 번호 대조를 통과한 뒤에만 건드린다 — 충돌로 끝난 저장이 부품을 먼저 지워
      //    버리면, 실패한 저장이 자료를 지우고 간 셈이 된다.
      await replaceItems(tx, templateId, items);

      // ── 6. 단가 — 같은 트랜잭션(머리말) ─────────────────────────────────
      //    여기서 거절되면 위의 version 증가와 줄 교체까지 함께 되돌아간다. 그것이 이 자리에
      //    있는 까닭이다.
      if (params.prices !== undefined) await applyPricesInTx(tx, params.prices, actor);

      // ── 7. 감사 — 본 작업과 한 트랜잭션(CLAUDE.md 11절) ─────────────────
      await tx.insert(auditLogs).values(
        auditValues({
          action: "OH_TEMPLATE_SAVED",
          actorId: actor.id,
          actorName: actor.name,
          // 🔵 대상 글자가 **이름**이다(2026-10-15 기종 코드를 없앰). 감사 로그는 고쳐 넣지 않는
          //    append-only 라, 그 전에 쌓인 줄에는 `oh_templates:301` 처럼 코드가 남아 있다 —
          //    `describeTarget` 이 둘 다 그대로 보여 준다.
          target: `oh_templates:${fields.name}`,
          detail: {
            created: params.id === null,
            version,
            previousVersion: previous?.version ?? null,
            name: fields.name,
            note: fields.note,
            previous: previous ? { name: previous.name, note: previous.note } : null,
            itemCount: items.length,
            // 🔴 줄을 **글자로** 남긴다. id 만 적으면 로그가 스스로를 설명하지 못하고, 이 표는
            //    줄을 통째로 갈아 끼우므로 나중에 「그때 무엇이 들어 있었나」를 되찾을 길이 없다.
            items: items.map((item, index) => ({
              displayOrder: index + 1,
              partNameText: item.partNameText,
              quantity: item.quantity,
              linked: item.partId !== null,
            })),
          },
        }),
      );

      return { ok: true, id: templateId, version, created: params.id === null };
    });
  } catch (err) {
    if (err instanceof OhRejected) return err.result;
    throw err;
  }
}

/* ───────────────────────── 지우기 ───────────────────────── */

/** 🔵 성공하면 **지운 템플릿의 이름**을 돌려준다 — 부르는 쪽이 「무엇을 지웠다」고 말할 글자다. */
export type DeleteOhTemplateResult = { ok: true; name: string } | { ok: false; message: string };

/**
 * 소프트 삭제(4칸 고정, CLAUDE.md 11절). **사유를 받는다** — `src/lib/parts/mutations.ts` 의
 * `deletePart` 가 이 저장소의 본보기다.
 *
 * 🔵 딸린 줄(items)과 모델 잇기(models)는 `ON DELETE CASCADE` 지만 소프트 삭제에서는 돌지 않는다.
 * **일부러다**: 되살릴 때 그대로 돌아와야 하고, 모델 잇기를 지우면 그 모델이 다른 템플릿에 붙을 수
 * 있게 되어 「지웠다가 되살렸더니 모델이 사라졌다」가 된다.
 */
export async function deleteOhTemplate(id: string, reason: string, actor: OhActor): Promise<DeleteOhTemplateResult> {
  const now = new Date();
  try {
    return await db().transaction(async (tx): Promise<DeleteOhTemplateResult> => {
      const [existing] = await tx
        .select({ id: ohPartTemplates.id, name: ohPartTemplates.name, isDeleted: ohPartTemplates.isDeleted })
        .from(ohPartTemplates)
        .where(eq(ohPartTemplates.id, id))
        .limit(1)
        .for("update");
      if (!existing || existing.isDeleted) reject("NOT_FOUND", NOT_FOUND_MESSAGE);

      await tx
        .update(ohPartTemplates)
        .set({ isDeleted: true, deletedAt: now, deletedBy: actor.id, deleteReason: reason, updatedAt: now, updatedBy: actor.id })
        .where(eq(ohPartTemplates.id, id));

      await tx.insert(auditLogs).values(
        auditValues({
          action: "OH_TEMPLATE_DELETED",
          actorId: actor.id,
          actorName: actor.name,
          target: `oh_templates:${existing.name}`,
          detail: { name: existing.name, reason },
        }),
      );
      return { ok: true, name: existing.name };
    });
  } catch (err) {
    if (err instanceof OhRejected) return { ok: false, message: err.result.message };
    throw err;
  }
}

/* ───────────────────────── 모델 잇기 ───────────────────────── */

export type OhLinkResult = { ok: true } | { ok: false; message: string };

/**
 * 제품 모델을 템플릿에 잇는다.
 *
 * 🔴 **모델 하나는 템플릿 하나에만 붙는다**(`oh_part_template_models_model_uq`). 이미 **다른**
 * 템플릿에 붙어 있으면 거절하고 **어느 템플릿인지 말해 준다** — 조용히 옮기면 그 템플릿을 쓰던
 * 사람이 까닭을 모른 채 다른 부품을 받게 된다. 같은 템플릿에 다시 거는 것은 그냥 성공이다
 * (사람이 두 번 누른 것이고, 결과는 바라던 그대로다).
 *
 * @param productModelName 🔴 **이을 때의 이름 사본.** 부르는 쪽(서버 액션)이 A/S 명부를 다시 받아
 *   와 거기서 뽑은 값이어야 한다 — 화면이 보낸 글자를 그대로 적으면 이름이 우리 표에 거짓으로
 *   남는다. 정본은 언제나 A/S 이고, 이 값은 A/S 가 꺼져 있어도 「어느 모델인지」가 남게 하는
 *   기록이다(`src/db/schema/oh-templates.ts` 머리말).
 */
export async function linkProductModel(
  templateId: string,
  productModelId: string,
  productModelName: string,
  actor: OhActor,
): Promise<OhLinkResult> {
  try {
    return await db().transaction(async (tx): Promise<OhLinkResult> => {
      const [template] = await tx
        .select({ id: ohPartTemplates.id, name: ohPartTemplates.name })
        .from(ohPartTemplates)
        .where(and(eq(ohPartTemplates.id, templateId), eq(ohPartTemplates.isDeleted, false)))
        .limit(1);
      if (!template) reject("NOT_FOUND", NOT_FOUND_MESSAGE);

      const [clash] = await tx
        .select({ templateId: ohPartTemplateModels.templateId, name: ohPartTemplates.name })
        .from(ohPartTemplateModels)
        .innerJoin(ohPartTemplates, eq(ohPartTemplates.id, ohPartTemplateModels.templateId))
        .where(eq(ohPartTemplateModels.productModelId, productModelId))
        .limit(1);
      if (clash) {
        if (clash.templateId === templateId) return { ok: true };
        reject(
          "VALIDATION_ERROR",
          `${productModelName} 은(는) 이미 「${clash.name}」 템플릿에 연결되어 있습니다. 그쪽 연결을 먼저 푸십시오.`,
        );
      }

      await tx.insert(ohPartTemplateModels).values({
        templateId,
        productModelId,
        productModelName,
        createdBy: actor.id,
      });
      await tx.insert(auditLogs).values(
        auditValues({
          action: "OH_TEMPLATE_MODEL_LINKED",
          actorId: actor.id,
          actorName: actor.name,
          target: `oh_templates:${template.name}`,
          detail: { productModelId, productModelName },
        }),
      );
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof OhRejected) return { ok: false, message: err.result.message };
    throw err;
  }
}

export async function unlinkProductModel(linkId: string, actor: OhActor): Promise<OhLinkResult> {
  try {
    return await db().transaction(async (tx): Promise<OhLinkResult> => {
      const [link] = await tx
        .select({
          id: ohPartTemplateModels.id,
          productModelId: ohPartTemplateModels.productModelId,
          productModelName: ohPartTemplateModels.productModelName,
          name: ohPartTemplates.name,
        })
        .from(ohPartTemplateModels)
        .innerJoin(ohPartTemplates, eq(ohPartTemplates.id, ohPartTemplateModels.templateId))
        .where(eq(ohPartTemplateModels.id, linkId))
        .limit(1);
      if (!link) reject("NOT_FOUND", "해당 연결을 찾을 수 없습니다.");

      await tx.delete(ohPartTemplateModels).where(eq(ohPartTemplateModels.id, linkId));
      await tx.insert(auditLogs).values(
        auditValues({
          action: "OH_TEMPLATE_MODEL_UNLINKED",
          actorId: actor.id,
          actorName: actor.name,
          target: `oh_templates:${link.name}`,
          detail: { productModelId: link.productModelId, productModelName: link.productModelName },
        }),
      );
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof OhRejected) return { ok: false, message: err.result.message };
    throw err;
  }
}
