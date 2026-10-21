/**
 * ============================================================================
 * 결재권 위임 — 순수 규칙
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. **받은 값을 보고 답만 한다** — `server-only` 를 물지
 * 않는 까닭이 그것이고(`./route.ts` 와 같은 자리), 그래서 화면 묶음이 끌어와도 빌드가 깨지지
 * 않는다.
 *
 * 결재권자가 출장·휴가로 자리를 비우면 그 건이 **선다.** 「A 의 결재권을 이 기간 동안 B 가
 * 대신한다」를 별도 표(`src/db/schema/approval-delegations.ts`)에 적어 두고, 여기서 「지금 이
 * 사람이 저 사람의 대리인인가」를 가린다.
 *
 * ── 🔴 승인 절차 안의 사람은 바뀌지 않는다 ──────────────────────────────
 * 위임은 `approval_routes` · `approval_route_steps` 를 **한 글자도 건드리지 않는다.** 결재선을
 * 고쳐 대리인을 끼워 넣는 길도 있었지만 그러면 「원래 누가 결재하게 돼 있었나」가 사라지고,
 * 휴가가 끝났을 때 되돌릴 근거도 없어진다. 결재선은 그대로 두고 **누를 수 있는 사람만 늘린다.**
 *
 * ── 🔴 열쇠는 포털 번호(`sub`)다 ────────────────────────────────────────
 * 이 시스템의 `users.id`(uuid) 도, A/S 번호(`approver_user_id`) 도 아니다. 그 둘을 섞어
 * 2026-10-15 에 실제 장애가 났다 — 「내가 결재할 건」이 영원히 빈 목록이 되는, 코드는 맞고 값만
 * 안 맞는 결함이라 눈으로도 시험으로도 잘 안 잡힌다(까닭은 `./directory.ts` 머리말).
 * 그래서 이 파일의 매개변수 이름은 전부 `…Sub` 다. **장식이 아니다.**
 *
 * 🔵 실제 결재 판정·목록·알림 종이 이 함수들을 부른다(2026-10-21, 조각 2). 표를 읽어 오는 일은
 * `./delegation-queries.ts` 가 하고, 「누를 수 있나」를 네 곳이 한 벌로 보는 자리가 아래
 * `actingApproverSubs` 다.
 * ============================================================================
 */

/**
 * 이 층이 위임 한 줄에서 보는 것. 표를 읽는 층의 타입이 이 모양을 이미 만족하므로 그쪽
 * 값을 그대로 넘기면 된다.
 *
 * 🔴 **도메인 층은 db 층을 가져오지 않는다.** 같은 모양을 여기 한 벌 적어 두는 것이 이
 * 저장소의 관례다(`./route.ts` 의 `RouteStepAssignment` 와 같은 자리).
 *
 * 🔵 이름 칸(`delegator_name` · `delegate_name`)은 여기 없다 — **판정에 쓰이지 않기** 때문이다.
 * 이름은 사람에게 보여 주려고 표에 적어 두는 사본이고, 그 까닭은 표 쪽 주석에 있다.
 */
export type ApprovalDelegationPeriod = {
  /** 결재권자 — 자리를 비우는 사람의 **포털 번호**. */
  delegatorSub: string;
  /** 대신할 사람의 **포털 번호**. */
  delegateSub: string;
  startsAt: Date;
  endsAt: Date;
  /** 되돌렸으면 그 시각. 아직 살아 있으면 `null`. 🔴 줄을 지우는 길은 없다(표 쪽 주석). */
  revokedAt: Date | null;
};

/**
 * 이 위임이 **지금 살아 있는가** — 되돌리지 않았고, 지금이 그 기간 안인가.
 *
 * ── 🔴 끝은 포함하지 않는다 (반열린 구간 `[starts_at, ends_at)`) ─────────
 * `starts_at <= now < ends_at` 이다. 끝을 포함하면 **한 위임이 끝나는 바로 그 순간에 다음
 * 위임이 시작할 때 둘 다 유효한 순간**이 생긴다. 그 1마이크로초에 결재가 들어오면 「누구의
 * 권한으로 눌렀나」가 둘이 되고, 나중에 그 건을 설명할 수 없다. 기간을 잇대어 적는 것은
 * 사람이 실제로 하는 일이라(출장이 끝나는 날 다른 사람에게 다시 맡긴다) 드문 경우도 아니다.
 *
 * 🔵 그래서 「9월 30일까지」를 적을 때 끝은 **10월 1일 0시**다. 화면이 그 환산을 맡는 것은
 * 다음 조각의 일이고, 이 층은 받은 시각을 그대로 믿는다.
 *
 * 🔴 **되돌린 줄은 기간 안이어도 거짓이다.** 되돌리기가 기간을 줄여 적는 것이 아니라 깃발을
 * 하나 세우는 것이라서, 기간만 보면 되돌린 뒤에도 계속 참이 된다.
 */
