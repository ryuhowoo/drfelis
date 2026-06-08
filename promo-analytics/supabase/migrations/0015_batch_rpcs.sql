-- 0015: 배치 RPC — 전 캠페인 한 번에 조회 (N+1 제거, 속도 최적화)
--
-- 문제: lib/cases.ts loadCases / library / 대시보드가 캠페인마다 단건 RPC를 호출(≈4N 왕복).
-- 해결: 0012(campaign_fits) 의 'cross join lateral' 배치 패턴을 동일하게 적용해,
--      기존 단건 함수(promotion_summary, promotion_measurement, effective_purpose_weights)를
--      한 번의 쿼리로 전 캠페인에 대해 실행. 계산은 기존 함수 단일 출처 그대로.
--
-- 검증: 배치 결과는 단건 호출 결과와 수치 동일해야 함 (동일 함수 호출).

-- ── 전 캠페인 promotion_summary ─────────────────────────────────────────
create or replace function promo.all_promotion_summaries()
returns table (
  promotion_id      uuid,
  promo_days        int,
  direct_uplift     numeric,
  halo_uplift       numeric,
  total_uplift      numeric,
  halo_share        numeric,
  actual_revenue    numeric,
  contribution      numeric,
  contribution_rate numeric,
  cold_start_count  int,
  trend_factor      numeric,
  uplift_ci         numeric
)
language sql
stable
set search_path = ''
as $$
  select pr.id, s.*
  from promo.promotions pr
  cross join lateral promo.promotion_summary(pr.id) s;
$$;

-- ── 전 캠페인 features (summary + measurement 파생 + sales 파생) ─────────
-- lib/cases.ts loadCases() 가 캠페인별로 계산하던 다음 값을 SQL로 일괄:
--   baseline_daily  = Σ measurement.baseline_daily_revenue
--   actual_daily    = Σ measurement.actual_revenue / promo_days
--   qty_per_day     = Σ promotion_sales.quantity   / promo_days
--   orders_per_day  = Σ promotion_sales.order_count/ promo_days
--   promo_days      = max(measurement.promo_days) (rows는 동일값 공유) — 빈 측정시 duration 폴백
--   duration_days   = end_date - start_date + 1
create or replace function promo.all_campaign_features()
returns table (
  promotion_id      uuid,
  -- summary 필드 (promotion_summary 와 동일)
  promo_days        int,
  direct_uplift     numeric,
  halo_uplift       numeric,
  total_uplift      numeric,
  halo_share        numeric,
  actual_revenue    numeric,
  contribution      numeric,
  contribution_rate numeric,
  cold_start_count  int,
  trend_factor      numeric,
  uplift_ci         numeric,
  -- measurement 파생
  baseline_daily    numeric,
  actual_daily      numeric,
  -- promotion_sales 파생
  qty_per_day       numeric,
  orders_per_day    numeric,
  -- 일정
  duration_days     int
)
language sql
stable
set search_path = ''
as $$
  with meas_agg as (
    select pr.id as promotion_id,
      coalesce(sum(m.baseline_daily_revenue), 0) as sum_baseline_daily_rev,
      coalesce(sum(m.actual_revenue), 0)         as sum_actual_rev,
      max(m.promo_days)                          as meas_promo_days
    from promo.promotions pr
    left join lateral promo.promotion_measurement(pr.id) m on true
    group by pr.id
  ),
  ps_agg as (
    select promotion_id,
      coalesce(sum(quantity), 0)    as total_qty,
      coalesce(sum(order_count), 0) as total_orders
    from promo.promotion_sales
    group by promotion_id
  ),
  sum_agg as (
    select pr.id as promotion_id, s.*
    from promo.promotions pr
    cross join lateral promo.promotion_summary(pr.id) s
  )
  select
    pr.id,
    sa.promo_days,
    sa.direct_uplift,
    sa.halo_uplift,
    sa.total_uplift,
    sa.halo_share,
    sa.actual_revenue,
    sa.contribution,
    sa.contribution_rate,
    sa.cold_start_count,
    sa.trend_factor,
    sa.uplift_ci,
    coalesce(ma.sum_baseline_daily_rev, 0) as baseline_daily,
    case when coalesce(ma.meas_promo_days, 0) > 0
      then coalesce(ma.sum_actual_rev, 0) / ma.meas_promo_days
      else 0 end as actual_daily,
    case when coalesce(ma.meas_promo_days, 0) > 0
      then coalesce(ps.total_qty, 0)::numeric / ma.meas_promo_days
      else 0 end as qty_per_day,
    case when coalesce(ma.meas_promo_days, 0) > 0
      then coalesce(ps.total_orders, 0)::numeric / ma.meas_promo_days
      else 0 end as orders_per_day,
    (pr.end_date - pr.start_date + 1)::int as duration_days
  from promo.promotions pr
  left join sum_agg  sa on sa.promotion_id = pr.id
  left join meas_agg ma on ma.promotion_id = pr.id
  left join ps_agg   ps on ps.promotion_id = pr.id;
$$;

-- ── 전 캠페인 effective_purpose_weights ────────────────────────────────
create or replace function promo.all_effective_purpose_weights()
returns table (promotion_id uuid, purpose text, weight numeric)
language sql
stable
set search_path = ''
as $$
  select pr.id, w.purpose, w.weight
  from promo.promotions pr
  cross join lateral promo.effective_purpose_weights(pr.id) w;
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
