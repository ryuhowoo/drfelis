"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useReplaceConfirm } from "./useReplaceConfirm";
import PlanGuideList from "./PlanGuideList";
import CardHistory from "./CardHistory";

// 업로드 이력 기록 — 연동 파일명·시간·종류·행수를 남긴다(업데이트 참고용).
// 실패해도 업로드 자체를 막지 않는다(best-effort).
async function logUpload(
  supabase: ReturnType<typeof createClient>,
  entry: {
    kind: "daily" | "promotion" | "price_master" | "plan_guide" | "segment";
    source_file: string;
    detail?: string;
    row_count?: number;
    total_revenue?: number | null;
    action?: "insert" | "replace";
    codes?: string[]; // 영향받은 캠페인 코드 — 캠페인 상세 '데이터 출처' 역추적용 (R1.3)
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
  try {
    // 롤업 프리웜 (R1.1): 업로드 직후 재계산해 다음 페이지 조회를 즉시 로딩으로.
    // 실패해도 무시 — 트리거 dirty 플래그 + 읽기 시점 ensure가 안전망.
    await supabase.rpc("refresh_rollups");
  } catch {
    /* 프리웜 실패는 무시 */
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
    key: "daily",
    title: "일별 전체 매출",
    desc: "모든 B2C 채널 합본을 한 번에 올리면 채널별로 분해해 적재합니다(일자 × 기초상품 × 옵션 × 채널 × 결제금액 × 수량). baseline(평소 매출)과 캠페인 시점 비교의 연료입니다. 재업로드 시 같은 기간·상품을 교체합니다(누적 아님).",
  },
];

export default function UploadPage() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">데이터 관리</h1>
      <p className="mt-1 text-sm text-neutral-500">
        엑셀(.xlsx) 파일을 올리면 헤더 이름으로 자동 인식합니다.
        파싱·적재 모두 브라우저에서 진행하므로 큰 파일도 안정적으로 처리됩니다.
      </p>
      <div className="mt-6 grid gap-4">
        {CARDS.map((c) => (
          <UploadCard key={c.key} def={c} />
        ))}
        <PlanGuideList />
      </div>
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
  const { confirm, element: replaceDialog } = useReplaceConfirm();

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

        let oldRevenue = 0;
        if (oldCount && oldCount > 0) {
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
        }

        // 상품 매칭 + 레코드 빌드 (DB 변경 전 — 미리보기에 매칭 통계 포함)
        setP({ phase: "uploading", message: `상품 매칭 중… (${rows.length}행)` });
        const productMap = await products.ensureProducts(
          supabase,
          rows.map((r) => r.base_name),
        );
        const dedup = new Map<
          string,
          { sale_date: string; product_id: string | null; base_name: string; option_info: string; channel: string; revenue: number; quantity: number; source_file: string }
        >();
        for (const r of rows) {
          const key = JSON.stringify([r.sale_date, r.base_name, r.option_info, r.channel]);
          const prev = dedup.get(key);
          dedup.set(key, {
            sale_date: r.sale_date,
            product_id: productMap.get(r.base_name) ?? null,
            base_name: r.base_name,
            option_info: r.option_info,
            channel: r.channel,
            revenue: (prev?.revenue ?? 0) + r.revenue,
            quantity: (prev?.quantity ?? 0) + r.quantity,
            source_file: file.name,
          });
        }
        const records = [...dedup.values()];

        // 교체 검토 (DB 변경 전 영향 확인) — window.confirm 대신 앱 내부 dialog
        if (oldCount && oldCount > 0) {
          const ok = await confirm({
            title: "일별 매출 — 같은 기간·상품 교체",
            period: `${minDate} ~ ${maxDate}`,
            oldCount,
            oldRevenue,
            newCount: records.length,
            newRevenue,
            matchedSkus: productMap.size,
            totalSkus: baseNamesList.length,
            note: "교환·환불·취소 반영 — 최신 파일을 기준으로 같은 기간·상품을 교체합니다(누적 아님). 삭제+삽입이 한 번에(원자적) 처리되어 부분 반영이 없습니다.",
          });
          if (!ok) {
            setP({ phase: "idle", message: "취소됨" });
            return;
          }
        }

        // 원자적 교체 (삭제+삽입 한 트랜잭션 — 부분 반영 불가)
        setP({
          phase: "uploading",
          message: `최신 파일로 교체 중… (${records.length}행)`,
          done: 0,
          total: records.length,
        });
        const { data: inserted, error: rpcErr } = await supabase.rpc("replace_daily_sales", {
          p_min: minDate,
          p_max: maxDate,
          p_base_names: baseNamesList,
          p_rows: records,
        });
        if (rpcErr) throw rpcErr;
        const done = Number(inserted) || records.length;

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
          // N13 P2: 리치 export 선택 필드(없으면 null) — 구독 양성신호·번들 식별·재파생용
          order_type: r.order_type,
          sale_option_code: r.sale_option_code,
          raw: r.composition ? { composition: r.composition } : null,
        }));

      // 기존 캠페인 탐지 (코드 우선, 없으면 이름) — 있으면 N1 백필(성과 교체)
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
        // 백필: 이 캠페인의 기존 성과만 삭제 후 교체. 확정 플랜(frozen)·expected는 건드리지 않음.
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
        // 상품 매칭 + 레코드 빌드 (DB 변경 전 — 미리보기 매칭 통계)
        setP({ phase: "uploading", message: "상품 매칭 중…" });
        const productMap = await products.ensureProducts(
          supabase,
          parsed.rows.map((r) => r.base_name),
        );
        const records = buildRecords(existing.id, productMap);
        const totalSkus = new Set(parsed.rows.map((r) => r.base_name)).size;

        // 교체 검토 (DB 변경 전) — window.confirm 대신 앱 내부 dialog
        const ok = await confirm({
          title: `캠페인 성과 교체 — ${name}`,
          oldCount,
          oldRevenue,
          newCount: parsed.rows.length,
          newRevenue,
          matchedSkus: productMap.size,
          totalSkus,
          note: "이 캠페인의 기존 성과를 최신 파일로 교체합니다. 확정 플랜(frozen)·기대값은 보존됩니다. 삭제+삽입이 한 번에(원자적) 처리되어 부분 반영이 없습니다.",
        });
        if (!ok) {
          setP({ phase: "idle", message: "취소됨" });
          return;
        }

        // 원자적 교체 (삭제+삽입 한 트랜잭션 — pack_size 트리거 자동 채움)
        setP({
          phase: "uploading",
          message: `최신 파일로 교체 중… (${records.length}행)`,
          done: 0,
          total: records.length,
        });
        const { data: insertedN, error: rpcErr } = await supabase.rpc("replace_promotion_sales", {
          p_promotion_id: existing.id,
          p_rows: records,
        });
        if (rpcErr) throw rpcErr;
        const done = Number(insertedN) || records.length;

        await logUpload(supabase, {
          kind: "promotion",
          source_file: file.name,
          detail: `${name} · 성과 교체`,
          row_count: done,
          total_revenue: newRevenue,
          action: "replace",
          codes: code ? [code] : undefined,
        });
        setP({ phase: "ok", message: `${name} 성과 백필 완료 · ${done}행. 상세로 이동합니다…` });
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

      // N13: 성과옵션 구조화(시그니처/구독/매칭) — 신규 캠페인은 직접 insert라 명시 호출
      // (교체 경로는 replace_promotion_sales RPC가 내부에서 호출). 실패해도 적재는 유효.
      await supabase.rpc("rebuild_sale_options", { p_promotion_id: promo.id });

      await logUpload(supabase, {
        kind: "promotion",
        source_file: file.name,
        detail: `${name} · ${parsed.start_date}~${parsed.end_date} · 신규`,
        row_count: done,
        total_revenue: newRevenue,
        action: "insert",
        codes: code ? [code] : undefined,
      });
      setP({ phase: "ok", message: `${name} 생성 완료 · ${done}행. 상세로 이동합니다…` });
      router.push(`/promotions/${promo.id}`);
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
    <div className="rounded-2xl card-soft p-5">
      {replaceDialog}
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
      <CardHistory kinds={[def.key]} />
    </div>
  );
}
