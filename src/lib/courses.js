// 코스 생성 — 기획서 §3.4 "메인/서브 구성 로직" + §4.4 프롬프트 설계 방향.
//
// ⚠️ 실제 제품에서는 이 함수가 아래를 수행한다 (README "교체할 자리"):
//   1. TourAPI areaBasedList 프리페치 결과(장소 목록)
//   2. computeNetBudget()의 순예산 + 여행기간 + 인원수 + L/F/A 비율 3세트 + 이동수단 제약
//   을 OpenAI API에 구조화 프롬프트로 전달 → JSON 코스 3개 파싱.
//
// 여기서는 API 키 없이 동작하도록 동일한 "출력 스키마"를 mock 데이터로 생성한다.
// courses[] 스키마는 README State Management 절을 바탕으로 하되, 기간별 표시를 위해 days[]를 추가한다.
//   { key, label, accent, title, budget, ratios:{stay,food,sight}, transit, places:[...], days:[...] }

import { computeNetBudget, budgetBand, placeCostRange, sumCostRange, budgetState } from './budget.js'
import { LABELS, LABEL_ACCENT } from './personality.js'

// 축별 대표 비율 프로파일 (전일정 기준). 당일치기면 stay 제거 후 재정규화.
const RATIO_PROFILE = {
  L: { stay: 50, food: 28, sight: 22 },
  F: { stay: 25, food: 42, sight: 33 },
  A: { stay: 20, food: 25, sight: 55 },
}

// 강릉 큐레이션 장소 세트 (스크린샷 기준 데모 데이터).
// kind: stay|food|sight, icon 한글 이니셜: 숙/식/관/카/체
const PLACES_GANGNEUNG = {
  L: [
    { icon: '숙', kind: 'stay', name: '씨마크 호텔', tag: '숙박 · 스파', cost: '12만원선' },
    { icon: '식', kind: 'food', name: '호텔 다이닝', tag: '저녁 · 코스', cost: '3만원선' },
    { icon: '카', kind: 'food', name: '테라로사 커피', tag: '카페 · 로스터리', cost: '1만원' },
    { icon: '관', kind: 'sight', name: '경포호 산책', tag: '관광 · 힐링', cost: '무료' },
  ],
  F: [
    { icon: '숙', kind: 'stay', name: '세인트존스 호텔', tag: '숙박 · 오션뷰', cost: '9만원선' },
    { icon: '식', kind: 'food', name: '초당순두부 마을', tag: '점심 · 로컬 맛집', cost: '8천원~' },
    { icon: '관', kind: 'sight', name: '오죽헌', tag: '관광 · 역사', cost: '3천원' },
    { icon: '카', kind: 'food', name: '봉봉방앗간', tag: '디저트 · 카페', cost: '1.5만원' },
    { icon: '관', kind: 'sight', name: '안목 커피거리', tag: '관광 · 야경', cost: '무료' },
  ],
  A: [
    { icon: '체', kind: 'sight', name: '정동진 레일바이크', tag: '체험 · 액티비티', cost: '2.5만원' },
    { icon: '관', kind: 'sight', name: '하슬라 아트월드', tag: '관광 · 전시', cost: '1.8만원' },
    { icon: '식', kind: 'food', name: '중앙시장 먹거리', tag: '점심 · 길거리', cost: '8천원~' },
    { icon: '숙', kind: 'stay', name: '강릉 게스트하우스', tag: '숙박 · 도미토리', cost: '3만원선' },
    { icon: '관', kind: 'sight', name: '주문진 방파제', tag: '관광 · 포토', cost: '무료' },
  ],
}

