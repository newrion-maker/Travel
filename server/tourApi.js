import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { enrichPlacesWithKakao } from './kakaoLocal.js'

const TOUR_API_BASE = 'https://apis.data.go.kr/B551011/KorService2'

// 전국 시/도·시/군/구 코드 트리 (scripts/generate-regions.mjs 로 생성).
const regionData = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'regions.json'), 'utf8'),
)

// "시도 시군구" 문자열 → { areaCode, sigunguCode } 매핑.
const REGION_CODES = {}
for (const sido of regionData.sido) {
  for (const sg of sido.sigungu) {
    REGION_CODES[`${sido.name} ${sg.name}`] = { areaCode: sido.code, sigunguCode: sg.code }
  }
}
const DEFAULT_REGION_CODE = REGION_CODES['강원 강릉시'] || { areaCode: '32', sigunguCode: '1' }

const CONTENT_KIND = {
  12: 'sight',
  14: 'sight',
  15: 'sight',
  25: 'sight',
  28: 'sight',
  32: 'stay',
  38: 'sight',
  39: 'food',
}

const KIND_ICON = {
  stay: '숙',
  food: '맛',
  sight: '관',
}

const PRICE_RULES = [
  { kind: 'food', pattern: /젤라또|아이스크림|빙수|디저트|카페|커피|베이커리|방앗간|빵|도넛/u, min: 5000, max: 12000, label: '예상 5천~1.2만원' },
  { kind: 'food', pattern: /시장|분식|국밥|백반|순두부|칼국수|국수|김밥|만두/u, min: 8000, max: 15000, label: '예상 8천~1.5만원' },
  { kind: 'food', pattern: /횟집|회센터|해산물|대게|한우|코스|다이닝|오마카세|스테이크/u, min: 25000, max: 50000, label: '예상 2.5~5만원' },
  { kind: 'stay', pattern: /게스트|호스텔|민박|도미토리/u, min: 30000, max: 70000, label: '1박 3~7만원' },
  { kind: 'stay', pattern: /모텔|여관|비즈니스|인텔/u, min: 50000, max: 100000, label: '1박 5~10만원' },
  { kind: 'stay', pattern: /리조트|오션|스파|풀빌라|씨마크|세인트존스|하이오션/u, min: 120000, max: 250000, label: '1박 12~25만원' },
  { kind: 'stay', pattern: /호텔/u, min: 70000, max: 150000, label: '1박 7~15만원' },
  { kind: 'sight', pattern: /산책|해변|해수욕장|거리|공원|시장|방파제|항구|호수|카페거리/u, min: 0, max: 0, label: '무료' },
  { kind: 'sight', pattern: /박물관|미술관|전시|아트|월드|체험|레일|바이크|입장/u, min: 3000, max: 25000, label: '예상 3천~2.5만원' },
]

const DEFAULT_PRICE = {
  stay: { min: 80000, max: 150000, label: '1박 8~15만원' },
  food: { min: 12000, max: 20000, label: '예상 1.2~2만원' },
  sight: { min: 0, max: 10000, label: '무료~1만원' },
}

function tourApiKey() {
  return process.env.TOUR_API_KEY || process.env.VITE_TOUR_API_KEY || ''
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// data.go.kr(TourAPI)은 간헐적으로 503/500을 반환한다. 일시 장애면 짧은 백오프 후 재시도.
async function fetchWithRetry(url, { retries = 2, backoffMs = 500 } = {}) {
  let lastResponse
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await delay(backoffMs * attempt)
    try {
      const response = await fetch(url)
      if (response.status < 500) return response // 성공 또는 4xx(클라이언트 오류)는 그대로 반환
      lastResponse = response // 5xx는 일시 장애 가능 → 재시도 대상
    } catch (error) {
      lastError = error // 네트워크 오류 → 재시도 대상
    }
  }

  if (lastResponse) return lastResponse
  throw lastError
}

