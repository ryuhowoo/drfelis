# 캠페인 애널리틱스 — 핸드오프 (2026-06-04)

> 새 채팅 세션이 이 한 파일만 읽어도 프로젝트를 이어받을 수 있게 정리.
> 기획 원문은 저장소 루트 [`SPEC.md`](../SPEC.md), 코드 컨벤션은 [`AGENTS.md`](AGENTS.md).

## 0. TL;DR

드르펠리스 사내 MD 도구. 자사몰 **캠페인**의 매출 기여도를 측정해 유사 사례로 매출을 예측하고, 목표 매출을 위한 캠페인 혜택을 처방함. Next.js 16(App Router, Turbopack) + Supabase(Auth+Postgres) + Vercel. 사내 `@drfelis.com` 도메인 제한.

용어: 화면 텍스트는 **"캠페인"**으로 일괄 통일. URL 경로(`/promotions/`), DB 스키마(`promotions`/`promotion_*`), 변수명은 호환을 위해 유지.

## 1. 현재 상태 스냅샷

- **배포**: <https://df-promo-dsbd.vercel.app> (Vercel)
- **Supabase 프로젝트 ID**: `mlbtnnchbpctgjjawkue` (스키마: `promo`)
- **데이터**: `daily_sales` 27,400행, 2024-06-04 ~ 2026-06-03 (730일, 69개 상품)
- **캠페인**: 22건 등록
- **전 매장 일자 단위 지표**: 상시 일평균 **₩8,025,854** / 행사 일평균 **₩21,914,043** / 평소 대비 **2.73배**

## 2. 데이터 모델 (`promo` 스키마)

| 테이블 | 핵심 컬럼 | 용도 |
|---|---|---|
| `products` | `id, base_name, dr_code, category, cost, consumer_price, regular_price` | 기초상품(SKU) 마스터 |
| `daily_sales` | `sale_date, product_id, base_name, option_info, revenue, quantity, source_file` | 일별 매출 시계열 (baseline의 연료) |
| `promotions` | `id, name, code, start_date, end_date, purpose, purposes[], promo_type, promo_types[], season_tag, benefits jsonb, contribution_amount, notes` | 캠페인 메타 |
| `promotion_main_products` | `promotion_id, product_id` | 캠페인의 메인 상품(특별 혜택 부여) |
| `promotion_sales` | `promotion_id, product_id, base_name, option_info, revenue, order_count, aov, fee, cost, quantity` | 캠페인 기간 실적 (전 상품) |
| `promotion_notes` | `promotion_id, question, answer, cause_tags[]` | 정성 메모(집요하게 묻기) |
| `benefit_types` | `name, sort` | 혜택 종류 마스터 (할인/사은품/1+1…) |
| `seasonalities` | `name, sort` | 시즌성 마스터 |
| `purposes` | `name, sort` | 목적 마스터 (세일즈/브랜딩/재고소진/신제품 런칭/리뉴얼/회원 활성화) |

`benefits` jsonb 예시:
```json
{ "discount_rate": 0.3, "gift": { "name": "포캣트릿", "value": 10000 }, "mechanic": "2+2" }
```

RLS: 모든 테이블 `authenticated` 역할에 `for all using (true) with check (true)` (사내 OAuth 통과 = 풀 권한).

## 3. 측정 엔진 (Postgres 함수)

`promo.promotion_measurement(p_id uuid)` v2 — 캠페인 product별 측정:
- **baseline = 직전 8주 비프로모션 일자**의 product별 일평균
- **요일 보정**: product × 요일별 평균을 캠페인 기간 요일 분포에 매칭
- **콜드스타트**: 관측 일수 < 14면 `cold_start=true` 마크
- **추세 보정**: 직전 8주 / 16주 일평균 비율, ±20% 캡 + 50% 보수 적용
- **±2σ 트림**: product별 baseline 일매출 이상치 제거 후 평균/표준편차 재산출
- **95% CI**: `baseline_std × √promo_days × 1.96`

`promo.promotion_summary(p_id uuid)` v2 — 캠페인 집계:
`direct_uplift, halo_uplift, total_uplift, halo_share, contribution, contribution_rate, cold_start_count, trend_factor, uplift_ci`

`promo.overall_baseline_metrics()` — 전 매장 일자 단위 지표:
`baseline_daily, promo_daily, lift_ratio` (대시보드 하단 카드 전용)

## 4. 페이지 트리

