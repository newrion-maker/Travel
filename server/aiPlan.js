import { placeCostRange, sumCostRange, budgetState } from '../src/lib/budget.js'

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const CAND_LIMIT = 45
const WALL_CLOCK_MS = 12000 // 재요청 포함 전체 상한
const FIRST_TIMEOUT_MS = 8000

function hasUsableKey() {
  const key = process.env.OPENAI_API_KEY
  return Boolean(key && !key.includes('여기에') && !key.includes('your_') && key.length > 20)
}

function responseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text
  return (data?.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || part.content || '')
    .join('')
}

// 검증 장소 → 번호(id) 매긴 후보. AI는 이 id로만 선택한다. (스냅샷은 호출자가 준 places 하나로 고정)
function buildCandidates(places) {
  return places.slice(0, CAND_LIMIT).map((p, i) => {
    const { min, max } = placeCostRange(p)
    return { id: i, name: p.name, kind: p.kind, cost: Math.round((min + max) / 2) }
  })
}

function schema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['plans'],
    properties: {
      plans: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'summary', 'strategy', 'days'],
          properties: {
            key: { type: 'string' },
            summary: { type: 'string' },
            strategy: { type: 'array', items: { type: 'string' } },
            days: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['day', 'items'],
                properties: {
                  day: { type: 'number' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['id', 'role'],
                      properties: { id: { type: 'number' }, role: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
}

const INSTRUCTIONS = `You are an AI travel itinerary planner for a Korean Toss mini app.
You receive numbered CANDIDATE places (id, name, kind: stay|food|sight, cost in KRW) and several courses.
For EACH course, build a day-by-day itinerary by choosing places FROM the candidates BY id only.
Hard rules:
- Never invent places or ids outside the candidate list. Use integer ids from candidates only.
- Keep each course's estimated total (sum of chosen costs) within its budgetNet. When budget is tight, prefer cheaper candidates.
- Respect each course's ratios (stay/food/sight %) as spending emphasis.
- Overnight trips (days>1): include exactly ONE stay per night = every day except the last day. Day trips have no stay.
- Order each day strictly by time flow: 오전 관광 -> 아침 -> 점심 -> 카페 -> 관광/체험 -> 저녁 -> 마무리 카페 -> 숙박.
- Never place morning/lunch/afternoon roles after 저녁 or 숙박. 숙박 is always the last item of that day.
- For day 1, respect arrivalTime: if arrivalTime is 오후, do not use 아침 or 오전 관광; if arrivalTime is 저녁, focus on 저녁 and 숙박 only.
- Assign a Korean role to each item from: 점심, 저녁, 아침, 카페, 마무리 카페, 관광, 오전 관광, 체험, 숙박.
- Aim for the given itemsPerDay counts per day.
Also write a short Korean summary (<60 chars) and 2-3 short Korean strategy tips per course.
Return JSON matching the schema.`

async function callOpenAI(payload, signal, extra = '') {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      instructions: INSTRUCTIONS + extra,
      input: JSON.stringify(payload),
      text: { format: { type: 'json_schema', name: 'travel_ai_courses', schema: schema(), strict: true } },
      max_output_tokens: 3500,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const data = await res.json()
  const text = responseText(data)
  return text ? JSON.parse(text) : { plans: [] }
}

function daySummary(day, totalDays, arrivalTime) {
  if (day === 1) return arrivalTime === '저녁' ? '저녁 도착 · 식사·숙소 중심' : arrivalTime === '오전' ? '오전 도착 · 점심부터' : '오후 도착 · 가벼운 시작'
  return day === totalDays ? '마무리 동선' : '핵심 방문 동선'
}

function normalizeRoleForArrival(role, kind, day, arrivalTime) {
  if (kind === 'stay') return '숙박'
  let normalized = String(role || '').trim()

  if (day === 1 && arrivalTime === '오후') {
    if (normalized.includes('오전')) normalized = '관광'
    if (normalized === '아침') normalized = kind === 'food' ? '점심' : '관광'
  }

  if (day === 1 && arrivalTime === '저녁') {
    if (normalized === '아침' || normalized === '점심') normalized = '저녁'
    if (normalized.includes('오전')) normalized = '관광'
    if (normalized === '카페') normalized = '마무리 카페'
  }

  return normalized || (kind === 'food' ? '점심' : '관광')
}

function roleOrder(place) {
  const role = String(place.role || '')
  if (place.kind === 'stay' || role.includes('숙박')) return 90
  if (role.includes('오전')) return 10
  if (role.includes('아침')) return 20
  if (role.includes('점심')) return 30
  if (role === '카페') return 40
  if (role.includes('관광') || role.includes('체험')) return 50
  if (role.includes('저녁')) return 60
  if (role.includes('마무리') || role.includes('카페')) return 70
  if (place.kind === 'food') return 35
  if (place.kind === 'sight') return 50
  return 80
}

function sortDayPlacesByTimeFlow(dayPlaces, day, arrivalTime) {
  return dayPlaces
    .map((place, index) => ({
      ...place,
      role: normalizeRoleForArrival(place.role, place.kind, day, arrivalTime),
      originalIndex: index,
    }))
    .sort((a, b) => roleOrder(a) - roleOrder(b) || a.originalIndex - b.originalIndex)
    .map(({ originalIndex, ...place }, index) => ({
      ...place,
      slotId: place.kind === 'stay' ? 'stay' : `d${day}p${index}`,
    }))
}

// AI의 days(id+role) → 실제 place 객체로 복원. places 스냅샷은 검증에 쓴 것과 동일해야 함(호출자 보장).
function resolveDays(planDays, places, totalDays, arrivalTime) {
  const days = []
  for (const d of (planDays || []).slice().sort((a, b) => (a.day || 0) - (b.day || 0))) {
    const dayPlaces = []
    ;(d.items || []).forEach((it, i) => {
      const p = places[it.id]
      if (!p) return // 존재하지 않는 id는 버림
      const slotId = p.kind === 'stay' ? 'stay' : `d${d.day}p${i}`
      dayPlaces.push({ ...p, role: String(it.role || ''), slotId })
    })
    if (dayPlaces.length) {
      days.push({
        day: d.day,
        title: `${d.day}일차`,
        summary: daySummary(d.day, totalDays, arrivalTime),
        places: sortDayPlacesByTimeFlow(dayPlaces, d.day, arrivalTime),
      })
    }
  }
  return days
}

// 빨강 스왑 보정: 가장 비싼(min 기준) 장소를 같은 kind의 더 싼 후보로 교체(최대 3회).
// 3회 소진 후에도 빨강이면 false 반환 → 호출부에서 그 코스를 규칙 fallback으로 넘긴다.
function correctRed(days, budgetNet, places) {
  for (let guard = 0; guard < 3; guard += 1) {
    const flat = days.flatMap((d) => d.places)
    if (budgetState(sumCostRange(flat), budgetNet) !== 'over') return true
    let worst = null
    for (const p of flat) {
      const min = placeCostRange(p).min
      if (!worst || min > worst.min) worst = { name: p.name, kind: p.kind, min }
    }
    if (!worst) break
    const usedNames = new Set(flat.map((p) => p.name))
    const cheaper = places
      .filter((c) => c.kind === worst.kind && !usedNames.has(c.name) && placeCostRange(c).min < worst.min)
      .sort((a, b) => placeCostRange(a).min - placeCostRange(b).min)[0]
    if (!cheaper) break // 더 싼 후보 없음 → 보정 불가
    for (const day of days) {
      day.places = day.places.map((p) => (p.name === worst.name ? { ...cheaper, role: p.role, slotId: p.slotId } : p))
    }
  }
  return budgetState(sumCostRange(days.flatMap((d) => d.places)), budgetNet) !== 'over'
}

// 한 코스 결과 처리: 복원 → (초과면)보정 → 성공/실패 판정.
function processPlan(plan, meta, places, arrivalTime) {
  try {
    const days = resolveDays(plan.days, places, meta.days, arrivalTime)
    if (!days.length || days.flatMap((d) => d.places).length < 2) return { ok: false }
    const over = budgetState(sumCostRange(days.flatMap((d) => d.places)), meta.budgetNet) === 'over'
    const fixed = over ? correctRed(days, meta.budgetNet, places) : true
    if (!fixed) return { ok: false, over: true } // 3회 소진 후에도 빨강 → rule fallback
    return { ok: true, over, days, summary: String(plan.summary || ''), strategy: (plan.strategy || []).map(String).slice(0, 3) }
  } catch {
    return { ok: false }
  }
}

/**
 * AI가 실제 일정을 설계한다. 검증 장소(places)에서 id로만 선택 → 복원 → 예산 초과 시 재요청1회/스왑보정 → 코스별 fallback.
 * @returns 코스별 { key, source:'ai', summary, strategy, days } 배열. (여기 없는 코스는 클라가 규칙 fallback)
 */
export async function generateAiPlans({ input, personality, places, courses } = {}) {
  const verified = Array.isArray(places) ? places : []
  const metas = Array.isArray(courses) ? courses : []
  if (!hasUsableKey() || verified.length < 3 || !metas.length) return []

  const deadline = Date.now() + WALL_CLOCK_MS
  const candidates = buildCandidates(verified)
  const arrivalTime = input?.arrivalTime || '오후'
  const payload = {
    input: { period: input?.period, arrivalTime, transit: input?.transit, party: input?.party, budget: input?.budget },
    personality: personality ? { top: personality.top, label: personality.label, ratios: personality.ratios, isDayTrip: personality.isDayTrip } : null,
    candidates,
    courses: metas.map((m) => ({ key: m.key, label: m.label, ratios: m.ratios, budgetNet: m.budgetNet, days: m.days, itemsPerDay: m.itemsPerDay })),
  }
  const metaByKey = Object.fromEntries(metas.map((m) => [m.key, m]))
  const requireKeys = `\nYou MUST return exactly ${metas.length} plans — one plan object for EACH course key: ${metas.map((m) => m.key).join(', ')}. Never omit or merge courses; each key gets its own distinct itinerary.`

  async function attempt(extra) {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), Math.max(1000, Math.min(FIRST_TIMEOUT_MS, deadline - Date.now())))
    try {
      const parsed = await callOpenAI(payload, controller.signal, extra)
      return (parsed.plans || [])
        .filter((plan) => metaByKey[plan.key])
        .map((plan) => ({ key: plan.key, res: processPlan(plan, metaByKey[plan.key], verified, arrivalTime) }))
    } finally {
      clearTimeout(t)
    }
  }

  let results
  try {
    results = await attempt(requireKeys)
  } catch {
    return [] // 1차 실패/타임아웃 → 전부 규칙 fallback
  }

  // 재요청 1회: 실패/초과 코스가 있고 시간 남으면 (품질 유지용)
  const needsRetry = results.some((r) => !r.res.ok || r.res.over)
  if (needsRetry && Date.now() < deadline - 3500) {
    try {
      const results2 = await attempt(`${requireKeys}\nPrevious attempt exceeded budget for some courses. Pick cheaper combinations so each course total stays within budgetNet.`)
      const byKey2 = Object.fromEntries(results2.map((r) => [r.key, r]))
      results = results.map((r) => {
        const alt = byKey2[r.key]
        return alt && alt.res.ok && (!r.res.ok || r.res.over) ? alt : r
      })
    } catch {
      // 재요청 실패는 무시하고 1차 결과 사용
    }
  }

  const plans = []
  for (const r of results) {
    if (r.res.ok) plans.push({ key: r.key, source: 'ai', summary: r.res.summary, strategy: r.res.strategy, days: r.res.days })
  }

  const aiKeys = plans.map((p) => p.key)
  const ruleKeys = metas.map((m) => m.key).filter((k) => !aiKeys.includes(k))
  console.log(`[ai-plan] 실제 AI 설계=[${aiKeys.join(',') || '없음'}] 규칙 fallback=[${ruleKeys.join(',') || '없음'}]`)
  return plans
}
