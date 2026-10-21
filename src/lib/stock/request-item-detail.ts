/**
 * 부품 요청 관리 화면의 **신청 항목 칸**이 그리는 규칙 — 순수 함수
 * (2026-10-16 쓰는 분 요청: 「신청 항목의 자세한 내용이 보이고, 품명을 누르면 부품 상세를 열 수 있으면」).
 *
 * 🔴 **화면에서 떼어 둔 까닭**: 이 저장소에는 화면 렌더 시험이 없다
 *    (`tests/part-issue-screen.test.ts` 머리말). 규칙을 `RequestManagerScreen.tsx` 안에 두면
 *    「지워진 부품에 링크를 걸지 않는다」 같은 울타리를 **아무도 돌려 보지 못한다.**
 *
 * 여기서 못 박는 것 여섯:
 *  1. **무엇을 보이나** — 고객사 품명 · 품명2 · 교산 품번 · 도번(`REQUEST_ITEM_DETAIL_FIELDS`).
 *     수량은 전부터 있던 자리라 그대로 두고, 이 넷이 더해진다.
 *     🔴 **차례는 `src/lib/parts/field-order.ts` 가 쥔다** — 여기서 다시 적지 않는다(2026-10-16).
 *  2. **빈 칸은 안 그린다** — 아래 `requestItemDetails`.
 *  3. 🔴 **지워진 부품에는 링크가 없다** — 아래 `partDetailHref`.
 *  4. 🔴 **넷 중 고객사 품명이 앞선다** — 아래 `requestItemDetailGroups`(2026-10-21 쓰는 분 요청).
 *  5. 🔵 **소유구분 딱지** — 아래 `requestItemOwnerTag`(2026-10-21 쓰는 분 요청).
 *  6. 🔵 **유상/무상 딱지** — 아래 `requestItemChargeTag`(같은 날, 같은 요청).
 *
 * ── 🔴 **5와 6은 성격이 다르다. 한 묶음으로 뭉뚱그리지 않는다** (2026-10-21) ──
 * **소유구분은 부품을 따라간다** — `parts.owner` 에 적힌 부품의 속성이라 **어느 신청에서 보든 같다.**
 * **유상/무상은 그 줄의 값이다** — 신청 payload 의 줄마다 붙고(`lib/stock/form.ts` 의 `UseLine`),
 * **같은 부품이라도 신청마다·줄마다 다를 수 있다.** 그래서 아래 두 함수는 **받는 타입이 갈려 있다**
 * (`RequestItemPart` ↔ `RequestItemLine`): 부품만 들고 유상/무상을 물을 수 없고, 줄 값만 들고
 * 소유를 물을 수도 없다. 🔴 한 묶음에 섞으면 「이 **부품**은 유상인가요?」라는 **틀린 물음**이 생기고,
 * 그 물음에는 답이 없다 — 틀리면 비용이 잘못 간다.
 *
 * 🔵 **쓰는 화면이 셋으로 늘었다**(2026-10-21): 부품 요청 관리 · 불출 신청 팝업 · 승인 요청건.
 *    그리는 모양은 `src/components/stock/RequestItemDetails.tsx` 하나이고, 여기는 **무엇을 어떤
 *    차례로 보일지**만 쥔다.
 */

import { OWNER_LABEL, type Owner } from "@/lib/parts/codes";
import { PART_FIELDS_WITHOUT_NAME } from "@/lib/parts/field-order";
import { CHARGE_LABEL, type ChargeType } from "@/lib/stock/codes";

/**
 * **글자로 늘어놓는 부품 칸 넷.** 🔴 `RequestItemPart` 에서 **따로 떼어 둔 까닭**: 아래
 * `RequestItemDetail["key"]` 가 이 넷과 **딱 맞물려야** 한다. 한 몸으로 두면 부품 쪽에 칸을 하나
 * 더할 때마다(2026-10-21 의 `owner` 가 그랬다) 「작은 글씨로 늘어놓을 칸」의 키 묶음이 **아무 말 없이
 * 넓어진다** — 넓어져도 tsc 는 조용하고, 시험만 그때그때 통과한다.
 */
