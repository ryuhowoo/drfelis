-- 0029: 캠페인 생애주기(stage) — 플랜만/실적만/플랜+실적 명확 구분
-- plan-first 워크플로의 핵심: 캠페인을 상태로 분류해 히스토리·플랜보드에서 분리.
--   plan   = 플랜만 (계획 작성, 실적 미입력)
--   actual = 실적만 (레거시 백필, 플랜 없음)
--   linked = 플랜+실적 (달성도 측정 가능)
--
-- 사전 데이터 정리(이 마이그레이션과 함께 운영 적용): 쪼개져 있던 플랜↔실적 쌍
-- (벌크업·Better Habits)을 실적 캠페인 본체로 합침 — 빈 플랜 셸 promotions 2건
-- 삭제, 해당 campaign_plans.promotion_id 를 실적 캠페인으로 이전, actual_promotion_id
-- 해제. (실적·메인상품·가중치는 실적 캠페인 쪽에 이미 있었음)
create or replace function promo.campaign_stage(p_id uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when has_plan and has_actual then 'linked'
    when has_plan then 'plan'
    when has_actual then 'actual'
    else 'empty'
  end
  from (
    select
      exists(select 1 from promo.campaign_plans pl
             where pl.promotion_id = p_id and pl.is_current) as has_plan,
      (
        (select count(*) from promo.promotion_sales s where s.promotion_id = p_id) > 0
        or exists(
          select 1 from promo.campaign_plans pl2
          where pl2.promotion_id = p_id and pl2.is_current
            and pl2.actual_promotion_id is not null
            and (select count(*) from promo.promotion_sales s2
                 where s2.promotion_id = pl2.actual_promotion_id) > 0)
      ) as has_actual
  ) x;
$$;

create or replace function promo.library_bundle()
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'promotions',
      (select coalesce(jsonb_agg(
         to_jsonb(p.*) || jsonb_build_object('stage', promo.campaign_stage(p.id))
         order by p.start_date desc), '[]'::jsonb)
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

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
