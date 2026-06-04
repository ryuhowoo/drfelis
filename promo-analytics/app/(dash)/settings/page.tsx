"use client";

import { useEffect, useState, useCallback } from "react";

type Item = { id: string; name: string; sort: number };
type Kind = "benefit_types" | "seasonalities";

export default function SettingsPage() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="text-xl font-semibold tracking-tight">설정 — 분류 관리</h1>
      <p className="mt-1 text-sm text-neutral-500">
        혜택 종류와 시즈널리티 항목을 추가·수정·삭제할 수 있어요. 시뮬레이터·편집 화면에 바로 반영됩니다.
      </p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ListEditor kind="benefit_types" title="혜택 종류" hint="할인·사은품·1+1 등 (고객이 받는 혜택)" />
        <ListEditor kind="seasonalities" title="시즈널리티" hint="N주년·명절·크리스마스 등 시점" />
      </div>
    </div>
  );
}

function ListEditor({ kind, title, hint }: { kind: Kind; title: string; hint: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [adding, setAdding] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/options");
    const data = await res.json();
    setItems((data[kind] as Item[]) ?? []);
  }, [kind]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function call(method: string, body: Record<string, unknown>) {
    setError("");
    const res = await fetch("/api/options", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...body }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "실패");
      return false;
    }
    await load();
    return true;
  }

  return (
    <div className="rounded-[24px] bg-white p-5 card-soft">
      <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
      <p className="mt-0.5 text-xs text-neutral-400">{hint}</p>

      <div className="mt-3 flex gap-2">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="새 항목 추가"
          className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm"
          onKeyDown={async (e) => {
            if (e.key === "Enter" && adding.trim()) {
              if (await call("POST", { name: adding })) setAdding("");
            }
          }}
        />
        <button
          onClick={async () => {
            if (adding.trim() && (await call("POST", { name: adding }))) setAdding("");
          }}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          추가
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <ul className="mt-3 divide-y divide-neutral-100">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 py-2">
            {editId === it.id ? (
              <>
                <input
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  className="flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-sm"
                  autoFocus
                />
                <button
                  onClick={async () => {
                    if (await call("PATCH", { id: it.id, name: editVal })) setEditId(null);
                  }}
                  className="text-xs font-medium text-brand-600"
                >
                  저장
                </button>
                <button onClick={() => setEditId(null)} className="text-xs text-neutral-400">
                  취소
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-neutral-800">{it.name}</span>
                <button
                  onClick={() => {
                    setEditId(it.id);
                    setEditVal(it.name);
                  }}
                  className="text-xs text-neutral-400 hover:text-neutral-700"
                >
                  수정
                </button>
                <button
                  onClick={() => {
                    if (confirm(`'${it.name}' 삭제할까요?`)) call("DELETE", { id: it.id });
                  }}
                  className="text-xs text-neutral-400 hover:text-red-600"
                >
                  삭제
                </button>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-3 text-sm text-neutral-400">
            항목이 없습니다. (Phase 2 SQL 적용 후 기본값이 채워집니다)
          </li>
        )}
      </ul>
    </div>
  );
}
