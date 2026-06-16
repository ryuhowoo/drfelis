"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import {
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { won, wonShort, pct } from "@/lib/format";
import { predict, type CaseFeature, type PredictionSpec } from "@/lib/predict";
import {
  decodeScenarios,
  encodeScenarios,
  scenarioLabel,
  diffPct,
  specToSeedQuery,
  type SavedScenario,
  type SimSpec,
} from "@/lib/scenario";
import { useUrlState } from "@/hooks/useUrlState";
import { CountUp, Button, InlineAlert } from "@/components/ui";

type Options = { benefitTypes: string[]; seasonalities: string[]; purposes: string[] };

const BRAND = "#e76f51";

function toSpec(s: SimSpec): PredictionSpec {
  return {
    promo_type: s.promoType || null,
    season_tag: s.season || null,
    purpose: s.purpose || null,
    discount_rate: s.discount / 100,
    duration_days: s.days,
  };
}

export default function Simulator({ cases, options }: { cases: CaseFeature[]; options: Options }) {
  // 조건·시나리오를 URL에 보존 → 링크 복사로 같은 결과 공유 (PR7)
  const [url, setUrl] = useUrlState({
    promo: options.benefitTypes[0] ?? "할인",
    season: "",
    purpose: "",
    discount: "40",
    days: "4",
    sc: "",
  });

  const promoType = url.promo as string;
  const seasonTag = url.season as string;
  const purpose = url.purpose as string;
  const discount = Number(url.discount) || 0;
  const days = Number(url.days) || 1;

  const liveSpec: SimSpec = { promoType, season: seasonTag, purpose, discount, days };
  const scenarios = useMemo(() => decodeScenarios(url.sc as string), [url.sc]);

  const [copied, setCopied] = useState(false);

  // 슬라이더는 즉시 반응하되 무거운 곡선 계산은 지연(useDeferredValue) — 끊김 방지
  const deferredDiscount = useDeferredValue(discount);
  const deferredSpec: PredictionSpec = { ...toSpec(liveSpec), discount_rate: deferredDiscount / 100 };

  const spec: PredictionSpec = toSpec(liveSpec);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pred = useMemo(() => predict(spec, cases), [promoType, seasonTag, purpose, discount, days, cases]);

  // 할인율별 예상 증분/공헌이익 곡선 (지연된 할인율 기준 — 슬라이더 드래그 중 끊김 방지)
  const curve = useMemo(() => {
    const out: { discount: number; uplift: number; contribution: number }[] = [];
    for (let d = 0; d <= 70; d += 5) {
      const p = predict({ ...deferredSpec, discount_rate: d / 100 }, cases);
      out.push({
        discount: d,
        uplift: Math.round(p.expected_uplift),
        contribution: Math.round(p.expected_contribution),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoType, seasonTag, purpose, days, deferredDiscount, cases]);

  // 스윗스팟: 최고 효과(증분 최대) / 최고 효율(공헌이익 최대)
  const bestEffect = useMemo(
    () => curve.reduce((b, c) => (c.uplift > b.uplift ? c : b), curve[0]),
    [curve],
  );
  const bestEfficiency = useMemo(
    () => curve.reduce((b, c) => (c.contribution > b.contribution ? c : b), curve[0]),
    [curve],
  );

  const curUplift = Math.round(pred.expected_uplift);

  // 저장된 시나리오별 예측 (기준=현재 조건과 비교)
  const scenarioRows = useMemo(
    () =>
      scenarios.map((s) => {
        const p = predict(toSpec(s), cases);
        return { s, p };
      }),
    [scenarios, cases],
  );

  function setSpec(patch: Partial<SimSpec>) {
    const next: Record<string, string> = {};
    if (patch.promoType !== undefined) next.promo = patch.promoType;
    if (patch.season !== undefined) next.season = patch.season;
    if (patch.purpose !== undefined) next.purpose = patch.purpose;
    if (patch.discount !== undefined) next.discount = String(patch.discount);
    if (patch.days !== undefined) next.days = String(patch.days);
    setUrl(next);
  }

  function saveScenario() {
    const s: SavedScenario = {
      id: `s${Date.now().toString(36)}`,
      name: scenarioLabel(liveSpec),
      ...liveSpec,
    };
    const next = [...scenarios, s].slice(-4); // 최대 4개
    setUrl({ sc: encodeScenarios(next) });
  }
  function removeScenario(id: string) {
    setUrl({ sc: encodeScenarios(scenarios.filter((s) => s.id !== id)) });
  }
  function renameScenario(id: string) {
    const cur = scenarios.find((s) => s.id === id);
    const name = window.prompt("시나리오 이름", cur?.name ?? "");
    if (name == null) return;
    setUrl({ sc: encodeScenarios(scenarios.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s))) });
  }
  function applyScenario(s: SavedScenario) {
    setSpec({ promoType: s.promoType, season: s.season, purpose: s.purpose, discount: s.discount, days: s.days });
  }
  function clearScenarios() {
    setUrl({ sc: "" });
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 클립보드 불가 환경 무시 */
    }
  }

  const confColor =
    pred.confidence === "높음"
      ? "bg-emerald-50 text-emerald-700"
      : pred.confidence === "보통"
        ? "bg-amber-50 text-amber-700"
        : "bg-neutral-100 text-neutral-500";

  const maxDaily = Math.max(pred.expected_baseline_daily, pred.expected_promo_daily, 1);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">성과 시뮬레이터</h1>
          <p className="mt-1 text-sm text-neutral-500">
            조건을 움직이면 과거 사례 기반으로 <strong>상시 대비 예상 매출</strong>이 즉시 갱신됩니다.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={copyShareLink}>
            {copied ? "링크 복사됨 ✓" : "🔗 공유 링크 복사"}
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/library?${specToSeedQuery(liveSpec)}`}>이 조건으로 플랜 만들기 →</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-5">
        {/* 컨트롤 */}
        <section className="rounded-2xl p-6 card-soft lg:col-span-2">
          <Field label="혜택 종류">
            <Chips options={options.benefitTypes} value={promoType} onChange={(v) => setSpec({ promoType: v })} />
          </Field>
          <Field label="시즈널리티">
            <Chips options={options.seasonalities} value={seasonTag} onChange={(v) => setSpec({ season: v })} clearable />
          </Field>
          <Field label="목적">
            <Chips options={options.purposes} value={purpose} onChange={(v) => setSpec({ purpose: v })} clearable />
            <p className="mt-1 text-[11px] text-neutral-400">
              목적을 고르면 같은 목적 캠페인 사례를 우선 가중해 예측합니다.
            </p>
          </Field>

          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-neutral-700">할인율</span>
              <span className="font-bold text-brand-600">{discount}%</span>
            </div>
            <input
              type="range" min={0} max={70} step={5}
              value={discount}
              onChange={(e) => setSpec({ discount: Number(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </div>

          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-neutral-700">기간</span>
              <span className="font-bold text-brand-600">{days}일</span>
            </div>
            <input
              type="range" min={1} max={14} step={1}
              value={days}
              onChange={(e) => setSpec({ days: Number(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </div>

          <button
            onClick={saveScenario}
            className="mt-6 w-full rounded-full border border-neutral-200 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
          >
            + 이 시나리오 저장하고 비교
          </button>
        </section>

        {/* 결과 */}
        <section className="rounded-2xl p-6 card-soft lg:col-span-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-neutral-400">평소 대비 예상 매출</div>
              <div className="mt-0.5 text-4xl font-bold tracking-tight text-brand-500">
                {pred.lift_ratio != null ? (
                  <CountUp value={pred.lift_ratio} format={(n) => `${n.toFixed(1)}배`} />
                ) : (
                  "—"
                )}
              </div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${confColor}`}>
              신뢰도 {pred.confidence}
            </span>
          </div>

          {/* 상시 vs 행사 일평균 */}
          <div className="mt-5 space-y-2">
            <Bar label="상시 일평균" value={pred.expected_baseline_daily} max={maxDaily} tone="neutral" />
            <Bar label="예상 행사 일평균" value={pred.expected_promo_daily} max={maxDaily} tone="brand" />
          </div>

          {/* KPI */}
          <div className="mt-5 grid grid-cols-3 gap-3">
            <Mini label="예상 총 증분">
              <CountUp value={curUplift} format={won} />
            </Mini>
            <Mini
              label="예상 공헌이익"
              sub={pred.expected_contribution_rate != null ? `이익률 ${pct(pred.expected_contribution_rate)}` : undefined}
            >
              <CountUp value={pred.expected_contribution} format={wonShort} />
            </Mini>
            <Mini label="예상 범위">{`${wonShort(pred.low)}~${wonShort(pred.high)}`}</Mini>
          </div>
          <p className="mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
            {pred.rationale}
          </p>
        </section>
      </div>

      {/* 할인율 곡선 — 스윗스팟 */}
      <section className="mt-3 rounded-2xl p-6 card-soft sm:mt-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎯</span>
          <h2 className="text-2xl font-bold tracking-tight">스윗스팟 찾기</h2>
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          현재 조건({promoType || "전체"}·{days}일{seasonTag ? `·${seasonTag}` : ""})에서 할인율만 바꿨을 때의 곡선. 점이 현재 설정.
        </p>

        {/* 최고 포인트 미리보기 */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setSpec({ discount: bestEffect.discount })}
            className="rounded-2xl bg-brand-50 p-4 text-left ring-1 ring-brand-100 transition hover:ring-brand-300"
          >
            <div className="text-xs font-semibold text-brand-600">최고 효과 (증분 최대)</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-brand-600">{bestEffect.discount}% 할인</span>
              <span className="text-sm text-neutral-500">→ 증분 {wonShort(bestEffect.uplift)}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">클릭하면 이 조건으로 설정</div>
          </button>
          <button
            onClick={() => setSpec({ discount: bestEfficiency.discount })}
            className="rounded-2xl bg-neutral-900 p-4 text-left transition hover:bg-neutral-800"
          >
            <div className="text-xs font-semibold text-brand-400">최고 효율 (공헌이익 최대)</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">{bestEfficiency.discount}% 할인</span>
              <span className="text-sm text-neutral-300">→ 이익 {wonShort(bestEfficiency.contribution)}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-500">클릭하면 이 조건으로 설정</div>
          </button>
        </div>

        <p className="mb-2 mt-5 text-xs font-medium text-neutral-500">할인율별 예상 증분</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={curve} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <XAxis dataKey="discount" tickFormatter={(d) => `${d}%`} fontSize={11} stroke="#bcb8b3" tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v) => wonShort(v)} fontSize={11} stroke="#bcb8b3" tickLine={false} axisLine={false} width={56} />
            <Tooltip
              formatter={(v) => [wonShort(Number(v)), "예상 증분"] as [string, string]}
              labelFormatter={(d) => `할인율 ${d}%`}
              contentStyle={{ borderRadius: 14, border: "none", boxShadow: "0 8px 24px -8px rgba(0,0,0,.2)", fontSize: 12 }}
            />
            <Line type="monotone" dataKey="uplift" stroke={BRAND} strokeWidth={2.5} dot={{ r: 0 }} activeDot={{ r: 5 }} />
            <ReferenceDot x={discount} y={curUplift} r={6} fill={BRAND} stroke="#fff" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>

        {/* 과거 캠페인 분포 (N6 R2.2): 내 조건이 과거 어디쯤인지 */}
        <p className="mb-2 mt-5 text-xs font-medium text-neutral-500">
          과거 캠페인 분포 — 할인율 × 일평균 증분
          <span className="ml-2 font-normal text-neutral-400">
            (코랄 = 같은 혜택 유형 · 회색 = 기타 · ◎ = 현재 조건)
          </span>
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <XAxis
              type="number"
              dataKey="x"
              name="할인율"
              domain={[0, 70]}
              tickFormatter={(d) => `${d}%`}
              fontSize={11}
              stroke="#bcb8b3"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="일평균 증분"
              tickFormatter={(v) => wonShort(v)}
              fontSize={11}
              stroke="#bcb8b3"
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ strokeDasharray: "4 4" }}
              formatter={(v, key) =>
                [key === "y" ? wonShort(Number(v)) : `${v}%`, key === "y" ? "일평균 증분" : "할인율"] as [string, string]
              }
              labelFormatter={() => ""}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as { name?: string; x: number; y: number } | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-md">
                    <div className="font-medium text-ink">{p.name ?? "현재 조건"}</div>
                    <div className="mt-0.5 text-ink-3">할인 {p.x}% · 일평균 증분 {wonShort(p.y)}</div>
                  </div>
                );
              }}
            />
            <Scatter
              data={cases
                .filter((c) => c.discount_rate != null && c.promo_type !== promoType)
                .map((c) => ({ x: Math.round((c.discount_rate ?? 0) * 100), y: c.uplift_per_day, name: c.name }))}
              fill="#C7CCD6"
              isAnimationActive={false}
            />
            <Scatter
              data={cases
                .filter((c) => c.discount_rate != null && c.promo_type === promoType)
                .map((c) => ({ x: Math.round((c.discount_rate ?? 0) * 100), y: c.uplift_per_day, name: c.name }))}
              fill={BRAND}
              isAnimationActive={false}
            />
            <Scatter
              data={[{ x: discount, y: days > 0 ? curUplift / days : curUplift, name: "현재 조건 (예측)" }]}
              fill="#1B1F2A"
              shape="diamond"
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </section>

      {/* 시나리오 비교 — 기준(현재 조건) 대비 차이 */}
      {scenarioRows.length > 0 && (
        <section className="mt-3 rounded-2xl p-6 card-soft sm:mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700">
              시나리오 비교 <span className="font-normal text-neutral-400">· 기준 = 현재 조건</span>
            </h2>
            <button onClick={clearScenarios} className="text-xs text-neutral-400 hover:text-brand-600">
              전체 삭제
            </button>
          </div>

          {/* 기준 요약 */}
          <div className="mb-3 rounded-2xl bg-brand-50 p-4">
            <div className="text-xs font-semibold text-brand-600">기준 · {scenarioLabel(liveSpec)}</div>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600">
              <span>배수 <strong className="text-neutral-900">{pred.lift_ratio != null ? `${pred.lift_ratio.toFixed(1)}배` : "—"}</strong></span>
              <span>증분 <strong className="text-neutral-900">{wonShort(pred.expected_uplift)}</strong></span>
              <span>공헌이익 <strong className="text-neutral-900">{wonShort(pred.expected_contribution)}</strong></span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {scenarioRows.map(({ s, p }) => {
              const dUplift = diffPct(pred.expected_uplift, p.expected_uplift);
              const dContrib = diffPct(pred.expected_contribution, p.expected_contribution);
              return (
                <div key={s.id} className="rounded-2xl bg-neutral-50 p-4">
                  <div className="flex items-start justify-between gap-1">
                    <button
                      onClick={() => renameScenario(s.id)}
                      className="min-w-0 flex-1 truncate text-left text-xs font-medium text-neutral-600 hover:text-brand-600"
                      title="클릭하면 이름 변경"
                    >
                      {s.name}
                    </button>
                    <button
                      onClick={() => removeScenario(s.id)}
                      className="shrink-0 text-neutral-300 hover:text-red-500"
                      aria-label="시나리오 삭제"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-1 text-lg font-bold text-brand-600">
                    {p.lift_ratio != null ? `${p.lift_ratio.toFixed(1)}배` : "—"}
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-neutral-500">
                    <CompareRow label="증분" value={wonShort(p.expected_uplift)} delta={dUplift} />
                    <CompareRow label="공헌이익" value={wonShort(p.expected_contribution)} delta={dContrib} />
                  </div>
                  <button
                    onClick={() => applyScenario(s)}
                    className="mt-3 w-full rounded-full border border-neutral-200 py-1.5 text-[11px] font-medium text-neutral-600 transition hover:bg-white"
                  >
                    이 조건 불러오기
                  </button>
                </div>
              );
            })}
          </div>
          <InlineAlert tone="info" className="mt-3">
            저장한 시나리오와 현재 조건은 URL에 담깁니다 — 링크를 복사하면 그대로 공유돼요.
          </InlineAlert>
        </section>
      )}

      {/* 근거 사례 */}
      {pred.comparables.length > 0 && (
        <section className="mt-3 rounded-2xl p-6 card-soft sm:mt-4">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700">근거가 된 유사 사례</h2>
          <ul className="space-y-1.5">
            {pred.comparables.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <Link href={`/promotions/${c.id}`} className="truncate text-neutral-700 hover:text-brand-600">
                  {c.name}
                </Link>
                <span className="ml-2 shrink-0 text-xs text-neutral-400">
                  유사도 {pct(c.score, 0)} · 일증분 {wonShort(c.uplift_per_day)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium text-neutral-700">{label}</label>
      {children}
    </div>
  );
}

function Chips({
  options, value, onChange, clearable,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {clearable && (
        <button
          type="button"
          onClick={() => onChange("")}
          className={`rounded-full border px-3 py-1 text-xs transition ${value === "" ? "border-brand-500 bg-brand-500 text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"}`}
        >
          무관
        </button>
      )}
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? "" : o)}
          className={`rounded-full border px-3 py-1 text-xs transition ${value === o ? "border-brand-500 bg-brand-500 text-white" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "neutral" | "brand" }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-24 shrink-0 text-xs ${tone === "brand" ? "text-brand-600" : "text-neutral-400"}`}>{label}</span>
      <div className={`h-4 flex-1 overflow-hidden rounded-full ${tone === "brand" ? "bg-brand-50" : "bg-neutral-100"}`}>
        <div
          className={`h-full rounded-full [transition:width_var(--duration-slow)_var(--ease-standard)] ${tone === "brand" ? "bg-brand-500" : "bg-neutral-300"}`}
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-700">{wonShort(value)}</span>
    </div>
  );
}

function Mini({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-neutral-50 p-3">
      <div className="text-[11px] text-neutral-400">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{children}</div>
      {sub && <div className="text-[11px] text-neutral-400">{sub}</div>}
    </div>
  );
}

function CompareRow({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  const tone =
    delta == null ? "text-neutral-400" : delta > 0.001 ? "text-emerald-600" : delta < -0.001 ? "text-red-500" : "text-neutral-400";
  const arrow = delta == null ? "" : delta > 0.001 ? "▲" : delta < -0.001 ? "▼" : "–";
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="tabular-nums text-neutral-700">{value}</span>
        <span className={`tabular-nums ${tone}`}>
          {arrow} {delta == null ? "" : `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`}
        </span>
      </span>
    </div>
  );
}
