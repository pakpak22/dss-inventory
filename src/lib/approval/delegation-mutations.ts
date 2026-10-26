import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDelegations } from "@/db/schema/approval-delegations";
import { auditLogs } from "@/db/schema/audit-logs";
import type { Role } from "@/db/schema/users";
import { auditValues } from "@/lib/audit";
import { fetchAsUserDirectory } from "./as-users";
import { mayManageOthersDelegations } from "./delegation-authority";
import {
  resolveDelegateFromDirectory,
  resolveDelegatorFromDirectory,
  seoulEndDateText,
  validateDelegationInput,
} from "./delegation-input";

/**
 * ============================================================================
 * 결재권 위임 — 만들기와 되돌리기 (2026-10-21, 조각 3 · 2026-10-26 에 넓힘)
 * ============================================================================
 * 조각 1이 표와 순수 규칙을, 조각 2가 결재 판정 넷을 깔았다. **그런데 표에 줄을 넣을 길이
 * 없었다** — 그것을 만드는 자리가 여기다. 판정 쪽은 한 글자도 건드리지 않는다.
 *
 * ── 🔴 **울타리가 이 파일 안에 있다**(2026-10-26) ───────────────────────
 * 2026-10-21 에는 「**본인만**」이었다. 맡기는 사람을 세션에서 꺼내 적었고, 입력 타입에는 그
 * 칸이 아예 없었다. **자리를 갑자기 비우게 된 사람(병가·사고)은 본인이 설정할 수 없다**는
 * 것이 바꾼 까닭이고, 그날 A/S 도 같은 방식으로 바뀌었다(사용자 결정). 지금 규칙은 한 줄이다:
 *
 *   🔴 **본인 것이면 누구나, 남의 것이면 `ADMIN`.**
 *
 * 🔴 **넓히기만 했다.** 지금까지 자기 결재권을 맡길 수 있던 사람은 역할과 무관하게 그대로
 * 맡길 수 있다 — 결재자는 역할과 무관하게 누구나 될 수 있어서(보기 권한자가 결재선에 든
 * 경우가 실제로 있다), 그 길이 막히면 이 기능이 풀려던 문제가 그대로 돌아온다.
 *
 * 🔴 **서버 액션은 지금도 `requireSession` 이다** — `requireRole` 로 바꾸지 마라. 역할로 문을
 * 막으면 보기 권한자가 **자기 위임조차** 못 만든다. 울타리는 문이 아니라 여기, 그리고 역할
 * 사다리(`roleAtLeast`)로 걸려 있다. 🔵 권한 영역(`hasPermission`) 체계를 쓰는 A/S 와 다른
 * 점이 이것이다 — 이 저장소에 그런 체계가 없고, 새로 만들지 않기로 했다.
 *
 * ── 🔴 `delegator_sub` 는 **화면 값이 그대로 들어가지 않는다** ───────────
 * 화면이 보내는 것은 **A/S 사용자 id** 이고, 포털 번호로 푸는 일도 자격을 묻는 일도 서버가
 * 명부를 보고 한다(`resolveDelegatorFromDirectory`). 번호를 받는 칸을 두면 **명부에 없는
 * 사람의 결재권까지** 넘기는 요청을 손으로 만들 수 있고, 그 줄은 나중에 아무도 설명하지 못한다.
 * 🔴 `created_by_sub` 는 **누른 사람**이다 — 「본인이 맡겼나, 관리자가 세웠나」가 그 칸으로만
 * 갈린다(표 쪽 머리말).
 *
 * ── 🔴 되돌리기도 **같게** 넓혔다 ──────────────────────────────────────
 * 본인 것이거나 `ADMIN` 이면 거둘 수 있고, 그 판정은 **조건절**에 있다. 화면에서 단추를 안
 * 그리는 것은 울타리가 아니다 — 이 함수는 화면을 거치지 않고도 불린다(이 저장소가
 * `cancelPartIssueApproval` 에서 쓰는 「판정을 WHERE 에 거는」 모양 그대로다).
 * 🔵 **0행이면 거절**하는 모양은 그대로다.
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

/**
 * 위임을 만들거나 되돌리는 사람. 🔴 **포털 번호(`sub`)가 반드시 있어야 한다** — 그것이 열쇠다.
 *
 * 🔴 **역할도 함께 받는다**(2026-10-26). 「남의 것까지 되는가」를 가르는 값이고, 세션에서 온
 * 값이어야 한다 — 화면이 보낸 값을 여기 실으면 울타리가 통째로 없어진다.
 */
