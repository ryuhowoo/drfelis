-- 0065 · 메인 카테고리 통합: 모래 = 배변용품
--
-- '모래'는 '배변용품'의 하위 개념이라 메인 카테고리에서는 같은 것으로 본다.
-- 기존 products.category='모래'를 '배변용품'으로 합치고, 향후 적재 시에도 동일하게 정규화된다
-- (앱 측 parse.ts CATEGORY_ALIAS). 서브상품 어태치율(0064)도 통합 카테고리로 계산된다.

update promo.products set category = '배변용품' where category = '모래';
