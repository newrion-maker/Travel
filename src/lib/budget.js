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
