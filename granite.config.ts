import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 앱인토스 콘솔에 등록한 앱 고유 키
  appName: 'budgettrip',
  brand: {
    // 토스 미니앱 목록/스플래시에 표시되는 이름 (콘솔 등록명과 일치)
    displayName: '얼마 있어?',
    // 앱 대표 색상 (현재 앱의 teal 브랜드 컬러)
    primaryColor: '#12B3A6',
    // public/icon.png(빌드 시 dist/icon.png로 복사돼 백엔드에서 정적으로 서빙됨)
    icon: 'https://budgettrip-api.onrender.com/icon.png',
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },
  // TODO: 위치/알림 등 필요한 권한이 생기면 추가 (광고 SDK는 별도)
  permissions: [],
  outdir: 'dist',
});
