"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Promotion } from "@/lib/types";
import { wonShort } from "@/lib/format";

type ProductItem = { product_id: string; base_name: string; revenue: number };
type Options = { benefitTypes: string[]; seasonalities: string[] };

export default function EditForm({
  promo,
  products,
  initialMainIds,
  options,
}: {
  promo: Promotion;
  products: ProductItem[];
  initialMainIds: string[];
  options: Options;
}) {
  const router = useRouter();
  const [name, setName] = useState(promo.name);
  const [promoTypes, setPromoTypes] = useState<string[]>(
    promo.promo_types ?? (promo.promo_type ? [promo.promo_type] : []),
  );
  const [seasonTag, setSeasonTag] = useState(promo.season_tag ?? "");
  const [purpose, setPurpose] = useState(promo.purpose ?? "");
  const [startDate, setStartDate] = useState(promo.start_date ?? "");
  const [endDate, setEndDate] = useState(promo.end_date ?? "");
  const [discountRate, setDiscountRate] = useState(
    promo.benefits?.discount_rate != null
      ? String(Math.round(promo.benefits.discount_rate * 100))
      : "",
  );
  const [giftName, setGiftName] = useState(promo.benefits?.gift?.name ?? "");
  const [giftValue, setGiftValue] = useState(
    promo.benefits?.gift?.value != null ? String(promo.benefits.gift.value) : "",
  );
  const [contribution, setContribution] = useState(
    promo.contribution_amount != null ? String(promo.contribution_amount) : "",
  );
  const [mainIds, setMainIds] = useState<string[]>(initialMainIds);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  function toggleType(t: string) {
    setPromoTypes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  }
  function toggleMain(id: string) {
    setMainIds((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }
  function selectFiltered() {
    setMainIds((m) => [...new Set([...m, ...filtered.map((p) => p.product_id)])]);
  }
  function clearMain() {
    setMainIds([]);
  }
  const allSelected = products.length > 0 && mainIds.length === products.length;

  async function save() {
    setSaving(true);
    const benefits: Record<string, unknown> = {};
    if (discountRate) benefits.discount_rate = Number(discountRate) / 100;
    if (giftName || giftValue)
      benefits.gift = {
        name: giftName || undefined,
        value: giftValue ? Number(giftValue) : undefined,
      };

    const res = await fetch(`/api/promotions/${promo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        promo_types: promoTypes,
        promo_type: promoTypes[0] ?? null,
        season_tag: seasonTag || null,
        purpose: purpose || null,
        start_date: startDate,
        end_date: endDate,
        benefits: Object.keys(benefits).length ? benefits : null,
        contribution_amount: contribution ? Number(contribution.replace(/[^0-9.-]/g, "")) : null,
        main_product_ids: mainIds,
      }),
    });
    setSaving(false);
    if (res.ok) router.push(`/promotions/${promo.id}`);
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "저장 실패 (Phase 2 SQL이 적용됐는지 확인하세요)");
    }
  }

  const filtered = query
    ? products.filter((p) => p.base_name.includes(query))
    : products;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">프로모션 편집</h1>
      <p className="mt-1 text-sm text-neutral-500">
        기간·목적·혜택을 채우고, 특별 혜택을 준 <strong>메인 상품</strong>을 지정하세요.
      </p>

      <div className="mt-6 space-y-5">
        <Field label="프로모션명">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="시작일">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="종료일">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label={`혜택 종류 (복수 선택) — ${promoTypes.length}개`}>
          <MultiChips options={options.benefitTypes} values={promoTypes} onToggle={toggleType} />
        </Field>

        <Field label="시즈널리티">
          <SingleChips options={options.seasonalities} value={seasonTag} onChange={setSeasonTag} />
        </Field>

        <Field label="목적">
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="예: 신제품 런칭 / 모래류 매출 극대화 / 3주년 / 재고 소진"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-neutral-400">
            ‘런칭·리뉴얼’ 등은 혜택이 아니라 <strong>목적</strong>에 적어주세요.
          </p>
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="대표 할인율(%)">
            <input value={discountRate} onChange={(e) => setDiscountRate(e.target.value)} inputMode="numeric" placeholder="50" className={inputCls} />
          </Field>
          <Field label="사은품">
            <input value={giftName} onChange={(e) => setGiftName(e.target.value)} placeholder="사은품명" className={inputCls} />
          </Field>
          <Field label="사은품 가치(₩)">
            <input value={giftValue} onChange={(e) => setGiftValue(e.target.value)} inputMode="numeric" placeholder="10000" className={inputCls} />
          </Field>
        </div>

        <Field label="공헌이익액 (직접 입력)">
          <input
            value={contribution}
            onChange={(e) => setContribution(e.target.value)}
            inputMode="numeric"
            placeholder="예: 12000000"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-neutral-400">
            자동 계산된 공헌이익률이 부정확할 때, 실제 공헌이익액을 직접 입력하면 이 값이 우선 사용됩니다.
          </p>
        </Field>

        <Field label={`메인 상품 지정 (${mainIds.length}/${products.length}개 선택)`}>
          <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => (allSelected ? clearMain() : setMainIds(products.map((p) => p.product_id)))}
              className="accent-brand-500"
            />
            전 상품 대상 (전체 선택)
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="상품명 검색"
            className={`mb-2 ${inputCls}`}
          />
          <div className="mb-2 flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={selectFiltered}
              className="rounded-full border border-neutral-200 px-2.5 py-1 text-neutral-600 hover:bg-neutral-50"
            >
              {query ? "검색결과 선택" : "전체 선택"}
            </button>
            <button
              type="button"
              onClick={clearMain}
              className="rounded-full border border-neutral-200 px-2.5 py-1 text-neutral-600 hover:bg-neutral-50"
            >
              전체 해제
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-neutral-200">
            {filtered.map((p) => (
              <label
                key={p.product_id}
                className="flex cursor-pointer items-center gap-2 border-b border-neutral-100 px-3 py-2 text-sm last:border-0 hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={mainIds.includes(p.product_id)}
                  onChange={() => toggleMain(p.product_id)}
                  className="accent-brand-500"
                />
                <span className="flex-1 truncate text-neutral-700">{p.base_name}</span>
                <span className="text-xs text-neutral-400">{wonShort(p.revenue)}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-neutral-400">상품이 없습니다.</div>
            )}
          </div>
        </Field>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-brand-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        <button
          onClick={() => router.push(`/promotions/${promo.id}`)}
          className="rounded-full border border-neutral-200 px-6 py-2.5 text-sm font-medium hover:bg-neutral-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-neutral-700">{label}</label>
      {children}
    </div>
  );
}

function MultiChips({
  options, values, onToggle,
}: {
  options: string[];
  values: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onToggle(o)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            values.includes(o)
              ? "border-brand-500 bg-brand-500 text-white"
              : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function SingleChips({
  options, value, onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? "" : o)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            value === o
              ? "border-brand-500 bg-brand-500 text-white"
              : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
