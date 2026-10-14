/**
 * ============================================================================
 * A/S 사람 명부 — 순수 규칙 (DB 도 망도 여기서 만지지 않는다)
 * ============================================================================
 * 결재자는 **A/S 의 사람**이다. 이 시스템 `users` 에는 이 시스템에 로그인한 적 있는 사람만
 * 들어오므로(지금 한 명), 명부는 A/S 통로에서 그때그때 받아 온다(2026-10-15 사용자 결정).
 * 실제로 받아 오는 일은 `as-users.ts` 가 하고, 여기에는 **받아 온 것을 어떻게 읽는가**만
 * 둔다 — 그래야 아래 판정들에 DB 도 망도 없는 시험이 붙는다.
 *
 * ── 🔴 「못 받아 왔다」와 「명부에 없다」는 다른 말이다 ───────────────────
 * 이 파일이 존재하는 이유가 그 한 줄이다. 둘을 같게 다루면 **A/S 가 꺼진 동안 멀쩡한
 * 결재선이 전부 「자격 없음」으로 그려진다** — 관리자는 결재선이 망가진 줄 알고 멀쩡한
 * 단계를 지운다. 그래서 받아 온 결과를 성공/실패로 **구별해서** 들고 다니고
 * (`AsUserDirectory`), 저장된 단계 하나를 볼 때도 상태가 셋이다(`ApproverPresence`):
 *
 *   · present — 명부를 받아 왔고 그 안에 있다. 보통으로 보인다.
 *   · missing — 명부를 받아 왔는데 그 안에 없다. **줄은 그대로 두고** 그 자리에 적는다.
 *   · unknown — 명부를 못 받아 왔다. 「없다」고 말하지 않는다.
 *
 * `missing` 일 때 줄을 조용히 빼지 않는 것은 원본(A/S 관리 시스템)의 판단을 그대로 옮긴
 * 것이다 — 「조용히 빼면 절차가 짧아진 것처럼 보이고, 왜 결재가 안 넘어가지를 아무도 답할
 * 수 없다.」 저장된 이름·역할은 우리 표에 사본이 있으므로(`approval_route_steps`) 명부가
 * 없어도 줄은 그대로 보인다.
 *
 * ── 🔴 빈 목록을 「못 받아 왔다」로 바꾸지 않는다(그 반대도) ──────────────
 * 통로가 200 으로 빈 목록을 돌려주는 것은 「올릴 수 있는 사람이 한 명도 없다」는 **사실**
 * 이고, 응답을 못 읽은 것은 **모름**이다. 아래 `parseAsUsersResponse` 가 둘을 가른다:
 * 모양이 아니면 `null`(부르는 쪽이 unreachable 로 바꾼다), 모양이면 빈 배열 그대로.
 * ============================================================================
 */

import { stepOrderFromIndex } from "./route";

/** A/S 통로(`GET /api/v1/users`)가 돌려주는 사람 한 줄. 칸은 넷뿐이다. */
export type AsUser = {
  id: string;
  name: string;
  email: string;
  /** A/S 의 역할 코드. 이 시스템의 역할과 **다른 목록**이다 — 글자로 받아 글자로 적어 둔다. */
  role: string;
};

/** 명부를 받아 왔는가. 🔴 성공과 실패를 구별해 들고 다닌다(머리말). */
export type AsUserDirectory =
  | { status: "ok"; users: AsUser[] }
  | { status: "unreachable"; reason: AsUserDirectoryUnreachableReason };

export type AsUserDirectoryUnreachableReason = "not_configured" | "timeout" | "error";

/**
 * 못 받아 온 까닭을 사람 말로. 🔴 셋 다 **「A/S 명부에 없습니다」라고 말하지 않는다** —
 * 모르는 것을 없는 것처럼 적으면 관리자가 멀쩡한 단계를 지운다.
 *
 * 말투는 `src/lib/stock/intake-lookup.ts` 의 `LOOKUP_MESSAGES` 와 맞춘다(같은 A/S 통로가
 * 응답하지 않을 때의 말이라, 두 화면이 다른 말을 하면 같은 사고가 다른 일로 보인다).
 */
