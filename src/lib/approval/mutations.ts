import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalRouteSteps, approvalRoutes } from "@/db/schema/approval-routes";
import { auditLogs } from "@/db/schema/audit-logs";
import { auditValues } from "@/lib/audit";
import { fetchAsUserDirectory } from "./as-users";
import { resolveApproversFromDirectory, type AsUserDirectory } from "./directory";
import { shouldCreateNewVersion, validateApprovalRouteInput } from "./input";
import { stepOrderFromIndex, type ApprovalRouteScope } from "./route";

/**
 * ============================================================================
 * 승인 절차(결재선) 저장 — 그 용도에 판(version)을 하나 얹는다
 * ============================================================================
 * A/S 의 `src/lib/db/mutations/shipment-approval-routes.ts` 를 이 저장소에서 되는 방식으로
 * 옮겨 온 것이다(2026-10-15, 조각 ③b). 화면이 보낸 값을 그대로 믿지 않는다 — 화면을 거치지
 * 않고도 이 함수를 부를 수 있기 때문이다.
 *
 * ── 🔴 용도(scope)가 가르는 것 셋 ───────────────────────────────────────
 * 아래 셋이 **전부 그 용도 안에서** 이뤄져야 한다:
 *  1. **지금 판을 읽는 자리** — 다른 용도의 판을 현재로 잡으면 엉뚱한 절차를 고친 것이 된다.
 *  2. **판 번호 매기기** — 전체에서 max + 1 을 하면 사람이 읽는 번호가 망가진다.
 *  3. **「바뀐 게 없으면 새 판을 만들지 않는다」** — 다른 용도의 판과 견주면, 같은 사람들을 두
 *     절차에 세운 순간 한쪽 저장이 조용히 삼켜진다.
 * 셋 다 아래 `currentRoute` 하나에서 나온다 — 그 조회에 걸린 `scope` 조건이 이 파일의 핵심이다.
 *
 * ── 🔴 잠금을 먼저 건다 ─────────────────────────────────────────────────
 * 판 번호를 `max + 1` 로 매기므로, 두 관리자가 동시에 저장하면 **같은 번호를 읽어** 같은
 * 번호의 판이 둘 생기려다 `approval_routes_scope_version_uq` 에서 터진다 — 사람에게는 「알 수
 * 없는 오류」로 보인다. 이 저장소가 이미 쓰는 `pg_advisory_xact_lock`(`stock/ledger.ts` 의
 * 번호표, `excel/workbook-apply-run.ts` 의 적용 잠금)과 같은 방식이고, 트랜잭션이 끝나면
 * 저절로 풀린다.
 *
 * 🔴 **열쇠를 용도별로 쪼개지 않는다.** 고정된 문자열 하나로 전체를 잠근다 — 저장은 관리자가
 * 어쩌다 한 번 누르는 일이라 기다리는 비용이 사실상 0 이고, 열쇠를 용도로 나누면 「용도별
 * 열쇠를 만드는 규칙」이 하나 더 생겨 새 용도를 더할 때 빠뜨릴 자리가 늘어난다.
 *
 * ── 🔴 거절은 반드시 던진다 ─────────────────────────────────────────────
 * 트랜잭션 콜백에서 그냥 `return` 하면 **커밋된다.** 그래서 막히면 `SaveRejected` 를 던져
 * 통째로 되돌린다. 판 하나와 단계 여럿을 함께 넣는 자리라, 반쯤 저장되면 순서가 비어 있는
 * 결재선이 남는다.
 *
 * ── 🔴 A/S 명부는 **트랜잭션을 열기 전에** 받아 온다 (원본과 다른 점) ─────
 * 원본은 승인자 자격을 DB 조회로 확인해 트랜잭션 안에서 했다. 여기서는 그것이 **다른
 * 시스템에 대한 망 호출**(최대 5초)이라, 트랜잭션 안에서 부르면 그동안 연결 하나(NAS 는 풀이
 * 다섯이다)와 잠금을 붙들고 있게 된다. 먼저 받아 와도 잃는 것이 없다 — 어느 쪽이든 명부는
 * 「그 순간의 스냅샷」이고, 판 번호를 지키는 것은 잠금이지 명부가 아니다.
 *
 * ── 🔴 저장 시점에 자격을 다시 본다 ─────────────────────────────────────
 * 화면이 받아 간 명부는 낡을 수 있다(고르는 사이에 A/S 에서 계정이 잠길 수 있다). 판정 자체는
 * 순수 함수 `resolveApproversFromDirectory` 가 쥐고 있고, 「못 받아 왔으면 거절」과 「0개면 명부를
 * 보지 않는다」의 까닭도 거기 적혀 있다.
 *
 * ── 🔴 이름·역할을 그 시점의 명부에서 복사해 적는다 ─────────────────────
 * `approver_name` · `approver_role` 은 명부의 사본이 아니라 **「그때 이렇게 저장했다」는
 * 기록**이다. 그것이 있어야 A/S 가 꺼져 있어도 결재선이 보이고, 그 사람이 나중에 없어져도
 * 그 자리에 적을 말이 「알 수 없는 사람」 말고 남는다.
 * ============================================================================
 */

