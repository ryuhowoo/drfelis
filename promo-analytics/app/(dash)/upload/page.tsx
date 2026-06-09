"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { won, pct } from "@/lib/format";
import type { ParsedPriceConfig } from "@/lib/parse";

// 업로드 이력 기록 — 연동 파일명·시간·종류·행수를 남긴다(업데이트 참고용).
// 실패해도 업로드 자체를 막지 않는다(best-effort).
async function logUpload(
  supabase: ReturnType<typeof createClient>,
  entry: {
    kind: "daily" | "promotion" | "price_master" | "plan_guide";
    source_file: string;
    detail?: string;
    row_count?: number;
    total_revenue?: number | null;
    action?: "insert" | "replace";
  },
) {
  try {
    const { data } = await supabase.auth.getUser();
    await supabase
      .from("upload_log")
      .insert({ ...entry, uploaded_by: data.user?.email ?? null });
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("upload-done"));
  } catch {
    /* 이력 기록 실패는 무시 */
  }
}

type Kind = "master" | "daily" | "promotion";

type CardDef = {
  key: Kind;
  title: string;
  desc: string;
};

const CARDS: CardDef[] = [
  {
    key: "master",
    title: "① 마스터 (품목코드)",
    desc: "기초상품 원가·소비자가·상시가. 가장 먼저 올리면 상품 정보가 채워집니다.",
  },
  {
    key: "daily",
    title: "② 일별 매출 추이",
    desc: "일자 × 기초상품 × 옵션 × 결제금액 × 수량. baseline(평소 매출)의 연료입니다. 재업로드 시 같은 기간·상품을 교체합니다(누적 아님) — 수량·옵션정보 백필용.",
  },
  {
    key: "promotion",
    title: "③ 캠페인 시트",
    desc: "캠페인 기간 실적(전 제품). 같은 코드의 캠페인이 있으면 실적을 교체(백필)하고 확정 플랜은 보존합니다. 없으면 새로 생성합니다.",
  },
];

export default function UploadPage() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">데이터 업로드</h1>
      <p className="mt-1 text-sm text-neutral-500">
        엑셀(.xlsx) 파일을 순서대로 올려주세요. 헤더 이름으로 자동 인식합니다.
        파싱·적재 모두 브라우저에서 진행하므로 큰 파일도 안정적으로 처리됩니다.
      </p>
      <div className="mt-6 grid gap-4">
        {CARDS.map((c) => (
          <UploadCard key={c.key} def={c} />
        ))}
        <PriceMasterCard />
        <PlanGuideImportCard />
      </div>
      <UploadHistory />
    </div>
  );
}

type LogRow = {
  id: string;
  kind: string;
  source_file: string;
  detail: string | null;
  row_count: number | null;
  total_revenue: number | null;
  action: string | null;
  uploaded_by: string | null;
  created_at: string;
};

const KIND_LABEL: Record<string, string> = {
  daily: "일별 매출",
  promotion: "캠페인",
  price_master: "가격 마스터",
  plan_guide: "플랜 가이드",
};

