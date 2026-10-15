import type { RequestStatus } from "@/db/schema/stock-requests";
import { CHARGE_LABEL, CHARGE_TYPES, INTAKE_NUMBER_RE, REQUEST_STATUS_LABEL, isChargeType, type ChargeType, type EntryType } from "@/lib/stock/codes";
import { MAX_LINES, MAX_QTY, type EntryInput } from "@/lib/stock/form";

/**
 * A/S 가 보내는 **반출 신청**의 검사와 모양 — 순수 함수 (2026-10-15, `POST /api/v1/stock-requests`).
 *
 * 🔴 **바깥이 처음으로 쓰기를 하는 자리다.** 그래서 규칙을 여기(DB 없는 순수 함수)에 모아 두고 시험이
 *    전부 덮는다. 통로 파일(`src/app/api/v1/stock-requests/route.ts`)은 이 함수들을 부르고 DB 만 만진다.
 *
 * 규칙 넷 (2026-10-15 사용자 승인 설계):
 *  1. **종류는 「사용」 고정**이다. 바깥이 종류를 고르게 하지 않는다 — 지금 쓸 일이 그것 하나다.
 *  2. **상한은 화면과 같은 값**(`MAX_LINES`·`MAX_QTY`, `src/lib/stock/form.ts`). 여기서 새 숫자를 정하면
 *     화면으로 적은 신청과 통로로 온 신청이 다른 규칙을 받는다.
 *  3. **인수번호는 A/S 가 보낸 것을 확인된 것으로 본다** — 출처가 A/S 자신이라 되물을 데가 없다.
 *     여기서는 **모양만**(D + 숫자 6자리) 본다. 🔵 담당자가 [확인]을 누르는 순간 원장이 제 규칙대로
 *     A/S 조회 통로에 한 번 더 묻는다(`ledger.ts`) — 그쪽은 손대지 않았다.
 *  4. 🔴 **틀린 줄을 조용히 건너뛰지 않는다.** 한 줄이라도 틀리면 통째로 400 이다. 줄 하나가 사라진 채
 *     신청이 서면 아무도 모르고, A/S 쪽에서는 「보냈는데 왜 안 왔지」가 된다.
 */

/** 줄 하나 — 🔴 **재고 관리의 부품 No.** 다(UUID 가 아니다. API.md 2절의 `no`). */
export interface ApiRequestLineInput {
  no: number;
  quantity: number;
  /**
   * 유상·무상 — 🔴 **필수이고 기본값이 없다** (2026-10-15 담당자 결정).
   *
   * 청구에 걸리는 값이라 **안 보내면 거절한다.** 안 보낸 것을 한쪽으로 채워 주면 틀린 청구가 조용히 서고,
   * 그것은 재고가 어긋나는 것보다 늦게 드러난다.
   * 🔴 **줄마다 다를 수 있다** — 담당자: 「한 건 안에서 부품마다 다른 일이 실제로 있다」. 그래서 건 단위가
   *    아니라 줄 단위로 받는다(원장도 줄마다 들고 있다 — `stock_transactions.charge_type`).
   */
  chargeType: ChargeType;
}

/** 거절 문구에 쓰는 「PAID(유상) 또는 FREE(무상)」. 🔴 글자를 손으로 적지 않고 **코드값 한 벌에서** 만든다. */
const CHARGE_CHOICES = CHARGE_TYPES.map((c) => `${c}(${CHARGE_LABEL[c]})`).join(" 또는 ");

export interface ApiStockRequestInput {
  /**
   * 바깥 요청 번호 — **A/S 쪽 요청 id**. 🔴 같은 값으로 두 번 부르면 **새로 만들지 않고 처음 만든 신청을
   * 그대로 돌려준다**(응답의 `created: false`). 통신이 끊기면 실제로 두 번 오기 때문이다(담당자 답변3 4절).
   */
  requestKey: string;
  intakeNumber: string;
  /** 신청자 — **포털 번호**(`sub`)로 재고 관리의 사람과 잇는다. 없는 사람이어도 신청은 받는다. */
  requester: { sub: string; name: string };
  lines: ApiRequestLineInput[];
  reason: string;
  note: string;
}

export type ParseApiStockRequestResult = { ok: true; value: ApiStockRequestInput } | { ok: false; message: string };

const MAX_KEY = 100;
const MAX_SUB = 200;
const MAX_NAME = 100;

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 글자 칸: 글자가 아니면 빈 값으로 본다(없는 것과 같게). 앞뒤 공백을 떼고 길이를 자른다 — 화면 폼과 같은 관례. */
function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

