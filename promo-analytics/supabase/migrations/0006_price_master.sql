-- 0006: 가격 마스터 (L1) — rate card + product_price_configs + products 정합 컬럼
-- S1: 가격 가이드 / 달성률 로드맵의 L1 가격 마스터 계층.
-- additive only. 기존 products.cost 값 등 기존 데이터는 건드리지 않음(업로드 적재 시 교정).

-- (1) rate card 파라미터 (단일 current 행 + 이력)
create table if not exists promo.rate_card (
  id              uuid primary key default gen_random_uuid(),
  fee_rate        numeric not null default 0.045,  -- 수수료(자사몰)
  ad_rate         numeric not null default 0.10,   -- 광고비
  logistics_rate  numeric not null default 0.12,   -- 물류비
  reward_rate     numeric not null default 0.02,   -- 적립금
  effective_from  timestamptz not null default now(),
  is_current      boolean not null default true,
  note            text,
  created_at      timestamptz not null default now()
);

-- 초기 1행 시드 (current 행이 없을 때만). 변동비율 합 = 0.285, 공헌이익 승수 = 0.715
insert into promo.rate_card (fee_rate, ad_rate, logistics_rate, reward_rate, is_current, note)
select 0.045, 0.10, 0.12, 0.02, true, '자사몰 기본 rate card (S1 초기 시드)'
where not exists (select 1 from promo.rate_card where is_current = true);

alter table promo.rate_card enable row level security;
drop policy if exists rate_card_auth on promo.rate_card;
create policy rate_card_auth on promo.rate_card for all to authenticated using (true) with check (true);

-- (2) products 정합 컬럼 (additive). 기존 cost 값은 건드리지 않음 — 업로드 적재 시 교정.
alter table promo.products add column if not exists cost_vat_excluded numeric;

-- (3) SKU × 판매구성 마스터
create table if not exists promo.product_price_configs (
  id                     uuid primary key default gen_random_uuid(),
  product_id             uuid not null references promo.products(id) on delete cascade,
  base_name              text not null,
  config_type            text not null,         -- '단품' | '2묶음' | '3묶음' | '4묶음' | '5묶음'
  pack_count             int  not null,         -- 1~5 (같은 SKU 수량)
  free_shipping          boolean not null default false,
  list_price             numeric,               -- 정가 = 소비자가 × pack_count
  sale_price             numeric not null,      -- 판매가(구성별)
  discount_rate_consumer numeric,               -- (list_price - sale_price)/list_price
  discount_rate_regular  numeric,               -- (상시가×pack - sale_price)/(상시가×pack)
  unit_cost_total        numeric,               -- 원가(VAT+) × pack_count
  contribution           numeric,               -- sale_price × mult − unit_cost_total
  contribution_rate      numeric,               -- contribution / sale_price
  source_file            text,
  updated_at             timestamptz not null default now(),
  unique (product_id, config_type)
);
create index if not exists product_price_configs_product_idx
  on promo.product_price_configs (product_id);

alter table promo.product_price_configs enable row level security;
drop policy if exists product_price_configs_auth on promo.product_price_configs;
create policy product_price_configs_auth on promo.product_price_configs for all to authenticated using (true) with check (true);

grant all on all tables in schema promo to authenticated;
grant all on all sequences in schema promo to authenticated;
grant execute on all functions in schema promo to authenticated;
