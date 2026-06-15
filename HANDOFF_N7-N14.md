# HANDOFF — N7~N14 (Codex 이어받기용)

> 작성: 2026-06-15 · 이 문서 하나로 Codex(또는 새 세션)가 현재 상태에서 이어서 작업할 수 있게 정리.
> 직전 작업은 Claude Code(+Supabase MCP)로 진행 — DB 마이그레이션을 운영에 직접 적용함. Codex에서 이어갈 때의 차이는 §7 참고.

---

## 0. 한 줄 요약
이커머스 캠페인 **플랜 vs 실적** 애널리틱스 앱. 이번 세션에서 **매칭 재설계(N7)** → **매출 중심 달성 모델(N8)** → **정리/폴백·구독 분리(N9~N14)** 까지 완료. 모두 프로덕션 반영됨.

## 1. 환경
- **레포**: `ryuhowoo/drfelis` · 앱 루트 **`promo-analytics/`** (Next 16 / React 19 / Tailwind v4 / Recharts / Supabase).
  - ⚠️ `promo-analytics/AGENTS.md`: "이건 네가 아는 Next.js가 아니다" — API 전에 `node_modules/next/dist/docs/` 확인.
- **Supabase**: project_id `mlbtnnchbpctgjjawkue`, 스키마 **`promo`**. 클라이언트는 `db: { schema: "promo" }`.
  - 마이그레이션: `promo-analytics/supabase/migrations/00NN_*.sql` 파일로 커밋 **+ 운영 DB에 적용**(이중 기록). **현재 최신: 0038. 다음은 0039.**
- **Vercel**: project `df-promo-dsbd`, 프로덕션 `https://df-promo-dsbd.vercel.app`. PR마다 프리뷰 자동 빌드.
- **PR 흐름**: feature 브랜치 → draft PR → Vercel Ready 확인 → squash 머지 → `git fetch origin main && git reset --hard origin/main`.

## 2. 아키텍처 (반드시 이해)
- 모든 페이지는 `promo.dashboard_bundle()/library_bundle()/promotion_detail_bundle(p_id)/plans_bundle()` **단일 RPC**로 사전계산 결과만 읽음(빠름). **읽기경로는 재계산 안 함**.
- 사전계산은 `promo.refresh_rollups(p_force boolean)`가 `campaign_rollups`/`global_rollups`에 적재. 입력테이블 변경 → 트리거가 `rollup_state.version`++ → pg_cron(2분)/프리웜이 refresh. `version > built_version`이면 stale.
- **달성/매칭 RPC를 바꾸면 → `refresh_rollups(true)` 강제 + 번들(`rollup.*`) 검증 필수.** refresh_rollups가 RPC를 **이름으로** 호출하므로, 같은 시그니처면 자동 반영.

## 3. 이번 세션에서 한 일 (N7~N14)
- **N7 매칭 재설계** (설계 본문 `N7_매칭_재설계.md`):
  - P1(0030): `promotion_sales.pack_size`+`promo.parse_pack(text)`(묶음수 파싱) / `campaign_plan_options.option_signature`·`display_label`(구성·개입수·세트가) / 임포터 '구성' 컬럼 다구성 지원.
  - P2(0031): `plan_vs_actual_options` 재작성 — 옵션 라벨 텍스트매칭(전부 0%) → **(정규화SKU, pack_size) 라우팅** + `match_source`.
  - P3: 상세 UI 통합 — SKU/옵션 탭, `display_label`·`match_source` 노출.
  - P4(0032·0033): 오염 옵션 11건 보정(라벨=base_name 제품으로 재지정) + `normalize_sku_name`에 브랜드 동의어 `세븐플러스`(=7+) 추가.
- **N8 매출 중심 달성 모델** (사용자 핵심 방향):
  - P1(0034): `plan_vs_actual_summary`에 신규 필드 — `subscription_revenue/main_revenue/halo_revenue/campaign_revenue_total/revenue_ach_total/contribution_total/contribution_ach_total`. `campaign_plans.main_product_ids`(메인 명시 지정, null=플랜 SKU 전체).
    - **매출 달성 = 캠페인 전체 실적(구독 제외)/목표(옵션 기대매출 합). 수량은 메인 제품만 따로.** (메인은 예상만큼 안 팔려도 '함께 구매' 매출로 목표를 채우는 현실 반영)
  - P2: 카드 재구성 [캠페인 매출 달성(전체)]·[메인 수량 달성]·[공헌(전체)] + 함께 구매 매출 라인 + 메인 수량 막대.
  - P3(0035): `campaign_plans.tags`(자유 태그) + `promo.halo_benchmarks()` + `HaloRecommendPanel`(플랜 편집 화면: 메인↔전체매출 양방향 추정 + 벤치마크). API `/api/promotions/[id]/plan/meta`.
