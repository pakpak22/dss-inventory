"use client";

import { usePathname } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { cancelRequestAction, closeRequestAction, confirmRequestAction, holdRequestAction, rejectRequestAction, releaseHoldAction, type RequestActionState } from "@/app/actions/stock";
import type { ClaimableRequestStatus } from "@/lib/stock/codes";
import { RETURN_TO_FIELD } from "@/lib/stock/return-to";

const BTN = "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BTN_P = "rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50";
/** 보류 단추는 보라색 — 상태 배지와 같은 색이라 「이 단추가 그 상태를 만든다」가 눈으로 이어진다 (codes.ts 의 `REQUEST_STATUS_BADGE`). */
const BTN_V = "rounded-md border border-violet-300 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50";
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
 * 이 단추 묶음을 그릴 수 있는 상태 (2026-10-15, 조각 10b).
 *
 * 🔴 집을 수 있는 둘(PENDING·PARTIAL)에 **보류(ON_HOLD)** 가 더해진 것이다. 보류 중에 그릴 단추는
 *    [보류 해제] **하나뿐**이고, 나머지 셋은 서버가 어차피 막는다(requests.ts: 셋 다 상태를 WHERE 에 걸어
 *    `ON_HOLD` 를 받지 않는다). 눌러도 거절당하는 단추를 사람에게 내밀지 않는다.
 */
export type RequestActionStatus = ClaimableRequestStatus | "ON_HOLD";

/**
 * 담당자: [확인] 은 **줄별로 이번에 줄 수량**을 받고(조각 4d), [반려] 는 사유를, [마감] 은 남은 것을 접는 사유를,
 * [보류] 는 멈추는 사유를 받는다(조각 10b). [보류 해제] 만 사유를 받지 않는다.
 * 신청자: [신청 취소]. 제출은 직접 다룬다(폼 자동 초기화 방지).
 *
 * 🔴 **[반려]와 [마감]이 갈린다.** 반려는 아직 아무것도 안 나간 신청(PENDING)만 받고(`rejectRequest` 의 WHERE),
 *    마감은 일부 나간 신청(PARTIAL)만 받는다(`closeRequest`). 둘 다 그리면 눌러도 거절당하는 단추가 생긴다.
 * 🔴 **[신청 취소]도 PENDING 뿐이다** — 부품이 이미 나간 신청은 신청자가 거둘 수 없다(부르는 쪽이 `canCancel` 로 가린다).
 * 🔵 **쓰는 화면은 부품 요청 관리(`/requests`) 하나다** (2026-10-15 사용자 결정으로 기록 내역의 「확인 대기」 구역을
 *    걷어내면서 그렇게 됐다). 그래도 단추를 그 화면 파일에 녹여 넣지 않는다 — 상태별로 무엇을 그릴지 가르는 규칙이
 *    여기 모여 있고(`canReject`·`canClose`·`canHold`…), 화면에 풀어 놓으면 서버가 받는 조건과 어긋나는 날이 온다.
 */
