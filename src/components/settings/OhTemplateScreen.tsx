"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteOhTemplateAction,
  linkProductModelAction,
  saveOhTemplateAction,
  unlinkProductModelAction,
} from "@/app/actions/oh-templates";
import {
  MAX_OH_TEMPLATE_ITEMS,
  OH_PRICE_FIELD_ERROR_PREFIX,
  parseOhPriceValue,
} from "@/lib/oh/input";
import {
  describeOhPartLink,
  ohPartOptionLabel,
  OH_PART_LINK_LABELS,
  type OhPartLinkOption,
} from "@/lib/oh/link-state";
import { isExactNormalizedMatch, rankSimilarNames, resolvePartLinkId } from "@/lib/oh/name-match";
import {
  AS_PRODUCT_MODEL_MESSAGES,
  filterUnlinkedModels,
  linkedProductModelIds,
  type AsProductModelDirectory,
} from "@/lib/oh/product-models";
// 🔴 `queries.ts` 가 아니라 타입만 든 파일에서 가져온다 — 그쪽은 server-only 라 이 조각이 끌어오면
//    빌드가 깨진다(`src/lib/oh/view.ts` 머리말).
import type { OhTemplateView } from "@/lib/oh/view";

/**
 * ============================================================================
 * O/H 부품 템플릿 관리 — 설정 안쪽 (관리자)
 * ============================================================================
 * A/S 의 `src/components/inventory/OhTemplateScreen.tsx` 를 **모양 그대로** 옮겨 온 것이다
 * (2026-10-15, 조각 8b). 이 목록은 원래 **견적서 OH 양식의 숨은 열**에 살았다(P~AD열 34~46행,
 * K11 에 기종 코드를 넣으면 IFS 로 나타나던 값들). 부품 하나를 고치려면 숨긴 열을 다시 펴야
 * 했고, 기종이 늘면 수식을 직접 고쳐야 했으며, 재고와 이어져 있지 않았다. 이 화면이 그 셋을
 * 대신한다.
 *
 * ── 🔴 재고 연결이 없는 줄이 정상이다 ───────────────────────────────────
 * 양식에서 옮겨 온 이름 중에는 재고 마스터에 없는 것이 있다. 그런 줄은 `재고 미연결` 로
 * 표시하고, **부품 요청에는 담기지 않는다** — 요청은 재고 부품에만 걸 수 있기 때문이다.
 * 그 사실을 담을 때 사람에게 알린다(카드 머리의 「재고 미연결 N종」, 줄마다의 상태 딱지).
 *
 * ── 🔴 13줄이 상한이다 ──────────────────────────────────────────────────
 * OH 견적서 양식의 부품 칸이 34~46행이다. 더 담아 두면 견적서를 만들 때 넘치는 줄이 갈 곳이
 * 없고, 그때 조용히 자르면 청구할 부품이 문서에서 사라진다. 그래서 [+ 부품 추가] 를 잠그고
 * **왜 잠겼는지를 그 자리에 적는다** — 숫자만으로는 사람이 상한을 고장과 구별하지 못한다.
 * 실제로 `부품 (13 / 13)` 을 보고도 「부품 추가가 안 된다」는 고장 신고가 올라온 적이 있다.
 *
 * ── 🔴 재고 연결은 품명 칸에서 만든다 ───────────────────────────────────
 * 품명 칸은 `<input list>` + `<datalist>` 다. 다른 점은 **친 글자가 곧 저장되는 값**이라는
 * 것이다 — 고객사 칸은 고르기 위한 글자와 저장되는 값이 따로였지만, 여기서는 `partNameText`
 * 가 그대로 견적서에 찍힌다. 그래서 후보의 `value` 는 **언제나 품명 그대로**여야 하고, 규격
 * 같은 곁가지는 `<option>` 의 본문(브라우저가 부제로 보여 준다)에만 싣는다.
 *
 * ── 🔴 품명을 고치면 재고 연결이 풀린다 ─────────────────────────────────
 * 그 까닭 넷은 `src/lib/oh/name-match.ts` 의 `resolvePartLinkId` 머리말에 있다. 여기서 되풀이
 * 하지 않는 까닭은, **화면과 저장 쪽이 같은 함수를 부르기 때문**이다 — 규칙이 적힌 곳이 하나여야
 * 「만들 때」와 「지킬 때」가 갈라지지 않는다. 화면이 다른 잣대를 쓰면 저장 결과가 화면과 달라진다.
 *
 * ── 🔴 O/H 단가의 `null` 은 0 이 아니다 ─────────────────────────────────
 * 빈 칸은 「정하지 않음」이고 저장 쪽이 그 줄을 **지운다.** 0 은 「오버홀 때는 무상」이라는
 * 뜻이다. 화면에서 `?? 0` 으로 뭉개면 그 갈림이 사라지고, **견적서가 정하지 않은 부품을 0원으로
 * 청구한다.**
 *
 * ── 🔵 아직 저장되지 않은 연결의 단가는 「모른다」 ──────────────────────
 * 서버가 내려 주는 `ohPrice` 는 **이미 저장된 줄의 것**이다. 편집 중에 새로 이은 부품은 그 값을
 * 알 수 없고(그 부품의 단가를 읽어 오는 통로가 이 화면에는 없다), 모르는 것을 빈 칸으로 그려
 * 그대로 보내면 **멀쩡히 정해져 있던 단가가 지워진다.** 그래서 보낼 줄을 두 갈래로 가린다:
 * 이미 저장돼 있던 부품(값을 안다) + 사람이 그 칸에 손댄 부품. 나머지는 **아예 보내지 않는다**
 * — 액션이 「보내지 않으면 건드리지 않는다」를 보장한다(`src/lib/oh/input.ts` 머리말).
 * ============================================================================
 */

