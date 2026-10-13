import { NextResponse } from "next/server";

/**
 * **상대 경로**(`/login?error=…`)를 Location 헤더에 넣는 307 응답.
 *
 * 왜 `NextResponse.redirect(new URL(path, request.url))` 를 쓰지 않는가:
 * `next dev` 가 주는 `request.url` 의 호스트가 들어온 `Host` 헤더와 상관없이 **늘 `localhost`** 다.
 * 그래서 사내망 주소(`192.168.1.132:3800`)로 들어온 사람도 `http://localhost:3800/…` 로 끌려가고,
 * 거기엔 방금 구운 세션·왕복 쿠키가 없어 로그인이 무한히 다시 돈다(2026-10-13 실측).
 *
 * HTTP 는 상대 `Location` 을 허용하고 브라우저가 **지금 보고 있는 호스트 기준**으로 푼다.
 * 그래서 localhost 로 들어오든 사내망 IP 로 들어오든 나중에 도메인으로 바뀌든 그 자리에 머문다 —
 * 설정에 자기 주소를 박아 둘 필요가 없다. 🔴 `NextResponse.redirect` 로 「되돌리면 깔끔하다」며
 * 돌리지 마라. 그건 절대 URL 만 받으므로 위 병이 그대로 돌아온다.
 *
 * 돌려주는 값은 `NextResponse` 라서 `res.cookies.set(...)` 을 그대로 쓸 수 있다.
 *
 * 🔵 포털처럼 **다른 사이트**로 보낼 때는 이 함수를 쓰지 않는다 (절대 주소가 맞다).
 */
export function redirectRelative(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: safePath(path) } });
}

/**
 * Location 에 넣어도 되는 **같은 사이트 경로**인지 마지막으로 한 번 더 본다.
 * 돌아갈 곳은 이미 `safeReturnTo()` 가 거르지만(session-codec.ts) 그 방어를 믿고 빼지 않는다.
 * 여기서 더 막는 것은 헤더에 줄바꿈이 섞여 들어가는 것(헤더 조작)이다.
 */
function safePath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return "/";
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return "/"; // CR·LF 등 제어 문자
  }
  return path;
}
