"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

// 새 모델의 진입점 — 1·2단계: 캠페인 생성 + 목적/기간.
// 목적은 3종 고정(세일즈/브랜딩/재고소진), 1~10 정수 가중치 → 정규화 비율(%) 자동 표기.
const PURPOSES = [
  { key: "세일즈", desc: "매출·판매 극대화" },
  { key: "브랜딩", desc: "인지·구매건수 확대" },
  { key: "재고소진", desc: "재고 회전·소진" },
] as const;

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = useMemo(
    () => PURPOSES.filter((p) => weights[p.key] != null),
    [weights],
  );
  const total = useMemo(
    () => selected.reduce((s, p) => s + (weights[p.key] || 0), 0),
    [selected, weights],
  );

  function toggle(key: string) {
    setWeights((w) => {
      const next = { ...w };
      if (next[key] != null) delete next[key];
      else next[key] = 5; // 기본 가중치
      return next;
    });
  }
  function setWeight(key: string, v: number) {
    setWeights((w) => ({ ...w, [key]: Math.max(1, Math.min(10, v)) }));
  }

  const canSave = name.trim() && start && end && end >= start && selected.length > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), start_date: start, end_date: end, purposes: selected.map((p) => p.key), weights }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 실패");
      router.push(`/promotions/${data.promotion_id}/plan`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "생성 실패");
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-1 text-sm text-ink-4">
        <Link href="/" className="hover:underline">대시보드</Link> / 새 캠페인
      </div>
      <h1 className="text-xl font-semibold text-ink">새 캠페인 만들기</h1>
      <p className="mt-1 text-sm text-ink-3">
        캠페인 하나 = 한 번의 행사. 여기서 목적·기간을 정하면 바로 플랜 작성으로 이어집니다.
      </p>

      <div className="mt-6 grid max-w-3xl gap-4 rise-in">
        {/* 기본 정보 */}
        <section className="rounded-2xl card-soft p-5 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-ink-2">기본 정보</h2>
          <label className="block text-xs font-medium text-ink-3">캠페인 이름</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 한가위 고양이 대잔치"
            className="mt-1.5 w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-brand-400"
          />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-3">시작일</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-3">종료일</label>
              <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-brand-400" />
            </div>
          </div>
        </section>

        {/* 목적 + 가중치 */}
        <section className="rounded-2xl card-soft p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-ink-2">목적 &amp; 가중치</h2>
          <p className="mt-1 text-xs text-ink-4">
            복수 선택 가능 · 각 1~10 가중치 → 비율은 자동 계산됩니다.
          </p>
          <div className="mt-4 space-y-2.5">
            {PURPOSES.map((p) => {
              const on = weights[p.key] != null;
              const share = on && total > 0 ? Math.round(((weights[p.key] || 0) / total) * 100) : 0;
              return (
                <div
                  key={p.key}
                  className={`rounded-xl border p-3 transition ${on ? "border-brand-300 bg-brand-50/60" : "border-line bg-card"}`}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(p.key)}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs transition ${on ? "border-brand-500 bg-brand-500 text-white" : "border-line text-transparent"}`}
                      aria-label={`${p.key} 선택`}
                    >
                      ✓
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink">{p.key}</div>
                      <div className="text-xs text-ink-4">{p.desc}</div>
                    </div>
                    {on && (
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => setWeight(p.key, (weights[p.key] || 0) - 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg surface-pressed-soft text-ink-2 hover:text-ink">−</button>
                          <span className="w-6 text-center text-sm font-bold tabular-nums text-ink">{weights[p.key]}</span>
                          <button type="button" onClick={() => setWeight(p.key, (weights[p.key] || 0) + 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg surface-pressed-soft text-ink-2 hover:text-ink">+</button>
                        </div>
                        <span className="w-12 shrink-0 text-right text-sm font-bold tabular-nums text-brand-600">{share}%</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {err && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{err}</div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="ghost">
            <Link href="/">취소</Link>
          </Button>
          <Button onClick={save} loading={saving} disabled={!canSave}>
            캠페인 만들고 플랜 작성 →
          </Button>
        </div>
      </div>
    </div>
  );
}
