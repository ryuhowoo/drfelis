-- 0053: 품절 제외 변경 시 롤업 dirty 표시 (cron 재빌드 트리거)
--
-- promotion_excluded_skus 에 mark_rollups_dirty 트리거가 없어, 품절 제외 후에도 저장 롤업
-- (campaign_rollups.diagnostic / pva_summary)이 갱신되지 않아 미매칭 카드가 계속 떴던 버그 수정.
-- 다른 측정 테이블과 동일하게 변경 시 rollup_state.version 을 올려 cron(2분) 재빌드가 반영한다.

drop trigger if exists promotion_excluded_skus_dirty on promo.promotion_excluded_skus;
create trigger promotion_excluded_skus_dirty
after insert or update or delete on promo.promotion_excluded_skus
for each statement execute function promo.mark_rollups_dirty();
