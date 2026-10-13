import type { NotificationBellItem } from "@dss/ui";
import { env } from "@/lib/env";

/**
 * ============================================================================
 * 포털에 묻는다 — 「이 사람의 **다른 시스템** 알림」
 * ============================================================================
 * 🔴 **방향이 둘이고 자격이 다르다.** 헷갈리면 통로가 조용히 401 이 된다.
 *
 *   ① 재고 → 포털  (이 파일)   POST · Basic client_secret · 남의 알림을 받아 온다
 *   ② 포털 → 재고              GET  · 포털이 RS256 으로 서명한 Bearer · 우리 알림을 내준다
 *                              (app/api/integration/notifications + auth/portal-service-token.ts)
 *
 * `dss-auth/docs/사이트-알림-통로.md` 에 적힌 POST 는 ① 뿐이다.
 *
 * ── 🔴 여기에 **이 시스템의 알림은 없다** ───────────────────────────────
 * 포털은 부른 사이트 자신에게는 묻지 않는다. 포털이 30초 캐시를 들기 때문에, 자기
 * 알림까지 거기서 받으면 **방금 확인한 신청이 30초 동안 종에 남는다** — 사람이 지금
 * 보고 있는 바로 이 화면에서. 남의 시스템 알림이 30초 늦는 것은 괜찮다(거기서 일하고
 * 있지 않으니까). 그래서 자기 목록은 notifications/queries.ts 가 직접 붙인다.
 *
 * ── 🔴 왜 **서버**에서 가져오나 (브라우저가 아니라) ─────────────────────
 * 자격증명이 `client_secret` 이라 브라우저에서는 부를 수 없다. 브라우저에서 가져오려면
 * 이 사이트 안에 중계 통로를 하나 더 두고 거기서 세션을 다시 검증해야 한다 —
 * **시크릿을 다루는 자리를 하나 더 만드는** 일이다.
 * ============================================================================
 */

/**
 * 이 왕복을 얼마나 기다릴지.
 *
 * 🔴 상한이 **반드시** 있어야 한다. 포털이 죽어 연결이 거절되면 fetch 는 곧바로
 * 실패하지만, 주소가 틀렸거나 포털이 멎어 응답이 **오지 않는** 곳을 두드리면 기본값
 * 으로는 하염없이 기다린다. 이 종은 머리말에 있어 **모든 화면**에 딸려 오므로, 상한이
 * 없으면 알림 하나 때문에 재고 관리 전체가 멈춘 것처럼 보인다.
 *
 * 2초인 까닭(게시판·개선요청도 같은 값이다):
 *  · 포털은 같은 사내망에 있고 사람마다 30초 캐시를 들고 있어 정상이라면 수십 ms 다.
 *  · 🔴 그렇다고 1.5초로 줄이지 않는다. 포털이 각 시스템에 묻는 상한이 **1.5초**
 *    (dss-auth 의 gather.ts READ_TIMEOUT_MS)라, 한 시스템이 느려 포털이 그 1.5초를 꽉
 *    채우고 「한 곳이 빠졌다(degraded)」로 답하는 것이 정상 동작이다. 상한을 1.5초로
 *    두면 바로 그 답을 **도착 직전에** 버린다.
 */
export const PORTAL_NOTIFICATIONS_TIMEOUT_MS = 2000;

/** 포털이 다른 시스템들에 물어 합쳐 준 알림. */
export type PortalNotificationFeed = {
  items: NotificationBellItem[];
  /**
   * 배지에 찍을 숫자. 🔴 **포털이 센 값 그대로** 나른다 — 줄 수로 다시 세지 않는다.
   * 세는 규칙은 시스템마다 다르고(A/S 는 같은 대상을 한 번만 센다), 여기서 다시 세면
   * 그 시스템의 종과 이 종이 서로 다른 숫자를 말하게 된다.
   */
  count: number;
  /**
   * 🔴 「한 곳이라도 못 물어봤다」는 표시. **「알림이 없다」와 다른 말이다.** 지금은
   * 화면에 쓰지 않지만 값을 버리지는 않는다 — 나중에 「일부를 불러오지 못했습니다」를
   * 보여 주기로 하면 여기 있다.
   */
  degraded: boolean;
};

/**
 * 못 물어봤을 때의 답. 🔴 **던지지 않는다** — 알림 하나 때문에 머리말이, 곧 모든
 * 화면이 깨지는 일은 없어야 한다.
 */
const UNREACHABLE: PortalNotificationFeed = { items: [], count: 0, degraded: true };

