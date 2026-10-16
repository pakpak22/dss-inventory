import "server-only";
import { and, count, desc, eq, gte, inArray, min, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { parts } from "@/db/schema/parts";
import { stockBalances } from "@/db/schema/stock-balances";
import { stockTransactions } from "@/db/schema/stock";
import { stockRequestIssues, stockRequests, type RequestSource, type RequestStatus } from "@/db/schema/stock-requests";
import { auditValues } from "@/lib/audit";
import type { Owner } from "@/lib/parts/codes";
import {
  ACTIONABLE_REQUEST_STATUSES,
  CANCELLABLE_REQUEST_SOURCES,
  CLAIMABLE_REQUEST_STATUSES,
  ENTRY_TYPE_LABEL,
  EXTERNALLY_CANCELLABLE_REQUEST_SOURCES,
  isClosedRequest,
  type EntryType,
} from "./codes";
import type { EntryInput } from "./form";
import { buildIssueInput, type IssueQuantity } from "./issue";
import { LedgerAbort, ledgerErrorMessage, recordEntryIn, type Actor, type EntryAuthor, type RecordResult } from "./ledger";

/**
 * 반출 확인 대기 (2026-10-06 사용자 결정). 신청 → 담당자 확인 → 원장.
 *
 * - 신청은 수량을 건드리지 않는다. 확인 순간 원장이 잠그고 다시 검사한다(모자라면 거절, 신청은 집기 전 상태로 돌아감).
 * - 두 담당자가 동시에 [확인] 을 눌러도 한 번만 쓰이게: PENDING·PARTIAL → CONFIRMING 으로 **먼저 집고**,
 *   원장을 쓴 뒤 CONFIRMED(또는 PARTIAL)로. 실패하면 집기 전 상태로 되돌린다.
 * - 원장의 created_by 는 **신청한 사람**(부품을 가져간 사람), confirmed_by 는 담당자.
 *
 * 🔵 **일부 수량만 내주기 (2026-10-14, 조각 4b. 설계 5절 「분할 불출 — 여러 번」)**
 *   - 사용자: 「여러 차례 나눠서 주기도 하고 **기다리기도** 한다」 → 다 못 주면 요청이 `PARTIAL` 로 **열린 채** 남는다.
 *   - 🔴 원장에 넘기는 `EntryInput` 은 **`issue.ts` 의 `buildIssueInput` 이 만든 것 하나뿐**이다.
 *     그래서 원장(`ledger.ts`)은 부분인지 전부인지 모르고, 그 파일은 한 글자도 바뀌지 않았다.
 *   - 🔴 회차마다 원장 건의 **「신청 연결」(`RecordOptions.requestId`)을 비운다** — `stock_entries_request_uq` 를
 *     피하는 자리다. 끊어진 자리는 회차 표(`stock_request_issues`)가 대신 잇는다 (그 표의 주석 1번).
 *   - 🔵 상태를 **세는** 쪽(대기 목록·배지·알림 종)은 조각 4c 에서 맞췄다 — `PARTIAL` 은 **대기**로 센다.
 *     가르는 글자는 `./codes` 의 `PENDING_REQUEST_STATUSES`·`DECIDED_REQUEST_STATUSES` 한 벌뿐이다.
 *   - 🔵 **마감 (2026-10-14, 조각 4d)**: 일부 나간 신청의 **남은 것만** 접는 `closeRequest`. 🔴 반려가 아니다 —
 *     아래 그 함수의 주석.
 *
 * 🔵 **보류 — 멈춰 둠 (2026-10-15, 조각 10a)**
 *   - 담당자가 **사유를 적어** 신청을 멈춰 두고, 나중에 풀면 멈추기 전 자리로 돌아간다(`holdRequest`·`releaseRequestHold`).
 *   - 🔴 **보류 중에는 확인도 반려도 마감도 안 된다.** 그 판정을 따로 넣지 않았다 — 셋 다 상태를 WHERE 에 걸고
 *     `ON_HOLD` 를 받는 곳이 하나도 없으므로 **저절로** 막힌다. 막는 자리를 두 벌 적지 않으려는 것이다.
 *     대신 그때 나가는 **문구**만 고쳤다(아래 `failureMessage`) — 「이미 처리된 신청」은 보류에는 거짓말이다.
 *   - 🔴 신청한 사람의 취소(`cancelRequest`)도 같은 까닭으로 막힌다(PENDING 만 받는다). 보류된 신청을 접으려면
 *     담당자가 먼저 풀어야 한다.
 */
export interface RequestLineView {
  partId: string;
  partNo: number | null;
  partName: string;
  /** 신청한 수량 */
  quantity: number;
  /**
   * 이 신청에서 그 부품이 **이미 나간 수량** (2026-10-14, 조각 4d). 회차 표에 달린 원장 줄을 세어서 온다.
   * 🔵 화면이 「요청 8 중 5 나감 · 3 남음」을 그리고, [확인] 상자의 「이번에 줄 수량」 기본값(= 남은 수량)이 여기서 나온다.
   */
  issued: number;
  /**
   * 그 부품의 **지금 재고**(`stock_balances.quantity`) (2026-10-15, 조각 10b).
   *
   * 🔵 담당자가 「지금 다 내줄 수 있나」를 보는 근거다 — 가용이 남은 수량보다 적으면 화면이 빨갛게 적어,
   *    [확인] 상자를 열거나 상자를 뜯으러 가기 **전에** 헛걸음을 막는다.
   * 🔴 **신청 당시 값이 아니라 지금 값**이다. 신청은 수량을 잡아 두지 않으므로(requests.ts 머리말) 화면을 그리는
   *    순간의 재고가 맞는 말이고, 모자라면 확인 순간 원장이 다시 거절한다.
   * 🔵 수량 줄이 아직 없는 부품은 0 으로 본다(`leftJoin`).
   */
  available: number;
  /**
   * 부품의 소유. 글자는 화면이 `src/lib/parts/codes.ts` 의 `OWNER_LABEL` 로 푼다 (저장은 영문 코드).
   *
   * 🔴 부품을 못 찾으면 `null` 이다 — 「DSS」 같은 기본값을 넣으면 화면이 **거짓말**을 한다. 그 줄은 품명도
   *    「(지워진 부품)」으로 나간다.
   */
  owner: Owner | null;
  /**
   * 그 부품의 **자세한 내용** 넷 (2026-10-16, 쓰는 분 요청: 「신청 항목의 자세한 내용이 보이면」).
   *
   * 🔵 담당자가 상자를 뜯으러 가기 전에 **어느 부품인지** 가리는 값들이다 — 같은 품명이 여럿인 묶음이
   *    실제로 16개 있다(REQUIREMENTS 4-1절). 고객사 품명은 고객사에 나가는 서류에 쓰는 이름이다.
   * 🔴 **부품을 못 찾으면 전부 빈 글자다.** 지어내지 않는다(위 두 칸과 같은 규칙) — 화면은 빈 칸을
   *    아예 안 그린다(`lib/stock/request-item-detail.ts`).
   * 🔵 **바깥 통로로는 나가지 않는다** — `toApiRequestStatus` 가 칸을 하나씩 손으로 옮겨 적으므로
   *    (`lib/api/stock-request-status.ts`) 여기 칸이 늘어도 A/S 가 받는 모양은 그대로다.
   */
  customerName: string;
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
}

export interface PendingRequestRow {
  id: string;
  type: EntryType;
  status: RequestStatus;
  summary: string;
  occurredOn: string;
  intakeNumber: string;
  noRepairCase: boolean;
  counterparty: string;
  reason: string;
  note: string;
  lines: RequestLineView[];
  /**
   * 마감된 신청인가 — 「준 것은 두고 남은 것만 접은」 것 (2026-10-14, 조각 4d).
   * 🔵 상태값이 아니라 **세어서** 안다. 가르는 규칙이 적힌 곳은 `./codes` 의 `isClosedRequest` 하나뿐이다.
   */
  closed: boolean;
  /**
   * 지금 멈춰 둔 것이면 그 사유·누가·언제 (2026-10-15, 조각 10a). 아니면 `null`.
   *
   * 🔴 **상태가 `ON_HOLD` 일 때만 채운다.** 푼 신청은 칸을 비우지만(`releaseRequestHold`), 비우기 전에
   *    서버가 죽는 따위로 값이 남아 있어도 화면에 「보류 중」이 뜨면 안 된다 — 참말인 것은 **상태**다.
   * 🔵 「누가 언제 왜 걸고 풀었나」의 이력은 칸이 아니라 감사 로그에 있다(`STOCK_REQUEST_HELD`·`…_HOLD_RELEASED`).
   */
  hold: { reason: string; heldByName: string; heldAt: string } | null;
  /**
   * 어디서 올라왔나 (2026-10-15). 화면이 「A/S」 표식을 붙이고 [신청 취소]를 그릴지 가린다
   * (`./codes` 의 `REQUEST_SOURCE_LABEL`·`canCancelRequest`).
   */
  source: RequestSource;
  /**
   * 신청한 사람의 재고 관리 `users.id`. 🔴 **`null` 일 수 있다** — A/S 에서 올라왔고 포털 번호로 재고 관리의
   * 사람을 못 찾은 신청이다. 그때도 이름(`requestedByName`)은 있다.
   */
  requestedBy: string | null;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string;
}

type LinesLike = { type: EntryType; lines: Array<{ partId: string; quantity: number }> };

function linesOf(input: EntryInput): Array<{ partId: string; quantity: number }> {
  if (input.type === "RETURN") return [];
  if (input.type === "ADJUST") return [{ partId: input.partId, quantity: input.actualQuantity }];
  if (input.type === "TRANSFER") return [{ partId: input.fromPartId, quantity: input.quantity }];
  return (input as LinesLike).lines.map((l) => ({ partId: l.partId, quantity: l.quantity }));
}

/** 목록에 보일 한 줄 요약. 부품 이름은 신청 때 붙여 둔다(나중에 부품이 바뀌어도 신청 글자는 그대로). */
export function buildRequestSummary(input: EntryInput, names: ReadonlyMap<string, { no: number; name: string }>): string {
  const lines = linesOf(input);
  const partsText = lines
    .slice(0, 3)
    .map((l) => {
      const p = names.get(l.partId);
      return `${p ? `No. ${p.no} ${p.name}` : "(부품)"} ×${l.quantity}`;
    })
    .join(", ");
  const more = lines.length > 3 ? ` 외 ${lines.length - 3}줄` : "";
  const head =
    input.type === "USE" ? (input.noRepairCase ? `수리 건 없음(${input.reason})` : input.intakeNumber) : input.type === "LOAN" ? input.counterparty : input.type === "DISPOSE" ? input.reason : "";
  return [ENTRY_TYPE_LABEL[input.type], input.occurredOn, head, partsText + more].filter(Boolean).join(" · ");
}

/** 부품 No.·품명 (요약 글자와 오류 문구에 쓴다). 이름은 그때그때 읽는다 — 신청 글자에는 이미 복사해 둔 것이 있다. */
async function partNamesOf(partIds: readonly string[]): Promise<Map<string, { no: number; name: string }>> {
  const ids = [...new Set(partIds)];
  if (ids.length === 0) return new Map();
  const rows = await db().select({ id: parts.id, no: parts.no, name: parts.name }).from(parts).where(inArray(parts.id, ids));
  return new Map(rows.map((r) => [r.id, { no: r.no, name: r.name }]));
}

/**
 * 화면에 보일 부품 한 줄 — No.·품명에 **소유와 지금 재고**까지 (2026-10-15, 조각 10b),
 * 그리고 **그 부품의 자세한 내용** 넷 (2026-10-16, 쓰는 분 요청).
 *
 * 🔵 넷은 `RequestLineView` 를 거쳐 화면까지 그대로 간다 — 무엇을 어떻게 보일지는
 *    `lib/stock/request-item-detail.ts`(순수)가 정한다.
 */
export type PartLineView = { no: number; name: string; owner: Owner; available: number; customerName: string; name2: string; kyosanPartNo: string; drawingNo: string };

/**
 * 목록이 그릴 부품 정보를 **부품 묶음으로 한 번에** (2026-10-15, 조각 10b).
 *
 * 🔴 신청마다 묻지 않는다 — 대기 30건이면 질의가 30번이 된다. 위 `issuedQuantitiesOf` 와 **같은 까닭·같은 방식**이다.
 * 🔵 **위 `partNamesOf` 와 일부러 갈라 두었다.** 저쪽은 원장을 쓰는 길(신청 만들기·확인)에서 **오류 문구**에만 쓰여
 *    수량도 소유도 필요 없다. 이 `leftJoin` 을 거기 얹으면 부품이 나갈 때마다 쓸데없이 한 표를 더 읽는다.
 * 🔵 `leftJoin` 인 까닭: 수량 줄(`stock_balances`)이 아직 없는 부품이 있을 수 있다 — 그때는 0 이 맞는 말이다.
 */
async function partViewsOf(partIds: readonly string[]): Promise<Map<string, PartLineView>> {
  const ids = [...new Set(partIds)];
  if (ids.length === 0) return new Map();
  const rows = await db()
    // 🔴 `select()` 전체 조회가 아니라 **쓸 칸만** 적는다 — 부품 표에 칸이 늘어도 화면으로 새어 나가지 않는다.
    .select({
      id: parts.id,
      no: parts.no,
      name: parts.name,
      owner: parts.owner,
      available: stockBalances.quantity,
      customerName: parts.customerName,
      name2: parts.name2,
      kyosanPartNo: parts.kyosanPartNo,
      drawingNo: parts.drawingNo,
    })
    .from(parts)
    .leftJoin(stockBalances, eq(stockBalances.partId, parts.id))
    .where(inArray(parts.id, ids));
  return new Map(
    rows.map((r) => [
      r.id,
      { no: r.no, name: r.name, owner: r.owner, available: r.available ?? 0, customerName: r.customerName, name2: r.name2, kyosanPartNo: r.kyosanPartNo, drawingNo: r.drawingNo },
    ]),
  );
}

/**
 * 신청을 낸 사람 (2026-10-15, A/S 통로).
 *
 * 🔴 **`id` 가 `null` 일 수 있다** — A/S 에서 올라온 신청자는 재고 관리의 `users` 에 **없을 수 있다.**
 *    없다고 신청을 막으면 현장에서 요청을 못 낸다(사용자 결정). 그때 남는 것은 **이름과 포털 번호**뿐이고,
 *    나중에 그 사람이 재고 관리에 로그인하면 포털 번호로 이어 볼 수 있다.
 * 🔵 화면이 쓰는 `Actor`(`id: string`)는 이 모양에 그대로 들어맞는다 — 부르는 자리를 하나도 고치지 않았다.
 */
export interface Requester {
  id: string | null;
  name: string;
}

/** 재고 관리 화면에서 직접 올린 신청. 🔵 기본값이라 부르는 쪽이 아무것도 안 넘기면 이것이다. */
const INVENTORY_ORIGIN: RequestOrigin = { source: "INVENTORY" };

export interface RequestOrigin {
  /** 어디서 올라왔나. 🔵 감사 로그에도 그대로 남는다. */
  source: RequestSource;
  /**
   * 바깥 요청 번호(A/S 쪽 요청 id). 🔴 **같은 값이 두 번 오면 새로 만들지 않고 처음 것을 돌려준다.**
   * 직접 올린 신청은 `null` 이다.
   */
  externalKey?: string | null;
  /** 신청자의 포털 번호. `users` 에서 못 찾아도 적어 둔다 — 사람을 되짚을 유일한 열쇠다. */
  requesterSub?: string | null;
  /** 감사 로그에 더 실을 것(바깥이 보낸 이름 등). 🔵 본 작업과 한 트랜잭션에 들어간다. */
  audit?: Record<string, unknown>;
}

export interface CreatedRequest {
  id: string;
  status: RequestStatus;
  /** 🔴 **이번에 새로 만들었나.** 거짓이면 같은 열쇠로 이미 들어와 있던 신청을 그대로 돌려준 것이다. */
  created: boolean;
}

/** 같은 바깥 요청 번호로 이미 들어온 신청. 멱등의 양쪽(미리 보기·부딪힌 뒤)이 **같은 질의**를 쓴다. */
async function findByExternalKey(externalKey: string): Promise<{ id: string; status: RequestStatus } | null> {
  const [row] = await db().select({ id: stockRequests.id, status: stockRequests.status }).from(stockRequests).where(eq(stockRequests.externalKey, externalKey));
  return row ?? null;
}

/** 바깥 요청 번호의 UNIQUE(`stock_requests_external_key_uq`)에 부딪혔나 — 두 호출이 **같은 순간** 들어왔을 때. */
function isExternalKeyConflict(e: unknown): boolean {
  const o = e as { code?: unknown; constraint_name?: unknown } | null;
  return !!o && typeof o === "object" && o.code === "23505" && o.constraint_name === "stock_requests_external_key_uq";
}

/**
 * 신청 만들기 — **신청이 생기는 길은 여기 하나다**(화면도, A/S 통로도).
 *
 * 🔵 **멱등 (2026-10-15, A/S 통로)**: `origin.externalKey` 가 있으면 먼저 그 번호로 찾아보고, 있으면
 *    **새로 만들지 않고 그것을 돌려준다**(`created: false`). 끊겨서 다시 보내도 두 번 서지 않는다.
 *  - 🔴 **오류가 아니라 「처음 것」을 돌려준다.** 오류로 답하면 A/S 가 「만들어진 건가 아닌가」를 알 수 없어
 *    사람이 손으로 확인해야 한다. 그 편이 재고보다 더 자주 틀린다.
 *  - 🔴 미리 찾아보는 것만으로는 부족하다 — 두 호출이 같은 순간 들어오면 둘 다 「없음」을 보고 둘 다 넣으려 한다.
 *    **진짜 울타리는 DB 의 UNIQUE** 이고, 거기 부딪히면 다시 찾아 돌려준다. 미리 찾는 것은 흔한 쪽(이미 있음)을
 *    값싸게 끝내는 지름길일 뿐이다.
 *  - 🔵 비어 있는(`null`) 바깥 번호는 UNIQUE 에 안 걸린다 — PostgreSQL 의 UNIQUE 는 NULL 을 서로 다른 값으로
 *    본다(기본 `NULLS DISTINCT`). 그래서 재고 관리에서 직접 올린 신청이 몇천 건 쌓여도 서로 부딪히지 않는다.
 */
export async function createRequest(input: EntryInput, actor: Requester, origin: RequestOrigin = INVENTORY_ORIGIN): Promise<CreatedRequest> {
  const externalKey = origin.externalKey ?? null;
  if (externalKey !== null) {
    const found = await findByExternalKey(externalKey);
    if (found) return { ...found, created: false };
  }
  const names = await partNamesOf(linesOf(input).map((l) => l.partId));
  const summary = buildRequestSummary(input, names);
  try {
    return await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(stockRequests)
        .values({
          type: input.type,
          payload: input as unknown as Record<string, unknown>,
          summary,
          requestedBy: actor.id,
          requestedByName: actor.name,
          source: origin.source,
          externalKey,
          requesterSub: origin.requesterSub ?? null,
        })
        .returning({ id: stockRequests.id, status: stockRequests.status });
      await tx.insert(auditLogs).values(
        auditValues({
          action: "STOCK_REQUEST",
          actorId: actor.id,
          actorName: actor.name,
          target: `requests:${row.id}`,
          // 🔴 **출처가 이력에 남는다.** 신청 표의 칸은 지금 값이고, 「어디서 들어왔나」를 영영 들고 있는 것은 여기다.
          detail: { type: input.type, summary, source: origin.source, externalKey, ...(origin.audit ?? {}) },
        }),
      );
      return { id: row.id, status: row.status, created: true };
    });
  } catch (e) {
    if (externalKey !== null && isExternalKeyConflict(e)) {
      const found = await findByExternalKey(externalKey);
      if (found) return { ...found, created: false };
    }
    throw e;
  }
}

