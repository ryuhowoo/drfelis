-- 0070: 성과 업로드 메타 (파일명·시각)
--
-- 캠페인 상세 '성과 교체' 카드에서 마지막 성과 업로드의 파일명/시각을 보여주기 위함.
-- replace_promotion_performance 업로드 직후 앱이 best-effort로 기록한다(promotions PATCH 허용 필드).

alter table promo.promotions
  add column if not exists perf_uploaded_at timestamptz,
  add column if not exists perf_source_file text;

notify pgrst, 'reload schema';