function regionParams(region) {
  return REGION_CODES[region] ?? DEFAULT_REGION_CODE
}

function estimatePrice(kind, item) {
  const text = `${item.title || ''} ${item.addr1 || ''} ${item.cat2 || ''} ${item.cat3 || ''}`
  const matched = PRICE_RULES.find((rule) => rule.kind === kind && rule.pattern.test(text))
  return matched || DEFAULT_PRICE[kind]
}

function normalizeTourPlace(item) {
  const kind = CONTENT_KIND[Number(item.contenttypeid)] ?? 'sight'
  const price = estimatePrice(kind, item)

  return {
    icon: KIND_ICON[kind],
    kind,
    name: item.title,
    tag: item.addr1 || item.cat3 || '관광공사 추천 장소',
    cost: price.label,
    minCost: price.min,
    maxCost: price.max,
    mapx: Number(item.mapx) || null,
    mapy: Number(item.mapy) || null,
    image: item.firstimage || item.firstimage2 || '',
    contentId: item.contentid,
    contentTypeId: item.contenttypeid,
  }
}

async function fetchAreaBasedList({ areaCode, sigunguCode, contentTypeId, numOfRows, serviceKey, region, required }) {
  const params = new URLSearchParams({
    MobileOS: 'ETC',
    MobileApp: 'summer-travel-course',
    _type: 'json',
    numOfRows: String(numOfRows),
    pageNo: '1',
    arrange: 'Q',
    areaCode,
    sigunguCode,
    ...(contentTypeId ? { contentTypeId } : {}),
  })

  let response
  try {
    response = await fetchWithRetry(`${TOUR_API_BASE}/areaBasedList2?serviceKey=${serviceKey}&${params.toString()}`)
  } catch (error) {
    if (required) throw error
    return []
  }

  if (!response.ok) {
    if (required) {
      console.warn(`[tourApi] ${region} 실시간 장소 조회 실패 (HTTP ${response.status}) → 샘플 데이터로 대체`)
      throw new Error(`TourAPI request failed: ${response.status}`)
    }
    return []
  }

  const data = await response.json()
  const rawItems = data?.response?.body?.items?.item
  return Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []
}

export async function fetchTourPlaces(region) {
  const key = tourApiKey()
  if (!key || key.includes('여기에_')) return []

  const { areaCode, sigunguCode } = regionParams(region)
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key)
  const common = { areaCode, sigunguCode, serviceKey, region }

  // 카테고리 구분 없이 인기순(Q)으로 40개만 뽑으면, 관광지·맛집이 많은 지역(예: 성심당
  // 있는 대전 중구)에서는 숙박 항목이 순위 밖으로 완전히 밀려서 코스에 숙소가 하나도
  // 안 잡히는 문제가 있었음(2026-07-21, 실사용 피드백으로 발견 — 1일차에 숙박 자체가
  // 안 보임). 숙박(32)·음식(39)은 최소 수량을 보장하도록 따로 조회해서 합친다. 메인
  // 조회(전체 카테고리 혼합)가 실패하면 기존처럼 샘플로 폴백하되, 보강 조회 둘은 실패해도
  // 조용히 빈 배열로 넘어가 전체 흐름을 막지 않는다.
  const [general, stayItems, foodItems] = await Promise.all([
    fetchAreaBasedList({ ...common, numOfRows: 40, required: true }),
    fetchAreaBasedList({ ...common, contentTypeId: '32', numOfRows: 10, required: false }),
    fetchAreaBasedList({ ...common, contentTypeId: '39', numOfRows: 10, required: false }),
  ])

  const seen = new Set()
  const dedupe = (list) =>
    list.filter((item) => {
      if (!item?.contentid || seen.has(item.contentid)) return false
      seen.add(item.contentid)
      return true
    })
  const items = [...dedupe(stayItems), ...dedupe(foodItems), ...dedupe(general)]
  const places = items.map(normalizeTourPlace).filter((place) => place.name)
  return enrichPlacesWithKakao(region, places)
}
