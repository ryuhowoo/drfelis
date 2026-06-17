# 설계서: 실적 옵션 구조화 (Structured Actual Options) — 3단계 로드맵

> 상태: **설계안 (구현 전, 승인 대기)** · 작성일 2026-06-17
> 전제(승인됨): ② export에 `옵션코드`·`구성(SKU:qty)`·`주문유형(정기/일반)` 추가 가능 / 전체 3단계 로드맵 진행

---

## 0. 왜 (Problem)

플랜(계획) 쪽은 **구조화된 옵션**이다 — `campaign_plan_options`(묶음가·할인율·공헌이익) + `campaign_plan_option_items`(SKU별 qty·단가 BOM) + `option_signature`(= `MD5(product_id:qty …)`).
실적 쪽은 **납작한 SKU 줄 + 자유텍스트 `option_info`** 뿐이다. 둘을 잇는 3대 분석이 전부 정규식/휴리스틱 추정 위에 서 있다:

1. **구독 판정**: `option_info ~ '개월'` 단일 토큰. 검증 결과 이 캠페인 "구독" 35M 중 **양성신호(정기/구독 키워드) 0원**, 47%가 `1개월`짜리 1회구매, 31.5M이 `N박스 (M개월)` 벌크. → 벌크 캠페인을 구독으로 오판.
2. **옵션 매칭**: 2개 이상 SKU 묶음은 자동매칭 포기(`match_source='none'`). MD가 가장 신경 쓰는 "두 제품 묶음+할인"이 실적과 대조 불가.
3. **공헌이익**: `매출 × mult − 원가`로 물류비·광고비를 **매출의 %**로 근사 → 벌크 대형주문에서 과대계상, 분해 비노출.

부차적으로 **비교 대상 연결 / 병합 도구**는 ②(실적)·⑤(가이드)가 다른 코드로 업로드돼 캠페인이 쪼개지는 **수집 정체성 문제**의 증상이다.

**해결 원리**: 실적에도 *옵션*이라는 1급 객체를 만들어 플랜과 같은 언어(시그니처)로 맞춘다.

---

## 1. 설계 원칙

| 원칙 | 의미 |
|---|---|
| **양성신호 우선** | 구독은 `주문유형` 또는 명시 키워드로만. `개월` 단독 판정 금지(소진기간일 뿐). |
| **하위호환** | 신규 컬럼은 선택. 없으면 자유텍스트에서 파생. 기존 업로드 안 깨짐. |
| **플랜 대칭** | 실적옵션 = `campaign_plan_options`의 거울. `option_signature`로 결정론적 매칭. |
| **추적가능** | 모든 판정/매칭이 근거 기록(`sub_source`, `match_source`, `match_confidence`). |
| **predict 중립** | 신규 레이어는 가산적. 기존 `campaign_achievements`의 매칭값(`e.*`)은 명시적 재배선 전까지 보존 + 회귀검증. |

---

## 2. 목표 데이터 모델 (3단계 종착점)

### 2.1 `promo.promotion_sale_options` (신규 — 실적 옵션)
```sql
create table promo.promotion_sale_options (
  id                uuid primary key default gen_random_uuid(),
  promotion_id      uuid not null references promo.promotions(id) on delete cascade,
  option_code       text,            -- export 옵션코드 (Phase 2). 없으면 null
  label_raw         text,            -- 대표 원본 텍스트(최대매출 멤버)
  option_signature  text not null,   -- 멤버 (product_id[:qty]) 정렬 해시 — 플랜과 동일 알고리즘
  pack_size         int  default 1,
  term_months       int,             -- '개월' 파싱값 (소진기간; 구독 아님)
  is_subscription   boolean not null default false,
  sub_source        text,            -- 'export' | 'derived' | 'override'
  -- 멤버 합산(실측)
  revenue           numeric default 0,
  quantity          numeric default 0,
  cost              numeric default 0,
  fee               numeric default 0,
  order_count       numeric default 0,
  -- 매칭
  matched_plan_option_id uuid references promo.campaign_plan_options(id),
  match_source      text,            -- 'option_code' | 'signature' | 'label' | 'manual' | 'none'
  match_confidence  numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on promo.promotion_sale_options(promotion_id);
create index on promo.promotion_sale_options(option_signature);
```

