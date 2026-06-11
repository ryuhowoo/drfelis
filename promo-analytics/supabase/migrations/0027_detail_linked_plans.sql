-- 0027: 상세 번들에 역링크 추가 — 이 캠페인을 '비교 대상 실적'으로 쓰는 플랜 목록.
-- 실적 캠페인 상세에서 "플랜은 저쪽에 있다"를 안내해 멘탈 모델 분열 해소.
-- (플랜 ↔ 실적이 서로 다른 캠페인일 때, 실적 쪽 SKU 진단이 '실적만 N'으로만
--  보이던 혼란의 원인 — 진단·매칭은 플랜이 붙은 캠페인에서 수행해야 함)
create or replace function promo.promotion_detail_bundle(p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare result jsonb;
begin
  perform promo.ensure_rollups_fresh();
  select jsonb_build_object(
    'promo',  (select to_jsonb(p.*) from promo.promotions p where p.id = p_id),
    'rollup', (select to_jsonb(r.*) from promo.campaign_rollups r where r.promotion_id = p_id),
    'notes',
      (select coalesce(jsonb_agg(to_jsonb(n.*) order by n.created_at desc), '[]'::jsonb)
       from promo.promotion_notes n where n.promotion_id = p_id),
    'plan',
      (select to_jsonb(cp.*) from promo.campaign_plans cp
       where cp.promotion_id = p_id and cp.is_current limit 1),
    'linked_plans',
      coalesce((select jsonb_agg(jsonb_build_object(
         'plan_id', pl.id,
         'code', pl.code,
         'name', coalesce(pl.name, pr2.name, pl.code),
         'promotion_id', pl.promotion_id))
       from promo.campaign_plans pl
       left join promo.promotions pr2 on pr2.id = pl.promotion_id
       where pl.is_current and pl.actual_promotion_id = p_id), '[]'::jsonb),
    'candidates',
      (select coalesce(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb)
       from promo.campaigns_with_actuals() c),
    'option_infos',
      (select coalesce(jsonb_agg(distinct ps.option_info), '[]'::jsonb)
       from promo.promotion_sales ps
       where ps.promotion_id = p_id and ps.option_info is not null
         and length(trim(ps.option_info)) > 0),
    'order_count',
      (select coalesce(sum(ps.order_count), 0)
       from promo.promotion_sales ps where ps.promotion_id = p_id),
    'mappings',
      (select coalesce(jsonb_agg(jsonb_build_object(
         'plan_product_id', m.plan_product_id,
         'actual_product_id', m.actual_product_id)), '[]'::jsonb)
       from promo.promotion_sku_mappings m where m.promotion_id = p_id),
    'weights',
      (select coalesce(jsonb_agg(to_jsonb(w.*)), '[]'::jsonb)
       from promo.effective_purpose_weights(p_id) w),
    'sources',
      coalesce((select jsonb_agg(to_jsonb(u.*) order by u.created_at desc)
        from promo.upload_log u, promo.promotions p2
        where p2.id = p_id and p2.code is not null
          and u.codes is not null and p2.code = any(u.codes)), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
