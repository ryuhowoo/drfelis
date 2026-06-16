"use client";

import { useCallback, useEffect, useState } from "react";

// PR6: 필터/정렬 상태를 URL query에 보존 — 링크 복사 시 같은 결과 복원.
// 클라 전용(서버 재요청 없이 즉시 필터). 순수 헬퍼는 테스트 대상.

export type UrlStateShape = Record<string, string | string[]>;

// state → query string (빈 값/빈 배열은 생략)
export function serializeUrlState(state: UrlStateShape): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (Array.isArray(v)) v.forEach((x) => x && sp.append(k, x));
    else if (v) sp.set(k, v);
  }
  return sp.toString();
}

// query string → state (defaults 기준, 존재하는 키만 덮어씀)
export function parseUrlState<T extends UrlStateShape>(search: string, defaults: T): T {
  const sp = new URLSearchParams(search);
  const next = { ...defaults } as Record<string, string | string[]>;
  for (const k of Object.keys(defaults)) {
    if (Array.isArray(defaults[k])) {
      const all = sp.getAll(k);
      if (all.length) next[k] = all;
    } else {
      const v = sp.get(k);
      if (v != null) next[k] = v;
    }
  }
  return next as T;
}

export function useUrlState<T extends UrlStateShape>(defaults: T) {
  const [state, setState] = useState<T>(defaults);

  // 마운트 시 URL에서 초기화 (SSR 안전 — window는 effect에서만)
  useEffect(() => {
    const parsed = parseUrlState(window.location.search, defaults);
    setState(parsed);
    // defaults는 첫 렌더 기준 — 마운트 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = useCallback((patch: Partial<T>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      const qs = serializeUrlState(next);
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
      return next;
    });
  }, []);

  const clear = useCallback(() => set(defaults), [set, defaults]);

  return [state, set, clear] as const;
}
