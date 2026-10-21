import { DelegationSection } from "@/components/approval/DelegationSection";
import { IssueApprovalScreen } from "@/components/stock/IssueApprovalScreen";
import { delegationNotice } from "@/lib/approval/delegation-screen";
import { readDelegationScreen } from "@/lib/approval/delegation-screen-data";
import { partIssueNotice } from "@/lib/approval/part-issue-screen";
import { readPartIssueApprovalScreen } from "@/lib/approval/part-issue-screen-data";
import { roleAtLeast } from "@/lib/auth/role";
import { requireSession } from "@/lib/auth/session";

/**
 * 승인 요청건 `/approvals` — 부품 불출 결재 (2026-10-15, 조각 11b).
 *
 * 🔴 **문은 `requireSession` 이다 — 역할로 막지 않는다.** 결재자는 **역할과 무관하게 누구나**
 *    될 수 있기 때문이다(결재선은 A/S 명부에서 고르고, 그 사람이 여기 보기 권한자일 수 있다).
 *    역할로 막으면 결재선에 든 사람이 자기 차례를 영영 못 누른다.
 * 🔴 **역할로 갈리는 것은 「실행할 건」 묶음 하나뿐**이고, 그것도 **감추는 것은 편의일 뿐**이다 —
 *    실제로 막는 울타리는 `executePartIssueAction` 의 `requireRole("ADMIN", …)` 이다
 *    (CLAUDE.md 8-4절). 여기를 지워도 쓰기는 안 뚫린다.
 * 🔴 **(다)에서 (나)를 빼는 판정은 서버가 한다** — 같은 건이 한 화면에 두 번 나오지 않게.
 *    화면은 받은 대로 그린다(`readPartIssueApprovalScreen`).
 * 🔴 **서버/클라이언트 경계**: 자료를 읽는 것은 여기(서버 컴포넌트)뿐이고, 화면 조각은
 *    `server-only` 모듈을 **직접도 타입으로도** 끌어오지 않는다. 화면이 받는 모양은 순수 모듈
 *    (`src/lib/approval/part-issue-screen.ts`)에 있고 **포털 번호를 담을 칸이 없다.**
 *
 * 🔵 **올리는 길(결재를 거는 자리)은 아직 없다** — 다음 조각(11c)이 부품 요청 관리에 붙인다.
 *    그때까지 이 화면이 비어 있는 것은 **정상**이고, 그래서 묶음마다 0건이라고 **말한다**
 *    (감추지 않는다 — `part-issue-screen.ts` 의 문구 상수들).
 *
 * ── 🔴 **결재권 위임도 여기 있다** (2026-10-21, 조각 3) ─────────────────
 * 결재자가 이미 가는 화면이라서다 — 설정 깊은 곳에 두면 **출장 전에 못 찾는다.** 문이
 * `requireSession` 인 것이 그쪽에도 그대로 걸린다: 위임을 만드는 사람은 결재자이고, 결재자는
 * 역할과 무관하게 누구나 될 수 있다(위 첫 줄과 **같은 까닭**이다).
 * 🔴 두 구역이 **같은 번호를 쓴다** — 「내 차례인가」도 「내가 맡긴 것인가」도 포털 번호
 *    (`authSub`)다. `users.id` 를 넘기면 두 목록이 조용히 빈 목록이 된다.
 */
export const metadata = { title: "승인 요청건" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession("/approvals");
  const isAdmin = roleAtLeast(session.user.role, "ADMIN");
  const sp = await searchParams;
  /**
   * 🔴 두 번호를 **바꿔 넘기지 마라**: 「내 차례인가」는 포털 번호(`authSub`), 「내가 올린
   *    건인가」는 이 시스템의 `users.id` 다. 바꿔 넘기면 「내가 결재할 건」이 영원히 빈
   *    목록이 되는데, 오류가 나지 않아 아무도 모른다(2026-10-15 에 실제로 있었던 결함).
   */
  // 🔵 두 자료 묶음이 서로를 기다리지 않는다 — 위임 쪽은 A/S 명부(망 호출, 최대 5초)를 품고 있다.
  const [data, delegation] = await Promise.all([
    readPartIssueApprovalScreen({ userId: session.user.id, approverSub: session.user.authSub, isAdmin }),
    readDelegationScreen(session.user.authSub),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <IssueApprovalScreen
        toDecide={data.toDecide}
        toExecute={data.toExecute}
        mine={data.mine}
        showExecute={isAdmin}
        progressExcludesExecutable={data.progressExcludesExecutable}
        /* 단추를 누르고 돌아왔을 때의 한 줄. 🔵 실패는 여기로 오지 않는다 — 그 카드 자리에 서버 문구가 그대로 뜬다. */
        notice={partIssueNotice(sp)}
      />
      {/* 🔵 결재 목록 **아래**에 둔다 — 날마다 보는 것은 위쪽이고, 위임은 어쩌다 한 번 하는 일이다. */}
      <DelegationSection
        directory={delegation.directory}
        made={delegation.made}
        acting={delegation.acting}
        today={delegation.today}
        notice={delegationNotice(sp)}
      />
    </div>
  );
}
