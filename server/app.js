import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateAiPlans } from './aiPlan.js'
import { fetchTourPlaces } from './tourApi.js'
import { computePersonality } from '../src/lib/personality.js'
import { QUESTIONS } from '../src/data/questions.js'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(rootDir, 'dist')
const port = Number(process.env.PORT) || 5175

function loadLocalEnv() {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = join(rootDir, fileName)
    if (!existsSync(filePath)) continue

    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue

      const index = trimmed.indexOf('=')
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim()
      if (key && process.env[key] == null) {
        process.env[key] = value
      }
    }
  }
}

loadLocalEnv()

// 앱인토스 WebView 배포 시 프론트는 https://<appName>.private-apps.tossmini.com 에서 열리고
// 이 서버(백엔드)는 별도 도메인(Render 등)이라 CORS 허용이 없으면 /api/* 호출이 전부 막힌다.
// 화이트리스트 방식은 실제 출시된 토스 앱이 보내는 Origin이 예상과 달라 라이브에서만
// 계속 샘플 데이터로 폴백되는 문제(2026-07-24)가 있었음 — 이 API들은 로그인/결제 등
// 민감 정보가 없고 IP 기준 요청 제한(checkRateLimit)이 이미 걸려있어, 화이트리스트
// 대신 들어온 Origin을 그대로 반영해 허용한다.
function applyCors(req, res) {
  const origin = req.headers.origin
  if (!origin) return
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// 클라이언트의 "하루 3회 무료" 제한은 브라우저 localStorage 기준이라, API를 직접 호출하는
// 스크립트는 거치지 않는다. 특히 /api/ai-plan은 호출마다 실제 OpenAI 과금이 발생하므로,
// IP 기준 슬라이딩 윈도우로 서버 사이드 최소 방어선을 둔다.
// 값 산정: 사무실/행사장처럼 여러 명이 같은 공인 IP(NAT)를 공유하는 상황(예: 챌린지 심사)에서도
// 정상 사용자가 막히지 않도록 여유를 두되, 지속적인 스크립트 남용은 여전히 막을 수 있는 수준.
// (한 명당 보통 1~2회, 10명이 동시에 테스트해도 20~30회 안쪽 — 아래 값은 그보다 넉넉하게 잡음)
const RATE_LIMITS = {
  '/api/ai-plan': { windowMs: 15 * 60 * 1000, max: 30 },
  '/api/tour-places': { windowMs: 10 * 60 * 1000, max: 100 },
}
const rateLimitHits = new Map() // `${route}:${ip}` -> timestamp[]

function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return xff.split(',')[0].trim()
  return req.socket.remoteAddress || 'unknown'
}

function checkRateLimit(req, route) {
  const rule = RATE_LIMITS[route]
  if (!rule) return true
  const key = `${route}:${clientIp(req)}`
  const now = Date.now()
  const hits = (rateLimitHits.get(key) || []).filter((t) => now - t < rule.windowMs)
  if (hits.length >= rule.max) {
    rateLimitHits.set(key, hits)
    return false
  }
  hits.push(now)
  rateLimitHits.set(key, hits)
  return true
}

// 오래된 IP 버킷이 메모리에 무한정 쌓이지 않도록 주기적으로 청소.
setInterval(() => {
  const now = Date.now()
  for (const [key, hits] of rateLimitHits) {
    const rule = RATE_LIMITS[key.slice(0, key.lastIndexOf(':'))]
    const fresh = hits.filter((t) => now - t < (rule?.windowMs ?? 0))
    if (fresh.length) rateLimitHits.set(key, fresh)
    else rateLimitHits.delete(key)
  }
}, 30 * 60 * 1000).unref()

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/api/tour-places') {
    if (!checkRateLimit(req, url.pathname)) {
      sendJson(res, 429, { error: 'Too many requests', places: [], source: 'fallback' })
      return
    }
    try {
      const region = url.searchParams.get('region') || '강원 강릉시'
      const places = await fetchTourPlaces(region)
      sendJson(res, 200, { places, source: places.length ? 'tourApi' : 'empty' })
    } catch {
      sendJson(res, 200, { places: [], source: 'fallback' })
    }
    return
  }

  if (url.pathname === '/api/ai-plan' && req.method === 'POST') {
    if (!checkRateLimit(req, url.pathname)) {
      sendJson(res, 429, { error: 'Too many requests', plans: [], source: 'fallback' })
      return
    }
    try {
      const body = await readJsonBody(req)
      const plans = await generateAiPlans(body)
      sendJson(res, 200, { plans, source: plans.length ? 'openai' : 'fallback' })
    } catch {
      sendJson(res, 200, { plans: [], source: 'fallback' })
    }
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname)
  const requested = pathname === '/' ? '/index.html' : pathname
  const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(distDir, normalized)

  if (!existsSync(filePath)) {
    filePath = join(distDir, 'index.html')
  }

  const ext = extname(filePath)
  res.writeHead(200, {
    'content-type': mimeTypes[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  })
  createReadStream(filePath).pipe(res)
}

// 공유 링크 미리보기(OG). SPA라 미리보기 봇이 빈 index.html만 읽는 문제를 막기 위해,
// view=courses 요청이면 URL 파라미터에서 바로 뽑은 정보로 OG 태그를 주입해 응답한다.
// (근사 재현 방식이라 코스 생성 없이 파라미터만 사용. 성향은 가벼운 computePersonality로.)
const OG_TITLE_WORD = { L: '호캉스', F: '미식', A: '알뜰' }