export type ConfirmResult =
  | {
      ok: true;
      result: Extract<RecordResult, { ok: true }>;
      /** 이번 회차 번호(1부터) */
      issueNo: number;
      /** 이번에 나간 수량의 합 */
      issuing: number;
      /** 아직 못 준 수량의 합. 0 이면 요청이 끝났다 */
      remaining: number;
      /** 다 나갔나 (= 상태가 CONFIRMED 가 됐나) */
      done: boolean;
    }
  | { ok: false; message: string };

export interface ConfirmOptions {
  /**
   * 줄별 「이번에 줄 수량」. 🔵 비우면 **남은 수량 전부** — 화면(조각 4d)이 생기기 전까지의 기존 동작 그대로다.
   * 목록에 없는 부품은 0 으로 본다(이번엔 안 준다).
   */
  quantities?: readonly IssueQuantity[];
  /** 「2개는 다음 주에」처럼 담당자가 그 회차에 남기는 말 */
  note?: string;
}

/**
 * 집기 — 한 사람만 들어가게 CONFIRMING 으로 먼저 바꾼다.
 *
 * 🔴 한 번에 `inArray` 로 집지 않고 상태마다 한 번씩 시도하는 까닭: `.returning()` 은 **바뀐 뒤**(CONFIRMING) 값을 주므로
 *    실패했을 때 어디로 되돌려야 하는지(PENDING 인지 PARTIAL 인지)를 알 수 없다. 되돌릴 자리를 알아야 한다.
 *    첫 번째 시도가 거의 언제나 맞는다(PENDING).
 */
