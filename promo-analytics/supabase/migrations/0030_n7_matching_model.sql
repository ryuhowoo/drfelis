-- 0030: N7 P1 — 매칭/플랜옵션 모델 기반 (비파괴: add column + 신규함수 위주, 멱등)
--
-- N7 설계(§6 P1, §7~8): 측정엔진·데이터는 보존하고 "매칭/플랜옵션" 레이어만 교체.
-- 이 마이그레이션은 P1(모델/적재 기반)만 담당 — 달성 계산(P2)·UI(P3)는 후속.
--
-- (1) promotion_sales.pack_size  : 실적 "묶음수"(개입/팩/박스) 를 구조화.
--     실적 option_info 는 자유텍스트라 묶음 완전매칭은 불가 → best-effort 파싱(§8.1/8.3).
-- (2) campaign_plan_options.option_signature : 구성(품목+개입수) 시그니처 = 옵션 식별 키(§8.2).
--     campaign_plan_options.display_label     : 구성+개입수+세트가 기반 표시 라벨(라벨 단독 금지, §8.2).
--     (campaign_plan_option_items 는 이미 1옵션:N아이템 구조 → 다구성 지원은 구조적으로 존재.
--      여기서는 파생값이 다구성에서 올바르게 계산되도록 함수/트리거만 확립.)
--
-- 기존 달성 RPC(plan_vs_actual 등)는 pack_size 를 아직 참조하지 않음 → 현재 수치 불변.

-- ── (1) parse_pack: option_info → 묶음수(best-effort) ─────────────────────
-- 규칙: %·기간(개월/달)·중량(kg/g/ml) 토큰을 먼저 제거한 뒤, 첫 "묶음 단위"
--       (박스/개입/팩/묶음/세트/병/캔/봉/입/개) 앞 숫자를 채택. 없으면 1.
--       포/스틱/P 등 "내용물 단위"는 묶음이 아니므로 제외("1개월/30포" → 30 오인 방지).
create or replace function promo.parse_pack(txt text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(txt, '')), '[0-9]+\s*%', '', 'g'),
        '[0-9]+\s*(개월|달)', '', 'g'),
      '[0-9]+(\.[0-9]+)?\s*(kg|g|ml)\b', '', 'g'
    ) as c
  )
  select greatest(1, coalesce(
    (regexp_match((select c from cleaned),
       '([0-9]+)\s*(박스|개입|팩|묶음|세트|병|캔|봉|입|개)'))[1]::int,
    1));
$$;

alter table promo.promotion_sales
  add column if not exists pack_size int;

-- 신규/변경 실적행은 트리거가 pack_size 자동 채움 (적재 경로 코드변경 의존 제거)
create or replace function promo.set_promotion_sales_pack()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.pack_size is null then
      new.pack_size := promo.parse_pack(new.option_info);
    end if;
  elsif new.option_info is distinct from old.option_info then
    new.pack_size := promo.parse_pack(new.option_info);
  end if;
  return new;
end;
$$;

drop trigger if exists promotion_sales_pack_size on promo.promotion_sales;
create trigger promotion_sales_pack_size
  before insert or update on promo.promotion_sales
  for each row execute function promo.set_promotion_sales_pack();

-- 과거분 백필 (option_info 불변 → 위 트리거가 덮어쓰지 않음)
update promo.promotion_sales
   set pack_size = promo.parse_pack(option_info)
 where pack_size is null;

-- ── (2) 플랜옵션 파생: option_signature / display_label ───────────────────
alter table promo.campaign_plan_options
  add column if not exists option_signature text,
  add column if not exists display_label text;

-- 구성 시그니처: (품목, 개입수) 집합의 정렬 해시. 같은 구성 = 같은 옵션(2개입/6개입은 다름).
create or replace function promo.compute_option_signature(p_option_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select md5(coalesce(string_agg(
      coalesce(i.product_id::text, '?') || ':' || i.sku_qty_per_option::text,
      '|' order by coalesce(i.product_id::text, ''), i.sku_qty_per_option), ''))
  from promo.campaign_plan_option_items i
  where i.campaign_plan_option_id = p_option_id;
$$;

-- 표시 라벨: 구성(품목×개입수) + 세트가. 라벨 단독으로는 2개입/6개입 구분 불가(핵심 불만) → 구조에서 재구성.
create or replace function promo.compute_option_display_label(p_option_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  with parts as (
    select string_agg(
        i.base_name || case when i.sku_qty_per_option > 1
             then ' ' || trim(to_char(i.sku_qty_per_option, 'FM999990')) || '개입'
             else '' end,
        ' + ' order by i.sort, i.base_name) as comp
    from promo.campaign_plan_option_items i
    where i.campaign_plan_option_id = p_option_id
  )
  select case
    when (select comp from parts) is null or (select comp from parts) = '' then o.option_label
    else (select comp from parts)
      || case when o.set_price is not null and o.set_price > 0
         then ' · ' || trim(to_char(o.set_price, 'FM999,999,999')) || '원'
         else '' end
  end
  from promo.campaign_plan_options o
  where o.id = p_option_id;
$$;

-- 아이템 변경 시 소속 옵션의 파생값 갱신 (다구성 insert 다건도 매행 반영)
create or replace function promo.refresh_plan_option_derived()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  oid uuid;
begin
  oid := coalesce(new.campaign_plan_option_id, old.campaign_plan_option_id);
  update promo.campaign_plan_options o
     set option_signature = promo.compute_option_signature(oid),
         display_label = promo.compute_option_display_label(oid),
         updated_at = now()
   where o.id = oid;
  return null;
end;
$$;

drop trigger if exists plan_option_items_derived on promo.campaign_plan_option_items;
create trigger plan_option_items_derived
  after insert or update or delete on promo.campaign_plan_option_items
  for each row execute function promo.refresh_plan_option_derived();

-- 기존 옵션 백필
update promo.campaign_plan_options o
   set option_signature = promo.compute_option_signature(o.id),
       display_label = promo.compute_option_display_label(o.id);

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
