-- 0047: 플랜(캠페인) 단위 조건부 쿠폰 — "N원 이상 n% 할인(최대 n원)"
--
-- 재설계 증분 2-2. campaign_plans에 쿠폰 3필드 추가. confirm_plan 롤업은 옵션 혜택가
-- (set_price)가 기준액 이상이면 정률 할인(상한 캡)한 net_price로 예상매출·공헌이익 계산.
-- lib/plan.ts computeOptionTotals/couponDiscount 와 식 동일. 쿠폰 없으면(rate=0) 무변.
-- set_price·discount_rate는 쿠폰 전(gross) 유지 — lib와 일치.

alter table promo.campaign_plans
  add column if not exists coupon_min_order numeric not null default 0,
  add column if not exists coupon_rate      numeric not null default 0,
  add column if not exists coupon_max        numeric not null default 0;

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
  v_cmin numeric;
  v_crate numeric;
  v_cmax numeric;
begin
  select promotion_id, coalesce(coupon_min_order,0), coalesce(coupon_rate,0), coalesce(coupon_max,0)
    into v_promo, v_cmin, v_crate, v_cmax
  from promo.campaign_plans where id = p_plan_id;
  if v_promo is null then
    raise exception 'plan % not found', p_plan_id;
  end if;

  select count(*) into v_opt_count
  from promo.campaign_plan_options
  where campaign_plan_id = p_plan_id and expected_option_qty > 0;
  if v_opt_count = 0 then
    raise exception '확정하려면 예상 세트수가 1 이상인 옵션이 최소 1개 필요합니다';
  end if;

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

  -- 2) 옵션 롤업 (frozen 기준) — 쿠폰 적용 net_price로 매출/공헌
  update promo.campaign_plan_options o
  set set_price = agg.set_price,
      consumer_total = agg.consumer_total,
      regular_total = agg.regular_total,
      discount_rate_consumer = case when agg.consumer_total > 0 then 1 - agg.set_price/agg.consumer_total else null end,
      discount_rate_regular  = case when agg.regular_total  > 0 then 1 - agg.set_price/agg.regular_total  else null end,
      expected_revenue = agg.net_price * o.expected_option_qty,
      expected_contribution = (agg.net_price * v_mult - agg.cost_total) * o.expected_option_qty,
      updated_at = now()
  from (
    select a.oid, a.set_price, a.consumer_total, a.regular_total, a.cost_total,
           a.set_price - (
             case when v_crate > 0 and a.set_price >= v_cmin
                  then round(least(a.set_price * v_crate,
                                   case when v_cmax > 0 then v_cmax else a.set_price * v_crate end))
                  else 0 end
           ) as net_price
    from (
      select i.campaign_plan_option_id as oid,
             sum(i.sku_qty_per_option * i.unit_sale_price)                   as set_price,
             sum(i.sku_qty_per_option * coalesce(i.frozen_consumer_price,0)) as consumer_total,
             sum(i.sku_qty_per_option * coalesce(i.frozen_regular_price,0))  as regular_total,
             sum(i.sku_qty_per_option * coalesce(i.frozen_cost,0))           as cost_total
      from promo.campaign_plan_option_items i
      group by i.campaign_plan_option_id
    ) a
  ) agg
  where o.id = agg.oid and o.campaign_plan_id = p_plan_id;

  -- 3) 플랜 합계
  select coalesce(sum(expected_revenue),0), coalesce(sum(expected_contribution),0)
  into v_rev_total, v_contrib_total
  from promo.campaign_plan_options where campaign_plan_id = p_plan_id;

  -- 4) 같은 promotion 의 다른 current 해제
  update promo.campaign_plans
  set is_current = false, updated_at = now()
  where promotion_id = v_promo and is_current and id <> p_plan_id;

  -- 5) 동결·확정·current
  update promo.campaign_plans
  set status='confirmed', confirmed_at=now(), rate_card_id=v_rc.id,
      rate_card_snapshot=v_snapshot, expected_revenue_total=v_rev_total,
      expected_contribution_total=v_contrib_total, is_current=true, updated_at=now()
  where id = p_plan_id;
end;
$$;

-- clone: 쿠폰 필드도 새 draft로 복제
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

  insert into promo.campaign_plans
    (promotion_id, version, is_current, status, notes, coupon_min_order, coupon_rate, coupon_max)
  select promotion_id, v_maxver, false, 'draft', notes, coupon_min_order, coupon_rate, coupon_max
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

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
