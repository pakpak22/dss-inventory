"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApprovalDelegation, revokeApprovalDelegation } from "@/lib/approval/delegation-mutations";
import { isUuidText } from "@/lib/approval/delegation-input";
import { delegationNoticeFlag } from "@/lib/approval/delegation-screen";
import { requireSession } from "@/lib/auth/session";

/**
 * ============================================================================
 * 서버 액션: 결재권 위임 맡기기 · 되돌리기 (2026-10-21, 조각 3)
 * ============================================================================
 * 모양은 `./part-issue.ts` 그대로다: 세션 → 값 꺼내기 → try/catch → `revalidatePath` →
 * `redirect`. 실패하면 **redirect 하지 않고** 상태로 돌려주어 그 자리에 문구가 뜬다.
 *
 * ── 🔴 문은 `requireSession` 이다 — `requireRole` 을 쓰지 않는다 ─────────
 * **결재자는 역할과 무관하게 누구나 될 수 있다**(결재선은 A/S 명부에서 고르고, 그 사람이 여기
 * 보기 권한자일 수 있다 — `src/app/(app)/settings/delegations/page.tsx` 머리말). 역할로 막으면
 * 결재선에 든 보기 권한자가 **자기 위임을 만들지 못한다.** 🔴 **화면이 설정 묶음으로 옮겨 갔다고
 * (2026-10-21) 여기를 `requireRole("ADMIN")` 으로 맞추지 마라** — 설정의 다른 탭과 달리 그 탭의
 * 문도 `requireSession` 이고, 진짜 울타리는 여기가 아니라 **쓰는 층**에 있다.
 *
 * 🔴 **2026-10-26 에 「자기 것만」이 아니게 됐는데도 그 결정은 그대로다.** 관리자는 남의
 * 결재권도 맡길 수 있게 넓혔지만, 그렇다고 이 문을 역할로 막으면 **본인 위임이 함께 막힌다** —
 * 넓히려던 것이 좁혀진다. 울타리는 `src/lib/approval/delegation-mutations.ts` 안에서 역할
 * 사다리(`roleAtLeast`)로 걸린다: **본인 것이면 누구나, 남의 것이면 `ADMIN`.**
 *
 * ── 🔴 폼에서 읽는 것은 **A/S 사용자 id** 이지 포털 번호가 아니다 ─────────
 * 「누구의 결재권인가」(`delegatorUserId`)를 2026-10-26 에 더했지만, 이 파일에는 **포털 번호를
 * 읽는 줄이 여전히 하나도 없다.** 번호로 푸는 일도 자격을 묻는 일도 서버 함수가 명부를 보고
 * 한다. 여기서 한 번이라도 `…Sub` 를 폼에서 읽어 넘기면, 손으로 만든 요청이 **명부에 없는
 * 사람의 결재권까지** 넘길 수 있다. 🔵 비워 보내면 본인이다 — 관리자가 아닌 사람의 화면에는
 * 그 고르개가 아예 없다.
 *
 * 🔵 **`revalidatePath` 는 위임 화면 하나다** — 위임으로 재고도 신청도 움직이지 않는다. 결재
 *    목록이 달라지는 것은 **상대방** 화면이고, 그 사람은 자기 요청으로 새로 그린다.
 * ============================================================================
 */

export interface DelegationActionState {
  /** 실패 사유 — **서버 문구 그대로**. 성공하면 redirect 하므로 이 자리는 비어 있다. */
  error: string | null;
}

/**
 * 돌아갈 화면. 🔴 **`/approvals` 가 아니다** — 2026-10-21 에 위임 구역이 설정의 탭으로 옮겨 갔다.
 * 여기를 옛 주소로 두면 맡기기·되돌리기가 **위임 구역이 없는 화면**으로 사람을 보내고, 성공 문구
 * (`delegationNotice`)도 그릴 자리가 없어 **아무 일도 안 일어난 것처럼** 보인다.
 */
const DELEGATIONS = "/settings/delegations";

/**
 * 맡기기. 🔴 폼에서 읽는 것은 **누구의 결재권·대신할 사람·기간·사유** 다섯뿐이다(머리말).
 */
