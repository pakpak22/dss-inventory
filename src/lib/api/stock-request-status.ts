import type { RequestStatus } from "@/db/schema/stock-requests";
import { INTAKE_NUMBER_RE, isClosedRequest, requestStatusLabel, type EntryType } from "@/lib/stock/codes";
import { MAX_KEY } from "./stock-requests";

/**
 * A/S 가 **올린 신청이 지금 어떻게 됐는지** 물어 가는 통로의 검사와 모양 — 순수 함수
 * (2026-10-15, `GET /api/v1/stock-requests`).
 *
 * 🔴 **까닭**: 올리는 통로(`POST`, `./stock-requests.ts`)는 만들어 주기만 하고 **결과를 알려 주지 않는다** —
 *    되돌려 부르는 길(웹훅)을 만들지 않기로 했기 때문이다(2026-10-15 사용자 결정, API.md 4-6절).
 *    그러면 A/S 쪽에는 「올렸다」만 남고 승인·반려·보류는 영영 모른다. **물어 갈 통로**가 그 짝이다.
 *
 * 규칙 다섯:
 *  1. **읽기다.** 그래서 읽기 토큰(`INVENTORY_API_TOKEN`)으로 연다 — 부품 목록과 같은 문이다.
 *     쓰기 토큰은 재고를 **움직이는** 신청을 만드는 자리에만 쓴다(`lib/api/auth.ts` 머리말).
 *  2. 🔴 **열쇠는 A/S 쪽 요청 번호(`requestKey`)다.** 우리 내부 번호(`id`)로 묻게 하지 않는다 — 저쪽이
 *     언제나 들고 있는 값은 제 요청 번호이고, 내부 번호는 보관하다 잃으면 되읽을 길이 끊긴다.
 *  3. 🔴 **여러 건을 한 번에** 묻는다. A/S 수리 건 상세에는 요청이 여러 줄 있고, 건마다 한 번씩 묻게 하면
 *     화면 한 번 여는 데 왕복이 줄 수만큼 는다.
 *  4. 🔴 **못 찾은 열쇠를 조용히 빠뜨리지 않는다**(`notFound`). 빠뜨리면 A/S 는 「아직 안 올라갔나, 지워졌나」를
 *     가릴 수 없다 — 돌아온 줄 수만 세어 보고 「덜 왔네」로 끝난다.
 *  5. 🔴 **마감은 상태값이 아니라 세어서 가린다.** 규칙이 적힌 자리는 `lib/stock/codes.ts` 의
 *     `isClosedRequest` 하나뿐이고, 여기서도 **그 함수를 그대로 부른다**(손으로 다시 적으면 언젠가 갈린다).
 *
 * 🔵 **묻는 법이 둘이다 (2026-10-15 에 인수번호를 더했다).**
 *    열쇠(`key`)로 묻는 길은 위 그대로이고, **인수번호(`intake`)로 묻는 길**이 옆에 섰다. 까닭은 하나다 —
 *    🔴 **A/S 는 열쇠를 들고 있지 않다.** 「A/S 는 재고에 관한 것을 제 표에 저장하지 않는다」가 설계라
 *    (2026-10-15 사용자 결정), 올릴 때 지어 보낸 `requestKey` 를 저쪽 어디에도 적어 두지 않는다. 열쇠로만
 *    물을 수 있으면 **되읽는 통로가 사실상 닫혀 있는 것**과 같다. 저쪽이 언제나 아는 값은 **인수번호**이고,
 *    우리 신청은 그 번호를 이미 들고 있다(`payload.intakeNumber`).
 *    🔵 그래서 이 통로는 「누가 올렸든 **그 수리 건에 나간 부품**」을 돌려준다 — 아래 `buildIntakeStatusResponse`.
 */

