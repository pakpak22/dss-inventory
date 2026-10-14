"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { cancelRequestAction, closeRequestAction, confirmRequestAction, rejectRequestAction, type RequestActionState } from "@/app/actions/stock";
import type { ClaimableRequestStatus } from "@/lib/stock/codes";

const BTN = "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BTN_P = "rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50";
const DIALOG = "w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40";
const FIELD = "rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900";
const EMPTY: RequestActionState = { error: null };

/**
 * 요청 한 줄. 🔵 `RequestLineView`(server-only 인 `src/lib/stock/requests.ts`)와 **같은 모양**을 여기 따로 적는다 —
 * 클라이언트 묶음이 server-only 파일을 끌어오지 않게. 칸이 늘면 양쪽을 같이 고친다.
 */
export interface RequestActionLine {
  partId: string;
  partNo: number | null;
  partName: string;
  /** 신청한 수량 */
  quantity: number;
  /** 이미 나간 수량 */
  issued: number;
}

/** 그 줄에 아직 안 나간 수량. 🔴 음수로 흐르지 않게 막는다(기록 취소 등으로 어긋나도 화면이 깨지지 않게). */
function remainingOf(l: RequestActionLine): number {
  return Math.max(0, l.quantity - l.issued);
}

function labelOf(l: RequestActionLine): string {
  return l.partNo !== null ? `No. ${l.partNo} ${l.partName}` : l.partName;
}

/**
 * 네이티브 dialog 하나. 🔵 열릴 때마다 속을 **다시 그린다**(`open ? children : null`) — 지난번에 친 수량·사유가
 * 남아 있으면 다음 회차에 그대로 나갈 뻔한다.
 */
function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={DIALOG}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}

/**
 * 담당자: [확인] 은 **줄별로 이번에 줄 수량**을 받고(조각 4d), [반려] 는 사유를, [마감] 은 남은 것을 접는 사유를 받는다.
 * 신청자: [신청 취소]. 제출은 직접 다룬다(폼 자동 초기화 방지).
 *
 * 🔴 **[반려]와 [마감]이 갈린다.** 반려는 아직 아무것도 안 나간 신청(PENDING)만 받고(`rejectRequest` 의 WHERE),
 *    마감은 일부 나간 신청(PARTIAL)만 받는다(`closeRequest`). 둘 다 그리면 눌러도 거절당하는 단추가 생긴다.
 * 🔴 **[신청 취소]도 PENDING 뿐이다** — 부품이 이미 나간 신청은 신청자가 거둘 수 없다(부르는 쪽이 `canCancel` 로 가린다).
 */
