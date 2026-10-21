import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isActiveDelegation, type ApprovalDelegationPeriod } from "../src/lib/approval/delegation";
import {
  isUuidText,
  noSsoDelegateMessage,
  resolveDelegateFromDirectory,
  seoulDateText,
  seoulDayStart,
  seoulEndDateText,
  seoulNextDayStart,
  validateDelegationInput,
  SELF_DELEGATION_MESSAGE,
  UNKNOWN_DELEGATE_MESSAGE,
} from "../src/lib/approval/delegation-input";
import { DIRECTORY_UNREACHABLE_SAVE_MESSAGE, type AsUser, type AsUserDirectory } from "../src/lib/approval/directory";

/**
 * ============================================================================
 * 결재권 위임 만들기 — 입력과 **날짜 → 시각** 환산 (2026-10-21, 조각 3)
 * ============================================================================
 * 조각 1·2가 표와 판정을 깔았고, 이 조각이 **줄을 넣는 길**을 만들었다. 여기서 못 박는 것은
 * 그 길에서 가장 틀리기 쉬운 자리 둘이다:
 *
 *  1. 🔴 **종료일 당일이 포함되는가.** 표는 반열린 구간이라(`starts_at <= now < ends_at`)
 *     적은 날짜를 그대로 넣으면 **종료일 당일에 위임이 안 먹는다.** 오류가 나지 않아 아무도
 *     못 보고 「왜 안 되지」만 남는다. 그래서 환산을 화면이 아니라 순수 함수에 두고 여기서
 *     **판정 함수까지 지나게** 재 본다 — 환산만 재면 「그 값이 정말 유효한가」는 안 묻게 된다.
 *  2. 🔴 **고른 사람이 번호 없이 들어가지 않는가.** 번호 없는 사람을 대리인으로 세우면
 *     위임이 성립하지 않는데(로그인해도 우리가 알아볼 수 없다) 화면에는 멀쩡한 줄로 보인다.
 *
 * 🔵 시간대는 `Asia/Seoul` 이다. 운영 서버(NAS)는 UTC 라, 아래 기대값을 전부 **UTC 글자**로
 *    적어 둔다 — 「한국 0시」가 UTC 로 몇 시인지가 눈에 보여야 셈이 틀렸을 때 바로 드러난다.
 * ============================================================================
 */

/** 2026-10-20 00:00(한국) = 2026-10-19T15:00Z. */
const START_UTC = "2026-10-19T15:00:00.000Z";
/** 「10월 25일까지」의 끝 = 2026-10-26 00:00(한국) = 2026-10-25T15:00Z. */
const END_UTC = "2026-10-25T15:00:00.000Z";

const uuid = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const DELEGATE_ID = uuid("1");

const asUser = (over: Partial<AsUser> = {}): AsUser => ({
  id: DELEGATE_ID,
  name: "이대리",
  email: "lee@example.com",
  role: "AS_ENGINEER",
  ssoSubject: "sub-lee",
  ...over,
});

const okDirectory = (users: AsUser[]): AsUserDirectory => ({ status: "ok", users });

const input = (over: Record<string, unknown> = {}) => ({
  delegateUserId: DELEGATE_ID,
  startDate: "2026-10-20",
  endDate: "2026-10-25",
  reason: "출장",
  ...over,
});

/** 검증을 지난 값으로 위임 한 줄을 만든다 — **판정이 실제로 보는 모양**이다. */
function periodOf(over: Record<string, unknown> = {}): ApprovalDelegationPeriod {
  const r = validateDelegationInput(input(over));
  assert.ok(r.ok, "검증이 거절했다");
  return { delegatorSub: "sub-kim", delegateSub: "sub-lee", startsAt: r.startsAt, endsAt: r.endsAt, revokedAt: null };
}

