import { PORTAL_TOKEN_PURPOSES, readBearerToken, verifyPortalServiceToken } from "@/lib/auth/portal-service-token";
import { loadDelegationsForAudit } from "@/lib/approval/delegation-queries";
import { findPortalDelegationPerson, portalDelegationStore } from "@/lib/approval/portal-delegation-store";
import { buildDelegationListReply, isDelegationListAction, readDelegationAction } from "@/lib/approval/portal-delegation-list";
import { applyPortalDelegation, parsePortalDelegationCommand } from "@/lib/approval/portal-delegation-sync";

/**
 * ============================================================================
 * 승인함에서 맡긴 결재권 위임을 **주고받는 통로** — 쓰기 갈래 둘 + 읽기 갈래 하나
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
 * ── 🟢 이 통로가 **판정에 이어졌다**(2026-11-16 저녁, 조각 8) ────────────
 * 여기로 들어온 줄은 `lib/approval/delegation-queries.ts` 의 `actingApproverSubsFor` 가 제 표
 * 위임과 **합집합**으로 읽는다(설계 B-4). 🔴 그러면서 「결재할 때마다 포털에 묻던」 길
 * (옛 `lib/approval/portal-acting-subs.ts`)은 **통째로 걷어냈다** — 두 길이 함께 살아 있으면
 * 같은 위임이 두 번 셈해질 자리가 생기고, 포털이 멎었을 때의 처신도 두 벌이 된다.
 * 🔴 **그래서 이 통로가 멎으면 결재권 위임이 멎는다.** 여기가 거절하면 포털이 지정 자체를
 * 거절하므로(설계 B-13) 「맡겼는데 여기선 안 듣는」 줄은 안 생기지만, 🔴 **표에 안 적힌 위임은
 * 이제 어디에서도 안 걸린다** — 전에는 물어서 메울 수 있었다.
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
 *
 * ── 🔴 읽기 갈래가 생겼다 (2026-11-17, 조각 9a · 설계 B-14) ──────────────
 *     POST /api/integration/delegations
 *     Authorization: Bearer <포털이 서명한 서비스 토큰 — 🔴 **읽기 쓰임새**>
 *     { "action": "list" }
 *
 *     200 { "delegations": [ { id, startsAt, endsAt, revokedAt } ], "truncated": false }
 *
 * 🔴 **답에 사람을 싣지 않는다** — 칸은 넷뿐이고 `id` 하나로 포털과 짝이 맞는다(포털이 정한
 * 번호가 이 표의 PK 그대로다). 까닭과 상한은 `approval/portal-delegation-list.ts` 머리말에
 * 있다. B-13 이 있어도 **전파는 됐는데 포털 저장만 실패하는 틈**은 남고, 맞대어 보지 않으면
 * 그 어긋남은 영영 조용하다 — 그 맞대어 보기에 내줄 길이 이 갈래다.
 * 🔴 **점검 스크립트는 포털 쪽에 있다.** 이 집은 길만 연다.
 *
 * ── 🔴 갈래마다 **쓰임새가 다르다** ─────────────────────────────────────
 *  · 쓰기(`upsert`·`revoke`) — `dss.delegations.write`
 *  · 읽기(`list`)            — `dss.delegations.read`
 * 🔴 **쓰기 토큰으로 읽을 수 없고, 읽기 토큰으로 쓸 수 없다.** 한 벌로 묶으면 「남에게 결재권을
 * 맡기러」 구운 토큰이 **회사 전체의 위임 장부**를 여는 열쇠가 된다. 🔵 포털이 읽기 글자를
 * 굽기 전까지 읽기 갈래는 **전부 401** 이고, 그동안 **쓰기 갈래는 한 글자도 안 바뀐다.**
 *
 * 🔴 그래서 **토큰 검증보다 `action` 엿보기가 먼저다.** 어느 쓰임새를 요구할지가 갈래에 달려
 * 있어 차례를 뒤집을 수가 없다. 🔵 엿보기는 **몸통 글자에서 한 칸을 읽을 뿐** 표도 토큰도
 * 건드리지 않고, 못 읽으면 쓰기 갈래로 간다 — 그래서 자격 없는 요청이 받는 답은 **갈래와
 * 무관하게 401 하나**다(모양으로 떠볼 틈이 없다).
 * 🔴 엿보는 것은 **복제본**이다. 원본 몸통은 아래 쓰기 갈래가 예전 그대로 `request.json()` 으로
 * 읽는다 — 원본을 읽으면 그 자리가 **빈 몸통**을 받아 **모든 쓰기가 조용히 400** 이 된다
 * (휴가가 깨뜨려 보고 확인했다). 2026-11-16 에 세 집이 맞춘 자리라 한 글자도 안 건드렸다.
 * ============================================================================
 */

