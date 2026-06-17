"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { wonShort, pct } from "@/lib/format";
import { useUrlState } from "@/hooks/useUrlState";
import { parseSeedQuery } from "@/lib/scenario";
import { InlineAlert } from "@/components/ui";

export type CampaignStage = "plan" | "actual" | "linked" | "empty";

export const STAGE_META: Record<
  CampaignStage,
  { label: string; cls: string }
> = {
  linked: { label: "플랜+실적", cls: "bg-emerald-50 text-emerald-700" },
  actual: { label: "실적만", cls: "bg-soft text-ink-3" },
  plan: { label: "플랜만", cls: "bg-amber-50 text-amber-700" },
  empty: { label: "빈 캠페인", cls: "bg-soft text-ink-4" },
};

export type LibraryRow = {
  id: string;
  name: string;
  stage: CampaignStage;
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
  has_confirmed_plan: boolean;
  ach_revenue: number | null;
  ach_contribution: number | null;
  quantity_reliable: boolean | null;
  fits: { purpose: string; score: number | null; reliable: boolean }[];
};

type Scored = LibraryRow & { score: number };

type SortKey =
  | "score"
  | "total_uplift"
  | "uplift_per_day"
  | "contribution"
  | "ach_revenue"
  | "ach_contribution"
  | "purpose_fit";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "종합점수" },
  { key: "total_uplift", label: "총 기여" },
  { key: "uplift_per_day", label: "일평균 기여" },
  { key: "contribution", label: "공헌이익" },
  { key: "ach_revenue", label: "매출 달성률" },
  { key: "ach_contribution", label: "공헌 달성률" },
  { key: "purpose_fit", label: "목적 적합도" },
];

// 행의 적합도 점수 (목적 필터 활성 시 그 목적들 중 max, 아니면 전체 max)
function rowFitScore(r: LibraryRow, filter: string[]): number {
  const pool = filter.length
    ? r.fits.filter((f) => filter.includes(f.purpose))
    : r.fits;
  const scores = pool.map((f) => f.score).filter((s): s is number => s != null);
  return scores.length ? Math.max(...scores) : -1;
}

type StageFilter = "all" | "linked" | "actual" | "plan";

