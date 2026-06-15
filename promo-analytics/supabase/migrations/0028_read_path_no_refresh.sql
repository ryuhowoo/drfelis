-- 0028: 읽기 경로에서 동기 재계산 제거 (업로드 직후 전면 먹통 방지)
--
-- 사고: 실적 업로드 → 롤업 dirty → 대시보드/히스토리/매칭이 각각 읽기 경로에서
-- refresh_rollups(~6.7s)를 동기 실행, 차단 락 앞에 줄서며 업로드 프리웜까지 겹쳐
-- statement_timeout 초과 → 번들 RPC 동시 에러 → 대시보드 빈 화면 · 히스토리
-- 캠페인 0 · 매칭 에러. (cron 이 뒤늦게 갱신하며 저절로 복구됐던 증상)
--
-- 원칙: 읽기는 절대 재계산을 트리거하지 않는다. 항상 서빙 테이블만 즉시 읽는다
-- (트랜잭션 격리로 재계산 중에도 이전 스냅샷이 보이므로 빈 결과 없음). 재계산은
-- (1) 업로드 직후 프리웜, (2) pg_cron 안전망(2분)으로만.
--
-- 추가: lost-update 안전을 위해 dirty(boolean) → version 카운터. 트리거가 version
-- 증가, 재계산은 시작 시점 버전을 캡처해 끝에 built_version 기록. 재계산 도중 들어온
-- 변경은 version > built_version 으로 남아 다음 주기에 반영. 차단 락 →
-- pg_try_advisory_xact_lock(논블로킹)으로 줄서기 제거. (cron 주기 5→2분: 0028 적용 시
-- cron.schedule('promo-refresh-rollups','*/2 * * * *', ...) 로 재등록)

alter table promo.rollup_state add column if not exists version       bigint not null default 0;
alter table promo.rollup_state add column if not exists built_version bigint not null default -1;
update promo.rollup_state set version = greatest(version, built_version + 1) where dirty;

create or replace function promo.mark_rollups_dirty()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update promo.rollup_state set version = version + 1, dirty = true where id;
  return null;
end;
$$;

create or replace function promo.refresh_rollups(p_force boolean default false)
returns void language plpgsql set search_path = '' as $$
declare
  v_now bigint;
  v_built bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('promo.refresh_rollups')) then
    return; -- 다른 재계산 진행 중 → 즉시 반환(줄서기 없음)
  end if;
  select version, built_version into v_now, v_built from promo.rollup_state where id;
  if not p_force and v_now <= coalesce(v_built, -1) then
    return; -- 이미 최신
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
         to_jsonb(f.*), to_jsonb(a.*),
         coalesce(ft.j, '[]'::jsonb), coalesce(m.j, '[]'::jsonb),
         p.s_j, coalesce(p.r_j, '[]'::jsonb), coalesce(p.o_j, '[]'::jsonb),
         coalesce(p.d_j, '[]'::jsonb), coalesce(dy.j, '[]'::jsonb), now()
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

  update promo.rollup_state
    set built_version = v_now,
        dirty = (version > v_now),
        refreshed_at = now()
  where id;
end;
$$;

create or replace function promo.ensure_rollups_fresh()
returns void language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from promo.rollup_state where id and version > built_version) then
    perform promo.refresh_rollups();
  end if;
end;
$$;

grant execute on all functions in schema promo to authenticated;

-- cron 주기 2분 재등록
select cron.unschedule('promo-refresh-rollups')
where exists (select 1 from cron.job where jobname = 'promo-refresh-rollups');
select cron.schedule('promo-refresh-rollups', '*/2 * * * *', $$select promo.refresh_rollups();$$);
