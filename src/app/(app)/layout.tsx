import { AppHeader } from "@/components/AppHeader";
import { DevRoleSwitch } from "@/components/DevRoleSwitch";
import { env } from "@/lib/env";
import { roleAtLeast } from "@/lib/auth/role";
import { requireSession } from "@/lib/auth/session";
import { countPendingRequests } from "@/lib/stock/requests";
import { WorkbookAlert } from "@/components/settings/WorkbookAlert";
import { getWorkbookState } from "@/lib/excel/workbook-sync";

/**
 * 인증 구간 레이아웃. **세션 검증은 여기 한 곳** (CLAUDE.md 8-4절).
 * 🔴 다만 레이아웃은 화면을 그릴 때만 돌므로, 데이터를 바꾸는 서버 액션·API 는 따로 다시 검증한다.
 *
 * cookies() 를 읽으므로 이 구간은 전부 동적 렌더링이다 (Next 16: cacheComponents 는 끄여 있음).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession("/");
  // 머리말의 「대기 N」 — 담당자가 알아채게. 실패해도 화면은 떠야 하므로 0 으로.
  const pendingRequests = await countPendingRequests().catch(() => 0);
  // 엑셀 한 벌이 멈춰 있으면(사람이 손댐·쓰기 실패) 관리자 화면 위쪽에 띠 (DESIGN 2-7절). 실패해도 화면은 떠야 하므로 null 로.
  const isAdmin = roleAtLeast(session.user.role, "ADMIN");
  const workbook = isAdmin ? await getWorkbookState().catch(() => null) : null;
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader
        user={{ name: session.user.name, role: session.user.role }}
        portalUrl={`${env.ssoIssuer}/apps`}
        services={session.services}
        currentServiceId={env.ssoClientId}
        isAdmin={isAdmin}
        canRecord={roleAtLeast(session.user.role, "STAFF")}
        pendingRequests={pendingRequests}
        devRoleSwitch={env.devRoleOverride && session.actualRole === "ADMIN" ? <DevRoleSwitch effectiveRole={session.user.role} /> : null}
      />
      {workbook && workbook.status !== "OK" ? <WorkbookAlert status={workbook.status} parkedFile={workbook.parkedFile} errorCount={workbook.errorCount} /> : null}
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
