-- 0061: 품목/가격 마스터 — Google Sheets '웹에 게시(CSV)' 연동 설정
--
-- 가격 마스터를 스프레드시트와 연동해 하루 1회 자동 + 수동 동기화한다. 공개 CSV URL과
-- 마지막 동기화 상태를 보관하는 싱글톤 설정 테이블. 실제 fetch·파싱·upsert는 앱/크론에서 수행.

create table if not exists promo.sheet_sync (
  id             int primary key default 1,
  csv_url        text,
  enabled        boolean not null default true,
  last_synced_at timestamptz,
  last_status    text,            -- 'ok' | 'error: ...'
  last_row_count integer,
  updated_at     timestamptz not null default now(),
  constraint sheet_sync_singleton check (id = 1)
);

insert into promo.sheet_sync (id) values (1)
on conflict (id) do nothing;

alter table promo.sheet_sync enable row level security;
drop policy if exists sheet_sync_auth on promo.sheet_sync;
create policy sheet_sync_auth on promo.sheet_sync
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
