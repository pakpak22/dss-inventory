import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDelegations } from "@/db/schema/approval-delegations";
import { auditLogs } from "@/db/schema/audit-logs";
import { auditValues } from "@/lib/audit";
import { fetchAsUserDirectory } from "./as-users";
import { resolveDelegateFromDirectory, seoulEndDateText, validateDelegationInput } from "./delegation-input";

/**
 * ============================================================================
 * 결재권 위임 — 만들기와 되돌리기 (2026-10-21, 조각 3)
 * ============================================================================
 * 조각 1이 표와 순수 규칙을, 조각 2가 결재 판정 넷을 깔았다. **그런데 표에 줄을 넣을 길이
 * 없었다** — 그것을 만드는 자리가 여기다. 판정 쪽은 한 글자도 건드리지 않는다.
 *
 * ── 🔴 `delegator_sub` 는 **세션에서 나온다** ───────────────────────────
 * 화면이 보내는 값이 아니다. 화면 값을 믿으면 **남의 결재권을 넘기는 요청을 손으로 만들 수
 * 있고**, 그 요청은 오류 없이 통과한다. 그래서 들어오는 입력 타입(`DelegationFormInput`)에는
 * 그 칸이 **아예 없고**, 아래는 `actor.sub` 만 적는다. 🔵 `created_by_sub` 도 같은 값이다 —
 * 지금은 결재권자 본인만 위임을 만든다(2026-10-21 결정, 표 쪽 머리말).
 *
 * ── 🔴 되돌리기도 **본인 것만** ────────────────────────────────────────
 * 조건절에 `delegator_sub = 내 번호` 를 건다. 화면에서 단추를 안 그리는 것은 울타리가 아니다 —
 * 이 함수는 화면을 거치지 않고도 불린다(이 저장소가 `cancelPartIssueApproval` 에서 쓰는
 * 「판정을 WHERE 에 거는」 모양 그대로다).
 *
 * ── 🔴 지우지 않는다. 깃발을 세운다 ────────────────────────────────────
 * 되돌리기는 `revoked_at` 을 찍는 일이다. 지우면 **그 기간에 난 결재를 나중에 설명할 수 없다** —
 * 「이 건은 왜 본인이 아닌 사람이 눌렀나」의 답이 이 표에만 있다(표 쪽 머리말).
 *
 * ── 🔵 겹치는 기간을 **막지 않는다** ───────────────────────────────────
 * 같은 사람에게 기간이 겹치게 또 맡겨도 그냥 둔다. 판정이 이미 중복을 걸러 내기 때문이다 —
 * `delegatorSubsFor` 가 같은 번호를 **한 번만** 돌려주므로 결재 목록에 같은 건이 두 번 뜨지
 * 않는다. 여기서 막으면 「10일까지 맡겼다가 15일까지로 늘리는」 평범한 고쳐 적기가 막히고,
 * 그 사람은 먼저 되돌린 뒤 다시 맡겨야 한다 — 그 사이에 결재가 들어오면 아무도 못 누른다.
 *
 * ── 🔵 **두 겹을 만들 때 막지 않는다** ─────────────────────────────────
 * 「위임받은 사람은 또 위임할 수 없다」는 **판정에서 이미 해결됐다**(`delegatorSubsFor` 가 이어
 * 붙이지 않는다 — A→B 와 B→C 가 있어도 C 는 A 의 결재권을 못 얻는다). 만드는 쪽에서까지 막으면
 * **남의 대리인이 된 사람은 「자기 결재권」조차 맡길 수 없게 된다.** B 도 출장을 갈 수 있다.
 *
 * ── 🔴 A/S 명부는 **트랜잭션을 열기 전에** 받아 온다 ───────────────────
 * 다른 시스템에 대한 망 호출(최대 5초)이라, 트랜잭션 안에서 부르면 그동안 연결 하나(NAS 는
 * 풀이 다섯이다)를 붙들고 있게 된다. `./mutations.ts` 가 같은 까닭으로 같은 순서다.
 * ============================================================================
 */

/** 위임을 만들거나 되돌리는 사람. 🔴 **포털 번호(`sub`)가 반드시 있어야 한다** — 그것이 열쇠다. */
export type DelegationActor = { id: string; name: string; sub: string };

export type CreateDelegationResult =
  | { ok: true; id: string }
  | {
      ok: false;
      /**
       * 🔵 코드로 가르는 까닭은 `./part-issue.ts` 와 같다 — 문구는 다듬을 수 있지만 분기는
       *    글자에 기대면 안 된다. 지금 부르는 쪽(서버 액션)은 문구만 그대로 보여 준다.
       */
      code: "INVALID_INPUT" | "DIRECTORY_UNREACHABLE" | "UNKNOWN_DELEGATE" | "NO_SSO_SUBJECT" | "SELF_DELEGATION";
      message: string;
    };

/** 감사·오류 문구가 쓰는 대상 글자. `src/lib/audit-labels.ts` 의 `describeTarget` 과 짝이다. */
function auditTarget(delegationId: string): string {
  return `approval_delegations:${delegationId}`;
}

/**
 * 「내 결재권을 이 기간 동안 저 사람이 대신한다」 한 줄을 만든다.
 *
 * @param input 화면이 보낸 값. 🔴 **그대로 믿지 않는다** — 모양 검사는 순수 함수
 *   (`validateDelegationInput`)가, 「그 사람이 지금 명부에 있고 포털 번호가 있는가」는
 *   `resolveDelegateFromDirectory` 가 한다. 둘 다 시험이 붙는 자리다.
 * @param actor 지금 로그인한 사람. 🔴 **이 사람의 결재권만** 맡길 수 있다.
 */
