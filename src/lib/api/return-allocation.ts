import { MAX_LINES, type ReturnLine } from "@/lib/stock/form";
import { summarizeReturnCandidates, type ReturnableLine } from "./return-candidates";

/**
 * A/S 가 보낸 **부품 + 수량**을 **돌려줄 수 있는 원장 줄들**에 나눠 담는다 — 순수 함수
 * (2026-11-26, `POST /api/v1/stock-requests` 의 `type: "RETURN"`. 설명은 API.md 4-11절).
 *
 * ── 🔴 **왜 재고 관리가 쪼개나** ────────────────────────────────────────
 * A/S 는 **원장 줄 번호(`transactionId`)를 모른다.** 알 길이 없고, 알게 해서도 안 된다 — 저쪽이 우리
 * 내부 번호를 제 표에 보관하게 되는 모양을 두 시스템이 일부러 피해 왔다(2026-10-15 결정). 그런데 반환
 * 기록은 **「어느 불출 줄을 되돌리나」로** 적힌다(`lib/stock/form.ts` 의 `ReturnLine`) — 원장이 그 줄
 * 단위로 「넘치나」를 검사하기 때문이다(`ledger.ts` 의 `return_exceeds`). 그 사이를 메우는 것이 여기다.
 *
 * ── 🔴 **먼저 나간 줄부터 채운다** ─────────────────────────────────────
 * 읽어 온 줄이 **이미 그 차례로 서 있다**(`lib/stock/queries.ts` 의 `readReturnableTransactions` —
 * 부품번호 오름차순 · 거래 생성 순). 🔴 여기서 다시 정렬하지 않는다: 차례를 두 곳에서 정하면 한쪽만
 * 바뀌는 날 **어느 줄에 붙었는지가 조용히 달라진다**(그러면 같은 수량을 돌려줘도 어떤 불출 건이
 * 「다 돌아왔는지」가 뒤바뀐다). 🔵 먼저 나간 것부터 닫는 편이 사람의 셈과 같다 — 오래 열려 있던
 * 불출 줄이 먼저 정리된다.
 *
 * ── 🔴 **「남은 것」의 셈은 앞 조각과 같은 것 하나다** ──────────────────
 * `taken − returned − pending`(대기 중인 반환 신청까지 뺀 값)이고, 그 셈이 적힌 곳은
 * `./return-candidates.ts` 의 `summarizeReturnCandidates` **하나뿐이다.** 🔴 여기서 다시 세면,
 * A/S 화면이 「3개까지」라고 보여 준 그 수와 **여기서 받아 주는 수가 갈린다** — 보여 준 대로 보냈는데
 * 거절당하는(또는 그 반대의) 자리가 생기고, 둘 다 오류 없이 수량만 틀린다.
 *
 * 🔴 **마지막 울타리는 여기가 아니다.** 실제로 넘치는 반환을 막는 자리는 원장(`return_exceeds`)이고
 *    그것은 **잠그고 다시 세는** 검사다. 여기서 조금 **적게** 받아 주는 것은 안전하고, **많이**
 *    받아 주는 것이 위험하다 — 그래서 모르는 쪽은 전부 적게 센다.
 */

/** A/S 가 보낸 줄 하나 — 부품 No. 와 수량. 🔵 모양은 `./stock-requests.ts` 의 `ApiReturnLineInput` 과 같다. */
export interface RequestedReturnLine {
  no: number;
  quantity: number;
}

export type AllocateReturnLinesResult = { ok: true; lines: ReturnLine[] } | { ok: false; message: string };

/**
 * 한 원장 줄에 **더 받을 수 있는 수량**. 🔴 `remainingOf` 와 **같은 뺄셈**이지만 이쪽은 **줄 단위**다 —
 * 저쪽은 부품 단위라 줄에 그대로 쓸 수 없다(한 부품이 여러 줄로 나가 있다).
 *
 * 🔵 **0 아래로 안 내려간다.** 한 줄이 이미 넘치게 돌아와 있어도(사람이 화면에서 적은 반환과 대기 중인
 *    신청이 겹치면 그럴 수 있다) 그 줄이 **다른 줄의 몫을 깎지 않게** 한다.
 */
function roomOf(line: ReturnableLine, pending: ReadonlyMap<string, number>): number {
  return Math.max(0, line.taken - line.returned - (pending.get(line.transactionId) ?? 0));
}

