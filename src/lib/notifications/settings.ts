import { ROLES, type Role } from "@/db/schema/users";
import { ROLE_LABEL } from "@/lib/auth/role";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  receivesPendingNotification,
  receivesRejectedNotification,
  REJECTED_VISIBLE_DAYS,
  type NotificationKind,
} from "./bell-items";

/**
 * ============================================================================
 * 포털이 **알림 설정**을 물어 올 때의 판단 — 라우트가 아니라 여기에 둔다
 * ============================================================================
 * ── 🔴 왜 이 통로가 있어야 하나 ─────────────────────────────────────────
 * 포털(dss-auth)에 알림 통로를 가진 시스템으로 한 줄 등록되면, 포털은 그 시스템에
 * 주소를 **둘** 물으러 온다 — 알림 목록(/api/integration/notifications)과 알림 설정
 * (/api/integration/notification-settings). 설정 통로가 없으면 404 가 나고 포털 관리자
 * 화면에서 재고 관리가 「지금은 불러올 수 없습니다」로 그려진다. **고장이 아닌데 상한
 * 것처럼 보인다.** 그래서 통로를 한 벌로 낸다.
 *
 * ── 🔴 이 시스템의 알림 설정은 **읽기 전용**이다 ────────────────────────
 * 설정을 저장할 표가 없고 이번 조각은 스키마를 건드리지 않는다. 그러면 답할 수 있는
 * 길은 둘이다:
 *
 *  ① 200 으로 받아들이고 **아무것도 바꾸지 않는다**
 *  ② 🔴 **읽기는 내주고, 저장은 403 으로 분명히 거절한다** ← 고른 길
 *
 * ①을 고르지 않은 까닭: 포털 관리자가 스위치를 눌러 「저장됨」을 보고 화면을 다시 열면
 * 값이 되돌아 있다 — **눌렀는데 아무 일도 일어나지 않는** 쪽이 훨씬 나쁘다. ②는 포털이
 * 그 자리에 우리가 적어 보낸 문장을 그대로 그리고, 403 을 **정상 응답**으로 다룬다 —
 * 못 물어본 것(unavailable)과 달리 degraded 로 세지 않는다. 게시판·개선요청이 같은
 * 자리에서 같은 길을 골랐다.
 *
 * ── 지금 내주는 내용은 **거짓이 아니다** ────────────────────────────────
 * 누가 무엇을 받는지는 손으로 적지 않는다 — 종이 실제로 쓰는 그 함수
 * (notifications/bell-items.ts 의 receives*)를 **그대로 부른다.** 그래서 규칙을 고치면
 * 이 표가 저절로 따라가고, 「종에는 뜨는데 설정 표에는 안 받는다고 적힌」 상태가 생길
 * 자리가 없다.
 *
 * ── DB 를 여기서 부르지 않는다 ──────────────────────────────────────────
 * 사람을 되짚는 일은 **인자로 받는다**(findActor). 그래서 이 파일의 판단은 DB 도
 * 네트워크도 없이 그대로 돌려 볼 수 있고, 라우트에는 「머리말에서 토큰 꺼내 검증하고
 * 이 함수 부르기」만 남는다.
 * ============================================================================
 */

/** 포털 쪽 sub 로 되짚은 이 시스템의 사람. 🔴 살아 있는 사람만 온다. */
export type PortalActor = { id: string; role: Role };

/** 포털 쪽 sub 로 이 시스템 계정을 찾는다. 없거나 지워진 사람이면 null. */
export type FindActorByAuthSub = (subject: string) => Promise<PortalActor | null>;

/** 그 시스템의 역할 한 줄. 🔴 포털은 우리 역할 어휘를 모른다 — 이름표를 함께 보낸다. */
export type PortalSettingsRole = {
  code: Role;
  label: string;
  /** 🔴 false 면 포털 화면이 그 줄을 잠근다. 이 시스템은 언제나 false(위 머리말). */
  editable: boolean;
};

export type PortalSettingsRoleCell = { receives: boolean; defaultReceives: boolean };

export type PortalSettingsKind = {
  kind: string;
  label: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
  /** 열쇠는 위 역할의 `code`. */
  roles: Record<string, PortalSettingsRoleCell>;
};

export type PortalNotificationSettings = {
  roles: PortalSettingsRole[];
  kinds: PortalSettingsKind[];
};

export type PortalSettingsResult<T> = { ok: true; value: T } | { ok: false; status: 403; message: string };

/** 종류마다 「누가 받는가」. 🔴 종이 쓰는 그 함수를 그대로 부른다(위 머리말). */
const RECEIVES: Record<NotificationKind, (role: Role) => boolean> = {
  [NOTIFICATION_KINDS.pending]: receivesPendingNotification,
  [NOTIFICATION_KINDS.rejected]: receivesRejectedNotification,
};

