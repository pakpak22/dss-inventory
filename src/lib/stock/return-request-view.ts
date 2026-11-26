import type { EntryType } from "./codes";
import type { EntryInput } from "./form";

/**
 * ============================================================================
 * 반환 신청을 **사람이 읽을 수 있는 모양**으로 펴는 순수 규칙 (2026-11-26)
 * ============================================================================
 * A/S 가 올리는 반환 신청이 2026-11-26 에 서기 시작했는데(`POST /api/v1/stock-requests` 의
 * `type: "RETURN"`), 부품 요청 관리 화면에서 그 신청은 **「반환 · 2026-11-26」 한 줄**이었다 —
 * 부품 줄도 인수번호도 안 보였다.
 *
 * ── 🔴 **왜 안 보였나** ─────────────────────────────────────────────────
 * 반환 줄은 **부품이 아니라 원장 줄을 가리킨다**(`./form.ts` 의 `ReturnLine` =
 * `{ transactionId, quantity, note }`). 그래서 payload 만 들고는 「어느 부품의 몇 개인지」를
 * 알 수 없고, `./requests.ts` 의 `linesOf` 가 반환을 **빈 배열**로 돌려주고 있었다.
 * 🔵 그 빈 배열은 틀린 것이 아니라 **재료가 없다**는 뜻이었다 — 되짚으려면 원장을 읽어야 한다.
 *
 * 🔴 **담당자가 무엇을 돌려받는지 화면에서 못 보면 「한 번 더 내용을 확인하고」가 성립하지
 *    않는다**(쓰는 분 지시). 그래서 원장 줄을 되짚어(`ReturnLineOrigin`) 부품과 인수번호를
 *    붙인다. 되짚는 질의는 `./requests.ts` 가 하고, **무엇을 어떻게 묶어 보일지는 여기**다 —
 *    이 저장소에는 화면 렌더 시험이 없어서(`tests/part-issue-screen.test.ts` 머리말) 화면 안에
 *    적은 규칙은 아무도 돌려 보지 못한 채 운영으로 나간다.
 *
 * 🔴 **사용(반출) 쪽은 한 글자도 건드리지 않는다.** 이 파일이 다루는 것은 `RETURN` 하나이고,
 *    다른 종류가 들어오면 **빈 목록**을 돌려준다(아래 각 함수).
 * ============================================================================
 */

/**
 * 「이 신청은 **돌려받는** 것인가」 — 🔴 **판정이 적힌 자리를 하나로 묶는다**.
 *
 * 화면에서 반환이 사용과 갈리는 자리가 다섯이다: 단추 이름 · 확인 상자의 제목과 안내 · 수량을
 * 고칠 수 있나 · 신청 항목 표의 머리글 · 「무엇에」 칸. 자리마다 `type === "RETURN"` 을 손으로
 * 적으면, 똑같이 다뤄야 하는 종류가 하나 더 생기는 날 **그중 한 자리만 안 고쳐진다** — 그 빠짐은
 * 오류가 아니라 「그 자리에서만 옛 글자」라 아무도 신고하지 않는다.
 *
 * 🔵 **결재 면제(`isApprovalExemptRequestType`)와 일부러 따로 둔다.** 저쪽은 「절차를 타는가」이고
 *    이쪽은 「화면에서 어떻게 보이는가」다 — 지금은 답이 같지만 **다른 물음**이라, 한 함수로 묶으면
 *    결재를 면제하는 종류가 하나 늘었을 때 그 종류의 화면 글자가 전부 「반환」으로 바뀐다.
 */
export function isReturnRequest(type: EntryType): boolean {
  return type === "RETURN";
}

/**
 * 되짚은 **원장 줄 하나** — 「그 줄은 어느 부품이고, 어느 수리 건에서 나갔나」.
 *
 * 🔵 읽어 오는 자리는 `./requests.ts` 의 `returnLineOriginsOf` 하나다. 여기는 **받아 쓰기만** 한다 —
 *    그래야 아래 규칙들을 DB 없이 시험이 전부 덮는다.
 * 🔴 **인수번호는 빈 글자일 수 있다** — 「수리 건 없음」으로 나간 반출 줄을 되돌리는 경우다.
 *    그때는 지어내지 않고 **안 그린다**(아래 `returnSourceText`).
 */
export interface ReturnLineOrigin {
  partId: string;
  intakeNumber: string;
}