/**
 * 받은 본문을 검사한다. 🔴 **첫 번째 잘못에서 멈추고 무엇이 틀렸는지 말한다** — 부르는 쪽이 고칠 수 있게
 * 칸 이름과 받은 값을 함께 적는다.
 */
export function parseApiStockRequest(raw: unknown): ParseApiStockRequestResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "본문은 JSON 객체여야 합니다." };
  }
  const body = raw as Record<string, unknown>;

  const requestKey = text(body.requestKey, MAX_KEY);
  if (!requestKey) {
    return { ok: false, message: `requestKey 는 A/S 쪽 요청 번호입니다 (1~${MAX_KEY}자 글자). 같은 값으로 두 번 부르면 처음 만든 신청을 그대로 돌려줍니다.` };
  }

  const intakeNumber = text(body.intakeNumber, 20).toUpperCase();
  if (!INTAKE_NUMBER_RE.test(intakeNumber)) {
    return { ok: false, message: `intakeNumber 는 D 와 숫자 6자리입니다 (예: D260701). 받은 값: ${JSON.stringify(body.intakeNumber ?? null)}` };
  }

  const requester = asRecord(body.requester);
  const sub = text(requester.sub, MAX_SUB);
  if (!sub) return { ok: false, message: "requester.sub 는 신청자의 포털 번호입니다. 재고 관리에 없는 사람이어도 괜찮지만 번호는 있어야 합니다." };
  const name = text(requester.name, MAX_NAME);
  if (!name) return { ok: false, message: "requester.name 은 신청자 이름입니다." };

  if (!Array.isArray(body.lines)) return { ok: false, message: "lines 는 부품 줄의 배열입니다 (예: [{ \"no\": 165, \"quantity\": 1 }])." };
  if (body.lines.length === 0) return { ok: false, message: "lines 가 비어 있습니다. 부품을 한 줄 이상 보내십시오." };
  if (body.lines.length > MAX_LINES) return { ok: false, message: `한 건에 ${MAX_LINES}줄까지입니다 (받은 줄 수: ${body.lines.length}). 나누어 보내십시오.` };

  const lines: ApiRequestLineInput[] = [];
  const seen = new Set<number>();
  for (const [i, item] of body.lines.entries()) {
    const line = asRecord(item);
    const at = `${i + 1}번째 줄`;
    // 🔴 글자로 온 숫자("3")를 받아 주지 않는다. 기계가 보내는 값이라 조용히 고쳐 주는 편이 더 위험하다.
    if (typeof line.no !== "number" || !Number.isInteger(line.no) || line.no < 1) {
      return { ok: false, message: `${at}: no 는 재고 관리의 부품 No.(1 이상의 정수)입니다. 받은 값: ${JSON.stringify(line.no ?? null)}` };
    }
    if (seen.has(line.no)) return { ok: false, message: `${at}: No. ${line.no} 가 두 번 들어 있습니다. 한 줄에 수량을 합치십시오.` };
    seen.add(line.no);
    if (typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QTY) {
      return { ok: false, message: `${at}(No. ${line.no}): quantity 는 1 이상 ${MAX_QTY.toLocaleString("en-US")} 이하의 정수입니다. 받은 값: ${JSON.stringify(line.quantity ?? null)}` };
    }
    // 🔴 기본값으로 채우지 않는다 — 청구에 걸리는 값이다(위 `chargeType` 주석).
    if (!isChargeType(line.chargeType)) {
      return { ok: false, message: `${at}(No. ${line.no}): chargeType 은 ${CHARGE_CHOICES}입니다. **기본값이 없으니 줄마다 보내십시오.** 받은 값: ${JSON.stringify(line.chargeType ?? null)}` };
    }
    lines.push({ no: line.no, quantity: line.quantity, chargeType: line.chargeType });
  }

  return { ok: true, value: { requestKey, intakeNumber, requester: { sub, name }, lines, reason: text(body.reason, 500), note: text(body.note, 1000) } };
}

/** 부품 되짚기에 쓰는 한 줄 — 통로가 `parts` 에서 읽어 넘긴다. */
export interface ApiPartRow {
  no: number;
  id: string;
  isDeleted: boolean;
}

/** 부품을 되짚은 줄. 🔵 유상·무상은 **바깥이 보낸 값 그대로** 실려 간다(여기서 정하는 값이 아니다). */
export interface ResolvedApiLine {
  partId: string;
  quantity: number;
  chargeType: ChargeType;
}

export type ResolveApiLinesResult = { ok: true; lines: ResolvedApiLine[] } | { ok: false; message: string };

