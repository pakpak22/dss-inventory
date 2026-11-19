"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveDrawingNoStyleAction } from "@/app/actions/drawing-no-style";
import { DrawingNoStyleProvider } from "@/components/stock/DrawingNoStyleContext";
import { RequestItemDetails } from "@/components/stock/RequestItemDetails";
import {
  DRAWING_NO_FONT_SIZE_MAX,
  DRAWING_NO_FONT_SIZE_MIN,
  DRAWING_NO_STYLE_DEFAULT,
  DRAWING_NO_STYLE_SAMPLE_VALUE,
  isSameDrawingNoStyle,
  serializeDrawingNoStyle,
  type DrawingNoStyle,
} from "@/lib/stock/drawing-no-style";
import type { RequestItemView } from "@/lib/stock/request-item-detail";

/**
 * ============================================================================
 * 설정 — **도번 표시 모양** 고르개 (2026-11-20 쓰는 분 요청)
 * ============================================================================
 * 고르는 것은 넷이다: ① 알약 모양을 쓸지 ② 글씨 크기 ③ 글자색 ④ 알약색.
 *
 * ── 🔴 미리보기는 **지금 고르는 중인 값**을 따른다 ──────────────────────
 * 저장된 값을 그리면 「고르고 → 저장하고 → 어떻게 됐나 보고 → 다시 고치고」가 되어, 색 하나
 * 맞추는 데 저장을 열 번 한다. 그리고 그 열 번이 **전 직원의 화면에 그대로 나간다.**
 *
 * ── 🔴 미리보기는 **알약을 꺼도 그려진다** ──────────────────────────────
 * 미리보기가 제 설정을 그대로 따라 **사라지면 다시 켤 손잡이를 잃는다.** 여기서 끄는 것은
 * 「알약(둥근 바탕)」이지 「도번 줄」이 아니다 — 꺼도 글자는 그대로 서고, 크기와 색이 든다.
 * 🔴 같은 까닭으로 **알약색 칸을 지우지 않는다.** 흐려 보이게만 두고 값은 그대로 들고 있다가,
 *    다시 켜면 그 색으로 돌아온다.
 *
 * ── 🔴 미리보기가 **진짜 그 조각**이다 ─────────────────────────────────
 * 비슷하게 생긴 것을 따로 그리지 않고, 신청 화면 셋이 쓰는 바로 그 조각(`RequestItemDetails`)을
 * 세운다. 다만 값을 **고르는 중인 것**으로 바꿔 끼운다(`DrawingNoStyleProvider`). 베껴 그리면
 * 미리보기와 진짜 화면이 갈라지는데, 그것은 설정 화면이 할 수 있는 **가장 나쁜 거짓말**이다 —
 * 고른 대로 보였는데 정작 신청 화면은 다르게 선다.
 * 🔵 **딱지 셋(소유 · 유상 · O/H)을 함께 세우는 까닭**: 도번 색을 고르는 기준이 「그 셋과 섞이지
 *    않는가」다(기본값을 파랑으로 고른 까닭 — `drawing-no-style.ts`). 도번만 떼어 보면 그 판단을
 *    할 수가 없다.
 *
 * 🔵 **기본값으로 되돌리기**를 둔 까닭: 흰 바탕에 흰 글자처럼 **스스로 안 보이게 만든 뒤** 고치러
 *    오면 고를 칸이 보이지 않는다. 그 한 수를 되돌리는 길이 단추 하나로 있어야 한다. 🔴 되돌리기는
 *    **고르는 중인 값만** 바꾼다 — 누르자마자 저장되면 되돌릴 셈으로 눌러 본 사람이 남의 화면까지
 *    바꾼다.
 * ============================================================================
 */

const INPUT_LABEL = "flex flex-col gap-1 text-xs text-zinc-500";

/**
 * 색 고르개 둘의 이름표를 잇는 `id`.
 *
 * 🔴 **라벨이 칸을 품지 않고 `htmlFor` 로 잇는 까닭**: 품으면 라벨이 차지한 **빈 자리까지** 눌림을
 *    받아 색 고르개가 열린다(2026-11-20 에 쓰는 분이 짚었다 — 오른쪽 빈 곳을 눌러도 팔레트가 떴다).
 *    이어 두면 라벨은 글자만큼만 덮는다.
 * 🔵 글자로 적힌 이름이라 스크린리더가 읽는 이름과 화면에 보이는 이름이 **같다**.
 */
const TEXT_COLOR_ID = "drawing-no-text-color";
const PILL_COLOR_ID = "drawing-no-pill-color";

