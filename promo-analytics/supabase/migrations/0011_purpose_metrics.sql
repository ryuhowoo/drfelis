-- 0011: 목적별 가중 집계 (S5.2) — 대시보드/히스토리 공용
-- 목적별 값 = Σ_campaigns(metric × effective_weight). 단일목적(주목적 1.0)=100% 귀속(중복 0).
create or replace function promo.purpose_metrics()
returns table (
  purpose text,
  weighted_uplift numeric,
  weighted_contribution numeric,
  campaign_count int,
  avg_fit_score numeric,
  data_reliable boolean
)
language sql
stable
set search_path = ''
as $$
  with cw as (
    select w.purpose, pr.id as promotion_id, w.weight,
           coalesce(s.total_uplift, 0)  as uplift,
           coalesce(s.contribution, 0)  as contribution
    from promo.promotions pr
    cross join lateral promo.effective_purpose_weights(pr.id) w
    left join lateral promo.promotion_summary(pr.id) s on true
    where w.weight > 0
  ),
  fit as (
    select pr.id as promotion_id, f.purpose, f.fit_score_0_100, f.data_reliable
    from promo.promotions pr
    cross join lateral promo.purpose_fit(pr.id) f
  )
  select
    cw.purpose,
    sum(cw.uplift * cw.weight)        as weighted_uplift,
    sum(cw.contribution * cw.weight)  as weighted_contribution,
    count(distinct cw.promotion_id)::int as campaign_count,
    avg(fit.fit_score_0_100)          as avg_fit_score,
    bool_and(coalesce(fit.data_reliable, true)) as data_reliable
  from cw
  left join fit on fit.promotion_id = cw.promotion_id and fit.purpose = cw.purpose
  group by cw.purpose
  order by sum(cw.uplift * cw.weight) desc nulls last;
$$;

grant execute on all functions in schema promo to authenticated;
