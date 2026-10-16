"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { savePartAction, type PartFormState } from "@/app/actions/parts";
import { CATEGORIES, CATEGORY_LABEL, CURRENCIES, CURRENCY_SIGN, OWNERS, OWNER_LABEL, formatQuantity } from "@/lib/parts/codes";
import type { PartFormValues } from "@/lib/parts/form";
import type { PartItemRow } from "@/lib/parts/types";

/**
 * 부품 등록·수정 폼 (DESIGN 2-3절). 등록과 수정이 같은 폼이고 숨은 `id` 로 갈린다.
 *
 * - No. 와 수량은 폼에 없다. No. 는 프로그램이 매기고, 수량은 조정 기록으로만 바뀐다.
 * - 저장할 때 품명·품명2·도번·소유가 같은 부품이 있으면 서버가 목록을 돌려주고, 여기서 보여 준 뒤
 *   「그래도 저장」을 눌러야 `confirmDuplicate=1` 과 함께 다시 보낸다.
 * - 라벨은 입력 위, 필수는 ` *` (CLAUDE.md 10절). 입력값은 로컬 state 로 들고 있어 되돌아와도 지워지지 않는다.
 */
export interface PartFormProps {
  items: PartItemRow[];
  initial: PartFormValues;
  /** 수정이면 부품 id, 등록이면 null */
  partId: string | null;
  partNo: number | null;
  quantity: number | null;
}

const INPUT = "rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 disabled:bg-zinc-50";
const INPUT_ERR = "border-red-400";
const LABEL = "flex flex-col gap-1 text-xs text-zinc-500";
const BTN = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BTN_PRIMARY = "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50";
const EMPTY_PART_FORM_STATE: PartFormState = { errors: {}, duplicates: [], values: null };

function Err({ msg }: { msg?: string }) {
  return msg ? <span className="text-xs text-red-600">{msg}</span> : null;
}