// 비-강릉 지역용 제네릭 mock (도시명 주입). 실제로는 TourAPI 결과로 대체된다.
function genericPlaces(city, axis) {
  const S = { icon: '숙', kind: 'stay' }
  const F = { icon: '식', kind: 'food' }
  const C = { icon: '카', kind: 'food' }
  const G = { icon: '관', kind: 'sight' }
  const E = { icon: '체', kind: 'sight' }
  const sets = {
    L: [
      { ...S, name: `${city} 시그니처 호텔`, tag: '숙박 · 프리미엄', cost: '11만원선' },
      { ...F, name: `${city} 호텔 다이닝`, tag: '저녁 · 코스', cost: '3만원선' },
      { ...C, name: `${city} 오션뷰 카페`, tag: '카페 · 뷰맛집', cost: '1만원' },
      { ...G, name: `${city} 대표 명소`, tag: '관광 · 힐링', cost: '무료' },
    ],
    F: [
      { ...S, name: `${city} 부티크 호텔`, tag: '숙박 · 위치 좋음', cost: '9만원선' },
      { ...F, name: `${city} 로컬 맛집`, tag: '점심 · 현지 인기', cost: '1만원~' },
      { ...G, name: `${city} 역사 명소`, tag: '관광 · 역사', cost: '3천원' },
      { ...C, name: `${city} 디저트 카페`, tag: '디저트 · 카페', cost: '1.5만원' },
      { ...G, name: `${city} 야경 스팟`, tag: '관광 · 야경', cost: '무료' },
    ],
    A: [
      { ...E, name: `${city} 액티비티`, tag: '체험 · 액티비티', cost: '2.5만원' },
      { ...G, name: `${city} 전시관`, tag: '관광 · 전시', cost: '1.8만원' },
      { ...F, name: `${city} 재래시장 먹거리`, tag: '점심 · 길거리', cost: '8천원~' },
      { ...S, name: `${city} 게스트하우스`, tag: '숙박 · 도미토리', cost: '3만원선' },
      { ...G, name: `${city} 포토 스팟`, tag: '관광 · 포토', cost: '무료' },
    ],
  }
  return sets[axis]
}

function placeMidCost(place) {
  const min = Number(place.minCost) || 0
  const max = Number(place.maxCost) || min
  return (min + max) / 2
}

function budgetTier({ net, party, period, isDayTrip }) {
  const days = tripDays(period)
  const nights = isDayTrip ? 0 : Math.max(days - 1, 1)
  const dailyPerPerson = net / Math.max(party * days, 1)
  const stayBudget = nights ? net * 0.55 / nights : 0

  if ((!isDayTrip && stayBudget < 90000) || dailyPerPerson < 45000) return 'low'
  if ((!isDayTrip && stayBudget > 160000) || dailyPerPerson > 90000) return 'high'
  return 'mid'
}

function roundToThousand(value) {
  return Math.max(0, Math.round(value / 1000) * 1000)
}

function budgetTableFor({ net, axis, tier, isDayTrip }) {
  const ratios = ratioForPeriod(axis, isDayTrip)
  const stay = roundToThousand((net * ratios.stay) / 100)
  const food = roundToThousand((net * ratios.food) / 100)
  const sight = roundToThousand((net * ratios.sight) / 100)
  const cafe = roundToThousand(food * (tier === 'low' ? 0.18 : 0.22))
  const meal = Math.max(0, food - cafe)
  const buffer = roundToThousand(net * (tier === 'low' ? 0.05 : 0.08))

  return [
    ...(!isDayTrip ? [{ label: '숙박', amount: stay }] : []),
    { label: '식사', amount: meal },
    { label: '카페', amount: cafe },
    { label: '관광/간식', amount: sight },
    { label: '여유비', amount: buffer },
  ]
}

function aiSummaryFor({ city, period, tier, axis, net }) {
  const amount = Math.round(net / 10000)
  const pace = tier === 'low' ? '알뜰하게' : tier === 'high' ? '여유롭게' : '무리 없이'
  const focus = axis === 'F' ? '식사와 카페 선택에 힘을 주고' : axis === 'L' ? '숙소 컨디션을 우선으로 보고' : '관광 동선을 넉넉하게 잡고'
  return `${city} ${period} 기준 ${amount}만원대 예산이면 ${pace} 다녀올 수 있어요. ${focus}, 실제 장소는 예산대에 맞춰 검증된 후보 위주로 골랐습니다.`
}

