import { CUSTOMER_NAME_DASH_ONLY, CUSTOMER_NAME_MAX } from "@/lib/parts/form";
import { MAX_NAME, MAX_SUB, asObjectField, trimTextField } from "./stock-requests";

/**
 * **고객사 품명을 바깥에서 채우는** 통로의 검사·판정·돌려줄 모양 — 순수 함수
 * (2026-10-16, `POST /api/v1/parts/{no}/customer-name`. 설명은 API.md 7절).
 *
 * 🔴 **이것은 재고 관리의 부품 자료를 바깥에서 고치는 첫 사례다.** 지금까지 바깥이 쓰는 자리는
 *    반출 신청을 **세우고 거두는** 것뿐이었고(API.md 4절), 그것은 신청 표만 건드렸다. 여기서는
 *    **정본인 `parts` 의 칸 하나**가 A/S 에서 들어온 값으로 바뀐다. 그래서 울타리를 더 좁게 둔다.
 *
 * 규칙 여섯 (2026-10-14 사용자 결정 넷 + 이 조각에서 더한 둘. 설계 7절):
 *  1. 🔴 **비어 있을 때만 채운다.** 이미 값이 있으면 **덮지 않고** 지금 값을 돌려준다 — 오류가 아니다
 *     (받는 쪽이 「이미 있습니다 — 「…」」라고 말할 수 있어야 한다). 덮어쓰기를 열면 A/S 쪽 한 사람의
 *     오타가 **고객사에 나가는 서류의 이름**을 조용히 갈아치운다.
 *  2. 🔴 **지우는 길을 두지 않는다.** 빈 글자·공백만·`-` 는 거절한다. 「채운다」만 있는 통로다.
 *  3. 🔴 **누가 채웠는지 남긴다** — 포털 번호와 이름. 바깥에서 들어오는 쓰기라 나중에 「이 이름 누가
 *     넣었지?」가 반드시 나온다. 그때 답할 것이 감사 로그뿐이므로 **번호까지** 받는다(이름은 겹친다).
 *  4. 🔴 **쓰기 토큰이다**(`INVENTORY_WRITE_TOKEN`). 읽기 토큰으로 두드리면 401 이고, 재고 쪽에 쓰기
 *     토큰이 없으면 이 통로만 503 으로 닫힌다 — 비었다고 열어 두지 않는다(`./token-gate.ts`).
 *  5. 🔴 **없는 번호와 지워진 부품을 각각 다른 말로** 거절한다(404 · 410). 한 가지로 뭉개면 저쪽에서
 *     「오타인가, 우리가 치운 부품인가」를 가릴 수 없다(올리는 통로의 `resolveApiRequestLines` 와 같은 결).
 *  6. 🔴 **고치는 길은 이 칸 하나뿐이다.** 품명·단가·비고는 이 통로로 들어오지 않는다.
 *
 * 🔵 **길이·`-` 는 화면 폼과 같은 자를 쓴다**(`lib/parts/form.ts` 가 내준 `CUSTOMER_NAME_MAX`·
 *    `CUSTOMER_NAME_DASH_ONLY`). 같은 칸인데 들어온 길에 따라 값이 달라지지 않게.
 */

/** 받는 것 — 채울 이름과 **채운 사람** 둘뿐이다. 부품은 주소의 No. 로 가리킨다. */
export interface ApiCustomerNameInput {
  customerName: string;
  filledBy: { sub: string; name: string };
}

export type ParseApiCustomerNameResult = { ok: true; value: ApiCustomerNameInput } | { ok: false; message: string };

/**
 * 주소의 `{no}`. 🔴 **글자로 온 숫자를 적당히 읽어 주지 않는다** — `"7번"`·`"07 "`·`"-3"` 은 전부 거절이다.
 * 🔵 `GET /api/v1/parts/{no}` 가 쓰는 것과 같은 자(`/^\d+$/`)이고, 거기와 달리 **함수로 꺼내 둔 것**은
 *    쓰는 통로의 울타리를 시험이 덮어야 하기 때문이다(통로 파일은 `server-only` 를 거쳐 들어간다).
 */
export function parsePartNoParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const no = Number(raw);
  return Number.isSafeInteger(no) && no >= 1 ? no : null;
}

/**
 * 본문 검사. 🔴 **첫 번째 잘못에서 멈추고 무엇이 틀렸는지 한국어로 말한다**(다른 통로와 같은 관례).
 *
 * 🔴 **길이를 넘으면 잘라서 받지 않고 거절한다.** 반출 신청의 `requestKey`·`sub` 는 **열쇠**라 양쪽이
 *    같은 자리에서 같게 자르는 것이 맞는 말이지만(`trimTextField`), 이 값은 **고객사에 나가는 서류에
 *    찍히는 이름**이다. 말없이 꼬리를 자르면 그 잘린 이름이 그대로 견적서에 올라가고, 보낸 쪽은
 *    잘린 줄 모른다. 🔵 그래서 사람 칸(`sub`·`name`)만 잘라 받고 **이름 칸은 재서 거절**한다.
 */
