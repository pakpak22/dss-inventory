"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { saveCustomerNameAction, saveLimitQuantityAction, type CustomerNameState, type LimitQuantityState } from "@/app/actions/parts";
import { CATEGORY_LABEL, OWNER_LABEL, formatMoney, formatQuantity, isLowStock } from "@/lib/parts/codes";
import type { LegacyHistoryLine, PartYearlyRow, ProductUse } from "@/lib/legacy/queries";
import type { PartRow } from "@/lib/parts/types";
import { CHARGE_LABEL, ENTRY_TYPE_LABEL, formatDelta, sheetNoText } from "@/lib/stock/codes";
import type { PartHistoryLine } from "@/lib/stock/queries";

/**
 * 부품 상세 — 목록 위에 뜨는 창 (DESIGN 2-2절). 주소의 `part=No.` 가 열고 닫는다.
 *
 * 네이티브 <dialog> + showModal() (CLAUDE.md 9-3절). 라이브러리를 쓰지 않는다.
 * `onCancel`(Esc) 은 preventDefault 뒤 onClose — 브라우저가 창만 닫고 주소는 그대로 남는 어긋남을 막는다.
 *
 * 이력은 두 구역으로 가른다(DESIGN 2-2절): **이 프로그램에 쌓인 기록**(조각 4, 합계가 현재 수량과 맞는다)과
 * **전환일 이전 참고용**(조각 5, 엑셀에서 가져온 과거 기록 — 합계를 따로 내고 「수량 계산에 쓰지 않습니다」). 한 표에 섞지 않는다.
 * 전환일 글자는 설정값에서 온다(코드에 날짜 없음, DESIGN 10-3절 7번).
 */

/** 상세 창이 받는 자료 한 묶음. 서버가 `?part=No.` 일 때 읽어 내려준다. 창이 닫혀 있으면 전부 빈 값. */
export interface PartDetailData {
  history: PartHistoryLine[];
  legacy: LegacyHistoryLine[];
  yearly: PartYearlyRow[];
  /** 이 부품의 「소유 불일치」 과거 사용 기록 수 — 연도별 수량에서 뺀 것 */
  excludedLegacy: number;
  products: ProductUse[];
}
export const EMPTY_DETAIL: PartDetailData = { history: [], legacy: [], yearly: [], excludedLegacy: 0, products: [] };
export interface PartDetailDialogProps {
  part: PartRow | null;
  /** 주소에 No. 는 있는데 그 부품이 없을 때 (지워졌거나 잘못된 주소) */
  missingNo: number | null;
  /** 관리자면 [수정]·[변경 이력] 이 보인다. 실제 차단은 각 화면의 requireRole. */
  canEdit: boolean;
  /** 기록·관리자면 [반출]·[입고] 가 보인다. */
  canRecord: boolean;
  detail: PartDetailData;
  transitionDate: string | null;
  onClose: () => void;
}

const BTN = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BADGE = "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-700";

