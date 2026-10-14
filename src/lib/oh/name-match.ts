/**
 * ============================================================================
 * 이름 맞추기 — 순수 규칙 (DB 도 망도 여기서 만지지 않는다)
 * ============================================================================
 * A/S 의 `src/lib/domain/entity-name-match.ts` 를 **동작 그대로** 옮겨 온 것이다
 * (2026-10-15, 조각 8a). 원본에서 이 함수들은 고객사·End-User·제품 모델 콤보박스(화면)와
 * 그 값을 저장하는 mutation(서버)이 **함께** 쓴다 — 「정확히 같은 이름인가」가 화면과 서버에서
 * 다른 뜻이 되지 않게 한 곳에 모아 둔 것이다. 여기서도 같은 이유로 한 곳에 둔다: O/H 템플릿
 * 화면(조각 8b)의 품명 칸과 `src/lib/oh/mutations.ts` 의 재고 연결 판정이 이 파일을 함께 쓴다.
 *
 * 🔴 **`server-only` 를 붙이지 않는다.** 화면(클라이언트)도 부르고 시험도 부른다.
 *
 * ── 원본과 다른 것 ──────────────────────────────────────────────────────
 * 원본의 정규화 규칙은 A/S DB 의 유니크 인덱스 식
 * (`lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))`)과 글자 단위로 같게 맞춘 것이었다.
 * 이 저장소의 `parts` 에는 **품명 유니크 제약이 아예 없다**(같은 이름의 부품이 실제로 16묶음
 * 있다 — CLAUDE.md 2-1절). 그래서 여기서는 DB 가 보증해 주는 것이 없고, 아래 규칙이 「같은
 * 이름」의 **유일한 정의**다. 함수의 동작은 원본 그대로 두었다 — 두 저장소가 같은 글자를 다르게
 * 읽으면 나중에 A/S 의 값을 옮겨 올 때 연결이 어긋난다.
 * ============================================================================
 */

/** 앞뒤 공백을 떼고, 가운데 공백을 한 칸으로 줄이고, 소문자로. */
export function normalizeEntityName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isExactNormalizedMatch(a: string, b: string): boolean {
  return normalizeEntityName(a) === normalizeEntityName(b);
}

export type NameSuggestable = { name: string };

/**
 * 비슷한 이름 줄 세우기 — **외부 라이브러리를 쓰지 않는다.**
 *
 * 세 층으로 나눈다: 정규화해서 똑같은 것이 먼저, 그다음 앞머리가 같은 것, 그다음 어딘가에
 * 들어 있는 것. **정규화한 물음말을 아예 품고 있지 않은 후보는 뺀다** — 편집 거리(fuzzy) 라이브러리
 * 없이는 그런 것을 「비슷하다」고 줄 세울 근거가 없고, 근거 없이 올리면 잡음일 뿐이다.
 * 같은 층 안에서는 **짧은 이름이 먼저** 온다(뜻이 있는 둘째 기준이 필요하고, 길이가 가장 가까운
 * 것이 가장 가까운 제안으로 읽힌다). 물음말이 비면 **전부를** 가나다순으로 돌려준다 — 그래야 칸이
 * 「목록을 훑어보는」 쓰임을 잃지 않는다.
 */
