"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    desc: "일자 × 기초상품 × 옵션 × 결제금액 × 수량. baseline(평소 매출)의 연료입니다.",
  },
  {
    key: "promotion",
    title: "③ 캠페인 시트",
    desc: "캠페인 기간 실적(전 제품). 업로드하면 캠페인이 생성되고 상세로 이동합니다.",
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
        setP({ phase: "ok", message: `${rows.length}개 품목 반영 완료` });
        return;
      }

      if (def.key === "daily") {
        const rows = parse.parseDailySales(buf);
        if (rows.length === 0) throw new Error("유효한 행이 없습니다.");

        setP({ phase: "uploading", message: `상품 매칭 중… (${rows.length}행)` });
        const productMap = await products.ensureProducts(
          supabase,
          rows.map((r) => r.base_name),
        );

        // 충돌 키(sale_date·base_name·option_info)로 사전 중복 제거 — 후순위 우선(합산).
        // 같은 키가 한 배치에 두 번 들어가면 Postgres upsert가 실패하므로 방어.
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
            // 동일 키가 여러 행으로 분리돼 있으면 합산(옵션 컬럼 없는 파일 대비)
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

      setP({ phase: "uploading", message: "상품 매칭 중…" });
      const productMap = await products.ensureProducts(
        supabase,
        parsed.rows.map((r) => r.base_name),
      );

      const rawName = file.name.replace(/\.(xlsx|xls|csv)$/i, "");
      const code = parse.extractPromoCode(rawName);
      const name = code ? rawName.slice(rawName.indexOf(code)) : rawName;

      setP({ phase: "uploading", message: "캠페인 생성 중…" });
      const { data: promo, error: pErr } = await supabase
        .from("promotions")
        .insert({
          name,
          code,
          start_date: parsed.start_date,
          end_date: parsed.end_date,
        })
        .select("id")
        .single();
      if (pErr) throw pErr;

      const records = parsed.rows.map((r) => ({
        promotion_id: promo.id,
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

  const pct =
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
          {pct != null && p.phase === "uploading" && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/60">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
