import type { RequestSource, RequestStatus } from "@/db/schema/stock-requests";
import { EXTERNALLY_CANCELLABLE_REQUEST_SOURCES, REQUEST_STATUS_LABEL } from "@/lib/stock/codes";
import type { ApiRequestStatus } from "./stock-request-status";
import { MAX_KEY, MAX_SUB, asObjectField, trimTextField } from "./stock-requests";

/**
 * A/S 가 **제가 올린 신청을 거두는** 통로의 검사와 판정 — 순수 함수
 * (2026-10-16, `POST /api/v1/stock-requests/cancel`. 설명은 API.md 4-9절).
 *
 * 🔴 **까닭**: 올리는 통로(`POST /api/v1/stock-requests`)는 열렸는데 **거둘 길이 없었다.** 재고 관리는
 *    A/S 에서 온 신청을 제 화면에서 거두지 못하게 막아 두었고(`lib/stock/codes.ts` 의
 *    `CANCELLABLE_REQUEST_SOURCES` — 이쪽에서 접으면 저쪽에 열린 요청이 영영 답을 못 받는다),
 *    A/S 쪽에는 거두는 통로가 없었다. 그래서 잘못 올린 신청을 **아무도 되돌릴 수 없었다.**
 *    거두는 것은 **낸 쪽의 몫**이라고 정했으면, 낸 쪽이 거둘 문을 함께 내주어야 말이 맞는다.
 *
 * 규칙 다섯:
 *  1. 🔴 **쓰기 토큰이다**(`INVENTORY_WRITE_TOKEN`). 재고를 한 개도 움직이지 않지만 **신청의 상태를
 *     바꾼다** — 가르는 것은 주소가 아니라 하는 일이고(API.md 1절), 읽기 토큰은 부품 목록을 가져가는
 *     여러 시스템이 나눠 쓰는 값이라 그것으로 남의 신청을 접게 둘 수 없다.
 *  2. 🔴 **열쇠는 A/S 쪽 요청 번호(`requestKey`)다.** 올릴 때와 같은 값이고, 우리 내부 번호(`id`)로는
 *     받지 않는다(되읽는 통로와 같은 까닭 — `./stock-request-status.ts` 머리말 2번).
 *  3. 🔴 **거둘 수 있는 조건 셋**을 **각각 다른 말로** 가린다 — 아래 `judgeApiCancel`.
 *  4. 🔴 **이미 거둔 것은 오류가 아니다.** 같은 요청이 두 번 와도 「거둬져 있다」를 그대로 돌려준다
 *     (올리는 통로가 같은 열쇠에 `created: false` 를 주는 것과 **같은 정신** — 받는 쪽이 안심하고 다시
 *     보낼 수 있어야 한다. 끊긴 통신은 실제로 두 번 온다).
 *  5. 🔵 **돌려주는 줄 모양은 상태 통로와 같다**(`ApiRequestStatus`). 받는 쪽이 모양 두 벌을 다루지 않게.
 */

/** 받는 것 — 열쇠와 **올린 사람의 포털 번호** 둘뿐이다. */
export interface ApiCancelInput {
  requestKey: string;
  requesterSub: string;
}

export type ParseApiCancelResult = { ok: true; value: ApiCancelInput } | { ok: false; message: string };

/**
 * 받은 본문을 검사한다. 🔴 **첫 번째 잘못에서 멈추고 무엇이 틀렸는지 말한다**(올리는 통로와 같은 관례).
 *
 * 🔵 **다듬기를 올리는 통로에서 그대로 가져온다**(`trimTextField`·`MAX_KEY`·`MAX_SUB`). 저쪽이 잘라서
 *    저장한 값을 이쪽이 다르게 다듬으면 **같은 글자로 보내도 못 찾는다** — 되읽는 통로가 `MAX_KEY` 를
 *    가져가는 것과 같은 까닭이다.
 * 🔴 **사유를 받지 않는다.** 거두는 것은 낸 사람이 「안 가져가겠다」는 뜻 하나뿐이고, 재고 쪽에 남을
 *    것은 「누가 언제 거뒀나」다(감사 로그). 적을 자리를 만들면 그 값을 보여 줄 화면도 함께 있어야 한다.
 */
export function parseApiCancelRequest(raw: unknown): ParseApiCancelResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "본문은 JSON 객체여야 합니다." };
  }
  const body = raw as Record<string, unknown>;

  const requestKey = trimTextField(body.requestKey, MAX_KEY);
  if (!requestKey) {
    return { ok: false, message: `requestKey 는 거둘 신청의 A/S 쪽 요청 번호입니다 (올릴 때 보낸 그 값, 1~${MAX_KEY}자 글자).` };
  }

  const requesterSub = trimTextField(asObjectField(body.requester).sub, MAX_SUB);
  if (!requesterSub) {
    return { ok: false, message: "requester.sub 는 **올린 사람의 포털 번호**입니다. 남의 신청은 거둘 수 없으므로 신청에 적힌 번호와 같아야 합니다." };
  }

  return { ok: true, value: { requestKey, requesterSub } };
}

/**
 * 판정에 필요한 칸만 — 🔵 `lib/stock/requests.ts` 의 `ExternalCancelTarget` 이 이 모양을 그대로 만족한다.
 *    🔴 그 타입을 끌어오지 않는 까닭: 저 파일은 `server-only` 라 `npm test` 가 **불러올 수조차 없다**
 *    (`./stock-request-status.ts` 의 `RequestStatusSource` 와 같은 까닭).
 */
