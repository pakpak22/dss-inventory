"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { cancelPartIssueAction, decidePartIssueAction, executePartIssueAction, rejectExecutionPartIssueAction, type PartIssueActionState } from "@/app/actions/part-issue";
import { IssueApprovalTrail } from "./IssueApprovalTrail";
import { RepairCaseInfo } from "./RepairCaseInfo";
import { RequestItemDetails } from "./RequestItemDetails";
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
 *  (나) **실행할 건** — 결재가 끝났고 아직 안 나간 것. **관리자에게만.** 🔴 단추가 **둘**이다:
 *       [실행]과 [반려]. 2026-10-21 에 [반려]가 붙기 전에는 결재가 다 끝난 건을 **아무도 멈출 수
 *       없었다**(결재가 도는 동안은 담당자의 [반려]·[보류]·[신청 취소]가 닫혀 있다).
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
 *
 * 🔴 **`REJECT_EXECUTION` 을 `REJECT` 와 합치지 않는다** (2026-10-21). 가는 서버 액션이 다르고
 *    (결재자의 반려 ↔ 담당자의 실행 대기 반려) **같은 카드가 두 묶음에 함께 뜰 수 있다** —
 *    관리자가 자기 결재 차례인 건을 (가)에서 보면서 (나)에서 실행을 기다릴 수 있다. 한 값으로
 *    뭉개면 한쪽 칸을 열었을 때 **다른 묶음의 칸까지 함께 펼쳐진다.**
 */
type Draft = { kind: "REJECT"; id: string } | { kind: "REJECT_EXECUTION"; id: string } | { kind: "EXECUTE"; id: string };

/**
 * 줄별 「이번에 줄 수량」과 지금 재고. 🔴 재고가 모자라면 실행이 막힌다 — **누르기 전에** 보여 준다.
 *
 * 🔵 **자세한 내용을 2026-10-21 에 더했다**(쓰는 분 접수 5번). **열을 늘리지 않고** 품목 칸 안에서
 *    품명 아래 작은 글씨로 묶는다 — 결재건 카드는 좁은 상자라 네 열을 세우면 수량과 재고가 밀려난다.
 *    부품 요청 관리의 신청 항목 표가 같은 까닭으로 같은 모양을 쓴다(`RequestItemDetails`).
 * 🔵 **소유구분과 유상/무상도 같은 날 같은 자리에 더했다**(쓰는 분 요청). 🔴 **결재자가 승인하기 전에
 *    봐야 하는 값들**이다 — 어느 재고에서 빠지는지(소유)와 **청구가 따라붙는지**(유상/무상). 열을 늘리지
 *    않는 까닭은 위와 같고, 딱지 모양과 「없으면 안 그린다」도 전부 그 조각 한 곳에 있다.
 */
/**
 * 한 줄을 사람이 부르는 이름. 🔴 **한 자리다** — 아래 `IssueLines`(결재건 카드)와
 * `ExecuteDraft`(실행 전 부품별 확인)가 같은 것을 가리켜야 한다. 두 벌로 적어 두면
 * 한쪽만 고쳐지는 날이 오고, **확인한 부품과 내주는 부품의 이름이 달라 보인다.**
 */
function partLabel(l: IssueApprovalLine): string {
  return l.partNo !== null ? `No. ${l.partNo} ${l.partName}` : l.partName;
}

/** 확인 두 걸음. 🔴 차례가 있다 — **꺼내는 것이 먼저고 다시 보는 것이 나중이다.** */
type IssueCheck = { tookOut: boolean; rechecked: boolean };
const NO_CHECK: IssueCheck = { tookOut: false, rechecked: false };
/** 지금 어느 걸음인가. `tookOut` 을 다 채워야 `rechecked` 로 넘어간다. */
type ExecuteStep = keyof IssueCheck;
/** 걸음마다 품목 옆에 적는 글. 🔵 짧아야 품명 옆에 들어간다. */
const STEP_LABEL: Record<ExecuteStep, string> = { tookOut: "꺼냄", rechecked: "품명·개수 다시 확인" };

