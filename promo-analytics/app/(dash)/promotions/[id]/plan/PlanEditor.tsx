"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CampaignPlan, RateCard } from "@/lib/types";
import {
  computeOptionTotals,
  computePlanTotals,
  rateCardMult,
  type PlanItemInput,
  type CouponSpec,
} from "@/lib/plan";
import { won, pct, num } from "@/lib/format";
import { validatePlan } from "@/lib/plan-validation";
import { InlineAlert, Dialog, DialogContent, DialogHeader, DialogFooter, Button } from "@/components/ui";
import PlanLoadPanel from "./PlanLoadPanel";
import SubProductSuggest, { type Bench } from "./SubProductSuggest";
import { downloadPlanXlsx, type ExportOption } from "@/lib/plan-export";

export type EditorItem = {
  product_id: string;
  base_name: string;
  sku_qty_per_option: number;
  unit_sale_price: number;
  source_config_id: string | null;
  consumer_price: number | null;
  regular_price: number | null;
  cost: number | null;
};
export type EditorOption = {
  option_label: string;
  expected_option_qty: number;
  is_main: boolean;
  match_patterns: string[];
  frozen: {
    set_price: number | null;
    discount_rate_consumer: number | null;
    discount_rate_regular: number | null;
    expected_revenue: number | null;
    expected_contribution: number | null;
  } | null;
  items: EditorItem[];
};
export type ProductEcon = Record<
  string,
  { consumer_price: number | null; regular_price: number | null; cost: number | null }
>;
// 예상 세트수 힌트 (S6.2) — 유사 캠페인 확정 플랜 평균, 비구속 표시용
export type QtyHint = {
  main: number | null;
  sub: number | null;
  mainN: number;
  subN: number;
};

