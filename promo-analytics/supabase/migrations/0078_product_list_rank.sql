-- 0078: 카탈로그 노출/정렬용 list_rank
-- B2C 가격표(시트)에 있는 SKU만 /products 표에 보이게 하고, 시트 순서(중요도)대로 정렬한다.
-- list_rank 가 NULL = 카탈로그에서 숨김(과거 데이터·구성품 등은 삭제하지 않고 보존, '전체 보기'로 확인 가능).
-- 시트의 캣트리스 조합세트 4종(라운지/캣핫/정글짐/캣타워)은 DB에 상품으로 없어 rank 43~46 비워둠.

alter table promo.products add column if not exists list_rank int;

-- 재실행 안전: 먼저 비우고 시트 순서대로 다시 부여
update promo.products set list_rank = null where list_rank is not null;

update promo.products p set list_rank = v.rank
from (values
  ('DR10071',1),('DR10081',2),('DR10030',3),('DR10040',4),('DR10036',5),('DR10033',6),('DR10041',7),
  ('DR10067',8),('DR10068',9),('DR10063',10),('DR10064',11),('DR10038',12),('DR10039',13),
  ('DR10011',14),('DR10021',15),('DR10012',16),('DR10022',17),('DR10072',18),
  ('DR10043',19),('DR10044',20),('DR10042',21),
  ('DR10007',22),('DR10008',23),('DR10010',24),('DR10019',25),('DR10020',26),('DR10023',27),('DR10024',28),
  ('DR10025',29),('DR10055',30),('DR10065',31),('DR10069',32),('DR10073',33),('DR10045',34),
  ('DR10066',35),('DR10034',36),('DR10035',37),('DR10061',38),
  ('DR10006',39),('DR10005',40),('DR10003',41),('DR10004',42),
  ('DR10026',47),('DR10027',48),('DR10059',49),('DR10060',50)
) as v(dr_code, rank)
where p.dr_code = v.dr_code;

notify pgrst, 'reload schema';
