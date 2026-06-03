"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { wonShort } from "@/lib/format";

const ACCENT = "#4f46e5";

export function MonthlyUplift({
  data,
}: {
  data: { month: string; uplift: number }[];
}) {
  if (data.length === 0)
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-neutral-400">
        데이터가 쌓이면 월별 추세가 표시됩니다.
      </div>
    );
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <XAxis
          dataKey="month"
          fontSize={11}
          stroke="#a3a3a3"
          tickLine={false}
          axisLine={false}
          tickFormatter={(m: string) => m.slice(2).replace("-", ".")}
        />
        <Tooltip
          cursor={{ fill: "#f5f5f5" }}
          formatter={(v) => [wonShort(Number(v)), "증분"] as [string, string]}
          labelFormatter={(m) => `${m}`}
          contentStyle={{ borderRadius: 12, border: "1px solid #e5e5e5", fontSize: 12 }}
        />
        <Bar dataKey="uplift" radius={[6, 6, 0, 0]} maxBarSize={40}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.uplift < 0 ? "#f87171" : ACCENT} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TypeBreakdown({
  data,
}: {
  data: { label: string; uplift: number }[];
}) {
  const max = Math.max(...data.map((d) => Math.abs(d.uplift)), 1);
  if (data.length === 0)
    return <div className="text-sm text-neutral-400">유형 데이터가 없습니다.</div>;
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-neutral-600">{d.label}</span>
            <span className="font-medium text-neutral-800">{wonShort(d.uplift)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(Math.abs(d.uplift) / max) * 100}%`,
                background: d.uplift < 0 ? "#f87171" : ACCENT,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