export function RequestActions({
  requestId,
  status,
  lines,
  canDecide,
  canCancel,
}: {
  requestId: string;
  /** 지금 상태 — 🔵 **집을 수 있는 둘(PENDING·PARTIAL) 중 하나임이 타입으로 보증된다**(`isClaimableRequest` 가 좁혀 준다). */
  status: ClaimableRequestStatus;
  lines: readonly RequestActionLine[];
  canDecide: boolean;
  canCancel: boolean;
}) {
  const [confirmState, confirmAction, confirming] = useActionState<RequestActionState, FormData>(confirmRequestAction, EMPTY);
  const [rejectState, rejectAction, rejecting] = useActionState<RequestActionState, FormData>(rejectRequestAction, EMPTY);
  const [cancelState, cancelAction, cancelling] = useActionState<RequestActionState, FormData>(cancelRequestAction, EMPTY);
  const [closeState, closeAction, closing] = useActionState<RequestActionState, FormData>(closeRequestAction, EMPTY);
  const [open, setOpen] = useState<null | "issue" | "reject" | "close">(null);
  /** 보내기 전에 화면에서 거른 것(서버도 같은 것을 다시 본다 — `buildIssueInput`). */
  const [issueError, setIssueError] = useState<string | null>(null);

  const busy = confirming || rejecting || cancelling || closing;
  const canClose = canDecide && status === "PARTIAL";
  const canReject = canDecide && status === "PENDING";
  const issuedTotal = lines.reduce((a, l) => a + Math.min(l.quantity, l.issued), 0);
  const remainingTotal = lines.reduce((a, l) => a + remainingOf(l), 0);
  const error = confirmState.error ?? rejectState.error ?? cancelState.error ?? closeState.error;

  const fd = () => {
    const f = new FormData();
    f.set("requestId", requestId);
    return f;
  };

  /**
   * 「이번에 줄 수량」 보내기.
   *
   * 🔴 **칸을 하나도 안 적었으면 `quantities` 를 아예 안 보낸다** — 서버가 그때 「남은 수량 전부」로 읽고(조각 4b),
   *    그것이 화면이 생기기 전의 동작 그대로다. 한 칸이라도 적었으면 **빈 칸은 그 줄의 남은 수량**으로 채워 보낸다
   *    (상자 머리말에 적은 뜻과 같다). 안 줄 줄에는 사람이 0 을 적는다.
   */
  const submitIssue = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const typed = lines.map((l) => ({ line: l, raw: String(form.get(`q:${l.partId}`) ?? "").trim() }));
    const out = fd();
    out.set("issueNote", String(form.get("issueNote") ?? ""));
    if (typed.some((t) => t.raw !== "")) {
      const quantities: Array<{ partId: string; quantity: number }> = [];
      for (const { line, raw } of typed) {
        const left = remainingOf(line);
        const n = raw === "" ? left : Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > left) {
          setIssueError(`${labelOf(line)}: 0 부터 ${left} 까지 적을 수 있습니다.`);
          return;
        }
        quantities.push({ partId: line.partId, quantity: n });
      }
      if (quantities.every((q) => q.quantity === 0)) {
        setIssueError("이번에 내줄 수량이 없습니다. 적어도 한 줄에 1 이상을 적으십시오.");
        return;
      }
      out.set("quantities", JSON.stringify(quantities));
    }
    setIssueError(null);
    startTransition(() => confirmAction(out));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 no-print">
      {canDecide ? (
        <button
          type="button"
          className={BTN_P}
          disabled={busy}
          onClick={() => {
            // 🔵 지난번에 거른 문구를 지우고 연다 — 상자를 다시 열었을 때 옛 오류가 남아 있으면 안 된다.
            setIssueError(null);
            setOpen("issue");
          }}
        >
          {confirming ? "내주는 중" : "확인"}
        </button>
      ) : null}
      {canReject ? (
        <button type="button" className={BTN} disabled={busy} onClick={() => setOpen("reject")}>
          반려
        </button>
      ) : null}
      {canClose ? (
        <button type="button" className={BTN} disabled={busy} onClick={() => setOpen("close")}>
          마감(남은 것 그만 주기)
        </button>
      ) : null}
      {canCancel ? (
        <button type="button" className={BTN} disabled={busy} onClick={() => startTransition(() => cancelAction(fd()))}>
          {cancelling ? "취소 중" : "신청 취소"}
        </button>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}

      {/* ① 확인 = 이번 회차 불출 — 줄별 수량 */}
      <Modal open={open === "issue"} onClose={() => setOpen(null)}>
        <form onSubmit={submitIssue} className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">이번에 내줄 수량</h3>
          <p className="text-xs text-zinc-500">
            칸을 <b>비워 두면 그 줄의 남은 수량 전부</b>를 내줍니다. 이번에 안 줄 줄에는 <b>0</b> 을 적으십시오. 남은 수량이 있으면 이 신청은 <b>확인 대기에 그대로 남습니다.</b>
          </p>
          <ul className="flex flex-col gap-1.5">
            {lines.map((l) => (
              <li key={l.partId} className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-1.5 last:border-0">
                <span className="text-sm text-zinc-800">
                  {labelOf(l)}{" "}
                  <span className="text-xs text-zinc-500">
                    요청 {l.quantity}
                    {l.issued > 0 ? ` 중 ${Math.min(l.quantity, l.issued)} 나감 · ${remainingOf(l)} 남음` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    name={`q:${l.partId}`}
                    min={0}
                    max={remainingOf(l)}
                    step={1}
                    inputMode="numeric"
                    placeholder={String(remainingOf(l))}
                    aria-label={`${labelOf(l)} 이번에 내줄 수량`}
                    className={`${FIELD} tabular w-24 text-right`}
                  />
                  <span className="text-xs text-zinc-500">개</span>
                </span>
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            이번 회차에 남길 말 (선택)
            <input name="issueNote" maxLength={500} className={FIELD} placeholder="예: 2개는 다음 주에" />
          </label>
          {issueError ? <p className="text-sm text-red-600">{issueError}</p> : null}
          {confirmState.error ? <p className="text-sm text-red-600">{confirmState.error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100" onClick={() => setOpen(null)} disabled={confirming}>
              돌아가기
            </button>
            <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50" disabled={confirming}>
              {confirming ? "내주는 중" : "내주기"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ② 반려 — 하나도 안 나간 신청만 */}
      <Modal open={open === "reject"} onClose={() => setOpen(null)}>
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
            <input name="note" required minLength={2} maxLength={500} className={FIELD} placeholder="예: 인수번호가 틀림, 수량 확인 필요" />
          </label>
          {rejectState.error ? <p className="text-sm text-red-600">{rejectState.error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100" onClick={() => setOpen(null)} disabled={rejecting}>
              돌아가기
            </button>
            <button type="submit" className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={rejecting}>
              {rejecting ? "반려 중" : "반려"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ③ 마감 — 일부 나간 신청의 남은 수량만 접는다. 🔴 반려와 다르다 */}
      <Modal open={open === "close"} onClose={() => setOpen(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            f.set("requestId", requestId);
            startTransition(() => closeAction(f));
          }}
          className="flex flex-col gap-3"
        >
          <h3 className="text-base font-semibold">남은 수량을 마감하겠습니까?</h3>
          <p className="text-sm text-zinc-700">
            이미 나간 <b className="tabular">{issuedTotal}</b>개는 그대로 두고, 아직 안 나간 <b className="tabular">{remainingTotal}</b>개는 <b>주지 않는 것으로</b> 닫습니다.
          </p>
          <p className="text-xs text-zinc-500">반려가 아닙니다. 이미 적힌 기록과 수량은 하나도 바뀌지 않고, 변경 이력에는 「반출 마감」으로 남습니다.</p>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            사유 *
            <input name="note" required minLength={2} maxLength={500} className={FIELD} placeholder="예: 나머지는 입고 뒤 새로 신청하기로" />
          </label>
          {closeState.error ? <p className="text-sm text-red-600">{closeState.error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100" onClick={() => setOpen(null)} disabled={closing}>
              돌아가기
            </button>
            <button type="submit" className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50" disabled={closing}>
              {closing ? "마감 중" : "마감"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
