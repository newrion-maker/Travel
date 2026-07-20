const KAKAO_LOCAL_BASE = 'https://dapi.kakao.com/v2/local/search/keyword.json'
const KAKAO_CACHE_TTL_MS = 1000 * 60 * 30
const KAKAO_CONCURRENCY = 5
const KAKAO_TIMEOUT_MS = 5000
const kakaoPlaceCache = new Map()

function kakaoKey() {
  return process.env.KAKAO_REST_API_KEY || ''
}

function hasUsableKakaoKey() {
  const key = kakaoKey()
  return Boolean(key && !key.includes('여기에') && !key.includes('your_') && key.length > 10)
}

function fallbackMapUrl(region, placeName) {
  const query = [region, placeName].filter(Boolean).join(' ')
  return `https://map.kakao.com/link/search/${encodeURIComponent(query)}`
}

function kakaoHeaders() {
  return {
    Authorization: `KakaoAK ${kakaoKey()}`,
  }
}

function cacheKey(region, place) {
  return [region, place.name, place.mapx || '', place.mapy || ''].join('|')
}

function readCache(key) {
  const cached = kakaoPlaceCache.get(key)
  if (!cached) return undefined
  if (Date.now() - cached.savedAt > KAKAO_CACHE_TTL_MS) {
    kakaoPlaceCache.delete(key)
    return undefined
  }
  return cached.value
}

function writeCache(key, value) {
  kakaoPlaceCache.set(key, { savedAt: Date.now(), value })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function lookupPlaceOnce(region, place) {
  const params = new URLSearchParams({
    query: [region, place.name].filter(Boolean).join(' '),
    size: '1',
  })

  if (place.mapx && place.mapy) {
    params.set('x', String(place.mapx))
    params.set('y', String(place.mapy))
    params.set('radius', '20000')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), KAKAO_TIMEOUT_MS)

  let response
  try {
    response = await fetch(`${KAKAO_LOCAL_BASE}?${params.toString()}`, {
      headers: kakaoHeaders(),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const err = new Error(`Kakao Local API ${response.status}`)
    err.status = response.status
    throw err
  }

  const data = await response.json()
  return data?.documents?.[0] || null
}

// 429(rate limit)/5xx/네트워크 오류는 일시적일 수 있어 한 번만 짧게 재시도한다. 401 등
// 나머지 4xx(키 문제 등)는 재시도해도 똑같이 실패하므로 즉시 포기.
async function lookupPlace(region, place) {
  try {
    return await lookupPlaceOnce(region, place)
  } catch (error) {
    if (error.status && error.status < 500 && error.status !== 429) throw error
    await delay(400)
    return lookupPlaceOnce(region, place)
  }
}

async function lookupPlaceCached(region, place) {
  const key = cacheKey(region, place)
  const cached = readCache(key)
  if (cached !== undefined) return cached

  const kakao = await lookupPlace(region, place)
  writeCache(key, kakao)
  return kakao
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let index = 0

  async function worker() {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await mapper(items[current], current)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function enrichPlacesWithKakao(region, places) {
  if (!Array.isArray(places) || !places.length) return []

  if (!hasUsableKakaoKey()) {
    return places.map((place) => ({
      ...place,
      mapUrl: '',
      kakaoPlaceId: '',
      kakaoSupported: false,
    }))
  }

  // 개별 실패를 매번 로그로 남기면 지역 하나당 최대 40줄이 쏟아지니, 실패 건수/마지막 오류만
  // 모아뒀다가 배치가 끝난 뒤 요약 한 줄로 남긴다 — "실패했는데 원인을 전혀 알 수 없는" 상태를
  // 막기 위함(2026-07-20, 조용히 삼켜지던 실패를 진단하다 발견).
  let errorCount = 0
  let lastError = null

  const results = await mapWithConcurrency(places, KAKAO_CONCURRENCY, async (place) => {
    try {
      const kakao = await lookupPlaceCached(region, place)
      const supported = Boolean(kakao?.id && kakao?.place_url)
      return {
        ...place,
        mapUrl: supported ? kakao.place_url : '',
        kakaoPlaceId: kakao?.id || '',
        kakaoPlaceName: kakao?.place_name || '',
        kakaoAddress: kakao?.road_address_name || kakao?.address_name || '',
        kakaoPhone: kakao?.phone || '',
        kakaoCategory: kakao?.category_name || '',
        kakaoSupported: supported,
      }
    } catch (error) {
      errorCount += 1
      lastError = error
      return {
        ...place,
        mapUrl: '',
        kakaoPlaceId: '',
        kakaoSupported: false,
      }
    }
  })

  if (errorCount > 0) {
    console.warn(`[kakaoLocal] ${region}: ${errorCount}/${places.length}곳 카카오 조회 실패 (마지막 오류: ${lastError?.message || lastError})`)
  }

  return results
}
