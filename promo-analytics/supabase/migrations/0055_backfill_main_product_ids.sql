-- 0055: 기존 플랜의 main_product_ids 백필 (is_main 옵션에서)
--
-- 플랜의 메인/서브 지정을 성과 측정에 자동 연결하는 로직(#125)은 플랜 '저장' 시 main_product_ids
-- 를 채운다. 그 변경 이전에 확정된 플랜은 main_product_ids 가 비어 성과 화면에서 '메인 미지정'·
-- '메인 직접 매출 ₩0'으로 떴다. 여기서 메인 옵션(is_main) SKU로 일괄 백필해 측정에 반영한다.
-- (이미 채워진 플랜은 건드리지 않음)

update promo.campaign_plans cp
set main_product_ids = sub.ids
from (
  select o.campaign_plan_id, array_agg(distinct i.product_id) as ids
  from promo.campaign_plan_options o
  join promo.campaign_plan_option_items i on i.campaign_plan_option_id = o.id
  where o.is_main
  group by o.campaign_plan_id
) sub
where cp.id = sub.campaign_plan_id
  and (cp.main_product_ids is null or cardinality(cp.main_product_ids) = 0);

select promo.refresh_rollups(true);
