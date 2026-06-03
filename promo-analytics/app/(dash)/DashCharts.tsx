"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { wonShort } from "@/lib/format";

const BRAND = "#f15a2b";

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
    <div className="relative mx-auto h-[230px] w-full max-w-[300px]">
      {items.map((d, i) => {
        const dia = 110 + 150 * Math.sqrt(d.value / max);
        const shade = baseShade(items.length - 1 - i); // 바깥=연하게, 안=진하게
        return (
          <div
            key={d.label}
            className="absolute bottom-0 left-1/2 flex -translate-x-1/2 justify-center rounded-full"
            style={{ width: dia, height: dia, background: shade, zIndex: i }}
          >
            <span
              className="mt-2 text-xs font-semibold"
              style={{ color: i >= items.length - 1 ? "#fff" : "#7a3b22" }}
            >
              {d.label} · {wonShort(d.value)}
            </span>
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
