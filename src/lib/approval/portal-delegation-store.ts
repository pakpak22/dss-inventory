import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { portalApprovalDelegations } from "@/db/schema/portal-approval-delegations";
import { auditValues } from "@/lib/audit";
import { findActiveUserByAuthSub } from "@/lib/auth/users";
import { seoulDateText, seoulEndDateText } from "./delegation-input";
import { revokedAtOnConflict } from "./portal-delegation-sync";
import type { PortalDelegationPerson, PortalDelegationStore } from "./portal-delegation-sync";

/**
 * ============================================================================
 * 승인함에서 온 위임을 **실제로 적는 자리** — DB 와 감사 로그 (2026-11-16, 조각 6)
 * ============================================================================
 * 판단은 `./portal-delegation-sync.ts` 가 전부 쥐고 있다. 여기 있는 것은 「시키는 대로 쓰고
 * 썼는지 돌려주기」와 **이력 남기기** 둘뿐이다.
 *
 * ── 🔴 감사 로그를 **남긴다**. 사람이 한 일이 아닌데도 ──────────────────
 * 이 줄은 포털이 써 주는 것이라 「누가 눌렀나」가 이 시스템 안에 없다. 그래도 남기는 까닭 셋:
 *  1. **권한이 늘어나는 사건**이다. 이 줄 하나로 남의 결재를 대신 누를 수 있게 된다 —
 *     이 집 규칙이 「승인·생성·수정은 감사 로그에」(CLAUDE.md 11절)라고 못 박은 바로 그 종류다.
 *     같은 뜻의 제 표 위임(`approval_delegations`)도 만들 때·거둘 때 둘 다 남긴다.
 *  2. 🔴 **줄이 덮어써진다.** 멱등이라 같은 `id` 로 다시 오면 기간도 사유도 **갈아 끼워지고**,
 *     표에는 마지막 상태만 남는다. 「언제 어떤 기간으로 왔다가 어떻게 바뀌었나」가 남는 곳은
 *     append-only 인 감사 로그뿐이다(`synced_at` 은 **마지막** 시각 한 칸이다).
 *  3. 🔴 **이름이 표에 없다.** 세 시스템 공통 모양이라 이름 칸을 못 두는데, 포털 번호는 사람에게
 *     뜻이 없다. 「그때 누구였나」를 남길 자리가 여기밖에 없다.
 * 🔵 **안 남기기로 한 것**: `not_applicable`(저장하지 않은 전파). 이 시스템에서는 **아무 일도
 *    일어나지 않았고**, 남기면 재고관리와 상관없는 사내 위임이 전부 이력에 쌓인다. 「왜 안
 *    들었나」는 포털 쪽 전파 기록이 답할 일이다.
 * 🔵 포털이 **다시 보낸 것**(재시도)도 한 줄 더 남는다. 재시도와 「기간을 고쳐 다시 지정」을
 *    가를 길이 받는 쪽에는 없고, 뭉개면 **진짜 다시 지정한 것**이 사라진다 — 줄이 하나 더
 *    쌓이는 쪽을 고른다.
 *
 * ── 🔴 본 작업과 **한 트랜잭션**이다 ────────────────────────────────────
 * 로그인처럼 「실패해도 본 작업은 되게」 하는 자리가 아니다(`writeAudit` 이 그쪽이다). 위임이
 * 저장됐는데 이력이 없으면 나중에 그 결재를 설명할 수 없다 — 둘 다 되거나 둘 다 안 되거나다.
 * ============================================================================
 */

/** 감사·대상 글자. `src/lib/audit-labels.ts` 의 `describeTarget` 과 짝이다. */
function auditTarget(delegationId: string): string {
  return `portal_approval_delegations:${delegationId}`;
}

/**
 * 🔴 **이 시스템 안에 행위자가 없다.** `actorId` 는 비우고 이름 자리에 **포털이 한 일**임을
 * 적는다 — 로그인 거절 줄이 사람 없이 쌓이는 것과 같은 자리이고, 표도 그 둘을 null 로 받는다.
 * 🔵 「승인함」이라고 적는 것은 사람이 **실제로 누른 화면**이 그것이기 때문이다. 「포털」은
 *    로그인 창으로 읽혀서, 이력을 읽는 사람이 어디를 열어 봐야 할지 알 수 없다.
 */