### 2.2 `promo.promotion_sales` (확장)
```sql
alter table promo.promotion_sales
  add column sale_option_id uuid references promo.promotion_sale_options(id) on delete set null,
  add column order_type     text,    -- 'subscription' | 'onetime' | null  (export 주문유형)
  add column raw            jsonb;   -- 원본 업로드 행 보존(재파생/감사) — 현재 부재한 갭 보완
```

### 2.3 공유 시그니처 함수 (플랜·실적 동일 산식)
```sql
-- 멤버 집합으로부터 시그니처 산출 (Phase 1: qty 생략 = 집합모드 / Phase 2: qty 포함 = 정밀모드)
create function promo.option_signature(p_items jsonb, p_with_qty boolean) returns text ...
```
플랜의 `compute_option_signature`도 이 함수를 호출하도록 통일 → 양쪽이 **반드시** 같은 값을 낸다.

---

## 3. 매칭 (추정 → 결정론)

우선순위:
1. `option_code` 동일 (Phase 2) → `match_source='option_code'`, conf 1.0
2. `option_signature` 동일 → `'signature'`, conf 1.0 — **단일·다중 SKU 묶음 모두 커버**
3. 라벨/패턴 폴백(`match_patterns`) → `'label'`, conf 0.5
4. 미스 → `'none'` = **진짜 미매칭(데이터 갭)**

→ 이로써 3번 문제(미매칭 vs 서브/동반 혼동)도 정리: `matched` / `의도된 서브·함께구매` / `none(확인필요)` 3분.

> **정밀도 단계화**: Phase 1은 `SKU집합 + pack_size`(qty 미사용 — 실적 quantity 신뢰도 낮음)로 견고하게. Phase 2는 `구성` 컬럼의 정확 qty로 qty포함 시그니처.

---

## 4. 구독 판정 (1번 문제 해결)

옵션 속성으로 1회 결정 + 근거 기록:
- **export 주문유형 있으면** → `is_subscription = (주문유형='정기')`, `sub_source='export'` (Phase 2, 최종 정답)
- **없으면 파생**: `정기/구독/정기배송` 키워드 또는 `products.is_subscription`일 때만 구독. **`개월`은 `term_months`로만** (구독 아님). `sub_source='derived'`
- **수동 오버라이드**: MD 교정 → `sub_source='override'`

효과: 이 캠페인 35M 벌크는 **구독에서 제외**, UI엔 근거배지("추정"/"export확인"). `plan_vs_actual_summary`의 구독 버킷을 `sale_options.is_subscription`(양성신호) 기준으로 재배선.

---

## 5. 공헌이익 (5번 문제) — 옵션 단위 실측 분해

```
공헌이익 = 매출 − 수수료(실측) − 원가(실측) − 물류비 − 광고비
  · 수수료·원가: 실적옵션 멤버 합산(실측)
  · 물류비: 박스당 고정단가 × (pack_size × 박스수)     ← 매출%(12%) 대신 박스기준
  · 광고비: 캠페인 예산 × (옵션매출 / 전체매출)          ← 줄별 매출×10% 대신 배분
```
- 레이트카드 `mult` 방식은 **폴백**(박스단가·광고예산 미입력 시).
- 분해를 UI에 그대로 노출 → "어디서 마진이 깎였나" 추적 가능.
- **신규 입력 필요**(아래 열린 결정): 박스당 물류 단가, 캠페인 실제 광고비.

---

## 6. 수집 변화 (② export — 하위호환 선택 컬럼)

| 컬럼 | 효과 | 없을 때 |
|---|---|---|
| `옵션코드` | 옵션 정체성 확정 | `정규화(option_info)` 그룹핑으로 파생 |
| `구성` (예: `DR123:2, DR456:1`) | 정확 qty 시그니처·정확 플랜매칭 | SKU집합 + pack_size 근사 |
| `주문유형` (정기/일반) | 구독 양성신호 | 키워드 없으면 구독 제외 |