const CARD = "rounded-lg border border-zinc-200 bg-white p-4";
const BTN = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_SMALL = "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_DANGER = "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
const INPUT = "w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";
const FIELD_LABEL = "text-xs text-zinc-500";
const FIELD_ERROR = "mt-1 text-[11px] text-red-700";
const BADGE_AMBER = "rounded border border-amber-300 px-1 text-[11px] text-amber-800";
const BADGE_GREEN = "rounded border border-emerald-300 px-1 text-[11px] text-emerald-800";
const BADGE_RED = "rounded border border-red-300 px-1 text-[11px] text-red-700";

/** 품명 칸 후보를 몇 개까지 보일지. A/S 원본과 같은 수다. */
const MAX_PART_SUGGESTIONS = 8;

/** 부품 줄 네 칸의 폭. 머리글과 줄이 **같은 격자**를 써야 칸이 어긋나지 않는다. */
const ITEM_GRID = "grid grid-cols-[1fr_4.5rem_7rem_2rem] gap-2";

type ItemRow = {
  /** React 의 줄 식별자. 저장된 줄은 그 id, 새로 더한 줄은 아래 seed 로 만든다. */
  key: string;
  partId: string | null;
  partNameText: string;
  /** 🔴 글자로 들고 있는다 — 숫자로 바꿔 두면 지우는 중간 상태(빈 칸)를 표현할 수 없다. */
  quantity: string;
};

let rowKeySeed = 0;
function newRowKey(): string {
  rowKeySeed += 1;
  return `new-${rowKeySeed}`;
}

/** 저장된 줄 → 편집용 줄. 새 템플릿은 빈 줄 하나로 시작한다(빈 줄은 저장할 때 걸러진다). */
function toRows(template: OhTemplateView | null): ItemRow[] {
  if (!template) return [{ key: newRowKey(), partId: null, partNameText: "", quantity: "1" }];
  return template.items.map((item) => ({
    key: item.id,
    partId: item.partId,
    partNameText: item.partNameText,
    quantity: String(item.quantity),
  }));
}

/**
 * 저장된 단가 → 칸에 채울 글자.
 * 🔴 `ohPrice === null` 은 「정하지 않음」이라 **빈 글자**로 둔다. 0 으로 채우면 그 자리에서
 * 「무상」이 되어 버리고, 다음 저장이 그 0 을 진짜로 적는다.
 */
function toPriceDraft(template: OhTemplateView | null): Record<string, string> {
  const draft: Record<string, string> = {};
  if (!template) return draft;
  for (const item of template.items) {
    if (item.partId === null) continue;
    draft[item.partId] = item.ohPrice === null ? "" : String(item.ohPrice);
  }
  return draft;
}

/** 이미 저장돼 있어서 **단가를 아는** 부품들(위 머리말의 「모른다」 갈림). */
function knownPriceParts(template: OhTemplateView | null): Set<string> {
  const ids = new Set<string>();
  if (!template) return ids;
  for (const item of template.items) {
    if (item.partId !== null) ids.add(item.partId);
  }
  return ids;
}

function priceText(value: number | null): string {
  // 🔴 `null` 은 0 이 아니다 — 「정하지 않음」이라고 적는다.
  return value === null ? "미정" : `${value.toLocaleString("ko-KR")}원`;
}

