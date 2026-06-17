"use client";

import { useCallback, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, Button, InlineAlert } from "@/components/ui";
import { wonShort, num } from "@/lib/format";

// PR4: 교체 검토 — window.confirm 대신 앱 내부 dialog. DB 변경 전 영향을 명확히 보여주고 확인.
// promise 기반: `const ok = await confirm({...})` 로 기존 흐름 거의 그대로 사용.
export type ReplacePreview = {
  title: string;
  period?: string;
  oldCount: number;
  oldRevenue: number;
  newCount: number;
  newRevenue: number;
  matchedSkus?: number;
  totalSkus?: number;
  note?: string;
};

export function useReplaceConfirm() {
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((p: ReplacePreview) => {
    setTyped("");
    setPreview(p);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setPreview(null);
  }, []);

  const delta = preview ? preview.newRevenue - preview.oldRevenue : 0;
  const deltaPct = preview
    ? preview.oldRevenue > 0
      ? (delta / preview.oldRevenue) * 100
      : preview.newRevenue > 0
        ? 100
        : 0
    : 0;
  const bigDelta = Math.abs(deltaPct) > 5;
  const canConfirm = !bigDelta || typed.trim() === "교체";

  const element = (
    <Dialog open={!!preview} onOpenChange={(o) => !o && finish(false)}>
      <DialogContent>
        {preview && (
          <>
            <DialogHeader title={preview.title} description={preview.period} />
            <dl className="space-y-1.5 text-sm">
              <Row label="삭제 예정 (기존)" value={`${num(preview.oldCount)}건 · ${wonShort(preview.oldRevenue)}`} />
              <Row label="삽입 예정 (신규)" value={`${num(preview.newCount)}건 · ${wonShort(preview.newRevenue)}`} strong />
              <Row
                label="매출 차이"
                value={`${delta >= 0 ? "+" : ""}${wonShort(delta)} (${deltaPct.toFixed(1)}%)`}
                tone={bigDelta ? "warn" : undefined}
              />
              {preview.matchedSkus != null && preview.totalSkus != null && (
                <Row
                  label="상품 매칭"
                  value={`${num(preview.matchedSkus)} / ${num(preview.totalSkus)} 성공`}
                  tone={preview.matchedSkus < preview.totalSkus ? "warn" : undefined}
                />
              )}
            </dl>

            {bigDelta && (
              <div className="mt-3">
                <InlineAlert tone="warning" title="총매출 변동이 큽니다">
                  파일·기간이 맞는지 확인하세요. 진행하려면 아래에 <strong>교체</strong> 를 입력하세요.
                </InlineAlert>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-label="확인 문구 입력"
                  placeholder="교체"
                  className="mt-2 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            )}

            {preview.note && <p className="mt-3 text-[11px] leading-relaxed text-ink-4">{preview.note}</p>}

            <DialogFooter>
              <Button variant="secondary" onClick={() => finish(false)}>
                취소
              </Button>
              <Button variant={bigDelta ? "danger" : "primary"} disabled={!canConfirm} onClick={() => finish(true)}>
                교체 진행
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { confirm, element };
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "warn";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd
        className={`tabular-nums ${tone === "warn" ? "font-semibold text-warning" : strong ? "font-semibold text-ink" : "text-ink-2"}`}
      >
        {value}
      </dd>
    </div>
  );
}
