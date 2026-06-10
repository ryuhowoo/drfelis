-- 0023: purpose_fit / campaign_fits / purpose_metrics O(N²) 제거 (N6 R1.1)
--
-- 문제: purpose_fit(p_id) 가 한 캠페인의 점수 정규화를 위해 '전체 캠페인'의
--       promotion_summary + plan_vs_actual_summary 를 매번 재계산 (base CTE).
--       campaign_fits() = N × purpose_fit = N² 차 summary 호출 → 단독 22초.
--       purpose_metrics() 도 내부에서 purpose_fit × N → 23초.
--       (히스토리 분석·대시보드가 느렸던 근본 원인)
-- 해결: base 를 한 번만 계산하는 all_purpose_fits() 배치 함수를 단일 출처로 만들고
--       purpose_fit(단건)·campaign_fits()·purpose_metrics() 는 여기에 위임.
--       수식·정규화(동류 min-max) 는 0010/0011/0012 와 동일 — 수치 변화 없음.

create or replace function promo.all_purpose_fits()
returns table (
  promotion_id uuid,
  purpose text,
  fit_metric_raw numeric,
  fit_score_0_100 numeric,
  data_reliable boolean
)
language sql
stable
set search_path = ''
as $$
  with base as (
    select pr.id as promotion_id,
      case when (s.actual_revenue - s.total_uplift) > 0
        then s.total_uplift / (s.actual_revenue - s.total_uplift) else null end as uplift_pct,
      pvs.ach_qty,
      pvs.quantity_reliable as qty_reliable,
      coalesce(oc.order_cnt, 0) as order_cnt
    from promo.promotions pr
    left join lateral promo.promotion_summary(pr.id) s on true
    left join lateral promo.plan_vs_actual_summary(pr.id) pvs on true
    left join lateral (
      select coalesce(sum(ps.order_count), 0) as order_cnt
      from promo.promotion_sales ps where ps.promotion_id = pr.id
    ) oc on true
  ),
  cp as (
    select pr.id as promotion_id, w.purpose
    from promo.promotions pr
    cross join lateral promo.effective_purpose_weights(pr.id) w
    where w.weight > 0
  ),
  metric as (
    select cp.promotion_id, cp.purpose,
      case
        when cp.purpose = '재고소진' then b.ach_qty
        when cp.purpose = '브랜딩'   then b.order_cnt
        else b.uplift_pct
      end as raw,
      case
        when cp.purpose = '재고소진' then coalesce(b.qty_reliable, false)
        when cp.purpose = '브랜딩'   then (b.order_cnt > 0)
        else true
      end as reliable
    from cp join base b on b.promotion_id = cp.promotion_id
  ),
  bounds as (
    select purpose, min(raw) as mn, max(raw) as mx
    from metric where raw is not null
    group by purpose
  )
  select m.promotion_id, m.purpose, m.raw,
    case
      when bd.mx > bd.mn then round((m.raw - bd.mn) / (bd.mx - bd.mn) * 100, 1)
      when m.raw is not null then 100
      else null
    end as fit_score_0_100,
    m.reliable
  from metric m
  left join bounds bd on bd.purpose = m.purpose;
$$;

-- 단건은 배치에 위임 (단일 출처 역전 — 이제 배치가 원본)
create or replace function promo.purpose_fit(p_id uuid)
returns table (
  purpose text,
  fit_metric_raw numeric,
  fit_score_0_100 numeric,
  data_reliable boolean
)
language sql
stable
set search_path = ''
as $$
  select f.purpose, f.fit_metric_raw, f.fit_score_0_100, f.data_reliable
  from promo.all_purpose_fits() f
  where f.promotion_id = p_id
  order by f.purpose;
$$;

create or replace function promo.campaign_fits()
returns table (
  promotion_id uuid,
  purpose text,
  fit_score_0_100 numeric,
  data_reliable boolean
)
language sql
stable
set search_path = ''
as $$
  select f.promotion_id, f.purpose, f.fit_score_0_100, f.data_reliable
  from promo.all_purpose_fits() f;
$$;

-- purpose_metrics: summary 도 배치(all_promotion_summaries)로, fit 도 배치로 — 1패스
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
    select w.purpose, w.promotion_id, w.weight,
           coalesce(s.total_uplift, 0)  as uplift,
           coalesce(s.contribution, 0)  as contribution
    from promo.all_effective_purpose_weights() w
    left join promo.all_promotion_summaries() s on s.promotion_id = w.promotion_id
    where w.weight > 0
  ),
  fit as (
    select f.promotion_id, f.purpose, f.fit_score_0_100, f.data_reliable
    from promo.all_purpose_fits() f
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

notify pgrst, 'reload schema';