```
app/
├── login                        Google OAuth (@drfelis.com 제한)
├── auth/{callback, signout}     OAuth 처리
└── (dash)                       사이드바 셸 + 페이지들
    ├── /                        대시보드: KPI Bento + 상시/행사 비교 + 월별 추세 + 동심원 + 성과 랭킹
    ├── /predict                 매출 시뮬레이터: 슬라이더로 실시간 예측
    ├── /prescribe               캠페인 추천: 다중 목표(세일즈/재고소진/브랜딩) 동시
    ├── /library                 히스토리 비교/분석: 모바일=카드 / 데스크톱=테이블
    ├── /promotions/[id]         캠페인 상세: 요약·증분표·차트·집요한 질문
    ├── /promotions/[id]/edit    캠페인 편집: 목적/혜택 multi · 시즌 자동추정 · 삭제
    ├── /upload                  업로드: 마스터/일별/캠페인 (전 흐름 브라우저 사이드)
    ├── /settings                분류 관리: 혜택·시즈널리티·목적 CRUD
    └── /seed                    (영구 비활성 — 410)

api/
├── promotions/[id]              PATCH(편집) / DELETE
├── promotions/[id]/notes        메모 CRUD
├── options                      혜택/시즌/목적 마스터 CRUD
├── predict / prescribe          예측·추천 RPC 래퍼
└── seed                         (영구 비활성 — 410)
```

## 5. 핵심 라이브러리 (`lib/`)

| 파일 | 역할 |
|---|---|
| `parse.ts` | 엑셀 헤더 자동 인식 파서 (마스터/일별/캠페인) |
| `predict.ts` | 유사 사례 검색 + `recommendByGoal`/`recommendByGoals`(다중 목표 가중) |
| `cases.ts` | `CaseFeature[]` 로더 (각 캠페인의 summary + measurement 집계) |
| `season.ts` | 캠페인 이름·시작일로 시즌 자동 추정 (시드 폴백 + 좁은 윈도 우선) |
| `format.ts` | `won/wonShort/pct/num/daysBetween` |
| `products.ts` | `ensureProducts(map)` + `chunk(arr)` |
| `supabase/{client,server,proxy}.ts` | SSR 클라이언트 + 미들웨어(`@drfelis.com` 도메인 차단) |
| `types.ts` | Promotion / MeasurementRow / PromotionSummary 등 |
| `constants.ts` | 기본 분류 fallback (테이블 비어있을 때) |

## 6. 작업 히스토리 (이번 세션, 2026-06-04)

| PR | 제목 | 핵심 |
|---|---|---|
| #21 | 측정 v2 + 업로드 4.5MB 우회 | 요일/콜드스타트/추세/트림/CI + xlsx 브라우저 파싱 |
| #23 | 캠페인 삭제 · 목적 다중 · 리네임 · 다중 목표 추천 | purposes 마스터/컬럼 + "프로모션→캠페인" UI + 추천 다중 목표 |
| #24 | 폰트·모바일·동심원·시즌 추정 | Pretendard + ASTA Sans 슬롯 / 카드 리스트 / 라벨 차트 밖 / `lib/season.ts` |
| #25 | ASTA Sans → Fontsource | `@fontsource-variable/asta-sans` 자체호스팅. 빌드 네트워크 의존 0 |
| #26 | 대시보드 일평균 부풀림 수정 | `overall_baseline_metrics()` RPC + 라벨 "캠페인별/전 매장" 명확화 |
| #27 | seed 비활성 + 업로드 중복 경고 | `/api/seed` 410, 업로드 시 다른 source 데이터 confirm |

이번 세션 큰 사건: **데이터 부풀림 사고**. `seed`(1년치) + `(4).xlsx`(2년치)가 1년치 겹쳐서 매출이 2배. 사용자 결정으로 `daily_sales`에서 seed/부분파일 모두 삭제, `(4).xlsx`만 27,400행 유지. seed 라우트 영구 비활성으로 재발 방지.

## 7. 다음 작업 — 사용자 지시 (2026-06-04)

### 7.1 목적(purpose) 중심 분석 전반화 — **최우선**
> "매출 시뮬레이터·히스토리 비교 등 모든 부분에서 각 캠페인의 가장 중요한 점은 '목적'이야. 목적에 따라 성과가 달라질 수 있는데 기여 매출로만 보는 건 부적합해."

