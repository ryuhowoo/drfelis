-- 0025: 플랜 보드 번들 (N6 — 플랜 전용 뷰 + 성향 분석)
--
-- N5에서 플랜이 실적과 분리된 독립 개체가 됐지만 모아 보는 화면이 없었다.
-- 현재 플랜(is_current) 전체 + 옵션 플랫 목록을 1회 왕복으로 반환.
-- 달성률은 연결된 promotion 의 rollup achievement 재사용 (단일 출처).

create or replace function promo.plans_bundle()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare result jsonb;
begin
  perform promo.ensure_rollups_fresh();
  select jsonb_build_object(
    'plans',
      coalesce((select jsonb_agg(jsonb_build_object(
         'id', pl.id,
         'code', pl.code,
         'name', coalesce(pl.name, pr.name),
         'start_date', coalesce(pl.start_date, pr.start_date),
         'end_date', coalesce(pl.end_date, pr.end_date),
         'channel', pl.channel,
         'status', pl.status,
         'version', pl.version,
         'confirmed_at', pl.confirmed_at,
         'target_revenue', coalesce(pl.target_revenue, pl.expected_revenue_total),
         'target_contribution', coalesce(pl.target_contribution, pl.expected_contribution_total),
         'target_contribution_rate', pl.target_contribution_rate,
         'promotion_id', pl.promotion_id,
         'promotion_name', pr.name,
         'actual_promotion_id', pl.actual_promotion_id,
         'actual_name', pa.name,
         'option_count',
           (select count(*) from promo.campaign_plan_options o
            where o.campaign_plan_id = pl.id),
         'achievement',
           (select r.achievement from promo.campaign_rollups r
            where r.promotion_id = pl.promotion_id)
       ) order by coalesce(pl.start_date, pr.start_date) desc nulls last)
       from promo.campaign_plans pl
       left join promo.promotions pr on pr.id = pl.promotion_id
       left join promo.promotions pa on pa.id = pl.actual_promotion_id
       where pl.is_current), '[]'::jsonb),
    'options',
      coalesce((select jsonb_agg(jsonb_build_object(
         'plan_id', o.campaign_plan_id,
         'is_main', o.is_main,
         'discount_consumer', o.discount_rate_consumer,
         'discount_regular', o.discount_rate_regular,
         'set_price', o.set_price,
         'expected_qty', o.expected_option_qty,
         'expected_revenue', o.expected_revenue))
       from promo.campaign_plan_options o
       join promo.campaign_plans pl
         on pl.id = o.campaign_plan_id and pl.is_current), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
