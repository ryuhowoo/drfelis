-- 0044: N13 P2 — 리치 export 수용(옵션코드/구성/주문유형) + 광고비 입력 + 옵션 단위 공헌 분해
--
-- 설계: docs/design-structured-actual-options.md (Phase 2)
--
-- (1) promotion_sales: order_type(주문유형)·sale_option_code(옵션코드)·raw(원본행) 컬럼.
--     모두 선택(nullable) — 기존 업로드 안 깨짐. 있으면 양성신호/번들 식별에 사용.
-- (2) promotions.ad_spend: 캠페인 실제 광고비(상세에서 직접 입력). 공헌 분해의 광고비 배분 분모.
--     실제 전체 공헌이익은 기존 promotions.contribution_amount 재사용(라벨만 명확화).
-- (3) replace_promotion_sales: 신규 필드 수용 + 적재 후 rebuild_sale_options 자동 호출.
-- (4) rebuild_sale_options: 옵션코드가 있으면 그 단위로 묶어(번들 복원), 주문유형='subscription'을
--     export 양성신호로. 없으면 기존 (정규화 SKU, pack_size) 단일멤버 동작.
-- (5) sale_option_contribution(): 옵션 단위 실측 공헌 분해(매출−수수료−원가−물류−광고배분),
--     물류=매출×물류율(결정① 12% 유지), 광고=ad_spend×매출비중(없으면 광고율 폴백).

-- ── (1) 실적행 신규 컬럼 ──────────────────────────────────────────────────
alter table promo.promotion_sales
  add column if not exists order_type       text,   -- 'subscription' | 'onetime' | null
  add column if not exists sale_option_code text,   -- export 옵션코드
  add column if not exists raw              jsonb;  -- 원본 업로드 행(재파생/감사)

-- ── (2) 캠페인 실제 광고비 ────────────────────────────────────────────────
alter table promo.promotions
  add column if not exists ad_spend numeric;
comment on column promo.promotions.ad_spend is '캠페인 실제 광고비(직접 입력) — 옵션 공헌 분해의 광고비 배분 분모';
comment on column promo.promotions.contribution_amount is '기간 내 공식몰 전체 공헌이익액(정기구독 포함, 직접 입력) — 옵션 분해 합과 대조하는 ground truth';

