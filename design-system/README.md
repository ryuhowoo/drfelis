# Felis "Neo Organic" 디자인 시스템 — 이식 가이드

`ogk2026_v4_weekly.html`에서 쓰인 디자인 시스템을 **다른 HTML 어디에나 붙일 수 있게**
단일 스타일시트로 뽑아 놓은 것입니다.

```
design-system/
├─ felis-neo-organic.css   ← 디자인 시스템 본체 (이 파일 하나만 링크하면 끝)
├─ template.html           ← 바로 복붙해서 시작하는 스타터
└─ README.md               ← 지금 이 문서
```

---

## 30초 요약 — 어떻게 이식하나

새 HTML의 `<head>`에 **두 줄**만 추가하면 됩니다.

```html
<!-- 1) 폰트 (디자인의 핵심. 빠지면 느낌이 완전히 달라집니다) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">

<!-- 2) 디자인 시스템 -->
<link rel="stylesheet" href="./felis-neo-organic.css">
```

그다음 본문을 아래 **정해진 클래스**로 조립하면 원본과 똑같은 룩이 나옵니다.
`template.html`을 열어 그대로 복사해서 시작하는 게 가장 빠릅니다.

---

## 왜 이런 구조인가 (알아두면 좋은 한 가지)

원본 파일은 `:root` 테마 블록이 **여러 겹 쌓여** 있습니다. CSS 캐스케이드 규칙상
**맨 마지막에 선언된 테마**(`DR.FELIS NEO ORGANIC DASHBOARD` · teal/mint 그린)가
실제 화면에 그려집니다. 앞의 웜테라코타/뉴모피즘 블록은 덮여서 안 보이지만,
컴포넌트의 **구조**를 정의하고 있어 지우면 레이아웃이 깨집니다.

그래서 `felis-neo-organic.css`는 **세 블록을 원래 순서 그대로 보존**해서 뽑았습니다.
→ 원본과 픽셀 단위로 동일하게 재현됩니다.

**색/모양을 바꾸고 싶다면** 파일 맨 아래 `DR.FELIS NEO ORGANIC DASHBOARD` 주석 밑의
`:root { … }` 토큰만 수정하세요. 그 위는 건드릴 필요 없습니다.

---

## 디자인 토큰 (자주 바꾸는 것들)

파일 하단 `:root`에서:

| 토큰 | 값 | 의미 |
|---|---|---|
| `--accent` | `#2F8F72` | 브랜드 메인(teal) — 버튼·강조·링크 |
| `--accent-md` / `--accent-lt` | `#58AC8E` / `#E5F4ED` | 액센트 중간톤 / 연한 배경 |
| `--bg` / `--bg-alt` | `#F9F7F2` / `#F3F0E8` | 페이지 배경 / 보조 배경 |
| `--txt-900 … --txt-300` | 딥그린→그레이 | 텍스트 명도 단계 |
| `--teal --navy --amber --burgundy --gold` | 상태색 | 성공/정보/주의/위험/보조 |
| `--radius` / `--radius-sm` | `24px` / `16px` | 카드 모서리 |
| `--shadow` / `--shadow-h` / `--shadow-sm` | — | 그림자 3단계 |

색 하나만 바꿔도(예: `--accent`) 버튼·칩·진행바·게이트가 **한 번에** 따라옵니다.

---

## 컴포넌트 치트시트

### 레이아웃
- `section` — 화면 한 폭 단위. `.visible` 클래스가 붙는 순간 등장 애니메이션 재생
  (아래 "스크립트" 참고). 정적으로 쓰려면 처음부터 `class="visible"`.
- `.bento` — 12컬럼 그리드. 자식에 `.b-3 .b-4 .b-5 .b-6 .b-7 .b-8 .b-12`로 폭 지정
- `.section-eye` — 섹션 위 작은 라벨 / `.section-heading` + `<em>` — 밑줄 강조 제목

### 카드 & 수치
- `.card` — 기본 카드(유리질, 호버 시 떠오름). `.b-*`와 함께 사용
- `.kpi-card` + `.label` + `.big-num`(+`.unit-sm`) + `.kpi-sub` / `.kpi-delta`(`.up/.down/.warn`)

### 강조 박스
- `.quote` — 인용 / `.insight`(+`.tag`) — 인사이트 / `.warn-box`(+`.tag`) — 경고