export function rankSimilarNames<T extends NameSuggestable>(
  query: string,
  candidates: readonly T[],
): T[] {
  const q = normalizeEntityName(query);
  if (!q) {
    return [...candidates].sort((a, b) => a.name.localeCompare(b.name));
  }

  function tier(name: string): number {
    const n = normalizeEntityName(name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return 2;
  }

  return candidates
    .filter((c) => normalizeEntityName(c.name).includes(q))
    .sort((a, b) => {
      const tierDiff = tier(a.name) - tier(b.name);
      if (tierDiff !== 0) return tierDiff;
      return normalizeEntityName(a.name).length - normalizeEntityName(b.name).length;
    });
}

/**
 * 품명 칸이 고를 수 있는 재고 부품 한 줄. **칸 이름이 `name` 인 것이 요점이다** —
 * `rankSimilarNames` 가 그 칸을 본다(이 저장소의 `parts.name` 과 이름이 같아 그대로 넘길 수 있다).
 */
export type OhPartOption = { id: string; name: string };

/**
 * ============================================================================
 * 🔴 품명을 고치면 재고 연결이 풀린다 — 이 파일에서 가장 중요한 판단
 * ============================================================================
 * 원본에서는 이 함수가 화면(`OhTemplateScreen.tsx`)에만 있었다. 여기서는 **화면과 저장 쪽이
 * 함께 쓴다** — 화면이 보낸 `partId` 를 서버가 그대로 믿지 않기 때문이다(CLAUDE.md 8-4절).
 * 규칙이 적힌 곳은 이 함수 하나여야 「만들 때」와 「지킬 때」가 갈라지지 않는다.
 *
 * 이어 둔 줄의 품명을 사람이 손으로 고쳤을 때 무엇을 할지의 답이다. 이 함수가 연결을 **만드는
 * 쪽과 푸는 쪽 둘 다**를 맡는다 — 품명이 재고 부품과 정확히 일치하면 그 부품에 잇고, 어긋나면
 * `null` 로 되돌린다.
 *
 * 왜 「연결은 두고 어긋났다고 표시」가 아니라 자동으로 푸는가:
 *
 *  1. **연결을 만드는 유일한 몸짓이 이름 일치다.** 품명 칸은 `<input list>` + `<datalist>` 라
 *     「골랐다」는 사건이 없고 글자만 온다 — 그래서 잇는 규칙이 곧 이름 일치다. 그렇다면
 *     지키는 규칙도 같아야 한다. 만들 때와 지킬 때가 다른 잣대를 쓰면 사람은 지금 무엇이
 *     연결돼 있는지 화면만 보고 알 수 없다.
 *  2. **어긋난 값이 견적서로 나간다.** `part_name_text` 는 문서에 찍히고 `part_id` 는 부품
 *     요청이 재고에서 꺼내는 값이다. 둘이 다르면 서류와 창고가 다른 것을 말한다.
 *  3. **풀린 자리가 이미 정상이다.** 재고 마스터에 없는 이름이 실제로 있어서 `part_id` 가 비는
 *     것이 정상이다(`src/db/schema/oh-templates.ts`). 어긋난 채 이어 두는 것보다 훨씬 덜
 *     위험한 곳으로 떨어진다.
 *  4. **되돌리는 데 아무것도 잃지 않는다.** 이름을 다시 맞추면 연결이 그대로 돌아온다. 반대로
 *     「연결된 줄은 이름을 못 고치게」 하면 오타 하나 고치자고 연결부터 풀어야 한다.
 *
 * @param currentPartId 지금 그 줄에 적혀 있는(또는 화면이 보낸) 연결. 같은 품명이 여럿일 때만 쓴다.
 * @param options 고를 수 있는 재고 부품 전부. 지워진 부품은 부르는 쪽이 이미 뺀 뒤여야 한다.
 */
export function resolvePartLinkId(
  partNameText: string,
  currentPartId: string | null,
  options: readonly OhPartOption[],
): string | null {
  const matches = options.filter((option) => isExactNormalizedMatch(option.name, partNameText));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].id;
  // 같은 품명이 여럿이다(이 저장소에 실제로 16묶음 있다). 지금 연결이 그중 하나면 그대로 둔다 —
  // 같은 이름을 다시 쳤다는 이유만으로 사람이 이미 고른 것을 빼앗지 않는다. 그렇지 않으면 어느
  // 것인지 찍지 않고 사람에게 고르게 한다(화면의 재고 고르기).
  if (currentPartId !== null && matches.some((option) => option.id === currentPartId)) {
    return currentPartId;
  }
  return null;
}
