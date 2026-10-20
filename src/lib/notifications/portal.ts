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
  /**
   * 🔴 그 사람이 지운 알림의 열쇠 — **재고관리 몫만** 온다(2026-10-20, 포털의 4425d54).
   *
   * 포털은 **남의 시스템 줄을 제 손으로 걸러서** 보낸다. `items` 에 없고 `count` 도
   * 그만큼 줄어 있으므로 이 사이트가 거기에 할 일이 없다. 할 일이 남는 것은
   * **제 줄**뿐이다 — 포털은 재고관리의 알림을 애초에 보내지 않고(위 머리말),
   * 그 목록은 notifications/queries.ts 가 제 DB 에서 직접 만들어 이어 붙인다.
   * 포털이 손댈 수 없는 그 목록을 거르라고 있는 칸이 이것이다.
   *
   * 🔴 **안 거르면 「재고관리에서 지웠는데 재고관리 종에만 그대로 뜬다」가 된다** —
   * 다른 시스템의 종에서는 사라지는데 여기서만 남는, 제일 헷갈리는 모양이다.
   * 거르는 자리는 `withoutDismissed` 하나다.
   *
   * 🔵 지운 것이 없으면 **빈 배열**이다. 포털이 지움 기록을 못 읽어도 빈 배열이고
   * 그때는 `degraded` 가 선다 — 지웠던 줄이 다시 뜰 뿐이고, 지움은 보기를 미루는
   * 것이지 지워지는 자료가 아니라 그 편이 종을 통째로 끄는 것보다 낫다.
   */
  dismissed: string[];
};

/**
 * 못 물어봤을 때의 답. 🔴 **던지지 않는다** — 알림 하나 때문에 머리말이, 곧 모든
 * 화면이 깨지는 일은 없어야 한다.
 */
const UNREACHABLE: PortalNotificationFeed = { items: [], count: 0, degraded: true, dismissed: [] };

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

  // 🔴 칸이 없는 옛 포털에 대고도 돌아야 한다 — 그때는 **빈 배열**이고, 제 줄이
  //    걸러지지 않을 뿐 종은 예전 그대로 그려진다. 글자가 아닌 조각은 버린다.
  const dismissed = Array.isArray(answer.dismissed) ? answer.dismissed.filter((key): key is string => typeof key === "string" && key !== "") : [];

  return { items, count, degraded: answer.degraded === true, dismissed };
}

/**
 * 🔴 **포털이 돌려준 지움으로 「이 시스템의 알림」에서 제 줄을 뺀다.**
 *
 * 포털은 남의 줄을 이미 걸러서 보내므로(위 `dismissed` 주석) 이 함수가 받는 것은
 * **우리가 제 DB 에서 만든 목록**(notifications/queries.ts)뿐이다. 망도 DB 도 타지
 * 않는 **순수 함수**라 그대로 불러 시험할 수 있다 — 거르기가 종 조각 안에 묻히면
 * 「개수가 0 아래로 내려가는가」를 한 번도 돌려 보지 못한다.
 *
 * 🔴 **개수도 함께 줄인다.** 줄은 빠졌는데 배지 숫자가 그대로면 「눌러도 안 없어지는
 * 숫자」가 되고, 사람은 「알림이 있다는데 열면 없다」로 읽는다.
 *
 * 🔴 **0 아래로 내려가지 않는다.** 이 시스템의 `count` 는 줄 수가 아니다 — 묶음 줄은
 * 1 로 세고, 상한에 잘린 목록은 **자르기 전의 총계**로 센다(bell-items.ts 의 count
 * 주석). 그래서 뺀 줄 수가 `count` 보다 클 수 있다.
 *
 * 🔵 열쇠는 `item.key` 를 **그대로** 본다. 그 값은 조립이 `` `${sourceId}:${id}` `` 로
 * 만든 것이고(bell-items.ts), 포털이 돌려주는 열쇠와 같은 모양이다. 여기서 접두사를
 * 다시 지어 맞추면 두 자리가 갈라질 수 있다.
 */
