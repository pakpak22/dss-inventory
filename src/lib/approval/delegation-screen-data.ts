import "server-only";
import type { Role } from "@/db/schema/users";
import { env } from "@/lib/env";
import { fetchAsUserDirectory } from "./as-users";
import { mayManageOthersDelegations } from "./delegation-authority";
import {
  listAllDelegations,
  listDelegationsIActFor,
  listDelegationsIMade,
  listPortalDelegationsIActFor,
  listPortalDelegationsIMade,
} from "./delegation-queries";
import { seoulDateText } from "./delegation-input";
import { approvalsDelegationHref, type AllDelegationsView, type DelegationRowView, type PortalDelegationsView } from "./delegation-screen";
import { toAsUserChoiceDirectory, type AsUserChoiceDirectory } from "./directory";

/**
 * ============================================================================
 * 결재권 위임 구역이 받는 자료 한 벌 (2026-10-21, 조각 3)
 * ============================================================================
 * 서버 컴포넌트(`src/app/(app)/settings/delegations/page.tsx`)가 **한 번 불러** 다섯 가지를 받는
 * 자리다 — 고를 사람 명부 · 내가 맡긴 것 · 내가 대신하고 있는 것 · **모두의 줄**(2026-10-26,
 * 관리 권한이 있을 때만) · **통합 승인함에서 맡긴 것**(2026-11-17). 모양은 `./part-issue-screen-data.ts`
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
 * 🔵 **여섯 조회가 서로를 기다리지 않는다**(`Promise.all`). 명부는 다른 시스템에 대한 망 호출이라
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
   * 🔴 **모두의 줄. `null` 이면 그 묶음이 화면에 아예 없다** — 감추는 것이 아니라 없는 것이다.
   *
   * 🔴 **여기서 판정해서 `null` 이 되는 것이 아니다.** 조회 함수가 제 손으로 역할을 묻고
   * 거절하며(`listAllDelegations`), 이 자리는 그 거절을 `null` 로 옮겨 적을 뿐이다. 그래서
   * 화면에도 이 파일에도 **권한 판정이 한 줄도 없다** — 울타리는 조회 안에 있다.
   */
  all: AllDelegationsView | null;
  /**
   * 🔴 **「누구의 결재권」 고르개를 그릴까.** 서버가 셈해 내려보낸다(화면은 클라이언트라
   * 역할표를 다시 묻지 못한다). 🔵 **울타리가 아니다** — 쓰는 층이 같은 자로 다시 판정한다.
   * 🔵 `all !== null` 과 지금은 같은 값이지만 **묻는 것이 다르다**(「남의 것을 세울 수 있나」와
   * 「남의 줄을 볼 수 있나」). 한 칸으로 합치면 둘이 갈리는 날 조용히 틀린다.
   */
  canDelegateForOthers: boolean;
  /**
   * 🔴 **통합 승인함에서 맡긴 결재권 위임**(2026-11-17, 설계 D-2).
   *
   * ── 🔴 왜 여기 있나 ───────────────────────────────────────────────────
   * 2026-11-13 부터 위임을 맡기는 고지가 **둘**이다 — 이 시스템의 표(위 `made`·`acting`)와
   * **통합 승인함에서 지정한 것**. 결재 판정은 둘을 합집합으로 보는데, 이 화면이 제 표만
   * 보여 주면 **「분명 맡겼는데 여기엔 없다」**가 된다. 설계 D-2 가 「각 화면에서 **어디에
   * 지정된 위임인가**를 구별해 보여 줄 것」이라고 못 박은 자리이고, 2026-11-17 에 쓰는 분이
   * 실제로 그렇게 말했다 — 「위임되었다는 내용이 안 뜬다」.
   *
   * ── 🔴 2026-11-17: **수 하나에서 줄들로** 바뀌었다 ─────────────────────
   * 그 전에는 `portalActing: { count }` 한 칸이었고, 화면은 그마저 안 그리고 있었다(그릴 조각이
   * 아직 안 왔다고 적혀 있었다). 🔴 **수를 두 곳에서 세지 않으려고 세던 함수를 걷어냈다** —
   * 줄을 그리면서 수까지 따로 세면 「N건이라는데 줄은 그보다 적은」 화면이 되고, 그때 오류는
   * 한 번도 안 난다. 수는 **그린 줄을 센다**(`acting.length`).
   *
   * ── 🔵 이름은 **여기서 붙는다**(옛 주석의 「수뿐이고 이름이 없다」는 끝났다) ──
   * 표에 이름 칸이 없는 것은 그대로이지만(세 시스템 공통 모양), 이 집은 `users.auth_sub` 가 곧
   * 포털 번호라 조회가 `LEFT JOIN` 으로 붙인다. 🔵 못 찾는 줄은 **감추지 않고** 이름 자리에만
   * 그 사실을 적는다(`portalDelegationCounterpartLabel`).
   *
   * 🟢 **「못 물었다」 칸은 2026-11-16 저녁에 사라졌다**(설계 B-12). 그 전에는 포털에 **물어서**
   * 받았고 못 물은 0 과 진짜 0 을 가르려고 `unavailable` 칸이 있었다. 이제 제 표를 읽으므로
   * **0 은 언제나 「없다」**다. 🔴 칸을 되살리지 마라 — 뜰 일 없는 경고를 화면이 그린다.
   *
   * 🔵 **본인은 애초에 안 들어간다** — 표의 `portal_approval_delegations_not_self` CHECK 가
   *    자기에게 맡기는 줄을 막는다. (포털에 묻던 때는 답의 맨 앞에 본인이 끼어 왔다.)
   */
  portal: PortalDelegationsView;
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
 * @param actorRole 지금 로그인한 사람의 **역할**(`session.user.role`). 🔴 모두의 목록과
 *   고르개를 가르는 값이고, **세션에서 온 값이어야 한다.**
 */
