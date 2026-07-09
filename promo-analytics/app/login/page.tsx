"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// 키컬러(딥그린) 전면 히어로 — Neo Organic 커버 톤(#153633→#1C4842→#24564D) + 유기적 블롭.
const HERO_BG =
  "radial-gradient(circle at 78% 22%, rgba(133,211,179,.22), transparent 30%)," +
  "radial-gradient(circle at 12% 78%, rgba(110,157,180,.16), transparent 26%)," +
  "linear-gradient(145deg,#153633 0%,#1C4842 56%,#24564D 100%)";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const params = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : null;
  const domainError = params?.get("error") === "domain";

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
  }

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
      style={{ background: HERO_BG }}
    >
      {/* 유기적 블롭 (Neo Organic) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-[6%] h-[380px] w-[420px]"
        style={{
          borderRadius: "64% 36% 38% 62% / 50% 62% 38% 50%",
          background: "rgba(233,247,240,.06)",
          border: "1px solid rgba(255,255,255,.06)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 bottom-[-8%] h-[440px] w-[480px]"
        style={{
          borderRadius: "48% 52% 62% 38% / 42% 35% 65% 58%",
          background: "linear-gradient(145deg, rgba(88,172,142,.16), rgba(255,255,255,0))",
          filter: "blur(2px)",
        }}
      />

      <div className="relative w-full max-w-sm text-center">
        <div
          className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-3xl text-lg font-bold"
          style={{
            background: "rgba(255,255,255,.10)",
            border: "1px solid rgba(255,255,255,.18)",
            color: "#8FD7B8",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          P
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">
          캠페인 애널리틱스
        </h1>
        <p className="mt-2 text-sm" style={{ color: "rgba(165,225,198,.92)" }}>
          닥터펠리스 사내 전용 · 매출 기여도 측정 · 예측 · 처방
        </p>

        {domainError && (
          <div
            className="mt-4 rounded-xl px-3 py-2 text-sm text-white"
            style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.18)" }}
          >
            <strong>@drfelis.com</strong> 계정만 접근할 수 있어요.
          </div>
        )}

        <button
          onClick={signIn}
          disabled={loading}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink shadow-[0_18px_40px_-16px_rgba(0,0,0,.5)] transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
          </svg>
          {loading ? "이동 중…" : "Google로 로그인"}
        </button>
      </div>
    </main>
  );
}