export function withoutDismissed(mine: { items: readonly NotificationBellItem[]; count: number }, dismissed: readonly string[]): { items: NotificationBellItem[]; count: number } {
  if (dismissed.length === 0) return { items: [...mine.items], count: mine.count };

  const hidden = new Set(dismissed);
  const items = mine.items.filter((row) => !hidden.has(row.key));
  const removed = mine.items.length - items.length;
  if (removed === 0) return { items, count: mine.count };

  return { items, count: Math.max(0, mine.count - removed) };
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

/* ========================================================================== */
/* 「이 알림은 그만 보겠다」 — 지움을 포털에 적는다 (쓰는 쪽)                   */
/*                                                                           */
/* 2026-10-19 까지 지움은 **각 사이트의 브라우저**에 적혔다. 브라우저 저장소는  */
/* 주소(포트)별로 갈려서 같은 사람이 시스템마다 다른 목록을 봤다 — A/S(3000)   */
/* 에서 지운 줄이 재고관리(3800)의 종에는 그대로 떴다. 그래서 지움을 포털 한   */
/* 곳에 모았고, 여기는 그 **쓰는 쪽**이다. 읽는 쪽(fetchPortalNotifications)과 */
/* 같은 자격증명·같은 상한·같은 거절이다 — 둘이 어긋나면 「알림은 오는데 지움은 */
/* 안 먹히는」 상태가 되고, 그 어긋남은 신고로만 드러난다.                     */
/*                                                                           */
/* 🔴 이 사이트에서 지우는 줄에는 **제 알림도 섞여 있다**(계측기·PO 와 다른    */
/*    점이다). 제 줄의 열쇠도 모양이 같아(`dss-inventory:…`) 포털이 그대로     */
/*    받아 적고, 다음 왕복에서 `dismissed` 로 돌려준다 — 거르는 일은 위        */
/*    `withoutDismissed` 가 한다.                                             */
/* ========================================================================== */

/**
 * 한 번에 보낼 수 있는 열쇠 수.
 *
 * 🔴 **넘으면 포털이 400 으로 통째로 거절한다 — 앞의 200개만 받아 주지 않는다.**
 * 그래서 자르는 일을 보내는 쪽이 한다. 값의 근거와 「왜 1000이 아닌가」는 포털 쪽에
 * 있다(dss-auth 의 `MAX_DISMISSAL_KEYS_PER_REQUEST`, 2026-10-20 결정).
 * 🔴 여기 값을 올려도 포털이 안 올라가면 소용이 없다 — 이 숫자는 **저쪽을 따라가는
 * 값**이지 우리가 정하는 값이 아니다.
 */
const DISMISSALS_PER_REQUEST = 200;

/**
 * 열쇠 한 묶음을 포털에 적는다. 🔴 **던지지 않는다** — 돌려주는 것은 「적혔는가」뿐이고,
 * 까닭은 서버 로그에만 남는다.
 */
async function recordDismissalChunk(subject: string, keys: readonly string[]): Promise<boolean> {
  let response: Response;
  try {
    // env 의 getter 는 값이 없으면 던진다 — 그래서 try 안에서 읽는다. 설정이 빠진 것
    // 때문에 ✕ 한 번이 화면을 깨면 안 된다.
    const credentials = `${encodeURIComponent(env.ssoClientId)}:${encodeURIComponent(env.ssoClientSecret)}`;

    response = await fetch(`${env.ssoIssuer}/api/integration/notification-dismissals`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ sub: subject, keys: keys.join(",") }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(PORTAL_NOTIFICATIONS_TIMEOUT_MS),
    });
  } catch (e) {
    // 🔴 남기는 것은 오류의 **종류**뿐이다. 열쇠에는 신청 번호 같은 업무 식별자가
    //    들어 있어 그것도 찍지 않는다(포털이 같은 판단을 한다).
    console.error("[notifications] 알림 지움을 적지 못했습니다:", { name: e instanceof Error ? e.name : "unknown" });
    return false;
  }

  if (!response.ok) {
    console.error("[notifications] 포털 알림 지움 통로 거절:", response.status);
    return false;
  }

  return true;
}

/**
 * 「이 알림들은 그만 보겠다」를 포털에 적는다. 🔴 **어떤 일이 있어도 던지지 않는다** —
 * 읽는 쪽과 같은 약속이다. 못 적으면 그 줄이 종에 남을 뿐이고, 그것이 화면이 깨지는
 * 것보다 훨씬 낫다.
 *
 * @param subject 포털의 users.id (= ID 토큰의 sub). 이 시스템은 `users.auth_sub` 로
 *                들고 있다. 🔴 **서버가 제 세션에서 가진 값**이어야 한다 — 브라우저가
 *                보낸 값을 그대로 넘기면 남의 알림을 지울 수 있는 통로가 된다.
 * @param keys    `{client_id}:{id}` 모양. 모양이 틀리거나 모르는 시스템의 것은 포털이
 *                **조용히 버린다** — 한 줄 때문에 묶음이 통째로 실패하지 않는다.
 * @returns 보낸 묶음이 **전부** 적혔는가. 하나라도 거절되면 false 다.
 *
 * 🔵 몇 번을 다시 보내도 안전하다 — 같은 열쇠를 두 번 지우는 것은 한 번 지우는 것과
 *    같다(포털이 이미 있는 열쇠를 조용히 넘긴다).
 */
export async function dismissPortalNotifications(subject: string, keys: readonly string[]): Promise<boolean> {
  if (!subject) return false;

  // 같은 열쇠가 두 번 실려 와도 한 번만 보낸다. 포털은 어느 쪽이든 같은 답을 주지만,
  // 겹친 값이 200 칸을 차지해 묶음이 괜히 늘어나지 않게 한다.
  const wanted = Array.from(new Set(keys.filter((key): key is string => typeof key === "string" && key !== "")));

  // 🔴 보낼 것이 없으면 **아예 부르지 않는다.** 빈 keys 는 포털이 400(no_keys)으로
  //    거절하므로, 부르는 것은 거절 한 줄을 로그에 쌓는 일뿐이다.
  if (wanted.length === 0) return false;

  // 🔴 묶음을 **차례로** 보낸다(한꺼번에 던지지 않는다). 한 사람의 ✕ 한 번에 포털로
  //    여러 연결이 동시에 열리면, 인증 실패 세는 통(분당 20번)과 포털의 DB 에 쓸데없는
  //    봉우리를 만든다. 두 자릿수가 실측이라 묶음은 대개 하나다.
  let recorded = true;
  for (let at = 0; at < wanted.length; at += DISMISSALS_PER_REQUEST) {
    const chunk = wanted.slice(at, at + DISMISSALS_PER_REQUEST);
    if (!(await recordDismissalChunk(subject, chunk))) recorded = false;
  }

  return recorded;
}
