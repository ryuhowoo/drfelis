"use client";

import { useEffect, useState } from "react";
import { Drawer, DrawerContent } from "@/components/ui/Drawer";
import { won, pctFloor } from "@/lib/format";
import {
  TIER_QTY,
  SANGSI_TIERS,
  JEONGGI_TIERS,
  discountVsConsumer,
  contribution,
  contributionRate,
} from "@/lib/pricing";

export type DrawerProduct = {
  id: string;
  base_name: string;
  consumer_price: number | null;
  regular_price: number | null;
  cost: number | null;
};

type Config = {
  id: string;
  sale_mode: string;
  config_type: string;
  sale_price: number | null;
  list_price: number | null;
  free_shipping: boolean;
};

export default function PriceConfigDrawer({
  product,
  mult,
  onClose,
}: {
  product: DrawerProduct | null;
  mult: number;
  onClose: () => void;
}) {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    setErr(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/products/configs?product_id=${product.id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "불러오기 실패");
        setConfigs(json.configs ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, [product]);

  async function save(sale_mode: string, config_type: string, sale: string, list: string, free: boolean) {
    if (!product) return;
    setErr(null);
    const res = await fetch("/api/products/configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: product.id, sale_mode, config_type, sale_price: sale, list_price: list, free_shipping: free }),
    });
    if (!res.ok) {
      setErr((await res.json()).error ?? "저장 실패");
      return;
    }
    const r2 = await fetch(`/api/products/configs?product_id=${product.id}`);
    setConfigs((await r2.json()).configs ?? []);
  }
  async function del(id: string) {
    setErr(null);
    const res = await fetch("/api/products/configs", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      setErr((await res.json()).error ?? "삭제 실패");
      return;
    }
    setConfigs((cs) => cs.filter((c) => c.id !== id));
  }

  const find = (mode: string, type: string) => configs.find((c) => c.sale_mode === mode && c.config_type === type) ?? null;

  return (
    <Drawer open={!!product} onOpenChange={(o) => !o && onClose()}>
      {product && (
        <DrawerContent side="right" title="가격 구성" description={product.base_name} className="w-[min(560px,calc(100vw-2rem))]">
          {loading ? (
            <p className="text-sm text-ink-4">불러오는 중…</p>
          ) : (
            <div className="space-y-5">
              {err && <p className="text-sm text-danger">{err}</p>}
              <div className="rounded-lg bg-soft px-3 py-2 text-[11px] text-ink-4">
                소비자가 {won(product.consumer_price)} · 원가 {won(product.cost)} · 상시가 {won(product.regular_price)} · 공헌승수 {mult.toFixed(3)}
                <br />가격(세트당)만 입력하면 할인율·공헌이익은 자동 계산됩니다. 기본값(소비자가·원가·상시가)은 ‘편집표’에서 수정하세요.
              </div>

              <Section
                title="상시 판매"
                tiers={SANGSI_TIERS as readonly string[]}
                mode="상시"
                product={product}
                mult={mult}
                find={find}
                onSave={save}
                onDelete={del}
                showFree
              />
              <Section
                title="정기구독 (무료배송)"
                tiers={JEONGGI_TIERS as readonly string[]}
                mode="정기"
                product={product}
                mult={mult}
                find={find}
                onSave={save}
                onDelete={del}
              />
            </div>
          )}
        </DrawerContent>
      )}
    </Drawer>
  );
}

function Section({
  title,
  tiers,
  mode,
  product,
  mult,
  find,
  onSave,
  onDelete,
  showFree,
}: {
  title: string;
  tiers: readonly string[];
  mode: string;
  product: DrawerProduct;
  mult: number;
  find: (mode: string, type: string) => Config | null;
  onSave: (mode: string, type: string, sale: string, list: string, free: boolean) => void;
  onDelete: (id: string) => void;
  showFree?: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink-2">{title}</h3>
      <div className="mt-2 space-y-2">
        {tiers.map((t) => (
          <TierRow
            key={t}
            tier={t}
            mode={mode}
            cfg={find(mode, t)}
            product={product}
            mult={mult}
            onSave={onSave}
            onDelete={onDelete}
            showFree={showFree}
          />
        ))}
      </div>
    </div>
  );
}

function TierRow({
  tier,
  mode,
  cfg,
  product,
  mult,
  onSave,
  onDelete,
  showFree,
}: {
  tier: string;
  mode: string;
  cfg: Config | null;
  product: DrawerProduct;
  mult: number;
  onSave: (mode: string, type: string, sale: string, list: string, free: boolean) => void;
  onDelete: (id: string) => void;
  showFree?: boolean;
}) {
  const [sale, setSale] = useState(cfg?.sale_price != null ? String(cfg.sale_price) : "");
  const [list, setList] = useState(cfg?.list_price != null ? String(cfg.list_price) : "");
  const [free, setFree] = useState(cfg?.free_shipping ?? mode === "정기");
  useEffect(() => {
    setSale(cfg?.sale_price != null ? String(cfg.sale_price) : "");
    setList(cfg?.list_price != null ? String(cfg.list_price) : "");
    setFree(cfg?.free_shipping ?? mode === "정기");
  }, [cfg, mode]);

  const qty = TIER_QTY[tier] ?? 1;
  const saleNum = sale.trim() === "" ? null : Number(sale.replace(/[^0-9.]/g, ""));
  const disc = discountVsConsumer(saleNum, product.consumer_price, qty);
  const contrib = contribution(saleNum, product.cost, qty, mult);
  const cRate = contributionRate(saleNum, product.cost, qty, mult);
  const dirty =
    sale !== (cfg?.sale_price != null ? String(cfg.sale_price) : "") ||
    list !== (cfg?.list_price != null ? String(cfg.list_price) : "") ||
    free !== (cfg?.free_shipping ?? mode === "정기");

  return (
    <div className="rounded-xl border border-line p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <span className="w-12 shrink-0 pb-1.5 text-xs font-semibold text-ink-2">{tier}</span>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-ink-4">판매가(세트)</span>
          <input
            value={saleNum != null ? saleNum.toLocaleString("ko-KR") : sale}
            onChange={(e) => setSale(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className="w-28 rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-ink-4">정가(선택)</span>
          <input
            value={list ? Number(list).toLocaleString("ko-KR") : ""}
            onChange={(e) => setList(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className="w-24 rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums"
          />
        </label>
        {showFree && (
          <label className="flex items-center gap-1 pb-2 text-[11px] text-ink-3">
            <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
            무배
          </label>
        )}
        <button
          onClick={() => onSave(mode, tier, sale, list, free)}
          disabled={!dirty || saleNum == null}
          className="mb-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-soft disabled:opacity-40"
        >
          {dirty ? "저장" : "저장됨"}
        </button>
        {cfg && (
          <button onClick={() => onDelete(cfg.id)} className="mb-1 rounded-lg px-2 py-1.5 text-xs text-red-500 hover:bg-red-50">
            지우기
          </button>
        )}
      </div>
      {saleNum != null && (
        <div className="mt-1 text-[11px] text-ink-4">
          소비자가 대비 {pctFloor(disc)} · 공헌이익 {won(contrib)} ({pctFloor(cRate)})
        </div>
      )}
    </div>
  );
}
