"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/format";

// 5단계 — 저장 전, 이전에 저장된 플랜을 추천. 누르면 이 캠페인 draft에 적용(복사)되어
// 수정해서 사용 가능. (추후 목적·성과 기반 추천으로 고도화 가능)
type Template = {
  id: string;
  promotion_id: string | null;
  name: string;
  purposes: string[];
  expected_revenue_total: number | null;
};

export default function PlanTemplatePanel({ promotionId }: { promotionId: string }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("campaign_plans")
        .select("id, promotion_id, expected_revenue_total, promotions(name, purposes)")
        .eq("status", "confirmed")
        .neq("promotion_id", promotionId)
        .order("confirmed_at", { ascending: false })
        .limit(12);
      if (!alive) return;
      const rows = (data ?? []).map((r) => {
        const p = (Array.isArray(r.promotions) ? r.promotions[0] : r.promotions) as
          | { name?: string; purposes?: string[] | null }
          | null;
        return {
          id: r.id as string,
          promotion_id: r.promotion_id as string | null,
          name: p?.name ?? "(이름 없음)",
          purposes: (p?.purposes ?? []) as string[],
          expected_revenue_total: r.expected_revenue_total as number | null,
        };
      });
      setTemplates(rows);
    })();
    return () => {
      alive = false;
    };
  }, [promotionId]);

  async function apply(t: Template) {
    if (busy) return;
    setBusy(t.id);
    setErr(null);
    try {
      const res = await fetch(`/api/promotions/${promotionId}/plan/apply-template`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_plan_id: t.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "적용 실패");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "적용 실패");
      setBusy(null);
    }
  }

  if (!templates || templates.length === 0) return null;

  return (
    <div className="mt-3 rounded-2xl card-soft p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="text-sm font-semibold text-ink-2">
          이전 플랜에서 시작 <span className="font-normal text-ink-4">· {templates.length}개 추천</span>
        </span>
        <span className="text-ink-4">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <>
          <p className="mt-1 text-xs text-ink-4">
            누르면 이 캠페인 플랜에 옵션·구성·쿠폰이 복사됩니다. 기존 작성 내용은 대체되니 빈 플랜에서 사용하세요.
          </p>
          {err && (
            <div className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{err}</div>
          )}
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => apply(t)}
                  disabled={!!busy}
                  className="flex w-full items-start justify-between gap-2 rounded-xl border border-line bg-card p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {t.purposes.slice(0, 3).map((p) => (
                        <span key={p} className="rounded-full bg-soft px-1.5 py-0.5 text-[10px] text-ink-3">
                          {p}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs font-semibold tabular-nums text-ink-2">
                      {won(t.expected_revenue_total)}
                    </span>
                    <span className="text-[10px] text-brand-600">{busy === t.id ? "적용 중…" : "적용 →"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
