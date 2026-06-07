-- 0012: 캠페인×목적 적합도 배치 로더 (S5.3) — 히스토리 목록 필터/정렬/분포용
create or replace function promo.campaign_fits()
returns table (
  promotion_id uuid,
  purpose text,
  fit_score_0_100 numeric,
  data_reliable boolean
)
language sql
stable
set search_path = ''
as $$
  select pr.id, f.purpose, f.fit_score_0_100, f.data_reliable
  from promo.promotions pr
  cross join lateral promo.purpose_fit(pr.id) f;
$$;

grant execute on all functions in schema promo to authenticated;
