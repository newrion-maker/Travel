const KAKAO_LOCAL_BASE = 'https://dapi.kakao.com/v2/local/search/keyword.json'

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

async function lookupPlace(region, place) {
  const params = new URLSearchParams({
    query: [region, place.name].filter(Boolean).join(' '),
    size: '1',
  })

  if (place.mapx && place.mapy) {
    params.set('x', String(place.mapx))
    params.set('y', String(place.mapy))
    params.set('radius', '20000')
  }

  const response = await fetch(`${KAKAO_LOCAL_BASE}?${params.toString()}`, {
    headers: kakaoHeaders(),
  })

  if (!response.ok) return null

  const data = await response.json()
  return data?.documents?.[0] || null
}

export async function enrichPlacesWithKakao(region, places) {
  if (!Array.isArray(places) || !places.length) return []

  if (!hasUsableKakaoKey()) {
    return places.map((place) => ({
      ...place,
      mapUrl: fallbackMapUrl(region, place.name),
    }))
  }

  const enriched = []
  for (const place of places) {
    try {
      const kakao = await lookupPlace(region, place)
      enriched.push({
        ...place,
        mapUrl: kakao?.place_url || fallbackMapUrl(region, place.name),
        kakaoPlaceId: kakao?.id || '',
        kakaoPlaceName: kakao?.place_name || '',
        kakaoAddress: kakao?.road_address_name || kakao?.address_name || '',
        kakaoPhone: kakao?.phone || '',
        kakaoCategory: kakao?.category_name || '',
      })
    } catch {
      enriched.push({
        ...place,
        mapUrl: fallbackMapUrl(region, place.name),
      })
    }
  }

  return enriched
}

export async function diagnoseKakaoLocal(query = '강릉') {
  const key = kakaoKey()
  const result = {
    hasKey: hasUsableKakaoKey(),
    keyLength: key.length,
    sendsAuthorizationHeader: Boolean(kakaoHeaders().Authorization),
    authorizationScheme: kakaoHeaders().Authorization.startsWith('KakaoAK ') ? 'KakaoAK' : 'unknown',
    ok: false,
    status: null,
    total: null,
    hasPlaceUrl: false,
    errorType: '',
    message: '',
    networkError: '',
  }

  if (!result.hasKey) return result

  try {
    const params = new URLSearchParams({ query, size: '1' })
    const response = await fetch(`${KAKAO_LOCAL_BASE}?${params.toString()}`, {
      headers: kakaoHeaders(),
    })
    result.ok = response.ok
    result.status = response.status
    const data = await response.json().catch(() => ({}))
    result.total = data?.meta?.total_count ?? null
    result.hasPlaceUrl = Boolean(data?.documents?.[0]?.place_url)
    result.errorType = data?.errorType || ''
    result.message = data?.message || ''
  } catch (error) {
    result.networkError = error.cause?.code || error.message || 'unknown'
  }

  return result
}