export function PartDetailDialog({ part, missingNo, canEdit, canRecord, detail, transitionDate, onClose }: PartDetailDialogProps) {
  const { history, legacy, yearly, excludedLegacy, products } = part === null ? EMPTY_DETAIL : detail;
  const ref = useRef<HTMLDialogElement>(null);
  const open = part !== null || missingNo !== null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      el.scrollTop = 0;
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, part?.id]);

  const sum = history.reduce((s, h) => s + h.delta, 0);

  return (
    <dialog
      ref={ref}
      className="w-full max-w-4xl rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 backdrop:bg-black/40"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // 창 바깥(backdrop)을 누르면 닫는다. 안쪽을 누른 것은 target 이 dialog 자신이 아니다.
        if (e.target === ref.current) onClose();
      }}
    >
      {part === null ? (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-900">부품 상세</h2>
            <button type="button" className={BTN} onClick={onClose}>
              닫기
            </button>
          </div>
          <p className="text-sm text-zinc-500">No. {missingNo} 부품이 없습니다. 지워졌거나 주소가 잘못되었습니다.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-base font-semibold text-zinc-900">
                {part.name}
                {part.name2 ? <span className="font-normal text-zinc-500"> · {part.name2}</span> : null}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                <span className={BADGE}>No. {part.no}</span>
                <span className={BADGE}>{part.itemName}</span>
                <span className={BADGE}>{CATEGORY_LABEL[part.category]}</span>
                <span className={BADGE}>{OWNER_LABEL[part.owner]}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {canRecord ? (
                <>
                  <Link href={`/entries/new?type=USE&part=${part.no}`} className={BTN}>
                    반출
                  </Link>
                  <Link href={`/entries/new?type=RECEIVE&part=${part.no}`} className={BTN}>
                    입고
                  </Link>
                </>
              ) : null}
              {canEdit ? (
                <>
                  <Link href={`/entries/new?type=ADJUST&part=${part.no}`} className={BTN} title="실물을 세어 보니 수량이 다를 때. 차이만큼 조정 기록이 남습니다.">
                    수량 조정
                  </Link>
                  <Link href={`/audit?part=${part.no}`} className={BTN}>
                    변경 이력
                  </Link>
                  <Link href={`/parts/${part.no}/edit`} className={BTN}>
                    수정
                  </Link>
                </>
              ) : null}
              <button type="button" className={BTN} onClick={onClose}>
                닫기
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500">수량</dt>
              <dd className="tabular">
                <b>{formatQuantity(part.quantity)}</b> 개
              </dd>
            </div>
            {/* 한계수량 — 재고가 이 수 이하가 되면 종에 뜬다. 수량 바로 옆에 둔다(견주는 두 수다). */}
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500">한계수량</dt>
              <dd>
                {/* key: 다른 부품으로 갈아타면 고치던 중이던 상태·입력값을 버린다 (고객사 품명과 같은 까닭) */}
                <LimitQuantityField key={part.id} partId={part.id} value={part.limitQuantity} quantity={part.quantity} canEdit={canEdit} />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500">교산 품번</dt>
              <dd className="font-mono text-xs">{part.kyosanPartNo || "-"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500">도번</dt>
              <dd className="font-mono text-xs">{part.drawingNo || "-"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500">공급가</dt>
              <dd className="tabular">{formatMoney(part.supplyPrice, part.supplyCurrency)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500">견적가</dt>
              <dd className="tabular">{formatMoney(part.quotePrice, "KRW")}</dd>
            </div>
            {/* 고객사에 나가는 서류(견적서)에 쓰는 이름. 우리 품명과 다르다 — 길 수 있어 두 칸을 쓴다. */}
            <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-3 lg:col-span-2">
              <dt className="text-xs text-zinc-500">고객사 품명</dt>
              <dd>
                {/* key: 다른 부품으로 갈아타면 고치던 중이던 상태·입력값을 버린다 */}
                <CustomerNameField key={part.id} partId={part.id} value={part.customerName} canEdit={canRecord} />
              </dd>
            </div>
          </dl>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-zinc-900">비고</h3>
            {part.note ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm whitespace-pre-wrap text-zinc-800">{part.note}</div>
            ) : (
              <p className="text-sm text-zinc-500">적힌 비고가 없습니다.</p>
            )}
          </section>

          <YearlyAndProducts yearly={yearly} excludedLegacy={excludedLegacy} products={products} />

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-900">
                {transitionDate ? <span className="font-normal text-zinc-500">전환일({transitionDate}) 이후 · </span> : null}이 프로그램에 쌓인 기록 {history.length}건
              </h3>
              {history.length > 0 ? (
                <span className="text-xs text-zinc-500">
                  증감 합계 <b className="tabular">{formatDelta(sum)}</b>
                  {" · "}
                  <Link href={`/entries?part=${part.no}`} className="underline">
                    기록 내역에서 보기
                  </Link>
                </span>
              ) : null}
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-zinc-500">아직 기록이 없습니다.{canRecord ? " 위의 [반출]·[입고] 로 첫 기록을 남길 수 있습니다." : ""}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-xs text-zinc-500">
                      <th className="px-2 py-1.5 font-medium whitespace-nowrap">날짜</th>
                      <th className="px-2 py-1.5 font-medium whitespace-nowrap">번호</th>
                      <th className="px-2 py-1.5 font-medium whitespace-nowrap">종류</th>
                      <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">증감</th>
                      <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">전 → 후</th>
                      <th className="px-2 py-1.5 font-medium">인수번호 · 사용처</th>
                      <th className="px-2 py-1.5 font-medium whitespace-nowrap">신청자 · 확인자</th>
                      <th className="px-2 py-1.5 font-medium">비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.transactionId} className={`border-b border-zinc-100 last:border-0 ${h.corrected ? "text-zinc-400 line-through" : ""}`}>
                        <td className="tabular px-2 py-1 whitespace-nowrap">{h.occurredOn}</td>
                        <td className="tabular px-2 py-1 whitespace-nowrap text-xs text-zinc-500">{sheetNoText(h.type, h.sheetYear, h.sheetNo)}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {ENTRY_TYPE_LABEL[h.type]}
                          {h.chargeType ? <span className="text-xs text-zinc-500"> {CHARGE_LABEL[h.chargeType]}</span> : null}
                        </td>
                        <td className="tabular px-2 py-1 text-right font-semibold whitespace-nowrap">{formatDelta(h.delta)}</td>
                        <td className="tabular px-2 py-1 text-right whitespace-nowrap text-xs text-zinc-500">
                          {h.quantityBefore} → {h.quantityAfter}
                        </td>
                        <td className="px-2 py-1 text-xs">
                          {h.usagePlace || h.intakeNumber || h.counterparty || ""}
                          {h.intakeUnverified ? <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 no-underline">확인 안 됨</span> : null}
                          {h.corrected ? <span className="ml-1 inline-flex items-center rounded-full bg-red-50 px-1.5 py-0.5 text-xs text-red-800 no-underline">취소됨</span> : null}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap text-xs">
                          {h.confirmedByName ? (
                            <>
                              신청자: <b>{h.createdByName}</b> · 확인자: <b>{h.confirmedByName}</b>
                            </>
                          ) : (
                            <>
                              기록자: <b>{h.createdByName}</b>
                            </>
                          )}
                        </td>
                        <td className="px-2 py-1 text-xs text-zinc-700">
                          {h.reason ? `${h.reason} ` : ""}
                          {h.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <LegacySection legacy={legacy} transitionDate={transitionDate} />
        </div>
      )}
    </dialog>
  );
}

/* ───────────── 고객사 품명 — 이 칸만 STAFF 이상이 그 자리에서 고친다 ───────────── */

const SMALL_BTN = "rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const EMPTY_CUSTOMER_NAME_STATE: CustomerNameState = { error: null, saveCount: 0 };

/**
 * 고객사 품명만 고치는 자리 (2026-10-14 사용자 결정 (다)).
 *
 * 왜 [수정] 화면으로 안 보내는가: 그 화면은 **ADMIN 전용**이고 이 칸만 **STAFF 이상**이다.
 * 부품 수정 전체의 가드를 내리면 품명·단가까지 열리므로, 이 칸만 고치는 길을 여기 따로 뒀다.
 *
 * 🔴 보이기 판정에 `canRecord`(= `roleAtLeast(role, "STAFF")`, `(app)/page.tsx`)를 **그대로 쓴다.**
 *    문턱이 똑같고, 새 prop 을 내리려면 `PartsList` 를 고쳐야 하는데 그 파일은 조각 2 의 것이다.
 *    🔴 이것은 **화면에 보일지**만 정한다 — 진짜 차단은 서버 액션의 `requireRole("STAFF")` 다 (CLAUDE.md 8-4절).
 */
function CustomerNameField({ partId, value, canEdit }: { partId: string; value: string; canEdit: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<CustomerNameState, FormData>(saveCustomerNameAction, EMPTY_CUSTOMER_NAME_STATE);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // 저장이 끝나면 고치던 칸을 닫는다. 새 저장을 알아채는 열쇠는 saveCount (EntryForm.tsx 와 같은 꼴 —
  // 효과 안에서 setState 하지 않고 **렌더 중에 상태를 맞춘다**. 효과로 하면 렌더가 한 번 더 돈다).
  const [seenSaveCount, setSeenSaveCount] = useState(0);
  if (state.saveCount !== seenSaveCount) {
    setSeenSaveCount(state.saveCount);
    setEditing(false);
  }

  // 🔴 함정: 그 자리에 남으면 **자료를 다시 읽어야** 방금 저장한 값이 보인다. 안 읽으면 상세·목록에 옛 값이 남는다
  //    (조각 4 에서 같은 함정을 밟았다 — CLAUDE.md 「저장 뒤 그 자리에 남기」).
  useEffect(() => {
    if (seenSaveCount !== 0) router.refresh();
  }, [seenSaveCount, router]);

  // 🔴 <form action={formAction}> 로 보내면 React 19 가 끝난 뒤 폼을 초기화한다. 제출을 직접 다루면 초기화가 없다
  //    (PartForm.tsx 에 적어 둔 같은 함정). 오류로 되돌아왔을 때 치던 글자가 사라지면 안 된다.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  if (!editing) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span>{value || <span className="text-zinc-400">-</span>}</span>
        {canEdit ? (
          <button
            type="button"
            className={SMALL_BTN}
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            title="고객사에 나가는 서류(견적서)에 쓰는 이름입니다. 기록·관리자가 고칠 수 있습니다."
          >
            수정
          </button>
        ) : null}
        {state.error ? (
          <span role="alert" className="text-xs text-red-600">
            {state.error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={partId} />
      <span className="flex flex-wrap items-center gap-1.5">
        <input
          name="customerName"
          aria-label="고객사 품명"
          className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          placeholder="없으면 비움"
          autoFocus
        />
        <button type="submit" className={SMALL_BTN} disabled={pending}>
          {pending ? "저장 중" : "저장"}
        </button>
        <button
          type="button"
          className={SMALL_BTN}
          disabled={pending}
          onClick={() => {
            setDraft(value);
            setEditing(false);
          }}
        >
          취소
        </button>
      </span>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/* ───────────── 한계수량 — 이 칸만 ADMIN 이 그 자리에서 고친다 (2026-10-16) ───────────── */

const EMPTY_LIMIT_QUANTITY_STATE: LimitQuantityState = { error: null, saveCount: 0 };

/**
 * 한계수량만 고치는 자리 (2026-10-16 사용자 요청: 「부품 상세에서 한계수량을 설정할 수 있도록」).
 *
 * 🔴 **바로 위 `CustomerNameField` 와 같은 결로 만든다** — 수정 → 칸 → 저장/취소, 저장이 끝나면
 *    칸을 닫고 `router.refresh()`. 함정 둘(렌더 중 상태 맞추기 · 폼 자동 초기화 피하기)도 같다.
 * 🔴 **다른 점은 자격뿐이다.** 고객사 품명은 기록(STAFF) 이상이지만(2026-10-14 결정) 한계수량은
 *    **관리자(ADMIN)** 다 — 그래서 `canRecord` 가 아니라 `canEdit` 를 본다. 진짜 차단은 서버 액션의
 *    `requireRole("ADMIN")` 이고 이것은 **화면에 보일지**만 정한다 (CLAUDE.md 8-4절).
 *
 * 🔵 값이 없을 때 「-」 가 아니라 **「없음」**이라고 적는다. 이 칸의 빈 값은 「모른다」가 아니라
 *    **정하지 않아 알리지 않는다**는 뜻이고, `0`(「하나도 안 남으면 알려라」)과 다른 값이다.
 *    🔴 **`0` 은 끄는 값이 아니다** — 부등호가 「이하」라 재고가 0 이면 울린다(2026-10-16 결정).
 *
 * 🔴 **「부족」 딱지는 종이 쓰는 그 함수(`isLowStock`)로 붙인다.** 여기에 `quantity < value` 를 손으로
 *    적어 두었다가 부등호가 「이하」로 바뀐 날 한쪽만 고칠 뻔했다 — 그러면 「상세엔 부족이라는데
 *    종은 조용하다」가 된다. 적는 자리는 `lib/parts/codes.ts` 하나다.
 */
function LimitQuantityField({ partId, value, quantity, canEdit }: { partId: string; value: number | null; quantity: number; canEdit: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LimitQuantityState, FormData>(saveLimitQuantityAction, EMPTY_LIMIT_QUANTITY_STATE);
  const [editing, setEditing] = useState(false);
  // 🔴 `null` 만 빈 칸이다. `0` 은 "0" 으로 그린다 — 뭉개면 「0 으로 정함」이 「정하지 않음」으로 바뀐다.
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  const [seenSaveCount, setSeenSaveCount] = useState(0);
  if (state.saveCount !== seenSaveCount) {
    setSeenSaveCount(state.saveCount);
    setEditing(false);
  }

  useEffect(() => {
    if (seenSaveCount !== 0) router.refresh();
  }, [seenSaveCount, router]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  if (!editing) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {value === null ? (
          <span className="text-zinc-400" title="한계수량을 정하지 않았습니다. 이 부품은 재고가 줄어도 알리지 않습니다.">
            없음
          </span>
        ) : (
          <span className="tabular">
            <b>{formatQuantity(value)}</b> 개
            {isLowStock(quantity, value) ? <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">부족</span> : null}
          </span>
        )}
        {canEdit ? (
          <button
            type="button"
            className={SMALL_BTN}
            onClick={() => {
              setDraft(value === null ? "" : String(value));
              setEditing(true);
            }}
            title="재고가 한계수량과 같거나 적어지면 알림 종에 뜹니다. 알리지 않으려면 비워 두십시오(0 은 「하나도 안 남으면 알려라」입니다). 관리자가 고칠 수 있습니다."
          >
            수정
          </button>
        ) : null}
        {state.error ? (
          <span role="alert" className="text-xs text-red-600">
            {state.error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={partId} />
      <span className="flex flex-wrap items-center gap-1.5">
        <input
          name="limitQuantity"
          inputMode="numeric"
          aria-label="한계수량"
          className="tabular min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-right text-sm text-zinc-900"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="없으면 비움"
          autoFocus
        />
        <button type="submit" className={SMALL_BTN} disabled={pending}>
          {pending ? "저장 중" : "저장"}
        </button>
        <button
          type="button"
          className={SMALL_BTN}
          disabled={pending}
          onClick={() => {
            setDraft(value === null ? "" : String(value));
            setEditing(false);
          }}
        >
          취소
        </button>
      </span>
      {/* 🔴 「끄려면 비운다」를 고치는 자리에도 적는다 — 0 을 끄기로 쓰는 오해가 여기서 생긴다. */}
      <span className="text-xs text-zinc-500">재고가 이 수와 같거나 적어지면 알립니다. 알리지 않으려면 비워 두십시오.</span>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/* ───────────── 조각 5: 연도별 입고·사용 수량 + 사용된 제품 ───────────── */

function YearlyAndProducts({ yearly, excludedLegacy, products }: { yearly: PartYearlyRow[]; excludedLegacy: number; products: ProductUse[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">연도별 입고·사용 수량</h3>
        {yearly.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 입고·사용 기록이 없습니다.</p>
        ) : (
          <table className="w-full max-w-sm border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-xs text-zinc-500">
                <th className="px-2 py-1.5 font-medium">연도</th>
                <th className="px-2 py-1.5 text-right font-medium">입고</th>
                <th className="px-2 py-1.5 text-right font-medium">사용</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => (
                <tr key={y.year} className="border-b border-zinc-100 last:border-0">
                  <td className="tabular px-2 py-1">{y.year}년</td>
                  <td className="tabular px-2 py-1 text-right">{y.received === 0 ? <span className="text-zinc-400">0</span> : formatQuantity(y.received)}</td>
                  <td className="tabular px-2 py-1 text-right font-semibold">{y.used === 0 ? <span className="text-zinc-400">0</span> : formatQuantity(y.used)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-zinc-500">
          원장의 사용(반환·취소 뺌)과 확인된 과거 기록을 더한 것입니다. 대여는 넣지 않습니다.
          {excludedLegacy > 0 ? <span className="text-amber-800"> 확인되지 않은 과거 기록 {excludedLegacy}건 제외.</span> : null}
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">사용된 제품</h3>
        {products.length === 0 ? (
          <p className="text-sm text-zinc-500">인수번호로 찾은 기종이 없습니다.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {products.map((p) => (
              <li key={p.model} className={BADGE}>
                {p.model} <b className="tabular ml-1">×{p.count}</b>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">인수번호로 찾은 기종별 사용 건수입니다.</p>
      </section>
    </div>
  );
}

/* ───────────── 조각 5: 전환일 이전 — 엑셀에서 가져온 과거 기록 (참고용) ───────────── */

const LEGACY_SHEET_LABEL = { USE: "사용처", RECEIVE: "입고" } as const;

/**
 * 소유 불일치(OWNER_MISMATCH) 줄은 **보이지 않는다** (2026-10-07 사용자: 「헷갈리니까 안 보여 주는 게 낫다」). 연도별 수량에서도 빠진 줄이라
 * 이 부품의 이력으로 보이면 숫자와 어긋나 보인다. DB 에는 그대로 있고(부품에 붙여 둠), 건수만 한 줄로 알린다.
 * 나중에 「사용 부품 통계」(소유와 상관없이 품명 단위로 통합)를 만들 때 이 줄들이 거기서 다시 쓰인다 (REQUIREMENTS 「나중에 붙일 화면」).
 */
function LegacySection({ legacy, transitionDate }: { legacy: LegacyHistoryLine[]; transitionDate: string | null }) {
  const shown = legacy.filter((l) => l.matchStatus !== "OWNER_MISMATCH");
  const usedSum = shown.filter((l) => l.sheet === "USE").reduce((s, l) => s + (l.quantity ?? 0), 0);
  const receivedSum = shown.filter((l) => l.sheet === "RECEIVE").reduce((s, l) => s + (l.quantity ?? 0), 0);
  const hidden = legacy.length - shown.length;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-700">
          {transitionDate ? `전환일(${transitionDate}) 이전` : "전환일 이전"} <span className="font-normal text-zinc-500">· 엑셀에서 가져온 과거 기록 {shown.length}건 (참고용)</span>
        </h3>
        {shown.length > 0 ? (
          <span className="text-xs text-zinc-500">
            사용 합계 <b className="tabular">{formatQuantity(usedSum)}</b> · 입고 합계 <b className="tabular">{formatQuantity(receivedSum)}</b>
          </span>
        ) : null}
      </div>
      <p className="text-xs text-zinc-500">
        엑셀 사용처·입고 기입란의 줄을 적힌 그대로 둔 것입니다. <b>수량 계산에 쓰지 않습니다</b> — 엑셀의 현 재고·이후 재고가 서로 안 맞는 곳이 있어 더해도 지금 수량이 나오지 않습니다.
        담당자 이름도 엑셀 글자 그대로입니다.
        {hidden > 0 ? ` 소유가 맞지 않아 참고로만 붙여 둔 ${hidden}건은 여기에 보이지 않습니다.` : ""}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">{transitionDate ? "이 부품은 엑셀에 과거 기록이 없습니다." : "아직 실제 자료를 넣기 전입니다(전환 전)."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-xs text-zinc-500">
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">날짜</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">시트 · No.</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">인수번호</th>
                <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">수량</th>
                <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">현 → 이후</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">목적 및 출하담당</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">유상·무상</th>
                <th className="px-2 py-1.5 font-medium">사용처</th>
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">소유</th>
                <th className="px-2 py-1.5 font-medium">비고</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} className="border-b border-zinc-100 last:border-0">
                  <td className="tabular px-2 py-1 whitespace-nowrap">{l.occurredOn ?? <span className="text-amber-800" title={l.anomaly}>{l.dateText || "-"}</span>}</td>
                  <td className="tabular px-2 py-1 text-xs whitespace-nowrap text-zinc-500">
                    {LEGACY_SHEET_LABEL[l.sheet]}
                    {l.sheetNo !== null ? ` No. ${l.sheetNo}` : ""}
                  </td>
                  <td className="px-2 py-1 font-mono text-xs whitespace-nowrap">{l.intakeNumber || "-"}</td>
                  <td className="tabular px-2 py-1 text-right font-semibold whitespace-nowrap">
                    {l.quantity === null ? <span className="text-amber-800" title={l.anomaly}>?</span> : l.sheet === "USE" ? `−${formatQuantity(l.quantity)}` : `+${formatQuantity(l.quantity)}`}
                  </td>
                  <td className="tabular px-2 py-1 text-right text-xs whitespace-nowrap text-zinc-500">
                    {l.stockBefore ?? "?"} → {l.stockAfter ?? "?"}
                  </td>
                  <td className="px-2 py-1 text-xs whitespace-nowrap">{l.purposeText || "-"}</td>
                  <td className="px-2 py-1 text-xs whitespace-nowrap">{l.chargeText || "-"}</td>
                  <td className="px-2 py-1 font-mono text-xs">{l.usagePlace || "-"}</td>
                  <td className="px-2 py-1 text-xs whitespace-nowrap">
                    {l.ownerText || "-"}
                    {l.matchStatus === "GROUP_DECIDED" ? (
                      <span className="ml-1 inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700" title={l.matchNote}>
                        묶음 판정
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1 text-xs text-zinc-700">{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
