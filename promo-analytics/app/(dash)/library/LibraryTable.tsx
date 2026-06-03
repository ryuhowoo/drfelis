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

type SortKey = "total_uplift" | "uplift_per_day" | "halo_share" | "contribution";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "total_uplift", label: "총 증분" },
  { key: "uplift_per_day", label: "일평균 증분" },
  { key: "halo_share", label: "후광 비중" },
  { key: "contribution", label: "공헌이익" },
];

export default function LibraryTable({ data }: { data: LibraryRow[] }) {
  const [type, setType] = useState("");
  const [season, setSeason] = useState("");
  const [sort, setSort] = useState<SortKey>("total_uplift");

  const types = useMemo(
    () => [...new Set(data.map((d) => d.promo_type).filter(Boolean) as string[])],
    [data],
  );
  const seasons = useMemo(
    () => [...new Set(data.map((d) => d.season_tag).filter(Boolean) as string[])],
    [data],
  );

  const rows = useMemo(() => {
    return data
      .filter((d) => (type ? d.promo_type === type : true))
      .filter((d) => (season ? d.season_tag === season : true))
      .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  }, [data, type, season, sort]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={type} onChange={setType} placeholder="혜택종류 전체" options={types} />
        <Select value={season} onChange={setSeason} placeholder="시즌 전체" options={seasons} />
        <div className="ml-auto flex items-center gap-1 text-xs text-neutral-500">
          정렬:
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`rounded-full px-2.5 py-1 ${
                sort === s.key
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">프로모션</th>
              <th className="px-4 py-3 font-medium">유형/시즌</th>
              <th className="px-4 py-3 text-right font-medium">할인</th>
              <th className="px-4 py-3 text-right font-medium">총 증분</th>
              <th className="px-4 py-3 text-right font-medium">일평균</th>
              <th className="px-4 py-3 text-right font-medium">후광</th>
              <th className="px-4 py-3 text-right font-medium">공헌이익</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-neutral-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/promotions/${r.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-xs text-neutral-400">
                    {r.start_date}~{r.end_date}
                  </div>
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
                <td className="px-4 py-3 text-right font-semibold">
                  {wonShort(r.total_uplift)}
                </td>
                <td className="px-4 py-3 text-right text-neutral-600">
                  {wonShort(r.uplift_per_day)}
                </td>
                <td className="px-4 py-3 text-right text-neutral-600">
                  {pct(r.halo_share)}
                </td>
                <td className="px-4 py-3 text-right text-neutral-600">
                  {wonShort(r.contribution)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-neutral-400">
                  조건에 맞는 프로모션이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  placeholder,
  options,
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
      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
      {children}
    </span>
  );
}
