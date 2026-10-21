import { Fragment } from "react";
import type { PartIssueStatus } from "@/lib/approval/part-issue-rules";
import {
  partIssueProgressText,
  partIssueTrailDelegateLabel,
  partIssueTrailMark,
  PART_ISSUE_TRAIL_DELEGATE_TITLE,
  type IssueApprovalTrailStep,
} from "@/lib/approval/part-issue-screen";

/**
 * ============================================================================
 * 결재선 진행 그림 — 「n/m단계 · 지금 차례: ○○○」 + 상자들
 * ============================================================================
 * A/S 관리 시스템의 `src/components/inventory/PartIssueApprovalTrail.tsx` 를 옮긴 것이다
 * (2026-10-15, 조각 11b). **모양과 까닭을 옮겼고**, 다크 모드와 결재 이력 펼침은 뺐다 —
 * 이 저장소에는 다크 모드가 한 글자도 없고(CLAUDE.md 9-2절), 이력은 변경 이력 화면(`/audit`)에
 * 결재건 단위로 남는다.
 *
 * ── 🔴 서버 액션을 물지 않는다 ──────────────────────────────────────────
 * 결재 화면(`./IssueApprovalScreen.tsx`)은 서버 액션을 직접 가져오는 클라이언트 조각이라 그
 * 사슬 끝의 `server-only` 때문에 따로 떼어 시험할 수 없다. 그래서 **그려지는 모양을 지켜야 하는
 * 부분만** 이 파일로 뺀다 — 여기가 쓰는 판정은 전부 순수 함수
 * (`@/lib/approval/part-issue-screen`)이고, 그 함수들은 `tests/part-issue-screen.test.ts` 가
 * 전수로 돌려 본다. 🔴 이 파일에 `if` 를 새로 적지 마라. 적는 순간 아무도 돌려 보지 못한다.
 *
 * ── 🔴 색만으로 상태를 구분하지 않는다 ──────────────────────────────────
 * 상자 색과 그 아래 글자를 **한 자리에서 함께** 정한다(`partIssueTrailMark`). 따로 두면 한쪽만
 * 늘어나고, 그때 색약인 사람에게는 모든 상자가 같아 보인다.
 *
 * ── 🔴 포털 번호는 여기 오지 않는다 ─────────────────────────────────────
 * 그림에 필요한 것은 **이름**이다. 「신청자 본인이라 건너뛴 자리인가」는 서버가 포털 번호 둘을
 * 견주어 `skipped` 한 칸으로 실어 보낸다(`src/lib/approval/part-issue-screen-data.ts` 머리말).
 * 「그 자리를 실제로 누가 눌렀나」도 **똑같이** 서버가 번호 둘을 견주어 끝내고 `decidedBy` 한
 * 칸(이름뿐)으로 실어 보낸다(2026-10-22, `approvalStepActor`).
 * ============================================================================
 */
export function IssueApprovalTrail({
  status,
  currentStep,
  steps,
}: {
  status: PartIssueStatus;
  /** 지금 열려 있는 단계. 결재가 끝났으면 `null`. */
  currentStep: { stepOrder: number; approverName: string } | null;
  /** 🔴 이 건이 **타고 있는 판**의 단계들 — 현재 판이 아니다(서버가 결재건의 판으로 읽는다). */
  steps: readonly IssueApprovalTrailStep[];
}) {
  const progress = partIssueProgressText({
    currentStepOrder: currentStep?.stepOrder ?? null,
    currentApproverName: currentStep?.approverName ?? null,
    totalSteps: steps.length,
    status,
  });

  if (progress === null && steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {progress !== null ? (
        <div>
          <p className="text-xs text-zinc-500">결재선 진행</p>
          <p className="text-sm text-zinc-900">{progress}</p>
        </div>
      ) : null}

      {steps.length > 0 ? (
        /* 🔴 가로로 길어지면 **이 상자 안에서만** 밀린다. 바깥이 밀리면 목록 전체가 못 쓰게 된다. */
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max items-start gap-2">
            {steps.map((step, index) => {
              const mark = partIssueTrailMark({
                stepOrder: step.stepOrder,
                currentStepOrder: currentStep?.stepOrder ?? null,
                status,
                skipped: step.skipped,
              });
              /**
               * 🔴 **대리로 눌린 자리에만 글자가 있다** — 본인·옛 줄·아직 안 누름은 전부 `null`
               *    이라 지금까지와 한 글자도 다르지 않게 그려진다. 갈래 넷을 가르는 일은 서버가
               *    끝냈고(`approvalStepActor`), 글자를 고르는 일은 순수 함수가 한다. 여기는 **있으면
               *    한 줄 더 그린다**뿐이다 — 이 파일에 판정을 적지 않는다(머리말).
               */
              const delegate = partIssueTrailDelegateLabel(step.decidedBy);
              return (
                <Fragment key={step.stepOrder}>
                  {index > 0 ? (
                    <span aria-hidden className="self-center text-sm text-zinc-400">
                      ▶
                    </span>
                  ) : null}
                  <div className="flex flex-col items-center gap-1">
                    {/* 🔴 **상자가 좁아 한 줄에 둘을 세우지 않는다** — 이름 둘을 한 줄에 붙이면 상자가
                        옆으로 터지고, 결재선이 길면 그림 전체가 못 읽게 밀린다. 그래서 **위아래로**
                        세운다: 윗줄이 **그 자리의 주인**(결재선에 적힌 사람)이고 아랫줄이 **그 자리에서
                        실제로 누른 대리인**이다. 🔵 작고 흐린 글씨로 두는 것이 「주(主)와 종(從)」을
                        말하는 자리다 — 결재선은 「누구 자리인가」를 보는 그림이고 대리는 그 자리에서
                        일어난 일이라, 대리인 이름이 결재권자보다 눈에 먼저 들어오면 거꾸로 읽힌다.
                        🔵 각 줄은 그대로 `whitespace-nowrap` 이라 이름이 중간에서 꺾이지 않는다. */}
                    <span className={`rounded-md border px-3 py-2 text-xs whitespace-nowrap ${mark.boxClass}`}>
                      <span className="block">{step.approverName}</span>
                      {delegate !== null ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-zinc-500" title={PART_ISSUE_TRAIL_DELEGATE_TITLE}>
                          {delegate}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[11px] whitespace-nowrap text-zinc-400">
                      {step.stepOrder}단계 · {mark.stateLabel}
                    </span>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
