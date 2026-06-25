"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/format";
import { downloadPlanXlsx, downloadPerformanceXlsx } from "@/lib/exportXlsx";
import CardHistory from "./CardHistory";

type Row = {
  promotion_id: string;
  name: string;
  code: string | null;
  channel: string | null;
  start_date: string | null;
  end_date: string | null;
  seg_rows: number;
  revenue: number;
  categories: number;
  subscription_revenue: number;
  last_at: string | null;
};

// ④ 캠페인 성과 — 적재 완료된 캠페인의 플랜·성과를 리스트업하고 엑셀로 내려받기.
// 업로드 자체는 각 캠페인 상세의 '성과 업로드'에서 통합 포맷으로 수행한다.
export default function CampaignPerformanceList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("campaign_performance_list");
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const h = () => load();
    window.addEventListener("upload-done", h);
    return () => window.removeEventListener("upload-done", h);
  }, [load]);

  async function dl(kind: "plan" | "perf", r: Row) {
    setErr(null);
    setBusy(`${kind}:${r.promotion_id}`);
    try {
      if (kind === "plan") await downloadPlanXlsx(r.promotion_id, r.name);
      else await downloadPerformanceXlsx(r.promotion_id, r.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function period(r: Row) {
    if (!r.start_date) return "—";
    return `${r.start_date}${r.end_date ? ` ~ ${r.end_date}` : ""}`;
  }

  return (
    <div className="rounded-2xl card-soft p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">④ 캠페인 성과 (회원·등급·카테고리)</h2>
        <span className="text-[11px] text-neutral-400">{rows.length}개 캠페인</span>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        성과 업로드는 각 캠페인 상세의 <b>성과 업로드</b>에서 통합 포맷(달성률+세그먼트)으로 진행합니다.
        여기서는 적재된 캠페인의 플랜·성과를 확인하고 엑셀로 내려받습니다.
      </p>

      {err && <p className="mt-3 text-xs text-rose-600">{err}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-neutral-400">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">아직 성과가 적재된 캠페인이 없습니다.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-neutral-400">
              <tr>
                <th className="py-1.5 pr-3">최종 적재</th>
                <th className="py-1.5 pr-3">채널</th>
                <th className="py-1.5 pr-3">캠페인</th>
                <th className="py-1.5 pr-3">기간</th>
                <th className="py-1.5 pr-3">요약</th>
                <th className="py-1.5 text-right">다운로드</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.promotion_id} className="border-t border-neutral-100 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-neutral-500">
                    {r.last_at
                      ? new Date(r.last_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{r.channel ?? "—"}</span>
                  </td>
                  <td className="py-2 pr-3 font-medium text-neutral-800">
                    <Link href={`/promotions/${r.promotion_id}?view=segment`} className="hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-neutral-500">{period(r)}</td>
                  <td className="py-2 pr-3 text-neutral-500">
                    {won(r.revenue)} · {r.seg_rows.toLocaleString()}행 · 카테고리 {r.categories}종
                    {r.revenue > 0 && r.subscription_revenue > 0 && (
                      <> · 정기 {Math.round((r.subscription_revenue / r.revenue) * 100)}%</>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => dl("plan", r)}
                      disabled={busy != null}
                      className="rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {busy === `plan:${r.promotion_id}` ? "…" : "플랜"}
                    </button>
                    <button
                      onClick={() => dl("perf", r)}
                      disabled={busy != null}
                      className="ml-1.5 rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {busy === `perf:${r.promotion_id}` ? "…" : "성과"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CardHistory kinds={["segment", "performance"]} />
    </div>
  );
}
