-- 0028b: 번들 RPC 4종 — ensure_rollups_fresh() 호출 제거(순수 읽기) + meta(stale/refreshed_at).
-- 읽기가 더 이상 재계산을 트리거하지 않으므로 업로드 직후에도 즉시 응답(직전 데이터 + 갱신중 표시).
create or replace function promo.dashboard_bundle()
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'promotions',
      (select coalesce(jsonb_agg(to_jsonb(p.*) order by p.start_date desc), '[]'::jsonb)
       from promo.promotions p),
    'rollups',
      (select coalesce(jsonb_agg(jsonb_build_object(
         'promotion_id', r.promotion_id, 'features', r.features, 'achievement', r.achievement)), '[]'::jsonb)
       from promo.campaign_rollups r),
    'overall',
      (select g.payload from promo.global_rollups g where g.key = 'overall'),
    'purpose_metrics',
      coalesce((select g.payload from promo.global_rollups g where g.key = 'purpose_metrics'), '[]'::jsonb),
    'meta',
      (select jsonb_build_object('stale', (version > built_version), 'refreshed_at', refreshed_at)
       from promo.rollup_state where id)
  ) into result;
  return result;
end;
$$;

create or replace function promo.library_bundle()
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'promotions',
      (select coalesce(jsonb_agg(to_jsonb(p.*) order by p.start_date desc), '[]'::jsonb)
       from promo.promotions p),
    'rollups',
      (select coalesce(jsonb_agg(jsonb_build_object(
         'promotion_id', r.promotion_id, 'features', r.features, 'achievement', r.achievement,
         'fits', r.fits, 'daily', r.daily)), '[]'::jsonb)
       from promo.campaign_rollups r),
    'meta',
      (select jsonb_build_object('stale', (version > built_version), 'refreshed_at', refreshed_at)
       from promo.rollup_state where id)
  ) into result;
  return result;
end;
$$;

create or replace function promo.plans_bundle()
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'plans',
      coalesce((select jsonb_agg(jsonb_build_object(
         'id', pl.id, 'code', pl.code, 'name', coalesce(pl.name, pr.name),
         'start_date', coalesce(pl.start_date, pr.start_date),
         'end_date', coalesce(pl.end_date, pr.end_date),
         'channel', pl.channel, 'status', pl.status, 'version', pl.version,
         'confirmed_at', pl.confirmed_at,
         'target_revenue', coalesce(pl.target_revenue, pl.expected_revenue_total),
         'target_contribution', coalesce(pl.target_contribution, pl.expected_contribution_total),
         'target_contribution_rate', pl.target_contribution_rate,
         'promotion_id', pl.promotion_id, 'promotion_name', pr.name,
         'actual_promotion_id', pl.actual_promotion_id, 'actual_name', pa.name,
         'option_count', (select count(*) from promo.campaign_plan_options o where o.campaign_plan_id = pl.id),
         'achievement', (select r.achievement from promo.campaign_rollups r where r.promotion_id = pl.promotion_id)
       ) order by coalesce(pl.start_date, pr.start_date) desc nulls last)
       from promo.campaign_plans pl
       left join promo.promotions pr on pr.id = pl.promotion_id
       left join promo.promotions pa on pa.id = pl.actual_promotion_id
       where pl.is_current), '[]'::jsonb),
    'options',
      coalesce((select jsonb_agg(jsonb_build_object(
         'plan_id', o.campaign_plan_id, 'is_main', o.is_main,
         'discount_consumer', o.discount_rate_consumer, 'discount_regular', o.discount_rate_regular,
         'set_price', o.set_price, 'expected_qty', o.expected_option_qty, 'expected_revenue', o.expected_revenue))
       from promo.campaign_plan_options o
       join promo.campaign_plans pl on pl.id = o.campaign_plan_id and pl.is_current), '[]'::jsonb),
    'meta',
      (select jsonb_build_object('stale', (version > built_version), 'refreshed_at', refreshed_at)
       from promo.rollup_state where id)
  ) into result;
  return result;
end;
$$;

create or replace function promo.promotion_detail_bundle(p_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'promo',  (select to_jsonb(p.*) from promo.promotions p where p.id = p_id),
    'rollup', (select to_jsonb(r.*) from promo.campaign_rollups r where r.promotion_id = p_id),
    'notes',
      (select coalesce(jsonb_agg(to_jsonb(n.*) order by n.created_at desc), '[]'::jsonb)
       from promo.promotion_notes n where n.promotion_id = p_id),
    'plan',
      (select to_jsonb(cp.*) from promo.campaign_plans cp where cp.promotion_id = p_id and cp.is_current limit 1),
    'linked_plans',
      coalesce((select jsonb_agg(jsonb_build_object(
         'plan_id', pl.id, 'code', pl.code,
         'name', coalesce(pl.name, pr2.name, pl.code), 'promotion_id', pl.promotion_id))
       from promo.campaign_plans pl
       left join promo.promotions pr2 on pr2.id = pl.promotion_id
       where pl.is_current and pl.actual_promotion_id = p_id), '[]'::jsonb),
    'candidates',
      (select coalesce(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) from promo.campaigns_with_actuals() c),
    'option_infos',
      (select coalesce(jsonb_agg(distinct ps.option_info), '[]'::jsonb)
       from promo.promotion_sales ps
       where ps.promotion_id = p_id and ps.option_info is not null and length(trim(ps.option_info)) > 0),
    'order_count',
      (select coalesce(sum(ps.order_count), 0) from promo.promotion_sales ps where ps.promotion_id = p_id),
    'mappings',
      (select coalesce(jsonb_agg(jsonb_build_object(
         'plan_product_id', m.plan_product_id, 'actual_product_id', m.actual_product_id)), '[]'::jsonb)
       from promo.promotion_sku_mappings m where m.promotion_id = p_id),
    'weights',
      (select coalesce(jsonb_agg(to_jsonb(w.*)), '[]'::jsonb) from promo.effective_purpose_weights(p_id) w),
    'sources',
      coalesce((select jsonb_agg(to_jsonb(u.*) order by u.created_at desc)
        from promo.upload_log u, promo.promotions p2
        where p2.id = p_id and p2.code is not null and u.codes is not null and p2.code = any(u.codes)), '[]'::jsonb),
    'meta',
      (select jsonb_build_object('stale', (version > built_version), 'refreshed_at', refreshed_at)
       from promo.rollup_state where id)
  ) into result;
  return result;
end;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
