import { PORTAL_TOKEN_PURPOSES, readBearerToken, verifyPortalServiceToken } from "@/lib/auth/portal-service-token";
import { findPortalDelegationPerson, portalDelegationStore } from "@/lib/approval/portal-delegation-store";
import { applyPortalDelegation, parsePortalDelegationCommand } from "@/lib/approval/portal-delegation-sync";

/**
 * ============================================================================
 * 승인함에서 맡긴 결재권 위임을 **받아 적는 통로** — 포털이 써 준다 (2026-11-16, 조각 6)
 * ============================================================================
 * 2026-11-16 저녁에 방식이 뒤집혔다(설계 `dss-approvals/DELEGATION_DESIGN.md` 의 B-12):
 * 결재할 때마다 포털에 **묻던** 것을, 포털이 지정·철회할 때 각 시스템에 **써 주는** 것으로
 * 바꿨다. 이 통로가 그 받는 자리다. 판단은 `lib/approval/portal-delegation-sync.ts` 가 전부
 * 쥐고 있고 여기 남은 일은 「토큰 꺼내 검증하고, 몸통 읽어, 그 함수 부르기」뿐이다.
 *
 * ── 🔴 몸통 규약 — **세 시스템(A/S·재고관리·휴가)이 글자 그대로 같다** ────
 *     POST /api/integration/delegations
 *     { "action": "upsert" | "revoke", "id": "<포털이 정한 uuid>",
 *       "delegatorSub": "…", "delegateSub": "…",
 *       "startsAt": "<ISO 8601>", "endsAt": "<ISO 8601>",
 *       "reason": "…", "revokedAt": "<ISO 8601>" }
 * 답은 **200 에 `outcome` 한 칸**이고 🔴 **둘 다 성공이다**:
 *     { "outcome": "stored" }          저장했다
 *     { "outcome": "not_applicable" }  이 시스템에는 해당 없다
 * 오류는 4xx/5xx 에 `{ error, error_description }`.
 * 🔴 **임의로 바꾸지 마라** — 포털 한 곳이 세 시스템을 같은 몸통으로 부른다.
 *
 * ── 🔴 `not_applicable` 이 이 통로의 핵심이다 ───────────────────────────
 * 위임자나 대리인이 **이 시스템에 계정이 없으면** 저장할 수 없는데 그것은 오류가 아니다.
 * 오류로 답하면 포털이 **전파 실패**로 보고 **지정 자체를 거절해**(설계 B-13), 「재고관리 계정이
 * 없는 사람에게는 위임을 아예 못 맡기는」 일이 생긴다 — 재고관리와 상관없는 A/S 결재권까지
 * 막힌다. 나오는 조건은 셋이고 전부 sync 쪽 주석에 적혀 있다.
 *
 * ── 🔴 이 통로는 **판정에 이어져 있지 않다**(조각 8) ────────────────────
 * 지금은 받아 적기만 한다. 「누가 대신 누를 수 있나」는 아직 `lib/approval/portal-acting-subs.ts`
 * 가 **포털에 물어서** 정한다 — 그 길을 걷어내고 이 표를 읽게 바꾸는 것이 다음 조각이다.
 * 🔵 그래서 이 통로가 생겨도 지금 동작은 한 군데도 안 바뀐다.
 *
 * ── 자격은 알림 통로와 **같은 방식, 다른 쓰임새** ───────────────────────
 * 포털이 RS256 으로 서명한 Bearer 토큰이고 검증은 `auth/portal-service-token.ts` 하나가 한다.
 * 🔴 쓰임새는 `dss.delegations.write` 다 — 종을 읽으려고 구운 토큰으로 **남의 결재권을 넘기는
 * 줄을 쓸 수 없어야 한다**(최소 권한). 🔴 **포털이 아직 그 글자를 굽지 않는다** — 포털 쪽
 * 조각에서 더해야 열린다(그 상수의 주석).
 * 🔵 **토큰의 `sub` 는 쓰지 않는다.** 알림·승인함 통로에서는 그 값이 「누구의 자료인가」였지만,
 *    여기서는 **누구에 대한 줄인지가 몸통에** 있다(`delegatorSub`·`delegateSub`). 토큰은
 *    「포털이 맞나」만 말한다. 🔴 그래도 `sub` 없는 토큰은 거절된다(검증기가 요구한다) — 포털은
 *    굽는 자리에서 사람 하나를 실어야 하고, 무엇을 싣든 이 통로의 판단은 달라지지 않는다.
 *
 * ── 🔵 Origin 머리말을 보지 않는다 ──────────────────────────────────────
 * CLAUDE.md 15절의 「상태를 바꾸는 요청은 출처를 검증한다」는 **브라우저 폼**에 대한 규칙이다
 * (쿠키가 자동으로 실려 가는 길을 막는 것). 이 통로는 쿠키를 한 글자도 안 읽고 **서버끼리**
 * 부른다 — 자격은 토큰뿐이라 남의 브라우저로는 애초에 부를 수 없다. 알림 설정 통로의 PUT 도
 * 같은 까닭으로 Origin 을 안 본다.
 * ============================================================================
 */

