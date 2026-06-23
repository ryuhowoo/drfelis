-- 0049: '플랜 불러오기'(item 12) — 저장된 플랜의 옵션+SKU 구성을 편집 가능한 형태로 반환.
--
-- 다른 캠페인(또는 다른 버전)에서 짠 플랜을 그대로 복제해 현재 작성 중인 플랜에 옵션을 채운다.
-- 클라이언트가 setOptions로 append → '함께 구매 추정'을 대체. econ은 frozen_* 우선, 없으면 products.

create or replace function promo.plan_editable(p_plan_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(opt order by opt_sort), '[]'::jsonb)
  from (
    select o.sort as opt_sort,
      jsonb_build_object(
        'option_label', o.option_label,
        'expected_option_qty', o.expected_option_qty,
        'is_main', o.is_main,
        'match_patterns', coalesce(o.match_patterns, '{}'::text[]),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'product_id', it.product_id,
            'base_name', it.base_name,
            'sku_qty_per_option', it.sku_qty_per_option,
            'unit_sale_price', it.unit_sale_price,
            'source_config_id', null,
            'consumer_price', coalesce(it.frozen_consumer_price, pr.consumer_price),
            'regular_price', coalesce(it.frozen_regular_price, pr.regular_price),
            'cost', coalesce(it.frozen_cost, pr.cost)
          ) order by it.sort)
          from promo.campaign_plan_option_items it
          left join promo.products pr on pr.id = it.product_id
          where it.campaign_plan_option_id = o.id
        ), '[]'::jsonb)
      ) as opt
    from promo.campaign_plan_options o
    where o.campaign_plan_id = p_plan_id
  ) s;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
