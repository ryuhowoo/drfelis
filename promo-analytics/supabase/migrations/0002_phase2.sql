-- 프로모션 애널리틱스 — Phase 2 스키마
-- Supabase SQL 에디터(프로젝트 mlbtnnchbpctgjjawkue)에 1회 실행.

-- 1) 프로모션: 수동 공헌이익액 + 복수 혜택종류
alter table promo.promotions add column if not exists contribution_amount numeric;
alter table promo.promotions add column if not exists promo_types text[];

-- 2) 혜택종류 / 시즈널리티 마스터 (추가·수정·삭제용)
create table if not exists promo.benefit_types (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int  not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists promo.seasonalities (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int  not null default 0,
  created_at timestamptz not null default now()
);

insert into promo.benefit_types(name, sort) values
  ('할인',1),('사은품',2),('1+1',3),('2+2',4),('번들',5),('쿠폰',6),('적립',7)
on conflict (name) do nothing;

insert into promo.seasonalities(name, sort) values
  ('N주년',1),('세계 고양이의 날',2),('한국 고양이의 날',3),('명절',4),
  ('크리스마스',5),('블랙프라이데이',6),('신학기',7),('여름',8),('겨울',9)
on conflict (name) do nothing;

alter table promo.benefit_types enable row level security;
alter table promo.seasonalities enable row level security;
drop policy if exists benefit_types_auth on promo.benefit_types;
create policy benefit_types_auth on promo.benefit_types for all to authenticated using (true) with check (true);
drop policy if exists seasonalities_auth on promo.seasonalities;
create policy seasonalities_auth on promo.seasonalities for all to authenticated using (true) with check (true);

-- 3) promotion_summary v2: 수동 공헌이익액이 있으면 그 값을 우선 사용
create or replace function promo.promotion_summary(p_id uuid)
returns table (
  promo_days        int,
  direct_uplift     numeric,
  halo_uplift       numeric,
  total_uplift      numeric,
  halo_share        numeric,
  actual_revenue    numeric,
  contribution      numeric,
  contribution_rate numeric
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
    coalesce(sum(m.uplift_revenue) filter (where m.is_main),  0),
    coalesce(sum(m.uplift_revenue) filter (where not m.is_main), 0),
    coalesce(sum(m.uplift_revenue), 0),
    case when sum(m.uplift_revenue) <> 0
         then coalesce(sum(m.uplift_revenue) filter (where not m.is_main), 0) / sum(m.uplift_revenue)
         else null end,
    coalesce(sum(m.actual_revenue), 0),
    coalesce((select amt from manual), (select ps_contrib from ps)),
    case when (select ps_rev from ps) <> 0
         then coalesce((select amt from manual), (select ps_contrib from ps)) / (select ps_rev from ps)
         else null end
  from m;
$$;

-- 4) 권한
grant all on all tables in schema promo to authenticated;
grant all on all sequences in schema promo to authenticated;
grant execute on all functions in schema promo to authenticated;
