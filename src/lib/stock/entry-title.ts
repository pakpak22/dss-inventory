import { ENTRY_TYPE_LABEL, type EntryType } from "./codes";
import { soleIntakeNumber } from "./return-request-view";

/**
 * ============================================================================
 * 기록 내역(원장)의 **건 머리글** — 굵은 검은 글씨 한 자리 (2026-10-06 / 2026-11-26)
 * ============================================================================
 * 한 건의 맨 윗줄은 [기록 번호] · **머리글** · 종류 딱지 · 날짜 · 신청자/확인자 차례로 선다.
 * 이 함수가 내주는 것은 그중 **굵은 검은 글씨 하나**다.
 *
 * ── 🔵 **왜 화면 파일에서 내려왔나** ──────────────────────────────────
 * 2026-11-26 까지 이 규칙은 `src/app/(app)/entries/page.tsx` 안에 있었다. 그 파일은 `await` 하는
 * 서버 컴포넌트라 `npm test` 가 불러올 수 없어서, 머리글에 **무엇이 뜨는가**를 값으로 잰 시험이
 * 한 줄도 없었다 — 이 저장소에는 화면 렌더 시험이 없다(`tests/entry-detail-cards.test.ts` 머리말).
 * 🔴 그래서 **글자 규칙만** 순수 함수로 내렸다. 꼴(굵기·색)과 배치는 화면에 그대로 남아 있다.
 *
 * ── 🔴 **반환 건의 머리글은 2026-11-26 에 바뀌었다** ──────────────────
 * 그 전에는 아래 `default` 로 떨어져 **종류 이름 「반환」**이 섰다. 바로 옆에 같은 말을 적은 종류
 * 딱지가 서 있어서 **한 줄에 「반환」이 두 번** 뜨고, 정작 「어느 수리 건을 돌려받는 것인가」는
 * 어디에도 없었다(2026-11-26 쓰는 분 지적: 「검은 글씨로 [반환]이라고 적힌 부분을 수리건
 * 인수번호로」).
 *
 * 🔴 **반환 건 자신은 인수번호를 들고 있지 않다.** 원장의 반환 갈래(`./ledger.ts` 의 `case
 *    "RETURN"`)는 `intake_number` 칸을 아예 안 쓴다 — 2026-11-26 개발 DB 실측으로도 반환 건 1건의
 *    그 칸이 빈 글자였다. 그래서 값은 **되돌린 원장 줄을 되짚어**(`stock_transactions
 *    .returns_transaction_id` → 그 줄이 달린 불출 건) 온다. 읽는 자리는 `./queries.ts` 의
 *    `returnIntakeNumbersFor` 하나이고, 여기는 **받아 쓰기만** 한다.
 * 🔴 **못 찾았으면 빈 글자다 — 「반환」으로 되돌아가지 않는다.** 옆 딱지가 이미 종류를 말하고 있고,
 *    돌아가면 고치기 전 모습 그대로다. 화면은 빈 머리글을 **아예 안 그린다**(page.tsx).
 * 🔵 **빈 글자가 되는 길이 둘 다 실제로 있다**: ① 대여나 「수리 건 없음」 반출을 되돌린 반환
 *    (되짚어도 인수번호가 없다) ② 한 부품의 여러 불출 줄을 한 번에 고른 반환으로 **수리 건이
 *    섞인 것**(`/entries/new?type=RETURN` 의 고르개는 그 부품의 불출 줄을 전부 늘어놓는다).
 *    ②에서 하나를 골라 적지 않는 규칙은 부품 요청 관리 화면과 **같은 한 벌**이다
 *    (`./return-request-view.ts` 의 `soleIntakeNumber`).
 * 🔴 **다른 종류는 한 글자도 안 바뀌었다.** 되짚은 인수번호가 실려 있어도 보는 것은 반환뿐이다 —
 *    입고·폐기·조정·소유 옮김에 인수번호가 뜨면 거짓말이다.
 * ============================================================================
 */
export interface EntryTitleSource {
  type: EntryType;
  /** 그 건이 **스스로** 들고 있는 인수번호. 🔵 사용(반출)에서만 찬다 — 반환은 언제나 빈 글자다(위 머리말). */
  intakeNumber: string;
  noRepairCase: boolean;
  reason: string;
  counterparty: string;
  /**
   * **반환 건이 되돌린 원장 줄들**의 인수번호(중복 없이, 되돌린 차례). 반환이 아니면 빈 배열이다.
   * 🔵 빈 글자는 애초에 담기지 않는다(`./queries.ts`) — 「수리 건 없음」으로 나간 줄을 되돌린 경우다.
   */
  returnIntakeNumbers: readonly string[];
}

/**
 * 건 머리글의 글자. 수리 건이면 **인수번호**, 수리 건이 없는 사용이면 「기타 사용」, 반환이면 되짚은
 * **인수번호**, 나머지는 종류와 상대·사유.
 *
 * 🔵 아래 표는 엑셀 사용처 기입란·입고 기입란·수량 변경 기록의 칸을 그대로 보인다 — 머리글은 그 표가
 *    **무엇에 대한 것인지**를 한 줄로 말하는 자리다.
 */
export function entryTitle(e: EntryTitleSource): string {
  switch (e.type) {
    case "USE":
      return e.noRepairCase ? `기타 사용${e.reason ? ` — ${e.reason}` : ""}` : e.intakeNumber;
    case "RETURN":
      // 🔴 갈래가 하나일 때만 말한다. 섞였거나 못 찾았으면 빈 글자이고, 화면은 그 자리를 안 그린다(위 머리말).
      return soleIntakeNumber(e.returnIntakeNumbers);
    case "LOAN":
      return `대여${e.counterparty ? ` — ${e.counterparty}` : ""}`;
    case "DISPOSE":
      return `폐기·불량${e.reason ? ` — ${e.reason}` : ""}`;
    case "ADJUST":
      return `조정${e.reason ? ` — ${e.reason}` : ""}`;
    case "CORRECTION":
      return `기록 취소${e.reason ? ` — ${e.reason}` : ""}`;
    default:
      return ENTRY_TYPE_LABEL[e.type];
  }
}
