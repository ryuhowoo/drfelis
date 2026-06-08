-- 0014: 플랜 옵션에 가이드 econ 보관(총원가/물류비/수수료/광고비/공헌이익률 등) — additive
-- 가이드(가설)의 예상 economics를 '그대로' 저장하기 위한 jsonb.
alter table promo.campaign_plan_options
  add column if not exists econ jsonb;

comment on column promo.campaign_plan_options.econ is
  '가이드 임포트 시 폼 그대로 보관: {총원가,물류비,수수료,광고비,공헌이익률,프로모션가,쿠폰혜택가}';
