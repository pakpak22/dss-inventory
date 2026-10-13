"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { SERVICE_MENU_COOKIE, SESSION_COOKIE, expiredCookieOptions } from "@/lib/auth/cookies";
import { buildLogoutUrl } from "@/lib/auth/oidc";
import { getSession } from "@/lib/auth/session";

/**
 * 로그아웃 — 이 시스템의 세션을 끊고 **포털 세션까지** 끝낸다.
 *
 * 예전에는 이 시스템 세션만 끊었다. 포털 로그아웃(end_session)으로 보내려면 post_logout_redirect_uri 를
 * 포털에 등록해야 하는데 등록된 것이 redirect_uri 하나뿐이었기 때문이다 (포털등록값 2026-10-06).
 * 🔵 **그 등록이 2026-10-13 에 끝났다.** 그래서 이제 포털까지 보낸다 — 쿠키만 지우면 포털 세션이
 * 그대로 살아 있어, 로그아웃한 사람이 [로그인]을 한 번 누르는 것만으로 누구인지 묻지도 않고 다시
 * 들어온다. 공용 PC 에서는 그것이 곧 로그아웃이 안 된 것이다.
 *
 * 🔴 **차례가 중요하다 — 이 시스템을 먼저 끊는다.** 포털이 꺼져 있거나 discovery 를 못 읽어도
 * 이 사이트에서는 이미 나가 있어야 한다. 그때는 예전처럼 /login 으로 물러선다.
 *
 * 🔴 **돌아갈 주소를 붙이지 않는다** — 포털 로그인 화면에 머무는 것이 맞다. 까닭은 buildLogoutUrl
 * (lib/auth/oidc.ts) 에 적었다.
 *
 * 포털에서 먼저 로그아웃한 경우는 반대 방향이다 — 포털이 백채널 로그아웃으로 알려 온다 (6-8절,
 * api/auth/sso/backchannel-logout).
 *
 * 서버 액션은 Next 가 Origin 을 Host 와 대조해 CSRF 를 막는다 (Next 16 문서 server-actions).
 */
export async function logoutAction(): Promise<void> {
  const s = await getSession();
  if (s) {
    void writeAudit({ action: "LOGOUT", actorId: s.user.id, actorName: s.user.name, target: `users:${s.user.id}` });
  }

  // 1) 이 시스템에서 먼저 나간다. 메뉴바 쿠키도 함께 — 세션과 수명을 같이한다.
  const store = await cookies();
  store.set(SESSION_COOKIE, "", expiredCookieOptions("/"));
  store.set(SERVICE_MENU_COOKIE, "", expiredCookieOptions("/"));

  // 2) 그다음 포털까지 보낸다. 못 가면 이 시스템의 로그인 화면으로 물러선다.
  let portalLogoutUrl: string | null = null;
  try {
    portalLogoutUrl = await buildLogoutUrl();
  } catch (e) {
    // 포털이 꺼져 있거나 discovery 가 안 읽힌다. 상세 사유는 서버 로그에만 남긴다.
    console.warn("[auth] 포털 로그아웃 주소를 읽지 못했습니다:", e instanceof Error ? e.message : e);
  }

  redirect(portalLogoutUrl ?? "/login?info=logged_out");
}
