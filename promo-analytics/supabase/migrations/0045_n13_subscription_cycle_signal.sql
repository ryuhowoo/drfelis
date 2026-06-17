-- 0045: N13 — 구독 신호를 '배송주기(주/격주/주기) + 주문유형'까지 확장 (소진기간 '개월'은 제외)
--
-- 사용자 확인(2026-06-17): '2박스(1개월)'은 소진기간(2박스=30개=1개월분) 표기일 뿐 구독 아님.
--   같은 옵션이 캠페인용·정기배송에 함께 쓰이므로, 구독 식별은 '개월'이 아니라
--   (1) 주문유형(정기/일반) 또는 (2) 배송주기 신호(2주/4주/격주/주기/배송주기)로 해야 함.
--   → is_subscription_positive를 배송주기 패턴까지 인식하도록 확장(‘개월’ 단독은 여전히 제외).
--   → plan_vs_actual_summary는 promotion_sales.order_type='subscription'도 양성신호로 결합.
--
-- 주의: 월 단위 주기(1개월/2개월)는 자유텍스트에서 소진기간과 구분 불가 → 그 경우는 반드시
--   주문유형 컬럼으로만 판별(텍스트 '개월'은 구독으로 보지 않음). 현 데이터엔 주기/주문유형
--   신호가 0건이라 수치 변화는 없고, 향후 리치 export 적재 시 자동 정확 분류되는 토대.

-- ── 헬퍼 확장: 정기/구독 키워드 + 배송주기(주 단위/격주/주기) ───────────────────
create or replace function promo.is_subscription_positive(option_info text)
returns boolean language sql immutable parallel safe set search_path = ''
as $$
  -- 양성: '정기'·'구독'·'격주'·'배송주기'·'주기' 또는 'N주'(2주/4주 등 주 단위 배송주기).
  -- 제외: 'N개월'(소진기간) 단독 — 월 단위 주기는 주문유형(order_type)으로만 판별.
  select coalesce(option_info, '') ~ '(정기|구독|격주|배송주기|주기|[0-9]+ *주)';
$$;

-- ── plan_vs_actual_summary: is_sub에 order_type='subscription' 결합 (반환 시그니처 0043과 동일) ──
create or replace function promo.plan_vs_actual_summary(p_id uuid)
returns table(
  has_confirmed_plan boolean,
  expected_revenue_total numeric, actual_revenue_total numeric, ach_revenue numeric,
  expected_qty_total numeric, actual_qty_total numeric, ach_qty numeric,
  expected_contribution_total numeric, actual_contribution_total numeric, ach_contribution numeric,
  unplanned_revenue numeric, unplanned_qty numeric, unplanned_contribution numeric,
  matched_sku_count integer, unsold_sku_count integer, unplanned_sku_count integer,
  quantity_reliable boolean, snapshot_mult numeric,
  subscription_revenue numeric, main_revenue numeric, halo_revenue numeric,
  campaign_revenue_total numeric, revenue_ach_total numeric,
  contribution_total numeric, contribution_ach_total numeric,
  main_nonsub_qty numeric, main_subscription_qty numeric
)
language plpgsql stable set search_path to ''
as $function$
declare
  v_has boolean; v_mult numeric; v_plan_id uuid; v_actual_pid uuid; v_main uuid[];
