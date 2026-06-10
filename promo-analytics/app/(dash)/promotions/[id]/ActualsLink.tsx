"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ActualsCandidate = {
  id: string;
  name: string;
  code: string | null;
  start_date: string;
  end_date: string;
  actual_skus: number;
};

// 이 캠페인의 플랜이 비교할 '실적 캠페인'을 명시적으로 선택.
// 가이드(⑤)와 실적(②)이 서로 다른 코드로 업로드된 경우 — 머지 없이 짝지어 비교.
export default function ActualsLink({
  promotionId,
  currentLinkId,
  candidates,
}: {
  promotionId: string;
  currentLinkId: string | null;
  candidates: ActualsCandidate[];
}) {
  const router = useRouter();
  const [pick, setPick] = useState<string>(currentLinkId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = (currentLinkId ?? "") !== pick;

  async function save(value: string | null) {
    setBusy(true);
    setErr(null);
    const res = await fetch(
      `/api/promotions/${promotionId}/plan/actuals-link`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actual_promotion_id: value }),
      },
    );
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "저장 실패");
      return;
    }
    router.refresh();
  }

  return (
    <section className="mt-6 rounded-2xl p-5 card-soft">
      <h2 className="text-sm font-semibold text-ink-2">비교 대상 실적 캠페인</h2>
      <p className="mt-1 text-xs text-ink-4">
        이 캠페인의 플랜을 어느 캠페인의 실적과 비교할지 선택합니다. 기본값은 자기 자신.
        가이드(⑤)와 실적(②)이 서로 다른 코드로 업로드된 경우 다른 캠페인을 지정해 짝지어
        비교하세요. 모든 달성률·진단이 선택한 실적 기준으로 다시 계산됩니다.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="rounded-xl px-3 py-2 text-sm surface-pressed-soft focus:outline-none"
        >
          <option value="">자기 캠페인 실적 (기본)</option>
          {candidates
            .filter((c) => c.id !== promotionId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                [{c.code ?? "—"}] {c.name} · {c.start_date}~{c.end_date} ·{" "}
                {c.actual_skus} SKU
              </option>
            ))}
        </select>
        <button
          onClick={() => save(pick || null)}
          disabled={busy || !dirty}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          저장
        </button>
        {currentLinkId && (
          <button
            onClick={() => {
              setPick("");
              save(null);
            }}
            disabled={busy}
            className="rounded-full px-4 py-2 text-sm font-semibold text-ink-3 card-soft hover:text-ink"
          >
            기본으로
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-brand-700">{err}</p>}
    </section>
  );
}
