"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { requestPartIssueAction, type PartIssueActionState } from "@/app/actions/part-issue";
import { cancelRequestAction, closeRequestAction, confirmRequestAction, holdRequestAction, rejectRequestAction, releaseHoldAction, type RequestActionState } from "@/app/actions/stock";
import {
  partIssueConfirmLabel,
  PART_ISSUE_APPROVALS_LINK_LABEL,
  PART_ISSUE_APPROVALS_PATH,
  PART_ISSUE_LOCK_LABELS,
  PART_ISSUE_LOCK_TITLES,
  PART_ISSUE_REASON_LABEL,
  PART_ISSUE_REASON_PLACEHOLDER,
  PART_ISSUE_REQUEST_DIALOG_NOTICE,
  PART_ISSUE_REQUEST_SUBMIT_LABEL,
  type PartIssueLock,
} from "@/lib/approval/part-issue-gate";
import type { ClaimableRequestStatus } from "@/lib/stock/codes";
import type { RequestItemView } from "@/lib/stock/request-item-detail";
import { RETURN_TO_FIELD } from "@/lib/stock/return-to";
import { RequestItemDetails } from "./RequestItemDetails";

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
 *
 * 🔴 **신청 항목 한 줄의 모양을 물려받는다**(2026-10-21, 쓰는 분 접수 5번: 「불출 신청 팝업에서도 어느 부품인지
 *    알아보게」 · 같은 날 접수: 「소유구분과 유상/무상도」). `RequestItemView` 가 `partNo` 와 고객사 품명·품명2·
 *    교산 품번·도번·**소유구분**(부품의 것)에 **유상/무상**(그 줄의 것)까지 들고 오므로 여기서 다시 적지 않는다 —
 *    손으로 베끼면 칸이 늘 때 한쪽만 고쳐진다. 🔴 **그 둘이 성격이 다르다는 것도 저쪽 타입이 갈라 들고 있다**
 *    (`lib/stock/request-item-detail.ts` 머리말).
 * 🔵 **조회는 한 글자도 안 고쳤다**: `listAllRequests` 가 넷(2026-10-16)과 소유구분(2026-10-15)을 이미 싣고
 *    있었고, 부품 요청 관리 화면만 쓰고 있었다. 팝업은 **받아 그리기만** 한다.
 */