export interface RequestItemPartText {
  customerName: string;
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
}

/** 신청 항목 한 줄이 들고 있는 **부품 쪽 값**. 🔵 화면 줄(`ManagerRequestLine`)이 이 모양을 그대로 만족한다. */
export interface RequestItemPart extends RequestItemPartText {
  /** 🔴 부품을 못 찾으면 `null`(지워진 부품). 그 줄은 품명도 「(지워진 부품)」이다 */
  partNo: number | null;
  /**
   * 소유구분 — 🔵 **부품의 속성이다**(`parts.owner`, NOT NULL). 어느 신청에서 보든 같은 값이라
   * 여기 **부품 쪽 묶음**에 산다(머리말). 글자는 `OWNER_LABEL` 이 푼다 — 저장은 영문 코드다.
   *
   * 🔴 **부품을 못 찾으면 `null`** 이고, 그때 딱지를 **아예 안 그린다**. 「DSS」 같은 기본값을 넣으면
   *    화면이 거짓말을 한다(`RequestLineView.owner` 의 같은 주석) — 2026-10-21 전까지 부품 요청 관리
   *    화면은 그 자리에 `-` 를 적고 있었는데, 그것이 이 조각의 「빈 칸은 안 그린다」와 어긋났다.
   */
  owner: Owner | null;
}

/**
 * 신청 항목 한 줄이 들고 있는 **줄 쪽 값**. 🔴 **부품의 속성이 아니다**(머리말).
 *
 * 🔵 지금은 칸이 하나지만 묶음을 따로 둔다 — 「부품의 것 ↔ 줄의 것」이라는 가름이 **타입으로** 서 있어야
 *    다음 사람이 유상/무상을 `RequestItemPart` 에 밀어 넣지 않는다.
 */
export interface RequestItemLine {
  /**
   * 유상/무상 — 🔴 **그 줄의 값이다.** 같은 부품이라도 신청마다, 한 신청 안에서도 줄마다 다를 수 있다
   * (`src/db/schema/stock.ts` 의 그 칸 주석).
   *
   * 🔴 **`null` 이 정상인 자리가 있다** — 이 값은 **사용(반출)에서만** 있다(`lib/stock/form.ts`:
   *    `UseLine` 에만 있고 대여·폐기가 쓰는 `SimpleLine` 에는 없다). 대여·폐기 신청에는 처음부터
   *    없는 값이라 딱지도 안 선다. 🔵 사용 신청에서는 **언제나 있다**: 화면 폼도 바깥 통로도 줄마다
   *    받기를 강제한다(「기본값이 없으니 줄마다 보내십시오」 — `lib/api/stock-requests.ts`).
   */
  chargeType: ChargeType | null;
}

/**
 * 화면 조각이 받는 **신청 항목 한 줄** — 부품 쪽 값과 줄 쪽 값을 **둘 다** 들고 있다.
 *
 * 🔵 둘을 **여기서만** 합친다. 합친 자리가 하나라서, 섞인 채로 다루는 코드는 화면 조각 한 곳뿐이고
 *    규칙을 재는 함수들은 끝까지 제 쪽 타입만 본다(머리말).
 */
export type RequestItemView = RequestItemPart & RequestItemLine;

export interface RequestItemDetail {
  /**
   * 어느 칸인가 — `parts` 표의 칸 이름 그대로.
   * 🔵 **라벨이 아니라 이 키로 고른다**(2026-10-21): 아래 `requestItemDetailGroups` 가 앞세울 칸을
   *    가릴 때 글자를 견주면 라벨을 다듬는 날 조용히 안 걸린다.
   */
  key: keyof RequestItemPartText;
  label: string;
  value: string;
}