export async function createDelegationAction(_prev: DelegationActionState, formData: FormData): Promise<DelegationActionState> {
  const session = await requireSession(DELEGATIONS);

  let r;
  try {
    r = await createApprovalDelegation(
      {
        /**
         * 🔴 **A/S 사용자 id 이고, 비면 본인이다**(2026-10-26). 관리자가 아닌 사람의 화면에는
         *    이 칸이 아예 없어 `""` 로 들어오고, 그때 서버는 세션의 번호를 쓴다. 🔴 이것이
         *    포털 번호가 **아니라는 점**이 울타리의 절반이다 — 자격은 쓰는 층이 묻는다.
         */
        delegatorUserId: String(formData.get("delegatorUserId") ?? ""),
        delegateUserId: String(formData.get("delegateUserId") ?? ""),
        startDate: String(formData.get("startDate") ?? ""),
        endDate: String(formData.get("endDate") ?? ""),
        reason: String(formData.get("reason") ?? ""),
      },
      /**
       * 🔴 누른 사람은 **세션**이다. 폼에는 번호 칸이 없다.
       * 🔴 **역할도 세션의 것**이다 — 「남의 것까지 되는가」를 가르는 값이라, 폼에서 읽은 값을
       *    여기 실으면 울타리가 통째로 없어진다.
       */
      { id: session.user.id, name: session.user.name, sub: session.user.authSub, role: session.user.role },
    );
  } catch (e) {
    console.error("[delegation] 위임 만들기 실패:", e instanceof Error ? e.message : e);
    return { error: "결재권을 맡기지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message };

  revalidatePath(DELEGATIONS);
  /**
   * 🔴 **본인 것을 맡겼나 남의 것을 세웠나**를 꼬리표로 실어 보낸다(2026-10-26). 돌아간 화면이
   *    할 말이 갈린다 — 「내 차례를 그분이 대신 누른다」는 관리자가 남의 것을 세웠을 때
   *    **거짓말**이고, 그때는 「모두의 결재권 위임」에서 찾으라고 일러 줘야 한다.
   * 🔵 꼬리표 값은 읽는 쪽과 **같은 함수**에서 나온다 — 손으로 적으면 한쪽만 고치는 날 화면이
   *    조용히 아무 말도 안 하게 된다.
   */
  redirect(`${DELEGATIONS}?delegated=${delegationNoticeFlag(r.onBehalf)}`);
}

/**
 * 되돌리기. 🔴 **본인 것이거나 `ADMIN`** — 그 판정은 조건절이 한다(화면이 단추를 안 그리는
 * 것은 편의일 뿐이다). 역할은 세션에서 꺼내 그대로 넘긴다.
 *
 * 🔵 번호 모양을 먼저 본다 — uuid 가 아닌 글자를 그대로 넘기면 DB 가 영어로 터지고, 그 예외는
 *    「되돌리지 못했습니다」로 뭉개져 사람에게 아무 말도 안 해 준다(CLAUDE.md 10절).
 */
export async function revokeDelegationAction(_prev: DelegationActionState, formData: FormData): Promise<DelegationActionState> {
  const session = await requireSession(DELEGATIONS);
  const delegationId = String(formData.get("delegationId") ?? "");
  if (!isUuidText(delegationId)) return { error: "되돌릴 위임이 정해지지 않았습니다. 화면을 새로 고치고 다시 보십시오." };

  let r;
  try {
    r = await revokeApprovalDelegation(delegationId, {
      id: session.user.id,
      name: session.user.name,
      sub: session.user.authSub,
      role: session.user.role,
    });
  } catch (e) {
    console.error("[delegation] 위임 되돌리기 실패:", e instanceof Error ? e.message : e);
    return { error: "위임을 되돌리지 못했습니다. 잠시 뒤 다시 시도하십시오." };
  }
  if (!r.ok) return { error: r.message };

  revalidatePath(DELEGATIONS);
  // 🔴 맡기기와 같은 짝이다 — 「내 차례」가 남의 위임을 거둔 관리자에게는 거짓말이 된다.
  redirect(`${DELEGATIONS}?delegationRevoked=${delegationNoticeFlag(r.onBehalf)}`);
}
