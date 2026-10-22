import type { EntryInput } from "./form";

/**
 * ============================================================================
 * 반출 신청에 **딸린 수리 건의 정보** — 순수 함수 (2026-10-22, 쓰는 분 요청)
 * ============================================================================
 * 쓰는 분: 「[재고 관리]의 [부품요청]과 [승인요청건]에 연결된 수리건의 model · L/N · S/N ·
 * 인수일 등이 표시되도록」. 쓰는 분이 정한 것 둘이 이 파일의 모양을 결정했다:
 *
 *  1. 🔴 **「요청이 올라올 때 받아 저장」** 한다. 화면을 그릴 때마다 A/S 에 묻지 않는다 —
 *     목록 한 번에 신청이 수십 건인데 줄마다 물으면 화면이 A/S 의 응답 속도에 묶이고,
 *     A/S 가 꺼져 있으면 **부품 요청 관리 화면 자체가 안 뜬다.**
 *  2. 🔴 **고객사와 최종사용처까지 여섯을 다 보여 준다.**
 *
 * ── 🔴 **이 값은 「요청 당시」의 값이다. 지금 값이 아니다** ───────────────────
 * A/S 에서 모델·L/N·S/N·고객사·인수일을 **나중에 고칠 수 있다**(저쪽 수리 건 수정 화면).
 * 그러면 여기 적힌 값은 옛것이 된다. 🔴 그래서 화면은 **반드시 「신청 당시」라고 말해야 한다**
 * (`REPAIR_CASE_TITLE`·`REPAIR_CASE_HINT`). 말하지 않으면 사람은 당연히 최신으로 읽고,
 * 어긋난 날 **아무 표시도 없이** 틀린 값을 보게 된다.
 * 🔵 그래도 복사해 두는 편이 맞다 — 원장(`stock_entries`)이 같은 까닭으로 같은 다섯 칸을
 *    복사해 둔다(`src/db/schema/stock.ts` 51행 근처). 「그때 무엇이었나」가 나중에 서류와
 *    맞춰 보는 값이다.
 *
 * ── 🔴 **서버 전용 모듈을 끌어오지 않는다 — 직접도 타입으로도** ─────────────
 * 두 화면(`RequestManagerScreen`·`IssueApprovalScreen`)이 클라이언트 묶음이라 여기까지
 * 따라 들어온다. 그래서 A/S 조회 통로(`./intake-lookup.ts`, `server-only`)의 타입을
 * **import 하지 않고** 아래 `RepairCaseLookupResult` 로 **모양만** 적어 둔다 —
 * `part-issue-screen.ts` 가 같은 까닭으로 쓰는 수법이다.
 * ============================================================================
 */

/**
 * 신청에 적어 두는 **수리 건 여섯 값**. 🔴 전부 글자이고 **「모름」은 빈 글자**다 — `null` 을 두면
 * 「안 물어봤다」와 「물었는데 비어 있었다」를 가를 수 있을 것 같지만, 그 둘로 할 수 있는 일이
 * 다르지 않고(둘 다 안 그린다) 칸마다 `?? ""` 가 붙는다. 원장(`stock_entries`)의 다섯 칸도
 * 같은 관례다(NOT NULL DEFAULT '').
 */
export interface RepairCaseSnapshot {
  customerName: string;
  endUser: string;
  productModel: string;
  productSerial: string;
  productLot: string;
  /**
   * 인수일 — 🔴 **`"YYYY-MM-DD"` 글자다. 시각이 아니고, Date 로 바꾸지 않는다.**
   * 까닭은 `./intake-lookup.ts` 의 같은 칸 주석에 있다(한 번 파싱하면 시간대 때문에 하루가 밀린다).
   */
  receivedAt: string;
}

/** 아무것도 못 받았을 때. 🔵 **얼어 있다** — 한 군데서 고치면 모든 신청의 값이 바뀌는 사고를 막는다. */
export const EMPTY_REPAIR_CASE: RepairCaseSnapshot = Object.freeze({
  customerName: "",
  endUser: "",
  productModel: "",
  productSerial: "",
  productLot: "",
  receivedAt: "",
});

/**
 * A/S 조회 결과의 **모양만** 적은 것 — 위 머리말의 까닭으로 `IntakeLookupResult` 를 import 하지 않는다.
 *
 * 🔴 **두 벌이 갈리는 것은 tsc 가 막는다**: 부르는 자리가 `repairCaseFromLookup(await lookupIntake(n))`
 *    이라, 저쪽에 새 갈래가 생기면 **그 줄에서 컴파일이 깨진다.** 글자만 베껴 둔 것이 아니라 울타리가 있다.
 * 🔵 `unreachable` 의 `reason` 처럼 여기 없는 칸이 더 실려 와도 괜찮다 — 쓰지 않으니 버려진다.
 */
export type RepairCaseLookupResult = { status: "found"; info: RepairCaseSnapshot } | { status: "not_found" | "bad_format" | "unreachable" };

