"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { predict, type CaseFeature } from "@/lib/predict";
import { inferSeasonality } from "@/lib/season";
import type { Options } from "@/lib/options";
import { wonShort } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { ensureProducts } from "@/lib/products";
import { parsePlanWorkbook, type ParsedPlanOption } from "@/lib/plan-import";
import { downloadCampaignTemplate, parseCampaignMeta } from "@/lib/campaignTemplate";

// 새 모델의 진입점 — 캠페인 생성 + 목적/기간 + 엄선 메타(혜택유형·시즌·할인율) + 실시간 예측.
// 메타는 감사에서 '예측에 실효적'으로 검증된 것만 노출(channel·ad_spend·contribution_amount·gift 폐기).
const PURPOSES = [
  { key: "세일즈", desc: "매출·판매 극대화" },
  { key: "브랜딩", desc: "인지·구매건수 확대" },
  { key: "재고소진", desc: "재고 회전·소진" },
] as const;

export default function NewCampaignForm({
  cases,
  options,
  channels = [],
}: {
  cases: CaseFeature[];
  options: Options;
  channels?: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  // 혜택 유형·시즌은 복수 선택 — 예측은 대표값(첫 항목) 사용.
  const [promoTypes, setPromoTypes] = useState<string[]>([]);
  const [seasonTags, setSeasonTags] = useState<string[]>([]);
  const [channel, setChannel] = useState("");
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 엑셀 양식으로 한 번에 채우기 — 파싱한 플랜 옵션은 캠페인 생성 후 draft 플랜에 적재.
  const [planOptions, setPlanOptions] = useState<ParsedPlanOption[]>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  // 시즌 자동 활성화 힌트 — 시작일에 맞춰 시즌을 자동 채움(사용자가 직접 만지면 멈춤).
  const [seasonTouched, setSeasonTouched] = useState(false);
  const [autoSeason, setAutoSeason] = useState<string | null>(null);

  // 시작일(또는 이름)로 시즌 자동 추정 → 아직 손대지 않았으면 자동 선택
  useEffect(() => {
    if (!start || seasonTouched) return;
    const inferred = inferSeasonality(name, start, options.seasonalities);
    /* eslint-disable react-hooks/set-state-in-effect */
    setAutoSeason(inferred);
    setSeasonTags(inferred ? [inferred] : []);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, name]);

  const selected = useMemo(() => PURPOSES.filter((p) => weights[p.key] != null), [weights]);
  const total = useMemo(
    () => selected.reduce((s, p) => s + (weights[p.key] || 0), 0),
    [selected, weights],
  );
  const duration = useMemo(() => {
    if (!start || !end) return 0;
    const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
    return d > 0 ? d : 0;
  }, [start, end]);
  const primaryPurpose = useMemo(() => {
    let best: string | null = null;
    let bw = -1;
    for (const p of selected) {
      const w = weights[p.key] || 0;
      if (w > bw) {
        bw = w;
        best = p.key;
      }
    }
    return best;
  }, [selected, weights]);

  // 실시간 예측 — 기간이 정해지고 사례가 있으면
  const prediction = useMemo(() => {
    if (duration <= 0 || cases.length === 0) return null;
    return predict(
      {
        promo_type: promoTypes[0] || null,
        season_tag: seasonTags[0] || null,
        discount_rate: discountPct ? discountPct / 100 : null,
        duration_days: duration,
        purpose: primaryPurpose,
      },
      cases,
    );
  }, [promoTypes, seasonTags, discountPct, duration, primaryPurpose, cases]);

  // 복수 선택 토글 (혜택 유형·시즌)
  function toggleTag(setter: typeof setPromoTypes, key: string) {
    setter((arr) => (arr.includes(key) ? arr.filter((x) => x !== key) : [...arr, key]));
  }

  function toggle(key: string) {
    setWeights((w) => {
      const next = { ...w };
      if (next[key] != null) delete next[key];
      else next[key] = 5;
      return next;
    });
  }
  function setWeight(key: string, v: number) {
    setWeights((w) => ({ ...w, [key]: Math.max(1, Math.min(10, v)) }));
  }

  // 엑셀 양식 업로드 → '캠페인' 시트로 폼 자동 채움 + '플랜' 시트로 옵션 적재 예약
  async function importTemplate(file: File) {
    setImportMsg("엑셀 읽는 중…");
    setErr(null);
    try {
      const buf = await file.arrayBuffer();
      const meta = parseCampaignMeta(buf);
      if (meta) {
        setName(meta.name);
        if (meta.start_date) setStart(meta.start_date);
        if (meta.end_date) setEnd(meta.end_date);
        if (meta.promo_types.length) setPromoTypes(meta.promo_types);
        if (meta.season_tags.length) {
          setSeasonTouched(true);
          setSeasonTags(meta.season_tags);
        }
        if (meta.channel) setChannel(meta.channel);
        if (meta.discount_pct != null) setDiscountPct(meta.discount_pct);
        if (Object.keys(meta.weights).length) setWeights(meta.weights);
      }
      const { options } = parsePlanWorkbook(buf);
      setPlanOptions(options);
      const parts: string[] = [];
      if (meta) parts.push("기본 정보·성격·목적 자동 채움");
      parts.push(`플랜 옵션 ${options.length}개 인식`);
      setImportMsg(
        `${parts.join(" · ")}. 검토 후 [캠페인 만들고 플랜 작성]을 누르면 플랜에 적재됩니다.`,
      );
    } catch (e) {
      setImportMsg(null);
      setErr(e instanceof Error ? e.message : "엑셀을 읽지 못했습니다.");
    }
  }

  // 생성된 draft 플랜에 엑셀 옵션 적재 — SKU를 product_id로 해석 후 플랜 PATCH (플랜 에디터와 동일 로직)
  async function ingestPlanOptions(promotionId: string, planId: string) {
    const supabase = createClient();
    const names = [...new Set(planOptions.flatMap((o) => o.items.map((it) => it.base_name)))];
    const idMap = await ensureProducts(supabase, names);

    // 엑셀에 적은 SKU 소비자가/원가/상시가(세트→1개 환산)를 상품 마스터의 '빈 값'에만 채운다.
    // (기존 마스터 값은 건드리지 않음 — 단일 출처 원칙 유지, best-effort)
    try {
      const econByName = new Map<string, { consumer: number | null; regular: number | null; cost: number | null }>();
      for (const o of planOptions)
        for (const it of o.items) {
          const cur = econByName.get(it.base_name) ?? { consumer: null, regular: null, cost: null };
          econByName.set(it.base_name, {
            consumer: cur.consumer ?? it.consumer_price,
            regular: cur.regular ?? it.regular_price,
            cost: cur.cost ?? it.cost,
          });
        }
      const ids = [...new Set([...idMap.values()])];
      if (ids.length > 0) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, base_name, consumer_price, regular_price, cost")
          .in("id", ids);
        for (const p of prods ?? []) {
          const e = econByName.get(p.base_name as string);
          if (!e) continue;
          const patch: Record<string, number> = {};
          if (p.consumer_price == null && e.consumer != null) patch.consumer_price = Math.round(e.consumer);
          if (p.regular_price == null && e.regular != null) patch.regular_price = Math.round(e.regular);
          if (p.cost == null && e.cost != null) patch.cost = Math.round(e.cost);
          if (Object.keys(patch).length > 0)
            await supabase.from("products").update(patch).eq("id", p.id as string);
        }
      }
    } catch {
      /* 마스터 프리필 실패는 무시 — 플랜 적재는 계속 */
    }

    const optionsPayload = planOptions.map((o, idx) => ({
      option_label: o.option_label,
      expected_option_qty: o.expected_option_qty,
      is_main: o.is_main,
      match_patterns: [] as string[],
      sort: idx,
      items: o.items
        .map((it) => ({
          product_id: idMap.get(it.base_name) ?? "",
          base_name: it.base_name,
          sku_qty_per_option: it.sku_qty_per_option,
          unit_sale_price: it.unit_sale_price,
          source_config_id: null,
        }))
        .filter((it) => it.product_id),
    }));
    await fetch(`/api/promotions/${promotionId}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: planId, options: optionsPayload }),
    });
  }

  const canSave = name.trim() && start && end && end >= start && selected.length > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          start_date: start,
          end_date: end,
          purposes: selected.map((p) => p.key),
          weights,
          promo_types: promoTypes,
          promo_type: promoTypes[0] || null,
          season_tags: seasonTags,
          season_tag: seasonTags[0] || null,
          channel: channel || null,
          discount_rate: discountPct ? discountPct / 100 : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 실패");
      // 엑셀 양식으로 올린 옵션이 있으면 draft 플랜에 적재(확정 직전 상태로)
      if (planOptions.length > 0 && data.plan_id) {
        try {
          await ingestPlanOptions(data.promotion_id, data.plan_id);
        } catch {
          /* 옵션 적재 실패해도 캠페인은 생성됨 — 플랜 페이지에서 보완 */
        }
      }
      router.push(`/promotions/${data.promotion_id}/plan`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "생성 실패");
      setSaving(false);
    }
  }

  const inputCls =
    "mt-1.5 w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-brand-400";

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-1 text-sm text-ink-4">
        <Link href="/" className="hover:underline">대시보드</Link> / 새 캠페인
      </div>
      <h1 className="text-xl font-semibold text-ink">새 캠페인 만들기</h1>
      <p className="mt-1 text-sm text-ink-3">
        캠페인 하나 = 한 번의 행사. 성격을 정하면 유사 사례로 <strong>예상 성과</strong>를 바로 보여주고, 이어서 플랜을 작성합니다.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* 좌: 입력 */}
        <div className="grid gap-4 rise-in">
          {/* 엑셀 양식으로 한 번에 채우기 */}
          <section className="rounded-2xl border border-brand-200 bg-brand-50/40 p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-ink-2">엑셀 양식으로 한 번에 채우기</h2>
            <p className="mt-1 text-xs text-ink-4">
              양식을 내려받아 캠페인 정보·목적·플랜 옵션을 채운 뒤 올리면, 아래 입력란과 플랜 옵션이
              자동으로 채워집니다(플랜 확정 직전 상태).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => downloadCampaignTemplate()}
                className="rounded-xl border border-line bg-card px-4 py-2 text-sm font-medium text-ink-2 hover:bg-brand-50"
              >
                ↓ 엑셀 양식 내려받기
              </button>
              <label className="cursor-pointer rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
                엑셀 불러오기
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importTemplate(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {importMsg && (
              <p className="mt-2 rounded-lg bg-brand-100/60 px-3 py-2 text-xs text-brand-700">{importMsg}</p>
            )}
          </section>

          {/* 기본 정보 */}
          <section className="rounded-2xl card-soft p-5 sm:p-6">
            <h2 className="mb-4 text-sm font-semibold text-ink-2">기본 정보</h2>
            <label className="block text-xs font-medium text-ink-3">캠페인 이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 한가위 고양이 대잔치" className={inputCls} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-3">시작일</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-3">종료일</label>
                <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
              </div>
            </div>
            {duration > 0 && <p className="mt-2 text-[11px] text-ink-4">운영 {duration}일</p>}
          </section>

          {/* 캠페인 성격 (예측에 사용) */}
          <section className="rounded-2xl card-soft p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-ink-2">캠페인 성격</h2>
            <p className="mt-1 text-xs text-ink-4">예측·유사 사례 매칭에 쓰입니다.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-ink-3">
                  혜택 유형 <span className="text-ink-4">· 복수 선택</span>
                </label>
                <ChipMulti
                  values={options.benefitTypes}
                  selected={promoTypes}
                  onToggle={(k) => toggleTag(setPromoTypes, k)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-3">
                  시즌 <span className="text-ink-4">· 복수 선택</span>
                </label>
                <ChipMulti
                  values={options.seasonalities}
                  selected={seasonTags}
                  onToggle={(k) => {
                    setSeasonTouched(true);
                    toggleTag(setSeasonTags, k);
                  }}
                />
                {autoSeason && seasonTags.includes(autoSeason) && !seasonTouched && (
                  <p className="mt-1 text-[11px] text-brand-600">시작일에 맞춰 ‘{autoSeason}’ 시즌을 자동 선택했어요. 바꾸려면 칩을 눌러 조정하세요.</p>
                )}
              </div>
            </div>
            {channels.length > 0 && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-ink-3">판매 채널</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>
                  <option value="">선택…</option>
                  {channels.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-ink-4">채널 수수료가 공헌이익 계산에 반영됩니다(설정에서 수수료 관리).</p>
              </div>
            )}
            <div className="mt-3">
              <label className="block text-xs font-medium text-ink-3">대표 할인율 (%)</label>
              <input type="number" min={0} max={100} step={1} value={discountPct || ""} onChange={(e) => setDiscountPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} placeholder="예: 50" className={inputCls} />
            </div>
          </section>

          {/* 목적 + 가중치 */}
          <section className="rounded-2xl card-soft p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-ink-2">목적 &amp; 가중치</h2>
            <p className="mt-1 text-xs text-ink-4">복수 선택 가능 · 각 1~10 가중치 → 비율 자동.</p>
            <div className="mt-4 space-y-2.5">
              {PURPOSES.map((p) => {
                const on = weights[p.key] != null;
                const share = on && total > 0 ? Math.round(((weights[p.key] || 0) / total) * 100) : 0;
                return (
                  <div key={p.key} className={`rounded-xl border p-3 transition ${on ? "border-brand-300 bg-brand-50/60" : "border-line bg-card"}`}>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => toggle(p.key)} aria-label={`${p.key} 선택`}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs transition ${on ? "border-brand-500 bg-brand-500 text-white" : "border-line text-transparent"}`}>✓</button>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-ink">{p.key}</div>
                        <div className="text-xs text-ink-4">{p.desc}</div>
                      </div>
                      {on && (
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => setWeight(p.key, (weights[p.key] || 0) - 1)} className="flex h-7 w-7 items-center justify-center rounded-lg surface-pressed-soft text-ink-2 hover:text-ink">−</button>
                            <span className="w-6 text-center text-sm font-bold tabular-nums text-ink">{weights[p.key]}</span>
                            <button type="button" onClick={() => setWeight(p.key, (weights[p.key] || 0) + 1)} className="flex h-7 w-7 items-center justify-center rounded-lg surface-pressed-soft text-ink-2 hover:text-ink">+</button>
                          </div>
                          <span className="w-12 shrink-0 text-right text-sm font-bold tabular-nums text-brand-600">{share}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {err && <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{err}</div>}

          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="ghost"><Link href="/">취소</Link></Button>
            <Button onClick={save} loading={saving} disabled={!canSave}>캠페인 만들고 플랜 작성 →</Button>
          </div>
        </div>

        {/* 우: 실시간 예측 패널 */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-2xl card-glass shimmer blob-soft p-5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[1.4px] text-brand-600">
              <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              플랜 설계 기준선 · 유사 사례 기반
            </div>
            <p className="mt-1 text-[11px] text-ink-4">
              아래는 유사 캠페인으로 추정한 <b>목표 기준선</b>입니다. 다음 단계(플랜 작성)에서 옵션·수량을 짜며 이 값을 목표로 삼으세요.
            </p>
            {prediction ? (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Mini label="예상 증분" value={wonShort(prediction.expected_uplift)} />
                  <Mini label="공헌(기여)" value={prediction.expected_uplift_contribution != null ? wonShort(prediction.expected_uplift_contribution) : "—"} />
                  <Mini label="평소 대비" value={prediction.lift_ratio != null ? `${prediction.lift_ratio.toFixed(1)}배` : "—"} />
                </div>
                <div className="mt-2 text-[11px] text-ink-4">
                  신뢰도 {prediction.confidence}
                  {prediction.expected_total_contribution != null && <> · 전체 공헌 {wonShort(prediction.expected_total_contribution)}</>}
                </div>
                {prediction.comparables.length > 0 && (
                  <div className="mt-3 border-t border-line/60 pt-3">
                    <div className="text-[11px] font-semibold text-ink-3">유사 캠페인</div>
                    <ul className="mt-1.5 space-y-1">
                      {prediction.comparables.slice(0, 3).map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-ink-2">{c.name}</span>
                          <span className="shrink-0 text-ink-4">유사 {Math.round(c.score * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-ink-4">{prediction.rationale}</p>
              </>
            ) : (
              <p className="mt-3 text-xs text-ink-4">기간·혜택 유형을 입력하면 유사 사례로 예상 성과를 추정합니다.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

// 복수 선택 칩 — 혜택 유형·시즌. 예측은 첫 선택을 대표값으로 사용.
function ChipMulti({
  values,
  selected,
  onToggle,
}: {
  values: string[];
  selected: string[];
  onToggle: (k: string) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {values.map((v) => {
        const on = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            onClick={() => onToggle(v)}
            aria-pressed={on}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              on
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-line bg-card text-ink-2 hover:border-brand-300 hover:bg-brand-50/50"
            }`}
          >
            {v}
          </button>
        );
      })}
      {values.length === 0 && (
        <span className="text-xs text-ink-4">설정에서 항목을 추가하세요.</span>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card/70 px-2 py-2 text-center">
      <div className="text-[10px] text-ink-4">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}
