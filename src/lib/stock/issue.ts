import type { EntryInput, SimpleLine, UseLine } from "./form";

/**
 * 요청 + 「이번에 줄 수량」 → 원장 입력 (2026-10-14, 조각 4b. 설계 `docs/부품요청_이관_설계_2026-10-14.md` 5절).
 *
 * 🔴 **원장으로 가는 유일한 길.** 지금까지 `confirmRequest` 는 신청 `payload` 를 **통째로** `recordEntry` 에 넘겼다.
 *    이제는 여기서 만든 `EntryInput` 만 넘긴다. 그래서 원장(`ledger.ts`)은 그것이 부분 불출인지 전부인지
 *    **알 필요가 없고** 타입도 그대로다 — 사용자가 못 박은 「수량 변경 기록 기능은 그대로 유지」가 타입으로 지켜진다.
 *
 * 🔵 순수 함수다(DB·서버 의존 없음). 그래서 `npm test` 가 DB 없이 경계를 전부 돌려 본다.
 */

export interface IssueQuantity {
  partId: string;
  /** 이번 회차에 줄 수량. 0 이면 이번엔 안 준다 */
  quantity: number;
}

export interface IssuePlan {
  /**
   * 원장에 넘길 입력.
   * 🔴 `null` 이면 이번에 줄 것이 하나도 없다 — **아무것도 쓰지 않는다**(수량 줄이 없는 빈 원장 건을 만들지 않는다).
   */
  input: EntryInput | null;
  /** 이번 회차가 나간 뒤에도 아직 못 준 수량의 합. 0 이면 요청이 끝난 것(CONFIRMED), 1 이상이면 열린 채 남는다(PARTIAL) */
  remaining: number;
  /** 이번 회차에 나가는 수량의 합 */
  issuing: number;
}

export type BuildIssueResult = { ok: true; plan: IssuePlan } | { ok: false; message: string };

type PartNames = ReadonlyMap<string, { no: number; name: string }>;

/** 사람에게 보일 부품 이름. 이름을 못 찾아도 문구가 깨지지 않게 (CLAUDE.md 10절: 코드값·표 이름을 화면에 내지 않는다) */
function partLabel(partId: string, names: PartNames): string {
  const p = names.get(partId);
  return p ? `No. ${p.no} ${p.name}` : "고른 부품";
}

/**
 * 확인을 거치는 세 종류(USE·LOAN·DISPOSE)의 요청 줄. 그 밖의 종류면 `null`.
 *
 * 🔵 `requests.ts` 의 `linesOf` 는 **화면 요약용**이라 조정·소유 옮김까지 억지로 한 줄로 만든다 — 쓰임이 달라 따로 둔다.
 *    여기는 「부분 불출이 가능한 줄」만 본다.
 */
function issuableLines(input: EntryInput): ReadonlyArray<{ partId: string; quantity: number }> | null {
  if (input.type === "USE" || input.type === "LOAN" || input.type === "DISPOSE") return input.lines.map((l) => ({ partId: l.partId, quantity: l.quantity }));
  return null;
}

/**
 * 「요청 수량 lines」 → 「이번 회차에 줄 수량 lines」.
 *
 * @param payload 신청에 저장된 EntryInput (요청 수량이 들어 있다)
 * @param want    줄별로 이번에 줄 수량. 🔵 `null` 이면 **남은 수량 전부** — 화면이 생기기 전(조각 4d)까지의 기존 동작 그대로다.
 *                목록에 없는 부품은 0 으로 본다(이번엔 안 준다).
 * @param issued  이 요청에서 **이미 나간 수량**(부품별). 회차 표에 달린 원장 줄을 세어서 온다.
 * @param names   오류 문구에 쓸 부품 이름
 *
 * 거절하는 것 둘 (🔴 둘 다 원장이 아니라 **여기서** 막는다 — 원장은 요청을 모른다):
 *  - 요청 수량보다 많이 주려 할 때
 *  - 이미 나간 양을 빼고 **남은 양보다** 많이 주려 할 때
 */