/** 화면에 설 **부품 한 줄**. 🔵 `./requests.ts` 의 `RequestLineView` 로 그대로 흘러 들어간다. */
export interface ReturnRequestPartLine {
  /**
   * 모으는 열쇠 = 되짚은 **부품 id**.
   *
   * 🔴 **되짚지 못했으면 원장 줄 번호를 그대로 쓴다.** 그 줄을 빼 버리면 **수량이 조용히
   *    사라지는데**, 담당자가 [반환 완료]를 누르면 원장에는 그 줄까지 들어간다 — 화면에서 본 것과
   *    실제로 일어나는 일이 갈린다. 「(지워진 부품) ×2」로라도 서는 편이 낫다.
   * 🔵 **실제로는 일어나지 않는다**: 원장은 append-only 이고(`src/db/schema/stock.ts`), 반환 신청의
   *    줄은 그 표에서 골라 적은 번호다(`lib/api/return-allocation.ts`). 그래도 갈래를 두는 까닭은
   *    「일어날 리 없다」가 틀린 날 **수량이 틀리는 쪽으로** 틀어지기 때문이다.
   */
  partId: string;
  /** 돌려받기로 한 수량. 🔵 같은 부품이 여러 원장 줄로 쪼개져 있으면 **합쳐진 값**이다(아래 머리말). */
  quantity: number;
  /**
   * 그 부품이 **어느 수리 건에서** 나갔나 — 되짚은 줄들의 인수번호(중복 없이, 처음 본 차례).
   * 🔵 거의 언제나 **한 개**다(A/S 는 수리 건 하나로 반환 신청을 세운다). 빈 배열일 수 있다(위 주석).
   */
  intakeNumbers: string[];
}

/**
 * 반환 payload 의 줄들을 **부품별로 합쳐** 화면 줄로 편다.
 *
 * ── 🔴 **왜 부품별로 합치나** ───────────────────────────────────────────
 * A/S 는 부품과 수량만 보내고, 「어느 불출 줄에 되돌려 붙일지」는 재고 관리가 쪼갠다
 * (`lib/api/return-allocation.ts` — 먼저 나간 줄부터 채운다). 그래서 **한 부품이 원장 줄 둘로
 * 쪼개져** 신청에 담기는 일이 흔하다. 쪼개진 그대로 그리면 담당자는 「No. 7 ×3」과 「No. 7 ×2」를
 * 보고 **다른 부품인가** 하게 되고, 저쪽이 보낸 「No. 7 을 5개」와도 모양이 갈린다.
 * 🔴 열쇠가 겹치면 화면이 **깨진다**: 화면은 `partId` 를 React 의 key 로 쓴다.
 *
 * 🔵 **차례는 payload 에 적힌 차례**다. DB 가 주는 차례나 부품 번호로 다시 세우지 않는다 —
 *    A/S 가 보낸 차례가 곧 사람이 그 화면에서 적은 차례다.
 * 🔴 **반환이 아닌 종류는 빈 목록**이다. 이 함수에 사용·대여·폐기를 넘겨도 아무 일이 없다 —
 *    가르는 자리를 여기 한 줄로 두어, 부르는 쪽이 종류를 또 가리지 않게 한다.
 */
export function returnRequestPartLines(input: EntryInput, origins: ReadonlyMap<string, ReturnLineOrigin>): ReturnRequestPartLine[] {
  if (input.type !== "RETURN") return [];
  const out: ReturnRequestPartLine[] = [];
  const byPart = new Map<string, ReturnRequestPartLine>();
  for (const line of input.lines) {
    const origin = origins.get(line.transactionId);
    // 🔴 못 되짚으면 원장 줄 번호가 열쇠다(위 `partId` 주석) — 줄을 버리지 않는다.
    const key = origin?.partId ?? line.transactionId;
    let row = byPart.get(key);
    if (!row) {
      row = { partId: key, quantity: 0, intakeNumbers: [] };
      byPart.set(key, row);
      out.push(row);
    }
    row.quantity += line.quantity;
    const intake = origin?.intakeNumber ?? "";
    // 🔵 빈 인수번호는 담지 않는다 — 「수리 건 없음」으로 나간 줄이고, 빈 글자를 담으면 화면이 빈 자리를 만든다.
    if (intake !== "" && !row.intakeNumbers.includes(intake)) row.intakeNumbers.push(intake);
  }
  return out;
}

/**
 * 그 신청 **전체**의 인수번호 — 목록의 「무엇에」 칸에 적는다.
 *
 * 🔴 **갈래가 하나일 때만 말한다.** 줄마다 다른 수리 건이 섞여 있으면 빈 글자를 돌려주고, 그때
 *    「어느 건에서 나온 것인가」는 **줄마다** 보인다(아래 `returnSourceText`). 하나를 골라
 *    적으면 나머지 건이 없는 것처럼 보이고, 그것은 **거짓말이면서 조용하다.**
 * 🔵 A/S 가 올리는 반환은 수리 건 하나로 세우므로(`lib/api/stock-requests.ts` 의
 *    `ApiReturnRequestInput`) 실제로는 언제나 하나다. 섞이는 길은 지금 없지만 그 전제를 코드에
 *    박지 않는다.
 */
export function returnRequestIntakeNumber(lines: readonly ReturnRequestPartLine[]): string {
  const seen = new Set<string>();
  for (const line of lines) for (const n of line.intakeNumbers) seen.add(n);
  return seen.size === 1 ? [...seen][0] : "";
}