/** 날짜 전용 글자의 모양. 🔵 달·일의 범위까지 보지 않는다 — 그 잣대는 보내는 쪽(A/S)의 DB 가 이미 쥐고 있다. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * **인수일 칸을 받는 규칙** — 🔴 모양이 맞을 때만 **글자 그대로**, 아니면 빈 글자.
 *
 * 🔴 **고쳐 주지 않는다.** `"2026-7-1"` 을 채워 주지도, `"2026-07-01T00:00:00Z"` 를 잘라 주지도,
 *    Date 로 파싱하지도 않는다. **파싱하는 순간 시간대가 끼어들고, 그것이 이 칸에서 가장 막고 싶은
 *    일이다**(`RepairCaseSnapshot.receivedAt` 주석 — 하루가 밀린다).
 * 🔴 **글자가 아니면 `String(v)` 로 만들어 주지도 않는다.** 그렇게 하면 통로가 어느 날 Date·숫자를
 *    보내기 시작했을 때 `"Tue Jul 01 2026 …"` 같은 글자가 **조용히** 저장되고 화면에 그대로 찍힌다.
 *    받은 것을 믿지 않는 자리라 **재서 떨어뜨린다** — 떨어져도 신청은 서고 그 칸만 안 그려진다.
 * 🔵 **공백을 떼지도 않는다**: A/S 는 날짜 전용 칸을 그대로 내보내므로 공백이 붙어 올 자리가 없고,
 *    붙어 왔다면 그것은 「다듬어 줄 값」이 아니라 **모양이 다른 값**이다.
 * 🔵 `intake-lookup.ts`(server-only)가 이 함수를 쓴다 — 규칙을 저기 두면 시험이 못 돌린다.
 */
export function repairCaseDate(v: unknown): string {
  return typeof v === "string" && ISO_DATE_RE.test(v) ? v : "";
}

/**
 * **A/S 에 물어볼 인수번호** — 물어볼 것이 없으면 `null`.
 *
 * 🔴 **인수번호가 없는 신청에는 묻지도 않는다**(쓰는 분 지시). 재고 관리 화면에서 직접 올린 대여·폐기,
 *    그리고 「수리 건 없음」을 고른 반출이 그것이다 — 물어 봐야 404 가 돌아오고, 그 호출마다 5초까지
 *    기다릴 수 있다(`./intake-lookup.ts` 의 `TIMEOUT_MS`).
 * 🔵 **모양은 여기서 보지 않는다.** `lookupIntake` 가 `bad_format` 으로 가려 주고, 그 갈래도 아래
 *    `repairCaseFromLookup` 에서 **빈 값**이 된다 — 가르는 자리를 두 벌 두지 않는다.
 */
export function repairCaseLookupNumber(input: EntryInput): string | null {
  if (input.type !== "USE") return null;
  if (input.noRepairCase) return null;
  const n = input.intakeNumber.trim();
  return n === "" ? null : n;
}

/**
 * 조회 결과 → 신청에 적어 둘 여섯 값.
 *
 * 🔴 **이 조각에서 가장 중요한 줄이다: 못 받으면 빈 값이고, 신청은 그대로 선다.**
 *    부품을 못 받는 것보다 정보 몇 칸이 비는 쪽이 훨씬 낫다(쓰는 분 지시). A/S 가 꺼져 있거나
 *    (`unreachable`) 그런 인수번호가 없거나(`not_found`) 모양이 틀려도(`bad_format`) **전부 같은
 *    자리로 간다** — 셋을 갈라 봐야 할 수 있는 일이 다르지 않다.
 * 🔴 **거절하는 갈래를 만들지 않는다.** 원장 쪽(`ledger.ts` 의 `recordEntryIn`)은 `not_found` 면
 *    기록을 **거절한다** — 거기는 이미 재고가 나가는 자리라 그것이 맞다. 여기는 **신청이 서기만 하는**
 *    자리이고, 담당자가 [확인]을 누르는 순간 그 원장 규칙을 한 번 더 지난다. 두 자리의 엄격함이
 *    다른 것은 일부러다.
 * 🔴 **여섯 칸을 하나하나 옮겨 적는다**(`...info` 로 펴지 않는다). 저쪽 `IntakeInfo` 에는
 *    `intakeNumber` 가 더 들어 있고, 통째로 펴면 칸이 느는 날 **쓸지 말지 정한 적 없는 값**이 신청
 *    표까지 흘러든다.
 * 🔴 **인수일은 글자 그대로**다 — `new Date()` 도 `toISOString()` 도 거치지 않는다(타입 주석).
 */
export function repairCaseFromLookup(result: RepairCaseLookupResult): RepairCaseSnapshot {
  if (result.status !== "found") return EMPTY_REPAIR_CASE;
  const info = result.info;
  return {
    customerName: info.customerName,
    endUser: info.endUser,
    productModel: info.productModel,
    productSerial: info.productSerial,
    productLot: info.productLot,
    receivedAt: info.receivedAt,
  };
}

/* ------------------------------------------------------------------ */
/* 화면에 보이는 모양 — 무엇을 어떤 차례로, 어떻게 묶어                  */
/* ------------------------------------------------------------------ */

export interface RepairCaseDetail {
  key: keyof RepairCaseSnapshot;
  label: string;
  value: string;
}

