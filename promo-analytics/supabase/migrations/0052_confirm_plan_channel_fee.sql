-- 0052: 확정 시 채널 수수료를 공헌이익 mult에 반영 (피드백 8 — 2단계)
--
-- confirm_plan 이 mult 동결 시, 캠페인 채널의 수수료(channel_fees)가 있으면 그것으로,
-- 없으면 레이트카드 fee_rate 를 쓴다. 채널이 모두 동일값으로 시드된 상태에서는 동작 불변.
-- (현재 운영본 정의 그대로 + v_fee override 만 추가)

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
  -- 채널 수수료 override: 캠페인 채널의 수수료가 있으면 그것으로, 없으면 레이트카드 fee
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

  select coalesce(sum(expected_revenue),0), coalesce(sum(expected_contribution),0)
  into v_rev_total, v_contrib_total
  from promo.campaign_plan_options where campaign_plan_id = p_plan_id;

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