/**
 * 반환 신청에서 **이미 원장에 들어온 수량**.
 *
 * ── 🔴 **부호가 뒤집혀 있다** ───────────────────────────────────────────
 * 회차에 달린 원장 줄을 세는 질의는 `sum(-delta)` 다(`./requests.ts` 의 `issuedQuantitiesOf`) —
 * **반출**이 음수라 부호를 뒤집어 「나간 수량」을 얻는 식이다. 반환은 `delta` 가 **양수**이므로
 * 같은 식이 **음수**를 준다. 그대로 화면에 흘리면 「불출 −2개 · 남음 4개」 같은 줄이 선다.
 * 🔴 **세는 질의를 고치지 않는다** — 그 식은 반출 쪽이 쓰는 그대로여야 하고, 고치면 「요청 8 중
 *    5 나감」을 그리는 모든 자리가 함께 흔들린다. 뒤집는 일은 **보여 주기 직전** 여기서 한다.
 * 🔵 0 아래로는 안 내려간다 — 기록 취소 따위로 어긋나도 화면이 음수를 그리지 않게.
 */
export function returnedQuantityOf(issuedRaw: number): number {
  return Math.max(0, -issuedRaw);
}

/* ------------------------------------------------------------------ */
/* 화면에 적는 글자 — 적힌 자리를 한 곳으로 묶는다                        */
/* ------------------------------------------------------------------ */

/**
 * 줄 아래에 붙는 「어느 수리 건에서」의 이름표.
 * 🔵 낱말은 이 저장소가 이미 쓰는 것이다 — 「수리 건 (신청 당시)」(`./repair-case.ts` 의
 *    `REPAIR_CASE_TITLE`)와 같은 말을 쓴다. 같은 것을 화면마다 다르게 부르지 않는다.
 */
export const RETURN_SOURCE_LABEL = "수리 건";

/**
 * 그 줄의 인수번호를 한 글자로. 🔴 **없으면 빈 글자**이고, 그때 화면은 **아무것도 안 그린다** —
 * 이 저장소의 「빈 칸은 안 그린다」 규칙 그대로다(`./request-item-detail.ts` 의 `requestItemDetails`).
 */
export function returnSourceText(intakeNumbers: readonly string[]): string {
  return intakeNumbers.join(", ");
}

/**
 * 목록에서 누르는 단추 — 🔴 **「확인」이 아니라 「반환」**이다 (2026-11-26 쓰는 분 지시:
 * 「[반환] 버튼을 누르고 … 한 번 더 내용을 확인하고 [반환 완료] 버튼을 눌러서」).
 *
 * 🔵 **「불출 신청」과 섞이지 않는다**: 반환은 결재를 아예 타지 않으므로
 *    (`lib/approval/route.ts` 의 `isApprovalExemptRequestType`) 그 자리의 두 이름
 *    (`partIssueConfirmLabel`)이 반환에는 둘 다 거짓말이다.
 */
export const RETURN_CONFIRM_BUTTON_LABEL = "반환";

/** 누르고 기다리는 동안. 🔵 「내주는 중」의 짝 — 반환은 들어오는 쪽이라 말이 반대다. */
export const RETURN_CONFIRM_BUSY_LABEL = "반환 중";

/** 확인 상자의 제목. 🔴 **무엇을 하라는 말이 아니라 무엇을 보라는 말**이다 — 이 상자의 일이 「한 번 더 확인」이다. */
export const RETURN_CONFIRM_TITLE = "돌려받을 내용을 확인하십시오";

/**
 * 확인 상자에 적는 한 줄.
 *
 * 🔴 **수량을 고칠 수 없다는 것을 말한다.** 바로 옆의 [확인] 상자는 줄마다 수량을 적게 하므로
 *    (분할 불출), 같은 자리에서 열린 상자에 입력 칸이 없으면 사람은 **고장으로 읽는다.**
 *    쓰는 분은 반환을 나눠 받는다는 말을 한 적이 없다 — 신청한 그대로 받는다.
 * 🔴 **결재를 타지 않는다는 것도 말한다**(쓰는 분: 「반환에는 승인 절차가 필요 없어」). 부품 불출
 *    쪽에 결재선이 서 있으면 담당자는 반환도 결재에 올라가는 줄 알고 기다린다.
 */
export const RETURN_CONFIRM_NOTICE = "신청한 수량을 그대로 받습니다 — 수량은 여기서 고칠 수 없습니다. 반환은 승인 절차를 거치지 않고, 누르는 즉시 재고에 더해집니다.";

/** 끝내는 단추. 🔴 쓰는 분이 글자까지 정했다 — 「확인」도 「반환 처리」도 아니다. */
export const RETURN_CONFIRM_SUBMIT_LABEL = "반환 완료";

/**
 * 신청 항목 표에서 **「불출」 자리에 서는 머리글** (2026-11-26).
 *
 * 🔴 **「불출」은 반환에 거짓말이다** — 그 칸이 세는 것은 「이 신청으로 원장에 들어온 수량」이고,
 *    반환에서는 부품이 **나간 것이 아니라 들어온 것**이다.
 * 🔵 「요청」·「남음」은 반환에서도 그대로 참말이라 바꾸지 않는다.
 */
export const RETURN_ITEMS_DONE_HEADER = "반환";
