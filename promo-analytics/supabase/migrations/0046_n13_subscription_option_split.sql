-- 0046: N13 — 실적옵션 롤업에서 정기배송 라인을 일반판매와 분리 (bool_or 오염 수정)
--
-- 버그: rebuild_sale_options는 sale_option_code가 없으면 (정규화SKU, pack)만으로 그룹핑하는데,
--   같은 품목이 '[정기배송] …4개입'과 일반 '…4개' 둘 다로 팔리면 signature가 동일해 한 그룹으로
--   묶이고, is_subscription = bool_or(kw_sub) 때문에 그룹 전체(=일반판매 포함)가 구독으로 오분류됨.
--   예) CF_P_251208 펠리스샌드 마스터 4.3kg: 진짜 정기배송 257,600원인데 26,863,508원으로 집계.
--
-- 수정: 그룹 키(gkey)에 구독 구분자(:sub)를 추가해 정기배송 라인을 독립 옵션으로 분리.
--   → 정기배송 라인만 is_subscription=true(실제 매출), 일반 라인은 분리·정상 집계.
--   plan_vs_actual_summary는 이미 행 단위라 영향 없음(이 수정은 promotion_sale_options 정합).

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
      promo.is_subscription_positive(ps.option_info) as kw_sub,
      coalesce(ps.order_type = 'subscription', false) as ord_sub,
      (regexp_match(coalesce(ps.option_info, ''), '([0-9]+)\s*개월'))[1]::int as term,
      ps.option_info, ps.revenue, ps.quantity, ps.cost, ps.fee, ps.order_count
    from promo.promotion_sales ps
    left join promo.products pr on pr.id = ps.product_id
    where ps.promotion_id = p_promotion_id
  ),
  keyed as (
    -- 코드가 없으면 (SKU,pack)로 묶되, 구독 신호가 있는 줄은 별도 그룹(:sub)으로 분리해
    -- 같은 품목의 정기배송/일반판매가 한 옵션으로 합쳐지지 않게 한다.
    select *, coalesce(
      code,
      'sig:' || skey || ':' || pack::text
        || case when (kw_sub or ord_sub or prod_sub) then ':sub' else '' end
    ) as gkey from src
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

  -- 코드 없는 줄: (SKU,pack) signature + 구독여부가 같은 옵션으로 연결
  update promo.promotion_sales ps
     set sale_option_id = o.id
    from promo.promotion_sale_options o
   where ps.promotion_id = p_promotion_id and o.promotion_id = p_promotion_id
     and ps.sale_option_id is null and o.option_code is null
     and o.is_subscription = (
           promo.is_subscription_positive(ps.option_info)
           or coalesce(ps.order_type = 'subscription', false)
           or coalesce((select is_subscription from promo.products where id = ps.product_id), false))
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
     and po.match_signature is not null and po.match_signature = o.match_signature
     and not o.is_subscription;   -- 구독 라인은 플랜 달성에 매칭하지 않음

  update promo.promotion_sale_options o
     set match_source = 'none'
   where o.promotion_id = p_promotion_id and o.matched_plan_option_id is null and o.match_source is null;

  return n;
end;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';

do $$
declare r record;
begin
  for r in select id from promo.promotions loop
    perform promo.rebuild_sale_options(r.id);
  end loop;
end $$;

select promo.refresh_rollups(true);
