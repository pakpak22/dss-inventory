/**
 * 서버가 뜰 때 한 번 돈다 (Next.js instrumentation). 빌드 때는 돌지 않는다.
 *  1. 빠진 환경변수를 **첫 요청이 아니라 시작할 때** 한꺼번에 알려 준다 (CLAUDE.md 12-1절 6번).
 *  2. 엑셀 한 벌 자동 갱신을 1분마다 돌린다 (조각 7, DESIGN 6-5절). 바뀐 것이 없으면 아무것도 안 한다.
 *     개발 중 끄려면 `WORKBOOK_SYNC_DISABLED=1`. 같은 프로세스에서 두 번 걸리지 않게 globalThis 에 표시한다(개발 서버가 모듈을 다시 불러도).
 *
 * 🔴 node 전용 코드는 반드시 `if (process.env.NEXT_RUNTIME === "nodejs") { … }` **블록 안**에서 동적 import 한다.
 *    이 파일은 edge 런타임용으로도 컴파일되는데, 웹팩은 상수 조건의 if 블록만 죽은 가지로 걷어낸다.
 *    `if (…!== "nodejs") return;` 처럼 먼저 빠져나오는 꼴은 걷어내지 못해 edge 컴파일이 `node:crypto` 에서
 *    "Unhandled scheme" 으로 깨지고 개발 서버의 모든 페이지가 500 이 된다(2026-10-12 에 밟음).
 *    같은 파일 안의 다른 함수로 빼도 소용없다 — 본문은 `instrumentation-node.ts` 에 두고 여기서는 import 만 한다.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
