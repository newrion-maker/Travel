// 앱인토스 WebView로 배포하면 프론트는 토스 도메인(https://<appName>.private-apps.tossmini.com)에서
// 열리고, 백엔드(Render 등)는 별도 도메인이라 상대경로(/api/*)로는 접근이 안 된다.
// VITE_API_BASE_URL을 배포 시 백엔드 절대 URL로 설정하면 그쪽으로 호출한다.
// 로컬 개발(비어있음)에서는 기존처럼 상대경로 + Vite 프록시를 그대로 사용.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/u, '')

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}