async function claimRequest(id: string): Promise<{ row: typeof stockRequests.$inferSelect; previousStatus: RequestStatus } | null> {
  // 🔵 집을 수 있는 상태의 한 벌은 `./codes` 에 있다 — 화면의 [확인] 단추도 **같은 것**을 본다(조각 4d).
  for (const previousStatus of CLAIMABLE_REQUEST_STATUSES) {
    const [row] = await db()
      .update(stockRequests)
      .set({ status: "CONFIRMING" })
      .where(and(eq(stockRequests.id, id), eq(stockRequests.status, previousStatus)))
      .returning();
    if (row) return { row, previousStatus };
  }
  return null;
}

/**
 * 이 요청에서 **이미 나간 수량**(부품별).
 *
 * 🔵 요약 칸을 두지 않고 회차 표에 달린 원장 줄을 **세어서** 안다 (회차 표 주석 3번: 같은 사실을 두 곳에 적지 않는다).
 * 🔴 반출은 delta 가 음수라 부호를 뒤집는다.
 * 🔴 기록 취소(CORRECTION)로 무른 건은 회차 표에 없으므로 여기 안 센다 — 무른 수량도 「이미 나간 것」으로 남는다.
 *    모자라게 주는 쪽(보수적)이라 재고가 어긋나지는 않는다. 화면에 어떻게 보일지는 조각 4c·4d 에서 정한다.
 */
async function issuedQuantities(requestId: string): Promise<Map<string, number>> {
  return (await issuedQuantitiesOf([requestId])).get(requestId) ?? new Map();
}

/**
 * 여러 신청의 「이미 나간 수량」을 **한 번에** (2026-10-14, 조각 4d — 목록이 줄마다 「요청 8 중 5 나감」을 그린다).
 *
 * 🔴 신청마다 한 번씩 물으면 대기 10건이 질의 10번이 된다. 화면은 목록을 통째로 그리므로 신청 묶음으로 한 번만 묻는다
 *    (회차 표 주석 3번의 「느려지면 그때 요약 칸」 — 그 전에 할 수 있는 것이 이것이다).
 */
async function issuedQuantitiesOf(requestIds: readonly string[]): Promise<Map<string, Map<string, number>>> {
  const ids = [...new Set(requestIds)];
  const out = new Map<string, Map<string, number>>();
  if (ids.length === 0) return out;
  const rows = await db()
    .select({ requestId: stockRequestIssues.requestId, partId: stockTransactions.partId, out: sql<number>`coalesce(sum(-${stockTransactions.delta}), 0)`.mapWith(Number) })
    .from(stockRequestIssues)
    .innerJoin(stockTransactions, eq(stockTransactions.entryId, stockRequestIssues.entryId))
    .where(inArray(stockRequestIssues.requestId, ids))
    .groupBy(stockRequestIssues.requestId, stockTransactions.partId);
  for (const r of rows) {
    const m = out.get(r.requestId) ?? new Map<string, number>();
    m.set(r.partId, r.out);
    out.set(r.requestId, m);
  }
  return out;
}

/**
 * 회차 표의 UNIQUE 에 걸렸나 (`stock_request_issues_no_uq`·`stock_request_issues_entry_uq`).
 *
 * 집기(CONFIRMING)가 이미 막아 주므로 평소에는 안 걸린다. **마지막 안전장치**라서, 걸렸을 때 사람에게
 * 오류 화면 대신 말이 되는 문구가 보이게 한다 (원장의 `stock_entries_request_uq` 가 하던 몫을 이어받은 자리다).
 */
function isIssueConflict(e: unknown): boolean {
  const o = e as { code?: unknown; constraint_name?: unknown } | null;
  if (!o || typeof o !== "object" || o.code !== "23505") return false;
  return o.constraint_name === "stock_request_issues_no_uq" || o.constraint_name === "stock_request_issues_entry_uq";
}

/** 보류 중이라 막혔을 때의 문구. 적힌 곳이 하나여야 세 단추([확인]·[반려]·[마감])가 같은 말을 한다. */
const ON_HOLD_MESSAGE = "보류 중인 신청입니다. 먼저 보류를 풀어야 합니다.";