export function parseApiCustomerName(raw: unknown): ParseApiCustomerNameResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "본문은 JSON 객체여야 합니다." };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.customerName !== "string") {
    return { ok: false, message: `customerName 은 고객사에 나가는 서류에 쓸 이름(글자)입니다. 받은 값: ${JSON.stringify(body.customerName ?? null)}` };
  }
  // 🔵 앞뒤 공백과 줄바꿈 꼴만 다듬는다 — **자르지 않는다**(위 머리말).
  const customerName = body.customerName.replace(/\r\n/g, "\n").trim();
  if (!customerName) {
    return { ok: false, message: "customerName 이 비어 있습니다. 이 통로는 **채우기만** 합니다 — 지우는 길이 아닙니다." };
  }
  if (CUSTOMER_NAME_DASH_ONLY.test(customerName)) {
    return { ok: false, message: "customerName 이 「-」 뿐입니다. 재고 관리에서 「-」 는 **없음**을 뜻하므로 값으로 받지 않습니다." };
  }
  if (customerName.length > CUSTOMER_NAME_MAX) {
    return { ok: false, message: `customerName 은 ${CUSTOMER_NAME_MAX}자 이하여야 합니다 (받은 길이: ${customerName.length}). 잘라서 받지 않습니다 — 고객사에 나가는 이름입니다.` };
  }

  const filledBy = asObjectField(body.filledBy);
  const sub = trimTextField(filledBy.sub, MAX_SUB);
  if (!sub) {
    return { ok: false, message: "filledBy.sub 는 **채우는 사람의 포털 번호**입니다. 바깥에서 들어오는 쓰기라 누가 넣었는지를 남깁니다." };
  }
  const name = trimTextField(filledBy.name, MAX_NAME);
  if (!name) return { ok: false, message: "filledBy.name 은 채우는 사람의 이름입니다." };

  return { ok: true, value: { customerName, filledBy: { sub, name } } };
}

/** 채우지 못한 까닭 — 🔴 **둘을 다른 상태 코드·다른 말로** 가른다(머리말 5번). */
export type CustomerNameRefusal = "not_found" | "deleted";

export interface CustomerNameDenial {
  status: 404 | 410;
  error: "not_found" | "gone";
  message: string;
}

/**
 * 🔴 **없는 번호(404)와 숨긴 부품(410)은 다른 일이다.**
 *  - **없는 번호**는 보낸 쪽의 오타이거나 아직 등록되지 않은 부품이다 → 번호를 고쳐 다시 보내면 된다.
 *  - **숨긴(지운) 부품**은 번호는 맞는데 재고 관리가 치워 둔 것이다 → 번호를 바꿔 봐야 소용없고,
 *    재고 담당자에게 물어야 한다. 반출 신청 통로가 이 둘을 가르는 것과 **같은 까닭**이다
 *    (`./stock-requests.ts` 의 `resolveApiRequestLines`).
 * 🔵 숨긴 부품에 410 을 쓰는 것은 「있었는데 지금은 없다」를 상태 코드만으로 알아볼 수 있게 하려는 것이다 —
 *    받는 쪽이 본문을 안 읽고 가르는 길을 하나 남겨 둔다.
 */
export function customerNameDenial(refusal: CustomerNameRefusal, no: number): CustomerNameDenial {
  return refusal === "not_found"
    ? { status: 404, error: "not_found", message: `No. ${no} 부품이 없습니다. GET /api/v1/parts 의 no 를 보내십시오.` }
    : { status: 410, error: "gone", message: `No. ${no} 는 숨긴(지운) 부품이라 고객사 품명을 채우지 않습니다. 재고 담당자에게 확인하십시오.` };
}

/**
 * 돌려주는 모양.
 *
 * 🔴 `filled` 는 **이번 호출이 채웠나**이다 — 올리는 통로의 `created`·거두는 통로의 `cancelled` 와
 *    **같은 뜻의 칸**이다. `false` 는 오류가 아니라 **「이미 있어서 덮지 않았다」**이고, 그때
 *    `part.customerName` 에 **지금 값**이 실려 온다(규칙 1번). 받는 쪽은 그 값으로
 *    「이미 있습니다 — 「…」」라고 말하면 된다.
 * 🔵 `part.name` 을 함께 주는 까닭: 받는 쪽 화면이 「No. 165 AMP-… 의 고객사 품명」이라고 말할 수 있게.
 *    🔴 **지금 상태를 말하는 것은 언제나 `part.customerName`** 이다 — 채웠든 이미 있었든 그 칸이 참이다.
 */
export interface ApiCustomerNamePart {
  no: number;
  name: string;
  customerName: string;
}

export interface ApiCustomerNameResponse {
  filled: boolean;
  part: ApiCustomerNamePart;
}

export function toApiCustomerNameResponse(filled: boolean, part: ApiCustomerNamePart): ApiCustomerNameResponse {
  return { filled, part: { no: part.no, name: part.name, customerName: part.customerName } };
}
