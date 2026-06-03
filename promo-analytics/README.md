# 프로모션 애널리틱스 (드르펠리스 사내 MD)

프로모션 매출 **기여도 측정 → 예측 → 처방** 도구. 기획은 저장소 루트의 [`SPEC.md`](../SPEC.md) 참고.

## 기술 스택
- Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4
- Supabase (Google 인증 + Postgres) — `@drfelis.com` 도메인 제한
- 측정 엔진은 Postgres 함수(`promotion_measurement`, `promotion_summary`)

## 구현된 기능
**Phase 1 — 측정 + 사례 탐색**
- **데이터 업로드**: ① 마스터(품목코드) ② 일별 매출 추이 ③ 프로모션 시트 — 헤더 자동 인식 파서
- **측정**: baseline = 직전 8주 비프로모션 일평균, uplift = 실적 − baseline×일수, 직접/후광 분리
- **프로모션 상세**: 요약 카드, 상품별 증분 표, 증분 Top10 차트, 메인상품 지정
- **사례 라이브러리**: 유형·시즌 필터 + 성과 정렬
- **집요하게 묻기**: 성과 원인 질문 자동 제안 + 정성 메모/태그 축적

**Phase 2 — 예측** (`/predict`)
- 계획 조건(혜택종류·시즌·할인율·기간) → 유사 사례 가중평균으로 예상 증분 + 신뢰도 + 근거 사례

**Phase 3 — 처방** (`/prescribe`)
- 목표 증분 → 과거 성과 기반 혜택 구성 추천(공헌이익률 우선 정렬, 목표 달성 표시)

> 예측·처방 엔진은 규칙/통계 기반(`lib/predict.ts`). 사례가 쌓일수록 정확해집니다.

## 초기 셋업

### 1. Supabase 프로젝트 (새로 생성)
1. [supabase.com](https://supabase.com)에서 **새 프로젝트** 생성
2. SQL Editor에서 `supabase/migrations/0001_init.sql` 전체 실행
3. **Authentication → Providers → Google** 활성화
   - Google Cloud Console에서 OAuth 클라이언트 생성
   - 승인된 리디렉션 URI: `https://<PROJECT>.supabase.co/auth/v1/callback`
   - (선택) OAuth 동의화면을 내부(Internal)로 설정하면 조직 계정만 허용
4. **Authentication → URL Configuration**의 Site URL / Redirect URLs에 배포 도메인 추가

### 2. 환경 변수
`.env.example`를 복사해 `.env.local` 생성:
```
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
ALLOWED_EMAIL_DOMAIN=drfelis.com
```

### 3. 로컬 실행
```bash
npm install
npm run dev
```

### 4. Vercel 배포
- 이 디렉터리(`promo-analytics`)를 Root Directory로 지정
- 위 환경 변수 등록
- 배포 도메인을 Supabase Redirect URLs와 Google OAuth에 추가

## 데이터 업로드 순서
1. **마스터(품목코드)** → 상품 원가/가격
2. **일별 매출 추이** → baseline 연료 (가능한 한 길게, 최소 직전 8주+)
3. **프로모션 시트** → 업로드 시 프로모션 자동 생성 → 편집 화면에서 메인상품·혜택 지정

원본 엑셀은 구글 드라이브
`MD/프로모션 애널리틱스 - 원본 데이터 보관함/` 하위 폴더에 보관.
