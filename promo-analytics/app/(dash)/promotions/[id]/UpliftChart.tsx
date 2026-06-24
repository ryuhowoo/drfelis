"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { wonShort } from "@/lib/format";

type Item = { name: string; uplift: number; isMain: boolean };

export default function UpliftChart({ data }: { data: Item[] }) {
  if (data.length === 0)
    return <p className="text-sm text-neutral-400">표시할 데이터가 없습니다.</p>;

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
      >
        <XAxis
          type="number"
          tickFormatter={(v) => wonShort(v)}
          fontSize={11}
          stroke="#a3a3a3"
        />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          fontSize={11}
          stroke="#737373"
          tickFormatter={(v: string) => (v.length > 14 ? v.slice(0, 14) + "…" : v)}
        />
        <Tooltip
          formatter={(v) => [wonShort(Number(v)), "초과 달성"] as [string, string]}
          cursor={{ fill: "#f5f5f5" }}
        />
        <Bar dataKey="uplift" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.uplift < 0 ? "#f87171" : d.isMain ? "#16a34a" : "#9ca3af"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