export function isActiveDelegation(delegation: ApprovalDelegationPeriod, now: Date): boolean {
  if (delegation.revokedAt !== null) return false;
  const at = now.getTime();
  return delegation.startsAt.getTime() <= at && at < delegation.endsAt.getTime();
}

/**
 * 이 사람이 **지금 누구의 결재권을 쓸 수 있나** — 쓸 수 있는 결재권자들의 포털 번호.
 *
 * @param delegations 볼 위임 줄들. 순서가 뒤섞여 있어도 되고, 이 사람과 상관없는 줄이 섞여
 *   있어도 된다(걸러 내는 일을 부르는 쪽에 떠넘기지 않는다).
 * @param delegateSub 「지금 누르려는 사람」의 **포털 번호**. 🔴 여기에 `users.id` 나 A/S 번호를
 *   넘기면 이 함수는 **언제나 빈 배열**을 돌려준다 — 막힌 것처럼 보이지만 오류는 나지 않는다.
 * @param now 지금 시각.
 *
 * ── 🔴 이어 붙이지 않는다. 위임은 **한 겹**이다 ─────────────────────────
 * A→B 와 B→C 가 둘 다 살아 있어도 **C 는 A 의 결재권을 얻지 못한다.** 이 함수는 받은 목록을
 * 한 번 훑을 뿐, 자기가 돌려준 번호를 다시 `delegateSub` 로 넣어 되풀이하지 않는다.
 *
 * 까닭이 둘이다:
 *  1. **A 는 C 를 모른다.** A 가 맡긴 사람은 B 뿐인데, B 가 또 맡기는 순간 A 의 결재권이 A 가
 *     동의한 적 없는 사람에게 넘어간다. 결재는 「누가 승인했나」가 곧 근거라, 그 근거가 무너진다.
 *  2. **고리가 생긴다.** A→B, B→A 가 함께 있으면 이어 붙이기는 끝나지 않는다. 깊이 제한을 두는
 *     길도 있지만, 그 숫자에 뜻을 붙일 방법이 없다(왜 2단계는 되고 3단계는 안 되는가).
 *
 * 🔵 **한 사람이 둘 이상에게서 위임받는 것은 막지 않는다** — 두 사람이 동시에 출장 갈 수 있다.
 * 그때는 결재권자 번호가 여럿 돌아오고, 그 사람은 그 여럿의 차례를 모두 누를 수 있다.
 *
 * 🔵 같은 결재권자가 여러 줄로 겹쳐 있어도 번호는 **한 번만** 돌려준다. 부르는 쪽이 이 값을
 * 「누구의 차례를 볼까」의 조건으로 쓰므로, 겹친 채 넘기면 같은 건이 목록에 두 번 뜬다.
 * 차례는 **목록에서 처음 나온 순서**다 — 값이 달라지지 않게 정해 둘 뿐, 뜻은 없다.
 */
export function delegatorSubsFor(
  delegations: readonly ApprovalDelegationPeriod[],
  delegateSub: string,
  now: Date,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const delegation of delegations) {
    if (delegation.delegateSub !== delegateSub) continue;
    if (!isActiveDelegation(delegation, now)) continue;
    if (seen.has(delegation.delegatorSub)) continue;
    seen.add(delegation.delegatorSub);
    out.push(delegation.delegatorSub);
  }
  return out;
}

