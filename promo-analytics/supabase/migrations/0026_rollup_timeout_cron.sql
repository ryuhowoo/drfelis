-- 0026: 롤업 재계산 타임아웃·백그라운드 갱신 (404 오인 사고 후속)
--
-- 문제: 변이(플랜 연동 등) 후 첫 조회가 refresh_rollups(~6.5s)를 동기 수행 →
--       authenticated 기본 statement_timeout(8s)에 걸리면 번들 RPC가 에러 →
--       상세 페이지가 이를 '캠페인 없음'으로 오인해 404 렌더.
-- 해결: (1) authenticated 타임아웃 30s 상향 (재계산 헤드룸)
--       (2) pg_cron 5분 주기 promo.refresh_rollups() — dirty 아닐 땐 즉시
--           no-op. 사용자가 콜드 경로(동기 재계산)를 밟을 일이 거의 없어짐.
--       (3) 앱: 상세 페이지 RPC 에러를 404 가 아닌 에러 바운더리로 분기,
--           (dash)/error.tsx 재시도 화면 추가. (코드 변경, 본 파일 외)

alter role authenticated set statement_timeout = '30s';

create extension if not exists pg_cron;

select cron.unschedule('promo-refresh-rollups')
where exists (select 1 from cron.job where jobname = 'promo-refresh-rollups');

select cron.schedule(
  'promo-refresh-rollups',
  '*/5 * * * *',
  $$select promo.refresh_rollups();$$
);