/**
 * 줄별 확인을 **품목 칸 안에서** 그리는 데 필요한 것. 🔵 `undefined` 면 확인 칸을 안 그린다 —
 * 결재건 카드는 평소에 읽는 자리이고, 체크는 [실행]을 펼친 동안에만 뜬다.
 */
type LineChecks = { step: ExecuteStep; checkOf: (partId: string) => IssueCheck; onMark: (partId: string, step: ExecuteStep, on: boolean) => void };

function IssueLines({ lines, checks }: { lines: readonly IssueApprovalLine[]; checks?: LineChecks }) {
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
              <td className="py-1 pr-2 text-zinc-800">
                {/* 🔴 **제목 옆의 ✓** (2026-10-23 쓰는 분 요청) — 지금 걸음에서 그 품목을 끝냈다는 표시다.
                    🔵 자리를 늘 차지하게 둔다(안 끝났으면 빈 칸). 글자가 좌우로 들썩이면 목록을 훑기 어렵다. */}
                {checks ? (
                  <span aria-hidden="true" className={`mr-1 inline-block w-3 text-center ${checks.checkOf(l.partId)[checks.step] ? "font-bold text-emerald-600" : "text-transparent"}`}>
                    ✓
                  </span>
                ) : null}
                {partLabel(l)}
                {/* 🔴 확인 칸은 **품목 바로 옆**이다 (2026-10-23 쓰는 분 요청). 열을 따로 세우지 않는
                    까닭은 이 표의 다른 값들과 같다(머리말) — 결재건 카드는 좁은 상자라 네 번째 열을
                    세우면 수량과 재고가 밀려난다.
                    🔴 **지금 걸음의 칸 하나만** 그린다. 둘을 함께 내밀면 사람은 한 줄에서 둘을 잇따라
                       누르고 넘어가, 「꺼낸 뒤 **다시** 본다」는 두 번째 걸음이 첫 번째와 같은 순간이
                       되어 버린다 — 그 걸음을 둔 뜻이 사라진다. */}
                {checks ? (
                  <label className="ml-2 inline-flex items-center gap-1 align-middle whitespace-nowrap text-amber-800">
                    <input
                      type="checkbox"
                      checked={checks.checkOf(l.partId)[checks.step]}
                      onChange={(e) => checks.onMark(l.partId, checks.step, e.target.checked)}
                      className="size-3.5 shrink-0 accent-zinc-900"
                    />
                    {STEP_LABEL[checks.step]}
                  </label>
                ) : null}
                {/* 🔵 값이 있는 칸만 선다 — 지워진 부품은 넷도 소유구분도 비어 있어 저절로 아무것도 안 그린다. */}
                <RequestItemDetails item={l} />
              </td>
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
function ApprovalCard({ card, actions, error, lineChecks }: { card: IssueApprovalCard; actions: ReactNode; error: string | null; lineChecks?: LineChecks }) {
  const badge = partIssueStatusBadge(card.status);
  return (
    // 🔴 id 는 통합 승인함(dss-approvals)의 href 가 쓰는 조각(#approval-{id})이다
    //    (notifications/portal-approvals.ts 머리말의 href 절). 이 화면에는 결재건별
    //    상세 주소가 없어, 이 카드까지 바로 스크롤되는 것이 지금 가능한 가장 좁은 주소다.
    <li id={`approval-${card.id}`} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
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

      {/* 🔵 **수리 건 — 머리말 바로 아래, 말 둘보다 위** (2026-10-22, 쓰는 분 요청).
          🔴 **「신청 사유」와 「요청 비고」 사이에 끼우지 않는다.** 그 둘은 2026-10-22 에 **나란히
             세우기로 정한 한 쌍**이고(누구의 말인지를 이름표로 가른다), 사이에 다른 종류의 상자가
             들어가면 그 짝이 끊긴다.
          🔴 **말 둘보다 위인 까닭**: 이것은 사람이 쓴 말이 아니라 A/S 에서 받아 온 **사실**이고,
             바로 윗줄의 요약 글자에 적힌 인수번호가 **어느 건인지**를 푸는 값이다. 결재자는 「무엇을
             고치는 건인가」를 먼저 보고 그다음에 사람들의 말을 읽는다.
          🔵 비면 아무것도 안 선다 — 재고 관리에서 직접 올린 신청은 늘 비어 있다. */}
      {card.request ? <RepairCaseInfo repairCase={card.request.repairCase} /> : null}

      {/* 🔴 사유는 **선택이라 비어 있을 수 있다**(2026-10-15 결정). 비면 **이 줄을 아예 그리지 않는다** —
          빈 자리를 「없음」 같은 글자로 채우면 적을 것이 없었다는 사실을 글자로 지어내는 셈이고, 따옴표만
          남은 빈 상자는 「사유가 지워졌나」로 읽힌다. */}
      {card.reason ? <p className="rounded-md bg-zinc-50 px-2 py-1 text-xs break-keep text-zinc-700">신청 사유: “{card.reason}”</p> : null}

      {/* 🔴 **바로 위 「신청 사유」와 다른 사람의 말이다** (2026-10-22). 저것은 결재를 올린 재고 담당자가
          결재자에게 쓴 글이고, 이것은 **부품을 요청한 사람**이 신청에 적은 말이다(A/S 에서 온 신청이면
          거기서 적은 글이 그대로 실려 온다). 🔴 이름표에 **누구의 말인지**를 적어 둔다 — 둘이 나란히
          서는 자리라, 「요청 비고」 네 글자만으로는 어느 쪽이 누구 말인지 가를 수 없다.
          🔴 비면 **이 줄을 아예 그리지 않는다** — 사유와 **같은 규칙**이다. 안 적었거나 재고 관리에서
          직접 올린 신청은 늘 비어 있어서, 「요청 비고: -」가 모든 카드에 붙으면 화면만 길어진다.
          🔴 **잘라서 숨기지 않는다**: 길 수 있지만(A/S 통로가 1000자까지 싣는다) 읽으라고 적은 글이다.
          `whitespace-pre-wrap` 로 적은 사람의 줄바꿈을 살리고, `break-words` 로 긴 글이 카드를 밀어내지
          않게만 한다. */}
      {card.requestNote ? (
        <p
          className="rounded-md bg-zinc-50 px-2 py-1 text-xs break-keep break-words whitespace-pre-wrap text-zinc-700"
          title="부품을 요청한 사람이 신청할 때 적은 말입니다. 「신청 사유」는 결재를 올린 재고 담당자가 결재자에게 쓴 글로, 서로 다른 말입니다."
        >
          요청 비고 (신청한 사람이 적은 말): “{card.requestNote}”
        </p>
      ) : null}

      <IssueLines lines={card.lines} checks={lineChecks} />
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

/**
 * [실행] 칸의 속 — 🔴 **여기서 실제로 부품이 나간다.**
 *
 * 🔴 **확인은 부품마다 두 번이다** (2026-10-23 쓰는 분 요청): ① 그 부품을 창고에서 꺼낼 때,
 *    ② 꺼낸 뒤 그 부품의 **품명과 개수**를 적힌 것과 다시 맞춰 볼 때. **줄 하나라도 둘을 다
 *    채우지 않으면 [실행]이 눌리지 않는다.**
 *
 * 🔴 **건 단위로 묶지 않는 까닭**이 요점이다. 한 결재건에 부품이 여럿인데 건에 체크 둘만
 *    두면, 사람은 **목록 전체를 한 번 훑고** 두 번 누른다 — 가운데 줄 하나를 빠뜨려도
 *    체크는 채워진다. 줄마다 두면 손이 **줄 수만큼** 멈춘다. 잘못 내주면 원장에 기록이
 *    남고 재고가 줄어든 뒤라, 되돌리는 길이 신청자의 새 신청뿐이다.
 *
 * 🔵 **따로 선 컴포넌트인 까닭은 체크가 저절로 풀리게 하려고다.** 부르는 쪽이 `key` 를
 *    `EXECUTE:<건 id>` 로 주므로, 다른 건을 펼치면 React 가 이것을 **새로 만든다** — 앞 건에서
 *    켜 둔 체크가 따라오지 않는다. 바깥 컴포넌트의 `useState` 로 두면 손으로 꺼야 하고, 한 번
 *    빠뜨리면 **체크 없이 눌리는 건**이 생기는데 오류가 안 나서 아무도 모른다.
 *
 * 🔴 체크 값은 **서버로 안 보낸다**(`name` 을 안 준다). 서버가 믿을 값이 아니라 **사람이
 *    멈추는 자리**다. 보내면 「그 칸이 참이면 통과」로 읽혀, 창고에서 실제로 무슨 일이
 *    있었는지와 무관한 울타리가 생긴 것처럼 보인다.
 */
function ExecuteDraft({
  step,
  total,
  done,
  busy,
  executing,
  onNext,
  onPrev,
  onSubmit,
  onBack,
}: {
  /** 지금 어느 걸음인가. */
  step: ExecuteStep;
  /** 이 건의 부품 줄 수. */
  total: number;
  /** 그중 **지금 걸음**을 끝낸 줄 수. */
  done: number;
  busy: boolean;
  executing: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSubmit: (fd: FormData) => void;
  onBack: () => void;
}) {
  /**
   * 🔴 **`total > 0` 을 함께 본다.** 줄이 없으면 `done === total` 이 `0 === 0` 으로 참이라,
   *    확인 칸이 하나도 안 보이는 채로 단추가 켜진다. 그런 건은 없어야 하지만, 없어야
   *    하는 것을 전제로 단추를 여는 대신 **닫는 쪽으로** 둔다.
   */
  const ready = total > 0 && done === total;
  const first = step === "tookOut";
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
    >
      {/* 🔴 확인 칸은 **위 품목 표 안**에 있다(`IssueLines` 의 `checks`). 여기에 목록을 다시
          그리지 않는 까닭: 같은 부품이 한 화면에 두 번 적히면 **어느 쪽을 보고 세는지**가
          흐려지고, 둘이 어긋나는 날이 온다. 여기서는 **지금 걸음과 남은 수만** 말한다. */}
      <p className="text-xs break-keep text-zinc-700">
        <span className="tabular mr-1 whitespace-nowrap rounded-sm bg-zinc-900 px-1.5 py-0.5 text-white">{first ? "1 / 2" : "2 / 2"}</span>
        {first ? (
          <>
            위 품목을 창고에서 꺼내면서 <strong className="font-semibold">꺼냄</strong>을 하나씩 체크해 주세요.
          </>
        ) : (
          <>
            꺼낸 부품을 손에 두고, 위에 적힌 <strong className="font-semibold">품명과 개수</strong>를 다시 맞춰 보며 체크해 주세요. 내주면 원장에 기록이 남고 재고가 줄어듭니다.
          </>
        )}{" "}
        <span className="tabular whitespace-nowrap text-amber-800">
          ({done}/{total})
        </span>
      </p>
      {/* 🔵 한마디는 **둘째 걸음에만** 적는다 — 첫 걸음에서 적어 두면 [다음]을 누를 때
          사라진 것처럼 보이고(실은 남아 있다), 어차피 보내는 것은 둘째 걸음이다. */}
      {first ? null : (
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          이번 회차에 남길 말 (선택)
          <input name="note" maxLength={500} className={FIELD} placeholder="예: 2개는 다음 주에" />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {first ? (
          /* 🔴 `type="button"` 이다 — `submit` 이면 첫 걸음에서 그대로 내줘 버린다. */
          <button type="button" className={BTN_P} disabled={busy || !ready} onClick={onNext}>
            다음
          </button>
        ) : (
          <button type="submit" className={BTN_P} disabled={busy || !ready}>
            {executing ? "내주는 중" : "실행"}
          </button>
        )}
        {/* 🔵 둘째 걸음에서 **되돌아갈 길**을 둔다 — 잘못 넘어왔을 때 [돌아가기]로 칸을 닫으면
            첫 걸음의 체크까지 다 풀린다. 🔵 첫 걸음의 체크는 그대로 남는다(지우지 않는다). */}
        {first ? null : (
          <button type="button" className={BTN} disabled={busy} onClick={onPrev}>
            이전
          </button>
        )}
        <button type="button" className={BTN} disabled={busy} onClick={onBack}>
          돌아가기
        </button>
        {/* 🔵 **왜 안 눌리는지, 그리고 몇 개가 남았는지 적어 준다** — 흐린 단추만 있으면 고장으로 읽힌다. */}
        {ready ? null : (
          <span className="text-xs break-keep text-amber-800">
            부품 {total - done}개가 남아 [{first ? "다음" : "실행"}]이 아직 안 눌립니다.
          </span>
        )}
      </div>
    </form>
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
  /** 🔴 [실행]과 **따로** 쥔다 — 한 상태에 묶으면 「내주는 중」과 「반려 중」이 같은 글자로 보인다. */
  const [stopState, stop, stopping] = useActionState<PartIssueActionState, FormData>(rejectExecutionPartIssueAction, EMPTY_STATE);
  const [draft, setDraft] = useState<Draft | null>(null);
  /**
   * 🔴 **실행 전 부품별 확인** (2026-10-23 쓰는 분 요청). 열쇠는 `partId` 다.
   * 🔴 **여기(화면)에 두는 까닭**: 체크 칸이 [실행] 칸이 아니라 **위 품목 표 안**에 그려진다.
   *    그 표(`IssueLines`)는 `ApprovalCard` 가 그리므로, 상태가 그 둘보다 위에 있어야 한다.
   */
  const [checks, setChecks] = useState<Record<string, IssueCheck>>({});
  /** 지금 어느 걸음인가 — ① 전부 꺼냄 → [다음] → ② 전부 품명·개수 다시 확인 → [실행]. */
  const [step, setStep] = useState<ExecuteStep>("tookOut");
  /** 🔴 방금 누른 카드 — 실패 문구를 **그 카드에만** 싣는다. 없으면 같은 글이 모든 카드에 찍힌다. */
  const [actedId, setActedId] = useState<string | null>(null);

  const busy = deciding || executing || cancelling || stopping;
  const error = decideState.error ?? executeState.error ?? cancelState.error ?? stopState.error;
  const errorOf = (id: string) => (actedId === id ? error : null);
  const draftOn = (kind: Draft["kind"], id: string) => draft !== null && draft.kind === kind && draft.id === id;

  /**
   * 🔴 **칸을 열거나 닫을 때마다 확인을 비운다.** 안 그러면 앞 건에서 켜 둔 체크가 다음 건에
   *    따라오고, 아무것도 안 보고도 [실행]이 켜진 채로 열린다 — 오류가 안 나서 아무도 모른다.
   *    `setDraft` 를 바로 부르지 않고 이 문 하나로 모은 까닭이 그것이다.
   */
  function openDraft(next: Draft | null) {
    setChecks({});
    setStep("tookOut");
    setDraft(next);
  }
  const checkOf = (partId: string): IssueCheck => checks[partId] ?? NO_CHECK;
  const markCheck = (partId: string, which: ExecuteStep, on: boolean) => setChecks((prev) => ({ ...prev, [partId]: { ...(prev[partId] ?? NO_CHECK), [which]: on } }));
  /** 지금 걸음을 끝낸 줄 수. 🔵 `ExecuteDraft` 가 이 값만 보고 단추를 연다. */
  const doneCount = (lines: readonly IssueApprovalLine[]): number => lines.filter((l) => checkOf(l.partId)[step]).length;
  const lineChecksFor = (card: IssueApprovalCard): LineChecks | undefined => (draftOn("EXECUTE", card.id) ? { step, checkOf, onMark: markCheck } : undefined);

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
          <button type="button" className={BTN} disabled={busy} onClick={() => openDraft(null)}>
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

  /**
   * [실행] 칸 — 🔴 **여기서 실제로 부품이 나간다.** 한 번 더 묻고, 한마디는 선택이다.
   * 🔴 속은 위의 `ExecuteDraft` 에 있다. **`key` 를 여기서 주는 것이 핵심이다** — 다른 건을
   *    펼치면 그 조각이 새로 만들어져 **확인 체크가 저절로 풀린다**(그쪽 주석).
   */
  function executeDraft(card: IssueApprovalCard) {
    return (
      <ExecuteDraft
        key={`EXECUTE:${card.id}`}
        step={step}
        total={card.lines.length}
        done={doneCount(card.lines)}
        busy={busy}
        executing={executing}
        onNext={() => setStep("rechecked")}
        onPrev={() => setStep("tookOut")}
        onSubmit={(fd) => send(execute, card.id, fd)}
        onBack={() => openDraft(null)}
      />
    );
  }

  /**
   * [반려] 칸 — **실행 대기에서 멈춘다** (2026-10-21). 🔴 **사유는 필수다**(두 글자 이상):
   * 이 사유가 **그대로 신청자에게 보인다**(서버가 반출 신청의 결정 사유 칸에 복사한다). 비면
   * 신청자는 부품이 왜 안 오는지 알 길이 없다. 서버 액션도 표의 CHECK 도 같은 것을 다시 본다.
   *
   * 🔴 **되돌릴 수 없는 단추라 무슨 일이 일어나는지 먼저 적는다** — 결재건과 반출 신청이 **함께**
   *    닫히고, 다시 내주려면 신청자가 **새로 신청**해야 한다. [실행] 칸이 「재고가 줄어듭니다」를
   *    먼저 적는 것과 같은 까닭이다.
   * 🔵 위 `rejectDraft`(결재자의 반려)와 **베껴 쓰지 않고 따로 둔다** — 가는 액션도, 적는 말도,
   *    일어나는 일도 다르다. 한 함수로 합치면 분기가 셋이 되어 둘 다 읽기 어려워진다.
   */
  function rejectExecutionDraft(card: IssueApprovalCard) {
    return (
      <form
        key={`REJECT_EXECUTION:${card.id}`}
        className="flex w-full flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(stop, card.id, new FormData(e.currentTarget));
        }}
      >
        <p className="text-xs break-keep text-zinc-700">이 건을 내주지 않고 멈춥니다. 결재건과 반출 신청이 함께 닫히고, 적으신 사유가 신청자에게 그대로 보입니다 — 다시 내주려면 신청자가 새로 신청해야 합니다.</p>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          반려 사유 *
          <textarea name="note" rows={2} required minLength={2} maxLength={500} className={FIELD} placeholder="예: 재고가 모자라 이번에는 내주기 어렵습니다. 입고된 뒤 다시 신청해 주십시오." />
        </label>
        <div className="flex gap-2">
          <button type="submit" className={BTN_R} disabled={busy}>
            {stopping ? "처리 중" : "반려 확정"}
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => openDraft(null)}>
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
                  <button type="button" className={BTN_R} disabled={busy} onClick={() => openDraft({ kind: "REJECT", id: card.id })}>
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
              /* 🔴 [실행] 칸을 펼친 **그 카드에만** 확인 칸이 뜬다 — 옆 카드의 품목 표는 평소 그대로다. */
              lineChecks={lineChecksFor(card)}
              actions={
                /* 🔴 펼침 상자가 열리는 길이 **둘**이다 — [실행]과 [반려]. 한 번에 하나만 열린다(`draft` 가 하나다). */
                draftOn("EXECUTE", card.id) ? (
                  executeDraft(card)
                ) : draftOn("REJECT_EXECUTION", card.id) ? (
                  rejectExecutionDraft(card)
                ) : (
                  <>
                    <button type="button" className={BTN_P} disabled={busy} onClick={() => openDraft({ kind: "EXECUTE", id: card.id })}>
                      실행
                    </button>
                    {/* 🔴 **[실행]을 멈출 수 있는 유일한 자리다**(2026-10-21). 이 단추가 없으면 결재가 다 끝난 건은
                        아무도 닫지 못해 이 목록에 영원히 떠 있는다 — 결재가 도는 동안은 담당자의 [반려]가 닫혀 있다. */}
                    <button type="button" className={BTN_R} disabled={busy} onClick={() => openDraft({ kind: "REJECT_EXECUTION", id: card.id })}>
                      반려
                    </button>
                  </>
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
