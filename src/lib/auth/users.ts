import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, type User } from "@/db/schema/users";
import type { LoginErrorCode } from "./errors";
import type { IdTokenClaims } from "./oidc";
import { decideRole } from "./role";

/**
 * 로그인한 사람을 users 에 적는다. 열쇠는 포털의 `sub` 하나다 (CLAUDE.md 6-6절).
 *
 * - 🔴 이메일이 같다고 기존 계정을 주워가지 않는다. sub 가 다르면 다른 사람이다.
 * - 이름·메일은 표시용이라 로그인할 때마다 최신값으로 덮는다.
 * - 역할은 decideRole 판정대로: 없음 → 유지 / 아는 값 → 덮어씀 / 모르는 값 → 거절.
 * - 처음 들어온 사람인데 역할 클레임이 없으면 거절한다 — 역할 없이 들어오게 하면 어떤 권한인지 정할 수 없고,
 *   기본 역할을 주는 것은 "지정된 사람만" 이라는 결정과 어긋난다.
 */
export type LoginResult = { ok: true; user: User } | { ok: false; code: LoginErrorCode; detail: string };

export async function upsertUserFromLogin(claims: IdTokenClaims, now = new Date()): Promise<LoginResult> {
  const decision = decideRole(claims.role);
  if (decision.kind === "REJECT") {
    return { ok: false, code: "unknown_role", detail: `모르는 역할: ${JSON.stringify(decision.received)}` };
  }

  const conn = db();
  const existing = await conn.query.users.findFirst({ where: eq(users.authSub, claims.sub) });

  if (!existing) {
    if (decision.kind !== "APPLY") {
      return { ok: false, code: "no_role", detail: `처음 로그인인데 role 클레임 없음 (sub=${claims.sub})` };
    }
    const [created] = await conn
      .insert(users)
      .values({
        authSub: claims.sub,
        name: claims.name,
        email: claims.email ?? null,
        role: decision.role,
        lastSid: claims.sid ?? null,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { ok: true, user: created };
  }

  if (existing.isDeleted) {
    return { ok: false, code: "account_disabled", detail: `삭제된 사용자 (id=${existing.id})` };
  }

  const [updated] = await conn
    .update(users)
    .set({
      name: claims.name,
      email: claims.email ?? null,
      role: decision.kind === "APPLY" ? decision.role : existing.role,
      lastSid: claims.sid ?? existing.lastSid,
      lastLoginAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, existing.id))
    .returning();
  return { ok: true, user: updated };
}

/**
 * 포털 쪽 `sub` 로 이 시스템의 사람을 되짚는다. 없거나 지워졌으면 null.
 *
 * 포털이 사람 대신 물으러 오는 통합 알림 통로(api/integration/*)가 쓴다 — 거기서는
 * 쿠키도 세션도 없고, **누구의 알림인지는 토큰의 sub 안에서만** 온다.
 *
 * 🔴 세션을 읽는 자리(findActiveUserById)와 **같은 줄**이다 — 지워진 사람은 못 찾은
 * 것으로 친다. 한쪽만 느슨해지면 이 화면에서 막힌 사람이 포털에서는 통과한다.
 * 🔵 `auth_sub` 는 **text 칸**이라(schema/users.ts) 모양이 달라도 던지지 않는다.
 *    uuid 칸인 시스템(게시판)이 모양을 먼저 보는 것과 다른 점이다.
 */
export async function findActiveUserByAuthSub(authSub: string): Promise<User | null> {
  if (!authSub) return null;
  const u = await db().query.users.findFirst({ where: eq(users.authSub, authSub) });
  if (!u || u.isDeleted) return null;
  return u;
}

/** 세션 검사용: 살아 있는 사용자 한 명. 없거나 삭제됐으면 null. */
export async function findActiveUserById(id: string): Promise<User | null> {
  const u = await db().query.users.findFirst({ where: eq(users.id, id) });
  if (!u || u.isDeleted) return null;
  return u;
}

/**
 * 백채널 로그아웃: 이 사람의 세션 유효 시작선을 지금으로 올린다. 그 전에 발급된 세션은 전부 무효.
 * logout_token 에 sub 가 있으면 sub 로, 없으면 sid 로 찾는다 (둘 다 없는 토큰은 verifyLogoutToken 이 이미 거절).
 */
export async function invalidateSessions(key: { sub?: string; sid?: string }, now = new Date()): Promise<number> {
  const where = key.sub ? eq(users.authSub, key.sub) : key.sid ? eq(users.lastSid, key.sid) : null;
  if (!where) return 0;
  const rows = await db()
    .update(users)
    .set({ sessionsValidFrom: now, updatedAt: now })
    .where(where)
    .returning({ id: users.id });
  return rows.length;
}