function UploadHistory() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("upload_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    setRows((data as LogRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("upload-done", h);
    return () => window.removeEventListener("upload-done", h);
  }, [load]);

  return (
    <div className="mt-6 rounded-[24px] bg-white card-soft p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">연동 이력</h2>
        <button
          onClick={load}
          className="rounded-lg border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          새로고침
        </button>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        최근 업로드한 파일·시간·행수입니다. 다음 업데이트 때 어떤 소스가 반영됐는지 참고하세요.
      </p>
      {loading ? (
        <p className="mt-4 text-sm text-neutral-400">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">아직 업로드 이력이 없습니다.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-neutral-400">
              <tr>
                <th className="py-1.5 pr-3">시간</th>
                <th className="py-1.5 pr-3">종류</th>
                <th className="py-1.5 pr-3">파일명</th>
                <th className="py-1.5 pr-3">요약</th>
                <th className="py-1.5 pr-3 text-right">행수</th>
                <th className="py-1.5">방식</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-neutral-500">
                    {new Date(r.created_at).toLocaleString("ko-KR", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                      {KIND_LABEL[r.kind] ?? r.kind}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-medium text-neutral-800">{r.source_file}</td>
                  <td className="py-1.5 pr-3 text-neutral-500">{r.detail ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-700">
                    {r.row_count != null ? r.row_count.toLocaleString() : "—"}
                  </td>
                  <td className="py-1.5">
                    {r.action === "replace" ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">교체(백필)</span>
                    ) : (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500">신규</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Progress = {
  phase: "idle" | "reading" | "parsing" | "uploading" | "ok" | "error";
  message: string;
  done?: number;
  total?: number;
};

function UploadCard({ def }: { def: CardDef }) {
  const router = useRouter();
  const [p, setP] = useState<Progress>({ phase: "idle", message: "" });

  async function handleFile(file: File) {
    try {
      setP({ phase: "reading", message: `${file.name} 읽는 중…` });
      const buf = await file.arrayBuffer();

      setP({ phase: "parsing", message: "엑셀 파싱 중…" });
      const parse = await import("@/lib/parse");
      const products = await import("@/lib/products");
      const supabase = createClient();

      if (def.key === "master") {
        const rows = parse.parseMaster(buf);
        if (rows.length === 0) throw new Error("유효한 행이 없습니다.");
        setP({ phase: "uploading", message: `${rows.length}개 품목 적재 중…` });
        const { error } = await supabase
          .from("products")
          .upsert(rows, { onConflict: "base_name" });
        if (error) throw error;
        await logUpload(supabase, {
          kind: "price_master",
          source_file: file.name,
          detail: `품목 마스터 ${rows.length}건`,
          row_count: rows.length,
          action: "replace",
        });
        setP({ phase: "ok", message: `${rows.length}개 품목 반영 완료` });
        return;
      }

      if (def.key === "daily") {
        const rows = parse.parseDailySales(buf);
        if (rows.length === 0) throw new Error("유효한 행이 없습니다.");

        const allDates = rows.map((r) => r.sale_date);
        const minDate = allDates.reduce((a, b) => (a < b ? a : b));
        const maxDate = allDates.reduce((a, b) => (a > b ? a : b));
        const baseNamesList = [...new Set(rows.map((r) => r.base_name))];
        const newRevenue = rows.reduce((s, r) => s + r.revenue, 0);

        // N1 백필 = 소스 교체. 같은 기간·상품의 기존 행을 삭제 후 새 파일 삽입(누적 금지).
        // 옵션정보가 채워지면 자연키(일자·상품·옵션)가 바뀌어 upsert로는 옛 빈-옵션 행이 남아
        // 매출이 중복 합산되므로, 반드시 범위 삭제 후 삽입한다.
        setP({ phase: "uploading", message: "기존 데이터 확인 중…" });
        const { count: oldCount, error: cntErr } = await supabase
          .from("daily_sales")
          .select("*", { count: "exact", head: true })
          .gte("sale_date", minDate)
          .lte("sale_date", maxDate)
          .in("base_name", baseNamesList);
        if (cntErr) throw cntErr;

        if (oldCount && oldCount > 0) {
          // 기존 총매출 합산(페이지네이션) — 불변식(총매출 동일) 확인용
          let oldRevenue = 0;
          const size = 1000;
          for (let from = 0; from < oldCount; from += size) {
            const { data, error } = await supabase
              .from("daily_sales")
              .select("revenue")
              .gte("sale_date", minDate)
              .lte("sale_date", maxDate)
              .in("base_name", baseNamesList)
              .range(from, from + size - 1);
            if (error) throw error;
            for (const r of data ?? []) oldRevenue += Number(r.revenue) || 0;
          }
          const delta = newRevenue - oldRevenue;
          const deltaPct =
            oldRevenue > 0 ? (delta / oldRevenue) * 100 : newRevenue > 0 ? 100 : 0;

          // 불변식 위반(±5% 초과)이면 중단 — 백필은 수량·옵션만 채우고 총매출은 동일해야 함
          if (Math.abs(deltaPct) > 5) {
            throw new Error(
              `백필 중단: 교체 시 총매출이 ${deltaPct.toFixed(1)}% 변동합니다 ` +
                `(기존 ₩${Math.round(oldRevenue).toLocaleString()} → 신규 ₩${Math.round(newRevenue).toLocaleString()}). ` +
                `백필은 수량·옵션정보만 채워야 하며 같은 기간 총매출은 동일해야 합니다. 파일/기간을 확인하세요.`,
            );
          }

          const ok = window.confirm(
            `백필(소스 교체) — 기간 ${minDate} ~ ${maxDate}\n` +
              `기존 ${oldCount.toLocaleString()}건 · 총매출 ₩${Math.round(oldRevenue).toLocaleString()}\n` +
              `신규 ${rows.length.toLocaleString()}건 · 총매출 ₩${Math.round(newRevenue).toLocaleString()}\n` +
              `매출 차이 ₩${Math.round(delta).toLocaleString()} (${deltaPct.toFixed(1)}%)\n\n` +
              `이 기간·상품의 기존 행을 모두 삭제하고 새 파일로 교체합니다 (누적 아님). 진행할까요?`,
          );
          if (!ok) {
            setP({ phase: "idle", message: "취소됨" });
            return;
          }

          setP({ phase: "uploading", message: `기존 ${oldCount.toLocaleString()}행 삭제 중…` });
          const { error: delErr } = await supabase
            .from("daily_sales")
            .delete()
            .gte("sale_date", minDate)
            .lte("sale_date", maxDate)
            .in("base_name", baseNamesList);
          if (delErr) throw delErr;
        }

        setP({ phase: "uploading", message: `상품 매칭 중… (${rows.length}행)` });
        const productMap = await products.ensureProducts(
          supabase,
          rows.map((r) => r.base_name),
        );

        // 파일 내부 동일 키(일자·상품·옵션) 합산 — 한 배치에 중복 키가 있으면 upsert가 실패하므로 방어.
        const dedup = new Map<
          string,
          { sale_date: string; product_id: string | null; base_name: string; option_info: string; revenue: number; quantity: number; source_file: string }
        >();
        for (const r of rows) {
          const key = JSON.stringify([r.sale_date, r.base_name, r.option_info]);
          const prev = dedup.get(key);
          dedup.set(key, {
            sale_date: r.sale_date,
            product_id: productMap.get(r.base_name) ?? null,
            base_name: r.base_name,
            option_info: r.option_info,
            revenue: (prev?.revenue ?? 0) + r.revenue,
            quantity: (prev?.quantity ?? 0) + r.quantity,
            source_file: file.name,
          });
        }
        const records = [...dedup.values()];

        const batches = products.chunk(records, 1000);
        let done = 0;
        for (const [i, batch] of batches.entries()) {
          setP({
            phase: "uploading",
            message: `${i + 1}/${batches.length} 배치 적재 중…`,
            done,
            total: records.length,
          });
          const { error } = await supabase
            .from("daily_sales")
            .upsert(batch, { onConflict: "sale_date,base_name,option_info" });
          if (error) throw error;
          done += batch.length;
        }

        const dates = rows.map((r) => r.sale_date).sort();
        await logUpload(supabase, {
          kind: "daily",
          source_file: file.name,
          detail: `${dates[0]} ~ ${dates[dates.length - 1]} · 상품 ${productMap.size}종`,
          row_count: done,
          total_revenue: newRevenue,
          action: oldCount && oldCount > 0 ? "replace" : "insert",
        });
        setP({
          phase: "ok",
          message: `${done}행 적재 · 상품 ${productMap.size}종 · 기간 ${dates[0]} ~ ${dates[dates.length - 1]}`,
        });
        return;
      }

      // promotion
      const parsed = parse.parsePromotionSheet(buf);
      if (parsed.rows.length === 0) throw new Error("유효한 행이 없습니다.");
      if (!parsed.start_date || !parsed.end_date)
        throw new Error("캠페인 기간을 시트에서 찾지 못했습니다. (일자 누적 컬럼 확인)");

      const rawName = file.name.replace(/\.(xlsx|xls|csv)$/i, "");
      const code = parse.extractPromoCode(rawName);
      const name = code ? rawName.slice(rawName.indexOf(code)) : rawName;
      const newRevenue = parsed.rows.reduce((s, r) => s + r.revenue, 0);

      const buildRecords = (promotionId: string, productMap: Map<string, string>) =>
        parsed.rows.map((r) => ({
          promotion_id: promotionId,
          product_id: productMap.get(r.base_name) ?? null,
          base_name: r.base_name,
          option_info: r.option_info,
          revenue: r.revenue,
          order_count: r.order_count,
          aov: r.aov,
          fee: r.fee,
          cost: r.cost,
          quantity: r.quantity,
        }));

      // 기존 캠페인 탐지 (코드 우선, 없으면 이름) — 있으면 N1 백필(실적 교체)
      setP({ phase: "uploading", message: "기존 캠페인 확인 중…" });
      let existing: { id: string } | null = null;
      if (code) {
        const { data } = await supabase
          .from("promotions")
          .select("id")
          .eq("code", code)
          .limit(1)
          .maybeSingle();
        existing = (data as { id: string } | null) ?? null;
      }
      if (!existing) {
        const { data } = await supabase
          .from("promotions")
          .select("id")
          .eq("name", name)
          .limit(1)
          .maybeSingle();
        existing = (data as { id: string } | null) ?? null;
      }

      if (existing) {
        // 백필: 이 캠페인의 기존 실적만 삭제 후 교체. 확정 플랜(frozen)·expected는 건드리지 않음.
        const { data: oldRows, error: oldErr } = await supabase
          .from("promotion_sales")
          .select("revenue")
          .eq("promotion_id", existing.id);
        if (oldErr) throw oldErr;
        const oldCount = (oldRows ?? []).length;
        const oldRevenue = (oldRows ?? []).reduce(
          (s, r) => s + (Number(r.revenue) || 0),
          0,
        );
        const delta = newRevenue - oldRevenue;
        const deltaPct =
          oldRevenue > 0 ? (delta / oldRevenue) * 100 : newRevenue > 0 ? 100 : 0;
        if (Math.abs(deltaPct) > 5) {
          throw new Error(
            `백필 중단: 캠페인 실적 총매출이 ${deltaPct.toFixed(1)}% 변동합니다 ` +
              `(기존 ₩${Math.round(oldRevenue).toLocaleString()} → 신규 ₩${Math.round(newRevenue).toLocaleString()}). ` +
              `백필은 수량·옵션정보만 채워야 하며 실적 매출은 동일해야 합니다. 파일을 확인하세요.`,
          );
        }
        const ok = window.confirm(
          `백필(캠페인 실적 교체) — ${name}\n` +
            `기존 ${oldCount.toLocaleString()}건 · 총매출 ₩${Math.round(oldRevenue).toLocaleString()}\n` +
            `신규 ${parsed.rows.length.toLocaleString()}건 · 총매출 ₩${Math.round(newRevenue).toLocaleString()}\n` +
            `매출 차이 ₩${Math.round(delta).toLocaleString()} (${deltaPct.toFixed(1)}%)\n\n` +
            `이 캠페인의 기존 실적을 삭제하고 교체합니다. 확정 플랜(frozen)은 그대로 보존됩니다.\n` +
            `진행할까요? (취소 시 중단 — 중복 캠페인을 만들지 않습니다)`,
        );
        if (!ok) {
          setP({ phase: "idle", message: "취소됨" });
          return;
        }

        setP({ phase: "uploading", message: "상품 매칭 중…" });
        const productMap = await products.ensureProducts(
          supabase,
          parsed.rows.map((r) => r.base_name),
        );

        setP({ phase: "uploading", message: `기존 실적 ${oldCount.toLocaleString()}행 삭제 중…` });
        const { error: delErr } = await supabase
          .from("promotion_sales")
          .delete()
          .eq("promotion_id", existing.id);
        if (delErr) throw delErr;

        const records = buildRecords(existing.id, productMap);
        const batches = products.chunk(records, 1000);
        let done = 0;
        for (const [i, batch] of batches.entries()) {
          setP({
            phase: "uploading",
            message: `${i + 1}/${batches.length} 배치 적재 중…`,
            done,
            total: records.length,
          });
          const { error } = await supabase.from("promotion_sales").insert(batch);
          if (error) throw error;
          done += batch.length;
        }

        await logUpload(supabase, {
          kind: "promotion",
          source_file: file.name,
          detail: `${name} · 실적 교체`,
          row_count: done,
          total_revenue: newRevenue,
          action: "replace",
        });
        setP({ phase: "ok", message: `${name} 실적 백필 완료 · ${done}행. 상세로 이동합니다…` });
        router.push(`/promotions/${existing.id}`);
        return;
      }

      // 신규 캠페인 생성 (기존 동작)
      setP({ phase: "uploading", message: "상품 매칭 중…" });
      const productMap = await products.ensureProducts(
        supabase,
        parsed.rows.map((r) => r.base_name),
      );

      // 시즌 마스터 + 이름·기간으로 시즌성 자동 추정
      const { inferSeasonality } = await import("@/lib/season");
      const { data: seasonRows } = await supabase
        .from("seasonalities")
        .select("name")
        .order("sort");
      const seasonNames = (seasonRows ?? []).map((r) => r.name as string);
      const season_tag = inferSeasonality(name, parsed.start_date, seasonNames);

      setP({ phase: "uploading", message: "캠페인 생성 중…" });
      const { data: promo, error: pErr } = await supabase
        .from("promotions")
        .insert({
          name,
          code,
          start_date: parsed.start_date,
          end_date: parsed.end_date,
          season_tag,
        })
        .select("id")
        .single();
      if (pErr) throw pErr;

      const records = buildRecords(promo.id, productMap);

      const batches = products.chunk(records, 1000);
      let done = 0;
      for (const [i, batch] of batches.entries()) {
        setP({
          phase: "uploading",
          message: `${i + 1}/${batches.length} 배치 적재 중…`,
          done,
          total: records.length,
        });
        const { error } = await supabase.from("promotion_sales").insert(batch);
        if (error) throw error;
        done += batch.length;
      }

      await logUpload(supabase, {
        kind: "promotion",
        source_file: file.name,
        detail: `${name} · ${parsed.start_date}~${parsed.end_date} · 신규`,
        row_count: done,
        total_revenue: newRevenue,
        action: "insert",
      });
      setP({ phase: "ok", message: `${name} 생성 완료 · ${done}행. 상세로 이동합니다…` });
      router.push(`/promotions/${promo.id}/edit`);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e && "message" in e
            ? String((e as { message: unknown }).message)
            : "임포트 실패";
      setP({ phase: "error", message: msg });
    }
  }

  const pctVal =
    p.total && p.total > 0 && p.done != null ? Math.round((p.done / p.total) * 100) : null;

  return (
    <div className="rounded-[24px] bg-white card-soft p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{def.title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{def.desc}</p>
        </div>
        <label
          className={`shrink-0 cursor-pointer rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 ${
            p.phase === "reading" || p.phase === "parsing" || p.phase === "uploading"
              ? "pointer-events-none opacity-50"
              : ""
          }`}
        >
          파일 선택
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {p.phase !== "idle" && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            p.phase === "error"
              ? "bg-red-50 text-red-700"
              : p.phase === "ok"
                ? "bg-green-50 text-green-700"
                : "bg-neutral-100 text-neutral-600"
          }`}
        >
          <div>{p.message}</div>
          {pctVal != null && p.phase === "uploading" && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/60">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${pctVal}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ④ 가격 마스터 (S1) — 워크북 1개에서 품목 + 가격가이드 두 시트를 적재
// ─────────────────────────────────────────────

type Skip = { reason: string; count: number };

type CostLookup = {
  cost: number | null;
  consumer_price: number | null;
  regular_price: number | null;
};

type PMPreview = {
  itemCount: number;
  configCount: number;
  matchedConfigCount: number | null; // 적재 시 산출 (미리보기 단계는 null)
  itemSkipped: Skip[];
  guideSkipped: Skip[];
  unmatched: number; // 가격가이드 행 중 품목 매칭 실패
  sample: ParsedPriceConfig[];
  mult: number;
};

// 예정값 시트 — 현재 마스터로 적재하면 안 됨 (그린푸드=원가 변경예정, 가격인상=8월초 인상예정)
const FUTURE_SHEET_MARKERS = ["인상", "인하", "예정", "그린푸드"];

function isFutureSheet(name: string): boolean {
  const n = name.replace(/\s+/g, "");
  return FUTURE_SHEET_MARKERS.some((m) => n.includes(m));
}

/** 예정 시트를 제외하고, prefer 키워드를 순서대로 만족하는 첫 시트를 기본값으로 */
function pickDefaultSheet(sheets: string[], prefer: string[]): string {
  const current = sheets.filter((s) => !isFutureSheet(s));
  for (const k of prefer) {
    const hit = current.find((s) => s.replace(/\s+/g, "").includes(k));
    if (hit) return hit;
  }
  return current[0] ?? sheets[0] ?? "";
}

/** 현재 rate card에서 공헌이익 승수 mult = 1 − (수수료+광고+물류+적립) 산출 */
async function fetchMult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<number> {
  const { data } = await supabase
    .from("rate_card")
    .select("fee_rate, ad_rate, logistics_rate, reward_rate")
    .eq("is_current", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return 0.715;
  const sum =
    Number(data.fee_rate) +
    Number(data.ad_rate) +
    Number(data.logistics_rate) +
    Number(data.reward_rate);
  return 1 - sum;
}

function PriceMasterCard() {
  const bufRef = useRef<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [sheets, setSheets] = useState<string[]>([]);
  const [itemSheet, setItemSheet] = useState<string>("");
  const [guideSheet, setGuideSheet] = useState<string>("");
  const [preview, setPreview] = useState<PMPreview | null>(null);
  const [p, setP] = useState<Progress>({ phase: "idle", message: "" });

  const busy =
    p.phase === "reading" || p.phase === "parsing" || p.phase === "uploading";

  async function handleFile(file: File) {
    try {
      setPreview(null);
      setP({ phase: "reading", message: `${file.name} 읽는 중…` });
      const buf = await file.arrayBuffer();
      bufRef.current = buf;
      setFileName(file.name);
      const parse = await import("@/lib/parse");
      const names = parse.sheetNames(buf);
      setSheets(names);
      setItemSheet(pickDefaultSheet(names, ["품목"]));
      setGuideSheet(pickDefaultSheet(names, ["가격가이드", "가이드", "가격"]));
      setP({
        phase: "idle",
        message: "",
      });
    } catch (e) {
      setP({ phase: "error", message: errMsg(e) });
    }
  }

  async function handlePreview() {
    if (!bufRef.current) return;
    try {
      setP({ phase: "parsing", message: "엑셀 파싱 중 (미리보기)…" });
      const parse = await import("@/lib/parse");
      const supabase = createClient();
      const mult = await fetchMult(supabase);
      const wb = parse.readWorkbook(bufRef.current);
      const item = parse.parseItemMaster(wb, itemSheet);
      const lookup = new Map<string, CostLookup>(
        item.rows
          .filter((r) => r.dr_code)
          .map((r): [string, CostLookup] => [
            r.dr_code as string,
            {
              cost: r.cost,
              consumer_price: r.consumer_price,
              regular_price: r.regular_price,
            },
          ]),
      );
      const guide = parse.parsePriceGuide(wb, guideSheet, { mult, lookup });
      setPreview({
        itemCount: item.rows.length,
        configCount: guide.configs.length,
        matchedConfigCount: null,
        itemSkipped: item.skipped,
        guideSkipped: guide.skipped,
        unmatched: 0,
        sample: guide.configs.slice(0, 10),
        mult,
      });
      setP({ phase: "idle", message: "" });
    } catch (e) {
      setP({ phase: "error", message: errMsg(e) });
    }
  }

  async function handleLoad() {
    if (!bufRef.current) return;
    if (isFutureSheet(itemSheet) || isFutureSheet(guideSheet)) {
      const bad = [itemSheet, guideSheet].filter(isFutureSheet).join(", ");
      const ok = window.confirm(
        `선택한 시트(${bad})는 '예정값'(원가 변경·가격 인상 예정)으로 보입니다.\n` +
          `현재 가격 마스터로 적재하면 안 됩니다. 그래도 진행할까요?`,
      );
      if (!ok) {
        setP({ phase: "idle", message: "취소됨" });
        return;
      }
    }
    try {
      const parse = await import("@/lib/parse");
      const products = await import("@/lib/products");
      const supabase = createClient();
      const mult = await fetchMult(supabase);
      const wb = parse.readWorkbook(bufRef.current);

      setP({ phase: "parsing", message: "엑셀 파싱 중…" });
      const item = parse.parseItemMaster(wb, itemSheet);
      const lookup = new Map<string, CostLookup>(
        item.rows
          .filter((r) => r.dr_code)
          .map((r): [string, CostLookup] => [
            r.dr_code as string,
            {
              cost: r.cost,
              consumer_price: r.consumer_price,
              regular_price: r.regular_price,
            },
          ]),
      );
      const guide = parse.parsePriceGuide(wb, guideSheet, { mult, lookup });
      if (item.rows.length === 0 && guide.configs.length === 0)
        throw new Error("적재할 품목·구성이 없습니다. 시트 지정을 확인하세요.");

      // 1) 품목 upsert (base_name 고유키 — 기존 인프라 재사용, dr_code/원가/가격은 필드로 갱신)
      setP({ phase: "uploading", message: `품목 ${item.rows.length}건 반영 중…` });
      const itemPayload = dedupBy(item.rows, (r) => r.base_name).map((r) => ({
        base_name: r.base_name,
        dr_code: r.dr_code,
        cost: r.cost,
        cost_vat_excluded: r.cost_vat_excluded,
        consumer_price: r.consumer_price,
        regular_price: r.regular_price,
      }));
      if (itemPayload.length > 0) {
        const { error } = await supabase
          .from("products")
          .upsert(itemPayload, { onConflict: "base_name" });
        if (error) throw error;
      }

      // 2) 전체 products 로드 → dr_code/base_name 으로 product_id 해석 맵
      const { data: allProducts, error: pErr } = await supabase
        .from("products")
        .select("id, base_name, dr_code");
      if (pErr) throw pErr;
      const byDr = new Map<string, { id: string; base_name: string }>();
      const byBase = new Map<string, { id: string; base_name: string }>();
      for (const pr of allProducts ?? []) {
        const v = { id: pr.id as string, base_name: pr.base_name as string };
        if (pr.dr_code) byDr.set(pr.dr_code as string, v);
        byBase.set(pr.base_name as string, v);
      }

      // 3) 카테고리 갱신 (가격가이드 시트 → products.category, 기존 품목만)
      const catByDr = new Map<string, string>();
      const catByBase = new Map<string, string>();
      for (const c of guide.categories) {
        if (c.dr_code) catByDr.set(c.dr_code, c.category);
        if (c.base_name) catByBase.set(c.base_name, c.category);
      }
      const catPayload: { base_name: string; category: string }[] = [];
      for (const pr of allProducts ?? []) {
        const cat =
          (pr.dr_code && catByDr.get(pr.dr_code as string)) ||
          catByBase.get(pr.base_name as string);
        if (cat) catPayload.push({ base_name: pr.base_name as string, category: cat });
      }
      if (catPayload.length > 0) {
        const { error } = await supabase
          .from("products")
          .upsert(catPayload, { onConflict: "base_name" });
        if (error) throw error;
      }

      // 4) configs: product_id 해석 + (product_id, config_type) 중복 제거
      const recMap = new Map<
        string,
        {
          product_id: string;
          base_name: string;
          config_type: string;
          pack_count: number;
          free_shipping: boolean;
          list_price: number | null;
          sale_price: number;
          discount_rate_consumer: number | null;
          discount_rate_regular: number | null;
          unit_cost_total: number | null;
          contribution: number | null;
          contribution_rate: number | null;
          source_file: string;
        }
      >();
      let unmatched = 0;
      for (const c of guide.configs) {
        const match =
          (c.dr_code && byDr.get(c.dr_code)) ||
          (c.base_name && byBase.get(c.base_name)) ||
          null;
        if (!match) {
          unmatched++;
          continue;
        }
        const key = `${match.id}::${c.config_type}`;
        recMap.set(key, {
          product_id: match.id,
          base_name: match.base_name,
          config_type: c.config_type,
          pack_count: c.pack_count,
          free_shipping: c.free_shipping,
          list_price: c.list_price,
          sale_price: c.sale_price,
          discount_rate_consumer: c.discount_rate_consumer,
          discount_rate_regular: c.discount_rate_regular,
          unit_cost_total: c.unit_cost_total,
          contribution: c.contribution,
          contribution_rate: c.contribution_rate,
          source_file: fileName,
        });
      }
      const records = [...recMap.values()];

      // 5) 다른 source_file 의 기존 구성 존재 시 경고 (PR #27 confirm 패턴)
      const { count: otherCount } = await supabase
        .from("product_price_configs")
        .select("*", { count: "exact", head: true })
        .neq("source_file", fileName);
      if (otherCount && otherCount > 0) {
        const ok = window.confirm(
          `다른 파일에서 적재된 가격 구성이 ${otherCount.toLocaleString()}건 있어요.\n` +
            `같은 (품목 × 구성)은 이번 값으로 덮어써집니다.\n\n그래도 진행할까요?`,
        );
        if (!ok) {
          setP({ phase: "idle", message: "취소됨" });
          return;
        }
      }

      // 6) upsert by (product_id, config_type)
      const batches = products.chunk(records, 500);
      let done = 0;
      for (const [i, batch] of batches.entries()) {
        setP({
          phase: "uploading",
          message: `구성 ${i + 1}/${batches.length} 배치 적재 중…`,
          done,
          total: records.length,
        });
        const { error } = await supabase
          .from("product_price_configs")
          .upsert(batch, { onConflict: "product_id,config_type" });
        if (error) throw error;
        done += batch.length;
      }

      await logUpload(supabase, {
        kind: "price_master",
        source_file: fileName,
        detail: `품목 ${itemPayload.length}건 · 구성 ${records.length}건${unmatched > 0 ? ` · 매칭실패 ${unmatched}` : ""}`,
        row_count: records.length,
        action: "replace",
      });
      setPreview((prev) =>
        prev ? { ...prev, matchedConfigCount: records.length, unmatched } : prev,
      );
      setP({
        phase: "ok",
        message:
          `품목 ${itemPayload.length}건 · 구성 ${records.length}건 반영 완료` +
          (unmatched > 0 ? ` · 품목 매칭 실패 ${unmatched}건(skip)` : ""),
      });
    } catch (e) {
      setP({ phase: "error", message: errMsg(e) });
    }
  }

  const pctVal =
    p.total && p.total > 0 && p.done != null
      ? Math.round((p.done / p.total) * 100)
      : null;

  return (
    <div className="rounded-[24px] bg-white card-soft p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">④ 가격 마스터 (가격가이드 워크북)</h2>
          <p className="mt-1 text-sm text-neutral-500">
            품목 시트 + 가격가이드 시트를 한 번에 적재합니다. SKU × 구성(단품/2·3·4·5묶음)별
            할인율·공헌이익은 rate card로 자동 계산합니다. 재업로드 시 중복 없이 갱신됩니다.
          </p>
        </div>
        <label
          className={`shrink-0 cursor-pointer rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 ${
            busy ? "pointer-events-none opacity-50" : ""
          }`}
        >
          파일 선택
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {sheets.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-neutral-500">품목 시트</span>
            <select
              className="mt-1 w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-sm"
              value={itemSheet}
              onChange={(e) => setItemSheet(e.target.value)}
              disabled={busy}
            >
              {sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-neutral-500">가격가이드 시트</span>
            <select
              className="mt-1 w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-sm"
              value={guideSheet}
              onChange={(e) => setGuideSheet(e.target.value)}
              disabled={busy}
            >
              {sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {sheets.some(isFutureSheet) && (
        <p className="mt-2 text-xs text-amber-600">
          예정값 시트(적재 금지):{" "}
          <b>{sheets.filter(isFutureSheet).join(", ")}</b> — 원가 변경·가격 인상 예정분이라
          현재 가격 마스터로 적재하지 마세요.
        </p>
      )}
      {(isFutureSheet(itemSheet) || isFutureSheet(guideSheet)) && (
        <p className="mt-1 text-xs font-medium text-red-600">
          ⚠️ 지금 예정값 시트가 선택돼 있습니다. 현재값 시트(예: 가격가이드_2026)로 바꿔주세요.
        </p>
      )}

      {sheets.length > 0 && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handlePreview}
            disabled={busy || !itemSheet || !guideSheet}
            className="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            미리보기 (dry-run)
          </button>
          <button
            type="button"
            onClick={handleLoad}
            disabled={busy || !preview}
            className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            적재
          </button>
        </div>
      )}

      {preview && (
        <div className="mt-4 rounded-xl border border-neutral-200 p-3 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-neutral-700">
            <span>
              품목 <b>{preview.itemCount.toLocaleString()}</b>건
            </span>
            <span>
              구성 <b>{preview.configCount.toLocaleString()}</b>건
            </span>
            {preview.matchedConfigCount != null && (
              <span>
                적재 <b>{preview.matchedConfigCount.toLocaleString()}</b>건
              </span>
            )}
            <span className="text-neutral-400">
              공헌이익 승수 mult = {preview.mult.toFixed(3)}
            </span>
          </div>
          {(preview.itemSkipped.length > 0 || preview.guideSkipped.length > 0) && (
            <div className="mt-1.5 text-xs text-amber-600">
              {[...preview.itemSkipped, ...preview.guideSkipped]
                .map((s) => `${s.reason} ${s.count}건`)
                .join(" · ")}
            </div>
          )}
          {preview.sample.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-neutral-400">
                  <tr>
                    <th className="py-1 pr-3">품목</th>
                    <th className="py-1 pr-3">구성</th>
                    <th className="py-1 pr-3 text-right">판매가</th>
                    <th className="py-1 pr-3 text-right">정가</th>
                    <th className="py-1 pr-3 text-right">할인(소비자)</th>
                    <th className="py-1 pr-3 text-right">할인(상시)</th>
                    <th className="py-1 pr-3 text-right">공헌이익</th>
                    <th className="py-1 text-right">공헌이익률</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((c, i) => (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="py-1 pr-3">{c.base_name ?? c.dr_code ?? "—"}</td>
                      <td className="py-1 pr-3">
                        {c.config_type}
                        {c.free_shipping && (
                          <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-700">
                            무배
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3 text-right">{won(c.sale_price)}</td>
                      <td className="py-1 pr-3 text-right">{won(c.list_price)}</td>
                      <td className="py-1 pr-3 text-right">
                        {pct(c.discount_rate_consumer)}
                      </td>
                      <td className="py-1 pr-3 text-right">
                        {pct(c.discount_rate_regular)}
                      </td>
                      <td className="py-1 pr-3 text-right">{won(c.contribution)}</td>
                      <td className="py-1 text-right">{pct(c.contribution_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1.5 text-[11px] text-neutral-400">
                상위 {preview.sample.length}행 미리보기. 매핑·건수를 확인한 뒤 [적재]를 누르세요.
              </p>
            </div>
          )}
        </div>
      )}

      {p.phase !== "idle" && p.message && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            p.phase === "error"
              ? "bg-red-50 text-red-700"
              : p.phase === "ok"
                ? "bg-green-50 text-green-700"
                : "bg-neutral-100 text-neutral-600"
          }`}
        >
          <div>{p.message}</div>
          {pctVal != null && p.phase === "uploading" && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/60">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${pctVal}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ⑤ 캠페인 플랜 가이드 — 표준 양식(평평한 표) → 캠페인 플랜(예상) 적재.
//    가이드는 '실적 가설'(옵션·가격·예상 수량/매출/공헌이익). 실적은 ③, 차이는 달성률(S4).
//    미리보기 → 검수 → draft 플랜 생성/교체. 확정(frozen) 플랜은 보존.
// ─────────────────────────────────────────────
function PlanGuideImportCard() {
  const router = useRouter();
  const [p, setP] = useState<Progress>({ phase: "idle", message: "" });
  const [camps, setCamps] = useState<
    import("@/lib/parsePlanGuide").PlanGuideCampaign[] | null
  >(null);

  async function handleFile(file: File) {
    try {
      setCamps(null);
      setP({ phase: "reading", message: `${file.name} 읽는 중…` });
      const buf = await file.arrayBuffer();
      setP({ phase: "parsing", message: "플랜 가이드 파싱 중…" });
      const { parsePlanGuide } = await import("@/lib/parsePlanGuide");
      const found = parsePlanGuide(buf);
      if (found.length === 0)
        throw new Error("표준 양식에서 캠페인을 찾지 못했습니다. 템플릿 컬럼을 확인하세요.");
      setCamps(found);
      setP({
        phase: "ok",
        message: `${found.length}개 캠페인 · 옵션 ${found.reduce((s, c) => s + c.options.length, 0)}개 인식. 확인 후 [플랜으로 적재]`,
      });
    } catch (e) {
      setP({ phase: "error", message: errMsg(e) });
    }
  }

  async function commit() {
    if (!camps) return;
    const ok = window.confirm(
      `${camps.length}개 캠페인의 플랜(예상)을 적재합니다.\n` +
        `· 코드로 캠페인을 찾고 없으면 생성\n` +
        `· draft 플랜은 교체, 확정(frozen) 플랜은 보존(건너뜀)\n` +
        `· 실적/달성률은 ③ 매출 export로 별도 채웁니다\n\n진행할까요?`,
    );
    if (!ok) return;
    try {
      const supabase = createClient();
      const productsLib = await import("@/lib/products");
      setP({ phase: "uploading", message: "품목 매칭 중…" });

      const allOptions = camps.flatMap((c) => c.options);
      const itemCodes = [...new Set(allOptions.map((o) => o.item_code).filter(Boolean))];
      const byDr = new Map<string, { id: string; base_name: string }>();
      if (itemCodes.length > 0) {
        const { data } = await supabase
          .from("products")
          .select("id, dr_code, base_name")
          .in("dr_code", itemCodes);
        for (const pr of data ?? [])
          if (pr.dr_code)
            byDr.set(String(pr.dr_code), { id: pr.id as string, base_name: pr.base_name as string });
      }
      const needNames = [
        ...new Set(
          allOptions
            .filter((o) => !(o.item_code && byDr.has(o.item_code)))
            .map((o) => o.option_label),
        ),
      ];
      const byName =
        needNames.length > 0
          ? await productsLib.ensureProducts(supabase, needNames)
          : new Map<string, string>();
      const resolve = (o: (typeof allOptions)[number]) => {
        if (o.item_code && byDr.has(o.item_code)) {
          const m = byDr.get(o.item_code)!;
          return { product_id: m.id, base_name: m.base_name };
        }
        const id = byName.get(o.option_label);
        return id ? { product_id: id, base_name: o.option_label } : null;
      };

      let created = 0,
        replaced = 0,
        skipped = 0,
        failed = 0;
      for (const [ci, camp] of camps.entries()) {
        setP({ phase: "uploading", message: `${ci + 1}/${camps.length} 캠페인 플랜 적재 중…` });
        try {
          // 캠페인 매칭/생성
          let promoId: string;
          const { data: ep } = await supabase
            .from("promotions")
            .select("id")
            .eq("code", camp.code)
            .limit(1)
            .maybeSingle();
          if (ep) promoId = ep.id as string;
          else {
            const { data: np, error } = await supabase
              .from("promotions")
              .insert({
                name: camp.code,
                code: camp.code,
                start_date: camp.start_date,
                end_date: camp.end_date,
              })
              .select("id")
              .single();
            if (error) throw error;
            promoId = np.id as string;
          }

          // 현재 플랜
          const { data: plan } = await supabase
            .from("campaign_plans")
            .select("id, status")
            .eq("promotion_id", promoId)
            .eq("is_current", true)
            .maybeSingle();
          if (plan?.status === "confirmed") {
            skipped++;
            continue; // 확정 플랜 보존
          }
          let planId: string;
          if (plan) {
            planId = plan.id as string;
            await supabase.from("campaign_plan_options").delete().eq("campaign_plan_id", planId);
            replaced++;
          } else {
            const { data: npl, error } = await supabase
              .from("campaign_plans")
              .insert({ promotion_id: promoId, version: 1, is_current: true, status: "draft" })
              .select("id")
              .single();
            if (error) throw error;
            planId = npl.id as string;
            created++;
          }

          let revTotal = 0,
            contribTotal = 0;
          for (const [idx, o] of camp.options.entries()) {
            const prod = resolve(o);
            if (!prod) {
              failed++;
              continue;
            }
            revTotal += o.target_revenue;
            contribTotal += o.contribution;
            const { data: newOpt, error: oErr } = await supabase
              .from("campaign_plan_options")
              .insert({
                campaign_plan_id: planId,
                option_label: o.option_label,
                expected_option_qty: o.expected_qty,
                is_main: o.is_main,
                // 옵션 라벨을 매칭 패턴 기본값으로 — 실적 option_info 와 부분일치 자동 시도
                match_patterns: [o.option_label],
                sort: idx,
                set_price: o.set_price,
                // 소비자가/상시가는 이미 번들(개입수 반영) 합계 → 그대로
                consumer_total: o.consumer_price > 0 ? o.consumer_price : null,
                regular_total: o.regular_price > 0 ? o.regular_price : null,
                discount_rate_consumer: o.discount_consumer,
                discount_rate_regular: o.discount_regular,
                expected_revenue: o.target_revenue, // 폼 그대로
                expected_contribution: o.contribution, // 폼 그대로
                econ: {
                  총원가: o.total_cost,
                  물류비: o.logistics,
                  수수료: o.fee,
                  광고비: o.ad_cost,
                  공헌이익률: o.contribution_rate,
                  프로모션가: o.promo_price,
                  쿠폰혜택가: o.coupon_price,
                },
              })
              .select("id")
              .single();
            if (oErr) throw oErr;
            const { error: iErr } = await supabase.from("campaign_plan_option_items").insert({
              campaign_plan_option_id: newOpt.id,
              product_id: prod.product_id,
              base_name: prod.base_name,
              sku_qty_per_option: o.pack_count,
              // set_price는 번들 합계 → SKU 단가로 환산
              unit_sale_price: o.pack_count > 0 ? o.set_price / o.pack_count : o.set_price,
              sort: 0,
            });
            if (iErr) throw iErr;
          }
          await supabase
            .from("campaign_plans")
            .update({
              expected_revenue_total: revTotal,
              expected_contribution_total: contribTotal,
              updated_at: new Date().toISOString(),
            })
            .eq("id", planId);
        } catch {
          failed++;
        }
      }

      await logUpload(supabase, {
        kind: "plan_guide",
        source_file: "캠페인 플랜 가이드",
        detail: `생성 ${created} · 교체 ${replaced} · 확정보존 ${skipped}${failed ? ` · 실패 ${failed}` : ""}`,
        row_count: allOptions.length,
        action: "replace",
      });
      setP({
        phase: "ok",
        message: `플랜 적재 완료 · 생성 ${created} · 교체 ${replaced} · 확정보존(건너뜀) ${skipped}${failed ? ` · 실패 ${failed}` : ""}`,
      });
      setCamps(null);
      router.refresh();
    } catch (e) {
      setP({ phase: "error", message: errMsg(e) });
    }
  }

  const busy = p.phase === "reading" || p.phase === "parsing" || p.phase === "uploading";

  return (
    <div className="rounded-[24px] bg-white card-soft p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">⑤ 캠페인 플랜 가이드 (예상 적재)</h2>
          <p className="mt-1 text-sm text-neutral-500">
            표준 양식(1행=옵션)으로 캠페인별 <b>예상(가설)</b> — 옵션·가격·예상수량·목표매출·공헌이익을
            플랜으로 적재합니다. 실제 결과는 ③ 매출 export, 차이는 <b>달성률</b>로 비교돼요. 확정 플랜은
            보존됩니다.{" "}
            <a
              href="/templates/campaign_plan_guide_template.csv"
              download
              className="text-brand-600 underline"
            >
              표준 템플릿 내려받기
            </a>
          </p>
        </div>
        <label
          className={`shrink-0 cursor-pointer rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 ${
            busy ? "pointer-events-none opacity-50" : ""
          }`}
        >
          파일 선택
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {p.phase !== "idle" && p.message && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            p.phase === "error"
              ? "bg-red-50 text-red-700"
              : p.phase === "ok"
                ? "bg-green-50 text-green-700"
                : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {p.message}
        </div>
      )}

      {camps && camps.length > 0 && (
        <div className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-neutral-400">
                <tr>
                  <th className="py-1.5 pr-3">코드</th>
                  <th className="py-1.5 pr-3">기간</th>
                  <th className="py-1.5 pr-3 text-right">옵션수</th>
                  <th className="py-1.5 pr-3 text-right">메인</th>
                  <th className="py-1.5 pr-3 text-right">Σ예상수량</th>
                  <th className="py-1.5 text-right">Σ목표매출</th>
                </tr>
              </thead>
              <tbody>
                {camps.map((c) => (
                  <tr key={c.code} className="border-t border-neutral-100">
                    <td className="py-1.5 pr-3 font-medium text-neutral-800">{c.code}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-neutral-500">
                      {c.start_date ?? "?"}
                      {c.end_date ? ` ~ ${c.end_date}` : ""}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.options.length}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.main_count}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {c.total_qty.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{won(c.total_target_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={commit}
              disabled={busy}
              className="rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              플랜으로 적재
            </button>
            <span className="text-[11px] text-neutral-400">
              메인 = 상시가 할인율 ≥ 15%. 개입수는 옵션명에서 추정합니다.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : "임포트 실패";
}

function dedupBy<T>(arr: T[], key: (t: T) => string): T[] {
  const m = new Map<string, T>();
  for (const it of arr) m.set(key(it), it);
  return [...m.values()];
}
