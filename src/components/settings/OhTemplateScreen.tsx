"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteOhTemplateAction,
  linkProductModelAction,
  saveOhTemplateAction,
  unlinkProductModelAction,
} from "@/app/actions/oh-templates";
import { PartPicker } from "@/components/parts/PartPicker";
import {
  MAX_OH_TEMPLATE_ITEMS,
  OH_PRICE_FIELD_ERROR_PREFIX,
  parseOhPriceValue,
} from "@/lib/oh/input";
import {
  describeOhPartLink,
  ohPartOptionLabel,
  OH_NO_CUSTOMER_NAME_NOTICE,
  OH_PART_LINK_LABELS,
  type OhPartLinkOption,
} from "@/lib/oh/link-state";
import {
  AS_PRODUCT_MODEL_MESSAGES,
  filterUnlinkedModels,
  linkedProductModelIds,
  type AsProductModelDirectory,
} from "@/lib/oh/product-models";
// 🔴 폴백을 이 화면에 다시 적지 않는다 — 푸는 자리는 그 한 곳이다(그 파일 머리말).
import { overhaulUnitPriceFollowsQuote, resolveOverhaulUnitPrice } from "@/lib/oh/unit-price";
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
 * ── 🔴 재고 연결은 **고르개**에서 만든다 (2026-10-15, 조각 9b) ───────────
 * 2026-10-15 까지 품명 칸은 `<input list>` + `<datalist>` 였고, 「골랐다」는 사건이 없어
 * **이름이 정확히 같은가**가 곧 연결 규칙이었다(글자를 고치면 연결이 풀렸다). 지금은 공용
 * 고르개(`src/components/parts/PartPicker.tsx`)가 그 자리를 맡는다 — **연결은 고를 때 맺히고**,
 * 손으로 글자를 고쳐서 풀리는 일은 없다.
 *
 * ── 🔴 아직 아무것도 아닌 줄에서는 고르개가 **먼저, 그리고 펼쳐진 채로** (2026-10-22 요청 1) ──
 * 고르개는 2026-10-15 부터 있었지만 **작은 글씨 [재고에서 고르기] 뒤에 접혀** 있었고, 줄의 첫
 * 칸은 품명 입력칸이었다. 그래서 새 템플릿을 만드는 사람은 **재고에 있는 부품까지 손으로 쳤고**,
 * 그 줄은 `재고 미연결` 이 되어 부품 요청에 담기지도, O/H 단가를 붙이지도 못했다.
 * 쓰는 분의 말은 「A/S 의 [수리 건 상세]처럼 — 검색 결과가 뜨고 그중에서 고른다」였다.
 * 그래서 셋을 바꿨다. **고르개 자체는 그대로다 — 새로 만들지 않았다.**
 *   ① 줄이 `EMPTY`(이음도 없고 품명도 빈) 이면 고르개가 **기본으로 펼쳐져** 있다.
 *   ② 이어지지 않은 줄에서는 고르개가 **품명 칸보다 위**에 선다 — 글상자 둘이 나란히 서면
 *      사람은 위엣것에 친다. A/S 의 그 화면도 찾는 칸이 맨 위다.
 *   ③ 품명 칸의 안내 글자가 **그 칸이 무엇을 위한 칸인지**를 말한다(재고에 없는 부품용).
 * 🔵 **자유 입력은 그대로 남는다**(바로 아래 머리말) — 양식에서 옮겨 온 이름 중에 재고 마스터에
 *    없는 것이 있고, 그 줄을 버리면 템플릿이 반쪽이 된다. 품명을 치기 시작하면 그 줄은 `UNLINKED`
 *    가 되어 고르개가 접힌다(재고에 없는 이름을 적는 중이라는 뜻이다). 다시 펴는 길은 그대로 있다.
 *
 * ── 🔴 이어진 줄의 품명은 **고객사 품명**이다 ───────────────────────────
 * 그 줄의 `partNameText` 는 그 부품의 `parts.customer_name` 이고, 그래서 **이 화면에서 고칠 수
 * 없다**(입력칸이 아니라 읽기만 하는 글자다). 고치려면 재고 현황의 그 부품으로 가야 한다 —
 * `/?part=<No.>` 가 상세 창을 열고 거기 고객사 품명 칸이 있다.
 * 🔴 **비어 있으면 빈 글자 그대로 저장된다** — 우리 품명으로 대신 채우지 않는다(2026-10-15
 * 사용자 결정. O/H 단가가 없을 때 일반 단가로 대신 채우지 않는 것과 같은 규칙이다). 그래서
 * 비어 있는 줄에는 빨간 딱지를 붙이고, **저장을 누르기 전에** 몇 줄이 그런지 한 번 더 말한다.
 * 막지는 않는다 — 사람이 알고도 저장할 까닭이 있다(나중에 채우기로 하고 틀을 먼저 만든다).
 * 🔵 재고에 없는 이름은 여전히 **자유 입력**이다. 양식에서 옮겨 온 이름 중에 마스터에 없는 것이
 * 있고, 그 줄을 버리면 템플릿이 반쪽이 된다.
 *
 * ── 🔴 O/H 단가의 `null` 은 0 이 아니다 ─────────────────────────────────
 * 빈 칸은 저장 쪽이 그 줄을 **지운다**(= `null`). 0 은 「오버홀 때는 무상」이라는 뜻이다.
 * 화면에서 `?? 0` 으로 뭉개면 그 갈림이 사라지고, **견적서가 무상이 아닌 부품을 0원으로
 * 청구한다.** 🔵 `null` 이 뜻하는 바는 2026-10-22 오후에 「정하지 않음」에서 **「견적가를
 * 따른다」**로 바뀌었다(아래) — 그래도 `0` 과 가르는 일은 그대로다.
 *
 * ── 🔵 아직 저장되지 않은 연결의 단가는 「모른다」 ──────────────────────
 * 서버가 내려 주는 `ohPrice` 는 **이미 저장된 줄의 것**이다. 편집 중에 새로 이은 부품은 그 값을
 * 알 수 없고(그 부품의 단가를 읽어 오는 통로가 이 화면에는 없다), 모르는 것을 빈 칸으로 그려
 * 그대로 보내면 **멀쩡히 정해져 있던 단가가 지워진다.** 그래서 보낼 줄을 두 갈래로 가린다:
 * 이미 저장돼 있던 부품(값을 안다) + 사람이 그 칸에 손댄 부품. 나머지는 **아예 보내지 않는다**
 * — 액션이 「보내지 않으면 건드리지 않는다」를 보장한다(`src/lib/oh/input.ts` 머리말).
 *
 * ── 🔴 **O/H 단가를 비워 두면 그 부품의 견적가가 쓰인다** (2026-10-22 오후, 쓰는 분 결정) ──
 * 🔴 **그 전에는 반대였다.** 같은 날 아침 커밋 `9d8df96` 은 「견적가를 **비쳐 주기만** 한다 —
 *    값이 아니라 안내다. 비워 두면 **정하지 않음**이고, `[견적가 N원 적용]` 단추를 **눌러야**
 *    값이 들어간다」로 정해 두었고, 이 머리말에도 그렇게 적혀 있었다.
 *    오후에 쓰는 분이 뒤집으셨다: 「비워 두면 견적가가 자동으로 쓰인다. 나중에 견적가가 바뀌면
 *    따라서 바뀐다. 그렇게 되면 `[견적가 적용]` 이라는 단추도 필요 없어질 테니까.」
 *    **그 단추는 없앴다**(아래 단가 칸 주석). 안 적어 두면 다음 사람이 옛 결정으로 되돌린다.
 *
 * 🔵 **화면이 하는 일은 그대로다 — 바뀐 것은 「비어 있음」의 뜻이다.** 칸이 비어 있으면 여전히
 *    `null` 이 저장되고(저장 쪽이 행을 지운다), 견적가는 여전히 **placeholder 로만** 비친다 —
 *    값을 미리 부으면 그 순간의 숫자에 **박혀** 「견적가가 바뀌면 따라 바뀐다」가 깨지기 때문이다.
 *    🔴 그래서 `save()` 의 `priceEntries` 는 이 조각 전과 똑같이 `knownPrices`·`touchedPrices`
 *    만 본다. 견적가는 `priceRaw`·`prices` 에 **닿지 않는다.**
 * 🔵 **「비면 견적가가 쓰인다」를 푸는 일은 읽는 쪽에서** 한다 — `resolveOverhaulUnitPrice`
 *    한 함수이고(`src/lib/oh/unit-price.ts`), 통로(`toApiPart`)도 이 화면의 접은 목록
 *    (`priceText`)도 그 하나를 부른다. 두 곳에 각자 적으면 언젠가 서로 다른 값을 말한다.
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

