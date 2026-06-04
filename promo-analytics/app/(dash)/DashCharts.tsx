"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { wonShort } from "@/lib/format";

const BRAND = "#e76f51";

// 월별 증분 — 오렌지 영역 스파크라인
export function MonthlyArea({
  data,
}: {
  data: { month: string; uplift: number }[];
}) {
  if (data.length === 0)
    return (
      <div className="flex h-[120px] items-center justify-center text-sm text-neutral-300">
        데이터가 쌓이면 추세가 표시됩니다.
      </div>
    );
  return (
    <ResponsiveContainer width="100%" height={130}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
        <defs>
          <linearGradient id="upliftFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.28} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="month"
          fontSize={10}
          stroke="#bcb8b3"
          tickLine={false}
          axisLine={false}
          tickFormatter={(m: string) => m.slice(2).replace("-", ".")}
          interval="preserveStartEnd"
        />
        <Tooltip
          cursor={{ stroke: BRAND, strokeOpacity: 0.3 }}
          formatter={(v) => [wonShort(Number(v)), "증분"] as [string, string]}
          contentStyle={{ borderRadius: 14, border: "none", boxShadow: "0 8px 24px -8px rgba(0,0,0,.2)", fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="uplift"
          stroke={BRAND}
          strokeWidth={2.5}
          fill="url(#upliftFill)"
          dot={{ r: 0 }}
          activeDot={{ r: 5, fill: BRAND, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// 동심원 — 유형별/제품별 증분
export function Concentric({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const items = data.filter((d) => d.value > 0).slice(0, 4);
  if (items.length === 0)
    return <div className="text-sm text-neutral-300">데이터가 없습니다.</div>;
  const max = items[0].value;
  const shades = ["#ffd9c8", "#ffb293", "#ff8255", BRAND];
  const baseShade = (i: number) => shades[Math.min(i, shades.length - 1)];

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-end sm:gap-5">
      <div className="relative h-[220px] w-[220px] shrink-0">
        {items.map((d, i) => {
          const dia = 110 + 110 * Math.sqrt(d.value / max);
          const shade = baseShade(items.length - 1 - i); // 바깥=연하게, 안=진하게
          return (
            <div
              key={d.label}
              className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full"
              style={{ width: dia, height: dia, background: shade, zIndex: i }}
            />
          );
        })}
      </div>
      <ul className="flex w-full flex-col gap-1.5 text-xs sm:max-w-[180px]">
        {items.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: baseShade(items.length - 1 - i) }}
            />
            <span className="min-w-0 flex-1 truncate text-neutral-700">{d.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-neutral-900">
              {wonShort(d.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 상시 일평균 vs 캠페인 일평균 — 비교 막대
export function BaselineVsPromo({
  data,
}: {
  data: { name: string; baseline: number; promo: number }[];
}) {
  if (data.length === 0)
    return <div className="text-sm text-neutral-300">데이터가 없습니다.</div>;
  const max = Math.max(...data.flatMap((d) => [d.baseline, d.promo]), 1);
  return (
    <div className="space-y-4">
      {data.map((d) => {
        const ratio = d.baseline > 0 ? d.promo / d.baseline : null;
        return (
          <div key={d.name}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="truncate font-medium text-neutral-700">{d.name}</span>
              {ratio != null && (
                <span className="ml-2 shrink-0 font-semibold text-brand-600">
                  평소 대비 {ratio.toFixed(1)}배
                </span>
              )}
            </div>
            {/* 상시 */}
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[10px] text-neutral-400">상시</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full bg-neutral-300" style={{ width: `${(d.baseline / max) * 100}%` }} />
              </div>
              <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-neutral-400">
                {wonShort(d.baseline)}
              </span>
            </div>
            {/* 캠페인 */}
            <div className="mt-1 flex items-center gap-2">
              <span className="w-8 shrink-0 text-[10px] text-brand-600">행사</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-brand-50">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(d.promo / max) * 100}%` }} />
              </div>
              <span className="w-16 shrink-0 text-right text-[10px] font-semibold tabular-nums text-neutral-700">
                {wonShort(d.promo)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 블랙 도넛 — 단일 비율
export function Donut({
  pct,
  label,
}: {
  pct: number | null;
  label: string;
}) {
  const deg = Math.max(0, Math.min(1, pct ?? 0)) * 360;
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div
        className="relative flex h-28 w-28 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${BRAND} ${deg}deg, #2f2d2b 0deg)` }}
      >
        <div className="flex h-[88px] w-[88px] flex-col items-center justify-center rounded-full bg-ink text-white">
          <span className="text-xl font-bold">{pct != null ? Math.round(pct * 100) : "—"}%</span>
        </div>
      </div>
      <span className="mt-3 text-xs text-neutral-300">{label}</span>
    </div>
  );
}
