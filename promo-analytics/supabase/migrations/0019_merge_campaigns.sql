-- 0019: 캠페인 병합 함수 — 가이드와 실적이 서로 다른 캠페인 코드로 업로드된 케이스 해결
--
-- 시나리오: 가이드(⑤)는 'CF_P_260511_벌크UP' 코드로, 실적(②)은 'CF_P_260518' 코드로
-- 업로드돼 같은 행사인데 두 개의 promotion 행이 생긴 경우. 한쪽의 모든 데이터를
-- 다른 쪽으로 이전한 뒤 원본 삭제.
--
-- 이전 대상: promotion_sales, promotion_notes, promotion_main_products,
--           promotion_purpose_weights, promotion_sku_mappings, campaign_plans
-- 메타: 시작일/종료일은 합집합으로 확장. name/code 는 target 유지.
-- 제약: 양쪽 모두 플랜이 있으면 거부 (사용자가 한쪽 먼저 정리해야 함).

create or replace function promo.merge_campaigns(source_id uuid, target_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_source promo.promotions%rowtype;
  v_target promo.promotions%rowtype;
  v_source_plan_count int;
  v_target_plan_count int;
  v_sales_moved int;
  v_notes_moved int;
begin
  if source_id = target_id then
    raise exception '원본과 대상이 같습니다';
  end if;

  select * into v_source from promo.promotions where id = source_id;
  if not found then raise exception '원본 캠페인을 찾을 수 없습니다'; end if;

  select * into v_target from promo.promotions where id = target_id;
  if not found then raise exception '대상 캠페인을 찾을 수 없습니다'; end if;

  select count(*) into v_source_plan_count from promo.campaign_plans where promotion_id = source_id;
  select count(*) into v_target_plan_count from promo.campaign_plans where promotion_id = target_id;
  if v_source_plan_count > 0 and v_target_plan_count > 0 then
    raise exception '양쪽 캠페인 모두 플랜이 있어 자동 병합 불가. 한쪽 플랜을 먼저 정리하세요.';
  end if;

  -- 단순 이전 (PK 가 자체 id 라 충돌 없음)
  update promo.promotion_sales set promotion_id = target_id where promotion_id = source_id;
  get diagnostics v_sales_moved = row_count;

  update promo.promotion_notes set promotion_id = target_id where promotion_id = source_id;
  get diagnostics v_notes_moved = row_count;

  -- 충돌 가능: 같은 (target_id, key) 있으면 target 유지
  insert into promo.promotion_main_products (promotion_id, product_id)
    select target_id, product_id from promo.promotion_main_products
    where promotion_id = source_id
    on conflict do nothing;
  delete from promo.promotion_main_products where promotion_id = source_id;

  insert into promo.promotion_purpose_weights (promotion_id, purpose, weight)
    select target_id, purpose, weight from promo.promotion_purpose_weights
    where promotion_id = source_id
    on conflict (promotion_id, purpose) do nothing;
  delete from promo.promotion_purpose_weights where promotion_id = source_id;

  insert into promo.promotion_sku_mappings (promotion_id, plan_product_id, actual_product_id)
    select target_id, plan_product_id, actual_product_id from promo.promotion_sku_mappings
    where promotion_id = source_id
    on conflict do nothing;
  delete from promo.promotion_sku_mappings where promotion_id = source_id;

  -- 플랜 이전 (한쪽에만 있을 때만 도달)
  update promo.campaign_plans set promotion_id = target_id where promotion_id = source_id;

  -- 메타: 기간 합집합 (start = min, end = max)
  update promo.promotions
  set start_date = least(v_source.start_date, v_target.start_date),
      end_date = greatest(v_source.end_date, v_target.end_date)
  where id = target_id;

  -- 원본 삭제 (cascade)
  delete from promo.promotions where id = source_id;

  return jsonb_build_object(
    'ok', true,
    'target_id', target_id,
    'sales_moved', v_sales_moved,
    'notes_moved', v_notes_moved,
    'plans_moved', v_source_plan_count
  );
end;
$$;

grant execute on function promo.merge_campaigns(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
