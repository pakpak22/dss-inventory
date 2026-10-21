import Link from "next/link";
import { IssueApprovalScreen } from "@/components/stock/IssueApprovalScreen";
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
 * ── 🔵 **결재권 위임은 설정의 탭으로 옮겼다** (2026-10-21 사용자 요청) ───
 * 구역은 `/settings/delegations` 로 갔고 **여기에는 한 줄 링크만** 남는다 — 결재자가 날마다 오는
 * 화면이 여기라, 출장 전에 여기서 바로 갈 수 있어야 하기 때문이다. 🔴 **위임 자료를 읽던 것도
 * 함께 옮겼다**: 그냥 두면 이 화면이 쓰지도 않을 A/S 명부 호출(망을 타고, 최대 5초)을 매번
 * 기다린다. 옮겨 간 쪽의 문도 `requireSession` 이다(위 첫 줄과 **같은 까닭**이다).
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
  // 🔵 읽는 묶음은 하나다 — 위임 쪽(A/S 명부를 품은 망 호출)은 `/settings/delegations` 로 옮겼다(머리말).
  const data = await readPartIssueApprovalScreen({ userId: session.user.id, approverSub: session.user.authSub, isAdmin });

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
      {/* 🔵 결재 목록 **아래**의 한 줄. 위임은 어쩌다 한 번 하는 일이라 자리는 작게 두되, **길은 남긴다** —
          결재자가 날마다 오는 화면이 여기라서 출장 전에 찾는 자리도 여기다(머리말). */}
      <p className="border-t border-zinc-200 pt-5 text-sm break-keep text-zinc-600">
        출장·휴가로 자리를 비우십니까?{" "}
        <Link href="/settings/delegations" className="font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600">
          설정 · 결재권 위임
        </Link>
        {" "}에서 그 기간 동안 내 결재 차례를 다른 분이 대신 누르게 할 수 있습니다.
      </p>
    </div>
  );
}