/** 종이 무엇을 언제 보여 주는가. 포털 화면이 종류 줄 밑에 그대로 그린다. */
const DESCRIPTIONS: Record<NotificationKind, string> = {
  [NOTIFICATION_KINDS.pending]: "확인을 기다리는 반출 신청이 있으면 건수를 종에 띄웁니다. 다 내주거나 반려하면 사라집니다. 일부만 내준 신청은 남은 수량이 있어 그대로 남습니다.",
  [NOTIFICATION_KINDS.rejected]: `자기가 낸 반출 신청이 반려되면 종에 띄웁니다. 반려된 지 ${REJECTED_VISIBLE_DAYS}일이 지나면 사라집니다. 확인된 신청은 수량이 바뀌어 화면에 바로 보이므로 알리지 않습니다.`,
};

/**
 * 한 종류의 역할 칸들. 🔴 **종류마다 새로 만든다** — 한 객체를 두 줄이 나눠 쓰면
 * 언젠가 한쪽을 고친 것이 다른 쪽까지 바꾼다(지금은 JSON 으로 나가 티가 안 난다).
 */
function roleCells(kind: NotificationKind): Record<string, PortalSettingsRoleCell> {
  const cells: Record<string, PortalSettingsRoleCell> = {};
  for (const code of ROLES) {
    const receives = RECEIVES[kind](code);
    cells[code] = { receives, defaultReceives: receives };
  }
  return cells;
}

/**
 * 이 시스템이 내주는 알림 설정 — **코드에 있는 규칙을 그대로 옮겨 적은 표**.
 *
 * 🔴 종류가 **몇 개인지도 여기서 정하지 않는다.** NOTIFICATION_KINDS 를 그대로 돌므로
 * 알림 종류가 늘면 이 표가 저절로 따라간다.
 */
export function inventoryNotificationSettings(): PortalNotificationSettings {
  const roles: PortalSettingsRole[] = ROLES.map((code) => ({
    code,
    label: `${ROLE_LABEL[code]} · ${code}`,
    // 🔴 저장할 표가 없다 — 이 시스템에서는 아무 칸도 바꿀 수 없다(위 머리말).
    editable: false,
  }));

  const kinds: PortalSettingsKind[] = Object.values(NOTIFICATION_KINDS).map((kind) => ({
    kind,
    label: NOTIFICATION_KIND_LABELS[kind],
    description: DESCRIPTIONS[kind],
    enabled: true,
    defaultEnabled: true,
    roles: roleCells(kind),
  }));

  return { roles, kinds };
}

/** 🔴 세 갈래(없는 사람·지워진 사람·관리자가 아닌 사람)가 **같은 문장**이다. */
const FORBIDDEN_MESSAGE = "이 시스템의 알림 설정은 볼 수 없습니다.";

/**
 * 저장은 받지 않는다 — 까닭은 머리말. 포털이 이 문장을 그대로 그린다.
 * 🔴 종류 이름을 손으로 적지 않는다(표와 같은 자리에서 온다).
 */
export const SETTINGS_READ_ONLY_MESSAGE = `DSS 재고 관리는 알림 설정을 바꿀 수 없습니다. 알림 종류(${Object.values(NOTIFICATION_KINDS)
  .map((kind) => NOTIFICATION_KIND_LABELS[kind])
  .join("·")})도 받는 역할도 코드에 정해져 있습니다.`;

/**
 * 설정을 **읽는** 것도 자격을 본다 — 관리자만.
 *
 * 어느 역할이 무엇을 받는지는 그 자체가 조직 구성 정보다. 자격을 보는 줄은 A/S·개선
 * 요청·게시판과 **같은 자리에** 그어 둔다 — 여러 시스템이 같은 포털 화면에 나란히
 * 그려지는데 한 곳만 느슨하면 그 한 곳이 「이 사람이 거기 계정이 있는가」를 알려 주는
 * 창구가 된다.
 *
 * 🔴 되짚지 못한 사람·지워진 사람·관리자가 아닌 사람 **셋 다 같은 답**이다 — 까닭을
 * 나누면 포털에 토큰 하나 구울 수 있는 쪽이 사람 목록과 각자의 권한을 알아낼 수 있다.
 */
export async function readPortalNotificationSettings(params: { subject: string; findActor: FindActorByAuthSub }): Promise<PortalSettingsResult<PortalNotificationSettings>> {
  const actor = await params.findActor(params.subject);
  if (!actor || actor.role !== "ADMIN") {
    return { ok: false, status: 403, message: FORBIDDEN_MESSAGE };
  }
  return { ok: true, value: inventoryNotificationSettings() };
}

/**
 * 설정 저장 — **언제나 거절한다.** 돌려주는 것은 답에 실을 문장뿐이다.
 *
 * 🔴 자격을 먼저 보고 거절한다. 관리자가 아닌 사람에게 「바꿀 수 없는 시스템이다」를
 * 알려 줄 이유가 없다 — 읽기와 **같은 문장**으로 답한다.
 *
 * 돌려주는 타입에 `ok: true` 갈래가 아예 없다 — 저장할 표가 생기기 전에는 성공이 있을
 * 수 없고, 타입이 그것을 말한다.
 */
export async function writePortalNotificationSettings(params: { subject: string; findActor: FindActorByAuthSub }): Promise<{ status: 403; message: string }> {
  const actor = await params.findActor(params.subject);
  if (!actor || actor.role !== "ADMIN") {
    return { status: 403, message: FORBIDDEN_MESSAGE };
  }
  return { status: 403, message: SETTINGS_READ_ONLY_MESSAGE };
}
