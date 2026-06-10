-- 0021: 플랜 독립화 (N5.1) — campaign_plans 강결합 해제 + 자체 식별자
--
-- S0 §2-3 "promotions ─1:1─ campaign_plans" 폐기 (N5_단독시작문서.md §4).
-- 플랜은 promotions에 의존하지 않는 독립 아티팩트:
--   · promotion_id nullable 전환 (drop 하지 않음 — 파괴 최소화, §4.4 예외)
--   · 자체 식별자/목표값 컬럼 추가 (가이드 시트 폼값 그대로, 재계산 금지)
--   · 실적과의 비교는 actual_promotion_id 명시적 짝짓기로만
-- campaign_plan_options 는 예상 세트수(expected_option_qty)·옵션 목표매출
-- (expected_revenue)을 이미 보유 → 추가 컬럼 없음.

alter table promo.campaign_plans alter column promotion_id drop not null;

alter table promo.campaign_plans
  add column if not exists code text,
  add column if not exists name text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists channel text,
  add column if not exists target_revenue numeric,           -- 플랜 헤더 목표매출 (폼값)
  add column if not exists target_contribution numeric,      -- 플랜 공헌이익 (폼값)
  add column if not exists target_contribution_rate numeric, -- 폼값
  add column if not exists actual_promotion_id uuid references promo.promotions(id) on delete set null;

-- 0020이 이미 actual_promotion_id를 만든 경우 FK에 on delete set null이 없음 → 재정의
alter table promo.campaign_plans
  drop constraint if exists campaign_plans_actual_promotion_id_fkey;
alter table promo.campaign_plans
  add constraint campaign_plans_actual_promotion_id_fkey
  foreign key (actual_promotion_id) references promo.promotions(id) on delete set null;

-- 레거시 플랜(promotion_id 보유)에 자체 식별자 백필 — 코드 기준 lookup이 동작하도록
update promo.campaign_plans cp
set code       = coalesce(cp.code, p.code),
    name       = coalesce(cp.name, p.name),
    start_date = coalesce(cp.start_date, p.start_date),
    end_date   = coalesce(cp.end_date, p.end_date)
from promo.promotions p
where p.id = cp.promotion_id;

create index if not exists campaign_plans_code_idx
  on promo.campaign_plans (code);

-- 독립 플랜(promotion_id null)은 코드당 현재 플랜 1개만
create unique index if not exists campaign_plans_code_current
  on promo.campaign_plans (code)
  where is_current and code is not null and promotion_id is null;

notify pgrst, 'reload schema';