export async function readDelegationScreen(actorSub: string, actorRole: Role, now: Date = new Date()): Promise<DelegationScreenData> {
  const [directory, made, acting, all, portalMade, portalActing] = await Promise.all([
    fetchAsUserDirectory(),
    listDelegationsIMade(actorSub, now),
    listDelegationsIActFor(actorSub, now),
    // 🔵 거절도 이 안에서 난다 — 여섯 조회가 서로를 기다리지 않는 모양은 그대로다(머리말).
    listAllDelegations(actorRole, now),
    /**
     * 🔴 **승인함에서 맡긴 위임도 함께 읽는다**(2026-11-17, 설계 B-4·D-2). 제 표만 보여 주면
     *    「분명 맡겼는데 여기엔 없다」가 된다(위 `portal` 주석).
     * 🟢 **DB 읽기 둘이다** — 2026-11-16 낮까지는 포털에 묻는 망 호출(최대 2초) 하나였고, 저녁에
     *    제 표 읽기 하나가 됐다. 🔵 명부 호출(최대 5초)과 나란히 나가는 모양은 그대로라 이 화면은
     *    더 느려지지 않는다 — 둘 다 색인을 타거나(대신하는 것) 몇 줄짜리다(맡긴 것).
     */
    listPortalDelegationsIMade(actorSub, now),
    listPortalDelegationsIActFor(actorSub, now),
  ]);

  // 🔴 포털 번호를 떼고 내려보낸다(머리말).
  return {
    directory: toAsUserChoiceDirectory(directory),
    made,
    acting,
    all: all.ok ? all.view : null,
    canDelegateForOthers: mayManageOthersDelegations(actorRole),
    /**
     * 🔵 번호 자체는 **조회 안에서 끝난다** — 화면이 받는 모양에 번호를 담을 칸이 없다(이 파일
     *    머리말의 명부 규칙과 같은 자리다). 올라오는 것은 이름과 기간뿐이다.
     *
     * 🔴 **갈 곳을 함께 싣는다.** 이 줄들은 여기서 거둘 수 없어서(표 머리말 ⓑ) 어디로 가야
     *    하는지를 화면이 말해 줘야 하고, 그 주소는 **환경변수**에서 온다.
     * 🔴 **값이 없어도 깨지지 않는다** — `env.approvalsBaseUrl` 은 없으면 `null` 이고
     *    (`required` 가 아니라 `optional` 이다), 그러면 링크 없이 안내 글자만 그린다.
     */
    portal: { made: portalMade, acting: portalActing, href: approvalsDelegationHref(env.approvalsBaseUrl) },
    today: seoulDateText(now),
  };
}
