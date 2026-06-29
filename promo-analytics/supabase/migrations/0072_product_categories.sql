-- 0072: 상품 카테고리 마스터 (관리 목록)
-- products.category(텍스트)는 그대로 값의 출처로 유지(모든 벤치마크·필터 RPC가 이 문자열로 동작).
-- product_categories 는 '관리 가능한 카테고리 목록 + 정렬'만 담는다. 이름 변경/병합은 앱에서
-- product_categories 와 products.category 를 함께 갱신(문자열 동기화)한다.
create table if not exists promo.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- 기존 products.category 의 distinct 값으로 시드(미지정/공백 제외)
insert into promo.product_categories (name, sort)
select c, row_number() over (order by c)
from (
  select distinct trim(category) as c from promo.products
  where category is not null and trim(category) <> ''
) s
on conflict (name) do nothing;

alter table promo.product_categories enable row level security;
drop policy if exists product_categories_auth_all on promo.product_categories;
create policy product_categories_auth_all on promo.product_categories
  for all to authenticated using (true) with check (true);
grant all on promo.product_categories to authenticated, service_role;

notify pgrst, 'reload schema';