/**
 * 「지금 이 사람의 자격으로 누를 수 있는 결재자 번호」 전부.
 *
 * 🔴 **빈 적이 없다** — 맨 앞은 언제나 본인이다. 그래서 타입이 **빈 목록을 허락하지 않는
 * 꼴**(`[string, ...string[]]`)이다. 빈 목록이 나올 수 있으면 아래 DB 쪽에서 `inArray(…, [])`
 * 가 되고, drizzle 은 그것을 `false` 로 굽는다 — **아무도 아무것도 못 누르는데 오류는 나지
 * 않는** 자리가 된다(`plan.steps` 를 같은 꼴로 둔 까닭과 같다).
 */
export type ActingApproverSubs = readonly [string, ...string[]];

/**
 * 🔴 **「누를 수 있나」가 두 벌로 적히는 것을 막는 자리다.**
 *
 * 이 판정이 필요한 곳은 넷이다 — 집행(`decidePartIssueApproval` 의 조건절) · 목록
 * (`listPartIssueApprovalsToDecide`) · 알림 종(`summarizePartIssueApprovalsToDecide`) · 순수
 * 판정(`mayDecidePartIssueStep`). 앞 셋은 SQL 이고 넷째는 TS 라 **같은 코드를 쓸 수 없다.**
 * 그래서 둘이 보는 **번호 목록을 이 함수 하나가 만든다**: DB 쪽은 이 목록을 `inArray` 에 그대로
 * 넣고, 순수 쪽은 「이 목록에 들어 있나」를 본다.
 *
 * 규칙을 두 벌 적으면 「종에는 뜨는데 눌리지 않는」(또는 그 반대의) 짝이 생기고, 그 어긋남은
 * 오류가 아니라 **사람이 포기할 때까지 조용하다.** 2026-10-21 전까지 실제로 두 벌이었다 —
 * 운영은 조건절 쪽을 쓰고 `mayDecidePartIssueStep` 은 시험만 불렀다.
 *
 * ── 🔴 위임은 **넘기는 것이 아니라 늘리는 것**이다 ──────────────────────
 * 본인 번호가 언제나 맨 앞에 남는다. 자리를 비우며 맡겨 둔 사람이 중간에 들어와 직접 눌러도
 * 막히지 않는다 — 막으면 「맡겼더니 내가 못 누른다」가 되고, 그것은 아무도 바란 적 없는 일이다.
 *
 * ── 🔴 늘어나는 것은 **대리인 자격뿐**이다 ──────────────────────────────
 * 이 목록에 들어오는 번호는 **지금 살아 있는 위임의 결재권자**뿐이다(`delegatorSubsFor`).
 * 관리자라고 남의 번호가 여기 들어오지 않고, 그래서 「관리자라고 남의 단계를 대신 누를 수
 * 없다」는 울타리가 그대로 선다. 두 겹(A→B·B→C)이 안 이어지는 것도 그 함수가 지킨다.
 *
 * 🔵 차례에는 뜻이 없다 — 본인이 맨 앞인 것만 정해 두고(값이 달라지지 않게), 나머지는
 *    `delegatorSubsFor` 가 준 차례 그대로다.
 *
 * @param actorSub 「지금 누르려는 사람」의 **포털 번호**. 🔴 `users.id` 나 A/S 번호를 넘기면
 *   위임은 하나도 안 붙고 **그 틀린 값 하나짜리 목록**이 돌아간다 — 오류 없이 영원히 0건이 된다
 *   (`delegatorSubsFor` 의 같은 주의).
 */
export function actingApproverSubs(
  delegations: readonly ApprovalDelegationPeriod[],
  actorSub: string,
  now: Date,
): ActingApproverSubs {
  return [actorSub, ...delegatorSubsFor(delegations, actorSub, now)];
}

/* ------------------------------------------------------------------ */
/* 「그 단계를 실제로 누른 사람은 누구인가」 (2026-10-22, 결재권 위임 마지막 조각) */
/* ------------------------------------------------------------------ */

/**
 * 단계 한 줄에서 **이 판정이 보는 것만** 추린 모양. 표
 * (`src/db/schema/stock-issue-approvals.ts` 의 `stock_issue_approval_steps`)의 칸 이름과 같다.
 *
 * 🔴 **도메인 층은 db 층을 가져오지 않는다** — 위 `ApprovalDelegationPeriod` 와 같은 관례다.
 */