/**
 * 🔴 **차례가 뜻을 가진다.** 맨 앞이 **고객사 품명**인 까닭: 이 화면에서 담당자가 가장 자주 맞춰 봐야 하는
 * 것이 「고객사가 부르는 이름」이고(견적서·서류에 나가는 값), 2026-10-16 에 A/S 가 **바깥에서 채우는**
 * 칸이 된 것도 이 칸이다. 나머지 셋은 같은 품명이 여럿일 때 **어느 부품인지 가르는** 값이라 뒤에 선다.
 *
 * 🔴 **차례를 여기 적지 않는다**(2026-10-16): `src/lib/parts/field-order.ts` 의 `PART_FIELDS` 한 표가
 * 쥐고, 재고 현황 목록·인쇄·기록 내역도 **같은 표를 돌면서** 그린다. 두 곳에 적으면 언젠가 갈린다.
 *
 * 🔵 품명 자체는 여기 없다 — 줄의 머리(`No. 165 AMP-…`)가 이미 그 값이다. 머리줄은 눈으로 훑는 줄이라
 * 그 자리를 옮기지 않는다(그 까닭은 `field-order.ts` 머리말).
 *
 * 🔵 타입을 적어 두는 까닭: 이 넷이 `RequestItemPartText` 의 칸과 **맞물려 있다**는 것을 tsc 가 재게 한다.
 */
export const REQUEST_ITEM_DETAIL_FIELDS: ReadonlyArray<{ key: keyof RequestItemPartText; label: string }> = PART_FIELDS_WITHOUT_NAME;

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
    if (value) out.push({ key: f.key, label: f.label, value });
  }
  return out;
}

/**
 * **앞세우는 칸** — 고객사 품명 (2026-10-21 쓰는 분 요청: 「다섯 중 고객사 품명을 가장 뚜렷하게」).
 *
 * 🔵 **까닭은 쓰는 분의 말 그대로**다: 고객사와 말을 주고받을 때 쓰는 이름이 이것이라, 그 화면에서
 *    **찾으려고 눈으로 훑는 값**이 된다. 넷을 같은 크기로 늘어놓으면 매번 뒤져야 한다.
 * 🔵 `REQUEST_ITEM_DETAIL_FIELDS` 의 **맨 앞이라는 사실에 기대지 않는다** — 차례는 `PART_FIELDS` 가
 *    쥐고 언제든 바뀔 수 있는데, 「앞세운다」는 차례와 **다른 결정**이다. 키로 못 박으면 차례가
 *    바뀌어도 앞세우는 칸은 그대로다.
 */
export const REQUEST_ITEM_LEAD_FIELD = "customerName" as const satisfies RequestItemDetail["key"];

export interface RequestItemDetailGroups {
  /**
   * 앞세울 칸. 🔴 **값이 없으면 `null` 이고, 그때 화면은 그 줄을 아예 안 그린다** — 빈 자리도,
   * 「없음」 같은 글자도 만들지 않는다(위 `requestItemDetails` 와 같은 규칙).
   *
   * 🔴 **비었다고 품명으로 대신 세우지 않는다**(2026-10-21 판단). 이 목록이 서는 화면 셋은 모두
   *    바로 **윗줄에 `No. 165 <품명>` 을 이미 그리고 있어서**, 대신 세우면 같은 글자가 두 줄에 걸쳐
   *    나오고 **그 복사본이 줄에서 가장 굵은 글자**가 된다. 앞세우기는 「눈으로 훑을 값을 하나 고르는
   *    일」인데, 윗줄과 같은 값을 고르면 고른 것이 없는 것과 같다. 🔵 `RequestItemPart` 에 `name`
   *    칸이 아예 없는 것이 이 결정을 타입으로도 받쳐 준다 — 대신 세우려면 칸부터 늘려야 한다.
   */
  lead: RequestItemDetail | null;
  /** 나머지 — 품명2 · 교산 품번 · 도번. 차례는 표 그대로이고, 값이 없는 칸은 여기서도 빠진다. */
  rest: RequestItemDetail[];
}