describe("① 🔴 날짜 → 시각 — 한국 시각 0시를 손으로 만든다", () => {
  it("시작일은 **그날 0시(한국)**다 — `new Date(\"2026-10-20\")`(UTC 0시 = 한국 오전 9시)가 아니다", () => {
    assert.equal(seoulDayStart("2026-10-20")?.toISOString(), START_UTC);
    // 🔴 이것이 틀리면 위임이 **아침 9시에 시작한다.** 그날 새벽에 올라온 건을 대리인이 못 누른다.
    assert.notEqual(seoulDayStart("2026-10-20")?.toISOString(), new Date("2026-10-20").toISOString());
  });

  it("🔴 종료일의 끝은 **그 다음 날 0시(한국)**다 — 이 한 줄이 이 조각의 핵심이다", () => {
    assert.equal(seoulNextDayStart("2026-10-25")?.toISOString(), END_UTC);
  });

  it("달·해를 넘긴다 — 10/31 → 11/01, 12/31 → 다음 해 1/1", () => {
    assert.equal(seoulNextDayStart("2026-10-31")?.toISOString(), "2026-10-31T15:00:00.000Z"); // = 11/01 0시(한국)
    assert.equal(seoulDateText(seoulNextDayStart("2026-10-31")!), "2026-11-01");
    assert.equal(seoulDateText(seoulNextDayStart("2026-12-31")!), "2027-01-01");
  });

  it("윤년을 넘긴다 — 2028-02-28 → 02-29, 02-29 → 03-01", () => {
    assert.equal(seoulDateText(seoulNextDayStart("2028-02-28")!), "2028-02-29");
    assert.equal(seoulDateText(seoulNextDayStart("2028-02-29")!), "2028-03-01");
    // 🔴 윤년이 아닌 해의 2월 29일은 **달력에 없는 날**이다. 조용히 3월 1일로 넘기면 사람이
    //    적은 적 없는 날짜로 위임이 선다.
    assert.equal(seoulDayStart("2027-02-29"), null);
    assert.equal(seoulDayStart("2026-02-30"), null);
    assert.equal(seoulDayStart("2026-13-01"), null);
  });

  it("모양이 아니면 null — 손으로 만든 요청이 여기서 걸린다", () => {
    for (const bad of ["", "2026-10-5", "20261005", "오늘", "2026-10-05T00:00:00Z"]) {
      assert.equal(seoulDayStart(bad), null, bad);
      assert.equal(seoulNextDayStart(bad), null, bad);
    }
  });

  it("🔴 표시용 종료일은 `seoulNextDayStart` 의 **정확한 역함수**다 — 하루 뒤가 보이면 안 된다", () => {
    for (const date of ["2026-10-25", "2026-10-31", "2026-12-31", "2028-02-29"]) {
      assert.equal(seoulEndDateText(seoulNextDayStart(date)!), date, date);
    }
  });
});

describe("② 🔴 「10/25까지」가 **그날 하루 전체**를 덮는다 — 판정 함수까지 지나서", () => {
  const period = periodOf();

  it("종료일 당일 23:59(한국)에도 유효하다", () => {
    // 🔴 여기가 거짓이면 「10월 25일까지」라고 적은 사람은 **25일 내내 위임이 안 먹는다.**
    //    오류가 나지 않아 아무도 모르고, 「왜 안 되지」만 남는다.
    assert.equal(isActiveDelegation(period, new Date("2026-10-25T14:59:59.999Z")), true, "= 10/25 23:59:59(한국)");
  });

  it("🔴 종료일 **다음 날 0시(한국)**부터는 아니다 — 끝은 포함하지 않는다", () => {
    assert.equal(isActiveDelegation(period, new Date(END_UTC)), false, "= 10/26 00:00(한국)");
  });

  it("시작일 0시(한국)부터다 — 그 직전은 아니다", () => {
    assert.equal(isActiveDelegation(period, new Date("2026-10-19T14:59:59.999Z")), false, "= 10/19 23:59(한국)");
    assert.equal(isActiveDelegation(period, new Date(START_UTC)), true, "= 10/20 00:00(한국)");
  });

  it("🔵 시작일과 종료일이 **같은 날**이면 그 하루만 — 하루짜리 위임은 정상이다", () => {
    const oneDay = periodOf({ startDate: "2026-10-20", endDate: "2026-10-20" });
    assert.equal(isActiveDelegation(oneDay, new Date("2026-10-19T14:59:59.999Z")), false, "전날 23:59(한국)");
    assert.equal(isActiveDelegation(oneDay, new Date(START_UTC)), true, "당일 0시(한국)");
    assert.equal(isActiveDelegation(oneDay, new Date("2026-10-20T14:59:59.999Z")), true, "당일 23:59(한국)");
    assert.equal(isActiveDelegation(oneDay, new Date("2026-10-20T15:00:00.000Z")), false, "다음 날 0시(한국)");
  });
});

