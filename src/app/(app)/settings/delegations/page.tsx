import { DelegationSection } from "@/components/approval/DelegationSection";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { delegationNotice } from "@/lib/approval/delegation-screen";
import { readDelegationScreen } from "@/lib/approval/delegation-screen-data";
import { roleAtLeast } from "@/lib/auth/role";
import { requireSession } from "@/lib/auth/session";

/**
 * ============================================================================
 * 설정 — 결재권 위임 `/settings/delegations` (2026-10-21)
 * ============================================================================
 * 「승인 요청건」(`/approvals`) 안의 구역이던 것을 **설정의 탭으로 옮겨 왔다**(사용자 요청).
 * 🔵 옮기면서 `/approvals` 에는 **한 줄 링크**를 남겼다 — 결재자가 날마다 오는 화면이 거기라,
 *    출장 전에 거기서 바로 올 수 있어야 한다. 화면 조각·서버 액션·조회·순수 함수는 **그대로**다.
 *
 * ── 🔴 문은 `requireSession` 이다 — `requireRole("ADMIN")` 이 **아니다** ──
 * 설정 묶음의 다른 탭(항목 관리·전환일·엑셀 상태·승인 절차·변경 이력)은 관리자 자리이지만,
 * **이 탭과 O/H 템플릿만은 로그인한 모두**가 들어온다. 결재자는 **역할과 무관하게 누구나** 될
 * 수 있고(결재선은 A/S 명부에서 고른다), 보기 권한자가 결재선에 들어 있는 경우가 실제로 있다.
 * 역할로 막으면 그분이 **자기 위임을 영영 못 만들고**, 자리를 비우는 동안 그 건이 선다 —
 * 「사람이 자리를 비우면 일이 멈춘다」는 이 기능이 풀려던 문제 그 자체다.
 * 🔴 **2026-10-26 에 「자기 것만」이 아니게 됐는데도 이 문은 그대로다.** 관리자는 남의 결재권도
 *    맡길 수 있게 넓혔지만, 그렇다고 여기를 역할로 막으면 **본인 위임이 함께 막힌다** —
 *    넓히려던 것이 좁혀진다. 울타리는 쓰는 층과 조회 안에 있다
 *    (`src/lib/approval/delegation-authority.ts`: 본인 것이면 누구나, 남의 것이면 `ADMIN`).
 *
 * ── 🔴 번호는 **포털 번호**(`authSub`)다 ───────────────────────────────
 * `users.id` 를 넘기면 두 목록이 **조용히 빈 목록**이 된다 — 오류가 나지 않아 아무도 모른다
 * (`src/lib/approval/delegation-screen-data.ts` 머리말의 같은 주의).
 *
 * 🔵 **위임 자료를 읽는 자리는 이제 여기 하나다.** `/approvals` 가 함께 읽던 것을 옮겨 왔다 —
 *    두 곳에서 읽으면 결재 화면이 쓰지도 않을 A/S 명부 호출(망을 타고, 최대 5초)을 매번 기다린다.
 * ============================================================================
 */
export const metadata = { title: "결재권 위임" };

export default async function DelegationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession("/settings/delegations");
  const sp = await searchParams;
  /**
   * 🔵 탭 줄을 가르는 값일 뿐 **울타리가 아니다** — 관리자 탭의 울타리는 그 화면들의 역할 가드다.
   * 🔴 이 줄에 가드 함수 이름을 적지 마라: `tests/approval-delegation-create.test.ts` 가 이 함수
   *    본문에 그 글자가 **한 번도** 안 나오는지로 「역할로 막기 시작했나」를 잰다(주석까지 긁는다).
   */
  const isAdmin = roleAtLeast(session.user.role, "ADMIN");

  /**
   * 🔴 **역할을 함께 넘긴다**(2026-10-26). 「모두의 결재권 위임」을 내릴지와 「누구의 결재권」
   *    고르개를 그릴지가 그 값으로 갈린다. 🔴 판정은 거기서 한다 — 여기서 걸러 넘기면
   *    「화면이 가린다」가 되고, 그 조회를 부르는 새 자리가 생기는 날 조용히 다 새어 나간다.
   * 🔵 자리를 바꿔 넘기면 `tsc` 가 멈춘다(`Role` 자리에 아무 글자나 못 들어간다).
   */
  const delegation = await readDelegationScreen(session.user.authSub, session.user.role);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        설정 <span className="font-normal text-zinc-500">· 결재권 위임</span>
      </h1>
      <SettingsNav current="delegations" isAdmin={isAdmin} />

      <DelegationSection
        directory={delegation.directory}
        made={delegation.made}
        acting={delegation.acting}
        all={delegation.all}
        canDelegateForOthers={delegation.canDelegateForOthers}
        /* 🔵 「누구의 결재권」 고르개를 안 그릴 때 그 자리에 적는 이름. 서버가 보낸 세션의 이름 그대로다. */
        meName={session.user.name}
        today={delegation.today}
        /* 맡기기·되돌리기가 성공해 돌아왔을 때의 한 줄. 🔵 실패는 여기로 오지 않는다 — 그 자리에 서버 문구가 그대로 뜬다. */
        notice={delegationNotice(sp)}
      />
    </div>
  );
}