export default function LibraryTable({ data }: { data: LibraryRow[] }) {
  // PR6: 필터/정렬을 URL에 보존 — 링크 복사 시 같은 결과 복원
  const [f, setF, clearF] = useUrlState({
    type: "",
    season: "",
    sort: "score",
    stage: "all",
    purpose: [] as string[],
  });
  const type = f.type;
  const season = f.season;
  const sort = f.sort as SortKey;
  const stage = f.stage as StageFilter;
  const purposeFilter = f.purpose;
  const anyFilter = !!(type || season || stage !== "all" || purposeFilter.length || sort !== "score");

  const stageCounts = useMemo(() => {
    const c = { linked: 0, actual: 0, plan: 0 };
    for (const d of data) if (d.stage in c) c[d.stage as keyof typeof c]++;
    return c;
  }, [data]);

  const types = useMemo(
    () => [...new Set(data.map((d) => d.promo_type).filter(Boolean) as string[])],
    [data],
  );
  const seasons = useMemo(
    () => [...new Set(data.map((d) => d.season_tag).filter(Boolean) as string[])],
    [data],
  );
  const purposes = useMemo(
    () => [...new Set(data.flatMap((d) => d.fits.map((f) => f.purpose)))],
    [data],
  );
  const togglePurpose = (p: string) =>
    setF({
      purpose: purposeFilter.includes(p)
        ? purposeFilter.filter((x) => x !== p)
        : [...purposeFilter, p],
    });

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
    const filtered = scored
      .filter((d) => (stage === "all" ? true : d.stage === stage))
      .filter((d) => (type ? d.promo_type === type : true))
      .filter((d) => (season ? d.season_tag === season : true))
      .filter((d) =>
        purposeFilter.length
          ? d.fits.some((f) => purposeFilter.includes(f.purpose))
          : true,
      );
    if (sort === "purpose_fit") {
      return [...filtered].sort(
        (a, b) => rowFitScore(b, purposeFilter) - rowFitScore(a, purposeFilter),
      );
    }
    return filtered.sort(
      (a, b) => ((b[sort] as number) ?? 0) - ((a[sort] as number) ?? 0),
    );
  }, [scored, stage, type, season, sort, purposeFilter]);

  // PR7: 시뮬레이터/추천에서 넘어온 "플랜 조건" 배너 — 적용할 캠페인 선택 유도
  const [seed, setSeed] = useState<ReturnType<typeof parseSeedQuery>>(null);
  useEffect(() => {
    setSeed(parseSeedQuery(window.location.search));
  }, []);

  return (
    <div>
      {seed?.active && (
        <InlineAlert
          tone="brand"
          title="추천 조건으로 플랜 시작"
          action={
            <button onClick={() => setSeed(null)} className="text-[11px] text-ink-4 underline hover:text-ink-2">
              닫기
            </button>
          }
          className="mb-4"
        >
          {seed.promoType || "전체"}
          {` · ${seed.discount}% 할인 · ${seed.days}일`}
          {seed.season ? ` · ${seed.season}` : ""} — 이 조건을 적용할 캠페인을 아래에서 선택해 상세로 들어간 뒤 ‘가격 가이드(플랜)’를 작성하세요.
        </InlineAlert>
      )}

      {/* 생애주기 세그먼트 — 플랜+실적 / 실적만 / 플랜만 구분 */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-soft p-1 text-sm font-medium w-fit">
        {(
          [
            { key: "all", label: `전체 ${data.length}` },
            { key: "linked", label: `플랜+실적 ${stageCounts.linked}` },
            { key: "actual", label: `실적만 ${stageCounts.actual}` },
            { key: "plan", label: `플랜만 ${stageCounts.plan}` },
          ] as { key: StageFilter; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setF({ stage: t.key })}
            aria-pressed={stage === t.key}
            className={`rounded-lg px-3.5 py-1.5 transition ${
              stage === t.key ? "card-soft text-ink" : "text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(v) => setF({ type: v })} placeholder="혜택종류 전체" options={types} />
        <Select value={season} onChange={(v) => setF({ season: v })} placeholder="시즈널리티 전체" options={seasons} />
        {anyFilter && (
          <button onClick={clearF} className="text-xs text-ink-4 underline hover:text-ink-2">
            필터 초기화
          </button>
        )}
        <div className="ml-auto flex items-center gap-1 text-xs text-neutral-500">
          정렬:
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setF({ sort: s.key })}
              aria-pressed={sort === s.key}
              className={`rounded-full px-2.5 py-1 ${
                sort === s.key ? "bg-brand-500 text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 목적 필터 (다중) + 분포 — S5.3 */}
      {purposes.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-neutral-500">목적:</span>
            {purposes.map((p) => (
              <button
                key={p}
                onClick={() => togglePurpose(p)}
                className={`max-w-[14rem] truncate rounded-full border px-2.5 py-1 text-xs transition ${
                  purposeFilter.includes(p)
                    ? "border-brand-500 bg-brand-500 text-white"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {p}
              </button>
            ))}
            {purposeFilter.length > 0 && (
              <button
                onClick={() => setF({ purpose: [] })}
                className="text-xs text-neutral-400 hover:text-neutral-600"
              >
                초기화
              </button>
            )}
          </div>
          {purposeFilter.length > 0 && (
            <PurposeDistribution rows={rows} purposes={purposeFilter} />
          )}
        </div>
      )}

      {/* 모바일: 카드 리스트 */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl p-4 card-soft">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  r.score >= 70
                    ? "bg-brand-500 text-white"
                    : r.score >= 40
                      ? "bg-brand-50 text-brand-600"
                      : "bg-neutral-100 text-neutral-400"
                }`}
              >
                {r.score}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/promotions/${r.id}`}
                    className="min-w-0 flex-1 truncate text-[15px] font-semibold text-neutral-900 hover:text-brand-600"
                  >
                    {r.name}
                  </Link>
                  <StageBadge stage={r.stage} />
                </div>
                <div className="mt-0.5 text-xs text-neutral-400">
                  {r.start_date} ~ {r.end_date}
                </div>
                {(r.promo_type || r.season_tag) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.promo_type && <Tag>{r.promo_type}</Tag>}
                    {r.season_tag && <Tag>{r.season_tag}</Tag>}
                  </div>
                )}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Stat label="총 기여" value={wonShort(r.total_uplift)} bold />
              <Stat label="간접비중" value={pct(r.halo_share)} />
              <Stat label="공헌이익" value={wonShort(r.contribution)} />
              <Stat
                label="매출 달성"
                value={
                  r.has_confirmed_plan
                    ? r.ach_revenue != null
                      ? pct(r.ach_revenue, 0)
                      : "—"
                    : "플랜없음"
                }
              />
              <Stat
                label="공헌 달성"
                value={
                  r.has_confirmed_plan && r.ach_contribution != null
                    ? pct(r.ach_contribution, 0)
                    : "—"
                }
              />
              <Stat label="할인" value={r.discount_rate != null ? pct(r.discount_rate, 0) : "—"} />
              <Stat
                label="목적 적합도"
                value={(() => {
                  const f = rowFitScore(r, purposeFilter);
                  return f < 0 ? "—" : String(Math.round(f));
                })()}
              />
            </dl>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-xl px-4 py-10 text-center text-sm text-neutral-400 card-soft">
            조건에 맞는 캠페인이 없습니다.
          </li>
        )}
      </ul>

      {/* 데스크톱: 테이블 */}
      <div className="hidden overflow-x-auto rounded-2xl card-soft md:block">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-center font-medium">종합점수</th>
              <th className="px-4 py-3 font-medium">캠페인</th>
              <th className="px-4 py-3 font-medium">혜택/시즈널리티</th>
              <th className="px-4 py-3 text-right font-medium">할인</th>
              <th className="px-4 py-3 text-right font-medium">총 기여</th>
              <th className="px-4 py-3 text-right font-medium">간접비중</th>
              <th className="px-4 py-3 text-right font-medium">공헌이익</th>
              <th className="px-4 py-3 text-right font-medium">매출 달성률</th>
              <th className="px-4 py-3 text-right font-medium">공헌 달성률</th>
              <th className="px-4 py-3 text-right font-medium">목적 적합도</th>
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
                  <div className="flex items-center gap-1.5">
                    <Link href={`/promotions/${r.id}`} className="font-medium text-neutral-900 hover:text-brand-600">
                      {r.name}
                    </Link>
                    <StageBadge stage={r.stage} />
                  </div>
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
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{wonShort(r.total_uplift)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-600">{pct(r.halo_share)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-600">{wonShort(r.contribution)}</td>
                <td className="px-4 py-3 text-right">
                  <AchCell v={r.ach_revenue} hasPlan={r.has_confirmed_plan} />
                  {r.has_confirmed_plan && r.quantity_reliable === false && (
                    <div className="text-[10px] text-amber-600">수량 데이터부족</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <AchCell v={r.ach_contribution} hasPlan={r.has_confirmed_plan} />
                </td>
                <td className="px-4 py-3 text-right">
                  <FitBadge score={rowFitScore(r, purposeFilter)} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-neutral-400">
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

function StageBadge({ stage }: { stage: CampaignStage }) {
  const m = STAGE_META[stage];
  if (!m) return null;
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

function Stat({
  label,
  value,
  bold,
  truncate,
}: {
  label: string;
  value: string;
  bold?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
      <dt className="text-[10px] text-neutral-400">{label}</dt>
      <dd
        className={`mt-0.5 tabular-nums ${bold ? "font-semibold text-neutral-900" : "text-neutral-700"} ${
          truncate ? "truncate" : ""
        }`}
      >
        {value}
      </dd>
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

function FitBadge({ score }: { score: number }) {
  if (score < 0) return <span className="text-neutral-300">—</span>;
  const c =
    score >= 70
      ? "bg-brand-50 text-brand-600"
      : score >= 40
        ? "bg-neutral-100 text-neutral-600"
        : "bg-neutral-100 text-neutral-400";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${c}`}>
      {Math.round(score)}
    </span>
  );
}

// 선택 목적별 적합도 분포 (필터된 캠페인 점수를 트랙 위 점으로)
function PurposeDistribution({
  rows,
  purposes,
}: {
  rows: LibraryRow[];
  purposes: string[];
}) {
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-neutral-50 p-3">
      {purposes.map((p) => {
        const pts = rows
          .map((r) => r.fits.find((f) => f.purpose === p))
          .filter((x): x is { purpose: string; score: number | null; reliable: boolean } => !!x);
        const scores = pts.map((x) => x.score).filter((s): s is number => s != null);
        const avg = scores.length
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : null;
        const anyUnreliable = pts.some((x) => !x.reliable);
        return (
          <div key={p}>
            <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-500">
              <span className="truncate">
                {p} · {scores.length}건
                {anyUnreliable && (
                  <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">
                    데이터 부족
                  </span>
                )}
              </span>
              <span>평균 {avg != null ? Math.round(avg) : "—"}</span>
            </div>
            <div className="relative h-5 rounded-full bg-white">
              {scores.map((s, i) => (
                <span
                  key={i}
                  title={String(Math.round(s))}
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/70"
                  style={{ left: `${Math.min(100, Math.max(0, s))}%` }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AchCell({ v, hasPlan }: { v: number | null; hasPlan: boolean }) {
  if (!hasPlan)
    return (
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-400">
        플랜없음
      </span>
    );
  if (v == null) return <span className="text-neutral-300">—</span>;
  const c = v >= 1 ? "text-green-600" : v < 0.7 ? "text-red-500" : "text-neutral-700";
  return <span className={`font-medium tabular-nums ${c}`}>{pct(v, 0)}</span>;
}