export type DelegationActor = { id: string; name: string; sub: string; role: Role };

export type CreateDelegationResult =
  | {
      ok: true;
      id: string;
      /**
       * 🔴 **남의 결재권을 세운 것인가.** 돌아간 화면이 할 말이 갈린다 — 「내 차례를 그분이
       * 대신 누른다」는 관리자가 남의 것을 세웠을 때 **거짓말**이다(`delegationNotice`).
       * 🔵 「본인이었나」를 아는 것은 여기뿐이다: 화면은 자기 A/S 번호를 모르고, 주소 꼬리표에는
       *    번호를 실을 수 없다.
       */
      onBehalf: boolean;
    }
  | {
      ok: false;
      /**
       * 🔵 코드로 가르는 까닭은 `./part-issue.ts` 와 같다 — 문구는 다듬을 수 있지만 분기는
       *    글자에 기대면 안 된다. 지금 부르는 쪽(서버 액션)은 문구만 그대로 보여 준다.
       */
      code:
        | "INVALID_INPUT"
        | "DIRECTORY_UNREACHABLE"
        | "UNKNOWN_DELEGATE"
        | "NO_SSO_SUBJECT"
        | "SELF_DELEGATION"
        /** 🔴 「누구의 결재권인가」 쪽에서만 나온다 — 명부에 없는 결재권자, 그리고 자격 없음. */
        | "UNKNOWN_DELEGATOR"
        | "FORBIDDEN";
      message: string;
    };

/** 감사·오류 문구가 쓰는 대상 글자. `src/lib/audit-labels.ts` 의 `describeTarget` 과 짝이다. */
function auditTarget(delegationId: string): string {
  return `approval_delegations:${delegationId}`;
}

/**
 * 「**이 사람의** 결재권을 이 기간 동안 저 사람이 대신한다」 한 줄을 만든다.
 *
 * @param input 화면이 보낸 값. 🔴 **그대로 믿지 않는다** — 모양 검사는 순수 함수
 *   (`validateDelegationInput`)가, 「그 사람이 지금 명부에 있고 포털 번호가 있는가」는
 *   `resolveDelegatorFromDirectory` · `resolveDelegateFromDirectory` 가 한다. 셋 다 시험이
 *   붙는 자리다.
 * @param actor 지금 로그인한 사람. 🔴 **본인 결재권은 역할과 무관하게**, 남의 결재권은
 *   `ADMIN` 이라야 맡길 수 있다(머리말). 🔵 누른 사람은 `created_by_sub` 에 그대로 남는다.
 */
