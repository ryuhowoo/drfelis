-- 0033: N7 P4 — SKU 정규화에 브랜드 동의어 '세븐플러스'(=7+) 추가
--
-- 배경: 플랜은 "(제품) 닥터펠리스 7+ 케어 스틱 연어", 실적은 "세븐플러스 7+ 케어 스틱 연어"로
--   같은 SKU 를 다른 브랜드 문자열로 기록 → normalize_sku_name 이 '세븐플러스'를 못 지워
--   서로 다른 키가 되어 매칭 실패(7+ 케어 라인이 실제 ~8.8M 팔렸는데 '미판매'로 표시).
--
-- 해결: 0018 의 정규화에 '닥터펠리스'처럼 '세븐플러스'(7+ 브랜드명)도 제거 토큰으로 추가.
--   → 양쪽 모두 "7케어스틱연어150g15p" 로 수렴해 매칭. 다른 SKU 와 충돌 없음(세븐플러스는 7+ 전용).
--   immutable SQL 함수 교체 → plan_vs_actual / sku_match_diagnostic / plan_vs_actual_options 전부 자동 반영.
--   적용 후 refresh_rollups(true) 필요.

create or replace function promo.normalize_sku_name(name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(name, ''), '\([^)]*\)', '', 'g'),
        '(닥터펠리스|세븐플러스)', '', 'g'
      ),
      '\s+', '', 'g'
    ),
    '[\[\](){}.,/+\-]', '', 'g'
  ));
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