begin
  select true, (rate_card_snapshot->>'mult')::numeric, id,
         coalesce(actual_promotion_id, promotion_id), main_product_ids
    into v_has, v_mult, v_plan_id, v_actual_pid, v_main
  from promo.campaign_plans
  where promotion_id = p_id and is_current and status = 'confirmed' limit 1;

  if not coalesce(v_has, false) then
    return query select false,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::int, null::int, null::int, null::boolean, null::numeric,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric;
    return;
  end if;

  return query
  with rows as (select * from promo.plan_vs_actual(p_id)),
  exp_rows as (select * from rows where status in ('matched','unsold')),
  unp_rows as (select * from rows where status = 'unplanned'),
  main_keys as (
    select distinct promo.normalize_sku_name(pr.base_name) as k
    from promo.campaign_plan_option_items i
    join promo.campaign_plan_options o on o.id = i.campaign_plan_option_id
    join promo.products pr on pr.id = i.product_id
    where o.campaign_plan_id = v_plan_id and (v_main is null or i.product_id = any(v_main))
  ),
  plan_keys as (
    select distinct promo.normalize_sku_name(pr.base_name) as k
    from promo.campaign_plan_option_items i
    join promo.campaign_plan_options o on o.id = i.campaign_plan_option_id
    join promo.products pr on pr.id = i.product_id
    where o.campaign_plan_id = v_plan_id
  ),
  sales as (
    select ps.revenue, coalesce(ps.cost,0) as cost, coalesce(ps.quantity,0) as qty,
      -- 양성신호: 주문유형(정기) OR 텍스트 신호(정기/구독/주기) OR 제품 플래그
      (ps.order_type = 'subscription'
        or coalesce(pr.is_subscription, false)
        or promo.is_subscription_positive(ps.option_info)) as is_sub,
      (promo.normalize_sku_name(pr.base_name) in (select k from main_keys)) as is_main,
      (promo.normalize_sku_name(pr.base_name) in (select k from plan_keys)) as in_plan
    from promo.promotion_sales ps
    left join promo.products pr on pr.id = ps.product_id
    where ps.promotion_id = v_actual_pid
  ),
  agg as (
    select
      coalesce(sum(revenue) filter (where is_sub), 0) as sub_rev,
      coalesce(sum(revenue) filter (where is_main and not is_sub), 0) as main_rev,
      coalesce(sum(revenue) filter (where not is_main and not is_sub), 0) as halo_rev,
      coalesce(sum(revenue) filter (where not is_sub), 0) as total_rev,
      coalesce(sum(cost) filter (where not is_sub), 0) as total_cost,
      coalesce(sum(qty) filter (where not is_sub and in_plan), 0) as main_nonsub_qty,
      coalesce(sum(qty) filter (where is_sub and in_plan), 0) as main_subscription_qty
    from sales
  ),
  e as (
    select coalesce(sum(expected_revenue),0) exp_rev, coalesce(sum(actual_revenue),0) act_rev,
      coalesce(sum(expected_qty),0) exp_qty, coalesce(sum(actual_qty),0) act_qty,
      coalesce(sum(expected_contribution),0) exp_contrib, coalesce(sum(actual_contribution),0) act_contrib
    from exp_rows
  )
  select true,
    e.exp_rev, e.act_rev,
    case when e.exp_rev > 0 then e.act_rev/e.exp_rev else null end,
    e.exp_qty, e.act_qty,
    case when e.exp_qty > 0 then e.act_qty/e.exp_qty else null end,
    e.exp_contrib, e.act_contrib,
    case when e.exp_contrib > 0 then e.act_contrib/e.exp_contrib else null end,
    (select coalesce(sum(actual_revenue),0) from unp_rows),
    (select coalesce(sum(actual_qty),0) from unp_rows),
    (select coalesce(sum(actual_contribution),0) from unp_rows),
    (select count(*)::int from rows where status = 'matched'),
    (select count(*)::int from rows where status = 'unsold'),
    (select count(*)::int from unp_rows),
    (e.act_qty > 0), v_mult,
    a.sub_rev, a.main_rev, a.halo_rev, a.total_rev,
    case when e.exp_rev > 0 then a.total_rev/e.exp_rev else null end,
    (a.total_rev * v_mult - a.total_cost),
    case when e.exp_contrib > 0 then (a.total_rev * v_mult - a.total_cost)/e.exp_contrib else null end,
    a.main_nonsub_qty, a.main_subscription_qty
  from e, agg a;
end;
$function$;

