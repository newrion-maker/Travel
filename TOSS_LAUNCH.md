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

## 배포 (호스팅) — 프론트/백엔드 분리 구조

**중요**: 앱인토스 WebView로 배포하면 프론트(`dist/`)는 `ait deploy`가 **토스 소유 도메인**
(`https://<appName>.private-apps.tossmini.com`)에 올려서 서빙한다 — 우리가 호스팅하지 않는다.
반면 시크릿 키를 쥔 API 서버(`server/app.js`)는 **별도로 우리가 직접 호스팅**해야 한다.
즉 배포 대상이 둘로 나뉜다:

| | 무엇을 | 어디에 | 방법 |
|---|---|---|---|
| 백엔드 | `server/app.js` + API 라우트 | Render 등 우리 서버 | `render.yaml` → 아래 절차 |
| 프론트 | `dist/`(vite build 결과물) | 토스 도메인 | `ait build` → `ait deploy` |

프론트가 토스 도메인에서 열리므로, API 호출은 **상대경로가 아니라 백엔드 절대 URL**을 써야 하고
(→ `VITE_API_BASE_URL`, `src/lib/apiBase.js`), 백엔드는 토스 도메인의 **CORS를 허용**해야 한다
(→ `server/app.js`의 `ALLOWED_ORIGINS`, 기본값에 `https://<appName>.private-apps.tossmini.com` 포함됨).

### 1. 백엔드(Render) 배포

1. [Render](https://render.com) 가입 → "New +" → "Blueprint" → 이 GitHub 저장소 연결 → `render.yaml` 자동 인식
2. 대시보드에서 시크릿 환경변수 입력: `TOUR_API_KEY`, `KAKAO_REST_API_KEY`, `OPENAI_API_KEY`, `VITE_KAKAO_MAP_KEY` (git에 안 올라가는 값이라 `sync: false`로 두고 콘솔에서 직접 입력)
3. 배포 완료 후 발급되는 도메인(`https://xxx.onrender.com`)을:
   - 카카오 콘솔의 **JavaScript SDK 도메인** 목록에 추가 (안 하면 지도 로드 실패)
   - `.env.local`(로컬 빌드용) 또는 배포 파이프라인 환경변수에 `VITE_API_BASE_URL=https://xxx.onrender.com` 로 등록
4. `healthCheckPath: /api/health`로 헬스체크 연결됨 — 배포 후 `https://xxx.onrender.com/api/health`가 `{"ok":true}`를 반환하는지 확인

무료 플랜은 트래픽 없을 때 슬립 후 첫 요청에 콜드스타트 지연(수십 초)이 있을 수 있음 — 챌린지 심사관이 접속할 때를 대비해 출시 직전엔 유료 플랜 전환을 고려.

### 2. 프론트(앱인토스) 배포

1. `VITE_API_BASE_URL`을 Render 도메인으로 설정한 상태에서 `npm run build`
2. `npx ait build` → `.ait` 번들 생성
3. 콘솔 업로드 또는 `npx ait deploy` (CI/CD용 API 키 필요, 콘솔에서 발급)
4. QR 코드 스캔 또는 `intoss-private://appsintoss?_deploymentId=[ID]` 스킴으로 실기기 테스트

## 출시 전 필수 체크

- API 키가 `dist/` 안에 포함되지 않는지 확인
- 토스 인앱 브라우저(및 실기기 QR 테스트)에서 첫 화면, 입력, 결과, 공유 흐름 확인
- 모든 외부 API 호출은 `/api/*` 서버 경유, `VITE_API_BASE_URL`로 백엔드 절대 URL 지정 확인
- 백엔드 `ALLOWED_ORIGINS`에 토스 배포 도메인이 포함돼 있는지 확인 (기본값에 이미 있음, appName 바뀌면 갱신 필요)
- 결과 화면에 실제 장소 링크를 붙일 경우 Kakao Local API를 서버에서 호출
- AI 추천 문장도 서버에서 생성하고, 프론트에는 결과 JSON만 전달
- 배포 도메인을 카카오 콘솔 JavaScript SDK 도메인에 등록

## 다음 작업 우선순위

1. Render 배포 + `VITE_API_BASE_URL` 연결 + 카카오 콘솔 도메인 등록
2. 앱인토스 mTLS 인증서 발급 (사업자 승인 완료 — 콘솔에서 발급 가능)
3. `ait build` → `ait deploy` → QR 실기기 테스트
4. 인앱광고(IAA) 광고그룹 생성 → 테스트 ID를 실제 ID로 교체
5. 토스 인앱 브라우저 기준 QA