### 표
- `.tbl` — `thead/tbody` 표. 셀에 `.hl`(강조) · `.neg`(부정) 클래스

### 칩 / 태그
- `.chip` + `.chip-o`(오렌지) `.chip-b`(블루) `.chip-g`(그린) `.chip-r`(레드) `.chip-a`(앰버)

### 기타
- `.flow` + `.flow-node`(`.accent`) — 플로우 다이어그램
- `.timeline` + `.tl-item`/`.tl-dot`/`.tl-mo`/`.tl-title`/`.tl-desc` — 타임라인
- `.gate-card`(`.g2/.g3/.g4`) · `.phase-card` + `.phase-tag`(`.p1/.p2/.p3`)
- `.side-nav` + `.nav-dot`(+`.nav-tooltip`) — 좌측 도트 네비
- `.scroll-progress` — 상단 스크롤 진행바
- `.top-tab-bar` + `.tab-btn`(`.active`) — 상단 탭바

### 로그인 / 인증 페이지 (딥그린 키컬러)
로그인·인증 화면은 본문(크림/민트)과 달리 **딥그린 히어로**를 키컬러로 씁니다.

- `.login-hero` — 딥그린 풀스크린 컨테이너(최상위 `div`에 부여). 흰 텍스트,
  강조어는 `<mark>` 또는 `.k`로 민트(`#8FD7B8`).
- `.login-card` — 딥그린 위에 올리는 유리질 흰 카드(max 400px).
- `.login-brand` · `.login-title` · `.login-sub` — 카드 상단 브랜드/제목/부제.
- `.login-field`(label+input) — 입력 필드, 포커스 시 액센트 링.
- `.login-btn` — CTA(액센트 그라데이션). `.login-alt`(보조 링크) · `.login-msg`(에러).

```html
<div class="login-hero">
  <form class="login-card">
    <span class="login-brand">닥터펠리스</span>
    <h1 class="login-title">VOC 대시보드</h1>
    <p class="login-sub">팀 계정으로 로그인하세요.</p>
    <div class="login-field"><label>이메일</label><input type="email"></div>
    <div class="login-field"><label>비밀번호</label><input type="password"></div>
    <button class="login-btn" type="submit">로그인</button>
    <p class="login-msg"></p>
  </form>
</div>
```

> ⚠️ 딥그린 배경은 `.login-hero`에 **직접** 지정돼 있습니다. 로그인 컨테이너를
> `<section>`으로 만들면 `section:nth-child(){background:transparent}`에 덮여
> 흰 글자가 안 보일 수 있으니, **`div`에 `.login-hero`를 주거나** 배경을
> `!important`로 고정하세요. (지난 히어로 가독성 사고와 동일 원인)

전체 클래스는 `felis-neo-organic.css`를 검색하면 다 나옵니다.

---

## 등장 애니메이션 스크립트 (선택)

CSS만으로도 레이아웃은 완성됩니다. 스크롤 등장 효과를 원하면 `template.html`
하단의 `IntersectionObserver` 스니펫을 복사하세요. 각 `section`이 뷰포트에 들어올 때
`.visible`을 붙여 카드가 순차적으로 페이드업됩니다. (원본과 동일한 동작)

`@media (prefers-reduced-motion: reduce)`가 포함돼 있어 접근성 설정도 자동 존중합니다.

---

## 주의 / 팁

- **폰트를 꼭 넣으세요.** Pretendard가 없으면 자간·굵기가 달라 "느낌"이 무너집니다.
- **트래커/주간/월간 화면**(`.t-* .w-* .m-*` 클래스)은 원본에서 JS로 DOM을 생성하고
  Firebase에 연결됩니다. 이 CSS는 그 스킨까지 전부 포함하지만, 화면을 실제로 채우려면
  원본의 JS·데이터 로직이 따로 필요합니다. **전략문서형 정적 페이지**(카드/표/섹션)는
  이 CSS만으로 100% 재현됩니다.
- 차트가 필요하면 원본처럼 `chart.js`를 별도 `<script>`로 추가하세요. (디자인 시스템 밖)
- 여러 페이지에서 쓸 거면 `felis-neo-organic.css`를 공용 위치에 두고 각 HTML에서
  같은 경로로 링크하면 됩니다. 한 곳만 고치면 전 페이지에 반영됩니다.
