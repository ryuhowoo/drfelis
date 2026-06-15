-- 0035: N8 P3 — 캠페인 자유 태그 + 함께 구매 벤치마크(추천 프로토타입 토대)
--
-- 방향: 캠페인별 '메인 → 함께 구매' 비율을 누적해, 유사 성격(자유 태그)·시즌의 캠페인끼리
--   평균을 내면 메인·예상수량만 정해도 전체 매출을 역추정/추천 가능.
--   (운영 데이터에서 비율 편차가 큼: 벌크UP 8% vs Better Habits 199% → 태그별 그룹핑 필수)
--
-- 비파괴: 컬럼 추가 + 신규 함수.

alter table promo.campaign_plans
  add column if not exists tags text[] default '{}';

-- 확정 플랜+실적 보유 캠페인의 함께 구매 벤치마크 (plan_vs_actual_summary 재사용)
create or replace function promo.halo_benchmarks()
returns table(
  promotion_id uuid,
  name text,
  season text,
  tags text[],
  main_revenue numeric,
  halo_revenue numeric,
  halo_ratio numeric,
  total_revenue numeric,
  target_revenue numeric,
  revenue_ach_total numeric
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    coalesce(cp.name, p.name),
    to_char(cp.start_date, 'YYYY-MM'),
    coalesce(cp.tags, '{}'),
    s.main_revenue,
    s.halo_revenue,
    case when coalesce(s.main_revenue, 0) > 0 then s.halo_revenue / s.main_revenue else null end,
    s.campaign_revenue_total,
    s.expected_revenue_total,
    s.revenue_ach_total
  from promo.promotions p
  join promo.campaign_plans cp
    on cp.promotion_id = p.id and cp.is_current and cp.status = 'confirmed'
  cross join lateral promo.plan_vs_actual_summary(p.id) s
  where s.has_confirmed_plan
  order by cp.start_date nulls last;
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
