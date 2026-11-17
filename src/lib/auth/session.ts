import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role, User } from "@/db/schema/users";
// 🔴 **역할 위임**(2026-11-17, 설계 B-10). 판정은 순수 모듈이, 표를 읽는 일은 위임 쪽 읽기 층이
//    한다 — 이 파일은 **역할을 읽는 자리**라서 그 둘을 여기서 잇는다. 세션 쿠키의 역할은 표시용
//    사본이고 진짜 판정은 아래 DB 값이다(설계 D-7 ④).
import { activeDelegatorRolesFor } from "@/lib/approval/delegation-queries";
import { DELEGATED_ADMIN_SOURCE_ROLE, decideDelegatedRole } from "@/lib/approval/delegated-role";
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
  /**
   * `user.role` 은 **지금 쓰이는 역할**. 개발 전용 역할 바꿔 보기가 켜져 있으면 낮춰진 값일 수
   * 있고, **결재권 위임으로 올라간 값**일 수도 있다(아래 `delegatedAdmin`).
   */
  user: User;
  /** 포털이 준 진짜 역할. 바꿔 보기 중이 아니면 user.role 과 같다. */
  actualRole: Role;
  /**
   * 🔴 **이 요청의 `ADMIN` 이 결재권 위임에서 왔는가** (2026-11-17, 설계 B-10·B-11).
   *
   * 「권한이 있나」가 아니라 **「승인 절차(결재선)를 고칠 수 있나」를 가르는 값**이다 — 임시
   * 관리자에게 주지 않는 문이 그 하나뿐이라서다(까닭은 `@/lib/approval/delegated-role` 머리말).
   * 🔴 **진짜 `ADMIN` 은 위임을 받았든 안 받았든 언제나 `false`** 다. 역할이 둘이면 높은 쪽이
   * 이긴다 — 여기가 `true` 가 되면 그 사람은 위임을 받았다는 이유만으로 결재선을 잃는다.
   */
  delegatedAdmin: boolean;
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

  /**
   * 🔴 **결재권 위임이 역할까지 넘긴다** (2026-11-17, 설계 B-10). `ADMIN` 이 맡긴 위임의
   *    대리인은 **그 기간 동안** `ADMIN` 이다. 뜻과 까닭은 `@/lib/approval/delegated-role` 머리말.
   *
   * 🔴 **DB 의 역할 칸을 바꿔 쓰지 않는다.** 이 함수가 매 요청마다 돌기 때문에(위 머리말) 여기서
   *    계산하면 기간이 끝날 때 **저절로** 닫힌다 — 야간 작업도 만료 처리도 필요 없고, 「여는
   *    조건과 닫는 조건이 다른 곳에」 생기지도 않는다.
   * 🔴 **진짜 `ADMIN` 에게는 아예 묻지 않는다.** 더 얻을 것이 없고(판정도 `false` 로 끝난다),
   *    위임 질의 둘을 매 요청마다 돌릴 까닭도 없다. 🔵 개발 전용 「역할 바꿔 보기」로 낮춰 본
   *    관리자도 여기에 걸린다 — `actualRole` 이 `ADMIN` 이라 안 묻고, 그래서 **낮춰 본 역할이
   *    위임으로 도로 올라가지 않는다.** 그 도구가 쓸모를 잃는 자리가 거기였다.
   */
  let delegatorRoles: Role[] = [];
  if (!roleAtLeast(actualRole, DELEGATED_ADMIN_SOURCE_ROLE)) {
    try {
      delegatorRoles = await activeDelegatorRolesFor(payload.sub);
    } catch (e) {
      /**
       * 🔴 **못 읽었으면 안 올린다**(fail-close). 위 users 조회가 「DB 가 죽었으면 세션도 없는
       *    것으로」 보는 것과 같은 쪽이다 — 여기서 던지면 위임과 아무 상관 없는 사람까지 모든
       *    화면이 500 이 된다. 🔴 대신 **반드시 로그에 남긴다**: 증상이 「위임받았는데 관리자
       *    기능이 안 열린다」 하나뿐이라, 이 줄이 없으면 아무 단서도 남지 않는다.
       */
      console.error("[session] 역할 위임 조회 실패:", e instanceof Error ? e.message : e);
    }
  }
  const delegated = decideDelegatedRole(actualRole, delegatorRoles);
  if (delegated.delegatedAdmin) effective = { ...effective, role: delegated.role };

  return {
    user: effective,
    actualRole,
    delegatedAdmin: delegated.delegatedAdmin,
    payload,
    services: decodeServiceMenu(store.get(SERVICE_MENU_COOKIE)?.value),
  };
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
