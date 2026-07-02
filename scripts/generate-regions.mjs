// 전국 시/도·시/군/구 지역 트리 생성 스크립트.
// TourAPI(KorService2 areaCode2)에서 17개 시/도 + 각 시/군/구 코드를 수집해
// src/data/regions.json 으로 저장한다. 코드는 거의 바뀌지 않으므로 1회 생성 후 커밋해 사용.
//
// 실행: node scripts/generate-regions.mjs   (.env.local 의 TOUR_API_KEY 사용)

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(rootDir, name), 'utf8').split(/\r?\n/u)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
        const idx = trimmed.indexOf('=')
        const key = trimmed.slice(0, idx).trim().replace(/^﻿/, '')
        const value = trimmed.slice(idx + 1).trim()
        if (key && process.env[key] == null) process.env[key] = value
      }
    } catch {
      // 파일 없으면 무시
    }
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// TourAPI가 주는 시/도 명을 짧은 표시명으로 정규화 (예: "경기도"→"경기").
// 지역 문자열은 "짧은시도명 + 공백 + 시군구명" 형식으로 통일한다 (예: "경기 평택시").
const SIDO_SHORT = {
  세종특별자치시: '세종',
  경기도: '경기',
  강원특별자치도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  경상북도: '경북',
  경상남도: '경남',
  전북특별자치도: '전북',
  전라남도: '전남',
  제주특별자치도: '제주',
}
const shortSido = (name) => SIDO_SHORT[name] || name

async function fetchAreas(serviceKey, areaCode) {
  const params = new URLSearchParams({
    serviceKey,
    MobileOS: 'ETC',
    MobileApp: 'summer-travel-course',
    _type: 'json',
    numOfRows: '100',
    pageNo: '1',
  })
  if (areaCode) params.set('areaCode', areaCode)

  const url = `https://apis.data.go.kr/B551011/KorService2/areaCode2?${params.toString()}`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await delay(600 * attempt)
    try {
      const response = await fetch(url)
      if (response.status >= 500) continue // data.go.kr 일시 장애 → 재시도
      const data = await response.json()
      const raw = data?.response?.body?.items?.item
      const items = Array.isArray(raw) ? raw : raw ? [raw] : []
      return items.map((item) => ({ name: String(item.name), code: String(item.code) }))
    } catch {
      // 재시도
    }
  }
  throw new Error(`areaCode2 실패 (areaCode=${areaCode ?? '전체'})`)
}

async function main() {
  loadEnv()
  const rawKey = process.env.TOUR_API_KEY || ''
  if (!rawKey) throw new Error('TOUR_API_KEY 없음')
  const serviceKey = rawKey.includes('%') ? rawKey : encodeURIComponent(rawKey)

  const sidoList = await fetchAreas(serviceKey)
  console.log(`시/도 ${sidoList.length}개:`, sidoList.map((s) => `${s.name}(${s.code})`).join(', '))

  const sido = []
  for (const item of sidoList) {
    const sigungu = await fetchAreas(serviceKey, item.code)
    sido.push({ name: shortSido(item.name), fullName: item.name, code: item.code, sigungu })
    console.log(`  ${shortSido(item.name)}: 시/군/구 ${sigungu.length}개`)
    await delay(120)
  }

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'TourAPI KorService2 areaCode2',
    sido,
  }
  const outPath = join(rootDir, 'src', 'data', 'regions.json')
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  const total = sido.reduce((sum, s) => sum + s.sigungu.length, 0)
  console.log(`저장 완료: ${outPath} (시/도 ${sido.length}, 시/군/구 합계 ${total})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