/** 한 줄의 아홉 칸. 하나라도 글자가 아니면 **그 줄만** 버린다. */
function toPortalBellItem(row: unknown): NotificationBellItem | null {
  if (typeof row !== "object" || row === null) return null;
  const { key, sourceId, sourceName, id, kind, kindLabel, subject, detail, href } = row as Record<string, unknown>;
  if (
    typeof key !== "string" ||
    typeof sourceId !== "string" ||
    typeof sourceName !== "string" ||
    typeof id !== "string" ||
    typeof kind !== "string" ||
    typeof kindLabel !== "string" ||
    typeof subject !== "string" ||
    typeof detail !== "string" ||
    typeof href !== "string"
  ) {
    return null;
  }
  return { key, sourceId, sourceName, id, kind, kindLabel, subject, detail, href };
}

/**
 * 포털의 답을 그릴 수 있는 모양으로 만든다. **망을 타지 않는 순수 함수**라 그대로
 * 불러 시험할 수 있다.
 *
 * 왜 한 번 더 보나: 포털은 우리 편이지만 그 답에는 **다른 시스템들이 만든 글자**가
 * 실려 온다. 한 시스템이 이상한 줄을 하나 섞어 보냈다고 머리말이 통째로 깨지면 안
 * 된다 — 그래서 모양이 안 맞는 줄은 그 줄만 버린다. (그릴 수 없는 주소는 @dss/ui 가
 * 또 한 번 거른다.)
 */
export function normalizePortalNotificationFeed(body: unknown): PortalNotificationFeed {
  if (typeof body !== "object" || body === null) return UNREACHABLE;
  const answer = body as Record<string, unknown>;

  const items: NotificationBellItem[] = [];
  if (Array.isArray(answer.items)) {
    for (const row of answer.items) {
      const item = toPortalBellItem(row);
      if (item) items.push(item);
    }
  }

  // 🔴 숫자가 아니면 **0** 이다(줄 수로 대신 세지 않는다 — 위 count 주석).
  const count = typeof answer.count === "number" && Number.isFinite(answer.count) && answer.count > 0 ? answer.count : 0;

  return { items, count, degraded: answer.degraded === true };
}

/**
 * 포털에 묻는다.
 *
 * 🔴 **어떤 일이 있어도 던지지 않는다.** 포털이 죽었든(503), 우리를 거절했든
 * (400·401·403·405·429), 망이 멎었든, 답이 JSON 이 아니든, 설정이 빠졌든 **빈 목록**이
 * 나간다.
 *
 * @param subject 포털의 users.id (= ID 토큰의 sub). 이 시스템은 `users.auth_sub` 로
 *                들고 있다. 포털 계정과 이어지지 않은 사람은 물을 수 없고, 그 사람은
 *                이 시스템의 알림만 보게 된다 — 정상이다.
 *
 * 🔴 자격증명은 **머리말(Authorization: Basic)** 로만 보낸다. 주소에 실으면 포털이
 *    400 으로 거절하고, 그 값은 이미 접근 로그에 남아 **다시 발급**해야 한다. 어떤
 *    로그에도 찍지 않는다 — 아래에서 남기는 것은 오류의 **종류**와 **상태 코드**뿐이다.
 */
export async function fetchPortalNotifications(subject: string): Promise<PortalNotificationFeed> {
  if (!subject) return UNREACHABLE;

  let response: Response;
  try {
    // env 의 getter 는 값이 없으면 던진다 — 그래서 try 안에서 읽는다.
    const credentials = `${encodeURIComponent(env.ssoClientId)}:${encodeURIComponent(env.ssoClientSecret)}`;

    response = await fetch(`${env.ssoIssuer}/api/integration/notifications`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ sub: subject }).toString(),
      // 포털의 답은 사람마다 다르고 방금 처리한 일이 바로 빠져야 한다. 포털이 이미
      // 30초 캐시를 들고 있으므로 여기서 또 담아 둘 이유가 없다.
      cache: "no-store",
      signal: AbortSignal.timeout(PORTAL_NOTIFICATIONS_TIMEOUT_MS),
    });
  } catch (e) {
    // 🔴 남기는 것은 오류의 **종류**뿐이다(TimeoutError · TypeError …). 주소도
    //    자격증명도 싣지 않는다.
    console.error("[notifications] 포털에 알림을 묻지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return UNREACHABLE;
  }

  if (!response.ok) {
    // 거절 여섯(400·401·403·405·429·503)이 전부 여기로 온다. 거절 본문은 포털의 내부
    // 사정을 설명할 수 있어 상태 코드만 남긴다.
    console.error("[notifications] 포털 알림 통로 거절:", response.status);
    return UNREACHABLE;
  }

  try {
    return normalizePortalNotificationFeed(await response.json());
  } catch {
    // JSON 이 아니거나 중간에 끊겼다(본문 읽기도 시간 상한에 걸릴 수 있다).
    console.error("[notifications] 포털의 알림 응답을 읽지 못했습니다.");
    return UNREACHABLE;
  }
}