/**
 * 한 번에 물을 수 있는 열쇠 수 — **50**.
 *
 * 🔵 이 저장소가 이미 쓰는 눈금이다: 한 신청에 실을 수 있는 부품 줄도 50 이다(`lib/stock/form.ts` 의 `MAX_LINES`,
 *    화면 폼과 올리는 통로가 함께 본다). 「한 번에 받는 양」의 숫자를 새로 정하지 않고 그 눈금을 따랐다.
 * 🔴 그런데도 `MAX_LINES` 를 **끌어오지 않고 따로 적는다** — 뜻이 다르기 때문이다(한 신청의 **부품 줄 수** ↔
 *    한 번에 묻는 **열쇠 수**). 끌어오면 화면 폼의 줄 상한을 손대는 날 이 통로의 상한이 말없이 따라 바뀐다.
 * 🔴 상한을 두는 까닭: 열쇠 하나가 신청 한 건이고 그 한 건이 부품 줄을 50개까지 들고 있어, 상한이 없으면
 *    한 번의 호출로 수천 줄을 읽히게 할 수 있다. 수리 건 하나에 신청이 50건을 넘을 일은 없다.
 */
export const MAX_STATUS_KEYS = 50;

export type ParseStatusKeysResult = { ok: true; keys: string[] } | { ok: false; message: string };

/**
 * `?key=AS-1&key=AS-2` 를 읽는다.
 *
 * 🔵 **열쇠를 다듬는 방식이 올리는 통로와 같다**(앞뒤 공백을 떼고 `MAX_KEY` 로 자른다). 저쪽이 자르고 저장한 값을
 *    이쪽이 안 자르면, 긴 열쇠로 올린 신청을 **같은 글자로 물어도 못 찾는다.** 그래서 상한을 저쪽에서 가져온다.
 * 🔵 같은 열쇠가 두 번 와도 **한 번만** 묻고 한 번만 돌려준다 — 부르는 쪽 목록에 중복이 있었을 뿐이고, 같은 신청을
 *    두 줄로 돌려주면 A/S 화면에 같은 줄이 둘 뜬다. 상한도 **추린 뒤의 수**로 센다(실제로 읽는 양이 그것이다).
 * 🔴 열쇠가 하나도 없으면 **전부 돌려주지 않고 거절한다** — 조건이 빠졌을 때 조용히 전체를 내주는 것은
 *    `GET /api/v1/parts` 가 모르는 값을 400 으로 돌려주는 것과 같은 까닭이다.
 */
export function parseStatusKeys(params: URLSearchParams): ParseStatusKeysResult {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const raw of params.getAll("key")) {
    const key = raw.trim().slice(0, MAX_KEY);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  if (keys.length === 0) {
    return { ok: false, message: "key 에 A/S 쪽 요청 번호(requestKey)를 하나 이상 보내십시오. 예: ?key=AS-REQ-2026-0007&key=AS-REQ-2026-0008" };
  }
  if (keys.length > MAX_STATUS_KEYS) {
    return { ok: false, message: `한 번에 ${MAX_STATUS_KEYS}개까지 물을 수 있습니다 (받은 열쇠: ${keys.length}개). 나누어 보내십시오.` };
  }
  return { ok: true, keys };
}

/* ------------------------------------------------------------------ */
/* 묻는 법 둘째 — **인수번호로** (2026-10-15)                            */
/* 🔴 위의 열쇠 길은 한 글자도 바꾸지 않았다. 더하기만 한다.              */
/* ------------------------------------------------------------------ */

/**
 * 인수번호를 받는 쿼리 이름.
 *
 * 🔵 올릴 때의 칸 이름은 `intakeNumber` 인데(API.md 4-2절) 여기서는 **`intake`** 다 — 이 통로가 이미
 *    `requestKey` 를 `key` 로 줄여 받고 있어서, 한 통로 안에서 한쪽만 긴 이름을 쓰면 그것이 더 헷갈린다.
 *    주소에 여러 번 붙는 값이기도 하다(`?intake=D260701&intake=D260702`).
 */
export const INTAKE_PARAM = "intake";

