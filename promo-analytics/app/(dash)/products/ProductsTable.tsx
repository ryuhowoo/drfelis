"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { productKind, type ProductKind, SELLABLE_KINDS, COMPONENT_KINDS } from "@/lib/products";

export type ProductRow = {
  id: string;
  base_name: string;
  dr_code: string | null;
  category: string | null;
  cost: number | null;
  consumer_price: number | null;
  regular_price: number | null;
  is_subscription: boolean;
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

export default function ProductsTable({
  initialRows,
  categories,
}: {
  initialRows: ProductRow[];
  categories: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ProductRow[]>(initialRows);
  const [q, setQ] = useState("");
  const [kindF, setKindF] = useState<KindFilter>("전체");
  const [catF, setCatF] = useState<string>("전체");
  const [missingOnly, setMissingOnly] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim();
    return rows.filter((r) => {
      if (term && !(r.base_name.includes(term) || (r.dr_code ?? "").includes(term))) return false;
      const k = productKind(r.base_name);
      if (kindF === "판매" && !SELLABLE_KINDS.includes(k)) return false;
      if (kindF === "구성품" && !COMPONENT_KINDS.includes(k)) return false;
      if (kindF === "기타" && k !== "기타") return false;
      if (catF !== "전체" && (r.category ?? "") !== catF) return false;
      if (missingOnly && r.cost != null && r.consumer_price != null && r.regular_price != null) return false;
      return true;
    });
  }, [rows, q, kindF, catF, missingOnly]);

  async function patch(id: string, field: Field, value: string | boolean) {
    setErr(null);
    setSavingId(id);
    const prev = rows.find((r) => r.id === id);
    // 낙관적 반영
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? {
              ...r,
              [field]: NUMERIC_FIELDS.includes(field)
                ? value === "" ? null : Number(String(value).replace(/[^0-9.-]/g, ""))
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
      if (prev) setRows((rs) => rs.map((r) => (r.id === id ? prev : r))); // 롤백
      setErr(e instanceof Error ? e.message : "수정 실패");
    } finally {
      setSavingId(null);
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
    router.refresh();
  }

  return (
    <div className="mt-5">
      <AddProduct categories={categories} onCreated={onCreated} onError={setErr} />

      {/* 검색·필터 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
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
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-3">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          가격·원가 누락만
        </label>
        <span className="ml-auto text-xs text-ink-4">{filtered.length} / {rows.length}개</span>
      </div>

      {err && <p className="mt-2 text-sm text-danger">{err}</p>}

      <div className="mt-3 overflow-x-auto rounded-2xl card-soft">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-soft/60 text-left text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2.5 font-medium">종류</th>
              <th className="px-3 py-2.5 font-medium">SKU 코드</th>
              <th className="px-3 py-2.5 font-medium">상품명</th>
              <th className="px-3 py-2.5 font-medium">카테고리</th>
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
                <tr key={r.id} className={`hover:bg-soft/40 ${flashId === r.id ? "row-success-flash" : ""}`}>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_TONE[kind]}`}>{kind}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell value={r.dr_code} placeholder="없음" width="w-24" onSave={(v) => patch(r.id, "dr_code", v)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell value={r.base_name} width="w-72" onSave={(v) => patch(r.id, "base_name", v)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell value={r.category} placeholder="—" width="w-28" list="cats" onSave={(v) => patch(r.id, "category", v)} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <NumCell value={r.cost} onSave={(v) => patch(r.id, "cost", v)} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <NumCell value={r.consumer_price} onSave={(v) => patch(r.id, "consumer_price", v)} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <NumCell value={r.regular_price} onSave={(v) => patch(r.id, "regular_price", v)} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={r.is_subscription}
                      disabled={savingId === r.id}
                      onChange={(e) => patch(r.id, "is_subscription", e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => remove(r)} className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50">삭제</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-ink-4">조건에 맞는 상품이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 카테고리 자동완성 */}
      <datalist id="cats">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
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
      value={shown}
      placeholder={placeholder}
      list={list}
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
  onCreated,
  onError,
}: {
  categories: string[];
  onCreated: (r: ProductRow) => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ base_name: "", dr_code: "", category: "", cost: "", consumer_price: "", regular_price: "", is_subscription: false });
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
        cost: num(f.cost),
        consumer_price: num(f.consumer_price),
        regular_price: num(f.regular_price),
        is_subscription: f.is_subscription,
      });
      setF({ base_name: "", dr_code: "", category: "", cost: "", consumer_price: "", regular_price: "", is_subscription: false });
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
          <input className={`${input} w-28`} list="cats" value={f.category} onChange={(e) => set("category", e.target.value)} />
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
      <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}
