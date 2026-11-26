import { OWNER_LABEL, type Owner } from "@/lib/parts/codes";
import { INTAKE_NUMBER_RE } from "@/lib/stock/codes";
// 🔵 **인수번호를 받는 쿼리 이름은 한 글자다** — 신청 상태 통로가 이미 `intake` 로 받고 있다.
//    여기서 `intakeNumber` 라고 새로 지으면, A/S 는 **같은 값을 통로마다 다른 이름으로** 붙여야 한다.
import { INTAKE_PARAM } from "./stock-request-status";

/**
 * A/S 가 **「이 수리 건에서 어떤 부품을 얼마나 돌려줄 수 있나」를 물어 가는 통로**의 검사와 모양 — 순수 함수
 * (2026-11-26, `GET /api/v1/return-candidates`. 설명은 API.md 8절).
 *
 * 🔴 **까닭**: A/S 에 [반환 요청] 화면이 선다. 그 화면은 부품마다 반환 수량을 적는데, **최댓값을 저쪽이
 *    셀 수 없다.** A/S 가 아는 것은 「이 건으로 얼마가 나갔나」뿐이고 **「이미 얼마가 돌아왔나」는 재고
 *    관리에만 있다**(원장 `stock_transactions.returns_transaction_id`). 나간 수량만 보고 최댓값을 그리면
 *    같은 부품을 **두 번 돌려주는 신청**이 서고, 그것은 원장이 거절할 때(`return_exceeds`)까지 아무도 모른다.
 *    그 뺄셈을 **값을 쥐고 있는 쪽이 해서 내주는 것**이 이 통로다.
 *
 * 규칙 다섯:
 *  1. **읽기다.** 재고를 한 개도 움직이지 않으므로 읽기 토큰(`INVENTORY_API_TOKEN`)으로 연다 — 부품 목록·신청
 *     상태와 같은 문이다(`lib/api/auth.ts` 머리말).
 *  2. 🔴 **부품별로 한 줄이다**(나간 원장 줄별이 아니다). 사람이 반환 화면에서 고르는 단위가 부품이고,
 *     「어느 불출 줄에 되돌려 붙일지」는 **재고 관리가 정할 일**이다 — 저쪽에 원장 줄 번호를 들려 보내면
 *     A/S 가 우리 내부 번호를 보관하게 되고, 그것은 이 두 시스템이 일부러 피해 온 모양이다
 *     (2026-10-15 결정: 「A/S 는 재고에 관한 것을 제 표에 저장하지 않는다」).
 *  3. 🔴 **`remaining` 은 음수로 나가지 않는다**(아래 `summarizeReturnCandidates`). 받는 쪽 화면이 최댓값으로
 *     쓰는 숫자라, 음수가 한 번 새면 수량 칸이 통째로 망가진다.
 *  4. 🔴 **`remaining` 이 0 이하인 부품은 아예 빼고 준다.** 돌려줄 것이 없는 줄을 화면에 세우면 사람이 0 을
 *     적고 거절당한다 — 「고를 수 있는데 못 보내는 줄」이 가장 나쁜 자리다.
 *  5. 🔴 **대기 중인 반환 신청(`pending`)까지 뺀다.** 아래 `pendingByTransaction` 머리말에 까닭이 길게 적혀 있다.
 *
 * 🔴 **마지막 울타리는 여기가 아니다.** 실제로 넘치는 반환을 거절하는 자리는 원장
 *    (`lib/stock/ledger.ts` 의 `return_exceeds`)이고, 그것은 **잠그고 다시 세는** 검사다. 이 통로는 화면이
 *    그릴 최댓값을 내줄 뿐이라, 여기서 조금 **적게** 말하는 것은 안전하고 **많게** 말하는 것이 위험하다.
 *    아래 곳곳의 「모르면 적게 센다」가 전부 그 판단이다.
 */

/* ------------------------------------------------------------------ */
/* 1. 묻는 법 — 인수번호 하나                                           */
/* ------------------------------------------------------------------ */

