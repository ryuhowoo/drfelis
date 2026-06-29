-- 0074: 판매 채널 + 상품 상태 (B2C MD 운영 정리)
-- channel: 'B2C'(기본) 외 다이소·대만 등 비B2C 채널 구분 → B2C MD 화면은 B2C만 기본 노출.
-- status: '판매중'(기본)/'품절'/'단종' → 뱃지·필터, 품절·단종은 옵션 검색에서 자동 제외.
alter table promo.products add column if not exists channel text not null default 'B2C';
alter table promo.products add column if not exists status  text not null default '판매중';

-- 이름 마커로 1차 백필 (이후 웹에서 직접 수정)
update promo.products set channel='다이소' where channel='B2C' and base_name ilike '%다이소%';
update promo.products set channel='대만'   where channel='B2C' and base_name ilike '%대만%';
update promo.products set status='단종' where status='판매중' and base_name ilike '%단종%';
update promo.products set status='품절' where status='판매중' and base_name ilike '%품절%';

notify pgrst, 'reload schema';
