-- 프로모션 애널리틱스 — 초기 스키마 + 측정 엔진
-- 단위: 일별 × 기초상품(SKU). 롤업: 옵션/프로모션.

-- ─────────────────────────────────────────────
-- 1. 마스터: 기초상품
-- ─────────────────────────────────────────────
create table if not exists public.products (
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
--    원천 컬럼: 일자 / 기초상품명 / 옵션정보 / 결제금액 / 판매수량
-- ─────────────────────────────────────────────
create table if not exists public.daily_sales (
  id          bigint generated always as identity primary key,
  sale_date   date not null,
  product_id  uuid references public.products(id),
  base_name   text not null,                  -- 원천 기초상품명 (매칭 전후 보존)
  option_info text not null default '',        -- 옵션정보 (없으면 빈문자열 → 업서트 키 안정화)
  revenue     numeric not null default 0,     -- 결제금액(환불/취소 제외)
  quantity    numeric not null default 0,     -- 기초상품 판매수량(환불/취소 제외)
  source_file text,
  created_at  timestamptz not null default now()
);
create index if not exists daily_sales_date_idx    on public.daily_sales (sale_date);
create index if not exists daily_sales_product_idx on public.daily_sales (product_id, sale_date);
-- 재업로드 시 같은 (일자·상품·옵션)은 덮어쓰기 위한 유니크 키
create unique index if not exists daily_sales_uq
  on public.daily_sales (sale_date, base_name, option_info);

-- ─────────────────────────────────────────────
-- 3. 프로모션 (메타 + 혜택 구조)
-- ─────────────────────────────────────────────
create table if not exists public.promotions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                  -- CF_P_251208_모래반짝특가
  code        text,                           -- CF_P_251208
  start_date  date not null,
  end_date    date not null,
  channel     text default '자사몰',
  purpose     text,                           -- 목적(자유서술): 신제품런칭/N주년/시즌 ...
  promo_type  text,                           -- 혜택종류: 할인/사은품/1+1/번들/쿠폰 ...
  season_tag  text,                           -- 시즌·이벤트: 세계고양이날/명절/크리스마스 ...
  benefits    jsonb,                          -- {discount_rate, discount_amount, gift:{name,value,relevance}, ...}
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists promotions_period_idx on public.promotions (start_date, end_date);

-- 3-1. 사용자가 지정한 메인(특별혜택) 상품
create table if not exists public.promotion_main_products (
  promotion_id uuid references public.promotions(id) on delete cascade,
  product_id   uuid references public.products(id),
  primary key (promotion_id, product_id)
);

-- 3-2. 프로모션 기간 실적 (시트 ②: 공헌이익 계산용 원가/수수료 포함)
create table if not exists public.promotion_sales (
  id           bigint generated always as identity primary key,
  promotion_id uuid references public.promotions(id) on delete cascade,
  product_id   uuid references public.products(id),
  base_name    text not null,
  option_info  text,
  revenue      numeric default 0,             -- 결제금액
  order_count  numeric default 0,             -- 결제 건수
  aov          numeric,                       -- 평균 주문가치
  fee          numeric default 0,             -- 수수료
  cost         numeric default 0,             -- 원가
  quantity     numeric default 0,
  created_at   timestamptz not null default now()
);
create index if not exists promotion_sales_promo_idx on public.promotion_sales (promotion_id);

-- 3-3. 정성 메모/가설 ("집요하게 묻기")
create table if not exists public.promotion_notes (
  id           uuid primary key default gen_random_uuid(),
  promotion_id uuid references public.promotions(id) on delete cascade,
  author       text,
  question     text,                          -- 시스템이 던진 질문
  answer       text,                          -- 사용자 응답
  cause_tags   text[],                        -- 광고증액/인플루언서/경쟁사품절/시즌특수/신제품 ...
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 4. 측정 엔진
--    baseline = 프로모션 직전 8주(56일) 중 "비프로모션 일자"의 일평균
--    uplift   = 프로모션 기간 실적 − baseline 일평균 × 프로모션 일수
-- ─────────────────────────────────────────────
create or replace function public.promotion_measurement(p_id uuid)
returns table (
  product_id             uuid,
  base_name              text,
  is_main                boolean,
  baseline_daily_revenue numeric,
  baseline_daily_qty     numeric,
  promo_days             int,
  actual_revenue         numeric,
  actual_qty             numeric,
  expected_revenue       numeric,   -- baseline_daily_revenue × promo_days
  uplift_revenue         numeric,
  uplift_qty             numeric
)
language sql
stable
as $$
  with params as (
    select start_date, end_date,
           (end_date - start_date + 1)            as promo_days,
           (start_date - interval '56 day')::date as win_start,
           (start_date - interval '1 day')::date  as win_end
    from public.promotions where id = p_id
  ),
  -- 모든 프로모션 기간의 날짜 집합 (baseline 윈도우에서 제외)
  promo_days_all as (
    select distinct g.d::date as day
    from public.promotions pr,
         lateral generate_series(pr.start_date, pr.end_date, interval '1 day') g(d)
  ),
  -- 직전 8주 윈도우 중 비프로모션 일자
  baseline_days as (
    select g.d::date as day
    from params, lateral generate_series(params.win_start, params.win_end, interval '1 day') g(d)
    where not exists (
      select 1 from promo_days_all pda where pda.day = g.d::date
    )
  ),
  n_baseline as (select count(*)::numeric as n from baseline_days),
  baseline as (
    select ds.product_id,
           sum(ds.revenue)  / nullif((select n from n_baseline), 0) as baseline_daily_revenue,
           sum(ds.quantity) / nullif((select n from n_baseline), 0) as baseline_daily_qty
    from public.daily_sales ds
    join baseline_days bd on bd.day = ds.sale_date
    where ds.product_id is not null
    group by ds.product_id
  ),
  actual as (
    select ds.product_id,
           sum(ds.revenue)  as actual_revenue,
           sum(ds.quantity) as actual_qty
    from public.daily_sales ds, params
    where ds.sale_date between params.start_date and params.end_date
      and ds.product_id is not null
    group by ds.product_id
  )
  select
    pr.id,
    pr.base_name,
    exists (
      select 1 from public.promotion_main_products m
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
  from public.products pr
  join actual a on a.product_id = pr.id   -- 프로모션 기간에 판매된 상품만
  left join baseline b on b.product_id = pr.id;
$$;

-- 4-1. 프로모션 단위 요약(직접/후광/총기여 + 공헌이익)
create or replace function public.promotion_summary(p_id uuid)
returns table (
  promo_days        int,
  direct_uplift     numeric,   -- 메인상품 증분 합
  halo_uplift       numeric,   -- 기타상품 증분 합 (후광)
  total_uplift      numeric,
  halo_share        numeric,   -- 후광 / 총기여
  actual_revenue    numeric,
  contribution      numeric,   -- 공헌이익 (실적 − 원가 − 수수료)  ※ promotion_sales 기준
  contribution_rate numeric
)
language sql
stable
as $$
  with m as (select * from public.promotion_measurement(p_id)),
  ps as (
    select coalesce(sum(revenue),0)                       as ps_rev,
           coalesce(sum(revenue - cost - fee),0)          as ps_contrib
    from public.promotion_sales where promotion_id = p_id
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
-- 5. RLS — 사내 전용. 인증된 사용자(= @drfelis.com 구글 로그인)는 전체 접근.
--    도메인 제한은 인증 레이어(OAuth 콜백/미들웨어)에서 강제.
-- ─────────────────────────────────────────────
alter table public.products                enable row level security;
alter table public.daily_sales             enable row level security;
alter table public.promotions              enable row level security;
alter table public.promotion_main_products enable row level security;
alter table public.promotion_sales         enable row level security;
alter table public.promotion_notes         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'products','daily_sales','promotions',
    'promotion_main_products','promotion_sales','promotion_notes'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t
    );
  end loop;
end $$;