/**
 * 한 번에 물을 수 있는 인수번호 수 — **10**. 🔴 열쇠 상한(50)과 **일부러 다른 눈금**이다.
 *
 * 🔴 까닭: **열쇠 하나는 신청 하나지만, 인수번호 하나는 신청 여러 건이다.** 한 수리 건에 반출 신청이 몇 건
 *    붙는지는 우리가 정하는 값이 아니라서, 열쇠와 같은 50을 쓰면 한 번에 읽는 양에 뚜껑이 없어진다
 *    (50 × 신청 N건 × 부품 50줄).
 * 🔵 10 으로 잡으면 한 수리 건에 신청이 다섯 건씩 붙어도 열쇠 50개와 비슷한 양이다. 그리고 이 통로를 쓰는
 *    화면(수리 건 상세)은 **한 번에 수리 건 하나**를 열므로 보통은 1 이다 — 10 은 「건 목록에서 한꺼번에
 *    물어보고 싶다」가 생겼을 때의 여유이지, 지금 필요해서 둔 숫자가 아니다.
 */
export const MAX_STATUS_INTAKES = 10;

export type ParseStatusIntakesResult = { ok: true; intakeNumbers: string[] } | { ok: false; message: string };

/**
 * `?intake=D260701&intake=D260702` 를 읽는다.
 *
 * 🔴 **모양 검사는 이 저장소의 그 정규식을 그대로 쓴다**(`lib/stock/codes.ts` 의 `INTAKE_NUMBER_RE`).
 *    여기서 새로 적으면 화면·올리는 통로·엑셀 가져오기가 보는 모양과 갈린다.
 * 🔵 **대문자로 올려서 본다** — 올리는 통로도 화면 폼도 저장 전에 대문자로 바꾸므로(`lib/api/stock-requests.ts`
 *    의 `parseApiStockRequest`, `lib/stock/form.ts`), 소문자로 물었다고 못 찾으면 거짓말이 된다.
 * 🔴 **모양이 틀리면 거절한다** — 열쇠와 다른 점이다. 열쇠는 저쪽이 지은 글자라 우리가 옳고 그름을 모르지만,
 *    인수번호는 **모양이 정해진 값**이다. 조용히 못 찾은 것으로 돌려주면 「없는 건」인지 「오타」인지 못 가린다.
 * 🔵 빈 값은 없는 것으로 보고, 같은 번호가 두 번 오면 한 번만 묻는다(열쇠와 같은 관례).
 */
export function parseStatusIntakes(params: URLSearchParams): ParseStatusIntakesResult {
  const intakeNumbers: string[] = [];
  const seen = new Set<string>();
  for (const raw of params.getAll(INTAKE_PARAM)) {
    const value = raw.trim().toUpperCase();
    if (!value) continue;
    if (!INTAKE_NUMBER_RE.test(value)) {
      return { ok: false, message: `${INTAKE_PARAM} 는 인수번호(D 와 숫자 6자리, 예: D260701)입니다. 받은 값: ${JSON.stringify(raw)}` };
    }
    if (seen.has(value)) continue;
    seen.add(value);
    intakeNumbers.push(value);
  }
  if (intakeNumbers.length === 0) {
    return { ok: false, message: `${INTAKE_PARAM} 에 인수번호를 하나 이상 보내십시오. 예: ?${INTAKE_PARAM}=D260701` };
  }
  if (intakeNumbers.length > MAX_STATUS_INTAKES) {
    return { ok: false, message: `인수번호는 한 번에 ${MAX_STATUS_INTAKES}개까지입니다 (받은 인수번호: ${intakeNumbers.length}개). 인수번호 하나에 신청이 여러 건 걸리므로 열쇠(${MAX_STATUS_KEYS}개)보다 적습니다. 나누어 보내십시오.` };
  }
  return { ok: true, intakeNumbers };
}

/** 어느 길로 물었나. 🔵 돌려주는 모양은 둘이 같고(아래 `ApiRequestStatusResponse`), 가르는 것은 **읽는 법**뿐이다. */
export type StatusQuery = { mode: "key"; keys: string[] } | { mode: "intake"; intakeNumbers: string[] };

