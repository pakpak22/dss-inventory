import Link from "next/link";
import type { Role } from "@/db/schema/users";
import { ROLE_LABEL } from "@/lib/auth/role";
import type { DssService } from "@/lib/auth/oidc";
import { logoutAction } from "@/app/actions/auth";
import { ServiceMenuBar } from "@dss/ui";

/**
 * 머리말형 레이아웃 (CLAUDE.md 9-4절). 사이드바는 화면이 스무 개를 넘기기 전까지 만들지 않는다.
 * 오른쪽의 「통합 로그인으로」는 포털 런처(/apps)로 가며 **세션을 끊지 않는다.** 로그아웃은 따로.
 *
 * 시스템 오가기 메뉴는 공용 패키지 `@dss/ui` 의 `ServiceMenuBar`(CLAUDE.md 9-5절).
 * 🔴 `variant="inline"` 에서는 `currentServiceId` 를 꼭 넘긴다 — 안 넘기면 단추에 「지금 어느 시스템인지」가 사라진다.
 * 목록은 ID 토큰의 `dss_services` → 서명 쿠키(service-menu-cookie.ts)에서 오고, 모양은 `DssService` = 포털 클레임 그대로라
 * 옮겨 담지 않고 넘긴다. 펼친 목록은 머리말 밖으로 떠서 그려지므로 이 header 와 조상에 overflow:hidden 을 걸지 않는다.
 */
export interface AppHeaderProps {
  user: { name: string; role: Role };
  portalUrl: string;
  services: DssService[];
  currentServiceId: string;
  /** 관리자 메뉴(변경 이력·설정)를 보일지. 숨기는 것은 편의일 뿐이고 실제 차단은 각 화면의 requireRole 이 한다. */
  isAdmin: boolean;
  /** 기록·관리자 메뉴(수량 변경 기록)를 보일지 */
  canRecord: boolean;
  /** 확인 대기 중인 반출 신청 수. 0 이면 표시 없음 */
  pendingRequests: number;
  /** 개발 전용 역할 바꿔 보기 조각. 운영에서는 null */
  devRoleSwitch?: React.ReactNode;
}

const NAV_LINK = "rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900";

export function AppHeader({ user, portalUrl, services, currentServiceId, isAdmin, canRecord, pendingRequests, devRoleSwitch }: AppHeaderProps) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-base font-semibold text-zinc-900">
            재고 관리
          </Link>
          <ServiceMenuBar
            services={services}
            currentServiceId={currentServiceId}
            variant="inline"
            className="shrink-0"
          />
          {/* 머리말 메뉴 (DESIGN 2절 화면 흐름). 수량 변경 기록·기록 내역은 조각 4 에서 더해진다. */}
          <nav aria-label="화면" className="flex items-center gap-1 no-print">
            <Link href="/" className={NAV_LINK}>
              재고 현황
            </Link>
            {canRecord && (
              <Link href="/entries/new" className={NAV_LINK}>
                수량 변경 기록
              </Link>
            )}
            <Link href="/entries" className={NAV_LINK}>
              기록 내역
              {pendingRequests > 0 ? (
                <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900" title="확인 대기 중인 반출 신청">
                  대기 {pendingRequests}
                </span>
              ) : null}
            </Link>
            {isAdmin && (
              <>
                <Link href="/audit" className={NAV_LINK}>
                  변경 이력
                </Link>
                <Link href="/settings/items" className={NAV_LINK}>
                  설정
                </Link>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {devRoleSwitch}
          <span className="text-sm text-zinc-700">
            <span className="font-medium text-zinc-900">{user.name}</span>
            <span
              className="ml-2 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-700"
              title={user.role}
            >
              {ROLE_LABEL[user.role]} · {user.role}
            </span>
          </span>
          <a
            href={portalUrl}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            통합 로그인으로
          </a>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
