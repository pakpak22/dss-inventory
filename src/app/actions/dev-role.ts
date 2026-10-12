"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEV_ROLE_COOKIE, expiredCookieOptions, sessionCookieOptions } from "@/lib/auth/cookies";
import { isRole, roleAtLeast } from "@/lib/auth/role";
import { getSession } from "@/lib/auth/session";
import { signValue } from "@/lib/auth/signed-value";
import { env } from "@/lib/env";

/**
 * 🔴 개발 전용 「역할 바꿔 보기」. 가계정·자체 로그인 대신 쓴다 (CLAUDE.md 5절: 신원은 포털만).
 *
 * - `DEV_ROLE_OVERRIDE=true` 이고 운영이 아닐 때만 동작한다. 아니면 아무 일도 하지 않는다.
 * - **진짜 역할이 ADMIN 인 사람만**, 자기 역할을 **같거나 낮은 쪽으로만** 바꾼다. 올리는 길은 없다.
 * - 쿠키는 세션 키로 서명한다 — 누가 값을 고쳐도 session.ts 가 다시 검사하고, 어차피 낮추는 방향뿐이다.
 * - 감사 로그는 바꾼 역할로 남는다(이름은 그대로). 시험 자료라는 것이 이름으로 드러난다.
 */
export async function setDevRoleAction(formData: FormData): Promise<void> {
  if (!env.devRoleOverride) return;
  const s = await getSession();
  if (!s || s.actualRole !== "ADMIN") return;
  const role = String(formData.get("role") ?? "");
  const store = await cookies();
  if (!isRole(role) || role === s.actualRole) {
    store.set(DEV_ROLE_COOKIE, "", expiredCookieOptions("/"));
  } else if (roleAtLeast(s.actualRole, role)) {
    store.set(DEV_ROLE_COOKIE, signValue({ role }, env.authSessionSecret, env.sessionHours * 3600), sessionCookieOptions());
  }
  redirect("/");
}
