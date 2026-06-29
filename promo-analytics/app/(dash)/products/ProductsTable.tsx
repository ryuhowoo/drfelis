"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { productKind, type ProductKind, SELLABLE_KINDS, COMPONENT_KINDS } from "@/lib/products";
import PriceConfigDrawer from "./PriceConfigDrawer";
import PriceMatrix from "./PriceMatrix";

export type ProductRow = {
  id: string;
  base_name: string;
  dr_code: string | null;
  category: string | null;
  brand: string | null;
  channel: string;
  status: string;
  cost: number | null;
  consumer_price: number | null;
  regular_price: number | null;
  is_subscription: boolean;
  list_rank: number | null;
};

const STATUSES = ["판매중", "품절", "단종"] as const;
const STATUS_TONE: Record<string, string> = {
  판매중: "bg-success-soft text-success",
  품절: "bg-amber-100 text-amber-700",
  단종: "bg-neutral-200 text-neutral-600",
};
export type ConfigLite = {
  sale_mode: string;
  config_type: string;
  sale_price: number | null;
  free_shipping: boolean;
};

type Field = keyof Omit<ProductRow, "id">;
const NUMERIC_FIELDS: Field[] = ["cost", "consumer_price", "regular_price"];

const KIND_TONE: Record<ProductKind, string> = {
  제품: "bg-brand-100 text-brand-700",
  세트: "bg-brand-100 text-brand-700",
  상품: "bg-brand-100 text-brand-700",
  원재료: "bg-amber-100 text-amber-700",
  부재료: "bg-amber-100 text-amber-700",
  부자재: "bg-amber-100 text-amber-700",
  기타: "bg-neutral-100 text-neutral-500",
};

type KindFilter = "전체" | "판매" | "구성품" | "기타";
const UNSET = "(미지정)";

