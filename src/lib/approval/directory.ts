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
 *
 * ── 🔴 결재자를 잇는 열쇠는 **포털 번호**다 — A/S 번호가 아니다 ───────────
 * 2026-10-15 사용자 결정. 같은 사람 하나가 시스템마다 다른 번호를 갖는다(실측):
 *
 *   · 재고 관리 `users.id`            — 이 시스템에 로그인한 사람에게만 있다
 *   · A/S `users.id`                  — 명부가 주는 `id`. 결재선에 적어 두는 번호다
 *   · 포털 `sub`(= 재고 `users.auth_sub` · A/S `users.sso_subject`) — **둘을 잇는 유일한 값**
 *
 * 그래서 「내가 결재할 건」을 A/S 번호로 찾으면 **영원히 빈 목록**이다 — 로그인한 사람의
 * 번호는 그것이 아니기 때문이다. 시험으로는 잡히지 않는다(코드는 맞고 값이 안 맞는다).
 * 이 파일이 `ssoSubject` 를 받아 오는 까닭이 그것이고, 결재자 판정의 열쇠가 적힌 곳은
 * 이제 전부 **`…Sub`** 라는 이름을 쓴다(`userId` 로 두면 다음 사람이 `users.id` 를 넘긴다 —
 * 이번 결함이 바로 그렇게 생겼다).
 *
 * ── 🔴 포털 번호가 `null` 인 사람은 **고를 수 없다** ─────────────────────
 * 포털로 한 번도 들어온 적이 없는 사람이다. 그 사람을 결재선에 세우면 이 시스템은 그가
 * 로그인해도 **알아볼 길이 없어** 그 단계에서 결재가 영영 멈춘다. 그래서 세 곳에서 막는다:
 * 명부(고르개에서 **가린다**) · 저장(`resolveApproversFromDirectory` 가 거절) · 결재건
 * (`planPartIssueApproval` 이 거절).
 *
 * 🔵 **명부에서 빼지는 않는다.** 조용히 사라지면 「왜 저 사람이 목록에 없지」가 되고, 관리자는
 * A/S 가 고장 난 줄 안다. 줄은 보이되 고를 수 없고, 그 자리에 까닭이 적힌다 — 위 `missing` 을
 * 조용히 빼지 않는 것과 **같은 판단**이다.
 *
 * ── 🔴 포털 번호 자체는 화면으로 내려보내지 않는다 ──────────────────────
 * `sub` 는 신원 증명에 쓰이는 값이다(A/S 쪽도 `/api/v1` 응답에서 그 칸이 새어 나가지 않는지
 * 시험으로 지킨다). 그래서 화면에는 `AsUserChoice` 로 **「고를 수 있는가」 한 칸만** 내려보내고,
 * 번호 자체는 서버에 둔다. 타입을 둘로 가른 까닭이 그것이다 — 한 벌로 두면 다음 사람이
 * 명부를 그대로 `props` 에 실어 모든 직원의 포털 번호가 브라우저로 나간다.
 * ============================================================================
 */

import { stepOrderFromIndex } from "./route";

/** A/S 통로(`GET /api/v1/users`)가 돌려주는 사람 한 줄. */
export type AsUser = {
  /** A/S 의 사용자 id. 결재선 단계의 `approver_user_id` 에 그대로 적힌다 — **결재자 판정의 열쇠가 아니다.** */
  id: string;
  name: string;
  email: string;
  /** A/S 의 역할 코드. 이 시스템의 역할과 **다른 목록**이다 — 글자로 받아 글자로 적어 둔다. */
  role: string;
  /**
   * 🔴 **포털(통합 로그인) 번호.** 이 시스템의 `users.auth_sub` 와 같은 값이고, 두 시스템의
   * 사람을 잇는 **유일한** 열쇠다(머리말).
   *
   * 🔴 포털로 한 번도 들어온 적 없는 사람은 `null` 로 온다(A/S 쪽이 그렇게 보낸다). 그 사람은
   * **결재자로 고를 수 없다** — 로그인해도 이 시스템이 알아볼 길이 없어 그 단계에서 결재가
   * 영영 멈추기 때문이다. 칸이 아예 없는 응답(= A/S 가 아직 이 칸을 안 보내는 판)도 같은
   * `null` 이다. 그래야 이 시스템이 먼저 올라가도 **조용히 틀리지 않고** 막힌다.
   */
  ssoSubject: string | null;
};

/**
 * 화면으로 내려보내는 사람 한 줄. 🔴 **포털 번호 자체는 싣지 않는다**(머리말) — 대신 그
 * 번호가 있느냐만 `selectable` 한 칸으로 옮긴다.
 */
