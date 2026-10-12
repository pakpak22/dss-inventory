"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { deletePartAction, type DeletePartState } from "@/app/actions/parts";

/**
 * 부품 삭제 (관리자, DESIGN 2-3절). 네이티브 <dialog> 안에서 사유를 받는다 (CLAUDE.md 9-3절).
 * 서버가 「수량이 남아 있음」 「기록이 있음」을 다시 검사한다 — 화면은 안내만 한다.
 */
export function DeletePartForm({ partId, partNo, quantity }: { partId: string; partNo: number; quantity: number }) {
  const [state, formAction, pending] = useActionState<DeletePartState, FormData>(deletePartAction, { error: null });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const blocked = quantity > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <section className="rounded-lg border border-red-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">삭제</h2>
      <p className="mt-1 text-xs text-zinc-500">
        입고·사용 기록이 없는 부품만 지울 수 있습니다. 잘못 적은 것은 삭제가 아니라 수정으로 고치십시오. 지운 부품은 목록에서 사라지고 되살리기 화면은 없습니다.
      </p>
      {blocked ? <p className="mt-2 text-xs text-red-700">수량이 {quantity}개 남아 있어 지울 수 없습니다.</p> : null}
      <button
        type="button"
        className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={blocked}
        onClick={() => setOpen(true)}
      >
        부품 삭제
      </button>

      <dialog
        ref={ref}
        className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <form
          onSubmit={(e) => {
            // 제출을 직접 다룬다 — <form action> 은 액션 뒤 폼을 초기화해 오류가 났을 때 적은 사유가 사라진다.
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => formAction(data));
          }}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="id" value={partId} />
          <h3 className="text-base font-semibold">No. {partNo} 부품을 지우겠습니까?</h3>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            삭제 사유 *
            <textarea name="reason" rows={3} required minLength={2} maxLength={500} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900" placeholder="예: 잘못 등록함 (No. 12 와 중복)" />
          </label>
          {state.error ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100" onClick={() => setOpen(false)} disabled={pending}>
              취소
            </button>
            <button type="submit" className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={pending}>
              {pending ? "지우는 중" : "지우기"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
