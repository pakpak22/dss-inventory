import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  APPROVER_PRESENCE_NOTICES,
  approverNoticeFor,
  approverPresence,
  asRoleLabel,
  asUserChoiceLabel,
  asUserLabel,
  AS_DIRECTORY_MESSAGES,
  DIRECTORY_UNREACHABLE_SAVE_MESSAGE,
  parseAsUsersResponse,
  resolveApproversFromDirectory,
  toAsUserChoiceDirectory,
  UNSELECTABLE_APPROVER_SUFFIX,
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
 * ── 🔴 그리고 **포털 번호**(2026-10-15) ────────────────────────────────
 * 결재자 판정의 열쇠는 A/S 번호가 아니라 포털 번호다. 포털로 한 번도 들어온 적 없는 사람은
 * 그 번호가 `null` 로 오고, 그 사람을 결재선에 세우면 **아무도 열 수 없는 단계**가 된다.
 * 여기서 넷을 더 못 박는다:
 *  4. 명부 파서가 `ssoSubject` 를 읽고, 없거나 빈 글자면 `null` 이다(칸을 아직 안 보내는 판도).
 *  5. 번호가 없는 사람도 **명부에는 남는다** — 다만 「고를 수 없음」으로 가려진다.
 *  6. **저장은 거절한다** — 누구인지와 고치는 길을 말하면서.
 *  7. 🔴 화면으로 내려보내는 모양에는 **포털 번호가 들어 있지 않다**(신원 증명에 쓰이는 값이다).
 *
 * DB 에도 망에도 붙지 않는다 — 전부 순수 함수다.
 * ============================================================================
 */

const 가 = { id: "11111111-1111-4111-8111-111111111111", name: "김철수", email: "a@x", role: "ADMIN", ssoSubject: "sub-가" };
const 나 = { id: "22222222-2222-4222-8222-222222222222", name: "이영희", email: "b@x", role: "AS_ENGINEER", ssoSubject: "sub-나" };
/** 🔴 포털로 한 번도 들어온 적 없는 사람. 명부에는 있지만 결재자로는 고를 수 없다. */
const 다 = { id: "33333333-3333-4333-8333-333333333333", name: "박대표", email: "c@x", role: "SALES", ssoSubject: null };

const 받아옴: AsUserDirectory = { status: "ok", users: [가, 나, 다] };
const 못받아옴: AsUserDirectory = { status: "unreachable", reason: "timeout" };

/** 화면이 받는 모양 — 포털 번호가 빠지고 `selectable` 한 칸이 붙는다. */
const 화면받아옴 = toAsUserChoiceDirectory(받아옴);
const 화면못받아옴 = toAsUserChoiceDirectory(못받아옴);

const 없는사람 = "55555555-5555-4555-8555-555555555555";

