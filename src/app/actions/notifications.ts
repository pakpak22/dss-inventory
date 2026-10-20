"use server";

import { revalidatePath } from "next/cache";
import type { NotificationBellItem } from "@dss/ui";
import { getSession } from "@/lib/auth/session";
import { vetDismissKeys } from "@/lib/notifications/dismiss-keys";
import { dismissPortalNotifications } from "@/lib/notifications/portal";

/**
 * 머리말의 알림 종에서 ✕ 를 눌렀을 때 — 그 줄을 **포털에** 지운다.
 *
 * ── 🔴 왜 서버 액션인가 (중계 통로가 아니라) ────────────────────────────
 * 종은 서버 조각이다(components/HeaderNotificationBell.tsx). 클라이언트 경계를
 * 건널 수 있는 함수는 **서버 액션뿐이라**, @dss/ui 의 `onDismiss` 에 넘길 수
 * 있는 것이 이것 하나다.
 *
 * 그보다 중요한 까닭이 하나 더 있다: 포털에 지움을 적는 자격은 `client_secret`
 * 이다. 브라우저용 중계 통로(route handler)를 뚫으면 거기서 세션을 다시
 * 검증하고 시크릿을 다시 다뤄야 한다 — **시크릿을 다루는 자리를 하나 더
 * 만드는** 일이다. 그 판단은 notifications/portal.ts 맨 위에 이미 적혀 있고,
 * 여기서 깨지 않는다. 서버 액션이면 시크릿은 이 프로세스 밖으로 나가지 않고,
 * 번들로는 **이 함수의 이름표**만 나간다(본문은 서버에 남는다).
 *
 * ── 🔴 누구의 지움인지는 **서버가** 정한다 ──────────────────────────────
 * 사람 번호(`sub`)를 인자로 받지 않는다. 받으면 브라우저가 아무 번호나 실어
 * 남의 알림을 지울 수 있다. 여기서 제 세션을 다시 읽어 그 값을 쓴다 —
 * 레이아웃이 이미 `requireSession` 을 했더라도 **서버 액션은 따로 다시
 * 검증한다**((app)/layout.tsx 머리말의 약속이 그것이다).
 *
 * 🔴 `redirect` 하는 `requireSession` 이 아니라 `getSession` 을 쓴다. 이 함수는
 *    사람이 ✕ 를 누른 **그 순간** 불리는데, 세션이 막 끊긴 경우에 종 하나
 *    때문에 보던 화면이 로그인으로 튀어서는 안 된다. 그때는 아무 일도 일어나지
 *    않는 편이 맞다.
 *
 * ── 🔴 던지지 않는다 ───────────────────────────────────────────────────
 * @dss/ui 의 곁들이 조각이 이 함수를 누름 처리 **한가운데서** 부른다. 여기서
 * 예외가 새면 그 누름의 나머지 처리(바깥 눌러 접기·Esc·확인)가 통째로 멈춘다.
 * 못 지우면 그 줄이 종에 남을 뿐이다.
 *
 * 🔵 **제 줄도 지울 수 있다.** 재고관리는 제 알림을 제 손으로 그려 포털 목록에
 *    이어 붙이는데(HeaderNotificationBell), 그 줄의 열쇠도 모양이 같아
 *    (`dss-inventory:…`) 포털이 그대로 받아 적는다. 다음 왕복에서 `dismissed`
 *    로 돌아오고, 거기서 거르는 일은 portal.ts 의 `withoutDismissed` 가 한다.
 */
export async function dismissNotificationAction(item: NotificationBellItem): Promise<void> {
  try {
    const session = await getSession();
    if (!session) return;

    // 🔴 열쇠는 브라우저에서 온 글자다. 포털이 모양이 틀리거나 모르는 시스템의
    //    열쇠를 조용히 버리므로 여기서 더 가릴 것은 없지만, 빈 값은 아예 보내지
    //    않는다(그 묶음은 포털이 400 으로 거절한다).
    //    🔵 이 값으로 **지워지는 것은 그 사람 자신의 알림뿐이다** — 누구의
    //    지움인지는 바로 위에서 서버가 정했다.
    const key = typeof item?.key === "string" ? item.key : "";
    if (key === "") return;

    const recorded = await dismissPortalNotifications(session.user.authSub, [key]);

    // 🔴 적히지 않았으면 다시 그리지 않는다. 포털이 거절했으면 다음 렌더의 목록도
    //    똑같고, 그때 하는 일이라고는 사이트 전체의 캐시를 쓸데없이 버리는 것뿐이다.
    //    그 줄은 종에 남는다 — 알고 받아들인 모습이다.
    if (!recorded) return;

    // ── 🔴 왜 `revalidatePath("/", "layout")` 인가 ────────────────────────
    // 종은 **사내 구간 레이아웃**이 그린다((app)/layout.tsx). 라우트 그룹이라 URL 에
    // 나타나지 않으므로 경로는 `/` 다. 지금 보고 있는 화면이 무엇이든 그 레이아웃이
    // 다시 그려져야 목록이 줄어든다 — 화면 하나만 되살리면 레이아웃은 그대로라 ✕ 를
    // 눌러도 줄이 남는다.
    //
    // 🔵 **누른 그 자리에서 즉시 사라지지는 않는다** — 줄은 다음 렌더에서 빠진다.
    //    알고 받아들인 값이다(즉시 지우려면 종을 클라이언트 조각으로 바꾸고 목록
    //    상태를 브라우저에 들어야 하는데, 그것이 위에서 피한 길이다). 대신 이 한 줄이
    //    있어 **그 다음 렌더가 실제로 줄어든다.**
    //
    // 🔵 포털의 30초 캐시에 걸리지 않는다 — 포털은 캐시에서 꺼낸 목록에도 지움을 **그
    //    자리에서** 다시 입힌다(dss-auth 의 site-service.ts). 제 줄은 애초에 캐시를
    //    거치지 않고 우리 DB 에서 바로 온다.
    revalidatePath("/", "layout");
  } catch (e) {
    // 🔴 오류의 **종류**만 남긴다 — 열쇠에는 업무 식별자가 들어 있다.
    console.error("[notifications] 알림 지움 처리에서 넘어졌습니다:", { name: e instanceof Error ? e.name : "unknown" });
  }
}

