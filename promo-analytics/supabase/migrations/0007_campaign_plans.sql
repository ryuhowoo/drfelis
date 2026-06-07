-- 0007: 캠페인 플랜 (L2) — campaign_plans / options / option_items + confirm·clone 함수
-- S2: 플랜 draft↔confirmed. confirm 시 rate card·가격·원가 전부 동결.
-- additive only.

-- 헤더
create table if not exists promo.campaign_plans (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid not null references promo.promotions(id) on delete cascade,
  version       int  not null default 1,
  is_current    boolean not null default true,
  status        text not null default 'draft',   -- 'draft' | 'confirmed'
  confirmed_at  timestamptz,
  rate_card_id  uuid references promo.rate_card(id),
  rate_card_snapshot jsonb,
  expected_revenue_total      numeric,
  expected_contribution_total numeric,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists campaign_plans_one_current
  on promo.campaign_plans (promotion_id) where is_current;
create index if not exists campaign_plans_promo_idx
  on promo.campaign_plans (promotion_id);

-- 옵션
create table if not exists promo.campaign_plan_options (
  id                uuid primary key default gen_random_uuid(),
  campaign_plan_id  uuid not null references promo.campaign_plans(id) on delete cascade,
  option_label      text not null,
  expected_option_qty numeric not null default 0,
  is_main           boolean not null default false,
  match_patterns    text[] not null default '{}',
  sort              int not null default 0,
  set_price             numeric,
  consumer_total        numeric,
  regular_total         numeric,
  discount_rate_consumer numeric,
  discount_rate_regular  numeric,
  expected_revenue      numeric,
  expected_contribution numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists campaign_plan_options_plan_idx
  on promo.campaign_plan_options (campaign_plan_id);

-- BOM 아이템
create table if not exists promo.campaign_plan_option_items (
  id                uuid primary key default gen_random_uuid(),
  campaign_plan_option_id uuid not null references promo.campaign_plan_options(id) on delete cascade,
  product_id        uuid not null references promo.products(id),
  base_name         text not null,
  sku_qty_per_option numeric not null,
  unit_sale_price    numeric not null,
  source_config_id  uuid references promo.product_price_configs(id),
  frozen_consumer_price numeric,
  frozen_regular_price  numeric,
  frozen_cost           numeric,
  sort              int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists campaign_plan_option_items_option_idx
  on promo.campaign_plan_option_items (campaign_plan_option_id);

-- RLS
alter table promo.campaign_plans enable row level security;
drop policy if exists campaign_plans_auth on promo.campaign_plans;
create policy campaign_plans_auth on promo.campaign_plans for all to authenticated using (true) with check (true);

alter table promo.campaign_plan_options enable row level security;
drop policy if exists campaign_plan_options_auth on promo.campaign_plan_options;
create policy campaign_plan_options_auth on promo.campaign_plan_options for all to authenticated using (true) with check (true);

alter table promo.campaign_plan_option_items enable row level security;
drop policy if exists campaign_plan_option_items_auth on promo.campaign_plan_option_items;
create policy campaign_plan_option_items_auth on promo.campaign_plan_option_items for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────
-- confirm_plan: 전 항목 동결 + 롤업 계산 + current 플립 (트랜잭션)
-- ─────────────────────────────────────────────
create or replace function promo.confirm_plan(p_plan_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_promo uuid;
  v_rc record;
  v_mult numeric;
  v_snapshot jsonb;
  v_opt_count int;
  v_bad_opt int;
  v_rev_total numeric;
  v_contrib_total numeric;
begin
  select promotion_id into v_promo from promo.campaign_plans where id = p_plan_id;
  if v_promo is null then
    raise exception 'plan % not found', p_plan_id;
  end if;

  -- 가드: 예상 세트수>0 옵션 ≥1
  select count(*) into v_opt_count
  from promo.campaign_plan_options
  where campaign_plan_id = p_plan_id and expected_option_qty > 0;
  if v_opt_count = 0 then
    raise exception '확정하려면 예상 세트수가 1 이상인 옵션이 최소 1개 필요합니다';
  end if;

  -- 가드: 구성 SKU 없는 옵션 금지
  select count(*) into v_bad_opt
  from promo.campaign_plan_options o
  where o.campaign_plan_id = p_plan_id
    and not exists (
      select 1 from promo.campaign_plan_option_items i
      where i.campaign_plan_option_id = o.id
    );
  if v_bad_opt > 0 then
    raise exception '구성 SKU가 없는 옵션이 % 개 있습니다', v_bad_opt;
  end if;

  -- rate card current → 스냅샷
  select * into v_rc from promo.rate_card where is_current order by effective_from desc limit 1;
  if v_rc is null then
    raise exception 'current rate_card 가 없습니다';
  end if;
  v_mult := 1 - (v_rc.fee_rate + v_rc.ad_rate + v_rc.logistics_rate + v_rc.reward_rate);
  v_snapshot := jsonb_build_object(
    'fee_rate', v_rc.fee_rate, 'ad_rate', v_rc.ad_rate,
    'logistics_rate', v_rc.logistics_rate, 'reward_rate', v_rc.reward_rate,
    'mult', v_mult, 'rate_card_id', v_rc.id, 'snapped_at', now()
  );

  -- 1) item frozen_* (products 라이브 → 동결)
  update promo.campaign_plan_option_items i
  set frozen_consumer_price = p.consumer_price,
      frozen_regular_price  = p.regular_price,
      frozen_cost           = p.cost,
      updated_at = now()
  from promo.products p
  where i.product_id = p.id
    and i.campaign_plan_option_id in (
      select id from promo.campaign_plan_options where campaign_plan_id = p_plan_id
    );

  -- 2) 옵션 롤업 (frozen 기준)
  update promo.campaign_plan_options o
  set set_price = agg.set_price,
      consumer_total = agg.consumer_total,
      regular_total = agg.regular_total,
      discount_rate_consumer = case when agg.consumer_total > 0 then 1 - agg.set_price/agg.consumer_total else null end,
      discount_rate_regular  = case when agg.regular_total  > 0 then 1 - agg.set_price/agg.regular_total  else null end,
      expected_revenue = agg.set_price * o.expected_option_qty,
      expected_contribution = (agg.set_price * v_mult - agg.cost_total) * o.expected_option_qty,
      updated_at = now()
  from (
    select i.campaign_plan_option_id as oid,
           sum(i.sku_qty_per_option * i.unit_sale_price)               as set_price,
           sum(i.sku_qty_per_option * coalesce(i.frozen_consumer_price,0)) as consumer_total,
           sum(i.sku_qty_per_option * coalesce(i.frozen_regular_price,0))  as regular_total,
           sum(i.sku_qty_per_option * coalesce(i.frozen_cost,0))          as cost_total
    from promo.campaign_plan_option_items i
    group by i.campaign_plan_option_id
  ) agg
  where o.id = agg.oid and o.campaign_plan_id = p_plan_id;

  -- 3) 플랜 합계
  select coalesce(sum(expected_revenue),0), coalesce(sum(expected_contribution),0)
  into v_rev_total, v_contrib_total
  from promo.campaign_plan_options where campaign_plan_id = p_plan_id;

  -- 4) 부분 유니크 충돌 방지: 같은 promotion 의 다른 current 먼저 해제
  update promo.campaign_plans
  set is_current = false, updated_at = now()
  where promotion_id = v_promo and is_current and id <> p_plan_id;

  -- 5) 이 플랜 동결·확정·current
  update promo.campaign_plans
  set status='confirmed', confirmed_at=now(), rate_card_id=v_rc.id,
      rate_card_snapshot=v_snapshot, expected_revenue_total=v_rev_total,
      expected_contribution_total=v_contrib_total, is_current=true, updated_at=now()
  where id = p_plan_id;
