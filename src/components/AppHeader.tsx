import Link from "next/link";
import type { Role } from "@/db/schema/users";
import { ROLE_LABEL } from "@/lib/auth/role";
import type { DssService } from "@/lib/auth/oidc";
import { logoutAction } from "@/app/actions/auth";
import { ServiceMenuBar } from "@dss/ui";
import { HeaderMenuDismiss } from "@/components/HeaderMenuDismiss";

/**
 * 머리말형 레이아웃 (CLAUDE.md 9-4절). 사이드바는 화면이 스무 개를 넘기기 전까지 만들지 않는다.
 * 오른쪽의 「통합 로그인으로」는 포털 런처(/apps)로 가며 **세션을 끊지 않는다.** 로그아웃은 따로.
 *
 * 시스템 오가기 메뉴는 공용 패키지 `@dss/ui` 의 `ServiceMenuBar`(CLAUDE.md 9-5절).
 * 🔴 `variant="inline"` 에서는 `currentServiceId` 를 꼭 넘긴다 — 안 넘기면 단추에 「지금 어느 시스템인지」가 사라진다.
 * 목록은 ID 토큰의 `dss_services` → 서명 쿠키(service-menu-cookie.ts)에서 오고, 모양은 `DssService` = 포털 클레임 그대로라
 * 옮겨 담지 않고 넘긴다. 펼친 목록은 머리말 밖으로 떠서 그려지므로 이 header 와 조상에 overflow:hidden 을 걸지 않는다.
 *
 * ── 좁은 화면 (2026-10-22, 쓰는 분 요청) ──────────────────────────────────
 * 그 전까지 머리말은 **줄바꿈도 스크롤도 없는 한 줄**이었다. 폭이 모자라면 flex 칸이
 * 글자 폭(min-content = 한글 한 자)까지 줄어들어, 폰(360~412px)에서 「재고 관리」가
 * 「재 / 고 / 관 / 리」처럼 **세로로 쪼개졌다.** 노트북 창을 반만 줄여도 같은 증상이 났다.
 * 고친 방법은 셋이다:
 *
 *  1. **`whitespace-nowrap`** — 찌그러짐의 진짜 원인. 글자가 안 꺾이면 그 칸의 min-content 가
 *     낱말 전체 폭이 되어 **줄어들 수가 없다.** 아래 `NAV_LINK`·`HEADER_BUTTON` 과 제목·이름에 붙였다.
 *  2. **`flex-wrap`** — 그래도 폭이 모자랄 때 **줄을 바꾼다**(넘치거나 찌그러지는 대신).
 *     768~1100px 같은 어중간한 폭에서 머리말이 두 줄이 되는 것이 이 때문이다.
 *  3. **☰ (`md` 미만)** — 폰에서는 화면 링크 여섯과 사용자 묶음을 `<details>` 패널로 접는다.
 *
 * 🔴 **`md`(768px) 이상에서는 예전과 한 글자도 다르지 않다.** 768px 은 `@dss/ui` 의
 *    `ServiceMenuBar` 가 단추 이름을 감추는 폭과 **같은 값**이다(service-menu.css 의
 *    `@media not all and (min-width: 768px)` — 거기 주석이 「사이트가 그 폭에서 햄버거를
 *    감춘다」를 전제로 적혀 있다). 한쪽만 옮기면 두 단추의 모양이 어긋난다.
 *
 * 🔴 **☰ 는 `<details>`/`<summary>` 다 — 자바스크립트를 쓰지 않는다** (쓰는 분 결정).
 *    이 파일 맨 위에는 클라이언트 지시문이 없다(**서버 컴포넌트**다 — 그 낱말을 여기 적지
 *    않은 것은 일부러다. 「서버 컴포넌트로 남았는가」를 `grep` 한 줄로 세는 자리가 있어서,
 *    주석에 적어 두면 그 셈이 1 이 되어 사람을 속인다). `useState` 로 여닫으려면
 *    클라이언트로 내려야 하는데, 그 경계가 깨지면 **시험이 다 통과해도 화면이 안 열리는**
 *    종류의 결함이 생기고 `npm run build` 에서만 드러난다. 여는 일은 브라우저에 맡긴다.
 * 🔵 그 대가 하나가 있었다: 패널 안의 링크를 눌러 **화면을 옮겨도 패널이 열린 채로 남았다**
 *    (머리말은 레이아웃이라 화면을 옮겨도 다시 그려지지 않고, `open` 은 브라우저가 쥔 값이다).
 *    접으려면 ☰ 를 한 번 더 눌러야 했다.
 * 🔵 **2026-10-22 에 그것만 따로 고쳤다** — 아래 `<HeaderMenuDismiss />` 다. 머리말을 내리는 대신
 *    **아무것도 그리지 않는 조각 하나**를 `<details>` 안에 두어, 그 파일에만 클라이언트 경계를
 *    둔다. 이 파일은 그대로 서버 컴포넌트다. ☰ 를 여닫는 일도 여전히 브라우저가 한다 —
 *    그 조각은 **접히는 때**(안의 메뉴를 눌러 옮겼을 때 · 바깥을 눌렀을 때 · Esc)만 더한다.
 *
 * ── A/S 시스템과 같은 모양으로 (2026-10-22, 쓰는 분 요청 셋) ───────────────
 * 본보기는 A/S 시스템(다른 저장소)의 `src/components/layout/TopBar.tsx` 와 `AppShell.tsx` 다.
 * 바뀐 것은 **자리와 모양 셋**뿐이다 — 메뉴 목록도, 누가 무엇을 보는지도, 가는 곳도 그대로다.
 *
 *  1. **☰ 가 머리말 맨 왼쪽**으로 갔다(시스템 이름보다도 앞). 그 전에는 오른쪽 끝, 알림 종
 *     바로 왼쪽이었다.
 *  2. **메뉴가 왼쪽에서 나오는 서랍**이 됐다. 그 전에는 머리말 아래로 펼쳐지는 전폭 패널
 *     (`absolute inset-x-0 top-full`)이었다.
 *  3. **머리말이 스크롤을 내려도 화면 위에 남는다**(`sticky top-0`).
 *
 * 🔴 **`md`(768px) 이상은 한 글자도 안 바뀐다.** ☰ 와 서랍은 `md:hidden` 안에 통째로 들어
 *    있어 넓은 화면에서는 아예 그려지지 않는다. 넓은 화면에 더해지는 것은 3번 하나뿐이다.
 * 🔴 셋의 **까닭**은 저마다 그 자리의 주석에 적어 두었다(고정에 sticky 를 고른 까닭 · z 를
 *    실제로 재 본 값 · 검은 바탕이 왜 `<button>` 이어야 하는가 · 노치 인셋 둘).
 *    **클래스만 보고 「쓸데없어 보인다」며 지우지 마라.**
 */