/**
 * 머리말의 알림 종에서 「**보이는 알림 지우기 n건**」을 눌렀을 때 — 지금 그려져 있는
 * 줄을 **한꺼번에** 포털에 지운다(2026-10-20).
 *
 * 🔵 위 `dismissNotificationAction` 과 **같은 약속 위에 있다.** 세션에서 사람 번호를
 *    읽는 것도, 던지지 않는 것도, 열쇠를 로그에 안 찍는 것도, 되살리는 자리가 사내 구간
 *    **레이아웃**인 것도 같다 — 까닭은 거기 적혀 있다. 여기서는 **다른 점 셋**만 적는다.
 *
 * ── 🔴 ① 인자를 **미리 묶어** 받는다 ───────────────────────────────────
 * @dss/ui 가 내준 자리는 `onDismissAll?: () => void` 로 **인자를 안 받는다.** 그런데
 * 지울 열쇠 목록을 아는 것은 사이트다(종에 무엇을 그릴지 사이트가 정한다). 종은 서버
 * 조각이라 `onDismissAll={() => 지운다(열쇠들)}` 처럼 평범한 화살표 함수를 클라이언트
 * 경계로 넘길 수 없다 — 건널 수 있는 것은 서버 액션뿐이다.
 *
 * 그래서 **값을 미리 묶은 서버 액션**을 넘긴다(`…bind(null, 열쇠들)`). 묶은 함수도
 * 여전히 서버 액션이고(React 가 `bind` 를 따로 손봐 둔다), 묶인 값은 RSC 응답에 실려
 * 내려갔다가 누를 때 되돌아온다.
 *
 * 🔴 묶어 보내는 목록은 **제 줄과 포털 줄을 합친 뒤**의 것이다(HeaderNotificationBell).
 *    재고관리는 제 알림을 제 손으로 그려 이어 붙이므로, 포털에서 온 줄만 묶으면 「전부
 *    지우기를 눌렀는데 내 알림만 남는다」가 된다.
 *
 * ── 🔴 ② 그래서 받은 값을 **믿지 않는다** ───────────────────────────────
 * 인자가 브라우저를 한 번 거친다는 뜻이다. 🔵 이것은 새 위험이 아니다 — 줄마다 서는 ✕ 도
 * 이미 브라우저가 보낸 `item.key` 를 쓴다. **누구의 지움인지(`sub`)는 여기서도 서버가 제
 * 세션에서 읽는다.** 열쇠로 할 수 있는 일은 「내 종에서 이 줄을 그만 보기」뿐이다.
 *
 * 모양과 수를 가리는 자리는 `vetDismissKeys` 다(notifications/dismiss-keys.ts). 배열이
 * 아니면·울타리를 넘으면 **아무 일도 하지 않는다.**
 *
 * ── 🔴 ③ 거절당해도 되살린다 — 위와 **반대**다 ──────────────────────────
 * 위 함수는 「적히지 않았으면 되살리지 않는다」가 맞다. 한 줄짜리라 거절은 곧 「아무것도
 * 안 바뀌었다」이고, 그때 되살리면 사이트 전체 캐시만 버린다.
 *
 * 여기서는 그 셈이 뒤집힌다. 열쇠가 200개를 넘으면 포털로 **여러 묶음**이 나가고
 * (portal.ts), 돌아오는 값은 「**전부** 적혔는가」다 — 가운데 하나가 거절돼도 나머지는
 * 적혔다. 그때 안 되살리면 **이미 지워진 줄이 종에 그대로 남아** 사람은 「눌렀는데 아무
 * 일도 없다」고 읽고, 다음 화면 이동까지 어긋난 목록을 본다. 한 묶음이 통째로 거절된
 * 때만 쓸데없이 캐시를 버리는데, 그것은 사람이 단추를 **방금 누른** 직후라 다시 그리는
 * 것이 손해가 아니다(한 번 누름에 한 번뿐이다).
 */
export async function dismissAllNotificationsAction(keys: readonly string[]): Promise<void> {
  try {
    const session = await getSession();
    if (!session) return;

    // 🔴 타입이 `readonly string[]` 라고 해서 그 모양으로 오지 않는다 — 서버 액션의
    //    인자는 tsc 가 지키는 범위 밖이다(위 ②).
    const wanted = vetDismissKeys(keys);
    if (wanted === null) return;
    if (wanted.length === 0) return;

    // 🔴 돌려받는 「전부 적혔는가」를 **보지 않는다.** 일부만 적힌 경우가 있고, 그때
    //    되살리지 않으면 지워진 줄이 종에 남는다(위 ③).
    await dismissPortalNotifications(session.user.authSub, wanted);
    revalidatePath("/", "layout");
  } catch (e) {
    // 🔴 여기도 오류의 **종류**만 남긴다 — 몇 건이었는지도 적지 않는다.
    console.error("[notifications] 보이는 알림 지움 처리에서 넘어졌습니다:", { name: e instanceof Error ? e.name : "unknown" });
  }
}