/**
 * **막힌 뒤에만** 부르는 문구 고르개 (2026-10-15, 조각 10a).
 *
 * 확인·반려·마감은 상태를 WHERE 에 걸어 `ON_HOLD` 를 받지 않는다 — 그래서 보류 중인 신청에 눌러도 막히는데,
 * 그때 나가던 말이 「이미 처리된 신청이거나 없는 신청입니다」였다. **보류에는 거짓말이다**(처리되지도, 없지도 않다).
 *
 * 🔴 **성공하는 길에는 질의가 하나도 늘지 않는다.** 0행이 바뀐 **뒤에만** 상태를 한 번 읽는다. 막히는 일은 드물고,
 *    드문 쪽에 질의 하나를 얹는 편이 모든 확인마다 한 번씩 더 묻는 것보다 싸다.
 * 🔵 읽은 값이 그 사이 또 바뀌었을 수 있지만 상관없다 — 이것은 **문구**를 고르는 자리일 뿐, 막는 판정은 이미 DB 가 했다.
 */
async function failureMessage(id: string, fallback: string): Promise<string> {
  const [r] = await db().select({ status: stockRequests.status }).from(stockRequests).where(eq(stockRequests.id, id));
  return r?.status === "ON_HOLD" ? ON_HOLD_MESSAGE : fallback;
}

export async function confirmRequest(id: string, admin: Actor, opts: ConfirmOptions = {}): Promise<ConfirmResult> {
  // 1. 집기 — 한 사람만. 일부만 나간 것(PARTIAL)은 다시 집어 다음 회차를 낸다. 보류 중이면 집히지 않는다(ON_HOLD 는 집는 묶음에 없다).
  const claimed = await claimRequest(id);
  if (!claimed) return { ok: false, message: await failureMessage(id, "이미 처리된 신청이거나 없는 신청입니다.") };
  const { row: request, previousStatus } = claimed;
  const restore = () => db().update(stockRequests).set({ status: previousStatus }).where(eq(stockRequests.id, id));

  const payload = request.payload as unknown as EntryInput;
  // 🔴 **신청한 사람의 id 가 없을 수 있다** — A/S 에서 올라왔고 재고 관리에 계정이 없는 사람이다.
  //    그때 원장 건의 `created_by` 는 비고 `created_by_name` 에 이름만 남는다(`EntryAuthor` 주석).
  //    🔵 확인하는 담당자(`admin`)는 여전히 `Actor` 라 반드시 이 시스템의 사람이다.
  const requester: EntryAuthor = { id: request.requestedBy, name: request.requestedByName };

  // 2. 「요청 수량」이 아니라 「이번에 줄 수량」으로 원장 입력을 만든다. 🔴 원장으로 가는 길은 이 함수 하나뿐이다.
  //    집기로 이 요청을 혼자 들고 있으므로 이미 나간 수량을 트랜잭션 밖에서 읽어도 그 사이에 바뀌지 않는다.
  let plan;
  try {
    const [issued, names] = await Promise.all([issuedQuantities(id), partNamesOf(linesOf(payload).map((l) => l.partId))]);
    const want = opts.quantities ? new Map(opts.quantities.map((q) => [q.partId, q.quantity])) : null;
    const built = buildIssueInput(payload, want, issued, names);
    if (!built.ok) {
      await restore();
      return { ok: false, message: built.message };
    }
    plan = built.plan;
  } catch (e) {
    await restore();
    throw e;
  }
  const input = plan.input;
  if (!input) {
    // 줄이 하나도 안 남았다 → 아무것도 하지 않는다. 빈 원장 건을 만들지 않는다.
    await restore();
    return { ok: false, message: "이번에 내줄 수량이 없습니다. 줄마다 내줄 수량을 적으십시오." };
  }

  // 3. 🔴 원장 쓰기 · 회차 줄 · 상태 바꾸기를 **한 트랜잭션**으로. 중간에 멈추면 아무것도 안 들어간다.
  const done = plan.remaining === 0;
  const now = new Date();
  let written: { result: Extract<RecordResult, { ok: true }>; issueNo: number };
  try {
    written = await db().transaction(async (tx) => {
      // 🔴 「신청 연결」(requestId)을 **비워 넘긴다** — stock_entries_request_uq 가 한 신청에서 두 건이 나오는 것을 막기 때문이다.
      //    끊어진 자리는 바로 아래 회차 줄이 잇는다 (stock-requests.ts 의 회차 표 주석 1번).
      const result = await recordEntryIn(tx, input, requester, { confirmedBy: admin });
      // 회차 번호 = 그 요청의 직전 최대값 + 1 (빈 번호가 생기지 않게). 겹치면 UNIQUE 가 막는다.
      const [seq] = await tx
        .select({ next: sql<number>`coalesce(max(${stockRequestIssues.issueNo}), 0) + 1`.mapWith(Number) })
        .from(stockRequestIssues)
        .where(eq(stockRequestIssues.requestId, id));
      const issueNo = seq?.next ?? 1;
      await tx.insert(stockRequestIssues).values({ requestId: id, entryId: result.entryId, issueNo, issuedBy: admin.id, issuedByName: admin.name, note: opts.note ?? "" });
      await tx
        .update(stockRequests)
        // 🔴 다 나갔으면 끝난 것(CONFIRMED), 남았으면 열린 채(PARTIAL).
        //    decided* 와 entryId 는 **끝났을 때만** 적는다 — 「결정됨 = 더 볼 일 없음」이라는 기존 뜻을 바꾸지 않으려고.
        //    누가 언제 몇 회차를 내줬는지는 회차 표에 줄마다 남는다. 여러 회차면 entryId 는 마지막 회차의 건이다.
        .set(done ? { status: "CONFIRMED", decidedBy: admin.id, decidedByName: admin.name, decidedAt: now, entryId: result.entryId } : { status: "PARTIAL" })
        .where(eq(stockRequests.id, id));
      await tx.insert(auditLogs).values(
        auditValues({
          action: done ? "STOCK_REQUEST_CONFIRMED" : "STOCK_REQUEST_PARTIAL",
          actorId: admin.id,
          actorName: admin.name,
          target: `requests:${id}`,
          detail: {
            summary: request.summary,
            requestedBy: request.requestedByName,
            entry: `${result.type}-${result.sheetYear}-${result.sheetNo}`,
            issueNo,
            issued: plan.issuing,
            remaining: plan.remaining,
            note: opts.note ?? "",
          },
        }),
      );
      return { result, issueNo };
    });
  } catch (e) {
    await restore();
    // 원장이 거절한 것(수량 부족 등)은 결과로 바꿔 돌려준다 — 신청은 집기 전 상태로 남는다(기존 동작 그대로).
    if (e instanceof LedgerAbort) return { ok: false, message: ledgerErrorMessage(e.error) };
    if (isIssueConflict(e)) return { ok: false, message: "다른 담당자가 방금 이 신청을 처리했습니다. 화면을 새로 고치고 다시 보십시오." };
    throw e;
  }
  return { ok: true, result: written.result, issueNo: written.issueNo, issuing: plan.issuing, remaining: plan.remaining, done };
}

export async function rejectRequest(id: string, note: string, admin: Actor): Promise<{ ok: boolean; message?: string }> {
  const now = new Date();
  const [row] = await db()
    .update(stockRequests)
    .set({ status: "REJECTED", decidedBy: admin.id, decidedByName: admin.name, decidedAt: now, decisionNote: note })
    .where(and(eq(stockRequests.id, id), eq(stockRequests.status, "PENDING")))
    .returning({ summary: stockRequests.summary, requestedByName: stockRequests.requestedByName });
  if (!row) return { ok: false, message: await failureMessage(id, "이미 처리된 신청이거나 없는 신청입니다.") };
  await db()
    .insert(auditLogs)
    .values(auditValues({ action: "STOCK_REQUEST_REJECTED", actorId: admin.id, actorName: admin.name, target: `requests:${id}`, detail: { summary: row.summary, requestedBy: row.requestedByName, note } }));
  return { ok: true };
}

