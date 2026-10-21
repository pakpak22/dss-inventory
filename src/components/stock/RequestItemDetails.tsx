import { requestItemChargeTag, requestItemDetailGroups, requestItemOwnerTag, type RequestItemTag, type RequestItemView } from "@/lib/stock/request-item-detail";

/**
 * 부품 한 줄 **아래**에 붙는 작은 글씨 — 고객사 품명 · 품명2 · 교산 품번 · 도번,
 * 그리고 **딱지 둘**(소유구분 · 유상/무상).
 * (2026-10-16 에 부품 요청 관리에만 있던 것을 2026-10-21 에 **세 화면이 같이 쓰도록** 떼어 냈다.
 * 쓰는 분 접수 5번: 「불출 신청 팝업과 승인 요청건에서도 부품을 알아보게」. 같은 날 접수로
 * **소유구분과 유상/무상**이 더해졌다.)
 *
 * 🔴 **모양을 세 곳에 베껴 적지 않는다.** 2026-10-21 전에는 이 markup 이 부품 요청 관리 화면 안에만
 *    있었고, 같은 것을 두 화면에 더 적으면 라벨 색·구분점·여백이 화면마다 따로 흐른다. 더 나쁜 것은
 *    **「값이 없으면 아무것도 안 그린다」는 규칙이 세 벌이 되는 것**이다 — 한 곳만 `?? "-"` 로 고쳐도
 *    그 화면에서만 빈 자리가 생기고, 이 저장소에는 화면 렌더 시험이 없어 아무도 못 본다.
 * 🔴 **그 규칙을 여기서 다시 적지도 않는다** — 무엇을 어떤 차례로 보일지도, 빈 칸을 버리는 것도,
 *    **넷 중 무엇을 앞세울지도**, **딱지의 글자와 꾸밈도** 전부 순수 함수 쪽이고
 *    (`requestItemDetailGroups` · `requestItemOwnerTag` · `requestItemChargeTag`), 여기는 **받은
 *    것을 그리기만** 한다.
 *    🔵 목록이 비면 `null` 이라 **상자도 여백도 안 선다**: 「없음」을 줄줄이 적으면 정작 있는 값이
 *       묻히고, 빈 상자만 남으면 「값이 지워졌나」로 읽힌다.
 *
 * ── 🔴 **고객사 품명이 가장 뚜렷하다** (2026-10-21 쓰는 분 요청) ──────────
 * 고객사와 말을 주고받을 때 쓰는 이름이라, 그 화면에서 **찾으려고 눈으로 훑는 값**이 이것이다.
 * 🔴 **색만으로 가르지 않는다**(CLAUDE.md 9-7절 — 색약인 사람에게는 같아 보인다). 가르는 것이 넷이다:
 *    **① 제 줄을 갖고 ② 맨 위에 서고 ③ 굵고(`font-medium`) ④ 한 치수 크다**(`text-xs` ↔ `text-[11px]`).
 *    색(zinc-900 ↔ zinc-600)은 그 위에 얹는 것이고, 색을 빼도 넷이 남는다.
 * 🔵 **모양은 부품 찾기 고르개(`PartPicker`)가 이미 쓰던 것**이다 — 거기도 고객사 품명만 제 줄에
 *    세우고 나머지를 한 줄에 묶는다. 같은 값을 두 화면이 다른 모양으로 보이지 않게 그 결을 따른다.
 * 🔴 **비면 그 줄이 통째로 안 선다.** 빈 자리를 만들지 않고, **품명으로 대신 세우지도 않는다** —
 *    까닭은 `requestItemDetailGroups` 의 `lead` 주석에 적어 두었다(윗줄이 이미 품명이다).
 *
 * ── 🔵 **딱지 둘을 가운데에 끼운다** (2026-10-21) ────────────────────────
 * 차례는 **① 고객사 품명 ② 딱지 ③ 나머지 글자**다.
 * 🔴 **딱지가 고객사 품명의 앞자리를 빼앗지 않는다** — 앞자리는 「눈으로 훑어 찾는 값」으로 이미
 *    정해진 것이고(위 머리말), 딱지는 **줄을 고른 뒤에 확인하는 값**이다.
 * 🔴 **그렇다고 맨 뒤로 보내지도 않는다.** 유상/무상은 **돈이 걸린 값**이라(틀리면 비용이 잘못 간다)
 *    품번·도번 뒤에 흘려 적으면 놓친다. 가운데에서 **상자 모양으로** 서는 것이 「훑을 값 하나」와
 *    「놓치면 안 되는 값」을 둘 다 지키는 자리다.
 * 🔴 **둘을 한 묶음으로 뭉뚱그리지 않는다.** 나란히 서 있을 뿐, 소유구분은 **부품의 속성**이고
 *    유상/무상은 **그 줄의 값**이다 — 그래서 아래도 **함수를 따로** 부른다. 까닭은
 *    `request-item-detail.ts` 머리말에 적혀 있다.
 *
 * 🔵 **머리줄은 부르는 쪽이 그린다**(`No. 165 …`). 화면마다 그 자리가 다르기 때문이다 — 부품 요청
 *    관리는 부품 상세로 가는 링크를 걸고, 불출 신청 팝업과 승인 요청건은 글자 그대로 둔다.
 * 🔵 `span`(display:block)인 까닭: 부르는 쪽 셋이 전부 **`span`·`td` 안**이라 `div` 를 넣으면
 *    글 흐름 안에 블록이 끼어든다.
 */
