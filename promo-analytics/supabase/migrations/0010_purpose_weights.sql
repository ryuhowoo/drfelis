-- 0010: 목적 가중 (S5.1) — promotion_purpose_weights + effective_purpose_weights + purpose_fit
-- 목적별 기여 = Σ(metric × weight). 기본: 주목적(purposes[1])=1.0, 보조=0.0(편집 가능).

create table if not exists promo.promotion_purpose_weights (
  promotion_id uuid not null references promo.promotions(id) on delete cascade,
  purpose      text not null,
  weight       numeric not null default 0,
  primary key (promotion_id, purpose)
);

alter table promo.promotion_purpose_weights enable row level security;
drop policy if exists promotion_purpose_weights_auth on promo.promotion_purpose_weights;
create policy promotion_purpose_weights_auth on promo.promotion_purpose_weights
  for all to authenticated using (true) with check (true);

-- 유효 가중치: 저장된 weight>0 행이 있으면 그것, 없으면 주목적(purposes[1]→purpose) = 1.0 폴백
create or replace function promo.effective_purpose_weights(p_id uuid)
returns table (purpose text, weight numeric)
language sql
stable
set search_path = ''
as $$
  with saved as (
    select purpose, weight
    from promo.promotion_purpose_weights
    where promotion_id = p_id and weight <> 0
  )
  select purpose, weight from saved
  union all
  select coalesce((pr.purposes)[1], pr.purpose) as purpose, 1.0 as weight
  from promo.promotions pr
  where pr.id = p_id
    and not exists (select 1 from saved)
    and coalesce((pr.purposes)[1], pr.purpose) is not null;
$$;

-- 목적 적합도: 캠페인의 각 목적에 대해 대표지표 raw + 같은목적 모집단 min-max 정규화(0~100) + 신뢰도
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
  with base as (
    select pr.id as promotion_id,
      (select case when (s.actual_revenue - s.total_uplift) > 0
                then s.total_uplift / (s.actual_revenue - s.total_uplift) else null end
       from promo.promotion_summary(pr.id) s) as uplift_pct,
      (select ach_qty from promo.plan_vs_actual_summary(pr.id)) as ach_qty,
      (select quantity_reliable from promo.plan_vs_actual_summary(pr.id)) as qty_reliable,
      (select coalesce(sum(ps.order_count),0) from promo.promotion_sales ps where ps.promotion_id = pr.id) as order_cnt
    from promo.promotions pr
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
  select m.purpose, m.raw,
    case
      when bd.mx > bd.mn then round((m.raw - bd.mn) / (bd.mx - bd.mn) * 100, 1)
      when m.raw is not null then 100
      else null
    end as fit_score_0_100,
    m.reliable
  from metric m
  left join bounds bd on bd.purpose = m.purpose
  where m.promotion_id = p_id
  order by m.purpose;
$$;

grant all on all tables in schema promo to authenticated;
grant execute on all functions in schema promo to authenticated;
