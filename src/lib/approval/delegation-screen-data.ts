import "server-only";
import { fetchAsUserDirectory } from "./as-users";
import { listDelegationsIActFor, listDelegationsIMade } from "./delegation-queries";
import { seoulDateText } from "./delegation-input";
import type { DelegationRowView } from "./delegation-screen";
import { toAsUserChoiceDirectory, type AsUserChoiceDirectory } from "./directory";

/**
 * ============================================================================
 * 결재권 위임 구역이 받는 자료 한 벌 (2026-10-21, 조각 3)
 * ============================================================================
 * 서버 컴포넌트(`src/app/(app)/settings/delegations/page.tsx`)가 **한 번 불러** 세 가지를 받는
 * 자리다 — 고를 사람 명부 · 내가 맡긴 것 · 내가 대신하고 있는 것. 모양은 `./part-issue-screen-data.ts`
 * 와 맞춘다(2026-10-21 에 위임이 `/approvals` 에서 설정의 탭으로 옮겨 가기 전까지는 **같은 화면**이었다.
 * 🔴 부르는 자리는 **하나뿐이다** — 결재 화면에 남겨 두면 쓰지도 않을 A/S 명부 호출을 매번 기다린다).
 *
 * ── 🔴 명부는 **포털 번호를 떼고** 내려보낸다 ──────────────────────────
 * `toAsUserChoiceDirectory` 를 반드시 거친다. 그냥 실으면 **전 직원의 포털 번호가 브라우저로
 * 나간다**(`./directory.ts` 머리말). 화면이 알아야 하는 것은 「고를 수 있는가」 한 칸뿐이고,
 * 고른 사람을 번호로 푸는 일은 저장할 때 서버가 명부를 다시 보고 한다.
 *
 * ── 🔴 못 받아 왔으면 **그 사실이 그대로 내려간다** ────────────────────
 * 「한 명도 없다」로 바꾸지 않는다 — 그러면 화면이 「올릴 수 있는 사람이 없습니다」라고 말하고,
 * 사람은 자기 회사에 결재자가 없는 줄 안다. 그 갈림의 까닭이 `./directory.ts` 가 성공·실패를
 * 구별해 들고 다니는 이유 전부다.
 *
 * 🔵 **세 조회가 서로를 기다리지 않는다**(`Promise.all`). 명부는 다른 시스템에 대한 망 호출이라
 *    최대 5초이고, 그동안 우리 표 읽기를 세워 둘 까닭이 없다.
 * ============================================================================
 */

export type DelegationScreenData = {
  /** 고를 사람. 🔴 포털 번호가 빠진 모양이다. 못 받아 왔으면 그 사실까지 들어 있다. */
  directory: AsUserChoiceDirectory;
  /** 내가 맡긴 것 — 끝난 것·되돌린 것까지 전부(상태로 갈려 보인다). */
  made: DelegationRowView[];
  /** 내가 지금 대신하고 있는 것 — 읽기 전용. */
  acting: DelegationRowView[];
  /**
   * 오늘(`YYYY-MM-DD`, 한국). 🔴 **서버가 정해 내려보낸다** — 화면에서 `new Date()` 로 만들면
   * 서버가 그린 글자와 브라우저가 그린 글자가 자정 즈음에 갈린다(운영 서버는 UTC 다).
   */
  today: string;
};

/**
 * @param actorSub 지금 로그인한 사람의 **포털 번호**(`session.user.authSub`).
 *   🔴 `users.id` 를 넘기면 두 목록이 **영원히 빈 목록**이 된다 — 오류는 나지 않는다
 *   (`./delegation.ts` 머리말의 같은 주의).
 */
export async function readDelegationScreen(actorSub: string, now: Date = new Date()): Promise<DelegationScreenData> {
  const [directory, made, acting] = await Promise.all([
    fetchAsUserDirectory(),
    listDelegationsIMade(actorSub, now),
    listDelegationsIActFor(actorSub, now),
  ]);

  // 🔴 포털 번호를 떼고 내려보낸다(머리말).
  return { directory: toAsUserChoiceDirectory(directory), made, acting, today: seoulDateText(now) };
}
