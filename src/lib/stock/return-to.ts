/**
 * 부품 요청 단추를 누른 뒤 **돌아갈 자리** (2026-10-15, 조각 10c).
 *
 * 단추 묶음(`components/stock/RequestActions.tsx`)이 끝나면 서버가 어디로 돌려보낼지 정해야 한다. 화면이
 * **지금 있는 자리**를 폼에 실어 보내고 서버가 그리로 돌려보낸다 — 고정된 한 자리로 보내면 보던 목록과
 * 걸러 둔 상태를 잃는다.
 *
 * 🔴 **폼에서 온 글자를 그대로 `redirect()` 에 넣으면 안 된다.** 폼 값은 사람이 고쳐 보낼 수 있어서,
 *    그대로 믿으면 `https://evil.example` · `//evil.example`(스킴 없는 바깥 주소) 같은 것으로 사람을 보내는
 *    구멍(open redirect)이 된다. **받는 값은 아래 두 가지뿐**이고 나머지는 전부 기록 내역으로 떨어뜨린다 —
 *    이 함수가 그 울타리다.
 * 🔵 **순수 함수로 따로 둔 까닭**: 울타리는 시험으로 지킨다(`tests/stock-return-to.test.ts`).
 *    서버 액션 파일(`src/app/actions/stock.ts`)에 두면 **내보낼 수 없다** — `"use server"` 파일은
 *    async 함수만 내보낼 수 있어 시험이 끌어오지 못한다. 그래서 거르는 자리는 여기 **한 곳**이다.
 * 🔵 server-only 를 끌어오지 않는다 — 클라이언트 묶음(`RequestActions`)도 칸 이름을 여기서 읽는다.
 */

/** 폼에 싣는 숨은 칸 이름. 🔴 화면과 서버가 **같은 글자**를 보게 한 곳에 둔다. */
export const RETURN_TO_FIELD = "returnTo";

/**
 * 돌아갈 수 있는 자리 전부. 단추 묶음을 쓰는 화면이 늘면 여기에 더한다(그리고 시험도 함께).
 *
 * 🔴 **둘인데 단추는 `/requests` 에만 있다 — 일부러 그대로 둔다** (2026-10-15, 기록 내역의 「확인 대기」 구역을
 *    걷어내면서). `/entries` 가 남아 있어야 하는 까닭 둘:
 *    ① **아래 `safeReturnTo` 의 기본값이 `/entries`** 다. 폼 값이 없거나 깨져서 떨어뜨릴 때 가는 자리이고,
 *       목록에 없는 주소로 떨어뜨리면 「거른 값」과 「기본값」이 서로 다른 규칙이 된다.
 *    ② 거기로 **지금도 돌아간다**: [확인]으로 적힌 기록은 기록 내역에 쌓이고, 그 화면은 `?saved=…` 를 읽어
 *       기록 번호를 말해 준다(`request-notice.ts`). 자리를 좁히는 것은 **막는 일이 아니라 잃는 일**이다.
 *    🔵 반대로 **글자를 더하는 것은 위험하다** — 여기 든 값이 곧 「사람을 보내도 되는 주소」이기 때문이다.
 */
export const RETURN_TO_PATHS = ["/entries", "/requests"] as const;

export type ReturnToPath = (typeof RETURN_TO_PATHS)[number];

/**
 * 폼에서 온 값을 돌아가도 되는 자리로 거른다. 아니면 **기록 내역**(단추가 생기기 전의 자리).
 *
 * 🔴 **정확히 같은 글자만** 통과시킨다. `startsWith("/")` 로 재면 `//evil.example`(브라우저가 바깥
 *    주소로 읽는다)이 뚫리고, 조건 줄기를 붙인 `/requests?x=1` 까지 받으면 받는 값이 열려 버린다.
 */
export function safeReturnTo(value: unknown): ReturnToPath {
  return typeof value === "string" && (RETURN_TO_PATHS as readonly string[]).includes(value) ? (value as ReturnToPath) : "/entries";
}
