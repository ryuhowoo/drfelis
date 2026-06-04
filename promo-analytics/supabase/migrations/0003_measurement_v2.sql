-- 프로모션 애널리틱스 — 측정 엔진 v2
--
-- 개선:
--   1) 요일 보정     : product × 요일별 평균을 프로모션 기간 요일 분포에 매칭
--   2) 콜드스타트     : baseline 관측 일수가 14일 미만이면 cold_start=true 마크
--   3) 추세(시즌) 보정 : 직전 8주/16주 일평균 비율을 ±20% 캡 + 50% 보수 적용
--   4) Outlier 트림  : product별 baseline 일매출 ±2σ 트림 후 평균/표준편차 재산출
--   5) 신뢰구간      : 1.96 × σ × √promo_days (95% CI 폭)

create or replace function promo.promotion_measurement(p_id uuid)
returns table (
  product_id              uuid,
  base_name               text,
  is_main                 boolean,
  promo_days              int,
  observed_baseline_days  int,
  cold_start              boolean,
  baseline_daily_revenue  numeric,
  baseline_daily_qty      numeric,
  baseline_std            numeric,
  trend_factor            numeric,
  expected_revenue        numeric,
  expected_qty            numeric,
  expected_revenue_naive  numeric,
  actual_revenue          numeric,
  actual_qty              numeric,
  uplift_revenue          numeric,
  uplift_qty              numeric,
  uplift_ci               numeric
)
language sql
stable
set search_path = ''
as $$
  with params as (
    select
      p.start_date,
      p.end_date,
      (p.end_date - p.start_date + 1)             as promo_days,
      (p.start_date - interval '56 day')::date    as win56_start,
      (p.start_date - interval '112 day')::date   as win112_start,
      (p.start_date - interval '1 day')::date     as win_end
    from promo.promotions p
    where p.id = p_id
  ),
  promo_days_all as (
    -- 모든 프로모션 기간 (직간접적으로 baseline에서 제외)
    select distinct g.d::date as day
    from promo.promotions pr,
         lateral generate_series(pr.start_date, pr.end_date, interval '1 day') g(d)
  ),
  baseline_days_56 as (
    select g.d::date as day, extract(dow from g.d)::int as dow
    from params, lateral generate_series(params.win56_start, params.win_end, interval '1 day') g(d)
    where not exists (select 1 from promo_days_all pda where pda.day = g.d::date)
  ),
  baseline_days_112 as (
    select g.d::date as day
    from params, lateral generate_series(params.win112_start, params.win_end, interval '1 day') g(d)
    where not exists (select 1 from promo_days_all pda where pda.day = g.d::date)
  ),
  -- 추세(시즌) 보정 계수: 8주 일평균 / 16주 일평균.
  -- 보수적으로 50%만 반영하고 ±20% 캡으로 안정성 확보.
  trend as (
    select case
      when t112.avg > 0 then least(1.2::numeric, greatest(0.8::numeric, 1 + (t56.avg / t112.avg - 1) * 0.5))
      else 1::numeric
    end as factor
    from
      (select coalesce(sum(revenue) / nullif(count(distinct sale_date), 0), 0) as avg
         from promo.daily_sales ds
         join baseline_days_56 b on b.day = ds.sale_date) t56,
      (select coalesce(sum(revenue) / nullif(count(distinct sale_date), 0), 0) as avg
         from promo.daily_sales ds
         join baseline_days_112 b on b.day = ds.sale_date) t112
  ),
  -- product별 raw baseline (요일 포함, ±2σ 트림 전)
  raw_baseline as (
    select
      ds.product_id,
      ds.sale_date,
      ds.revenue,
      ds.quantity,
      extract(dow from ds.sale_date)::int as dow,
      avg(ds.revenue)                                          over (partition by ds.product_id) as mu_rev,
      coalesce(stddev_samp(ds.revenue) over (partition by ds.product_id), 0)                       as sigma_rev
    from promo.daily_sales ds
    join baseline_days_56 bd on bd.day = ds.sale_date
    where ds.product_id is not null
  ),
  trimmed_baseline as (
    -- ±2σ 밖 일자 제거 (sigma=0이면 전부 포함)
    select * from raw_baseline
    where sigma_rev = 0 or abs(revenue - mu_rev) <= 2 * sigma_rev
  ),
  baseline_stats as (
    select
      product_id,
      avg(revenue)                            as daily_avg_rev,
      avg(quantity)                           as daily_avg_qty,
      coalesce(stddev_samp(revenue), 0)       as daily_std_rev,
      count(*)                                as observed_days
    from trimmed_baseline
    group by product_id
  ),
  baseline_dow as (
    select
      product_id, dow,
      avg(revenue)  as avg_rev,
      avg(quantity) as avg_qty
    from trimmed_baseline
    group by product_id, dow
  ),
  promo_dow_count as (
    select
      extract(dow from g.d)::int as dow,
      count(*)::int              as days
    from params, lateral generate_series(params.start_date, params.end_date, interval '1 day') g(d)
    group by 1
  ),
  -- 요일 보정 expected: product의 각 요일 평균 × 해당 요일 일수
  -- 프로모션 기간 요일이 baseline에 모두 관측됐을 때만 의미 있음.
  expected_wd as (
    select
      bd.product_id,
      sum(bd.avg_rev * pdc.days) as expected_rev_raw,
      sum(bd.avg_qty * pdc.days) as expected_qty_raw,
      sum(pdc.days)::int         as covered_days
    from baseline_dow bd
    join promo_dow_count pdc on pdc.dow = bd.dow
    group by bd.product_id
  ),
  actual as (
    select
      ds.product_id,
      sum(ds.revenue)  as actual_revenue,
      sum(ds.quantity) as actual_qty
    from promo.daily_sales ds, params
    where ds.sale_date between params.start_date and params.end_date
      and ds.product_id is not null
    group by ds.product_id
  ),
  -- 요일 커버리지 부족 시 단순 일평균×일수로 폴백
  computed as (
    select
      pr.id as product_id,
      pr.base_name,
      exists (
        select 1 from promo.promotion_main_products m
        where m.promotion_id = p_id and m.product_id = pr.id
      ) as is_main,
      (select promo_days from params)::int                          as promo_days,
      coalesce(bs.observed_days, 0)::int                            as observed_baseline_days,
      coalesce(bs.observed_days, 0) < 14                            as cold_start,
      coalesce(bs.daily_avg_rev, 0)                                 as baseline_daily_revenue,
      coalesce(bs.daily_avg_qty, 0)                                 as baseline_daily_qty,
      coalesce(bs.daily_std_rev, 0)                                 as baseline_std,
      (select factor from trend)                                    as trend_factor,
      case
        when coalesce(ew.covered_days, 0) = (select promo_days from params)
          then coalesce(ew.expected_rev_raw, 0)
        else coalesce(bs.daily_avg_rev, 0) * (select promo_days from params)
      end                                                            as expected_rev_base,
      case
        when coalesce(ew.covered_days, 0) = (select promo_days from params)
          then coalesce(ew.expected_qty_raw, 0)
        else coalesce(bs.daily_avg_qty, 0) * (select promo_days from params)
      end                                                            as expected_qty_base,
      coalesce(bs.daily_avg_rev, 0) * (select promo_days from params) as expected_revenue_naive,
      coalesce(a.actual_revenue, 0)                                  as actual_revenue,
      coalesce(a.actual_qty, 0)                                      as actual_qty
    from promo.products pr
    join actual a              on a.product_id  = pr.id
    left join baseline_stats bs on bs.product_id = pr.id
    left join expected_wd    ew on ew.product_id = pr.id
  )
  select
    c.product_id,
    c.base_name,
    c.is_main,
    c.promo_days,
    c.observed_baseline_days,
    c.cold_start,
    c.baseline_daily_revenue,
    c.baseline_daily_qty,
    c.baseline_std,
    c.trend_factor,
    c.expected_rev_base * c.trend_factor          as expected_revenue,
    c.expected_qty_base * c.trend_factor          as expected_qty,
    c.expected_revenue_naive,
    c.actual_revenue,
    c.actual_qty,
    c.actual_revenue - c.expected_rev_base * c.trend_factor as uplift_revenue,
    c.actual_qty     - c.expected_qty_base * c.trend_factor as uplift_qty,
    c.baseline_std * sqrt(c.promo_days::numeric) * 1.96     as uplift_ci
  from computed c;
