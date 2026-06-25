-- 0066 · 시즈널리티 복수 선택 지원
--
-- 혜택 유형은 이미 promo_types(text[])가 있으나 시즌은 단일(season_tag)뿐이었다.
-- season_tags(text[])를 추가해 복수 선택을 저장한다. 단일 컬럼(season_tag/promo_type)은
-- 레거시 예측·필터 호환을 위해 '대표값(첫 항목)'으로 계속 유지한다.

alter table promo.promotions add column if not exists season_tags text[];

-- 기존 단일값을 배열로 백필 (비어있던 배열만)
update promo.promotions
   set season_tags = array[season_tag]
 where season_tag is not null and (season_tags is null or cardinality(season_tags) = 0);

update promo.promotions
   set promo_types = array[promo_type]
 where promo_type is not null and (promo_types is null or cardinality(promo_types) = 0);
