"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { SERVICE_MENU_COOKIE, SESSION_COOKIE, expiredCookieOptions } from "@/lib/auth/cookies";
import { getSession } from "@/lib/auth/session";

/**
 * 이 시스템에서 로그아웃. 세션 쿠키를 지우고 /login 으로 보낸다.
 *
 * 포털의 SSO 세션은 그대로 둔다 — 포털 로그아웃(end_session)으로 보내려면 post_logout_redirect_uri 를
 * 포털에 등록해야 하는데, 지금 등록된 것은 redirect_uri 하나뿐이다 (포털등록값 2026-10-06).
 * 그래서 다시 [로그인]을 누르면 포털 세션이 살아 있는 동안은 아무것도 묻지 않고 바로 들어온다 (6-3절).
 * 포털까지 끊고 싶으면 머리말의 「통합 로그인으로」에서 포털 쪽 로그아웃을 쓴다.
 *
 * 서버 액션은 Next 가 Origin 을 Host 와 대조해 CSRF 를 막는다 (Next 16 문서 server-actions).
 */
export async function logoutAction(): Promise<void> {
  const s = await getSession();
  if (s) {
    void writeAudit({ action: "LOGOUT", actorId: s.user.id, actorName: s.user.name, target: `users:${s.user.id}` });
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, "", expiredCookieOptions("/"));
  store.set(SERVICE_MENU_COOKIE, "", expiredCookieOptions("/"));
  redirect("/login?info=logged_out");
}