describe("명부를 받아 왔는가 — 저장된 단계의 상태", () => {
  test("받아 왔고 그 안에 있으면 보통이다", () => {
    assert.equal(approverPresence(화면받아옴, 가.id), "present");
    assert.equal(approverNoticeFor(화면받아옴, 가.id), null);
  });

  test("받아 왔는데 그 안에 없으면 「명부에 없다」", () => {
    assert.equal(approverPresence(화면받아옴, 없는사람), "missing");
    assert.equal(approverNoticeFor(화면받아옴, 없는사람), APPROVER_PRESENCE_NOTICES.missing);
  });

  test("🔴 못 받아 왔으면 「모른다」다 — 「없다」가 아니다", () => {
    assert.equal(approverPresence(화면못받아옴, 가.id), "unknown");
    assert.equal(approverPresence(화면못받아옴, "아무개"), "unknown");
    assert.equal(approverNoticeFor(화면못받아옴, 가.id), APPROVER_PRESENCE_NOTICES.unknown);
    // 두 문장은 **다른 말이어야 한다**. 같아지면 화면이 둘을 구별해 말할 수 없다.
    assert.notEqual(APPROVER_PRESENCE_NOTICES.unknown, APPROVER_PRESENCE_NOTICES.missing);
  });

  test("🔴 명부에는 있는데 포털 번호가 없으면 「고를 수 없음」이다 — 「명부에 없다」가 아니다", () => {
    assert.equal(approverPresence(화면받아옴, 다.id), "no_sso");
    assert.equal(approverNoticeFor(화면받아옴, 다.id), APPROVER_PRESENCE_NOTICES.no_sso);
    // 🔴 고치는 길이 다르다 — 저쪽은 다른 사람을 고르는 일이고, 이쪽은 그 사람이 한 번
    //    로그인하면 풀린다. 같은 말로 적으면 멀쩡히 명부에 있는 사람을 A/S 에 다시 만들어
    //    달라고 하게 된다.
    assert.notEqual(APPROVER_PRESENCE_NOTICES.no_sso, APPROVER_PRESENCE_NOTICES.missing);
    assert.ok(!APPROVER_PRESENCE_NOTICES.no_sso.includes("명부에 없"), APPROVER_PRESENCE_NOTICES.no_sso);
  });

  test("🔴 못 받아 왔을 때의 문구에 「명부에 없」이라는 말이 들어가지 않는다", () => {
    assert.ok(!APPROVER_PRESENCE_NOTICES.unknown.includes("명부에 없"));
    for (const message of Object.values(AS_DIRECTORY_MESSAGES)) {
      assert.ok(!message.includes("명부에 없"), message);
    }
  });

  test("아직 사람을 안 고른 빈 자리는 경고하지 않는다 — 저장할 때 말해 준다", () => {
    assert.equal(approverPresence(화면받아옴, ""), "present");
    assert.equal(approverNoticeFor(화면받아옴, ""), null);
    assert.equal(approverNoticeFor(화면못받아옴, "   "), null);
  });
});

describe("🔴 화면으로 내려보내는 모양 — 포털 번호는 빠진다", () => {
  test("고를 수 있는가 한 칸만 간다. 번호 자체는 어디에도 없다", () => {
    assert.equal(화면받아옴.status, "ok");
    assert.ok(화면받아옴.status === "ok");
    assert.deepEqual(
      화면받아옴.users.map((u) => [u.name, u.selectable]),
      [
        ["김철수", true],
        ["이영희", true],
        ["박대표", false],
      ],
    );
    // 🔴 신원 증명에 쓰이는 값이다 — 한 글자도 브라우저로 나가면 안 된다.
    const 직렬화 = JSON.stringify(화면받아옴);
    assert.ok(!직렬화.includes("sub-가"), 직렬화);
    assert.ok(!직렬화.includes("ssoSubject"), 직렬화);
  });

  test("🔴 못 받아 온 것은 못 받아 온 그대로 간다 — 「한 명도 없다」로 바꾸지 않는다", () => {
    assert.deepEqual(화면못받아옴, { status: "unreachable", reason: "timeout" });
  });

  test("고를 수 없는 사람의 이름표에는 까닭이 붙는다 — 목록에서 빼지 않기 때문이다", () => {
    assert.equal(asUserChoiceLabel({ name: "박대표", role: "SALES", selectable: false }), `박대표 (영업 담당자)${UNSELECTABLE_APPROVER_SUFFIX}`);
    assert.equal(asUserChoiceLabel({ name: "박대표", role: "SALES", selectable: true }), "박대표 (영업 담당자)");
  });
});