export type ApprovalStepDecision = {
  /**
   * 🔴 그 단계에 **적힌** 결재자의 포털 번호 — 「누구 자리인가」다. 대리인이 눌러도 이 칸은
   * 바뀌지 않는다(`decidePartIssueApproval` 이 건드리지 않는다).
   */
  approverSub: string;
  /**
   * 결정된 시각. 아직 열려 있는(`REQUESTED`) 줄이면 `null`.
   *
   * 🔴 **「결재됐나」를 이 칸으로 읽는다.** 표의 `…_decision_metadata` CHECK 가 「결정됐으면
   * 시각이 있고, 안 됐으면 없다」를 지키므로 이 한 칸이면 갈린다. 상태를 따로 받으면 두
   * 칸이 어긋난 줄을 상상해야 하는데, 그런 줄은 DB 가 만들지 못한다.
   */
  decidedAt: Date | null;
  /** 🔴 **실제로 누른 사람**의 포털 번호. 아래 세 갈래를 보라. */
  decidedBySub: string | null;
  /** 그때 적어 둔 이름의 사본. */
  decidedByName: string | null;
};

/**
 * 한 단계를 **누가 눌렀는가**의 네 갈래.
 *
 * 🔵 이름 말고는 아무것도 담지 않는다 — **포털 번호가 화면까지 내려가지 않게** 하려는 것이고
 * (`./part-issue-screen.ts` 머리말), 그래서 이 값은 그대로 화면으로 실어 보낼 수 있다.
 */
export type ApprovalStepActor =
  /** 아직 결재되지 않은 자리 — 지금 차례이거나, 차례가 안 왔거나, 건너뛴 자리다. */
  | { kind: "UNDECIDED" }
  /** 적힌 사람이 **본인** 손으로 눌렀다. */
  | { kind: "SELF" }
  /**
   * 🔴 **누가 눌렀는지 어디에도 안 적힌 옛 줄**이다. 「본인이 눌렀다」가 **아니다** —
   * `decided_by_*` 칸이 생기기(2026-10-21) 전에 결재된 줄이라 적힐 자리가 없었다.
   */
  | { kind: "UNRECORDED" }
  /**
   * **대리인**이 대신 눌렀다. 🔵 `delegateName` 이 `null` 인 줄은 번호만 있고 이름이 안 적힌
   * 줄이다 — 쓰는 코드는 둘을 언제나 함께 적지만(위 집행 자리), 표가 둘 다 널 허용이라
   * 「대리인인데 이름을 모른다」를 지어내지 않고 그대로 들고 간다.
   */
  | { kind: "DELEGATED"; delegateName: string | null };

/**
 * 🔴 **세 갈래(+ 아직 안 누른 자리)를 가르는 유일한 자리다.** 화면마다 다시 적으면 한 화면에서만
 * 대리가 보이거나, 더 나쁘게는 **옛 줄이 「본인」으로 둔갑**한다.
 *
 * @param step 단계 한 줄. 🔴 **그 자리에 줄 자체가 없으면 `null`** 을 넘긴다 — 결재선 그림은
 *   아직 열리지 않은 단계·건너뛴 단계의 상자도 그리는데, 그 자리에는 단계 줄이 아예 없다
 *   (단계는 차례가 올 때 한 줄씩 생긴다 — 표 머리말의 「미리 전부 넣어 두지 않는다」).
 *
 * ── 🔴 `NULL` 을 「본인」으로 읽지 마라 ──────────────────────────────────
 * 표 쪽 주석(`decided_by_sub`)이 적어 둔 세 갈래 그대로다. 둘을 같은 것으로 읽으면 **과거를
 * 지어내게 된다** — 그 줄에는 누가 눌렀는지가 어디에도 없다.
 *
 * 🔵 **갈래 넷을 전부 돌려준다.** 「대리인인가 아닌가」의 boolean 으로 줄이면 `UNRECORDED` 와
 *    `SELF` 가 한 값으로 뭉개져, 뒷날 「대리로 결재된 건을 전부 보여 달라」에 답할 수 없다.
 */
export function approvalStepActor(step: ApprovalStepDecision | null): ApprovalStepActor {
  if (step === null || step.decidedAt === null) return { kind: "UNDECIDED" };
  if (step.decidedBySub === null) return { kind: "UNRECORDED" };
  if (step.decidedBySub === step.approverSub) return { kind: "SELF" };
  return { kind: "DELEGATED", delegateName: step.decidedByName };
}
