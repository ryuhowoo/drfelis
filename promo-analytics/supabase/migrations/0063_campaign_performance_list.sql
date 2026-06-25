-- 0063: 캠페인 성과 리스트 — 업로드 페이지 ④ '캠페인 성과' 카드용 읽기 RPC
-- 세그먼트 성과가 적재된 캠페인을 시작일 최신순으로. 채널·기간·요약(매출·행수·카테고리수·정기비중)·최종적재시각.

create or replace function promo.campaign_performance_list()
returns table (
  promotion_id   uuid,
  name           text,
  code           text,
  channel        text,
  start_date     date,
  end_date       date,
  seg_rows       bigint,
  revenue        numeric,
  categories     bigint,
  subscription_revenue numeric,
  last_at        timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.code, p.channel, p.start_date, p.end_date,
         count(s.id)                                                              as seg_rows,
         coalesce(sum(s.revenue), 0)                                              as revenue,
         count(distinct s.category) filter (where s.category is not null)         as categories,
         coalesce(sum(s.revenue) filter (where s.order_type = 'subscription'), 0) as subscription_revenue,
         max(s.created_at)                                                        as last_at
  from promo.promotions p
  join promo.promotion_segment_sales s on s.promotion_id = p.id
  group by p.id
  order by p.start_date desc nulls last, max(s.created_at) desc;
$$;

grant execute on function promo.campaign_performance_list() to authenticated;
notify pgrst, 'reload schema';