export interface AppHeaderProps {
  user: { name: string; role: Role };
  portalUrl: string;
  services: DssService[];
  currentServiceId: string;
  /**
   * 🔴 「설정」을 **보일지**가 아니라 **어디로 보낼지**를 가른다 (2026-10-21). 설정 안에 모두가 쓰는
   * 탭이 둘(결재권 위임 · O/H 템플릿) 생겨 링크 자체는 누구에게나 선다 — 다만 관리자 전용 첫 탭으로
   * 보내면 일반 사용자가 `/forbidden` 으로 튀므로 갈 곳만 갈린다(아래 「설정」 링크의 주석).
   * 실제 차단은 여기가 아니라 각 화면의 `requireRole`/`requireSession` 이 한다.
   * 🔵 「대기 N」 배지는 이 값을 보지 않는다 — 역할과 무관하게 「부품 요청」 옆에 선다(아래 `PendingBadge`).
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

/**
 * 머리말 메뉴 한 칸(넓은 화면). 🔵 `whitespace-nowrap` 은 모양이 아니라 **울타리**다 —
 * 없으면 폭이 모자랄 때 이 칸이 한글 한 자 폭까지 줄어 글자가 세로로 선다(위 머리말 주석).
 */
const NAV_LINK = "rounded-md px-2 py-1 text-sm whitespace-nowrap text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900";

/** ☰ 패널 안의 메뉴 한 칸(좁은 화면). 같은 링크를 **세로로** 세운 것뿐이다 — 가는 곳도 자격도 같다. */
const PANEL_LINK = "block rounded-md px-2 py-2 text-sm whitespace-nowrap text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900";

/** [통합 로그인으로]·[로그아웃] 의 생김새. 두 자리(넓은 화면·☰ 패널)가 같은 값을 쓴다. */
const HEADER_BUTTON = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm whitespace-nowrap text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";

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

/**
 * 화면 링크 여섯. **넓은 화면의 `<nav>` 와 ☰ 패널이 이 조각 하나를 함께 쓴다** — 생김새(`linkClassName`)만
 * 다르다. 🔴 두 벌로 베껴 적지 않는 까닭: 여기 달린 자격 규칙(`isAdmin`·`canRecord`)이 갈리면 **폰과
 * 컴퓨터가 서로 다른 메뉴를 그린다.** 베낀 쪽은 고칠 때 잊히고, 그 어긋남은 아무 오류도 내지 않는다.
 */
function ScreenLinks({
  isAdmin,
  canRecord,
  pendingRequests,
  linkClassName,
}: {
  isAdmin: boolean;
  canRecord: boolean;
  pendingRequests: number;
  linkClassName: string;
}) {
  return (
    <>
      <Link href="/" className={linkClassName}>
        재고 현황
      </Link>
      {canRecord && (
        <Link href="/entries/new" className={linkClassName}>
          수량 변경 기록
        </Link>
      )}
      <Link href="/entries" className={linkClassName}>
        기록 내역
      </Link>
      {/* 🔴 「부품 요청」은 **기록 권한 이상 모두**에게 보인다 (2026-10-15 사용자 결정: 신청자도 보기만 한다).
          관리자는 거기서 처리하고, 신청자는 자기 요청이 어디까지 갔는지 본다. 막는 자리는 그 화면의 requireRole. */}
      {canRecord && (
        <Link href="/requests" className={linkClassName}>
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
      <Link href="/approvals" className={linkClassName}>
        승인 요청건
      </Link>
      {/* 🔴 「설정」은 **로그인한 모두**에게 보인다 (2026-10-21) — 설정 안에 모두가 쓰는 탭이 둘
          (결재권 위임 · O/H 템플릿) 생겼기 때문이다. 역할로 가리면 결재선에 든 보기 권한자가
          자기 위임을 만들러 갈 길이 없다.
          🔴 **가는 곳이 역할에 따라 다르다.** 모두에게 `/settings/items`(관리자 전용)를 물리면
          일반 사용자는 누르자마자 `/forbidden` 으로 튄다 — 「설정이 고장났다」로 읽힌다. 자기에게
          열려 있는 첫 탭으로 보낸다(그 차례는 `SettingsNav` 의 ITEMS 순서와 같다).
          🔵 「변경 이력」(/audit)은 설정의 탭으로 옮겼다 (2026-10-15 사용자 요청). 주소는 그대로다 —
          옮기면 열려 있는 탭·즐겨찾기가 깨지고 얻는 것이 없다. */}
      <Link href={isAdmin ? "/settings/items" : "/settings/delegations"} className={linkClassName}>
        설정
      </Link>
    </>
  );
}

/** 이름 + 역할 배지. 넓은 화면의 오른쪽 끝과 ☰ 패널이 같은 조각을 쓴다(두 곳이 갈리지 않게). */
function UserIdentity({ user }: { user: { name: string; role: Role } }) {
  return (
    <span className="text-sm whitespace-nowrap text-zinc-700">
      <span className="font-medium text-zinc-900">{user.name}</span>
      <span
        className="ml-2 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-700"
        title={user.role}
      >
        {ROLE_LABEL[user.role]} · {user.role}
      </span>
    </span>
  );
}

export function AppHeader({ user, portalUrl, services, currentServiceId, isAdmin, canRecord, pendingRequests, notificationBell, devRoleSwitch }: AppHeaderProps) {
  return (
    // ── 🔴 머리말은 굴러도 화면 위에 남는다 (2026-10-22, 쓰는 분 요청 셋째) ──────────
    //
    // 🔴 옛 `relative` 가 `sticky` 로 **바뀐** 것이지 더해진 것이 아니다. 둘 다 `position`
    //    이라 한 요소에 같이 쓸 수 없고, 함께 적으면 Tailwind 가 CSS 를 찍는 차례에 따라
    //    한쪽이 **조용히** 이긴다. 옛 `relative` 는 ☰ 패널이 기댈 자리였는데, 그 패널이
    //    아래에서 **화면에 매달리는 서랍**(fixed)으로 바뀌어 기댈 자리가 필요 없어졌다.
    //    종·📦▾ 의 펼친 목록은 저마다 제 상자(.dss-bell · .dss-menu__dropdown)가
    //    position: relative 라 애초에 이 자리를 쓰지 않았다 — 건드리지 않았다.
    //
    // 🔴 **A/S 시스템과 방법이 다르다 — 일부러 그랬다(2026-10-22 결정).** A/S 는 sticky 를
    //    쓰지 않는다: 페이지 자체는 안 구르고 <main> 만 제 안에서 구르는 구조
    //    (overflow-y-auto)라 머리말이 자연히 위에 남는다. 그 구조를 여기로 통째로 옮기면
    //    인쇄·팝업·폰 주소창 높이까지 전부 걸린다. 보이는 결과는 같고 위험이 훨씬 작아
    //    `sticky top-0` 을 골랐다. 바깥(app/(app)/layout.tsx)이 `flex min-h-full flex-col`
    //    이고 이를 막는 overflow 가 조상에 없어 그대로 먹는다.
    //    🔴 「A/S 와 다르다」는 까닭만으로 되돌리지 마라.
    //
    // 🔴 `z-30` 은 **재 본 값**이다 (2026-10-22, `grep -rn "z-" src/`). 본문 쪽에서 가장 높은
    //    것이 ScrollSelect 펼침 목록의 20 하나뿐이라 30 이면 그 위다.
    //    🔴 `sticky` 에 z 를 주면 머리말이 **쌓임 맥락**을 만든다. 그 뒤로 머리말 **안**의
    //    z 값(종 목록 50 · 📦▾ 목록 50 — 둘 다 @dss/ui 의 CSS · 아래 서랍 60)은 전부 이
    //    맥락 안에서만 겨루고, 바깥과는 이 30 하나로 겨룬다. 그래서 본문에 30 이상을 더하는
    //    날에는 **이 값도 함께 올려야 한다** — 안 올리면 머리말이 덮이는데 오류는 안 난다.
    //    🔵 showModal() 로 여는 <dialog> 는 top layer 에 올라가 z 와 무관하게 늘 위다.
    //
    // 🔵 `print:static` — 인쇄에서 고정은 방해다(브라우저에 따라 쪽마다 겹쳐 찍히거나 첫 쪽
    //    본문을 가린다). static 으로 돌리면 z-index 도 함께 뜻을 잃어 되돌림이 하나면 된다.
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white print:static">
      {/* 🔵 위아래를 한꺼번에 주던 패딩이 위·아래로 갈린 까닭: 머리말이 화면 맨 위에
          고정되면서 **노치 밑에 깔릴 수 있는 맨 위 요소**가 됐다. 🔴 패딩과 인셋은
          **한 클래스 안에서 calc 로 더해야** 한다 — 위아래를 한꺼번에 주는 클래스를 둔 채
          인셋을 따로 걸면 같은 padding-top 을 두 클래스가 다투고, 지는 날 아이폰에서 인셋이
          조용히 사라진다(A/S TopBar.tsx 의 같은 주석).
          인셋이 0인 기기에서는 정확히 12px 이라 예전과 **픽셀 단위로 같다.**
          🔵 이 앱은 아직 viewport-fit=cover 를 켜지 않아 인셋이 늘 0 이다 — 켜는 날 저절로 맞는다.
          🔴 이 주석에 그 클래스 이름을 **대괄호째 적지 마라.** Tailwind 는 주석까지 긁어
             가짜 클래스를 CSS 로 찍으려 들고, 줄임표가 섞이면 globals.css 가 통째로 깨진다. */}
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {/*
            ☰ — `md` 미만에서만 선다. 🔴 **머리말 맨 왼쪽**이다, 시스템 이름보다도 앞
            (2026-10-22 쓰는 분 요청 첫째. 본보기는 A/S 의 layout/TopBar.tsx — 거기서도 ☰ 가
            머리말의 첫 자식이다). 그 전에는 오른쪽 끝, 알림 종 바로 왼쪽이었다.
            🔵 옮긴 것은 **자리뿐**이다. 안에 든 링크도 자격 규칙도 한 줄 안 바뀌었다.
            🔴 `md` 이상에서는 `md:hidden` 이라 아예 그려지지 않는다 — 그래서 자리를 옮겨도
               넓은 화면은 예전과 글자 하나 다르지 않다.
            🔴 `shrink-0` — 이 줄에서 눌려도 되는 것은 글자뿐이다(A/S TopBar.tsx 의 같은 주석).
               없으면 좁은 폭에서 flex 가 `w-9` 를 깎아 **손가락에 안 잡히는 크기**가 된다.
            🔴 `<details>` 라서 **자바스크립트가 없다**(파일 머리말의 까닭). `<summary>` 앞의
               ▶ 삼각형은 `list-none`(파이어폭스·크롬) 과 `::-webkit-details-marker`(사파리)
               **둘 다** 꺼야 사라진다.
            🔴 `data-header-menu` 는 모양이 아니라 **표식**이다 — 아래 `<HeaderMenuDismiss />` 가
               「우리 ☰」만 골라 집는 손잡이로 쓴다(`details[data-header-menu][open]`). 이 칸을
               지우거나 이름을 바꾸면 서랍이 **저절로 안 접히는데 오류도 안 난다.**
          */}
          <details className="no-print shrink-0 md:hidden" data-header-menu="">
            <summary
              className="relative flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md text-zinc-700 select-none hover:bg-zinc-100 [&::-webkit-details-marker]:hidden"
              // 🔴 접으면 「대기 N」 배지가 서랍 안으로 숨는다 — **할 일이 있다는 사실**만은
              //    접힌 채로도 보여야 해서 아래 점을 찍고, 화면 낭독기에는 이름으로 말한다.
              //    세는 값은 여전히 하나다(`pendingRequests`) — 숫자 자체는 서랍의 「부품 요청」 줄에 있다.
              aria-label={pendingRequests > 0 ? `메뉴 — 확인 대기 ${pendingRequests}건` : "메뉴"}
            >
              <span aria-hidden="true" className="text-lg leading-none">
                ☰
              </span>
              {pendingRequests > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white"
                  title="확인 대기 중인 반출 신청"
                />
              ) : null}
            </summary>
            {/* 서랍을 **저절로 접는** 조각 (2026-10-22 쓰는 분 요청). 아무것도 그리지 않는다 —
                마크업이 한 글자도 늘지 않으므로 아래 서랍의 모양과 차례는 그대로다.
                🔵 이 조각이 없어도(스크립트가 아직 안 붙었어도) ☰ 는 눌러서 열리고 다시 눌러
                   접힌다. 더해지는 것은 **접히는 때** 셋뿐이다 — 까닭은 그 파일 머리말에. */}
            <HeaderMenuDismiss />
            {/*
              서랍 — 왼쪽에서 나온다 (2026-10-22 쓰는 분 요청 둘째. 본보기는 A/S 의
              layout/AppShell.tsx 모바일 드로어). 그 전에는 머리말 아래로 펼쳐지는 전폭 패널
              (`absolute inset-x-0 top-full`)이었다.

              🔴 `fixed` 는 **화면**에 매달린다 — 머리말에 매달리지 않는다. 위 `sticky` 는
                 position:fixed 의 기준(containing block)을 만들지 않으므로(그것을 만드는 것은
                 transform·filter·contain 같은 것들이다) 머리말 안에 적어도 화면 전체를 덮는다.
              🔴 z 는 **머리말 안에서만** 겨룬다(머리말이 쌓임 맥락이다 — 위 <header> 주석).
                 같은 맥락에 종의 펼친 목록과 📦▾ 의 펼친 목록이 각각 50 으로 들어와 있고,
                 50 끼리 맞비기면 **뒤에 적힌 쪽**이 이긴다(종이 이 서랍보다 뒤에 있다).
                 서랍은 화면을 덮는 것이므로 둘보다 위여야 해서 60 으로 둔다.
              🔵 `md:hidden`·`print:hidden` 을 여기 또 적지 않는다 — 바깥 `<details>` 가 이미
                 `no-print md:hidden` 이라 넓은 화면과 인쇄에서는 통째로 사라진다.
            */}
            <div className="fixed inset-0 z-[60] flex">
              {/*
                검은 바탕. 🔴 **반드시 `<button>` 이어야 한다** — 모양 때문이 아니라
                **눌러서 닫히게 하려고** 그렇다.

                서랍이 되면서 이 바탕이 `<details>` **안**으로 들어왔다. 그래서
                HeaderMenuDismiss 의 「바깥 누르기」(pointerdown)에는 **안 걸린다** — 안이니까.
                걸리는 길은 다른 쪽이다: 패널 **안**은 click 으로 듣고, 눌린 것이 거기
                `PANEL_ACTIONS = "a, button"` 에 걸릴 때만 접는다. 이것이 `<button>` 이면 그대로
                접히고, 평범한 `<div>` 면 **눌러도 아무 일이 없는데 오류도 안 난다.**
                🔴 규칙이 두 파일에 흩어져 있어 한쪽만 바뀌면 조용히 깨진다 — 두 파일을 맞대어
                   보는 시험이 tests/header-menu-dismiss.test.ts ⑥ 에 있다.
                🔴 `type="button"` 을 빠뜨리지 마라. 빠지면 기본값이 `submit` 이다. 지금은 이
                   단추가 아래 `<form action={logoutAction}>` **밖**이라 당장 로그아웃이 날아가지는
                   않지만, 같은 서랍 안에 그 폼이 있어 마크업을 조금만 손대면 바로 그렇게 된다.
                🔵 `click` 으로 접히는 것도 일부러다 — 누르는 순간 접으면 서랍 안쪽이
                   display:none 이 되어 눌린 것의 click 이 아예 안 난다(그 파일 주석).
              */}
              <button type="button" aria-label="메뉴 닫기" className="absolute inset-0 bg-black/40" />
              {/*
                서랍 본체. 🔴 아래쪽 인셋 패딩의 까닭: 서랍은 화면 높이를 꽉 채우므로, 없으면
                **맨 아래 칸**(로그아웃·역할 바꿔 보기)이 홈 인디케이터/제스처 바에 겹쳐 눌리지
                않는다 — A/S 에서 **실제로 겪은 일**이다(AppShell.tsx 의 같은 주석).
                🔴 패딩과 인셋은 **한 클래스 안에서** 더한다 — 따로 두면 같은 padding-bottom 을
                   두 클래스가 다투고, 지는 날 아이폰에서 인셋이 조용히 사라진다. 인셋이 0인
                   기기에서는 정확히 12px 이라 옛 패널의 `py-3` 와 같다.
                🔵 `overflow-y-auto`(+`min-h-0`) — 가로로 눕힌 폰에서는 메뉴가 화면보다 길다.
                   `overscroll-contain` 은 끝까지 민 스크롤이 뒤 페이지로 새는 것을 막는다.
              */}
              <div className="relative z-50 flex min-h-0 w-64 flex-col overflow-y-auto overscroll-contain border-r border-zinc-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                <nav aria-label="화면" className="flex flex-col gap-0.5">
                  <ScreenLinks isAdmin={isAdmin} canRecord={canRecord} pendingRequests={pendingRequests} linkClassName={PANEL_LINK} />
                </nav>
                {/*
                  빈 칸막이 — 아래 묶음을 **서랍 바닥**에 붙인다 (2026-10-22, 쓰는 분 요청).
                  그 전에는 메뉴 링크 여섯 **바로 밑**에 붙어 있고 그 아래로 빈 자리가 길게 남았다.
                  🔵 바뀌는 것은 **자리뿐**이다 — 아래 묶음 안의 차례(이름 → 통합 로그인으로 →
                     로그아웃 → 역할 바꿔 보기)는 넓은 화면의 오른쪽 끝 차례와 일부러 같게 맞춰
                     둔 것이라 손대지 않았다.

                  🔴 **`mt-auto` 를 쓰지 않은 까닭.** 아래 묶음에 margin-top:auto 를 주면 자리가
                     남을 때는 잘 내려가지만, 메뉴가 **서랍보다 길어지는 순간**(가로로 눕힌 폰 ·
                     글자 크기를 키운 기기 · 메뉴가 더 느는 날) 남는 자리가 없어 auto 가 **0 으로
                     풀린다.** 그러면 지금 보장돼 있는 구분선 위 12px 간격(아래 `mt-3`)이 사라져
                     구분선이 마지막 링크에 바짝 달라붙는다 — 간격이 가장 필요한 때에 없어지는데
                     오류는 한 줄도 안 나고 눈에만 드러난다.

                  🔵 **칸막이는 두 경우가 모두 옳다.** 서랍 본체가 세로 flex 이고 높이가 화면에
                     매여 있으므로(바깥이 fixed inset-0),
                      · 자리가 남으면 `grow` 가 남는 자리를 **전부** 가져가 아래 묶음이 바닥에 붙고,
                      · 내용이 길어지면 남는 자리가 없어 칸막이가 **높이 0** 으로 줄어 **예전과
                        픽셀 단위로 같은 모양**이 된다(스크롤도 그대로 생긴다).
                     아래 묶음의 `mt-3` 은 두 경우 다 그대로 12px 이다 — 바깥 여백은 남는 자리를
                     나눠 주기 **전에** 떼어 두는 몫이라 `grow` 가 먹지 않는다.
                     🔵 칸막이는 `flex-basis: auto` + 내용 없음이라 밑너비가 0 이다. 그래서 자리가
                        모자랄 때 flex 가 깎을 것도 없다 — 깎이는 쪽은 늘 **아무도 아니다**.

                  🔴 **빈 div 라고 지우지 마라.** 지우면 아래 묶음이 다시 링크 바로 밑으로
                     올라붙는데 오류는 안 난다. 그것을 지키는 시험이
                     tests/app-header-responsive.test.ts ⑩ 에 있다.
                  🔵 `aria-hidden` — 아무것도 그리지 않으므로 낭독기에 알릴 것이 없다.
                  🔵 HeaderMenuDismiss 의 「안쪽을 누르면 접는다」 규칙은 `a, button` 만 본다 —
                     칸막이는 링크도 단추도 아니라 거기 안 걸린다. 눌러도 아무 일이 없다(맞다).
                  🔴 아래쪽 노치 여백은 **서랍 바깥 상자**(위 본체 div)에 그대로 있다. 칸막이가
                     바닥까지 밀어 주는 것은 그 여백 **안쪽**까지다 — 그래서 맨 아래 단추가
                     홈 인디케이터에 겹치지 않는다. 그 여백을 여기로 옮기지 마라.
                */}
                <div aria-hidden="true" className="grow" />
                {/* 구분선 아래는 넓은 화면에서 오른쪽 끝에 서 있던 것들 — 차례도 그대로다. */}
                <div className="mt-3 flex flex-col items-stretch gap-2 border-t border-zinc-200 pt-3">
                  <UserIdentity user={user} />
                  <a href={portalUrl} className={`${HEADER_BUTTON} block text-center`}>
                    통합 로그인으로
                  </a>
                  <form action={logoutAction}>
                    <button type="submit" className={`${HEADER_BUTTON} w-full`}>
                      로그아웃
                    </button>
                  </form>
                  {devRoleSwitch}
                </div>
              </div>
            </div>
          </details>
          <Link href="/" className="shrink-0 text-base font-semibold whitespace-nowrap text-zinc-900">
            재고 관리
          </Link>
          <ServiceMenuBar
            services={services}
            currentServiceId={currentServiceId}
            variant="inline"
            className="shrink-0"
          />
          {/* 머리말 메뉴 (DESIGN 2절 화면 흐름). 수량 변경 기록·기록 내역은 조각 4 에서 더해진다.
              🔵 `md` 미만에서는 이 줄이 통째로 사라지고 **같은 링크가 ☰ 서랍 안에 세로로** 선다
              (같은 `ScreenLinks` 조각이다 — 자격 규칙이 두 벌이 되지 않게). */}
          <nav aria-label="화면" className="hidden flex-wrap items-center gap-1 no-print md:flex">
            <ScreenLinks isAdmin={isAdmin} canRecord={canRecord} pendingRequests={pendingRequests} linkClassName={NAV_LINK} />
          </nav>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {/* 넓은 화면의 사용자 묶음. `md` 미만에서는 통째로 ☰ 서랍 안으로 들어간다. */}
          <div className="hidden items-center gap-3 md:flex">
            {devRoleSwitch}
            <UserIdentity user={user} />
            <a href={portalUrl} className={HEADER_BUTTON}>
              통합 로그인으로
            </a>
            <form action={logoutAction}>
              <button type="submit" className={HEADER_BUTTON}>
                로그아웃
              </button>
            </form>
          </div>
          {/* 통합 알림 종. [로그아웃] **오른쪽**, 머리말 맨 끝에 선다 — 펼친 목록이 종에
              오른쪽 끝을 맞춰 왼쪽으로 펼쳐지므로(@dss/ui 의 CSS 는 right: 0) 머리말
              맨 오른쪽 끝인 이 자리와 잘 맞는다. 자료를 가져오는 것은 이 파일이
              아니다(위 prop 주석).
              🔴 **좁은 화면에서도 접지 않는다** (쓰는 분 결정) — 알림은 접힌 서랍 안에서
              기다리면 안 되는 것이고, 이 자리가 비면 목록이 설 자리도 함께 어긋난다.
              🔵 2026-10-22 에 ☰ 가 머리말 맨 왼쪽으로 가면서, 좁은 화면에서 이 줄의 오른쪽
              끝에 남는 것은 **종 하나**가 됐다. 「종이 맨 오른쪽」이라는 전제는 그대로다 —
              오히려 더 분명해졌다. 종 오른쪽에 무언가를 더하면 그때 목록이 잘린다. */}
          {notificationBell}
        </div>
      </div>
    </header>
  );
}
