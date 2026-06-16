import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";

describe("useOptimisticMutation", () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it("성공: optimistic apply + 성공 토스트 + reconcile refresh, rollback 없음", async () => {
    const apply = vi.fn();
    const rollback = vi.fn();
    const { result } = renderHook(() => useOptimisticMutation());
    await act(async () => {
      const ok = await result.current.run({
        key: "k",
        apply,
        rollback,
        request: async () => new Response(null, { status: 200 }),
        successMessage: "ok",
      });
      expect(ok).toBe(true);
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("실패: rollback + error 토스트, reconcile 안함", async () => {
    const apply = vi.fn();
    const rollback = vi.fn();
    const { result } = renderHook(() => useOptimisticMutation());
    await act(async () => {
      const ok = await result.current.run({
        key: "k",
        apply,
        rollback,
        request: async () => new Response(JSON.stringify({ error: "x" }), { status: 500 }),
      });
      expect(ok).toBe(false);
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
