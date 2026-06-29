"use client";

import { useEffect, useState } from "react";
import { Drawer, DrawerContent } from "@/components/ui/Drawer";
import { won, pctFloor } from "@/lib/format";

const TIERS = ["단품", "2묶음", "3묶음", "4묶음", "5묶음", "정기"] as const;
type Tier = (typeof TIERS)[number];

type Config = {
  id: string;
  config_type: string;
  pack_count: number | null;
  sale_price: number | null;
  list_price: number | null;
  free_shipping: boolean;
  discount_rate_consumer: number | null;
  discount_rate_regular: number | null;
};

export default function PriceConfigDrawer({
  product,
  onClose,
}: {
  product: { id: string; base_name: string } | null;
  onClose: () => void;
}) {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);
  // 새 구성 추가 폼
  const [addType, setAddType] = useState<Tier | "">("");
  const [addSale, setAddSale] = useState("");
  const [addList, setAddList] = useState("");
  const [addFree, setAddFree] = useState(false);

  useEffect(() => {
    if (!product) return;
    setErr(null);
    setLoading(true);
    setAddType("");
    setAddSale("");
    setAddList("");
    setAddFree(false);
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

  async function save(config_type: string, sale_price: string, list_price: string, free_shipping: boolean) {
    if (!product) return;
    setErr(null);
    setSavingType(config_type);
    try {
      const res = await fetch("/api/products/configs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_id: product.id, config_type, sale_price, list_price, free_shipping }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "저장 실패");
      // 갱신
      const r2 = await fetch(`/api/products/configs?product_id=${product.id}`);
      setConfigs((await r2.json()).configs ?? []);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
      return false;
    } finally {
      setSavingType(null);
    }
  }

  async function del(id: string) {
    setErr(null);
    try {
      const res = await fetch("/api/products/configs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "삭제 실패");
      setConfigs((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제 실패");
    }
  }

  const usedTypes = new Set(configs.map((c) => c.config_type));
  const addableTiers = TIERS.filter((t) => !usedTypes.has(t));
  const ordered = [...configs].sort((a, b) => TIERS.indexOf(a.config_type as Tier) - TIERS.indexOf(b.config_type as Tier));

  async function submitAdd() {
    if (!addType) return;
    const ok = await save(addType, addSale, addList, addFree);
    if (ok) {
      setAddType("");
      setAddSale("");
      setAddList("");
      setAddFree(false);
    }
  }

  return (
    <Drawer open={!!product} onOpenChange={(o) => !o && onClose()}>
      {product && (
        <DrawerContent side="right" title="가격 구성" description={product.base_name}>
          {loading ? (
            <p className="text-sm text-ink-4">불러오는 중…</p>
          ) : (
            <div className="space-y-3">
              {err && <p className="text-sm text-danger">{err}</p>}
              {ordered.length === 0 && <p className="text-sm text-ink-4">등록된 가격 구성이 없습니다. 아래에서 추가하세요.</p>}
              {ordered.map((c) => (
                <ConfigRow key={c.id} c={c} busy={savingType === c.config_type} onSave={save} onDelete={() => del(c.id)} />
              ))}

              {/* 새 구성 추가 */}
              {addableTiers.length > 0 && (
                <div className="rounded-xl border border-dashed border-line p-3">
                  <div className="text-[11px] font-medium text-ink-4">구성 추가</div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <select value={addType} onChange={(e) => setAddType(e.target.value as Tier)} className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm">
                      <option value="">종류…</option>
                      {addableTiers.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-ink-4">판매가</span>
                      <input value={addSale} onChange={(e) => setAddSale(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="필수" className="w-28 rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-ink-4">정가(선택)</span>
                      <input value={addList} onChange={(e) => setAddList(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className="w-28 rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums" />
                    </label>
                    <label className="flex items-center gap-1.5 pb-2 text-xs text-ink-3">
                      <input type="checkbox" checked={addFree} onChange={(e) => setAddFree(e.target.checked)} />
                      무료배송
                    </label>
                    <button onClick={submitAdd} disabled={!addType || !addSale || savingType === addType} className="mb-1 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
                      추가
                    </button>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-ink-4">
                판매가는 ‘세트당’(묶음/정기 포함) 가격입니다. 할인율은 소비자가 × 수량 기준으로 자동 계산됩니다.
              </p>
            </div>
          )}
        </DrawerContent>
      )}
    </Drawer>
  );
}

function ConfigRow({
  c,
  busy,
  onSave,
  onDelete,
}: {
  c: Config;
  busy: boolean;
  onSave: (type: string, sale: string, list: string, free: boolean) => Promise<boolean | undefined>;
  onDelete: () => void;
}) {
  const [sale, setSale] = useState(c.sale_price != null ? String(c.sale_price) : "");
  const [list, setList] = useState(c.list_price != null ? String(c.list_price) : "");
  const [free, setFree] = useState(c.free_shipping);
  const dirty = sale !== (c.sale_price != null ? String(c.sale_price) : "") || list !== (c.list_price != null ? String(c.list_price) : "") || free !== c.free_shipping;

  return (
    <div className="rounded-xl card-soft p-3">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{c.config_type}</span>
        <button onClick={onDelete} className="text-[11px] text-red-500 hover:underline">삭제</button>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-4">판매가</span>
          <input value={sale ? Number(sale).toLocaleString("ko-KR") : ""} onChange={(e) => setSale(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className="w-28 rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-4">정가</span>
          <input value={list ? Number(list).toLocaleString("ko-KR") : ""} onChange={(e) => setList(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className="w-28 rounded-lg border border-line bg-card px-2.5 py-1.5 text-right text-sm tabular-nums" />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-ink-3">
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
          무료배송
        </label>
        <button
          onClick={() => onSave(c.config_type, sale, list, free)}
          disabled={!dirty || busy}
          className="mb-1 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-soft disabled:opacity-40"
        >
          {busy ? "저장 중…" : dirty ? "저장" : "저장됨"}
        </button>
      </div>
      <div className="mt-1 text-[11px] text-ink-4">
        소비자가 대비 할인 {pctFloor(c.discount_rate_consumer)}
        {c.sale_price != null ? ` · 세트가 ${won(c.sale_price)}` : ""}
      </div>
    </div>
  );
}
