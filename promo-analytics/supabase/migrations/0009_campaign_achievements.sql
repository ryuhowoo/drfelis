-- 0009: 캠페인별 달성률 단일 소스 (S4) — 대시보드/히스토리 공용
-- plan_vs_actual_summary 로직 재사용(중복 SQL 지양). 확정 플랜 없는 캠페인도 행 반환.
create or replace function promo.campaign_achievements()
returns table (
  promotion_id uuid,
  name text,
  start_date date,
  end_date date,
  confirmed_at timestamptz,
  has_confirmed_plan boolean,
  ach_revenue numeric,
  ach_qty numeric,
  ach_contribution numeric,
  expected_revenue_total numeric,
  actual_revenue_total numeric,
  expected_contribution_total numeric,
  actual_contribution_total numeric,
  quantity_reliable boolean
)
language sql
stable
set search_path = ''
as $$
  select
    p.id, p.name, p.start_date, p.end_date, cp.confirmed_at,
    coalesce(s.has_confirmed_plan, false),
    s.ach_revenue, s.ach_qty, s.ach_contribution,
    s.expected_revenue_total, s.actual_revenue_total,
    s.expected_contribution_total, s.actual_contribution_total,
    s.quantity_reliable
  from promo.promotions p
  left join lateral (select * from promo.plan_vs_actual_summary(p.id)) s on true
  left join promo.campaign_plans cp
    on cp.promotion_id = p.id and cp.is_current and cp.status = 'confirmed'
  order by p.start_date;
$$;

grant execute on all functions in schema promo to authenticated;
