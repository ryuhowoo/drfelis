"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CampaignPlan, RateCard } from "@/lib/types";
import {
  computeOptionTotals,
  computePlanTotals,
  effectiveMult,
  freebieDeduction,
  type PlanItemInput,
  type Coupon,
  type Freebie,
} from "@/lib/plan";
import { won, pct, pctFloor, num } from "@/lib/format";
import { validatePlan } from "@/lib/plan-validation";
import { InlineAlert, Dialog, DialogContent, DialogHeader, DialogFooter, Button, SegmentedControl } from "@/components/ui";
import PlanLoadPanel from "./PlanLoadPanel";
import SubProductSuggest, { type Bench } from "./SubProductSuggest";
import { downloadPlanXlsx, type ExportOption } from "@/lib/plan-export";
import { parsePlanWorkbook } from "@/lib/plan-import";
import { ensureProducts, isComponentName } from "@/lib/products";

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
  // 이 옵션 구성의 과거 평균 판매수 (서브 추천에서 추가 시 채워짐, 비구속 힌트)
  qty_bench?: number | null;
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

// 메인 카테고리 표기 — '배변용품'에는 '모래'가 통합돼 있어 라벨로 함께 보여준다(0065 데이터 통합).
function categoryLabel(c: string): string {
  return c === "배변용품" ? "배변용품(모래)" : c;
}

// ── 사은품・추가 할인 쿠폰 카드 항목 ─────────────────────────────
// 한 캠페인에 쿠폰을 여러 개 중첩하거나(정률/정액) 사은품을 동봉할 수 있어, 항목을 자유롭게 추가/삭제한다.
type CouponEntry = {
  id: string;
  type: "coupon";
  kind: "rate" | "flat";
  min: number; // 기준액 (원 이상)
  ratePct: number; // 정률 %
  max: number; // 정률 캡 (원, 0=무제한)
  flat: number; // 정액 할인 (원)
  label: string;
  group: string; // 유형(중복 규칙 그룹). 비면 독립(항상 중첩)
  stackSame: boolean; // 동일유형 중복 허용(금액대별 발행 케이스)
  burdenPct: number; // 자사 부담율 % (기본 100 = 전액 자사 부담)
};
type FreebieEntry = {
  id: string;
  type: "freebie";
  product_id: string | null;
  base_name: string;
  qty: number;
  cost: number; // 원가(VAT+) — 차감 기준
};
type ExtraEntry = CouponEntry | FreebieEntry;

const isCoupon = (e: ExtraEntry): e is CouponEntry => e.type === "coupon";
const isFreebie = (e: ExtraEntry): e is FreebieEntry => e.type === "freebie";

// 저장된 extras(JSON) 복원 + 레거시 단일 쿠폰(coupon_rate>0) 마이그레이션
function initialExtras(plan: {
  extras?: unknown;
  coupon_min_order?: number | null;
  coupon_rate?: number | null;
  coupon_max?: number | null;
} | null): ExtraEntry[] {
  const raw = plan?.extras;
  if (Array.isArray(raw)) {
    return (raw as Partial<ExtraEntry>[])
      .map((e): ExtraEntry | null => {
        if (e?.type === "freebie")
          return {
            id: uid(),
            type: "freebie",
            product_id: (e as FreebieEntry).product_id ?? null,
            base_name: (e as FreebieEntry).base_name ?? "",
            qty: Number((e as FreebieEntry).qty) || 0,
            cost: Number((e as FreebieEntry).cost) || 0,
          };
        if (e?.type === "coupon")
          return {
            id: uid(),
            type: "coupon",
            kind: (e as CouponEntry).kind === "flat" ? "flat" : "rate",
            min: Number((e as CouponEntry).min) || 0,
            ratePct: Number((e as CouponEntry).ratePct) || 0,
            max: Number((e as CouponEntry).max) || 0,
            flat: Number((e as CouponEntry).flat) || 0,
            label: (e as CouponEntry).label ?? "",
            group: (e as CouponEntry).group ?? "",
            stackSame: !!(e as CouponEntry).stackSame,
            burdenPct:
              (e as CouponEntry).burdenPct == null ? 100 : Number((e as CouponEntry).burdenPct),
          };
        return null;
      })
      .filter((e): e is ExtraEntry => e != null);
  }
  // 레거시 단일 쿠폰 → 쿠폰 항목 1개로 승격
  if ((Number(plan?.coupon_rate) || 0) > 0) {
    return [
      {
        id: uid(),
        type: "coupon",
        kind: "rate",
        min: Number(plan?.coupon_min_order) || 0,
        ratePct: (Number(plan?.coupon_rate) || 0) * 100,
        max: Number(plan?.coupon_max) || 0,
        flat: 0,
        label: "",
        group: "",
        stackSame: false,
        burdenPct: 100,
      },
    ];
  }
  return [];
}

