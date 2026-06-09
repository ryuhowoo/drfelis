"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm rounded-[28px] bg-canvas p-8 card-soft">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas text-base font-bold text-brand-600 card-soft">
          P
        </div>
        <h1 className="text-xl font-semibold text-ink">
          캠페인 애널리틱스
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          닥터펠리스 사내 전용 · 매출 기여도 측정 · 예측 · 처방
        </p>

        {domainError && (
          <div className="mt-4 rounded-xl px-3 py-2 text-sm text-brand-700 surface-pressed-soft">
            <strong>@drfelis.com</strong> 계정만 접근할 수 있어요.
          </div>
        )}

        <button
          onClick={signIn}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-canvas px-4 py-2.5 text-sm font-semibold text-ink card-soft transition hover:card-soft-h disabled:opacity-60"
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
