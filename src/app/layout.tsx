import type { Metadata } from "next";
import "./globals.css";
import "@dss/ui/styles.css";
import "@dss/ui/notification-bell.css";

export const metadata: Metadata = {
  title: { default: "재고 관리", template: "%s · 재고 관리" },
  description: "DSS 부품 재고 관리",
};

/**
 * 루트 레이아웃. 폰트는 next/font 를 쓰지 않고 시스템 폰트 스택 (CLAUDE.md 9-1절).
 * `@dss/ui/styles.css` 는 공용 패키지(서브모듈 vendor/dss-ui)의 시스템 오가기 메뉴 스타일 — 여기서 한 번만 부른다 (9-5절).
 * 그 조각은 CSS 를 스스로 부르지 않는다(번들러 없이 도는 시험을 지키려고).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