export interface CancelSubject {
  source: RequestSource;
  status: RequestStatus;
  /** 🔴 신청에 적힌 **올린 사람의 포털 번호**. 화면에서 직접 올린 신청은 비어 있다(`null`). */
  requesterSub: string | null;
}

export interface CancelDenial {
  ok: false;
  status: 403 | 404 | 409;
  error: "not_found" | "forbidden" | "conflict";
  message: string;
}

/**
 * 거둘 수 있나. 🔵 `target` 을 함께 돌려주는 것은 부르는 쪽이 **그 줄로 바로 거두게** 하려는 것이다
 * (통로 파일에서 `null` 아님을 다시 증명하지 않아도 되게).
 */
export type CancelJudgement<T> = { ok: true; already: boolean; target: T } | CancelDenial;

/**
 * 🔴 **거둘 수 있는 조건 셋 — 하나라도 어긋나면 각각 다른 말로 거절한다.**
 *
 *  1. **그 열쇠의 신청이 있을 것** → 없으면 404 `not_found`. 조용히 「거뒀다」로 답하지 않는다 —
 *     오타로 엉뚱한 열쇠를 보냈을 때 저쪽은 **거둔 줄 알고 끝낸다**(실제 신청은 그대로 선 채로).
 *  2. 🔴 **올린 사람 본인일 것** → 아니면 403 `forbidden`. 신청에 적힌 포털 번호와 보낸 번호가 같아야
 *     한다. **남의 신청을 거둘 수 없다** — 쓰기 토큰은 시스템 하나가 들고 있는 값이라, 토큰만으로
 *     지나가게 두면 A/S 를 쓰는 **아무나 남의 요청을 접을 수 있다.**
 *  3. **아직 대기(PENDING)일 것** → 아니면 409 `conflict`. 한 개라도 나갔거나(`PARTIAL`) 담당자가
 *     집었으면(`CONFIRMING`) 이미 물건이 움직이는 중이고, 결재가 걸린 신청도 여기서 접으면 결재선이
 *     허공을 가리킨다. 지금 상태를 **글자로 적어** 돌려준다 — 「왜 안 되는지」가 저쪽 화면에 그대로 뜬다.
 *
 * 🔴 **출처가 `AS` 가 아니면 이 통로로 거두지 않는다**(403). 재고 관리 화면에서 직접 올린 신청은
 *    **그쪽 화면에서** 거둔다(`lib/stock/codes.ts` 의 `CANCELLABLE_REQUEST_SOURCES`). 🔵 실제로는
 *    그런 신청에 열쇠가 아예 없어 1번에서 먼저 걸리지만, **판정을 운에 맡기지 않는다** — 언젠가 열쇠를
 *    달고 들어오는 신청이 생기면 그때 말없이 문이 열린다.
 *
 * 🔴 **이미 거둬진 것(`CANCELLED`)은 오류가 아니다**(머리말 4번) — `already: true` 로 통과시킨다.
 *    🔵 그래도 **출처·본인은 먼저 본다.** 남의 신청이 거둬져 있는 것을 「거둬 드렸습니다」로 답하면
 *    남의 요청 상태를 아무나 떠볼 수 있는 창이 된다.
 */
export function judgeApiCancel<T extends CancelSubject>(found: T | null, requesterSub: string): CancelJudgement<T> {
  if (!found) {
    return {
      ok: false,
      status: 404,
      error: "not_found",
      message: "그 requestKey 로 올라온 신청이 없습니다. 올릴 때 보낸 값을 그대로 보내십시오.",
    };
  }
  if (!(EXTERNALLY_CANCELLABLE_REQUEST_SOURCES as readonly RequestSource[]).includes(found.source)) {
    return {
      ok: false,
      status: 403,
      error: "forbidden",
      message: "재고 관리에서 직접 올린 신청입니다. 이 통로로는 거둘 수 없고, 재고 관리 화면에서 거둡니다.",
    };
  }
  if (found.requesterSub === null || found.requesterSub !== requesterSub) {
    return {
      ok: false,
      status: 403,
      error: "forbidden",
      message: "올린 사람만 거둘 수 있습니다. 신청에 적힌 포털 번호와 보내신 requester.sub 가 다릅니다.",
    };
  }
  if (found.status === "CANCELLED") return { ok: true, already: true, target: found };
  if (found.status !== "PENDING") {
    return {
      ok: false,
      status: 409,
      error: "conflict",
      message: `지금 「${REQUEST_STATUS_LABEL[found.status]}」 상태라 거둘 수 없습니다. 아직 대기 중인 신청만 거둡니다 — 재고 담당자에게 말씀하십시오.`,
    };
  }
  return { ok: true, already: false, target: found };
}

/**
 * 돌려주는 모양.
 *
 * 🔴 `cancelled` 는 **이번 호출이 거뒀나**이다 — 올리는 통로의 `created` 와 **같은 뜻의 칸**이다
 *    (`created: false` = 이미 서 있던 신청 / `cancelled: false` = 이미 거둬져 있던 신청). 둘 다 200 이고
 *    오류가 아니다. **지금 상태를 말하는 것은 언제나 `request.status`** 이고, 거기엔 두 경우 모두
 *    `CANCELLED` 가 온다.
 * 🔵 `request` 는 **상태 통로(`GET /api/v1/stock-requests`)가 주는 줄 그대로**다. 받는 쪽이 모양 두 벌을
 *    다루지 않게, 그리고 거둔 직후의 화면을 **다시 묻지 않고** 그릴 수 있게.
 */
export interface ApiCancelResponse {
  cancelled: boolean;
  request: ApiRequestStatus;
}

export function toApiCancelResponse(cancelled: boolean, request: ApiRequestStatus): ApiCancelResponse {
  return { cancelled, request };
}