export function PartForm({ items, initial, partId, partNo, quantity }: PartFormProps) {
  const [state, formAction, pending] = useActionState<PartFormState, FormData>(savePartAction, EMPTY_PART_FORM_STATE);
  const [v, setV] = useState<PartFormValues>(initial);
  const set = (k: keyof PartFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((prev) => ({ ...prev, [k]: e.target.value }));
  const err = state.errors;
  const hasDup = state.duplicates.length > 0;

  // 🔴 <form action={formAction}> 로 보내면 React 19 가 액션이 끝난 뒤 폼을 **자동으로 초기화**한다.
  //    같은 이름 경고가 돌아왔을 때 고르기 상자가 비어 버려 사람이 다시 고르다 틀릴 수 있다(2026-10-06 확인).
  //    제출을 직접 다루면 초기화가 없다. 입력값은 로컬 state 가 그대로 들고 있다.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {partId ? <input type="hidden" name="id" value={partId} /> : null}

      {err.form ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err.form}
        </p>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">부품 정보</h2>
        {partNo !== null ? (
          <p className="mt-1 text-xs text-zinc-500">
            No. {partNo} · 현재 수량 {quantity === null ? "-" : formatQuantity(quantity)}개. No. 와 수량은 여기서 고치지 않습니다 — 수량은 조정 기록으로만 바뀝니다.
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">No. 는 저장할 때 프로그램이 매깁니다. 처음 수량은 등록 뒤 수량 변경 기록(조각 4)으로 넣습니다.</p>
        )}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className={LABEL}>
            품명 *
            <input name="name" className={`${INPUT} ${err.name ? INPUT_ERR : ""}`} value={v.name} onChange={set("name")} maxLength={200} required autoFocus />
            <Err msg={err.name} />
          </label>
          <label className={LABEL}>
            품명2
            <input name="name2" className={`${INPUT} ${err.name2 ? INPUT_ERR : ""}`} value={v.name2} onChange={set("name2")} maxLength={200} />
            <Err msg={err.name2} />
          </label>
          <label className={LABEL}>
            고객사 품명
            <input name="customerName" className={`${INPUT} ${err.customerName ? INPUT_ERR : ""}`} value={v.customerName} onChange={set("customerName")} maxLength={200} placeholder="없으면 비움" />
            <Err msg={err.customerName} />
          </label>
          <label className={LABEL}>
            교산 품번
            <input name="kyosanPartNo" className={`${INPUT} font-mono ${err.kyosanPartNo ? INPUT_ERR : ""}`} value={v.kyosanPartNo} onChange={set("kyosanPartNo")} maxLength={200} />
            <Err msg={err.kyosanPartNo} />
          </label>
          <label className={LABEL}>
            도번
            <input name="drawingNo" className={`${INPUT} font-mono ${err.drawingNo ? INPUT_ERR : ""}`} value={v.drawingNo} onChange={set("drawingNo")} maxLength={200} />
            <Err msg={err.drawingNo} />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-500">고객사 품명은 고객사에 나가는 서류(견적서)에 쓰는 이름입니다. 우리 품명과 달라도 됩니다.</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">구분</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className={LABEL}>
            항목 *
            <select name="itemId" className={`${INPUT} ${err.itemId ? INPUT_ERR : ""}`} value={v.itemId} onChange={set("itemId")} required>
              <option value="">고르십시오</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <Err msg={err.itemId} />
          </label>
          <label className={LABEL}>
            분류 *
            <select name="category" className={`${INPUT} ${err.category ? INPUT_ERR : ""}`} value={v.category} onChange={set("category")} required>
              <option value="">고르십시오</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <Err msg={err.category} />
          </label>
          <label className={LABEL}>
            소유 *
            <select name="owner" className={`${INPUT} ${err.owner ? INPUT_ERR : ""}`} value={v.owner} onChange={set("owner")} required>
              <option value="">고르십시오</option>
              {OWNERS.map((o) => (
                <option key={o} value={o}>
                  {OWNER_LABEL[o]}
                </option>
              ))}
            </select>
            <Err msg={err.owner} />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-500">같은 부품이라도 소유가 다르면 다른 No. 로 따로 등록합니다.</p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">가격</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className={LABEL}>
            공급가
            <div className="flex gap-2">
              <select name="supplyCurrency" className={`${INPUT} ${err.supplyCurrency ? INPUT_ERR : ""}`} value={v.supplyCurrency} onChange={set("supplyCurrency")} aria-label="공급가 통화">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_SIGN[c]} {c === "JPY" ? "엔" : "원"}
                  </option>
                ))}
              </select>
              <input name="supplyPrice" inputMode="numeric" className={`${INPUT} tabular flex-1 text-right ${err.supplyPrice ? INPUT_ERR : ""}`} value={v.supplyPrice} onChange={set("supplyPrice")} placeholder="없으면 비움" />
            </div>
            <Err msg={err.supplyPrice ?? err.supplyCurrency} />
          </label>
          <label className={LABEL}>
            견적가 (₩)
            <input name="quotePrice" inputMode="numeric" className={`${INPUT} tabular text-right ${err.quotePrice ? INPUT_ERR : ""}`} value={v.quotePrice} onChange={set("quotePrice")} placeholder="없으면 비움" />
            <Err msg={err.quotePrice} />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-500">엔이 기본이고 국내 구매품만 원입니다. 견적가는 항상 원입니다.</p>
      </section>

      {/*
        재고 알림 (2026-10-16 사용자 요청). 가격 칸들과 **따로 둔 까닭**: 돈이 아니라 수량이고,
        이 칸 하나가 「알림이 뜨느냐 마느냐」를 정하는 설정이라 설명 한 줄이 반드시 따라붙어야 한다.
        🔴 비우면 `null`(정하지 않음)이고, 그 부품은 알림 대상이 아니다 — 0 과 다르다(lib/parts/form.ts).
      */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">재고 알림</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className={LABEL}>
            한계수량
            <input
              name="limitQuantity"
              inputMode="numeric"
              className={`${INPUT} tabular text-right ${err.limitQuantity ? INPUT_ERR : ""}`}
              value={v.limitQuantity}
              onChange={set("limitQuantity")}
              placeholder="없으면 비움"
            />
            <Err msg={err.limitQuantity} />
          </label>
        </div>
        {/* 🔴 「같을 때도」와 「0 도 알린다」를 둘 다 적는다 — 둘 다 2026-10-16 에 뜻이 바뀐 자리이고,
            설명이 반만 맞으면 사람이 0 을 「끄기」로 쓴다(끄는 길은 비우는 것 하나뿐이다). */}
        <p className="mt-2 text-xs text-zinc-500">
          재고가 한계수량과 <b>같거나 적어지면</b> 머리말의 알림 종에 뜹니다. 0 을 적으면 재고가 하나도 남지 않았을 때 알립니다. <b>알리지 않으려면 비워 두십시오</b> — 비운 부품은 알리지 않습니다.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <label className={LABEL}>
          비고
          <textarea name="note" rows={4} className={`${INPUT} ${err.note ? INPUT_ERR : ""}`} value={v.note} onChange={set("note")} maxLength={4000} placeholder="엑셀의 비고 칸과 같습니다. 여러 줄을 쓸 수 있습니다." />
          <Err msg={err.note} />
        </label>
      </section>

      {hasDup ? (
        <section role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <h2 className="text-sm font-semibold">같은 이름의 부품이 이미 있습니다</h2>
          <p className="mt-1 text-xs">
            「같은 부품」은 품명·품명2·도번·소유가 전부 같은 것, 「품명만 같음」은 나머지가 다른 것입니다. 구입 명목이 달라 따로 세는 것이면 그대로 저장하고, 아니면 취소한 뒤 그 부품을 수정하십시오.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {state.duplicates.map((d) => (
              <li key={d.no} className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-medium whitespace-nowrap">No. {d.no}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${d.exact ? "bg-red-100 text-red-800" : "bg-amber-200 text-amber-900"}`}>
                  {d.exact ? "같은 부품" : "품명만 같음"}
                </span>
                <span className="font-medium">{d.name}</span>
                {d.name2 ? <span>· {d.name2}</span> : null}
                {d.drawingNo ? <span className="font-mono text-xs">{d.drawingNo}</span> : null}
                <span>· {OWNER_LABEL[d.owner]}</span>
                <span className="tabular">· 수량 {formatQuantity(d.quantity)}</span>
                <Link href={`/?part=${d.no}`} className="text-xs underline" target="_blank">
                  보기
                </Link>
              </li>
            ))}
          </ul>
          <input type="hidden" name="confirmDuplicate" value="1" />
        </section>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Link href={partNo === null ? "/" : `/?part=${partNo}`} className={BTN}>
          취소
        </Link>
        <button type="submit" className={hasDup ? `${BTN_PRIMARY} bg-amber-700 hover:bg-amber-800` : BTN_PRIMARY} disabled={pending}>
          {pending ? "저장 중" : hasDup ? "그래도 저장" : "저장"}
        </button>
      </div>
    </form>
  );
}
