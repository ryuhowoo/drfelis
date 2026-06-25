-- 0058: 세그먼트 성과 요약 (회원/비회원, 회원등급 코호트, AOV/ARPPU, 일반/정기)
--
-- promotion_segment_sales(0057)를 회원유형·회원등급으로 집계해 단일 JSON으로 반환.
-- 정책(사용자 확정): Staff·동물병원(도매)은 고객 성과 합계에서 제외하고 별도 'excluded' 블록으로 노출.
--   · 회원 vs 비회원 분리. 회원은 등급 코호트(아깽이/꼬물이/캣초딩/고영희/묘르신 등) 유지.
--   · AOV·ARPPU는 합산이 불가능한 행 단위 값이라 집계 매출에서 파생: AOV=매출/결제건수,
--     ARPPU=매출/결제유저수. (프런트에서 파생 — RPC는 합계만 신뢰성 있게 제공)
-- detail bundle과 동일하게 단일 RPC. 미적재 캠페인은 has_data=false.

create or replace function promo.promotion_segment_summary(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with base as (
    select *,
      (coalesce(member_grade, '') in ('Staff', '동물병원')) as is_excluded
    from promo.promotion_segment_sales
    where promotion_id = p_id
  ),
  member_split as (
    select
      case when member_type = '비회원' then '비회원' else '회원' end as seg,
      sum(revenue) as revenue, sum(order_count) as orders,
      sum(quantity) as qty, sum(coalesce(paying_users, 0)) as users
    from base where not is_excluded
    group by 1
  ),
  grade as (
    select member_grade as grade,
      sum(revenue) as revenue, sum(order_count) as orders,
      sum(quantity) as qty, sum(coalesce(paying_users, 0)) as users
    from base
    where not is_excluded and member_type <> '비회원' and nullif(member_grade, '') is not null
    group by 1
  ),
  ordtype as (
    select coalesce(order_type, 'onetime') as order_type,
      sum(revenue) as revenue, sum(order_count) as orders, sum(quantity) as qty
    from base where not is_excluded
    group by 1
  ),
  cat as (
    select coalesce(nullif(category, ''), '미분류') as category,
      sum(revenue) as revenue, sum(order_count) as orders, sum(quantity) as qty
    from base where not is_excluded
    group by 1
  ),
  excluded as (
    select member_grade as grade, sum(revenue) as revenue, sum(order_count) as orders
    from base where is_excluded
    group by 1
  ),
  totals as (
    select sum(revenue) as revenue, sum(order_count) as orders,
           sum(coalesce(paying_users, 0)) as users, sum(quantity) as qty
    from base where not is_excluded
  )
  select jsonb_build_object(
    'has_data', (select count(*) from base) > 0,
    'total', (select to_jsonb(t) from totals t),
    'member_split', coalesce((select jsonb_agg(to_jsonb(m) order by m.revenue desc) from member_split m), '[]'::jsonb),
    'grades', coalesce((select jsonb_agg(to_jsonb(g) order by g.revenue desc) from grade g), '[]'::jsonb),
    'order_types', coalesce((select jsonb_agg(to_jsonb(o) order by o.revenue desc) from ordtype o), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.revenue desc) from cat c), '[]'::jsonb),
    'excluded', coalesce((select jsonb_agg(to_jsonb(e) order by e.revenue desc) from excluded e), '[]'::jsonb)
  );
$$;

grant execute on function promo.promotion_segment_summary(uuid) to authenticated;
notify pgrst, 'reload schema';
