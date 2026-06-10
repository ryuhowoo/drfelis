"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { createClient } from "@/lib/supabase/client";

// N6 R2.1: ⌘K / Ctrl+K 커맨드 팔레트 — 페이지 점프 + 캠페인 검색.
// 캠페인 목록은 팔레트를 처음 열 때 1회 로드(이름·코드·기간만, 가벼움).

const PAGES = [
  { label: "대시보드", href: "/" },
  { label: "성과 시뮬레이터", href: "/predict" },
  { label: "캠페인 추천", href: "/prescribe" },
  { label: "히스토리 비교/분석", href: "/library" },
  { label: "데이터 업로드", href: "/upload" },
  { label: "설정", href: "/settings" },
];

type Camp = { id: string; name: string; code: string | null; start_date: string };

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [camps, setCamps] = useState<Camp[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-cmdk", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-cmdk", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open || camps !== null) return;
    const supabase = createClient();
    supabase
      .from("promotions")
      .select("id, name, code, start_date")
      .order("start_date", { ascending: false })
      .then(({ data }) => setCamps((data as Camp[]) ?? []));
  }, [open, camps]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-label="명령 팔레트">
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div className="absolute left-1/2 top-24 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2">
        <Command
          label="검색"
          className="overflow-hidden rounded-2xl card-soft-h"
          loop
        >
          <Command.Input
            autoFocus
            placeholder="캠페인·페이지 검색…  (esc 닫기)"
            className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-ink-4"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <Command.List className="max-h-[50vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-ink-4">
              결과가 없습니다.
            </Command.Empty>
            <Command.Group
              heading="페이지"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-4"
            >
              {PAGES.map((p) => (
                <Command.Item
                  key={p.href}
                  value={`페이지 ${p.label}`}
                  onSelect={() => go(p.href)}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-sm text-ink-2 data-[selected=true]:bg-brand-50 data-[selected=true]:text-brand-700"
                >
                  {p.label}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group
              heading="캠페인"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-4"
            >
              {camps === null && (
                <div className="px-3 py-2 text-sm text-ink-4">불러오는 중…</div>
              )}
              {(camps ?? []).map((c) => (
                <Command.Item
                  key={c.id}
                  value={`${c.name} ${c.code ?? ""}`}
                  onSelect={() => go(`/promotions/${c.id}`)}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-sm text-ink-2 data-[selected=true]:bg-brand-50 data-[selected=true]:text-brand-700"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-ink-4">
                    {c.start_date.slice(0, 7)}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
