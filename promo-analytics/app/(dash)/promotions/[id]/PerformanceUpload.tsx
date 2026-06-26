"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSegmentSheet } from "@/lib/parse";
import { ensureProducts } from "@/lib/products";
import { useReplaceConfirm } from "../../upload/useReplaceConfirm";

// Supabase 에러(PostgrestError)는 Error 인스턴스가 아니라 일반 객체 → message/details/hint를 직접 추출.
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string };
    return o.message || o.details || o.hint || "업로드 실패";
  }
  return "업로드 실패";
}

// 캠페인에 직접 성과 추가 (통합 포맷) — 회원/등급/카테고리·일반/정기까지 분해된 매출 export를
// '이 캠페인'에 promotion_id로 고정 적재. replace_promotion_performance RPC가 한 번에
//   (1) promotion_segment_sales 풀그레인(세그먼트 탭·어태치율) + 카테고리 백필
//   (2) promotion_sales 집계(달성률·롤업)
// 를 원자적으로 채운다. 이어서 sale_options 재구성 + 롤업 갱신.
export default function PerformanceUpload({
  promotionId,
  hasActuals,
  contributionAmount,
  adSpend,
}: {
  promotionId: string;
  hasActuals: boolean;
  contributionAmount?: number | null;
  adSpend?: number | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const { confirm, element: replaceDialog } = useReplaceConfirm();

  // 전체 실공헌이익액·실광고비 직접 입력 — 옵션 분해의 기준값(groundTruth)·광고 배분에 반영
  const [contrib, setContrib] = useState(contributionAmount != null ? String(contributionAmount) : "");
  const [ad, setAd] = useState(adSpend != null ? String(adSpend) : "");
  const [econBusy, setEconBusy] = useState(false);
  const [econMsg, setEconMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function saveEcon() {
    setEconBusy(true);
    setEconMsg(null);
    try {
      const res = await fetch(`/api/promotions/${promotionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contribution_amount: contrib.trim() ? Number(contrib.replace(/[^0-9.-]/g, "")) : null,
          ad_spend: ad.trim() ? Number(ad.replace(/[^0-9.-]/g, "")) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "저장 실패");
      const supabase = createClient();
      await supabase.rpc("refresh_rollups", { p_force: true });
      setEconMsg({ kind: "ok", text: "저장됐습니다. 옵션 분해·광고 배분에 반영됩니다." });
      router.refresh();
    } catch (e) {
      setEconMsg({ kind: "err", text: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setEconBusy(false);
    }
  }

  async function onFile(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseSegmentSheet(buf);
      if (parsed.rows.length === 0)
        throw new Error("성과 행이 없습니다 — 회원/등급/카테고리까지 분해된 캠페인 매출 export인지 확인하세요.");

      const supabase = createClient();
      const productMap = await ensureProducts(
        supabase,
        parsed.rows.map((r) => r.base_name),
      );
      const records = parsed.rows.map((r) => ({
        product_id: productMap.get(r.base_name) ?? null,
        base_name: r.base_name,
        option_info: r.option_info,
        category: r.category,
        member_type: r.member_type,
        member_grade: r.member_grade,
        order_type: r.order_type, // 정기/일반 — 구독 자동 분류
        revenue: r.revenue,
        order_count: r.order_count,
        aov: r.aov,
        arppu: r.arppu,
        paying_users: r.paying_users,
        quantity: r.quantity,
        fee: r.fee,
        cost: r.cost,
      }));

      // 교체 검토 (DB 변경 전) — 일별 매출과 동일한 흐름. 기존 성과가 있으면 old/new 비교 후 확인.
      const { data: existing } = await supabase
        .from("promotion_sales")
        .select("revenue")
        .eq("promotion_id", promotionId);
      const oldCount = existing?.length ?? 0;
      if (oldCount > 0) {
        const oldRevenue = (existing ?? []).reduce((s, x) => s + (Number(x.revenue) || 0), 0);
        const newRevenue = records.reduce((s, x) => s + (x.revenue || 0), 0);
        const newGrain = new Set(
          parsed.rows.map((r) => `${r.base_name}|${r.option_info ?? ""}`),
        ).size;
        const uniqNames = new Set(parsed.rows.map((r) => r.base_name)).size;
        const ok = await confirm({
          title: "성과 교체 — 이 캠페인의 기존 성과를 새 파일로",
          oldCount,
          oldRevenue,
          newCount: newGrain,
          newRevenue,
          matchedSkus: productMap.size,
          totalSkus: uniqNames,
          note: "이 캠페인의 옵션/SKU별 집계와 세그먼트(회원·등급·AOV·ARPPU)가 새 파일로 원자적으로 교체됩니다(누적 아님).",
        });
        if (!ok) {
          setMsg(null);
          setBusy(false);
          if (inputRef.current) inputRef.current.value = "";
          return;
        }
      }

      // 통합 적재: 세그먼트 풀그레인 + promotion_sales 집계(달성률) 원자적 교체
      const { error } = await supabase.rpc("replace_promotion_performance", {
        p_promotion_id: promotionId,
        p_rows: records,
      });
      if (error) throw error;
      // 성과옵션(구독/시그니처) 재구성 + 롤업 갱신 — 실패해도 적재는 유효
      try {
        await supabase.rpc("rebuild_sale_options", { p_promotion_id: promotionId });
      } catch {
        /* 옵션 재구성 실패는 무시 — 다음 조회 시 ensure */
      }
      await supabase.rpc("refresh_rollups", { p_force: true });

      // 업로드 이력(④ 캠페인 성과 카드) — best-effort
      try {
        const cats = new Set(records.map((x) => x.category).filter(Boolean)).size;
        const { data: au } = await supabase.auth.getUser();
        await supabase.from("upload_log").insert({
          kind: "segment",
          source_file: file.name,
          detail: `${parsed.rows.length}행 · 카테고리 ${cats}종`,
          row_count: parsed.rows.length,
          total_revenue: records.reduce((s, x) => s + (x.revenue || 0), 0),
          action: hasActuals ? "replace" : "insert",
          uploaded_by: au.user?.email ?? null,
        });
      } catch {
        /* 이력 기록 실패는 무시 */
      }

      const subN = records.filter((x) => x.order_type === "subscription").length;
      setMsg({
        kind: "ok",
        text: `성과 ${records.length}행 적재·자동 분류 완료${subN > 0 ? ` (정기구독 ${subN}행 분리)` : ""}. 세그먼트·달성률을 갱신합니다…`,
      });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-2xl card-soft p-5">
      {replaceDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-2">
            성과 {hasActuals ? "교체" : "추가"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-4">
            캠페인 종료 후 <strong className="text-ink-3">통합 매출 export</strong>(기초상품명·옵션정보·회원/비회원·회원등급·카테고리·일반/정기)를 올리면
            이 캠페인에 바로 적재 → 옵션/SKU별 <strong className="text-ink-3">달성률</strong>과 <strong className="text-ink-3">세그먼트</strong>(회원·등급·AOV·ARPPU)가 한 번에 채워집니다.
          </p>
        </div>
        <label className={`shrink-0 cursor-pointer rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${busy ? "bg-ink-4" : "bg-brand-500 hover:-translate-y-0.5 hover:bg-brand-600 hover:shadow-float"}`}>
          {busy ? "적재 중…" : hasActuals ? "성과 다시 올리기" : "성과 엑셀 업로드"}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            className="hidden"
          />
        </label>
      </div>
      {msg && (
        <div
          className={`mt-3 rounded-xl px-4 py-2.5 text-sm ${msg.kind === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}
        >
          {msg.text}
        </div>
      )}

      {/* 전체 실공헌이익액·실광고비 직접 입력 (성과의 최종 ground truth) */}
      <div className="mt-4 border-t border-line/70 pt-4">
        <h3 className="text-xs font-semibold text-ink-2">실 공헌이익·광고비 (직접 입력)</h3>
        <p className="mt-0.5 text-[11px] text-ink-4">
          기간 내 공식몰 <b>전체</b> 실공헌이익액(정기구독 포함)·실광고비. 옵션별 공헌이익 분해의 기준값과
          광고 배분에 반영돼 <b>최종 성과</b>를 정확히 보여줍니다.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] font-medium text-ink-4">전체 실공헌이익액 (₩)</span>
            <input
              value={contrib}
              onChange={(e) => setContrib(e.target.value)}
              inputMode="numeric"
              placeholder="예: 60613475"
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm tabular-nums text-ink outline-none focus:border-brand-400"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-ink-4">실 광고비 (₩)</span>
            <input
              value={ad}
              onChange={(e) => setAd(e.target.value)}
              inputMode="numeric"
              placeholder="예: 6890000"
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm tabular-nums text-ink outline-none focus:border-brand-400"
            />
          </label>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={saveEcon}
            disabled={econBusy}
            className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {econBusy ? "저장 중…" : "저장"}
          </button>
          {econMsg && (
            <span className={`text-xs ${econMsg.kind === "ok" ? "text-success" : "text-danger"}`}>
              {econMsg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
