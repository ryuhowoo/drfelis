"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "felis-seed-2026";

type Meta = { dailyChunks: number; dailyTotal: number; products: number; promotions: number };

export default function SeedPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/seed/meta.json")
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => setError("seed 데이터를 찾을 수 없습니다."));
  }, []);

  function append(s: string) {
    setLog((l) => [...l, s]);
  }

  async function run() {
    if (!meta) return;
    setRunning(true);
    setError("");
    setLog([]);
    setProgress(0);
    try {
      append("마스터·프로모션 적재 중…");
      const m = await fetch(`/api/seed?key=${KEY}&phase=master`, { method: "POST" });
      const md = await m.json();
      if (!m.ok) throw new Error(md.error);
      append(`상품 ${md.products}개 · 프로모션 ${md.promotions}개 완료`);

      let total = 0;
      for (let i = 0; i < meta.dailyChunks; i++) {
        const res = await fetch(`/api/seed?key=${KEY}&phase=daily&chunk=${i}`, {
          method: "POST",
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        total += d.inserted;
        setProgress(Math.round(((i + 1) / meta.dailyChunks) * 100));
        append(`일별 매출 ${total.toLocaleString()} / ${meta.dailyTotal.toLocaleString()}행`);
      }
      setDone(true);
      append("✅ 모든 데이터 적재 완료!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">초기 데이터 적재</h1>
      <p className="mt-1 text-sm text-neutral-500">
        첨부된 마스터·일별 매출·프로모션 시트를 한 번에 적재합니다. (중복 시 덮어쓰기)
      </p>

      {meta && (
        <div className="mt-5 grid max-w-md grid-cols-3 gap-3">
          <Mini label="상품" value={meta.products} />
          <Mini label="일별 행" value={meta.dailyTotal} />
          <Mini label="프로모션" value={meta.promotions} />
        </div>
      )}

      <div className="mt-6 max-w-md">
        {!done ? (
          <button
            onClick={run}
            disabled={running || !meta}
            className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {running ? `적재 중… ${progress}%` : "데이터 적재 시작"}
          </button>
        ) : (
          <Link
            href="/"
            className="block w-full rounded-xl bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white hover:bg-neutral-700"
          >
            대시보드로 이동 →
          </Link>
        )}

        {running && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full bg-neutral-900 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error} — 다시 시도하면 이어서 진행됩니다.
          </p>
        )}

        {log.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 text-center">
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
      <div className="text-xs text-neutral-400">{label}</div>
    </div>
  );
}