`normalize_option_info()`: 이모지, `[35%⬇️]` 배지, `상품선택1/2=` 골격, 공백 흡수 → Phase 1 그룹핑 정확도의 핵심.

---

## 7. 단계별 로드맵

### Phase 1 — 기존 데이터로 파생 (수집 변화 0)
**범위**
- `promotion_sale_options` + `promotion_sales.sale_option_id` 신설.
- 백필: 기존 `promotion_sales`를 `(promotion_id, normalize(option_info))`로 그룹핑 → 실적옵션 생성, 시그니처(집합모드), 합산.
- `normalize_option_info()` / `option_signature()` 공유함수.
- 시그니처 매칭 → `matched_plan_option_id`/`match_source`.
- **구독 정정**: 양성신호 기반, `개월`→`term_months`. 요약 구독버킷 재배선.
- **3분 택소노미** 라벨 정리(UI).
- predict: `campaign_achievements` 매칭값 불변 검증.

**산출물**: 마이그레이션(0042~0043 예상), `normalize` 파서 헬퍼, UI 라벨, 회귀쿼리.
**리스크**: 정규화 품질, 다중SKU qty 근사. **즉시효과**: 86%구독 오판·다중묶음 미매칭 해소.

### Phase 2 — 리치 export 수집
**범위**
- 파서: `옵션코드`·`구성`·`주문유형` 읽기 (`lib/parse.ts`).
- `option_code` → 텍스트 그룹핑 대체(안정 정체성).
- `구성` → 정확 qty → qty포함 시그니처 → 정확 플랜매칭.
- `주문유형` → 구독 양성판정(`sub_source='export'`).
- **옵션 단위 실측 공헌이익**(5장) + 박스물류단가·광고예산 입력 스키마.
- `raw jsonb` 저장.

**산출물**: 파서 변경, `replace_promotion_sales` RPC 확장, 공헌이익 함수, 레이트카드/예산 스키마(0044~).
**리스크**: export 형식 정착, 물류·광고 데이터 출처.

### Phase 3 — 수집 정체성 + 도구 격하
**범위**
- 업로드 시 **캠페인 명시 선택** → ②+⑤를 한 `promotion_id`에 결속(근본원인 제거).
- `actual_promotion_id` 비교연결 & 병합도구를 **관리자/정리용**으로 격하(함수는 유지).

**산출물**: 업로드 플로우 변경, UI 이동.

---

## 8. 횡단 관심사 — predict/library 회귀

각 단계마다: 적용 전/후 `ach_revenue`·`ach_qty`·`quantity_reliable` 스냅샷 → **의도한 곳만** 델타 발생 단언. 지난 N12처럼 "매칭값 `e.*` 불변 → predict 무영향"을 기본값으로, 재배선 시에만 명시적으로 기준 이동 + 공지.

---

## 9. 열린 결정 (Phase 2 착수 전 확인)

1. **박스당 물류 단가**의 데이터 출처? (현재 레이트카드엔 % 만)
2. **캠페인 실제 광고비** 컬럼/입력 위치? (배분 분모)
3. `옵션코드`가 ②와 ⑤에서 **동일 체계**로 매겨지는가? (그렇다면 시그니처 없이도 직접 조인 가능)

---

## 10. 예상 마이그레이션 인벤토리

| # | 내용 | Phase |
|---|---|---|
| 0042 | `promotion_sale_options` + `sale_option_id` + 공유 `option_signature`/`normalize_option_info` + 백필 | 1 |
| 0043 | 요약 구독버킷 재배선(양성신호) + 시그니처 매칭 + 3분 택소노미 | 1 |
| 0044 | 파서측 `order_type`/`구성`/`옵션코드` 수용 + `raw` 저장 | 2 |
| 0045 | 옵션 단위 실측 공헌이익 + 박스물류단가/광고예산 스키마 | 2 |
| 0046 | 업로드 캠페인 결속 + 도구 격하 | 3 |
