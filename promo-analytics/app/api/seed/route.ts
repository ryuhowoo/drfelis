import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SEED_KEY = "felis-seed-2026";

type DailyFile = { cols: string[]; rows: [string, string, string, number, number][] };
type ProductSeed = {
  base_name: string;
  dr_code: string | null;
  cost: number | null;
  consumer_price: number | null;
  regular_price: number | null;
};
type PromoSeed = {
  name: string;
  code: string | null;
  start_date: string | null;
  end_date: string | null;
  sales: {
    base_name: string;
    option_info: string;
    revenue: number;
    order_count: number;
    aov: number;
    fee: number;
    cost: number;
    quantity: number;
  }[];
};

function originOf(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

async function loadJson<T>(req: Request, path: string): Promise<T> {
  const res = await fetch(`${originOf(req)}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 로드 실패 (${res.status})`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${path} 응답이 JSON이 아닙니다 (인증/경로 확인)`);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("key") !== SEED_KEY)
    return NextResponse.json({ error: "잘못된 키" }, { status: 403 });

  const phase = searchParams.get("phase");
  const supabase = await createClient();

  try {
    // ── 마스터 + 프로모션 ──
    if (phase === "master") {
      const products = await loadJson<ProductSeed[]>(req, "/seed/products.json");
      for (const b of chunk(products, 500)) {
        const { error } = await supabase
          .from("products")
          .upsert(b, { onConflict: "base_name" });
        if (error) throw error;
      }

      const { data: prods } = await supabase.from("products").select("id, base_name");
      const map = new Map((prods ?? []).map((p) => [p.base_name, p.id]));

      const promos = await loadJson<PromoSeed[]>(req, "/seed/promotions.json");
      let promoCount = 0;
      for (const p of promos) {
        if (!p.start_date || !p.end_date) continue;
        if (p.code)
          await supabase.from("promotions").delete().eq("code", p.code);
        else await supabase.from("promotions").delete().eq("name", p.name);

        const { data: ins, error: pErr } = await supabase
          .from("promotions")
          .insert({
            name: p.name,
            code: p.code,
            start_date: p.start_date,
            end_date: p.end_date,
          })
          .select("id")
          .single();
        if (pErr) throw pErr;

        const sales = p.sales.map((s) => ({
          promotion_id: ins.id,
          product_id: map.get(s.base_name) ?? null,
          base_name: s.base_name,
          option_info: s.option_info,
          revenue: s.revenue,
          order_count: s.order_count,
          aov: s.aov,
          fee: s.fee,
          cost: s.cost,
          quantity: s.quantity,
        }));
        for (const b of chunk(sales, 500)) {
          const { error } = await supabase.from("promotion_sales").insert(b);
          if (error) throw error;
        }
        promoCount++;
      }
      return NextResponse.json({
        ok: true,
        products: products.length,
        promotions: promoCount,
      });
    }

    // ── 일별 매출 (청크 단위) ──
    if (phase === "daily") {
      const idx = Number(searchParams.get("chunk") ?? "0");
      const file = await loadJson<DailyFile>(req, `/seed/daily-${idx}.json`);

      const { data: prods } = await supabase.from("products").select("id, base_name");
      const map = new Map((prods ?? []).map((p) => [p.base_name, p.id]));

      const records = file.rows.map((r) => ({
        sale_date: r[0],
        base_name: r[1],
        option_info: r[2] ?? "",
        revenue: r[3],
        quantity: r[4],
        product_id: map.get(r[1]) ?? null,
        source_file: "seed",
      }));
      for (const b of chunk(records, 2000)) {
        const { error } = await supabase
          .from("daily_sales")
          .upsert(b, { onConflict: "sale_date,base_name,option_info" });
        if (error) throw error;
      }
      return NextResponse.json({ ok: true, inserted: records.length });
    }

    return NextResponse.json({ error: "phase 누락" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "적재 실패" },
      { status: 500 },
    );
  }
}
