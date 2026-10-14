import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  APPROVER_PRESENCE_NOTICES,
  approverNoticeFor,
  approverPresence,
  asRoleLabel,
  asUserLabel,
  AS_DIRECTORY_MESSAGES,
  DIRECTORY_UNREACHABLE_SAVE_MESSAGE,
  parseAsUsersResponse,
  resolveApproversFromDirectory,
  type AsUserDirectory,
} from "../src/lib/approval/directory";

/**
 * ============================================================================
 * A/S 사람 명부 — 「못 받아 왔다」와 「명부에 없다」를 가른다 (2026-10-15, 조각 ③b)
 * ============================================================================
 * 이 시험이 지키는 것은 **한 가지 혼동**이다. 결재자는 A/S 의 사람이라 명부가 저쪽에 있고,
 * A/S 가 꺼지는 일은 실제로 일어난다. 그때 「확인하지 못했다」를 「그런 사람 없다」로 그리면
 * 멀쩡한 결재선이 전부 깨진 것으로 보이고, 관리자는 멀쩡한 단계를 지운다.
 *
 * 그래서 아래 셋을 못 박는다:
 *  1. 명부를 못 받아 왔으면 저장된 단계의 상태는 `unknown` 이다 — 절대 `missing` 이 아니다.
 *  2. 응답을 못 읽은 것과 「한 명도 없다」는 다른 결과다(`null` vs `[]`).
 *  3. **새로 저장할 때**는 반대로 못 받아 왔으면 거절한다 — 단, 단계가 0개면 통과한다
 *     (0개짜리 판이 한 번 켠 절차를 끄는 유일한 출구다).
 *
 * DB 에도 망에도 붙지 않는다 — 전부 순수 함수다.
 * ============================================================================
 */

const 가 = { id: "11111111-1111-4111-8111-111111111111", name: "김철수", email: "a@x", role: "ADMIN" };
const 나 = { id: "22222222-2222-4222-8222-222222222222", name: "이영희", email: "b@x", role: "AS_ENGINEER" };

const 받아옴: AsUserDirectory = { status: "ok", users: [가, 나] };
const 못받아옴: AsUserDirectory = { status: "unreachable", reason: "timeout" };

describe("명부를 받아 왔는가 — 저장된 단계의 상태", () => {
  test("받아 왔고 그 안에 있으면 보통이다", () => {
    assert.equal(approverPresence(받아옴, 가.id), "present");
    assert.equal(approverNoticeFor(받아옴, 가.id), null);
  });

  test("받아 왔는데 그 안에 없으면 「명부에 없다」", () => {
    assert.equal(approverPresence(받아옴, "33333333-3333-4333-8333-333333333333"), "missing");
    assert.equal(
      approverNoticeFor(받아옴, "33333333-3333-4333-8333-333333333333"),
      APPROVER_PRESENCE_NOTICES.missing,
    );
  });

  test("🔴 못 받아 왔으면 「모른다」다 — 「없다」가 아니다", () => {
    assert.equal(approverPresence(못받아옴, 가.id), "unknown");
    assert.equal(approverPresence(못받아옴, "아무개"), "unknown");
    assert.equal(approverNoticeFor(못받아옴, 가.id), APPROVER_PRESENCE_NOTICES.unknown);
    // 두 문장은 **다른 말이어야 한다**. 같아지면 화면이 둘을 구별해 말할 수 없다.
    assert.notEqual(APPROVER_PRESENCE_NOTICES.unknown, APPROVER_PRESENCE_NOTICES.missing);
  });

  test("🔴 못 받아 왔을 때의 문구에 「명부에 없」이라는 말이 들어가지 않는다", () => {
    assert.ok(!APPROVER_PRESENCE_NOTICES.unknown.includes("명부에 없"));
    for (const message of Object.values(AS_DIRECTORY_MESSAGES)) {
      assert.ok(!message.includes("명부에 없"), message);
    }
  });

  test("아직 사람을 안 고른 빈 자리는 경고하지 않는다 — 저장할 때 말해 준다", () => {
    assert.equal(approverPresence(받아옴, ""), "present");
    assert.equal(approverNoticeFor(받아옴, ""), null);
    assert.equal(approverNoticeFor(못받아옴, "   "), null);
  });
});

