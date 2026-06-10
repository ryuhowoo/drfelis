-- 0022: 롤업 서빙 테이블 — "요청 시점 집계 금지" (N6 R1.1)
--
-- 문제: 모든 페이지가 매 요청마다 전 캠페인의 측정(업리프트·헤일로·기여이익)을
--       SQL로 풀 재계산 (0015 배치 RPC도 계산 자체는 매번 수행). 데이터가 작아도
--       함수 체인이 깊어 페이지 로드가 수 초.
-- 해결: 계산 결과를 campaign_rollups / global_rollups 에 저장하고 페이지는
--       이것만 읽는다. 입력 테이블이 바뀌면 statement 트리거가 dirty 플래그를
--       세우고, 다음 읽기(또는 업로드 직후 명시적 refresh)가 1회 재계산한다.
--       계산 로직은 기존 함수(단일 출처)를 그대로 호출 — 수치 동일 보장.

-- ── 서빙 테이블 ─────────────────────────────────────────────────────────
create table if not exists promo.campaign_rollups (
  promotion_id uuid primary key references promo.promotions(id) on delete cascade,
  features     jsonb,                       -- all_campaign_features 행 (summary 포함)
  achievement  jsonb,                       -- campaign_achievements 행
  fits         jsonb not null default '[]', -- campaign_fits 행 배열
  measurement  jsonb not null default '[]', -- promotion_measurement 행 배열 (상세용)
  pva_summary  jsonb,                       -- plan_vs_actual_summary 행
  pva_rows     jsonb not null default '[]', -- plan_vs_actual 행 배열
  pva_options  jsonb not null default '[]', -- plan_vs_actual_options 행 배열
  diagnostic   jsonb not null default '[]', -- sku_match_diagnostic 행 배열
  refreshed_at timestamptz not null default now()
);

create table if not exists promo.global_rollups (
  key          text primary key,            -- 'overall' | 'purpose_metrics'
  payload      jsonb,
  refreshed_at timestamptz not null default now()
);

-- 단일 행 dirty 플래그
create table if not exists promo.rollup_state (
  id           boolean primary key default true check (id),
  dirty        boolean not null default true,
  refreshed_at timestamptz
);
insert into promo.rollup_state (id, dirty) values (true, true)
on conflict (id) do nothing;

alter table promo.campaign_rollups enable row level security;
alter table promo.global_rollups   enable row level security;
alter table promo.rollup_state     enable row level security;
do $$
declare t text;
begin
  foreach t in array array['campaign_rollups','global_rollups','rollup_state'] loop
    execute format('drop policy if exists %I on promo.%I;', t || '_authenticated_all', t);
    execute format(
      'create policy %I on promo.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t);
  end loop;
end $$;

-- ── 업로드 역추적: upload_log 에 영향받은 캠페인 코드 기록 (N6 R1.3) ────
alter table promo.upload_log add column if not exists codes text[];

-- ── dirty 마킹 트리거 — 측정 입력 테이블 전체 ──────────────────────────
create or replace function promo.mark_rollups_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update promo.rollup_state set dirty = true where not dirty;
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'products','daily_sales','promotions','promotion_main_products',
    'promotion_sales','promotion_purpose_weights','promotion_sku_mappings',
    'campaign_plans','campaign_plan_options','campaign_plan_option_items',
    'product_price_configs'
  ] loop
    execute format('drop trigger if exists %I on promo.%I;', t || '_mark_dirty', t);
    execute format(
      'create trigger %I after insert or update or delete on promo.%I
       for each statement execute function promo.mark_rollups_dirty();',
      t || '_mark_dirty', t);
  end loop;
end $$;

-- ── 전체 재계산 ─────────────────────────────────────────────────────────
create or replace function promo.refresh_rollups(p_force boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
declare
  is_dirty boolean;
begin
  -- 동시 호출 직렬화. 락 대기 후 dirty 재확인 — 앞선 호출이 이미 갱신했으면 스킵.
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
       )
  insert into promo.campaign_rollups
    (promotion_id, features, achievement, fits, measurement,
     pva_summary, pva_rows, pva_options, diagnostic, refreshed_at)
  select pr.id,
         to_jsonb(f.*),
         to_jsonb(a.*),
         coalesce(ft.j, '[]'::jsonb),
         coalesce(m.j,  '[]'::jsonb),
         p.s_j,
         coalesce(p.r_j, '[]'::jsonb),
         coalesce(p.o_j, '[]'::jsonb),
         coalesce(p.d_j, '[]'::jsonb),
         now()
  from promo.promotions pr
  left join feats f on f.promotion_id = pr.id
  left join achs  a on a.promotion_id = pr.id
  left join fits  ft on ft.promotion_id = pr.id
  left join meas  m on m.pid = pr.id
  left join pvas  p on p.pid = pr.id;

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

create or replace function promo.ensure_rollups_fresh()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from promo.rollup_state where id and dirty) then
    perform promo.refresh_rollups();
  end if;
end;
$$;

-- ── 페이지 번들 RPC — 페이지당 1회 왕복 ────────────────────────────────
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
         'fits', r.fits)), '[]'::jsonb)
       from promo.campaign_rollups r)
  ) into result;
  return result;
end;
$$;

create or replace function promo.dashboard_bundle()
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
         'achievement', r.achievement)), '[]'::jsonb)
       from promo.campaign_rollups r),
    'overall',
      (select g.payload from promo.global_rollups g where g.key = 'overall'),
    'purpose_metrics',
      coalesce((select g.payload from promo.global_rollups g where g.key = 'purpose_metrics'),
               '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

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