/**
 * 🔴 **두 묶음으로 가른다 — 여섯을 한 줄에 늘어놓지 않는다.**
 *
 * 두 화면 다 좁다: 부품 요청 관리의 「무엇에」 칸은 `max-w-64`(16rem)이고, 승인 요청건은 카드 안이다.
 * 여섯을 ` · ` 로 이어 한 줄로 두면 폭이 모자라 **아무 데서나 접히고**, 접히는 자리가 신청마다 달라져
 * 세로로 훑을 수 없다. 묶음을 뜻으로 갈라 두면 접혀도 **같은 것끼리 붙어** 있다.
 *
 *  ① **제품** — 기종 · L/N · S/N. 「어느 장비인가」. 담당자가 부품을 고를 때 맞춰 보는 값이다.
 *  ② **건** — 인수일 · 고객사 · End-User. 「누구의 언제 건인가」. 서류와 맞춰 볼 때 보는 값이다.
 *
 * 🔴 **접어 두지 않는다**(펼침 단추를 달지 않는다). 쓰는 분이 「표시되도록」이라고 한 값이고,
 *    접으면 **없는 것과 구별되지 않는다** — 같은 날의 「요청 비고」가 같은 까닭으로 안 접힌다
 *    (`tests/request-note-screens.test.ts` ④).
 *
 * 🔴 **낱말은 이 저장소가 이미 쓰는 것**이다 — 기록 화면의 인수번호 [확인] 상자가 **같은 통로의
 *    같은 값**을 「고객사 · End-User · 기종 · S/N · L/N」으로 부르고 있다
 *    (`src/components/stock/EntryForm.tsx`). 같은 값을 화면마다 다른 말로 부르면 사람이 다른 것인
 *    줄 안다. 🔵 쓰는 분이 적어 준 말(model · 최종사용처)과는 글자가 다르지만 가리키는 칸은 같다.
 * 🔴 **차례는 쓰는 분이 적어 준 그대로**다(model · L/N · S/N · 인수일 · 고객사 · 최종사용처).
 */
export const REPAIR_CASE_FIELD_GROUPS: ReadonlyArray<ReadonlyArray<{ key: keyof RepairCaseSnapshot; label: string }>> = [
  [
    { key: "productModel", label: "기종" },
    { key: "productLot", label: "L/N" },
    { key: "productSerial", label: "S/N" },
  ],
  [
    { key: "receivedAt", label: "인수일" },
    { key: "customerName", label: "고객사" },
    { key: "endUser", label: "End-User" },
  ],
];

/**
 * 🔴 **「신청 당시」임을 말하는 이름표.** 머리말의 까닭 — 이 글자가 없으면 사람은 최신으로 읽는다.
 * 🔵 두 화면이 **같은 말**을 쓴다. 다르게 적으면 화면을 오가는 담당자가 다른 것으로 읽는다
 *    (같은 날 「요청 비고」가 두 화면에서 같은 글자인 것과 같은 관례).
 */
export const REPAIR_CASE_TITLE = "수리 건 (신청 당시)";

/**
 * 손 올렸을 때 나오는 설명. 🔴 **「최신입니다」로 읽히지 않게** 무엇이 일어나는지까지 적는다 —
 * 「신청 당시」 네 글자만으로는 *그 뒤에 바뀔 수 있다*는 사실이 전해지지 않는다.
 */
export const REPAIR_CASE_HINT = "신청이 올라온 그때 A/S 에서 받아 적어 둔 값입니다. 그 뒤 A/S 에서 고쳐도 여기 글자는 바뀌지 않습니다 — 지금 값은 A/S 에서 확인하십시오.";

/**
 * 값이 **있는 칸만**, 위 차례대로, 묶음별로. 🔴 **빈 묶음은 아예 돌려주지 않는다.**
 *
 * 🔴 **비면 그 줄을 안 그린다**(쓰는 분 지시). 재고 관리에서 직접 올린 신청은 **늘** 여섯이 비어
 *    있고, A/S 신청도 조회가 실패하면 비어 있다. 「기종 -」을 줄마다 적으면 표만 길어지고 정작
 *    있는 값이 묻힌다 — 같은 날의 「요청 비고」·부품 자세한 내용(`requestItemDetails`)과 같은 규칙이다.
 * 🔵 앞뒤 공백만 있는 값도 없는 것으로 본다 — 저장은 빈 글자가 관례지만 화면이 그 관례에 기대지 않는다.
 */
export function repairCaseGroups(c: RepairCaseSnapshot): RepairCaseDetail[][] {
  const out: RepairCaseDetail[][] = [];
  for (const group of REPAIR_CASE_FIELD_GROUPS) {
    const details: RepairCaseDetail[] = [];
    for (const f of group) {
      const value = (c[f.key] ?? "").trim();
      if (value) details.push({ key: f.key, label: f.label, value });
    }
    if (details.length > 0) out.push(details);
  }
  return out;
}

/** 여섯이 전부 비었나 — 🔵 화면이 「그릴 것이 있나」를 묻는 한 줄. */
export function isRepairCaseEmpty(c: RepairCaseSnapshot): boolean {
  return repairCaseGroups(c).length === 0;
}
