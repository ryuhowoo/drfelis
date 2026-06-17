"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { wonShort, pct } from "@/lib/format";

// N8 P3: 함께 구매 벤치마크 + 전체매출 추정/역추정 (추천 프로토타입).
// - 캠페인 자유 태그로 '유사 성격' 그룹핑 → 그 그룹의 평균 함께구매 비율 사용
// - 메인 제품 명시 지정(없으면 플랜 SKU 전체가 메인)
// ⚠️ 현재 확정 캠페인이 적어 추정은 프로토타입 — 데이터가 쌓일수록 정교해짐.

export type Bench = {
  promotion_id: string;
  name: string;
  season: string | null;
  tags: string[];
  halo_ratio: number | null;
  revenue_ach_total: number | null;
};
type Sku = { product_id: string; base_name: string };
type Opt = { expected_revenue: number; product_ids: string[] };

export default function HaloRecommendPanel({
  promotionId,
  benchmarks,
  tags,
  mainProductIds,
  skus,
  options,
  planTarget,
}: {
  promotionId: string;
  benchmarks: Bench[];
  tags: string[];
  mainProductIds: string[] | null;
  skus: Sku[];
  options: Opt[];
  planTarget: number;
}) {
  const router = useRouter();
  const [localTags, setLocalTags] = useState<string[]>(tags);
  const [tagInput, setTagInput] = useState("");
  const [mainSet, setMainSet] = useState<string[] | null>(mainProductIds);
  const [busy, setBusy] = useState(false);

  const isAllMain = mainSet === null;
  const mainIds = isAllMain ? skus.map((s) => s.product_id) : mainSet;

  // 관련 벤치마크: 태그가 하나라도 겹치면 그 그룹, 태그 미설정이면 전체
  const related = useMemo(() => {
    const withRatio = benchmarks.filter(
      (b) => b.halo_ratio != null && b.promotion_id !== promotionId,
    );
    if (localTags.length === 0) return withRatio;
    const f = withRatio.filter((b) => b.tags.some((t) => localTags.includes(t)));
    return f.length ? f : withRatio;
  }, [benchmarks, localTags, promotionId]);

  const avgRatio = related.length
    ? related.reduce((s, b) => s + (b.halo_ratio ?? 0), 0) / related.length
    : null;

  const mainExpected = options
    .filter((o) => o.product_ids.some((p) => mainIds.includes(p)))
    .reduce((s, o) => s + o.expected_revenue, 0);
  const projectedTotal = avgRatio != null ? mainExpected * (1 + avgRatio) : null;
  const requiredMain = avgRatio != null && avgRatio > -1 ? planTarget / (1 + avgRatio) : null;

  async function save(patch: { tags?: string[]; main_product_ids?: string[] | null }) {
    setBusy(true);
    const res = await fetch(`/api/promotions/${promotionId}/plan/meta`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "저장 실패");
      return false;
    }
    router.refresh();
    return true;
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || localTags.includes(t)) {
      setTagInput("");
      return;
    }
    const next = [...localTags, t];
    setLocalTags(next);
    setTagInput("");
    save({ tags: next });
  }
  function removeTag(t: string) {
    const next = localTags.filter((x) => x !== t);
    setLocalTags(next);
    save({ tags: next });
  }
  function toggleMain(pid: string) {
    const base = isAllMain ? skus.map((s) => s.product_id) : mainSet!;
    const next = base.includes(pid) ? base.filter((x) => x !== pid) : [...base, pid];
    setMainSet(next);
  }
  function applyMain() {
    // 전체 선택과 같으면 null(=전체)로 저장
    const all = skus.map((s) => s.product_id).sort().join(",");
    const sel = (mainSet ?? []).slice().sort().join(",");
    save({ main_product_ids: isAllMain || sel === all ? null : mainSet });
  }

  return (
    <section className="mt-5 rounded-2xl card-soft p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-700">
          함께 구매 추정 · 추천{" "}
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            프로토타입
          </span>
        </h3>
        <span className="text-[11px] text-ink-4">
          유사 캠페인 {related.length}건 기준{" "}
          {avgRatio != null && (
            <>
              · 평균 함께구매 비율 <strong className="text-brand-700">{pct(avgRatio, 0)}</strong>
            </>
          )}
        </span>
      </div>

      {/* 태그 */}
      <div className="mt-3">
        <div className="text-[11px] font-medium text-ink-3">캠페인 성격 태그 (유사 캠페인 그룹핑)</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {localTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700"
            >
              {t}
              <button onClick={() => removeTag(t)} disabled={busy} className="text-brand-400 hover:text-brand-700">
                ×
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
            placeholder="태그 추가 (예: 입문/구독, 벌크업)…"
            className="min-w-[160px] flex-1 rounded-lg border border-line bg-card px-2.5 py-1 text-xs focus:outline-none"
          />
        </div>
      </div>

      {/* 추정 카드 */}
      {avgRatio == null ? (
        <p className="mt-4 rounded-xl bg-soft px-4 py-3 text-xs text-ink-4">
          비교할 과거 캠페인(확정+실적)이 아직 없어 추정을 낼 수 없습니다. 캠페인이 쌓이면 유사 태그 그룹의 평균으로 추천합니다.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-brand-50 p-4">
            <div className="text-xs text-ink-3">메인 기대매출 → 예상 전체 매출</div>
            <div className="mt-1 text-xl font-semibold text-ink">
              {wonShort(mainExpected)} <span className="text-ink-4">→</span> {wonShort(projectedTotal)}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-4">
              메인 × (1 + 함께구매 {pct(avgRatio, 0)})
            </div>
          </div>
          <div className="rounded-xl card-soft p-4">
            <div className="text-xs text-ink-3">목표 {wonShort(planTarget)} 달성에 필요한 메인 기대매출</div>
            <div className="mt-1 text-xl font-semibold text-ink">{wonShort(requiredMain)}</div>
            <div className="mt-0.5 text-[11px] text-ink-4">
              목표 ÷ (1 + 함께구매 {pct(avgRatio, 0)}) — 메인을 이만큼만 계획해도 함께구매로 목표 도달 기대
            </div>
          </div>
        </div>
      )}

      {/* 메인 제품 지정 */}
      {skus.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium text-ink-3">
              메인 제품 지정 {isAllMain && <span className="text-ink-4">(미지정 = 플랜 SKU 전체)</span>}
            </div>
            <button
              onClick={applyMain}
              disabled={busy}
              className="rounded-lg bg-brand-500 px-3 py-1 text-[11px] font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              메인 적용
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {skus.map((s) => {
              const on = mainIds.includes(s.product_id);
              return (
                <button
                  key={s.product_id}
                  onClick={() => toggleMain(s.product_id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${on ? "bg-brand-100 text-brand-700" : "bg-soft text-ink-4"}`}
                >
                  {on ? "✓ " : ""}
                  {s.base_name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 벤치마크 표 */}
      {related.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead className="text-ink-4">
              <tr>
                <th className="py-1.5 pr-3 font-medium">캠페인</th>
                <th className="py-1.5 pr-3 font-medium">시즌</th>
                <th className="py-1.5 pr-3 font-medium">태그</th>
                <th className="py-1.5 pr-3 text-right font-medium">함께구매 비율</th>
                <th className="py-1.5 text-right font-medium">전체 달성</th>
              </tr>
            </thead>
            <tbody>
              {related.map((b) => (
                <tr key={b.promotion_id} className="border-t border-line/60">
                  <td className="py-1.5 pr-3 text-ink-2">{b.name}</td>
                  <td className="py-1.5 pr-3 text-ink-4">{b.season ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-ink-4">{b.tags.join(", ") || "—"}</td>
                  <td className="py-1.5 pr-3 text-right font-medium text-brand-700">
                    {b.halo_ratio != null ? pct(b.halo_ratio, 0) : "—"}
                  </td>
                  <td className="py-1.5 text-right text-ink-3">
                    {b.revenue_ach_total != null ? pct(b.revenue_ach_total, 0) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
