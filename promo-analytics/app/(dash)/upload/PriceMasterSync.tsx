"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type SyncRow = {
  csv_url: string | null;
  enabled: boolean;
  last_synced_at: string | null;
  last_status: string | null;
  last_row_count: number | null;
};

// 품목/가격 마스터 — Google Sheets '웹에 게시(CSV)' 연동. URL 저장 + 수동 동기화 + 상태 표시.
// 자동(일 1회)은 Vercel Cron(/api/cron/sync-price-master)이 수행.
export default function PriceMasterSync() {
  const [row, setRow] = useState<SyncRow | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"idle" | "saving" | "syncing">("idle");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("sheet_sync")
      .select("csv_url, enabled, last_synced_at, last_status, last_row_count")
      .eq("id", 1)
      .maybeSingle();
    const r = (data as SyncRow) ?? null;
    setRow(r);
    setUrl(r?.csv_url ?? "");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save() {
    setBusy("saving");
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("sheet_sync")
        .update({ csv_url: url.trim() || null, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw new Error(error.message);
      setMsg({ kind: "ok", text: "CSV URL 저장됨" });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("idle");
    }
  }

  async function syncNow() {
    setBusy("syncing");
    setMsg(null);
    try {
      const res = await fetch("/api/cron/sync-price-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv_url: url.trim() || undefined }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        items?: number;
        configs?: number;
        unmatched?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `동기화 실패 (HTTP ${res.status})`);
      setMsg({
        kind: "ok",
        text: `동기화 완료 · 품목 ${json.items ?? 0}건 · 구성 ${json.configs ?? 0}건${
          json.unmatched ? ` · 매칭실패 ${json.unmatched}` : ""
        }`,
      });
      if (typeof window !== "undefined") window.dispatchEvent(new Event("upload-done"));
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-neutral-150 bg-neutral-50/60 p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700">스프레드시트 연동 (Google Sheets · 매일 자동)</span>
        {row?.last_synced_at && (
          <span className="text-[11px] text-neutral-400">
            마지막 동기화 {new Date(row.last_synced_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        시트 → 파일 → 공유 → ‘웹에 게시’ → 해당 시트 · CSV → 게시. 생성된 CSV 링크를 등록하면 매일 1회 자동 동기화됩니다.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?gid=0&single=true&output=csv"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm"
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy !== "idle"}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            {busy === "saving" ? "저장 중…" : "URL 저장"}
          </button>
          <button
            onClick={syncNow}
            disabled={busy !== "idle" || !url.trim()}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "syncing" ? "동기화 중…" : "지금 동기화"}
          </button>
        </div>
      </div>
      {msg && (
        <p className={`mt-2 text-xs ${msg.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>
      )}
      {!msg && row?.last_status && row.last_status !== "ok" && (
        <p className="mt-2 text-xs text-rose-600">최근 상태: {row.last_status}</p>
      )}
    </div>
  );
}
