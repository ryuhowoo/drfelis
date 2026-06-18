"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parsePromotionSheet } from "@/lib/parse";
import { ensureProducts } from "@/lib/products";

// 캠페인에 직접 성과 추가 (6단계) — 라플라스 동기간 매출 export를 '이 캠페인'에 고정 적재.
// 이름/코드 매칭에 의존하지 않고 promotion_id로 바로 넣어 플랜↔성과가 확실히 같은 캠페인에 붙는다.
// replace_promotion_sales RPC가 원자적 교체 + 실적옵션 재구성(구독/시그니처)을 수행한다.
export default function PerformanceUpload({
  promotionId,
  hasActuals,
}: {
  promotionId: string;
  hasActuals: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parsePromotionSheet(buf);
      if (parsed.rows.length === 0)
        throw new Error("성과 행이 없습니다 — 라플라스 캠페인 매출 export인지 확인하세요.");

      const supabase = createClient();
      const productMap = await ensureProducts(
        supabase,
        parsed.rows.map((r) => r.base_name),
      );
      const records = parsed.rows.map((r) => ({
        promotion_id: promotionId,
        product_id: productMap.get(r.base_name) ?? null,
        base_name: r.base_name,
        option_info: r.option_info,
        revenue: r.revenue,
        order_count: r.order_count,
        aov: r.aov,
        fee: r.fee,
        cost: r.cost,
        quantity: r.quantity,
        order_type: r.order_type, // 정기/일반 — 구독 자동 분류
        sale_option_code: r.sale_option_code,
        raw: r.composition ? { composition: r.composition } : null,
      }));

      // 원자적 교체 + 실적옵션 재구성(구독/시그니처 자동 분류)
      const { error } = await supabase.rpc("replace_promotion_sales", {
        p_promotion_id: promotionId,
        p_rows: records,
      });
      if (error) throw error;
      // 롤업 갱신(달성률·구독분리) — 실패해도 적재는 유효
      await supabase.rpc("refresh_rollups", { p_force: true });

      const subN = records.filter((x) => x.order_type === "subscription").length;
      setMsg({
        kind: "ok",
        text: `성과 ${records.length}행 적재·자동 분류 완료${subN > 0 ? ` (정기구독 ${subN}행 분리)` : ""}. 달성률을 갱신합니다…`,
      });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "업로드 실패" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-2xl card-soft p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-2">
            성과 {hasActuals ? "교체" : "추가"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-4">
            캠페인 종료 후 <strong className="text-ink-3">동기간 매출 export</strong>(상품명·일반/정기·옵션정보·기초상품명)를 올리면
            이 캠페인에 바로 적재 → 옵션/SKU별 달성률과 구독 제외 값이 자동 분류됩니다.
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
    </div>
  );
}