/**
 * 마감 — **남은 것은 그만 주기** (2026-10-14 사용자 결정, 조각 4d).
 *
 * 🔴 **반려와 다르다.** 반려는 「하나도 안 준다」라서 아직 아무것도 안 나간 신청(PENDING)만 받고,
 *    마감은 「준 것은 그대로 두고 **나머지만** 접는다」라서 **일부 나간 신청(PARTIAL)만** 받는다.
 *    이미 나간 회차와 그 원장 건은 **하나도 건드리지 않는다** — 수량은 1 개도 움직이지 않는다.
 * 🔴 상태는 `CONFIRMED`(더 볼 일 없음)로 닫는다. 「다 나감」과 「마감」을 가르는 자리는 `./codes` 의 `isClosedRequest`
 *    하나뿐이고, **이력에서는 감사 행위**(`STOCK_REQUEST_CLOSED` = 「반출 마감」)가 반려와 가른다 — 나중에
 *    「3개는 줬는데 왜 반려지?」가 되지 않게.
 * 🔵 모양은 `rejectRequest` 를 그대로 따른다: 상태를 조건으로 건 UPDATE 한 번(두 담당자가 동시에 눌러도 한 번만),
 *    그다음 감사 로그. 감사 로그가 실패해도 마감 자체는 되돌리지 않는다(반려와 같은 관례).
 */
export async function closeRequest(id: string, note: string, admin: Actor): Promise<{ ok: boolean; message?: string }> {
  const now = new Date();
  const [row] = await db()
    .update(stockRequests)
    .set({ status: "CONFIRMED", decidedBy: admin.id, decidedByName: admin.name, decidedAt: now, decisionNote: note })
    .where(and(eq(stockRequests.id, id), eq(stockRequests.status, "PARTIAL")))
    .returning({ summary: stockRequests.summary, requestedByName: stockRequests.requestedByName, payload: stockRequests.payload });
  if (!row) return { ok: false, message: await failureMessage(id, "마감할 수 없는 신청입니다. 일부라도 내준 신청만 마감할 수 있습니다. 화면을 새로 고치고 다시 보십시오.") };

  // 이력에 숫자를 남긴다 — 「요청 8 중 5 나감, 3 남음을 마감」이 나중에 읽혀야 한다. 회차 줄은 마감으로 바뀌지 않으므로 지금 세도 같다.
  const issued = await issuedQuantities(id);
  const lines = linesOf(row.payload as unknown as EntryInput);
  const requested = lines.reduce((a, l) => a + l.quantity, 0);
  const out = lines.reduce((a, l) => a + Math.min(l.quantity, issued.get(l.partId) ?? 0), 0);
  await db().insert(auditLogs).values(
    auditValues({
      action: "STOCK_REQUEST_CLOSED",
      actorId: admin.id,
      actorName: admin.name,
      target: `requests:${id}`,
      detail: { summary: row.summary, requestedBy: row.requestedByName, requested, issued: out, remaining: requested - out, note },
    }),
  );
  return { ok: true };
}

/**
 * 보류 — **멈춰 둠** (2026-10-15, 조각 10a. A/S 쪽 `holdPartRequest` 에서 규칙만 옮겨 왔다).
 *
 * 「지금은 처리하지 않는다」를 **사유와 함께** 남겨 두는 중간 자리다. 끝낸 것이 아니라 나중에 다시 볼 것이라,
 * 대기 목록에는 그대로 남는다(`./codes` 의 `PENDING_REQUEST_STATUSES`). 재촉하는 숫자에서만 빠진다.
 *
 * 🔴 **보류 중에는 확인도 반려도 마감도 취소도 안 된다.** 그 판정을 여기 따로 적지 않았다 — 네 함수 모두 상태를
 *    WHERE 에 걸고 `ON_HOLD` 를 받는 곳이 하나도 없어 **저절로** 막힌다. 막는 규칙을 두 벌 적으면 언젠가 갈린다.
 * 🔴 걸 수 있는 상태는 **집을 수 있는 상태와 같은 묶음**(`CLAIMABLE_REQUEST_STATUSES` = PENDING·PARTIAL)이다.
 *    우연이 아니라 같은 뜻이다 — 「담당자가 아직 손댈 차례인 신청」. 🔴 `CONFIRMING` 은 **뺀다**: 다른 담당자가
 *    **지금** 집어 원장을 쓰는 중이라, 그 밑에서 상태를 바꾸면 그 사람의 되돌리기(`restore`)가 보류를 덮어 쓴다.
 * 🔵 모양은 `rejectRequest`·`closeRequest` 그대로다 — 상태를 조건으로 건 UPDATE **한 번**(두 담당자가 동시에
 *    눌러도 한 번만 걸린다), 그다음 감사 로그.
 */
export async function holdRequest(id: string, reason: string, admin: Actor): Promise<{ ok: boolean; message?: string }> {
  const now = new Date();
  const [row] = await db()
    .update(stockRequests)
    // 🔴 `decided*` 는 건드리지 않는다. 보류는 **결정이 아니다** — 결정 칸을 적으면 「더 볼 일 없음」이라는 그 칸의 뜻이 깨진다.
    .set({ status: "ON_HOLD", holdReason: reason, heldBy: admin.id, heldByName: admin.name, heldAt: now })
    .where(and(eq(stockRequests.id, id), inArray(stockRequests.status, [...CLAIMABLE_REQUEST_STATUSES])))
    .returning({ summary: stockRequests.summary, requestedByName: stockRequests.requestedByName });
  if (!row) return { ok: false, message: "보류할 수 없는 신청입니다. 대기 중이거나 일부만 내준 신청만 보류할 수 있습니다. 화면을 새로 고치고 다시 보십시오." };

  await db()
    .insert(auditLogs)
    .values(auditValues({ action: "STOCK_REQUEST_HELD", actorId: admin.id, actorName: admin.name, target: `requests:${id}`, detail: { summary: row.summary, requestedBy: row.requestedByName, reason } }));
  return { ok: true };
}

/**
 * 보류 풀기 — 멈추기 **전 자리**로 돌려놓는다 (2026-10-15, 조각 10a).
 *
 * 🔴 **돌아갈 상태를 저장해 두지 않고 센다.** 이미 나간 수량이 있으면 `PARTIAL`, 하나도 없으면 `PENDING`.
 *    보류 직전 상태를 칸에 적어 두면 그 사이 사정이 달라졌을 때 옛 상태로 되돌아가 **실제와 어긋난다** —
 *    나간 수량에서 다시 구하는 편이 언제나 맞다(A/S 쪽 `statusAfterHoldRelease` 의 까닭 그대로).
 *    🔵 보류 중에는 불출이 막혀 있으므로 지금 세는 값이 트랜잭션 밖에서 읽어도 그 사이 바뀌지 않는다.
 * 🔴 **네 칸을 비운다** — 사유는 `''`, 나머지는 null. 칸에는 **지금 보류 중인 사유만** 남는다. 지워도 괜찮은 까닭은
 *    「누가 언제 왜 걸고 풀었나」가 감사 로그에 있기 때문이다(`STOCK_REQUEST_HELD` 의 `detail.reason`, append-only).
 *    칸을 이력으로 쓰지 않는다 — 한 신청을 여러 번 걸고 풀면 칸은 마지막 것만 들고 있을 수 있어 거짓이 된다.
 * 🔵 **사유를 받지 않는다.** 보류는 왜 멈추는지가 남아야 하지만, 푸는 것은 「다시 진행한다」는 뜻뿐이라 적을 것이 없다.
 */
export async function releaseRequestHold(id: string, admin: Actor): Promise<{ ok: boolean; message?: string }> {
  const issued = await issuedQuantities(id);
  let out = 0;
  for (const q of issued.values()) out += q;
  const next: RequestStatus = out > 0 ? "PARTIAL" : "PENDING";

  const [row] = await db()
    .update(stockRequests)
    .set({ status: next, holdReason: "", heldBy: null, heldByName: null, heldAt: null })
    .where(and(eq(stockRequests.id, id), eq(stockRequests.status, "ON_HOLD")))
    // 🔴 보류 사유를 여기서 되읽을 수 없다 — `RETURNING` 은 **바뀐 뒤** 값을 주므로 이미 비워진 빈 글자가 온다.
    //    걸 때의 사유는 `STOCK_REQUEST_HELD` 감사 줄에 있다(append-only 라 거기선 사라지지 않는다).
    .returning({ summary: stockRequests.summary, requestedByName: stockRequests.requestedByName });
  if (!row) return { ok: false, message: "보류 중인 신청이 아닙니다. 화면을 새로 고치고 다시 보십시오." };

  await db().insert(auditLogs).values(
    auditValues({
      action: "STOCK_REQUEST_HOLD_RELEASED",
      actorId: admin.id,
      actorName: admin.name,
      target: `requests:${id}`,
      // 돌아간 자리(`status`)와 그렇게 정한 근거(이미 나간 수량)를 적는다 — 나중에 「왜 PENDING 으로 갔지?」를 따질 수 있게.
      detail: { summary: row.summary, requestedBy: row.requestedByName, status: next, issued: out },
    }),
  );
  return { ok: true };
}