describe("통로 응답 읽기 — 못 읽은 것과 한 명도 없는 것은 다르다", () => {
  test("모양이면 목록, 한 명도 없으면 빈 배열", () => {
    assert.deepEqual(parseAsUsersResponse({ generatedAt: "t", count: 0, users: [] }), []);
    const parsed = parseAsUsersResponse({ users: [{ id: 가.id, name: "김철수", email: "a@x", role: "ADMIN" }] });
    assert.deepEqual(parsed, [{ id: 가.id, name: "김철수", email: "a@x", role: "ADMIN" }]);
  });

  test("🔴 모양이 아니면 null — 빈 배열로 바꾸지 않는다", () => {
    assert.equal(parseAsUsersResponse(null), null);
    assert.equal(parseAsUsersResponse("<html>"), null);
    assert.equal(parseAsUsersResponse([]), null);
    assert.equal(parseAsUsersResponse({ error: "unauthorized" }), null);
    assert.equal(parseAsUsersResponse({ users: "없음" }), null);
  });

  test("id 나 이름이 빈 줄은 버린다 — 고를 수도, 저장할 수도 없다", () => {
    const parsed = parseAsUsersResponse({
      users: [{ id: "", name: "이름만" }, { id: 나.id, name: "  " }, { id: 나.id, name: " 이영희 " }, 7],
    });
    assert.deepEqual(parsed, [{ id: 나.id, name: "이영희", email: "", role: "" }]);
  });
});

describe("역할 이름표", () => {
  test("아는 코드는 한글, 모르는 코드는 코드 그대로", () => {
    assert.equal(asRoleLabel("AS_ENGINEER"), "A/S 엔지니어");
    assert.equal(asRoleLabel("WHAT_IS_THIS"), "WHAT_IS_THIS");
    assert.equal(asUserLabel(나), "이영희 (A/S 엔지니어)");
  });
});

describe("저장 시점의 자격 확인", () => {
  test("전부 명부에 있으면 통과하고, 이름·역할을 그 시점의 명부에서 가져온다", () => {
    const r = resolveApproversFromDirectory(받아옴, [나.id, 가.id]);
    assert.equal(r.ok, true);
    assert.ok(r.ok);
    assert.deepEqual(
      r.approvers.map((u) => [u.id, u.name, u.role]),
      [
        [나.id, "이영희", "AS_ENGINEER"],
        [가.id, "김철수", "ADMIN"],
      ],
    );
  });

  test("🔴 못 받아 왔으면 거절한다 — 확인 없이 결재선을 세우지 않는다", () => {
    const r = resolveApproversFromDirectory(못받아옴, [가.id]);
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.code, "DIRECTORY_UNREACHABLE");
    assert.equal(r.message, DIRECTORY_UNREACHABLE_SAVE_MESSAGE);
  });

  test("🔴 단계가 0개면 명부를 보지 않는다 — 절차를 끄는 유일한 출구를 막지 않는다", () => {
    const r = resolveApproversFromDirectory(못받아옴, []);
    assert.equal(r.ok, true);
    assert.ok(r.ok);
    assert.deepEqual(r.approvers, []);
  });

  test("명부에 없는 사람이 섞이면 **누구인지** 말해 준다", () => {
    const 없는사람 = "44444444-4444-4444-8444-444444444444";
    const r = resolveApproversFromDirectory(받아옴, [가.id, 없는사람], new Map([[없는사람, "박대표"]]));
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.code, "UNKNOWN_APPROVER");
    assert.ok(r.message.includes("2번째 단계"), r.message);
    assert.ok(r.message.includes("박대표"), r.message);
  });

  test("이름을 모르면 단계 번호만 말한다 — 「저장할 수 없습니다」로 끝내지 않는다", () => {
    const r = resolveApproversFromDirectory(받아옴, ["44444444-4444-4444-8444-444444444444"]);
    assert.ok(!r.ok);
    assert.ok(r.message.includes("1번째 단계"), r.message);
  });
});
