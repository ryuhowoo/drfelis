"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/format";
import type { EditorOption } from "./PlanEditor";

// item 12 — '플랜 불러오기'. 저장된 플랜의 옵션 구성을 그대로 현재 작성 중 플랜에 추가(append).
// '함께 구매 추정'을 대체. 클라이언트 상태(setOptions)로 바로 반영돼 자동저장과도 호환.
type PlanRow = {
  id: string;
  promotion_name: string | null;
  version: number;
  status: string;
  option_count: number;
};

export default function PlanLoadPanel({
  currentPlanId,
  onLoad,
}: {
  currentPlanId: string;
  onLoad: (opts: EditorOption[]) => void;
}) {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("plans_bundle");
      if (!alive) return;
      const rows = ((data as { plans?: PlanRow[] } | null)?.plans ?? [])
        .filter((p) => p.option_count > 0 && p.id !== currentPlanId);
      setPlans(rows);
    })();
    return () => {
      alive = false;
    };
  }, [currentPlanId]);

  async function load(p: PlanRow) {
    if (busyId) return;
    setBusyId(p.id);
    setErr(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("plan_editable", { p_plan_id: p.id });
      if (error) throw new Error(error.message);
      const opts = ((data as Omit<EditorOption, "frozen">[]) ?? []).map((o) => ({
        ...o,
        frozen: null,
      })) as EditorOption[];
      if (opts.length === 0) throw new Error("불러올 옵션이 없습니다.");
      onLoad(opts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setBusyId(null);
    }
  }

  if (!plans || plans.length === 0) return null;

  return (
    <div className="mt-3 rounded-2xl card-soft p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="text-sm font-semibold text-ink-2">
          플랜 불러오기 <span className="font-normal text-ink-4">· 저장된 플랜의 옵션을 그대로 추가</span>
        </span>
        <span className="text-ink-4">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <>
          <p className="mt-1 text-xs text-ink-4">
            누르면 그 플랜의 옵션·SKU 구성이 현재 플랜에 <strong>추가</strong>됩니다(대체 아님). 단가·수량은 그대로 들어오니 조정하세요.
          </p>
          {err && <div className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{err}</div>}
          <ul className="mt-3 grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {plans.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => load(p)}
                  disabled={!!busyId}
                  className="flex w-full items-start justify-between gap-2 rounded-xl border border-line bg-card p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {p.promotion_name ?? "(이름 없음)"}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-4">
                      v{p.version} · 옵션 {p.option_count}종 · {p.status === "confirmed" ? "확정" : "draft"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-brand-600">
                    {busyId === p.id ? "불러오는 중…" : "옵션 추가 →"}
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