describe("③ 거르는 것 — 거절하고 **까닭을 말한다**", () => {
  it("🔴 기간이 거꾸로면 거절한다 — DB CHECK 까지 가면 「알 수 없는 오류」가 된다", () => {
    const r = validateDelegationInput(input({ startDate: "2026-10-25", endDate: "2026-10-20" }));
    assert.equal(r.ok, false);
    assert.equal(r.code, "PERIOD_REVERSED");
    assert.match(r.message, /종료일이 시작일보다 앞섭니다/);
    assert.doesNotMatch(r.message, /check|constraint|approval_delegations/i, "영어 개발자 메시지가 새어 나갔다");
  });

  it("대신할 분을 안 골랐으면 거절한다", () => {
    const r = validateDelegationInput(input({ delegateUserId: "" }));
    assert.equal(r.ok, false);
    assert.equal(r.code, "MISSING_DELEGATE");
    assert.match(r.message, /고르십시오/);
  });

  it("날짜를 안 골랐거나 모양이 아니면 **어느 칸인지** 말한다", () => {
    const missing = validateDelegationInput(input({ endDate: "" }));
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "MISSING_DATE");
    assert.match(missing.message, /종료일/);

    const broken = validateDelegationInput(input({ startDate: "2026-02-30" }));
    assert.equal(broken.ok, false);
    assert.equal(broken.code, "INVALID_DATE");
    assert.match(broken.message, /시작일/);
  });

  it("uuid 가 아닌 사람 번호·객체가 아닌 요청은 거절한다 (손으로 만든 요청)", () => {
    assert.equal(validateDelegationInput(input({ delegateUserId: "lee" })).ok, false);
    assert.equal(validateDelegationInput(null).ok, false);
    assert.equal(validateDelegationInput([]).ok, false);
    assert.equal(validateDelegationInput("x").ok, false);
    assert.equal(isUuidText(DELEGATE_ID), true);
    assert.equal(isUuidText("lee"), false);
    assert.equal(isUuidText(null), false);
  });

  it("사유는 **비워도 된다** — 안 적었다고 위임을 막을 일은 아니다", () => {
    const r = validateDelegationInput(input({ reason: undefined }));
    assert.ok(r.ok);
    assert.equal(r.reason, "");
  });

  it("사유의 줄바꿈·겹친 공백은 한 칸으로, 500자에서 자른다", () => {
    const r = validateDelegationInput(input({ reason: " 출장\n\n 중국  " }));
    assert.ok(r.ok);
    assert.equal(r.reason, "출장 중국");
    const long = validateDelegationInput(input({ reason: "가".repeat(600) }));
    assert.ok(long.ok);
    assert.equal(long.reason.length, 500);
  });

  it("🔴 **입력에 맡기는 사람을 섞어 보내도 결과에 실리지 않는다** — 받는 칸이 없다", () => {
    // 🔴 남의 결재권을 넘기는 요청을 손으로 만드는 길이 여기서 끊긴다. 서버는 세션의 번호만 적는다.
    const r = validateDelegationInput(input({ delegatorSub: "sub-victim", delegatorName: "피해자", createdBySub: "sub-victim" }));
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r).sort(), ["delegateUserId", "endDate", "endsAt", "ok", "reason", "startDate", "startsAt"]);
  });
});

