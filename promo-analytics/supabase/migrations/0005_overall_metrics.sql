-- 전체 데이터 기간의 정확한 상시/행사 일평균을 일자 단위로 계산.
-- 대시보드 하단 비교 카드가 product별 baseline_daily 합산을 22개 캠페인에 걸쳐
-- 다시 합산해 product 중복 부풀림이 발생하던 문제 해결용.

create or replace function promo.overall_baseline_metrics()
returns table (
  data_start         date,
  data_end           date,
  non_promo_days     int,
  promo_days         int,
  baseline_daily     numeric, -- 비프로모션 일자 평균 매출 (전 매장)
  promo_daily        numeric, -- 캠페인 기간 일자 평균 매출 (전 매장)
  lift_ratio         numeric  -- promo_daily / baseline_daily
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select min(sale_date) as min_d, max(sale_date) as max_d
    from promo.daily_sales
  ),
  promo_days_all as (
    select distinct g.d::date as d
    from promo.promotions p,
         lateral generate_series(p.start_date, p.end_date, interval '1 day') g(d)
  ),
  range_days as (
    select g.d::date as d
    from bounds, lateral generate_series(bounds.min_d, bounds.max_d, interval '1 day') g(d)
  ),
  non_promo as (
    select rd.d from range_days rd
    where rd.d not in (select d from promo_days_all)
  ),
  in_range_promo as (
    select pd.d from promo_days_all pd, bounds
    where pd.d between bounds.min_d and bounds.max_d
  ),
  np_daily as (
    select ds.sale_date, sum(ds.revenue) as rev
    from promo.daily_sales ds
    join non_promo n on n.d = ds.sale_date
    group by ds.sale_date
  ),
  p_daily as (
    select ds.sale_date, sum(ds.revenue) as rev
    from promo.daily_sales ds
    join in_range_promo p on p.d = ds.sale_date
    group by ds.sale_date
  )
  select
    (select min_d from bounds) as data_start,
    (select max_d from bounds) as data_end,
    (select count(*)::int from non_promo)        as non_promo_days,
    (select count(*)::int from in_range_promo)   as promo_days,
    coalesce((select avg(rev) from np_daily), 0) as baseline_daily,
    coalesce((select avg(rev) from p_daily),  0) as promo_daily,
    case
      when coalesce((select avg(rev) from np_daily), 0) > 0
        then (select avg(rev) from p_daily) / (select avg(rev) from np_daily)
      else null
    end as lift_ratio;
$$;

grant execute on function promo.overall_baseline_metrics() to authenticated;
