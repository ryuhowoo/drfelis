-- 0032: N7 P4 — 오염 플랜옵션 구성 보정 (라벨↔구성 SKU 불일치 교정)
--
-- 배경(설계 §0): 구 임포터(1행=1옵션=단일 SKU)가 품목코드 누락/이름 충돌 시 옵션을
--   엉뚱한 product 에 매핑 → "퍼펙트 연어" 옵션의 구성이 "퍼펙트 치킨"으로, "7+ 케어 치킨"이
--   "퍼펙트 치킨"으로 저장되는 등 구성 오염. 단일구성 옵션 11건에서 라벨 SKU ≠ 구성 SKU.
--   이 오염은 SKU 달성 귀속을 왜곡(연어 옵션이 치킨 기대치로 합산).
--
-- 보정 원칙(결정적·비추측): 오염 단일구성 옵션의 item 을, base_name 이 옵션 라벨과
--   **정확히 일치**하는 제품으로 재지정. 사전 점검 결과 11건 모두 정확일치 제품이 1개씩 존재
--   (no_exact=0, ambiguous=0) → 추측 없이 안전. 멱등(정규화 일치하면 재실행시 0건).
--   set_price/econ/expected_* 등 폼 경제값은 보존(데이터 보존 원칙) — product 정체성만 교정.
--   item 변경 트리거가 option_signature/display_label 재계산.
--
-- 수동 매핑 정리(설계 §8.8 사용자 결정: 플랜+실적 동시 보유 캠페인만 보존, 나머지 초기화):
--   현 상태 promotion_sku_mappings 0건, 커스텀 match_patterns 1건(= Better Habits, 연동 캠페인)
--   → 보존 대상만 존재하므로 파괴적 초기화 불필요(조건 이미 충족). 비파괴 유지.

update promo.campaign_plan_option_items it
set product_id = sub.correct_pid,
    base_name = sub.correct_name,
    updated_at = now()
from (
  select i.id as item_id,
    (select pr.id from promo.products pr where pr.base_name = o.option_label limit 1) as correct_pid,
    (select pr.base_name from promo.products pr where pr.base_name = o.option_label limit 1) as correct_name
  from promo.campaign_plan_options o
  join promo.campaign_plan_option_items i on i.campaign_plan_option_id = o.id
  where (select count(*) from promo.campaign_plan_option_items i2
           where i2.campaign_plan_option_id = o.id) = 1
    and promo.normalize_sku_name(i.base_name) <> promo.normalize_sku_name(o.option_label)
    and (select count(*) from promo.products pr where pr.base_name = o.option_label) = 1
) sub
where it.id = sub.item_id and sub.correct_pid is not null;

notify pgrst, 'reload schema';
