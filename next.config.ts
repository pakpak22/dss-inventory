import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NAS(Synology DS218+) Docker 컨테이너에 올리기 위해. CLAUDE.md 12-2절.
  output: "standalone",
  // 사내 시스템은 아이콘·이미지 최적화 서버를 쓰지 않는다(네이티브 바이너리 sharp 를 피한다).
  images: { unoptimized: true },
  // 🔴 Next 16 은 dev 서버가 뜰 때 프로젝트 루트의 CLAUDE.md 에 자기 규칙을 써 넣으려 한다.
  //    이 저장소의 CLAUDE.md 는 담당자가 정한 프로젝트 규칙이라 건드리면 안 된다. 꺼 둔다.
  agentRules: false,
};

export default nextConfig;