/** 🔴 이 답이 캐시되면 「저장했다」가 저장 안 한 요청에도 돌아간다. 모든 답에 붙인다. */
const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  try {
    const verified = await verifyPortalServiceToken(readBearerToken(request.headers.get("authorization")), PORTAL_TOKEN_PURPOSES.delegationsWrite);
    if (!verified.ok) {
      // 🔴 왜 거절했는지는 밖으로 내보내지 않는다 — 맞혀 가며 두드릴 실마리가 된다.
      //    까닭은 서버 로그에만 남는다(auth/portal-service-token.ts).
      return Response.json(
        { error: "invalid_token", error_description: "자격증명이 없거나 이 통로의 것이 아닙니다." },
        { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } },
      );
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      // 🔵 모양이 틀린 것과 같은 자리로 보낸다 — 포털이 할 일(몸통을 고쳐 다시 보내기)이 같다.
      return badRequest("몸통을 JSON 으로 읽지 못했습니다.");
    }

    const parsed = parsePortalDelegationCommand(payload);
    // 🔴 **400 이다(500 이 아니다).** 포털은 둘을 다르게 다룬다 — 500 은 다시 보낼 만하고,
    //    400 은 다시 보내도 같다. 몸통이 틀린 것을 500 으로 답하면 포털이 영원히 되쏜다.
    if (!parsed.ok) return badRequest(parsed.message);

    const { outcome } = await applyPortalDelegation({
      command: parsed.command,
      // 🔴 자격 판정을 새로 짓지 않는다 — 알림·승인함 통로가 쓰는 그 조회를 그대로 넘긴다.
      findActor: findPortalDelegationPerson,
      store: portalDelegationStore,
    });

    return Response.json({ outcome }, { headers: NO_STORE });
  } catch (e) {
    // 설정값이 빠졌거나(env 의 getter 가 던진다) 포털의 JWKS 를 못 읽었거나 DB 가 멎었다.
    // 🔴 안쪽 사정은 내보내지 않는다. 🔵 포털은 이것을 **전파 실패**로 보고 지정을 거절한다
    //    (설계 B-13) — 그래야 「맡겼는데 여기서만 안 듣는」 상태가 안 생긴다.
    console.error("[integration] 결재권 위임을 받아 적지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return Response.json(
      { error: "temporarily_unavailable", error_description: "지금은 받아 적을 수 없습니다." },
      { status: 503, headers: NO_STORE },
    );
  }
}

/** 몸통이 우리가 아는 그 모양이 아니다. 🔵 까닭을 그대로 적는다 — 읽는 쪽이 포털 로그다. */
function badRequest(description: string): Response {
  return Response.json({ error: "invalid_request", error_description: description }, { status: 400, headers: NO_STORE });
}
