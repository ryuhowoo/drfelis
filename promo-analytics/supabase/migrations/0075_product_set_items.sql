-- 0075: 세트 구성(BOM) — (세트) 상품이 어떤 SKU 로 구성되는지(자식 SKU + 수량)
create table if not exists promo.product_set_items (
  id uuid primary key default gen_random_uuid(),
  set_product_id   uuid not null references promo.products(id) on delete cascade,
  child_product_id uuid not null references promo.products(id) on delete cascade,
  qty integer not null default 1,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (set_product_id, child_product_id)
);
create index if not exists product_set_items_set_idx on promo.product_set_items (set_product_id);

alter table promo.product_set_items enable row level security;
drop policy if exists product_set_items_auth_all on promo.product_set_items;
create policy product_set_items_auth_all on promo.product_set_items
  for all to authenticated using (true) with check (true);
grant all on promo.product_set_items to authenticated, service_role;

notify pgrst, 'reload schema';
