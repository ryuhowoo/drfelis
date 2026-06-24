import { won, wonShort, pct, num } from "@/lib/format";

export type PurposeMetricRow = {
  purpose: string;
  weight: number;
  kind: "sales" | "stock" | "branding" | "other";
  uplift: number | null;
  contribution: number | null;
  uplift_pct: number | null;
  ach_qty: number | null;
  qty_reliable: boolean;
  order_count: number | null;
  // 플랜 대비 목표 달성 (achSummary)
  plan_revenue?: number | null;
  actual_revenue?: number | null;
  ach_revenue?: number | null;
  plan_contribution?: number | null;
  actual_contribution?: number | null;
  ach_contribution?: number | null;
  plan_qty?: number | null;
  actual_qty?: number | null;
};

// S5.4: 캠페인 상세 — 목적별 핵심 지표 블록 (가중·구분 표시). 계산은 5.1/측정 함수 단일 출처.
export default function PurposeBlock({ rows }: { rows: PurposeMetricRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">목적별 핵심 지표</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.purpose} className="rounded-xl p-4 card-soft">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-neutral-800">
                {r.purpose}
              </span>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                중요도 {r.weight}
              </span>
            </div>
            <div className="mt-3 space-y-1.5 text-sm">
              {r.kind === "stock" ? (
                <>
                  <PvA
                    label="판매 수량"
                    plan={r.plan_qty}
                    actual={r.actual_qty}
                    ach={r.ach_qty}
                    fmt={(v) => `${num(v)}개`}
                    badge={!r.qty_reliable ? "데이터 부족" : undefined}
                    primary
                  />
                </>
              ) : r.kind === "branding" ? (
                <>
                  <Metric label="구매 건수" value={num(r.order_count)} primary />
                  <p className="text-[11px] text-neutral-400">
                    브랜딩은 구매 건수로 봅니다(신규 비중은 회원 데이터 확보 후).
                  </p>
                </>
              ) : (
                <>
                  <PvA label="매출" plan={r.plan_revenue} actual={r.actual_revenue} ach={r.ach_revenue} fmt={(v) => wonShort(v)} primary />
                  <PvA label="공헌이익" plan={r.plan_contribution} actual={r.actual_contribution} ach={r.ach_contribution} fmt={(v) => wonShort(v)} />
                  <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-1.5">
                    <span className="text-[11px] text-neutral-400">그중 행사로 늘어난 매출</span>
                    <span className="text-[11px] font-medium text-neutral-600">{won(r.uplift)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        목적마다 보는 숫자가 다릅니다 — 세일즈=매출·공헌 <strong>계획 대비 달성</strong>,
        재고소진=수량 계획 대비, 브랜딩=구매 건수. ‘행사로 늘어난 매출’은 평소(미행사) 대비 증가분입니다.
      </p>
    </section>
  );
}

// 플랜 대비 목표 달성 한 줄 (달성% + 계획→실제)
function PvA({
  label,
  plan,
  actual,
  ach,
  fmt,
  badge,
  primary,
}: {
  label: string;
  plan?: number | null;
  actual?: number | null;
  ach?: number | null;
  fmt: (v: number | null) => string;
  badge?: string;
  primary?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-neutral-500">
          {label} 달성
          {badge && (
            <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">{badge}</span>
          )}
        </span>
        <span
          className={`tabular-nums ${primary ? "text-base font-bold text-neutral-900" : "font-semibold text-neutral-800"}`}
        >
          {ach != null ? pct(ach, 0) : "—"}
        </span>
      </div>
      <div className="mt-0.5 text-right text-[11px] text-neutral-400">
        계획 {fmt(plan ?? null)} → 실제 {fmt(actual ?? null)}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  badge,
  primary,
}: {
  label: string;
  value: string;
  badge?: string;
  primary?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-500">
        {label}
        {badge && (
          <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">
            {badge}
          </span>
        )}
      </span>
      <span className={`tabular-nums ${primary ? "font-semibold text-neutral-900" : "text-neutral-700"}`}>
        {value}
      </span>
    </div>
  );
}
