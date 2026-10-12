import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role, User } from "@/db/schema/users";
import type { DssService } from "./oidc";
import { roleAtLeast } from "./role";
import { DEV_ROLE_COOKIE, SERVICE_MENU_COOKIE, SESSION_COOKIE } from "./cookies";
import { env } from "@/lib/env";
import { isRole } from "./role";
import { verifyValue } from "./signed-value";
import { decodeServiceMenu } from "./service-menu-cookie";
import { decodeSession, type SessionPayload } from "./session-codec";
import { findActiveUserById } from "./users";

/**
 * 🔴 세션을 읽는 코드는 이 파일 하나에만 둔다 (CLAUDE.md 6-7절). 화면·API 곳곳에서 쿠키를 직접 읽지 않는다.
 *
 * 매 요청마다 DB 의 users 를 다시 읽는다. 백채널 로그아웃이 `sessions_valid_from` 을 올리면
 * 그보다 먼저 발급된 세션을 즉시 거절해야 하기 때문 (6-8절). "성능" 으로 이 읽기를 걷어내지 마라.
 * 같은 요청 안에서 레이아웃·페이지·액션이 여러 번 불러도 React `cache()` 가 한 번만 읽게 해 준다.
 */
export interface CurrentSession {
  /** `user.role` 은 **지금 쓰이는 역할**. 개발 전용 역할 바꿔 보기가 켜져 있으면 낮춰진 값일 수 있다. */
  user: User;
  /** 포털이 준 진짜 역할. 바꿔 보기 중이 아니면 user.role 과 같다. */
  actualRole: Role;
  payload: SessionPayload;
  services: DssService[];
}

export const getSession = cache(async (): Promise<CurrentSession | null> => {
  const store = await cookies();
  const payload = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  let user: User | null;
  try {
    user = await findActiveUserById(payload.uid);
  } catch (e) {
    // DB 가 죽었으면 세션도 없는 것으로 본다 — 열어 두는 쪽(fail-open)보다 낫다.
    console.error("[session] users 조회 실패:", e instanceof Error ? e.message : e);
    return null;
  }
  if (!user) return null;
  if (user.authSub !== payload.sub) return null;
  // 포털에서 로그아웃(백채널)한 뒤 발급된 세션만 유효
  if (user.sessionsValidFrom.getTime() > payload.iat) return null;

  // 🔴 개발 전용 역할 바꿔 보기: 관리자가 자기 역할을 **낮춰서만** 본다. 올리는 쪽은 절대 안 된다. 운영에서는 꺼진다.
  const actualRole = user.role;
  let effective = user;
  if (env.devRoleOverride && actualRole === "ADMIN") {
    const v = verifyValue<{ role: string }>(store.get(DEV_ROLE_COOKIE)?.value, env.authSessionSecret);
    if (v && isRole(v.role) && roleAtLeast(actualRole, v.role) && v.role !== actualRole) effective = { ...user, role: v.role };
  }
  return { user: effective, actualRole, payload, services: decodeServiceMenu(store.get(SERVICE_MENU_COOKIE)?.value) };
});

/**
 * 보호된 화면의 입구. 세션이 없으면 곧장 통합 로그인으로 보낸다 — 아이디/비밀번호 화면은 없다 (9-6절).
 * `returnTo` 는 로그인 뒤 돌아올 이 사이트 안의 경로.
 */
export async function requireSession(returnTo = "/"): Promise<CurrentSession> {
  const s = await getSession();
  if (!s) redirect(`/api/auth/sso/start?returnTo=${encodeURIComponent(returnTo)}`);
  return s;
}

/**
 * 역할 가드. 판정은 항상 서버에서 (8-4절). 레이아웃은 화면을 그릴 때만 돌므로
 * 🔴 데이터를 바꾸는 서버 액션·API 는 이 함수를 **따로 다시** 부른다.
 */
export async function requireRole(required: Role, returnTo = "/"): Promise<CurrentSession> {
  const s = await requireSession(returnTo);
  if (!roleAtLeast(s.user.role, required)) redirect("/forbidden");
  return s;
}
