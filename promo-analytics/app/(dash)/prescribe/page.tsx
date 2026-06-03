"use client";

import { useState } from "react";
import { SEASON_TAGS } from "@/lib/constants";
import { won, wonShort, pct } from "@/lib/format";
import type { Recommendation } from "@/lib/predict";

export default function PrescribePage() {
  const [target, setTarget] = useState("");
  const [days, setDays] = useState("4");
  const [seasonTag, setSeasonTag] = useState("");
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    setRecs(null);
    try {
      const res = await fetch("/api/prescribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_uplift: Number(target.replace(/[^0-9]/g, "")),
          duration_days: Number(days) || 1,
          season_tag: seasonTag || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecs(data.recommendations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="text-xl font-semibold">프로모션 처방</h1>
      <p className="mt-1 text-sm text-neutral-500">
        목표 증분을 입력하면, 과거 성과를 근거로 어떤 혜택 구성이 좋을지
        추천합니다. (공헌이익률 우선 정렬)
      </p>

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="목표 증분(₩)">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="numeric"
              placeholder="50000000"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="기간(일)">
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="시점 / 시즌 (선택)">
            <select
              value={seasonTag}
              onChange={(e) => setSeasonTag(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">무관</option>
              {SEASON_TAGS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="mt-4 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? "분석 중…" : "추천 받기"}
        </button>
        {error && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      {recs && (
        <div className="mt-6">
          {recs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center text-sm text-neutral-400">
              추천할 사례가 부족합니다. 프로모션 데이터를 더 쌓아주세요.
            </p>
          ) : (
            <div className="space-y-3">
              {recs.map((r, i) => (
                <div
                  key={i}
                  className={`rounded-xl border bg-white p-5 ${
                    r.meets_target ? "border-neutral-900" : "border-neutral-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold">
                          {r.promo_type}
                          {r.discount_rate != null &&
                            ` · ${pct(r.discount_rate, 0)} 할인`}
                        </span>
                        {r.meets_target && (
                          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                            목표 달성
                          </span>
                        )}
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                          신뢰도 {r.confidence}
                        </span>
                      </div>
                      {r.season_tag && (
                        <div className="mt-1 text-xs text-neutral-400">
                          시즌: {r.season_tag}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-neutral-400">예상 증분</div>
                      <div className="text-lg font-bold">
                        {won(r.predicted_uplift)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-4 text-xs text-neutral-500">
                    <span>
                      평균 공헌이익률{" "}
                      <strong className="text-neutral-700">
                        {pct(r.avg_contribution_rate)}
                      </strong>
                    </span>
                    <span>근거 사례 {r.sample}건</span>
                    <span className="ml-auto">
                      일평균 {wonShort(r.predicted_uplift / (Number(days) || 1))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      {children}
    </div>
  );
}