export type AsUserChoice = {
  id: string;
  name: string;
  email: string;
  role: string;
  /** 결재자로 **고를 수 있는가**. 포털 번호가 없으면 거짓이고, 그때 까닭을 그 자리에 적는다. */
  selectable: boolean;
};

/** 명부를 받아 왔는가. 🔴 성공과 실패를 구별해 들고 다닌다(머리말). */
export type AsUserDirectory =
  | { status: "ok"; users: AsUser[] }
  | { status: "unreachable"; reason: AsUserDirectoryUnreachableReason };

/** 화면이 받는 명부. 모양은 위와 같고 **사람 줄만 가려져 있다**. */
export type AsUserChoiceDirectory =
  | { status: "ok"; users: AsUserChoice[] }
  | { status: "unreachable"; reason: AsUserDirectoryUnreachableReason };

/** 한 줄을 화면 모양으로. 포털 번호는 여기서 **떨어져 나간다**. */
export function asUserChoice(user: AsUser): AsUserChoice {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    selectable: user.ssoSubject !== null,
  };
}

/**
 * 명부를 화면 모양으로. 🔴 **서버 컴포넌트가 화면에 내려보내기 전에 반드시 거치는 자리다** —
 * `AsUserDirectory` 를 그대로 `props` 에 실으면 전 직원의 포털 번호가 브라우저로 나간다.
 * 못 받아 온 것은 못 받아 온 그대로 간다(「한 명도 없다」로 바꾸지 않는다).
 */
export function toAsUserChoiceDirectory(directory: AsUserDirectory): AsUserChoiceDirectory {
  if (directory.status !== "ok") return directory;
  return { status: "ok", users: directory.users.map(asUserChoice) };
}

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

/**
 * 고를 수 없는 사람의 줄에 붙이는 꼬리말. 🔴 **목록에서 빼는 대신 붙인다**(머리말) — 그래야
 * 「왜 저 사람이 목록에 없지」가 아니라 「아, 저 사람은 아직 안 되는구나」가 된다.
 */
export const UNSELECTABLE_APPROVER_SUFFIX = " — 통합 로그인 기록 없음(고를 수 없음)";

/** 고르개 한 줄의 글자. 고를 수 없는 사람이면 까닭이 뒤에 붙는다. */
export function asUserChoiceLabel(choice: { name: string; role: string; selectable: boolean }): string {
  return choice.selectable
    ? asUserLabel(choice)
    : `${asUserLabel(choice)}${UNSELECTABLE_APPROVER_SUFFIX}`;
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
 *
 * 🔴 **포털 번호가 없는 줄은 버리지 않는다.** 그 사람은 「고를 수 없는 사람」이지 「없는
 * 사람」이 아니다 — 빼 버리면 관리자가 명부에서 그를 찾다가 A/S 가 고장 난 줄 안다(머리말).
 * 빈 글자·칸 없음·`null` 은 전부 `null` 하나로 모은다: 빈 글자를 그대로 두면 그것이 열쇠로
 * 쓰여 **번호 없는 사람끼리 같은 사람이 된다.**
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
    const ssoSubject = str(o.ssoSubject);
    users.push({ id, name, email: str(o.email), role: str(o.role), ssoSubject: ssoSubject === "" ? null : ssoSubject });
  }
  return users;
}

/**
 * 저장된 단계 하나가 **지금** 어떤 상태인가. 🔴 넷을 가르는 유일한 자리다(머리말).
 *
 * 아직 사람을 고르지 않은 빈 자리는 `present` 로 본다 — 그 자리에 할 말은 저장할 때
 * `validateApprovalRouteSteps` 가 한다(「N번째 단계의 승인자를 선택해 주세요」). 여기서
 * 「명부에 없습니다」라고 적으면 관리자는 방금 누른 [+ 단계 추가] 가 고장 난 줄 안다.
 *
 * 🔴 **`no_sso` 를 `missing` 과 가른다.** 둘 다 「이 단계에서 결재가 멈춘다」지만 고치는 길이
 * 다르다 — `missing` 은 **다른 사람을 고르는** 일이고, `no_sso` 는 **그 사람이 통합 로그인으로
 * 한 번 들어오면** 풀린다. 뭉쳐서 「명부에 없습니다」라고 적으면 멀쩡히 명부에 있는 사람을
 * 두고 관리자가 A/S 에 사람을 다시 만들어 달라고 한다.
 */
export type ApproverPresence = "present" | "missing" | "unknown" | "no_sso";

