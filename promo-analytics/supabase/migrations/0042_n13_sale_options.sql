-- 0042: N13 P1 — 실적 옵션 구조화 (promotion_sale_options) + 공유 match_signature 매칭 토대
--
-- 설계: docs/design-structured-actual-options.md (Phase 1)
--
-- 배경: 플랜은 옵션(구성·BOM·option_signature)으로 구조화돼 있으나 실적(promotion_sales)은
--   납작한 SKU 줄 + 자유텍스트 option_info 뿐. 둘을 잇는 매칭/구독/공헌 분석이 전부 추정 위에 섬.
--
-- 이 마이그레이션(P1, 비파괴·additive):
--   (1) normalize_option_info()  : 배지([35%⬇️])·골격(상품선택1=)·공백 정규화.
--   (2) match_signature(jsonb)   : (정규화 SKU명:수량) 멤버 집합의 정렬 해시 = 플랜↔실적 공유 매칭 키.
--       플랜의 option_signature(product_id:qty, 내부 식별용)와 별개 — 이름 기반이라 양측 교차매칭 가능.
--   (3) campaign_plan_options.match_signature : 위 키를 플랜 옵션에도 부여(트리거+백필).
--   (4) promotion_sale_options 테이블 + promotion_sales.sale_option_id : 실적옵션을 1급 객체로.
--   (5) rebuild_sale_options(promotion) : 실적행을 (정규화 SKU, pack_size)로 묶어 실적옵션 생성·매칭.
--   (6) 전 캠페인 백필.
--
-- 기존 달성 RPC(plan_vs_actual_*, predict)는 이 레이어를 아직 참조하지 않음 → 현재 수치 불변.
-- 구독 판정 정정(양성신호)은 후속 0043에서.

-- ── (1) option_info 정규화 ────────────────────────────────────────────────
create or replace function promo.normalize_option_info(txt text)
returns text
language sql immutable parallel safe set search_path = ''
as $$
  -- [35%⬇️] 류 대괄호 배지 제거 → '상품선택1=' '구성2:' 골격 제거 → 공백 1칸 정규화.
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(coalesce(txt, ''), '\[[^\]]*\]', '', 'g'),
      '(상품선택|구성)\s*[0-9]*\s*[:=]', '', 'g'),
    '\s+', ' ', 'g'));
$$;

-- ── (2) 공유 매칭 시그니처: (정규화 SKU명:수량) 멤버 집합의 정렬 해시 ──────────
-- p_members = jsonb 배열 [{"k": <정규화 SKU명>, "q": <수량/개입수>}, ...]
create or replace function promo.match_signature(p_members jsonb)
returns text
language sql immutable parallel safe set search_path = ''
as $$
  select md5(coalesce(string_agg(m.k || ':' || m.q::text, '|' order by m.k, m.q), ''))
  from (
    select coalesce(e->>'k', '?') as k,
           coalesce((e->>'q')::numeric, 1) as q
    from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) e
  ) m;
$$;

-- ── (3) 플랜 옵션에 match_signature 부여 ──────────────────────────────────
alter table promo.campaign_plan_options
  add column if not exists match_signature text;

create or replace function promo.plan_option_match_signature(p_option_id uuid)
returns text
language sql stable set search_path = ''
as $$
  select promo.match_signature(coalesce(jsonb_agg(jsonb_build_object(
      'k', promo.normalize_sku_name(i.base_name),
      'q', i.sku_qty_per_option)), '[]'::jsonb))
  from promo.campaign_plan_option_items i
  where i.campaign_plan_option_id = p_option_id;
$$;

-- 아이템 변경 시 파생값 갱신 (0030의 트리거 함수에 match_signature 추가 — option_signature/display_label 보존)
create or replace function promo.refresh_plan_option_derived()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  oid uuid;
begin
  oid := coalesce(new.campaign_plan_option_id, old.campaign_plan_option_id);
  update promo.campaign_plan_options o
     set option_signature = promo.compute_option_signature(oid),
         display_label    = promo.compute_option_display_label(oid),
         match_signature  = promo.plan_option_match_signature(oid),
         updated_at = now()
   where o.id = oid;
  return null;
end;
$$;

-- 기존 옵션 백필
update promo.campaign_plan_options o
   set match_signature = promo.plan_option_match_signature(o.id)
 where o.match_signature is null;

-- ── (4) 실적옵션 테이블 + 연결 컬럼 ───────────────────────────────────────
create table if not exists promo.promotion_sale_options (
  id                uuid primary key default gen_random_uuid(),
  promotion_id      uuid not null references promo.promotions(id) on delete cascade,
  option_code       text,            -- export 옵션코드 (Phase 2). 없으면 null
  label             text,            -- 대표 표시명(최대매출 멤버 base_name)
  label_raw         text,            -- 대표 원본 option_info
  match_signature   text not null,   -- (정규화 SKU:수량) 해시 — 플랜과 동일 알고리즘
  pack_size         int not null default 1,
  term_months       int,             -- 'N개월' 파싱값 (소진기간 — 구독 신호 아님)
  is_subscription   boolean not null default false,
  sub_source        text,            -- 'product' | 'derived' | 'export' | 'override'
  revenue           numeric default 0,
  quantity          numeric default 0,
  cost              numeric default 0,
  fee               numeric default 0,
  order_count       numeric default 0,
  matched_plan_option_id uuid references promo.campaign_plan_options(id) on delete set null,
  match_source      text,            -- 'option_code' | 'signature' | 'label' | 'manual' | 'none'
  match_confidence  numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists promotion_sale_options_promo_idx on promo.promotion_sale_options (promotion_id);
create index if not exists promotion_sale_options_sig_idx   on promo.promotion_sale_options (match_signature);

alter table promo.promotion_sales
  add column if not exists sale_option_id uuid references promo.promotion_sale_options(id) on delete set null;
create index if not exists promotion_sales_sale_option_idx on promo.promotion_sales (sale_option_id);

alter table promo.promotion_sale_options enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies
    where schemaname='promo' and tablename='promotion_sale_options' and policyname='sale_options_read') then
    create policy sale_options_read on promo.promotion_sale_options for select to authenticated using (true);
  end if;
