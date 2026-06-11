"use client";

import {
  Area,
  Bar,
  Brush,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { wonShort } from "@/lib/format";

const BRAND = "#c66a48";
const GRAY = "#C7CCD6";

export type DailyPoint = { d: string; rev: number; in: boolean };

// N6 R2.2: 캠페인 일별 매출 시계열 — 직전 8주 맥락 + 캠페인 기간 강조 + 브러시 줌.
// 회색 = 평시(직전 8주), 코랄 = 캠페인 기간. 점선 = 평시 일평균(baseline).
export default function CampaignTrend({
  data,
  baselineDaily,
}: {
  data: DailyPoint[];
  baselineDaily: number | null;
}) {
  if (data.length < 2) return null;
  const promoStart = data.findIndex((p) => p.in);
  // 기본 뷰: 캠페인 시작 2주 전부터 (브러시로 전체 8주 탐색 가능)
  const defaultStart = Math.max(0, promoStart - 14);

  return (
    <section className="mt-6 rounded-2xl card-soft p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-700">일별 매출 흐름</h2>
        <div className="flex items-center gap-3 text-[11px] text-neutral-400">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: GRAY }} />평시 (직전 8주)</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: BRAND }} />캠페인 기간</span>
          {baselineDaily != null && baselineDaily > 0 && (
            <span>― ― 평시 일평균 {wonShort(baselineDaily)}</span>
          )}
        </div>
      </div>
      <div className="mt-3 h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="d"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fontSize: 11, fill: "#9CA4B4" }}
              tickLine={false}
              axisLine={{ stroke: "#E4E7EC" }}
              minTickGap={28}
            />
            <YAxis
              tickFormatter={(v: number) => wonShort(v)}
              tick={{ fontSize: 11, fill: "#9CA4B4" }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              formatter={(v) => [wonShort(Number(v)), "일매출"] as [string, string]}
              labelFormatter={(l) => String(l)}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #E4E7EC",
                boxShadow: "0 8px 24px -8px rgba(0,0,0,.15)",
                fontSize: 12,
              }}
            />
            {baselineDaily != null && baselineDaily > 0 && (
              <ReferenceLine
                y={baselineDaily}
                stroke="#9CA4B4"
                strokeDasharray="5 4"
                strokeWidth={1}
              />
            )}
            <Bar dataKey="rev" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((p) => (
                <Cell key={p.d} fill={p.in ? BRAND : GRAY} fillOpacity={p.in ? 1 : 0.55} />
              ))}
            </Bar>
            <Area
              type="monotone"
              dataKey="rev"
              stroke="transparent"
              fill="transparent"
              isAnimationActive={false}
            />
            <Brush
              dataKey="d"
              startIndex={defaultStart}
              height={22}
              travellerWidth={8}
              stroke="#C7CCD6"
              fill="#F6F7F9"
              tickFormatter={(v: string) => v.slice(5)}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        매장 전체 일매출 기준 · 드래그(브러시)로 구간을 좁혀 캠페인 전후 흐름을 비교하세요.
      </p>
    </section>
  );
}
