import type { Metadata } from "next";
import { Asta_Sans } from "next/font/google";
import "./globals.css";

const astaSans = Asta_Sans({
  subsets: ["latin"],
  variable: "--font-asta-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "캠페인 애널리틱스",
  description: "드르펠리스 사내 · 캠페인 매출 기여도 측정 · 예측 · 처방",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`h-full antialiased ${astaSans.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
