import type { Metadata } from "next";
import "@fontsource-variable/asta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "캠페인 애널리틱스",
  description: "닥터펠리스 사내 · 캠페인 매출 기여도 측정 · 예측 · 처방",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
