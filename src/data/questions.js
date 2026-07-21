// 성향 테스트 5문항 + 배점 — 기획서 §3.2 표를 그대로 옮긴 것 (SSOT).
// 각 선택지의 delta = { L, F, A } 가산점 (숙박 L / 식비 F / 관광·체험 A).
// 당일치기 분기는 계산 단계(lib/personality.js)에서만 처리하므로 문항은 공통.
// 계절 상관없이 사계절 내내 쓸 수 있도록 여름 한정 문구는 안 쓴다(2026-07-21).

export const QUESTIONS = [
  {
    id: 'Q1',
    tag: 'Q1. 숙소 취향',
    title: '숙소는 어떤\n느낌이면\n좋으세요?',
    options: [
      { key: 'A', label: '가성비 게스트하우스,\n어차피 잠만 잘 건데', delta: { L: 0, F: 1, A: 1 } },
      { key: 'B', label: '그래도 조식 나오는\n편안한 숙소 🛏️', delta: { L: 2, F: 0, A: 0 } },
    ],
  },
  {
    id: 'Q2',
    tag: 'Q2. 미식 성향',
    title: '맛집 앞 웨이팅\n2시간, 어떻게\n하실래요?',
    options: [
      { key: 'A', label: '기다려서 먹는다,\n이게 여행의 낙이지 🍜', delta: { L: 0, F: 2, A: 0 } },
      { key: 'B', label: '포기하고 다른 데로,\n시간이 아까워', delta: { L: 0, F: 0, A: 2 } },
    ],
  },
  {
    id: 'Q3',
    tag: 'Q3. 하루 스케줄',
    title: '여행지에서\n하루 스케줄은\n어떠세요?',
    options: [
      { key: 'A', label: '가능한 많이 돌아보기,\n알차게 🗺️', delta: { L: 0, F: 0, A: 2 } },
      { key: 'B', label: '느긋하게 카페에서\n시간 보내기 ☕', delta: { L: 1, F: 1, A: 0 } },
    ],
  },
  {
    id: 'Q4',
    tag: 'Q4. 안 아끼는 것',
    title: '여행 가서 절대\n아끼고 싶지\n않은 건?',
    options: [
      { key: 'A', label: '숙소', delta: { L: 2, F: 0, A: 0 } },
      { key: 'B', label: '음식', delta: { L: 0, F: 2, A: 0 } },
      { key: 'C', label: '체험 · 입장료 · 액티비티', delta: { L: 0, F: 0, A: 2 } },
    ],
  },
  {
    id: 'Q5',
    tag: 'Q5. 여윳돈 쓰기',
    title: '예상보다 돈이\n좀 남았어요.\n어디에 더 쓸까요?',
    options: [
      { key: 'A', label: '숙소 업그레이드', delta: { L: 2, F: 0, A: 0 } },
      { key: 'B', label: '맛집 하나 더', delta: { L: 0, F: 2, A: 0 } },
      { key: 'C', label: '체험 추가', delta: { L: 0, F: 0, A: 2 } },
    ],
  },
]
