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
 * ── 🔴 재고 연결이 없는 줄이 정상이다 ───────────────────────────────────
 * 양식에서 옮겨 온 이름 중에는 재고 마스터에 없는 것이 있다. 그런 줄은 `재고 미연결` 로
 * 표시하고 **부품 요청에는 담기지 않는다** — 요청은 재고 부품에만 걸 수 있기 때문이다.
 * 그래서 `UNLINKED` 는 오류가 아니라 **말해 주어야 하는 사실**이다. 그 사실을 담을 때
 * 사람에게 알려야, 「요청에서 왜 이 부품이 빠졌나」를 나중에 답할 수 있다.
 *
 * ── 🔴 `MISMATCHED` 는 이 화면이 만들지 않는다 ──────────────────────────
 * 품명을 고치면 연결은 그 자리에서 풀린다(`name-match.ts` 의 `resolvePartLinkId` — 그 까닭
 * 넷이 거기 적혀 있다). 그러니 **어긋난 줄은 DB 에서 온다**: 이어 둔 뒤 재고 쪽에서 그 부품의
 * 품명을 고치면, 저장된 `part_name_text` 와 지금 재고의 품명이 어긋난 채 남는다. 그 줄을
 * 조용히 지나치면 **견적서에 찍히는 글자와 창고에서 꺼내는 부품이 서로 다른 것을 말한다** —
 * 그래서 상태를 따로 둔다.
 *
 * ── 🔵 `MISSING` 은 지워진 부품이다 ────────────────────────────────────
 * 고르개 목록(`listOhPartOptions`)은 **지워진 부품을 뺀다.** 이어 둔 뒤 그 부품이 지워지면
 * `part_id` 는 남아 있는데 후보 중에는 없다. 「어긋남」과 가르는 까닭은 할 일이 다르기
 * 때문이다 — 어긋남은 이름을 맞추거나 다시 이으면 되지만, 지워진 부품은 연결을 풀고 다른
 * 부품을 고르는 수밖에 없다.
 * ============================================================================
 */

/**
 * 품명 칸이 고를 수 있는 재고 부품 한 줄. `listOhPartOptions` 가 돌려주는 모양 그대로다.
 *
 * `name2`(품명2)와 `no` 가 함께 오는 까닭: 이 저장소의 `parts` 에는 **품명 유니크 제약이
 * 없다**(같은 이름을 따로 세는 부품이 실제로 16묶음 있다). 같은 이름이 둘 나왔을 때 사람이
 * 어느 재고인지 고르려면 단서가 있어야 하고, 이 시스템에서 사람이 부품을 가리키는 말은 **No.** 다.
 */
export type OhPartLinkOption = { id: string; no: number; name: string; name2: string };

export type OhPartLinkState =
  /** 품명이 비었다. 저장할 때 걸러지는 줄이라 아직 아무것도 아니다. */
  | { kind: "EMPTY" }
  /**
   * 재고에 이어지지 않았다. **정상이다**(머리말).
   * `ambiguous` 는 **같은 품명이 여럿이라** 연결을 정하지 못한 경우에만 찬다 — 그때는 찍지 않고
   * 사람에게 고르게 한다(`resolvePartLinkId` 의 같은 판단).
   */
  | { kind: "UNLINKED"; ambiguous: OhPartLinkOption[] }
  | { kind: "LINKED"; part: OhPartLinkOption }
  /** 🔴 이어 둔 뒤 재고 쪽 품명이 바뀌었다(머리말). */
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
  MISMATCHED: "연결된 재고와 품명이 다름",
  MISSING: "연결된 재고를 찾을 수 없음",
};

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
  if (row.partNameText.trim() === "") return { kind: "EMPTY" };

  if (row.partId === null) {
    const matches = options.filter((option) => isExactNormalizedMatch(option.name, row.partNameText));
    // 하나뿐인 일치는 여기 오지 않는다 — `resolvePartLinkId` 가 이미 이어 버렸기 때문이다.
    // 그래도 「0개」와 「1개」를 같게 다루는 까닭은, 이 함수가 **저장된 줄**에도 쓰이기 때문이다
    // (화면을 거치지 않고 들어온 줄이 있을 수 있다). 고르게 할 것이 있을 때만 들려 보낸다.
    return { kind: "UNLINKED", ambiguous: matches.length > 1 ? matches : [] };
  }

  const part = options.find((option) => option.id === row.partId);
  if (!part) return { kind: "MISSING" };
  if (!isExactNormalizedMatch(part.name, row.partNameText)) return { kind: "MISMATCHED", part };
  return { kind: "LINKED", part };
}
