import "server-only";
import { env } from "@/lib/env";
import { NO_PORTAL_DELEGATIONS, readPortalDelegationSubs, type PortalDelegations } from "./portal-delegation";

/**
 * ============================================================================
 * 포털에 「이 사람이 지금 누구를 대신할 수 있나」를 묻는다 — 나가는 쪽
 * ============================================================================
 * 결재권 위임을 포털(dss-auth) 한 곳에 모으기로 한 결정(2026-11-13, 설계 B-1)의 재고관리 쪽
 * **읽는 자리**다. 지정·되돌리기는 통합 승인함이 하고 저장은 포털이 하며, 여기서는 **묻기만**
 * 한다. 통로 규격은 설계서 C-2 에 있다:
 *
 *     POST {포털}/api/integration/delegations
 *     Authorization: Basic base64(client_id:client_secret)
 *     Content-Type: application/x-www-form-urlencoded
 *     본문: sub=<포털 users.id>&action=acting
 *     답(200): { "subs": ["…"], "count": N }
 *
 * 🔴 **`subs[0]` 은 언제나 부른 사람 자신**이고, 뒤에 「이 사람이 대신할 수 있는 결재권자들」의
 * 포털 번호가 붙는다. 🔴 **이어 붙이지 않는다** — A→B, B→C 라도 C 는 A 를 못 얻고, 그 판정은
 * **포털이 이미** 한다. 여기서 한 번 더 이어 붙이면 안 된다.
 *
 * ── 🔵 이 집은 **열쇠를 바꾸지 않는다** ─────────────────────────────────
 * `users.auth_sub` 가 곧 포털 `sub` 이고 결재 판정의 열쇠도 그 번호라(`./delegation.ts`
 * 머리말), 포털이 준 값을 **그대로** 쓴다. A/S 가 하는 두 번의 변환(`users.id` ↔
 * `sso_subject`)이 여기에는 아예 없다 — 그래서 변환에 실패해 조용히 안 듣는 사람도 없다.
 *
 * ── 🔴 왜 notifications/portal.ts 에 같이 두지 않았나 ───────────────────
 * 그 파일은 **알림 하나의 왕복 넷**이고 머리말이 통째로 그 이야기다(종 · 지움 · 확인 · 결재
 * 생김). 이것은 **결재 길목의 인가 판정**에 쓰이는 전혀 다른 물음이고, 못 물었을 때의 처신도
 * 다르다 — 알림은 빈 목록이면 그만이지만 여기는 **사람이 결재를 못 누르는 결과**로 이어져
 * 안내까지 띄워야 한다(설계 B-7). 판정에 쓰는 값이라 결재 묶음 안에 둔다 —
 * `./as-users.ts`(A/S 명부를 받아 오는 망 호출)가 `./directory.ts`(순수) 옆에 서 있는 것과
 * **같은 짝**이다.
 * 🔵 다만 **자격증명을 읽는 법과 보내는 머리말은 그 파일과 글자 그대로 같다** — 같은 포털의
 * 같은 인증이라 두 벌로 갈리면 한쪽만 조용히 401 이 된다.
 *
 * ── 🔴 어떤 일이 있어도 던지지 않는다 ───────────────────────────────────
 * 포털이 죽었든(503), 우리를 거절했든(400·401·403·429), 주소가 틀렸든, 설정이 빠졌든
 * (env 의 getter 가 던진다), 이상한 JSON 을 보냈든 **「못 물었다」가 값으로 나간다**
 * (설계 B-6 — 못 물었을 때는 「위임 없음」으로 보고 결재를 그대로 진행한다). 던지면 포털 한
 * 곳이 멈춘 날 세 시스템의 결재가 전부 멈춘다.
 *
 * 🔴 **빈 목록과 「못 물었다」를 같은 값으로 뭉개지 않는다.** 그릇과 까닭은
 * `./portal-delegation.ts` 머리말에 있다.
 *
 * ── 🔴 **거래를 열기 전에** 부를 것 ─────────────────────────────────────
 * 설계 C-3 이 정한 길이다. 결재 판정은 제 DB 트랜잭션 **안에서** 도는데(`part-issue.ts` 의
 * `decidePartIssueApproval` 은 결재건 행을 `FOR UPDATE` 로 잡은 뒤 위임을 읽는다), 망 호출을
 * 그 안에 넣으면 트랜잭션이 망 지연만큼 열려 있게 된다 — 포털이 느린 날 결재건 행 잠금이
 * 2초씩 붙들린다. 그래서 **먼저 묻고, 결과를 트랜잭션 안으로 들고 들어간다.**
 * ============================================================================
 */

