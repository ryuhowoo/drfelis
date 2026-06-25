"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// ⑤ 캠페인 플랜 가이드 (리스트 전용)
//  - 플랜은 '새 캠페인 만들기'에서 엑셀로 올리고, 성과는 '캠페인 상세'에서 올립니다.
//  - 여기서는 플랜이 있는 캠페인을 '캠페인명'으로 나열하고, 성과 데이터 업로드 유무만 체크합니다.
type Row = {
  promotion_id: string;
  name: string;
  status: string;
  has_perf: boolean;
};

export default function PlanGuideList() {
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    setRows(null);
    // 현재 버전 플랜 + 캠페인명
    const { data: plans } = await supabase
      .from("campaign_plans")
      .select("promotion_id, status, promotions(name)")
      .eq("is_current", true)
      .not("promotion_id", "is", null);

    const seen = new Map<string, { name: string; status: string }>();
    for (const p of (plans ?? []) as unknown as {
      promotion_id: string;
      status: string;
      promotions: { name: string | null } | null;
    }[]) {
      if (!seen.has(p.promotion_id))
        seen.set(p.promotion_id, {
          name: p.promotions?.name ?? "(이름 없음)",
          status: p.status,
        });
    }
    const ids = [...seen.keys()];

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
    load();
    const h = () => load();
    window.addEventListener("upload-done", h);
    return () => window.removeEventListener("upload-done", h);
  }, [load]);

  return (
    <div className="rounded-2xl card-soft p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">⑤ 캠페인 플랜 가이드</h2>
          <p className="mt-1 text-sm text-neutral-500">
            플랜은 <Link href="/campaigns/new" className="text-brand-600 underline">새 캠페인 만들기</Link>에서
            엑셀 양식으로 올리고, 성과는 <b>캠페인 상세</b>에서 올립니다. 아래는 플랜이 있는
            캠페인과 <b>성과 데이터 업로드 유무</b>입니다.
          </p>
        </div>
        <button
          onClick={load}
          className="shrink-0 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          새로고침
        </button>
      </div>

      {rows == null ? (
        <p className="mt-4 text-sm text-neutral-400">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">
          아직 플랜이 없습니다. ‘새 캠페인 만들기’에서 플랜을 작성하면 여기에 쌓입니다.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs text-neutral-400">
              <tr>
                <th className="py-1.5 pr-3">캠페인명</th>
                <th className="py-1.5 pr-3">플랜 상태</th>
                <th className="py-1.5 pr-3">성과 데이터</th>
                <th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.promotion_id} className="border-t border-neutral-100">
                  <td className="py-2 pr-3 font-medium text-neutral-800">
                    <Link href={`/promotions/${r.promotion_id}`} className="hover:text-brand-600">
                      {r.name}
                    </Link>
                  </td>
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
                  <td className="py-2 text-right">
                    <Link
                      href={`/promotions/${r.promotion_id}`}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      성과 올리기 →
                    </Link>
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
