-- 0057: 세그먼트 실적 수집 (회원/비회원 × 회원등급 × 카테고리 × 일반/정기) + 카테고리 백필
--
-- 카페24 채널별 매출 export는 한 라인을 회원유형·회원등급·기초상품 카테고리·주문유형(일반/정기)으로
-- 분해해 제공한다. 기존 promotion_sales(SKU/옵션 합계)는 이 차원을 담지 못하므로 세그먼트 단위
-- fact 테이블을 신설한다. 동시에 export의 '기초 상품 카테고리'로 products.category를 백필(현재
-- 16% → 대폭 상승)해 카테고리 기반 서브상품 어태치율 추천(0059)·카테고리 선택기를 의미있게 만든다.
--
-- 모두 추가형(기존 업로드/RPC 불변). product_id는 업로드 시 ensureProducts로 해석해 채운다.

create table if not exists promo.promotion_segment_sales (
  id            bigint generated always as identity primary key,
  promotion_id  uuid references promo.promotions(id) on delete cascade,
  product_id    uuid references promo.products(id),
  base_name     text not null,
  option_info   text,
  category      text,              -- 기초 상품 카테고리 (영양케어/간식/배변용품/용품/굿즈…)
  member_type   text,              -- '회원' | '비회원'
  member_grade  text,              -- 주문 회원등급 (고영희/꼬물이/아깽이/캣초딩/묘르신 · Staff · 동물병원)
  order_type    text,              -- 'subscription' | 'onetime' | null (일반/정기 배송)
  revenue       numeric default 0,
  order_count   numeric default 0, -- 결제 건수(클레임 제외)
  aov           numeric,           -- 평균 주문 가치 (export 원본값, 행 단위)
  arppu         numeric,           -- 객단가 (export 원본값, 행 단위)
  paying_users  numeric,           -- 결제 유저수
  quantity      numeric default 0, -- 기초 상품 판매 수량
  fee           numeric default 0,
  cost          numeric default 0,
  raw           jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists promotion_segment_sales_promo_idx
  on promo.promotion_segment_sales(promotion_id);

-- 원자 교체(삭제+삽입) + 카테고리 백필 — 업로드 직후 일관 적용
create or replace function promo.replace_promotion_segment_sales(
  p_promotion_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  delete from promo.promotion_segment_sales where promotion_id = p_promotion_id;

  insert into promo.promotion_segment_sales
    (promotion_id, product_id, base_name, option_info, category, member_type, member_grade,
     order_type, revenue, order_count, aov, arppu, paying_users, quantity, fee, cost, raw)
  select p_promotion_id,
         nullif(r->>'product_id', '')::uuid,
         r->>'base_name',
         nullif(r->>'option_info', ''),
         nullif(r->>'category', ''),
         nullif(r->>'member_type', ''),
         nullif(r->>'member_grade', ''),
         nullif(r->>'order_type', ''),
         coalesce((r->>'revenue')::numeric, 0),
         coalesce((r->>'order_count')::numeric, 0),
         nullif(r->>'aov', '')::numeric,
         nullif(r->>'arppu', '')::numeric,
         nullif(r->>'paying_users', '')::numeric,
         coalesce((r->>'quantity')::numeric, 0),
         coalesce((r->>'fee')::numeric, 0),
         coalesce((r->>'cost')::numeric, 0),
         r->'raw'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  get diagnostics n = row_count;

  -- 카테고리 백필: export가 들고 온 카테고리로 비어있는 products.category만 채운다(정규화 SKU명 매칭,
  -- 동일 정규화명 중 가장 흔한 카테고리 선택). 기존 값은 덮어쓰지 않음.
  with seg as (
    select promo.normalize_sku_name(base_name) as skey, category, count(*) as c
    from promo.promotion_segment_sales
    where promotion_id = p_promotion_id and nullif(category, '') is not null
    group by 1, 2
  ),
  pick as (
    select distinct on (skey) skey, category from seg order by skey, c desc
  )
  update promo.products p
     set category = pick.category
    from pick
   where promo.normalize_sku_name(p.base_name) = pick.skey
     and (p.category is null or p.category = '');

  return n;
end;
$$;

grant execute on function promo.replace_promotion_segment_sales(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
