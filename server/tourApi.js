const TOUR_API_BASE = 'https://apis.data.go.kr/B551011/KorService2'

const REGION_CODES = {
  '강원 강릉시': { areaCode: '32', sigunguCode: '1' },
  '부산 해운대구': { areaCode: '6', sigunguCode: '16' },
  '전북 전주시': { areaCode: '37', sigunguCode: '12' },
  '제주 제주시': { areaCode: '39', sigunguCode: '4' },
}

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

function regionParams(region) {
  return REGION_CODES[region] ?? REGION_CODES['강원 강릉시']
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

export async function fetchTourPlaces(region) {
  const key = tourApiKey()
  if (!key || key.includes('여기에_')) return []

  const { areaCode, sigunguCode } = regionParams(region)
  const params = new URLSearchParams({
    MobileOS: 'ETC',
    MobileApp: 'summer-travel-course',
    _type: 'json',
    numOfRows: '40',
    pageNo: '1',
    arrange: 'Q',
    areaCode,
    sigunguCode,
  })
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key)
  const response = await fetch(`${TOUR_API_BASE}/areaBasedList2?serviceKey=${serviceKey}&${params.toString()}`)

  if (!response.ok) {
    throw new Error(`TourAPI request failed: ${response.status}`)
  }

  const data = await response.json()
  const rawItems = data?.response?.body?.items?.item
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []
  return items.map(normalizeTourPlace).filter((place) => place.name)
}
