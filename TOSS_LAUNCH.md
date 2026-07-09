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

위 세 키는 **서버 전용 시크릿**이며 브라우저에 노출하지 않는다.

예외: `VITE_KAKAO_MAP_KEY`(카카오 지도 JavaScript 키)는 **원래 브라우저에서 동작하는 공개키**로, 빌드 시 dist에 포함된다. 시크릿이 아니라 **카카오 콘솔의 사이트 도메인 등록**으로 보호되므로, 배포 도메인(및 로컬 테스트 도메인)을 반드시 등록한다.

```env
VITE_KAKAO_MAP_KEY=카카오_JavaScript_키   # 공개키(도메인 등록으로 보호)
```

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

## 배포 (호스팅)

`server/app.js`가 시크릿 키를 쥔 API 서버 + 정적 파일(`dist/`)을 함께 서빙하므로, 순수 정적 호스팅(Vercel 정적 배포 등)이 아니라 **상시 구동되는 Node 서버**가 필요하다.

`render.yaml`(Render 블루프린트)을 프로젝트 루트에 준비해뒀다.

1. [Render](https://render.com) 가입 → "New +" → "Blueprint" → 이 GitHub 저장소 연결 → `render.yaml` 자동 인식
2. 대시보드에서 시크릿 환경변수 4개 입력: `TOUR_API_KEY`, `KAKAO_REST_API_KEY`, `OPENAI_API_KEY`, `VITE_KAKAO_MAP_KEY` (git에 올리지 않는 값이라 `sync: false`로 두고 콘솔에서 직접 입력)
3. 배포 완료 후 발급되는 도메인(`https://xxx.onrender.com`)을:
   - 카카오 콘솔의 **JavaScript SDK 도메인** 목록에 추가 (안 하면 지도 로드 실패)
   - `granite.config.ts` 및 앱인토스 콘솔의 배포 URL 설정에 등록
4. `healthCheckPath: /api/health`로 헬스체크 연결됨 — 배포 후 `https://xxx.onrender.com/api/health`가 `{"ok":true}`를 반환하는지 확인

무료 플랜은 트래픽 없을 때 슬립 후 첫 요청에 콜드스타트 지연(수십 초)이 있을 수 있음 — 챌린지 심사관이 접속할 때를 대비해 출시 직전엔 유료 플랜 전환을 고려.

## 출시 전 필수 체크

- API 키가 `dist/` 안에 포함되지 않는지 확인
- 토스 인앱 브라우저에서 첫 화면, 입력, 결과, 공유 흐름 확인
- 모든 외부 API 호출은 `/api/*` 서버 경유
- 결과 화면에 실제 장소 링크를 붙일 경우 Kakao Local API를 서버에서 호출
- AI 추천 문장도 서버에서 생성하고, 프론트에는 결과 JSON만 전달
- 배포 도메인을 카카오 콘솔 JavaScript SDK 도메인에 등록

## 다음 작업 우선순위

1. Render 배포 + 카카오 콘솔 도메인 등록
2. 앱인토스 mTLS 인증서 발급 (콘솔에서 직접 시도)
3. 앱인토스 사업자·정산 인증 완료 대기 → 인앱광고(IAA) SDK 연동
4. 토스 인앱 브라우저 기준 QA
