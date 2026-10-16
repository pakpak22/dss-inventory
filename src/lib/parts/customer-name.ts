/**
 * 고객사 품명을 **바깥에서 채울 때** 남길 이력 — 순수 함수
 * (2026-10-16, `POST /api/v1/parts/{no}/customer-name`. 설명은 API.md 7절).
 *
 * 🔴 **DB 를 건드리는 함수(`./mutations.ts` 의 `fillCustomerName`)에서 떼어 둔 까닭**: 저 파일은
 *    `server-only` 라 `npm test` 가 **불러올 수조차 없다.** 「누가 채웠는지 남는가」는 이 조각에서
 *    **반드시 지켜야 하는 것**인데(바깥에서 들어오는 쓰기라 「이 이름 누가 넣었지?」가 반드시 나온다),
 *    거기 두면 아무도 돌려 보지 못한다. 그래서 **남길 내용을 빚는 일만** 여기로 내렸다.
 */

/**
 * 고객사 품명을 **바깥에서** 채운 사람.
 *
 * 🔴 **`id` 가 `null` 일 수 있다** — A/S 에서 채운 사람이 재고 관리의 `users` 에 **없을 수 있다.**
 *    반출 신청 통로가 「못 찾아도 받는다」로 정한 것과 같은 자리다(`lib/stock/requests.ts` 의 `Requester`).
 *    그때 남는 것은 **이름과 포털 번호**뿐이고, 그래서 번호를 따로 받아 둔다.
 */
export interface CustomerNameFiller {
  /** 우리 `users` 에서 찾았으면 그 id, 못 찾았으면 null */
  id: string | null;
  /** 이력의 「누가」 칸에 보일 이름 — 찾았으면 **우리 쪽 이름**(같은 사람이 화면마다 다른 이름으로 보이지 않게) */
  name: string;
  /** 🔴 **포털 번호.** 못 찾은 사람을 되짚을 유일한 열쇠다 */
  sub: string;
  /** 바깥이 보내온 이름 그대로. 우리 쪽 이름과 다를 수 있어 둘 다 남긴다 */
  sentName: string;
}

/**
 * 감사 로그 `PART_UPDATE` 의 `detail`.
 *
 * 🔵 **사람이 화면에서 고칠 때와 같은 모양**(`changes.<칸>.{before,after}`)을 쓴다 — `/audit` 의
 *    `linesOf` 가 그대로 풀어 「고객사 품명 · 변경 전 · 변경 후」로 그린다. 모양을 새로 만들면 그 화면에
 *    JSON 이 날것으로 뜬다(2026-10-12 에 실제로 겪은 일).
 * 🔴 `before` 는 **언제나 빈 글자**다 — 비어 있을 때만 채우기 때문이다. 값이 있는 칸을 이 길로 고치는
 *    일은 없고, 그래서 이력에 「무엇을 덮었다」가 남을 수도 없다.
 * 🔴 **`filledBy` 가 이 조각의 핵심이다.** 포털 번호와 **보내온 이름**을 그대로 적는다 — 이름은 겹치므로
 *    나중에 사람을 가릴 수 있는 것은 번호뿐이다. 우리 쪽에서 찾은 이름은 `matchedUser` 에 따로 적어,
 *    「보낸 이름」과 「우리가 아는 이름」이 다를 때 둘 다 남게 한다(못 찾았으면 `null`).
 * 🔵 `via` 는 **통로로 들어온 쓰기**임을 적는다. 화면에서 고친 기록(`updateCustomerName`)에는 이 칸이
 *    없어서, 둘을 이력에서 가르는 자리가 된다.
 */
export function customerNameFillAudit(customerName: string, filler: CustomerNameFiller): Record<string, unknown> {
  return {
    changes: { customerName: { before: "", after: customerName } },
    filledBy: { sub: filler.sub, name: filler.sentName },
    matchedUser: filler.id ? filler.name : null,
    via: "API",
  };
}
