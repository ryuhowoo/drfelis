# VOC 대시보드 — Neo Organic 디자인 시스템 이식 프롬프트

아래 내용을 **VOC 대시보드 작업 세션**에 그대로 붙여넣으세요.
(원본 파일 `felis-neo-organic.css`와 `README.md`를 그 세션에 **첨부/업로드**한 뒤 사용)

---

첨부한 `felis-neo-organic.css`와 `README.md`가 우리 "Neo Organic" 디자인 시스템 원본이야.
이 파일들을 프로젝트에 저장하고, README의 컴포넌트 치트시트대로 VOC 대시보드에 이식해줘.

## 규칙
1. 기존의 자체 색·폰트·그림자 토큰은 무시·삭제하고, 이 디자인 시스템의 토큰(:root 변수)과
   문서화된 컴포넌트 클래스(.card / .bento+.b-* / .kpi-card / .tbl / .insight / .warn-box /
   .chip / .acc-* / .gate-card 등)로 다시 조립해.
2. 색을 바꿔야 하면 CSS 하단 `DR.FELIS NEO ORGANIC DASHBOARD` :root 의 `--accent` 등
   토큰만 수정해. 개별 요소에 하드코딩 금지.
3. 콘텐츠·데이터·로직은 절대 바꾸지 말고 **디자인만** 교체해.
4. React/Next 프로젝트라면 CSS를 그대로 링크하기보다, 하단 :root 토큰을
   globals.css(또는 Tailwind theme)로 옮기고 컴포넌트가 그 토큰을 쓰도록 바꿔.
5. 폰트: Pretendard 링크를 반드시 포함(없으면 자간·굵기가 무너짐).

## 로그인(인증) 페이지 — 딥그린 히어로 키컬러
로그인 페이지는 본문(크림/민트)과 달리 **딥그린 히어로**를 키컬러로 써. 디자인 시스템에
이미 `.login-*` 클래스로 문서화돼 있으니 그대로 사용해:

- 최상위 풀스크린 컨테이너(**div**)에 `.login-hero` → 딥그린 그라데이션 배경
  (`linear-gradient(145deg,#153633,#1C4842,#24564D)` + 민트/블루 글로우, 흰 텍스트)
- 그 위에 유리질 흰 카드 `.login-card`
- `.login-brand`(액센트) · `.login-title` · `.login-sub`(강조어는 `<mark>`=민트 #8FD7B8)
- 입력은 `.login-field`(label+input), CTA는 `.login-btn`(액센트 그라데이션),
  보조 링크 `.login-alt`, 에러 `.login-msg`

⚠️ **가독성 필수 확인**: `.login-hero`의 딥그린 배경이 다른 규칙(`section:nth-child(){
background:transparent}` 등)에 덮이면 흰 글자가 안 보인다. 로그인 컨테이너는 `<section>`이
아니라 `<div>`로 만들거나 배경을 `!important`로 고정하고, **렌더 스크린샷으로 배경이 실제로
딥그린인지, 흰 글자 대비가 충분한지 반드시 확인**해줘.

## 마무리
- 데스크톱·모바일 둘 다 렌더해서 가독성(대비)까지 확인하고 스크린샷 보여줘.
- 대상 파일/컴포넌트 경로가 모호하면 추측하지 말고 먼저 물어봐.