/**
 * 부품별 요청을 원장 줄로 쪼갠다.
 *
 * @param requested A/S 가 보낸 부품별 수량. 🔵 같은 부품이 두 줄로 오는 일은 **그 앞에서** 막힌다
 *   (`parseApiStockRequest` 의 중복 검사).
 * @param candidates 그 인수번호로 나간 원장 줄 전부 (`returnableLinesByIntake`). **차례 그대로** 쓴다.
 * @param pending 대기 중인 반환 신청의 줄별 수량 (`pendingByTransaction`).
 *
 * 거절하는 것 셋 — 🔴 **무엇이 얼마나 남았는지를 말에 담는다.** A/S 화면이 그 말을 그대로 사람에게
 * 보여 주므로, 「안 됩니다」만 주면 사람은 수량을 몇 번 더 바꿔 보다 포기한다.
 */
export function allocateReturnLines(
  requested: readonly RequestedReturnLine[],
  candidates: readonly ReturnableLine[],
  pending: ReadonlyMap<string, number>,
): AllocateReturnLinesResult {
  /**
   * 🔴 **앞 조각의 셈을 그대로 부른다**(머리말). 돌려줄 것이 0 이하인 부품은 이 목록에서 **줄째 빠지므로**,
   *    아래 「모르는 번호」와 「남은 것이 없는 부품」이 **같은 자리에서** 걸린다 — 둘 다 「지금 그 부품은
   *    돌려줄 수 없다」라 사람이 할 일이 같다.
   */
  const remainingByNo = new Map(summarizeReturnCandidates(candidates, pending).map((c) => [c.no, c.remaining]));

  for (const line of requested) {
    const remaining = remainingByNo.get(line.no);
    if (remaining === undefined) {
      return {
        ok: false,
        message: `No. ${line.no} 는 이 수리 건에서 지금 돌려줄 수 있는 부품이 아닙니다. 나간 적이 없거나, 이미 다 돌아왔거나, 처리 중인 반환 신청에 들어 있습니다. GET /api/v1/return-candidates 로 다시 확인하십시오.`,
      };
    }
    if (line.quantity > remaining) {
      return {
        ok: false,
        message: `No. ${line.no} 는 ${remaining}개까지 돌려줄 수 있습니다 (요청 ${line.quantity}개). 이미 돌아온 수량과 처리 중인 반환 신청을 뺀 값입니다.`,
      };
    }
  }

  const lines: ReturnLine[] = [];
  for (const want of requested) {
    let left = want.quantity;
    for (const candidate of candidates) {
      if (left === 0) break;
      if (candidate.part.no !== want.no) continue;
      const take = Math.min(roomOf(candidate, pending), left);
      if (take === 0) continue;
      // 🔵 줄 비고는 빈 글자다 — A/S 는 줄마다 적을 자리를 주지 않는다(건 하나에 `note` 하나).
      lines.push({ transactionId: candidate.transactionId, quantity: take, note: "" });
      left -= take;
    }
    /**
     * 🔴 **닿지 않는 자리다. 그래도 조용히 적게 담지 않는다.**
     * 부품의 남은 수량은 줄별 남은 수량을 **더한 값**이고(음수 줄은 0 으로 깎여 더 커진다), 위에서
     * 그 값을 넘지 않는 것만 통과시켰으므로 줄을 다 돌면 언제나 0 이 된다. 그런데도 적어 두는 까닭:
     * 여기서 `left` 를 버리면 **요청한 수량보다 적은 신청이 서고**, A/S 에는 「접수됨」이 떠서
     * 아무도 모른다. 터지는 쪽이 낫다.
     */
    if (left > 0) {
      return { ok: false, message: `No. ${want.no} 를 ${want.quantity}개로 나눠 담지 못했습니다 (${left}개 남음). 잠시 뒤 다시 보내십시오.` };
    }
  }

  /**
   * 🔴 **줄 수 상한도 화면과 같은 값**(`MAX_LINES`). 한 부품이 여러 불출 줄로 나가 있으면 **요청 줄보다
   *    많은 반환 줄**이 생기므로, 여기가 상한을 넘을 수 있는 유일한 자리다.
   * 🔵 **거의 닿지 않는다**(한 수리 건의 한 부품이 쉰 번 넘게 따로 나갔어야 한다). 그래도 막는 까닭은
   *    화면으로 적은 반환이 받는 상한과 통로로 온 반환이 받는 상한이 **달라지지 않게** 하려는 것이다.
   */
  if (lines.length > MAX_LINES) {
    return { ok: false, message: `한 건에 ${MAX_LINES}줄까지입니다 (나눠 담으니 ${lines.length}줄이 됩니다). 부품이나 수량을 나누어 보내십시오.` };
  }
  return { ok: true, lines };
}
