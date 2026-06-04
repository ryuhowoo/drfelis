"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { wonShort, pct } from "@/lib/format";

export type LibraryRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  promo_type: string | null;
  season_tag: string | null;
  purpose: string | null;
  discount_rate: number | null;
  total_uplift: number;
  halo_share: number | null;
  contribution: number;
  uplift_per_day: number;
};

type Scored = LibraryRow & { score: number };

type SortKey = "score" | "total_uplift" | "uplift_per_day" | "contribution";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "종합점수" },
  { key: "total_uplift", label: "총 기여" },
  { key: "uplift_per_day", label: "일평균 기여" },
  { key: "contribution", label: "공헌이익" },
];

export default function LibraryTable({ data }: { data: LibraryRow[] }) {
  const [type, setType] = useState("");
  const [season, setSeason] = useState("");
  const [sort, setSort] = useState<SortKey>("score");

  const types = useMemo(
    () => [...new Set(data.map((d) => d.promo_type).filter(Boolean) as string[])],
    [data],
  );
  const seasons = useMemo(
    () => [...new Set(data.map((d) => d.season_tag).filter(Boolean) as string[])],
    [data],
  );

  // 종합 점수 = 공헌이익 0.4 · 일평균 기여 0.3 · 효율(기여/할인) 0.2 · 간접비중 0.1
  const scored = useMemo<Scored[]>(() => {
    const eff = (d: LibraryRow) =>
      d.discount_rate && d.discount_rate > 0 ? d.uplift_per_day / d.discount_rate : d.uplift_per_day;
    const maxC = Math.max(...data.map((d) => d.contribution), 1);
    const maxU = Math.max(...data.map((d) => d.uplift_per_day), 1);
    const maxE = Math.max(...data.map(eff), 1);
    return data.map((d) => {
      const s =
        0.4 * Math.max(0, d.contribution) / maxC +
        0.3 * Math.max(0, d.uplift_per_day) / maxU +
        0.2 * Math.max(0, eff(d)) / maxE +
        0.1 * Math.min(1, Math.max(0, d.halo_share ?? 0));
      return { ...d, score: Math.round(s * 100) };
    });
  }, [data]);

  const rows = useMemo(() => {
    return scored
      .filter((d) => (type ? d.promo_type === type : true))
      .filter((d) => (season ? d.season_tag === season : true))
      .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  }, [scored, type, season, sort]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={type} onChange={setType} placeholder="혜택종류 전체" options={types} />
        <Select value={season} onChange={setSeason} placeholder="시즈널리티 전체" options={seasons} />
        <div className="ml-auto flex items-center gap-1 text-xs text-neutral-500">
          정렬:
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`rounded-full px-2.5 py-1 ${
                sort === s.key ? "bg-brand-500 text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[24px] bg-white card-soft">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-center font-medium">종합점수</th>
              <th className="px-4 py-3 font-medium">캠페인</th>
              <th className="px-4 py-3 font-medium">혜택/시즈널리티</th>
              <th className="px-4 py-3 text-right font-medium">할인</th>
              <th className="px-4 py-3 text-right font-medium">총 기여</th>
              <th className="px-4 py-3 text-right font-medium">간접비중</th>
              <th className="px-4 py-3 text-right font-medium">공헌이익</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-neutral-50">
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                    r.score >= 70 ? "bg-brand-500 text-white" : r.score >= 40 ? "bg-brand-50 text-brand-600" : "bg-neutral-100 text-neutral-400"
                  }`}>
                    {r.score}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/promotions/${r.id}`} className="font-medium text-neutral-900 hover:text-brand-600">
                    {r.name}
                  </Link>
                  <div className="text-xs text-neutral-400">{r.start_date}~{r.end_date}</div>
                  {r.purpose && <div className="text-xs text-neutral-400">목적: {r.purpose}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500">
                  <div className="flex flex-wrap gap-1">
                    {r.promo_type && <Tag>{r.promo_type}</Tag>}
                    {r.season_tag && <Tag>{r.season_tag}</Tag>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-neutral-600">
                  {r.discount_rate != null ? pct(r.discount_rate, 0) : "—"}
                </td>
                <td className="px-4 py-3 text-right font-semibold">{wonShort(r.total_uplift)}</td>
                <td className="px-4 py-3 text-right text-neutral-600">{pct(r.halo_share)}</td>
                <td className="px-4 py-3 text-right text-neutral-600">{wonShort(r.contribution)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-neutral-400">
                  조건에 맞는 캠페인이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 px-1 text-xs text-neutral-400">
        종합점수 = 공헌이익 40% · 일평균 기여 30% · 효율(기여/할인깊이) 20% · 간접비중 10% (전체 대비 상대 점수)
      </p>
    </div>
  );
}

function Select({
  value, onChange, placeholder, options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{children}</span>
  );
}
