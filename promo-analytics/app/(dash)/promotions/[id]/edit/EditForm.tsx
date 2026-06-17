"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Promotion } from "@/lib/types";
import { wonShort } from "@/lib/format";

type ProductItem = { product_id: string; base_name: string; revenue: number };
type Options = { benefitTypes: string[]; seasonalities: string[]; purposes: string[] };

export default function EditForm({
  promo,
  products,
  initialMainIds,
  options,
  initialWeights,
}: {
  promo: Promotion;
  products: ProductItem[];
  initialMainIds: string[];
  options: Options;
  initialWeights: Record<string, number>;
}) {
  const router = useRouter();
  const [name, setName] = useState(promo.name);
  const [promoTypes, setPromoTypes] = useState<string[]>(
    promo.promo_types ?? (promo.promo_type ? [promo.promo_type] : []),
  );
  const [seasonTag, setSeasonTag] = useState(promo.season_tag ?? "");
  const [purposes, setPurposes] = useState<string[]>(
    promo.purposes ?? (promo.purpose ? [promo.purpose] : []),
  );
  const [purposeWeights, setPurposeWeights] =
    useState<Record<string, number>>(initialWeights);
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
  const [adSpend, setAdSpend] = useState(
    promo.ad_spend != null ? String(promo.ad_spend) : "",
  );
  const [mainIds, setMainIds] = useState<string[]>(initialMainIds);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");

  function toggleType(t: string) {
    setPromoTypes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  }
  function togglePurpose(t: string) {
    setPurposes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  }
  // 목적 가중치: 저장값 우선, 없으면 주목적(0번)=1.0 / 보조=0.0
  const weightOf = (p: string, i: number) => purposeWeights[p] ?? (i === 0 ? 1 : 0);
  function setWeight(p: string, v: number) {
    setPurposeWeights((w) => ({ ...w, [p]: Number.isNaN(v) ? 0 : v }));
  }
  const weightSum = purposes.reduce((s, p, i) => s + weightOf(p, i), 0);
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
        purposes,
        purpose: purposes[0] ?? null,
        purpose_weights: purposes.map((p, i) => ({ purpose: p, weight: weightOf(p, i) })),
        start_date: startDate,
        end_date: endDate,
        benefits: Object.keys(benefits).length ? benefits : null,
        contribution_amount: contribution ? Number(contribution.replace(/[^0-9.-]/g, "")) : null,
        ad_spend: adSpend ? Number(adSpend.replace(/[^0-9.-]/g, "")) : null,
        main_product_ids: mainIds,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("저장됐습니다");
      router.push(`/promotions/${promo.id}`);
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "저장 실패 (마이그레이션이 적용됐는지 확인하세요)", {
        action: { label: "다시 시도", onClick: () => save() },
      });
    }
  }

  async function remove() {
    if (!confirm(`'${promo.name}' 캠페인을 삭제할까요?\n\n실적·메인상품·메모가 함께 삭제됩니다. 복구 불가.`))
      return;
    setDeleting(true);
    const res = await fetch(`/api/promotions/${promo.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      router.push("/library");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "삭제 실패", {
        action: { label: "다시 시도", onClick: () => remove() },
      });
    }
  }

  const filtered = query
    ? products.filter((p) => p.base_name.includes(query))
    : products;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">캠페인 편집</h1>
      <p className="mt-1 text-sm text-neutral-500">
        기간·목적·혜택을 채우고, 특별 혜택을 준 <strong>메인 상품</strong>을 지정하세요.
      </p>

      <div className="mt-6 space-y-5">
        <Field label="캠페인명">
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

        <Field label={`목적 (복수 선택) — ${purposes.length}개`}>
          <MultiChips options={options.purposes} values={purposes} onToggle={togglePurpose} />
          <p className="mt-1 text-xs text-neutral-400">
            브랜딩 + 세일즈처럼 섞인 캠페인도 모두 체크해주세요. ‘설정 → 캠페인 목적’에서 항목을 추가할 수 있어요.
          </p>
        </Field>

        {purposes.length > 0 && (
          <Field label="목적 가중치 (집계·랭킹·예측에 사용)">
            <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
              {purposes.map((p, i) => (
                <div key={p} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 truncate text-sm text-neutral-700">{p}</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={weightOf(p, i)}
                    onChange={(e) => setWeight(p, Number(e.target.value))}
                    className="w-24 rounded-lg border border-neutral-200 px-2 py-1 text-right text-sm focus:border-brand-400 focus:outline-none"
                  />
                  {i === 0 && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-600">
                      주목적
                    </span>
                  )}
                </div>
              ))}
              <p className="text-xs text-neutral-400">
                합계 {weightSum.toFixed(1)} · 기본은 주목적 1.0 / 보조 0.0(주목적 귀속, 중복
                카운트 없음). 보조 목적에도 성과를 나눠 귀속하려면 0.7 / 0.3 처럼 조정하세요.
              </p>
            </div>
          </Field>
        )}

        <Field label="시즈널리티">
          <SingleChips options={options.seasonalities} value={seasonTag} onChange={setSeasonTag} />
          <button
            type="button"
            onClick={async () => {
              const { inferSeasonality } = await import("@/lib/season");
              const inferred = inferSeasonality(name, startDate, options.seasonalities);
              setSeasonTag(inferred ?? "");
            }}
            className="mt-2 rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
          >
            이름·기간으로 자동 추정
          </button>
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

        <div className="grid grid-cols-2 gap-4">
          <Field label="전체 공헌이익액 (직접 입력)">
            <input
              value={contribution}
              onChange={(e) => setContribution(e.target.value)}
              inputMode="numeric"
              placeholder="예: 12000000"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-neutral-400">
              기간 내 공식몰 <b>전체</b> 공헌이익액(정기구독 포함). 옵션 단위 분해 합과 대조하는
              기준값으로 쓰입니다.
            </p>
          </Field>
          <Field label="실제 광고비 (직접 입력)">
            <input
              value={adSpend}
              onChange={(e) => setAdSpend(e.target.value)}
              inputMode="numeric"
              placeholder="예: 3000000"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-neutral-400">
              캠페인 실제 광고비. 옵션별 공헌이익 분해 시 매출 비중으로 배분합니다(미입력 시 레이트카드
              광고율 적용).
            </p>
          </Field>
        </div>

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

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving || deleting}
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
        <button
          onClick={remove}
          disabled={saving || deleting}
          className="ml-auto rounded-full border border-red-200 px-5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "삭제 중…" : "캠페인 삭제"}
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
