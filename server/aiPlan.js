const PLACE_LIMIT = 8

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

function compactCourse(course) {
  return {
    key: course.key,
    label: course.label,
    title: course.title,
    budget: course.budget,
    ratios: course.ratios,
    budgetTier: course.budgetTier,
    places: (course.places || []).slice(0, PLACE_LIMIT).map((place) => ({
      name: place.name,
      kind: place.kind,
      tag: place.tag,
      cost: place.cost,
    })),
    days: (course.days || []).map((day) => ({
      day: day.day,
      title: day.title,
      summary: day.summary,
      places: (day.places || []).slice(0, PLACE_LIMIT).map((place) => ({
        name: place.name,
        kind: place.kind,
        tag: place.tag,
        cost: place.cost,
      })),
    })),
  }
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
          required: ['key', 'summary', 'budgetTable', 'strategy', 'slots'],
          properties: {
            key: { type: 'string' },
            summary: { type: 'string' },
            budgetTable: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'amount'],
                properties: {
                  label: { type: 'string' },
                  amount: { type: 'number' },
                },
              },
            },
            strategy: {
              type: 'array',
              items: { type: 'string' },
            },
            slots: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['day', 'time', 'type', 'keyword'],
                properties: {
                  day: { type: 'number' },
                  time: { type: 'string' },
                  type: { type: 'string' },
                  keyword: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }
}

export async function generateAiPlans({ input, personality, courses } = {}) {
  if (!hasUsableKey()) return []

  const payload = {
    input,
    personality: personality
      ? {
          top: personality.top,
          label: personality.label,
          ratios: personality.ratios,
          isDayTrip: personality.isDayTrip,
        }
      : null,
    courses: (courses || []).map(compactCourse),
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      instructions:
        'You are a Korean travel planner for a Toss web mini service. Return only practical Korean JSON. Make budget advice sensitive to trip length, party size, arrival time, and total budget. Use the provided real or candidate places as grounding, but do not invent exact prices. Keep each summary under 90 Korean characters and each strategy under 70 Korean characters.',
      input: JSON.stringify(payload),
      text: {
        format: {
          type: 'json_schema',
          name: 'travel_ai_plans',
          schema: schema(),
          strict: true,
        },
      },
      max_output_tokens: 2200,
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`)
  }

  const data = await response.json()
  const text = responseText(data)
  if (!text) return []

  const parsed = JSON.parse(text)
  return Array.isArray(parsed.plans) ? parsed.plans : []
}
