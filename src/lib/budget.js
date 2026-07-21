// 예산은 "교통비를 제외하고 여행지에서 쓸 금액"으로 받는다.
export function computeNetBudget(budget) {
  return { net: budget, fare: 0, rate: 0 }
}

/** 원화 천단위 콤마 포맷 ("150000" → "150,000") */
export function formatKRW(value) {
  const digits = String(value ?? '').replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('ko-KR')
}

/** 순예산을 "약 N만원선" 범위형 표현으로 (§4.4 기대치 관리) */
export function budgetBand(net) {
  const man = net / 10000
  if (man < 1) return '약 1만원 이하'
  const rounded = Math.round(man / 5) * 5 || Math.round(man)
  return `약 ${rounded}만원선`
}

// 비용 문자열 → { min, max }. fallback 장소용 ("무료","8천원~","12만원선","1.5만원","3천원" 등).
function toWon(numStr, unit) {
  const n = Number(numStr)
  if (!Number.isFinite(n)) return null
  if (unit.includes('만')) return Math.round(n * 10000)
  if (unit.includes('천')) return Math.round(n * 1000)
  return Math.round(n)
}

export function parseCostString(text) {
  const raw = String(text ?? '').trim()
  if (!raw || /무료/.test(raw)) return { min: 0, max: 0 }
  const range = raw.match(/([\d.]+)\s*~\s*([\d.]+)\s*(만원|천원|원)/)
  if (range) {
    const unit = range[3]
    return { min: toWon(range[1], unit) ?? 0, max: toWon(range[2], unit) ?? 0 }
  }
  const single = raw.match(/([\d.]+)\s*(만원|천원|원)/)
  if (!single) return { min: 0, max: 0 }
  const base = toWon(single[1], single[2]) ?? 0
  if (/~/.test(raw)) return { min: base, max: Math.round(base * 1.5) } // "8천원~" = N부터
  if (/선/.test(raw)) return { min: Math.round(base * 0.85), max: Math.round(base * 1.15) } // "12만원선" = 대략
  return { min: base, max: base } // 확정 단일값
}

// 장소 비용 범위. TourAPI 실장소는 min/maxCost(숫자), 그 외는 문자열 파싱.
export function placeCostRange(place) {
  if (Number.isFinite(place?.minCost) && Number.isFinite(place?.maxCost)) {
    return { min: place.minCost, max: place.maxCost }
  }
  return parseCostString(place?.cost)
}

// 인원수만큼 식사/관광(입장료) 비용을 늘린다. 숙박은 보통 인원수와 무관하게 방(그룹) 단위
// 요금이라 제외한다. 후보 풀 단계(선택 로직이 돌기 전)에서 적용해야, "몇 명이 몇 곳을 갈지"
// 고르는 예산 적합성 판단 자체가 인원수를 반영한다.
export function scalePlaceCost(place, party = 1) {
  const p = Math.max(1, Number(party) || 1)
  if (p <= 1 || place?.kind === 'stay') return place
  const { min, max } = placeCostRange(place)
  return { ...place, minCost: min * p, maxCost: max * p }
}

export function scalePlacesCost(places = [], party = 1) {
  return places.map((p) => scalePlaceCost(p, party))
}

// 장소 여러 개의 비용 범위 합.
export function sumCostRange(places = []) {
  return places.reduce(
    (acc, p) => {
      const { min, max } = placeCostRange(p)
      return { min: acc.min + min, max: acc.max + max }
    },
    { min: 0, max: 0 },
  )
}

// 3단계 예산 상태: under(초록) / near(앰버) / over(빨강).
// 예전엔 "min~max 범위가 예산선에 걸치기만 하면 near"였는데, 장소별 비용 범위를 그냥
// 합산하다 보니(sumCostRange) 범위 폭 자체가 장소 개수만큼 누적돼서 코스가 길수록(1박2일
// 이상) 총 범위가 실제보다 훨씬 넓어지고, 중간값 기준으론 확실히 예산 안인데도 "근처"로
// 뜨는 문제가 있었음(2026-07-21, "합해보면 부족한데 근처로 나온다" 피드백으로 발견). 그래서
// 범위가 예산을 걸치는지가 아니라, 중간값이 예산에서 얼마나 떨어져 있는지로 판단한다 —
// 예산의 ±10% 안쪽이면 근처, 그보다 확실히 낮으면 여유, 확실히 높으면 초과.
const NEAR_TOLERANCE_RATIO = 0.1
export function budgetState({ min, max }, budget) {
  if (!Number.isFinite(budget) || budget <= 0) return 'near'
  const mid = (min + max) / 2
  const tolerance = budget * NEAR_TOLERANCE_RATIO
  if (mid <= budget - tolerance) return 'under'
  if (mid > budget + tolerance) return 'over'
  return 'near'
}

// 장소 1개 비용 표기: 확정(min===max) → 물결 없음, 범위 → 중간값에 물결.
export function formatPlaceCost(place) {
  const { min, max } = placeCostRange(place)
  if (max <= 0) return '무료'
  if (min === max) return `${formatKRW(min)}원`
  const mid = Math.round((min + max) / 2 / 1000) * 1000
  return `~${formatKRW(mid)}원`
}