export async function createApprovalDelegation(input: unknown, actor: DelegationActor): Promise<CreateDelegationResult> {
  // 1. 모양과 기간(순수). 🔴 종료일 → 「그 다음 날 0시」 환산이 여기서 끝난다.
  const validated = validateDelegationInput(input);
  if (!validated.ok) return { ok: false, code: "INVALID_INPUT", message: validated.message };

  // 2. 명부 — 트랜잭션 밖에서(머리말). 🔴 못 받아 왔으면 **빈 목록으로 둔갑시키지 않고** 거절한다.
  const directory = await fetchAsUserDirectory();

  /**
   * 3. 🔴 **여기가 이 파일의 울타리다** — 「누구의 결재권인가」를 풀면서 자격까지 가른다.
   *    비워 보냈으면 본인이고, 남의 것이면 `ADMIN` 이라야 통과한다. 🔴 역할 사다리를 쓰는
   *    자리는 이 한 줄이고, 되돌리기·모두의 목록도 **같은 함수**에 묻는다.
   */
  const delegator = resolveDelegatorFromDirectory(directory, validated.delegatorUserId, actor, mayManageOthersDelegations(actor.role));
  if (!delegator.ok) return { ok: false, code: delegator.code, message: delegator.message };

  /**
   * 4. 대신할 사람. 🔴 「자기 자신에게 맡기는 줄」 판정의 기준이 **결재권자**다 — 누르는
   *    사람이 아니다. 그래서 관리자가 **자기를 대리인으로** 세우는 것(A → 관리자)은 여기를
   *    그냥 지나간다. 막지 않기로 했다(2026-10-26 사용자 결정) — 누가 세웠는지는
   *    `created_by_sub` 에 줄마다 남아 나중에 전부 추려 볼 수 있고, 그것이 막는 자리 대신
   *    두기로 한 기록이다. 표의 `approval_delegations_not_self` CHECK 도 같은 잣대다.
   */
  const resolved = resolveDelegateFromDirectory(directory, validated.delegateUserId, delegator.delegator.sub);
  if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message };

  return db().transaction(async (tx): Promise<CreateDelegationResult> => {
    const [row] = await tx
      .insert(approvalDelegations)
      .values({
        /**
         * 🔴 화면이 보낸 **A/S id** 가 아니라 **풀고 자격까지 확인된 포털 번호**다(3번).
         *    🔵 본인 위임이면 세션의 이름과 번호가 그대로 들어온다 — 이 시스템에 로그인한
         *    그 사람의 이름이고, 「그때 누구였나」를 남기려고 사본으로 적는다(표 쪽 머리말).
         */
        delegatorSub: delegator.delegator.sub,
        delegatorName: delegator.delegator.name,
        delegateSub: resolved.delegate.sub,
        delegateName: resolved.delegate.name,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
        reason: validated.reason,
        /**
         * 🔴 **누른 사람**이다. 2026-10-26 부터 `delegator_sub` 와 **갈릴 수 있고**, 「본인이
         * 맡겼나, 관리자가 세웠나」는 그 둘을 맞대야만 나온다(표 쪽 주석). 여기에 결재권자를
         * 적으면 관리자가 세운 줄이 본인이 맡긴 줄과 **구별되지 않는다.**
         */
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
          /**
           * 🔴 **누구의 결재권이었나**와 **본인이 맡긴 것인가**를 함께 남긴다(2026-10-26).
           *    이력은 제3자가 「이 건은 왜 본인이 아닌 사람이 눌렀나」를 되짚는 자리인데, 그
           *    되짚기가 한 겹 깊어졌다 — 「그 위임을 누가 세웠나」까지 봐야 한다. 둘 중 하나만
           *    남기면 그 물음에 **영영 답이 없다**(감사 로그는 고쳐 넣지 않는다).
           */
          delegatorName: delegator.delegator.name,
          onBehalf: !delegator.delegator.isSelf,
          startDate: validated.startDate,
          endDate: validated.endDate,
          startsAt: validated.startsAt.toISOString(),
          endsAt: validated.endsAt.toISOString(),
          reason: validated.reason,
        },
      }),
    );

    return { ok: true, id: row.id, onBehalf: !delegator.delegator.isSelf };
  });
}

/**
 * 🔴 되돌릴 수 없을 때의 문구. **까닭 셋을 뭉쳐 적는다** — 어느 쪽인지 말해 주려면 남의 줄을
 * 읽어야 하고, 그러면 「그 번호의 위임이 있는가」를 아무나 물어볼 수 있게 된다.
 *
 * 🔵 셋째 까닭에 괄호를 붙였다(2026-10-26). 관리자에게는 「본인이 맡긴 위임이 아닙니다」가
 *    더 이상 거절 사유가 아니라, 그 말만 두면 **고칠 길을 모르는 사람**이 생긴다.
 */
export const DELEGATION_REVOKE_REJECTED_MESSAGE =
  "되돌릴 수 없는 위임입니다. 이미 되돌렸거나 기간이 끝났거나, 본인이 맡긴 위임이 아닙니다(남의 위임은 관리자만 되돌립니다).";

/**
 * 🔵 `onBehalf` 는 만들기 쪽과 **같은 뜻**이다 — 돌아간 화면이 할 말이 갈린다(「내 차례」가
 * 관리자에게는 거짓말이다). 🔴 「본인 것이었나」를 아는 것은 거둔 **그 줄**뿐이라 여기서 센다.
 */
export type RevokeDelegationResult = { ok: true; onBehalf: boolean } | { ok: false; message: string };

/**
 * 맡겨 둔 결재권을 거둔다.
 *
 * 🔴 **조건절이 울타리다**(머리말). 아직 안 되돌렸음 · 아직 안 끝났음에, **관리자가 아니면**
 * `delegator_sub = 내 번호` 를 함께 걸어 한 번에 집는다. 0행이면 아무것도 쓰지 않은 채 거절한다.
 * 🔵 끝난 줄을 되돌리지 않는 까닭: 되돌릴 것이 없고, 지난 기간의 위임은 「그때 왜 저 사람이
 *    눌렀나」의 근거라 손대면 그 설명이 바뀐다.
 *
 * 🔴 **대리인은 제가 맡은 위임을 거둘 수 없다**(넓힌 뒤에도 그대로다 — 관리자인 대리인은 제
 * 역할로 거두는 것이지 「맡았기 때문」이 아니다). 맡은 사람이 스스로 자격을 버리는 길을 두면
 * 맡긴 사람이 모르는 사이에 그 차례가 다시 선다.
 */
