import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES } from "../src/db/schema/users";
import { NOTIFICATION_KINDS } from "../src/lib/notifications/bell-items";
import { inventoryNotificationSettings, readPortalNotificationSettings, SETTINGS_READ_ONLY_MESSAGE, writePortalNotificationSettings, type PortalActor } from "../src/lib/notifications/settings";

/**
 * 포털이 알림 **설정**을 물어 올 때의 판단. 🔴 이 통로가 없으면 포털 관리자 화면에서
 * 재고 관리가 「지금은 불러올 수 없습니다」로 그려진다 — 고장이 아닌데 상한 것처럼.
 */

const ADMIN: PortalActor = { id: "u-admin", role: "ADMIN" };
const found = (actor: PortalActor | null) => async () => actor;

describe("내주는 표", () => {
  it("종류는 종이 실제로 쓰는 그 다섯이다 — 손으로 적지 않는다", () => {
    const { kinds } = inventoryNotificationSettings();
    assert.deepEqual(
      kinds.map((k) => k.kind).sort(),
      Object.values(NOTIFICATION_KINDS).sort(),
    );
  });

  it("역할은 이 시스템의 셋이고, 전부 잠겨 있다(저장할 표가 없다)", () => {
    const { roles } = inventoryNotificationSettings();
    // 🔴 2026-10-22: 포털 표의 차례는 ROLES(스키마 정의·역할 바꿔 보기 고르개) 그대로가
    //    아니다 — 권한이 강한 쪽이 앞에 오도록 여기서만 다시 줄 세운다.
    assert.deepEqual(
      roles.map((r) => r.code),
      ["ADMIN", "STAFF", "VIEWER"],
    );
    assert.deepEqual(roles.map((r) => r.code).sort(), [...ROLES].sort(), "집합은 그대로다 — 추가·삭제가 없다");
    for (const role of roles) {
      assert.equal(role.editable, false, role.code);
      assert.ok(role.label.includes(role.code), role.label);
    }
  });

  it("🔴 2026-10-22: 관리자가 역할 열의 맨 앞이다 — 글자(label)가 아니라 코드로 잰다", () => {
    const { roles } = inventoryNotificationSettings();
    assert.equal(roles[0]?.code, "ADMIN", "관리자가 첫 칸이 아니다");
  });

  it("🔴 「누가 받는가」는 종의 규칙 그대로다 — 대기는 ADMIN 만, 반려는 기록 권한 이상", () => {
    const { kinds } = inventoryNotificationSettings();
    const pending = kinds.find((k) => k.kind === NOTIFICATION_KINDS.pending);
    const rejected = kinds.find((k) => k.kind === NOTIFICATION_KINDS.rejected);
    assert.ok(pending && rejected);
    assert.deepEqual(
      Object.entries(pending.roles).map(([code, cell]) => [code, cell.receives]),
      [
        ["VIEWER", false],
        ["STAFF", false],
        ["ADMIN", true],
      ],
    );
    assert.deepEqual(
      Object.entries(rejected.roles).map(([code, cell]) => [code, cell.receives]),
      [
        ["VIEWER", false],
        ["STAFF", true],
        ["ADMIN", true],
      ],
    );
  });

  /**
   * 🔴 2026-10-15(조각 11d). 불출 결재 둘이 포털 표에 실린다 — 실리지 않으면 포털 관리 화면에서
   * 켜고 끌 수조차 없다. 🔵 **세 역할 칸이 모두 ✓ 인 것이 참말이다**: `/approvals` 의 문이
   * `requireSession` 이라 역할이 자격을 가르지 않고, 실제로 줄을 받는 사람은 질의의 열쇠
   * (`approver_sub` · `requested_by`)가 가른다.
   */
  it("🔴 불출 결재 둘도 표에 실리고, 세 역할이 모두 받는다 — 역할로 가르지 않는다", () => {
    const { kinds } = inventoryNotificationSettings();
    for (const kind of [NOTIFICATION_KINDS.issueApprovalToDecide, NOTIFICATION_KINDS.issueApprovalDecided]) {
      const row = kinds.find((k) => k.kind === kind);
      assert.ok(row, kind);
      assert.deepEqual(
        Object.entries(row.roles).map(([code, cell]) => [code, cell.receives]),
        [
          ["VIEWER", true],
          ["STAFF", true],
          ["ADMIN", true],
        ],
        kind,
      );
      assert.notEqual(row.label, "", kind);
      assert.notEqual(row.description, "", kind);
    }
  });

  /**
   * 🔴 2026-10-16. 재고 부족이 표에 실린다 — 실리지 않으면 포털 관리 화면에서 이 알림이 있는 줄도
   * 모른다. 🔵 **재고를 채우는 사람(ADMIN)만 ✓ 인 것이 참말이다** — 확인 대기와 같은 사람들이다.
   */
  it("🔴 재고 부족도 표에 실리고, 관리자만 받는다", () => {
    const row = inventoryNotificationSettings().kinds.find((k) => k.kind === NOTIFICATION_KINDS.lowStock);
    assert.ok(row);
    assert.deepEqual(
      Object.entries(row.roles).map(([code, cell]) => [code, cell.receives]),
      [
        ["VIEWER", false],
        ["STAFF", false],
        ["ADMIN", true],
      ],
    );
    assert.notEqual(row.label, "");
    // 🔴 「같을 때도 알린다」와 「끄는 길은 비우기뿐」이 설명에 적혀 있어야 한다 — 포털 화면이 이 글자를
    //    그대로 그린다. 2026-10-16 에 부등호가 「미만」에서 「이하」로 바뀌면서 뜻이 뒤집힌 자리다.
    assert.ok(row.description.includes("같거나 적어지면"), row.description);
    assert.ok(row.description.includes("비워 둔 부품은 알리지 않습니다"), row.description);
    // 🔴 `0` 이 끄는 값으로 읽히면 안 된다.
    assert.ok(row.description.includes("0 은 「하나도 안 남으면 알려라」"), row.description);
  });

  it("🔴 승인 줄에 기간 제한이 없다는 것이 설명에 적혀 있다 — 반려만 7일이다", () => {
    const decided = inventoryNotificationSettings().kinds.find((k) => k.kind === NOTIFICATION_KINDS.issueApprovalDecided);
    assert.ok(decided);
    assert.ok(decided.description.includes("기간 제한 없이"), decided.description);
    assert.ok(decided.description.includes("7일"), decided.description);
  });

  it("지금 값과 기본값이 같다 — 바꾼 적이 없으니 그것이 참말이다", () => {
    for (const kind of inventoryNotificationSettings().kinds) {
      assert.equal(kind.enabled, kind.defaultEnabled, kind.kind);
      for (const [code, cell] of Object.entries(kind.roles)) {
        assert.equal(cell.receives, cell.defaultReceives, `${kind.kind}/${code}`);
      }
    }
  });

  it("🔴 종류마다 역할 칸을 새로 만든다 — 한 객체를 나눠 쓰면 한쪽 수정이 다른 쪽까지 바꾼다", () => {
    const { kinds } = inventoryNotificationSettings();
    assert.notEqual(kinds[0].roles, kinds[1].roles);
    assert.notEqual(kinds[0].roles.ADMIN, kinds[1].roles.ADMIN);
  });

  it("설명에 7일이 적혀 있고 「확인된 신청은 안 알린다」가 들어 있다", () => {
    const rejected = inventoryNotificationSettings().kinds.find((k) => k.kind === NOTIFICATION_KINDS.rejected);
    assert.ok(rejected);
    assert.ok(rejected.description.includes("7일"), rejected.description);
    assert.ok(rejected.description.includes("확인된 신청"), rejected.description);
  });
});

