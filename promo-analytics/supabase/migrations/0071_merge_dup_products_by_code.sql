-- 0071: 같은 dr_code 를 가진 중복 product 병합 (이름만 다르고 같은 상품)
--
-- 원인: products 는 base_name 기준으로 생성/업서트되는데(applyPriceMasterCsv·ensureProducts),
-- 같은 SKU 가 마스터 카탈로그명("(제품) …")과 플랜/성과 적재명("…")으로 서로 다르게 들어오면
-- 같은 dr_code 를 가진 두 행이 생긴다. 매칭 진단(sku_match_diagnostic)은 product 의 base_name 을
-- 정규화해 비교하므로, 한쪽 이름이 달라 '플랜만/성과만' 고아로 남는다.
--
-- 해결: dr_code 가 같은 행을 1개로 병합. survivor = 매출 보유 우선 → '(제품)' 접두 → 오래된 순.
-- 모든 참조를 survivor 로 repoint 후 loser 삭제. 매출(promotion_sales/segment_sales/daily_sales)은
-- 코드별로 한쪽 id 에만 존재하므로(점검 완료) 합산/중복 없이 안전. 가격구성·메인·매핑은 충돌행 정리 후 이전.
-- 이 함수는 가격 마스터 동기화(applyPriceMasterCsv) 끝에서 best-effort 로 호출돼 재발을 자동 치유한다.

create or replace function promo.merge_dup_products_by_code()
returns table(out_code text, out_survivor uuid, out_merged int)
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_survivor uuid;
  v_loser uuid;
  v_count int;
begin
  for r in
    select p.dr_code as code, array_agg(p.id) as ids
    from promo.products p
    where p.dr_code is not null and p.dr_code <> ''
    group by p.dr_code
    having count(*) > 1
  loop
    select p.id into v_survivor
    from promo.products p
    where p.id = any(r.ids)
    order by
      (exists(select 1 from promo.promotion_sales s where s.product_id=p.id)
        or exists(select 1 from promo.promotion_segment_sales s where s.product_id=p.id)
        or exists(select 1 from promo.daily_sales s where s.product_id=p.id)) desc,
      (p.base_name like '(제품)%') desc,
      p.created_at asc
    limit 1;

    v_count := 0;
    foreach v_loser in array r.ids loop
      if v_loser = v_survivor then continue; end if;

      -- 충돌 가능 테이블: 충돌행 먼저 삭제 후 repoint
      delete from promo.product_price_configs l
      where l.product_id = v_loser
        and exists (select 1 from promo.product_price_configs s
                    where s.product_id=v_survivor and s.config_type=l.config_type);
      update promo.product_price_configs set product_id=v_survivor where product_id=v_loser;

      delete from promo.promotion_excluded_skus l
      where l.product_id=v_loser
        and exists (select 1 from promo.promotion_excluded_skus s
                    where s.product_id=v_survivor and s.promotion_id=l.promotion_id);
      update promo.promotion_excluded_skus set product_id=v_survivor where product_id=v_loser;

      delete from promo.promotion_main_products l
      where l.product_id=v_loser
        and exists (select 1 from promo.promotion_main_products s
                    where s.product_id=v_survivor and s.promotion_id=l.promotion_id);
      update promo.promotion_main_products set product_id=v_survivor where product_id=v_loser;

      -- sku_mappings: plan/actual 두 컬럼 (PK promotion_id,plan,actual)
      delete from promo.promotion_sku_mappings l
      where l.plan_product_id=v_loser
        and exists (select 1 from promo.promotion_sku_mappings s
                    where s.promotion_id=l.promotion_id and s.plan_product_id=v_survivor and s.actual_product_id=l.actual_product_id);
      update promo.promotion_sku_mappings set plan_product_id=v_survivor where plan_product_id=v_loser;
      delete from promo.promotion_sku_mappings l
      where l.actual_product_id=v_loser
        and exists (select 1 from promo.promotion_sku_mappings s
                    where s.promotion_id=l.promotion_id and s.actual_product_id=v_survivor and s.plan_product_id=l.plan_product_id);
      update promo.promotion_sku_mappings set actual_product_id=v_survivor where actual_product_id=v_loser;
      delete from promo.promotion_sku_mappings where plan_product_id = actual_product_id;

      -- 충돌 없는 테이블: 단순 repoint (loser 측엔 매출이 없음)
      update promo.campaign_plan_option_items set product_id=v_survivor where product_id=v_loser;
      update promo.daily_sales set product_id=v_survivor where product_id=v_loser;
      update promo.promotion_sales set product_id=v_survivor where product_id=v_loser;
      update promo.promotion_segment_sales set product_id=v_survivor where product_id=v_loser;

      -- 메인상품 배열(uuid[]) 내 치환 + 중복 제거
      update promo.campaign_plans
      set main_product_ids = (select array(select distinct e from unnest(array_replace(main_product_ids, v_loser, v_survivor)) e))
      where main_product_ids @> array[v_loser];

      delete from promo.products where id = v_loser;
      v_count := v_count + 1;
    end loop;

    out_code := r.code; out_survivor := v_survivor; out_merged := v_count;
    return next;
  end loop;
end;
$$;

grant execute on function promo.merge_dup_products_by_code() to authenticated, service_role, anon;

-- 기존 중복 일괄 정리 (idempotent — 중복 없으면 no-op)
select promo.merge_dup_products_by_code();

notify pgrst, 'reload schema';