export type ParseStatusQueryResult = { ok: true; query: StatusQuery } | { ok: false; message: string };

/** 그 이름으로 **빈 값이 아닌** 값이 하나라도 왔는가. 🔵 섞어 보냈는지를 **다듬기 전에** 가리는 데 쓴다. */
function sentAny(params: URLSearchParams, name: string): boolean {
  return params.getAll(name).some((v) => v.trim() !== "");
}

/**
 * 묻는 법을 가린다 — **열쇠로** 또는 **인수번호로**.
 *
 * 🔴 **둘을 함께 보내면 거절한다**(400). 까닭 셋이다:
 *   1. **돌려줄 차례가 모호해진다.** 열쇠로 물으면 **물어본 차례 그대로**(저쪽 목록과 짝짓는 길)이고,
 *      인수번호로 물으면 **최근 신청이 위**(그 수리 건을 훑는 화면)다. 섞으면 어느 차례를 줄지 정할 수 없고,
 *      어느 쪽으로 정하든 부르는 쪽의 한 가지 기대는 말없이 깨진다.
 *   2. **`notFound` 의 뜻이 섞인다.** 그 칸은 열쇠에만 뜻이 있다(아래 `buildIntakeStatusResponse` 주석).
 *      함께 받으면 한 응답 안에서 그 칸이 반만 참말이 된다.
 *   3. **같은 신청이 두 번 실린다.** 열쇠로 물은 신청이 인수번호에도 걸리면 한 화면에 같은 줄이 둘 뜬다.
 * 🔵 섞였는지는 **다듬기 전에** 본다 — 인수번호 모양이 틀린 채로 섞여 왔을 때 「모양이 틀렸다」가 아니라
 *    「섞어 보냈다」를 말해 주어야 부르는 쪽이 진짜 잘못을 고친다.
 * 🔴 **둘 다 없으면 지금까지처럼 400 이다.** 조건이 빠졌을 때 조용히 전부를 내주지 않는다.
 */
export function parseStatusQuery(params: URLSearchParams): ParseStatusQueryResult {
  const byKey = sentAny(params, "key");
  const byIntake = sentAny(params, INTAKE_PARAM);

  if (byKey && byIntake) {
    return {
      ok: false,
      message: `key 와 ${INTAKE_PARAM} 를 함께 보낼 수 없습니다. 한 번에 한 가지로만 물으십시오 — 열쇠는 물어본 차례 그대로, 인수번호는 최근 신청이 위로 돌아가서 섞으면 차례의 뜻이 사라집니다.`,
    };
  }
  if (byIntake) {
    const parsed = parseStatusIntakes(params);
    return parsed.ok ? { ok: true, query: { mode: "intake", intakeNumbers: parsed.intakeNumbers } } : parsed;
  }
  if (byKey) {
    const parsed = parseStatusKeys(params);
    return parsed.ok ? { ok: true, query: { mode: "key", keys: parsed.keys } } : parsed;
  }
  return {
    ok: false,
    message: `무엇을 물을지 보내십시오 — key 에 A/S 쪽 요청 번호(requestKey), 또는 ${INTAKE_PARAM} 에 인수번호입니다. 예: ?key=AS-REQ-2026-0007 · ?${INTAKE_PARAM}=D260701`,
  };
}

/**
 * 줄 하나 — **요청 수량과 이미 나간 수량**.
 *
 * 🔵 A/S 화면이 「No. 165 ×2 중 1 나감」을 그리는 데 쓰는 값이다. 남은 수량은 뺄셈이라 칸을 두지 않는다
 *    (재고 쪽도 요약 칸을 두지 않고 세어서 안다 — `db/schema/stock-requests.ts` 의 회차 표 주석 3번).
 * 🔴 `no` 가 `null` 인 줄은 **그 사이 재고 쪽에서 지워진 부품**이다. 지어낸 번호를 넣지 않는다.
 */