/**
 * 신청한 사람 본인이 아직 PENDING 인 것만 거둔다. 🔴 보류 중이면 막힌다 — 담당자가 먼저 풀어야 한다(위 `holdRequest`).
 *
 * 🔴 **A/S 에서 올라온 신청은 여기서 거둬지지 않는다** (2026-10-15). 저쪽에 「이 부품 내 달라」가 열린 채 남아
 *    있는데 이쪽에서 접으면 A/S 는 영영 답을 못 받는다 — 거두는 것은 **낸 쪽의 몫**이다. 출처 묶음은
 *    `./codes` 의 `CANCELLABLE_REQUEST_SOURCES` 하나뿐이고 화면의 단추도 **같은 것**을 본다.
 * 🔵 사람 조건(`requested_by = 나`)만으로는 모자란다: 포털 번호가 재고 관리의 사람과 **맞아떨어진** A/S 신청은
 *    그 사람의 id 가 적혀 있어 조건을 통과한다. 못 맞춘 신청은 `requested_by` 가 NULL 이라 저절로 막히지만,
 *    **맞은 쪽과 못 맞춘 쪽이 다르게 굴면 안 된다.** 그래서 출처를 따로 건다.
 */
export async function cancelRequest(id: string, actor: Actor): Promise<{ ok: boolean; message?: string }> {
  const now = new Date();
  const [row] = await db()
    .update(stockRequests)
    .set({ status: "CANCELLED", decidedBy: actor.id, decidedByName: actor.name, decidedAt: now })
    .where(and(eq(stockRequests.id, id), eq(stockRequests.status, "PENDING"), eq(stockRequests.requestedBy, actor.id), inArray(stockRequests.source, [...CANCELLABLE_REQUEST_SOURCES])))
    .returning({ summary: stockRequests.summary });
  if (!row) return { ok: false, message: "거둘 수 없는 신청입니다. 이미 처리됐거나, 본인 신청이 아니거나, A/S 에서 올라온 신청입니다(그것은 A/S 에서 거둡니다)." };
  await db().insert(auditLogs).values(auditValues({ action: "STOCK_REQUEST_CANCELLED", actorId: actor.id, actorName: actor.name, target: `requests:${id}`, detail: { summary: row.summary } }));
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 바깥(A/S)이 **제 신청을 거두는** 길 (2026-10-16)                      */
/* 🔴 위 `cancelRequest` 는 한 글자도 바뀌지 않았다 — 더하기만 한다.      */
/* ------------------------------------------------------------------ */

/**
 * 바깥 통로가 거둘 신청을 **판정에 필요한 칸만** 읽어 온다 (`POST /api/v1/stock-requests/cancel`).
 *
 * 🔵 `listRequestsByExternalKeys` 를 쓰지 않는 까닭: 그쪽이 주는 줄(`PendingRequestRow`)에는 **포털
 *    번호가 없다.** 화면이 쓸 일이 없어 일부러 안 넣은 칸인데, 거기에 더하면 관리 화면의 클라이언트
 *    묶음으로 **남의 포털 번호가 줄줄이 실려 나간다.** 그래서 이 길에만 필요한 칸을 따로 읽는다.
 * 🔵 돌려줄 응답 줄은 거둔 **뒤에** 그 함수로 다시 읽는다 — 그래야 A/S 가 받는 모양이 상태 통로와
 *    한 글자도 다르지 않다(빚는 길이 `attachNames` → `toRow` 하나다).
 */
export interface ExternalCancelTarget {
  id: string;
  source: RequestSource;
  status: RequestStatus;
  /** 신청에 적힌 **올린 사람의 포털 번호**. 화면에서 올린 신청은 비어 있다. */
  requesterSub: string | null;
  /** 🔴 `null` 일 수 있다 — A/S 에서 올라왔고 재고 관리에 계정이 없는 사람이다(표 주석). */
  requestedBy: string | null;
  requestedByName: string;
}

export async function findExternalRequestForCancel(externalKey: string): Promise<ExternalCancelTarget | null> {
  const [row] = await db()
    .select({
      id: stockRequests.id,
      source: stockRequests.source,
      status: stockRequests.status,
      requesterSub: stockRequests.requesterSub,
      requestedBy: stockRequests.requestedBy,
      requestedByName: stockRequests.requestedByName,
    })
    .from(stockRequests)
    .where(eq(stockRequests.externalKey, externalKey));
  return row ?? null;
}

/**
 * 바깥 통로로 **거두기** — 🔴 **울타리 셋을 WHERE 에 그대로 건다**(출처 · 본인 · 대기).
 *
 * 🔴 **`cancelRequest` 를 그대로 부를 수 없었다.** 그 함수의 울타리가 **정반대**이기 때문이다:
 *   ① 출처를 `CANCELLABLE_REQUEST_SOURCES`(= `INVENTORY`)로 막는다 — A/S 신청은 거기서 **언제나** 거절된다.
 *      그것이 버그가 아니라 그 함수의 뜻이다(「A/S 것은 A/S 가 거둔다」).
 *   ② 본인을 `requested_by = <내 users.id>` 로 본다. 🔴 A/S 신청자는 **재고 관리에 계정이 없을 수 있어**
 *      그 칸이 `NULL` 이고, 그러면 본인인데도 영영 못 거둔다. 바깥에서 사람을 가리키는 유일한 열쇠는
 *      **포털 번호**(`requester_sub`)다 (표 주석: 「못 찾은 사람을 되짚을 유일한 열쇠」).
 *   🔵 그래서 **동작을 고치지 않고 옆에 세웠다.** 고쳤다면 화면의 [신청 취소]가 A/S 신청까지 거두게 되어
 *      이 조각이 막으려는 바로 그 일이 일어난다.
 * 🔴 **같은 울타리를 같은 모양으로 지킨다** — 상태를 조건으로 건 UPDATE **한 번**(두 번 들어와도 한 번만
 *    바뀐다), 그다음 감사 로그. `cancelRequest`·`rejectRequest`·`closeRequest` 와 같은 관례다.
 * 🔵 **거둔 사람 = 올린 사람**이다. 본인임을 WHERE 가 이미 가렸으므로 `decided*` 에 신청자를 적는다
 *    (id 는 없을 수 있고, 그때도 이름은 남는다).
 * 🔴 **감사 로그에 출처가 보인다** — 행위는 기존 「반출 신청 취소」(`STOCK_REQUEST_CANCELLED`) 그대로이고,
 *    `detail.source` · `detail.externalKey` 로 **A/S 에서 거둔 것**임이 이력에 남는다(`/audit` 화면이
 *    그 두 칸을 읽어 한 줄로 적는다). 행위를 새로 만들지 않은 까닭: 일어난 일은 같은 일이고, 거르개에
 *    항목이 둘이 되면 「취소된 신청」을 찾을 때 한쪽을 놓친다.
 *
 * @returns 거뒀으면 `true`. 🔵 `false` 는 **그 사이에 상태가 바뀐 것**이다(같은 요청이 동시에 두 번
 *   왔거나 담당자가 방금 집었거나) — 부르는 쪽이 **다시 읽어 다시 판정한다**(통로 파일의 두 바퀴).
 */
export async function cancelExternalRequest(target: ExternalCancelTarget, requesterSub: string): Promise<boolean> {
  const now = new Date();
  const [row] = await db()
    .update(stockRequests)
    .set({ status: "CANCELLED", decidedBy: target.requestedBy, decidedByName: target.requestedByName, decidedAt: now })
    .where(
      and(
        eq(stockRequests.id, target.id),
        eq(stockRequests.status, "PENDING"),
        inArray(stockRequests.source, [...EXTERNALLY_CANCELLABLE_REQUEST_SOURCES]),
        // 🔴 **보낸 번호로** 건다 — 읽어 둔 값으로 걸면 「그 줄에 그 번호가 적혀 있나」를 확인할 뿐,
        //    「부른 사람이 그 사람인가」는 확인하지 못한다.
        eq(stockRequests.requesterSub, requesterSub),
      ),
    )
    .returning({ summary: stockRequests.summary, externalKey: stockRequests.externalKey });
  if (!row) return false;
  await db()
    .insert(auditLogs)
    .values(
      auditValues({
        action: "STOCK_REQUEST_CANCELLED",
        actorId: target.requestedBy,
        actorName: target.requestedByName,
        target: `requests:${target.id}`,
        detail: { summary: row.summary, source: target.source, externalKey: row.externalKey, requesterSub },
      }),
    );
  return true;
}

function toRow(r: typeof stockRequests.$inferSelect, names: ReadonlyMap<string, PartLineView>, issued: ReadonlyMap<string, number>): PendingRequestRow {
  const input = r.payload as unknown as EntryInput;
  const lines = linesOf(input).map((l) => {
    const p = names.get(l.partId);
    return {
      partId: l.partId,
      partNo: p?.no ?? null,
      partName: p?.name ?? "(지워진 부품)",
      quantity: l.quantity,
      issued: issued.get(l.partId) ?? 0,
      // 🔴 부품을 못 찾으면 가용 0 · 소유 null 이다 — 지어내지 않는다(`RequestLineView` 의 두 주석).
      available: p?.available ?? 0,
      owner: p?.owner ?? null,
      // 🔴 자세한 내용도 못 찾으면 **빈 글자**다 — 화면이 빈 칸을 아예 안 그리므로 그 줄은 품명만 남는다.
      customerName: p?.customerName ?? "",
      name2: p?.name2 ?? "",
      kyosanPartNo: p?.kyosanPartNo ?? "",
      drawingNo: p?.drawingNo ?? "",
    };
  });
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    summary: r.summary,
    occurredOn: input.occurredOn,
    intakeNumber: input.type === "USE" ? input.intakeNumber : "",
    noRepairCase: input.type === "USE" ? input.noRepairCase : false,
    counterparty: input.type === "LOAN" ? input.counterparty : "",
    reason: "reason" in input ? input.reason : "",
    note: input.note,
    lines,
    closed: isClosedRequest(r.status, lines),
    // 🔴 **상태로 가른다** — 칸에 값이 남아 있어도 `ON_HOLD` 가 아니면 `null` 이다 (`PendingRequestRow.hold` 주석).
    hold: r.status === "ON_HOLD" ? { reason: r.holdReason, heldByName: r.heldByName ?? "", heldAt: r.heldAt?.toISOString() ?? "" } : null,
    source: r.source,
    requestedBy: r.requestedBy,
    requestedByName: r.requestedByName,
    requestedAt: r.requestedAt.toISOString(),
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
  };
}