describe("통로 응답 읽기 — 못 읽은 것과 한 명도 없는 것은 다르다", () => {
  test("모양이면 목록, 한 명도 없으면 빈 배열", () => {
    assert.deepEqual(parseAsUsersResponse({ generatedAt: "t", count: 0, users: [] }), []);
    const parsed = parseAsUsersResponse({ users: [{ id: 가.id, name: "김철수", email: "a@x", role: "ADMIN", ssoSubject: "sub-가" }] });
    assert.deepEqual(parsed, [{ id: 가.id, name: "김철수", email: "a@x", role: "ADMIN", ssoSubject: "sub-가" }]);
  });

  test("🔴 포털 번호가 없으면 null 이다 — 칸이 아예 없는 판(A/S 가 아직 안 보낼 때)도 같다", () => {
    const parsed = parseAsUsersResponse({
      users: [
        { id: 가.id, name: "김철수", role: "ADMIN", ssoSubject: null },
        { id: 나.id, name: "이영희", role: "AS_ENGINEER", ssoSubject: "   " },
        { id: 다.id, name: "박대표", role: "SALES" },
      ],
    });
    assert.ok(parsed);
    assert.deepEqual(
      parsed.map((u) => u.ssoSubject),
      [null, null, null],
      "🔴 빈 글자를 그대로 두면 그것이 열쇠로 쓰여 번호 없는 사람끼리 같은 사람이 된다",
    );
  });

  test("🔴 포털 번호가 없는 사람도 명부에 남는다 — 조용히 빼면 「왜 저 사람이 없지」가 된다", () => {
    const parsed = parseAsUsersResponse({ users: [{ id: 다.id, name: "박대표", role: "SALES" }] });
    assert.equal(parsed?.length, 1);
    assert.equal(parsed?.[0].name, "박대표");
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
      users: [{ id: "", name: "이름만" }, { id: 나.id, name: "  " }, { id: 나.id, name: " 이영희 ", ssoSubject: " sub-나 " }, 7],
    });
    assert.deepEqual(parsed, [{ id: 나.id, name: "이영희", email: "", role: "", ssoSubject: "sub-나" }]);
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
  test("전부 명부에 있으면 통과하고, 이름·역할·포털 번호를 그 시점의 명부에서 가져온다", () => {
    const r = resolveApproversFromDirectory(받아옴, [나.id, 가.id]);
    assert.equal(r.ok, true);
    assert.ok(r.ok);
    assert.deepEqual(
      r.approvers.map((u) => [u.id, u.name, u.role, u.ssoSubject]),
      [
        [나.id, "이영희", "AS_ENGINEER", "sub-나"],
        [가.id, "김철수", "ADMIN", "sub-가"],
      ],
      "🔴 포털 번호를 함께 돌려주지 않으면 저장할 때 적을 값이 없다",
    );
  });

  test("🔴 포털 번호가 없는 사람은 거절한다 — 아무도 열 수 없는 단계를 만들지 않는다", () => {
    const r = resolveApproversFromDirectory(받아옴, [가.id, 다.id]);
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.code, "NO_SSO_SUBJECT");
    assert.ok(r.message.includes("2번째 단계"), r.message);
    assert.ok(r.message.includes("박대표"), r.message);
    assert.ok(r.message.includes("통합 로그인"), r.message);
  });

  test("🔴 혼자만 있어도 거절한다 — 화면 검사만 믿지 않는다(이 함수는 화면을 거치지 않고도 불린다)", () => {
    const r = resolveApproversFromDirectory(받아옴, [다.id]);
    assert.ok(!r.ok);
    assert.equal(r.code, "NO_SSO_SUBJECT");
    assert.ok(r.message.includes("1번째 단계"), r.message);
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
    const r = resolveApproversFromDirectory(받아옴, [가.id, 없는사람], new Map([[없는사람, "최과장"]]));
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.code, "UNKNOWN_APPROVER");
    assert.ok(r.message.includes("2번째 단계"), r.message);
    assert.ok(r.message.includes("최과장"), r.message);
  });

  test("이름을 모르면 단계 번호만 말한다 — 「저장할 수 없습니다」로 끝내지 않는다", () => {
    const r = resolveApproversFromDirectory(받아옴, ["44444444-4444-4444-8444-444444444444"]);
    assert.ok(!r.ok);
    assert.ok(r.message.includes("1번째 단계"), r.message);
  });
});