function entryToCoupon(e: CouponEntry): Coupon {
  return {
    kind: e.kind,
    min_order_amount: e.min,
    discount_rate: e.ratePct / 100,
    max_discount_amount: e.max,
    flat_amount: e.flat,
    label: e.label,
    group: e.group,
    stack_same: e.stackSame,
    burden_rate: (e.burdenPct == null ? 100 : e.burdenPct) / 100,
  };
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
  channel,
  channelFee,
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
  channel?: string | null;
  channelFee?: number | null;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<OptState[]>(() => toState(initialOptions));
  // 플랜(캠페인) 단위 조건부 쿠폰 — UI는 할인율을 %로 입력
  const planC = plan as (CampaignPlan & {
    coupon_min_order?: number | null;
    coupon_rate?: number | null;
    coupon_max?: number | null;
    main_category?: string | null;
    extras?: unknown;
  }) | null;
  // 사은품・추가 할인 쿠폰 항목들 (다중 쿠폰 중첩 + 사은품 동봉)
  const [extras, setExtras] = useState<ExtraEntry[]>(() => initialExtras(planC));
  // Feature A/B — 메인 카테고리(서브 어태치율 추천 기준). '전체'=전사 할인(n주년 등) 분석.
  const [mainCategory, setMainCategory] = useState<string>(() => planC?.main_category || "전체");
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      // 관리 카테고리 목록(정렬) 우선, 없으면 상품 distinct 로 보완(0072 미적용 환경 대비)
      const { data: managed } = await supabase.from("product_categories").select("name, sort").order("sort");
      const { data } = await supabase.from("products").select("category").not("category", "is", null);
      if (!alive) return;
      const fromProducts = [...new Set((data ?? []).map((r) => (r.category as string)?.trim()).filter(Boolean))];
      const ordered = (managed ?? []).map((c) => c.name as string);
      const uniq = [...new Set([...ordered, ...fromProducts])];
      setCategories(uniq.length > 0 ? uniq : fromProducts.sort());
    })();
    return () => {
      alive = false;
    };
  }, []);
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
      ? effectiveMult(rateCard, channelFee)
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
        const d = JSON.parse(raw) as { options?: OptState[]; extras?: ExtraEntry[]; mainCategory?: string };
        if (Array.isArray(d.options) && d.options.length > 0) {
          setOptions(d.options);
          if (Array.isArray(d.extras)) setExtras(d.extras);
          if (d.mainCategory) setMainCategory(d.mainCategory);
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
        localStorage.setItem(draftKey, JSON.stringify({ options, extras, mainCategory, ts: Date.now() }));
      } catch {
        /* 용량 초과 등 무시 */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [options, extras, mainCategory, draftKey, confirmed]);
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
    setExtras(initialExtras(planC));
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

  // 쿠폰·사은품 분해 (정률/정액 다중 쿠폰 중첩 + 사은품 동봉 차감)
  const couponList: Coupon[] = extras.filter(isCoupon).map(entryToCoupon);
  const freebies: Freebie[] = extras.filter(isFreebie).map((f) => ({
    product_id: f.product_id,
    base_name: f.base_name,
    qty: f.qty,
    cost: f.cost,
  }));
  const freebieTotal = freebieDeduction(freebies);

  // ── 라이브 롤업 ──────────────────────────────
  const optionResults = options.map((o) => {
    const inputs: PlanItemInput[] = o.items.map((it) => ({
      sku_qty_per_option: it.sku_qty_per_option,
      unit_sale_price: it.unit_sale_price,
      consumer_price: it.consumer_price,
      regular_price: it.regular_price,
      cost: it.cost,
    }));
    return computeOptionTotals(inputs, mult, o.expected_option_qty, couponList);
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
  // 사은품 차감 후 최종 공헌이익 (사은품은 동봉 발송 → 원가×수량만 일괄 차감)
  const contribNet = planTotals.expected_contribution_total - freebieTotal;
  const contribRate =
    planTotals.expected_revenue_total > 0
      ? contribNet / planTotals.expected_revenue_total
      : null;
  const couponTotal = optionResults.reduce(
    (s, r, i) => s + r.coupon_discount * (options[i].expected_option_qty || 0),
    0,
  );

  // ── 인라인 검증 (확정 전 오류 발견) ──────────
  const validation = validatePlan(options, mult);

  // ── 사은품・쿠폰 항목 변경 헬퍼 ───────────────
  const addCouponEntry = () => {
    setDirty(true);
    setExtras((prev) => [
      ...prev,
      { id: uid(), type: "coupon", kind: "rate", min: 50000, ratePct: 5, max: 0, flat: 0, label: "", group: "", stackSame: false, burdenPct: 100 },
    ]);
  };
  const addFreebieEntry = () => {
    setDirty(true);
    setExtras((prev) => [
      ...prev,
      { id: uid(), type: "freebie", product_id: null, base_name: "", qty: 0, cost: 0 },
    ]);
  };
  const patchExtra = (id: string, patch: Partial<ExtraEntry>) => {
    setDirty(true);
    setExtras((prev) => prev.map((e) => (e.id === id ? ({ ...e, ...patch } as ExtraEntry) : e)));
  };
  const removeExtra = (id: string) => {
    setDirty(true);
    setExtras((prev) => prev.filter((e) => e.id !== id));
  };

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
  // 메인 체크 토글 — 메인 옵션은 위로, 서브는 아래로 안정 정렬(상대 순서 유지)
  const toggleMain = (key: string, isMain: boolean) => {
    setDirty(true);
    setOptions((prev) => {
      const next = prev.map((o) => (o.key === key ? { ...o, is_main: isMain } : o));
      return [...next.filter((o) => o.is_main), ...next.filter((o) => !o.is_main)];
    });
  };
  // 드래그로 옵션 카드 순서 변경 — from 카드를 to 위치로 이동
  const dragKey = useRef<string | null>(null);
  const moveOption = (from: string, to: string) => {
    if (from === to) return;
    setDirty(true);
    setOptions((prev) => {
      const fi = prev.findIndex((o) => o.key === from);
      const ti = prev.findIndex((o) => o.key === to);
      if (fi < 0 || ti < 0) return prev;
      const next = [...prev];
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      return next;
    });
  };
  // Phase 4 — 벤치마크 추천 서브상품을 옵션으로 추가.
  // 옵션 단가는 '상시 판매가'로 들어간다(할인 안 하는 서브를 평균 할인가로 채우면 수정이 번거로움).
  function buildSubOption(b: Bench): OptState {
    const unit = b.regular_price ?? b.consumer_price ?? Math.round(b.avg_unit_price) ?? 0;
    // Feature A — 어태치율이 있으면 (계획 메인 수량 × 어태치율)로 환산, 없으면 과거 평균 수량
    const mq = options.filter((o) => o.is_main).reduce((s, o) => s + (o.expected_option_qty || 0), 0);
    const qty =
      b.avg_attach_ratio != null && mq > 0
        ? Math.round(b.avg_attach_ratio * mq) || 0
        : Math.round(b.avg_qty) || 0;
    return {
      key: uid(),
      option_label: b.base_name,
      expected_option_qty: qty,
      is_main: false,
      qty_bench: Math.round(b.avg_qty) || null,
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
    // 레거시 단일 쿠폰 컬럼(coupon_*) 은 첫 정률 쿠폰으로 채워 하위호환 유지, 전체는 extras로 저장
    const firstRate = extras.find((e): e is CouponEntry => isCoupon(e) && e.kind === "rate" && e.ratePct > 0);
    return {
      plan_id: plan!.id,
      coupon: firstRate
        ? { min_order: firstRate.min, rate: firstRate.ratePct / 100, max: firstRate.max }
        : { min_order: 0, rate: 0, max: 0 },
      extras: extras.map((e) =>
        isFreebie(e)
          ? { type: "freebie", product_id: e.product_id, base_name: e.base_name, qty: e.qty, cost: e.cost }
          : { type: "coupon", kind: e.kind, min: e.min, ratePct: e.ratePct, max: e.max, flat: e.flat, label: e.label, group: e.group, stackSame: e.stackSame, burdenPct: e.burdenPct },
      ),
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
    // Feature B — 선택한 메인 카테고리 저장(다음 플래닝 시 기준 기억). best-effort: 컬럼 미적용 시 무시.
    if (plan) {
      try {
        await createClient()
          .from("campaign_plans")
          .update({ main_category: mainCategory === "전체" ? null : mainCategory })
          .eq("id", plan.id);
      } catch {
        /* 0059 미적용 등 무시 */
      }
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
    // 확정 완료 → 해당 캠페인 상세(SKU·옵션)로 이동
    router.push(`/promotions/${promotionId}?view=skus`);
    router.refresh();
    setBusy(false);
  }

  function exportXlsx() {
    const firstRate = extras.find((e): e is CouponEntry => isCoupon(e) && e.kind === "rate" && e.ratePct > 0);
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
        channel: channel ?? null,
      },
      exOptions,
      {
        revenue: planTotals.expected_revenue_total,
        order_count: expOrderCount,
        sku_units: expSkuUnits,
        contribution: contribNet,
        contribution_rate: contribRate,
      },
      firstRate ? { min: firstRate.min, ratePct: firstRate.ratePct, max: firstRate.max } : null,
    );
  }

  // Excel 가져오기 (로드맵 3.2) — 내보낸 양식의 '플랜' 시트를 파싱해 옵션을 추가
  async function importXlsx(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const { options: parsed } = parsePlanWorkbook(buf);
      if (parsed.length === 0)
        throw new Error("'플랜' 시트를 찾지 못했습니다 — 내보낸 양식인지 확인하세요.");
      const supabase = createClient();
      const names = [...new Set(parsed.flatMap((o) => o.items.map((it) => it.base_name)))];
      const idMap = await ensureProducts(supabase, names);
      const ids = [...new Set([...idMap.values()])];
      const econ: Record<string, { consumer_price: number | null; regular_price: number | null; cost: number | null }> = {};
      if (ids.length > 0) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, consumer_price, regular_price, cost")
          .in("id", ids);
        for (const p of prods ?? [])
          econ[p.id as string] = {
            consumer_price: p.consumer_price as number | null,
            regular_price: p.regular_price as number | null,
            cost: p.cost as number | null,
          };
      }
      const editorOpts: EditorOption[] = parsed.map((o) => ({
        option_label: o.option_label,
        expected_option_qty: o.expected_option_qty,
        is_main: o.is_main,
        match_patterns: [],
        frozen: null,
        items: o.items
          .map((it) => {
            const pid = idMap.get(it.base_name) ?? "";
            const e = econ[pid];
            return {
              product_id: pid,
              base_name: it.base_name,
              sku_qty_per_option: it.sku_qty_per_option,
              unit_sale_price: it.unit_sale_price,
              source_config_id: null,
              consumer_price: e?.consumer_price ?? it.consumer_price ?? null,
              regular_price: e?.regular_price ?? it.regular_price ?? null,
              cost: e?.cost ?? it.cost ?? null,
            };
          })
          .filter((it) => it.product_id),
      }));
      loadPlanOptions(editorOpts);
      setMsg({ kind: "ok", text: `엑셀에서 옵션 ${editorOpts.length}개를 불러왔습니다. 검토 후 저장하세요.` });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "가져오기 실패" });
    } finally {
      setBusy(false);
    }
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
          <Stat
            label="예상 매출액"
            value={won(planTotals.expected_revenue_total)}
            sub={couponTotal > 0 ? `쿠폰 할인 반영 −${won(couponTotal)}` : undefined}
            primary
          />
          <Stat label="구매건수 (세트)" value={num(expOrderCount)} />
          <Stat label="판매수량 (SKU)" value={num(expSkuUnits)} />
          <Stat
            label="공헌이익액"
            value={won(contribNet)}
            sub={freebieTotal > 0 ? `사은품 차감 −${won(freebieTotal)}` : undefined}
          />
          <Stat label="공헌이익률" value={contribRate != null ? pct(contribRate, 1) : "—"} />
        </div>
        <div className="mt-2 text-[11px] text-ink-4">
          옵션 {num(options.length)}종 · SKU {num(planTotals.skuExpectedQty.size)}종
        </div>
      </div>

      {/* 사은품・추가 할인 쿠폰 (플랜 단위 · 쿠폰 다중 중첩 + 사은품 동봉) */}
      <div className="mt-3 rounded-2xl card-soft p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-2">사은품・추가 할인 쿠폰</h3>
          <span className="text-[11px] text-ink-4">쿠폰: 옵션 혜택가가 기준액 이상이면 자동 적용</span>
        </div>

        {extras.length === 0 ? (
          <p className="mt-3 text-xs text-ink-4">
            추가 쿠폰이나 동봉 사은품이 없습니다. 아래에서 추가하세요. 쿠폰은 여러 개를 중첩 적용할 수 있어요.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {extras.map((e, i) =>
              isCoupon(e) ? (
                <CouponRow
                  key={e.id}
                  entry={e}
                  index={extras.filter((x, j) => isCoupon(x) && j <= i).length}
                  readOnly={confirmed}
                  onPatch={(patch) => patchExtra(e.id, patch)}
                  onRemove={() => removeExtra(e.id)}
                />
              ) : (
                <FreebieRow
                  key={e.id}
                  entry={e}
                  readOnly={confirmed}
                  onPatch={(patch) => patchExtra(e.id, patch)}
                  onRemove={() => removeExtra(e.id)}
                />
              ),
            )}
          </ul>
        )}
        <datalist id="coupon-groups">
          {[...new Set(extras.filter(isCoupon).map((e) => e.group).filter(Boolean))].map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>

        {!confirmed && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={addCouponEntry}
              className="rounded-lg border border-dashed border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
            >
              + 쿠폰 추가
            </button>
            <button
              onClick={addFreebieEntry}
              className="rounded-lg border border-dashed border-secondary-300 px-3 py-1.5 text-xs font-medium text-secondary-700 hover:bg-secondary-50"
            >
              + 사은품 추가
            </button>
          </div>
        )}
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

      {/* 옵션들 — 드래그로 순서 변경 가능 */}
      <div className="mt-5 space-y-4">
        {options.map((o, i) => {
          const issues = validation.byOption[o.key] ?? [];
          return (
            <div
              key={o.key}
              onDragOver={confirmed ? undefined : (e) => e.preventDefault()}
              onDrop={
                confirmed
                  ? undefined
                  : (e) => {
                      e.preventDefault();
                      if (dragKey.current) moveOption(dragKey.current, o.key);
                      dragKey.current = null;
                    }
              }
            >
              <OptionCard
                opt={o}
                totals={optionResults[i]}
                mult={mult}
                qtyHint={qtyHint}
                readOnly={confirmed}
                invalid={issues.some((x) => x.level === "error")}
                onPatch={(patch) => patchOption(o.key, patch)}
                onToggleMain={(v) => toggleMain(o.key, v)}
                onRemove={() => removeOption(o.key)}
                onDuplicate={() => duplicateOption(o.key)}
                onAddItem={(it) => addItem(o.key, it)}
                onPatchItem={(itemKey, patch) => patchItem(o.key, itemKey, patch)}
                onRemoveItem={(itemKey) => removeItem(o.key, itemKey)}
                onDragStart={() => {
                  dragKey.current = o.key;
                }}
                onDragEnd={() => {
                  dragKey.current = null;
                }}
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
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl card-soft px-5 py-3">
            <span className="text-sm font-semibold text-ink-2">메인 카테고리</span>
            <SegmentedControl
              ariaLabel="메인 카테고리 선택"
              value={mainCategory}
              onValueChange={(v) => {
                setMainCategory(v);
                setDirty(true);
              }}
              options={[
                { value: "전체", label: "전체" },
                ...categories.map((c) => ({ value: c, label: categoryLabel(c) })),
              ]}
            />
            <span className="text-[11px] text-ink-4">
              선택한 카테고리가 메인이던 과거 캠페인의 ‘함께 담은 비율’로 서브 수량을 제안합니다. ‘전체’=전사 할인(n주년 등).
            </span>
          </div>
          <SubProductSuggest
            existingProductIds={options.flatMap((o) => o.items.map((it) => it.product_id))}
            mainCategory={mainCategory}
            mainQty={options.filter((o) => o.is_main).reduce((s, o) => s + (o.expected_option_qty || 0), 0)}
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
        {!confirmed && (
          <label
            className={`cursor-pointer rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-2 hover:bg-soft ${busy ? "pointer-events-none opacity-50" : ""}`}
            title="내보낸 양식의 엑셀을 올려 옵션을 한 번에 채우기"
          >
            ⬆ Excel 가져오기
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importXlsx(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
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
            title="이대로 확정할까요?"
            description="확정하면 rate card·가격·원가가 이 시점으로 동결됩니다. 확정 후에도 '수정(새 버전)'으로 언제든 변경할 수 있어요. 확정이 끝나면 캠페인 상세로 이동합니다."
          />
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">목표 매출</dt>
              <dd className="font-semibold tabular-nums text-ink">{won(planTotals.expected_revenue_total)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">목표 공헌이익{freebieTotal > 0 ? " (사은품 차감 후)" : ""}</dt>
              <dd className="font-semibold tabular-nums text-ink">{won(contribNet)}</dd>
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
  sub,
  primary,
}: {
  label: string;
  value: string;
  sub?: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${primary ? "bg-brand-50" : "card-soft"}`}
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-4">{sub}</div>}
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
  onToggleMain,
  onRemove,
  onDuplicate,
  onAddItem,
  onPatchItem,
  onRemoveItem,
  onDragStart,
  onDragEnd,
}: {
  opt: OptState;
  totals: ReturnType<typeof computeOptionTotals>;
  mult: number;
  qtyHint?: QtyHint;
  readOnly: boolean;
  invalid?: boolean;
  onPatch: (patch: Partial<OptState>) => void;
  onToggleMain: (v: boolean) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddItem: (it: ItemState) => void;
  onPatchItem: (itemKey: string, patch: Partial<ItemState>) => void;
  onRemoveItem: (itemKey: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  // 드래그는 핸들(⠿)을 잡았을 때만 활성 — 입력 필드 드래그 선택과 충돌 방지
  const [dragging, setDragging] = useState(false);
  // 옵션 단가/할인율을 '주 입력'으로 — 입력 시 SKU 단가들을 비례 스케일해
  // set_price=Σ(sku×price) 계약을 유지(백엔드 무변). 입력 중 jitter 방지로 blur 시 적용.
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [discDraft, setDiscDraft] = useState<string | null>(null);

  // 입력한 옵션 단가를 '정확히' 유지한다. set_price=Σ(sku_qty×unit_sale_price) 계약을
  // 지키려면 정수 단가로는 입력값을 못 맞추는 경우가 있어(예: 수량3, 89,900 → 89,898 드리프트),
  // 단가를 소수까지 허용해 Σ가 입력값과 정확히 일치하도록 비례 배분한다(단가는 숨김 값이라 무방).
  function applyOptionPrice(newPrice: number) {
    const items = opt.items;
    if (items.length === 0 || !(newPrice >= 0)) return;
    const cur = totals.set_price;
    if (cur > 0) {
      const f = newPrice / cur;
      items.forEach((it) =>
        onPatchItem(it.key, { unit_sale_price: Math.max(0, it.unit_sale_price * f), source_config_id: null }),
      );
    } else if (totals.consumer_total > 0) {
      items.forEach((it) => {
        const share = ((it.consumer_price ?? 0) * (it.sku_qty_per_option || 0)) / totals.consumer_total;
        const q = Math.max(1, it.sku_qty_per_option || 1);
        onPatchItem(it.key, { unit_sale_price: (newPrice * share) / q, source_config_id: null });
      });
    } else {
      const totalQty = items.reduce((s, it) => s + (it.sku_qty_per_option || 0), 0) || items.length;
      const perUnit = newPrice / totalQty;
      items.forEach((it) => onPatchItem(it.key, { unit_sale_price: perUnit, source_config_id: null }));
    }
  }
  function applyDiscount(ratePct: number) {
    if (totals.consumer_total <= 0) return;
    // 입력 할인율은 정수 기준으로 받되, 단가는 정확히 반영(반올림 없이)
    applyOptionPrice(totals.consumer_total * (1 - ratePct / 100));
  }

  const qty = opt.expected_option_qty || 0;
  const unitsPerSet = opt.items.reduce((s, it) => s + (it.sku_qty_per_option || 0), 0);
  // 상단은 쿠폰 전(목록가 기준), 쿠폰 적용 옵션은 아래 '최종' 줄에서 반영
  const preRevenue = totals.set_price * qty;
  const preContribution = (totals.set_price * mult - totals.cost_total) * qty;

  return (
    <div
      className={`rounded-xl card-soft p-4 ${invalid ? "ring-1 ring-danger/40" : ""} ${dragging ? "opacity-60 ring-2 ring-brand-300" : ""}`}
      draggable={dragging && !readOnly}
      onDragStart={onDragStart}
      onDragEnd={() => {
        setDragging(false);
        onDragEnd();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <button
            type="button"
            aria-label="드래그하여 순서 변경"
            title="드래그하여 순서 변경"
            onMouseDown={() => setDragging(true)}
            onMouseUp={() => setDragging(false)}
            className="cursor-grab select-none px-1 text-base leading-none text-ink-4 hover:text-ink-2 active:cursor-grabbing"
          >
            ⠿
          </button>
        )}
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
            onChange={(e) => onToggleMain(e.target.checked)}
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
              step="1"
              min={0}
              max={100}
              disabled={readOnly || totals.consumer_total <= 0}
              value={discDraft ?? (totals.discount_rate_consumer != null ? Math.floor(totals.discount_rate_consumer * 100) : "")}
              onChange={(e) => setDiscDraft(e.target.value)}
              onBlur={() => { if (discDraft != null) { applyDiscount(Number(discDraft) || 0); setDiscDraft(null); } }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-brand-400 disabled:opacity-60"
            />
            <span className="text-xs text-ink-4">%</span>
          </div>
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-ink-4">예상 판매수</span>
          <input
            type="number"
            className="mt-0.5 w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-brand-400 disabled:opacity-60"
            value={opt.expected_option_qty || 0}
            disabled={readOnly}
            onChange={(e) => onPatch({ expected_option_qty: Number(e.target.value) || 0 })}
          />
          {(() => {
            // 이 옵션 구성의 과거 평균(서브 추천에서 추가 시)이 있으면 우선, 없으면 메인/서브 전역 평균
            if (opt.qty_bench != null && opt.qty_bench > 0) {
              return (
                <span className="mt-0.5 block text-[10px] text-neutral-400">
                  이 구성 평균 {num(opt.qty_bench)}개
                </span>
              );
            }
            const hv = opt.is_main ? qtyHint?.main : qtyHint?.sub;
            const hn = opt.is_main ? qtyHint?.mainN : qtyHint?.subN;
            return hv != null && hn ? (
              <span className="mt-0.5 block text-[10px] text-neutral-400">
                유사 평균 {num(hv)}개 ({hn}건)
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
          <div className="mt-0.5 flex flex-wrap items-center gap-1 py-1.5">
            <span className="text-sm font-bold tabular-nums text-ink">{won(preContribution)}</span>
            {totals.free_shipping && (
              <span className="rounded bg-secondary-100 px-1 text-[10px] text-secondary-700">무배</span>
            )}
            {totals.coupon_amounts.map((amt, ci) =>
              amt > 0 ? (
                <span key={ci} className="rounded bg-brand-100 px-1 text-[10px] font-medium text-brand-700">
                  쿠폰{ci + 1}
                </span>
              ) : null,
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
              {pctFloor(totals.discount_rate_consumer_net)}
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

// 입력 스타일 공통
const fieldCls =
  "mt-0.5 w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm tabular-nums text-ink outline-none focus:border-brand-400 disabled:opacity-60";
const labelCls = "block text-[11px] font-medium text-ink-4";

function CouponRow({
  entry,
  index,
  readOnly,
  onPatch,
  onRemove,
}: {
  entry: CouponEntry;
  index: number;
  readOnly: boolean;
  onPatch: (patch: Partial<CouponEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-xl border border-line bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
            쿠폰{index}
          </span>
          <select
            value={entry.kind}
            disabled={readOnly}
            onChange={(e) => onPatch({ kind: e.target.value as "rate" | "flat" })}
            className="rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink disabled:opacity-60"
          >
            <option value="rate">정률(%)</option>
            <option value="flat">정액(원)</option>
          </select>
          <input
            value={entry.label}
            disabled={readOnly}
            placeholder="쿠폰 이름(선택, 예: 카톡 추가)"
            onChange={(e) => onPatch({ label: e.target.value })}
            className="w-44 rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink disabled:opacity-60"
          />
        </div>
        {!readOnly && (
          <button onClick={onRemove} className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50">
            삭제
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="block">
          <span className={labelCls}>기준액 (원 이상)</span>
          <input
            type="text"
            inputMode="numeric"
            disabled={readOnly}
            value={entry.min ? entry.min.toLocaleString("ko-KR") : ""}
            onChange={(e) => onPatch({ min: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
            placeholder="예: 50,000"
            className={fieldCls}
          />
        </label>
        {entry.kind === "rate" ? (
          <>
            <label className="block">
              <span className={labelCls}>할인율 (%)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                disabled={readOnly}
                value={entry.ratePct || ""}
                onChange={(e) => onPatch({ ratePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                placeholder="예: 5"
                className={fieldCls}
              />
            </label>
            <label className="block">
              <span className={labelCls}>최대 할인 (원, 0=무제한)</span>
              <input
                type="text"
                inputMode="numeric"
                disabled={readOnly}
                value={entry.max ? entry.max.toLocaleString("ko-KR") : ""}
                onChange={(e) => onPatch({ max: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                placeholder="예: 10,000"
                className={fieldCls}
              />
            </label>
          </>
        ) : (
          <label className="col-span-2 block">
            <span className={labelCls}>정액 할인 (원) — 예: 배송비 대신 5,000</span>
            <input
              type="text"
              inputMode="numeric"
              disabled={readOnly}
              value={entry.flat ? entry.flat.toLocaleString("ko-KR") : ""}
              onChange={(e) => onPatch({ flat: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
              placeholder="예: 5,000"
              className={fieldCls}
            />
          </label>
        )}
      </div>

      {/* 중복(스택) 규칙 + 자사 부담율 */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className={labelCls}>유형(중복 그룹)</span>
          <input
            type="text"
            list="coupon-groups"
            disabled={readOnly}
            value={entry.group}
            onChange={(e) => onPatch({ group: e.target.value })}
            placeholder="예: 기본할인 / 카톡 / 네이버"
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className={labelCls}>자사 부담율 (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            disabled={readOnly}
            value={entry.burdenPct}
            onChange={(e) => onPatch({ burdenPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            placeholder="100"
            className={`${fieldCls} text-right`}
          />
        </label>
        <label className="flex items-end gap-1.5 pb-1.5 text-xs text-ink-3">
          <input
            type="checkbox"
            disabled={readOnly || !entry.group.trim()}
            checked={entry.stackSame}
            onChange={(e) => onPatch({ stackSame: e.target.checked })}
          />
          동일유형 중복 허용
        </label>
      </div>
      <p className="mt-1 text-[11px] text-ink-4">
        같은 <b>유형</b>끼리는 기본 <b>중복 불가</b>(가장 큰 할인 1개만) · 다른 유형은 중첩. 금액대별로 여러 개 발행돼 모두 적용되면
        ‘동일유형 중복 허용’을 켜세요. 부담율 100%=우리가 전액, <b>네이버 100% 지원=0%</b>, 5:5 분담=50%.
        (매출은 전체 할인 반영, <b>공헌이익만</b> 부담율로 보정)
      </p>
    </li>
  );
}

function FreebieRow({
  entry,
  readOnly,
  onPatch,
  onRemove,
}: {
  entry: FreebieEntry;
  readOnly: boolean;
  onPatch: (patch: Partial<FreebieEntry>) => void;
  onRemove: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);

  async function search(v: string) {
    setQ(v);
    if (v.trim().length < 1) {
      setHits([]);
      return;
    }
    const safe = v.replace(/[,()%]/g, " ").trim();
    const { data } = await createClient()
      .from("products")
      .select("id, base_name, dr_code, consumer_price, regular_price, cost")
      .or(`base_name.ilike.%${safe}%,dr_code.ilike.%${safe}%`)
      .limit(30);
    // 사은품은 스티커·약봉투·팜플렛 등 부재료/판촉물도 쓰이므로 구성품도 포함해 모두 노출
    setHits(((data as SearchHit[]) ?? []).slice(0, 8));
    setOpen(true);
  }
  function pick(h: SearchHit) {
    onPatch({ product_id: h.id, base_name: h.base_name, cost: Number(h.cost) || 0 });
    setQ("");
    setHits([]);
    setOpen(false);
  }

  const deduction = (Number(entry.cost) || 0) * (Number(entry.qty) || 0);

  return (
    <li className="rounded-xl border border-secondary-200 bg-secondary-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded bg-secondary-100 px-1.5 py-0.5 text-[10px] font-semibold text-secondary-700">
          사은품 (동봉)
        </span>
        {!readOnly && (
          <button onClick={onRemove} className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50">
            삭제
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="relative col-span-2">
          <span className={labelCls}>사은품 SKU</span>
          {entry.product_id ? (
            <div className="mt-0.5 flex items-center justify-between gap-2 rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink">
              <span className="truncate">{entry.base_name}</span>
              {!readOnly && (
                <button
                  onClick={() => onPatch({ product_id: null, base_name: "", cost: 0 })}
                  className="shrink-0 text-xs text-red-500 hover:underline"
                >
                  변경
                </button>
              )}
            </div>
          ) : (
            <>
              <input
                className={fieldCls}
                placeholder="품목명/품목코드 검색"
                value={q}
                disabled={readOnly}
                onChange={(e) => search(e.target.value)}
                onFocus={() => hits.length && setOpen(true)}
              />
              {open && hits.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        onClick={() => pick(h)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
                      >
                        <span className="truncate">{h.base_name}</span>
                        <span className="shrink-0 text-xs text-neutral-400">원가 {won(h.cost)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <label className="block">
          <span className={labelCls}>원가 (차감 기준)</span>
          <input
            type="text"
            inputMode="numeric"
            disabled={readOnly}
            value={entry.cost ? entry.cost.toLocaleString("ko-KR") : ""}
            onChange={(e) => onPatch({ cost: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
            placeholder="자동·직접입력"
            className={`${fieldCls} text-right`}
          />
        </label>
        <label className="block">
          <span className={labelCls}>수량 (한정)</span>
          <input
            type="number"
            min={0}
            disabled={readOnly}
            value={entry.qty || 0}
            onChange={(e) => onPatch({ qty: Number(e.target.value) || 0 })}
            className={`${fieldCls} text-right`}
          />
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-4">
        차감액 = 원가 {won(entry.cost)} × 수량 {num(entry.qty)} = <b className="text-ink-2">−{won(deduction)}</b>{" "}
        (동봉 발송이라 물류비·광고비는 제외). 원가가 비어 있으면 직접 입력하세요.
      </p>
    </li>
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
  channel?: string | null;
  status?: string | null;
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
      .select("id, base_name, dr_code, consumer_price, regular_price, cost, channel, status")
      .or(`base_name.ilike.%${safe}%,dr_code.ilike.%${safe}%`)
      .limit(40);
    const clear = ((data as SearchHit[]) ?? []).filter(
      // 불분명 품목(상품코드·소비자가·상시가 전부 없는, 성과에서 이름만 자동생성된 것) 숨김
      (h) => (h.dr_code || h.consumer_price || h.regular_price) &&
        // 원재료·부재료·부자재(비판매 구성품)는 옵션에 담지 않으므로 제외
        !isComponentName(h.base_name) &&
        // 비B2C 채널·품절·단종은 옵션에서 제외(채널 미지정=구버전 데이터는 허용)
        (h.channel == null || h.channel === "B2C") &&
        h.status !== "품절" && h.status !== "단종",
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
      .eq("sale_mode", "상시")
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
