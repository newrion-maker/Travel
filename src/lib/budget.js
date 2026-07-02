// 순예산 계산 (교통비 처리) — 기획서 §4.1 을 구현.
//
// 교통비 포함 여부는 이동수단과 독립적인 선택. (§4.1)
//  - 포함: 총예산에서 교통비 어림값 차감 후 잔액을 L/F/A 배분 대상으로.
//    어림값 = 대중교통 총예산의 10~15%, 자차 5~10% (원거리 여부에 따라 가변).
//  - 별도: 입력 예산 100%를 그대로 배분, 교통비는 계산 제외.

// MVP: 원거리 가변폭의 중앙값을 사용 (대중교통 12.5%, 자차 7.5%).
const FARE_RATE = {
  대중교통: 0.125,
  자차: 0.075,
}

/**
 * @param {number} budget 총예산(원, 전체 인원 합산)
 * @param {'자차'|'대중교통'} transit
 * @param {boolean} fareIncluded 교통비를 예산에 포함하는지
 * @returns {{ net:number, fare:number, rate:number }}
 */
export function computeNetBudget(budget, transit, fareIncluded) {
  if (!fareIncluded) {
    return { net: budget, fare: 0, rate: 0 }
  }
  const rate = FARE_RATE[transit] ?? 0.1
  const fare = Math.round((budget * rate) / 1000) * 1000 // 천원 단위 반올림
  return { net: Math.max(budget - fare, 0), fare, rate }
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

// 3단계 예산 상태: under(초록·max≤예산) / near(앰버·범위 걸침) / over(빨강·min>예산).
export function budgetState({ min, max }, budget) {
  if (!Number.isFinite(budget) || budget <= 0) return 'near'
  if (max <= budget) return 'under'
  if (min > budget) return 'over'
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