/** 🔴 이 답이 캐시되면 「저장했다」가 저장 안 한 요청에도 돌아간다. 모든 답에 붙인다. */
const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  try {
    // 🔴 **갈래를 먼저 가린다** — 요구할 쓰임새가 갈래마다 다르다(머리말). 🔵 복제본만 읽으므로
    //    아래 쓰기 갈래의 몸통은 손대지 않은 채로 남는다.
    const action = readDelegationAction(await request.clone().text(), request.headers.get("content-type"));

    if (isDelegationListAction(action)) {
      const verifiedReader = await verifyPortalServiceToken(
        readBearerToken(request.headers.get("authorization")),
        // 🔴 **읽기 쓰임새**다. 쓰기 토큰으로 장부를 통째로 읽을 수 없어야 한다.
        PORTAL_TOKEN_PURPOSES.delegationsRead,
      );
      if (!verifiedReader.ok) return invalidToken();

      let rows;
      try {
        rows = await loadDelegationsForAudit();
      } catch (e) {
        /**
         * 🔴 **못 읽은 것을 빈 목록으로 답하지 않는다.** 빈 목록은 「이 집에 위임이 하나도
         * 없다」는 **뜻 있는 답**이고, 점검은 그것을 「포털에만 있다 = 어긋남」으로 읽는다.
         * 읽기에 실패한 것을 그 모양으로 답하면 **DB 가 앓는 날 모든 위임이 어긋난 것으로
         * 보고된다.** 🔵 답의 모양은 아래 바깥 catch 와 **같다** — 갈래마다 다른 말을 만들지
         * 않는다. 로그만 「읽다 실패」라고 따로 적는다(바깥 글은 받아 적기를 말한다).
         */
        console.error("[integration] 위임 목록을 내주지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
        return unavailable("지금은 위임 목록을 내줄 수 없습니다.");
      }
      return Response.json(buildDelegationListReply(rows), { headers: NO_STORE });
    }

    // ── 아래는 2026-11-16 의 쓰기 갈래. 🔴 **차례까지 그대로다** ──────────────────────────
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

/**
 * 읽기 갈래의 401. 🔴 **쓰기 갈래의 그 답과 글자까지 같다**(위 `verified` 쪽의 `Response.json`) —
 * 답의 모양이 갈리면 토큰 없이 두드리는 쪽이 **어느 갈래가 살아 있는지**를 모양으로 알아낸다.
 * 🔵 그쪽을 이 함수로 바꾸지 않은 것은 2026-11-16 의 쓰기 갈래를 **한 글자도 안 건드리기로**
 * 했기 때문이다. 두 자리가 어긋나지 않게 `tests/portal-delegation-list.test.ts` 가 센다.
 */
function invalidToken(): Response {
  return Response.json(
    { error: "invalid_token", error_description: "자격증명이 없거나 이 통로의 것이 아닙니다." },
    { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } },
  );
}

/**
 * 「지금은 안 된다」. 🔵 바깥 catch 가 쓰는 그 모양이고(같은 글자·같은 상태), 포털은 이것을
 * **다시 물어볼 만한 실패**로 읽는다 — 🔴 「이 집에 줄이 없다」와 섞이면 안 되는 쪽이다.
 */
function unavailable(description: string): Response {
  return Response.json({ error: "temporarily_unavailable", error_description: description }, { status: 503, headers: NO_STORE });
}

/** 몸통이 우리가 아는 그 모양이 아니다. 🔵 까닭을 그대로 적는다 — 읽는 쪽이 포털 로그다. */
function badRequest(description: string): Response {
  return Response.json({ error: "invalid_request", error_description: description }, { status: 400, headers: NO_STORE });
}
