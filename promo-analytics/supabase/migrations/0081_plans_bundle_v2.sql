-- 0081: plans_bundle v2 — 캠페인 리스트 개선용 필드 추가
--
-- · channel: 플랜에 채널이 없으면 캠페인(promotions.channel)으로 폴백
--   (새 캠페인 플로우는 채널을 promotions에 저장 → 리스트에 '—'로 나오던 버그 수정)
-- · purposes: 캠페인 목적 배열(세일즈/브랜딩/재고소진) — 목표1/목표2 라벨링용
-- · has_perf: 성과(실판매) 업로드 여부 — promotion_sales 존재
-- · expected_order_count: Σ 옵션 예상세트수 (브랜딩 '구매건수' 목표)
-- · expected_main_qty: Σ 메인옵션 예상세트수 × 세트당 SKU 수량 (재고소진 '판매수량' 목표)

create or replace function promo.plans_bundle()
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'plans',
      coalesce((select jsonb_agg(jsonb_build_object(
         'id', pl.id, 'code', pl.code, 'name', coalesce(pl.name, pr.name),
         'start_date', coalesce(pl.start_date, pr.start_date),
         'end_date', coalesce(pl.end_date, pr.end_date),
         'channel', coalesce(pl.channel, pr.channel),
         'status', pl.status, 'version', pl.version,
         'confirmed_at', pl.confirmed_at,
         'purposes', pr.purposes,
         'target_revenue', coalesce(pl.target_revenue, pl.expected_revenue_total),
         'target_contribution', coalesce(pl.target_contribution, pl.expected_contribution_total),
         'target_contribution_rate', pl.target_contribution_rate,
         'promotion_id', pl.promotion_id, 'promotion_name', pr.name,
         'actual_promotion_id', pl.actual_promotion_id, 'actual_name', pa.name,
         'option_count', (select count(*) from promo.campaign_plan_options o where o.campaign_plan_id = pl.id),
         'has_perf', exists (
           select 1 from promo.promotion_sales ps
           where ps.promotion_id = coalesce(pl.actual_promotion_id, pl.promotion_id)
         ),
         'expected_order_count', (
           select coalesce(sum(o.expected_option_qty), 0)
           from promo.campaign_plan_options o where o.campaign_plan_id = pl.id
         ),
         'expected_main_qty', (
           select coalesce(sum(o.expected_option_qty * coalesce(iq.q, 0)), 0)
           from promo.campaign_plan_options o
           left join lateral (
             select sum(i.sku_qty_per_option) as q
             from promo.campaign_plan_option_items i
             where i.campaign_plan_option_id = o.id
           ) iq on true
           where o.campaign_plan_id = pl.id and o.is_main
         ),
         'achievement', (select r.achievement from promo.campaign_rollups r where r.promotion_id = pl.promotion_id)
       ) order by coalesce(pl.start_date, pr.start_date) desc nulls last)
       from promo.campaign_plans pl
       left join promo.promotions pr on pr.id = pl.promotion_id
       left join promo.promotions pa on pa.id = pl.actual_promotion_id
       where pl.is_current), '[]'::jsonb),
    'options',
      coalesce((select jsonb_agg(jsonb_build_object(
         'plan_id', o.campaign_plan_id, 'is_main', o.is_main,
         'discount_consumer', o.discount_rate_consumer, 'discount_regular', o.discount_rate_regular,
         'set_price', o.set_price, 'expected_qty', o.expected_option_qty, 'expected_revenue', o.expected_revenue))
       from promo.campaign_plan_options o
       join promo.campaign_plans pl on pl.id = o.campaign_plan_id and pl.is_current), '[]'::jsonb),
    'meta',
      (select jsonb_build_object('stale', (version > built_version), 'refreshed_at', refreshed_at)
       from promo.rollup_state where id)
  ) into result;
  return result;
end;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
