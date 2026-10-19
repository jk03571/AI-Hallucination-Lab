# AI Hallucination Lab

AI 답변에서 사실 주장(Claim)을 추출하고, Tavily 웹 검색 Evidence와 Gemini 판정을 결합해 환각 가능성을 보여주는 반응형 웹 앱입니다.

## 기능

- Gemini 기반 Claim 추출 및 Evidence 비교 판정
- Claim별 Tavily 검색 결과(title, URL, content, score) 표시
- TRUE, FALSE, PARTIALLY TRUE, UNCERTAIN 판정 및 보수적 confidence
- 전체 판정 분포와 Hallucination Rate 표시
- API 키는 서버에서만 읽고 브라우저로 전달하지 않음
- 동일 Claim 검색 결과를 10분간 메모리 캐시

## 실행

Node.js 20.12 이상에서 `outputs` 폴더를 현재 폴더로 두고 실행합니다.

```powershell
npm install
npm start
```

브라우저 주소는 `http://localhost:4173`입니다. 다른 포트는 `$env:PORT=4174`를 설정한 뒤 실행합니다. 4173이 이미 사용 중이면 기존 서버를 재사용하라는 안내를 출력합니다.

## API 키 설정

1. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 Gemini 키를 발급합니다.
2. [Tavily](https://app.tavily.com/)에서 Tavily 키를 발급합니다.
3. `.env.example`을 `.env`로 복사하고 키를 입력합니다.

```powershell
Copy-Item .env.example .env
# .env에 GEMINI_API_KEY와 TAVILY_API_KEY를 입력합니다.
npm start
```

`GEMINI_MODEL` 기본값은 `gemini-3.8-flash`이며 환경변수로 변경할 수 있습니다. 키가 없으면 서버는 충돌하지 않고 화면에 `API 키를 설정해주세요.`를 표시합니다.

## 검증 흐름

입력 답변 → Gemini Claim 추출 → Claim별 Tavily 검색 → 검색 Evidence와 Claim을 Gemini가 비교 → 판정 및 Hallucination Rate 계산 순서입니다. 검색 결과가 없으면 해당 Claim은 UNCERTAIN으로 처리합니다.

## 테스트 입력

- 사실: `대한민국의 수도는 서울이다.`
- 오류: `대한민국의 수도는 부산이다.`
- 혼합: `지구는 태양 주위를 돌고, 달은 지구보다 크다.`
- 최신 정보: `현재 한국의 대통령은 누구인가?`
- 확인 어려움: 출처 없는 개인 경험이나 예측

## 프로젝트 구조

```text
outputs/
  index.html   앱 화면
  style.css    반응형 테마와 레이아웃
  app.js       검증 진행 상태와 결과 렌더링
  server.js    정적 파일 서버 및 Tavily/Gemini 검증 API
```

## 제한사항

- 검색 결과가 모든 주장을 충분히 뒷받침하지 않을 수 있습니다.
- 검색 결과와 판정은 참고용이며, 중요한 정보는 원문 출처를 직접 확인해야 합니다.
- Tavily와 Gemini의 요금, rate limit, 모델 접근 조건은 계정에 따라 달라질 수 있습니다.
