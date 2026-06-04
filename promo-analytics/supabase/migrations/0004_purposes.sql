-- 캠페인 목적 다중선택 + 목적 마스터 + 추천 가중치 확장
-- 1) promotions.purposes 컬럼 추가 (기존 promotions.purpose text는 폴백/표시용 유지)
alter table promo.promotions add column if not exists purposes text[];

-- 2) 목적 마스터 테이블
create table if not exists promo.purposes (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int  not null default 0,
  created_at timestamptz not null default now()
);

insert into promo.purposes(name, sort) values
  ('세일즈',1),('브랜딩',2),('재고소진',3),('신제품 런칭',4),('리뉴얼',5),('회원 활성화',6)
on conflict (name) do nothing;

alter table promo.purposes enable row level security;
drop policy if exists purposes_auth on promo.purposes;
create policy purposes_auth on promo.purposes for all to authenticated using (true) with check (true);

grant all on all tables in schema promo to authenticated;
grant all on all sequences in schema promo to authenticated;
grant execute on all functions in schema promo to authenticated;