/**
 * 자세한 내용을 **앞세울 하나**와 **나머지**로 가른다.
 *
 * 🔴 **가르는 자리를 화면이 아니라 여기 둔다.** 이 저장소에는 화면 렌더 시험이 없어서, 화면이
 *    「첫째 칸을 굵게」 같은 조건을 제 안에 적으면 아무도 돌려 보지 못한 채 운영으로 나간다 —
 *    이 파일 머리말과 같은 까닭이고 같은 처방이다.
 * 🔵 **값을 잃지도 겹치지도 않는다**: `lead` 와 `rest` 를 합치면 `requestItemDetails` 그대로다.
 *    시험이 그것을 전수로 본다.
 */
export function requestItemDetailGroups(part: RequestItemPart): RequestItemDetailGroups {
  const details = requestItemDetails(part);
  return {
    lead: details.find((d) => d.key === REQUEST_ITEM_LEAD_FIELD) ?? null,
    rest: details.filter((d) => d.key !== REQUEST_ITEM_LEAD_FIELD),
  };
}

/* ------------------------------------------------------------------ */
/* 딱지 둘 — 소유구분(부품의 것) · 유상/무상(줄의 것) (2026-10-21)        */
/* ------------------------------------------------------------------ */

/**
 * 줄에 붙는 **딱지** 하나.
 *
 * 🔴 **글자와 꾸밈을 한 자리에서 함께 고른다**(CLAUDE.md 9-7절 · 이 저장소의 `PART_ISSUE_TRAIL_MARKS`·
 *    `REQUEST_STATUS_BADGE` 와 같은 수법). 따로 두면 한쪽만 늘어나고, 그때 색약인 사람에게는 모든 딱지가
 *    같아 보인다. **색을 빼도 말이 되어야 한다.**
 * 🔵 **「자세한 내용」(`RequestItemDetail`)과 타입을 따로 둔 까닭**: 저쪽은 글자를 **흘려 적는** 값이고
 *    (품번·도번처럼 길다), 이쪽은 **값이 몇 가지뿐인 짧은 값**이라 눈에 집히는 상자로 그린다. 한 타입으로
 *    합치면 모양을 고를 근거가 사라져 결국 화면이 `key` 를 보고 갈라야 한다.
 */
export interface RequestItemTag {
  /** 어느 값인가. 🔵 화면의 `key` 이자, 시험이 「둘이 섞이지 않았나」를 짚는 이름이다. */
  key: "owner" | "chargeType";
  /**
   * 값 앞에 붙는 작은 글자. 🔵 **빈 글자일 수 있다** — 값 자체가 이미 말이 되는 딱지는 라벨을 달지 않는다
   * (아래 유상/무상). 🔴 **그 있고 없음이 두 딱지를 가르는 「색 아닌」 표식 하나**이기도 하다.
   */
  label: string;
  value: string;
  /** 상자 꾸밈(테두리·바탕·글자색·굵기). 🔴 위 머리말 — 색만 담지 않는다. */
  className: string;
}

/** 소유구분 딱지의 라벨. 🔵 값(`DSS`·`KYOSAN`·`보수부재`)만으로는 무슨 칸인지 모른다 — 그래서 붙인다. */
export const REQUEST_ITEM_OWNER_TAG_LABEL = "소유";

/**
 * 소유구분 딱지의 꾸밈 — **중립색 · 보통 굵기**.
 *
 * 🔵 **일부러 눈에 덜 띄게 둔다.** 이 줄에서 돈이 걸린 값은 아래 유상/무상이고, 둘을 같은 세기로 그리면
 *    그쪽이 묻힌다. 소유는 「어느 재고에서 빠지나」를 확인하는 값이라 **있으면 보이는 것으로 충분하다.**
 */
export const REQUEST_ITEM_OWNER_TAG_CLASS = "border-zinc-200 bg-zinc-50 text-zinc-600";

