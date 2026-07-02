-- 0079: 쿠폰 중복(스택) 규칙 + 자사 부담율 (공헌이익 정확도)
--
-- 1) 중복 규칙: extras 쿠폰에 group(유형)·stackSame·burdenPct 필드 추가(스키마 변경 없음, jsonb).
--    · group 이 비면 독립 → 항상 중첩
--    · 같은 group 이 여럿이고 모두 stackSame → 모두 중첩(금액대별 발행 케이스)
--    · 그 외 같은 group → 조건 충족 중 '가장 큰 할인' 1개만
-- 2) 부담율: 매출은 전체 할인 반영(고객 결제가), 공헌이익만 자사 부담분(할인×부담율)으로 보정.
--    네이버 등 채널 부담 쿠폰은 공헌이익에서 덜 깎인다. 부담율 기본 100%면 기존과 동일.
-- lib/plan.ts(selectSurvivors/stackedCoupons/computeOptionTotals)와 식 동일.

-- 중복 규칙 적용 후 [customer(고객 할인총액), our(자사 부담 할인총액)] 반환
create or replace function promo.apply_extras_coupons_v2(p_set_price numeric, p_extras jsonb)
returns table(customer numeric, our numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  n int;
  i int;
  j int;
  kinds text[] := '{}';
  mins numeric[] := '{}';
  rates numeric[] := '{}';
  maxs numeric[] := '{}';
  flats numeric[] := '{}';
  grps text[] := '{}';
  stacks boolean[] := '{}';
  burdens numeric[] := '{}';
  standalone numeric[];
  survive boolean[];
  c jsonb;
  running numeric;
  d numeric;
  cust numeric := 0;
  ourt numeric := 0;
  g text;
  all_stack boolean;
  best int;
  best_amt numeric;
begin
  customer := 0;
  our := 0;
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then
    return next;
    return;
  end if;

  for c in select value from jsonb_array_elements(p_extras) where value->>'type' = 'coupon'
  loop
    kinds   := kinds   || coalesce(c->>'kind', 'rate');
    mins    := mins    || coalesce((c->>'min')::numeric, 0);
    rates   := rates   || (coalesce((c->>'ratePct')::numeric, 0) / 100.0);
    maxs    := maxs    || coalesce((c->>'max')::numeric, 0);
    flats   := flats   || coalesce((c->>'flat')::numeric, 0);
    grps    := grps    || btrim(coalesce(c->>'group', ''));
    stacks  := stacks  || coalesce((c->>'stackSame')::boolean, false);
    burdens := burdens || least(1, greatest(0, coalesce((c->>'burdenPct')::numeric, 100) / 100.0));
  end loop;

  n := coalesce(array_length(kinds, 1), 0);
  if n = 0 then
    return next;
    return;
  end if;

  -- gross set_price 기준 단독 할인액 (동일유형 '가장 큰 할인' 선택 기준, min 게이팅)
  standalone := array_fill(0::numeric, array[n]);
  survive := array_fill(false, array[n]);
  for i in 1..n loop
    if p_set_price >= mins[i] then
      if kinds[i] = 'flat' then
        d := least(flats[i], p_set_price);
      elsif rates[i] > 0 then
        d := p_set_price * rates[i];
        if maxs[i] > 0 then d := least(d, maxs[i]); end if;
        d := least(d, p_set_price);
      else
        d := 0;
      end if;
      standalone[i] := round(greatest(d, 0));
    end if;
  end loop;

  -- 독립(그룹 미지정)은 항상 적용
  for i in 1..n loop
    if grps[i] = '' then survive[i] := true; end if;
  end loop;

  -- 각 그룹을 첫 등장 지점에서 한 번만 처리
  for i in 1..n loop
    g := grps[i];
    if g = '' then continue; end if;
    if exists (select 1 from generate_series(1, i - 1) k(idx) where grps[k.idx] = g) then
      continue;
    end if;
    all_stack := true;
    for j in 1..n loop
      if grps[j] = g and not stacks[j] then all_stack := false; end if;
    end loop;
    if all_stack then
      for j in 1..n loop
        if grps[j] = g then survive[j] := true; end if;
      end loop;
    else
      best := 0;
      best_amt := 0;
      for j in 1..n loop
        if grps[j] = g and standalone[j] > best_amt then
          best_amt := standalone[j];
          best := j;
        end if;
      end loop;
      if best > 0 then survive[best] := true; end if;
    end if;
  end loop;

  -- 살아남은 쿠폰만 입력 순서로 순차 중첩(정률은 running 기준)
  running := p_set_price;
  for i in 1..n loop
    if not survive[i] then continue; end if;
    if p_set_price < mins[i] then continue; end if;
    if kinds[i] = 'flat' then
      d := least(flats[i], running);
    elsif rates[i] > 0 then
      d := running * rates[i];
      if maxs[i] > 0 then d := least(d, maxs[i]); end if;
      d := least(d, running);
    else
      d := 0;
    end if;
    d := round(greatest(d, 0));
    running := running - d;
    cust := cust + d;
    ourt := ourt + d * burdens[i];
  end loop;

  customer := cust;
  our := ourt;
  return next;
end;
$$;

-- confirm_plan: 매출=고객 할인(customer), 공헌이익=자사 부담 할인(our) 기준
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
      expected_revenue = (agg.set_price - agg.cust_disc) * o.expected_option_qty,
      expected_contribution = ((agg.set_price - agg.our_disc) * v_mult - agg.cost_total) * o.expected_option_qty,
      updated_at = now()
  from (
    select a.oid, a.set_price, a.consumer_total, a.regular_total, a.cost_total,
           cp.cust_disc, cp.our_disc
    from (
      select i.campaign_plan_option_id as oid,
             sum(i.sku_qty_per_option * i.unit_sale_price)                   as set_price,
             sum(i.sku_qty_per_option * coalesce(i.frozen_consumer_price,0)) as consumer_total,
             sum(i.sku_qty_per_option * coalesce(i.frozen_regular_price,0))  as regular_total,
             sum(i.sku_qty_per_option * coalesce(i.frozen_cost,0))           as cost_total
      from promo.campaign_plan_option_items i
      group by i.campaign_plan_option_id
    ) a
    cross join lateral (
      select
        case when v_has_extra_coupon then v2.customer
             when v_crate > 0 and a.set_price >= v_cmin
               then round(least(a.set_price * v_crate, case when v_cmax > 0 then v_cmax else a.set_price * v_crate end))
             else 0 end as cust_disc,
        case when v_has_extra_coupon then v2.our
             when v_crate > 0 and a.set_price >= v_cmin
               then round(least(a.set_price * v_crate, case when v_cmax > 0 then v_cmax else a.set_price * v_crate end))
             else 0 end as our_disc
      from promo.apply_extras_coupons_v2(a.set_price, v_extras) v2
    ) cp
  ) agg
  where o.id = agg.oid and o.campaign_plan_id = p_plan_id;

  select coalesce(sum(expected_revenue),0), coalesce(sum(expected_contribution),0)
  into v_rev_total, v_contrib_total
  from promo.campaign_plan_options where campaign_plan_id = p_plan_id;

  -- 사은품 동봉 차감 (원가×수량)
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

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
