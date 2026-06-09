"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "대시보드", icon: "M3.5 12l8.5-8 8.5 8M5.5 10.5V19a1 1 0 001 1h3.5v-5h3v5H18a1 1 0 001-1v-8.5" },
  { href: "/predict", label: "매출 시뮬레이터", icon: "M4 18l5-5 3 3 7-8M21 8v4m0-4h-4" },
  { href: "/prescribe", label: "캠페인 추천", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 104 0M9 5a2 2 0 014 0m-3 8l2 2 3-4" },
  { href: "/library", label: "히스토리 비교/분석", icon: "M4 7h16M4 12h16M4 17h10" },
  { href: "/upload", label: "데이터 업로드", icon: "M12 16V4m0 0l-4 4m4-4l4 4M5 20h14" },
  { href: "/settings", label: "설정", icon: "M10.3 4.3a1 1 0 011.4 0l.7.7a1 1 0 00.9.3l1-.2a1 1 0 011.2.9l.1 1a1 1 0 00.6.8l.9.4a1 1 0 01.5 1.3l-.4.9a1 1 0 000 .9l.4.9a1 1 0 01-.5 1.3l-.9.4a1 1 0 00-.6.8l-.1 1a1 1 0 01-1.2.9l-1-.2a1 1 0 00-.9.3l-.7.7a1 1 0 01-1.4 0M12 9a3 3 0 100 6 3 3 0 000-6z" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map((n) => {
        const active = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition ${
              active
                ? "surface-pressed text-ink"
                : "text-ink-3 hover:text-ink"
            }`}
          >
            <svg
              className={`h-[18px] w-[18px] shrink-0 ${active ? "text-brand-500" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={n.icon} />
            </svg>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-canvas text-sm font-bold text-brand-600 card-soft">
        P
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight text-ink">캠페인 애널리틱스</span>
        <span className="block text-[11px] text-ink-4">드르펠리스 MD</span>
      </span>
    </Link>
  );
}

function UserFooter({ email }: { email?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="rounded-2xl px-3 py-2.5 surface-pressed-soft">
        <div className="truncate text-xs font-medium text-ink-2">{email}</div>
        <form action="/auth/signout" method="post">
          <button className="mt-0.5 text-xs text-ink-4 hover:text-brand-600">
            로그아웃
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AppShell({
  email,
  children,
}: {
  email?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen md:flex">
      {/* 데스크톱 사이드바 */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col py-4 md:flex">
        <div className="px-5 py-4">
          <Brand />
        </div>
        <NavLinks />
        <div className="mt-auto">
          <UserFooter email={email} />
        </div>
      </aside>

      {/* 모바일 상단바 */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-canvas/85 px-4 backdrop-blur md:hidden">
        <Brand />
        <button
          onClick={() => setOpen(true)}
          aria-label="메뉴 열기"
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-canvas text-ink-2 card-soft"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* 모바일 드로어 */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-72 flex-col bg-canvas py-4 card-soft-h">
            <div className="flex items-center justify-between px-5 py-4">
              <Brand />
              <button
                onClick={() => setOpen(false)}
                aria-label="메뉴 닫기"
                className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-3 hover:text-ink"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-auto">
              <UserFooter email={email} />
            </div>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 md:py-4 md:pr-4">
        <div className="min-h-full md:rounded-[32px] md:bg-canvas md:card-soft">{children}</div>
      </main>
    </div>
  );
}
