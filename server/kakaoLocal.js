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
    headers: {
      authorization: `KakaoAK ${kakaoKey()}`,
    },
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
