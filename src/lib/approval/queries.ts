import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalRouteSteps, approvalRoutes } from "@/db/schema/approval-routes";
import type { ApprovalRouteScope } from "./route";
// 🔴 화면에 그릴 모양은 타입만 든 파일에 있다 — 이 파일은 server-only 라 클라이언트가 끌어올 수
// 없고, 그렇다고 같은 모양을 화면 쪽에 한 벌 더 적으면 칸이 늘 때 한쪽만 고쳐진다(view.ts 머리말).
import type { ApprovalRouteStepView, ApprovalRouteView } from "./view";

export type { ApprovalRouteStepView, ApprovalRouteView };

/**
 * ============================================================================
 * 승인 절차(결재선) 읽기
 * ============================================================================
 * 「현재 절차」는 **그 용도(scope) 안에서 version 이 가장 큰 판** 하나다 — `is_current` 같은
 * 깃발 칸이 없는 까닭은 `src/db/schema/approval-routes.ts` 머리말에 있다(같은 사실이 두 곳에
 * 적히면 갈라지고, 그때 「현재」가 둘이 되거나 0개가 된다). 그래서 여기서도
 * `WHERE scope = ? ORDER BY version DESC LIMIT 1` 하나로 정한다. **이 정의가 적힌 곳은
 * 저장소 전체에서 이 파일 하나여야 한다.**
 *
 * 🔴 **용도를 받는 함수는 기본값을 두지 않는다.** 부르는 쪽이 언제나 적어야 새 용도를 더할
 * 때 고쳐야 할 자리가 컴파일러에 보인다.
 *
 * ── 🔴 이름·역할은 우리 표의 사본을 쓴다 — A/S 를 조인하지 않는다 ────────
 * 결재자는 A/S 의 사람이라 이 시스템 `users` 에 그 줄이 없다(조인할 수도 없다). 단계에 적어
 * 둔 `approver_name` · `approver_role` 은 **저장하던 그때의 기록**이고 정본은 언제나 A/S 다.
 * 그 덕에 **A/S 가 꺼져 있어도 결재선은 그대로 보인다** — 「지금도 그 사람이 맞는가」는
 * 화면이 명부를 받아 와 따로 판정한다(`directory.ts`).
 *
 * ── 🔴 「단계 0개인 판」과 「판이 없음」을 구별해 돌려준다 ────────────────
 * 둘 다 「절차를 쓰지 않는다」는 뜻이지만, 화면이 「현재 N번째 판 · ○○○ 님이 저장」을 적어야
 * 하므로 같은 것으로 뭉개면 **방금 절차를 끈 사람이 자기가 저장한 흔적을 볼 수 없다.** 판이
 * 없으면 `null`, 0개짜리 판은 `steps: []` 인 판이다.
 *
 * ── 🔴 포털 번호가 든 모양과 화면이 받는 모양을 **가른다** ───────────────
 * `approver_sub` 는 결재자 판정의 열쇠이면서 신원 증명에 쓰이는 값이다. 그래서 읽는 함수가
 * 둘이다: 서버 안에서 쓰는 `getCurrentApprovalRouteWithSubs`(번호가 들어 있다)와 화면에
 * 내려보내는 `getCurrentApprovalRoute`(번호 대신 **있느냐 없느냐** 한 칸). 한 벌로 두면 다음
 * 사람이 그대로 `props` 에 실어 결재자들의 포털 번호가 브라우저로 나간다
 * (`./directory.ts` 머리말의 `AsUserChoice` 와 같은 까닭).
 * ============================================================================
 */

/**
 * 🔴 **서버 안에서만 쓴다** — `approverSub` 가 들어 있다. 화면으로 내려보내지 마라(머리말).
 * 결재건을 올릴 때 이 모양 그대로 `planPartIssueApproval` 에 넘어간다.
 */
export type ApprovalRouteStepWithSub = {
  stepOrder: number;
  /** A/S 사용자 id. 명부로 되짚는 번호다 — **결재자 판정의 열쇠가 아니다.** */
  approverUserId: string;
  /** 🔴 포털 번호. 판정의 열쇠. 옛 판(번호를 적기 전에 저장된 단계)에는 없다. */
  approverSub: string | null;
  approverName: string;
  approverRole: string;
};

export type ApprovalRouteWithSubs = Omit<ApprovalRouteView, "steps"> & {
  steps: ApprovalRouteStepWithSub[];
};

/**
 * 그 용도에 지금 쓰이는 절차 한 판과 그 단계들 — **포털 번호까지.**
 * 🔴 화면에 내려보내려면 아래 `getCurrentApprovalRoute` 를 쓴다.
 */
export async function getCurrentApprovalRouteWithSubs(
  scope: ApprovalRouteScope,
): Promise<ApprovalRouteWithSubs | null> {
  const [route] = await db()
    .select({
      id: approvalRoutes.id,
      scope: approvalRoutes.scope,
      version: approvalRoutes.version,
      createdAt: approvalRoutes.createdAt,
      createdByName: approvalRoutes.createdByName,
    })
    .from(approvalRoutes)
    .where(eq(approvalRoutes.scope, scope))
    .orderBy(desc(approvalRoutes.version))
    .limit(1);

  if (!route) return null;

  const steps = await db()
    .select({
      stepOrder: approvalRouteSteps.stepOrder,
      approverUserId: approvalRouteSteps.approverUserId,
      approverSub: approvalRouteSteps.approverSub,
      approverName: approvalRouteSteps.approverName,
      approverRole: approvalRouteSteps.approverRole,
    })
    .from(approvalRouteSteps)
    .where(eq(approvalRouteSteps.routeId, route.id))
    .orderBy(asc(approvalRouteSteps.stepOrder));

  return { ...route, steps };
}

/**
 * 그 용도에 지금 쓰이는 절차 한 판과 그 단계들. **그 용도의 판이 하나도 없으면 `null`.**
 *
 * 🔴 **포털 번호 자체는 빠진다** — 대신 `approverHasSub` 한 칸이 간다(머리말). 그 칸이 거짓인
 * 단계는 **아무도 열 수 없는 문**이라, 화면이 그 사실을 관리자에게 말해 줘야 한다.
 */
export async function getCurrentApprovalRoute(
  scope: ApprovalRouteScope,
): Promise<ApprovalRouteView | null> {
  const route = await getCurrentApprovalRouteWithSubs(scope);
  if (!route) return null;
  return {
    ...route,
    steps: route.steps.map((step) => ({
      stepOrder: step.stepOrder,
      approverUserId: step.approverUserId,
      approverName: step.approverName,
      approverRole: step.approverRole,
      approverHasSub: step.approverSub !== null,
    })),
  };
}
