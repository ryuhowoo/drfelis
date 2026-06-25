import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

// 캠페인 플랜 / 성과 데이터를 엑셀로 내려받기 (업로드 페이지 ④ '캠페인 성과' 카드).
// 클라이언트에서 Supabase 조회 → 워크북 생성 → Blob 다운로드.

function safe(name: string): string {
  return (name || "campaign").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
}

function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 캠페인 확정/현재 플랜을 엑셀로 — 옵션 시트 + 구성(SKU) 시트. */
export async function downloadPlanXlsx(promotionId: string, campaignName: string) {
  const supabase = createClient();
  const { data: plan } = await supabase
    .from("campaign_plans")
    .select("id, status, version")
    .eq("promotion_id", promotionId)
    .eq("is_current", true)
    .maybeSingle();
  if (!plan) throw new Error("이 캠페인에 플랜이 없습니다.");

  const { data: options } = await supabase
    .from("campaign_plan_options")
    .select(
      "id, option_label, is_main, expected_option_qty, set_price, consumer_total, regular_total, discount_rate_consumer, discount_rate_regular, expected_revenue, expected_contribution, sort",
    )
    .eq("campaign_plan_id", plan.id)
    .order("sort");
  const opts = options ?? [];
  const optIds = opts.map((o) => o.id as string);

  const itemsByOpt = new Map<string, Record<string, unknown>[]>();
  if (optIds.length) {
    const { data: items } = await supabase
      .from("campaign_plan_option_items")
      .select("campaign_plan_option_id, base_name, sku_qty_per_option, unit_sale_price, sort")
      .in("campaign_plan_option_id", optIds)
      .order("sort");
    for (const it of items ?? []) {
      const k = it.campaign_plan_option_id as string;
      if (!itemsByOpt.has(k)) itemsByOpt.set(k, []);
      itemsByOpt.get(k)!.push(it);
    }
  }

  const optSheet = opts.map((o) => ({
    옵션명: o.option_label,
    메인: o.is_main ? "Y" : "",
    예상수량: o.expected_option_qty,
    판매가: o.set_price,
    소비자정가: o.consumer_total,
    상시정가: o.regular_total,
    "할인율(소비자)": o.discount_rate_consumer,
    "할인율(상시)": o.discount_rate_regular,
    예상매출: o.expected_revenue,
    예상공헌이익: o.expected_contribution,
  }));
  const skuSheet: Record<string, unknown>[] = [];
  for (const o of opts) {
    for (const it of itemsByOpt.get(o.id as string) ?? []) {
      skuSheet.push({
        옵션명: o.option_label,
        기초상품명: it.base_name,
        "구성수량/옵션": it.sku_qty_per_option,
        단가: it.unit_sale_price,
      });
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(optSheet), "옵션");
  if (skuSheet.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(skuSheet), "구성");
  downloadWorkbook(wb, `${safe(campaignName)}_플랜.xlsx`);
}

/** 캠페인 성과(세그먼트 풀그레인)를 엑셀로. */
export async function downloadPerformanceXlsx(promotionId: string, campaignName: string) {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("promotion_segment_sales")
    .select(
      "base_name, option_info, category, member_type, member_grade, order_type, revenue, order_count, aov, arppu, paying_users, quantity, fee, cost",
    )
    .eq("promotion_id", promotionId)
    .limit(20000);
  const list = rows ?? [];
  if (!list.length) throw new Error("이 캠페인에 성과 데이터가 없습니다.");

  const sheet = list.map((r) => ({
    기초상품명: r.base_name,
    옵션정보: r.option_info,
    카테고리: r.category,
    "회원/비회원": r.member_type,
    회원등급: r.member_grade,
    "일반/정기": r.order_type,
    결제금액: r.revenue,
    결제건수: r.order_count,
    AOV: r.aov,
    ARPPU: r.arppu,
    결제유저수: r.paying_users,
    판매수량: r.quantity,
    수수료: r.fee,
    원가: r.cost,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "성과");
  downloadWorkbook(wb, `${safe(campaignName)}_성과.xlsx`);
}