/**
 * **부품의 소유구분** 딱지. 값이 없으면 `null` 이고, 그때 화면은 **아무것도 안 그린다.**
 *
 * 🔴 **받는 것이 `RequestItemPart` 다** — 줄 쪽 값(`RequestItemLine`)으로는 이 함수를 부를 수 없다.
 *    그 가름이 이 조각의 뜻이다(파일 머리말).
 * 🔴 **빈 자리를 만들지 않는다**(`requestItemDetails` 와 같은 규칙). 부품을 못 찾은 줄에 `-` 를 적으면
 *    「소유가 없는 부품」처럼 읽히는데, 참말은 **부품을 못 찾았다**이고 그것은 품명 칸이 이미 말하고 있다.
 * 🔵 글자는 `OWNER_LABEL` 한 표에서 온다 — 여기 손으로 적으면 A/S 와 부르는 말이 갈린다.
 */
export function requestItemOwnerTag(part: RequestItemPart): RequestItemTag | null {
  if (part.owner === null) return null;
  return { key: "owner", label: REQUEST_ITEM_OWNER_TAG_LABEL, value: OWNER_LABEL[part.owner], className: REQUEST_ITEM_OWNER_TAG_CLASS };
}

/**
 * 유상/무상 딱지의 꾸밈 — 🔴 **둘이 색 말고도 갈린다.**
 *
 *  ① **글자가 다르다**(「유상」 ↔ 「무상」). 색을 전부 지워도 이 가름은 남는다 — 이 저장소가
 *     상태 배지·결재선 상자에서 쓰는 그 수법이다(`PART_ISSUE_TRAIL_MARKS` 주석).
 *  ② **바탕이 차 있나**가 다르다(연노랑 ↔ 흰 바탕). 흑백으로 찍어도, 색약인 눈에도 **한쪽만 칠해져
 *     있다**는 것은 보인다.
 *
 * 🔴 **둘 다 굵다**(`font-semibold`). 돈이 걸린 값이라 **흘려 적어서 놓치는 일이 없어야** 하기 때문이고,
 *    바로 위 소유구분 딱지가 보통 굵기인 것과 함께 **두 딱지를 가르는 「색 아닌」 표식**이 된다.
 * 🔵 유상에 노랑을 고른 까닭: 이 저장소에서 주황·노랑 계열은 「사람이 더 볼 것이 있다」는 뜻으로
 *    쓰인다(대기 배지·남은 수량). 유상은 **청구가 따라붙는** 줄이다. 무상은 그냥 나가는 줄이라 중립색이다.
 */
export const REQUEST_ITEM_CHARGE_TAG_CLASS: Record<ChargeType, string> = {
  PAID: "border-amber-300 bg-amber-50 font-semibold text-amber-900",
  FREE: "border-zinc-300 bg-white font-semibold text-zinc-700",
};

/**
 * **그 줄의 유상/무상** 딱지. 값이 없으면 `null` 이고, 그때 화면은 **아무것도 안 그린다.**
 *
 * 🔴 **받는 것이 `RequestItemLine` 이다** — 부품(`RequestItemPart`)으로는 부를 수 없다. 「이 **부품**은
 *    유상인가요?」는 답이 없는 물음이기 때문이다(파일 머리말).
 * 🔴 **라벨을 달지 않는다.** 「유상」·「무상」이 그 자체로 무슨 칸인지까지 말하는 낱말이라, 앞에 「유상/무상」을
 *    또 적으면 같은 말이 두 번 나오고 딱지가 길어져 **오히려 묻힌다.**
 * 🔵 **비어 있는 것이 정상인 자리가 있다** — 대여·폐기 신청에는 이 값이 처음부터 없다(`RequestItemLine`
 *    의 그 칸 주석). 그래서 「없으면 안 그린다」가 여기서는 **빠뜨림이 아니라 참말**이다.
 */
export function requestItemChargeTag(line: RequestItemLine): RequestItemTag | null {
  if (line.chargeType === null) return null;
  return { key: "chargeType", label: "", value: CHARGE_LABEL[line.chargeType], className: REQUEST_ITEM_CHARGE_TAG_CLASS[line.chargeType] };
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
