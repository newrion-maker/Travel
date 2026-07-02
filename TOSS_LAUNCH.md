# Toss Web Launch Notes

이 프로젝트는 토스 인앱 브라우저에서 열리는 모바일 웹 서비스 기준으로 운영한다.

## 실행 구조

- Frontend: React + Vite
- API server: Node.js built-in HTTP server
- Static files: `dist/`
- API route: `/api/*`

## 환경 변수

출시 환경에는 아래 값을 서버 환경 변수로 등록한다.

```env
TOUR_API_KEY=한국관광공사_TourAPI_서비스키
KAKAO_REST_API_KEY=카카오_REST_API_키
OPENAI_API_KEY=AI_추천용_OpenAI_API_키
```

브라우저에 노출되는 `VITE_*` 키는 사용하지 않는다.

## 로컬 확인

```bash
npm run build
npm run serve
```

기본 주소:

```text
http://127.0.0.1:5175
```

API 상태 확인:

```text
http://127.0.0.1:5175/api/health
```

TourAPI 장소 확인:

```text
http://127.0.0.1:5175/api/tour-places?region=강원%20강릉시
```

## 출시 전 필수 체크

- API 키가 `dist/` 안에 포함되지 않는지 확인
- 토스 인앱 브라우저에서 첫 화면, 입력, 결과, 공유 흐름 확인
- 모든 외부 API 호출은 `/api/*` 서버 경유
- 결과 화면에 실제 장소 링크를 붙일 경우 Kakao Local API를 서버에서 호출
- AI 추천 문장도 서버에서 생성하고, 프론트에는 결과 JSON만 전달

## 다음 작업 우선순위

1. Kakao Local API 서버 프록시 추가
2. 장소 카드에 카카오맵 상세보기 링크 추가
3. AI 예산표/추천 설명 API 추가
4. 결과 공유 URL 구조 추가
5. 토스 인앱 브라우저 기준 QA
