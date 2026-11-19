import { drawingNoValueStyle, type DrawingNoStyle } from "@/lib/stock/drawing-no-style";

/**
 * **도번 한 줄** — 신청 줄 아래에 제 자리를 갖고 서는, 크고 색이 든 줄 (2026-11-20 쓰는 분 요청:
 * 「재고 담당자가 **도번을 보면서 불출을 실행**한다. 지금은 너무 작고 눈에 안 띈다」).
 *
 * 🔴 **그리는 자리가 여기 하나다.** 이 모양을 쓰는 곳이 둘이다 — 실제 신청 줄
 *    (`RequestItemDetails`)과 **설정 화면의 미리보기**(`DrawingNoStyleForm`). 미리보기를 따로
 *    베껴 적으면 **미리보기와 진짜 화면이 갈라지고**, 그것은 설정 화면이 할 수 있는 가장 나쁜
 *    거짓말이다(고른 대로 보였는데 신청 화면은 다르게 선다).
 * 🔵 두 쪽이 **값을 다른 데서 받는다**는 것이 이 조각이 `style` 을 프롭으로 받는 까닭이다:
 *    신청 줄은 **저장된 값**(Context)을, 미리보기는 **지금 고르는 중인 값**(화면 상태)을 준다.
 *
 * ── 🔴 색만으로 가르지 않는다 (CLAUDE.md 9-7절) ─────────────────────────
 * 색약인 사람에게는 색이 같아 보이고, 흑백으로 찍으면 아예 사라진다. 그래서 가르는 것이 색 말고도 셋이다:
 *  ① **제 줄을 갖는다**(바로 위 품번·도번 줄에 섞이지 않는다)
 *  ② **「도번」이라는 라벨 글자가 남아 있다** — 색을 전부 지워도 무슨 값인지 알 수 있다
 *  ③ **굵고 크다**(`font-medium` · 설정 기본 15px ↔ 이웃 줄 11px)
 *
 * 🔵 **라벨은 커지지 않는다.** 설정의 글씨 크기는 **값**에만 든다 — 라벨까지 함께 키우면 줄에서
 *    가장 넓은 자리를 「도번」이라는 안내 글자가 차지하고, 정작 훑어야 할 값이 그만큼 밀린다.
 * 🔵 `span`(display:block)인 까닭: 부르는 쪽이 `span`·`td` 안이라 `div` 를 넣으면 글 흐름 안에
 *    블록이 끼어든다(`RequestItemDetails` 의 같은 까닭).
 * 🔵 꾸밈 가운데 **사람이 고른 것만** 인라인 `style` 이고(`drawingNoValueStyle`), 자리·굵기처럼
 *    고를 수 없는 것은 클래스다. 🔴 고른 색으로 클래스 이름을 지어내면 **조용히 투명**이 된다
 *    (까닭은 `drawing-no-style.ts` 머리말).
 */
export function DrawingNoLine({ label, value, style }: { label: string; value: string; style: DrawingNoStyle }) {
  return (
    <span className="mt-1 block leading-tight">
      {/* 🔵 라벨은 이웃 줄의 라벨과 같은 크기·같은 옅기다 — 「무슨 칸인지」만 알려 주면 된다. */}
      <span className="mr-1 text-[11px] text-zinc-400">{label}</span>
      <span className="inline-block align-middle font-medium" style={drawingNoValueStyle(style)}>
        {value}
      </span>
    </span>
  );
}
