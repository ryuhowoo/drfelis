-- 0076: 서브 브랜드 마스터(중요도 순) + 상품 브랜드 배정
-- 가격표를 시트처럼 '서브 브랜드 중요도 순 → 품목코드 순'으로 정렬하기 위함.
-- product_brands 는 카테고리 하위의 서브 브랜드 목록 + 정렬(중요도). products.brand 는 그 이름.

create table if not exists promo.product_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

alter table promo.product_brands enable row level security;
drop policy if exists product_brands_auth_all on promo.product_brands;
create policy product_brands_auth_all on promo.product_brands
  for all to authenticated using (true) with check (true);
grant all on promo.product_brands to authenticated, service_role;

-- 중요도 순 시드 (시트 순서)
insert into promo.product_brands (name, sort) values
  ('퓨저나이트', 1), ('카사벤토', 2), ('영양케어', 3), ('포캣츄', 4), ('포캣트릿', 5),
  ('체험팩', 6), ('바이바이배드', 7), ('애착박스', 8), ('캣트리스', 9), ('포캣네스트', 10),
  ('사은품/굿즈', 11)
on conflict (name) do update set sort = excluded.sort;

-- 품목코드 기준 브랜드 배정 (시트 기준)
update promo.products set brand='퓨저나이트'  where dr_code in ('DR10071','DR10081');
update promo.products set brand='카사벤토'    where dr_code in ('DR10030','DR10040','DR10036','DR10033','DR10041');
update promo.products set brand='영양케어'    where dr_code in ('DR10067','DR10068','DR10063','DR10064','DR10038','DR10039','DR10011','DR10021','DR10012','DR10022','DR10072');
update promo.products set brand='포캣츄'      where dr_code in ('DR10043','DR10044','DR10042');
update promo.products set brand='포캣트릿'    where dr_code in ('DR10007','DR10008','DR10010','DR10019','DR10020','DR10023','DR10024');
update promo.products set brand='체험팩'      where dr_code in ('DR10025','DR10055','DR10065','DR10069','DR10073','DR10045');
update promo.products set brand='바이바이배드' where dr_code in ('DR10066');
update promo.products set brand='애착박스'    where dr_code in ('DR10034','DR10035','DR10061');
update promo.products set brand='캣트리스'    where dr_code in ('DR10006','DR10005','DR10003','DR10004');
update promo.products set brand='포캣네스트'  where dr_code in ('DR10026','DR10027');
update promo.products set brand='사은품/굿즈' where dr_code in ('DR10059','DR10060');

notify pgrst, 'reload schema';
