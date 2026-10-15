import type { ApprovalRouteScope } from "./route";

/**
 * 화면에 그릴 절차 한 판의 **모양만** — 타입뿐이고 코드가 없다.
 *
 * 🔴 `queries.ts` 와 나눠 둔 까닭: 그쪽은 `server-only` 라 클라이언트 묶음이 끌어오면 빌드가
 * 깨진다. 그렇다고 같은 모양을 편집 화면에 한 벌 더 적으면(이 저장소의 `RequestActionLine` 이
 * 그렇게 했다) 칸이 늘 때 한쪽만 고쳐진다 — 타입만 든 파일을 사이에 두면 둘 다 피한다.
 * 읽는 쪽(`queries.ts`)이 이 모양을 그대로 돌려주고, 그리는 쪽(`ApprovalRouteSection.tsx`)이
 * 이 모양을 그대로 받는다.
 */

/** 절차 한 단계. 🔴 이름·역할은 **저장하던 그때의 사본**이다 — 정본은 A/S 다. */
export type ApprovalRouteStepView = {
  /** 1부터. 이 순서대로 결재한다. */
  stepOrder: number;
  /** A/S 사용자 id. 우리 표에는 FK 가 없다 — 글자로 적어 둘 뿐이다. */
  approverUserId: string;
  approverName: string;
  /** A/S 의 역할 코드. 사람이 읽는 이름은 `asRoleLabel`. */
  approverRole: string;
  /**
   * 🔴 이 단계에 **포털 번호가 저장돼 있는가.** 번호 자체는 내려오지 않는다 — 신원 증명에
   * 쓰이는 값이라 화면에 실어 보내지 않는다(`queries.ts` 머리말).
   *
   * 거짓이면 **아무도 그 단계를 열 수 없다**(그 결재선으로는 결재건이 올라가지 않는다).
   * 포털 번호를 적기 전에 저장된 옛 판이 그렇다 — 다시 저장하면 채워진다.
   */
  approverHasSub: boolean;
};

export type ApprovalRouteView = {
  id: string;
  /**
   * 이 판이 어느 절차의 것인가. 부른 쪽이 이미 아는 값이지만 함께 싣는다 — 편집 화면이 판
   * 하나를 통째로 받아 「지금 보고 있는 절차」와 짝지어야 하기 때문이다.
   */
  scope: ApprovalRouteScope;
  /** 판 번호. **그 용도 안에서** 가장 큰 것이 현재 절차다. */
  version: number;
  createdAt: Date;
  /** 이 판을 만든 사람의 이름(그때의 사본). 「누가 언제 결재선을 바꿨나」가 화면에 그대로 보인다. */
  createdByName: string;
  /** `step_order` 순. **빈 배열도 정상이다** — 「절차를 쓰지 않겠다」는 뜻이다. */
  steps: ApprovalRouteStepView[];
};