/**
 * **전부** — 상태를 가리지 않고, 최신 신청이 위 (2026-10-15, 조각 10b. 「부품 요청 관리」 화면).
 *
 * 🔴 **신청을 읽어 오는 목록은 이제 이 함수 하나다** (2026-10-15, 조각 10d). 그 전에는 둘이 더 있었다 —
 *    「확인 대기만」(`listPendingRequests`, 오래된 것이 위)과 「최근 처리된 것만」(`listRecentDecidedRequests`).
 *    기록 내역 맨 위의 「확인 대기」 구역이 쓰던 함수들인데 그 구역을 걷어내(사용자 결정) **부르는 곳이 하나도
 *    없어졌고**, 쓰는 곳 없는 채로 한 조각이 더 지나가 지웠다. 🔵 가르는 글자(`./codes` 의
 *    `PENDING_REQUEST_STATUSES`·`DECIDED_REQUEST_STATUSES`)는 **그대로 둔다** — 상태를 더했을 때 어느 쪽에도
 *    안 들어간 신청이 조용히 사라지는 것을 막는 자리다(그 파일의 「빠짐없이 덮는다」 시험).
 * 🔵 차례는 「방금 무슨 일이 있었나」를 훑는 자리라 **최신이 위**다(걷어낸 대기 목록은 「먼저 올라온 것부터
 *    처리하는 일감 줄」이라 반대였다 — 일감 줄이 다시 필요해지면 그때 차례를 뒤집어 되살린다).
 * 🔴 **건수 제한을 두지 않는다**(A/S 쪽 원본과 같다). 담당자가 「지난달 그 신청」을 찾는 자리이기도 해서, 잘라 내면
 *    못 찾는다. 상태로 거르는 것은 **화면에서** 한다(목록이 한 번에 다 와 있어야 거르기가 서버 왕복 없이 끝난다).
 * 🔵 **건수가 늘면 서버에서 쪽을 나눈다.** 그때 고칠 곳은 이 함수와 부르는 화면 둘뿐이다 — 지금은 신청이 몇십 건이라
 *    한 번에 보내는 편이 빠르고, 거르개가 바뀔 때마다 서버를 부르지 않아도 된다.
 */
export async function listAllRequests(): Promise<PendingRequestRow[]> {
  const rows = await db().select().from(stockRequests).orderBy(desc(stockRequests.requestedAt));
  return attachNames(rows);
}

/**
 * 바깥 요청 번호(A/S 쪽 `requestKey`)로 신청을 **여러 건 한 번에** 되읽는다
 * (2026-10-15, `GET /api/v1/stock-requests`. 설명은 API.md 4-7절).
 *
 * 🔵 **읽기만 더한 함수다** — 이 파일의 어떤 동작도 바뀌지 않았다. 줄을 빚는 길은 그대로
 *    `attachNames` → `toRow` 하나라, A/S 가 물어 가는 값과 화면이 그리는 값이 **같은 곳에서** 나온다.
 * 🔴 열쇠를 함께 돌려준다 — `PendingRequestRow` 에는 바깥 요청 번호가 없고(화면이 쓸 일이 없다),
 *    돌려줄 때는 **물어본 열쇠로 짝지어야** 하기 때문이다. 차례에 기대지 않고 신청 번호로 맞춘다.
 * 🔵 못 찾은 열쇠를 여기서 가리지 않는다 — 가르는 자리는 순수 함수 한 곳이다
 *    (`lib/api/stock-request-status.ts` 의 `buildStatusResponse`). 그래야 시험이 DB 없이 덮는다.
 * 🔵 재고 관리에서 직접 올린 신청은 이 칸이 비어 있어 **절대 걸리지 않는다**(NULL 은 어떤 값과도 같지 않다).
 */
export async function listRequestsByExternalKeys(keys: readonly string[]): Promise<Array<{ externalKey: string; request: ApiRequestRow }>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const rows = await db().select().from(stockRequests).where(inArray(stockRequests.externalKey, unique));
  const keyById = new Map(rows.map((r) => [r.id, r.externalKey ?? ""]));
  const views = await attachNames(rows);
  const subs = requesterSubsOf(rows);
  return views.map((request) => ({ externalKey: keyById.get(request.id) ?? "", request: withRequesterSub(request, subs) }));
}

/**
 * **바깥 통로가 받아 가는 줄** — 화면이 그리는 줄에 **올린 사람의 포털 번호**를 얹은 것
 * (2026-10-16, A/S 가 「내가 올린 줄」을 가리는 유일한 값이다. API.md 4-7절).
 *
 * 🔴 **`PendingRequestRow` 에 그 칸을 넣지 않은 까닭**: 그 줄은 부품 요청 관리 화면이 **통째로 클라이언트
 *    컴포넌트에 넘긴다**(`app/(app)/requests/page.tsx` → `RequestManagerScreen`). 거기에 칸을 더하면 **모든
 *    신청자의 포털 번호가 브라우저로 실려 나간다** — 화면은 그 값을 한 번도 쓰지 않는데도.
 *    그래서 **바깥으로 나가는 두 함수에서만** 얹는다. 🔵 A/S 는 이 번호를 이미 알고 있다(저쪽
 *    `users.sso_subject`) — 저쪽에는 새어 나가는 값이 아니고, 브라우저에는 안 보낸다.
 * 🔴 **재고 관리 화면에서 직접 올린 신청은 `null`** 이다. 지어내지 않는다 — 거기서는 `requested_by` 가 곧
 *    사람이라 포털 번호를 적을 까닭이 없었다(표 주석). A/S 쪽은 이 `null` 을 보고 「내 것이 아니다」로 읽는다.
 */
export type ApiRequestRow = PendingRequestRow & { requesterSub: string | null };

/** 신청 번호 → 포털 번호. 🔵 줄을 빚는 길(`attachNames` → `toRow`)을 건드리지 않으려고 밖에서 짝짓는다. */
function requesterSubsOf(rows: Array<typeof stockRequests.$inferSelect>): Map<string, string | null> {
  return new Map(rows.map((r) => [r.id, r.requesterSub]));
}

function withRequesterSub(request: PendingRequestRow, subs: ReadonlyMap<string, string | null>): ApiRequestRow {
  return { ...request, requesterSub: subs.get(request.id) ?? null };
}

