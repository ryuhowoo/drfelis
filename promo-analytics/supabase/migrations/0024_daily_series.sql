-- 0024: 캠페인 일별 매출 시리즈 롤업 (N6 R2.2)
--
-- 캠페인 상세 시계열(브러시 줌)·히스토리 비교 오버레이용.
-- 캠페인 기간 내 daily_sales 일자 합계를 rollup에 사전 적재.
-- (promotion_sales 는 일자 granularity 가 없으므로 전장 daily_sales 기준 —
--  '캠페인 기간의 매장 전체 일매출' 시리즈. baseline 대비선과 함께 읽는 용도)

alter table promo.campaign_rollups
  add column if not exists daily jsonb not null default '[]';

create or replace function promo.refresh_rollups(p_force boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
declare
  is_dirty boolean;
begin
  perform pg_advisory_xact_lock(hashtext('promo.refresh_rollups'));
  select dirty into is_dirty from promo.rollup_state where id;
  if not p_force and not coalesce(is_dirty, true) then
    return;
  end if;

  delete from promo.campaign_rollups;
  with feats as (select * from promo.all_campaign_features()),
       achs  as (select * from promo.campaign_achievements()),
       fits  as (
         select f.promotion_id, jsonb_agg(to_jsonb(f.*)) as j
         from promo.campaign_fits() f group by f.promotion_id
       ),
       meas  as (
         select pr.id as pid,
                coalesce(jsonb_agg(to_jsonb(m.*)) filter (where m.product_id is not null),
                         '[]'::jsonb) as j
         from promo.promotions pr
         left join lateral promo.promotion_measurement(pr.id) m on true
         group by pr.id
       ),
       pvas  as (
         select pr.id as pid,
           (select to_jsonb(s.*) from promo.plan_vs_actual_summary(pr.id) s limit 1) as s_j,
           (select coalesce(jsonb_agg(to_jsonb(r.*)), '[]'::jsonb)
              from promo.plan_vs_actual(pr.id) r) as r_j,
           (select coalesce(jsonb_agg(to_jsonb(o.*)), '[]'::jsonb)
              from promo.plan_vs_actual_options(pr.id) o) as o_j,
           (select coalesce(jsonb_agg(to_jsonb(d.*)), '[]'::jsonb)
              from promo.sku_match_diagnostic(pr.id) d) as d_j
         from promo.promotions pr
       ),
       -- 직전 8주 맥락 포함 ('in' = 캠페인 기간 여부) — 상세 시계열에서
       -- baseline 구간 대비 스파이크가 보이게
       daily as (
         select pr.id as pid,
                coalesce(jsonb_agg(jsonb_build_object(
                           'd', d.sale_date, 'rev', d.rev,
                           'in', (d.sale_date between pr.start_date and pr.end_date))
                                   order by d.sale_date)
                         filter (where d.sale_date is not null), '[]'::jsonb) as j
         from promo.promotions pr
         left join lateral (
           select ds.sale_date, sum(ds.revenue) as rev
           from promo.daily_sales ds
           where ds.sale_date between pr.start_date - 56 and pr.end_date
           group by ds.sale_date
         ) d on true
         group by pr.id
       )
  insert into promo.campaign_rollups
    (promotion_id, features, achievement, fits, measurement,
     pva_summary, pva_rows, pva_options, diagnostic, daily, refreshed_at)
  select pr.id,
         to_jsonb(f.*),
         to_jsonb(a.*),
         coalesce(ft.j, '[]'::jsonb),
         coalesce(m.j,  '[]'::jsonb),
         p.s_j,
         coalesce(p.r_j, '[]'::jsonb),
         coalesce(p.o_j, '[]'::jsonb),
         coalesce(p.d_j, '[]'::jsonb),
         coalesce(dy.j, '[]'::jsonb),
         now()
  from promo.promotions pr
  left join feats f on f.promotion_id = pr.id
  left join achs  a on a.promotion_id = pr.id
  left join fits  ft on ft.promotion_id = pr.id
  left join meas  m on m.pid = pr.id
  left join pvas  p on p.pid = pr.id
  left join daily dy on dy.pid = pr.id;

  insert into promo.global_rollups (key, payload, refreshed_at)
  values
    ('overall',
     (select to_jsonb(o.*) from promo.overall_baseline_metrics() o limit 1), now()),
    ('purpose_metrics',
     (select coalesce(jsonb_agg(to_jsonb(pm.*)), '[]'::jsonb) from promo.purpose_metrics() pm), now())
  on conflict (key) do update
    set payload = excluded.payload, refreshed_at = excluded.refreshed_at;

  update promo.rollup_state set dirty = false, refreshed_at = now() where id;
end;
$$;

-- library_bundle 에 daily 포함 (히스토리 비교 오버레이용)
create or replace function promo.library_bundle()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare result jsonb;
begin
  perform promo.ensure_rollups_fresh();
  select jsonb_build_object(
    'promotions',
      (select coalesce(jsonb_agg(to_jsonb(p.*) order by p.start_date desc), '[]'::jsonb)
       from promo.promotions p),
    'rollups',
      (select coalesce(jsonb_agg(jsonb_build_object(
         'promotion_id', r.promotion_id,
         'features', r.features,
         'achievement', r.achievement,
         'fits', r.fits,
         'daily', r.daily)), '[]'::jsonb)
       from promo.campaign_rollups r)
  ) into result;
  return result;
end;
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
