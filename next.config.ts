import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NAS(Synology DS218+) Docker 컨테이너에 올리기 위해. CLAUDE.md 12-2절.
  output: "standalone",
  // 사내 시스템은 아이콘·이미지 최적화 서버를 쓰지 않는다(네이티브 바이너리 sharp 를 피한다).
  images: { unoptimized: true },
  // 🔴 Next 16 은 dev 서버가 뜰 때 프로젝트 루트의 CLAUDE.md 에 자기 규칙을 써 넣으려 한다.
  //    이 저장소의 CLAUDE.md 는 담당자가 정한 프로젝트 규칙이라 건드리면 안 된다. 꺼 둔다.
  agentRules: false,

  /**
   * 개발 서버를 localhost 가 아닌 주소로 열 때 허용할 곳.
   *
   * 이것이 없으면 Next 가 개발 전용 리소스(HMR 웹소켓·폰트)를 막는다. 그러면
   * 화면은 멀쩡히 뜨는데 **React 가 붙지 않아** 버튼이 전부 죽는다. 오류 문구가
   * 나지 않아 코드를 의심하게 되는 종류의 고장이다 — 사내 다른 시스템에서 실제로
   * 겪었다. 통합 알림 종은 `<details>` 라 스크립트 없이도 열리지만, 바깥 클릭과
   * Esc 로 접는 일(@dss/ui 의 BellBehavior)은 React 가 붙어야만 돈다 —
   * 「종은 열리는데 바깥을 눌러도 안 닫힌다」가 바로 이 설정이 없을 때의 증상이다.
   *
   * 사내망 대역을 통째로 적어 둔다. 이 PC 의 Wi-Fi 주소는 자주 바뀌는데,
   * 바뀔 때마다 여기까지 고치게 하면 결국 또 빠뜨린다.
   *
   * 칸마다 별표 하나씩 네 칸(192.168.*.*)이어야 한다. Next 의 대조기는 칸을
   * 뒤에서부터 하나씩 맞추고 마지막에 남은 칸이 없어야 통과시키므로
   * (node_modules/next/dist/server/app-render/csrf-protection.js),
   * "192.168.*" 나 "192.168.**" 는 칸 수가 모자라 오히려 막힌다 — 다른 사내
   * 시스템에서 실측으로 확인했다. 줄여 쓰고 싶어지더라도 그대로 둘 것.
   * (개발 서버에만 적용된다. next build 결과에는 영향이 없다.)
   */
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