type ItemState = EditorItem & { key: string };
type OptState = {
  key: string;
  option_label: string;
  expected_option_qty: number;
  is_main: boolean;
  match_patterns: string[];
  items: ItemState[];
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function toState(opts: EditorOption[]): OptState[] {
  return opts.map((o) => ({
    key: uid(),
    option_label: o.option_label,
    expected_option_qty: o.expected_option_qty,
    is_main: o.is_main,
    match_patterns: o.match_patterns,
    items: o.items.map((it) => ({ ...it, key: uid() })),
  }));
}

export default function PlanEditor({
  promotionId,
  plan,
  initialOptions,
  rateCard,
  qtyHint,
  purposes,
  campaignName,
  startDate,
  endDate,
}: {
  promotionId: string;
  plan: CampaignPlan | null;
  initialOptions: EditorOption[];
  rateCard: RateCard | null;
  qtyHint?: QtyHint;
  purposes?: string[];
  campaignName?: string;
  startDate?: string;
  endDate?: string;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<OptState[]>(() => toState(initialOptions));
  // 플랜(캠페인) 단위 조건부 쿠폰 — UI는 할인율을 %로 입력
  const planC = plan as (CampaignPlan & {
    coupon_min_order?: number | null;
    coupon_rate?: number | null;
    coupon_max?: number | null;
  }) | null;
  const [coupon, setCoupon] = useState(() => ({
    min: Number(planC?.coupon_min_order ?? 0) || 0,
    ratePct: (Number(planC?.coupon_rate ?? 0) || 0) * 100,
    max: Number(planC?.coupon_max ?? 0) || 0,
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 저장되지 않은 변경이 있으면 이탈 경고
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const confirmed = plan?.status === "confirmed";
  const mult = confirmed
    ? plan?.rate_card_snapshot?.mult ?? 0.715
    : rateCard
      ? rateCardMult(rateCard)
      : 0.715;

  // ── 작성 중 자동 임시저장 (item 11) ──────────
  // 뒤로가기·새로고침·크래시 후에도 이어서 작성. draft에서만, localStorage 사용.
  const draftKey = plan ? `plan-draft:${promotionId}:${plan.id}` : null;
  const [restored, setRestored] = useState(false);
  const hydrated = useRef(false);
  useEffect(() => {
    if (!draftKey || confirmed) {
      hydrated.current = true;
      return;
    }
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { options?: OptState[]; coupon?: typeof coupon };
        if (Array.isArray(d.options) && d.options.length > 0) {
          setOptions(d.options);
          if (d.coupon) setCoupon(d.coupon);
          setRestored(true);
          setDirty(true);
        }
      }
    } catch {
      /* 손상된 임시본 무시 */
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!draftKey || confirmed || !hydrated.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ options, coupon, ts: Date.now() }));
      } catch {
        /* 용량 초과 등 무시 */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [options, coupon, draftKey, confirmed]);
  const clearDraft = () => {
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* noop */
      }
    }
    setRestored(false);
  };
  const discardDraft = () => {
    clearDraft();
    setOptions(toState(initialOptions));
    setCoupon({
      min: Number(planC?.coupon_min_order ?? 0) || 0,
      ratePct: (Number(planC?.coupon_rate ?? 0) || 0) * 100,
      max: Number(planC?.coupon_max ?? 0) || 0,
    });
    setDirty(false);
  };

  // N5: '플랜 만들기' 자동 draft 생성 제거 — 플랜은 ⑤ 가이드 업로드로만 적재
  if (!plan) {
    return (
      <div className="mt-6 rounded-2xl card-soft p-6">
        <p className="text-sm text-neutral-600">
          이 캠페인에 연결된 가격 가이드(플랜)가 없습니다. 플랜은 업로드 페이지의 ⑤ 캠페인
          플랜 가이드로 적재해요 — 빈 플랜을 자동으로 만들지 않습니다.
        </p>
        <Link
          href="/upload"
          className="mt-4 inline-block rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          업로드로 이동
        </Link>
      </div>
    );
  }

  // 쿠폰 스펙 (할인율>0일 때만 적용)
  const couponSpec: CouponSpec =
    coupon.ratePct > 0
      ? {
          min_order_amount: coupon.min,
          discount_rate: coupon.ratePct / 100,
          max_discount_amount: coupon.max,
        }
      : null;

  // ── 라이브 롤업 ──────────────────────────────
  const optionResults = options.map((o) => {
    const inputs: PlanItemInput[] = o.items.map((it) => ({
      sku_qty_per_option: it.sku_qty_per_option,
      unit_sale_price: it.unit_sale_price,
      consumer_price: it.consumer_price,
      regular_price: it.regular_price,
      cost: it.cost,
    }));
    return computeOptionTotals(inputs, mult, o.expected_option_qty, couponSpec);
  });
  const planTotals = computePlanTotals(
    options.map((o, i) => ({
      qty: o.expected_option_qty,
      totals: optionResults[i],
      items: o.items.map((it) => ({
        product_id: it.product_id,
        base_name: it.base_name,
        sku_qty_per_option: it.sku_qty_per_option,
      })),
    })),
  );
  // 목적별 총합 — 구매건수(=Σ옵션 세트수)·판매수량(=Σ SKU 단위)·공헌이익률·쿠폰 할인 총액
  const expOrderCount = options.reduce((s, o) => s + (o.expected_option_qty || 0), 0);
  let expSkuUnits = 0;
  for (const v of planTotals.skuExpectedQty.values()) expSkuUnits += v.qty;
  const contribRate =
    planTotals.expected_revenue_total > 0
      ? planTotals.expected_contribution_total / planTotals.expected_revenue_total
      : null;
  const couponTotal = optionResults.reduce(
    (s, r, i) => s + r.coupon_discount * (options[i].expected_option_qty || 0),
    0,
  );

  // ── 인라인 검증 (확정 전 오류 발견) ──────────
  const validation = validatePlan(options, mult);

  // ── 상태 변경 헬퍼 ───────────────────────────
  const patchOption = (key: string, patch: Partial<OptState>) => {
    setDirty(true);
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  };
  const removeOption = (key: string) => {
    setDirty(true);
    setOptions((prev) => prev.filter((o) => o.key !== key));
  };
  const addOption = () => {
    setDirty(true);
    setOptions((prev) => [
      ...prev,
      {
        key: uid(),
        option_label: `메인 옵션 ${prev.length + 1}`,
        expected_option_qty: 0,
        is_main: true,
        match_patterns: [],
        items: [],
      },
    ]);
  };
  // 옵션 카드 복제 — 구성·가격 그대로, 새 key 부여 후 바로 아래에 삽입
  const duplicateOption = (key: string) => {
    setDirty(true);
    setOptions((prev) => {
      const idx = prev.findIndex((o) => o.key === key);
      if (idx < 0) return prev;
      const src = prev[idx];
      const copy: OptState = {
        ...src,
        key: uid(),
        option_label: `${src.option_label} (복제)`,
        items: src.items.map((it) => ({ ...it, key: uid() })),
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };
  // Phase 4 — 벤치마크 추천 서브상품을 옵션으로 추가.
  // 옵션 단가는 '상시 판매가'로 들어간다(할인 안 하는 서브를 평균 할인가로 채우면 수정이 번거로움).
  function buildSubOption(b: Bench): OptState {
    const unit = b.regular_price ?? b.consumer_price ?? Math.round(b.avg_unit_price) ?? 0;
    return {
      key: uid(),
      option_label: b.base_name,
      expected_option_qty: Math.round(b.avg_qty) || 0,
      is_main: false,
      match_patterns: [],
      items: [
        {
          key: uid(),
          product_id: b.product_id,
          base_name: b.base_name,
          sku_qty_per_option: 1,
          unit_sale_price: Math.round(unit) || 0,
          source_config_id: null,
          consumer_price: b.consumer_price,
          regular_price: b.regular_price,
          cost: b.cost,
        },
      ],
    };
  }
  const addSubOption = (b: Bench) => {
    setDirty(true);
    setOptions((prev) => [...prev, buildSubOption(b)]);
  };
  // 메인에 없는 서브 SKU를 한 번에 전체 추가 (item 8)
  const addSubOptions = (bs: Bench[]) => {
    if (bs.length === 0) return;
    setDirty(true);
    setOptions((prev) => [...prev, ...bs.map(buildSubOption)]);
  };
  // item 12 — 저장된 플랜의 옵션을 그대로 현재 플랜에 추가(append)
  const loadPlanOptions = (opts: EditorOption[]) => {
    setDirty(true);
    setOptions((prev) => [...prev, ...toState(opts)]);
  };
  const patchItem = (optKey: string, itemKey: string, patch: Partial<ItemState>) => {
    setDirty(true);
    setOptions((prev) =>
      prev.map((o) =>
        o.key === optKey
          ? { ...o, items: o.items.map((it) => (it.key === itemKey ? { ...it, ...patch } : it)) }
          : o,
      ),
    );
  };
  const removeItem = (optKey: string, itemKey: string) => {
    setDirty(true);
    setOptions((prev) =>
      prev.map((o) =>
        o.key === optKey ? { ...o, items: o.items.filter((it) => it.key !== itemKey) } : o,
      ),
    );
  };

  function addItem(optKey: string, it: ItemState) {
    setDirty(true);
    setOptions((prev) =>
      prev.map((o) => (o.key === optKey ? { ...o, items: [...o.items, it] } : o)),
    );
  }

  // ── 저장 / 확정 / 복제 ───────────────────────
  function payload() {
    return {
      plan_id: plan!.id,
      coupon: { min_order: coupon.min, rate: coupon.ratePct / 100, max: coupon.max },
      options: options.map((o, i) => ({
        option_label: o.option_label,
        expected_option_qty: o.expected_option_qty,
        is_main: o.is_main,
        match_patterns: o.match_patterns,
        sort: i,
        items: o.items.map((it) => ({
          product_id: it.product_id,
          base_name: it.base_name,
          sku_qty_per_option: it.sku_qty_per_option,
          unit_sale_price: it.unit_sale_price,
          source_config_id: it.source_config_id,
        })),
      })),
    };
  }

  async function save(): Promise<boolean> {
    const res = await fetch(`/api/promotions/${promotionId}/plan`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    });
    if (!res.ok) {
      setMsg({ kind: "err", text: (await res.json()).error ?? "저장 실패" });
      return false;
    }
    return true;
  }

  async function onSave() {
    setBusy(true);
    setMsg(null);
    const ok = await save();
    if (ok) {
      setDirty(false);
      clearDraft();
      setMsg({ kind: "ok", text: "draft 저장 완료" });
      router.refresh();
    }
    setBusy(false);
  }

  // 확정 검토 dialog에서 호출 (window.confirm 대체)
  async function doConfirm() {
    setConfirmOpen(false);
    setBusy(true);
    setMsg(null);
    if (!(await save())) {
      setBusy(false);
      return;
    }
    setDirty(false);
    const res = await fetch(`/api/promotions/${promotionId}/plan/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: plan!.id }),
    });
    if (!res.ok) {
      setMsg({ kind: "err", text: (await res.json()).error ?? "확정 실패" });
      setBusy(false);
      return;
    }
    clearDraft();
    router.refresh();
    setBusy(false);
  }

  function exportXlsx() {
    const exOptions: ExportOption[] = options.map((o, i) => {
      const t = optionResults[i];
      return {
        label: o.option_label || `옵션 ${i + 1}`,
        is_main: o.is_main,
        expected_option_qty: o.expected_option_qty,
        net_price: t.net_price,
        discount_rate_consumer: t.discount_rate_consumer_net ?? t.discount_rate_consumer,
        expected_revenue: t.expected_revenue,
        expected_contribution: t.expected_contribution,
        items: o.items.map((it) => ({
          base_name: it.base_name,
          sku_qty: it.sku_qty_per_option,
          unit_price: it.unit_sale_price,
          cost: it.cost,
          consumer_price: it.consumer_price,
        })),
      };
    });
    downloadPlanXlsx(
      {
        campaign: campaignName || `플랜 v${plan!.version}`,
        period: startDate && endDate ? `${startDate} ~ ${endDate}` : "",
        version: `v${plan!.version}`,
        purposes: purposes ?? [],
      },
      exOptions,
      {
        revenue: planTotals.expected_revenue_total,
        order_count: expOrderCount,
        sku_units: expSkuUnits,
        contribution: planTotals.expected_contribution_total,
        contribution_rate: contribRate,
      },
      couponSpec ? { min: coupon.min, ratePct: coupon.ratePct, max: coupon.max } : null,
    );
  }

  async function onClone() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/promotions/${promotionId}/plan/clone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: plan!.id }),
    });
    if (!res.ok) {
      setMsg({ kind: "err", text: (await res.json()).error ?? "복제 실패" });
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            confirmed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          v{plan.version} · {confirmed ? "확정됨" : "draft"}
        </span>
        {plan.is_current && (
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-500">
            현재 버전
          </span>
        )}
        <span className="text-xs text-neutral-400">
          공헌이익 승수 mult = {mult.toFixed(3)}
          {confirmed && plan.confirmed_at ? " · 동결됨" : " · 라이브"}
        </span>
        {!confirmed && (
          <span
            className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${
              msg?.kind === "err"
                ? "bg-danger-soft text-danger"
                : busy
                  ? "bg-soft text-ink-3"
                  : dirty
                    ? "bg-warning-soft text-warning"
                    : "bg-success-soft text-success"
            }`}
          >
            {msg?.kind === "err" ? "저장 실패" : busy ? "저장 중…" : dirty ? "저장되지 않은 변경" : "저장됨"}
          </span>
        )}
      </div>

      {restored && !confirmed && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-700">
          <span>이전에 작성하던 임시 내용을 복구했습니다. 저장하면 확정 반영됩니다.</span>
          <button
            onClick={discardDraft}
            className="shrink-0 rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-medium hover:bg-brand-100"
          >
            서버 버전으로 되돌리기
          </button>
        </div>
      )}

      {/* 플랜 목적 + 목적별 총합 헤더 — 스크롤 시에도 합계를 보며 옵션 조절 (sticky) */}
      <div className="sticky top-16 z-20 mt-4 rounded-2xl card-soft p-5 shadow-sm md:top-0">
        {purposes && purposes.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-ink-4">목적</span>
            {purposes.map((p) => (
              <span key={p} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                {p}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="예상 매출액" value={won(planTotals.expected_revenue_total)} primary />
          <Stat label="구매건수 (세트)" value={num(expOrderCount)} />
          <Stat label="판매수량 (SKU)" value={num(expSkuUnits)} />
          <Stat label="공헌이익액" value={won(planTotals.expected_contribution_total)} />
          <Stat label="공헌이익률" value={contribRate != null ? pct(contribRate, 1) : "—"} />
        </div>
        <div className="mt-2 text-[11px] text-ink-4">
          옵션 {num(options.length)}종 · SKU {num(planTotals.skuExpectedQty.size)}종
          {couponTotal > 0 && <> · 쿠폰 할인 반영 −{won(couponTotal)}</>}
        </div>
      </div>

      {/* 추가 할인 쿠폰 (플랜 단위 · N원 이상 n% 최대 n원) */}
      <div className="mt-3 rounded-2xl card-soft p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-2">추가 할인 쿠폰</h3>
          <span className="text-[11px] text-ink-4">옵션 혜택가가 기준액 이상이면 자동 적용</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[11px] font-medium text-ink-4">기준액 (원 이상)</span>
            <input
              type="text" inputMode="numeric" disabled={confirmed}
              value={coupon.min ? coupon.min.toLocaleString("ko-KR") : ""}
              onChange={(e) => { const v = Number(e.target.value.replace(/[^0-9]/g, "")) || 0; setCoupon((c) => ({ ...c, min: v })); setDirty(true); }}
              placeholder="예: 50,000"
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm tabular-nums text-ink outline-none transition focus:border-brand-400 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-ink-4">할인율 (%)</span>
            <input
              type="number" inputMode="decimal" min={0} max={100} disabled={confirmed}
              value={coupon.ratePct || ""}
              onChange={(e) => { setCoupon((c) => ({ ...c, ratePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })); setDirty(true); }}
              placeholder="예: 10"
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm tabular-nums text-ink outline-none transition focus:border-brand-400 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-ink-4">최대 할인 (원, 0=무제한)</span>
            <input
              type="text" inputMode="numeric" disabled={confirmed}
              value={coupon.max ? coupon.max.toLocaleString("ko-KR") : ""}
              onChange={(e) => { const v = Number(e.target.value.replace(/[^0-9]/g, "")) || 0; setCoupon((c) => ({ ...c, max: v })); setDirty(true); }}
              placeholder="예: 10,000"
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm tabular-nums text-ink outline-none transition focus:border-brand-400 disabled:opacity-60"
            />
          </label>
        </div>
      </div>

      {/* 플랜 불러오기 (draft에서만) */}
      {!confirmed && <PlanLoadPanel currentPlanId={plan.id} onLoad={loadPlanOptions} />}

      {/* 검증 요약 (확정 전 오류 발견) */}
      {!confirmed && (validation.errorCount > 0 || validation.warnCount > 0) && (
        <div className="mt-4">
          <InlineAlert
            tone={validation.errorCount > 0 ? "danger" : "warning"}
            title={`검증 — 오류 ${validation.errorCount} · 경고 ${validation.warnCount}`}
          >
            {validation.errorCount > 0
              ? "오류를 해결해야 확정할 수 있습니다."
              : "경고가 있어도 확정은 가능하나 확인을 권장합니다."}
            {validation.plan.map((p, j) => (
              <span key={j} className="mt-0.5 block">
                · {p.message}
              </span>
            ))}
          </InlineAlert>
        </div>
      )}

      {/* 옵션들 */}
      <div className="mt-5 space-y-4">
        {options.map((o, i) => {
          const issues = validation.byOption[o.key] ?? [];
          return (
            <div key={o.key}>
              <OptionCard
                opt={o}
                totals={optionResults[i]}
                mult={mult}
                qtyHint={qtyHint}
                readOnly={confirmed}
                invalid={issues.some((x) => x.level === "error")}
                onPatch={(patch) => patchOption(o.key, patch)}
                onRemove={() => removeOption(o.key)}
                onDuplicate={() => duplicateOption(o.key)}
                onAddItem={(it) => addItem(o.key, it)}
                onPatchItem={(itemKey, patch) => patchItem(o.key, itemKey, patch)}
                onRemoveItem={(itemKey) => removeItem(o.key, itemKey)}
              />
              {issues.length > 0 && (
                <ul className="mt-1 space-y-0.5 px-1">
                  {issues.map((iss, j) => (
                    <li
                      key={j}
                      className={`text-[11px] ${iss.level === "error" ? "text-danger" : "text-warning"}`}
                    >
                      {iss.level === "error" ? "✕" : "⚠"} {iss.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {!confirmed && (
        <>
          <button
            onClick={addOption}
            disabled={busy}
            className="mt-4 rounded-xl border border-dashed border-brand-300 px-4 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50"
          >
            + 메인 옵션 추가
          </button>
          <SubProductSuggest
            existingProductIds={options.flatMap((o) => o.items.map((it) => it.product_id))}
            onAdd={addSubOption}
            onAddAll={addSubOptions}
          />
        </>
      )}

      {/* 액션 */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={exportXlsx}
          disabled={options.length === 0}
          className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-2 hover:bg-soft disabled:opacity-50"
          title="현재 플랜을 Excel로 내려받기"
        >
          ⬇ Excel 내보내기
        </button>
        {confirmed ? (
          <button
            onClick={onClone}
            disabled={busy}
            className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            수정 (새 버전)
          </button>
        ) : (
          <>
            <button
              onClick={onSave}
              disabled={busy}
              className="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
            >
              draft 저장
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={busy || validation.errorCount > 0}
              title={validation.errorCount > 0 ? "오류를 먼저 해결하세요" : undefined}
              className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              확정
            </button>
          </>
        )}
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.kind === "err" ? "text-danger" : "text-success"}`}>
          {msg.text}
        </p>
      )}

      {/* 확정 검토 dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader
            title="플랜 확정"
            description="확정하면 rate card·가격·원가가 동결되고 수정이 잠깁니다. 이후 수정은 '새 버전'으로만 가능합니다."
          />
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">목표 매출</dt>
              <dd className="font-semibold tabular-nums text-ink">{won(planTotals.expected_revenue_total)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">목표 공헌이익</dt>
              <dd className="font-semibold tabular-nums text-ink">{won(planTotals.expected_contribution_total)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">옵션 수</dt>
              <dd className="tabular-nums text-ink-2">{num(options.length)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">메인 제품</dt>
              <dd className="text-ink-2">
                {options.filter((o) => o.is_main).length > 0
                  ? `${num(options.filter((o) => o.is_main).length)}개 지정`
                  : "미지정"}
              </dd>
            </div>
          </dl>
          {validation.warnCount > 0 && (
            <div className="mt-3">
              <InlineAlert tone="warning" title={`경고 ${validation.warnCount}개`}>
                경고가 있어도 확정은 가능합니다. 확인 후 진행하세요.
              </InlineAlert>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              취소
            </Button>
            <Button onClick={doConfirm} disabled={busy}>
              확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  primary,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${primary ? "bg-brand-50" : "card-soft"}`}
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function OptionCard({
  opt,
  totals,
  mult,
  qtyHint,
  readOnly,
  invalid,
  onPatch,
  onRemove,
  onDuplicate,
  onAddItem,
  onPatchItem,
  onRemoveItem,
}: {
  opt: OptState;
  totals: ReturnType<typeof computeOptionTotals>;
  mult: number;
  qtyHint?: QtyHint;
  readOnly: boolean;
  invalid?: boolean;
  onPatch: (patch: Partial<OptState>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddItem: (it: ItemState) => void;
  onPatchItem: (itemKey: string, patch: Partial<ItemState>) => void;
  onRemoveItem: (itemKey: string) => void;
}) {
  // 옵션 단가/할인율을 '주 입력'으로 — 입력 시 SKU 단가들을 비례 스케일해
  // set_price=Σ(sku×price) 계약을 유지(백엔드 무변). 입력 중 jitter 방지로 blur 시 적용.
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [discDraft, setDiscDraft] = useState<string | null>(null);

  function applyOptionPrice(newPrice: number) {
    const items = opt.items;
    if (items.length === 0 || !(newPrice >= 0)) return;
    const cur = totals.set_price;
    if (cur > 0) {
      const f = newPrice / cur;
      items.forEach((it) =>
        onPatchItem(it.key, { unit_sale_price: Math.max(0, Math.round(it.unit_sale_price * f)), source_config_id: null }),
      );
    } else if (totals.consumer_total > 0) {
      items.forEach((it) => {
        const share = ((it.consumer_price ?? 0) * (it.sku_qty_per_option || 0)) / totals.consumer_total;
        const q = Math.max(1, it.sku_qty_per_option || 1);
        onPatchItem(it.key, { unit_sale_price: Math.round((newPrice * share) / q), source_config_id: null });
      });
    } else {
      const totalQty = items.reduce((s, it) => s + (it.sku_qty_per_option || 0), 0) || items.length;
      const perUnit = Math.round(newPrice / totalQty);
      items.forEach((it) => onPatchItem(it.key, { unit_sale_price: perUnit, source_config_id: null }));
    }
  }
  function applyDiscount(ratePct: number) {
    if (totals.consumer_total <= 0) return;
    applyOptionPrice(Math.round(totals.consumer_total * (1 - ratePct / 100)));
  }

  const qty = opt.expected_option_qty || 0;
  const unitsPerSet = opt.items.reduce((s, it) => s + (it.sku_qty_per_option || 0), 0);
  // 상단은 쿠폰 전(목록가 기준), 쿠폰 적용 옵션은 아래 '최종' 줄에서 반영
  const preRevenue = totals.set_price * qty;
  const preContribution = (totals.set_price * mult - totals.cost_total) * qty;

  return (
    <div className={`rounded-xl card-soft p-4 ${invalid ? "ring-1 ring-danger/40" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[10rem] flex-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-medium disabled:bg-neutral-50"
          value={opt.option_label}
          disabled={readOnly}
          onChange={(e) => onPatch({ option_label: e.target.value })}
          placeholder="옵션 라벨 (예: 모래 4묶음 세트)"
        />
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={opt.is_main}
            disabled={readOnly}
            onChange={(e) => onPatch({ is_main: e.target.checked })}
          />
          메인
        </label>
        {!readOnly && (
          <button
            onClick={onRemove}
            className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50"
          >
            옵션 삭제
          </button>
        )}
      </div>

      {/* 옵션 단가·할인율·예상세트수 = 주 입력. 단품수·매출·공헌은 자동 계산. */}
      <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl surface-pressed-soft p-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block">
          <span className="block text-[11px] font-medium text-ink-4">옵션 단가</span>
          <input
            type="text"
            inputMode="numeric"
            disabled={readOnly || opt.items.length === 0}
            value={priceDraft ?? (totals.set_price ? totals.set_price.toLocaleString("ko-KR") : "")}
            onChange={(e) => setPriceDraft(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => { if (priceDraft != null) { applyOptionPrice(Number(priceDraft) || 0); setPriceDraft(null); } }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="옵션 판매가"
            className="mt-0.5 w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-semibold tabular-nums text-ink outline-none focus:border-brand-400 disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-ink-4">할인율(소비자)</span>
          <div className="mt-0.5 flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              min={0}
              max={100}
              disabled={readOnly || totals.consumer_total <= 0}
              value={discDraft ?? (totals.discount_rate_consumer != null ? +(totals.discount_rate_consumer * 100).toFixed(1) : "")}
              onChange={(e) => setDiscDraft(e.target.value)}
              onBlur={() => { if (discDraft != null) { applyDiscount(Number(discDraft) || 0); setDiscDraft(null); } }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-brand-400 disabled:opacity-60"
            />
            <span className="text-xs text-ink-4">%</span>
          </div>
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-ink-4">예상 세트수</span>
          <input
            type="number"
            className="mt-0.5 w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-brand-400 disabled:opacity-60"
            value={opt.expected_option_qty || 0}
            disabled={readOnly}
            onChange={(e) => onPatch({ expected_option_qty: Number(e.target.value) || 0 })}
          />
          {(() => {
            const hv = opt.is_main ? qtyHint?.main : qtyHint?.sub;
            const hn = opt.is_main ? qtyHint?.mainN : qtyHint?.subN;
            return hv != null && hn ? (
              <span className="mt-0.5 block text-[10px] text-neutral-400">
                유사 평균 {num(hv)}세트 ({hn}건)
              </span>
            ) : null;
          })()}
        </label>
        <div>
          <span className="block text-[11px] font-medium text-ink-4">예상 단품수</span>
          <div className="mt-0.5 py-1.5 text-sm font-semibold tabular-nums text-ink-2">
            {num(unitsPerSet * (opt.expected_option_qty || 0))}
          </div>
          <span className="text-[10px] text-neutral-400">세트당 {num(unitsPerSet)}개</span>
        </div>
        <div>
          <span className="block text-[11px] font-medium text-ink-4">예상 매출</span>
          <div className="mt-0.5 py-1.5 text-sm font-bold tabular-nums text-ink">{won(preRevenue)}</div>
        </div>
        <div>
          <span className="block text-[11px] font-medium text-ink-4">예상 공헌이익</span>
          <div className="mt-0.5 flex items-center gap-1.5 py-1.5">
            <span className="text-sm font-bold tabular-nums text-ink">{won(preContribution)}</span>
            {totals.free_shipping && (
              <span className="rounded bg-secondary-100 px-1 text-[10px] text-secondary-700">무배</span>
            )}
          </div>
        </div>
      </div>

      {/* 쿠폰 적용 옵션: 최종(쿠폰 반영) 값 */}
      {totals.coupon_discount > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-3 rounded-xl bg-brand-50/60 px-3 py-2 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <span className="block text-[11px] font-medium text-brand-600">최종 쿠폰가</span>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{won(totals.net_price)}</div>
          </div>
          <div>
            <span className="block text-[11px] font-medium text-brand-600">최종 할인율</span>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
              {totals.discount_rate_consumer_net != null ? pct(totals.discount_rate_consumer_net, 1) : "—"}
            </div>
          </div>
          <div className="hidden lg:block" />
          <div className="hidden lg:block" />
          <div>
            <span className="block text-[11px] font-medium text-brand-600">최종 예상 매출</span>
            <div className="mt-0.5 text-sm font-bold tabular-nums text-ink">{won(totals.expected_revenue)}</div>
          </div>
          <div>
            <span className="block text-[11px] font-medium text-brand-600">최종 예상 공헌이익</span>
            <div className="mt-0.5 text-sm font-bold tabular-nums text-ink">{won(totals.expected_contribution)}</div>
          </div>
        </div>
      )}

      {/* 아이템(BOM) */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-400">
            <tr>
              <th className="py-1 pr-3">SKU (구성)</th>
              <th className="py-1 pr-2 text-right">세트당 수량</th>
              <th className="py-1 pr-2 text-right">원가</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {opt.items.map((it) => (
              <ItemRow
                key={it.key}
                it={it}
                readOnly={readOnly}
                onPatch={(patch) => onPatchItem(it.key, patch)}
                onRemove={() => onRemoveItem(it.key)}
              />
            ))}
            {opt.items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-xs text-neutral-400">
                  구성 SKU가 없습니다. 아래에서 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && <AddSku onAdd={onAddItem} />}
      <p className="mt-1 text-[11px] text-neutral-400">
        옵션 단가·할인율을 직접 입력하세요(매출 구동). SKU는 구성(수량)·원가만. 공헌이익 = 옵션단가 × {mult.toFixed(3)} − Σ(원가 × 수량).
      </p>
      {!readOnly && (
        <div className="mt-2">
          <button
            onClick={onDuplicate}
            className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-3 transition hover:bg-soft hover:text-ink"
          >
            ⧉ 옵션 복제
          </button>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  it,
  readOnly,
  onPatch,
  onRemove,
}: {
  it: ItemState;
  readOnly: boolean;
  onPatch: (patch: Partial<ItemState>) => void;
  onRemove: () => void;
}) {
  // SKU 행 = 구성(수량) + 원가만. 개별 단가/할인율은 옵션 단가로 일원화(숨김).
  return (
    <tr className="border-t border-neutral-100 align-top">
      <td className="py-1 pr-3">{it.base_name}</td>
      <td className="py-1 pr-2 text-right">
        <input
          type="number"
          className="w-16 rounded border border-neutral-200 px-1.5 py-1 text-right disabled:bg-neutral-50"
          value={it.sku_qty_per_option || 0}
          disabled={readOnly}
          onChange={(e) => onPatch({ sku_qty_per_option: Number(e.target.value) || 0 })}
        />
      </td>
      <td className="py-1 pr-2 text-right tabular-nums text-neutral-500">{won(it.cost)}</td>
      <td className="py-1 text-right">
        {!readOnly && (
          <button
            onClick={onRemove}
            className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}

type SearchHit = {
  id: string;
  base_name: string;
  dr_code: string | null;
  consumer_price: number | null;
  regular_price: number | null;
  cost: number | null;
};

function AddSku({ onAdd }: { onAdd: (it: ItemState) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);

  async function search(v: string) {
    setQ(v);
    if (v.trim().length < 1) {
      setHits([]);
      return;
    }
    const supabase = createClient();
    const safe = v.replace(/[,()%]/g, " ").trim();
    const { data } = await supabase
      .from("products")
      .select("id, base_name, dr_code, consumer_price, regular_price, cost")
      .or(`base_name.ilike.%${safe}%,dr_code.ilike.%${safe}%`)
      .limit(20);
    // 불분명 품목(상품코드·소비자가·상시가 전부 없는, 실적에서 이름만 자동생성된 것) 숨김
    const clear = ((data as SearchHit[]) ?? []).filter(
      (h) => h.dr_code || h.consumer_price || h.regular_price,
    );
    setHits(clear.slice(0, 8));
    setOpen(true);
  }

  async function pick(h: SearchHit) {
    const supabase = createClient();
    // 시드 단가 = 단품 config sale_price(상시가), 없으면 상시가/소비자가
    const { data: cfg } = await supabase
      .from("product_price_configs")
      .select("id, sale_price")
      .eq("product_id", h.id)
      .eq("config_type", "단품")
      .limit(1)
      .maybeSingle();
    const seed =
      (cfg?.sale_price as number | null) ??
      h.regular_price ??
      h.consumer_price ??
      0;
    onAdd({
      key: uid(),
      product_id: h.id,
      base_name: h.base_name,
      sku_qty_per_option: 1,
      unit_sale_price: Number(seed) || 0,
      source_config_id: (cfg?.id as string | null) ?? null,
      consumer_price: h.consumer_price,
      regular_price: h.regular_price,
      cost: h.cost,
    });
    setQ("");
    setHits([]);
    setOpen(false);
  }

  return (
    <div className="relative mt-2">
      <input
        className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm"
        placeholder="+ SKU 추가 — 품목명/품목코드 검색"
        value={q}
        onChange={(e) => search(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
      />
      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => pick(h)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
              >
                <span>{h.base_name}</span>
                <span className="text-xs text-neutral-400">
                  {h.dr_code ?? ""} · {won(h.consumer_price)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