export interface ApiRequestStatusLine {
  no: number | null;
  /** 품명. 지워진 부품이면 「(지워진 부품)」 — 재고 관리 화면이 쓰는 글자 그대로다. */
  name: string;
  /** 신청한 수량 */
  quantity: number;
  /** 이 신청에서 **이미 나간** 수량. 아직 하나도 안 나갔으면 0 */
  issued: number;
}

/**
 * 신청 한 건의 지금 상태.
 *
 * 🔴 이 모양도 다른 시스템이 의존하는 **약속**이다 — 칸을 더하는 것은 괜찮지만 이름을 바꾸거나 빼지 않는다
 *    (API.md 머리말).
 */
export interface ApiRequestStatus {
  /**
   * 물어본 열쇠를 **그대로** 돌려준다 — 부르는 쪽이 제 목록과 짝지을 수 있게.
   *
   * 🔴 **`null` 일 수 있다** (2026-10-15, 인수번호로 묻는 길이 생기면서). 인수번호로 물으면 **재고 관리에서
   *    직접 올린 신청**도 함께 돌아가는데, 그런 신청에는 A/S 쪽 요청 번호가 아예 없다. 지어내지 않는다.
   * 🔵 **열쇠로 물었을 때는 언제나 글자**다 — 열쇠가 적힌 신청만 걸리기 때문이다.
   */
  requestKey: string | null;
  /** 재고 쪽 신청 번호. 올릴 때 돌려받은 `request.id` 와 같은 값이다(사람에게 물을 때 쓴다) */
  id: string;
  /**
   * 이 신청이 붙어 있는 **인수번호** (2026-10-15 에 더한 칸).
   *
   * 🔴 인수번호 **여러 개를 한 번에** 물을 수 있어서 둔 칸이다 — 없으면 돌아온 줄이 어느 수리 건의 것인지
   *    부르는 쪽이 가릴 수 없다(신청 번호로는 못 가린다. 그 짝을 아는 것이 우리뿐이다).
   * 🔵 열쇠로 물었을 때도 **같이 간다** — 돌려주는 모양을 둘로 가르지 않으려는 것이다(머리말).
   *    반출 신청은 인수번호가 필수라 A/S 에서 올라온 신청에는 언제나 들어 있다. 재고 관리 화면에서
   *    「수리 건 없음」으로 적은 신청은 빈 글자다.
   */
  intakeNumber: string;
  type: EntryType;
  /**
   * 상태 코드와 **사람이 읽을 글자**.
   *
   * 🔴 글자는 재고 관리 화면이 쓰는 표에서 온다(`lib/stock/codes.ts` 의 `requestStatusLabel`) — 손으로 다시
   *    적지 않는다. 적으면 화면과 API 가 같은 상태를 다른 말로 불러, 전화로 맞춰 볼 때 서로 다른 말을 한다.
   * 🔴 **마감이면 `code` 는 `CONFIRMED` 인데 `label` 은 「마감」이다.** 마감은 상태값이 아니라 세어서 가리는
   *    것이라 그렇다(아래 `closed`). 가르려면 `label` 이 아니라 `closed` 를 보라.
   */
  status: { code: RequestStatus; label: string };
  /**
   * **마감된 신청인가** — 「준 것은 그대로 두고 남은 것만 접은」 것 (2026-10-14 재고 쪽 결정).
   * 🔵 `status.code` 로는 「다 나감」과 구별되지 않는다(둘 다 `CONFIRMED`). 가르는 칸이 이것이다.
   */
  closed: boolean;
  /** 신청이 선 시각(UTC) */
  requestedAt: string;
  lines: ApiRequestStatusLine[];
  /**
   * **결정한 사람·시각·사유** — 아직 결정 전이면 `null`.
   *
   * 🔵 확인됨·마감·반려·취소에 들어 있다. 일부만 나간(`PARTIAL`) 신청은 아직 결정이 아니라 `null` 이다 —
   *    재고 쪽도 그때는 결정 칸을 적지 않는다(`lib/stock/requests.ts` 의 `confirmRequest`: 「결정됨 = 더 볼 일 없음」).
   */
  decision: { byName: string; at: string; note: string } | null;
  /**
   * **지금 멈춰 둔 것이면** 사유·건 사람·시각. 아니면 `null`.
   *
   * 🔴 **사유까지 내준다**(2026-10-15 이 조각의 결정). 반려 사유(`decision.note`)를 내주면서 보류 사유를 가리면
   *    앞뒤가 안 맞는다 — 반려는 끝난 일이고 **보류는 「기다리라」**라서, 왜·언제까지인지가 그 줄의 전부다.
   *    가리면 A/S 쪽 사람은 결국 전화를 걸게 되고, 그러면 「물어 가는 통로」를 낸 뜻이 사라진다.
   *    🔵 같은 사유가 재고 관리 화면에도 그대로 보인다 — 신청자가 어느 화면을 열든 같은 말을 봐야 한다.
   */
  hold: { reason: string; byName: string; at: string } | null;
}