- **N9(0036)**: 옵션 매칭 **SKU 폴백** — 개입 정확매칭 없으면 같은 SKU 옵션에 SKU 실적 분배(벌크UP 8개입 0% 문제 해결). + 상세 화면 정리(중복 수량 막대/표 통합, 매칭 패널 기본 접힘).
- **N10**: 업로드 백필 — 동기간 총매출 ±5% 초과 **하드 차단 폐기** → 최신 파일로 교체(교환·환불·취소 반영). 확인창에 경고만.
- **N11(0037)~N14(0038)**: 정기구독을 **상품(품목)으로 식별**(`products.is_subscription`) → 달성 제외 + '정기구독 매출(별도)' 섹션 + 진단표 '구독 지정' 토글(API `/api/products/subscription`). 텍스트 폴백은 제거(상품 플래그로 일원화).

## 4. 핵심 파일/함수 맵
- 상세 화면: `app/(dash)/promotions/[id]/page.tsx`, `Achievement.tsx`(달성 카드/SKU·옵션 탭/함께구매/구독섹션), `SkuMatchPanel.tsx`(진단표·매핑·구독토글).
- 플랜 편집: `app/(dash)/promotions/[id]/plan/page.tsx`, `PlanEditor.tsx`, `HaloRecommendPanel.tsx`(추천/태그/메인지정).
- 임포터: `lib/parsePlanGuide.ts`, `app/(dash)/upload/page.tsx`(가이드/실적/일별 백필).
- 타입: `lib/types.ts` (`PlanVsActualSummary`·`PlanVsActualOption`·`PlanVsActualRow`).
- 주요 RPC: `plan_vs_actual`, `plan_vs_actual_options`, `plan_vs_actual_summary`, `sku_match_diagnostic`, `halo_benchmarks`, `normalize_sku_name`, `parse_pack`, `refresh_rollups`, `promotion_detail_bundle`.

## 5. 표본 캠페인
- 플랜+실적 연동 = **2개**뿐: Better Habits(실적 `626e9550-50f2-432d-a093-e3b4eb95c776`) / 벌크UP(실적 `e4f9e870-7088-47cf-bd00-0ba6b0a50492`).
- Better Habits: 매출 달성(전체) ~160%, 메인 수량 ~57%. 벌크UP: 매출 ~25%, 옵션 SKU폴백 정상.

## 6. 열린 작업 (다음 할 일)
1. **(데이터 버그) 벌크UP 예상 공헌이익 음수** — 옵션 `unit_sale_price`가 원가와 동일하게 적재됨(`set_price 37,787 ÷ 8개입 = 4,723 = cost`). `products.cost`는 정상. **가이드의 세트가/개입수(8) 파싱이 실제와 다른 것**으로 추정. 가이드(⑤) 재업로드 또는 실제 세트가 확인 후 `parsePlanGuide.ts` 검증·플랜 set_price 보정 필요. (현재 화면은 N12로 "계산 불가"+안내만)
2. **추천 시드**: 연동 캠페인 2개에 태그(예: 입문/구독, 벌크업)·메인·구독 품목을 지정하면 `halo_benchmarks` 추천이 의미 생김.
3. **콤보(혼합) 옵션 매칭** 정교화 (현재 `match_source='none'`).
4. **함께 구매 Top 제품** 심화 / 시즌(월) 자동 그룹.

## 7. Codex에서 이어갈 때 주의
- **DB 적용 격차**: 직전 세션은 Supabase MCP로 마이그레이션을 운영 DB에 직접 적용했음. Codex 클라우드 샌드박스엔 보통 그 접근이 없음 → **마이그레이션 SQL 파일을 커밋만** 하고, **운영 DB 적용은 별도**(Supabase 대시보드 SQL 에디터 또는 `supabase` CLI)로 해야 함. 적용 후 `select promo.refresh_rollups(true);` 잊지 말 것.
- 빌드 검증: `cd promo-analytics && npm install && npx tsc --noEmit && npm run build`.
- 커밋/PR에 **모델 식별자·비공개 키 노출 금지**. PR은 draft로 만들고, 가능하면 사람이 머지.
- 컨벤션: 마이그레이션은 add column + 신규/치환 함수 위주(비파괴·멱등), 반환 시그니처 바꿀 땐 DROP+CREATE.
