import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { DevRoleSwitch } from "@/components/DevRoleSwitch";
import { HeaderNotificationBell } from "@/components/HeaderNotificationBell";
import { env } from "@/lib/env";
import { roleAtLeast } from "@/lib/auth/role";
import { requireSession } from "@/lib/auth/session";
import { countPendingRequests } from "@/lib/stock/requests";
import { WorkbookAlert } from "@/components/settings/WorkbookAlert";
import { getWorkbookState } from "@/lib/excel/workbook-sync";
import { DrawingNoStyleProvider } from "@/components/stock/DrawingNoStyleContext";
import { DRAWING_NO_STYLE_DEFAULT } from "@/lib/stock/drawing-no-style";
import { getDrawingNoStyle } from "@/lib/stock/drawing-no-style-queries";

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
  /**
   * 도번 줄의 크기·색 (2026-11-20, 설정 `/settings/drawing-no`).
   *
   * 🔴 **읽는 자리를 여기 하나로 둔다.** 그 줄을 그리는 조각(`RequestItemDetails`)을 쓰는 화면이
   *    셋이고 저마다 여러 겹 안쪽에 있어서, 화면마다 읽어 프롭으로 내리면 **한 자리만 빠뜨려도
   *    그 화면에서만 기본값으로 선다**(오류가 안 난다). 까닭은 `DrawingNoStyleContext.tsx` 머리말.
   * 🔴 **실패해도 화면은 떠야 한다**(바로 위 둘과 같은 규칙). 꾸밈 설정 하나 때문에 모든 화면이
   *    오류로 막히면 그것이 훨씬 큰 사고다 — 못 읽으면 기본값으로 그린다.
   */
  const drawingNoStyle = await getDrawingNoStyle().catch(() => DRAWING_NO_STYLE_DEFAULT);
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader
        user={{
          name: session.user.name,
          role: session.user.role,
          /*
            🔴 **머리말 배지에 「임시」를 더하는 값**이다 (2026-11-17). 여기서 막는 것은 아무것도
               없다 — 임시 관리자에게 닫히는 문은 서버가 거절하고(결재선 설정 · 남의 결재권
               맡기기), 이 값은 **사람이 제 상태를 알게** 하려고 내려간다.
            🔵 바로 위 `role` 과 **짝으로** 내려간다. 역할은 위임으로 올라간 값일 수 있어서, 둘
               중 하나만 내려보내면 배지가 「관리자」라고만 하거나 「임시」라고만 하게 된다.
          */
          delegatedAdmin: session.delegatedAdmin,
        }}
        portalUrl={`${env.ssoIssuer}/apps`}
        services={session.services}
        currentServiceId={env.ssoClientId}
        isAdmin={isAdmin}
        canRecord={roleAtLeast(session.user.role, "STAFF")}
        pendingRequests={pendingRequests}
        notificationBell={
          /*
            통합 알림 종. 재고 자신의 알림(확인 대기·내 신청 반려)과 포털이 모아 준 다른
            시스템 알림을 **합쳐서** 그린다 — 무엇을 어떻게 합치는지는
            components/HeaderNotificationBell.tsx 머리말에.

            ── 🔴 `<Suspense>` 가 이 자리의 전부다 ─────────────────────────────
            종이 기다리는 것에 **포털 왕복**이 들어 있다(망을 타고, 2초 상한이 걸려 있다
            — notifications/portal.ts). 이 레이아웃은 모든 화면에 딸려 오므로, 감싸지
            않으면 **모든 화면 이동이 포털 왕복만큼 느려진다.** 감싸면 머리말과 본문이
            먼저 뜨고 종만 나중에 흘러 들어온다.

            fallback 이 null 인 까닭: 알림이 없을 때 종이 아예 안 그려지는 것과 **같은
            모습**이라 자리가 들썩이지 않는다. 뼈대를 두면 알림이 없는 사람에게는
            「있다가 사라지는 종」이 된다.

            🔴 실패는 이 자리에 오지 않는다 — DB 질의도 포털 왕복도 각자 삼키고 빈
            목록을 돌려준다. 그래서 error boundary 가 필요 없다.

            🔵 역할은 `session.user.role`(지금 쓰이는 역할)이다 — 개발 전용 「역할 바꿔
            보기」로 낮춰 보면 종도 함께 낮아져야 화면과 말이 맞는다.
          */
          <Suspense fallback={null}>
            <HeaderNotificationBell userId={session.user.id} role={session.user.role} subject={session.user.authSub} />
          </Suspense>
        }
        devRoleSwitch={env.devRoleOverride && session.actualRole === "ADMIN" ? <DevRoleSwitch effectiveRole={session.user.role} /> : null}
      />
      {workbook && workbook.status !== "OK" ? <WorkbookAlert status={workbook.status} parkedFile={workbook.parkedFile} errorCount={workbook.errorCount} /> : null}
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">
        <DrawingNoStyleProvider value={drawingNoStyle}>{children}</DrawingNoStyleProvider>
      </main>
    </div>
  );
}