export function OhTemplateScreen({
  templates,
  partOptions,
  directory,
}: {
  templates: OhTemplateView[];
  /** 품명 칸이 검색할 재고 부품 전부. 지워진 부품은 서버가 이미 뺐다. */
  partOptions: OhPartLinkOption[];
  /** A/S 제품 모델 명부. 🔴 못 받아 왔을 수 있고, 그것은 「한 개도 없다」와 다른 말이다. */
  directory: AsProductModelDirectory;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [popup, setPopup] = useState<string | null>(null);

  // 🔵 고르개 목록은 **순수 함수 둘**이 만든다. 모델 하나는 템플릿 하나에만 붙으므로, 다른
  //    템플릿에 붙은 것도 이 템플릿의 고르개에서 빠져야 한다(`product-models.ts` 머리말).
  const unlinkedModels = useMemo(
    () => (directory.status === "ok" ? filterUnlinkedModels(directory.models, linkedProductModelIds(templates)) : []),
    [directory, templates],
  );

  // 저장 팝업. 🔵 이 저장소에는 공용 저장 팝업 조각이 없어 `src/components/stock/EntryForm.tsx`
  //    처럼 제 안에서 직접 그린다. 네이티브 <dialog> + showModal (CLAUDE.md 9-3절).
  const popupRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = popupRef.current;
    if (!el) return;
    if (popup && !el.open) el.showModal();
    else if (!popup && el.open) el.close();
  }, [popup]);

  function done(saved: string) {
    setMessage(null);
    setPopup(saved);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">O/H 부품 템플릿 {templates.length}종</h2>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              setCreating((previous) => !previous);
              setMessage(null);
            }}
          >
            {creating ? "새 템플릿 닫기" : "새 템플릿"}
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          기종마다 「오버홀이면 이 부품들」을 적어 둡니다. 제품 모델을 이어 두면 그 장비의 부품 요청에서 한 번에 담을
          수 있습니다. 부품 칸은 견적서 양식에 맞춰 {MAX_OH_TEMPLATE_ITEMS}줄까지입니다.
        </p>

        {/* 🔴 못 받아 온 것을 「없다」로 그리지 않는다 — 이미 이어 둔 모델은 아래에 그대로 보이고,
            지금 할 수 없는 일(새로 고르기)만 말한다(`product-models.ts` 머리말). */}
        {directory.status !== "ok" && (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            {AS_PRODUCT_MODEL_MESSAGES[directory.reason]} 아래 연결된 제품 모델은 저장된 내용 그대로이며, 지금은 모델을
            새로 고를 수 없습니다. 이미 이어 둔 연결은 그대로 돌아갑니다.
          </p>
        )}

        {message && (
          <p role="alert" className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700">
            {message}
          </p>
        )}
      </section>

      {creating && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-zinc-900">새 템플릿</h2>
          <TemplateEditor
            template={null}
            partOptions={partOptions}
            onMessage={setMessage}
            onSaved={(saved) => {
              setCreating(false);
              done(saved);
            }}
            onClose={() => setCreating(false)}
          />
        </section>
      )}

      {templates.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          아직 등록된 O/H 템플릿이 없습니다. 위 [새 템플릿] 으로 기종 하나를 만드십시오.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {templates.map((template) => {
            const unlinkedCount = template.items.filter((item) => item.partId === null).length;
            const isOpen = openId === template.id;
            return (
              <li key={template.id} className={CARD}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      기종 {template.code}
                      <span className="ml-2 font-normal text-zinc-500">{template.name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      부품 {template.items.length}종
                      {unlinkedCount > 0 && ` · 재고 미연결 ${unlinkedCount}종`}
                      {` · 연결된 모델 ${template.models.length}개`}
                      {` · ${template.version}번째 판`}
                    </p>
                    {template.note && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600">{template.note}</p>}
                  </div>
                  <button
                    type="button"
                    className={BTN_SMALL}
                    onClick={() => {
                      // 🔵 닫으면 편집 중이던 것이 사라진다. 그래서 「다른 사람이 먼저 저장했습니다」로
                      //    거절당했을 때 닫았다 다시 열면 최신 자료로 깨끗하게 시작한다.
                      setOpenId(isOpen ? null : template.id);
                      setMessage(null);
                    }}
                  >
                    {isOpen ? "편집 닫기" : "편집"}
                  </button>
                </div>

                <ModelLinks
                  template={template}
                  unlinkedModels={unlinkedModels}
                  directoryReachable={directory.status === "ok"}
                  onMessage={setMessage}
                  onDone={done}
                />

                {isOpen ? (
                  <TemplateEditor
                    template={template}
                    partOptions={partOptions}
                    onMessage={setMessage}
                    onSaved={done}
                    onClose={() => setOpenId(null)}
                  />
                ) : (
                  <ItemPreview template={template} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 🔴 팝업은 DOM 부모의 CSS 를 물려받는다. 이 저장소에서 표 칸 안에서 태어난 팝업의 글이
          밖으로 넘친 적이 있다 — 상자에서 글 흐름을 다시 세운다. */}
      <dialog
        ref={popupRef}
        className="w-full max-w-sm whitespace-normal break-words rounded-lg border border-zinc-200 bg-white p-4 text-left text-zinc-900 backdrop:bg-black/40"
        onCancel={(e) => {
          e.preventDefault();
          setPopup(null);
        }}
      >
        <div className="flex flex-col gap-3">
          <p className="text-base font-semibold">{popup ?? ""}</p>
          <div className="flex justify-end">
            <button type="button" className={BTN} onClick={() => setPopup(null)}>
              확인
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

/** 접었을 때 보이는 부품 줄. 읽기만 한다 — 상태 딱지의 말은 편집 화면과 같다. */
function ItemPreview({ template }: { template: OhTemplateView }) {
  if (template.items.length === 0) {
    return <p className="mt-3 text-xs text-zinc-500">담긴 부품이 없습니다. [편집] 에서 추가하십시오.</p>;
  }
  return (
    <ol className="mt-3 flex flex-col gap-0.5 text-sm">
      {template.items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-baseline gap-2">
          <span className="w-5 text-right text-xs text-zinc-400">{item.displayOrder}</span>
          <span className="text-zinc-800">{item.partNameText}</span>
          <span className="text-xs text-zinc-500">×{item.quantity}</span>
          {item.partId === null ? (
            <span className={BADGE_AMBER}>{OH_PART_LINK_LABELS.UNLINKED}</span>
          ) : (
            <>
              <span className="text-xs text-zinc-500">
                No. {item.partNo ?? "?"} · O/H 단가 {priceText(item.ohPrice)}
              </span>
              {/* 🔴 이은 뒤 재고 쪽 품명이 바뀐 줄. 조용히 두면 견적서와 창고가 다른 것을 말한다.
                  🔴 「같은 이름인가」는 **편집 화면과 같은 함수**로 판정한다 — 글자 비교로 재면
                  공백·대소문자만 다른 줄이 여기서만 빨갛게 뜨고 편집 화면에서는 멀쩡해 보인다. */}
              {item.partName !== null && !isExactNormalizedMatch(item.partName, item.partNameText) && (
                <span className={BADGE_RED}>
                  {OH_PART_LINK_LABELS.MISMATCHED} (지금 재고: {item.partName})
                </span>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

/** 제품 모델 잇기·풀기. 🔴 모델 하나는 템플릿 하나에만 붙는다(스키마의 unique). */
function ModelLinks({
  template,
  unlinkedModels,
  directoryReachable,
  onMessage,
  onDone,
}: {
  template: OhTemplateView;
  unlinkedModels: { id: string; modelName: string }[];
  directoryReachable: boolean;
  onMessage: (message: string | null) => void;
  onDone: (saved: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  async function link() {
    if (selected === "" || busy) return;
    setBusy(true);
    onMessage(null);
    // 🔴 모델 **이름을 보내지 않는다** — 서버가 A/S 명부에서 다시 뽑는다(액션 머리말).
    const result = await linkProductModelAction({ templateId: template.id, productModelId: selected });
    setBusy(false);
    if (!result.ok) {
      onMessage(result.message);
      return;
    }
    setSelected("");
    onDone(result.message);
  }

  async function unlink(linkId: string, modelName: string) {
    if (busy) return;
    setBusy(true);
    onMessage(null);
    const result = await unlinkProductModelAction({ linkId });
    setBusy(false);
    if (!result.ok) {
      onMessage(result.message);
      return;
    }
    onDone(`${modelName} 연결을 풀었습니다.`);
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <p className={FIELD_LABEL}>연결된 제품 모델</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {template.models.length === 0 && (
          <span className="text-xs text-zinc-400">
            없음 — 이어 두지 않으면 부품 요청에서 이 템플릿을 담을 수 없습니다.
          </span>
        )}
        {template.models.map((model) => (
          <span key={model.id} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs">
            {model.productModelName}
            <button
              type="button"
              onClick={() => void unlink(model.id, model.productModelName)}
              disabled={busy}
              aria-label={`${model.productModelName} 연결 풀기`}
              className="text-zinc-400 hover:text-red-600 disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* 🔴 A/S 를 못 받아 왔으면 고르개를 비우고 **그 사실을 적는다.** 위 카드의 띠가 까닭을
          말하고, 여기서는 지금 이 자리에서 할 수 없는 일만 짧게 적는다. */}
      {!directoryReachable ? (
        <p className="mt-2 text-[11px] text-amber-700">
          A/S 제품 모델 명부를 받아 오지 못해 지금은 모델을 새로 고를 수 없습니다.
        </p>
      ) : unlinkedModels.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-400">
          고를 수 있는 모델이 없습니다 — 모든 제품 모델이 이미 어느 템플릿엔가 붙어 있습니다.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy}
            aria-label={`기종 ${template.code} 에 이을 제품 모델`}
            className="min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50"
          >
            <option value="">모델 고르기…</option>
            {unlinkedModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.modelName}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void link()} disabled={busy || selected === ""} className={BTN_SMALL}>
            {busy ? "처리 중" : "연결"}
          </button>
        </div>
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  partOptions,
  onMessage,
  onSaved,
  onClose,
}: {
  /** `null` 이면 새로 만드는 중이다. */
  template: OhTemplateView | null;
  partOptions: OhPartLinkOption[];
  onMessage: (message: string | null) => void;
  onSaved: (saved: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(template?.code ?? "");
  const [name, setName] = useState(template?.name ?? "");
  const [note, setNote] = useState(template?.note ?? "");
  const [items, setItems] = useState<ItemRow[]>(() => toRows(template));
  /**
   * 부품별 O/H 단가. **줄이 아니라 부품 id 로 담는다** — 단가는 그 부품의 값이지 이 줄의 값이
   * 아니다. 그래서 같은 부품이 두 줄에 있으면 두 칸이 같은 값을 보여 주고 함께 움직인다(그게
   * 사실이다. 부품 하나에 O/H 단가는 하나다).
   */
  const [prices, setPrices] = useState<Record<string, string>>(() => toPriceDraft(template));
  /** 사람이 손댄 단가 칸. 🔵 「모르는 값을 지워 보내는 일」을 막는 열쇠다(파일 머리말). */
  const [touchedPrices, setTouchedPrices] = useState<Set<string>>(() => new Set());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /**
   * 🔴 낙관적 잠금용 판 번호. 저장이 성공하면 **돌아온 값으로 갈아 끼운다** — 안 하면 다음
   * 저장이 곧바로 충돌한다. 🔴 서버가 내려보낸 `template.version` 으로 **다시 맞추지 않는다**:
   * 다른 사람이 먼저 저장했을 때 조용히 맞춰 주면 낙관적 잠금이 통째로 무력해지고, 내가 보고
   * 있던 화면이 남의 저장을 덮어쓴다.
   */
  const [version, setVersion] = useState<number | null>(template?.version ?? null);

  const knownPrices = useMemo(() => knownPriceParts(template), [template]);

  /**
   * 줄마다의 품명 후보. 줄이 여럿이라 훅을 줄 안에서 부를 수 없어 한 번에 만든다.
   * 🔴 후보의 `value` 는 **언제나 품명 그대로**다 — 고르면 그 글자가 곧 저장되는 `partNameText`
   * 이고 견적서에 찍힌다(파일 머리말).
   */
  const suggestionsByKey = useMemo(() => {
    const map = new Map<string, OhPartLinkOption[]>();
    for (const row of items) {
      map.set(row.key, rankSimilarNames(row.partNameText, partOptions).slice(0, MAX_PART_SUGGESTIONS));
    }
    return map;
  }, [items, partOptions]);

  /** 🔴 품명을 고칠 때마다 연결을 다시 정한다 — 서버가 저장할 때 쓰는 그 함수다. */
  function changePartName(key: string, text: string) {
    setItems((previous) =>
      previous.map((row) =>
        row.key === key ? { ...row, partNameText: text, partId: resolvePartLinkId(text, row.partId, partOptions) } : row,
      ),
    );
  }

  /** 잘못 이어 둔 줄을 되돌린다. **품명은 건드리지 않는다** — 적어 둔 글자는 사람 것이다. */
  function unlinkPart(key: string) {
    setItems((previous) => previous.map((row) => (row.key === key ? { ...row, partId: null } : row)));
  }

  function changePrice(partId: string, value: string) {
    setPrices((previous) => ({ ...previous, [partId]: value }));
    setTouchedPrices((previous) => {
      if (previous.has(partId)) return previous;
      const next = new Set(previous);
      next.add(partId);
      return next;
    });
  }

  const atItemLimit = items.length >= MAX_OH_TEMPLATE_ITEMS;
  const itemLimitHintId = `oh-item-limit-${template?.id ?? "new"}`;

  // 🔴 서버에 보낼 줄은 **빈 줄을 뺀 것**이라 자리 번호가 화면과 다르다. 오류를 그 줄에 붙이려면
  //    같은 셈을 여기서 해 둬야 한다 — 화면 자리로 찾으면 빈 줄 하나에 오류가 통째로 밀린다.
  const sendItems = items.filter((row) => row.partNameText.trim() !== "");
  const sendIndexByKey = new Map(sendItems.map((row, index) => [row.key, index]));

  async function save() {
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    onMessage(null);

    /**
     * 보낼 단가 줄. **재고와 이어진 줄만** 담는다 — 단가는 부품에 붙는 값이라 이어지지 않은
     * 줄에는 붙일 곳이 없다. 부품 id 로 한 번 접는다: 같은 부품이 두 줄에 있으면 검증이 「같은
     * 부품이 두 번 들어왔습니다」로 거절하는데, 화면에서는 두 칸이 애초에 같은 값을 보여 주고
     * 있으므로 그건 사람의 잘못이 아니다.
     *
     * 🔵 값을 **아는 부품만** 담는다(파일 머리말) — 모르는 것을 빈 칸으로 보내면 저장 쪽이
     * 「정하지 않음」으로 읽고 멀쩡한 단가를 지운다.
     */
    const priceEntries = [
      ...new Map(
        sendItems
          .filter((row): row is ItemRow & { partId: string } => row.partId !== null)
          .filter((row) => knownPrices.has(row.partId) || touchedPrices.has(row.partId))
          .map((row) => [row.partId, prices[row.partId] ?? ""] as const),
      ),
    ].map(([partId, unitPrice]) => ({ partId, unitPrice }));

    const result = await saveOhTemplateAction({
      id: template?.id ?? null,
      expectedVersion: version,
      prices: priceEntries,
      fields: {
        code,
        name,
        note,
        items: sendItems.map((row) => ({
          partId: row.partId,
          partNameText: row.partNameText,
          quantity: Number(row.quantity),
        })),
      },
    });
    setBusy(false);

    if (!result.ok) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      onMessage(result.message);
      return;
    }

    // 🔴 판 번호를 갈아 끼운다. 안 하면 **다음 저장이 바로 충돌한다.**
    if (result.version !== undefined) setVersion(result.version);
    // 저장이 끝났으니 지금 화면의 값이 곧 저장된 값이다 — 「모른다」였던 칸도 이제 안다.
    setTouchedPrices(new Set(Object.keys(prices)));
    onSaved(result.message);
  }

  const unlinkedInDraft = sendItems.filter((row) => row.partId === null).length;

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>기종 코드 *</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={INPUT} disabled={busy} placeholder="예: 301" />
          {fieldErrors.code && <p className={FIELD_ERROR}>{fieldErrors.code}</p>}
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>이름 *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} disabled={busy} />
          {fieldErrors.name && <p className={FIELD_ERROR}>{fieldErrors.name}</p>}
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className={FIELD_LABEL}>비고</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={INPUT} disabled={busy} />
        {fieldErrors.note && <p className={FIELD_ERROR}>{fieldErrors.note}</p>}
      </label>

      <div className="mt-4 flex items-baseline justify-between">
        <span className={FIELD_LABEL}>
          부품 ({items.length} / {MAX_OH_TEMPLATE_ITEMS})
        </span>
        <button
          type="button"
          onClick={() =>
            setItems((previous) => [...previous, { key: newRowKey(), partId: null, partNameText: "", quantity: "1" }])
          }
          disabled={busy || atItemLimit}
          aria-describedby={atItemLimit ? itemLimitHintId : undefined}
          className={BTN_SMALL}
        >
          + 부품 추가
        </button>
      </div>
      {/* 🔴 꽉 찼을 때만 뜬다. 늘 떠 있으면 잔소리가 되고, 정작 단추가 잠긴 순간에 눈에 띄지
          않는다. 오류가 아니라 안전장치라서 빨강이 아닌 호박색을 쓴다. */}
      {atItemLimit && (
        <p id={itemLimitHintId} className="mt-1 text-[11px] text-amber-800">
          견적서 양식의 O/H 부품 칸이 {MAX_OH_TEMPLATE_ITEMS}줄이라 {MAX_OH_TEMPLATE_ITEMS}종까지만 담을 수 있습니다 —
          다른 부품을 넣으려면 아래에서 필요 없는 줄을 먼저 지우십시오.
        </p>
      )}
      {fieldErrors.items && <p className={FIELD_ERROR}>{fieldErrors.items}</p>}

      <div className="mt-2 flex flex-col gap-2.5">
        {/* 칸 이름. 값이 차면 placeholder 가 사라지므로 머리글이 없으면 셋째 칸이 무엇인지 알
            길이 없다. 지우기 칸은 이름 붙일 것이 없어 비워 둔다. */}
        {items.length > 0 && (
          <div className={`${ITEM_GRID} text-[11px] text-zinc-500`}>
            <span>품명</span>
            <span>수량</span>
            <span>O/H 단가 (원)</span>
            <span aria-hidden />
          </div>
        )}

        {items.map((row, index) => {
          const link = describeOhPartLink(row, partOptions);
          const listId = `oh-part-suggestions-${template?.id ?? "new"}-${row.key}`;
          const sendIndex = sendIndexByKey.get(row.key);
          const nameError = sendIndex === undefined ? undefined : fieldErrors[`items.${sendIndex}.partNameText`];
          const partIdError = sendIndex === undefined ? undefined : fieldErrors[`items.${sendIndex}.partId`];
          const quantityError = sendIndex === undefined ? undefined : fieldErrors[`items.${sendIndex}.quantity`];
          const priceRaw = row.partId === null ? "" : prices[row.partId] ?? "";
          const priceCheck = parseOhPriceValue(priceRaw);
          const priceServerError = row.partId === null ? undefined : fieldErrors[`${OH_PRICE_FIELD_ERROR_PREFIX}${row.partId}`];
          const priceUnknown = row.partId !== null && !knownPrices.has(row.partId) && !touchedPrices.has(row.partId);

          return (
            <div key={row.key} className={ITEM_GRID}>
              <div>
                <input
                  value={row.partNameText}
                  onChange={(e) => changePartName(row.key, e.target.value)}
                  list={listId}
                  autoComplete="off"
                  placeholder={`${index + 1}번째 부품 품명`}
                  aria-label={`${index + 1}번째 부품 품명`}
                  className={INPUT}
                  disabled={busy}
                />
                <datalist id={listId}>
                  {(suggestionsByKey.get(row.key) ?? []).map((option) => (
                    // 🔴 value 는 품명 그대로, 곁가지는 본문으로만(파일 머리말).
                    <option key={option.id} value={option.name}>
                      {ohPartOptionLabel(option)}
                    </option>
                  ))}
                </datalist>

                {/* 이 줄이 지금 재고와 이어져 있는가. 말은 목록 화면과 맞춘다 — 새 용어를 만들지 않는다. */}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {link.kind === "LINKED" && (
                    <>
                      <span className={BADGE_GREEN}>{OH_PART_LINK_LABELS.LINKED}</span>
                      <span className="text-zinc-500">{ohPartOptionLabel(link.part)}</span>
                      <button
                        type="button"
                        onClick={() => unlinkPart(row.key)}
                        disabled={busy}
                        aria-label={`${index + 1}번째 부품 재고 연결 풀기`}
                        className="text-zinc-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50"
                      >
                        연결 풀기
                      </button>
                    </>
                  )}

                  {link.kind === "UNLINKED" && (
                    <>
                      <span className={BADGE_AMBER}>{OH_PART_LINK_LABELS.UNLINKED}</span>
                      <span className="text-zinc-500">부품 요청에는 담기지 않습니다.</span>
                    </>
                  )}

                  {/* 🔴 DB 에서 온 어긋남이다 — 이 화면은 이 상태를 만들지 않는다(품명을 고치면
                      연결이 먼저 풀린다). 조용히 두면 견적서와 창고가 다른 것을 말한다. */}
                  {link.kind === "MISMATCHED" && (
                    <>
                      <span className={BADGE_RED}>{OH_PART_LINK_LABELS.MISMATCHED}</span>
                      <span className="text-zinc-500">연결: {ohPartOptionLabel(link.part)}</span>
                      <button
                        type="button"
                        onClick={() => unlinkPart(row.key)}
                        disabled={busy}
                        aria-label={`${index + 1}번째 부품 재고 연결 풀기`}
                        className="text-zinc-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50"
                      >
                        연결 풀기
                      </button>
                    </>
                  )}

                  {link.kind === "MISSING" && (
                    <>
                      <span className={BADGE_RED}>{OH_PART_LINK_LABELS.MISSING}</span>
                      <span className="text-zinc-500">지워진 부품으로 보입니다.</span>
                      <button
                        type="button"
                        onClick={() => unlinkPart(row.key)}
                        disabled={busy}
                        aria-label={`${index + 1}번째 부품 재고 연결 풀기`}
                        className="text-zinc-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50"
                      >
                        연결 풀기
                      </button>
                    </>
                  )}
                </div>

                {/* 품명이 같은 부품이 여럿이라 이름만으로는 정할 수 없다. 찍지 않고 사람에게 고르게 한다. */}
                {link.kind === "UNLINKED" && link.ambiguous.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const picked = e.target.value;
                      if (picked === "") return;
                      setItems((previous) => previous.map((r) => (r.key === row.key ? { ...r, partId: picked } : r)));
                    }}
                    disabled={busy}
                    aria-label={`${index + 1}번째 부품 재고 고르기`}
                    className={`${INPUT} mt-1`}
                  >
                    <option value="">같은 품명이 {link.ambiguous.length}개입니다 — 어느 재고인지 고르십시오…</option>
                    {link.ambiguous.map((option) => (
                      <option key={option.id} value={option.id}>
                        {ohPartOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                )}

                {nameError && <p className={FIELD_ERROR}>{nameError}</p>}
                {partIdError && <p className={FIELD_ERROR}>{partIdError}</p>}
              </div>

              <div>
                <input
                  value={row.quantity}
                  onChange={(e) =>
                    setItems((previous) => previous.map((r) => (r.key === row.key ? { ...r, quantity: e.target.value } : r)))
                  }
                  inputMode="numeric"
                  aria-label={`${index + 1}번째 부품 수량`}
                  className={INPUT}
                  disabled={busy}
                />
                {quantityError && <p className={FIELD_ERROR}>{quantityError}</p>}
              </div>

              {/* ── 부품별 O/H 단가 ───────────────────────────────────────────
                  재고와 이어진 줄에만 적을 수 있다 — 단가는 부품에 붙는 값이라 이어지지 않은
                  줄에는 붙일 곳이 없다. **잠그기만 하고 까닭을 안 적으면 안 된다**: 설명 없이
                  회색인 칸을 두었다가 「안 된다」는 고장 신고를 받은 적이 있다(위 부품 상한 안내). */}
              <div>
                <input
                  value={priceRaw}
                  onChange={(e) => {
                    if (row.partId === null) return;
                    changePrice(row.partId, e.target.value);
                  }}
                  inputMode="numeric"
                  disabled={busy || row.partId === null}
                  placeholder={row.partId === null ? "재고 연결 필요" : priceUnknown ? "저장 뒤 표시" : "미정"}
                  title={
                    row.partId === null
                      ? "재고와 이어야 O/H 단가를 정할 수 있습니다."
                      : priceUnknown
                        ? "이 부품에 이미 정해 둔 O/H 단가가 있을 수 있습니다. 비워 두면 그대로 두고, 값을 적으면 그 값으로 정합니다."
                        : "비워 두면 정하지 않음입니다. 0 은 무상이라는 뜻입니다."
                  }
                  aria-label={`${index + 1}번째 부품 O/H 단가`}
                  className={INPUT}
                />
                {/* 화면에서 미리 재 본다. 최종 판정은 서버가 같은 함수로 다시 한다. */}
                {row.partId !== null && !priceCheck.ok && <p className={FIELD_ERROR}>{priceCheck.message}</p>}
                {priceServerError && <p className={FIELD_ERROR}>{priceServerError}</p>}
              </div>

              <button
                type="button"
                onClick={() => setItems((previous) => previous.filter((r) => r.key !== row.key))}
                disabled={busy}
                aria-label={`${index + 1}번째 줄 지우기`}
                className="h-8 rounded-md border border-zinc-300 text-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* 🔴 재고에 이어지지 않은 줄이 있다는 사실을 **담을 때** 알린다(파일 머리말). */}
      {unlinkedInDraft > 0 && (
        <p className="mt-2 text-[11px] text-amber-800">
          재고에 이어지지 않은 줄이 {unlinkedInDraft}개입니다. 그대로 저장할 수 있지만 그 줄은 부품 요청에 담기지
          않습니다 — 재고에 있는 부품이라면 품명을 목록에서 골라 이어 주십시오.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {template && <DeleteTemplateDialog template={template} onMessage={onMessage} onDone={onSaved} busy={busy} />}
        <button type="button" className={BTN} onClick={onClose} disabled={busy}>
          닫기
        </button>
        <button type="button" className={BTN_PRIMARY} onClick={() => void save()} disabled={busy}>
          {busy ? "저장 중" : template ? "저장" : "등록"}
        </button>
      </div>
    </div>
  );
}

/**
 * 템플릿 지우기. **사유를 받는다** — 지운 뒤에 「왜 없어졌나」를 답할 수 있어야 한다
 * (`src/components/parts/DeletePartForm.tsx` 가 이 저장소의 본보기다).
 */
function DeleteTemplateDialog({
  template,
  onMessage,
  onDone,
  busy,
}: {
  template: OhTemplateView;
  onMessage: (message: string | null) => void;
  onDone: (saved: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  async function remove() {
    if (pending) return;
    setPending(true);
    setError(null);
    onMessage(null);
    const result = await deleteOhTemplateAction({ id: template.id, reason });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    setReason("");
    onDone(result.message);
  }

  return (
    <>
      <button type="button" className={`${BTN} mr-auto`} onClick={() => setOpen(true)} disabled={busy}>
        템플릿 삭제
      </button>

      {/* 🔴 팝업은 DOM 부모의 CSS 를 물려받는다 — 상자에서 글 흐름을 다시 세운다. */}
      <dialog
        ref={ref}
        className="w-full max-w-lg whitespace-normal break-words rounded-lg border border-zinc-200 bg-white p-4 text-left text-zinc-900 backdrop:bg-black/40"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">
            기종 {template.code} 템플릿을 지우겠습니까?
          </h3>
          <p className="text-xs text-zinc-500">
            부품 {template.items.length}종과 연결된 제품 모델 {template.models.length}개가 함께 숨겨집니다. 목록에서
            사라지고 되살리기 화면은 없습니다.
          </p>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            삭제 사유 *
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              className={INPUT}
              placeholder="예: 기종 통합으로 302 템플릿에 합침"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setOpen(false)} disabled={pending}>
              취소
            </button>
            <button type="button" className={BTN_DANGER} onClick={() => void remove()} disabled={pending}>
              {pending ? "지우는 중" : "지우기"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