export type SaveApprovalRouteResult =
  | { ok: true; changed: boolean; version: number }
  | { ok: false; code: "INVALID_INPUT" | "DIRECTORY_UNREACHABLE"; message: string };

/** 결재선을 바꾸는 사람. 이 시스템의 세션에서 온다. */
export type ApprovalRouteActor = { id: string; name: string };

/** advisory 잠금의 고정 열쇠. 용도로 나누지 않는다(머리말). */
const ROUTE_LOCK_KEY = "approval_routes:current";

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호. 콜백에서 그냥 반환하면 트랜잭션이 **커밋된다.**
 */
class ApprovalRouteSaveRejected extends Error {
  constructor(readonly result: Extract<SaveApprovalRouteResult, { ok: false }>) {
    super(result.message);
    this.name = "ApprovalRouteSaveRejected";
  }
}

/** 감사 기록에 싣는 단계 한 줄. 🔴 id 만 적으면 로그가 스스로를 설명하지 못한다. */
type AuditStep = { stepOrder: number; approverUserId: string; approverName: string; approverRole: string };

/**
 * 그 용도에 판을 하나 얹는다.
 *
 * @param scope 어느 절차를 저장하는가. 🔴 **기본값을 두지 않는다** — 부르는 쪽이 언제나 적어야
 *   새 용도를 더할 때 고쳐야 할 자리가 컴파일러에 보인다.
 */
