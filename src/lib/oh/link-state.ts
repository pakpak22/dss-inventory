// 🔵 **타입만** 가져온다 — 빌드 때 지워지므로 "use client" 화면이 이 파일을 읽어도 스키마가
//    브라우저로 따라가지 않는다(`src/components/parts/PartPicker.tsx` 도 같은 길을 쓴다).
import type { Owner } from "@/db/schema/codes";
import type { PartQueryFields } from "@/lib/parts/search";
import { isExactNormalizedMatch } from "./name-match";

/**
 * ============================================================================
 * 줄 하나가 지금 어떤 재고 연결 상태인가 — 순수 규칙 (DB 도 망도 만지지 않는다)
 * ============================================================================
 * O/H 템플릿 화면(조각 8b)이 부품 줄마다 무엇을 보여 줄지를 **이 값 하나로** 정한다.
 * A/S 원본에서는 이 판정이 화면 파일(`OhTemplateScreen.tsx`) 안에 있었다. 여기서는 밖으로
 * 꺼낸다 — 그 화면은 서버 액션을 물고 있어(그 사슬 끝에 `server-only` 가 있다) 렌더 시험이
 * 붙지 않으므로, 틀리면 조용히 넘어가는 판정을 시험이 붙는 자리로 내려 둔다
 * (`src/lib/approval/route.ts` 의 같은 판단).
 *
 * 🔴 **`server-only` 를 붙이지 않는다.** 화면(클라이언트)이 부르고 시험도 부른다.
 *
 * ── 🔴 2026-10-15(조각 9b): 줄의 품명은 **고객사 품명**이다 ──────────────
 * 이어진 줄의 `part_name_text` 는 그 부품의 `parts.customer_name` 이다. 그래서 「같은가」를
 * 재는 상대가 우리 품명(`name`)에서 **고객사 품명(`customerName`)으로 바뀌었다.** 이 줄은
 * 견적서에 그대로 찍히는 글자이고, 고객사가 읽는 이름은 우리 품명이 아니다.
 *
 * ── 🔴 `NO_CUSTOMER_NAME` 이 이 조각의 요점이다 ─────────────────────────
 * 고객사 품명이 비어 있으면 `part_name_text` 도 **빈 글자**다 — 우리 품명으로 대신 채우지
 * 않는다(2026-10-15 사용자 결정. O/H 단가가 없을 때 일반 단가로 대신 채우지 않는 것과 같은
 * 규칙이다). 그래서 그 줄은 「아직 정해지지 않은 줄」이고, 그대로 저장하면 **견적서의 품명 칸이
 * 비어 나간다.** 조용히 두면 아무도 모르므로 상태를 따로 둔다 — 화면은 그 줄에 빨간 딱지를
 * 붙이고 고치러 가는 길(`/?part=No.` 의 고객사 품명 칸)을 준다.
 *
 * ── 🔴 재고 연결이 없는 줄이 정상이다 ───────────────────────────────────
 * 양식에서 옮겨 온 이름 중에는 재고 마스터에 없는 것이 있다. 그런 줄은 `재고 미연결` 로
 * 표시하고 **부품 요청에는 담기지 않는다** — 요청은 재고 부품에만 걸 수 있기 때문이다.
 * 그래서 `UNLINKED` 는 오류가 아니라 **말해 주어야 하는 사실**이다. 그 줄의 품명은 사람이 손으로
 * 적은 자유 입력 그대로다.
 *
 * ── 🔴 `MISMATCHED` 는 이 화면이 만들지 않는다 ──────────────────────────
 * 품명을 손으로 고치는 길이 없어졌으므로(고르개가 채운다) **어긋난 줄은 DB 에서 온다**: 이어 둔
 * 뒤 재고 쪽에서 그 부품의 **고객사 품명을 고치면**, 저장된 `part_name_text` 와 지금 값이 어긋난
 * 채 남는다. 그 줄을 조용히 지나치면 **견적서에 찍히는 글자와 창고에서 꺼내는 부품이 서로 다른
 * 것을 말한다** — 그래서 상태를 따로 둔다. 다시 저장하면 지금 고객사 품명으로 맞춰진다.
 *
 * ── 🔵 `MISSING` 은 지워진 부품이다 ────────────────────────────────────
 * 고르개 목록(`listOhPartOptions`)은 **지워진 부품을 뺀다.** 이어 둔 뒤 그 부품이 지워지면
 * `part_id` 는 남아 있는데 후보 중에는 없다. 「어긋남」과 가르는 까닭은 할 일이 다르기
 * 때문이다 — 어긋남은 다시 저장하면 맞춰지지만, 지워진 부품은 연결을 풀고 다른 부품을 고르는
 * 수밖에 없다(서버도 그 줄을 거절한다 — `mutations.ts` 3번).
 * ============================================================================
 */

