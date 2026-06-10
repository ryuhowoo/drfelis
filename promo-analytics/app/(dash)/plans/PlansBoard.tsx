"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { won, wonShort, pct } from "@/lib/format";

// promo.plans_bundle() 반환 형태
export type PlanRow = {
  id: string;
  code: string | null;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  channel: string | null;
  status: string; // draft | confirmed
  version: number;
  confirmed_at: string | null;
  target_revenue: number | null;
  target_contribution: number | null;
  target_contribution_rate: number | null;
  promotion_id: string | null;
  promotion_name: string | null;
  actual_promotion_id: string | null;
  actual_name: string | null;
  option_count: number;
  achievement: {
    has_confirmed_plan: boolean;
    ach_revenue: number | null;
    ach_contribution: number | null;
  } | null;
};

export type PlanOption = {
  plan_id: string;
  is_main: boolean;
  discount_consumer: number | null;
  discount_regular: number | null;
  set_price: number | null;
  expected_qty: number | null;
  expected_revenue: number | null;
};

type Tab = "list" | "tendency";

export default function PlansBoard({
  plans,
  options,
}: {
  plans: PlanRow[];
  options: PlanOption[];
}) {
  const [tab, setTab] = useState<Tab>("list");

  return (
    <div>
      {/* 탭 */}
      <div className="flex gap-1 rounded-xl bg-soft p-1 text-sm font-medium w-fit">
        {(
          [
            { key: "list", label: `플랜 목록 (${plans.length})` },
            { key: "tendency", label: "성향 분석" },
          ] as { key: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 transition ${
              tab === t.key ? "card-soft text-ink" : "text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "list" ? (
        <PlanList plans={plans} />
      ) : (
        <Tendency plans={plans} options={options} />
      )}
    </div>
  );
}

// ── 플랜 목록 ─────────────────────────────────────────────────────────────
function PlanList({ plans }: { plans: PlanRow[] }) {
  if (plans.length === 0)
    return (
      <p className="mt-6 rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center text-sm text-neutral-400">
        아직 플랜이 없습니다. 업로드 메뉴에서 ⑤ 캠페인 플랜 가이드를 올리면 여기에 쌓입니다.
      </p>
    );
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl card-soft">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-soft/60 text-left text-xs text-neutral-500">
          <tr>
            <th className="px-3 py-2.5 font-medium">플랜 (코드)</th>
            <th className="px-3 py-2.5 font-medium">기간</th>
            <th className="px-3 py-2.5 font-medium">상태</th>
            <th className="px-3 py-2.5 text-right font-medium">목표 매출</th>
            <th className="px-3 py-2.5 text-right font-medium">목표 공헌이익</th>
            <th className="px-3 py-2.5 text-right font-medium">옵션</th>
            <th className="px-3 py-2.5 font-medium">실적 연결</th>
            <th className="px-3 py-2.5 text-right font-medium">매출 달성률</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {plans.map((p) => {
            const ach =
              p.achievement?.has_confirmed_plan && p.achievement.ach_revenue != null
                ? p.achievement.ach_revenue
                : null;
            const linkedId = p.actual_promotion_id ?? p.promotion_id;
            return (
              <tr key={p.id} className="hover:bg-soft/40">
                <td className="px-3 py-2.5">
                  {linkedId ? (
                    <Link
                      href={`/promotions/${linkedId}`}
                      className="font-medium text-ink hover:text-brand-600"
                    >
                      {p.name ?? p.code ?? "(이름 없음)"}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">
                      {p.name ?? p.code ?? "(이름 없음)"}
                    </span>
                  )}
                  {p.code && p.code !== p.name && (
                    <span className="ml-1.5 text-[11px] text-neutral-400">{p.code}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-neutral-500">
                  {p.start_date ?? "—"} ~ {p.end_date ?? "—"}
                </td>
                <td className="px-3 py-2.5">
                  {p.status === "confirmed" ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      확정 v{p.version}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      draft v{p.version}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                  {wonShort(p.target_revenue)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">
                  {wonShort(p.target_contribution)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">
                  {p.option_count}
                </td>
                <td className="px-3 py-2.5">
                  {p.actual_promotion_id ? (
                    <Link
                      href={`/promotions/${p.actual_promotion_id}`}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      {p.actual_name ?? "실적 캠페인"}
                    </Link>
                  ) : p.promotion_id ? (
                    <span className="text-xs text-neutral-500">자기 캠페인</span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                      미연동
                    </span>
                  )}
                </td>
                <td
                  className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                    ach == null
                      ? "text-neutral-300"
                      : ach >= 1
                        ? "text-emerald-600"
                        : ach < 0.7
                          ? "text-brand-700"
                          : "text-ink"
                  }`}
                >
                  {ach != null ? pct(ach, 0) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 성향 분석 ─────────────────────────────────────────────────────────────
function Tendency({ plans, options }: { plans: PlanRow[]; options: PlanOption[] }) {
  const stats = useMemo(() => {
    const confirmed = plans.filter((p) => p.status === "confirmed");
    const targets = plans
      .map((p) => Number(p.target_revenue) || 0)
      .filter((v) => v > 0);
    const avgTarget = targets.length
      ? targets.reduce((a, b) => a + b, 0) / targets.length
      : null;

    const crRates = plans
      .map((p) =>
        p.target_revenue && p.target_contribution
          ? Number(p.target_contribution) / Number(p.target_revenue)
          : null,
      )
      .filter((v): v is number => v != null && Number.isFinite(v));
    const avgCr = crRates.length
      ? crRates.reduce((a, b) => a + b, 0) / crRates.length
      : null;

    const discounts = options
      .map((o) => (o.discount_consumer != null ? Number(o.discount_consumer) : null))
      .filter((v): v is number => v != null && v > 0 && v < 1);
    const avgDiscount = discounts.length
      ? discounts.reduce((a, b) => a + b, 0) / discounts.length
      : null;

    const achs = plans
      .map((p) =>
        p.achievement?.has_confirmed_plan && p.achievement.ach_revenue != null
          ? Number(p.achievement.ach_revenue)
          : null,
      )
      .filter((v): v is number => v != null);
    const avgAch = achs.length ? achs.reduce((a, b) => a + b, 0) / achs.length : null;

    const optPerPlan = plans.length ? options.length / plans.length : null;
    const mainShare = options.length
      ? options.filter((o) => o.is_main).length / options.length
      : null;

    // 할인율 분포 (10%p 버킷)
    const buckets = new Map<string, number>();
    for (const d of discounts) {
      const b = Math.min(6, Math.floor((d * 100) / 10));
      const label = `${b * 10}~${b * 10 + 9}%`;
      buckets.set(label, (buckets.get(label) ?? 0) + 1);
    }
    const discountDist = [...buckets.entries()]
      .map(([label, n]) => ({ label, n }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));

    return {
      confirmed: confirmed.length,
      drafts: plans.length - confirmed.length,
      avgTarget,
      avgCr,
      avgDiscount,
      avgAch,
      achCount: achs.length,
      optPerPlan,
      mainShare,
      discountDist,
      maxDiscountN: Math.max(1, ...discountDist.map((d) => d.n)),
    };
  }, [plans, options]);

  if (plans.length === 0)
    return (
      <p className="mt-6 rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center text-sm text-neutral-400">
        분석할 플랜이 없습니다. ⑤ 가이드 업로드로 플랜이 쌓이면 성향이 보입니다.
      </p>
    );

  const verdict =
    stats.avgAch == null
      ? null
      : stats.avgAch < 0.85
        ? {
            tone: "warn" as const,
            text: `과대계획 성향 — 목표를 실적보다 평균 ${Math.round((1 - stats.avgAch) * 100)}% 높게 잡습니다. 목표 산정을 보수적으로 조정해 보세요.`,
          }
        : stats.avgAch > 1.1
          ? {
              tone: "info" as const,
              text: `과소계획 성향 — 실적이 목표를 평균 ${Math.round((stats.avgAch - 1) * 100)}% 초과합니다. 목표를 더 공격적으로 잡아도 됩니다.`,
            }
          : {
              tone: "ok" as const,
              text: "계획 정확도 양호 — 목표와 실적이 ±15% 안에서 움직입니다.",
            };

  return (
    <div className="mt-4 space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="플랜 수"
          value={`${plans.length}`}
          sub={`확정 ${stats.confirmed} · draft ${stats.drafts}`}
        />
        <StatCard
          label="평균 목표 매출"
          value={stats.avgTarget != null ? wonShort(stats.avgTarget) : "—"}
          sub={stats.avgTarget != null ? won(stats.avgTarget) : undefined}
        />
        <StatCard
          label="평균 계획 할인율"
          value={stats.avgDiscount != null ? pct(stats.avgDiscount, 0) : "—"}
          sub="옵션 소비자가 기준"
        />
        <StatCard
          label="목표 공헌이익률"
          value={stats.avgCr != null ? pct(stats.avgCr, 0) : "—"}
          sub="플랜 헤더 기준 평균"
        />
      </div>

      {/* 계획 정확도 판정 */}
      <div className="rounded-2xl card-soft p-5">
        <h3 className="text-sm font-semibold text-ink-2">계획 정확도 성향</h3>
        {verdict ? (
          <div
            className={`mt-2 rounded-xl border px-4 py-3 text-sm ${
              verdict.tone === "warn"
                ? "border-amber-200 bg-amber-50/60 text-amber-800"
                : verdict.tone === "ok"
                  ? "border-emerald-200 bg-emerald-50/50 text-emerald-800"
                  : "border-line bg-soft/50 text-ink-2"
            }`}
          >
            평균 매출 달성률 <strong>{pct(stats.avgAch, 0)}</strong> (확정 플랜{" "}
            {stats.achCount}건 기준) — {verdict.text}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-4">
            확정 플랜의 실적 데이터가 아직 없습니다. 플랜을 확정하고 실적과 연동하면
            과대/과소계획 성향이 여기서 판정됩니다.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 할인율 분포 */}
        <div className="rounded-2xl card-soft p-5">
          <h3 className="text-sm font-semibold text-ink-2">계획 할인율 분포</h3>
          <p className="mt-0.5 text-xs text-ink-4">옵션 {options.length}개 · 소비자가 대비</p>
          {stats.discountDist.length > 0 ? (
            <div className="mt-3 space-y-2">
              {stats.discountDist.map((d) => (
                <div key={d.label} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 text-ink-3">{d.label}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-soft">
                    <div
                      className="h-full rounded-full bg-brand-400"
                      style={{ width: `${(d.n / stats.maxDiscountN) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right tabular-nums text-ink-3">
                    {d.n}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-4">할인율 데이터가 없습니다.</p>
          )}
        </div>

        {/* 옵션 구성 성향 */}
        <div className="rounded-2xl card-soft p-5">
          <h3 className="text-sm font-semibold text-ink-2">옵션 구성 성향</h3>
          <div className="mt-3 space-y-3 text-sm">
            <KV
              k="플랜당 평균 옵션 수"
              v={stats.optPerPlan != null ? stats.optPerPlan.toFixed(1) : "—"}
            />
            <KV
              k="메인 옵션 비중"
              v={stats.mainShare != null ? pct(stats.mainShare, 0) : "—"}
            />
            <KV
              k="옵션 평균 세트가"
              v={(() => {
                const ps = options
                  .map((o) => Number(o.set_price) || 0)
                  .filter((v) => v > 0);
                return ps.length
                  ? wonShort(ps.reduce((a, b) => a + b, 0) / ps.length)
                  : "—";
              })()}
            />
            <KV
              k="옵션 평균 목표 수량"
              v={(() => {
                const qs = options
                  .map((o) => Number(o.expected_qty) || 0)
                  .filter((v) => v > 0);
                return qs.length
                  ? Math.round(qs.reduce((a, b) => a + b, 0) / qs.length).toLocaleString()
                  : "—";
              })()}
            />
          </div>
        </div>
      </div>

      {/* 플랜별 목표 매출 */}
      <div className="rounded-2xl card-soft p-5">
        <h3 className="text-sm font-semibold text-ink-2">플랜별 목표 매출</h3>
        <div className="mt-3 space-y-2">
          {plans
            .filter((p) => Number(p.target_revenue) > 0)
            .sort((a, b) => Number(b.target_revenue) - Number(a.target_revenue))
            .slice(0, 10)
            .map((p) => {
              const max = Math.max(
                ...plans.map((x) => Number(x.target_revenue) || 0),
                1,
              );
              const ach =
                p.achievement?.has_confirmed_plan && p.achievement.ach_revenue != null
                  ? Number(p.achievement.ach_revenue)
                  : null;
              return (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="w-44 shrink-0 truncate text-ink-2" title={p.name ?? ""}>
                    {p.name ?? p.code}
                  </span>
                  <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-soft">
                    <div
                      className="h-full rounded-full bg-brand-300"
                      style={{ width: `${(Number(p.target_revenue) / max) * 100}%` }}
                    />
                    {ach != null && (
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-brand-600/80"
                        style={{
                          width: `${Math.min(100, (Number(p.target_revenue) * ach / max) * 100)}%`,
                        }}
                        title={`실적 환산 ${pct(ach, 0)}`}
                      />
                    )}
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-ink-3">
                    {wonShort(p.target_revenue)}
                  </span>
                </div>
              );
            })}
        </div>
        <p className="mt-2 text-[11px] text-ink-4">
          연한 코랄 = 목표 · 진한 코랄 = 실적 환산(달성률 반영, 연동된 플랜만)
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl card-soft p-4">
      <div className="text-[11px] font-bold uppercase tracking-[1.4px] text-ink-3">
        {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-4">{sub}</div>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-3">{k}</span>
      <span className="font-semibold tabular-nums text-ink">{v}</span>
    </div>
  );
}