export function RequestActions({
  requestId,
  status,
  lines,
  canDecide,
  canCancel,
}: {
  requestId: string;
  /** 지금 상태 — 🔵 **셋 중 하나임이 타입으로 보증된다**(`isClaimableRequest` 가 좁혀 주고, 보류는 부르는 쪽이 따로 가린다). */
  status: RequestActionStatus;
  lines: readonly RequestActionLine[];
  canDecide: boolean;
  canCancel: boolean;
}) {
  const [confirmState, confirmAction, confirming] = useActionState<RequestActionState, FormData>(confirmRequestAction, EMPTY);
  const [rejectState, rejectAction, rejecting] = useActionState<RequestActionState, FormData>(rejectRequestAction, EMPTY);
  const [cancelState, cancelAction, cancelling] = useActionState<RequestActionState, FormData>(cancelRequestAction, EMPTY);
  const [closeState, closeAction, closing] = useActionState<RequestActionState, FormData>(closeRequestAction, EMPTY);
  const [holdState, holdAction, holding] = useActionState<RequestActionState, FormData>(holdRequestAction, EMPTY);
  const [releaseState, releaseAction, releasing] = useActionState<RequestActionState, FormData>(releaseHoldAction, EMPTY);
  const [open, setOpen] = useState<null | "issue" | "reject" | "close" | "hold">(null);
  /** 보내기 전에 화면에서 거른 것(서버도 같은 것을 다시 본다 — `buildIssueInput`). */
  const [issueError, setIssueError] = useState<string | null>(null);

  const busy = confirming || rejecting || cancelling || closing || holding || releasing;
  /** 🔴 멈춰 둔 신청에는 확인·반려·마감을 **그리지 않는다** — 서버가 받지 않는다(requests.ts 의 `holdRequest` 주석). */
  const held = status === "ON_HOLD";
  const canClose = canDecide && status === "PARTIAL";
  const canReject = canDecide && status === "PENDING";
  // 보류를 걸 수 있는 묶음은 집을 수 있는 묶음과 같다(PENDING·PARTIAL) — 우연이 아니라 같은 뜻이다(codes.ts 의 `CLAIMABLE_REQUEST_STATUSES`).
  const canHold = canDecide && !held;
  const canRelease = canDecide && held;
  const issuedTotal = lines.reduce((a, l) => a + Math.min(l.quantity, l.issued), 0);
  const remainingTotal = lines.reduce((a, l) => a + remainingOf(l), 0);
  const error = confirmState.error ?? rejectState.error ?? cancelState.error ?? closeState.error ?? holdState.error ?? releaseState.error;

  /**
   * 🔴 **지금 있는 자리를 함께 싣는다** (2026-10-15, 조각 10c). 액션은 끝나고 이 값이 가리키는 자리로 돌려보낸다 —
   *    없으면 서버가 기본값(`/entries`)으로 떨어뜨려, `/requests` 에서 누른 사람이 기록 내역으로 튕기며 보던 목록과
   *    걸러 둔 상태를 잃는다. 🔵 지금 단추가 붙은 화면은 `/requests` 하나지만 **값은 계속 실어 보낸다**: 자리를 적는
   *    쪽은 화면, 받아도 되는지 가리는 쪽은 서버로 갈라 두어야 화면이 늘 때 한 곳만 고치면 된다.
   *    🔵 **서버는 이 값을 그대로 믿지 않는다**(`safeReturnTo`, 허용 목록에 든 글자만).
   */
  const returnTo = usePathname();

  const fd = () => {
    const f = new FormData();
    f.set("requestId", requestId);
    f.set(RETURN_TO_FIELD, returnTo);
    return f;
  };

  /**
   * 폼으로 보내는 셋(반려·마감·보류)은 **숨은 칸**으로 싣는다 — 그 셋은 `new FormData(폼)` 으로 보내기 때문이다.
   * 단추만 있는 둘(보류 해제·신청 취소)과 [확인]은 위 `fd()` 가 **같은 값**을 넣는다. 값은 한 곳(`returnTo`)에서 온다.
   */
  const returnToField = <input type="hidden" name={RETURN_TO_FIELD} value={returnTo} />;

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
      {canDecide && !held ? (
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
      {canHold ? (
        <button type="button" className={BTN_V} disabled={busy} onClick={() => setOpen("hold")}>
          보류
        </button>
      ) : null}
      {/* 🔵 [보류 해제]는 상자를 열지 않는다 — 푸는 것은 「다시 진행한다」는 뜻뿐이라 적을 것이 없다(`releaseRequestHold` 주석). */}
      {canRelease ? (
        <button type="button" className={BTN_V} disabled={busy} onClick={() => startTransition(() => releaseAction(fd()))}>
          {releasing ? "푸는 중" : "보류 해제"}
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
          {returnToField}
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
          {returnToField}
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

      {/* ④ 보류 — 멈춰 둔다. 🔴 반려도 마감도 아니다: 풀면 멈추기 전 자리로 돌아간다 (2026-10-15, 조각 10b) */}
      <Modal open={open === "hold"} onClose={() => setOpen(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            f.set("requestId", requestId);
            startTransition(() => holdAction(f));
          }}
          className="flex flex-col gap-3"
        >
          {returnToField}
          <h3 className="text-base font-semibold">이 신청을 보류하겠습니까?</h3>
          <p className="text-sm text-zinc-700">수량은 바뀌지 않습니다. 이미 나간 기록도 그대로입니다.</p>
          <p className="text-xs text-zinc-500">
            보류하는 동안에는 <b>확인·반려·마감이 되지 않습니다.</b> 신청은 확인 대기 목록에 그대로 남고, 머리말의 「대기」 숫자에서만 빠집니다. [보류 해제]를 누르면 멈추기 전 자리로 돌아갑니다.
          </p>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {/* 🔴 사유를 꼭 받는다 — 왜 멈췄는지가 안 남으면 나중에 아무도 풀지 못한다. */}
            사유 *
            <input name="reason" required minLength={2} maxLength={500} className={FIELD} placeholder="예: 부품 입고 대기, 신청자 확인 필요" />
          </label>
          {holdState.error ? <p className="text-sm text-red-600">{holdState.error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100" onClick={() => setOpen(null)} disabled={holding}>
              돌아가기
            </button>
            <button type="submit" className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50" disabled={holding}>
              {holding ? "보류 중" : "보류"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
