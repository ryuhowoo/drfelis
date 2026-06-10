"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { won, wonShort, pct } from "@/lib/format";
import { predict, type CaseFeature, type PredictionSpec } from "@/lib/predict";

type Options = { benefitTypes: string[]; seasonalities: string[]; purposes: string[] };

const BRAND = "#e76f51";

type Scenario = {
  label: string;
  uplift: number;
  promoDaily: number;
  baselineDaily: number;
  ratio: number | null;
  contribution: number;
};

export default function Simulator({ cases, options }: { cases: CaseFeature[]; options: Options }) {
  const [promoType, setPromoType] = useState(options.benefitTypes[0] ?? "할인");
  const [seasonTag, setSeasonTag] = useState("");
  const [purpose, setPurpose] = useState("");
  const [discount, setDiscount] = useState(40);
  const [days, setDays] = useState(4);
  const [pinned, setPinned] = useState<Scenario[]>([]);

  const spec: PredictionSpec = {
    promo_type: promoType || null,
    season_tag: seasonTag || null,
    purpose: purpose || null,
    discount_rate: discount / 100,
    duration_days: days,
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pred = useMemo(() => predict(spec, cases), [promoType, seasonTag, purpose, discount, days, cases]);

  // 할인율별 예상 증분/공헌이익 곡선
  const curve = useMemo(() => {
    const out: { discount: number; uplift: number; contribution: number }[] = [];
    for (let d = 0; d <= 70; d += 5) {
      const p = predict({ ...spec, discount_rate: d / 100 }, cases);
      out.push({
        discount: d,
        uplift: Math.round(p.expected_uplift),
        contribution: Math.round(p.expected_contribution),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoType, seasonTag, purpose, days, cases]);

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

  function pin() {
    setPinned((prev) =>
      [
        ...prev,
        {
          label: `${promoType || "?"} ${discount}%·${days}일${seasonTag ? `·${seasonTag}` : ""}${purpose ? `·${purpose}` : ""}`,
          uplift: pred.expected_uplift,
          promoDaily: pred.expected_promo_daily,
          baselineDaily: pred.expected_baseline_daily,
          ratio: pred.lift_ratio,
          contribution: pred.expected_contribution,
        },
      ].slice(-3),
    );
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
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">성과 시뮬레이터</h1>
        <p className="mt-1 text-sm text-neutral-500">
          조건을 움직이면 과거 사례 기반으로 <strong>상시 대비 예상 매출</strong>이 즉시 갱신됩니다.
        </p>
      </header>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-5">
        {/* 컨트롤 */}
        <section className="rounded-2xl p-6 card-soft lg:col-span-2">
          <Field label="혜택 종류">
            <Chips options={options.benefitTypes} value={promoType} onChange={setPromoType} />
          </Field>
          <Field label="시즈널리티">
            <Chips options={options.seasonalities} value={seasonTag} onChange={setSeasonTag} clearable />
          </Field>
          <Field label="목적">
            <Chips options={options.purposes} value={purpose} onChange={setPurpose} clearable />
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
              onChange={(e) => setDiscount(Number(e.target.value))}
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
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
          </div>

          <button
            onClick={pin}
            className="mt-6 w-full rounded-full border border-neutral-200 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
          >
            + 이 시나리오 비교에 담기
          </button>
        </section>

        {/* 결과 */}
        <section className="rounded-2xl p-6 card-soft lg:col-span-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-neutral-400">평소 대비 예상 매출</div>
              <div className="mt-0.5 text-4xl font-bold tracking-tight text-brand-500">
                {pred.lift_ratio != null ? `${pred.lift_ratio.toFixed(1)}배` : "—"}
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
            <Mini label="예상 총 증분" value={won(curUplift)} />
            <Mini label="예상 공헌이익" value={wonShort(pred.expected_contribution)} sub={pred.expected_contribution_rate != null ? `이익률 ${pct(pred.expected_contribution_rate)}` : undefined} />
            <Mini label="예상 범위" value={`${wonShort(pred.low)}~${wonShort(pred.high)}`} />
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
            onClick={() => setDiscount(bestEffect.discount)}
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
            onClick={() => setDiscount(bestEfficiency.discount)}
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
      </section>

      {/* 시나리오 비교 */}
      {pinned.length > 0 && (
        <section className="mt-3 rounded-2xl p-6 card-soft sm:mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700">시나리오 비교</h2>
            <button onClick={() => setPinned([])} className="text-xs text-neutral-400 hover:text-brand-600">
              초기화
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {pinned.map((s, i) => (
              <div key={i} className="rounded-2xl bg-neutral-50 p-4">
                <div className="truncate text-xs font-medium text-neutral-500">{s.label}</div>
                <div className="mt-1 text-lg font-bold text-brand-600">
                  {s.ratio != null ? `${s.ratio.toFixed(1)}배` : "—"}
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-neutral-500">
                  <div className="flex justify-between"><span>증분</span><span className="tabular-nums text-neutral-700">{wonShort(s.uplift)}</span></div>
                  <div className="flex justify-between"><span>공헌이익</span><span className="tabular-nums text-neutral-700">{wonShort(s.contribution)}</span></div>
                </div>
              </div>
            ))}
          </div>
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
          className={`h-full rounded-full ${tone === "brand" ? "bg-brand-500" : "bg-neutral-300"}`}
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-700">{wonShort(value)}</span>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-neutral-50 p-3">
      <div className="text-[11px] text-neutral-400">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{value}</div>
      {sub && <div className="text-[11px] text-neutral-400">{sub}</div>}
    </div>
  );
}
