"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { cancelRequestAction, confirmRequestAction, rejectRequestAction, type RequestActionState } from "@/app/actions/stock";

const BTN = "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BTN_P = "rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50";
const EMPTY: RequestActionState = { error: null };

/** 담당자: [확인] 은 바로, [반려] 는 사유를 받는다. 신청자: [취소]. 제출은 직접 다룬다(폼 자동 초기화 방지). */
export function RequestActions({ requestId, canDecide, canCancel }: { requestId: string; canDecide: boolean; canCancel: boolean }) {
  const [confirmState, confirmAction, confirming] = useActionState<RequestActionState, FormData>(confirmRequestAction, EMPTY);
  const [rejectState, rejectAction, rejecting] = useActionState<RequestActionState, FormData>(rejectRequestAction, EMPTY);
  const [cancelState, cancelAction, cancelling] = useActionState<RequestActionState, FormData>(cancelRequestAction, EMPTY);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  const busy = confirming || rejecting || cancelling;
  const fd = () => {
    const f = new FormData();
    f.set("requestId", requestId);
    return f;
  };
  const error = confirmState.error ?? rejectState.error ?? cancelState.error;

  return (
    <div className="flex flex-wrap items-center gap-1.5 no-print">
      {canDecide ? (
        <>
          <button type="button" className={BTN_P} disabled={busy} onClick={() => startTransition(() => confirmAction(fd()))}>
            {confirming ? "확인 중" : "확인"}
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => setOpen(true)}>
            반려
          </button>
        </>
      ) : null}
      {canCancel ? (
        <button type="button" className={BTN} disabled={busy} onClick={() => startTransition(() => cancelAction(fd()))}>
          {cancelling ? "취소 중" : "신청 취소"}
        </button>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}

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
            const f = new FormData(e.currentTarget);
            f.set("requestId", requestId);
            startTransition(() => rejectAction(f));
          }}
          className="flex flex-col gap-3"
        >
          <h3 className="text-base font-semibold">이 신청을 반려하겠습니까?</h3>
          <p className="text-xs text-zinc-500">수량은 바뀌지 않습니다. 신청한 사람에게 사유가 보입니다.</p>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            사유 *
            <input name="note" required minLength={2} maxLength={500} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900" placeholder="예: 인수번호가 틀림, 수량 확인 필요" />
          </label>
          {rejectState.error ? <p className="text-sm text-red-600">{rejectState.error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100" onClick={() => setOpen(false)} disabled={rejecting}>
              돌아가기
            </button>
            <button type="submit" className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={rejecting}>
              {rejecting ? "반려 중" : "반려"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