export const AS_DIRECTORY_MESSAGES: Record<AsUserDirectoryUnreachableReason, string> = {
  not_configured: "A/S 사람 명부 통로가 아직 연결되지 않았습니다.",
  timeout: "A/S 가 응답하지 않습니다.",
  error: "A/S 사람 명부를 불러오지 못했습니다.",
};

/**
 * A/S 의 역할 코드 → 사람이 읽는 이름. **모르는 코드는 코드 그대로 보여 준다** — 이름표가
 * 사라지는 것보다 낫다(원본 편집 화면의 `roleLabel` 과 같은 판단).
 *
 * 🔴 이 목록은 **A/S 의 것**이지 이 시스템의 역할(ADMIN·STAFF·VIEWER)이 아니다. 둘을 섞어
 * 적으면 「관리자」가 어느 시스템의 관리자인지 알 수 없게 된다.
 */
export const AS_ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "최고관리자",
  ADMIN: "관리자",
  AS_ENGINEER: "A/S 엔지니어",
  SALES: "영업 담당자",
  INVENTORY_MANAGER: "재고 담당자",
};

export function asRoleLabel(role: string): string {
  return AS_ROLE_LABELS[role] ?? role;
}

/** 고르개·칩에 쓰는 한 줄. 이름 뒤에 역할을 괄호로 — 동명이인을 가르는 유일한 단서다. */
export function asUserLabel(user: { name: string; role: string }): string {
  return `${user.name} (${asRoleLabel(user.role)})`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 통로 응답(JSON) → 사람 목록. **모양이 아니면 `null`** 이다.
 *
 * 🔴 `null` 과 빈 배열을 부르는 쪽이 구별해야 한다(머리말) — `null` 은 「못 읽었다」,
 * `[]` 는 「한 명도 없다」다. 키 이름이 바뀌면 이 함수 하나만 고친다
 * (`src/lib/stock/intake-lookup.ts` 의 `parseLookupResponse` 와 같은 자리다).
 *
 * id 나 이름이 빈 줄은 **버린다** — 고르개에 올려 봐야 고를 수 없고, 저장하면 우리 표의
 * `approver_name NOT NULL` 에서 「알 수 없는 오류」로 터진다.
 */
export function parseAsUsersResponse(json: unknown): AsUser[] | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = (json as { users?: unknown }).users;
  if (!Array.isArray(raw)) return null;

  const users: AsUser[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = str(o.id);
    const name = str(o.name);
    if (id === "" || name === "") continue;
    users.push({ id, name, email: str(o.email), role: str(o.role) });
  }
  return users;
}

/**
 * 저장된 단계 하나가 **지금** 어떤 상태인가. 🔴 셋을 가르는 유일한 자리다(머리말).
 *
 * 아직 사람을 고르지 않은 빈 자리는 `present` 로 본다 — 그 자리에 할 말은 저장할 때
 * `validateApprovalRouteSteps` 가 한다(「N번째 단계의 승인자를 선택해 주세요」). 여기서
 * 「명부에 없습니다」라고 적으면 관리자는 방금 누른 [+ 단계 추가] 가 고장 난 줄 안다.
 */
export type ApproverPresence = "present" | "missing" | "unknown";

export function approverPresence(
  directory: AsUserDirectory,
  approverUserId: string,
): ApproverPresence {
  if (approverUserId.trim() === "") return "present";
  // 🔴 「모른다」가 먼저다. 명부가 없는데 `users` 를 뒤지면 전부 missing 이 된다.
  if (directory.status !== "ok") return "unknown";
  return directory.users.some((user) => user.id === approverUserId) ? "present" : "missing";
}

/**
 * 그 줄에 적을 말. 보통이면 `null`.
 *
 * 🔴 두 문장이 **다른 말을 해야 한다.** 위가 「이 단계에서 결재가 멈춘다」는 사실이고,
 * 아래는 「우리가 확인하지 못했다」는 우리 쪽 사정이다 — 아래를 위처럼 적으면 멀쩡한
 * 결재선이 깨진 것으로 보인다.
 */
export const APPROVER_PRESENCE_NOTICES: Record<Exclude<ApproverPresence, "present">, string> = {
  missing: "지금 A/S 명부에 없습니다. 이 단계에서 결재가 멈춥니다.",
  unknown: "A/S 에 연결할 수 없어 확인하지 못했습니다.",
};