export type ParseReturnCandidatesResult = { ok: true; intakeNumber: string } | { ok: false; message: string };

/**
 * `?intake=D260701` 을 읽는다.
 *
 * 🔴 **모양 검사는 이 저장소의 그 정규식 그대로다**(`lib/stock/codes.ts` 의 `INTAKE_NUMBER_RE`). 여기서 새로
 *    적으면 화면·올리는 통로·엑셀 가져오기가 보는 모양과 갈린다.
 * 🔵 **대문자로 올려서 본다** — 저장된 값이 언제나 대문자다(올리는 통로도 화면 폼도 저장 전에 올린다).
 *    소문자로 물었다고 「없는 건」이라 답하면 거짓말이 된다.
 * 🔴 **한 번에 하나만 받는다** — 신청 상태 통로(`?intake=…` 를 10개까지)와 **일부러 다르다.** 돌려주는 것이
 *    「부품별 한 줄」이라, 인수번호 둘을 함께 받으면 **어느 건의 몫인지 줄에 적을 자리가 없다**(합쳐 주면
 *    A/S 가 건을 섞어 반환 신청을 세운다). 섞어 묻고 싶어지면 그때 줄마다 인수번호를 붙여 열면 된다.
 * 🔴 **값이 없으면 거절한다**(400). 조건이 빠졌을 때 조용히 전부를 내주지 않는다 — 부품 목록 통로가 모르는
 *    값을 400 으로 돌려주는 것과 같은 까닭이다.
 */
export function parseReturnCandidatesQuery(params: URLSearchParams): ParseReturnCandidatesResult {
  const given = params.getAll(INTAKE_PARAM).map((v) => v.trim().toUpperCase()).filter((v) => v !== "");
  const unique = [...new Set(given)];
  if (unique.length === 0) {
    return { ok: false, message: `${INTAKE_PARAM} 에 인수번호를 보내십시오. 예: ?${INTAKE_PARAM}=D260701` };
  }
  if (unique.length > 1) {
    return {
      ok: false,
      message: `${INTAKE_PARAM} 는 한 번에 하나입니다 (받은 인수번호: ${unique.length}개). 돌려주는 줄이 부품별이라 여러 건을 합치면 어느 수리 건의 몫인지 가릴 수 없습니다.`,
    };
  }
  const intakeNumber = unique[0];
  if (!INTAKE_NUMBER_RE.test(intakeNumber)) {
    return { ok: false, message: `${INTAKE_PARAM} 는 인수번호(D 와 숫자 6자리, 예: D260701)입니다. 받은 값: ${JSON.stringify(intakeNumber)}` };
  }
  return { ok: true, intakeNumber };
}

/* ------------------------------------------------------------------ */
/* 2. 읽어 온 줄 — 나간 원장 줄 하나                                     */
/* ------------------------------------------------------------------ */

/** 그 부품을 알아보는 값. 🔵 칸 이름과 `owner` 의 모양은 부품 목록 통로(`GET /api/v1/parts`)와 같다. */
export interface ReturnableLinePart {
  no: number;
  name: string;
  name2: string;
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  owner: Owner;
}

/**
 * **나간 원장 줄 하나** — 읽는 자리는 `lib/stock/queries.ts` 의 `returnableLinesByIntake` 하나다.
 *
 * 🔴 **줄마다 `remaining` 을 들고 오지 않는다.** 남은 수량은 **부품 단위로 합친 뒤** 한 번만 센다
 *    (아래 `summarizeReturnCandidates`) — 줄마다 세어 두면 합치는 쪽에서 그 숫자를 또 더하게 되고,
 *    그때 「줄의 남은 수량」과 「부품의 남은 수량」 둘이 생긴다.
 * 🔵 `transactionId` 는 **대기 중인 반환 신청과 짝짓는 열쇠**다(신청이 그 번호로 줄을 가리킨다).
 *    내보내는 모양에는 들어가지 않는다(머리말 2번).
 */