function strategyFor({ axis, tier, isDayTrip }) {
  const stayText = tier === 'low' ? '숙소는 게스트하우스나 10만원 이하 호텔을 우선 추천해요.' : tier === 'high' ? '숙소는 리조트나 컨디션 좋은 호텔까지 선택 폭을 넓혀도 괜찮아요.' : '숙소는 위치 좋은 중간 가격대 호텔을 우선으로 보는 게 좋아요.'
  const foodText = axis === 'F' ? '식사는 지역 대표 메뉴를 점심/저녁에 나눠 넣고, 카페 예산도 따로 잡는 구성이 좋아요.' : '식사는 부담 없는 로컬 메뉴 중심으로 잡고, 남는 예산을 관광이나 숙소에 배분해요.'
  const paceText = isDayTrip ? '당일치기는 이동 시간을 줄이고 핵심 장소만 짧게 묶는 편이 좋아요.' : '1박 이상은 첫날 도착 시간에 맞춰 가볍게 시작하고, 다음 날 핵심 코스를 넣는 편이 좋아요.'
  return [stayText, foodText, paceText]
}

function slotsFor({ axis, period, arrivalTime, isDayTrip }) {
  const firstMeal = arrivalTime === '저녁' ? '저녁' : '점심'
  const foodKeyword = axis === 'F' ? '지역 대표 맛집' : '부담 없는 로컬 식사'
  const cafeKeyword = axis === 'L' ? '숙소 근처 카페' : '동선 좋은 카페'
  const sightKeyword = axis === 'A' ? '핵심 관광지' : '가벼운 산책 명소'
  const slots = [
    { day: 1, time: firstMeal, type: 'food', keyword: foodKeyword },
    { day: 1, time: '오후', type: 'cafe', keyword: cafeKeyword },
    { day: 1, time: arrivalTime === '저녁' ? '밤' : '저녁', type: 'sight', keyword: sightKeyword },
  ]

  if (!isDayTrip) {
    slots.push({ day: 1, time: '숙박', type: 'stay', keyword: '예산 맞춤 숙소' })
    slots.push({ day: 2, time: '점심', type: 'food', keyword: axis === 'F' ? '두 번째 맛집' : '가성비 점심' })
    slots.push({ day: 2, time: '카페', type: 'cafe', keyword: '마무리 카페' })
  }

  if (period === '2박3일') {
    slots.push({ day: 3, time: '오전', type: 'sight', keyword: '마지막 관광지' })
  }

  return slots
}

function buildAiPlan({ city, period, arrivalTime, axis, tier, net, isDayTrip }) {
  return {
    summary: aiSummaryFor({ city, period, tier, axis, net }),
    budgetTable: budgetTableFor({ net, axis, tier, isDayTrip }),
    strategy: strategyFor({ axis, tier, isDayTrip }),
    slots: slotsFor({ axis, period, arrivalTime, isDayTrip }),
  }
}

function sortPlacesForBudget(places, tier, kind) {
  const target = {
    low: { stay: 65000, food: 9000, sight: 0 },
    mid: { stay: 110000, food: 16000, sight: 7000 },
    high: { stay: 190000, food: 35000, sight: 18000 },
  }[tier]?.[kind] ?? 0

  return [...places].sort((a, b) => {
    const aCost = placeMidCost(a)
    const bCost = placeMidCost(b)
    if (tier === 'low') return aCost - bCost
    if (tier === 'high') return bCost - aCost
    return Math.abs(aCost - target) - Math.abs(bCost - target)
  })
}