export function RequestItemDetails({ item }: { item: RequestItemView }) {
  const { lead, rest } = requestItemDetailGroups(item);
  /**
   * 🔴 **두 번 따로 묻는다.** 묻는 타입이 갈려 있어(부품 ↔ 줄) 이 두 줄이 곧 「성격이 다르다」는
   *    말이고, 한 함수로 합치면 그 가름이 사라진다(`request-item-detail.ts` 머리말).
   * 🔵 **차례는 소유 → 유상/무상**이다: 소유구분은 2026-10-21 전까지 품명 바로 아래 서 있던 값이라
   *    그 자리를 그대로 두고, 새로 서는 유상/무상을 그 옆에 붙인다. 쓰는 분이 적어 준 차례(① 소유구분
   *    ② 유상/무상)와도 같다.
   */
  const tags: RequestItemTag[] = [requestItemOwnerTag(item), requestItemChargeTag(item)].filter((t): t is RequestItemTag => t !== null);
  if (lead === null && tags.length === 0 && rest.length === 0) return null;
  return (
    <>
      {/* 🔴 앞세우는 줄 — 굵기·크기·자리로 가른다(색만으로 가르지 않는다, 위 머리말). */}
      {lead === null ? null : (
        <span className="mt-0.5 block text-xs leading-snug font-medium text-zinc-900">
          {/* 🔵 라벨은 값보다 옅고 가늘게 — 굵은 것이 둘이면 어느 쪽을 훑어야 하는지 알 수 없다. */}
          <span className="font-normal text-zinc-400">{lead.label} </span>
          {lead.value}
        </span>
      )}
      {/* 🔵 **딱지 줄** — 값이 몇 가지뿐인 짧은 값이라 글에 섞지 않고 상자로 세운다.
          🔵 `flex-wrap` 인 까닭: 불출 신청 팝업은 좁은 상자라 둘이 한 줄에 못 설 수 있다. */}
      {tags.length === 0 ? null : (
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {tags.map((t) => (
            <span key={t.key} className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-tight ${t.className}`}>
              {/* 🔵 라벨이 있는 딱지만 라벨을 그린다 — 「유상」·「무상」은 값 자체가 말이 된다(순수 함수 쪽 주석). */}
              {t.label === "" ? null : <span className="font-normal text-zinc-400">{t.label}</span>}
              {t.value}
            </span>
          ))}
        </span>
      )}
      {rest.length === 0 ? null : (
        <span className="mt-0.5 block text-[11px] leading-snug text-zinc-600">
          {rest.map((d, i) => (
            <span key={d.key}>
              {/* 🔵 라벨은 더 옅게, 값은 읽히게 — 훑는 것은 값이고 라벨은 「무슨 칸인지」만 알려 주면 된다. */}
              {i > 0 ? <span className="text-zinc-300"> · </span> : null}
              <span className="text-zinc-400">{d.label} </span>
              {d.value}
            </span>
          ))}
        </span>
      )}
    </>
  );
}
