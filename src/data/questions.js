// 성향 테스트 5문항 + 배점 — 기획서 §3.2 표를 그대로 옮긴 것 (SSOT).
// 각 선택지의 delta = { L, F, A } 가산점 (숙박 L / 식비 F / 관광·체험 A).
// 당일치기 분기는 계산 단계(lib/personality.js)에서만 처리하므로 문항은 공통.
// 2026-07-09: 여름 챌린지용으로 문항·선택지 텍스트를 여름 시나리오로 리스킨.
//   delta 값과 옵션 key는 기존과 완전히 동일 — lib/personality.js 로직 영향 없음.

export const QUESTIONS = [
  {
    id: 'Q1',
    tag: 'Q1. 숙소 취향',
    title: '여름 휴가,\n어떤 숙소가\n끌리세요?',
    options: [
      { key: 'A', label: '가성비 게스트하우스,\n어차피 물놀이하다 잠만 잘 건데', delta: { L: 0, F: 1, A: 1 } },
      { key: 'B', label: '그래도 수영장 있는\n편안한 숙소 🏊', delta: { L: 2, F: 0, A: 0 } },
    ],
  },
  {
    id: 'Q2',
    tag: 'Q2. 미식 성향',
    title: '빙수 맛집 앞 웨이팅\n1시간, 어떻게\n하실래요?',
    options: [
      { key: 'A', label: '기다려서 먹는다,\n여름엔 역시 빙수지 🍧', delta: { L: 0, F: 2, A: 0 } },
      { key: 'B', label: '포기하고 다른 데로,\n더위에 줄 서기 싫어', delta: { L: 0, F: 0, A: 2 } },
    ],
  },
  {
    id: 'Q3',
    tag: 'Q3. 하루 스케줄',
    title: '한여름 낮 12시~3시,\n뭐 하고\n계세요?',
    options: [
      { key: 'A', label: '그래도 나가서\n알차게 돌아다니기 🗺️', delta: { L: 0, F: 0, A: 2 } },
      { key: 'B', label: '에어컨 카페에서\n피서하며 느긋하게 ☕', delta: { L: 1, F: 1, A: 0 } },
    ],
  },
  {
    id: 'Q4',
    tag: 'Q4. 안 아끼는 것',
    title: '여름휴가 가서 절대\n아끼고 싶지\n않은 건?',
    options: [
      { key: 'A', label: '숙소 (오션뷰·수영장)', delta: { L: 2, F: 0, A: 0 } },
      { key: 'B', label: '음식 (빙수·물회·냉면)', delta: { L: 0, F: 2, A: 0 } },
      { key: 'C', label: '체험 · 물놀이 · 액티비티', delta: { L: 0, F: 0, A: 2 } },
    ],
  },
  {
    id: 'Q5',
    tag: 'Q5. 여윳돈 쓰기',
    title: '휴가비가 예상보다\n좀 남았어요.\n어디에 더 쓸까요?',
    options: [
      { key: 'A', label: '숙소 업그레이드\n(오션뷰·풀빌라)', delta: { L: 2, F: 0, A: 0 } },
      { key: 'B', label: '여름 별미 하나 더', delta: { L: 0, F: 2, A: 0 } },
      { key: 'C', label: '물놀이 · 체험 추가', delta: { L: 0, F: 0, A: 2 } },
    ],
  },
]
