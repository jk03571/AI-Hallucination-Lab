# AI Hallucination Lab

AI 답변에서 사실 주장(Claim)을 추출하고, Tavily 웹 검색 Evidence와 Gemini 판정을 결합해 환각 가능성을 보여주는 반응형 웹 앱입니다.

## 기능

- Gemini 기반 Claim 추출 및 Evidence 비교 판정
- Claim별 Tavily 검색 결과(title, URL, content, score) 표시
- TRUE, FALSE, PARTIALLY TRUE, UNCERTAIN 판정 및 보수적 confidence
- 전체 발견 주장, 검증 주장, 미검증 주장과 검증 범위 표시
- 실제 판정된 주장만 사용한 Hallucination Rate 표시
- 검증 우선순위와 답변 전반의 구간별 표본 선택
- API 키는 서버에서만 읽고 브라우저로 전달하지 않음
- 동일 Claim 검색 결과를 10분간 메모리 캐시
- 동일 입력의 검증 결과를 3분간 메모리 캐시 (최대 100건)

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

`GEMINI_MODEL` 기본값은 `gemini-3.6-flash`이며 환경변수로 변경할 수 있습니다. 키가 없으면 서버는 충돌하지 않고 화면에 `API 키를 설정해주세요.`를 표시합니다.

## 검증 흐름

입력 답변 → Gemini가 최대 30개까지 안전 상한 내에서 전체 사실 주장을 추출 → 중복 제거 및 우선순위/구간 분포에 따라 검증 예산 8/10/12개 선택 → 선택된 주장만 Claim별 Tavily 검색 → Gemini 한 번으로 전체 판정 → 결과 요약 순서입니다. 정상 요청은 Gemini 호출 2회이며 Claim별 Gemini 호출은 없습니다. 검색하지 않은 주장도 `unverified`로 응답에 남겨 발견 주장 수와 검증 수를 구분합니다. Hallucination Rate는 `FALSE / (TRUE + FALSE + PARTIALLY_TRUE)`로 계산하며 UNCERTAIN과 미검증 주장은 포함하지 않습니다. 동일 입력 결과는 3분, 검색은 10분간 서버 메모리에 임시 캐시되며 디스크에는 저장하지 않습니다. 검색 결과가 없거나 차단 출처만 남으면 해당 Claim은 UNCERTAIN으로 처리합니다.

Tavily 결과에서 Wikipedia, 위키류, 블로그, 카페 및 주요 커뮤니티 도메인과 하위 도메인은 제거합니다. 검색 결과는 출처 우선순위, Tavily 점수, 본문 관련도를 반영해 정렬하고, 판정 요청에는 Claim당 최대 5개를 전달합니다. Claim 검색 결과는 10분 캐시되고 동일 검색 및 동일 검증의 동시 요청은 in-flight 작업을 공유합니다.

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
