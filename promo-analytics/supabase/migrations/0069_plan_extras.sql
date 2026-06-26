-- 0069: 사은품・다중 추가 할인 쿠폰 (플랜 단위 extras)
--
-- 한 캠페인에서 추가 할인 쿠폰을 2~3개까지 중첩 적용(정률/정액)하거나, 사은품을 동봉할 수 있다.
-- campaign_plans.extras(jsonb 배열)에 원본을 저장하고, 확정 롤업도 동일하게 계산한다.
--   · 쿠폰: { type:'coupon', kind:'rate'|'flat', min, ratePct, max, flat, label }
--   · 사은품: { type:'freebie', product_id, base_name, qty, cost }
-- 쿠폰은 기준액(min)을 옵션 혜택가(set_price, gross)로 게이팅하고 입력 순서대로 중첩(정률은 직전
-- 차감 후 running price 기준). 사은품은 동봉 발송이라 물류비·광고비 없이 원가×수량만 공헌이익에서 차감.
-- lib/plan.ts(stackedCoupons/freebieDeduction)와 식 동일. extras 가 비면 레거시 단일 쿠폰(coupon_*)으로 폴백.

alter table promo.campaign_plans
  add column if not exists extras jsonb not null default '[]'::jsonb;

-- 다중 쿠폰 중첩 적용 → 총 할인액 (입력 순서, 기준액은 gross set_price 로 게이팅)
create or replace function promo.apply_extras_coupons(p_set_price numeric, p_extras jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb;
  running numeric := p_set_price;
  d numeric;
  kind text;
  minord numeric;
  rate numeric;
  maxd numeric;
  flat numeric;
begin
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then
    return 0;
  end if;
  for c in select value from jsonb_array_elements(p_extras) where value->>'type' = 'coupon'
  loop
    minord := coalesce((c->>'min')::numeric, 0);
    if p_set_price < minord then
      continue;
    end if;
    kind := coalesce(c->>'kind', 'rate');
    if kind = 'flat' then
      flat := coalesce((c->>'flat')::numeric, 0);
      d := least(flat, running);
    else
      rate := coalesce((c->>'ratePct')::numeric, 0) / 100.0;
      if rate <= 0 then
        continue;
      end if;
      maxd := coalesce((c->>'max')::numeric, 0);
      d := running * rate;
      if maxd > 0 then
        d := least(d, maxd);
      end if;
      d := least(d, running);
    end if;
    d := round(greatest(d, 0));
    running := running - d;
  end loop;
  return p_set_price - running;
end;
$$;

-- 사은품 총 차감액 = Σ(원가 × 수량)
create or replace function promo.extras_freebie_total(p_extras jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(
           round(coalesce((value->>'cost')::numeric, 0)) * coalesce((value->>'qty')::numeric, 0)
         ), 0)
  from jsonb_array_elements(
    case when p_extras is null or jsonb_typeof(p_extras) <> 'array' then '[]'::jsonb else p_extras end
  )
  where value->>'type' = 'freebie';
$$;

-- confirm_plan: 다중 쿠폰(extras) + 사은품 차감 반영 (없으면 레거시 단일 쿠폰)
create or replace function promo.confirm_plan(p_plan_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  v_promo uuid;
  v_rc record;
  v_fee numeric;
  v_mult numeric;
  v_snapshot jsonb;
  v_opt_count int;
  v_bad_opt int;
  v_rev_total numeric;
  v_contrib_total numeric;
  v_cmin numeric;
  v_crate numeric;
  v_cmax numeric;
  v_extras jsonb;
  v_has_extra_coupon boolean;
begin
  select promotion_id, coalesce(coupon_min_order,0), coalesce(coupon_rate,0), coalesce(coupon_max,0),
         coalesce(extras, '[]'::jsonb)
    into v_promo, v_cmin, v_crate, v_cmax, v_extras
  from promo.campaign_plans where id = p_plan_id;
  if v_promo is null then
    raise exception 'plan % not found', p_plan_id;
  end if;

  v_has_extra_coupon := exists (
    select 1 from jsonb_array_elements(v_extras) where value->>'type' = 'coupon'
  );

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
  select cf.fee_rate into v_fee
  from promo.promotions pr
  left join promo.channel_fees cf on cf.channel = pr.channel
  where pr.id = v_promo;
  v_fee := coalesce(v_fee, v_rc.fee_rate);
  v_mult := 1 - (v_fee + v_rc.ad_rate + v_rc.logistics_rate + v_rc.reward_rate);
  v_snapshot := jsonb_build_object(
    'fee_rate', v_fee, 'ad_rate', v_rc.ad_rate,
    'logistics_rate', v_rc.logistics_rate, 'reward_rate', v_rc.reward_rate,
    'mult', v_mult, 'rate_card_id', v_rc.id, 'snapped_at', now()
  );

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
             case
               when v_has_extra_coupon then promo.apply_extras_coupons(a.set_price, v_extras)
               when v_crate > 0 and a.set_price >= v_cmin
                 then round(least(a.set_price * v_crate,
                                  case when v_cmax > 0 then v_cmax else a.set_price * v_crate end))
               else 0
             end
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

  select coalesce(sum(expected_revenue),0), coalesce(sum(expected_contribution),0)
  into v_rev_total, v_contrib_total
  from promo.campaign_plan_options where campaign_plan_id = p_plan_id;

  -- 사은품 동봉 차감 (원가×수량) — 플랜 단위 공헌이익에서 일괄 차감
  v_contrib_total := v_contrib_total - promo.extras_freebie_total(v_extras);

  update promo.campaign_plans
  set is_current = false, updated_at = now()
  where promotion_id = v_promo and is_current and id <> p_plan_id;

  update promo.campaign_plans
  set status='confirmed', confirmed_at=now(), rate_card_id=v_rc.id,
      rate_card_snapshot=v_snapshot, expected_revenue_total=v_rev_total,
      expected_contribution_total=v_contrib_total, is_current=true, updated_at=now()
  where id = p_plan_id;
end;
$function$;

-- clone: extras(사은품・쿠폰)도 새 draft로 복제
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
    (promotion_id, version, is_current, status, notes, coupon_min_order, coupon_rate, coupon_max, extras)
  select promotion_id, v_maxver, false, 'draft', notes, coupon_min_order, coupon_rate, coupon_max, coalesce(extras,'[]'::jsonb)
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