export interface ReturnableLine {
  transactionId: string;
  part: ReturnableLinePart;
  /** 이 줄로 **나간** 수량 (원장 `delta` 의 부호를 뒤집은 값, 언제나 1 이상) */
  taken: number;
  /** 이 줄에 **이미 돌아온** 수량 */
  returned: number;
}

/* ------------------------------------------------------------------ */
/* 3. 대기 중인 반환 신청 — `pending`                                    */
/* ------------------------------------------------------------------ */

/** 반환 신청 payload 의 줄 하나 — 🔵 모양은 `lib/stock/form.ts` 의 `ReturnLine` 이다(열쇠가 부품이 아니라 **원장 줄**이다). */
export interface PendingReturnLine {
  transactionId: string;
  quantity: number;
}

/**
 * 신청 payload 에서 **반환 줄을 편다.**
 *
 * 🔴 **`payload` 는 DB 에 JSON 으로 누워 있다가 되살아난 값이라 타입을 믿을 수 없다** — 그래서 `unknown` 을
 *    받아 칸마다 확인한다(`lib/stock/requests.ts` 의 `linesOf` 가 유상/무상에서 하는 것과 같은 판단).
 * 🔴 **모양이 틀린 줄은 건너뛴다 — 그리고 그것은 안전한 쪽이 아니다.** 건너뛰면 `pending` 이 작아지고
 *    `remaining` 이 **커진다**(=더 많이 돌려줄 수 있다고 말한다). 그래도 그렇게 두는 까닭은, 모양이 깨진
 *    줄 하나 때문에 **멀쩡한 부품까지 반환을 막는 것**이 더 나쁘고, 넘치는 반환은 원장이 다시 세어
 *    거절하기 때문이다(머리말의 마지막 울타리).
 * 🔵 반환 신청의 줄은 **부품이 아니라 원장 줄**을 가리킨다 — 그래서 `linesOf`(부품 기준)가 RETURN 을
 *    빈 배열로 돌려주고, 이 함수가 따로 있다. 두 함수가 **같은 payload 의 다른 칸**을 본다.
 */
export function returnRequestLines(payload: unknown): PendingReturnLine[] {
  if (typeof payload !== "object" || payload === null) return [];
  const raw = (payload as { lines?: unknown }).lines;
  if (!Array.isArray(raw)) return [];
  const lines: PendingReturnLine[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { transactionId, quantity } = item as { transactionId?: unknown; quantity?: unknown };
    if (typeof transactionId !== "string" || transactionId === "") continue;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) continue;
    lines.push({ transactionId, quantity });
  }
  return lines;
}

/**
 * **대기 중인 반환 신청**을 원장 줄별 수량으로 모은다.
 *
 * ── 🔴 **지금은 늘 비어 있다. 그래도 자리를 지금 만든다** (2026-11-26) ──────────
 * 이 저장소에는 `type='RETURN'` 인 신청이 **한 줄도 없다**(개발 DB 실측: `stock_requests` 29줄이 전부
 * `USE`). 반환 신청을 **세우는 일은 다음 조각**이고, 그때까지 이 함수는 빈 Map 을 돌려준다.
 * 🔴 **그런데도 지금 만드는 까닭**: 다음 조각이 신청을 세우기 시작하는 순간, 이 뺄셈이 없으면
 *    **같은 부품을 두 번 신청해 넘기는 길**이 열린다. 신청은 수량을 건드리지 않으므로(신청 표 머리말)
 *    두 번째 신청도 멀쩡히 서고, 터지는 것은 담당자가 **둘째를 확인하는 순간**이다 — 그때는 이미 A/S
 *    쪽에 「접수됐다」가 떠 있고, 어디서 어긋났는지 아무도 모른다.
 * 🔵 **지금 0 이 나오는 것이 정상**이고, 그 뜻을 시험 이름에 적어 두었다(`tests/api-return-candidates.test.ts`).
 *
 * 🔴 **어떤 상태를 「대기」로 세는가는 이 저장소의 그 묶음 하나다**(`lib/stock/codes.ts` 의
 *    `PENDING_REQUEST_STATUSES`) — 읽는 질의가 그것으로 거른다(`lib/stock/requests.ts` 의
 *    `listPendingReturnPayloads`). 여기서 상태를 다시 가리지 않는다: 두 곳에 적으면 상태가 하나 늘어난
 *    날 한쪽만 고쳐지고, 그때 **빠진 상태의 신청이 `pending` 에서 조용히 사라진다.**
 * 🔵 **부분 불출(`PARTIAL`)은 조금 많이 센다.** 그 상태는 일부가 이미 원장에 떨어진 것이라 그만큼은
 *    `returned` 에도 잡히는데, 여기서는 payload 의 **신청 수량 전부**를 센다. 🔴 그래서 `remaining` 이
 *    실제보다 **작게** 나올 수 있고, 그쪽이 안전한 방향이다(머리말). 반환을 나눠 내주는 길은 아직
 *    없으므로 지금은 일어나지 않는 일이다 — 생기면 여기 회차를 빼는 줄을 더한다.
 */