const PORTAL_ACTOR_NAME = "통합 승인함";

export const portalDelegationStore: PortalDelegationStore = {
  async upsert({ command, delegator, delegate }): Promise<void> {
    await db().transaction(async (tx) => {
      await tx
        .insert(portalApprovalDelegations)
        .values({
          // 🔴 **포털이 정한 번호 그대로.** 이 값이 멱등의 전부다 — 아래 충돌 처리가 이 PK 를 문다.
          id: command.id,
          delegatorSub: command.delegatorSub,
          delegateSub: command.delegateSub,
          startsAt: command.startsAt,
          endsAt: command.endsAt,
          reason: command.reason,
          revokedAt: command.revokedAt,
          syncedAt: new Date(),
        })
        /**
         * 🔴 **같은 번호로 두 번 와도 한 줄이다.** 포털은 전파가 실패로 보이면 다시 보낼 수
         * 있고(끊긴 응답은 저쪽이 이미 저장했을 수도 있다), 줄이 둘이 되면 철회가 한 줄만
         * 맞힌다. 🔴 사람 칸까지 **전부** 덮는다 — 포털이 그 줄의 주인이라 「우리가 먼저 받은
         * 값」을 지킬 까닭이 없고, 한 칸만 안 덮으면 두 쪽이 다른 줄을 보게 된다.
         * 🔴 **`revoked_at` 하나만 예외다**(2026-11-16, 세 시스템의 규약을 맞췄다). 값이 실려
         *    왔으면 적고 **널이면 이미 적힌 값을 지우지 않는다** — 널까지 덮으면 철회와 엇갈려
         *    늦게 닿은 이 문장이 **거둔 위임을 되살리고**, 그 사람은 아무 오류 없이 남의 결재를
         *    누를 수 있게 된다. 까닭 전부와 「왜 여기만 조건부인가」는 `revokedAtOnConflict`
         *    머리말에 있다. 🔵 **위의 `values`(처음 받는 줄)는 그 규칙을 안 쓴다.**
         */
        .onConflictDoUpdate({
          target: portalApprovalDelegations.id,
          set: {
            delegatorSub: command.delegatorSub,
            delegateSub: command.delegateSub,
            startsAt: command.startsAt,
            endsAt: command.endsAt,
            reason: command.reason,
            syncedAt: new Date(),
            ...revokedAtOnConflict(command.revokedAt),
          },
        });

      await tx.insert(auditLogs).values(
        auditValues({
          action: "PORTAL_DELEGATION_SYNCED",
          actorId: null,
          actorName: PORTAL_ACTOR_NAME,
          target: auditTarget(command.id),
          detail: {
            /**
             * 🔵 **포털 번호는 싣지 않는다** — 누구인지는 이름으로 충분하고, 신원 증명에 쓰이는
             *    값을 로그에 흘려 둘 까닭이 없다(`./delegation-mutations.ts` 와 같은 규약).
             *    이름은 **이 시스템의 `users` 에서 지금 읽은 값**이다(정본은 포털).
             */
            delegatorName: delegator.name,
            delegateName: delegate.name,
            /**
             * 🔵 사람이 읽을 날짜와 기계가 읽을 시각을 **둘 다** 남긴다. 제 표 위임 쪽과 같은
             *    짝이고 같은 까닭이다(`ends_at` 만 그리면 하루 뒤 날짜로 읽힌다).
             * 🔴 **다만 이 줄의 끝은 한국 시각 0시가 아닐 수 있다** — 날짜를 환산해 보내는 것이
             *    포털이라, 여기 적는 `endDate` 는 「그 구간에 걸린 마지막 날」이다. 정확한 순간은
             *    `endsAt` 쪽을 본다.
             */
            startDate: seoulDateText(command.startsAt),
            endDate: seoulEndDateText(command.endsAt),
            startsAt: command.startsAt.toISOString(),
            endsAt: command.endsAt.toISOString(),
            reason: command.reason,
            /**
             * 🔴 **거둔 채로 들어온 줄**인가. 통로 규약상 평소에는 없지만, 실려 오면 그대로
             *    적으므로(`parsePortalDelegationCommand` 주석) 이력에도 그 사실이 보여야 한다 —
             *    없으면 「받았는데 왜 안 듣지」의 답이 표에만 있고 이력에는 없다.
             * 🔵 **「지금 그 줄이 거둬져 있나」가 아니다.** 이미 거둔 줄에 널로 온 전파는 여기서
             *    `false` 인데 표의 `revoked_at` 은 그대로 남는다(한 방향 규칙). 이 칸은 **무엇이
             *    들어왔나**만 말한다.
             */
            arrivedRevoked: command.revokedAt !== null,
          },
        }),
      );
    });
  },

  async revoke(id: string, revokedAt: Date): Promise<boolean> {
    return db().transaction(async (tx) => {
      const [row] = await tx
        .update(portalApprovalDelegations)
        /**
         * 🔴 **포털이 보낸 시각을 적는다**(받은 시각이 아니다). 같은 철회가 두 번 와도 값이
         * 같아야 멱등이다 — 표 쪽 칸 주석과 같은 까닭.
         * 🔵 **이미 거둔 줄에 또 와도 덮는다.** 포털이 그 줄의 주인이고, 「언제 거뒀나」의 정본은
         *    저쪽이다. 여기서 먼저 찍힌 값을 지키면 두 쪽이 다른 날짜를 말하게 된다.
         */
        .set({ revokedAt, syncedAt: new Date() })
        // 🔴 조건은 번호 하나다. **기간이 끝난 줄도 거둔다** — 제 표 위임(`revokeApprovalDelegation`)이
        //    「끝난 줄은 안 거둔다」인 것과 **일부러 다르다**: 저쪽은 사람이 화면에서 누르는 길이라
        //    되돌릴 것이 없는 줄을 막는 뜻이 있고, 이쪽은 **포털과 같은 상태로 맞추는** 일이다.
        .where(eq(portalApprovalDelegations.id, id))
        .returning({
          id: portalApprovalDelegations.id,
          startsAt: portalApprovalDelegations.startsAt,
          endsAt: portalApprovalDelegations.endsAt,
        });
      /**
       * 🔴 **없는 줄은 오류가 아니다.** 애초에 `not_applicable` 로 저장하지 않았던 줄일 수 있다
       * (두 사람 중 하나가 이 시스템에 없었다). 0행이면 아무것도 안 썼으므로 그대로 빠져나온다.
       */
      if (!row) return false;

      await tx.insert(auditLogs).values(
        auditValues({
          action: "PORTAL_DELEGATION_REVOKED",
          actorId: null,
          actorName: PORTAL_ACTOR_NAME,
          target: auditTarget(row.id),
          detail: {
            /**
             * 🔴 **이름이 없다.** 철회 몸통에는 사람 칸이 아예 없고(통로 규약), 표에도 이름
             *    칸이 없다. 번호로 되짚어 적을 수도 있지만 그러면 **거둘 때마다 사람 조회가
             *    둘** 붙는다 — 대신 **기간**을 남긴다. 같은 번호의 `PORTAL_DELEGATION_SYNCED`
             *    줄에 이름이 있으니 이력에서 짝이 맞춰진다.
             */
            startDate: seoulDateText(row.startsAt),
            endDate: seoulEndDateText(row.endsAt),
            revokedAt: revokedAt.toISOString(),
          },
        }),
      );
      return true;
    });
  },
};

/**
 * 포털 번호로 이 시스템의 **살아 있는** 사람을 되짚는다. 없으면 `null`.
 *
 * 🔴 알림·승인함 통로와 **같은 함수**를 부른다 — 한쪽만 느슨해지면 이 시스템에서 막힌 사람이
 * 포털에서는 통과한다. 🔵 이 집은 `users.auth_sub` 가 곧 포털 `sub` 라 바꿀 것이 없다.
 */
export async function findPortalDelegationPerson(sub: string): Promise<PortalDelegationPerson | null> {
  const user = await findActiveUserByAuthSub(sub);
  return user ? { id: user.id, name: user.name } : null;
}
