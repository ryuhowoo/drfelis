"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Promotion } from "@/lib/types";
import { wonShort } from "@/lib/format";

const PROMO_TYPES = ["할인", "사은품", "1+1", "2+2", "번들", "쿠폰", "적립", "런칭"];
const SEASON_TAGS = [
  "N주년",
  "세계 고양이의 날",
  "한국 고양이의 날",
  "명절",
  "크리스마스",
  "블랙프라이데이",
  "신학기",
  "여름",
  "겨울",
];

type ProductItem = { product_id: string; base_name: string; revenue: number };

export default function EditForm({
  promo,
  products,
  initialMainIds,
}: {
  promo: Promotion;
  products: ProductItem[];
  initialMainIds: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(promo.name);
  const [promoType, setPromoType] = useState(promo.promo_type ?? "");
  const [seasonTag, setSeasonTag] = useState(promo.season_tag ?? "");
  const [purpose, setPurpose] = useState(promo.purpose ?? "");
  const [discountRate, setDiscountRate] = useState(
    promo.benefits?.discount_rate != null
      ? String(Math.round(promo.benefits.discount_rate * 100))
      : "",
  );
  const [giftName, setGiftName] = useState(promo.benefits?.gift?.name ?? "");
  const [giftValue, setGiftValue] = useState(
    promo.benefits?.gift?.value != null ? String(promo.benefits.gift.value) : "",
  );
  const [mainIds, setMainIds] = useState<string[]>(initialMainIds);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  function toggleMain(id: string) {
    setMainIds((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

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
        promo_type: promoType || null,
        season_tag: seasonTag || null,
        purpose: purpose || null,
        benefits: Object.keys(benefits).length ? benefits : null,
        main_product_ids: mainIds,
      }),
    });
    setSaving(false);
    if (res.ok) router.push(`/promotions/${promo.id}`);
  }

  const filtered = query
    ? products.filter((p) => p.base_name.includes(query))
    : products;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">프로모션 편집</h1>
      <p className="mt-1 text-sm text-neutral-500">
        목적·혜택·시점을 채우고, 특별 혜택을 준 <strong>메인 상품</strong>을
        지정하세요. (예측·사례 분류에 쓰입니다)
      </p>

      <div className="mt-6 space-y-5">
        <Field label="프로모션명">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="혜택 종류">
            <ChipSelect
              options={PROMO_TYPES}
              value={promoType}
              onChange={setPromoType}
            />
          </Field>
          <Field label="시점 / 시즌">
            <ChipSelect
              options={SEASON_TAGS}
              value={seasonTag}
              onChange={setSeasonTag}
            />
          </Field>
        </div>

        <Field label="목적 (자유 서술)">
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="예: 모래류 매출 극대화 / 신제품 런칭 / 3주년 최대혜택"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="대표 할인율(%)">
            <input
              value={discountRate}
              onChange={(e) => setDiscountRate(e.target.value)}
              inputMode="numeric"
              placeholder="50"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="사은품">
            <input
              value={giftName}
              onChange={(e) => setGiftName(e.target.value)}
              placeholder="사은품명"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="사은품 가치(₩)">
            <input
              value={giftValue}
              onChange={(e) => setGiftValue(e.target.value)}
              inputMode="numeric"
              placeholder="10000"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <Field label={`메인 상품 지정 (${mainIds.length}개 선택됨)`}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="상품명 검색"
            className="mb-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-200">
            {filtered.map((p) => (
              <label
                key={p.product_id}
                className="flex cursor-pointer items-center gap-2 border-b border-neutral-100 px-3 py-2 text-sm last:border-0 hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={mainIds.includes(p.product_id)}
                  onChange={() => toggleMain(p.product_id)}
                />
                <span className="flex-1 truncate text-neutral-700">
                  {p.base_name}
                </span>
                <span className="text-xs text-neutral-400">
                  {wonShort(p.revenue)}
                </span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-neutral-400">
                상품이 없습니다.
              </div>
            )}
          </div>
        </Field>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        <button
          onClick={() => router.push(`/promotions/${promo.id}`)}
          className="rounded-lg border border-neutral-300 px-5 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      {children}
    </div>
  );
}

function ChipSelect({
  options,
  value,
  onChange,
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
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