function isKakaoVerifiedPlace(place) {
  return Boolean(place?.kakaoSupported !== false && place?.kakaoPlaceId && /^https?:\/\/place\.map\.kakao\.com\//u.test(place.mapUrl || ''))
}

function mergeUniquePlaces(...groups) {
  const used = new Set()
  const result = []

  for (const group of groups) {
    for (const place of group || []) {
      if (!place?.name || used.has(place.name)) continue
      used.add(place.name)
      result.push(place)
    }
  }

  return result
}

function buildApiPlaces(tourPlaces, axis, fallbackPlaces, tier, allowFallback) {
  if (!Array.isArray(tourPlaces) || tourPlaces.length < 3) return fallbackPlaces

  const byKind = {
    stay: sortPlacesForBudget(tourPlaces.filter((place) => place.kind === 'stay'), tier, 'stay'),
    food: sortPlacesForBudget(tourPlaces.filter((place) => place.kind === 'food'), tier, 'food'),
    sight: sortPlacesForBudget(tourPlaces.filter((place) => place.kind === 'sight'), tier, 'sight'),
  }
  const shape = {
    L: ['stay', 'food', 'sight', 'food', 'sight'],
    F: ['food', 'food', 'sight', 'food', 'stay'],
    A: ['sight', 'sight', 'food', 'sight', 'stay'],
  }[axis]
  const used = new Set()
  const result = []

  for (const kind of shape) {
    const fromApi = byKind[kind]?.find((place) => !used.has(place.name))
    const fromFallback = allowFallback ? fallbackPlaces.find((place) => place.kind === kind && !used.has(place.name)) : null
    const place = fromApi || fromFallback
    if (place) {
      used.add(place.name)
      result.push(place)
    }
  }

  const fillPool = allowFallback ? fallbackPlaces : tourPlaces
  for (const place of fillPool) {
    if (result.length >= 5) break
    if (!used.has(place.name)) {
      used.add(place.name)
      result.push(place)
    }
  }

  return result.length >= 3 ? result : fallbackPlaces
}

const AXIS_WORD = { L: '호캉스', F: '미식', A: '알뜰' }

const DAY_PLACE_TARGETS = {
  1: [4],
  2: [3, 4],
  3: [3, 3, 4],
}

const FIRST_DAY_TARGET_BY_ARRIVAL = {
  오전: 4,
  오후: 3,
  저녁: 2,
}

// 이동수단 제약(§4.2) 반영 동선 안내 문구
function transitText(axis, transit) {
  const byCar = transit === '자차'
  const base = byCar ? '자차 이동 기준' : '대중교통 이동 기준'
  const tail = {
    L: byCar ? '숙소를 중심으로 여유롭게 도는 동선이에요.' : '숙소·역 접근이 좋은 장소 위주로 묶었어요.',
    F: byCar ? '가까운 맛집과 카페를 묶어 이동 부담을 줄인 동선이에요.' : '역세권 맛집 위주라 도보·버스로 이동이 편해요.',
    A: byCar ? '근교 명소까지 넓게 도는 알찬 동선이에요.' : '버스 접근이 쉬운 명소 위주로 알차게 묶었어요.',
  }
  return `${base} · ${tail[axis]}`
}

// 여행기간(당일치기) 반영: stay 제거 후 food/sight 재정규화 (§4.3)
function ratioForPeriod(axis, isDayTrip) {
  const p = RATIO_PROFILE[axis]
  if (!isDayTrip) return { ...p }
  const sum = p.food + p.sight
  const food = Math.round((p.food / sum) * 100)
  return { stay: 0, food, sight: 100 - food }
}

function shortCity(region) {
  // "강원 강릉시" → "강릉", "부산 해운대구" → "해운대"
  const parts = String(region || '').trim().split(/\s+/)
  const last = parts[parts.length - 1] || region || ''
  return last.replace(/(특별시|광역시|특별자치시|특별자치도|시|군|구)$/u, '') || last
}

function tripDays(period) {
  if (period === '당일치기') return 1
  if (period === '1박2일') return 2
  return 3
}

function extraPlaces(city, axis) {
  const byAxis = {
    L: [
      { icon: '관', kind: 'sight', name: `${city} 해변 산책로`, tag: '관광 · 산책', cost: '무료' },
      { icon: '카', kind: 'food', name: `${city} 브런치 카페`, tag: '아침 · 카페', cost: '1.2만원' },
      { icon: '식', kind: 'food', name: `${city} 로컬 한상`, tag: '점심 · 한식', cost: '1.5만원~' },
      { icon: '관', kind: 'sight', name: `${city} 전망대`, tag: '관광 · 포토', cost: '무료' },
      { icon: '카', kind: 'food', name: `${city} 디저트 라운지`, tag: '디저트 · 휴식', cost: '1만원' },
    ],
    F: [
      { icon: '식', kind: 'food', name: `${city} 아침 국밥집`, tag: '아침 · 로컬', cost: '9천원~' },
      { icon: '카', kind: 'food', name: `${city} 베이커리 카페`, tag: '디저트 · 인기', cost: '1.3만원' },
      { icon: '식', kind: 'food', name: `${city} 해산물 식당`, tag: '저녁 · 맛집', cost: '2.5만원~' },
      { icon: '관', kind: 'sight', name: `${city} 골목 산책`, tag: '관광 · 로컬', cost: '무료' },
      { icon: '식', kind: 'food', name: `${city} 시장 분식`, tag: '간식 · 시장', cost: '7천원~' },
    ],
    A: [
      { icon: '관', kind: 'sight', name: `${city} 무료 전시관`, tag: '관광 · 전시', cost: '무료' },
      { icon: '체', kind: 'sight', name: `${city} 해안 트레킹`, tag: '체험 · 걷기', cost: '무료' },
      { icon: '식', kind: 'food', name: `${city} 시장 백반`, tag: '점심 · 가성비', cost: '8천원~' },
      { icon: '관', kind: 'sight', name: `${city} 야경 산책`, tag: '관광 · 야경', cost: '무료' },
      { icon: '카', kind: 'food', name: `${city} 동네 카페`, tag: '카페 · 휴식', cost: '7천원~' },
    ],
  }
  return byAxis[axis]
}

function firstDaySummary(arrivalTime, isDayTrip) {
  if (arrivalTime === '오전') return isDayTrip ? '오전 도착 · 알찬 당일 동선' : '오전 도착 · 점심부터 시작'
  if (arrivalTime === '저녁') return isDayTrip ? '저녁 도착 · 짧은 핵심 동선' : '저녁 도착 · 식사와 숙소 중심'
  return isDayTrip ? '오후 도착 · 핵심 당일 동선' : '오후 도착 · 가벼운 시작'
}

function orderFirstDayPlaces(places, arrivalTime) {
  if (arrivalTime === '오전') return places
  if (arrivalTime === '저녁') {
    return [...places].sort((a, b) => {
      const score = { food: 0, stay: 1, sight: 2 }
      return (score[a.kind] ?? 3) - (score[b.kind] ?? 3)
    })
  }
  return [...places].sort((a, b) => {
    const score = { food: 0, sight: 1, stay: 2 }
    return (score[a.kind] ?? 3) - (score[b.kind] ?? 3)
  })
}

// 각 장소에 일정표용 역할(점심/카페/숙박/관광 등)을 부여한다. 정확한 시각이 아니라 '역할·끼니' 기준.
function assignDayRoles(dayPlaces, day, arrivalTime) {
  const meals = day === 1 ? (arrivalTime === '저녁' ? ['저녁'] : ['점심', '저녁']) : ['아침', '점심', '저녁']
  let mealIdx = 0
  const isCafe = (p) => p.icon === '카' || /카페|커피|디저트|베이커리|빵집|젤라또|아이스크림|로스터리|방앗간/u.test(`${p.name} ${p.tag || ''} ${p.kakaoCategory || ''}`)
  const lastNonStayIdx = dayPlaces.reduce((last, p, i) => (p.kind !== 'stay' ? i : last), -1)
  return dayPlaces.map((p, i) => {
    let role
    if (p.kind === 'stay') role = '숙박'
    else if (p.kind === 'food' && isCafe(p)) role = i === lastNonStayIdx ? '마무리 카페' : '카페'
    else if (p.kind === 'food') role = meals[Math.min(mealIdx++, meals.length - 1)]
    else if (p.icon === '체') role = '체험'
    else role = i === 0 && day > 1 ? '오전 관광' : '관광'
    return { ...p, role }
  })
}

function buildDayPlans({ city, axis, period, arrivalTime = '오후', places, candidatePlaces = [], isDayTrip, allowSyntheticPlaces = true }) {
  const totalDays = tripDays(period)
  const targets = [...DAY_PLACE_TARGETS[totalDays]]
  targets[0] = Math.min(targets[0], FIRST_DAY_TARGET_BY_ARRIVAL[arrivalTime] ?? targets[0])
  const stay = places.find((place) => place.kind === 'stay')
  const nonStayBase = places.filter((place) => place.kind !== 'stay')
  const candidateNonStay = candidatePlaces.filter((place) => place.kind !== 'stay')
  const syntheticNonStay = allowSyntheticPlaces ? extraPlaces(city, axis) : []
  const nonStayPool = orderFirstDayPlaces(mergeUniquePlaces(nonStayBase, candidateNonStay, syntheticNonStay), arrivalTime)
  const days = []
  let cursor = 0

  for (let day = 1; day <= totalDays; day += 1) {
    const isStayNight = !isDayTrip && day < totalDays && stay
    const nonStayCount = targets[day - 1] - (isStayNight ? 1 : 0)
    const dayPlaces = []

    for (let i = 0; i < nonStayCount; i += 1) {
      if (!nonStayPool.length) break
      dayPlaces.push({ ...nonStayPool[cursor % nonStayPool.length], slotId: `d${day}p${i}` })
      cursor += 1
    }

    if (isStayNight) {
      dayPlaces.push({
        ...stay,
        name: totalDays > 2 ? `${stay.name} (${day}박)` : stay.name,
        tag: `${day}박 숙소 · ${stay.tag.replace(/^숙박 ·\s*/u, '')}`,
        slotId: 'stay', // 다박이면 밤마다 공유 → 스왑 시 전체 밤 일괄 교체
      })
    }

    days.push({
      day,
      title: `${day}일차`,
      summary: day === 1 ? firstDaySummary(arrivalTime, isDayTrip) : day === totalDays ? '마무리 동선' : isStayNight ? `${day}박 포함 동선` : '핵심 방문 동선',
      places: assignDayRoles(dayPlaces, day, arrivalTime),
    })
  }

  return days
}

// 빨강 최소 방어: basePlaces에서 가장 비싼(최소비용 기준) 장소를 같은 kind의 더 싼 후보(pool)로 교체.
// 최적화가 아니라 "기본 조합이 예산 초과(빨강)로 뜨는 최악"만 피하는 방어용. 대체 후보 없으면 그대로 둔다.
function swapCheapestSameKind(basePlaces, pool) {
  if (!basePlaces?.length) return null
  let idx = 0
  let worstMin = -1
  basePlaces.forEach((p, i) => {
    const { min } = placeCostRange(p)
    if (min > worstMin) {
      worstMin = min
      idx = i
    }
  })
  const target = basePlaces[idx]
  const used = new Set(basePlaces.map((p) => p.name))
  const cheaper = (pool || [])
    .filter((c) => c.kind === target.kind && !used.has(c.name) && placeCostRange(c).min < worstMin)
    .sort((a, b) => placeCostRange(a).min - placeCostRange(b).min)[0]
  if (!cheaper) return null
  const next = basePlaces.slice()
  next[idx] = cheaper
  return next
}

/**
 * @param {object} input  FlowContext input (region, period, transit, budget, fareIncluded ...)
 * @param {object} personality  computePersonality() 결과
 * @returns {Array} 코스 3개 (메인 먼저, 서브 2개)
 */
export function generateCourses(input, personality, tourPlaces = []) {
  const { region, regionLabel, period, arrivalTime, transit, budget, fareIncluded, party = 1 } = input
  const isDayTrip = personality.isDayTrip
  const city = shortCity(regionLabel || region)
  const { net, fare } = computeNetBudget(Number(budget) || 0, transit, fareIncluded)
  const band = budgetBand(net)
  const tier = budgetTier({ net, party, period, isDayTrip })

  const isGangneung = /강릉/.test(region || '')
  const verifiedTourPlaces = Array.isArray(tourPlaces) ? tourPlaces.filter(isKakaoVerifiedPlace) : []
  const hasApiPlaces = verifiedTourPlaces.length >= 3

  // 메인 먼저, 나머지 축을 서브로 (§3.4). 당일치기는 숙박 축(L=호캉스)을 제외한다.
  const axisPool = isDayTrip ? ['F', 'A'] : ['L', 'F', 'A']
  const order = [personality.top, ...axisPool.filter((a) => a !== personality.top)]

  return order.map((axis) => {
    const fallbackPlaces = isGangneung ? PLACES_GANGNEUNG[axis] : genericPlaces(city, axis)
    let basePlaces = buildApiPlaces(verifiedTourPlaces, axis, fallbackPlaces, tier, !hasApiPlaces)
    let days = buildDayPlans({
      city,
      axis,
      period,
      arrivalTime,
      places: basePlaces,
      candidatePlaces: verifiedTourPlaces,
      isDayTrip,
      allowSyntheticPlaces: !hasApiPlaces,
    })

    // 빨강 최소 방어: 조합이 min 기준으로도 예산 초과(빨강)면, 가장 비싼 항목을 같은 kind의
    // 더 싼 후보로 교체 후 재구성(최대 3회). 앰버(범위 걸침)는 정직한 상태이므로 그대로 둔다.
    for (let guard = 0; guard < 3 && net > 0; guard += 1) {
      if (budgetState(sumCostRange(days.flatMap((day) => day.places)), net) !== 'over') break
      const swapped = swapCheapestSameKind(basePlaces, verifiedTourPlaces)
      if (!swapped) break
      basePlaces = swapped
      days = buildDayPlans({
        city,
        axis,
        period,
        arrivalTime,
        places: basePlaces,
        candidatePlaces: verifiedTourPlaces,
        isDayTrip,
        allowSyntheticPlaces: !hasApiPlaces,
      })
    }

    const places = days.flatMap((day) => day.places)
    const ratios = ratioForPeriod(axis, isDayTrip)
    return {
      key: axis,
      label: LABELS[axis], // "미식 우선형" 등
      accent: LABEL_ACCENT[axis], // teal | coral | amber
      title: `${city} ${AXIS_WORD[axis]} 코스`,
      budget: band,
      ratios,
      transit: transitText(axis, transit),
      source: hasApiPlaces ? 'tourApi' : 'sample',
      budgetTier: tier,
      // 예산 미터용: 순예산과 성향비율로 계산한 카테고리별 목표(배분 A).
      budgetNet: net,
      budgetFare: fare, // 교통비(예산에서 차감된 추정액). 0이면 미포함/별도계산.
      transitMode: transit,
      budgetTargets: {
        stay: Math.round((net * ratios.stay) / 100),
        food: Math.round((net * ratios.food) / 100),
        sight: Math.round((net * ratios.sight) / 100),
      },
      aiPlan: buildAiPlan({ city, period, arrivalTime, axis, tier, net, isDayTrip }),
      days,
      places,
    }
  })
}
