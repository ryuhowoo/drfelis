import { won, pct } from "@/lib/format";

// N13 P2: 옵션 단위 실측 공헌 분해 (sale_option_contribution RPC).
// 매출−수수료−원가−물류(매출×12%)−광고(실제 광고비 매출비중 배분) = 옵션 공헌.
// 합계를 캠페인 '전체 공헌이익액'(직접 입력 ground truth)과 대조.
export type OptionContribRow = {
  sale_option_id: string;
  label: string | null;
  option_code: string | null;
  is_subscription: boolean;
  matched_plan_option_id: string | null;
  plan_label: string | null;
  match_source: string | null;
  expected_revenue: number | null;
  revenue: number | null;
  fee: number | null;
  cost: number | null;
  logistics: number | null;
  ad_alloc: number | null;
  contribution: number | null;
  contribution_rate: number | null;
};

const MATCH_LABEL: Record<string, string> = {
  option_code: "옵션코드",
  signature: "구성매칭",
  label: "라벨",
  manual: "수동",
  none: "미매칭",
};

export default function OptionContribution({
  rows,
  groundTruth,
}: {
  rows: OptionContribRow[];
  groundTruth: number | null;
}) {
  if (!rows || rows.length === 0) return null;
  const sum = rows.reduce((s, r) => s + (r.contribution ?? 0), 0);
  const revSum = rows.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const gap = groundTruth != null ? sum - groundTruth : null;

  return (
    <section className="mt-4 rounded-2xl card-soft p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-2">옵션별 공헌이익 분해 (실측)</h2>
        <span className="text-xs text-ink-4">
          매출 − 수수료 − 원가 − 물류(12%) − 광고배분
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="text-ink-3">
          분해 합 공헌이익 <b className="text-ink tabular-nums">{won(sum)}</b>
        </span>
        {groundTruth != null && (
          <span className="text-ink-3">
            전체 공헌이익(입력) <b className="text-ink tabular-nums">{won(groundTruth)}</b>
          </span>
        )}
        {gap != null && (
          <span className={Math.abs(gap) > Math.abs(groundTruth ?? 1) * 0.1 ? "text-warning" : "text-ink-4"}>
            차이 <b className="tabular-nums">{won(gap)}</b>
            <span className="ml-1 text-ink-4">
              (정기구독 등 옵션 외 항목 차이 — 큰 값이면 매칭/구독 점검)
            </span>
          </span>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-ink-4">
            <tr className="border-b border-line">
              <th className="py-1.5 pr-3">옵션</th>
              <th className="py-1.5 pr-3">매칭</th>
              <th className="py-1.5 pr-3 text-right">매출</th>
              <th className="py-1.5 pr-3 text-right">수수료</th>
              <th className="py-1.5 pr-3 text-right">원가</th>
              <th className="py-1.5 pr-3 text-right">물류</th>
              <th className="py-1.5 pr-3 text-right">광고</th>
              <th className="py-1.5 pr-3 text-right">공헌이익</th>
              <th className="py-1.5 text-right">공헌률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sale_option_id} className="border-b border-line/60">
                <td className="py-1.5 pr-3">
                  <span className="text-ink-2">{r.label ?? r.option_code ?? "—"}</span>
                  {r.is_subscription && (
                    <span className="ml-1 rounded bg-brand-50 px-1 text-[10px] text-brand-700">정기</span>
                  )}
                  {r.plan_label && (
                    <span className="block text-[10px] text-ink-4">↔ {r.plan_label}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-ink-4">
                  {MATCH_LABEL[r.match_source ?? "none"] ?? r.match_source ?? "—"}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{won(r.revenue)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink-4">−{won(r.fee)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink-4">−{won(r.cost)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink-4">−{won(r.logistics)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink-4">−{won(r.ad_alloc)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums font-medium text-ink">{won(r.contribution)}</td>
                <td className="py-1.5 text-right tabular-nums">{pct(r.contribution_rate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-medium text-ink">
              <td className="py-1.5 pr-3" colSpan={2}>합계</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{won(revSum)}</td>
              <td colSpan={4} />
              <td className="py-1.5 pr-3 text-right tabular-nums">{won(sum)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {pct(revSum > 0 ? sum / revSum : null)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-ink-4">
        물류비는 매출의 12%(레이트카드)로 일괄 반영. 광고비는 캠페인 실제 광고비를 매출 비중으로
        배분(미입력 시 레이트카드 광고율). 수수료·원가는 실적 실측값.
      </p>
    </section>
  );
}