export default function ProductsTable({
  initialRows,
  categories,
  brands,
  channels,
  configsByProduct,
  mult,
}: {
  initialRows: ProductRow[];
  categories: string[];
  brands: string[];
  channels: string[];
  configsByProduct: Record<string, ConfigLite[]>;
  mult: number;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ProductRow[]>(initialRows);
  const [cats, setCats] = useState<string[]>(categories);
  const [view, setView] = useState<"edit" | "matrix">("edit");
  // 카탈로그(가격표 SKU)만 보기 — 기본 ON. 끄면 전체 상품(구성품·비B2C·과거 SKU 포함) 표시.
  const [catalogOnly, setCatalogOnly] = useState(true);
  const [channelF, setChannelF] = useState<string>("B2C");
  const [statusF, setStatusF] = useState<string>("전체");
  const [q, setQ] = useState("");
  const [kindF, setKindF] = useState<KindFilter>("전체");
  const [catF, setCatF] = useState<string>("전체");
  const [missingOnly, setMissingOnly] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<string>("");
  const [configFor, setConfigFor] = useState<ProductRow | null>(null);
  const [configs, setConfigs] = useState<Record<string, ConfigLite[]>>(configsByProduct);

  // 가격표 인라인: tier 판매가 저장 + 로컬 반영
  async function saveConfig(productId: string, sale_mode: string, config_type: string, sale: string) {
    setErr(null);
    const saleNum = sale.trim() === "" ? null : Number(sale.replace(/[^0-9.]/g, ""));
    setConfigs((prev) => {
      const list = [...(prev[productId] ?? [])];
      const i = list.findIndex((c) => c.sale_mode === sale_mode && c.config_type === config_type);
      if (i >= 0) list[i] = { ...list[i], sale_price: saleNum };
      else list.push({ sale_mode, config_type, sale_price: saleNum, free_shipping: sale_mode === "정기" });
      return { ...prev, [productId]: list };
    });
    const res = await fetch("/api/products/configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: productId, sale_mode, config_type, sale_price: sale, free_shipping: sale_mode === "정기" }),
    });
    if (!res.ok) setErr((await res.json()).error ?? "가격 저장 실패");
  }

  // 카탈로그(가격표 SKU)만 / 채널 필터 — 편집표·가격표 공통 적용.
  // 카탈로그만 보기일 땐 시트 SKU(list_rank)만 시트 순서대로(이미 정렬됨) 노출하고 채널 필터는 무시.
  const channelRows = useMemo(() => {
    if (catalogOnly) return rows.filter((r) => r.list_rank != null);
    return channelF === "전체" ? rows : rows.filter((r) => r.channel === channelF);
  }, [rows, catalogOnly, channelF]);

  const filtered = useMemo(() => {
    const term = q.trim();
    return channelRows.filter((r) => {
      if (term && !(r.base_name.includes(term) || (r.dr_code ?? "").includes(term))) return false;
      const k = productKind(r.base_name);
      if (kindF === "판매" && !SELLABLE_KINDS.includes(k)) return false;
      if (kindF === "구성품" && !COMPONENT_KINDS.includes(k)) return false;
      if (kindF === "기타" && k !== "기타") return false;
      if (catF === UNSET && r.category) return false;
      if (catF !== "전체" && catF !== UNSET && (r.category ?? "") !== catF) return false;
      if (statusF !== "전체" && r.status !== statusF) return false;
      if (missingOnly && r.cost != null && r.consumer_price != null && r.regular_price != null) return false;
      return true;
    });
  }, [channelRows, q, kindF, catF, statusF, missingOnly]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const c = r.category?.trim();
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [rows]);
  const unsetCount = rows.filter((r) => !r.category).length;

  async function patch(id: string, field: Field, value: string | boolean | null) {
    setErr(null);
    setSavingId(id);
    const prev = rows.find((r) => r.id === id);
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? {
              ...r,
              [field]: NUMERIC_FIELDS.includes(field)
                ? value === "" || value == null ? null : Number(String(value).replace(/[^0-9.-]/g, ""))
                : field === "is_subscription" ? value : (value === "" ? null : value),
            }
          : r,
      ),
    );
    try {
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, [field]: value }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "수정 실패");
      setFlashId(id);
      setTimeout(() => setFlashId((f) => (f === id ? null : f)), 800);
    } catch (e) {
      if (prev) setRows((rs) => rs.map((r) => (r.id === id ? prev : r)));
      setErr(e instanceof Error ? e.message : "수정 실패");
    } finally {
      setSavingId(null);
    }
  }

  async function bulkAssign() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const cat = bulkCat === UNSET || bulkCat === "" ? null : bulkCat;
    setErr(null);
    const snapshot = rows;
    setRows((rs) => rs.map((r) => (selected.has(r.id) ? { ...r, category: cat } : r)));
    try {
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, category: cat }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "일괄 적용 실패");
      setSelected(new Set());
    } catch (e) {
      setRows(snapshot);
      setErr(e instanceof Error ? e.message : "일괄 적용 실패");
    }
  }

  async function remove(r: ProductRow) {
    if (!confirm(`'${r.base_name}' 상품을 삭제할까요? (가격 구성도 함께 삭제)`)) return;
    setErr(null);
    try {
      const res = await fetch("/api/products", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: r.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "삭제 실패");
      setRows((rs) => rs.filter((x) => x.id !== r.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제 실패");
    }
  }

  function onCreated(row: ProductRow) {
    setRows((rs) => [row, ...rs]);
    if (row.category && !cats.includes(row.category)) setCats((c) => [...c, row.category!]);
    setCatalogOnly(false); // 새 SKU 는 카탈로그 순서가 없어 '전체 보기'로 전환해 바로 보이게
    router.refresh();
  }

  // 카테고리 관리 후 로컬 반영
  function applyCatChange(kind: "add" | "rename" | "merge" | "delete", a: string, b?: string) {
    if (kind === "add") setCats((c) => (c.includes(a) ? c : [...c, a]));
    else if (kind === "rename") {
      setCats((c) => c.map((x) => (x === a ? b! : x)));
      setRows((rs) => rs.map((r) => (r.category === a ? { ...r, category: b! } : r)));
    } else if (kind === "merge") {
      setCats((c) => c.filter((x) => x !== a));
      setRows((rs) => rs.map((r) => (r.category === a ? { ...r, category: b! } : r)));
    } else if (kind === "delete") {
      setCats((c) => c.filter((x) => x !== a));
      setRows((rs) => rs.map((r) => (r.category === a ? { ...r, category: null } : r)));
    }
    router.refresh();
  }

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s);
      if (allSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });

  return (
    <div className="mt-5 space-y-4">
      {/* 보기 전환 + 카탈로그 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-line p-0.5 text-sm">
          <button
            onClick={() => setView("edit")}
            className={`rounded-lg px-3 py-1.5 font-medium ${view === "edit" ? "bg-brand-500 text-white" : "text-ink-3 hover:bg-soft"}`}
          >
            편집표
          </button>
          <button
            onClick={() => setView("matrix")}
            className={`rounded-lg px-3 py-1.5 font-medium ${view === "matrix" ? "bg-brand-500 text-white" : "text-ink-3 hover:bg-soft"}`}
          >
            가격표(매트릭스)
          </button>
        </div>
        <div className="inline-flex rounded-xl border border-line p-0.5 text-sm">
          <button
            onClick={() => setCatalogOnly(true)}
            className={`rounded-lg px-3 py-1.5 font-medium ${catalogOnly ? "bg-brand-500 text-white" : "text-ink-3 hover:bg-soft"}`}
          >
            가격표 상품만
          </button>
          <button
            onClick={() => setCatalogOnly(false)}
            className={`rounded-lg px-3 py-1.5 font-medium ${!catalogOnly ? "bg-brand-500 text-white" : "text-ink-3 hover:bg-soft"}`}
          >
            전체 보기
          </button>
        </div>
        <span className="text-xs text-ink-4">
          {catalogOnly ? "B2C 가격표에 있는 판매 SKU만 시트 순서대로 표시" : "구성품·비B2C·과거 SKU 포함 전체"}
        </span>
      </div>

      <CategoryManager cats={cats} counts={catCounts} unsetCount={unsetCount} onChange={applyCatChange} onError={setErr} />

      {view === "matrix" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {!catalogOnly && (
              <select value={channelF} onChange={(e) => setChannelF(e.target.value)} className="rounded-xl border border-line bg-card px-2.5 py-2 text-sm">
                <option value="B2C">B2C (기본)</option>
                <option value="전체">채널 전체</option>
                {channels.filter((c) => c !== "B2C").map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <span className="text-xs text-ink-4">{channelRows.length}개</span>
          </div>
          <PriceMatrix
            rows={channelRows}
            configsByProduct={configs}
            mult={mult}
            onOpen={setConfigFor}
            onPatchBase={(id, field, val) => patch(id, field, val)}
            onSaveConfig={saveConfig}
          />
        </>
      ) : (
      <>
      <AddProduct categories={cats} brands={brands} onCreated={onCreated} onError={setErr} />

      {/* 검색·필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·코드 검색…"
          className="w-56 rounded-xl border border-line bg-card px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        />
        <select value={kindF} onChange={(e) => setKindF(e.target.value as KindFilter)} className="rounded-xl border border-line bg-card px-2.5 py-2 text-sm">
          <option value="전체">종류 전체</option>
          <option value="판매">판매상품(제품·세트·상품)</option>
          <option value="구성품">구성품(원재료·부재료·부자재)</option>
          <option value="기타">기타(접두없음)</option>
        </select>
        <select value={catF} onChange={(e) => setCatF(e.target.value)} className="rounded-xl border border-line bg-card px-2.5 py-2 text-sm">
          <option value="전체">카테고리 전체</option>
          <option value={UNSET}>미지정 ({unsetCount})</option>
          {cats.map((c) => (
            <option key={c} value={c}>{c} ({catCounts.get(c) ?? 0})</option>
          ))}
        </select>
        {!catalogOnly && (
          <select value={channelF} onChange={(e) => setChannelF(e.target.value)} className="rounded-xl border border-line bg-card px-2.5 py-2 text-sm">
            <option value="B2C">B2C (기본)</option>
            <option value="전체">채널 전체</option>
            {channels.filter((c) => c !== "B2C").map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded-xl border border-line bg-card px-2.5 py-2 text-sm">
          <option value="전체">상태 전체</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-3">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          가격·원가 누락만
        </label>
        <span className="ml-auto text-xs text-ink-4">{filtered.length} / {channelRows.length}개</span>
      </div>

      {/* 선택 일괄 카테고리 적용 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-700">{selected.size}개 선택</span>
          <span className="text-ink-3">→ 카테고리</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm">
            <option value="">선택…</option>
            <option value={UNSET}>미지정으로</option>
            {cats.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={bulkAssign}
            disabled={!bulkCat}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
          >
            적용
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-ink-4 hover:text-ink-2">선택 해제</button>
        </div>
      )}

      {err && <p className="text-sm text-danger">{err}</p>}

      <div className="overflow-x-auto rounded-2xl card-soft">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="bg-soft/60 text-left text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2.5"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="전체 선택" /></th>
              <th className="px-3 py-2.5 font-medium">종류</th>
              <th className="px-3 py-2.5 font-medium">SKU 코드</th>
              <th className="px-3 py-2.5 font-medium">상품명</th>
              <th className="px-3 py-2.5 font-medium">카테고리</th>
              <th className="px-3 py-2.5 font-medium">브랜드</th>
              <th className="px-3 py-2.5 font-medium">상태</th>
              <th className="px-3 py-2.5 text-right font-medium">원가</th>
              <th className="px-3 py-2.5 text-right font-medium">소비자가</th>
              <th className="px-3 py-2.5 text-right font-medium">상시 판매가</th>
              <th className="px-3 py-2.5 text-center font-medium">정기</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {filtered.map((r) => {
              const kind = productKind(r.base_name);
              return (
                <tr key={r.id} className={`hover:bg-soft/40 ${flashId === r.id ? "row-success-flash" : ""} ${selected.has(r.id) ? "bg-brand-50/40" : ""}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_TONE[kind]}`}>{kind}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell value={r.dr_code} placeholder="없음" width="w-24" onSave={(v) => patch(r.id, "dr_code", v)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell value={r.base_name} width="w-[26rem]" onSave={(v) => patch(r.id, "base_name", v)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={r.category ?? ""}
                      disabled={savingId === r.id}
                      onChange={(e) => patch(r.id, "category", e.target.value === "" ? null : e.target.value)}
                      className={`w-32 rounded-lg border px-2 py-1 text-sm focus:border-brand-400 focus:outline-none ${r.category ? "border-line bg-card" : "border-amber-300 bg-amber-50 text-amber-700"}`}
                    >
                      <option value="">미지정</option>
                      {r.category && !cats.includes(r.category) && <option value={r.category}>{r.category}</option>}
                      {cats.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell value={r.brand} placeholder="—" width="w-28" list="brands" onSave={(v) => patch(r.id, "brand", v)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={r.status}
                      disabled={savingId === r.id}
                      onChange={(e) => patch(r.id, "status", e.target.value)}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium focus:outline-none ${STATUS_TONE[r.status] ?? "bg-neutral-100 text-neutral-500"}`}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-right"><NumCell value={r.cost} onSave={(v) => patch(r.id, "cost", v)} /></td>
                  <td className="px-2 py-1.5 text-right"><NumCell value={r.consumer_price} onSave={(v) => patch(r.id, "consumer_price", v)} /></td>
                  <td className="px-2 py-1.5 text-right"><NumCell value={r.regular_price} onSave={(v) => patch(r.id, "regular_price", v)} /></td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={r.is_subscription}
                      disabled={savingId === r.id}
                      onChange={(e) => patch(r.id, "is_subscription", e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <button onClick={() => setConfigFor(r)} className="rounded px-1.5 py-0.5 text-xs text-brand-600 hover:bg-brand-50">구성</button>
                    <button onClick={() => remove(r)} className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50">삭제</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-ink-4">조건에 맞는 상품이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <datalist id="brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
      </>
      )}

      <PriceConfigDrawer
        product={
          configFor
            ? { id: configFor.id, base_name: configFor.base_name, consumer_price: configFor.consumer_price, regular_price: configFor.regular_price, cost: configFor.cost }
            : null
        }
        mult={mult}
        onClose={() => {
          setConfigFor(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function CategoryManager({
  cats,
  counts,
  unsetCount,
  onChange,
  onError,
}: {
  cats: string[];
  counts: Map<string, number>;
  unsetCount: number;
  onChange: (kind: "add" | "rename" | "merge" | "delete", a: string, b?: string) => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(method: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    onError("");
    try {
      const res = await fetch("/api/product-categories", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "실패");
      return true;
    } catch (e) {
      onError(e instanceof Error ? e.message : "실패");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const n = newName.trim();
    if (!n) return;
    if (await call("POST", { name: n })) {
      onChange("add", n);
      setNewName("");
    }
  }
  async function rename(from: string) {
    const to = prompt(`'${from}' → 새 이름 (이미 있는 이름으로 바꾸면 병합됩니다)`, from)?.trim();
    if (!to || to === from) return;
    const merge = cats.includes(to);
    if (await call("PATCH", { from, to })) onChange(merge ? "merge" : "rename", from, to);
  }
  async function del(name: string) {
    const n = counts.get(name) ?? 0;
    if (!confirm(`'${name}' 카테고리를 삭제할까요?${n > 0 ? ` 이 카테고리 상품 ${n}개는 '미지정'이 됩니다.` : ""}`)) return;
    if (await call("DELETE", { name })) onChange("delete", name);
  }

  return (
    <div className="rounded-2xl card-soft p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-ink-2">
          카테고리 관리 <span className="font-normal text-ink-4">· {cats.length}종{unsetCount > 0 ? ` · 미지정 ${unsetCount}개` : ""}</span>
        </span>
        <span className="text-ink-4">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-[11px] text-ink-4">
            이름 변경 시 해당 상품들의 카테고리도 함께 바뀝니다(예: 굿즈 → 집사). 이미 있는 이름으로 바꾸면 두 카테고리가 병합돼요.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {cats.map((c) => (
              <li key={c} className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-sm">
                <span className="text-ink-2">{c}</span>
                <span className="text-[11px] text-ink-4">{counts.get(c) ?? 0}</span>
                <button onClick={() => rename(c)} disabled={busy} className="ml-1 text-[11px] text-brand-600 hover:underline">이름변경</button>
                <button onClick={() => del(c)} disabled={busy} className="text-[11px] text-red-500 hover:underline">삭제</button>
              </li>
            ))}
            {cats.length === 0 && <li className="text-xs text-ink-4">카테고리가 없습니다.</li>}
          </ul>
          <div className="mt-3 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="새 카테고리 (예: 집사)"
              className="w-48 rounded-lg border border-line bg-card px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
            />
            <button onClick={add} disabled={busy || !newName.trim()} className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
              추가
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TextCell({
  value,
  placeholder,
  width,
  list,
  onSave,
}: {
  value: string | null;
  placeholder?: string;
  width: string;
  list?: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  return (
    <input
      list={list}
      value={shown}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft != null && draft !== (value ?? "")) onSave(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className={`${width} rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm hover:border-line focus:border-brand-400 focus:bg-card focus:outline-none`}
    />
  );
}

function NumCell({ value, onSave }: { value: number | null; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value != null ? value.toLocaleString("ko-KR") : "");
  return (
    <input
      value={shown}
      inputMode="numeric"
      placeholder="—"
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
      onBlur={() => {
        if (draft != null && Number(draft || "0") !== (value ?? 0)) onSave(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className="w-24 rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-sm tabular-nums hover:border-line focus:border-brand-400 focus:bg-card focus:outline-none"
    />
  );
}

function AddProduct({
  categories,
  brands,
  onCreated,
  onError,
}: {
  categories: string[];
  brands: string[];
  onCreated: (r: ProductRow) => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ base_name: "", dr_code: "", category: "", brand: "", cost: "", consumer_price: "", regular_price: "", is_subscription: false });
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    if (!f.base_name.trim()) {
      onError("상품명을 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(f),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "생성 실패");
      const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^0-9.-]/g, "")));
      onCreated({
        id: json.id,
        base_name: f.base_name.trim(),
        dr_code: f.dr_code.trim() || null,
        category: f.category.trim() || null,
        brand: f.brand.trim() || null,
        channel: "B2C",
        status: "판매중",
        cost: num(f.cost),
        consumer_price: num(f.consumer_price),
        regular_price: num(f.regular_price),
        is_subscription: f.is_subscription,
        list_rank: null,
      });
      setF({ base_name: "", dr_code: "", category: "", brand: "", cost: "", consumer_price: "", regular_price: "", is_subscription: false });
      setOpen(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
        + 새 SKU 추가
      </button>
    );
  }
  const input = "rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none";
  return (
    <div className="rounded-2xl card-soft p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4">상품명 *</span>
          <input className={`${input} w-64`} value={f.base_name} onChange={(e) => set("base_name", e.target.value)} placeholder="(제품) …" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4">SKU 코드</span>
          <input className={`${input} w-28`} value={f.dr_code} onChange={(e) => set("dr_code", e.target.value)} placeholder="DR…" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4">카테고리</span>
          <select className={`${input} w-28`} value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">미지정</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4">브랜드</span>
          <input className={`${input} w-28`} list="brands-add" value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="(선택)" />
          <datalist id="brands-add">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4">원가</span>
          <input className={`${input} w-24 text-right`} inputMode="numeric" value={f.cost} onChange={(e) => set("cost", e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4">소비자가</span>
          <input className={`${input} w-24 text-right`} inputMode="numeric" value={f.consumer_price} onChange={(e) => set("consumer_price", e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4">상시 판매가</span>
          <input className={`${input} w-24 text-right`} inputMode="numeric" value={f.regular_price} onChange={(e) => set("regular_price", e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-ink-3">
          <input type="checkbox" checked={f.is_subscription} onChange={(e) => set("is_subscription", e.target.checked)} />
          정기
        </label>
        <div className="flex gap-2 pb-1">
          <button onClick={submit} disabled={busy} className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
            {busy ? "추가 중…" : "추가"}
          </button>
          <button onClick={() => setOpen(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-3 hover:bg-soft">취소</button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-4">접두 ‘(제품)/(세트)/(상품)’=판매상품, ‘(원재료)/(부재료)/(부자재)’=구성품으로 자동 분류됩니다.</p>
    </div>
  );
}