end;
$$;

-- ─────────────────────────────────────────────
-- clone_plan_as_draft: 현재 버전 복제 → 새 draft (version+1, is_current=false)
-- ─────────────────────────────────────────────
create or replace function promo.clone_plan_as_draft(p_plan_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_promo uuid;
  v_new_plan uuid;
  v_maxver int;
  r_opt record;
  v_new_opt uuid;
begin
  select promotion_id into v_promo from promo.campaign_plans where id = p_plan_id;
  if v_promo is null then raise exception 'plan % not found', p_plan_id; end if;

  select coalesce(max(version),0)+1 into v_maxver
  from promo.campaign_plans where promotion_id = v_promo;

  insert into promo.campaign_plans (promotion_id, version, is_current, status, notes)
  select promotion_id, v_maxver, false, 'draft', notes
  from promo.campaign_plans where id = p_plan_id
  returning id into v_new_plan;

  for r_opt in
    select * from promo.campaign_plan_options where campaign_plan_id = p_plan_id order by sort
  loop
    insert into promo.campaign_plan_options
      (campaign_plan_id, option_label, expected_option_qty, is_main, match_patterns, sort)
    values
      (v_new_plan, r_opt.option_label, r_opt.expected_option_qty, r_opt.is_main, r_opt.match_patterns, r_opt.sort)
    returning id into v_new_opt;

    insert into promo.campaign_plan_option_items
      (campaign_plan_option_id, product_id, base_name, sku_qty_per_option, unit_sale_price, source_config_id, sort)
    select v_new_opt, product_id, base_name, sku_qty_per_option, unit_sale_price, source_config_id, sort
    from promo.campaign_plan_option_items where campaign_plan_option_id = r_opt.id;
  end loop;

  return v_new_plan;
end;
$$;

grant all on all tables in schema promo to authenticated;
grant all on all sequences in schema promo to authenticated;
grant execute on all functions in schema promo to authenticated;
