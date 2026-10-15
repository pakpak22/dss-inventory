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
  /**
   * 관리자 메뉴(설정)를 보일지.
   * 숨기는 것은 편의일 뿐이고 실제 차단은 각 화면의 requireRole 이 한다.
   * 🔵 「대기 N」 배지는 이제 이 값을 보지 않는다 — 역할과 무관하게 「부품 요청」 옆에 선다(아래 `PendingBadge`).
   */
  isAdmin: boolean;
  /** 기록·관리자 메뉴(수량 변경 기록·부품 요청)를 보일지. 🔵 「부품 요청」은 2026-10-15 부터 신청자도 **보기만** 한다. */
  canRecord: boolean;
  /** 확인 대기 중인 반출 신청 수. 0 이면 표시 없음 */
  pendingRequests: number;
  /**
   * 통합 알림 종(@dss/ui). **다 그려진 노드**를 받는다 — 여기서 자료를 가져오지 않는다.
   * 🔴 위 `pendingRequests` 배지와 **역할이 다르다**: 배지는 「부품 요청 화면에 할 일이
   * 있다」는 표시이고, 종은 여러 사내 시스템의 알림을 모으는 자리다. 둘 다 남는다.
   * 🔵 알림이 0건이면 조각이 스스로 null 이 되고, 래퍼로 감싸지 않으므로 **머리말이
   * 예전과 글자 하나 다르지 않다**(빈 칸도 여백도 생기지 않는다).
   */
  notificationBell?: React.ReactNode;
  /** 개발 전용 역할 바꿔 보기 조각. 운영에서는 null */
  devRoleSwitch?: React.ReactNode;
}

const NAV_LINK = "rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900";

/**
 * 「대기 N」 — 확인 대기 중인 반출 신청 수 (0 이면 아무것도 그리지 않는다).
 *
 * 🔴 **자리는 「부품 요청」 하나다 — 역할로 가르지 않는다** (2026-10-15 사용자 결정). 그 전에는 관리자만
 *    「부품 요청」에 달고 그 밖의 사람은 「기록 내역」에 달았는데, 같은 날 기록 내역의 「확인 대기」 구역을
 *    걷어내 **신청이 보이는 자리가 `/requests` 하나**가 됐다. 배지를 기록 내역에 두면 눌러도 신청이 없다.
 * 🔵 숫자와 `title` 은 누구에게나 같은 것이다(`countPendingRequests` — 보류한 신청은 이 숫자에서 빠진다.
 *    stock/codes.ts 의 `ACTIONABLE_REQUEST_STATUSES`). 관리자에게는 「처리할 것」, 신청자에게는
 *    「담당자가 아직 보고 있는 것」으로 읽히지만 **세는 묶음이 같아** 두 벌로 세지 않는다.
 */
function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900" title="확인 대기 중인 반출 신청">
      대기 {count}
    </span>
  );
}

export function AppHeader({ user, portalUrl, services, currentServiceId, isAdmin, canRecord, pendingRequests, notificationBell, devRoleSwitch }: AppHeaderProps) {
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
            </Link>
            {/* 🔴 「부품 요청」은 **기록 권한 이상 모두**에게 보인다 (2026-10-15 사용자 결정: 신청자도 보기만 한다).
                관리자는 거기서 처리하고, 신청자는 자기 요청이 어디까지 갔는지 본다. 막는 자리는 그 화면의 requireRole. */}
            {canRecord && (
              <Link href="/requests" className={NAV_LINK}>
                부품 요청
                {/* 🔴 배지는 **역할과 무관하게** 여기 선다 (2026-10-15) — 신청이 보이는 자리가 이 화면 하나다.
                    기록 내역에 달던 것은 거기 「확인 대기」 구역이 있던 때의 이야기이고, 그 구역은 걷어냈다. */}
                <PendingBadge count={pendingRequests} />
              </Link>
            )}
            {/* 🔴 「승인 요청건」은 **로그인한 모두**에게 보인다 (2026-10-15, 조각 11b) — 결재자는 역할과 무관하게
                누구나 될 수 있고(결재선은 A/S 명부에서 고른다), 역할로 가리면 결재선에 든 보기 권한자가 자기
                차례를 못 찾는다. 막는 자리는 그 화면의 requireSession 과 각 서버 액션이다.
                🔴 **배지(「N건」)를 달지 않는다.** 머리말은 모든 화면에 딸려 오므로 질의가 하나 늘면 **모든 화면이**
                그만큼 느려진다. 「내가 결재할 건이 있다」를 알리는 것은 **알림 종의 일**이고, 종에 싣는 것은
                다음 조각이다(종은 이미 한 번에 모아 읽는 자리라 질의가 늘지 않는다). */}
            <Link href="/approvals" className={NAV_LINK}>
              승인 요청건
            </Link>
            {isAdmin && (
              /* 🔵 「변경 이력」(/audit)은 설정의 탭으로 옮겼다 (2026-10-15 사용자 요청). 주소는 그대로다 —
                 옮기면 열려 있는 탭·즐겨찾기가 깨지고 얻는 것이 없다. */
              <Link href="/settings/items" className={NAV_LINK}>
                설정
              </Link>
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
          {/* 통합 알림 종. [로그아웃] **오른쪽**, 머리말 맨 끝에 선다 — 펼친 목록이 종에
              오른쪽 끝을 맞춰 왼쪽으로 펼쳐지므로(@dss/ui 의 CSS 는 right: 0) 머리말
              맨 오른쪽 끝인 이 자리와 잘 맞는다. 자료를 가져오는 것은 이 파일이
              아니다(위 prop 주석). */}
          {notificationBell}
        </div>
      </div>
    </header>
  );
}
