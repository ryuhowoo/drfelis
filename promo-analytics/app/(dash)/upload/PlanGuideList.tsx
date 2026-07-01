"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { downloadPlanXlsx, downloadPerformanceXlsx } from "@/lib/exportXlsx";

// 캠페인 데이터 (리스트 전용)
//  - 플랜이 있는 캠페인을 캠페인명으로 나열하고, 성과 데이터 업로드 유무를 표시.
//  - 행을 클릭하면 해당 캠페인으로 이동하고, 플랜/성과 데이터를 엑셀로 내려받을 수 있다.
type Row = {
  promotion_id: string;
  name: string;
  status: string;
  has_perf: boolean;
};

export default function PlanGuideList() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    setRows(null);
    // 현재 버전 플랜. campaign_plans→promotions는 FK가 2개(promotion_id·actual_promotion_id)라
    // PostgREST 임베드가 모호해 실패하므로, 캠페인명은 별도 조회로 합친다.
    const { data: plans } = await supabase
      .from("campaign_plans")
      .select("promotion_id, status")
      .eq("is_current", true)
      .not("promotion_id", "is", null);

    const seen = new Map<string, { name: string; status: string }>();
    for (const p of (plans ?? []) as { promotion_id: string; status: string }[]) {
      if (!seen.has(p.promotion_id))
        seen.set(p.promotion_id, { name: "(이름 없음)", status: p.status });
    }
    const ids = [...seen.keys()];

    // 캠페인명 채우기
    if (ids.length > 0) {
      const { data: proms } = await supabase
        .from("promotions")
        .select("id, name")
        .in("id", ids);
      for (const pr of (proms ?? []) as { id: string; name: string | null }[]) {
        const e = seen.get(pr.id);
        if (e) e.name = pr.name ?? "(이름 없음)";
      }
    }

    // 성과(실판매) 업로드 유무 — promotion_sales 존재 여부
    const perfSet = new Set<string>();
    if (ids.length > 0) {
      const { data: perf } = await supabase
        .from("promotion_sales")
        .select("promotion_id")
        .in("promotion_id", ids);
      for (const r of (perf ?? []) as { promotion_id: string }[])
        perfSet.add(r.promotion_id);
    }

    setRows(
      [...seen.entries()].map(([promotion_id, v]) => ({
        promotion_id,
        name: v.name,
        status: v.status,
        has_perf: perfSet.has(promotion_id),
      })),
    );
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

  return (
    <div className="rounded-2xl card-soft p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">캠페인 데이터</h2>
          <p className="mt-1 text-sm text-neutral-500">
            플랜이 있는 캠페인과 <b>성과 데이터 업로드 유무</b>입니다. 행을 클릭하면 해당 캠페인으로
            이동하고, 오른쪽 버튼으로 플랜·성과 데이터를 엑셀로 내려받을 수 있어요.
          </p>
        </div>
        <button
          onClick={load}
          className="shrink-0 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          새로고침
        </button>
      </div>

      {err && <p className="mt-3 text-xs text-rose-600">{err}</p>}

      {rows == null ? (
        <p className="mt-4 text-sm text-neutral-400">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">
          아직 플랜이 없습니다. ‘새 캠페인 만들기’에서 플랜을 작성하면 여기에 쌓입니다.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs text-neutral-400">
              <tr>
                <th className="py-1.5 pr-3">캠페인명</th>
                <th className="py-1.5 pr-3">플랜 상태</th>
                <th className="py-1.5 pr-3">성과 데이터</th>
                <th className="py-1.5 text-right">엑셀 다운로드</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.promotion_id}
                  onClick={() => router.push(`/promotions/${r.promotion_id}`)}
                  className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50"
                >
                  <td className="py-2 pr-3 font-medium text-neutral-800">{r.name}</td>
                  <td className="py-2 pr-3">
                    {r.status === "confirmed" ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        확정
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        draft
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {r.has_perf ? (
                      <span className="text-emerald-600">✓ 업로드됨</span>
                    ) : (
                      <span className="text-neutral-400">✗ 없음</span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dl("plan", r);
                      }}
                      disabled={busy != null}
                      className="rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {busy === `plan:${r.promotion_id}` ? "…" : "플랜"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dl("perf", r);
                      }}
                      disabled={busy != null || !r.has_perf}
                      title={r.has_perf ? undefined : "성과 데이터가 없습니다"}
                      className="ml-1.5 rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
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
    </div>
  );
}