export async function createApprovalDelegation(input: unknown, actor: DelegationActor): Promise<CreateDelegationResult> {
  // 1. 모양과 기간(순수). 🔴 종료일 → 「그 다음 날 0시」 환산이 여기서 끝난다.
  const validated = validateDelegationInput(input);
  if (!validated.ok) return { ok: false, code: "INVALID_INPUT", message: validated.message };

  // 2. 명부 — 트랜잭션 밖에서(머리말). 🔴 못 받아 왔으면 **빈 목록으로 둔갑시키지 않고** 거절한다.
  const directory = await fetchAsUserDirectory();
  const resolved = resolveDelegateFromDirectory(directory, validated.delegateUserId, actor.sub);
  if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message };

  return db().transaction(async (tx): Promise<CreateDelegationResult> => {
    const [row] = await tx
      .insert(approvalDelegations)
      .values({
        /**
         * 🔴 **여기가 이 파일의 울타리다.** 화면이 무엇을 보냈든 맡기는 사람은 세션의 번호다.
         *    🔵 이름도 세션의 것이다 — 이 시스템에 로그인한 그 사람의 이름이고, 「그때 누구였나」를
         *    남기려고 사본으로 적는다(표 쪽 머리말).
         */
        delegatorSub: actor.sub,
        delegatorName: actor.name,
        delegateSub: resolved.delegate.sub,
        delegateName: resolved.delegate.name,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
        reason: validated.reason,
        // 🔴 지금은 `delegator_sub` 와 언제나 같은 값이다. 그래도 칸을 따로 적는다(표 쪽 주석).
        createdBySub: actor.sub,
        createdByName: actor.name,
      })
      .returning({ id: approvalDelegations.id });

    // 감사 기록 — 본 작업과 **한 트랜잭션**(CLAUDE.md 11절).
    await tx.insert(auditLogs).values(
      auditValues({
        action: "APPROVAL_DELEGATION_CREATED",
        actorId: actor.id,
        actorName: actor.name,
        target: auditTarget(row.id),
        detail: {
          /**
           * 🔵 **포털 번호는 싣지 않는다** — 누구에게 맡겼나는 이름으로 충분하고, 신원 증명에
           *    쓰이는 값을 로그에 흘려 둘 까닭이 없다(`./mutations.ts` 와 같은 규약).
           * 🔵 사람이 적은 **날짜**도 함께 남긴다. `endsAt` 만 남기면 나중에 이력을 읽는 사람이
           *    「26일까지 맡겼네」로 읽는다 — 실제로 적은 것은 25일까지다.
           */
          delegateName: resolved.delegate.name,
          startDate: validated.startDate,
          endDate: validated.endDate,
          startsAt: validated.startsAt.toISOString(),
          endsAt: validated.endsAt.toISOString(),
          reason: validated.reason,
        },
      }),
    );

    return { ok: true, id: row.id };
  });
}

/**
 * 🔴 되돌릴 수 없을 때의 문구. **까닭 셋을 뭉쳐 적는다** — 어느 쪽인지 말해 주려면 남의 줄을
 * 읽어야 하고, 그러면 「그 번호의 위임이 있는가」를 아무나 물어볼 수 있게 된다.
 */
export const DELEGATION_REVOKE_REJECTED_MESSAGE =
  "되돌릴 수 없는 위임입니다. 이미 되돌렸거나 기간이 끝났거나, 본인이 맡긴 위임이 아닙니다.";

/**
 * 맡겨 둔 결재권을 거둔다.
 *
 * 🔴 **조건절이 울타리다**(머리말). `delegator_sub = 내 번호` · 아직 안 되돌렸음 · 아직 안 끝났음을
 * 함께 걸어 한 번에 집는다. 0행이면 아무것도 쓰지 않은 채 거절한다.
 * 🔵 끝난 줄을 되돌리지 않는 까닭: 되돌릴 것이 없고, 지난 기간의 위임은 「그때 왜 저 사람이
 *    눌렀나」의 근거라 손대면 그 설명이 바뀐다.
 */
export async function revokeApprovalDelegation(
  delegationId: string,
  actor: DelegationActor,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  return db().transaction(async (tx): Promise<{ ok: true } | { ok: false; message: string }> => {
    const [row] = await tx
      .update(approvalDelegations)
      .set({ revokedAt: now, revokedBySub: actor.sub, revokedByName: actor.name })
      .where(
        and(
          eq(approvalDelegations.id, delegationId),
          // 🔴 **본인 것만.** 이 한 줄이 「남의 결재권을 거두는」 요청을 막는다.
          eq(approvalDelegations.delegatorSub, actor.sub),
          isNull(approvalDelegations.revokedAt),
          gt(approvalDelegations.endsAt, now),
        ),
      )
      .returning({
        id: approvalDelegations.id,
        delegateName: approvalDelegations.delegateName,
        startsAt: approvalDelegations.startsAt,
        endsAt: approvalDelegations.endsAt,
      });
    // 🔵 0행이면 **아직 아무것도 안 썼다** — 그때만 `return` 해도 빈 트랜잭션이 커밋될 뿐이다.
    if (!row) return { ok: false, message: DELEGATION_REVOKE_REJECTED_MESSAGE };

    await tx.insert(auditLogs).values(
      auditValues({
        action: "APPROVAL_DELEGATION_REVOKED",
        actorId: actor.id,
        actorName: actor.name,
        target: auditTarget(row.id),
        detail: {
          delegateName: row.delegateName,
          // 🔵 **언제까지였던 것을 거뒀나**를 남긴다 — 사람이 적었던 종료일 그대로 되돌려 적는다.
          endDate: seoulEndDateText(row.endsAt),
          revokedAt: now.toISOString(),
        },
      }),
    );

    return { ok: true };
  });
}
