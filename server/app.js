import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateAiPlans } from './aiPlan.js'
import { diagnoseKakaoLocal } from './kakaoLocal.js'
import { fetchTourPlaces } from './tourApi.js'

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

  await serveStatic(req, res, url)
}).listen(port, () => {
  console.log(`Summer travel web service running at http://127.0.0.1:${port}`)
})
