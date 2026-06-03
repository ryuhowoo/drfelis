-- 프로모션 애널리틱스 — promo 스키마 (숏클립 등 다른 앱과 격리)
-- 단위: 일별 × 기초상품(SKU). 롤업: 옵션/프로모션.

create schema if not exists promo;
grant usage on schema promo to anon, authenticated;

-- ─────────────────────────────────────────────
-- 1. 마스터: 기초상품
-- ─────────────────────────────────────────────
create table if not exists promo.products (
  id             uuid primary key default gen_random_uuid(),
  base_name      text not null unique,        -- 기초 상품명
  dr_code        text,                         -- 품목코드 (DR10056 ...)
  category       text,                         -- 모래/간식/영양제/용품 등 (선택)
  cost           numeric,                      -- 제품원가 (VAT+)
  consumer_price numeric,                      -- 소비자가
  regular_price  numeric,                      -- 상시가
  created_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 2. 연료: 일별 매출 추이 (시계열)
-- ─────────────────────────────────────────────
create table if not exists promo.daily_sales (
  id          bigint generated always as identity primary key,
  sale_date   date not null,
  product_id  uuid references promo.products(id),
  base_name   text not null,
  option_info text not null default '',
  revenue     numeric not null default 0,
  quantity    numeric not null default 0,
  source_file text,
  created_at  timestamptz not null default now()
);
create index if not exists daily_sales_date_idx    on promo.daily_sales (sale_date);
create index if not exists daily_sales_product_idx on promo.daily_sales (product_id, sale_date);
create unique index if not exists daily_sales_uq
  on promo.daily_sales (sale_date, base_name, option_info);

-- ─────────────────────────────────────────────
-- 3. 프로모션 (메타 + 혜택 구조)
-- ─────────────────────────────────────────────
create table if not exists promo.promotions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  start_date  date not null,
  end_date    date not null,
  channel     text default '자사몰',
  purpose     text,
  promo_type  text,
  season_tag  text,
  benefits    jsonb,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists promotions_period_idx on promo.promotions (start_date, end_date);

create table if not exists promo.promotion_main_products (
  promotion_id uuid references promo.promotions(id) on delete cascade,
  product_id   uuid references promo.products(id),
  primary key (promotion_id, product_id)
);

create table if not exists promo.promotion_sales (
  id           bigint generated always as identity primary key,
  promotion_id uuid references promo.promotions(id) on delete cascade,
  product_id   uuid references promo.products(id),
  base_name    text not null,
  option_info  text,
  revenue      numeric default 0,
  order_count  numeric default 0,
  aov          numeric,
  fee          numeric default 0,
  cost         numeric default 0,
  quantity     numeric default 0,
  created_at   timestamptz not null default now()
);
create index if not exists promotion_sales_promo_idx on promo.promotion_sales (promotion_id);

create table if not exists promo.promotion_notes (
  id           uuid primary key default gen_random_uuid(),
  promotion_id uuid references promo.promotions(id) on delete cascade,
  author       text,
  question     text,
  answer       text,
  cause_tags   text[],
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 4. 측정 엔진
-- ─────────────────────────────────────────────
create or replace function promo.promotion_measurement(p_id uuid)
returns table (
  product_id             uuid,
  base_name              text,
  is_main                boolean,
  baseline_daily_revenue numeric,
  baseline_daily_qty     numeric,
  promo_days             int,
  actual_revenue         numeric,
  actual_qty             numeric,
  expected_revenue       numeric,
  uplift_revenue         numeric,
  uplift_qty             numeric
)
language sql
stable
set search_path = ''
as $$
  with params as (
    select start_date, end_date,
           (end_date - start_date + 1)            as promo_days,
           (start_date - interval '56 day')::date as win_start,
           (start_date - interval '1 day')::date  as win_end
    from promo.promotions where id = p_id
  ),
  promo_days_all as (
    select distinct g.d::date as day
    from promo.promotions pr,
         lateral generate_series(pr.start_date, pr.end_date, interval '1 day') g(d)
  ),
  baseline_days as (
    select g.d::date as day
    from params, lateral generate_series(params.win_start, params.win_end, interval '1 day') g(d)
    where not exists (select 1 from promo_days_all pda where pda.day = g.d::date)
  ),
  n_baseline as (select count(*)::numeric as n from baseline_days),
  baseline as (
    select ds.product_id,
           sum(ds.revenue)  / nullif((select n from n_baseline), 0) as baseline_daily_revenue,
           sum(ds.quantity) / nullif((select n from n_baseline), 0) as baseline_daily_qty
    from promo.daily_sales ds
    join baseline_days bd on bd.day = ds.sale_date
    where ds.product_id is not null
    group by ds.product_id
  ),
  actual as (
    select ds.product_id,
           sum(ds.revenue)  as actual_revenue,
           sum(ds.quantity) as actual_qty
    from promo.daily_sales ds, params
    where ds.sale_date between params.start_date and params.end_date
      and ds.product_id is not null
    group by ds.product_id
  )
  select
    pr.id,
    pr.base_name,
    exists (
      select 1 from promo.promotion_main_products m
      where m.promotion_id = p_id and m.product_id = pr.id
    ) as is_main,
    coalesce(b.baseline_daily_revenue, 0),
    coalesce(b.baseline_daily_qty, 0),
    (select promo_days from params)::int,
    coalesce(a.actual_revenue, 0),
    coalesce(a.actual_qty, 0),
    coalesce(b.baseline_daily_revenue, 0) * (select promo_days from params),
    coalesce(a.actual_revenue, 0) - coalesce(b.baseline_daily_revenue, 0) * (select promo_days from params),
    coalesce(a.actual_qty, 0)     - coalesce(b.baseline_daily_qty, 0)     * (select promo_days from params)
  from promo.products pr
  join actual a on a.product_id = pr.id
  left join baseline b on b.product_id = pr.id;
$$;

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
  )
  select
    max(m.promo_days),
    coalesce(sum(m.uplift_revenue) filter (where m.is_main),  0),
    coalesce(sum(m.uplift_revenue) filter (where not m.is_main), 0),
    coalesce(sum(m.uplift_revenue), 0),
    case when sum(m.uplift_revenue) <> 0
         then coalesce(sum(m.uplift_revenue) filter (where not m.is_main), 0) / sum(m.uplift_revenue)
         else null end,
    coalesce(sum(m.actual_revenue), 0),
    (select ps_contrib from ps),
    case when (select ps_rev from ps) <> 0
         then (select ps_contrib from ps) / (select ps_rev from ps)
         else null end
  from m;
$$;

-- ─────────────────────────────────────────────
-- 5. RLS — 인증된 사용자(@drfelis.com 구글 로그인) 전체 접근
-- ─────────────────────────────────────────────
alter table promo.products                enable row level security;
alter table promo.daily_sales             enable row level security;
alter table promo.promotions              enable row level security;
alter table promo.promotion_main_products enable row level security;
alter table promo.promotion_sales         enable row level security;
alter table promo.promotion_notes         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'products','daily_sales','promotions',
    'promotion_main_products','promotion_sales','promotion_notes'
  ] loop
    execute format(
      'drop policy if exists %I on promo.%I;', t || '_authenticated_all', t
    );
    execute format(
      'create policy %I on promo.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- 6. PostgREST 권한 (authenticated 역할)
-- ─────────────────────────────────────────────
grant all on all tables in schema promo to authenticated;
grant all on all sequences in schema promo to authenticated;
grant execute on all functions in schema promo to authenticated;
alter default privileges in schema promo grant all on tables to authenticated;
alter default privileges in schema promo grant all on sequences to authenticated;
alter default privileges in schema promo grant execute on functions to authenticated;