function escHtml(text) {
  return String(text).replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function shortCityName(region) {
  const parts = String(region || '').trim().split(/\s+/u)
  const last = parts[parts.length - 1] || region || ''
  return last.replace(/(특별시|광역시|특별자치시|특별자치도|시|군|구)$/u, '') || last
}

function personalityWord(ansStr, period) {
  try {
    const answers = {}
    QUESTIONS.forEach((q, i) => {
      const a = ansStr?.[i]
      if (a) answers[q.id] = a
    })
    if (!Object.keys(answers).length) return '' // 답변 파라미터 없으면 성향 라벨 생략(안전 제목)
    return OG_TITLE_WORD[computePersonality(answers, period).top] || ''
  } catch {
    return ''
  }
}

function buildShareMeta(url, origin) {
  const params = url.searchParams
  const city = shortCityName(params.get('rl') || params.get('r') || '')
  const period = params.get('p') || ''
  const man = Number(params.get('b')) ? Math.round(Number(params.get('b')) / 10000) : 0
  const word = personalityWord(params.get('ans') || '', period)

  const title = `${city} ${word ? `${word} ` : ''}여행 코스`.replace(/\s+/gu, ' ').trim() || 'AI 여행 코스 추천'
  const desc = [man ? `약 ${man}만원` : '', period, '예산 맞춤 AI 코스 추천'].filter(Boolean).join(' · ')
  return {
    title,
    description: desc,
    image: `${origin}/og-cover.png`,
    pageUrl: `${origin}${url.pathname}${url.search}`,
  }
}

function injectOg(html, meta) {
  const tags = [
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escHtml(meta.description)}" />`,
    `<meta property="og:image" content="${escHtml(meta.image)}" />`,
    `<meta property="og:url" content="${escHtml(meta.pageUrl)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escHtml(meta.image)}" />`,
  ].join('\n    ')
  return html
    .replace(/<title>[\s\S]*?<\/title>/u, `<title>${escHtml(meta.title)}</title>`)
    .replace('</head>', `    ${tags}\n  </head>`)
}

async function serveShareHtml(req, res, url) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http'
  const origin = `${proto}://${req.headers.host}`
  const html = await readFile(join(distDir, 'index.html'), 'utf8')
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(injectOg(html, buildShareMeta(url, origin)))
}

// 회원가입/로그인이 없는 앱이라 서버가 보관하는 개인정보는 없음 — 기기 로컬 저장(localStorage)과
// 광고/지도 SDK가 각자 처리하는 부분만 있어 그 사실을 그대로 안내한다. React 번들과 무관하게
// 항상 뜨도록 순수 정적 HTML로 서빙한다.
const PRIVACY_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>개인정보처리방침 · 얼마 있어?</title>
<style>
  body { margin: 0; padding: 32px 20px 60px; max-width: 560px; margin: 0 auto; font-family: -apple-system, 'Pretendard', 'Malgun Gothic', sans-serif; color: #1B2528; line-height: 1.7; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 32px; color: #0E9A8F; }
  p, li { font-size: 14px; color: #3E4C51; }
  .updated { font-size: 12px; color: #8A999E; margin-bottom: 24px; }
</style>
</head>
<body>
  <h1>개인정보처리방침</h1>
  <p class="updated">최종 업데이트: 2026-07-17</p>

  <h2>회원가입 없이 이용하는 앱이에요</h2>
  <p>'얼마 있어?'는 별도의 회원가입·로그인 없이 이용해요. 그래서 이름, 이메일 같은 개인정보를 서버에 수집·저장하지 않아요.</p>

  <h2>입력하신 여행 정보는 어떻게 쓰이나요</h2>
  <p>지역·예산·기간·인원수 같은 정보는 코스를 생성하는 순간에만 서버로 전달되고, 응답을 만든 뒤에는 서버에 저장하지 않고 즉시 폐기해요.</p>

  <h2>기기에 저장되는 정보</h2>
  <p>저장한 코스, 오늘 무료 생성 횟수는 사용자 기기의 브라우저 저장소(localStorage)에만 저장돼요. 서버로 전송되지 않으며, 브라우저 데이터를 지우면 함께 삭제돼요.</p>

  <h2>광고</h2>
  <p>토스애즈(TossAds)를 통해 광고를 제공해요. 광고 효과 측정을 위해 광고 SDK가 기기 식별자 등 정보를 수집할 수 있으며, 이는 토스 자체 개인정보처리방침을 따라요.</p>

  <h2>지도</h2>
  <p>장소 위치 표시를 위해 카카오맵(Kakao Maps) API를 사용해요. 지도 표시 과정에서 카카오의 정책에 따라 정보가 처리될 수 있어요.</p>

  <h2>문의</h2>
  <p>개인정보 관련 문의는 <a href="mailto:newrion@gmail.com">newrion@gmail.com</a>으로 연락해 주세요.</p>
</body>
</html>`

function servePrivacyHtml(res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' })
  res.end(PRIVACY_HTML)
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname.startsWith('/api/')) {
    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    await handleApi(req, res, url)
    return
  }

  if (url.pathname === '/privacy') {
    servePrivacyHtml(res)
    return
  }

  if (!existsSync(join(distDir, 'index.html'))) {
    const message = await readFile(join(rootDir, 'index.html'), 'utf8')
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' })
    res.end(message)
    return
  }

  if (url.searchParams.get('view') === 'courses') {
    await serveShareHtml(req, res, url)
    return
  }

  await serveStatic(req, res, url)
}).listen(port, () => {
  console.log(`Summer travel web service running at http://127.0.0.1:${port}`)
})
