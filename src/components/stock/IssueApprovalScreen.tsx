"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { cancelPartIssueAction, decidePartIssueAction, executePartIssueAction, type PartIssueActionState } from "@/app/actions/part-issue";
import { IssueApprovalTrail } from "./IssueApprovalTrail";
import {
  formatPartIssueMoment,
  partIssueProgressEmptyText,
  partIssueStatusBadge,
  PART_ISSUE_EXECUTION_STANDING_NOTICE,
  PART_ISSUE_NOTHING_TO_DECIDE,
  PART_ISSUE_NOTHING_TO_EXECUTE,
  type IssueApprovalCard,
  type IssueApprovalLine,
  type PartIssueNotice,
} from "@/lib/approval/part-issue-screen";
import { formatQuantity } from "@/lib/parts/codes";
import { ENTRY_TYPE_LABEL } from "@/lib/stock/codes";

/**
 * ============================================================================
 * 「승인 요청건」 — 내가 결재할 건 · 실행할 건 · 진행 중인 내 신청
 * ============================================================================
 * A/S 관리 시스템의 `src/components/inventory/PartIssueApprovalScreen.tsx` 를 옮긴 것이다
 * (2026-10-15, 조각 11b). **구조가 아니라 모양과 까닭을 옮겼다.**
 *
 * 묶음 셋:
 *  (가) **내가 결재할 건** — 지금 내 차례인 것. 좁히는 일은 조회의 몫이고
 *       (`listPartIssueApprovalsToDecide` — 포털 번호로 집는다) 여기서 한 벌 더 좁히지 않는다.
 *  (나) **실행할 건** — 결재가 끝났고 아직 안 나간 것. **관리자에게만.**
 *  (다) **진행 중인 내 신청** — 내가 올려 결재 중·실행 대기인 것. 결재·실행 단추가 **없다.**
 *       올린 사람에게는 (가)(나)가 비어 보이는 것이 정상이라, 이 묶음이 없으면 올린 건이
 *       사라진 것처럼 보인다. 🔴 (나)가 보이는 세션에서는 거기 뜬 건을 여기서 뺀다 — 그
 *       판정과 빼기는 **서버(페이지)가** 하고 화면은 받은 대로 그린다.
 *
 * 🔴 **묶음을 함부로 감추지 않는다.** 「지금 할 일이 없다」와 「이 화면은 나와 상관없다」는 다른
 * 말이다. 0건이면 그렇게 **말한다**(`PART_ISSUE_NOTHING_…`). 감추는 묶음은 (나) 하나뿐이고,
 * 그것도 관리자가 아닌 세션에서만이다.
 *
 * 🔴 **실패 이유를 뭉개지 않는다.** 서버가 돌려주는 문구를 그 카드 자리에 **그대로** 보여 준다.
 * 「처리할 수 없습니다」로 접으면 절차를 만들어야 하는지, 입고를 기다려야 하는지, 새로 고쳐야
 * 하는지 알 수 없다.
 *
 * 🔴 옮기면서 **일부러 다르게 한 것 셋**:
 *   1. **낱말은 재고 관리 것.** 원본은 「불출 신청」, 여기서는 반출 신청과 헷갈리지 않게
 *      **「불출 결재」**라 부르고 단추는 [승인]·[반려]·[실행]·[신청 취소]다.
 *   2. **다크 모드를 뺐다.** 이 저장소에는 다크 모드용 클래스가 한 개도 없다(CLAUDE.md 9-2절).
 *   3. **「직접 사용」 길이 없다.** 이 시스템의 결재건은 **모두 반출 신청을 가리킨다** — 그래서
 *      카드 머리에 접수 건 대신 그 신청의 요약을 적는다.
 *
 * 🔴 **server-only 를 끌어오지 않는다.** 화면이 받는 모양과 판정·문구는 순수 모듈
 * (`@/lib/approval/part-issue-screen`)에 있고, 거기에는 **포털 번호를 담을 칸이 없다.**
 * ============================================================================
 */

const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
const BTN = "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BTN_P = "rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50";
const BTN_R = "rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50";
const FIELD = "rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900";
const EMPTY_BOX = "rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500";
const NOTICE: Record<PartIssueNotice["tone"], string> = {
  info: "rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700",
  warn: "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900",
};
const EMPTY_STATE: PartIssueActionState = { error: null };

