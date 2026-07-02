/** @type {import('tailwindcss').Config} */
// 디자인 토큰 = design_handoff README "Design Tokens" 절을 그대로 옮긴 것.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: '#12B3A6', // primary: CTA, 선택 칩, 숙박 축
          deep: '#0E9A8F', // 흰 배경 위 틸 텍스트
          tint: '#E6F6F4', // 옅은 틸 배경(배지/선택)
        },
        coral: {
          DEFAULT: '#FF7060', // secondary: 식비 축, 시작 핀
          deep: '#E8503E', // 코랄 텍스트/강조
          tint: '#FFF0EE',
          tint2: '#FFECE9',
        },
        amber: {
          DEFAULT: '#F2B035', // 관광지 축
          text: '#B4791A', // 앰버 틴트 위 텍스트(대비)
        },
        ink: {
          DEFAULT: '#10171C', // text-primary
          2: '#5A6A70', // text-secondary
          3: '#94A3A8', // text-tertiary
          muted: '#C2CDCD', // 리스트 순번 등
        },
        screen: '#F5F7F7', // 화면 배경
        card: '#FFFFFF',
        line: {
          DEFAULT: '#EAEEEF', // 입력/칩 기본 테두리
          hair: '#F0F3F3', // 구분선
          hair2: '#F4F6F6', // 리스트 행 하단선
          footer: '#ECF0F0', // 하단 CTA 상단 보더
        },
      },
      fontFamily: {
        sans: ['Pretendard', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: {
        chip: '13px',
        field: '15px',
        card: '16px',
        'card-lg': '20px',
        btn: '16px',
        sq: '10px',
        'sq-lg': '11px',
      },
      boxShadow: {
        // CTA 버튼
        cta: '0 6px 16px rgba(18,179,166,0.30)',
        // 입력 강조(teal) 필드
        field: '0 2px 8px rgba(18,179,166,0.10)',
        // 카드
        card: '0 8px 24px rgba(16,23,28,0.07)',
        'card-soft': '0 4px 16px rgba(16,23,28,0.05)',
        // 세그먼트 활성 pill
        seg: '0 2px 6px rgba(16,23,28,0.12)',
        // 스플래시 CTA(흰 버튼)
        'cta-white': '0 8px 20px rgba(0,0,0,0.14)',
      },
      keyframes: {
        bob: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        spin095: { to: { transform: 'rotate(360deg)' } },
        'fade-slide': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        bob: 'bob 3s ease-in-out infinite',
        'bob-fast': 'bob 1.8s ease-in-out infinite',
        spin095: 'spin095 0.95s linear infinite',
        'fade-slide': 'fade-slide 0.28s ease',
        'fade-in': 'fade-in 0.3s ease',
      },
    },
  },
  plugins: [],
}