`promotions.purposes[]`는 이미 입력 가능(PR #23). 다음은 **결과·비교·예측을 목적으로 슬라이스**:

- **대시보드**: 목적별 기여 매출/공헌이익 비중 카드, 목적별 평균 점수 도넛
- **히스토리(`/library`)**: 목적 필터 + 목적별 점수 분포, 정렬에 "목적 적합도"
- **시뮬레이터(`/predict`)**: 입력에 목적 선택 → 그 목적의 사례로만 가중평균
- **캠페인 상세(`/promotions/[id]`)**: 그 캠페인 목적별 핵심 지표(세일즈면 증분/공헌이익, 브랜딩이면 구매건수·신규 비중)
- **추천(`/prescribe`)**: 이미 다중 목표 입력(PR #23). 결과 카드에 목적별 충족도 더 시각적으로

### 7.2 가격 가이드 (캠페인 시뮬레이션 가이드) — **신규 구조**
> "각 캠페인을 실행하기 전에는 가격가이드를 짜서 각 SKU별 할인율이나 예상 판매 수량을 넣고 공헌이익까지 계산해. 캠페인을 통한 성과를 미리 예측하고 진행하는데, 이 달성률이 매우 중요해."

핵심 컨셉: **사전 계획 vs 사후 실적**의 갭(달성률)을 추적하는 게 곧 학습.

DB 신규 테이블(안):
```sql
create table promo.campaign_price_guides (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid references promo.promotions(id) on delete cascade,
  product_id    uuid references promo.products(id),
  base_name     text not null,
  discount_rate numeric,          -- 계획 할인율 0~1
  expected_qty  numeric,          -- 예상 판매수량
  expected_price        numeric,  -- 예상 단가
  expected_revenue      numeric,  -- 예상 매출 (qty × price)
  expected_contribution numeric,  -- 예상 공헌이익
  created_at    timestamptz default now()
);
-- 캠페인당 한 번에 일괄 업로드. 캠페인 생성 직전/직후.
```

업로드: `/upload`에 4번째 카드(혹은 별도 `/upload/guide`) 추가. 엑셀 파싱 → 캠페인 선택(또는 매칭) → 일괄 적재.

달성률 측정 (사후):
- `actual_revenue` vs `expected_revenue` → 매출 달성률
- `actual_quantity` vs `expected_qty` → 수량 달성률
- `actual_contribution` vs `expected_contribution` → 공헌이익 달성률

표시:
- **캠페인 상세**: SKU 단위 가이드 vs 실적 표, 전체 달성률 카드
- **대시보드**: 최근 캠페인 평균 달성률 KPI, 달성률 추세
- **히스토리**: 목록에 달성률 컬럼/배지
- **시뮬레이터·추천**: 과거 달성률 패턴을 신뢰도에 가중

### 7.3 우선순위(제안)
1. **price_guides 스키마 + 업로드 + 캠페인 상세 표시** — 가장 큰 구조 변화
2. **달성률 계산 + 대시보드/히스토리 노출**
3. **목적별 슬라이스 전반화** (각 화면 단위로 점진 적용)
4. 달성률 패턴을 예측 엔진에 통합 (장기)

## 8. 운영·환경

| 항목 | 값 |
|---|---|
| Next.js | 16.2.7 (Turbopack) |
| Node | 20+ |
| 패키지 | `@supabase/ssr`, `@supabase/supabase-js`, `recharts`, `xlsx`, `@fontsource-variable/asta-sans` |
| 폰트 | ASTA Sans → Pretendard → Apple SD Gothic Neo → 시스템 (체인) |
| 환경변수 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ALLOWED_EMAIL_DOMAIN=drfelis.com` |
| 마이그레이션 | `supabase/migrations/0001 ~ 0005` (DB는 이미 적용된 상태) |

## 9. 알려진 제약·주의

- 현재 `daily_sales`엔 `option_info`가 모두 `""`이고 `quantity=0` — 사용자가 올린 `(4).xlsx`에 옵션·수량 컬럼이 없었음. 수량 기반 지표(`재고소진`·`브랜딩`)는 신뢰도 낮음 → 향후 수량 데이터 확보 필요.
- 추세 보정은 8주/16주 비율. **작년 동기간 비교는 데이터 미보유로 미구현**. 2년치(2024-06~) 확보 후 시즌 보정으로 업그레이드 가능.
- `seed` 라우트는 영구 비활성(410). 초기 적재는 `/upload`에서.
- ASTA Sans는 자체호스팅 npm 패키지 (`@fontsource-variable/asta-sans`) — 빌드 시 외부 네트워크 의존 0.

## 10. 빠르게 시작하기 (새 채팅 세션 가이드)

1. 이 파일 + `SPEC.md` + `AGENTS.md` + `S0_로드맵_아키텍처_마스터.md`를 첨부 (가격 가이드/달성률/목적 슬라이스 로드맵은 S0가 마스터)
2. 디렉토리: 모든 코드는 `promo-analytics/` 아래
3. DB 작업은 Supabase MCP의 `apply_migration` 또는 SQL Editor
4. 코드 컨벤션: `AGENTS.md`("This is NOT the Next.js you know")를 우선 참조
5. 머지 워크플로: branch → push → PR → Vercel 미리보기 빌드 Ready → 머지 (코드 변경 시 빌드 자동 트리거)
