"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// 지시서 P0-6: 작은 변경은 즉시 optimistic 반영, 서버 성공 시 확정/실패 시 rollback+재시도.
// 전체 router.refresh()는 성공 후 reconcile 용도로만(블로킹 아님).
export type MutationOpts = {
  key: string;
  apply: () => void; // optimistic 즉시 반영
  rollback: () => void; // 실패 시 원복
  request: () => Promise<Response>;
  successMessage?: string;
  errorMessage?: string;
  undo?: () => void; // toast '실행 취소'
  reconcile?: boolean; // 성공 후 router.refresh (기본 true)
};

export function useOptimisticMutation() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(
    async (opts: MutationOpts): Promise<boolean> => {
      const { key, apply, rollback, request, successMessage, errorMessage, undo, reconcile = true } = opts;
      apply();
      setPending(key);
      let res: Response;
      try {
        res = await request();
      } catch {
        rollback();
        setPending(null);
        toast.error(errorMessage ?? "네트워크 오류", {
          action: { label: "다시 시도", onClick: () => run(opts) },
        });
        return false;
      }
      setPending(null);
      if (!res.ok) {
        rollback();
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? errorMessage ?? "처리 실패", {
          action: { label: "다시 시도", onClick: () => run(opts) },
        });
        return false;
      }
      if (successMessage) {
        toast.success(successMessage, undo ? { action: { label: "실행 취소", onClick: undo } } : undefined);
      }
      if (reconcile) router.refresh(); // 성공 상태를 먼저 보여준 뒤 reconcile
      return true;
    },
    [router],
  );

  return { run, pending };
}