export interface RequestActionLine extends RequestItemView {
  partId: string;
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
 *
 * ── 🔴 [확인] 자리에 문이 달린다 (2026-10-15, 조각 11c) ────────────────────────────────────
 * 「부품 불출」 승인 절차가 쓰이고 있으면 이 자리는 그 자리에서 재고를 빼지 않고 **[불출 신청]**(결재 올리기)이
 * 되고, 이미 올라간 결재건이 있으면 **누를 수 없는 단추**가 된다. 절차가 없으면 **지금까지와 한 글자도 다르지 않다.**
 *
 * 🔴 **판정은 전부 서버가 해서 내려보낸 값이다**(`approvalRequired` · `issueLock`). 여기서 다시 판정하지 않는다.
 * 🔴 **잠금은 그리는 단계에서만 건다** — [반려]·[마감]·[보류]·[신청 취소]는 **손대지 않는다**(A/S 원본
 *    `PartRequestManagerScreen` 이 그렇게 했다). 결재가 돌고 있어도 담당자는 그 신청을 반려하거나 멈춰 둘 수 있어야
 *    하고, 그 길까지 막으면 결재 중인 신청에 아무도 손을 못 대는 자리가 생긴다.
 */
export function RequestActions({
  requestId,
  status,
  lines,
  canDecide,
  canCancel,
  approvalRequired,
  issueLock,
}: {
  requestId: string;
  /** 지금 상태 — 🔵 **셋 중 하나임이 타입으로 보증된다**(`isClaimableRequest` 가 좁혀 주고, 보류는 부르는 쪽이 따로 가린다). */
  status: RequestActionStatus;
  lines: readonly RequestActionLine[];
  canDecide: boolean;
  canCancel: boolean;
  /** 「부품 불출」 승인 절차가 **지금 쓰이고 있는가** — 서버 판정(`/requests` 서버 컴포넌트). */
  approvalRequired: boolean;
  /** 살아 있는 결재건이 이 신청을 붙들고 있으면 그 까닭, 아니면 `null` — 서버 판정. */
  issueLock: PartIssueLock | null;
}) {
  const [confirmState, confirmAction, confirming] = useActionState<RequestActionState, FormData>(confirmRequestAction, EMPTY);
  const [rejectState, rejectAction, rejecting] = useActionState<RequestActionState, FormData>(rejectRequestAction, EMPTY);
  const [cancelState, cancelAction, cancelling] = useActionState<RequestActionState, FormData>(cancelRequestAction, EMPTY);
  const [closeState, closeAction, closing] = useActionState<RequestActionState, FormData>(closeRequestAction, EMPTY);
  const [holdState, holdAction, holding] = useActionState<RequestActionState, FormData>(holdRequestAction, EMPTY);
  const [releaseState, releaseAction, releasing] = useActionState<RequestActionState, FormData>(releaseHoldAction, EMPTY);
  /**
   * 🔴 **[확인]과 같은 상자, 다른 액션** (조각 11c). 절차가 쓰이고 있으면 같은 상자에서 받은 수량이 원장이 아니라
   *    결재건으로 간다 — 상자를 두 벌 만들면 「요청 8 중 5 나감」을 그리는 셈이 두 곳에 흩어진다.
   */
  const [issueRequestState, issueRequestAction, requestingIssue] = useActionState<PartIssueActionState, FormData>(requestPartIssueAction, EMPTY);
  const [open, setOpen] = useState<null | "issue" | "reject" | "close" | "hold">(null);
  /** 보내기 전에 화면에서 거른 것(서버도 같은 것을 다시 본다 — `buildIssueInput`). */
  const [issueError, setIssueError] = useState<string | null>(null);

  const busy = confirming || rejecting || cancelling || closing || holding || releasing || requestingIssue;
  /** 상자를 띄운 채 보내는 중인가 — 절차가 있으면 결재를 올리는 중이고, 없으면 내주는 중이다. */
  const submitting = approvalRequired ? requestingIssue : confirming;
  /** 🔴 멈춰 둔 신청에는 확인·반려·마감을 **그리지 않는다** — 서버가 받지 않는다(requests.ts 의 `holdRequest` 주석). */
  const held = status === "ON_HOLD";
  const canClose = canDecide && status === "PARTIAL";
  const canReject = canDecide && status === "PENDING";
  // 보류를 걸 수 있는 묶음은 집을 수 있는 묶음과 같다(PENDING·PARTIAL) — 우연이 아니라 같은 뜻이다(codes.ts 의 `CLAIMABLE_REQUEST_STATUSES`).
  const canHold = canDecide && !held;
  const canRelease = canDecide && held;
  const issuedTotal = lines.reduce((a, l) => a + Math.min(l.quantity, l.issued), 0);
  const remainingTotal = lines.reduce((a, l) => a + remainingOf(l), 0);
  const error = confirmState.error ?? rejectState.error ?? cancelState.error ?? closeState.error ?? holdState.error ?? releaseState.error ?? issueRequestState.error;

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
   * 칸에 적힌 「이번에 줄 수량」을 줄별로 읽는다. 거르다 막히면 문구를 세우고 `null`.
   *
   * 🔴 한 칸이라도 적었으면 **빈 칸은 그 줄의 남은 수량**으로 채운다(상자 머리말에 적은 뜻과 같다).
   *    안 줄 줄에는 사람이 0 을 적는다.
   */
  const readQuantities = (form: FormData): Array<{ partId: string; quantity: number }> | null => {
    const quantities: Array<{ partId: string; quantity: number }> = [];
    for (const line of lines) {
      const raw = String(form.get(`q:${line.partId}`) ?? "").trim();
      const left = remainingOf(line);
      const n = raw === "" ? left : Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > left) {
        setIssueError(`${labelOf(line)}: 0 부터 ${left} 까지 적을 수 있습니다.`);
        return null;
      }
      quantities.push({ partId: line.partId, quantity: n });
    }
    if (quantities.every((q) => q.quantity === 0)) {
      setIssueError("이번에 내줄 수량이 없습니다. 적어도 한 줄에 1 이상을 적으십시오.");
      return null;
    }
    return quantities;
  };

