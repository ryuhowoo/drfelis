-- 0054: 채널별 수수료 업계 추정치 출발점 (피드백 후속 2)
--
-- 실제 계약 수수료는 팀이 설정에서 입력한다. 여기서는 placeholder(0.045)인 채널만 업계 일반
-- 추정치로 갱신해, 사용자가 이미 수정한 값은 보존한다. 추정치이므로 설정에서 실값으로 교체 권장.
-- (추정 근거: 공식몰=자사몰 낮음 / 마켓플레이스는 카테고리·계약별 상이)

update promo.channel_fees set fee_rate = v.rate, updated_at = now()
from (values
  ('공식몰', 0.045),
  ('네이버', 0.06),
  ('선물하기', 0.10),
  ('톡스토어', 0.035),
  ('오늘의집', 0.22),
  ('토스쇼핑', 0.06),
  ('29CM', 0.34)
) as v(channel, rate)
where channel_fees.channel = v.channel
  and channel_fees.fee_rate = 0.045;  -- placeholder 인 것만 (사용자 편집 보존)