/**
 * 재고 쪽 신청 한 줄에서 **이 통로가 쓰는 칸만** 추린 모양.
 *
 * 🔵 `lib/stock/requests.ts` 의 `PendingRequestRow` 가 이 모양을 그대로 만족한다(칸이 더 많을 뿐이다).
 *    🔴 그 타입을 직접 끌어오지 않는 까닭: 저 파일은 `server-only` 라 `npm test` 가 **불러올 수조차 없다**.
 *    여기(순수 함수)에 모양만 적어 두면 시험이 DB 없이 덮고, 두 모양이 어긋나면 통로 파일에서 tsc 가 멈춘다.
 */
export interface RequestStatusSource {
  id: string;
  type: EntryType;
  status: RequestStatus;
  /** 🔵 `PendingRequestRow` 가 이미 들고 있는 칸이다(USE 가 아니면 빈 글자). 위 `ApiRequestStatus.intakeNumber` */
  intakeNumber: string;
  requestedAt: string;
  lines: readonly { partNo: number | null; partName: string; quantity: number; issued: number }[];
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string;
  hold: { reason: string; heldByName: string; heldAt: string } | null;
}

export function toApiRequestStatus(requestKey: string | null, r: RequestStatusSource): ApiRequestStatus {
  // 🔴 마감 판정은 **이 저장소의 그 함수**를 그대로 부른다 (머리말 5번). 「CONFIRMED 인데 덜 나갔다」를 손으로 적지 않는다.
  const closed = isClosedRequest(r.status, r.lines);
  return {
    requestKey,
    id: r.id,
    intakeNumber: r.intakeNumber,
    type: r.type,
    status: { code: r.status, label: requestStatusLabel(r.status, closed) },
    closed,
    requestedAt: r.requestedAt,
    lines: r.lines.map((l) => ({ no: l.partNo, name: l.partName, quantity: l.quantity, issued: l.issued })),
    // 🔵 결정 시각이 있으면 결정된 것이다 — 상태로 가르지 않는다. 결정 칸을 적는 자리가 넷(확인·마감·반려·취소)이라,
    //    상태 목록을 여기 또 적으면 다섯째가 생기는 날 조용히 빠진다.
    decision: r.decidedAt ? { byName: r.decidedByName ?? "", at: r.decidedAt, note: r.decisionNote } : null,
    hold: r.hold ? { reason: r.hold.reason, byName: r.hold.heldByName, at: r.hold.heldAt } : null,
  };
}

export interface ApiRequestStatusResponse {
  generatedAt: string;
  /** 찾은 신청의 수. 🔴 `count + notFound.length` 가 **물어본 열쇠 수**와 같다 */
  count: number;
  requests: ApiRequestStatus[];
  /** 🔴 **못 찾은 열쇠** — 조용히 빠뜨리지 않는다(머리말 4번). 하나도 없으면 빈 배열 */
  notFound: string[];
}