  /**
   * 「이번에 줄 수량」 보내기 — 🔴 **가는 곳이 둘로 갈린다.**
   *
   * ① 절차가 없으면 **지금까지 그대로**: 칸을 하나도 안 적었으면 `quantities` 를 **아예 안 보낸다** — 서버가 그때
   *    「남은 수량 전부」로 읽고(조각 4b), 그것이 화면이 생기기 전의 동작 그대로다.
   * ② 절차가 쓰이고 있으면 **결재를 올린다**: 이때는 **언제나 줄별 수량을 보낸다**(빈 칸은 남은 수량). 결재는
   *    「무엇을 얼마나 내보내겠다」는 약속이라, 「남은 것 전부」처럼 **나중에 값이 달라지는 말**로 올리면 결재자가
   *    승인한 것과 실행되는 것이 달라진다. 🔵 사유도 함께 보내지만 **선택이다**(2026-10-15 결정) —
   *    비어 있으면 빈 글자가 그대로 간다(DB 칸이 `NOT NULL DEFAULT ''`). 🔴 거르는 자리를 여기만
   *    풀면 서버가 거절하므로 서버 쪽 울타리도 같이 풀었다(`requestPartIssueAction`).
   */
  const submitIssue = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const out = fd();

    if (approvalRequired) {
      const quantities = readQuantities(form);
      if (quantities === null) return;
      // 🔵 사유는 선택이다 — 비면 빈 글자를 그대로 보낸다(거르지 않는다).
      const reason = String(form.get("reason") ?? "").trim();
      out.set("quantities", JSON.stringify(quantities));
      out.set("reason", reason);
      setIssueError(null);
      startTransition(() => issueRequestAction(out));
      return;
    }