/**
 * 왕복 상한. 🔴 **2초다. 설계서의 3초가 아니다.**
 *
 * 설계서 B-6 은 「시간 제한 3초」라고 적었는데 **그것은 통합 승인함이 각 결재함을 부를 때의
 * 값**이다. 재고관리가 포털을 부르는 왕복은 이 집에서 이미 **2초**로 맞춰져 있고
 * (`notifications/portal.ts` 의 `PORTAL_NOTIFICATIONS_TIMEOUT_MS` — 게시판·개선요청도 같은
 * 값이다), 🔴 **같은 집에서 같은 포털을 부르는 상한이 둘이면 느릴 때 어느 쪽이 느린지 알 수
 * 없게 된다.**
 *
 * 🔴 **1.5초(`PORTAL_APPROVAL_PING_TIMEOUT_MS`)로 줄이지도 않는다.** 그 값이 더 짧은 까닭은
 * 「받을 답이 없어서」(「받았다」 한 마디뿐이라 늦게 와도 버릴 것이 없다)인데, 여기는 **받은
 * 목록이 곧 판정 재료**다. 도착 직전에 버리면 대리인이 그대로 막힌다.
 *
 * 🔵 **더 늘리지 않는 까닭**: 여기는 사람이 [승인]을 누르고 기다리는 **결재 길목**이고,
 * 머리말의 알림 종이라 **모든 화면**에 딸려 온다. 넘쳐도 위임이 안 걸릴 뿐 결재 자체는 그대로
 * 진행되므로(설계 B-6), 1초를 더 기다려서 얻는 것보다 1초를 덜 기다려서 잃는 것이 적다.
 *
 * 🔴 **이 주석을 지우지 마라**: 설계서만 읽은 사람이 「3초인데 왜 2초냐」로 되돌리는 것을 막는
 * 자리다.
 */
export const PORTAL_DELEGATIONS_TIMEOUT_MS = 2000;

/**
 * 포털에 묻는다 — **포털 번호 그대로** 돌려준다.
 *
 * @param subject 포털의 `users.id`(= ID 토큰의 `sub` = 이 시스템의 `users.auth_sub`).
 * @returns 물었으면 `{ asked: true, subs }`, 못 물었으면 `{ asked: false }`.
 *          🔴 빈 `subs` 와 `asked: false` 는 **다른 답**이다.
 *
 * 🔵 **빈 번호는 「못 물었다」가 아니라 「물을 것이 없다」**다. 포털 계정과 이어지지 않은
 *    사람에게는 포털 위임이 걸릴 수조차 없으므로(승인함의 대리인 고르개는 포털 사용자만
 *    보여 준다) 「위임 없음」이 **사실**이다. 「잠시 후 다시 시도해 주세요」라고 말하면 영영
 *    오지 않을 때를 기다리게 한다.
 */
