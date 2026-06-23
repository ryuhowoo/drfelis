"use client";

import { useMemo, useState } from "react";

// 모든 성과 표 공용 정렬. 순수 sortRows(테스트 대상) + useTableSort 훅.
export type SortDir = "asc" | "desc";

/** key 기준 정렬 사본 반환. null/undefined는 항상 바닥. 숫자는 수치, 그 외는 ko 로캘 비교. */
export function sortRows<T>(rows: T[], key: keyof T | null, dir: SortDir): T[] {
  if (key == null) return rows;
  const arr = [...rows];
  arr.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const an = av == null;
    const bn = bv == null;
    if (an && bn) return 0;
    if (an) return 1; // null은 방향과 무관하게 바닥
    if (bn) return -1;
    let c: number;
    if (typeof av === "number" && typeof bv === "number") c = av - bv;
    else c = String(av).localeCompare(String(bv), "ko");
    return dir === "asc" ? c : -c;
  });
  return arr;
}

export function useTableSort<T>(
  rows: T[],
  initialKey: keyof T | null = null,
  initialDir: SortDir = "desc",
) {
  const [key, setKey] = useState<keyof T | null>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const sorted = useMemo(() => sortRows(rows, key, dir), [rows, key, dir]);
  const toggle = (k: keyof T) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("desc");
    }
  };
  // 헤더에 붙일 화살표 (활성 컬럼만)
  const arrow = (k: keyof T) => (k === key ? (dir === "asc" ? " ▲" : " ▼") : "");
  return { sorted, toggle, arrow, sortKey: key, sortDir: dir };
}