export function approverPresence(
  directory: AsUserChoiceDirectory,
  approverUserId: string,
): ApproverPresence {
  if (approverUserId.trim() === "") return "present";
  // 🔴 「모른다」가 먼저다. 명부가 없는데 `users` 를 뒤지면 전부 missing 이 된다.
  if (directory.status !== "ok") return "unknown";
  const user = directory.users.find((candidate) => candidate.id === approverUserId);
  if (!user) return "missing";
  return user.selectable ? "present" : "no_sso";
}

/**
 * 그 줄에 적을 말. 보통이면 `null`.
 *
 * 🔴 셋이 **다른 말을 해야 한다.** 첫째는 「이 단계에서 결재가 멈춘다」는 사실이고, 둘째는
 * 「우리가 확인하지 못했다」는 우리 쪽 사정이며, 셋째는 「그 사람이 한 번 들어오면 풀린다」는
 * **고치는 길**이다 — 뭉개면 멀쩡한 결재선이 깨진 것으로 보이거나, 고칠 수 있는 것을 두고
 * 엉뚱한 곳을 고치게 된다.
 */
export const APPROVER_PRESENCE_NOTICES: Record<Exclude<ApproverPresence, "present">, string> = {
  missing: "지금 A/S 명부에 없습니다. 이 단계에서 결재가 멈춥니다.",
  unknown: "A/S 에 연결할 수 없어 확인하지 못했습니다.",
  no_sso: "아직 통합 로그인으로 들어온 적이 없어 결재자로 지정할 수 없습니다. 그 분이 한 번 로그인한 뒤에 다시 고를 수 있습니다.",
};

export function approverNoticeFor(
  directory: AsUserChoiceDirectory,
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
 *
 * ── 🔴 포털 번호가 없는 사람은 여기서 **거절한다** ──────────────────────
 * 화면이 고르지 못하게 가려 두지만(`selectable`), **화면 검사만 믿지 않는다** — 이 함수는
 * 화면을 거치지 않고도 불린다. 번호 없는 사람이 결재선에 들어가면 그 단계는 **아무도 열 수
 * 없는 문**이 되고, 그 사실은 한참 뒤 누군가 결재건을 올릴 때에야 드러난다.
 * ============================================================================
 */
/**
 * 🔴 **포털 번호가 있는 것이 타입으로 보장된 사람.** 통과한 뒤에는 `null` 검사가 다시 나오지
 * 않아야 한다 — 검사가 여러 곳에 흩어지면 그중 하나가 빠지는 날 번호 없는 사람이 저장된다.
 */
export type SelectableAsUser = AsUser & { ssoSubject: string };

export type ResolveApproversResult =
  | { ok: true; approvers: SelectableAsUser[] }
  | { ok: false; code: "DIRECTORY_UNREACHABLE" | "UNKNOWN_APPROVER" | "NO_SSO_SUBJECT"; message: string };

/** 못 받아 왔을 때의 거절 문구. 🔴 「없습니다」가 아니라 「확인하지 못했습니다」다. */
export const DIRECTORY_UNREACHABLE_SAVE_MESSAGE =
  "A/S 에 연결할 수 없어 저장하지 못했습니다. 잠시 뒤 다시 시도하십시오.";

/**
 * 포털 번호가 없는 사람을 거절하는 문구. 🔴 **누구인지와 고치는 길**을 함께 적는다 — 이름이
 * 없으면 열 명 중 누구를 빼야 할지 알 수 없고, 고치는 길이 없으면 관리자는 A/S 에 사람을 다시
 * 만들어 달라고 한다(그 사람은 멀쩡히 명부에 있다).
 */
export function noSsoSubjectSaveMessage(stepOrder: number, name: string): string {
  return `${stepOrder}번째 단계의 ${name} 님은 아직 통합 로그인으로 들어온 적이 없어 결재자로 지정할 수 없습니다. 그 분이 통합 로그인으로 한 번 들어온 뒤에 다시 지정해 주십시오.`;
}

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
  const approvers: SelectableAsUser[] = [];
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
    // 🔴 명부에는 있지만 **포털 번호가 없다** — 우리가 알아볼 수 없는 사람이다(머리말).
    //    이름은 명부의 것을 쓴다(지금 이 순간의 참말이다).
    if (user.ssoSubject === null) {
      return {
        ok: false,
        code: "NO_SSO_SUBJECT",
        message: noSsoSubjectSaveMessage(stepOrderFromIndex(index), user.name),
      };
    }
    approvers.push({ ...user, ssoSubject: user.ssoSubject });
  }
  return { ok: true, approvers };
}
