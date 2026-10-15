import { Fragment } from "react";
import type { PartIssueStatus } from "@/lib/approval/part-issue-rules";
import { partIssueProgressText, partIssueTrailMark, type IssueApprovalTrailStep } from "@/lib/approval/part-issue-screen";

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
              return (
                <Fragment key={step.stepOrder}>
                  {index > 0 ? (
                    <span aria-hidden className="self-center text-sm text-zinc-400">
                      ▶
                    </span>
                  ) : null}
                  <div className="flex flex-col items-center gap-1">
                    <span className={`rounded-md border px-3 py-2 text-xs whitespace-nowrap ${mark.boxClass}`}>{step.approverName}</span>
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
