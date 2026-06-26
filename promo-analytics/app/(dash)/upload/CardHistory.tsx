"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type LogRow = {
  id: string;
  source_file: string;
  detail: string | null;
  row_count: number | null;
  action: string | null;
  created_at: string;
};

// 카드별 미니 업로드 이력 — upload_log 를 kind 로 필터해 최근 N건. (기존 전역 '연동 이력' 섹션 대체)
// upload-done window 이벤트로 자동 갱신. 항목이 많으면 영역 내부 스크롤로 전부 볼 수 있다.
export default function CardHistory({ kinds, limit = 50 }: { kinds: string[]; limit?: number }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("upload_log")
      .select("id, source_file, detail, row_count, action, created_at, kind")
      .in("kind", kinds)
      .order("created_at", { ascending: false })
      .limit(limit);
    setRows((data as LogRow[]) ?? []);
    setLoaded(true);
  }, [kinds, limit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const h = () => load();
    window.addEventListener("upload-done", h);
    return () => window.removeEventListener("upload-done", h);
  }, [load]);

  if (!loaded || rows.length === 0) return null;

  return (
    <div className="mt-3 border-t border-neutral-100 pt-2.5">
      <div className="text-[11px] font-medium text-neutral-400">
        최근 업로드{rows.length >= 6 ? ` · ${rows.length}건` : ""}
      </div>
      <ul className="mt-1 max-h-44 space-y-0.5 overflow-y-auto pr-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-[11px] text-neutral-500">
            <span className="whitespace-nowrap text-neutral-400">
              {new Date(r.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="truncate font-medium text-neutral-600">{r.source_file}</span>
            {r.detail && <span className="truncate text-neutral-400">· {r.detail}</span>}
            {r.row_count != null && (
              <span className="ml-auto whitespace-nowrap tabular-nums text-neutral-400">{r.row_count.toLocaleString()}행</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