export async function revokeApprovalDelegation(
  delegationId: string,
  actor: DelegationActor,
  now: Date = new Date(),
): Promise<RevokeDelegationResult> {
  /**
   * 🔴 변수에 담기는 것은 「권한이 있나」가 아니라 「**남의 것까지** 거둘 수 있나」다 — 아래
   *    조건절이 그 뜻 그대로 쓰인다. 🔵 본인 것은 이 값과 무관하게 언제나 거둘 수 있다.
   */
  const mayRevokeOthers = mayManageOthersDelegations(actor.role);

  return db().transaction(async (tx): Promise<RevokeDelegationResult> => {
    const [row] = await tx
      .update(approvalDelegations)
      .set({ revokedAt: now, revokedBySub: actor.sub, revokedByName: actor.name })
      .where(
        and(
          eq(approvalDelegations.id, delegationId),
          /**
           * 🔴 **인가 조건.** 남의 것까지 거둘 수 있는 사람에게는 조건을 더하지 않고, 아니면
           *    **자기 결재권의 줄만** 집을 수 있다. 이 한 줄이 「남의 결재권을 거두는」 요청을
           *    막는다. 🔴 `undefined` 는 drizzle 의 `and()` 가 **그냥 빼 준다** — 조건이 참으로
           *    바뀌는 것이 아니라 아예 안 붙는다(참으로 바꿔 적지 마라, 뜻이 같아 보여도 다음
           *    사람이 `eq(..., true)` 같은 것을 끼워 넣는다).
           */
          mayRevokeOthers ? undefined : eq(approvalDelegations.delegatorSub, actor.sub),
          isNull(approvalDelegations.revokedAt),
          gt(approvalDelegations.endsAt, now),
        ),
      )
      .returning({
        id: approvalDelegations.id,
        // 🔴 **누구의 결재권이었나**도 받아 온다 — 관리자가 남의 위임을 거둘 수 있게 되면서
        //    이력에 그 이름이 없으면 「누구 자리였나」가 안 남는다(아래 감사 기록).
        delegatorSub: approvalDelegations.delegatorSub,
        delegatorName: approvalDelegations.delegatorName,
        delegateName: approvalDelegations.delegateName,
        startsAt: approvalDelegations.startsAt,
        endsAt: approvalDelegations.endsAt,
      });
    // 🔵 0행이면 **아직 아무것도 안 썼다** — 그때만 `return` 해도 빈 트랜잭션이 커밋될 뿐이다.
    if (!row) return { ok: false, message: DELEGATION_REVOKE_REJECTED_MESSAGE };

    /**
     * 🔴 **거둔 줄의 결재권자로 센다** — 역할로 세지 않는다. 관리자가 **자기 위임**을 거두는
     *    일은 흔하고, 그때 「그 분의 위임을 되돌렸습니다」라고 하면 틀린 말이 된다.
     */
    const onBehalf = row.delegatorSub !== actor.sub;

    await tx.insert(auditLogs).values(
      auditValues({
        action: "APPROVAL_DELEGATION_REVOKED",
        actorId: actor.id,
        actorName: actor.name,
        target: auditTarget(row.id),
        detail: {
          delegateName: row.delegateName,
          /**
           * 🔴 **누구의 결재권이었나**와 **본인 것을 거둔 것인가**(2026-10-26). 만들기 쪽과
           *    같은 짝이고 같은 까닭이다 — 관리자가 남의 위임을 거둔 줄이 본인이 거둔 줄과
           *    구별되지 않으면, 나중에 「왜 저 위임이 사라졌나」에 답할 자리가 없다.
           */
          delegatorName: row.delegatorName,
          onBehalf,
          // 🔵 **언제까지였던 것을 거뒀나**를 남긴다 — 사람이 적었던 종료일 그대로 되돌려 적는다.
          endDate: seoulEndDateText(row.endsAt),
          revokedAt: now.toISOString(),
        },
      }),
    );

    return { ok: true, onBehalf };
  });
}
