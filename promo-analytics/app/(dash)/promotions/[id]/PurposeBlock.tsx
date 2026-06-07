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
};

// S5.4: 캠페인 상세 — 목적별 핵심 지표 블록 (가중·구분 표시). 계산은 5.1/측정 함수 단일 출처.
export default function PurposeBlock({ rows }: { rows: PurposeMetricRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">목적별 핵심 지표</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.purpose} className="rounded-[20px] bg-white p-4 card-soft">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-neutral-800">
                {r.purpose}
              </span>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                가중치 {r.weight}
              </span>
            </div>
            <div className="mt-3 space-y-1.5 text-sm">
              {r.kind === "stock" ? (
                <Metric
                  label="수량 달성률"
                  value={r.ach_qty != null ? pct(r.ach_qty, 0) : "—"}
                  badge={!r.qty_reliable ? "데이터 부족" : undefined}
                  primary
                />
              ) : r.kind === "branding" ? (
                <>
                  <Metric label="구매 건수" value={num(r.order_count)} primary />
                  <p className="text-[11px] text-neutral-400">
                    신규 비중: 회원·수량 데이터 확보 후 제공 예정
                  </p>
                </>
              ) : (
                <>
                  <Metric label="증분 매출" value={won(r.uplift)} primary />
                  <Metric label="공헌이익" value={wonShort(r.contribution)} />
                  {r.uplift_pct != null && (
                    <Metric label="증분율" value={pct(r.uplift_pct, 0)} />
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        목적별로 보는 관점이 다릅니다 — 세일즈=증분·공헌, 재고소진=수량 달성률, 브랜딩=구매 건수.
        가중치는 캠페인 편집에서 조정합니다.
      </p>
    </section>
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