/** 부품 줄 네 칸의 폭. 머리글과 줄이 **같은 격자**를 써야 칸이 어긋나지 않는다. */
const ITEM_GRID = "grid grid-cols-[1fr_4.5rem_7rem_2rem] gap-2";

type ItemRow = {
  /** React 의 줄 식별자. 저장된 줄은 그 id, 새로 더한 줄은 아래 seed 로 만든다. */
  key: string;
  partId: string | null;
  /**
   * 견적서에 찍히는 품명.
   * 🔴 이어진 줄에서는 **고를 때 채워 넣은 고객사 품명**이고 사람이 고칠 수 없다(파일 머리말).
   * 자유 입력 줄에서는 사람이 친 글자 그대로다.
   */
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

/**
 * 접은 목록에 적는 O/H 단가. 🔴 **저장된 값이 아니라 실제로 견적서에 나가는 값**을 적는다
 * (2026-10-22 결정) — 저장된 값이 비어 있으면 그 부품의 견적가가 나가므로, 그 숫자를 적고
 * 「견적가」라고 밝힌다. 그 전에는 비면 그냥 `미정` 이었는데, 이제 그것은 **거짓말**이다:
 * 비어 있어도 견적가가 있으면 그 금액으로 청구된다.
 *
 * 🔴 `null` 은 여전히 0 이 아니다 — 둘 다 없을 때만 `미정` 이고, 저장된 `0` 은 `0원`(무상)이다.
 *
 * @param stored     저장된 O/H 단가(행이 없으면 `null`)
 * @param quotePrice 그 부품의 견적가. 가리킬 부품이 없는 줄(자유 입력·지워진 연결)은 `null`
 */
function priceText(stored: number | null, quotePrice: number | null): string {
  const resolved = resolveOverhaulUnitPrice(stored, quotePrice);
  if (resolved === null) return "미정";
  const amount = `${resolved.toLocaleString("ko-KR")}원`;
  return overhaulUnitPriceFollowsQuote(stored) ? `${amount} (견적가)` : amount;
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
          아직 등록된 O/H 템플릿이 없습니다. 위 [새 템플릿] 으로 하나를 만드십시오.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {templates.map((template) => {
            const unlinkedCount = template.items.filter((item) => item.partId === null).length;
            // 🔴 접어 둔 채로도 보여야 하는 사실이다 — 이 줄들은 견적서의 품명 칸이 비어 나간다.
            const noCustomerNameCount = template.items.filter(
              (item) => describeOhPartLink(item, partOptions).kind === "NO_CUSTOMER_NAME",
            ).length;
            const isOpen = openId === template.id;
            return (
              <li key={template.id} className={CARD}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    {/* 🔵 2026-10-15 에 기종 코드를 없앴다 — 머리글에 설 글자가 이름 하나다. */}
                    <p className="text-sm font-medium text-zinc-900">{template.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      부품 {template.items.length}종
                      {unlinkedCount > 0 && ` · 재고 미연결 ${unlinkedCount}종`}
                      {noCustomerNameCount > 0 && (
                        <span className="text-red-700"> · 고객사 품명 없음 {noCustomerNameCount}종</span>
                      )}
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
                  <ItemPreview template={template} partOptions={partOptions} />
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

/**
 * 접었을 때 보이는 부품 줄. 읽기만 한다 — 상태 딱지의 말은 편집 화면과 같다.
 *
 * 🔴 여기 적히는 품명은 **저장된 글자**(`partNameText`)다. 지금 재고의 고객사 품명으로 바꿔
 * 그리면 화면이 **견적서에 실제로 찍힐 글자를 숨기게 된다** — 어긋난 줄은 어긋난 채로 보이고,
 * 그 사실을 딱지로 말한다(`describeOhPartLink`).
 */
function ItemPreview({ template, partOptions }: { template: OhTemplateView; partOptions: OhPartLinkOption[] }) {
  if (template.items.length === 0) {
    return <p className="mt-3 text-xs text-zinc-500">담긴 부품이 없습니다. [편집] 에서 추가하십시오.</p>;
  }
  return (
    <ol className="mt-3 flex flex-col gap-0.5 text-sm">
      {template.items.map((item) => {
        const link = describeOhPartLink(item, partOptions);
        return (
          <li key={item.id} className="flex flex-wrap items-baseline gap-2">
            <span className="w-5 text-right text-xs text-zinc-400">{item.displayOrder}</span>
            {/* 🔴 빈 품명은 「아무것도 없음」으로 보이면 안 된다 — 그 자리가 비어 나간다는 뜻이다. */}
            {item.partNameText === "" ? (
              <span className="text-xs text-zinc-400">(품명 비어 있음)</span>
            ) : (
              <span className="text-zinc-800">{item.partNameText}</span>
            )}
            <span className="text-xs text-zinc-500">×{item.quantity}</span>
            {item.partId === null ? (
              <span className={BADGE_AMBER}>{OH_PART_LINK_LABELS.UNLINKED}</span>
            ) : (
              <>
                <span className="text-xs text-zinc-500">
                  No. {item.partNo ?? "?"} · {item.partName ?? "?"} · O/H 단가{" "}
                  {priceText(item.ohPrice, "part" in link ? link.part.quotePrice : null)}
                </span>
                {/* 🔴 고객사 품명이 없는 줄. 그대로 견적서에 나가면 품명 칸이 빈다. */}
                {link.kind === "NO_CUSTOMER_NAME" && (
                  <span className={BADGE_RED}>
                    {OH_PART_LINK_LABELS.NO_CUSTOMER_NAME} — 견적서 품명 칸이 비어 나갑니다
                  </span>
                )}
                {/* 🔴 이은 뒤 재고 쪽 고객사 품명이 바뀐 줄. 조용히 두면 견적서와 창고가 다른 것을
                    말한다. 「같은 이름인가」는 **편집 화면과 같은 함수**로 판정한다 — 글자 비교로
                    재면 공백·대소문자만 다른 줄이 여기서만 빨갛게 뜬다. */}
                {link.kind === "MISMATCHED" && (
                  <span className={BADGE_RED}>
                    {OH_PART_LINK_LABELS.MISMATCHED} (지금 고객사 품명: {link.part.customerName})
                  </span>
                )}
                {link.kind === "MISSING" && <span className={BADGE_RED}>{OH_PART_LINK_LABELS.MISSING}</span>}
              </>
            )}
          </li>
        );
      })}
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
            aria-label={`「${template.name}」 템플릿에 이을 제품 모델`}
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

  /** 지금 고르개를 **손으로 펼쳐 둔** 줄. 한 번에 하나만 펼친다 — 줄마다 펼쳐 두면 화면이 목록이 된다. */
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  /**
   * 🔴 **손으로 접은 줄**만 담는다. 아직 아무것도 아닌 줄(`EMPTY`)은 **기본이 펼침**이라,
   * 「안 접었다」가 곧 「펼쳐져 있다」다(2026-10-22 요청 1, 아래 `pickerShown`).
   *
   * 🔵 펼친 줄을 담지 않고 접은 줄을 담는 까닭: 펼침을 담으면 줄이 새로 생길 때마다 담아 줘야
   *    하고, [+ 부품 추가] 와 `toRows(null)` 둘 중 하나만 빠뜨려도 그 자리만 예전 모양으로 돌아간다.
   *    접힘을 담으면 더할 일이 사람이 누를 때 한 군데뿐이다.
   */
  const [collapsedPickers, setCollapsedPickers] = useState<Set<string>>(() => new Set());

  /**
   * 그 줄의 고르개를 펼치거나 접는다.
   * 🔴 **두 상태를 함께** 움직여야 한다 — 기본이 펼침인 줄을 `pickerKey` 만으로 접으면 다음
   * 렌더에서 기본값이 도로 펼쳐, 닫기 단추가 아무 일도 안 하는 것처럼 보인다.
   */
  function togglePicker(key: string, shown: boolean) {
    if (shown) {
      if (pickerKey === key) setPickerKey(null);
      setCollapsedPickers((previous) => {
        if (previous.has(key)) return previous;
        const next = new Set(previous);
        next.add(key);
        return next;
      });
      return;
    }
    setPickerKey(key);
    setCollapsedPickers((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  }
  /** 🔴 「고객사 품명이 없는 줄이 N개입니다」를 저장 전에 묻는 중인가(아래 dialog). */
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = confirmRef.current;
    if (!el) return;
    if (confirming && !el.open) el.showModal();
    else if (!confirming && el.open) el.close();
  }, [confirming]);

  /** 자유 입력 줄의 품명. 🔵 이어진 줄에는 이 칸이 없다(품명이 고객사 품명이다). */
  function changePartName(key: string, text: string) {
    setItems((previous) => previous.map((row) => (row.key === key ? { ...row, partNameText: text } : row)));
  }

  /**
   * 🔴 고르개에서 골랐다 — **연결과 품명이 함께 채워진다.** 품명은 그 부품의 고객사 품명이고,
   * 비어 있으면 **빈 글자 그대로** 넣는다(우리 품명으로 대신 채우지 않는다, 파일 머리말).
   * 저장할 때 서버가 DB 에서 같은 값을 다시 읽어 확정한다.
   */
  function pickPart(key: string, option: OhPartLinkOption) {
    setItems((previous) =>
      previous.map((row) => (row.key === key ? { ...row, partId: option.id, partNameText: option.customerName } : row)),
    );
    setPickerKey(null);
  }

  /**
   * 잘못 이어 둔 줄을 되돌린다. **품명은 건드리지 않는다** — 적어 둔 글자는 사람 것이다.
   * 🔵 고객사 품명이 비어 있던 줄은 품명도 빈 채로 자유 입력 줄이 된다. 그 줄은 품명을 적지
   * 않으면 저장할 때 빠진다(빈 줄은 보내지 않는다, 아래 `sendItems`).
   */
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
  // 🔴 **이어 둔 줄은 품명이 비어도 보낸다**(2026-10-15): 고객사 품명이 아직 없는 줄이고,
  //    여기서 걸러 버리면 사람이 담아 둔 부품이 저장할 때 **조용히 사라진다.**
  const sendItems = items.filter((row) => row.partId !== null || row.partNameText.trim() !== "");
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
  /** 🔴 이어는 두었는데 고객사 품명이 없는 줄. 저장 전에 한 번 묻는 까닭이다(파일 머리말). */
  const noCustomerNameInDraft = sendItems.filter(
    (row) => describeOhPartLink(row, partOptions).kind === "NO_CUSTOMER_NAME",
  ).length;

  /** 저장 단추. 고객사 품명이 없는 줄이 있으면 **묻고 나서** 저장한다(막지는 않는다). */
  function askThenSave() {
    if (busy) return;
    if (noCustomerNameInDraft > 0) {
      setConfirming(true);
      return;
    }
    void save();
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      {/*
        🔵 2026-10-15 에 기종 코드 칸을 걷어냈다 — 머리 칸이 이름 하나라 두 칸 격자를 쓰지 않는다.
        이름이 이 템플릿을 가리키는 유일한 글자이고, 같은 이름이 이미 있으면 저장이 거절된다.
      */}
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>이름 *</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
          disabled={busy}
          placeholder="예: 301 기종 표준 O/H"
        />
        {fieldErrors.name && <p className={FIELD_ERROR}>{fieldErrors.name}</p>}
      </label>
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
          const sendIndex = sendIndexByKey.get(row.key);
          const nameError = sendIndex === undefined ? undefined : fieldErrors[`items.${sendIndex}.partNameText`];
          const partIdError = sendIndex === undefined ? undefined : fieldErrors[`items.${sendIndex}.partId`];
          const quantityError = sendIndex === undefined ? undefined : fieldErrors[`items.${sendIndex}.quantity`];
          const priceRaw = row.partId === null ? "" : prices[row.partId] ?? "";
          const priceCheck = parseOhPriceValue(priceRaw);
          const priceServerError = row.partId === null ? undefined : fieldErrors[`${OH_PRICE_FIELD_ERROR_PREFIX}${row.partId}`];
          const priceUnknown = row.partId !== null && !knownPrices.has(row.partId) && !touchedPrices.has(row.partId);
          // 🔴 견적가는 **이어진 부품이 있을 때만** 안다(`link.part`) — 자유 입력 줄·지워진 부품
          //    연결(MISSING)은 가리킬 부품이 없어 `null` 이다(파일 머리말).
          const quotePrice = "part" in link ? link.part.quotePrice : null;
          /**
           * 🔴 **숫자만** 비친다(2026-10-22 오후). 그 전에는 `견적가 1,482,500원` 꼴이었고,
           * 앞에 `미정 ·` 까지 붙어 **112px 칸에서 잘렸다.** 쓰는 분의 말이 원래 「기존 견적단가가
           * **회색 글씨로 자동으로 적혀 있고**」였으니, 적혀 있어야 할 것은 숫자다 — 칸 머리글이
           * 이미 `O/H 단가 (원)` 라고 말하고 있어 「견적가」라는 말을 또 넣을 자리가 아니다.
           * 무엇에서 온 숫자인지는 `title`(마우스를 얹으면 뜨는 말)이 밝힌다.
           */
          const quoteHint = quotePrice === null ? null : quotePrice.toLocaleString("ko-KR");
          /**
           * 🔴 이 줄의 고르개가 지금 보이는가. **아직 아무것도 아닌 줄은 기본이 펼침**이다
           * (2026-10-22 요청 1) — 손으로 접었을 때만 닫힌다(위 `collapsedPickers`).
           */
          const pickerShown = pickerKey === row.key || (link.kind === "EMPTY" && !collapsedPickers.has(row.key));
          /**
           * 🔴 고르개를 **한 번만 빚어 두 자리 중 하나에** 꽂는다(아래). 이어지지 않은 줄에서는
           * 찾는 칸이 **품명 칸보다 먼저** 와야 한다 — A/S 의 [수리 건 상세]가 그렇고, 글상자 둘이
           * 나란히 서면 사람은 위엣것에 친다. 이어진 줄은 품명이 읽는 글자라 지금 자리 그대로다.
           */
          const picker =
            pickerShown && !busy ? (
              <div className="my-1 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                <PartPicker
                  parts={partOptions}
                  exclude={new Set()}
                  label={`${index + 1}번째 줄에 넣을 재고 부품 찾기`}
                  onPick={(part) => pickPart(row.key, part)}
                  /* 🔴 **그 부품에 대한 내용이 한 줄에 다 나오게** 한다(2026-10-22 요청 1) — 고르는
                     사람이 **재고가 몇 개인지 보고 고른다.** 켜는 자리는 여기 하나이고, 안 켠
                     다섯 자리(`src/components/stock/EntryForm.tsx`)는 그대로다. */
                  detailed
                />
              </div>
            ) : null;

          return (
            <div key={row.key} className={ITEM_GRID}>
              <div>
                {/* ── 이어진 줄: 품명은 **고객사 품명**이고 여기서 고칠 수 없다(파일 머리말) ──
                    🔴 입력칸으로 그리면 사람은 고칠 수 있다고 믿는다. 읽는 글자로 그린다. */}
                {row.partId === null ? (
                  <>
                    {/* 🔴 찾는 칸이 먼저다(2026-10-22 요청 1) — 빈 줄에서는 펼쳐진 채로 시작한다. */}
                    {picker}
                    {/* 🔴 안내를 「n번째 부품 품명」으로만 적어 두었더니, 재고에 **있는** 부품도 손으로
                        쳐서 재고 미연결 줄이 됐다 — 그 줄은 부품 요청에 담기지 않고 O/H 단가도 붙일 수
                        없다. 이 칸이 **무엇을 위한 칸인지**를 칸 안에서 말한다(자리 번호는 aria-label 에
                        그대로 남는다). */}
                    <input
                      value={row.partNameText}
                      onChange={(e) => changePartName(row.key, e.target.value)}
                      autoComplete="off"
                      placeholder="재고에 없는 부품이면 품명을 직접 적습니다"
                      aria-label={`${index + 1}번째 부품 품명`}
                      className={INPUT}
                      disabled={busy}
                    />
                  </>
                ) : row.partNameText === "" ? (
                  // 🔴 고객사 품명이 없는 줄. 빈 자리로 두면 아무도 모른 채 견적서가 비어 나간다.
                  <p className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                    {OH_NO_CUSTOMER_NAME_NOTICE}
                  </p>
                ) : (
                  <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm text-zinc-900">
                    {row.partNameText}
                  </p>
                )}

                {/* 이 줄이 지금 재고와 이어져 있는가. 말은 목록 화면과 맞춘다 — 새 용어를 만들지 않는다. */}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {(link.kind === "LINKED" || link.kind === "NO_CUSTOMER_NAME" || link.kind === "MISMATCHED") && (
                    <>
                      <span className={link.kind === "LINKED" ? BADGE_GREEN : BADGE_RED}>
                        {OH_PART_LINK_LABELS[link.kind]}
                      </span>
                      <span className="text-zinc-500">{ohPartOptionLabel(link.part)}</span>
                      {/* 🔵 고치러 가는 길. **새 탭으로 연다** — 이 화면에는 아직 저장하지 않은
                          편집 내용이 있고, 떠났다 돌아오면 그것이 사라진다. */}
                      {link.kind === "NO_CUSTOMER_NAME" && (
                        <a
                          href={`/?part=${link.part.no}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-red-700 underline underline-offset-2"
                        >
                          고객사 품명 정하러 가기
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => togglePicker(row.key, pickerShown)}
                        disabled={busy}
                        aria-label={`${index + 1}번째 부품 다시 고르기`}
                        className="text-zinc-500 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50"
                      >
                        다른 부품
                      </button>
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

                  {/* 🔴 전에 적혀 있던 글자가 남아 있는데 지금 고객사 품명은 비었다. 저장하면
                      그 글자가 사라지므로, 지금 보이는 것이 저장될 값이 아님을 말해 준다. */}
                  {link.kind === "NO_CUSTOMER_NAME" && row.partNameText !== "" && (
                    <span className="text-zinc-500">
                      적혀 있던 「{row.partNameText}」는 저장할 때 빈 글자가 됩니다.
                    </span>
                  )}

                  {/* 🔴 DB 에서 온 어긋남이다 — 이은 뒤 재고 쪽 고객사 품명이 바뀌었다. 저장하면
                      지금 값으로 맞춰진다(저장 쪽이 DB 에서 다시 읽는다). */}
                  {link.kind === "MISMATCHED" && (
                    <span className="text-zinc-500">
                      지금 고객사 품명은 「{link.part.customerName}」입니다 — 저장하면 그 글자로 바뀝니다.
                    </span>
                  )}

                  {(link.kind === "UNLINKED" || link.kind === "EMPTY") && (
                    <>
                      {link.kind === "UNLINKED" && (
                        <>
                          <span className={BADGE_AMBER}>{OH_PART_LINK_LABELS.UNLINKED}</span>
                          <span className="text-zinc-500">부품 요청에는 담기지 않습니다.</span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => togglePicker(row.key, pickerShown)}
                        disabled={busy}
                        aria-label={`${index + 1}번째 부품 재고에서 고르기`}
                        className="text-zinc-500 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50"
                      >
                        {pickerShown ? "고르기 닫기" : "재고에서 고르기"}
                      </button>
                    </>
                  )}

                  {link.kind === "MISSING" && (
                    <>
                      <span className={BADGE_RED}>{OH_PART_LINK_LABELS.MISSING}</span>
                      <span className="text-zinc-500">지워진 부품으로 보입니다. 저장하면 거절됩니다.</span>
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

                {/* 🔴 고르면 연결과 품명(= 고객사 품명)이 **함께** 채워진다. 공용 고르개라 수량 변경
                    기록 화면과 같은 칸으로 찾는다(No.·품명·품명2·고객사 품명·도번·교산 품번).
                    🔵 **이어진 줄에서만 여기 선다** — 이어지지 않은 줄에서는 품명 칸 위로 올라간다(위). */}
                {row.partId === null ? null : picker}

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
                  /**
                   * 🔴 비칠 것을 **하나만** 고른다(2026-10-22 오후). 둘을 `·` 로 잇던 글이
                   * 칸에서 잘렸고, 새 뜻에서는 이을 까닭도 없어졌다 — 비면 그 숫자가 실제로
                   * 쓰이므로 숫자 하나가 곧 답이다.
                   * 🔴 `priceUnknown` 이 **먼저**다: 편집 중에 새로 이은 부품은 이미 정해 둔 O/H
                   *    단가가 있을 수 있어(이 화면이 그 값을 받지 않는다 — 파일 머리말) 견적가를
                   *    비치면 「이 부품은 견적가로 나간다」는 **틀린 말**이 된다.
                   * 🔵 견적가도 없으면 `미정` 이다 — 따라갈 숫자가 없으므로 O/H 단가가 정말로
                   *    비어 나가고, 견적서 쪽이 칸을 비우고 사람이 채운다(API.md 2절).
                   */
                  placeholder={
                    row.partId === null
                      ? "재고 연결 필요"
                      : priceUnknown
                        ? "저장 뒤 표시"
                        : (quoteHint ?? "미정")
                  }
                  title={
                    row.partId === null
                      ? "재고와 이어야 O/H 단가를 정할 수 있습니다."
                      : priceUnknown
                        ? "이 부품에 이미 정해 둔 O/H 단가가 있을 수 있습니다. 비워 두면 그대로 두고, 값을 적으면 그 값으로 정합니다."
                        : quoteHint
                          ? `비워 두면 이 부품의 견적가 ${quoteHint}원이 그대로 쓰입니다 — 나중에 견적가가 바뀌면 따라서 바뀝니다. 회색 숫자가 그 금액입니다. 다른 금액으로 청구하려면 적으십시오. 0 은 오버홀 때 무상이라는 뜻입니다.`
                          : "이 부품은 견적가도 정해져 있지 않아, 비워 두면 O/H 단가가 비어 나갑니다. 0 은 오버홀 때 무상이라는 뜻입니다."
                  }
                  aria-label={`${index + 1}번째 부품 O/H 단가`}
                  className={INPUT}
                />
                {/* 🔴 **여기 있던 「견적가 적용」 단추를 없앴다**(2026-10-22 오후, 쓰는 분 결정).
                    그 단추는 「비치는 글자를 칸에 실제로 넣는」 몸짓이었는데, 이제 **안 눌러도
                    비워 둔 칸이 견적가로 나간다** — 쓰는 분의 말 그대로 「그렇게 되면 [견적가 적용]
                    이라는 단추도 필요 없어질 테니까」다. 더구나 누르면 그 순간의 숫자가 칸에
                    **박혀** 나중에 견적가가 바뀌어도 안 따라간다 — 새 뜻을 정면으로 깬다.
                    🔵 다른 금액으로 청구할 일은 칸에 직접 적으면 된다(그 길은 그대로다). */}
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
          않습니다 — 재고에 있는 부품이라면 [재고에서 고르기] 로 이어 주십시오.
        </p>
      )}

      {/* 🔴 고객사 품명이 없는 줄도 **담을 때** 알린다. 저장을 누르면 한 번 더 묻는다(아래). */}
      {noCustomerNameInDraft > 0 && (
        <p className="mt-2 text-[11px] text-red-700">
          고객사 품명이 없는 줄이 {noCustomerNameInDraft}개입니다. 그 줄은 견적서의 품명 칸이 비어 나갑니다 — 재고
          현황에서 그 부품의 고객사 품명을 먼저 정하십시오.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {template && <DeleteTemplateDialog template={template} onMessage={onMessage} onDone={onSaved} busy={busy} />}
        <button type="button" className={BTN} onClick={onClose} disabled={busy}>
          닫기
        </button>
        <button type="button" className={BTN_PRIMARY} onClick={askThenSave} disabled={busy}>
          {busy ? "저장 중" : template ? "저장" : "등록"}
        </button>
      </div>

      {/*
        🔴 저장 **전에** 한 번 말한다 — 막지는 않는다(파일 머리말). 사람이 알고도 저장할 까닭이
        있다(부품은 먼저 담아 두고 고객사 품명은 나중에 정한다). 그래서 [이대로 저장] 이 있다.
        🔵 팝업은 DOM 부모의 CSS 를 물려받는다 — 상자에서 글 흐름을 다시 세운다.
      */}
      <dialog
        ref={confirmRef}
        className="w-full max-w-md whitespace-normal break-words rounded-lg border border-zinc-200 bg-white p-4 text-left text-zinc-900 backdrop:bg-black/40"
        onCancel={(e) => {
          e.preventDefault();
          setConfirming(false);
        }}
      >
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">고객사 품명이 없는 줄이 {noCustomerNameInDraft}개입니다.</h3>
          <p className="text-sm text-zinc-600">
            이대로 저장하면 견적서의 품명 칸이 비어 나갑니다. 재고 현황에서 그 부품의 고객사 품명을 먼저 정할 수
            있습니다.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setConfirming(false)}>
              취소
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => {
                setConfirming(false);
                void save();
              }}
            >
              이대로 저장
            </button>
          </div>
        </div>
      </dialog>
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
            「{template.name}」 템플릿을 지우겠습니까?
          </h3>
          <p className="text-xs text-zinc-500">
            부품 {template.items.length}종과 연결된 제품 모델 {template.models.length}개가 함께 숨겨집니다. 목록에서
            사라지고 되살리기 화면은 없습니다.
            {/* 🔴 숨긴 연결이 모델을 영영 붙잡아 두지 않는다(2026-10-16). 그 사실을 지우기 전에 말해 준다. */}
            {template.models.length > 0 &&
              " 숨긴 제품 모델은 나중에 다른 템플릿에 이을 수 있으며, 그때 이 템플릿의 연결은 풀립니다."}
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