/**
 * 물어본 열쇠를 **물어본 차례 그대로** 훑어 찾은 것과 못 찾은 것으로 가른다.
 *
 * 🔵 차례를 지키는 까닭: A/S 가 제 요청 목록과 **차례로 짝지을 수 있다.** DB 가 돌려주는 차례(색인 순)는
 *    부르는 쪽 목록과 아무 관계가 없다.
 */
export function buildStatusResponse(keys: readonly string[], found: ReadonlyMap<string, RequestStatusSource>, generatedAt: string): ApiRequestStatusResponse {
  const requests: ApiRequestStatus[] = [];
  const notFound: string[] = [];
  for (const key of keys) {
    const row = found.get(key);
    if (row) requests.push(toApiRequestStatus(key, row));
    else notFound.push(key);
  }
  return { generatedAt, count: requests.length, requests, notFound };
}

/** 인수번호로 찾은 신청 한 줄 — 🔵 **열쇠가 없을 수 있다**(재고 관리 화면에서 직접 올린 신청). */
export interface IntakeStatusRow {
  requestKey: string | null;
  request: RequestStatusSource;
}

/**
 * 인수번호로 찾은 신청을 돌려줄 모양으로 빚는다.
 *
 * 🔴 **차례는 신청한 시각이 늦은 것이 위**다. 이 통로를 쓰는 자리가 **그 수리 건의 최근 요청부터 보는 화면**
 *    이기 때문이다 — 「방금 뭘 더 달라고 했지」가 맨 위에 와야 한다. 열쇠로 물을 때의 「물어본 차례 그대로」를
 *    여기 쓸 수 없는 것도 까닭이다: 인수번호 하나가 신청 여러 건을 끌고 와서 **짝지을 차례 자체가 없다.**
 *    🔵 시각이 같으면 신청 번호 역순으로 가른다 — 같은 초에 두 건이 서면 차례가 호출마다 달라져, 화면이
 *       새로고침할 때마다 줄이 바뀐다. DB 가 주는 차례에 기대지 않고 **여기서** 정한다(그래야 시험이 덮는다).
 * 🔴 **열쇠 없이 올라온 신청도 함께 돌려준다**(`requestKey: null`). 재고 관리 화면에서 직접 적은 반출도 그
 *    수리 건에 나간 부품이고, 빼면 A/S 쪽 화면이 **「이 건에 나간 부품」을 반만 보여 준다.** 그 화면의 뜻은
 *    「누가 적었나」가 아니라 「이 건에 무엇이 나갔나」다.
 * 🔴 **`notFound` 는 언제나 빈 목록이다.** 그 칸은 **열쇠로 물었을 때만** 뜻이 있다 — 열쇠는 우리가 받아
 *    적어 둔 값이라 「없다」가 이상한 일(안 올라갔거나 지워졌거나)이지만, 인수번호는 A/S 가 매긴 값이라
 *    **「그 수리 건에 아직 반출 신청이 없다」가 보통 일**이다. 거기 적어 돌려주면 A/S 화면이 평범한 건마다
 *    경고를 띄운다. 🔵 그런데도 **칸을 빼지 않는 것**은 받는 쪽이 모양 두 벌을 다루지 않게 하려는 것이고,
 *    어느 인수번호가 비었는지는 돌아온 줄의 `intakeNumber` 로 부르는 쪽이 바로 센다.
 */
export function buildIntakeStatusResponse(rows: readonly IntakeStatusRow[], generatedAt: string): ApiRequestStatusResponse {
  const sorted = [...rows].sort((a, b) => compareDesc(a.request.requestedAt, b.request.requestedAt) || compareDesc(a.request.id, b.request.id));
  const requests = sorted.map((r) => toApiRequestStatus(r.requestKey, r.request));
  return { generatedAt, count: requests.length, requests, notFound: [] };
}

/** 늦은 것이 앞. 🔵 시각은 전부 `toISOString()` 이라 글자 비교로 시각 비교가 된다. */
function compareDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