-- ── (3) replace_promotion_sales: 신규 필드 + rebuild 자동 호출 ────────────────
create or replace function promo.replace_promotion_sales(
  p_promotion_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  delete from promo.promotion_sales where promotion_id = p_promotion_id;

  insert into promo.promotion_sales
    (promotion_id, product_id, base_name, option_info, revenue, order_count, aov, fee, cost, quantity,
     order_type, sale_option_code, raw)
  select p_promotion_id,
         nullif(r->>'product_id', '')::uuid,
         r->>'base_name',
         r->>'option_info',
         coalesce((r->>'revenue')::numeric, 0),
         (r->>'order_count')::numeric,
         (r->>'aov')::numeric,
         (r->>'fee')::numeric,
         (r->>'cost')::numeric,
         (r->>'quantity')::numeric,
         nullif(r->>'order_type', ''),
         nullif(r->>'sale_option_code', ''),
         r->'raw'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  get diagnostics n = row_count;

  -- 실적옵션 재구성(시그니처/구독/매칭) — 업로드 직후 일관 적용
  perform promo.rebuild_sale_options(p_promotion_id);
  return n;
end;
$$;

grant execute on function promo.replace_promotion_sales(uuid, jsonb) to authenticated;

-- ── (4) rebuild_sale_options: 옵션코드 묶음 + 주문유형 양성신호 ────────────────
create or replace function promo.rebuild_sale_options(p_promotion_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  update promo.promotion_sales set sale_option_id = null where promotion_id = p_promotion_id;
  delete from promo.promotion_sale_options where promotion_id = p_promotion_id;

  -- 행별 파생: 그룹키 = 옵션코드(있으면) 아니면 (정규화 SKU:pack) 합성키(=단일멤버)
  with src as (
    select ps.id,
      nullif(btrim(coalesce(ps.sale_option_code, '')), '') as code,
      promo.normalize_sku_name(coalesce(pr.base_name, ps.base_name)) as skey,
      coalesce(pr.base_name, ps.base_name) as bname,
      coalesce(ps.pack_size, 1) as pack,
      coalesce(pr.is_subscription, false) as prod_sub,
      coalesce(ps.option_info, '') ~ '(정기|구독)' as kw_sub,
      coalesce(ps.order_type = 'subscription', false) as ord_sub,  -- NULL 가드(order_type null)
      (regexp_match(coalesce(ps.option_info, ''), '([0-9]+)\s*개월'))[1]::int as term,
      ps.option_info, ps.revenue, ps.quantity, ps.cost, ps.fee, ps.order_count
    from promo.promotion_sales ps
    left join promo.products pr on pr.id = ps.product_id
    where ps.promotion_id = p_promotion_id
  ),
  keyed as (
    select *, coalesce(code, 'sig:' || skey || ':' || pack::text) as gkey from src
  ),
  members as (  -- 그룹별 멤버 시그니처(중복 SKU는 수량 합산)
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

  -- 연결: 옵션코드 있으면 코드로, 없으면 단일멤버 시그니처로
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

  -- 플랜 옵션 매칭(시그니처 동일 → 단일·다중 구성 모두)
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

-- ── (5) 옵션 단위 실측 공헌 분해 ──────────────────────────────────────────
-- 물류=매출×물류율(레이트카드, 평균 12% — 결정① 유지). 광고=ad_spend×(옵션매출/전체매출),
-- ad_spend 미입력 시 매출×광고율 폴백. 수수료·원가는 실측(sale_options 합산) 우선.
create or replace function promo.sale_option_contribution(p_id uuid)
returns table(
  sale_option_id uuid, label text, option_code text, is_subscription boolean,
  matched_plan_option_id uuid, plan_label text, match_source text,
  expected_revenue numeric, revenue numeric, fee numeric, cost numeric,
  logistics numeric, ad_alloc numeric, contribution numeric, contribution_rate numeric
)
language sql stable set search_path = ''
as $$
  with cfg as (
    select coalesce(fee_rate,0) fee_rate, coalesce(ad_rate,0) ad_rate,
           coalesce(logistics_rate,0) log_rate, coalesce(reward_rate,0) reward_rate
    from promo.rate_card where is_current = true
    order by effective_from desc limit 1
  ),
  promo_row as (
    select coalesce(ad_spend, 0) as ad_spend from promo.promotions where id = p_id
  ),
  tot as (select coalesce(sum(revenue),0) as total_rev from promo.promotion_sale_options where promotion_id = p_id),
  o as (
    select so.*, po.display_label as plan_label, po.expected_revenue
    from promo.promotion_sale_options so
    left join promo.campaign_plan_options po on po.id = so.matched_plan_option_id
    where so.promotion_id = p_id
  )
  select o.id, o.label, o.option_code, o.is_subscription,
    o.matched_plan_option_id, o.plan_label, o.match_source,
    o.expected_revenue, o.revenue,
    -- 수수료: 실측 fee 있으면 사용, 없으면 매출×수수료율
    case when o.fee > 0 then o.fee else o.revenue * (select fee_rate from cfg) end as fee,
    o.cost,
    o.revenue * (select log_rate from cfg) as logistics,
    -- 광고비: ad_spend 배분(매출비중), 미입력 시 매출×광고율
    case when (select ad_spend from promo_row) > 0 and (select total_rev from tot) > 0
         then (select ad_spend from promo_row) * o.revenue / (select total_rev from tot)
         else o.revenue * (select ad_rate from cfg) end as ad_alloc,
    o.revenue
      - (case when o.fee > 0 then o.fee else o.revenue * (select fee_rate from cfg) end)
      - o.cost
      - o.revenue * (select log_rate from cfg)
      - (case when (select ad_spend from promo_row) > 0 and (select total_rev from tot) > 0
              then (select ad_spend from promo_row) * o.revenue / (select total_rev from tot)
              else o.revenue * (select ad_rate from cfg) end) as contribution,
    case when o.revenue > 0 then (
      o.revenue
        - (case when o.fee > 0 then o.fee else o.revenue * (select fee_rate from cfg) end)
        - o.cost
        - o.revenue * (select log_rate from cfg)
        - (case when (select ad_spend from promo_row) > 0 and (select total_rev from tot) > 0
                then (select ad_spend from promo_row) * o.revenue / (select total_rev from tot)
                else o.revenue * (select ad_rate from cfg) end)
      ) / o.revenue else null end as contribution_rate
  from o
  order by o.revenue desc;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';

-- rebuild 로직이 0042 대비 바뀌었으니(옵션코드 묶음·주문유형 신호) 전 캠페인 재구성
do $$
declare r record;
begin
  for r in select id from promo.promotions loop
    perform promo.rebuild_sale_options(r.id);
  end loop;
end $$;