$$;

-- promotion_summary 보강: cold_start_count, trend_factor, uplift_ci 추가
create or replace function promo.promotion_summary(p_id uuid)
returns table (
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
  with m as (select * from promo.promotion_measurement(p_id)),
  ps as (
    select coalesce(sum(revenue),0)              as ps_rev,
           coalesce(sum(revenue - cost - fee),0) as ps_contrib
    from promo.promotion_sales where promotion_id = p_id
  ),
  manual as (select contribution_amount as amt from promo.promotions where id = p_id)
  select
    max(m.promo_days),
    coalesce(sum(m.uplift_revenue) filter (where m.is_main),     0),
    coalesce(sum(m.uplift_revenue) filter (where not m.is_main), 0),
    coalesce(sum(m.uplift_revenue), 0),
    case when sum(m.uplift_revenue) <> 0
         then coalesce(sum(m.uplift_revenue) filter (where not m.is_main), 0) / sum(m.uplift_revenue)
         else null end,
    coalesce(sum(m.actual_revenue), 0),
    coalesce((select amt from manual), (select ps_contrib from ps)),
    case when (select ps_rev from ps) <> 0
         then coalesce((select amt from manual), (select ps_contrib from ps)) / (select ps_rev from ps)
         else null end,
    coalesce(sum(case when m.cold_start then 1 else 0 end), 0)::int as cold_start_count,
    max(m.trend_factor) as trend_factor,
    -- 분산 독립 가정: ci_total = √(Σ ci²)
    coalesce(sqrt(sum(m.uplift_ci * m.uplift_ci)), 0) as uplift_ci
  from m;
$$;

grant execute on function promo.promotion_measurement(uuid) to authenticated;
grant execute on function promo.promotion_summary(uuid)     to authenticated;