end $$;

-- ── (5) 실적옵션 재구성: 실적행 → (정규화 SKU, pack_size) 묶음 ─────────────
-- Phase 1 그레인 = (정규화 SKU명, pack_size). 실적행은 본디 제품×옵션 집계라 보통 단일 SKU.
-- 다구성(번들) 복원은 export 구성/옵션코드(Phase 2) 필요 → 그때 그레인을 option_code로 승격.
create or replace function promo.rebuild_sale_options(p_promotion_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  -- 멱등: 기존 연결/옵션 비우고 재생성
  update promo.promotion_sales set sale_option_id = null where promotion_id = p_promotion_id;
  delete from promo.promotion_sale_options where promotion_id = p_promotion_id;

  insert into promo.promotion_sale_options
    (promotion_id, label, label_raw, match_signature, pack_size, term_months,
     is_subscription, sub_source, revenue, quantity, cost, fee, order_count)
  select p_promotion_id,
    g.label, g.label_raw,
    promo.match_signature(jsonb_build_array(jsonb_build_object('k', g.skey, 'q', g.pack))),
    g.pack, g.term_months,
    (g.prod_sub or g.kw_sub),
    case when g.prod_sub then 'product' when g.kw_sub then 'derived' else null end,
    g.rev, g.qty, g.cost, g.fee, g.oc
  from (
    select
      promo.normalize_sku_name(coalesce(pr.base_name, ps.base_name)) as skey,
      coalesce(ps.pack_size, 1) as pack,
      (array_agg(coalesce(pr.base_name, ps.base_name) order by ps.revenue desc nulls last))[1] as label,
      (array_agg(promo.normalize_option_info(ps.option_info) order by ps.revenue desc nulls last))[1] as label_raw,
      bool_or(coalesce(pr.is_subscription, false)) as prod_sub,
      -- Phase 1 양성신호: '정기/구독' 키워드만(‘개월’ 단독 금지 — 0043에서 요약에도 반영)
      bool_or(coalesce(ps.option_info, '') ~ '(정기|구독)') as kw_sub,
      max((regexp_match(coalesce(ps.option_info, ''), '([0-9]+)\s*개월'))[1]::int) as term_months,
      sum(coalesce(ps.revenue, 0)) as rev,
      sum(coalesce(ps.quantity, 0)) as qty,
      sum(coalesce(ps.cost, 0)) as cost,
      sum(coalesce(ps.fee, 0)) as fee,
      sum(coalesce(ps.order_count, 0)) as oc
    from promo.promotion_sales ps
    left join promo.products pr on pr.id = ps.product_id
    where ps.promotion_id = p_promotion_id
    group by 1, 2
  ) g;

  get diagnostics n = row_count;

  -- 실적행 ↔ 실적옵션 연결 (동일 시그니처 = 동일 그룹, 캠페인 내 유일)
  update promo.promotion_sales ps
     set sale_option_id = o.id
    from promo.promotion_sale_options o
   where ps.promotion_id = p_promotion_id
     and o.promotion_id = p_promotion_id
     and o.match_signature = promo.match_signature(jsonb_build_array(jsonb_build_object(
           'k', promo.normalize_sku_name(coalesce(
                  (select base_name from promo.products where id = ps.product_id), ps.base_name)),
           'q', coalesce(ps.pack_size, 1))));

  -- 플랜 옵션 매칭 (시그니처 동일). 플랜은 coalesce(actual_promotion_id, promotion_id)=캠페인 기준.
  update promo.promotion_sale_options o
     set matched_plan_option_id = po.id,
         match_source = 'signature',
         match_confidence = 1.0
    from promo.campaign_plans cp
    join promo.campaign_plan_options po on po.campaign_plan_id = cp.id
   where o.promotion_id = p_promotion_id
     and coalesce(cp.actual_promotion_id, cp.promotion_id) = p_promotion_id
     and cp.is_current and cp.status = 'confirmed'
     and po.match_signature is not null
     and po.match_signature = o.match_signature;

  -- 미매칭 표기
  update promo.promotion_sale_options o
     set match_source = 'none'
   where o.promotion_id = p_promotion_id and o.matched_plan_option_id is null
     and o.match_source is null;

  return n;
end;
$$;

-- ── (6) 전 캠페인 백필 ────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select id from promo.promotions loop
    perform promo.rebuild_sale_options(r.id);
  end loop;
end $$;

grant execute on all functions in schema promo to authenticated;
grant select on promo.promotion_sale_options to authenticated;

notify pgrst, 'reload schema';
