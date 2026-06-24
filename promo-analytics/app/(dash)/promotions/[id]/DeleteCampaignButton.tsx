"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 캠페인 삭제 — 편집 페이지 폐지에 따라 상세 헤더로 이동. 성과·플랜·메모 함께 삭제.
export function DeleteCampaignButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(`'${name}' 캠페인을 삭제할까요?\n\n성과·플랜·메모가 함께 삭제됩니다. 복구 불가.`))
      return;
    setBusy(true);
    const res = await fetch(`/api/promotions/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/library");
      router.refresh();
    } else {
      setBusy(false);
      alert("삭제 실패");
    }
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      className="shrink-0 rounded-xl border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
    >
      {busy ? "삭제 중…" : "캠페인 삭제"}
    </button>
  );
}
