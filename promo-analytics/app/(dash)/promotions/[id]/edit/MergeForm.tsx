"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  id: string;
  name: string;
  code: string | null;
  start_date: string;
  end_date: string;
};

// 캠페인 병합: 이 캠페인(source)을 다른 캠페인(target)으로 흡수.
// 같은 행사인데 가이드(⑤)·실적(②) 시트가 서로 다른 코드로 업로드돼 별개 캠페인이 생긴 경우 사용.
export default function MergeForm({
  sourceId,
  sourceName,
  candidates,
}: {
  sourceId: string;
  sourceName: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const target = candidates.find((c) => c.id === targetId);

  async function merge() {
    if (!targetId || !target) return;
    const ok = window.confirm(
      `현재 캠페인 [${sourceName}]을\n` +
        `대상 캠페인 [${target.name}]에 병합합니다.\n\n` +
        `· 실적·메모·메인상품·목적 가중치·SKU 매핑을 모두 대상으로 이전\n` +
        `· 플랜이 있으면 대상으로 이전 (양쪽 모두 있으면 거부)\n` +
        `· 기간은 합집합 (시작=min, 종료=max)\n` +
        `· 현재 캠페인은 삭제됩니다\n\n` +
        `되돌릴 수 없습니다. 진행할까요?`,
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/promotions/${sourceId}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_id: targetId }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "병합 실패");
      return;
    }
    // 병합 후 대상 캠페인 상세로 이동
    router.push(`/promotions/${targetId}`);
    router.refresh();
  }

  return (
    <section className="rounded-2xl p-6 card-soft">
      <h2 className="text-sm font-semibold text-ink-2">캠페인 병합 · 관리자/정리용</h2>
      <p className="mt-1 text-xs text-ink-4">
        정상 경로는 가이드(⑤)·실적(②)을 <strong>같은 캠페인 코드</strong>로 올려 자동 결속하는
        것입니다. 이 도구는 코드가 어긋나 별개 캠페인이 생긴 <strong>레거시 보정용</strong> — 현재 캠페인을
        다른 캠페인에 흡수합니다. 모든 데이터(실적·메모·플랜·매핑)는 대상으로 이전되고 현재 캠페인은
        삭제됩니다(되돌릴 수 없음).
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="rounded-xl px-3 py-2 text-sm surface-pressed-soft focus:outline-none"
        >
          <option value="">병합 대상 캠페인 선택 …</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              [{c.code ?? "—"}] {c.name} · {c.start_date}~{c.end_date}
            </option>
          ))}
        </select>
        <button
          onClick={merge}
          disabled={busy || !targetId}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? "병합 중…" : "병합 실행"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-brand-700">{err}</p>}
    </section>
  );
}
