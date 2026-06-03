"use client";

import { useState } from "react";
import Link from "next/link";
import { PROMO_TYPES, SEASON_TAGS } from "@/lib/constants";
import { won, wonShort, pct } from "@/lib/format";
import type { Prediction } from "@/lib/predict";

export default function PredictPage() {
  const [promoType, setPromoType] = useState("");
  const [seasonTag, setSeasonTag] = useState("");
  const [discount, setDiscount] = useState("");
  const [days, setDays] = useState("4");
  const [result, setResult] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promo_type: promoType || null,
          season_tag: seasonTag || null,
          discount_rate: discount ? Number(discount) / 100 : null,
          duration_days: Number(days) || 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setLoading(false);
    }
  }

  const confColor =
    result?.confidence === "높음"
      ? "text-green-700 bg-green-50"
      : result?.confidence === "보통"
        ? "text-amber-700 bg-amber-50"
        : "text-neutral-600 bg-neutral-100";

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">예상 매출 추산</h1>
      <p className="mt-1 text-sm text-neutral-500">
        계획 중인 프로모션 조건을 넣으면 유사 사례로 예상 증분을 추산합니다.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 입력 */}
        <div className="rounded-[24px] bg-white card-soft p-5">
          <Field label="혜택 종류">
            <Chips options={PROMO_TYPES} value={promoType} onChange={setPromoType} />
          </Field>
          <Field label="시점 / 시즌">
            <Chips options={SEASON_TAGS} value={seasonTag} onChange={setSeasonTag} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="대표 할인율(%)">
              <input
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                inputMode="numeric"
                placeholder="50"
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="기간(일)">
              <input
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {loading ? "추산 중…" : "예상 매출 추산"}
          </button>
          {error && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        {/* 결과 */}
        <div className="rounded-[24px] bg-white card-soft p-5">
          {!result ? (
            <p className="text-sm text-neutral-400">
              조건을 입력하고 추산을 실행하세요.
            </p>
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">예상 총 증분</span>
                <span className={`rounded-full px-2.5 py-1 text-xs ${confColor}`}>
                  신뢰도 {result.confidence}
                </span>
              </div>
              <div className="mt-1 text-3xl font-bold">
                {won(result.expected_uplift)}
              </div>
              <div className="mt-1 text-sm text-neutral-500">
                범위 {wonShort(result.low)} ~ {wonShort(result.high)} · 일평균{" "}
                {wonShort(result.expected_uplift_per_day)}
              </div>
              <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                {result.rationale}
              </p>

              {result.comparables.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-medium text-neutral-500">
                    근거가 된 유사 사례
                  </div>
                  <ul className="space-y-1.5">
                    {result.comparables.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <Link
                          href={`/promotions/${c.id}`}
                          className="truncate text-neutral-700 hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="ml-2 shrink-0 text-neutral-400">
                          유사도 {pct(c.score, 0)} · 일 {wonShort(c.uplift_per_day)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      {children}
    </div>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? "" : o)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            value === o
              ? "border-neutral-900 bg-brand-500 text-white"
              : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