/**
 * 고를 수 있는 재고 부품 한 줄. `listOhPartOptions` 가 돌려주는 모양 그대로이고, **공용 고르개가
 * 찾는 여섯 칸**(`PartQueryFields`)을 그대로 품는다 — 고르개가 한 벌이므로 찾는 칸도 한 벌이다.
 *
 * `name2`(품명2)와 `no` 가 함께 오는 까닭: 이 저장소의 `parts` 에는 **품명 유니크 제약이
 * 없다**(같은 이름을 따로 세는 부품이 실제로 16묶음 있다). 같은 이름이 둘 나왔을 때 사람이
 * 어느 재고인지 고르려면 단서가 있어야 하고, 이 시스템에서 사람이 부품을 가리키는 말은 **No.** 다.
 *
 * 🔵 **`quotePrice` 는 찾는 칸이 아니다**(`PartQueryFields` 에 없다) — O/H 템플릿 화면이 O/H
 * 단가를 비워 둔 줄에 **그 부품이 실제로 얼마로 나가는지**를 보이는 데 쓴다(2026-10-22).
 * 🔴 처음 이 칸을 더할 때(같은 날 아침)는 「**비쳐 주기만** 하는 글자」였는데, **오후에 쓰는 분이
 *    뒤집으셨다** — 비워 두면 그 견적가가 **실제로 쓰인다**(`src/lib/oh/unit-price.ts` 머리말).
 *    그래서 이 칸은 안내용 곁들이가 아니라 **값을 정하는 두 숫자 중 하나**다. 빼면 화면이 비친
 *    숫자와 통로가 내보내는 숫자가 달라진다.
 * 🔴 **`null` 은 「견적가를 정하지 않았다」이지 0 이 아니다** — O/H 단가와 같은 잣대다
 * (`src/lib/api/parts.ts` 의 `ApiPart.overhaulQuotePrice` 머리말).
 *
 * 🔵 **`owner`·`quantity` 도 찾는 칸이 아니다**(2026-10-22 요청 1) — 고르개의 결과 줄에 **그
 * 부품에 대한 내용이 다 보이게** 하는 데 쓴다. 고르는 사람이 **재고가 몇 개인지 보고 고른다.**
 * 🔵 `quantity` 는 **재고 현황 목록이 읽는 그 수**다(`stock_balances.quantity`, 줄이 없으면 0) —
 * 질의가 거기서 맞춰 준다(`listOhPartOptions` 머리말). 「모름」이라는 값은 없다.
 */
export type OhPartLinkOption = PartQueryFields & {
  id: string;
  quotePrice: number | null;
  owner: Owner;
  quantity: number;
};

export type OhPartLinkState =
  /** 자유 입력 줄인데 품명이 비었다. 저장할 때 걸러지는 줄이라 아직 아무것도 아니다. */
  | { kind: "EMPTY" }
  /** 재고에 이어지지 않은 자유 입력 줄. **정상이다**(머리말). */
  | { kind: "UNLINKED" }
  | { kind: "LINKED"; part: OhPartLinkOption }
  /** 🔴 이어졌는데 그 부품의 고객사 품명이 비어 있다(머리말). */
  | { kind: "NO_CUSTOMER_NAME"; part: OhPartLinkOption }
  /** 🔴 이어 둔 뒤 재고 쪽 고객사 품명이 바뀌었다(머리말). */
  | { kind: "MISMATCHED"; part: OhPartLinkOption }
  /** 🔴 이어 둔 부품이 지워졌다(머리말). */
  | { kind: "MISSING" };