export async function saveApprovalRoute(
  scope: ApprovalRouteScope,
  approverUserIds: readonly string[],
  actor: ApprovalRouteActor,
): Promise<SaveApprovalRouteResult> {
  // 1. 입력 검증(순수). 서버 액션이 이미 한 번 보지만, 이 함수는 화면을 거치지 않고도 불릴
  //    수 있고 그때 엉뚱한 용도는 표의 enum 에서 「알 수 없는 오류」로 터진다.
  const validated = validateApprovalRouteInput({ scope, approverUserIds: [...approverUserIds] });
  if (!validated.ok) return { ok: false, code: "INVALID_INPUT", message: validated.message };
  const nextApproverIds = validated.approverUserIds;

  // 2. A/S 명부 — 트랜잭션 밖에서 받아 온다(머리말).
  //    🔴 단계가 0개면 **부르지 않는다.** 확인할 사람이 없고, 여기서 A/S 를 요구하면 A/S 가
  //    꺼져 있는 동안 절차를 끌 방법이 사라진다(0개짜리 판이 유일한 출구다).
  const directory: AsUserDirectory =
    nextApproverIds.length === 0 ? { status: "ok", users: [] } : await fetchAsUserDirectory();

  try {
    return await db().transaction(async (tx): Promise<SaveApprovalRouteResult> => {
      // 3. 🔴 잠금이 먼저다. 아래 「지금 최대 판 번호」가 이 잠금 밖에서는 다른 트랜잭션과
      //    같은 값으로 읽힐 수 있다.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ROUTE_LOCK_KEY}))`);

      // 4. 🔴 **그 용도의** 지금 판. 판 번호 매기기·「그대로인가」 판정·감사 기록의 이전 값이
      //    전부 이 한 줄에서 나온다. scope 조건이 빠지면 셋이 한꺼번에 다른 절차를 가리킨다.
      const [currentRoute] = await tx
        .select({ id: approvalRoutes.id, version: approvalRoutes.version })
        .from(approvalRoutes)
        .where(eq(approvalRoutes.scope, validated.scope))
        .orderBy(desc(approvalRoutes.version))
        .limit(1);

      const currentSteps: AuditStep[] = currentRoute
        ? await tx
            .select({
              stepOrder: approvalRouteSteps.stepOrder,
              approverUserId: approvalRouteSteps.approverUserId,
              approverName: approvalRouteSteps.approverName,
              approverRole: approvalRouteSteps.approverRole,
            })
            .from(approvalRouteSteps)
            .where(eq(approvalRouteSteps.routeId, currentRoute.id))
            .orderBy(asc(approvalRouteSteps.stepOrder))
        : [];

      // 5. 🔴 자격 확인. 「그대로인가」보다 **먼저** 본다 — 같은 값을 다시 저장하는 길로
      //    명부에서 사라진 사람이 조용히 통과하면, 관리자는 그 결재선이 멀쩡한 줄 안다.
      //    이름은 지금 저장돼 있는 사본에서 빌려 와 **누가** 안 되는지 말해 준다.
      const resolved = resolveApproversFromDirectory(
        directory,
        nextApproverIds,
        new Map(currentSteps.map((step) => [step.approverUserId, step.approverName])),
      );
      if (!resolved.ok) {
        throw new ApprovalRouteSaveRejected({
          ok: false,
          code: resolved.code === "DIRECTORY_UNREACHABLE" ? "DIRECTORY_UNREACHABLE" : "INVALID_INPUT",
          message: resolved.message,
        });
      }

      // 6. 🔴 이름·역할을 **그 시점의 명부에서 복사해** 적는다(머리말).
      const nextSteps: AuditStep[] = resolved.approvers.map((user, index) => ({
        stepOrder: stepOrderFromIndex(index),
        approverUserId: user.id,
        approverName: user.name,
        approverRole: user.role,
      }));

      // 7. 🔴 바뀐 게 없으면 새 판을 만들지 않는다. 판정은 순수 함수가 쥐고 있고, 화면의
      //    「저장하지 않은 변경이 있습니다」와 같은 비교를 쓴다.
      const currentApproverIds = currentRoute ? currentSteps.map((step) => step.approverUserId) : null;
      if (currentRoute && !shouldCreateNewVersion(currentApproverIds, nextApproverIds)) {
        return { ok: true, changed: false, version: currentRoute.version };
      }

      // 8. 새 판. 🔴 판 번호는 **그 용도 안에서** 이어진다. 1 로 고쳐 적지 않는다.
      const nextVersion = (currentRoute?.version ?? 0) + 1;
      const [insertedRoute] = await tx
        .insert(approvalRoutes)
        .values({
          scope: validated.scope,
          version: nextVersion,
          createdBy: actor.id,
          createdByName: actor.name,
        })
        .returning({ id: approvalRoutes.id });

      // 단계가 0개면 판만 만들고 단계는 넣지 않는다(정상이다 — 절차를 끄는 유일한 출구).
      if (nextSteps.length > 0) {
        await tx.insert(approvalRouteSteps).values(
          nextSteps.map((step) => ({
            routeId: insertedRoute.id,
            stepOrder: step.stepOrder,
            approverUserId: step.approverUserId,
            approverName: step.approverName,
            approverRole: step.approverRole,
          })),
        );
      }

      // 9. 감사 기록 — 본 작업과 **한 트랜잭션**(CLAUDE.md 11절).
      //    🔴 용도를 적는다. 대상 표 이름만으로는 어느 절차가 바뀌었는지 알 수 없고, 판 번호는
      //    용도마다 따로 세므로 「2판 → 3판」만 보고는 무엇이 바뀌었는지 알 수 없다.
      await tx.insert(auditLogs).values(
        auditValues({
          action: "APPROVAL_ROUTE_SAVED",
          actorId: actor.id,
          actorName: actor.name,
          target: `approval_routes:${validated.scope}`,
          detail: {
            scope: validated.scope,
            version: nextVersion,
            previousVersion: currentRoute?.version ?? null,
            steps: nextSteps,
            previousSteps: currentSteps,
          },
        }),
      );

      return { ok: true, changed: true, version: nextVersion };
    });
  } catch (err) {
    if (err instanceof ApprovalRouteSaveRejected) return err.result;
    throw err;
  }
}