/**
 * 미리보기에 세우는 **지어낸 신청 줄** 하나.
 *
 * 🔴 **실제 고객사 값을 적지 않는다** — 이 저장소에 한 번 박히면 지울 길이 없다(도번은
 *    `DRAWING_NO_STYLE_SAMPLE_VALUE`, 나머지도 전부 지어낸 글자다).
 * 🔵 칸을 **하나도 비우지 않는 까닭**: 비우면 그 줄이 안 그려지고(「빈 칸은 안 그린다」),
 *    그러면 도번이 실제로 어디에 서는지가 미리보기에서 안 보인다.
 */
const PREVIEW_ITEM: RequestItemView = {
  partNo: 1,
  owner: "DSS",
  customerName: "배면 덧댐 판금",
  name2: "Rear panel",
  kyosanPartNo: "C012345678",
  drawingNo: DRAWING_NO_STYLE_SAMPLE_VALUE,
  chargeType: "PAID",
  fromOhTemplate: true,
};

export function DrawingNoStyleForm({ saved, savedAt, savedByName }: { saved: DrawingNoStyle; savedAt: string | null; savedByName: string }) {
  const router = useRouter();

  const [draft, setDraft] = useState<DrawingNoStyle>(saved);
  /**
   * 저장 뒤 `router.refresh()` 로 새 값이 내려오면 고르는 중이던 값을 그것에 맞춘다. 다른 관리자가
   * 먼저 바꾼 경우에도 화면이 옛 값을 붙들고 있지 않게 하는 자리다(렌더 중 setState — 자료가 바뀐
   * 그 렌더에서 바로 반영된다. `ApprovalRouteSection` 과 같은 수법).
   */
  const savedKey = serializeDrawingNoStyle(saved);
  const [syncedKey, setSyncedKey] = useState(savedKey);
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey);
    setDraft(saved);
  }

  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function update(patch: Partial<DrawingNoStyle>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    // 🔵 결과 문구는 **방금 저장한 값**에 대한 말이다. 값을 또 고치면 그 말은 더 이상 참이 아니다.
    setMessage(null);
  }

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);
    const result = await saveDrawingNoStyleAction(draft);
    setIsSaving(false);
    setMessage(result.message);
    if (!result.ok) return;
    router.refresh();
  }

  const unsaved = !isSameDrawingNoStyle(saved, draft);
  const isDefault = isSameDrawingNoStyle(DRAWING_NO_STYLE_DEFAULT, draft);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">도번 표시 모양</h2>
      <p className="mt-1 text-xs text-zinc-500">
        부품 요청 관리 · 승인 요청건 · 불출 신청 팝업에서 부품 아래에 서는 <span className="font-medium text-zinc-700">도번</span> 줄의 모양입니다. 세 화면에 함께 적용됩니다.
      </p>

      {/* ── 미리보기 — 🔴 **지금 고르는 중인 값**이고, 알약을 꺼도 그려진다(머리말) ── */}
      <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
        <p className="text-xs text-zinc-500">미리보기 — 부품 요청 관리의 신청 항목 한 줄</p>
        <div className="mt-2 rounded border border-zinc-200 bg-white px-3 py-2">
          {/* 🔵 머리줄은 부르는 쪽이 그린다(`RequestItemDetails` 머리말) — 실제 화면에서도 이 자리다. */}
          <p className="text-sm font-medium text-zinc-900">
            No. 1 <span className="font-normal">예시 판금</span>
          </p>
          {/* 🔴 **고르는 중인 값**을 끼워 넣는다 — 저장된 값(레이아웃이 내려보낸 것)이 아니다. */}
          <DrawingNoStyleProvider value={draft}>
            <RequestItemDetails item={PREVIEW_ITEM} />
          </DrawingNoStyleProvider>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" className="size-4" checked={draft.pill} onChange={(e) => update({ pill: e.target.checked })} />
          알약 모양(둥근 바탕)으로 보이기
        </label>
        <p className="-mt-3 text-xs text-zinc-500">끄면 바탕 없이 글자만 커지고 색이 듭니다. 알약색은 지워지지 않고 그대로 남습니다.</p>

        <label className={INPUT_LABEL}>
          글씨 크기
          <span className="flex items-center gap-2">
            {/* 🔵 끄는 칸이 아니라 **미는 칸**인 까닭: 숫자 칸은 지우는 순간 빈 값이 되어 미리보기가
                한 번 깨지는데, 여기서 보려는 것이 바로 그 미리보기다. 미는 칸은 빈 값이 없다.
                🔴 위·아래 끝은 순수 함수 쪽 상수다 — 서버도 같은 둘로 다시 잰다. */}
            <input
              type="range"
              min={DRAWING_NO_FONT_SIZE_MIN}
              max={DRAWING_NO_FONT_SIZE_MAX}
              step={1}
              value={draft.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
              className="w-56"
              aria-label="글씨 크기"
            />
            <span className="tabular text-sm text-zinc-900">{draft.fontSize}px</span>
          </span>
        </label>

        {/* ── 🔴 **색 둘은 한 줄에 나란히** (2026-11-20 쓰는 분 요청) ──────────────
            글자색과 알약색은 **서로 견주며 고르는 값**이다(대비가 모자라면 글자가 안 보인다).
            세로로 떨어져 있으면 둘을 번갈아 보느라 눈이 오간다.
            🔵 글씨 크기는 미는 칸이 넓어 이 줄에 끼우지 않았다 — 끼우면 미는 칸이 좁아져
               한 칸씩 고르기가 어려워진다.

            🔴 **라벨이 줄 전체를 덮지 않는다.** 앞서는 `<label>` 이 `flex flex-col` 이라 폭을
               통째로 차지해서 **오른쪽 빈 자리를 눌러도 색 고르개가 열렸다**(쓰는 분이 짚었다).
               `htmlFor` 로 이어 두면 라벨은 **글자만큼만** 덮고 빈 자리는 아무 일도 안 한다.
            🔴 **`aria-label` 로 바꿔 이어 두는 것을 없애지 마라** — 그러면 화면에서 읽히는 이름과
               스크린리더가 읽는 이름이 갈린다. 색 고르개는 그림만 보여 주는 칸이라 이름이 글자로
               남아 있어야 무슨 색인지 알 수 있다. */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <span className="flex items-center gap-2">
            <label htmlFor={TEXT_COLOR_ID} className="text-xs text-zinc-500">
              글자색
            </label>
            <input id={TEXT_COLOR_ID} type="color" value={draft.textColor} onChange={(e) => update({ textColor: e.target.value })} className="h-8 w-14 rounded border border-zinc-300 bg-white p-0.5" />
            {/* 🔵 고른 색의 값을 글자로도 적는다 — 「그 파란색」이라고만 하면 서로 다른 색을 말하게 된다. */}
            <span className="font-mono text-xs text-zinc-500">{draft.textColor}</span>
          </span>

          {/* 🔴 알약을 꺼도 **지우지 않는다**. 흐려 보이게만 두고 값은 그대로 들고 있다(머리말). */}
          <span className={`flex items-center gap-2 ${draft.pill ? "" : "opacity-50"}`}>
            <label htmlFor={PILL_COLOR_ID} className="text-xs text-zinc-500">
              알약색
            </label>
            <input id={PILL_COLOR_ID} type="color" value={draft.pillColor} onChange={(e) => update({ pillColor: e.target.value })} className="h-8 w-14 rounded border border-zinc-300 bg-white p-0.5" />
            <span className="font-mono text-xs text-zinc-500">{draft.pillColor}</span>
          </span>
        </div>
        {/* 🔵 안내는 **줄 아래**로 내렸다 — 한 줄에 끼우면 색 둘이 밀려 가로로 서는 뜻이 없어진다. */}
        {draft.pill ? null : <p className="-mt-1 text-xs text-zinc-500">알약을 켜면 이 색이 쓰입니다.</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !unsaved}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {isSaving ? "저장 중" : "저장"}
        </button>
        <button
          type="button"
          onClick={() => update(DRAWING_NO_STYLE_DEFAULT)}
          disabled={isDefault}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
        >
          기본값으로 되돌리기
        </button>
        {unsaved ? <span className="text-xs text-amber-700">아직 저장하지 않았습니다.</span> : null}
      </div>

      {message === null ? null : <p className="mt-2 text-xs text-zinc-700">{message}</p>}

      <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        {savedAt === null ? (
          // 🔵 「기본값으로 서 있다」와 「누가 기본값과 같은 값을 저장해 뒀다」는 보이기는 같지만 다른 상태다.
          <>아직 한 번도 바꾸지 않았습니다 — 기본값으로 보입니다.</>
        ) : (
          <>
            마지막으로 바꾼 사람: {savedByName || "-"} · <span className="tabular">{new Date(savedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}</span>
          </>
        )}
      </p>
    </section>
  );
}
