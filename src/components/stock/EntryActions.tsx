"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { correctTransactionAction, reverifyIntakeAction, type CorrectState, type ReverifyState } from "@/app/actions/stock";

const BTN_SMALL = "rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";

/** [기록 취소] (관리자, DESIGN 2-5절): 사유를 받아 되돌리는 줄을 쌓는다. 원래 줄은 지워지지 않는다. */
export function CorrectButton({ transactionId, label }: { transactionId: string; label: string }) {
  const [state, action, pending] = useActionState<CorrectState, FormData>(correctTransactionAction, { error: null });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  return (
    <>
      <button type="button" className={BTN_SMALL} onClick={() => setOpen(true)}>
        기록 취소
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
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => action(fd));
          }}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="transactionId" value={transactionId} />
          <h3 className="text-base font-semibold">이 줄을 취소하겠습니까?</h3>
          <p className="text-sm text-zinc-600">{label}</p>
          <p className="text-xs text-zinc-500">원래 줄은 지워지지 않고 「취소됨」 표시가 붙습니다. 이것을 되돌리는 줄이 오늘 날짜의 기록 취소로 새로 쌓입니다. 한 줄은 한 번만 취소합니다.</p>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            사유 *
            <input name="reason" required minLength={2} maxLength={500} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900" placeholder="예: 수량을 잘못 적음 (3 → 2)" />
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
              {pending ? "쌓는 중" : "기록 취소"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** [확인] (기록·관리자): 「인수번호 확인 안 됨」 기록을 A/S 에 다시 묻는다. */
export function ReverifyButton({ entryId }: { entryId: string }) {
  const [state, action, pending] = useActionState<ReverifyState, FormData>(reverifyIntakeAction, { message: null, ok: false });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className={BTN_SMALL}
        disabled={pending || state.ok}
        onClick={() => {
          const fd = new FormData();
          fd.set("entryId", entryId);
          startTransition(() => action(fd));
        }}
      >
        {pending ? "확인 중" : "확인"}
      </button>
      {state.message ? <span className={`text-xs ${state.ok ? "text-zinc-700" : "text-red-600"}`}>{state.message}</span> : null}
    </span>
  );
}