export async function fetchPortalActingSubs(subject: string): Promise<{ asked: true; subs: string[] } | { asked: false }> {
  if (!subject) return { asked: true, subs: [] };

  let response: Response;
  try {
    // env 의 getter 는 값이 없으면 던진다 — 그래서 try 안에서 읽는다. 설정이 빠진 것 때문에
    // 결재가 깨지면 안 된다(`notifications/portal.ts` 와 같은 규약).
    // 규격: base64(urlencode(client_id) + ":" + urlencode(client_secret)).
    const credentials = `${encodeURIComponent(env.ssoClientId)}:${encodeURIComponent(env.ssoClientSecret)}`;

    response = await fetch(`${env.ssoIssuer}/api/integration/delegations`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      // 🔴 `action=acting` — 「이 사람이 **대신할 수 있는** 사람들」을 묻는 방향이다. 같은
      //    통로의 다른 일(`list`·`candidates`·`create`·`revoke`)은 승인함의 것이고, 그중
      //    하나를 여기 꽂으면 오류 없이 아무도 못 누르거나 **엉뚱한 사람이 누르게 된다.**
      body: new URLSearchParams({ sub: subject, action: "acting" }).toString(),
      // 사람마다 다르고 방금 되돌린 위임이 바로 빠져야 한다 — 담아 둘 이유가 없다.
      cache: "no-store",
      signal: AbortSignal.timeout(PORTAL_DELEGATIONS_TIMEOUT_MS),
    });
  } catch (e) {
    // 🔴 남기는 것은 오류의 **종류**뿐이다(TimeoutError · TypeError …). 주소도 자격증명도
    //    포털 번호도 싣지 않는다(이 집의 포털 통로 전부가 같은 규칙이다).
    console.error("[delegations] 포털에 결재권 위임을 묻지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return { asked: false };
  }

  if (!response.ok) {
    // 거절 본문은 포털의 내부 설정을 설명할 수 있다. 상태 코드만 남긴다.
    // 🔵 **통로가 없던 동안의 404 도 여기로 온다** — 그때는 위임이 안 걸릴 뿐 결재는 멀쩡하다.
    console.error("[delegations] 포털 결재권 위임 통로 거절:", response.status);
    return { asked: false };
  }

  let subs: string[] | null;
  try {
    subs = readPortalDelegationSubs(await response.json(), subject);
  } catch {
    // JSON 이 아니거나 중간에 끊겼다(본문 읽기도 상한에 걸릴 수 있다).
    subs = null;
  }
  if (subs === null) {
    // 🔴 **모르는 모양은 「위임 없음」이 아니라 「못 물었다」**다(그 함수 머리말). 통로가
    //    바뀐 날 대리인 전원이 까닭 없이 막히는데 아무 흔적이 없는 것을 막는 유일한 줄이다.
    console.error("[delegations] 포털의 결재권 위임 응답을 읽지 못했습니다.");
    return { asked: false };
  }
  return { asked: true, subs };
}

/**
 * 🔴 **이 조각의 입구.** 한 사람에 대해 「포털에 맡겨 둔 위임으로 지금 누구를 대신할 수
 * 있나」를 **포털 번호 목록**으로 돌려준다. 🔴 **던지지 않는다** — 못 물었으면
 * `unavailable: true` 인 빈 목록이다.
 *
 * 부르는 자리는 셋이고 **전부 트랜잭션 밖**이다:
 *  · 결재 단추   — `app/actions/part-issue.ts` 의 `decidePartIssueAction`(거래를 열기 전)
 *  · 결재 화면   — `./part-issue-screen-data.ts` 의 `readPartIssueApprovalScreen`
 *  · 알림 종·위임 설정 화면 — `components/HeaderNotificationBell.tsx` ·
 *                            `./delegation-screen-data.ts`
 *
 * 🔴 **포털이 우리를 부르는 통로(`app/api/integration/*`)에서는 부르지 않는다.** 거기서 또
 * 포털에 물으면 **포털이 우리를 기다리는 동안 우리가 포털을 기다린다** — 포털의 상한이
 * 1.5초인데 우리 상한이 2초라 답이 닿기 전에 포털이 그 줄을 버린다. 그 자리들은
 * `NO_PORTAL_DELEGATIONS` 를 글자로 넘겨 **안 물었다는 사실을 코드에 적어 둔다.**
 */
export async function resolvePortalDelegations(subject: string): Promise<PortalDelegations> {
  const answer = await fetchPortalActingSubs(subject);
  if (!answer.asked) return { delegatorSubs: [], unavailable: true };

  // 🔴 **본인 번호를 여기서 빼지 않는다.** 포털은 맨 앞에 부른 사람 자신을 넣어 주는데,
  //    합치는 함수(`./delegation.ts` 의 `actingApproverSubs`)가 본인을 맨 앞에 두고 중복을
  //    걷는다. 여기서 또 빼면 「누가 본인을 넣는가」가 두 곳이 된다.
  if (answer.subs.length === 0) return NO_PORTAL_DELEGATIONS;

  return { delegatorSubs: answer.subs, unavailable: false };
}
