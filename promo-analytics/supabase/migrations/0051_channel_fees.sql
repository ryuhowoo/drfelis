-- 0051: 채널별 수수료 (피드백 8 — 1단계)
--
-- 우리 팀의 판매 채널별 수수료를 한곳에서 관리. 새 캠페인에서 채널을 선택하면 해당 수수료가
-- 공헌이익(mult) 계산에 반영된다(반영 로직은 2단계). 1단계는 테이블+시드+읽기.
-- 시드는 현재 레이트카드 수수료(0.045)로 통일 — 실제 채널별 값은 설정에서 입력.

create table if not exists promo.channel_fees (
  channel    text primary key,
  fee_rate   numeric not null default 0,   -- 0~1 수수료율
  sort       int not null default 0,
  updated_at timestamptz not null default now()
);
alter table promo.channel_fees enable row level security;
drop policy if exists channel_fees_auth on promo.channel_fees;
create policy channel_fees_auth on promo.channel_fees
  for all to authenticated using (true) with check (true);

insert into promo.channel_fees(channel, fee_rate, sort) values
  ('공식몰', 0.045, 1),
  ('네이버', 0.045, 2),
  ('선물하기', 0.045, 3),
  ('톡스토어', 0.045, 4),
  ('오늘의집', 0.045, 5),
  ('토스쇼핑', 0.045, 6),
  ('29CM', 0.045, 7)
on conflict (channel) do nothing;

grant all on all tables in schema promo to authenticated;
notify pgrst, 'reload schema';
