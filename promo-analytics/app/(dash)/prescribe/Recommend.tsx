"use client";

import { useState } from "react";
import Link from "next/link";
import { won, wonShort, pct, num } from "@/lib/format";
import type { GoalRec, Goal } from "@/lib/predict";

type Options = { benefitTypes: string[]; seasonalities: string[] };

const GOALS: { key: Goal; label: string; desc: string; targetLabel: string; unit: string }[] = [
  { key: "revenue", label: "매출", desc: "기여 매출(증분)을 키우는 게 목표", targetLabel: "목표 증분 매출(₩)", unit: "won" },
  { key: "stock", label: "재고소진", desc: "메인 제품 재고를 빠르게 소진", targetLabel: "목표 판매수량(개)", unit: "qty" },
  { key: "branding", label: "브랜딩", desc: "구매 건수(저변 확대)가 목표", targetLabel: "목표 구매 건수", unit: "orders" },
];

function fmtMetric(unit: string, v: number) {
  if (unit === "won") return won(v);
  if (unit === "qty") return `${num(v)}개`;
  return `${num(v)}건`;
}

export default function Recommend({ options }: { options: Options }) {
  const [goal, setGoal] = useState<Goal>("revenue");
  const [target, setTarget] = useState("");
  const [days, setDays] = useState("4");
  const [season, setSeason] = useState("");
  const [recs, setRecs] = useState<GoalRec[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const goalDef = GOALS.find((g) => g.key === goal)!;

  async function run() {
    setLoading(true);
    setError("");
    setRecs(null);
    try {
      const res = await fetch("/api/prescribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          target: Number(target.replace(/[^0-9.]/g, "")) || 0,
          duration_days: Number(days) || 1,
          season_tag: season || null,
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
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="text-xl font-semibold tracking-tight">프로모션 추천</h1>
      <p className="mt-1 text-sm text-neutral-500">
        목적을 먼저 고르면, 과거 성과를 근거로 그 목적에 맞는 혜택 구성을 추천해요.
      </p>

      {/* 목적 탭 */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {GOALS.map((g) => (
          <button
            key={g.key}
            onClick={() => { setGoal(g.key); setRecs(null); }}
            className={`rounded-2xl border p-4 text-left transition ${
              goal === g.key
                ? "border-brand-500 bg-brand-50"
                : "border-neutral-200 bg-white hover:border-neutral-300"
            }`}
          >
            <div className={`text-base font-bold ${goal === g.key ? "text-brand-600" : "text-neutral-800"}`}>{g.label}</div>
            <div className="mt-0.5 text-xs text-neutral-500">{g.desc}</div>
          </button>
        ))}
      </div>

      {/* 입력 */}
      <div className="mt-4 rounded-[24px] bg-white p-5 card-soft">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={goalDef.targetLabel}>
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric"
              placeholder={goal === "revenue" ? "50000000" : goal === "stock" ? "3000" : "1000"}
              className={inputCls} />
          </Field>
          <Field label="기간(일)">
            <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className={inputCls} />
          </Field>
          <Field label="시즈널리티 (선택)">
            <select value={season} onChange={(e) => setSeason(e.target.value)} className={inputCls}>
              <option value="">무관</option>
              {options.seasonalities.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <button onClick={run} disabled={loading}
          className="mt-4 rounded-full bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
          {loading ? "분석 중…" : "추천 받기"}
        </button>
        {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {recs && (
        <div className="mt-6">
          {recs.length === 0 ? (
            <p className="rounded-[24px] border border-dashed border-neutral-300 bg-white px-6 py-10 text-center text-sm text-neutral-400">
              추천할 사례가 부족합니다. 프로모션 데이터를 더 쌓아주세요.
            </p>
          ) : (
            <div className="space-y-3">
              {recs.map((r, i) => (
                <div key={i} className={`rounded-[24px] bg-white p-5 card-soft ${i === 0 ? "ring-2 ring-brand-500" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {i === 0 && <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white">추천 1순위</span>}
                        <span className="text-base font-bold">
                          {r.promo_type}{r.discount_rate != null && ` · ${pct(r.discount_rate, 0)} 할인`}
                        </span>
                        {r.meets_target && <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">목표 달성</span>}
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">신뢰도 {r.confidence}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
                        <span>예상 {goalDef.label}: <strong className="text-neutral-800">{fmtMetric(goalDef.unit, r.predicted_metric)}</strong></span>
                        <span>예상 증분: {wonShort(r.predicted_uplift)}</span>
                        <span>예상 공헌이익: {wonShort(r.predicted_contribution)}</span>
                        <span>근거 {r.sample}건</span>
                      </div>
                      {r.examples.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {r.examples.map((e) => (
                            <Link key={e.id} href={`/promotions/${e.id}`}
                              className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:text-brand-600">
                              {e.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-neutral-400">종합 점수</div>
                      <div className="text-2xl font-bold text-brand-600">{r.score}</div>
                    </div>
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

const inputCls = "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-neutral-700">{label}</label>
      {children}
    </div>
  );
}
