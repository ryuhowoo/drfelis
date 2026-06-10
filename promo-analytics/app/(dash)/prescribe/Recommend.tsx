"use client";

import { useState } from "react";
import Link from "next/link";
import { won, wonShort, pct, num } from "@/lib/format";
import type { GoalRec, Goal } from "@/lib/predict";

type Options = { benefitTypes: string[]; seasonalities: string[]; purposes: string[] };

const GOALS: { key: Goal; label: string; desc: string; targetLabel: string; unit: "won" | "qty" | "orders"; placeholder: string }[] = [
  { key: "revenue",  label: "세일즈",   desc: "기여 매출(증분)을 키우는 게 목표",   targetLabel: "목표 증분 매출(₩)", unit: "won",    placeholder: "50000000" },
  { key: "stock",    label: "재고소진", desc: "메인 제품 재고를 빠르게 소진",        targetLabel: "목표 판매수량(개)",  unit: "qty",    placeholder: "3000" },
  { key: "branding", label: "브랜딩",   desc: "구매 건수(저변 확대)가 목표",         targetLabel: "목표 구매 건수",     unit: "orders", placeholder: "1000" },
];

const GOAL_LABEL: Record<Goal, string> = {
  revenue: "세일즈",
  stock: "재고소진",
  branding: "브랜딩",
};

function fmtMetric(unit: "won" | "qty" | "orders", v: number) {
  if (unit === "won") return won(v);
  if (unit === "qty") return `${num(v)}개`;
  return `${num(v)}건`;
}

function unitFor(g: Goal): "won" | "qty" | "orders" {
  return GOALS.find((x) => x.key === g)!.unit;
}

export default function Recommend({ options }: { options: Options }) {
  const [selected, setSelected] = useState<Goal[]>(["revenue"]);
  const [targets, setTargets] = useState<Record<Goal, string>>({
    revenue: "",
    stock: "",
    branding: "",
  });
  const [days, setDays] = useState("4");
  const [season, setSeason] = useState("");
  const [recs, setRecs] = useState<GoalRec[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggleGoal(g: Goal) {
    setRecs(null);
    setSelected((s) => {
      if (s.includes(g)) {
        // 최소 1개는 남겨둠
        if (s.length === 1) return s;
        return s.filter((x) => x !== g);
      }
      return [...s, g];
    });
  }
  function setTarget(g: Goal, v: string) {
    setTargets((t) => ({ ...t, [g]: v }));
  }

  async function run() {
    setLoading(true);
    setError("");
    setRecs(null);
    try {
      const goal_targets = selected.map((g) => ({
        goal: g,
        target: Number(targets[g].replace(/[^0-9.]/g, "")) || 0,
      }));
      const res = await fetch("/api/prescribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal_targets,
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
      <h1 className="text-xl font-semibold tracking-tight">캠페인 추천</h1>
      <p className="mt-1 text-sm text-neutral-500">
        목적을 하나 또는 여러 개 선택하면, 과거 성과를 근거로 그에 맞는 혜택 구성을 추천해요.
        (예: <strong>브랜딩</strong> + <strong>세일즈</strong> 혼합)
      </p>

      {/* 목적 선택 — 다중선택 */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {GOALS.map((g) => {
          const active = selected.includes(g.key);
          return (
            <button
              key={g.key}
              onClick={() => toggleGoal(g.key)}
              className={`rounded-2xl border p-4 text-left transition ${
                active
                  ? "border-brand-500 bg-brand-50"
                  : "border-neutral-200 bg-white hover:border-neutral-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => {}}
                  className="pointer-events-none accent-brand-500"
                />
                <div className={`text-base font-bold ${active ? "text-brand-600" : "text-neutral-800"}`}>{g.label}</div>
              </div>
              <div className="mt-0.5 text-xs text-neutral-500">{g.desc}</div>
            </button>
          );
        })}
      </div>

      {/* 입력 — 선택된 목표마다 목표값 */}
      <div className="mt-4 rounded-2xl p-5 card-soft">
        <div className="grid gap-4 sm:grid-cols-2">
          {selected.map((g) => {
            const def = GOALS.find((x) => x.key === g)!;
            return (
              <Field key={g} label={def.targetLabel}>
                <input
                  value={targets[g]}
                  onChange={(e) => setTarget(g, e.target.value)}
                  inputMode="numeric"
                  placeholder={def.placeholder}
                  className={inputCls}
                />
              </Field>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
        {selected.length > 1 && (
          <p className="mt-3 text-xs text-neutral-400">
            여러 목적을 함께 고르면, 종합 점수는 각 목적 점수의 평균으로 계산돼요.
            모든 목적의 목표를 만족하는 후보가 ‘목표 달성’으로 표시됩니다.
          </p>
        )}
      </div>

      {recs && (
        <div className="mt-6">
          {recs.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center text-sm text-neutral-400">
              추천할 사례가 부족합니다. 캠페인 데이터를 더 쌓아주세요.
            </p>
          ) : (
            <div className="space-y-3">
              {recs.map((r, i) => (
                <div key={i} className={`rounded-2xl p-5 card-soft ${i === 0 ? "ring-2 ring-brand-500" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {i === 0 && <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white">추천 1순위</span>}
                        <span className="text-base font-bold">
                          {r.promo_type}{r.discount_rate != null && ` · ${pct(r.discount_rate, 0)} 할인`}
                        </span>
                        {r.meets_target && <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">목표 달성</span>}
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">신뢰도 {r.confidence}</span>
                        <span
                          className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500"
                          title="유사 캠페인의 계획 달성 신뢰도를 랭킹·예측에 반영"
                        >
                          달성 {Math.round(r.reliability * 100)}%
                        </span>
                      </div>

                      {/* 목적별 충족도 (목표 대비) — S5.6 */}
                      <div className="mt-3 space-y-2">
                        {(r.per_goal ?? [{
                          goal: "revenue" as Goal,
                          metric_per_day: r.metric_per_day,
                          predicted_metric: r.predicted_metric,
                          target: 0,
                          meets_target: r.meets_target,
                        }]).map((pg) => {
                          const unit = unitFor(pg.goal);
                          const fulfill = pg.target > 0 ? pg.predicted_metric / pg.target : null;
                          return (
                            <div key={pg.goal}>
                              <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                                    {GOAL_LABEL[pg.goal]}
                                  </span>
                                  <span className="truncate text-neutral-500">
                                    예상 <strong className="text-neutral-800">{fmtMetric(unit, pg.predicted_metric)}</strong>
                                    {pg.target > 0 && <> / 목표 {fmtMetric(unit, pg.target)}</>}
                                  </span>
                                </span>
                                {fulfill != null && (
                                  <span className={`shrink-0 font-semibold ${pg.meets_target ? "text-green-600" : "text-amber-600"}`}>
                                    {Math.round(fulfill * 100)}%
                                  </span>
                                )}
                              </div>
                              {fulfill != null && (
                                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                                  <div
                                    className={`h-full rounded-full ${pg.meets_target ? "bg-green-500" : "bg-amber-400"}`}
                                    style={{ width: `${Math.min(100, fulfill * 100)}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
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
