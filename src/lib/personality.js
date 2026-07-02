// 성향 점수 로직 — 기획서 §3.2 "점수 계산 로직" 을 그대로 구현한 SSOT.
//
// 입력: answers = { Q1: 'A'|'B', ... }, period = '당일치기'|'1박2일'|'2박3일 이상'
// 출력: { scores:{L,F,A}, ratios:{stay,food,sight}, top, label, isDayTrip }

import { QUESTIONS } from '../data/questions.js'

export const LABELS = {
  L: '호캉스 우선형',
  F: '미식 우선형',
  A: '알뜰 다다익선형',
}

// 성향별 결과 화면 강조색 (README §3 성향 결과)
export const LABEL_ACCENT = {
  L: 'teal',
  F: 'coral',
  A: 'amber',
}

// 성향별 설명 문구 (강조 span은 화면에서 accent 색 처리)
export const LABEL_DESC = {
  L: ['여유와 컨디션을 무엇보다 챙기는 분이에요. ', '숙박 비중을 높여', ' 좋은 숙소 중심으로 코스를 짰어요.'],
  F: ['웨이팅도 기꺼이 감수하는 진정한 미식가예요. ', '식비 비중을 높여', ' 맛집 위주로 코스를 짰어요.'],
  A: ['하나라도 더 보고 즐기고 싶은 알뜰 여행가예요. ', '관광·체험 비중을 높여', ' 알차게 도는 코스를 짰어요.'],
}

const MIN_PCT = 15 // §3.2-4: 특정 축이 15% 미만이면 15%로 상향

/** 5문항 답변을 L/F/A 원점수로 합산 */
export function scoreAnswers(answers) {
  const scores = { L: 0, F: 0, A: 0 }
  for (const q of QUESTIONS) {
    const picked = answers[q.id]
    if (!picked) continue
    const opt = q.options.find((o) => o.key === picked)
    if (!opt) continue
    scores.L += opt.delta.L
    scores.F += opt.delta.F
    scores.A += opt.delta.A
  }
  return scores
}

/**
 * 점수 → 비율(%) 환산 + 15% 하한 보정.
 * axes: 계산에 포함할 축 배열. 당일치기면 ['F','A'] (L 제외), 아니면 ['L','F','A'].
 * 반환: { L, F, A } (계산에서 제외된 축은 0)
 */
function toRatios(scores, axes) {
  const total = axes.reduce((s, k) => s + scores[k], 0)
  const out = { L: 0, F: 0, A: 0 }
  if (total <= 0) {
    // 전부 0인 방어 케이스: 균등 분배
    const even = Math.round(100 / axes.length)
    axes.forEach((k, i) => (out[k] = i === axes.length - 1 ? 100 - even * (axes.length - 1) : even))
    return out
  }

  // 1차 비율(반올림)
  axes.forEach((k) => {
    out[k] = Math.round((scores[k] / total) * 100)
  })

  // 반올림 합계를 100으로 맞춤 (최고 점수 축에서 조정)
  fixTo100(out, axes)

  // 15% 하한 보정: 부족분을 최고 점수 축에서 차감 (§3.2-4)
  const topAxis = axes.reduce((a, b) => (out[a] >= out[b] ? a : b))
  for (const k of axes) {
    if (k !== topAxis && out[k] < MIN_PCT) {
      const deficit = MIN_PCT - out[k]
      out[k] = MIN_PCT
      out[topAxis] -= deficit
    }
  }
  return out
}

function fixTo100(out, axes) {
  const sum = axes.reduce((s, k) => s + out[k], 0)
  const diff = 100 - sum
  if (diff !== 0) {
    const topAxis = axes.reduce((a, b) => (out[a] >= out[b] ? a : b))
    out[topAxis] += diff
  }
}

/** 메인 결과 산출 */
export function computePersonality(answers, period) {
  const isDayTrip = period === '당일치기'
  const scores = scoreAnswers(answers)
  const axes = isDayTrip ? ['F', 'A'] : ['L', 'F', 'A']

  const r = toRatios(scores, axes)
  const ratios = { stay: r.L, food: r.F, sight: r.A }

  // 라벨은 계산에 포함된 축 중 최고점 기준 (§3.2 결과 라벨링)
  const top = axes.reduce((a, b) => (scores[a] >= scores[b] ? a : b))

  return {
    scores,
    ratios,
    top, // 'L' | 'F' | 'A'
    label: LABELS[top],
    accent: LABEL_ACCENT[top],
    desc: LABEL_DESC[top],
    isDayTrip,
  }
}
