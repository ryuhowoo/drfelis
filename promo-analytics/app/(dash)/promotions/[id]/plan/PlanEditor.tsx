"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CampaignPlan, RateCard } from "@/lib/types";
import {
  computeOptionTotals,
  computePlanTotals,
  rateCardMult,
  discountFromPrice,
  priceFromDiscount,
  type PlanItemInput,
  type CouponSpec,
} from "@/lib/plan";
import { won, pct, num } from "@/lib/format";
import { validatePlan } from "@/lib/plan-validation";
import { InlineAlert, Dialog, DialogContent, DialogHeader, DialogFooter, Button } from "@/components/ui";
import PlanTemplatePanel from "./PlanTemplatePanel";

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
}: {
  promotionId: string;
  plan: CampaignPlan | null;
  initialOptions: EditorOption[];
  rateCard: RateCard | null;
  qtyHint?: QtyHint;
  purposes?: string[];
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
        option_label: `옵션 ${prev.length + 1}`,
        expected_option_qty: 0,
        is_main: false,
        match_patterns: [],
        items: [],
      },
    ]);
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
    router.refresh();
    setBusy(false);
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

      {/* 플랜 목적 + 목적별 총합 헤더 */}
      <div className="mt-4 rounded-2xl card-soft p-5">
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
              type="number" inputMode="numeric" min={0} disabled={confirmed}
              value={coupon.min || ""}
              onChange={(e) => { setCoupon((c) => ({ ...c, min: Math.max(0, Number(e.target.value) || 0) })); setDirty(true); }}
              placeholder="예: 50000"
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
              type="number" inputMode="numeric" min={0} disabled={confirmed}
              value={coupon.max || ""}
              onChange={(e) => { setCoupon((c) => ({ ...c, max: Math.max(0, Number(e.target.value) || 0) })); setDirty(true); }}
              placeholder="예: 10000"
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm tabular-nums text-ink outline-none transition focus:border-brand-400 disabled:opacity-60"
            />
          </label>
        </div>
      </div>

      {/* 이전 플랜 추천 (draft에서만) */}
      {!confirmed && <PlanTemplatePanel promotionId={promotionId} />}

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
        <button
          onClick={addOption}
          disabled={busy}
          className="mt-4 rounded-xl border border-dashed border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
        >
          + 옵션 추가
        </button>
      )}

      {/* SKU 단위 예상 수량 롤업 */}
      {planTotals.skuExpectedQty.size > 0 && (
        <div className="mt-6 rounded-xl card-soft p-4">
          <h3 className="text-sm font-medium">SKU 단위 예상 판매수 (전 옵션 합산)</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-400">
                <tr>
                  <th className="py-1 pr-3">SKU</th>
                  <th className="py-1 text-right">예상 수량</th>
                </tr>
              </thead>
              <tbody>
                {[...planTotals.skuExpectedQty.entries()].map(([pid, v]) => (
                  <tr key={pid} className="border-t border-neutral-100">
                    <td className="py-1 pr-3">{v.base_name}</td>
                    <td className="py-1 text-right">{num(v.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 액션 */}
      <div className="mt-6 flex flex-wrap gap-2">
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
  onAddItem: (it: ItemState) => void;
  onPatchItem: (itemKey: string, patch: Partial<ItemState>) => void;
  onRemoveItem: (itemKey: string) => void;
}) {
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
        <div className="flex flex-col gap-0.5">
          <label className="flex items-center gap-1 text-xs text-neutral-500">
            예상 세트수
            <input
              type="number"
              className="w-24 rounded-lg border border-neutral-200 px-2 py-1.5 text-right text-sm disabled:bg-neutral-50"
              value={opt.expected_option_qty || 0}
              disabled={readOnly}
              onChange={(e) =>
                onPatch({ expected_option_qty: Number(e.target.value) || 0 })
              }
            />
          </label>
          {(() => {
            const hv = opt.is_main ? qtyHint?.main : qtyHint?.sub;
            const hn = opt.is_main ? qtyHint?.mainN : qtyHint?.subN;
            return hv != null && hn ? (
              <span className="text-[10px] text-neutral-400">
                유사 캠페인 평균 {num(hv)}세트 ({hn}건, {opt.is_main ? "메인" : "서브"})
              </span>
            ) : null;
          })()}
        </div>
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

      {/* 옵션 롤업 */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
        <span>
          세트 단가 <b>{won(totals.set_price)}</b>
        </span>
        <span>할인(소비자) {pct(totals.discount_rate_consumer)}</span>
        <span>할인(상시) {pct(totals.discount_rate_regular)}</span>
        <span>
          예상매출 <b>{won(totals.expected_revenue)}</b>
        </span>
        <span>
          예상공헌 <b>{won(totals.expected_contribution)}</b>
        </span>
        {totals.free_shipping && (
          <span className="rounded bg-sky-100 px-1 text-sky-700">무배</span>
        )}
      </div>

      {/* 아이템(BOM) */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-400">
            <tr>
              <th className="py-1 pr-3">SKU</th>
              <th className="py-1 pr-2 text-right">세트당 수량</th>
              <th className="py-1 pr-2 text-right">단가</th>
              <th className="py-1 pr-2 text-right">할인율(소비자)</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {opt.items.map((it) => (
              <ItemRow
                key={it.key}
                it={it}
                optItemCount={opt.items.length}
                readOnly={readOnly}
                onPatch={(patch) => onPatchItem(it.key, patch)}
                onRemove={() => onRemoveItem(it.key)}
              />
            ))}
            {opt.items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-xs text-neutral-400">
                  구성 SKU가 없습니다. 아래에서 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && <AddSku onAdd={onAddItem} />}
      <p className="mt-1 text-[11px] text-neutral-400">
        공헌이익 = 세트단가 × {mult.toFixed(3)} − Σ(원가 × 수량). 물류비 12% 포함 고정.
      </p>
    </div>
  );
}

function ItemRow({
  it,
  optItemCount,
  readOnly,
  onPatch,
  onRemove,
}: {
  it: ItemState;
  optItemCount: number;
  readOnly: boolean;
  onPatch: (patch: Partial<ItemState>) => void;
  onRemove: () => void;
}) {
  const disc = discountFromPrice(it.consumer_price ?? 0, it.unit_sale_price);
  const canLoadBundle = optItemCount === 1 && it.sku_qty_per_option >= 2;

  async function loadBundle() {
    const supabase = createClient();
    const { data } = await supabase
      .from("product_price_configs")
      .select("id, sale_price, pack_count")
      .eq("product_id", it.product_id)
      .eq("pack_count", it.sku_qty_per_option)
      .limit(1)
      .maybeSingle();
    if (data?.sale_price)
      onPatch({
        unit_sale_price: Math.round(Number(data.sale_price) / it.sku_qty_per_option),
        source_config_id: data.id as string,
      });
  }

  return (
    <tr className="border-t border-neutral-100 align-top">
      <td className="py-1 pr-3">
        <div>{it.base_name}</div>
        {canLoadBundle && !readOnly && (
          <button
            onClick={loadBundle}
            className="mt-0.5 text-[11px] text-brand-600 hover:underline"
          >
            {it.sku_qty_per_option}묶음가 불러오기 (÷{it.sku_qty_per_option})
          </button>
        )}
      </td>
      <td className="py-1 pr-2 text-right">
        <input
          type="number"
          className="w-16 rounded border border-neutral-200 px-1.5 py-1 text-right disabled:bg-neutral-50"
          value={it.sku_qty_per_option || 0}
          disabled={readOnly}
          onChange={(e) => onPatch({ sku_qty_per_option: Number(e.target.value) || 0 })}
        />
      </td>
      <td className="py-1 pr-2 text-right">
        <input
          type="number"
          className="w-24 rounded border border-neutral-200 px-1.5 py-1 text-right disabled:bg-neutral-50"
          value={it.unit_sale_price || 0}
          disabled={readOnly}
          onChange={(e) =>
            onPatch({ unit_sale_price: Number(e.target.value) || 0, source_config_id: null })
          }
        />
      </td>
      <td className="py-1 pr-2 text-right">
        <input
          type="number"
          step="0.1"
          className="w-16 rounded border border-neutral-200 px-1.5 py-1 text-right disabled:bg-neutral-50"
          value={disc != null ? +(disc * 100).toFixed(1) : ""}
          disabled={readOnly || !it.consumer_price}
          onChange={(e) =>
            onPatch({
              unit_sale_price: priceFromDiscount(
                it.consumer_price ?? 0,
                (Number(e.target.value) || 0) / 100,
              ),
              source_config_id: null,
            })
          }
        />
        <span className="ml-0.5 text-xs text-neutral-400">%</span>
      </td>
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
      .limit(8);
    setHits((data as SearchHit[]) ?? []);
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