/**
 * 부품 No. → 부품 id. 🔴 **없는 번호와 숨긴(지운) 부품을 다른 말로 거절한다** — A/S 쪽에서 「오타인가,
 * 우리가 치운 부품인가」를 가려야 고칠 수 있다.
 */
export function resolveApiRequestLines(lines: readonly ApiRequestLineInput[], found: readonly ApiPartRow[]): ResolveApiLinesResult {
  const byNo = new Map(found.map((p) => [p.no, p]));
  const missing: number[] = [];
  const hidden: number[] = [];
  for (const l of lines) {
    const p = byNo.get(l.no);
    if (!p) missing.push(l.no);
    else if (p.isDeleted) hidden.push(l.no);
  }
  if (missing.length > 0) return { ok: false, message: `재고 관리에 없는 부품 No. 입니다: ${missing.join(", ")}. GET /api/v1/parts 의 no 를 보내십시오.` };
  if (hidden.length > 0) return { ok: false, message: `숨긴(지운) 부품이라 반출 신청을 받지 않습니다: No. ${hidden.join(", ")}. 재고 담당자에게 확인하십시오.` };
  return { ok: true, lines: lines.map((l) => ({ partId: byNo.get(l.no)!.id, quantity: l.quantity, chargeType: l.chargeType })) };
}

/**
 * 신청에 담길 내용(`EntryInput`) — **화면이 만드는 것과 같은 모양**이다. 담당자가 [확인]을 누르면
 * 이 값 그대로 원장에 쓰인다(`confirmRequest`).
 *
 * 바깥이 보내지 않는 칸을 여기서 정한다. 🔴 **고른 값과 까닭을 적어 둔다** — 나중에 「이 값은 어디서 왔지」가
 * 코드만 보고 풀려야 한다. 셋 다 **인수번호가 필수**라는 데서 따라 나오는 값이다.
 *  - `type` **USE 고정** (위 머리말 1번).
 *  - `occurredOn` = **오늘**(서울). A/S 는 날짜를 보내지 않는다 — 신청을 낸 날이 맞는 말이고, 화면에서
 *    적을 때도 기본값이 오늘이다.
 *  - `purpose` = **REPAIR(수리)**. 인수번호가 **필수**라 수리 건에 쓰는 반출이다.
 *  - `noRepairCase` = false. 「수리 건 없음」으로 들어오는 길은 두지 않았다 — 인수번호가 필수다.
 *
 * 🔴 **유상·무상은 여기서 정하지 않는다.** A/S 가 **줄마다** 보낸 값을 그대로 싣는다 (2026-10-15 담당자 결정).
 *    한 건 안에 `PAID` 와 `FREE` 가 섞여 들어와도 **줄마다 제 값**으로 간다. 안 보냈으면 이 함수에 닿기 전에
 *    거절당한다(`parseApiStockRequest`) — 여기에 기본값을 되살리면 그 울타리가 통째로 무의미해진다.
 */
export function buildApiUseRequest(value: ApiStockRequestInput, lines: readonly ResolvedApiLine[], todayIso: string): EntryInput {
  return {
    type: "USE",
    occurredOn: todayIso,
    intakeNumber: value.intakeNumber,
    noRepairCase: false,
    reason: value.reason,
    purpose: "REPAIR",
    purposeText: "",
    note: value.note,
    lines: lines.map((l) => ({ partId: l.partId, quantity: l.quantity, chargeType: l.chargeType, note: "", actualQuantity: null })),
  };
}

/**
 * 돌려주는 모양. 🔴 **새로 만들었는지 이미 있던 것인지**(`created`)를 구별해 준다 — A/S 가 끊겨 다시 보냈을 때
 * 「두 번 만들어진 것 아닌가」를 거기서 알 수 있어야 한다. HTTP 코드도 가른다(201 새로 만듦 / 200 이미 있음).
 * 🔵 상태는 코드와 한글을 함께 — 부품 목록의 `owner`·`item` 과 같은 관례다(API.md 2절).
 */
export interface ApiStockRequestResponse {
  created: boolean;
  request: {
    id: string;
    requestKey: string;
    type: EntryType;
    status: { code: RequestStatus; label: string };
  };
}

export function toApiStockRequest(r: { id: string; status: RequestStatus; created: boolean }, requestKey: string, type: EntryType): ApiStockRequestResponse {
  return {
    created: r.created,
    request: { id: r.id, requestKey, type, status: { code: r.status, label: REQUEST_STATUS_LABEL[r.status] } },
  };
}
