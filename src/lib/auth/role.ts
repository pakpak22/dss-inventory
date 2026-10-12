import { ROLES, type Role } from "@/db/schema/users";

/**
 * 포털이 실어 보낸 `role` 클레임을 어떻게 다룰지 판정한다. CLAUDE.md 8-2절의 표를 **그대로** 옮겼다.
 *
 * | 들어온 값            | 처리                                 |
 * |----------------------|--------------------------------------|
 * | role 클레임이 없음   | KEEP   — 기존 역할을 유지한다        |
 * | 아는 값              | APPLY  — 포털 값으로 덮어쓴다        |
 * | 모르는 값            | REJECT — 로그인을 거절한다           |
 *
 * 왜 REJECT 인가: 관리자가 *강등*하려다 오타를 내면, 유지(KEEP)는 높은 권한을 조용히 남긴다.
 * 그게 fail-open 이다. 거절하면 시끄럽게 실패하고 사람이 알아챈다.
 *
 * 🔴 "없음" 과 "빈 값" 을 가른다 — 포털은 지정이 없으면 **키 자체를 보내지 않는다** (6-5절).
 *    그래서 `undefined` 만 KEEP 이고, 빈 문자열이나 다른 타입은 전부 모르는 값(REJECT) 이다.
 */
export type RoleDecision =
  | { kind: "KEEP" }
  | { kind: "APPLY"; role: Role }
  | { kind: "REJECT"; received: unknown };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function decideRole(claim: unknown): RoleDecision {
  if (claim === undefined) return { kind: "KEEP" };
  if (isRole(claim)) return { kind: "APPLY", role: claim };
  return { kind: "REJECT", received: claim };
}

/** 화면 표시용 한국어 이름 (REQUIREMENTS 10절 역할 표) */
export const ROLE_LABEL: Record<Role, string> = {
  VIEWER: "보기",
  STAFF: "기록",
  ADMIN: "관리자",
};

/** 역할 서열. 가드에서 "이 역할 이상" 을 판정할 때 쓴다. */
const RANK: Record<Role, number> = { VIEWER: 0, STAFF: 1, ADMIN: 2 };

export function roleAtLeast(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}