describe("④ 고른 사람을 명부에서 풀기 — 번호 없는 사람은 못 세운다", () => {
  const ME = "sub-kim";

  it("명부에 있고 포털 번호가 있으면 **번호와 이름**이 나온다", () => {
    const r = resolveDelegateFromDirectory(okDirectory([asUser()]), DELEGATE_ID, ME);
    assert.ok(r.ok);
    assert.deepEqual(r.delegate, { id: DELEGATE_ID, name: "이대리", sub: "sub-lee" });
  });

  it("🔴 **명부를 못 가져오면 그렇게 말한다** — 빈 목록으로 둔갑시키지 않는다", () => {
    for (const reason of ["not_configured", "timeout", "error"] as const) {
      const r = resolveDelegateFromDirectory({ status: "unreachable", reason }, DELEGATE_ID, ME);
      assert.equal(r.ok, false);
      assert.equal(r.code, "DIRECTORY_UNREACHABLE");
      assert.equal(r.message, DIRECTORY_UNREACHABLE_SAVE_MESSAGE, "결재선 저장과 같은 말이어야 한다 — 같은 사고가 다른 일로 보이면 안 된다");
      assert.doesNotMatch(r.message, /없습니다/, "「모른다」를 「없다」로 말했다");
    }
  });

  it("🔴 포털 번호가 없는 분은 거절하고 **고치는 길**을 말한다", () => {
    const r = resolveDelegateFromDirectory(okDirectory([asUser({ ssoSubject: null })]), DELEGATE_ID, ME);
    assert.equal(r.ok, false);
    assert.equal(r.code, "NO_SSO_SUBJECT");
    assert.equal(r.message, noSsoDelegateMessage("이대리"));
    assert.match(r.message, /이대리/, "누구인지 없으면 열 명 중 누구를 빼야 할지 모른다");
    assert.match(r.message, /한 번 들어온 뒤에/, "고치는 길이 없으면 A/S 에 사람을 다시 만들어 달라고 한다");
  });

  it("🔴 **자기 자신에게는 못 맡긴다** — DB 오류가 아니라 사람 말로 막는다", () => {
    const r = resolveDelegateFromDirectory(okDirectory([asUser({ ssoSubject: ME })]), DELEGATE_ID, ME);
    assert.equal(r.ok, false);
    assert.equal(r.code, "SELF_DELEGATION");
    assert.equal(r.message, SELF_DELEGATION_MESSAGE);
    assert.doesNotMatch(r.message, /not_self|check|violates/i, "DB CHECK 오류가 그대로 새어 나갔다");
  });

  it("🔵 자기 자신 판정은 **포털 번호로** 한다 — A/S 번호가 같아도 번호가 다르면 남이다", () => {
    // 🔴 화면이 보내는 것은 A/S 번호이고 세션이 아는 것은 포털 번호다. 열쇠를 섞으면 「자기
    //    자신」이 영원히 거짓이 되어 뜻 없는 줄이 들어온다(표의 CHECK 가 그때 영어로 터진다).
    const r = resolveDelegateFromDirectory(okDirectory([asUser({ ssoSubject: "sub-lee" })]), DELEGATE_ID, ME);
    assert.ok(r.ok);
  });

  it("명부에서 사라진 사람은 「지금 못 찾는다」로 말한다", () => {
    const r = resolveDelegateFromDirectory(okDirectory([asUser({ id: uuid("9") })]), DELEGATE_ID, ME);
    assert.equal(r.ok, false);
    assert.equal(r.code, "UNKNOWN_DELEGATE");
    assert.equal(r.message, UNKNOWN_DELEGATE_MESSAGE);
  });

  it("🔵 명부가 **비어 있는 것**은 「못 받아 왔다」와 다른 말이다 — 그때는 「못 찾는다」가 맞다", () => {
    const r = resolveDelegateFromDirectory(okDirectory([]), DELEGATE_ID, ME);
    assert.equal(r.ok, false);
    assert.equal(r.code, "UNKNOWN_DELEGATE");
  });
});
