import { describe, expect, it } from 'vitest'
import {
  formatKRW,
  budgetBand,
  parseCostString,
  placeCostRange,
  sumCostRange,
  budgetState,
  formatPlaceCost,
  scalePlaceCost,
  scalePlacesCost,
} from './budget.js'

describe('formatKRW', () => {
  it('adds thousand separators', () => {
    expect(formatKRW(150000)).toBe('150,000')
  })
  it('returns empty string for empty input', () => {
    expect(formatKRW('')).toBe('')
  })
})

describe('budgetBand', () => {
  it('rounds to the nearest 5만원', () => {
    expect(budgetBand(153000)).toBe('약 15만원선')
  })
  it('handles under 1만원', () => {
    expect(budgetBand(8000)).toBe('약 1만원 이하')
  })
})

describe('parseCostString', () => {
  it('parses "무료" as zero', () => {
    expect(parseCostString('무료')).toEqual({ min: 0, max: 0 })
  })
  it('parses a same-unit range like "3~7만원"', () => {
    expect(parseCostString('3~7만원')).toEqual({ min: 30000, max: 70000 })
  })
  it('parses "N원~" as an open-ended floor', () => {
    const result = parseCostString('8천원~')
    expect(result.min).toBe(8000)
    expect(result.max).toBeGreaterThan(result.min)
  })
  it('parses a single confirmed value with no range marker', () => {
    expect(parseCostString('12000원')).toEqual({ min: 12000, max: 12000 })
  })
})

describe('placeCostRange', () => {
  it('prefers numeric minCost/maxCost when present', () => {
    expect(placeCostRange({ minCost: 5000, maxCost: 9000, cost: '무료' })).toEqual({ min: 5000, max: 9000 })
  })
  it('falls back to parsing the cost string when numeric fields are absent', () => {
    expect(placeCostRange({ cost: '무료' })).toEqual({ min: 0, max: 0 })
  })
})

describe('sumCostRange', () => {
  it('sums min/max across places', () => {
    const places = [
      { minCost: 1000, maxCost: 2000 },
      { minCost: 3000, maxCost: 3000 },
    ]
    expect(sumCostRange(places)).toEqual({ min: 4000, max: 5000 })
  })
  it('returns zero for an empty list', () => {
    expect(sumCostRange([])).toEqual({ min: 0, max: 0 })
  })
})

describe('budgetState', () => {
  it('is "under" when the max fits within budget', () => {
    expect(budgetState({ min: 1000, max: 2000 }, 5000)).toBe('under')
  })
  it('is "over" when even the min exceeds budget', () => {
    expect(budgetState({ min: 6000, max: 9000 }, 5000)).toBe('over')
  })
  it('is "near" when the range straddles the budget', () => {
    expect(budgetState({ min: 4000, max: 6000 }, 5000)).toBe('near')
  })
  // 2026-07-21 회귀: 장소별 비용 범위를 그냥 합산하면(sumCostRange) 폭이 장소 개수만큼
  // 누적돼서, 코스가 길수록(1박2일 이상) 범위가 예산선에 걸치기 쉬워진다. "합해보면 확실히
  // 부족한데 근처/초과로 뜬다"는 실사용 피드백으로 발견 — 중간값(mid) 기준으로 판단해야 함.
  it('is "under" when the range is wide but the midpoint is comfortably below budget', () => {
    // mid = 100,000, budget(150,000)의 10% 여유(135,000)보다 확실히 낮음 — 범위 폭(40,000~160,000)이
    // 넓어도 실제로는 여유 있는 코스인데, 예전 로직이면 max(160,000)>budget이라 "near"였음.
    expect(budgetState({ min: 40000, max: 160000 }, 150000)).toBe('under')
  })
  it('is "over" (not "near") when the midpoint clearly exceeds budget despite min being under it', () => {
    // mid = 210,000, budget보다 40% 비쌈 — 예전 로직이면 min(140,000)<=budget(150,000)이라 "near"로만
    // 표시돼서 실제로 예산이 한참 부족한 코스가 "안에 들 수도 있다"로 오해를 줬음.
    expect(budgetState({ min: 140000, max: 280000 }, 150000)).toBe('over')
  })
  it('is "near" when the wide-ranged midpoint sits close to budget', () => {
    expect(budgetState({ min: 80000, max: 220000 }, 150000)).toBe('near') // mid=150,000, 예산과 정확히 같음
  })
})

describe('formatPlaceCost', () => {
  it('shows "무료" for zero-cost places', () => {
    expect(formatPlaceCost({ minCost: 0, maxCost: 0 })).toBe('무료')
  })
  it('shows a plain value when min equals max', () => {
    expect(formatPlaceCost({ minCost: 12000, maxCost: 12000 })).toBe('12,000원')
  })
  it('shows a "~" prefixed midpoint for a range', () => {
    expect(formatPlaceCost({ minCost: 8000, maxCost: 16000 })).toBe('~12,000원')
  })
})

// 인원수(party)가 식비·입장료에 반영 안 되던 버그(2026-07-14 수정)에 대한 회귀 테스트.
describe('scalePlaceCost / scalePlacesCost', () => {
  it('multiplies food cost by party size', () => {
    const place = { kind: 'food', minCost: 9000, maxCost: 9000 }
    expect(scalePlaceCost(place, 2)).toMatchObject({ minCost: 18000, maxCost: 18000 })
    expect(scalePlaceCost(place, 3)).toMatchObject({ minCost: 27000, maxCost: 27000 })
  })
  it('multiplies sight (admission) cost by party size', () => {
    const place = { kind: 'sight', minCost: 5000, maxCost: 5000 }
    expect(scalePlaceCost(place, 2)).toMatchObject({ minCost: 10000, maxCost: 10000 })
  })
  it('does NOT scale stay (room-rate) cost by party size', () => {
    const place = { kind: 'stay', minCost: 100000, maxCost: 100000 }
    expect(scalePlaceCost(place, 2)).toMatchObject({ minCost: 100000, maxCost: 100000 })
    expect(scalePlaceCost(place, 4)).toMatchObject({ minCost: 100000, maxCost: 100000 })
  })
  it('leaves cost unchanged for party of 1', () => {
    const place = { kind: 'food', minCost: 9000, maxCost: 9000 }
    expect(scalePlaceCost(place, 1)).toBe(place)
  })
  it('scales a full list of mixed-kind places', () => {
    const places = [
      { kind: 'food', minCost: 9000, maxCost: 9000 },
      { kind: 'sight', minCost: 5000, maxCost: 5000 },
      { kind: 'stay', minCost: 100000, maxCost: 100000 },
    ]
    const scaled = scalePlacesCost(places, 3)
    expect(sumCostRange(scaled)).toEqual({ min: 9000 * 3 + 5000 * 3 + 100000, max: 9000 * 3 + 5000 * 3 + 100000 })
  })
})