export function pendingByTransaction(payloads: readonly unknown[]): Map<string, number> {
  const pending = new Map<string, number>();
  for (const payload of payloads) {
    for (const line of returnRequestLines(payload)) {
      pending.set(line.transactionId, (pending.get(line.transactionId) ?? 0) + line.quantity);
    }
  }
  return pending;
}

/* ------------------------------------------------------------------ */
/* 4. 돌려주는 모양                                                     */
/* ------------------------------------------------------------------ */

/**
 * 돌려줄 수 있는 부품 한 줄.
 *
 * 🔴 이 모양도 다른 시스템이 의존하는 **약속**이다 — 칸을 더하는 것은 괜찮지만 이름을 바꾸거나 빼지 않는다
 *    (API.md 머리말).
 * 🔵 네 숫자를 **다 내준다.** `remaining` 하나면 화면은 그릴 수 있지만, 사람이 「왜 3개뿐이지」를 물을 때
 *    답할 수가 없다(나간 것·돌아간 것·신청 중인 것이 각각 얼마인지가 그 답이다).
 */
export interface ApiReturnCandidate {
  /** 재고 관리의 부품 No. 🔵 A/S 가 다른 통로에서 쓰는 열쇠와 같은 값이다(`GET /api/v1/parts/{no}`). */
  no: number;
  name: string;
  name2: string;
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  /** 🔵 `{ code, label }` 모양은 부품 목록 통로의 `owner` 와 같다 — 글자를 저쪽에서 다시 지으면 두 화면이 다른 말을 한다. */
  owner: { code: Owner; label: string };
  /** 이 인수번호로 **나간** 수량의 합 (사용·대여, 기록 취소된 줄은 빠진다) */
  taken: number;
  /** 그중 **이미 돌아온** 수량의 합 */
  returned: number;
  /** **대기 중인 반환 신청**에 적힌 수량의 합. 🔵 지금은 언제나 0 이다(위 `pendingByTransaction` 머리말) */
  pending: number;
  /** 지금 **돌려줄 수 있는** 수량 = `taken − returned − pending`. 🔴 언제나 1 이상이다(0 이하는 줄째로 빠진다) */
  remaining: number;
}