/**
 * **인수번호**로 신청을 되읽는다 — 그 수리 건의 반출 신청을 **누가 올렸든** (2026-10-15,
 * `GET /api/v1/stock-requests?intake=…`. 설명은 API.md 4-7절).
 *
 * 🔴 **까닭**: A/S 는 제가 올릴 때 지어 보낸 요청 번호(`external_key`)를 **들고 있지 않다** — 재고에 관한
 *    것을 저쪽 표에 저장하지 않기로 했기 때문이다(2026-10-15 사용자 결정). 저쪽이 언제나 아는 값은
 *    **인수번호**이고, 우리 신청은 그것을 payload 에 이미 들고 있다.
 * 🔵 **읽기만 더한 함수다** — 위의 `listRequestsByExternalKeys` 와 **같은 길**(`attachNames` → `toRow`)로
 *    줄을 빚는다. 이 파일의 어떤 동작도 바뀌지 않는다.
 * 🔴 **열쇠가 없는 신청도 걸린다**(재고 관리 화면에서 직접 올린 반출). 일부러 그렇게 둔다 — 그 수리 건에
 *    나간 부품을 A/S 쪽에서 **빠짐없이** 보는 것이 이 통로의 뜻이다. 그때 `externalKey` 는 `null` 이다.
 * 🔵 인수번호는 **payload 안**에 있다(칸이 따로 없다. `stock_requests` 스키마). 그래서 `payload->>'intakeNumber'`
 *    로 읽는다 — 🔴 **표를 고치지 않으려는 것**이고, 신청은 많아야 몇천 건이라 훑어도 된다. 느려지면 그때
 *    그 식에 색인을 두면 되고(표 모양은 그대로다), 그 전에 칸을 더해 같은 사실을 두 곳에 적지 않는다.
 * 🔵 대문자로 받는다 — 저장된 값이 언제나 대문자다(올리는 통로와 화면 폼이 저장 전에 올린다). 다듬는 자리는
 *    부르는 쪽 순수 함수(`lib/api/stock-request-status.ts` 의 `parseStatusIntakes`) 하나다.
 * 🔵 차례를 여기서 정하지 않는다 — 돌려줄 차례는 순수 함수 한 곳에서 정한다(`buildIntakeStatusResponse`).
 *    그래야 시험이 DB 없이 그 규칙을 덮는다.
 */
export async function listRequestsByIntakeNumbers(intakeNumbers: readonly string[]): Promise<Array<{ externalKey: string | null; request: ApiRequestRow }>> {
  const unique = [...new Set(intakeNumbers)];
  if (unique.length === 0) return [];
  const rows = await db()
    .select()
    .from(stockRequests)
    .where(inArray(sql`${stockRequests.payload}->>'intakeNumber'`, unique));
  const keyById = new Map(rows.map((r) => [r.id, r.externalKey]));
  const views = await attachNames(rows);
  // 🔴 **열쇠로 물었을 때와 같은 줄 모양**이다 — 포털 번호도 여기서 똑같이 얹는다(한쪽만 실으면 A/S 화면이
  //    묻는 법에 따라 [요청 취소] 단추를 그렸다 말았다 한다).
  const subs = requesterSubsOf(rows);
  return views.map((request) => ({ externalKey: keyById.get(request.id) ?? null, request: withRequesterSub(request, subs) }));
}

/**
 * 🔵 부품 정보와 「이미 나간 수량」을 각각 **한 번씩**만 묻는다(신청 수와 무관하게 질의 둘).
 * 🔴 목록을 만드는 길은 여기 하나뿐이다 — 신청 줄을 읽는 자리가 늘어도 **같은 줄 모양**을 받는다.
 *    화면마다 따로 채우면 언젠가 한쪽에만 칸이 생겨 갈린다.
 */
async function attachNames(rows: Array<typeof stockRequests.$inferSelect>): Promise<PendingRequestRow[]> {
  const [names, issued] = await Promise.all([partViewsOf(rows.flatMap((r) => linesOf(r.payload as unknown as EntryInput).map((l) => l.partId))), issuedQuantitiesOf(rows.map((r) => r.id))]);
  return rows.map((r) => toRow(r, names, issued.get(r.id) ?? new Map()));
}

/**
 * 머리말의 「대기 N」 배지.
 *
 * 🔴 아래 `summarizePendingRequests()`(알림 종)와 **같은 묶음**을 본다 — 둘이 갈리면 「배지에는 있는데 종에는 없는」 신청이 생긴다.
 * 🔴 그 묶음은 `ACTIONABLE_REQUEST_STATUSES` 다 — **세는 묶음(`./codes` 의 `PENDING_REQUEST_STATUSES`)보다 좁다.**
 *    보류(`ON_HOLD`)는 부품 요청 관리 목록에는 보이지만 이 숫자에서는 빠진다(2026-10-15, 조각 10a): 담당자가 일부러
 *    멈춰 둔 것을 재촉하지 않으려는 것이다.
 */
export async function countPendingRequests(): Promise<number> {
  const [r] = await db().select({ n: count() }).from(stockRequests).where(inArray(stockRequests.status, [...ACTIONABLE_REQUEST_STATUSES]));
  return r?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* 머리말의 알림 종이 쓰는 조회 (2026-10-13)                            */
/* 🔴 위의 함수들은 화면이 쓰고 있다 — 동작을 바꾸지 않고 **더하기만** 한다. */
/* ------------------------------------------------------------------ */

/**
 * 확인 대기 요약 — 건수와 **가장 오래 기다린 신청의 시각**.
 *
 * 🔴 `countPendingRequests()` 와 세는 범위가 **같다** — 둘 다 `ACTIONABLE_REQUEST_STATUSES` 를
 * 본다(일부 나감 PARTIAL 포함, 보류 ON_HOLD 제외). 목록을 손으로 두 벌 적으면 언젠가 갈려서 「배지에는
 * 있는데 종에는 없는」 신청이 생긴다. 그런데도 질의를 둘로 둔 까닭: 머리말의 「대기 N」
 * 배지는 숫자 하나만 쓰고 모든 화면에 딸려 오므로, 거기에 집계 한 칸을 더 얹지 않는다.
 * 종은 줄에 적을 날짜가 필요해 따로 묻는다.
 */
export async function summarizePendingRequests(): Promise<{ count: number; oldestAt: Date | null }> {
  const [r] = await db()
    .select({ n: count(), oldest: min(stockRequests.requestedAt) })
    .from(stockRequests)
    .where(inArray(stockRequests.status, [...ACTIONABLE_REQUEST_STATUSES]));
  // 드라이버가 timestamptz 를 Date 로 주지만, 집계는 글자로 올 수도 있어 둘 다 받는다.
  const oldest = (r?.oldest ?? null) as Date | string | null;
  return {
    count: r?.n ?? 0,
    oldestAt: oldest === null ? null : oldest instanceof Date ? oldest : new Date(oldest),
  };
}

/** 종에 실을 「내 반려된 신청」 한 줄. 사유 본문은 싣지 않는다 — 화면에서 본다. */
export interface RejectedRequestRow {
  id: string;
  summary: string;
  decidedByName: string | null;
  decidedAt: Date | null;
}

/**
 * 그 사람이 낸 신청 중 **반려된 것**을, `since` 이후에 결정된 것만.
 *
 * - 🔴 확인(CONFIRMED)·취소(CANCELLED)는 뺀다. 확인은 수량이 바뀌어 화면에서 바로
 *   보이고(2026-10-13 사용자 결정), 취소는 본인이 거둔 것이라 알릴 일이 아니다.
 * - `since` 를 부르는 쪽이 정한다 — 「7일」이 적힌 곳은 notifications/bell-items.ts
 *   하나뿐이어야 하기 때문이다(그 파일의 `rejectionCutoff`).
 * - 🔴 `total` 은 **상한에 걸리기 전의 전체 개수**다. 배지 숫자가 참말이어야 한다
 *   (@dss/ui README 7절). 창 함수는 WHERE 뒤·LIMIT 앞에 계산되므로 세는 질의를 따로
 *   보내지 않아도 된다 — 종은 모든 화면에 딸려 오므로 왕복 한 번이 곧 모든 화면의 비용이다.
 * - 색인 `stock_requests_requester_idx`(requested_by)를 탄다.
 */
export async function listRejectedRequestsFor(userId: string, since: Date, limit: number): Promise<{ rows: RejectedRequestRow[]; total: number }> {
  const rows = await db()
    .select({
      id: stockRequests.id,
      summary: stockRequests.summary,
      decidedByName: stockRequests.decidedByName,
      decidedAt: stockRequests.decidedAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(stockRequests)
    .where(and(eq(stockRequests.status, "REJECTED"), eq(stockRequests.requestedBy, userId), gte(stockRequests.decidedAt, since)))
    .orderBy(desc(stockRequests.decidedAt), desc(stockRequests.id))
    .limit(limit);
  if (rows.length === 0) return { rows: [], total: 0 };
  return {
    rows: rows.map((r) => ({ id: r.id, summary: r.summary, decidedByName: r.decidedByName, decidedAt: r.decidedAt })),
    total: rows[0].total,
  };
}