describe("자격 — 관리자만", () => {
  it("관리자는 표를 받는다", async () => {
    const result = await readPortalNotificationSettings({ subject: "sub-1", findActor: found(ADMIN) });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, inventoryNotificationSettings());
  });

  it("🔴 없는 사람·관리자가 아닌 사람이 **같은 답**이다 — 까닭을 나누면 사람 목록이 샌다", async () => {
    const missing = await readPortalNotificationSettings({ subject: "sub-1", findActor: found(null) });
    const staff = await readPortalNotificationSettings({ subject: "sub-1", findActor: found({ id: "u", role: "STAFF" }) });
    const viewer = await readPortalNotificationSettings({ subject: "sub-1", findActor: found({ id: "u", role: "VIEWER" }) });
    assert.deepEqual(missing, { ok: false, status: 403, message: "이 시스템의 알림 설정은 볼 수 없습니다." });
    assert.deepEqual(staff, missing);
    assert.deepEqual(viewer, missing);
  });
});

describe("저장 — 언제나 거절", () => {
  it("관리자에게는 까닭을 적은 문장이 간다", async () => {
    const result = await writePortalNotificationSettings({ subject: "sub-1", findActor: found(ADMIN) });
    assert.equal(result.status, 403);
    assert.equal(result.message, SETTINGS_READ_ONLY_MESSAGE);
    assert.ok(result.message.includes("확인 대기"), result.message);
    assert.ok(result.message.includes("반려"), result.message);
  });

  it("🔴 관리자가 아니면 읽기와 **같은 문장**이다 — 「바꿀 수 없는 시스템」임도 알릴 이유가 없다", async () => {
    const staff = await writePortalNotificationSettings({ subject: "sub-1", findActor: found({ id: "u", role: "STAFF" }) });
    assert.deepEqual(staff, { status: 403, message: "이 시스템의 알림 설정은 볼 수 없습니다." });
  });
});
