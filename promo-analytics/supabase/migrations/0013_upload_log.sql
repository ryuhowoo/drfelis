-- 0013: 업로드 이력 — 연동된 파일명·시간·종류·행수 기록 (업데이트 참고용)
create table if not exists promo.upload_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,            -- 'daily' | 'promotion' | 'price_master'
  source_file text not null,
  detail text,                   -- 기간/캠페인명/시트 등 요약
  row_count integer,
  total_revenue numeric,
  action text,                   -- 'insert' | 'replace'(백필 교체)
  uploaded_by text,
  created_at timestamptz not null default now()
);

create index if not exists upload_log_created_idx on promo.upload_log (created_at desc);

alter table promo.upload_log enable row level security;
drop policy if exists upload_log_authenticated_all on promo.upload_log;
create policy upload_log_authenticated_all on promo.upload_log
  for all to authenticated using (true) with check (true);

grant all on promo.upload_log to authenticated;
