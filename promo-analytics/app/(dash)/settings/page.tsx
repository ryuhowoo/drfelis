"use client";

import { useEffect, useState, useCallback } from "react";

type Item = { id: string; name: string; sort: number };
type Kind = "benefit_types" | "seasonalities" | "purposes";

export default function SettingsPage() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="text-xl font-semibold tracking-tight">설정 — 분류 · 채널 관리</h1>
      <p className="mt-1 text-sm text-neutral-500">
        혜택·시즈널리티·목적 항목과 <strong>채널별 수수료</strong>를 관리합니다. 작성·시뮬레이터 화면에 바로 반영됩니다.
      </p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ListEditor kind="benefit_types" title="혜택 종류" hint="할인·사은품·1+1 등 (고객이 받는 혜택)" />
        <ListEditor kind="seasonalities" title="시즈널리티" hint="N주년·명절·크리스마스 등 시점" />
        <ListEditor kind="purposes" title="캠페인 목적" hint="세일즈·브랜딩·재고소진 등 (복수 선택 가능)" />
        <ChannelFeesEditor />
      </div>
    </div>
  );
}

type Channel = { channel: string; fee_rate: number; sort: number };

function ChannelFeesEditor() {
  const [rows, setRows] = useState<Channel[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addName, setAddName] = useState("");
  const [addRate, setAddRate] = useState("");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/channel-fees");
    const data = await res.json();
    setRows((data.channels as Channel[]) ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function call(method: string, body: Record<string, unknown>) {
    setError("");
    const res = await fetch("/api/channel-fees", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "실패");
      return false;
    }
    await load();
    return true;
  }

  async function saveRate(channel: string, pctStr: string) {
    const pct = Number(pctStr);
    if (Number.isNaN(pct)) return;
    if (await call("PUT", { channel, fee_rate: pct / 100 })) {
      setSavedAt(channel);
      setTimeout(() => setSavedAt((s) => (s === channel ? null : s)), 1200);
    }
  }

  return (
    <div className="rounded-2xl p-5 card-soft">
      <h2 className="text-sm font-semibold text-neutral-700">채널별 수수료</h2>
      <p className="mt-0.5 text-xs text-neutral-400">
        판매 채널별 수수료(%) — 새 캠페인에서 채널을 고르면 공헌이익 계산에 반영됩니다.
      </p>

      <ul className="mt-3 divide-y divide-neutral-100">
        {rows.map((r) => {
          const draft = drafts[r.channel] ?? String(+(r.fee_rate * 100).toFixed(2));
          return (
            <li key={r.channel} className="flex items-center gap-2 py-2">
              <span className="flex-1 text-sm text-neutral-800">{r.channel}</span>
              <input
                value={draft}
                inputMode="decimal"
                onChange={(e) => setDrafts((d) => ({ ...d, [r.channel]: e.target.value }))}
                onBlur={() => saveRate(r.channel, draft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-20 rounded-lg border border-neutral-200 px-2 py-1 text-right text-sm tabular-nums focus:border-brand-400 focus:outline-none"
              />
              <span className="w-4 text-xs text-neutral-400">%</span>
              <span className="w-8 text-[11px] text-emerald-600">{savedAt === r.channel ? "저장" : ""}</span>
              <button
                onClick={() => {
                  if (confirm(`'${r.channel}' 채널을 삭제할까요?`)) call("DELETE", { channel: r.channel });
                }}
                className="text-xs text-neutral-400 hover:text-red-600"
              >
                삭제
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="py-3 text-sm text-neutral-400">채널이 없습니다.</li>
        )}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
          placeholder="새 채널명"
          className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm"
        />
        <input
          value={addRate}
          onChange={(e) => setAddRate(e.target.value)}
          placeholder="수수료%"
          inputMode="decimal"
          className="w-24 rounded-xl border border-neutral-200 px-3 py-2 text-right text-sm"
        />
        <button
          onClick={async () => {
            if (addName.trim() && (await call("POST", { channel: addName, fee_rate: Number(addRate) / 100 || 0 }))) {
              setAddName("");
              setAddRate("");
            }
          }}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          추가
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
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
    <div className="rounded-2xl p-5 card-soft">
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