export function approverNoticeFor(
  directory: AsUserDirectory,
  approverUserId: string,
): string | null {
  const presence = approverPresence(directory, approverUserId);
  return presence === "present" ? null : APPROVER_PRESENCE_NOTICES[presence];
}

/**
 * ============================================================================
 * 저장 시점의 자격 확인 — 넘어온 승인자가 **전부** 지금 명부에 있는가
 * ============================================================================
 * 화면이 받아 간 명부는 낡을 수 있다(고르는 사이에 A/S 에서 계정이 잠길 수 있다). 그래서
 * 저장 경로가 명부를 **다시 받아 와** 이 함수로 본다.
 *
 * 🔴 **못 받아 왔으면 저장을 거절한다.** 확인할 수 없는 채로 결재선을 세우면 없는 사람이
 * 결재자가 되어 그 단계에서 영영 멈춘다 — 화면에서 「모른다」로 적는 것과 정반대의 판단인데,
 * 보는 것은 이미 저장된 사실이고 여기서 하는 것은 **새 사실을 만드는 일**이기 때문이다.
 *
 * 🔴 **단, 단계가 0개면 명부를 보지 않는다.** 확인할 사람이 없고, 0개짜리 판을 얹는 것이
 * 한 번 켠 절차를 끄는 **유일한 출구**다(`src/db/schema/approval-routes.ts` 머리말). 여기서
 * A/S 를 요구하면 A/S 가 꺼져 있는 동안 절차를 끌 방법이 사라진다 — 원본
 * (`saveShipmentApprovalRouteInTx`)도 목록이 비면 자격 조회를 아예 하지 않는다.
 * ============================================================================
 */
export type ResolveApproversResult =
  | { ok: true; approvers: AsUser[] }
  | { ok: false; code: "DIRECTORY_UNREACHABLE" | "UNKNOWN_APPROVER"; message: string };

/** 못 받아 왔을 때의 거절 문구. 🔴 「없습니다」가 아니라 「확인하지 못했습니다」다. */
export const DIRECTORY_UNREACHABLE_SAVE_MESSAGE =
  "A/S 에 연결할 수 없어 저장하지 못했습니다. 잠시 뒤 다시 시도하십시오.";

/**
 * @param nameHints 지금 저장돼 있는 단계의 이름 사본(id → 이름). 명부에서 사라진 사람을
 *   **누구인지 말해 주기** 위해서만 쓴다 — 「저장할 수 없습니다」만 돌려주면 관리자는 열 명
 *   중 누구를 빼야 하는지 알 수 없어 같은 값을 몇 번 더 눌러 보다가 포기한다. 모르면 단계
 *   번호만 말한다.
 */
export function resolveApproversFromDirectory(
  directory: AsUserDirectory,
  approverUserIds: readonly string[],
  nameHints?: ReadonlyMap<string, string>,
): ResolveApproversResult {
  // 🔴 0개는 명부와 무관하게 통과한다(머리말).
  if (approverUserIds.length === 0) return { ok: true, approvers: [] };

  if (directory.status !== "ok") {
    return { ok: false, code: "DIRECTORY_UNREACHABLE", message: DIRECTORY_UNREACHABLE_SAVE_MESSAGE };
  }

  const byId = new Map(directory.users.map((user) => [user.id, user]));
  const approvers: AsUser[] = [];
  for (let index = 0; index < approverUserIds.length; index += 1) {
    const approverUserId = approverUserIds[index];
    const user = byId.get(approverUserId);
    if (!user) {
      // 번호 규칙이 적힌 곳은 route.ts 하나다 — 여기서 `index + 1` 을 직접 적지 않는다.
      const stepOrder = stepOrderFromIndex(index);
      const name = nameHints?.get(approverUserId);
      return {
        ok: false,
        code: "UNKNOWN_APPROVER",
        message: name
          ? `${stepOrder}번째 단계의 ${name} 님은 지금 A/S 명부에 없습니다. 그 단계를 빼거나 다른 사람을 고른 뒤 저장해 주십시오.`
          : `${stepOrder}번째 단계의 승인자를 A/S 명부에서 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 지정해 주십시오.`,
      };
    }
    approvers.push(user);
  }
  return { ok: true, approvers };
}
