"use client";

import { RETURN_SOURCE_LABEL, returnSourceText } from "@/lib/stock/return-request-view";

/**
 * 반환 신청의 부품 줄 **아래**에 붙는 「어느 수리 건에서 나간 것을 돌려주나」 한 줄 (2026-11-26).
 *
 * 🔴 **반환에만 선다.** 사용·대여·폐기 줄에는 이 값이 처음부터 없어 빈 배열이고, 그때
 *    **아무것도 안 그린다** — 이 저장소의 「빈 칸은 안 그린다」 규칙 그대로다
 *    (`lib/stock/request-item-detail.ts` 의 `requestItemDetails`).
 * 🔴 **두 자리가 같은 조각을 부른다** — 부품 요청 관리 목록의 신청 항목 표와 [반환] 확인 상자다.
 *    베껴 두면 「빈 값은 안 그린다」가 두 벌이 되고, 이 저장소에는 화면 렌더 시험이 없어 한쪽만
 *    틀어져도 아무도 못 본다(`RequestItemDetails` 머리말과 같은 까닭·같은 처방).
 * 🔵 **모양은 `RequestItemDetails` 의 「나머지 글자」 줄과 맞춘다** — 같은 줄 아래 나란히 서는
 *    작은 글씨라, 크기·색이 다르면 한쪽이 더 중요한 값처럼 보인다.
 * 🔵 `span`(display:block)인 까닭도 같다: 부르는 두 자리가 `td`·`span` 안이다.
 */
export function ReturnSourceLine({ intakeNumbers }: { intakeNumbers: readonly string[] }) {
  const text = returnSourceText(intakeNumbers);
  if (text === "") return null;
  return (
    <span className="mt-0.5 block text-[11px] leading-snug text-zinc-600">
      <span className="text-zinc-400">{RETURN_SOURCE_LABEL} </span>
      {text}
    </span>
  );
}