    out.set("issueNote", String(form.get("issueNote") ?? ""));
    if (lines.some((l) => String(form.get(`q:${l.partId}`) ?? "").trim() !== "")) {
      const quantities = readQuantities(form);
      if (quantities === null) return;
      out.set("quantities", JSON.stringify(quantities));
    }
    setIssueError(null);
    startTransition(() => confirmAction(out));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 no-print">
      {canDecide && !held ? (
        issueLock !== null ? (
          /* 🔴 누를 수 없는 자리 — 상자를 여는 길이 아예 없다. **왜 못 누르는지는 `title` 로** 말하고,
             🔵 **갈 곳을 옆에 세운다**(「승인 요청건」). 막다른 길을 만들지 않는다. */
          <span className="flex items-center gap-1.5">
            <button type="button" className={BTN_P} disabled title={PART_ISSUE_LOCK_TITLES[issueLock]}>
              {PART_ISSUE_LOCK_LABELS[issueLock]}
            </button>
            <Link href={PART_ISSUE_APPROVALS_PATH} className="text-xs text-zinc-600 underline hover:text-zinc-900">
              {PART_ISSUE_APPROVALS_LINK_LABEL}
            </Link>
          </span>
        ) : (
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
            {/* 🔴 절차가 쓰이고 있으면 이 단추는 **재고를 빼지 않는다** — 이름도 그렇게 말한다(`part-issue-gate.ts`). */}
            {submitting ? (approvalRequired ? "올리는 중" : "내주는 중") : partIssueConfirmLabel(approvalRequired)}
          </button>
        )
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

      {/* ① 확인 = 이번 회차 불출 — 줄별 수량. 🔴 절차가 쓰이고 있으면 **같은 상자가 결재를 올린다**(조각 11c) */}
      <Modal open={open === "issue"} onClose={() => setOpen(null)}>
        <form onSubmit={submitIssue} className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">{approvalRequired ? "이번에 내보낼 수량" : "이번에 내줄 수량"}</h3>
          {/* 🔴 **무엇이 달라졌는지 먼저 말한다** — 단추 이름만 바뀌면 사람은 눌러 보고 나서야 재고가 안 빠진다는 것을 안다. */}
          {approvalRequired ? <p className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-900">{PART_ISSUE_REQUEST_DIALOG_NOTICE}</p> : null}
          <p className="text-xs text-zinc-500">
            칸을 <b>비워 두면 그 줄의 남은 수량 전부</b>를 {approvalRequired ? "올립니다" : "내줍니다"}. 이번에 안 줄 줄에는 <b>0</b> 을 적으십시오. 남은 수량이 있으면 이 신청은{" "}
            <b>확인 대기에 그대로 남습니다.</b>
          </p>
          {/* 🔵 **위로 맞춘다**(`items-start`, 2026-10-21) — 아래 자세한 내용이 붙으면서 왼쪽이 두세 줄이 됐다.
              가운데로 맞추면 수량 칸이 줄 한가운데로 내려가 **어느 부품의 칸인지**가 한눈에 안 들어온다.
              🔵 `min-w-0 flex-1` 은 긴 품번·도번이 수량 칸을 상자 밖으로 밀어내지 않게 하는 자리다. */}
          <ul className="flex flex-col gap-1.5">
            {lines.map((l) => (
              <li key={l.partId} className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-100 pb-1.5 last:border-0">
                <span className="min-w-0 flex-1 text-sm text-zinc-800">
                  {labelOf(l)}{" "}
                  <span className="text-xs text-zinc-500">
                    요청 {l.quantity}
                    {l.issued > 0 ? ` 중 ${Math.min(l.quantity, l.issued)} 나감 · ${remainingOf(l)} 남음` : ""}
                  </span>
                  {/* 🔴 **어느 부품인지 가리는 값들**(고객사 품명·품명2·교산 품번·도번)과 **딱지 둘**(소유구분·유상/무상).
                      같은 품명이 여럿인 묶음이 실제로 16개 있어, 상자를 뜯으러 가기 **전에** 여기서 갈려야 한다
                      (2026-10-21 쓰는 분 접수 5번). 🔴 **유상/무상은 이 상자에서 특히 중요하다** — 여기서 누르는 것이
                      곧 내주는(또는 결재에 올리는) 행위이고, 틀리면 **청구가 잘못 간다.**
                      🔵 값이 없는 칸은 아예 안 그린다 — 그 규칙도 모양도 `RequestItemDetails` 한 곳에 있다. */}
                  <RequestItemDetails item={l} />
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
          {/* 🔵 절차가 쓰이고 있을 때의 사유는 **선택**이다(2026-10-15 결정) — 별표도 `required` 도 `minLength` 도 없다.
              🔴 서버 쪽 두 글자 울타리도 함께 풀었다(`requestPartIssueAction`). 한쪽만 풀면 눌러도 거절당하거나 아예 못 누른다.
              🔵 절차가 없을 때의 「이번 회차에 남길 말」도 **그대로 선택**이다. 두 칸은 뜻이 달라 한 칸으로 합치지 않는다:
              사유는 결재자에게 하는 말이고, 회차 메모는 기록에 남기는 말이다. */}
          {approvalRequired ? (
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              {PART_ISSUE_REASON_LABEL}
              <input name="reason" maxLength={500} className={FIELD} placeholder={PART_ISSUE_REASON_PLACEHOLDER} />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              이번 회차에 남길 말 (선택)
              <input name="issueNote" maxLength={500} className={FIELD} placeholder="예: 2개는 다음 주에" />
            </label>
          )}
          {issueError ? <p className="text-sm text-red-600">{issueError}</p> : null}
          {/* 🔴 서버가 돌려준 문구를 **그대로** 보인다(뭉개지 않는다) — 절차가 그 사이 꺼졌는지, 이미 올라간 건이 있는지가 여기서만 보인다. */}
          {(approvalRequired ? issueRequestState.error : confirmState.error) ? <p className="text-sm text-red-600">{approvalRequired ? issueRequestState.error : confirmState.error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100" onClick={() => setOpen(null)} disabled={submitting}>
              돌아가기
            </button>
            <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50" disabled={submitting}>
              {submitting ? (approvalRequired ? "올리는 중" : "내주는 중") : approvalRequired ? PART_ISSUE_REQUEST_SUBMIT_LABEL : "내주기"}
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