/**
 * 상태마다 화면에 적는 말. 🔵 **목록 화면과 같은 글자를 쓴다** — `재고 미연결` 은 A/S 원본이
 * 쓰던 말이고, 새 용어를 만들면 같은 사실이 화면마다 다른 일로 보인다.
 *
 * `EMPTY` 에는 붙일 말이 없다(아직 아무것도 아니다) — 타입에서 아예 뺀다.
 */
export const OH_PART_LINK_LABELS: Record<Exclude<OhPartLinkState["kind"], "EMPTY">, string> = {
  UNLINKED: "재고 미연결",
  LINKED: "재고 연결됨",
  NO_CUSTOMER_NAME: "고객사 품명 없음",
  MISMATCHED: "저장된 품명이 지금 고객사 품명과 다름",
  MISSING: "연결된 재고를 찾을 수 없음",
};

/** 고객사 품명이 없는 줄에 적는 말. 화면 둘(편집·접은 목록)이 같은 글자를 쓴다. */
export const OH_NO_CUSTOMER_NAME_NOTICE = "고객사 품명이 없습니다 — 먼저 정하십시오.";

/**
 * 같은 품명이 여럿일 때 고르는 줄에 적는 말. **No. 가 앞에 온다** — 이 시스템에서 사람이 부품을
 * 가리키는 말이 No. 이고(엑셀 현황판의 첫 칸), 품명2는 비어 있을 수 있다.
 *
 * 품명도 품명2도 똑같은 부품이 둘이면 여기서 더 해 줄 것이 없다 — No. 가 그 둘을 가른다.
 */
export function ohPartOptionLabel(option: OhPartLinkOption): string {
  const base = `No. ${option.no} · ${option.name}`;
  return option.name2 === "" ? base : `${base} — ${option.name2}`;
}

/**
 * 줄 하나의 지금 상태. 화면이 이 값 하나로 무엇을 보여 줄지 정한다.
 *
 * @param row 화면이 들고 있는 줄(편집 중인 값)이거나, 읽기용으로는 저장된 줄.
 * @param options 고를 수 있는 재고 부품 전부. **지워진 부품은 부르는 쪽이 이미 뺀 뒤여야 한다**
 *   (`listOhPartOptions` 가 뺀다) — 그래야 `MISSING` 이 「지워졌다」는 뜻을 갖는다.
 */
export function describeOhPartLink(
  row: { partId: string | null; partNameText: string },
  options: readonly OhPartLinkOption[],
): OhPartLinkState {
  // 🔴 연결이 없는 줄에서만 「비었음」을 본다. 이어진 줄의 빈 품명은 비었음이 아니라
  //    **고객사 품명이 아직 없다**는 뜻이고, 그 줄은 지워지지 않고 그대로 저장된다.
  if (row.partId === null) {
    return row.partNameText.trim() === "" ? { kind: "EMPTY" } : { kind: "UNLINKED" };
  }

  const part = options.find((option) => option.id === row.partId);
  if (!part) return { kind: "MISSING" };
  // 🔴 고객사 품명이 비었으면 그것이 먼저다 — 사람이 할 일(재고에서 고객사 품명을 정한다)이
  //    어긋남과 다르고, 어긋남으로 적으면 「다시 저장하면 된다」로 읽힌다.
  if (part.customerName.trim() === "") return { kind: "NO_CUSTOMER_NAME", part };
  if (!isExactNormalizedMatch(part.customerName, row.partNameText)) return { kind: "MISMATCHED", part };
  return { kind: "LINKED", part };
}