export function buildIssueInput(payload: EntryInput, want: ReadonlyMap<string, number> | null, issued: ReadonlyMap<string, number>, names: PartNames = new Map()): BuildIssueResult {
  const requested = issuableLines(payload);
  if (requested === null) {
    // 줄이 없는 종류(입고·반환·조정·소유 옮김)는 애초에 확인 대기를 거치지 않는다 (codes.ts 의 CONFIRMATION_TYPES).
    // 그래도 그런 신청이 들어와 있으면 **지금까지 하던 대로** 통째로 넘긴다 — 이 조각에서 기존 동작이 바뀌면 안 된다.
    return { ok: true, plan: { input: payload, remaining: 0, issuing: 0 } };
  }
  // 요청 줄에 같은 부품이 두 번 들어오는 일은 폼 검사가 막는다 (form.ts: 「같은 부품이 두 번 들어 있습니다」).
  const requestedById = new Map(requested.map((l) => [l.partId, l.quantity]));
  if (want) {
    for (const partId of want.keys()) {
      if (!requestedById.has(partId)) return { ok: false, message: "요청에 없는 부품이 들어 있습니다. 화면을 새로 고치고 다시 하십시오." };
    }
  }

  const give = new Map<string, number>();
  let remaining = 0;
  let issuing = 0;
  for (const line of requested) {
    const already = issued.get(line.partId) ?? 0;
    // 이미 나간 양이 요청보다 많아질 수는 없지만(아래 검사가 막는다), 어긋나더라도 남은 수량이 음수로 흐르지 않게 막는다.
    const left = Math.max(0, line.quantity - already);
    const n = want === null ? left : (want.get(line.partId) ?? 0);
    if (!Number.isInteger(n) || n < 0) return { ok: false, message: `${partLabel(line.partId, names)}: 내줄 수량은 0 이상의 정수입니다.` };
    if (n > line.quantity) return { ok: false, message: `${partLabel(line.partId, names)}: 요청 수량은 ${line.quantity}개입니다. 요청보다 많이 내줄 수 없습니다.` };
    if (n > left) return { ok: false, message: `${partLabel(line.partId, names)}: 요청 ${line.quantity}개 중 ${already}개가 이미 나갔습니다. 남은 ${left}개까지만 내줄 수 있습니다.` };
    remaining += left - n;
    issuing += n;
    if (n > 0) give.set(line.partId, n); // 🔴 0 인 줄은 뺀다 — 원장에 수량 0 짜리 줄을 만들지 않는다
  }
  if (give.size === 0) return { ok: true, plan: { input: null, remaining, issuing: 0 } };

  if (payload.type === "USE") {
    const lines: UseLine[] = payload.lines
      .filter((l) => give.has(l.partId))
      .map((l) => ({
        ...l,
        quantity: give.get(l.partId)!,
        // 🔴 「실제 수량이 다릅니다」(actualQuantity)는 그 부품이 **처음 나갈 때만** 싣는다.
        //    회차마다 다시 실으면 조정(ADJUST)이 수량을 그 값으로 **다시 끌어올려** 재고가 부풀어 오른다:
        //    1회차에 5개로 맞추고 3개를 쓰면 지금 2개인데, 2회차가 또 5개로 맞춰 +3 이 들어간다.
        //    남은 회차에서 실물 수량이 또 다르면 담당자가 조정(ADJUST) 기록을 따로 적는다.
        actualQuantity: (issued.get(l.partId) ?? 0) === 0 ? l.actualQuantity : null,
      }));
    return { ok: true, plan: { input: { ...payload, lines }, remaining, issuing } };
  }
  // 여기 올 수 있는 것은 대여·폐기뿐이다(위에서 줄을 준 종류가 셋뿐이라). 타입을 좁히려고 다시 확인한다.
  if (payload.type !== "LOAN" && payload.type !== "DISPOSE") return { ok: true, plan: { input: payload, remaining, issuing } };
  const lines: SimpleLine[] = payload.lines.filter((l) => give.has(l.partId)).map((l) => ({ ...l, quantity: give.get(l.partId)! }));
  return { ok: true, plan: { input: { ...payload, lines }, remaining, issuing } };
}

export type ParseIssueQuantitiesResult = { ok: true; quantities: IssueQuantity[] | null } | { ok: false; message: string };

/** 한 건에 50줄까지 — 폼 검사(form.ts 의 MAX_LINES)와 같은 한도. 요청 줄보다 많이 올 수 없으니 같은 수를 쓴다. */
const MAX_LINES = 50;
const BAD_QUANTITIES = "내줄 수량을 읽지 못했습니다. 화면을 새로 고치고 다시 하십시오.";

/**
 * 화면이 보낸 줄별 수량(JSON 글자 하나) 읽기.
 *
 * 🔵 조각 4d(화면)가 쓸 **받을 자리**를 미리 만들어 둔 것이다. 지금 화면은 안 보낸다 —
 *    안 보내면 `null`(= 남은 수량 전부)이라 **지금까지의 동작과 같다.**
 * 🔴 값은 여기서 모양만 보고, 「요청에 있는 부품인가·요청보다 많지 않은가」는 `buildIssueInput` 이 본다.
 */
export function parseIssueQuantities(raw: unknown): ParseIssueQuantitiesResult {
  if (raw === null || raw === undefined || raw === "") return { ok: true, quantities: null };
  if (typeof raw !== "string") return { ok: false, message: BAD_QUANTITIES };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: BAD_QUANTITIES };
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_LINES) return { ok: false, message: BAD_QUANTITIES };
  const out: IssueQuantity[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!o) return { ok: false, message: BAD_QUANTITIES };
    const partId = typeof o.partId === "string" ? o.partId : "";
    const q = typeof o.quantity === "number" ? o.quantity : typeof o.quantity === "string" && o.quantity.trim() !== "" ? Number(o.quantity) : Number.NaN;
    if (!partId || seen.has(partId) || !Number.isInteger(q) || q < 0) return { ok: false, message: BAD_QUANTITIES };
    seen.add(partId);
    out.push({ partId, quantity: q });
  }
  return { ok: true, quantities: out };
}
