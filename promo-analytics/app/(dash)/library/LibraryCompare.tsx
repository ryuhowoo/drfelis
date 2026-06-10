"use client";

import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { wonShort } from "@/lib/format";

const COLORS = ["#c66a48", "#3A4254", "#7C9885"];

export type CompareCampaign = {
  id: string;
  name: string;
  daily: { d: string; rev: number; in: boolean }[];
};

// N6 R2.2: 캠페인 기간 정규화(D1·D2·…) 오버레이 비교 — 최대 3개.
// 서로 다른 시기의 캠페인을 같은 일차 축에 겹쳐 흐름·체급을 비교한다.
export default function LibraryCompare({ campaigns }: { campaigns: CompareCampaign[] }) {
  const candidates = useMemo(
    () => campaigns.filter((c) => c.daily.some((p) => p.in)),
    [campaigns],
  );
  const [picks, setPicks] = useState<string[]>(() =>
    candidates.slice(0, 2).map((c) => c.id),
  );

  const setPick = (idx: number, id: string) => {
    setPicks((p) => {
      const next = [...p];
      if (id === "") next.splice(idx, 1);
      else next[idx] = id;
      return [...new Set(next)];
    });
  };

  const series = picks
    .map((id) => candidates.find((c) => c.id === id))
    .filter((c): c is CompareCampaign => c != null);

  const chartData = useMemo(() => {
    const maxLen = Math.max(0, ...series.map((s) => s.daily.filter((p) => p.in).length));
    const rows: Record<string, number | string>[] = [];
    for (let i = 0; i < maxLen; i++) {
      const row: Record<string, number | string> = { day: `D${i + 1}` };
      for (const s of series) {
        const promoDays = s.daily.filter((p) => p.in);
        if (promoDays[i]) row[s.id] = promoDays[i].rev;
      }
      rows.push(row);
    }
    return rows;
  }, [series]);

  if (candidates.length < 2) return null;

  return (
    <section className="mt-6 rounded-2xl card-soft p-5">
      <h2 className="text-sm font-semibold text-neutral-700">캠페인 비교 (기간 정규화)</h2>
      <p className="mt-1 text-xs text-neutral-400">
        시기가 달라도 캠페인 1일차(D1) 기준으로 겹쳐 일매출 흐름을 비교합니다. 최대 3개.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {[0, 1, 2].map((idx) => (
          <select
            key={idx}
            value={picks[idx] ?? ""}
            onChange={(e) => setPick(idx, e.target.value)}
            className="max-w-[260px] rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink-2 focus:outline-none"
          >
            <option value="">{idx < picks.length ? "— 제거" : `+ 캠페인 ${idx + 1}`}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id} disabled={picks.includes(c.id) && picks[idx] !== c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ))}
      </div>
      {series.length >= 2 && (
        <div className="mt-4 h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9CA4B4" }} tickLine={false} axisLine={{ stroke: "#E4E7EC" }} />
              <YAxis tickFormatter={(v: number) => wonShort(v)} tick={{ fontSize: 11, fill: "#9CA4B4" }} tickLine={false} axisLine={false} width={56} />
              <Tooltip
                formatter={(v, key) => {
                  const c = series.find((s) => s.id === key);
                  return [wonShort(Number(v)), c?.name ?? String(key)] as [string, string];
                }}
                contentStyle={{ borderRadius: 12, border: "1px solid #E4E7EC", boxShadow: "0 8px 24px -8px rgba(0,0,0,.15)", fontSize: 12 }}
              />
              <Legend
                formatter={(key: string) => {
                  const c = series.find((s) => s.id === key);
                  return <span style={{ fontSize: 12 }}>{c?.name ?? key}</span>;
                }}
              />
              {series.map((s, i) => (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  type="monotone"
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
