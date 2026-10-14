"use server";

import { saveApprovalRoute } from "@/lib/approval/mutations";
import { validateApprovalRouteInput } from "@/lib/approval/input";
import { APPROVAL_ROUTE_EMPTY_NOTICES, type ApprovalRouteScope } from "@/lib/approval/route";
import { requireRole } from "@/lib/auth/session";

/**
 * ============================================================================
 * 서버 액션: 승인 절차(결재선) 저장
 * ============================================================================
 * 다른 서버 액션과 같은 층위의 일만 한다 — 인가, 입력 형식 검증(용도 포함), 예상 못한 오류
 * 은닉. 승인자 자격 재확인·「바뀐 게 없으면 새 판을 만들지 않는다」·판 번호 매기기·감사 기록은
 * `saveApprovalRoute()` 가 자기 트랜잭션 안에서 한다.
 *
 * 🔴 **인가를 액션 안에서 다시 본다.** 화면이 메뉴를 숨기는 것은 편의일 뿐 차단이 아니다 —
 * 서버 액션은 네트워크 경계 너머에서 불리고, 그 경계에서 타입은 아무것도 막지 못한다.
 * 모양은 `src/app/actions/part-items.ts` 와 같다(`requireRole` 은 자격이 모자라면
 * `/forbidden` 으로 돌린다).
 *
 * 🔴 **권한 거절 문구에 `scope` 를 싣지 않는다.** 인가는 검증보다 **먼저** 보므로 그때의
 * `scope` 는 아직 확인되지 않은 글자다 — 그것을 문구에 실으면 손으로 만든 요청이 보낸 글자가
 * 사람에게 되돌아간다. 게다가 권한은 용도마다 갈리지 않는다(관리자 하나다).
 *
 * 🔴 **`revalidatePath` 를 부르지 않는다.** 이 값을 읽는 것은 설정 화면 하나이고, 그 화면이
 * 저장 뒤 `router.refresh()` 로 자기 화면만 다시 그린다(원본과 같다).
 * ============================================================================
 */

export type SaveApprovalRouteActionInput = {
  /**
   * 어느 절차를 저장하는가. 🔴 **화면이 보낸 값을 그대로 믿지 않는다** —
   * `validateApprovalRouteInput` 이 허용된 값인지 확인하고, **기본값으로 채워 주지 않는다.**
   * 여기서 「없으면 부품 불출」로 채우면 용도를 빠뜨린 요청이 조용히 어떤 절차를 덮어쓴다.
   */
  scope: ApprovalRouteScope;
  /**
   * 결재 순서대로 담은 승인자 id. **자리가 곧 순서다** — 순서 번호를 따로 받지 않는다
   * (그 까닭은 `src/lib/approval/route.ts` 머리말).
   *
   * 🔴 빈 배열은 「절차를 쓰지 않겠다」는 뜻이고, 판은 지우지 않으므로(append-only) **0개짜리
   * 판을 얹는 것이 절차를 끄는 유일한 출구다.**
   */
  approverUserIds: string[];
};

export type SaveApprovalRouteActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function saveApprovalRouteAction(
  input: SaveApprovalRouteActionInput,
): Promise<SaveApprovalRouteActionResult> {
  const session = await requireRole("ADMIN");

  const validated = validateApprovalRouteInput(input);
  if (!validated.ok) return { ok: false, message: validated.message };

  try {
    const result = await saveApprovalRoute(
      // 🔴 검증을 지난 값을 넘긴다 — `input.scope` 를 그대로 넘기면 위에서 확인한 것과 아래에서
      // 쓰는 것이 다른 값이 될 수 있다.
      validated.scope,
      validated.approverUserIds,
      { id: session.user.id, name: session.user.name },
    );
    if (!result.ok) return { ok: false, message: result.message };
    if (!result.changed) {
      // 🔴 「저장됐다」와 구별해 말해 준다. 같은 값을 다시 저장하면 판을 늘리지 않으므로,
      // 성공 문구만 보이면 관리자는 이력이 쌓였다고 오해한다.
      return { ok: true, message: "변경된 내용이 없습니다." };
    }
    return {
      ok: true,
      message:
        validated.approverUserIds.length === 0
          ? // 🔴 비운 뒤에 **무엇이 그 일을 대신하는지**까지 말해 준다. 「비웠습니다」만으로는
            // 관리자가 결재가 통째로 사라진 줄 안다. 용도마다 다른 그 한 문장은 편집 화면과
            // 같은 자리에서 온다.
            `승인 절차를 비웠습니다. ${APPROVAL_ROUTE_EMPTY_NOTICES[validated.scope]}`
          : `${validated.approverUserIds.length}단계 승인 절차를 저장했습니다.`,
    };
  } catch (e) {
    console.error("[approval-routes] 저장 실패:", e instanceof Error ? e.message : e);
    return { ok: false, message: "저장하지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
}