-- ── rebuild_sale_options: kw_sub를 헬퍼로 교체(주기 신호 인식). 나머지는 0044와 동일 ──
create or replace function promo.rebuild_sale_options(p_promotion_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  update promo.promotion_sales set sale_option_id = null where promotion_id = p_promotion_id;
  delete from promo.promotion_sale_options where promotion_id = p_promotion_id;

  with src as (
    select ps.id,
      nullif(btrim(coalesce(ps.sale_option_code, '')), '') as code,
      promo.normalize_sku_name(coalesce(pr.base_name, ps.base_name)) as skey,
      coalesce(pr.base_name, ps.base_name) as bname,
      coalesce(ps.pack_size, 1) as pack,
      coalesce(pr.is_subscription, false) as prod_sub,
      promo.is_subscription_positive(ps.option_info) as kw_sub,   -- 정기/구독/주기
      coalesce(ps.order_type = 'subscription', false) as ord_sub,
      (regexp_match(coalesce(ps.option_info, ''), '([0-9]+)\s*개월'))[1]::int as term,
      ps.option_info, ps.revenue, ps.quantity, ps.cost, ps.fee, ps.order_count
    from promo.promotion_sales ps
    left join promo.products pr on pr.id = ps.product_id
    where ps.promotion_id = p_promotion_id
  ),
  keyed as (
    select *, coalesce(code, 'sig:' || skey || ':' || pack::text) as gkey from src
  ),
  members as (
    select gkey,
      promo.match_signature(jsonb_agg(distinct jsonb_build_object('k', skey, 'q', pack))) as sig
    from keyed group by gkey
  ),
  grp as (
    select k.gkey,
      max(k.code) as code,
      (array_agg(k.bname order by k.revenue desc nulls last))[1] as label,
      (array_agg(promo.normalize_option_info(k.option_info) order by k.revenue desc nulls last))[1] as label_raw,
      (array_agg(k.pack order by k.revenue desc nulls last))[1] as pack,
      bool_or(k.prod_sub) as prod_sub, bool_or(k.kw_sub) as kw_sub, bool_or(k.ord_sub) as ord_sub,
      max(k.term) as term,
      sum(coalesce(k.revenue,0)) rev, sum(coalesce(k.quantity,0)) qty,
      sum(coalesce(k.cost,0)) cost, sum(coalesce(k.fee,0)) fee, sum(coalesce(k.order_count,0)) oc
    from keyed k group by k.gkey
  )
  insert into promo.promotion_sale_options
    (promotion_id, option_code, label, label_raw, match_signature, pack_size, term_months,
     is_subscription, sub_source, revenue, quantity, cost, fee, order_count)
  select p_promotion_id, g.code, g.label, g.label_raw, m.sig, g.pack, g.term,
    coalesce(g.prod_sub or g.kw_sub or g.ord_sub, false),
    case when g.ord_sub then 'export' when g.prod_sub then 'product'
         when g.kw_sub then 'derived' else null end,
    g.rev, g.qty, g.cost, g.fee, g.oc
  from grp g join members m on m.gkey = g.gkey;

  get diagnostics n = row_count;

  update promo.promotion_sales ps
     set sale_option_id = o.id
    from promo.promotion_sale_options o
   where ps.promotion_id = p_promotion_id and o.promotion_id = p_promotion_id
     and o.option_code is not null
     and o.option_code = nullif(btrim(coalesce(ps.sale_option_code, '')), '');

  update promo.promotion_sales ps
     set sale_option_id = o.id
    from promo.promotion_sale_options o
   where ps.promotion_id = p_promotion_id and o.promotion_id = p_promotion_id
     and ps.sale_option_id is null and o.option_code is null
     and o.match_signature = promo.match_signature(jsonb_build_array(jsonb_build_object(
           'k', promo.normalize_sku_name(coalesce(
                  (select base_name from promo.products where id = ps.product_id), ps.base_name)),
           'q', coalesce(ps.pack_size, 1))));

  update promo.promotion_sale_options o
     set matched_plan_option_id = po.id, match_source = 'signature', match_confidence = 1.0
    from promo.campaign_plans cp
    join promo.campaign_plan_options po on po.campaign_plan_id = cp.id
   where o.promotion_id = p_promotion_id
     and coalesce(cp.actual_promotion_id, cp.promotion_id) = p_promotion_id
     and cp.is_current and cp.status = 'confirmed'
     and po.match_signature is not null and po.match_signature = o.match_signature;

  update promo.promotion_sale_options o
     set match_source = 'none'
   where o.promotion_id = p_promotion_id and o.matched_plan_option_id is null and o.match_source is null;

  return n;
end;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';

-- 헬퍼 변경 반영: 전 캠페인 재구성 + 롤업 갱신
do $$
declare r record;
begin
  for r in select id from promo.promotions loop
    perform promo.rebuild_sale_options(r.id);
  end loop;
end $$;

select promo.refresh_rollups(true);
