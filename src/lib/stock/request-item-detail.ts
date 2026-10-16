/**
 * 부품 요청 관리 화면의 **신청 항목 칸**이 그리는 규칙 — 순수 함수
 * (2026-10-16 쓰는 분 요청: 「신청 항목의 자세한 내용이 보이고, 품명을 누르면 부품 상세를 열 수 있으면」).
 *
 * 🔴 **화면에서 떼어 둔 까닭**: 이 저장소에는 화면 렌더 시험이 없다
 *    (`tests/part-issue-screen.test.ts` 머리말). 규칙을 `RequestManagerScreen.tsx` 안에 두면
 *    「지워진 부품에 링크를 걸지 않는다」 같은 울타리를 **아무도 돌려 보지 못한다.**
 *
 * 여기서 못 박는 것 셋:
 *  1. **무엇을 보이나** — 고객사 품명 · 품명2 · 교산 품번 · 도번(`REQUEST_ITEM_DETAIL_FIELDS`).
 *     소유·수량은 전부터 있던 자리라 그대로 두고, 이 넷이 더해진다.
 *  2. **빈 칸은 안 그린다** — 아래 `requestItemDetails`.
 *  3. 🔴 **지워진 부품에는 링크가 없다** — 아래 `partDetailHref`.
 */

/** 신청 항목 한 줄이 들고 있는 **부품 쪽 값**. 🔵 화면 줄(`ManagerRequestLine`)이 이 모양을 그대로 만족한다. */
export interface RequestItemPart {
  /** 🔴 부품을 못 찾으면 `null`(지워진 부품). 그 줄은 품명도 「(지워진 부품)」이다 */
  partNo: number | null;
  customerName: string;
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
}

export interface RequestItemDetail {
  label: string;
  value: string;
}

/**
 * 🔴 **차례가 뜻을 가진다.** 맨 앞이 **고객사 품명**인 까닭: 이 화면에서 담당자가 가장 자주 맞춰 봐야 하는
 * 것이 「고객사가 부르는 이름」이고(견적서·서류에 나가는 값), 2026-10-16 에 A/S 가 **바깥에서 채우는**
 * 칸이 된 것도 이 칸이다. 나머지 셋은 같은 품명이 여럿일 때 **어느 부품인지 가르는** 값이라 뒤에 선다.
 *
 * 🔵 품명 자체는 여기 없다 — 줄의 머리(`No. 165 AMP-…`)가 이미 그 값이다.
 */
export const REQUEST_ITEM_DETAIL_FIELDS = [
  { key: "customerName", label: "고객사 품명" },
  { key: "name2", label: "품명2" },
  { key: "kyosanPartNo", label: "교산 품번" },
  { key: "drawingNo", label: "도번" },
] as const satisfies ReadonlyArray<{ key: keyof Omit<RequestItemPart, "partNo">; label: string }>;

/**
 * 그 부품의 **자세한 내용** — 값이 있는 칸만, 위 차례대로.
 *
 * 🔴 **빈 칸은 그리지 않는다.** 네 칸을 언제나 다 적으면(없으면 `-`) 줄마다 네 토막이 서고, 한 신청에
 *    부품이 여럿이면 그 칸이 화면의 절반을 먹는다. 실제로 **비어 있는 것이 보통**인 칸들이라
 *    (품명2·교산 품번·도번은 엑셀에서도 `-` 로 적혀 들어왔다) 「없음」을 줄줄이 적으면 **정작 있는 값이
 *    묻힌다.** 보려는 것은 「이 부품이 무엇인가」이지 「무엇이 비었나」가 아니다.
 * 🔵 앞뒤 공백만 있는 값도 없는 것으로 본다 — 저장은 빈 글자가 관례지만(`parts` 표 주석) 화면이
 *    그 관례에 기대지 않는다.
 * 🔴 **지워진 부품(`partNo === null`)이라고 여기서 막지 않는다.** 그 줄은 부품을 못 찾아 네 칸이 전부
 *    비어 있고, 그래서 **저절로** 빈 목록이 된다 — 막는 자리를 두 벌 두지 않는다.
 */
export function requestItemDetails(part: RequestItemPart): RequestItemDetail[] {
  const out: RequestItemDetail[] = [];
  for (const f of REQUEST_ITEM_DETAIL_FIELDS) {
    const value = (part[f.key] ?? "").trim();
    if (value) out.push({ label: f.label, value });
  }
  return out;
}

/**
 * 품명을 눌렀을 때 갈 곳 — **이미 있는 길**이다.
 *
 * 🔵 부품 상세는 전용 주소가 아니라 **재고 현황(`/`)의 `?part=No.` 창**이다(`PartDetailDialog`).
 *    변경 이력·기록 내역·O/H 템플릿 화면이 전부 이 길로 간다 — 새 화면을 만들지 않는다.
 * 🔴 **지워진 부품에는 링크가 없다**(`null`). 번호가 없으니 열 창이 없고, 눌러도 아무 부품도 안 뜨는
 *    링크를 그리면 「눌렀는데 안 열린다」가 된다. 🔵 숫자가 없는 것을 **빠진 값으로 읽고 넘어가지
 *    않도록** 여기서 사실로 적어 둔다(API 의 `linked: false` 와 같은 결).
 */
export function partDetailHref(partNo: number | null): string | null {
  return partNo === null ? null : `/?part=${partNo}`;
}
