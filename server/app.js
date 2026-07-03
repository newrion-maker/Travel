import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateAiPlans } from './aiPlan.js'
import { diagnoseKakaoLocal } from './kakaoLocal.js'
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

  if (url.pathname === '/api/kakao-health') {
    const query = url.searchParams.get('query') || '강릉'
    const result = await diagnoseKakaoLocal(query)
    sendJson(res, 200, result)
    return
  }

  if (url.pathname === '/api/tour-places') {
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
  const city = shortCityName(params.get('r') || '')
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

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url)
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