/**
 * 카드 안에 펼친 입력 칸 — 🔴 **화면 전체에 하나뿐이다.** 반려와 실행을 한 상태에 담아 두 칸이
 * 동시에 펼쳐지는 일을 모양으로 막는다. 하나를 열면 다른 하나는 저절로 닫힌다.
 *
 * 🔵 **[승인]은 여기 없다**(2026-10-15 쓰는 분 결정) — 승인할 때 한마디를 받던 칸을 걷어내
 *    **단추 하나로 끝나므로** 펼칠 것이 없다. 그래서 `decision` 을 담던 칸도 사라졌다: 펼침
 *    상자가 열리는 길은 **반려와 실행 둘뿐**이다.
 * 🔵 [신청 취소]도 칸이 없다 — 사유를 받지 않기 때문이다(`cancelPartIssueAction` 주석). 부품
 *    요청 관리의 [신청 취소]와 같은 모양이다.
 */
type Draft = { kind: "REJECT"; id: string } | { kind: "EXECUTE"; id: string };

/** 줄별 「이번에 줄 수량」과 지금 재고. 🔴 재고가 모자라면 실행이 막힌다 — **누르기 전에** 보여 준다. */
function IssueLines({ lines }: { lines: readonly IssueApprovalLine[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-zinc-400">
          <th scope="col" className="pb-1 text-left font-normal">
            품목
          </th>
          <th scope="col" className="w-24 pb-1 text-right font-normal">
            이번에 줄 수량
          </th>
          <th scope="col" className="w-20 pb-1 text-right font-normal">
            지금 재고
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const short = l.quantity > l.available;
          return (
            <tr key={l.partId} className="border-t border-zinc-100 align-top">
              <td className="py-1 pr-2 text-zinc-800">{l.partNo !== null ? `No. ${l.partNo} ${l.partName}` : l.partName}</td>
              <td className="tabular py-1 text-right font-medium text-zinc-800">{formatQuantity(l.quantity)}</td>
              <td
                className={`tabular py-1 text-right ${short ? "font-medium text-red-700" : "text-zinc-500"}`}
                title={short ? "지금 재고로는 이 수량을 다 내줄 수 없습니다. 실행은 막히고 결재건은 그대로 남습니다." : undefined}
              >
                {formatQuantity(l.available)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 결재건 한 장 — 무엇을 얼마나 · 누가 왜 올렸나 · 결재선 진행 · 단추. */
function ApprovalCard({ card, actions, error }: { card: IssueApprovalCard; actions: ReactNode; error: string | null }) {
  const badge = partIssueStatusBadge(card.status);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          {/* 🔵 반출 신청의 **요약 글자 그대로**다(`buildRequestSummary`) — 종류·날짜·인수번호/빌려준 곳/사유·부품이 그 안에 있다. */}
          <span className="text-sm font-medium text-zinc-900">{card.request ? card.request.summary : "(신청을 찾을 수 없습니다)"}</span>
          <span className="text-[11px] text-zinc-500">
            {card.request ? `${ENTRY_TYPE_LABEL[card.request.type]} · 신청자 ${card.request.requestedByName} · ` : ""}
            결재 올린 사람 {card.requestedByName} · {formatPartIssueMoment(card.requestedAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {card.mine ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-zinc-700">내 신청</span> : null}
          {/* 🔴 색과 글자를 **함께** 그린다 — 색만으로 상태를 구분하지 않는다(CLAUDE.md 9-7절). */}
          <span className={`${BADGE} ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      {/* 🔴 사유는 **선택이라 비어 있을 수 있다**(2026-10-15 결정). 비면 **이 줄을 아예 그리지 않는다** —
          빈 자리를 「없음」 같은 글자로 채우면 적을 것이 없었다는 사실을 글자로 지어내는 셈이고, 따옴표만
          남은 빈 상자는 「사유가 지워졌나」로 읽힌다. */}
      {card.reason ? <p className="rounded-md bg-zinc-50 px-2 py-1 text-xs break-keep text-zinc-700">신청 사유: “{card.reason}”</p> : null}

      <IssueLines lines={card.lines} />
      <IssueApprovalTrail status={card.status} currentStep={card.currentStep} steps={card.trail} />

      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      {/* 🔴 서버가 돌려준 문구 그대로. 뭉개지 않는다. */}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </li>
  );
}

/** 묶음 하나 — 🔴 0건이면 **감추지 않고 그렇게 말한다.** */
function Section({ title, count, hint, empty, children }: { title: string; count: number; hint?: string; empty: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-zinc-900">
        {title} <span className="tabular text-zinc-500">{count}건</span>
      </h2>
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
      {count === 0 ? <p className={EMPTY_BOX}>{empty}</p> : <ul className="flex flex-col gap-3">{children}</ul>}
    </section>
  );
}

export function IssueApprovalScreen({
  toDecide,
  toExecute,
  mine,
  showExecute,
  progressExcludesExecutable,
  notice,
}: {
  toDecide: IssueApprovalCard[];
  toExecute: IssueApprovalCard[];
  mine: IssueApprovalCard[];
  /** (나)를 그릴지. 🔴 **관리자 판정은 서버가 한다** — 여기를 고쳐도 실행은 `requireRole("ADMIN")` 이 막는다. */
  showExecute: boolean;
  /** 서버가 (다)에서 (나)의 건을 뺐는가 — 빈 상태 문구가 이것으로 갈린다. */
  progressExcludesExecutable: boolean;
  notice: PartIssueNotice | null;
}) {
  const [decideState, decide, deciding] = useActionState<PartIssueActionState, FormData>(decidePartIssueAction, EMPTY_STATE);
  const [executeState, execute, executing] = useActionState<PartIssueActionState, FormData>(executePartIssueAction, EMPTY_STATE);
  const [cancelState, cancel, cancelling] = useActionState<PartIssueActionState, FormData>(cancelPartIssueAction, EMPTY_STATE);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** 🔴 방금 누른 카드 — 실패 문구를 **그 카드에만** 싣는다. 없으면 같은 글이 모든 카드에 찍힌다. */
  const [actedId, setActedId] = useState<string | null>(null);

  const busy = deciding || executing || cancelling;
  const error = decideState.error ?? executeState.error ?? cancelState.error;
  const errorOf = (id: string) => (actedId === id ? error : null);
  const draftOn = (kind: Draft["kind"], id: string) => draft !== null && draft.kind === kind && draft.id === id;

  /** 🔵 성공하면 서버 액션이 돌려보내므로 이 자리에는 실패만 남는다. 칸은 그대로 열어 둔다(사유를 다시 적지 않게). */
  function send(action: (fd: FormData) => void, id: string, fd: FormData) {
    fd.set("approvalId", id);
    setActedId(id);
    startTransition(() => action(fd));
  }

  /**
   * [반려] 칸. 🔴 **사유는 필수다**(두 글자 이상) — 왜 거절했는지가 없으면 올린 사람은 무엇을
   * 고쳐야 할지 알 수 없다. 서버도(`decidePartIssueAction`·`checkRejectReason`) 표의 CHECK 도
   * 같은 것을 다시 본다.
   *
   * 🔵 **승인 쪽 짝이 없다**(2026-10-15 결정) — 승인은 단추 하나로 끝나므로 이 칸은 반려만
   *    쓴다. 그래서 `decision` 을 받아 글자·색·필수 여부를 가르던 분기가 전부 사라졌다.
   */
  function rejectDraft(card: IssueApprovalCard) {
    return (
      <form
        key={`REJECT:${card.id}`}
        className="flex w-full flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("decision", "REJECTED");
          send(decide, card.id, fd);
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          반려 사유 *
          <textarea name="note" rows={2} required minLength={2} maxLength={500} className={FIELD} placeholder="예: 수량이 너무 많습니다. 반으로 줄여 다시 올려 주십시오." />
        </label>
        <div className="flex gap-2">
          <button type="submit" className={BTN_R} disabled={busy}>
            {deciding ? "처리 중" : "반려 확정"}
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => setDraft(null)}>
            돌아가기
          </button>
        </div>
      </form>
    );
  }

  /**
   * [승인] — 🔴 **누르면 바로 간다.** 펼칠 칸이 없어 `draft` 를 건드리지 않는다.
   * 🔵 눌린 카드에만 「승인 중」이 뜬다(`actedId`) — 없으면 모든 카드의 단추가 함께 바뀐다.
   */
  function approveButton(card: IssueApprovalCard) {
    return (
      <button
        type="button"
        className={BTN_P}
        disabled={busy}
        onClick={() => {
          const fd = new FormData();
          fd.set("decision", "APPROVED");
          send(decide, card.id, fd);
        }}
      >
        {deciding && actedId === card.id ? "승인 중" : "승인"}
      </button>
    );
  }

  /** [실행] 칸 — 🔴 **여기서 실제로 부품이 나간다.** 한 번 더 묻고, 한마디는 선택이다. */
  function executeDraft(card: IssueApprovalCard) {
    return (
      <form
        key={`EXECUTE:${card.id}`}
        className="flex w-full flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(execute, card.id, new FormData(e.currentTarget));
        }}
      >
        <p className="text-xs text-zinc-700">위에 적힌 수량대로 부품을 내줍니다. 원장에 기록이 남고 재고가 줄어듭니다.</p>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          이번 회차에 남길 말 (선택)
          <input name="note" maxLength={500} className={FIELD} placeholder="예: 2개는 다음 주에" />
        </label>
        <div className="flex gap-2">
          <button type="submit" className={BTN_P} disabled={busy}>
            {executing ? "내주는 중" : "실행"}
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => setDraft(null)}>
            돌아가기
          </button>
        </div>
      </form>
    );
  }

  /** [신청 취소] — 올린 사람이 아직 결재 전일 때만. 그릴지는 서버가 판정해 보낸 `canCancel` 이 정한다. */
  function cancelButton(card: IssueApprovalCard) {
    return (
      <button type="button" className={BTN} disabled={busy} onClick={() => send(cancel, card.id, new FormData())}>
        {cancelling && actedId === card.id ? "거두는 중" : "신청 취소"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold text-zinc-900">승인 요청건</h1>
      <p className="text-xs text-zinc-500">
        반출 신청에 올라온 <b>부품 불출 결재</b>를 봅니다. 결재가 끝나도 재고는 아직 나가지 않습니다 — 담당자(관리자)가 <b>[실행]</b>을 눌러야 그때 원장에 적히고 수량이 줄어듭니다.
      </p>

      {notice ? <p className={NOTICE[notice.tone]}>{notice.text}</p> : null}

      {/* (가) 내가 결재할 건 — 🔴 누구나 결재자가 될 수 있으므로 역할로 감추지 않는다. */}
      <Section title="내가 결재할 건" count={toDecide.length} empty={PART_ISSUE_NOTHING_TO_DECIDE}>
        {toDecide.map((card) => (
          <ApprovalCard
            key={card.id}
            card={card}
            error={errorOf(card.id)}
            actions={
              /* 🔴 펼침 상자가 열리는 길은 **반려 하나**다 — 승인은 단추 하나로 끝난다(2026-10-15 결정). */
              draftOn("REJECT", card.id) ? (
                rejectDraft(card)
              ) : (
                <>
                  {approveButton(card)}
                  <button type="button" className={BTN_R} disabled={busy} onClick={() => setDraft({ kind: "REJECT", id: card.id })}>
                    반려
                  </button>
                </>
              )
            }
          />
        ))}
      </Section>

      {/* (나) 실행할 건 — 🔵 관리자가 아닌 세션에만 감춘다. 서버도 그 사람에게는 목록을 만들지 않는다. */}
      {showExecute ? (
        <Section title="실행할 건" count={toExecute.length} hint={PART_ISSUE_EXECUTION_STANDING_NOTICE} empty={PART_ISSUE_NOTHING_TO_EXECUTE}>
          {toExecute.map((card) => (
            <ApprovalCard
              key={card.id}
              card={card}
              error={errorOf(card.id)}
              actions={
                draftOn("EXECUTE", card.id) ? (
                  executeDraft(card)
                ) : (
                  <button type="button" className={BTN_P} disabled={busy} onClick={() => setDraft({ kind: "EXECUTE", id: card.id })}>
                    실행
                  </button>
                )
              }
            />
          ))}
        </Section>
      ) : null}

      {/* (다) 진행 중인 내 신청 — 🔴 결재·실행 단추가 없다. 싣는 것은 [신청 취소] 하나뿐이다. */}
      <Section title="진행 중인 내 신청" count={mine.length} empty={partIssueProgressEmptyText(progressExcludesExecutable)}>
        {mine.map((card) => (
          <ApprovalCard key={card.id} card={card} error={errorOf(card.id)} actions={card.canCancel ? cancelButton(card) : null} />
        ))}
      </Section>
    </div>
  );
}
