-- 0056: promotion_measurement 의 is_main 을 플랜 기준으로 통일 (히어로 '메인 직접 매출'·증분 Top10)
--
-- 기존엔 빈 promotion_main_products 테이블을 봐서 is_main 이 항상 false → 히어로 '메인 직접 매출 ₩0'·
-- '메인 미지정'·증분 Top10 전부 회색. plan_vs_actual 은 campaign_plans.main_product_ids 를 써서
-- 두 측정의 메인 소스가 갈렸다. 여기서 promotion_measurement 도 동일 정의(campaign_plans.
-- main_product_ids, null=전체) + 정규화 이름 매칭으로 바꿔 플랜의 메인 지정을 일관 반영한다.

create or replace function promo.promotion_measurement(p_id uuid)
 returns table(product_id uuid, base_name text, is_main boolean, promo_days integer, observed_baseline_days integer, cold_start boolean, baseline_daily_revenue numeric, baseline_daily_qty numeric, baseline_std numeric, trend_factor numeric, expected_revenue numeric, expected_qty numeric, expected_revenue_naive numeric, actual_revenue numeric, actual_qty numeric, uplift_revenue numeric, uplift_qty numeric, uplift_ci numeric)
 language sql stable set search_path to ''
as $function$
  with params as (
    select
      p.start_date,
      p.end_date,
      (p.end_date - p.start_date + 1)             as promo_days,
      (p.start_date - interval '56 day')::date    as win56_start,
      (p.start_date - interval '112 day')::date   as win112_start,
      (p.start_date - interval '1 day')::date     as win_end,
      (p.start_date - interval '365 day' - interval '14 day')::date as ly_win_start,
      (p.end_date   - interval '365 day' + interval '14 day')::date as ly_win_end,
      (p.start_date - interval '365 day' - interval '14 day' - interval '56 day')::date as ly_pre_start,
      (p.start_date - interval '365 day' - interval '14 day' - interval '1 day')::date  as ly_pre_end
    from promo.promotions p
    where p.id = p_id
  ),
  promo_days_all as (
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
  ly_window_days as (
    select g.d::date as day
    from params, lateral generate_series(params.ly_win_start, params.ly_win_end, interval '1 day') g(d)
  ),
  ly_pre_days as (
    select g.d::date as day
    from params, lateral generate_series(params.ly_pre_start, params.ly_pre_end, interval '1 day') g(d)
  ),
  trend as (
    select
      case
        when t112.avg > 0
          then least(1.2::numeric, greatest(0.8::numeric, 1 + (t56.avg / t112.avg - 1) * 0.5))
        else 1::numeric
      end as short_factor,
      case
        when lyw.avg > 0 and lyp.avg > 0 and lyw.cnt >= 14
          then least(1.15::numeric, greatest(0.85::numeric, 1 + (lyw.avg / lyp.avg - 1) * 0.5))
        else 1::numeric
      end as season_factor
    from
      (select coalesce(sum(revenue) / nullif(count(distinct sale_date), 0), 0) as avg
         from promo.daily_sales ds
         join baseline_days_56 b on b.day = ds.sale_date) t56,
      (select coalesce(sum(revenue) / nullif(count(distinct sale_date), 0), 0) as avg
         from promo.daily_sales ds
         join baseline_days_112 b on b.day = ds.sale_date) t112,
      (select coalesce(sum(revenue) / nullif(count(distinct sale_date), 0), 0) as avg,
              count(distinct ds.sale_date)                                       as cnt
         from promo.daily_sales ds
         join ly_window_days w on w.day = ds.sale_date) lyw,
      (select coalesce(sum(revenue) / nullif(count(distinct sale_date), 0), 0) as avg
         from promo.daily_sales ds
         join ly_pre_days p on p.day = ds.sale_date) lyp
  ),
  trend_combined as (
    select least(1.3::numeric, greatest(0.7::numeric, short_factor * season_factor)) as factor
    from trend
  ),
  raw_baseline as (
    select
      ds.product_id,
      ds.sale_date,
      ds.revenue,
      ds.quantity,
      extract(dow from ds.sale_date)::int as dow,
      avg(ds.revenue) over (partition by ds.product_id) as mu_rev,
      coalesce(stddev_samp(ds.revenue) over (partition by ds.product_id), 0) as sigma_rev
    from promo.daily_sales ds
    join baseline_days_56 bd on bd.day = ds.sale_date
    where ds.product_id is not null
  ),
  trimmed_baseline as (
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
  computed as (
    select
      pr.id as product_id,
      pr.base_name,
      -- 메인 판정: 플랜(현재 확정)의 main_product_ids(null=전체) + 정규화 이름 매칭 (plan_vs_actual 동일)
      exists (
        select 1
        from promo.campaign_plans cp
        join promo.campaign_plan_options o2 on o2.campaign_plan_id = cp.id
        join promo.campaign_plan_option_items i2 on i2.campaign_plan_option_id = o2.id
        join promo.products mp on mp.id = i2.product_id
        where cp.promotion_id = p_id and cp.is_current and cp.status = 'confirmed'
          and (cp.main_product_ids is null or i2.product_id = any(cp.main_product_ids))
          and promo.normalize_sku_name(mp.base_name) = promo.normalize_sku_name(pr.base_name)
      ) as is_main,
      (select promo_days from params)::int                          as promo_days,
      coalesce(bs.observed_days, 0)::int                            as observed_baseline_days,
      coalesce(bs.observed_days, 0) < 14                            as cold_start,
      coalesce(bs.daily_avg_rev, 0)                                 as baseline_daily_revenue,
      coalesce(bs.daily_avg_qty, 0)                                 as baseline_daily_qty,
      coalesce(bs.daily_std_rev, 0)                                 as baseline_std,
      (select factor from trend_combined)                           as trend_factor,
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
$function$;