/**
 * 돌려줄 수 있는 수량 = `taken − returned − pending`, **0 아래로는 안 내려간다.**
 *
 * 🔴 **세 숫자가 서로 다른 자리에서 온다**(원장의 나간 줄 · 원장의 돌아온 줄 · 신청 표). 셋이 어긋나면
 *    뺄셈이 음수가 될 수 있는데, 받는 쪽은 이 값을 **수량 칸의 최댓값**으로 쓴다 — 음수가 한 번 새면
 *    화면이 통째로 망가진다.
 * 🔵 **깎는 줄은 지금 눈에 보이는 일을 하지 않는다** — 0 이하인 줄은 아래 `summarizeReturnCandidates` 의
 *    거르개(`> 0`)에서 어차피 빠지기 때문이다. 그래도 함수로 꺼내 두는 까닭 둘: ① 거르개가 언젠가
 *    `>= 0` 으로 바뀌면(「0 인 줄도 보여 주자」) **이 줄이 유일한 울타리**가 된다 ② 꺼내 두어야 음수
 *    입력을 **시험이 직접 눌러 볼 수 있다**(목록 쪽으로만 재면 그 줄은 걸러져 표본이 비고, 빈 표본은
 *    공짜로 통과한다).
 */
export function remainingOf(taken: number, returned: number, pending: number): number {
  return Math.max(0, taken - returned - pending);
}

/**
 * 나간 줄들을 **부품별로 합쳐** 돌려줄 수 있는 수량을 센다.
 *
 * 🔴 **`remaining` 이 0 이하인 부품은 목록에서 뺀다**(머리말 4번). 🔵 음수를 막는 자리는 위 `remainingOf` 다.
 * 🔵 **차례는 부품 No. 오름차순**이다. DB 가 주는 차례에 기대지 않고 여기서 정한다 — 그래야 시험이 덮고,
 *    화면을 다시 그릴 때마다 줄이 바뀌지 않는다.
 * 🔵 **`taken`·`returned` 는 깎지 않고 그대로 더한다.** 그 둘은 「무슨 일이 있었나」를 말하는 값이라
 *    다듬으면 거짓이 된다. 다듬는 것은 「지금 뭘 할 수 있나」를 말하는 `remaining` 하나뿐이다.
 */
export function summarizeReturnCandidates(lines: readonly ReturnableLine[], pending: ReadonlyMap<string, number>): ApiReturnCandidate[] {
  const byPart = new Map<number, ApiReturnCandidate>();
  for (const line of lines) {
    const row = byPart.get(line.part.no) ?? {
      no: line.part.no,
      name: line.part.name,
      name2: line.part.name2,
      customerName: line.part.customerName,
      kyosanPartNo: line.part.kyosanPartNo,
      drawingNo: line.part.drawingNo,
      owner: { code: line.part.owner, label: OWNER_LABEL[line.part.owner] },
      taken: 0,
      returned: 0,
      pending: 0,
      remaining: 0,
    };
    row.taken += line.taken;
    row.returned += line.returned;
    row.pending += pending.get(line.transactionId) ?? 0;
    byPart.set(line.part.no, row);
  }
  return [...byPart.values()]
    .map((row) => ({ ...row, remaining: remainingOf(row.taken, row.returned, row.pending) }))
    .filter((row) => row.remaining > 0)
    .sort((a, b) => a.no - b.no);
}

export interface ApiReturnCandidatesResponse {
  generatedAt: string;
  /** 물어본 인수번호를 **그대로** 돌려준다 — 부르는 쪽이 제 화면과 짝지을 수 있게(대문자로 올린 뒤의 값이다). */
  intakeNumber: string;
  count: number;
  candidates: ApiReturnCandidate[];
}

/**
 * 돌려줄 모양으로 빚는다.
 *
 * 🔴 **없는 인수번호도 오류가 아니다** — 빈 목록이다. 「그 건으로 나간 부품이 없다」와 「그런 건이 없다」를
 *    재고 관리는 **가릴 수 없다**(수리 건 표는 A/S 에 있다). 404 로 답하면 아직 아무것도 안 나간 멀쩡한
 *    수리 건에서 A/S 화면이 오류를 띄운다.
 */
export function buildReturnCandidatesResponse(intakeNumber: string, candidates: readonly ApiReturnCandidate[], generatedAt: string): ApiReturnCandidatesResponse {
  return { generatedAt, intakeNumber, count: candidates.length, candidates: [...candidates] };
}
